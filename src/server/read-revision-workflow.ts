import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { orderedChapters, type Bible, type Chapter } from "../contracts";
import { executeRevisionCycle } from "../agents/write/revision";
import { revisedManuscriptSchema, type RevisedManuscript } from "../agents/write/runtime";
import type { WriteModel } from "../agents/write/model";
import { db } from "./db";
import { bibles, chapters, critiques, projects, proposals, runs, tasks } from "./db/schema";
import { configuredReadConnections } from "./read-connection-http";
import { assertCurrentReadConsistency, assertCurrentReadEditor, createReadConnections, type ReadConnectionOptions } from "./read-connections";
import { createReadRevisionConnection, revisionReaderOperation, revisionProposalIds, type ReadRevisionAssignments } from "./read-revision-connection";
import { ReadConnectionError, readRequestSchema, type ConnectionSnapshot, type ReadAssignment } from "./read-connection-contracts";

type Candidate={id:string;manuscript:RevisedManuscript};
export type ConnectedRevisionInput={ownerId:string;projectId:string;runId:string;stateVersion:number;bibleVersion:number;
  approvedBible:Bible;draftChapters:Chapter[];readingA:Chapter[];readingB:Chapter[];revisionRound:number;
  editorialInstructions:string;hasAdditionalInstructions:boolean;assignments:ReadRevisionAssignments;
  modelA:WriteModel;modelB:WriteModel;options:ReadConnectionOptions};
export type ConnectedRevisionStore={existing:()=>Promise<Candidate[]|undefined>;
  stage:(candidates:Candidate[])=>Promise<void>;finalize:(candidates:Candidate[])=>Promise<void>};

/** Real workflow orchestration, also injectable for synthetic end-to-end execution. */
export async function executeConnectedRevisionWorkflow(input:ConnectedRevisionInput,store:ConnectedRevisionStore){
  let candidates=await store.existing();
  if(!candidates){
    const cycle=await executeRevisionCycle({runId:input.runId,projectId:input.projectId,bibleVersion:input.bibleVersion,
      approvedBible:input.approvedBible,baseChapters:input.draftChapters,baseChaptersA:input.readingA,baseChaptersB:input.readingB,
      revisionRound:input.revisionRound,editorialInstructions:input.editorialInstructions,hasAdditionalInstructions:input.hasAdditionalInstructions,
      modelA:input.modelA,modelB:input.modelB,signal:input.options.runtime.signal,
      proposalIds:revisionProposalIds(input.runId),
      readConnection:createReadRevisionConnection({ownerId:input.ownerId,projectId:input.projectId,targetRunId:input.runId,
        assignments:input.assignments,options:input.options})});
    candidates=cycle.proposals.map(p=>({id:p.id,manuscript:p.manuscript}));
    await store.stage(candidates);
  }
  if(candidates.length!==2||new Set(candidates.map(p=>p.manuscript.kind)).size!==2)throw new ReadConnectionError("EDITOR_PAIR_REQUIRED");
  const service=createReadConnections(input.options);
  for(const candidate of candidates){
    const requestId=`consistency:${candidate.id}`;
    const assignment:ReadAssignment={...input.assignments.critic_editor_a,requestId,runId:input.runId,targetRunId:input.runId,
      draftVersion:input.revisionRound+1,source:{kind:"proposal",proposalId:candidate.id,proposalVersion:input.revisionRound+1}};
    await service.recordRequest(input.ownerId,input.projectId,assignment);
    await service.checkConsistency(input.ownerId,input.projectId,input.runId,requestId,`check:${candidate.id}`);
  }
  // The store must validate each exact report within its advancement transaction, not a pre-check.
  await store.finalize(candidates);
  return candidates;
}

