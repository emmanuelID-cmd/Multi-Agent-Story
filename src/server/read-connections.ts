import { randomUUID } from "node:crypto";
import { z } from "zod";
import { bibleSchema, orderedChapters, type Chapter } from "../contracts";
import { readSnapshotSchema, type ReadSnapshot } from "../agents/read/contracts";
import { proposalDigest, runReader, runConsistency, sha256, type ReadDependencies } from "../agents/read/runtime";
import { revisedManuscriptSchema, hashManuscriptContent, verifyManuscriptEnvelope } from "../agents/write/runtime";
import { validateEditorReceivingHandoff, type ReaderToEditorHandoff } from "../agents/handoff";
import { storyReadModel } from "./story-budget";
import {
  connectionId, readAssignmentSchema, readRequestSchema, readOperationSchema, recoveryDecisionSchema, readerResultSchema,
  consistencyResultSchema, receiptSchema, ReadConnectionError,
  type ReadAssignment, type ReadRequest, type ReadOperation, type ConnectionSnapshot,
  type ConnectionWriter, type ConnectionRow, type ReadConnectionRepository, type ResolvedReadTarget,
} from "./read-connection-contracts";

const digest=(value:unknown)=>sha256(JSON.stringify(value));
const requestKey=(projectId:string,id:string)=>`read-request:${digest([projectId,id])}`;
const operationKey=(projectId:string,id:string)=>`read-operation:${digest([projectId,id])}`;
const sourceIdentity=(source:ReadAssignment["source"])=>source.kind==="draft"?"draft":`proposal:${source.proposalId}`;
const proposalRowIdentity=(row:ConnectionRow)=>({id:row.id,projectId:row.projectId,baseVersion:row.baseVersion,kind:row.kind,data:row.data});
const missing=()=>new ReadConnectionError("PROJECT_UNAVAILABLE","retrieval_recovery",404);
function owned(s:ConnectionSnapshot,ownerId:string,projectId:string,runId:string){
  if(s.project.ownerId!==ownerId||s.project.id!==projectId||s.run.id!==runId||s.run.projectId!==projectId||
    s.bible.projectId!==projectId||s.run.bibleId!==s.bible.id)throw missing();
}
function current(s:ConnectionSnapshot,a:ReadAssignment){
  if(s.run.canceledAt||s.run.status==="canceled")throw new ReadConnectionError("CANCELED");
  if(s.project.version!==a.stateVersion||s.bible.version!==a.bibleVersion)
    throw new ReadConnectionError("SOURCE_VERSION_CHANGED");
}
function proposal(s:ConnectionSnapshot,id:string){
  const row=s.rows.find(r=>r.id===id&&r.projectId===s.project.id&&["manuscript_a","manuscript_b"].includes(r.kind));
  if(!row||!["pending","awaiting_read"].includes(row.status))throw new ReadConnectionError("PROPOSAL_UNAVAILABLE","retrieval_recovery");
  const parsed=revisedManuscriptSchema.safeParse(row.data);
  if(!parsed.success||parsed.data.kind!==row.kind||row.baseVersion!==s.bible.version||
    !parsed.data.envelope||parsed.data.envelope.runId!==s.run.id)
    throw new ReadConnectionError("PROPOSAL_BINDING_INVALID");
  const manuscript=parsed.data;
  orderedChapters(manuscript.chapters,s.bible.version);
  const check=verifyManuscriptEnvelope({envelope:manuscript.envelope!,storedChapters:s.chapters,
    manuscript,expectedBaseVersion:s.bible.version});
  if(!check.valid)throw new ReadConnectionError("PROPOSAL_BASE_CHANGED");
  return {row,manuscript};
}
/** Resolve exact stored relationships. Draft/source revision is independent of the approved Bible revision. */
export function resolveReadSource(s:ConnectionSnapshot,a:ReadAssignment){
  current(s,a);
  const bible=bibleSchema.safeParse(s.bible.data);
  if(!bible.success||new Set(bible.data.facts.map(f=>f.id)).size!==bible.data.facts.length)
    throw new ReadConnectionError("BIBLE_UNREADABLE","retrieval_recovery");
  let base:Chapter[];
  try{base=orderedChapters(s.chapters,a.bibleVersion);}catch{throw new ReadConnectionError("WRITER_CHAPTERS_INCOMPLETE","writer_recovery");}
  if(s.chapters.some(c=>c.runId!==s.run.id)||new Set(s.chapters.map(c=>c.id)).size!==3)
    throw new ReadConnectionError("CHAPTER_IDENTITY_INVALID","writer_recovery");
  const selected=a.source.kind==="proposal"?proposal(s,a.source.proposalId):undefined;
  const sourceChapters=selected?.manuscript.chapters??base;
  const snapshot=readSnapshotSchema.parse({ownerId:s.project.ownerId,projectId:s.project.id,stateVersion:a.stateVersion,
    bibleVersion:a.bibleVersion,draftVersion:a.draftVersion,facts:bible.data.facts,
    ...(a.source.kind==="proposal"?{proposalId:a.source.proposalId,proposalVersion:a.source.proposalVersion}:{}),
    chapters:sourceChapters.map(c=>({...c,draftVersion:a.draftVersion,sha256:sha256(c.text),
      sourceId:selected?`proposal:${selected.row.id}:chapter:${c.chapterIndex}`:s.chapters.find(row=>row.chapterIndex===c.chapterIndex)!.id}))});
  const bibleDigest=digest({id:s.bible.id,version:s.bible.version,data:s.bible.data});
  const baseDigest=digest([...s.chapters].sort((a,b)=>a.chapterIndex-b.chapterIndex));
  const fingerprint=digest({runId:s.run.id,bibleId:s.run.bibleId,bibleDigest,baseDigest,
    source:a.source,sourceRow:selected?proposalRowIdentity(selected.row):undefined,chapters:snapshot.chapters,stateVersion:a.stateVersion,draftVersion:a.draftVersion});
  return {snapshot,fingerprint,bibleDigest,baseDigest,base,bible:bible.data,origin:s.origin};
}
function request(s:ConnectionSnapshot,requestId:string):ReadRequest{
  const row=s.rows.find(r=>r.id===requestKey(s.project.id,requestId)&&r.kind==="read_request");
  const parsed=readRequestSchema.safeParse(row?.data);
  if(!parsed.success||parsed.data.ownerId!==s.project.ownerId||parsed.data.projectId!==s.project.id||
    parsed.data.assignment.runId!==s.run.id||row!.status!=="recorded")throw new ReadConnectionError("REQUEST_UNAVAILABLE","retrieval_recovery");
  return parsed.data;
}
function exact(s:ConnectionSnapshot,r:ReadRequest){
  const resolved=resolveReadSource(s,r.assignment);
  if(resolved.fingerprint!==r.sourceFingerprint)throw new ReadConnectionError("SOURCE_CHANGED");
  return resolved;
}
function operation(s:ConnectionSnapshot,operationId:string):ReadOperation|undefined{
  const row=s.rows.find(r=>r.id===operationKey(s.project.id,operationId));
  if(!row)return;
  const parsed=readOperationSchema.safeParse(row.data);
  if(row.kind!=="read_operation"||!parsed.success||parsed.data.ownerId!==s.project.ownerId||parsed.data.projectId!==s.project.id)
    throw new ReadConnectionError("OPERATION_UNREADABLE");
  return parsed.data;
}
async function save(s:ConnectionSnapshot,w:ConnectionWriter,data:ReadRequest|ReadOperation){
  const isRequest=data.kind==="read_request";
  await w.save({id:isRequest?requestKey(s.project.id,data.assignment.requestId):operationKey(s.project.id,data.operationId),
    projectId:s.project.id,baseVersion:isRequest?data.assignment.stateVersion:request(s,data.requestId).assignment.stateVersion,
    kind:data.kind,status:isRequest?"recorded":data.status,data});
}
function assertIntent(op:ReadOperation,intent:string){if(op.intentFingerprint!==intent)throw new ReadConnectionError("OPERATION_INTENT_MISMATCH");}
function retryEligible(op:ReadOperation){
  if(op.recoveryDecisions.length||!op.budgetReservation||op.budgetReservation.settled||
    !["running","blocked","partial","failed","unavailable"].includes(op.status))return false;
  const last=op.agent==="reader"?op.readerResults.at(-1):op.consistencyResult;
  return !last||(!last.output&&last.attempts>0&&last.status!=="canceled");
}
/** Owner-scoped recovery inventory returns metadata only; it never dispatches a model call. */
export async function listReadRecoveryOperations(ownerId:string,projectId:string,runId:string,repository?:ReadConnectionRepository){
  const repo=repository??(await import("./read-connection-storage")).dbReadConnectionRepository;
  return repo.locked(ownerId,projectId,runId,async(s)=>{
    owned(s,ownerId,projectId,runId);
    return s.rows.filter(row=>row.kind==="read_operation"&&row.projectId===projectId).flatMap(row=>{
      const op=readOperationSchema.safeParse(row.data);if(!op.success)return [];
      if(op.data.ownerId!==ownerId||op.data.projectId!==projectId)return [];
      const requestRow=s.rows.find(item=>item.id===requestKey(projectId,op.data.requestId));
      const requestData=readRequestSchema.safeParse(requestRow?.data);if(!requestData.success)return [];
      if(requestData.data.ownerId!==ownerId||requestData.data.projectId!==projectId||
        requestData.data.assignment.runId!==runId)return [];
      const assignment=requestData.data.assignment;
      const result=op.data.agent==="reader"?op.data.readerResults.at(-1):op.data.consistencyResult;
      return [{agent:op.data.agent,operationId:op.data.operationId,status:op.data.status,reasonCode:op.data.reasonCode,
        savedResultStatus:result?.status??(op.data.status==="running"?"dispatch outcome unknown":"no result saved"),
        dependencyVersions:{projectState:assignment.stateVersion,approvedBible:assignment.bibleVersion,
          draft:assignment.draftVersion,request:assignment.requestVersion,editorialRound:assignment.editorialRound},
        retryAvailable:retryEligible(op.data)}];
    });
  });
}
/** Pure downstream gate: invoke only inside the same source-locked transaction as advancement. */
export function assertCurrentReadConsistency(s:ConnectionSnapshot,proposalId:string){
  const selected=proposal(s,proposalId);
  for(const row of s.rows){
    const parsed=readOperationSchema.safeParse(row.data);
    if(!parsed.success||parsed.data.agent!=="consistency"||parsed.data.proposalBinding?.proposalId!==proposalId)continue;
    const op=parsed.data,b=op.proposalBinding!;
    if(op.ownerId!==s.project.ownerId||op.projectId!==s.project.id||op.status!=="ready_for_review"||
      op.consistencyResult?.status!=="ready_for_review"||op.consistencyResult.output?.status!=="complete")continue;
    const r=request(s,op.requestId),resolved=exact(s,r),out=op.consistencyResult.output;
    if(r.assignment.source.kind!=="proposal"||r.assignment.source.proposalId!==proposalId||
      b.proposalVersion!==r.assignment.source.proposalVersion||out.proposalId!==proposalId||out.proposalVersion!==b.proposalVersion||
      out.proposalSha256!==b.readDigest||out.bibleVersion!==s.bible.version||
      b.writeDigest!==hashManuscriptContent(selected.manuscript)||b.readDigest!==proposalDigest(resolved.snapshot.chapters)||
      b.rowDigest!==digest(proposalRowIdentity(selected.row))||b.bibleDigest!==resolved.bibleDigest||b.baseDigest!==resolved.baseDigest)
      throw new ReadConnectionError("CONSISTENCY_BINDING_CHANGED");
    return op;
  }
  throw new ReadConnectionError("CURRENT_READ_CONSISTENCY_REQUIRED");
}
export function assertCurrentReadEditor(s:ConnectionSnapshot,operationId:string,editorId:"critic_editor_a"|"critic_editor_b",targetRunId:string,
  expected?:z.infer<typeof revisedManuscriptSchema>){
  const op=operation(s,operationId);if(!op||op.agent!=="reader"||op.status!=="ready_for_review")throw new ReadConnectionError("READER_EXECUTION_REQUIRED");
  const r=request(s,op.requestId);exact(s,r);
  if(r.assignment.targetRunId!==targetRunId||!op.editorExecutions.some(e=>e.editorId===editorId&&e.status==="output_produced"&&
    e.generation===op.generation&&e.handoffHash===digest(op.readerResults.at(-1)?.output?.handoff)))throw new ReadConnectionError("EDITOR_OUTPUT_BINDING_REQUIRED");
  const output=op.editorOutputs.find(out=>out.editorId===editorId&&out.generation===op.generation&&out.handoffHash===digest(op.readerResults.at(-1)?.output?.handoff));
  if(!output||(expected&&hashManuscriptContent(expected)!==hashManuscriptContent(output.proposal)))throw new ReadConnectionError("DURABLE_EDITOR_OUTPUT_REQUIRED");
  return output;
}
function errorCode(e:unknown){return e instanceof ReadConnectionError?e.code:"STORAGE_UNAVAILABLE";}
function failed(op:ReadOperation,e:unknown):ReadOperation{
  const code=errorCode(e);
  return {...op,status:code==="CANCELED"?"canceled":"blocked",reasonCode:code,
    route:e instanceof ReadConnectionError?e.route:"retrieval_recovery"};
}
export type ReadConnectionOptions={repository?:ReadConnectionRepository;
  runtime:Omit<ReadDependencies,"readSnapshot"|"readerContentRetries"|"readerCorrection">;
  versions:z.infer<typeof import("../agents/read/contracts").readVersionsSchema>};