/** Worker entry point. Trusted identity and authority come from owned persisted run/task rows. */
export async function executeReadConnectedRun(runId:string,modelA:WriteModel,modelB:WriteModel,signal:AbortSignal){
  const options=configuredReadConnections(signal);
  const [run]=await db.select().from(runs).where(eq(runs.id,runId));
  if(!run)throw new ReadConnectionError("TARGET_REVISION_CHANGED");
  const [project]=await db.select().from(projects).where(eq(projects.id,run.projectId));
  const [bible]=await db.select().from(bibles).where(and(eq(bibles.id,run.bibleId),eq(bibles.projectId,run.projectId)));
  const runTasks=await db.select().from(tasks).where(eq(tasks.runId,runId));
  const saved=runTasks[0]?.savedInput as {revisionRound?:number;editorialInstructions?:string;hasAdditionalInstructions?:boolean;
    readSourceRunId?:string;readSourceProposalIds?:string[]}|undefined;
  if(!project||!bible||runTasks.length!==3||typeof saved?.editorialInstructions!=="string"||typeof saved.hasAdditionalInstructions!=="boolean")
    throw new ReadConnectionError("PERSISTED_EDITORIAL_AUTHORITY_REQUIRED");
  const revisionRound=saved.revisionRound??0;
  if(revisionRound<0||revisionRound>2||saved.hasAdditionalInstructions!==Boolean(saved.editorialInstructions.trim())||runTasks.some(t=>{
    const other=t.savedInput as typeof saved;
    return other?.revisionRound!==revisionRound||other?.editorialInstructions!==saved.editorialInstructions||other?.hasAdditionalInstructions!==saved.hasAdditionalInstructions;
  }))throw new ReadConnectionError("PERSISTED_EDITORIAL_AUTHORITY_CHANGED");
  if(revisionRound>0&&!saved.readSourceRunId)throw new ReadConnectionError("TARGET_SOURCE_ASSIGNMENT_UNAVAILABLE");
  const sourceRun=revisionRound===0?run:(await db.select().from(runs).where(and(eq(runs.id,saved.readSourceRunId!),eq(runs.projectId,project.id),
    eq(runs.bibleId,bible.id),eq(runs.status,"completed")))).find(r=>r.id!==runId);
  if(!sourceRun)throw new ReadConnectionError("SOURCE_RUN_REQUIRED");
  const sourceRows=await db.select().from(chapters).where(eq(chapters.runId,sourceRun.id));
  const draftChapters=orderedChapters(sourceRows,bible.version);
  let readingA=draftChapters,readingB=draftChapters;
  type SourceSelection={kind:"draft"}|{kind:"proposal";proposalId:string};
  let sourceA:SourceSelection={kind:"draft"},sourceB:SourceSelection={kind:"draft"};
  if(revisionRound===2){
    const pending=await db.select().from(proposals).where(and(eq(proposals.projectId,project.id),eq(proposals.status,"pending"))).orderBy(desc(proposals.createdAt));
    const a=pending.find(p=>p.kind==="manuscript_a"&&p.id===saved.readSourceProposalIds?.[0]),
      b=pending.find(p=>p.kind==="manuscript_b"&&p.id===saved.readSourceProposalIds?.[1]);
    if(!a||!b)throw new ReadConnectionError("PREVIOUS_EDITOR_PAIR_REQUIRED");
    const pa=revisedManuscriptSchema.parse(a.data),pb=revisedManuscriptSchema.parse(b.data);
    if(pa.envelope?.runId!==sourceRun.id||pb.envelope?.runId!==sourceRun.id)throw new ReadConnectionError("SOURCE_RUN_CHANGED");
    readingA=orderedChapters(pa.chapters,bible.version);readingB=orderedChapters(pb.chapters,bible.version);
    sourceA={kind:"proposal",proposalId:a.id};sourceB={kind:"proposal",proposalId:b.id};
  }
  // Application defaults are not a human's explicit no-instructions choice. Require the existing authenticated request endpoint's durable record.
  const requestRows=await db.select().from(proposals).where(and(eq(proposals.projectId,project.id),eq(proposals.kind,"read_request"))).limit(201);
  if(requestRows.length>200)throw new ReadConnectionError("READ_HISTORY_CAPACITY");
  const assignment=(source:SourceSelection):ReadAssignment=>{
    const matches=requestRows.map(row=>readRequestSchema.safeParse(row.data)).filter(parsed=>parsed.success&&
      parsed.data.ownerId===project.ownerId&&parsed.data.assignment.runId===sourceRun.id&&parsed.data.assignment.targetRunId===runId&&
      parsed.data.assignment.editorialRound===revisionRound&&parsed.data.assignment.source.kind===source.kind&&
      (source.kind==="draft"||(parsed.data.assignment.source.kind==="proposal"&&parsed.data.assignment.source.proposalId===source.proposalId)));
    if(matches.length!==1||!matches[0].success)throw new ReadConnectionError("EXPLICIT_AUTHENTICATED_READ_REQUEST_REQUIRED");
    const a=matches[0].data.assignment;
    if(a.stateVersion!==project.version||a.bibleVersion!==bible.version||
      (revisionRound>0&&(a.recordedRequest!==saved.editorialInstructions||a.hasAdditionalInstructions!==saved.hasAdditionalInstructions)))
      throw new ReadConnectionError("PERSISTED_EDITORIAL_AUTHORITY_CHANGED");
    return a;
  };
  const assignments={critic_editor_a:assignment(sourceA),critic_editor_b:assignment(sourceB)};
  if(assignments.critic_editor_a.recordedRequest!==assignments.critic_editor_b.recordedRequest||
    assignments.critic_editor_a.hasAdditionalInstructions!==assignments.critic_editor_b.hasAdditionalInstructions)
    throw new ReadConnectionError("PERSISTED_EDITORIAL_AUTHORITY_CHANGED");
  type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
  async function locked<T>(work:(tx:Tx,target:ConnectionSnapshot,source:ConnectionSnapshot)=>Promise<T>){
    return db.transaction(async tx=>{
      await tx.execute(sql`select set_config('statement_timeout', '5000ms', true), set_config('lock_timeout', '5000ms', true)`);
      const [p]=await tx.select().from(projects).where(and(eq(projects.id,project.id),eq(projects.ownerId,project.ownerId))).for("update");
      const runRows=await tx.select().from(runs).where(inArray(runs.id,[runId,sourceRun!.id])).orderBy(runs.id).for("update");
      const target=runRows.find(r=>r.id===runId),source=runRows.find(r=>r.id===sourceRun!.id);
      const [b]=await tx.select().from(bibles).where(eq(bibles.id,bible.id)).for("share");
      if(!p||!target||!source||!b||p.version!==project.version||b.projectId!==p.id||b.version!==bible.version||
        target.projectId!==p.id||source.projectId!==p.id||target.bibleId!==b.id||source.bibleId!==b.id||
        target.canceledAt||source.canceledAt||!["running","pending"].includes(target.status)||signal.aborted)
        throw new ReadConnectionError("TARGET_REVISION_CHANGED");
      const chapterRows=await tx.select().from(chapters).where(inArray(chapters.runId,runRows.map(r=>r.id)))
        .orderBy(chapters.runId,chapters.chapterIndex).for("share");
      const rows=await tx.select().from(proposals).where(and(eq(proposals.projectId,p.id),
        inArray(proposals.kind,["read_request","read_operation","manuscript_a","manuscript_b"]))).orderBy(proposals.id).limit(201).for("update");
      if(rows.length>200)throw new ReadConnectionError("READ_HISTORY_CAPACITY");
      const snapshot=(r:typeof target):ConnectionSnapshot=>({project:p,run:r,bible:b,
        chapters:chapterRows.filter(c=>c.runId===r.id),rows,origin:"unverified"});
      return work(tx,snapshot(target),snapshot(source));
    });
  }
  const input:ConnectedRevisionInput={ownerId:project.ownerId,projectId:project.id,runId,stateVersion:project.version,bibleVersion:bible.version,
    approvedBible:bible.data,draftChapters,readingA,readingB,revisionRound,editorialInstructions:assignments.critic_editor_a.recordedRequest,
    hasAdditionalInstructions:assignments.critic_editor_a.hasAdditionalInstructions,assignments,modelA,modelB,options};
  const assertReaders=(source:ConnectionSnapshot)=>{
    for(const editorId of ["critic_editor_a","critic_editor_b"] as const)
      assertCurrentReadEditor(source,revisionReaderOperation(assignments[editorId]),editorId,runId);
  };
  return executeConnectedRevisionWorkflow(input,{
    existing:()=>locked(async(_tx,target)=>{
      const found=revisionProposalIds(runId).map(id=>target.rows.find(r=>r.id===id));
      if(found.every(r=>!r))return;
      if(found.some(r=>!r||r.status!=="awaiting_read"))throw new ReadConnectionError("STAGED_EDITOR_PAIR_CHANGED");
      return found.map(r=>({id:r!.id,manuscript:revisedManuscriptSchema.parse(r!.data)}));
    }),
    stage:candidates=>locked(async(tx,target,source)=>{
      assertReaders(source);
      for(const c of candidates){const editorId=c.manuscript.kind==="manuscript_a"?"critic_editor_a":"critic_editor_b";
        assertCurrentReadEditor(source,revisionReaderOperation(assignments[editorId]),editorId,runId,c.manuscript);}
      if(target.chapters.length){if(JSON.stringify(orderedChapters(target.chapters,bible.version).map(c=>[c.chapterIndex,c.text]))!==
        JSON.stringify(draftChapters.map(c=>[c.chapterIndex,c.text])))throw new ReadConnectionError("TARGET_BASE_CHANGED");}
      else await tx.insert(chapters).values(draftChapters.map(c=>({...c,id:randomUUID(),runId})));
      await tx.insert(proposals).values(candidates.map(c=>({id:c.id,projectId:project.id,baseVersion:bible.version,
        kind:c.manuscript.kind,status:"awaiting_read",data:c.manuscript})));
    }),
    finalize:candidates=>locked(async(tx,target,source)=>{
      assertReaders(source);
      const checks=candidates.map(c=>assertCurrentReadConsistency(target,c.id));
      await tx.update(proposals).set({status:"rejected"}).where(and(eq(proposals.projectId,project.id),eq(proposals.status,"pending"),
        inArray(proposals.kind,["manuscript_a","manuscript_b"])));
      await tx.update(proposals).set({status:"pending"}).where(and(eq(proposals.projectId,project.id),inArray(proposals.id,candidates.map(c=>c.id)),eq(proposals.status,"awaiting_read")));
      await tx.update(tasks).set({status:"completed",error:null,updatedAt:new Date()}).where(eq(tasks.runId,runId));
      await tx.insert(critiques).values({id:randomUUID(),runId,data:{revisionRounds:revisionRound,
        producerProvenance:"unverified; worker uses fixture Editorial models",verifiedLiveProducer:false,
        consistency:{label:"exact READ Consistency",versionA:checks[0].consistencyResult,versionB:checks[1].consistencyResult},
        unresolvedIssues:checks.flatMap(c=>c.consistencyResult?.output?.unresolvedIssues??[])}}).onConflictDoNothing();
      await tx.update(runs).set({status:"completed"}).where(eq(runs.id,runId));
    }),
  });
}