/** Server-only services: caller supplies authenticated ownerId, never an owner asserted by model output. */
export function createReadConnections(options:ReadConnectionOptions){
  async function validatedTarget(s:ConnectionSnapshot,w:ConnectionWriter,a:ReadAssignment){
    const id=a.targetRunId??a.runId;
    const resolved:ResolvedReadTarget|undefined=id===s.run.id?{run:s.run}:await w.resolveTarget?.(id);
    if(!resolved)throw new ReadConnectionError("TARGET_SOURCE_ASSIGNMENT_UNAVAILABLE");
    const target=resolved.run;
    if(target.id!==id||target.projectId!==s.project.id||target.bibleId!==s.bible.id||target.canceledAt||target.status==="canceled"||
      !(id===s.run.id?["pending","running","paused","completed"]:["pending","running","paused"]).includes(target.status))
      throw new ReadConnectionError("TARGET_REVISION_CHANGED");
    if(id!==s.run.id&&(resolved.sourceRunId!==s.run.id||resolved.editorialRound!==a.editorialRound||
      resolved.editorialInstructions!==a.recordedRequest||resolved.hasAdditionalInstructions!==a.hasAdditionalInstructions||
      (a.source.kind==="proposal"?!resolved.sourceProposalIds?.includes(a.source.proposalId):Boolean(resolved.sourceProposalIds?.length))))
      throw new ReadConnectionError("TARGET_SOURCE_ASSIGNMENT_CHANGED");
    return target.id;
  }
  function reserveBudget(s:ConnectionSnapshot,r:ReadRequest,operationId:string,targetRunId:string){
    let tokens=0,cost=0;
    for(const row of s.rows.filter(row=>row.kind==="read_operation")){
      const parsed=readOperationSchema.safeParse(row.data);if(!parsed.success)throw new ReadConnectionError("BUDGET_LEDGER_UNREADABLE");
      const op=parsed.data;
      const recorded=s.rows.find(row=>row.id===requestKey(s.project.id,op.requestId));
      const parsedRequest=readRequestSchema.safeParse(recorded?.data);
      if(!parsedRequest.success)throw new ReadConnectionError("BUDGET_LEDGER_UNREADABLE");
      const assignment=parsedRequest.data.assignment;
      if((assignment.targetRunId??assignment.runId)!==targetRunId)continue;
      const attempts=[...op.budgetHistory,{generation:op.generation,reservation:op.budgetReservation,
        result:op.agent==="reader"?op.readerResults.at(-1):op.consistencyResult}];
      for(const attempt of attempts){
        const reservation=attempt.reservation;
        if(!reservation){
          if(op.status==="running")throw new ReadConnectionError("BUDGET_OUTCOME_UNSETTLED");
          const usage=attempt.result?.usage??{inputTokens:0,outputTokens:0};tokens+=usage.inputTokens+usage.outputTokens;
          cost+=(usage.inputTokens*options.runtime.budget.inputUsdPerMillion+usage.outputTokens*options.runtime.budget.outputUsdPerMillion)/1_000_000;
          continue;
        }
        if(!reservation.settled){tokens+=reservation.maxTokens;cost+=reservation.maxCostUsd;}
        else{const usage=attempt.result?.usage??{inputTokens:0,outputTokens:0};tokens+=usage.inputTokens+usage.outputTokens;
          cost+=(usage.inputTokens*reservation.inputUsdPerMillion+usage.outputTokens*reservation.outputUsdPerMillion)/1_000_000;}
      }
    }
    const remainingTokens=Math.max(0,options.runtime.budget.maxTokens-tokens),remainingCostUsd=Math.max(0,options.runtime.budget.maxCostUsd-cost);
    const maxTokens=Math.min(30_000,remainingTokens),maxCostUsd=Math.min(1.5,remainingCostUsd);
    if(!maxTokens||!maxCostUsd)throw new ReadConnectionError("TARGET_READ_BUDGET_EXHAUSTED");
    return {targetRunId,...options.runtime.budget,maxTokens,maxCostUsd,settled:false};
  }
  function reserveRetryBudget(s:ConnectionSnapshot,r:ReadRequest,op:ReadOperation,targetRunId:string){
    let tokens=0,cost=0;
    for(const row of s.rows.filter(row=>row.kind==="read_operation")){
      const parsed=readOperationSchema.safeParse(row.data);if(!parsed.success)throw new ReadConnectionError("BUDGET_LEDGER_UNREADABLE");
      const current=parsed.data,recorded=s.rows.find(item=>item.id===requestKey(s.project.id,current.requestId));
      const parsedRequest=readRequestSchema.safeParse(recorded?.data);
      if(!parsedRequest.success)throw new ReadConnectionError("BUDGET_LEDGER_UNREADABLE");
      if((parsedRequest.data.assignment.targetRunId??parsedRequest.data.assignment.runId)!==targetRunId)continue;
      const attempts=[...current.budgetHistory,{generation:current.generation,reservation:current.budgetReservation,
        result:current.agent==="reader"?current.readerResults.at(-1):current.consistencyResult}];
      for(const attempt of attempts){
        const reservation=attempt.reservation;
        if(!reservation)continue;
        if(!reservation.settled){tokens+=reservation.maxTokens;cost+=reservation.maxCostUsd;}
        else{const usage=attempt.result?.usage??{inputTokens:0,outputTokens:0};tokens+=usage.inputTokens+usage.outputTokens;
          cost+=(usage.inputTokens*reservation.inputUsdPerMillion+usage.outputTokens*reservation.outputUsdPerMillion)/1_000_000;}
      }
    }
    const maxTokens=Math.min(30_000,Math.max(0,options.runtime.budget.maxTokens-tokens));
    const maxCostUsd=Math.min(1.5,Math.max(0,options.runtime.budget.maxCostUsd-cost));
    if(!maxTokens||!maxCostUsd)throw new ReadConnectionError("TARGET_READ_BUDGET_EXHAUSTED");
    return {targetRunId,...options.runtime.budget,maxTokens,maxCostUsd,settled:false};
  }
  async function locked<T>(ownerId:string,projectId:string,runId:string,work:(s:ConnectionSnapshot,w:ConnectionWriter)=>Promise<T>){
    [ownerId,projectId,runId].forEach(v=>connectionId.parse(v));
    const repo=options.repository??(await import("./read-connection-storage")).dbReadConnectionRepository;
    return repo.locked(ownerId,projectId,runId,async(s,w)=>{owned(s,ownerId,projectId,runId);return work(s,w);});
  }
  async function recordRequest(ownerId:string,projectId:string,input:ReadAssignment){
    const a=readAssignmentSchema.parse(input);
    if(new Set(a.editorialTask.scope).size!==3)throw new ReadConnectionError("EDITORIAL_SCOPE_INVALID","human_review",400);
    return locked(ownerId,projectId,a.runId,async(s,w)=>{
      await validatedTarget(s,w,a);
      const resolved=resolveReadSource(s,a);
      const data=readRequestSchema.parse({schemaVersion:1,kind:"read_request",ownerId,projectId,assignment:a,
        sourceFingerprint:resolved.fingerprint,draftVersionAuthority:"authenticated_assignment"});
      const existing=s.rows.find(row=>row.id===requestKey(projectId,a.requestId));
      if(existing){if(digest(existing.data)!==digest(data))throw new ReadConnectionError("REQUEST_INTENT_MISMATCH");return data;}
      for(const row of s.rows.filter(row=>row.kind==="read_request")){
        const prior=readRequestSchema.safeParse(row.data);
        if(prior.success&&a.source.kind==="proposal"&&prior.data.assignment.source.kind==="proposal"&&
          prior.data.assignment.source.proposalId===a.source.proposalId&&
          prior.data.assignment.source.proposalVersion!==a.source.proposalVersion)
          throw new ReadConnectionError("PROPOSAL_REVISION_ALREADY_BOUND");
        if(prior.success&&prior.data.assignment.runId===a.runId&&prior.data.assignment.draftVersion===a.draftVersion&&
          sourceIdentity(prior.data.assignment.source)===sourceIdentity(a.source)&&prior.data.sourceFingerprint!==resolved.fingerprint)
          throw new ReadConnectionError("DRAFT_REVISION_ALREADY_BOUND");
        if(prior.success&&prior.data.assignment.runId===a.runId&&prior.data.assignment.editorialRound===a.editorialRound&&
          sourceIdentity(prior.data.assignment.source)===sourceIdentity(a.source))throw new ReadConnectionError("ROUND_REQUEST_ALREADY_BOUND");
      }
      await save(s,w,data);return data;
    });
  }
  async function prepareReader(ownerId:string,projectId:string,runId:string,requestId:string,operationId:string){
    connectionId.parse(operationId);
    const prepared=await locked(ownerId,projectId,runId,async(s,w)=>{
      const r=request(s,requestId),source=exact(s,r);
      const targetRunId=await validatedTarget(s,w,r.assignment);
      const intent=digest({agent:"reader",request:r,versions:options.versions});
      if(s.rows.some(row=>row.kind==="read_operation"&&readOperationSchema.safeParse(row.data).success&&
        (row.data as ReadOperation).requestId===requestId&&(row.data as ReadOperation).agent==="reader"&&
        (row.data as ReadOperation).operationId!==operationId))throw new ReadConnectionError("REQUEST_OPERATION_ALREADY_BOUND");
      const prior=operation(s,operationId);
      if(prior){assertIntent(prior,intent);return {op:prior,r,source,dispatch:false};}
      const op=readOperationSchema.parse({schemaVersion:1,kind:"read_operation",ownerId,projectId,operationId,requestId,
        agent:"reader",intentFingerprint:intent,sourceFingerprint:source.fingerprint,versions:options.versions,
        generation:1,repairUsed:false,status:"running",reasonCode:"READER_DISPATCH_RESERVED",route:"reader_correction",
        origin:source.origin,verifiedLiveProducer:false,draftVersionAuthority:"authenticated_assignment",receipts:[],readerResults:[],
        budgetReservation:reserveBudget(s,r,operationId,targetRunId)});
      await save(s,w,op);return {op,r,source,dispatch:true};
    });
    if(!prepared.dispatch)return prepared.op;
    return dispatchReader(ownerId,projectId,runId,prepared.op,prepared.r,prepared.source.snapshot);
  }
  async function retryUncertain(ownerId:string,projectId:string,runId:string,operationId:string,duplicateProviderCallAcknowledged:boolean){
    connectionId.parse(operationId);
    if(duplicateProviderCallAcknowledged!==true)throw new ReadConnectionError("RETRY_CONFIRMATION_REQUIRED","human_review",400);
    const prepared=await locked(ownerId,projectId,runId,async(s,w)=>{
      const op=operation(s,operationId);if(!op)throw new ReadConnectionError("OPERATION_UNAVAILABLE","retrieval_recovery",404);
      const r=request(s,op.requestId),source=exact(s,r),targetRunId=await validatedTarget(s,w,r.assignment);
      if(op.recoveryDecisions.length)return {op,r,source,dispatch:false};
      if(op.status==="canceled"||op.status==="ready_for_review"||op.status==="exhausted"||
        !op.budgetReservation||op.budgetReservation.settled)throw new ReadConnectionError("RETRY_NOT_ELIGIBLE");
      const priorResult=op.agent==="reader"?op.readerResults.at(-1):op.consistencyResult;
      if(priorResult&&(priorResult.output||priorResult.attempts===0||priorResult.status==="canceled"))
        throw new ReadConnectionError("RETRY_NOT_ELIGIBLE");
      const decision=recoveryDecisionSchema.parse({
        decision:"retry_once",decisionId:randomUUID(),duplicateProviderCallAcknowledged:true,
        authorizedAt:new Date().toISOString(),priorGeneration:op.generation,
        priorStatus:op.status,priorReasonCode:op.reasonCode,priorResult,
        priorBudgetReservation:op.budgetReservation,
        dependency:{requestVersion:r.assignment.requestVersion,stateVersion:s.project.version,bibleVersion:s.bible.version,sourceFingerprint:source.fingerprint},
      });
      const next=readOperationSchema.parse({...op,generation:op.generation+1,recoveryDecisions:[decision],
        budgetHistory:op.budgetReservation?[...op.budgetHistory,{generation:op.generation,reservation:op.budgetReservation,result:priorResult}]:op.budgetHistory,status:"running",
        reasonCode:op.agent==="reader"?"READER_RETRY_RESERVED":"CONSISTENCY_RETRY_RESERVED",
        route:op.agent==="reader"?"reader_correction":"human_review",
        budgetReservation:reserveRetryBudget(s,r,op,targetRunId)});
      await save(s,w,next);return {op:next,r,source,dispatch:true};
    });
    if(!prepared.dispatch)return prepared.op;
    if(prepared.op.agent==="reader")
      return dispatchReader(ownerId,projectId,runId,prepared.op,prepared.r,prepared.source.snapshot);
    return dispatchConsistency(ownerId,projectId,runId,prepared.op,prepared.r,prepared.source.snapshot,prepared.op.proposalBinding!);
  }
  async function dispatchReader(ownerId:string,projectId:string,runId:string,op:ReadOperation,r:ReadRequest,snapshot:ReadSnapshot,
    correction?:z.infer<typeof import("./read-connection-contracts").rejectionSchema>){
    const a=r.assignment;
    const model=options.repository?options.runtime.model:storyReadModel(options.runtime.model,ownerId,projectId,`${op.operationId}:${op.generation}`);
    const used=op.readerResults.reduce((total,r)=>({inputTokens:total.inputTokens+r.usage.inputTokens,outputTokens:total.outputTokens+r.usage.outputTokens}),{inputTokens:0,outputTokens:0});
    const reserved=op.budgetReservation??options.runtime.budget;
    const budget={...options.runtime.budget,maxTokens:Math.max(0,reserved.maxTokens-used.inputTokens-used.outputTokens),
      maxCostUsd:Math.max(0,reserved.maxCostUsd-(used.inputTokens*options.runtime.budget.inputUsdPerMillion+used.outputTokens*options.runtime.budget.outputUsdPerMillion)/1_000_000)};
    const result=readerResultSchema.parse(await runReader({authority:{runId,projectId,ownerId,
      taskId:a.requestId,operationId:op.operationId,stateVersion:a.stateVersion,requestVersion:a.requestVersion,prdVersion:"v4-draft"},
      versions:options.versions,bibleVersion:a.bibleVersion,draftVersion:a.draftVersion,editorialTask:a.editorialTask,
      recordedRequest:a.recordedRequest,hasAdditionalInstructions:a.hasAdditionalInstructions,revision:a.editorialRound},
      {...options.runtime,model,budget,readerContentRetries:0,readerCorrection:correction,readSnapshot:async()=>snapshot}));
    if(result.output)result.output.handoff.version.handoffRevision=op.generation;
    // Model work is outside the repository lock. Late changes cannot become retained success.
    return locked(ownerId,projectId,runId,async(s,w)=>{
      const latest=operation(s,op.operationId);
      if(!latest||latest.generation!==op.generation||latest.status!=="running")throw new ReadConnectionError("DISPATCH_NO_LONGER_CURRENT");
      let next:ReadOperation={...latest,readerResults:[...latest.readerResults,result],status:result.status,
        budgetReservation:latest.budgetReservation?{...latest.budgetReservation,
          settled:result.attempts===0||Boolean(result.output&&["ready_for_review","partial"].includes(result.status))}:undefined,
        reasonCode:result.reasonCode,route:result.status==="ready_for_review"?"editor":"reader_correction"};
      try{const fresh=request(s,r.assignment.requestId);if(digest(fresh)!==digest(r))throw new ReadConnectionError("REQUEST_CHANGED");exact(s,fresh);await validatedTarget(s,w,fresh.assignment);
        if(options.runtime.signal?.aborted)throw new ReadConnectionError("CANCELED");
      }catch(e){next=failed(next,e);}
      await save(s,w,next);return next;
    });
  }
  /** Actual receiving boundary: Editor identity is fixed; rejection content is computed, never model authority. */
  async function receiveReader(ownerId:string,projectId:string,runId:string,operationId:string,editorId:"critic_editor_a"|"critic_editor_b"){
    z.enum(["critic_editor_a","critic_editor_b"]).parse(editorId);
    const prepared=await locked(ownerId,projectId,runId,async(s,w)=>{
      const op=operation(s,operationId);
      if(!op||op.agent!=="reader")throw new ReadConnectionError("READER_OPERATION_UNAVAILABLE","retrieval_recovery");
      const r=request(s,op.requestId),source=exact(s,r);
      const targetRunId=await validatedTarget(s,w,r.assignment);
      if(op.status==="running"||op.status==="canceled"||op.status==="exhausted")return {op,dispatch:false,r,source};
      const handoff=op.readerResults.at(-1)?.output?.handoff;
      // No artifact arrived: execution failure is not an Editor rejection or a content-repair trigger.
      if(!handoff)return {op,dispatch:false,r,source};
      const handoffHash=digest(handoff??null);
      if(op.receipts.some(receipt=>receipt.editorId===editorId&&receipt.handoffHash===handoffHash))return {op,dispatch:false,r,source};
      const validation=validateEditorReceivingHandoff({handoff,expectedRecordedRequest:r.assignment.recordedRequest,
        baseChapters:source.snapshot.chapters,approvedBibleVersion:r.assignment.bibleVersion,
        sourceAssignment:{draftVersion:r.assignment.draftVersion,chapters:source.snapshot.chapters}});
      if(handoff&&(digest(handoff.task)!==digest({taskId:r.assignment.requestId,...r.assignment.editorialTask})||
        handoff.userInstructions.revision!==r.assignment.editorialRound||
        handoff.userInstructions.hasAdditionalInstructions!==r.assignment.hasAdditionalInstructions)){
        validation.valid=false;validation.rejection={failedChecks:["REQUEST_BINDING_MISMATCH"],missingItems:[],requestedCorrection:"Restore the exact recorded editorial assignment."};
      }
      const receipt=receiptSchema.parse({kind:"receiving_validation",editorId,handoffHash,handoffRevision:op.generation,accepted:validation.valid,rejection:validation.rejection});
      let next:ReadOperation={...op,receipts:[...op.receipts,receipt]};
      if(validation.valid){await save(s,w,next);return {op:next,r,source,dispatch:false};}
      if(op.repairUsed){next={...next,status:"exhausted",reasonCode:"READER_REPAIR_EXHAUSTED",route:"human_review"};
        await save(s,w,next);return {op:next,r,source,dispatch:false};}
      next={...next,generation:2,repairUsed:true,status:"running",reasonCode:"READER_REPAIR_RESERVED",route:"reader_correction",
        budgetHistory:next.budgetReservation?[...next.budgetHistory,{generation:next.generation,reservation:next.budgetReservation,result:next.readerResults.at(-1)}]:next.budgetHistory,
        budgetReservation:reserveBudget(s,r,op.operationId,targetRunId)};
      await save(s,w,next);return {op:next,r,source,dispatch:true,correction:receipt.rejection};
    });
    if(!prepared.dispatch)return prepared.op;
    return dispatchReader(ownerId,projectId,runId,prepared.op,prepared.r,prepared.source.snapshot,prepared.correction);
  }
  async function checkConsistency(ownerId:string,projectId:string,runId:string,requestId:string,operationId:string){
    connectionId.parse(operationId);
    const prepared=await locked(ownerId,projectId,runId,async(s,w)=>{
      const r=request(s,requestId),source=exact(s,r),a=r.assignment;
      const targetRunId=await validatedTarget(s,w,a);
      if(a.source.kind!=="proposal")throw new ReadConnectionError("PROPOSAL_ASSIGNMENT_REQUIRED");
      const selected=proposal(s,a.source.proposalId);
      const binding={proposalId:selected.row.id,proposalVersion:a.source.proposalVersion,
        writeDigest:hashManuscriptContent(selected.manuscript),readDigest:proposalDigest(source.snapshot.chapters),
        rowDigest:digest(proposalRowIdentity(selected.row)),bibleDigest:source.bibleDigest,baseDigest:source.baseDigest};
      const intent=digest({agent:"consistency",request:r,binding,versions:options.versions});
      if(s.rows.some(row=>row.kind==="read_operation"&&readOperationSchema.safeParse(row.data).success&&
        (row.data as ReadOperation).requestId===requestId&&(row.data as ReadOperation).agent==="consistency"&&
        (row.data as ReadOperation).operationId!==operationId))throw new ReadConnectionError("REQUEST_OPERATION_ALREADY_BOUND");
      const prior=operation(s,operationId);
      if(prior){assertIntent(prior,intent);return {op:prior,r,source,binding,dispatch:false};}
      const op=readOperationSchema.parse({schemaVersion:1,kind:"read_operation",ownerId,projectId,operationId,requestId,
        agent:"consistency",intentFingerprint:intent,sourceFingerprint:source.fingerprint,versions:options.versions,
        generation:1,repairUsed:false,status:"running",reasonCode:"CONSISTENCY_DISPATCH_RESERVED",route:"human_review",
        origin:source.origin,verifiedLiveProducer:false,draftVersionAuthority:"authenticated_assignment",receipts:[],readerResults:[],proposalBinding:binding,
        budgetReservation:reserveBudget(s,r,operationId,targetRunId)});
      await save(s,w,op);return {op,r,source,binding,dispatch:true};
    });
    if(!prepared.dispatch)return prepared.op;
    return dispatchConsistency(ownerId,projectId,runId,prepared.op,prepared.r,prepared.source.snapshot,prepared.binding);
  }
  async function dispatchConsistency(ownerId:string,projectId:string,runId:string,op:ReadOperation,r:ReadRequest,snapshot:ReadSnapshot,
    binding:NonNullable<ReadOperation["proposalBinding"]>){
    const a=r.assignment,b=binding;
    const model=options.repository?options.runtime.model:storyReadModel(options.runtime.model,ownerId,projectId,`${op.operationId}:${op.generation}`);
    const result=consistencyResultSchema.parse(await runConsistency({authority:{runId,projectId,ownerId,
      taskId:a.requestId,operationId:op.operationId,stateVersion:a.stateVersion,requestVersion:a.requestVersion,prdVersion:"v4-draft"},
      versions:options.versions,bibleVersion:a.bibleVersion,draftVersion:a.draftVersion,
      proposalId:b.proposalId,proposalVersion:b.proposalVersion,proposalSha256:b.readDigest},
      {...options.runtime,model,budget:op.budgetReservation??options.runtime.budget,readSnapshot:async()=>snapshot}));
    return locked(ownerId,projectId,runId,async(s,w)=>{
      const latest=operation(s,op.operationId);
      if(!latest||latest.generation!==op.generation||latest.status!=="running")throw new ReadConnectionError("DISPATCH_NO_LONGER_CURRENT");
      let next:ReadOperation={...latest,status:["MODEL_UNAVAILABLE","DEPENDENCY_UNAVAILABLE","SNAPSHOT_RESOLVER_UNAVAILABLE"].includes(result.reasonCode)?"unavailable":result.status,
        budgetReservation:latest.budgetReservation?{...latest.budgetReservation,
          settled:result.attempts===0||Boolean(result.output&&["ready_for_review","partial"].includes(result.status))}:undefined,
        reasonCode:result.reasonCode,consistencyResult:result};
      try{const fresh=request(s,r.assignment.requestId);if(digest(fresh)!==digest(r))throw new ReadConnectionError("REQUEST_CHANGED");exact(s,fresh);await validatedTarget(s,w,fresh.assignment);
        if(options.runtime.signal?.aborted)throw new ReadConnectionError("CANCELED");
      }catch(e){next=failed(next,e);}
      await save(s,w,next);return next;
    });
  }
  async function recordEditorExecution(ownerId:string,projectId:string,runId:string,operationId:string,
    editorId:"critic_editor_a"|"critic_editor_b",handoff:ReaderToEditorHandoff,status:"accepted_for_execution"|"output_produced"|"failed",modelUsed?:string,
    output?:import("../agents/write/runtime").GenerateEditorialProposalResult){
    return locked(ownerId,projectId,runId,async(s,w)=>{
      const op=operation(s,operationId);if(!op||op.agent!=="reader")throw new ReadConnectionError("READER_OPERATION_UNAVAILABLE");
      const r=request(s,op.requestId);exact(s,r);await validatedTarget(s,w,r.assignment);
      if(digest(op.readerResults.at(-1)?.output?.handoff)!==digest(handoff))throw new ReadConnectionError("EDITOR_HANDOFF_CHANGED");
      const entry={editorId,handoffHash:digest(handoff),generation:op.generation,status,modelUsed,
        producerOrigin:modelUsed?.startsWith("fixture")?"synthetic" as const:"unverified" as const};
      if(status==="accepted_for_execution"&&op.editorExecutions.some(e=>e.editorId===editorId&&
        e.handoffHash===entry.handoffHash&&e.generation===entry.generation))throw new ReadConnectionError("EDITOR_DISPATCH_ALREADY_RESERVED");
      if(status!=="accepted_for_execution"&&!op.editorExecutions.some(e=>e.editorId===editorId&&
        e.handoffHash===entry.handoffHash&&e.generation===entry.generation&&e.status==="accepted_for_execution"))
        throw new ReadConnectionError("EDITOR_DISPATCH_RESERVATION_REQUIRED");
      if(op.editorExecutions.some(e=>digest(e)===digest(entry)))return op;
      if(status==="output_produced"&&!output)throw new ReadConnectionError("EDITOR_OUTPUT_REQUIRED");
      const editorOutputs=output?[...op.editorOutputs,{editorId,handoffHash:entry.handoffHash,generation:op.generation,...output}]:op.editorOutputs;
      const next=readOperationSchema.parse({...op,editorExecutions:[...op.editorExecutions,entry],editorOutputs});await save(s,w,next);return next;
    });
  }
  return {recordRequest,prepareReader,receiveReader,checkConsistency,retryUncertain,recordEditorExecution};
}
