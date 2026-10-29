import { describe, expect, it, vi } from "vitest";
import { executeConnectedRevisionWorkflow, type ConnectedRevisionInput, type ConnectedRevisionStore } from "../src/server/read-revision-workflow";
import { createReadRevisionConnection, revisionReaderOperation } from "../src/server/read-revision-connection";
import { assertCurrentReadConsistency, assertCurrentReadEditor, createReadConnections } from "../src/server/read-connections";
import { ReadConnectionError, type ConnectionRow, type ConnectionSnapshot, type ReadAssignment, type ReadConnectionRepository } from "../src/server/read-connection-contracts";
import { buildManuscriptEnvelope, type RevisedManuscript } from "../src/agents/write/runtime";
import type { Chapter } from "../src/contracts";
import type { ModelCall } from "../src/agents/read/model";
import { db } from "../src/server/db";
import { projects, proposals, chapters, bibles, runs } from "../src/server/db/schema";
import { approveManuscriptProposal } from "../src/server/projects";

function harness(round=1){
  const rows:ConnectionRow[]=[],events:string[]=[],editorData:unknown[]=[];
  const bible={id:"bible",projectId:"project",version:2,data:{facts:[{id:"fact",text:"Mara cannot swim."}],
    beats:[1,2,3].map(chapterIndex=>({chapterIndex,text:"Boat scene."}))}};
  const project={id:"project",ownerId:"owner",version:2};
  const source:ConnectionSnapshot={project,bible,run:{id:"source-run",projectId:"project",bibleId:"bible",status:"completed",canceledAt:null},
    chapters:[1,2,3].map(chapterIndex=>({id:`source-${chapterIndex}`,runId:"source-run",chapterIndex,bibleVersion:2,text:`Mara remains aboard scene ${chapterIndex}.`})),rows,origin:"synthetic"};
  const target:ConnectionSnapshot={project,bible,run:{id:"target-run",projectId:"project",bibleId:"bible",status:"running",canceledAt:null},chapters:[],rows,origin:"synthetic"};
  const targetLink={sourceRunId:"source-run",sourceProposalIds:round===2?["manuscript_a","manuscript_b"]:undefined,
    editorialRound:round,editorialInstructions:"",hasAdditionalInstructions:false};
  let tail:Promise<unknown>=Promise.resolve();
  const repo:ReadConnectionRepository={locked(ownerId,projectId,runId,work){
    const next=tail.then(()=>{
      const s=runId===source.run.id?source:runId===target.run.id?target:undefined;
      if(!s||ownerId!==s.project.ownerId||projectId!==s.project.id)throw new ReadConnectionError("PROJECT_UNAVAILABLE");
      return work(structuredClone(s),{async resolveTarget(id){
        if(id!==target.run.id)throw new ReadConnectionError("PROJECT_UNAVAILABLE");
        return structuredClone({run:target.run,...targetLink});
      },async save(row){const i=rows.findIndex(r=>r.id===row.id);if(i<0)rows.push(structuredClone(row));else rows[i]=structuredClone(row);}});
    });tail=next.catch(()=>{});return next;
  }};
  let confidence=1,consistencyError:string|undefined,readTokens=100,failEditorB=false;
  const calls:ModelCall[]=[];
  const readModel={modelId:"fixture-read-workflow",async complete(call:ModelCall){
    calls.push(call);events.push(call.agent);
    const snapshot=(call.data as {snapshot:{chapters:{chapterIndex:number;sourceId:string;text:string}[]}}).snapshot;
    if(call.agent==="consistency"&&consistencyError)throw new Error(consistencyError);
    const value=call.agent==="reader"?{findings:snapshot.chapters.map(c=>({chapterIndex:c.chapterIndex,sourceId:c.sourceId,quote:c.text,factId:"fact",observation:"The character remains aboard."})),missingItems:[],confidence}:
      {findings:[],unresolvedIssues:[],checkedFactIds:["fact"],checkedChapterIndexes:[1,2,3]};
    confidence=1;return {value,usage:{inputTokens:readTokens,outputTokens:100}};
  }};
  const writeModel={async complete(call:import("../src/agents/write/model").WriteModelCall){
    events.push(call.role);editorData.push(call.data);
    if(call.role==="critic_editor_b"&&failEditorB)throw new Error("MODEL_UNAVAILABLE");
    const data=call.data as {baseChapters:Chapter[]};
    return {value:{rationale:"Original editorial proposal.",chapters:data.baseChapters.map(c=>({chapterIndex:c.chapterIndex,text:c.text+` Revised ${call.role}.`})),
      changesMade:[{chapterIndex:1,summary:"Clarify the scene",justification:"Preserve the approved facts"}]},
      usage:{inputTokens:100,outputTokens:100},modelUsed:"fixture-editor"};
  }};
  const draft=source.chapters.map(({chapterIndex,bibleVersion,text})=>({chapterIndex,bibleVersion,text}));
  let readingA=draft,readingB=draft;
  const assignment=(sourceRef:ReadAssignment["source"]):ReadAssignment=>({schemaVersion:1,
    requestId:`request:${sourceRef.kind==="draft"?"draft":sourceRef.proposalId}`,requestVersion:1,runId:"source-run",targetRunId:"target-run",
    stateVersion:2,bibleVersion:2,draftVersion:5,editorialRound:round,editorialTask:{action:"revise",scope:[1,2,3],expectedOutput:"Two full proposals."},
    recordedRequest:"",hasAdditionalInstructions:false,source:sourceRef});
  let a=assignment({kind:"draft"}),b=a;
  if(round===2){
    for(const kind of ["manuscript_a","manuscript_b"] as const){
      const manuscript:RevisedManuscript={kind,editorialLens:kind==="manuscript_a"?"continuity_and_pacing":"voice_and_atmosphere",
        rationale:"Previous proposal",changesMade:[{chapterIndex:1,summary:"Earlier change",justification:"Earlier instruction"}],
        chapters:draft.map(c=>({...c,text:c.text+` Previous ${kind}.`}))};
      manuscript.envelope=buildManuscriptEnvelope({runId:"source-run",baseVersion:2,baseChapters:draft,manuscript});
      rows.push({id:kind,projectId:"project",baseVersion:2,kind,status:"pending",data:manuscript});
      if(kind==="manuscript_a"){readingA=manuscript.chapters;a=assignment({kind:"proposal",proposalId:kind,proposalVersion:2});}
      else{readingB=manuscript.chapters;b=assignment({kind:"proposal",proposalId:kind,proposalVersion:2});}
    }
  }
  const options={repository:repo,runtime:{model:readModel,budget:{maxTokens:30_000,maxCostUsd:1,inputUsdPerMillion:1,outputUsdPerMillion:5}},
    versions:{contract:"read-v1" as const,prompt:"read-v1" as const,harness:"read-connections-v1",model:readModel.modelId}};
  const input:ConnectedRevisionInput={ownerId:"owner",projectId:"project",runId:"target-run",stateVersion:2,bibleVersion:2,approvedBible:bible.data,
    draftChapters:draft,readingA,readingB,revisionRound:round,editorialInstructions:"",hasAdditionalInstructions:false,
    assignments:{critic_editor_a:a,critic_editor_b:b},modelA:writeModel,modelB:writeModel,options};
  let beforeFinalize:(s:ConnectionSnapshot)=>void=()=>{};
  const store:ConnectedRevisionStore={async existing(){
    const found=rows.filter(r=>r.status==="awaiting_read");return found.length?found.map(r=>({id:r.id,manuscript:r.data as RevisedManuscript})):undefined;
  },async stage(candidates){
    await repo.locked("owner","project","source-run",async s=>{
      for(const id of ["critic_editor_a","critic_editor_b"] as const)assertCurrentReadEditor(s,revisionReaderOperation(input.assignments[id]),id,"target-run");
      target.chapters=draft.map(c=>({...c,id:`target-${c.chapterIndex}`,runId:"target-run"}));
      rows.push(...candidates.map(c=>({id:c.id,projectId:"project",baseVersion:2,kind:c.manuscript.kind,status:"awaiting_read",data:c.manuscript})));
    });
  },async finalize(candidates){
    await repo.locked("owner","project","target-run",async s=>{
      beforeFinalize(s);
      candidates.forEach(c=>assertCurrentReadConsistency(s,c.id));
      candidates.forEach(c=>{rows.find(r=>r.id===c.id)!.status="pending";});target.run.status="completed";
    });
  }};
  return {rows,events,editorData,source,target,targetLink,repo,input,store,calls,setIncomplete(){confidence=0.1;},
    chargeReadTokens(tokens:number){readTokens=tokens;},failSecondEditor(){failEditorB=true;},
    setUnavailable(code="MODEL_UNAVAILABLE"){consistencyError=code;},beforeFinalize(fn:typeof beforeFinalize){beforeFinalize=fn;}};
}

describe("actual opt-in revision consumer and exact downstream gate",()=>{
  it.each(["missing","foreign","bible","canceled","completed","source-link","instructions"])("rejects direct request ledger target %s before reservation or dispatch",async invalid=>{
    const h=harness(),a={...h.input.assignments.critic_editor_a};
    if(invalid==="missing")a.targetRunId="missing-target";
    if(invalid==="foreign")h.target.run.projectId="foreign";
    if(invalid==="bible")h.target.run.bibleId="other-bible";
    if(invalid==="canceled")h.target.run.canceledAt=new Date();
    if(invalid==="completed")h.target.run.status="completed";
    if(invalid==="source-link")h.targetLink.sourceRunId="unrelated-source";
    if(invalid==="instructions")h.targetLink.editorialInstructions="Different authenticated request";
    await expect(createReadConnections(h.input.options).recordRequest("owner","project",a)).rejects.toBeInstanceOf(ReadConnectionError);
    expect(h.rows).toHaveLength(0);expect(h.events).toHaveLength(0);
  });
  it("supports an authorized standalone completed-source review using its real source as ledger target",async()=>{
    const h=harness(),service=createReadConnections(h.input.options),a={...h.input.assignments.critic_editor_a,targetRunId:"source-run"};
    await service.recordRequest("owner","project",a);
    const op=await service.prepareReader("owner","project","source-run",a.requestId,"standalone-reader");
    expect(op.status).toBe("ready_for_review");expect(op.budgetReservation?.targetRunId).toBe("source-run");
  });
  it("rejects failed standalone source targets without dispatch",async()=>{
    const h=harness();h.source.run.status="failed";
    await expect(createReadConnections(h.input.options).recordRequest("owner","project",{...h.input.assignments.critic_editor_a,targetRunId:"source-run"}))
      .rejects.toMatchObject({code:"TARGET_REVISION_CHANGED"});
    expect(h.events).toEqual([]);
  });
  it("does not partition the same source budget through concurrent invented target IDs",async()=>{
    const h=harness(),service=createReadConnections(h.input.options),a=h.input.assignments.critic_editor_a;
    const attempts=await Promise.allSettled([service.recordRequest("owner","project",a),
      service.recordRequest("owner","project",{...a,requestId:"invented-intent",targetRunId:"invented-target"})]);
    expect(attempts.map(a=>a.status)).toEqual(["fulfilled","rejected"]);
    await service.prepareReader("owner","project",a.runId,a.requestId,"valid-reader");
    expect(h.calls).toHaveLength(1);expect(h.rows.filter(r=>r.kind==="read_operation")).toHaveLength(1);
  });
  it("passes actual Reader evidence through both Editor runtimes, binds distinct source/target runs and advances only after both exact reports",async()=>{
    const h=harness();await executeConnectedRevisionWorkflow(h.input,h.store);
    expect(h.events).toEqual(["reader","critic_editor_a","critic_editor_b","consistency","consistency"]);
    for(const data of h.editorData){expect(data).toMatchObject({readerHandoff:{version:{bibleVersion:2,draftVersion:5},
      sourceReferences:[{sourceId:"source-1"},{sourceId:"source-2"},{sourceId:"source-3"}],userInstructions:{recordedRequest:""}}});}
    const reader=h.rows.find(r=>r.kind==="read_operation"&&(r.data as {agent:string}).agent==="reader")!.data as {editorExecutions:{status:string}[]};
    expect(reader.editorExecutions.map(e=>e.status)).toEqual(["accepted_for_execution","output_produced","accepted_for_execution","output_produced"]);
    expect(h.target.run.status).toBe("completed");expect(h.rows.filter(r=>r.kind.startsWith("manuscript_")).every(r=>r.status==="pending")).toBe(true);
  });
  it("routes an actual Editor receiving rejection through the single durable Reader repair",async()=>{
    const h=harness();h.setIncomplete();await executeConnectedRevisionWorkflow(h.input,h.store);
    expect(h.events).toEqual(["reader","reader","critic_editor_a","critic_editor_b","consistency","consistency"]);
    const op=h.rows.find(r=>r.kind==="read_operation"&&(r.data as {agent:string}).agent==="reader")!.data;
    expect(op).toMatchObject({repairUsed:true,generation:2,receipts:[{editorId:"critic_editor_a",accepted:false}]});
  });
  it("retains independent round-two A/B source proposals instead of sharing one draft",async()=>{
    const h=harness(2);await executeConnectedRevisionWorkflow(h.input,h.store);
    const [a,b]=h.editorData as {baseChapters:Chapter[];readerHandoff:{sourceReferences:{sourceId:string}[]}}[];
    expect(a.baseChapters[0].text).toContain("Previous manuscript_a");expect(b.baseChapters[0].text).toContain("Previous manuscript_b");
    expect(a.readerHandoff.sourceReferences[0].sourceId).toContain("proposal:manuscript_a");
    expect(b.readerHandoff.sourceReferences[0].sourceId).toContain("proposal:manuscript_b");
  });
  it.each(["wrong-project","wrong-bible","canceled"])("fails before model dispatch for %s target",async change=>{
    const h=harness();if(change==="wrong-project")h.target.run.projectId="foreign";
    if(change==="wrong-bible")h.target.run.bibleId="other";if(change==="canceled")h.target.run.canceledAt=new Date();
    await expect(executeConnectedRevisionWorkflow(h.input,h.store)).rejects.toMatchObject({code:"TARGET_REVISION_CHANGED"});
    expect(h.events).toEqual([]);
  });
  it.each(["metadata","bible","mismatched-report","missing-report"])("atomically blocks %s at advancement while preserving both candidates",async change=>{
    const h=harness();h.beforeFinalize(s=>{
      const candidate=s.rows.find(r=>r.kind==="manuscript_a")!;
      const operation=s.rows.find(r=>r.kind==="read_operation"&&(r.data as {agent:string;proposalBinding?:{proposalId:string}}).proposalBinding?.proposalId===candidate.id)!;
      if(change==="metadata")(candidate.data as RevisedManuscript).rationale+=" changed";
      if(change==="bible")(s.bible.data as {facts:{text:string}[]}).facts[0].text="Changed canonical fact.";
      if(change==="mismatched-report")((operation.data as {consistencyResult:{output:{proposalId:string}}}).consistencyResult.output.proposalId)="other";
      if(change==="missing-report")s.rows.splice(s.rows.indexOf(operation),1);
    });
    await expect(executeConnectedRevisionWorkflow(h.input,h.store)).rejects.toBeInstanceOf(ReadConnectionError);
    expect(h.target.run.status).toBe("running");expect(h.rows.filter(r=>r.status==="awaiting_read")).toHaveLength(2);
  });
  it.each(["MODEL_UNAVAILABLE","TIMEOUT"])("retains uncertain %s reservation and blocks other operations/replay on the target run",async code=>{
    const h=harness();h.setUnavailable(code);
    await expect(executeConnectedRevisionWorkflow(h.input,h.store)).rejects.toMatchObject({code:"TARGET_READ_BUDGET_EXHAUSTED"});
    const before=h.events.length;
    await expect(executeConnectedRevisionWorkflow(h.input,h.store)).rejects.toMatchObject({code:"TARGET_READ_BUDGET_EXHAUSTED"});
    expect(h.events).toHaveLength(before);expect(h.rows.filter(r=>r.status==="awaiting_read")).toHaveLength(2);
    const uncertain=h.rows.find(r=>r.kind==="read_operation"&&(r.data as {agent:string}).agent==="consistency")!.data;
    expect(uncertain).toMatchObject({budgetReservation:{settled:false,targetRunId:"target-run"}});
  });
  it("reserves actual Editor dispatch once across concurrent/restarted consumers",async()=>{
    const h=harness(),service=createReadConnections(h.input.options),a=h.input.assignments.critic_editor_a;
    await service.recordRequest("owner","project",a);await service.prepareReader("owner","project",a.runId,a.requestId,revisionReaderOperation(a));
    const make=()=>createReadRevisionConnection({ownerId:"owner",projectId:"project",targetRunId:"target-run",assignments:h.input.assignments,options:h.input.options});
    const results=await Promise.allSettled([make().edit("critic_editor_a",h.input.readingA,h.input.modelA),make().edit("critic_editor_a",h.input.readingA,h.input.modelA)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect((await make().edit("critic_editor_a",h.input.readingA,h.input.modelA)).result.modelUsed).toBe("fixture-editor");
    expect(h.events.filter(e=>e==="critic_editor_a")).toHaveLength(1);
  });
  it("durably preserves the first Editor output when the second Editor fails",async()=>{
    const h=harness();h.failSecondEditor();
    await expect(executeConnectedRevisionWorkflow(h.input,h.store)).rejects.toThrow("MODEL_UNAVAILABLE");
    const op=h.rows.find(r=>r.kind==="read_operation"&&(r.data as {agent:string}).agent==="reader")!.data as {
      editorOutputs:{editorId:string;modelUsed:string;proposal:RevisedManuscript}[];editorExecutions:{status:string;producerOrigin:string}[]};
    expect(op.editorOutputs).toHaveLength(1);expect(op.editorOutputs[0]).toMatchObject({editorId:"critic_editor_a",modelUsed:"fixture-editor"});
    expect(op.editorExecutions.find(e=>e.status==="output_produced")?.producerOrigin).toBe("synthetic");
    const connection=createReadRevisionConnection({ownerId:"owner",projectId:"project",targetRunId:"target-run",assignments:h.input.assignments,options:h.input.options});
    const resumed=await connection.edit("critic_editor_a",h.input.readingA,h.input.modelA);
    expect(resumed.result.proposal).toEqual(op.editorOutputs[0].proposal);
    expect(h.events.filter(e=>e==="critic_editor_a")).toHaveLength(1);
  });
  it("shares a durable READ token allowance across Reader and both Consistency operations",async()=>{
    const h=harness();h.input.options.runtime.budget.maxTokens=10_000;h.chargeReadTokens(9_000);
    await expect(executeConnectedRevisionWorkflow(h.input,h.store)).rejects.toMatchObject({code:"CURRENT_READ_CONSISTENCY_REQUIRED"});
    expect(h.events).toEqual(["reader","critic_editor_a","critic_editor_b"]);
    const before=h.events.length;
    await expect(executeConnectedRevisionWorkflow(h.input,h.store)).rejects.toMatchObject({code:"CURRENT_READ_CONSISTENCY_REQUIRED"});
    expect(h.events).toHaveLength(before);expect(h.rows.filter(r=>r.status==="awaiting_read")).toHaveLength(2);
  });
  it.each(["valid","missing-run","unavailable","wrong-proposal"])("checks %s exact READ evidence inside the actual human approval transaction",async mode=>{
    const h=harness();await executeConnectedRevisionWorkflow(h.input,h.store);
    const candidate=h.rows.find(r=>r.kind==="manuscript_a")!;
    const report=h.rows.find(r=>r.kind==="read_operation"&&(r.data as {proposalBinding?:{proposalId:string}}).proposalBinding?.proposalId===candidate.id)!.data as {
      status:string;consistencyResult:{output:{proposalId:string}}};
    if(mode==="unavailable")report.status="unavailable";
    if(mode==="wrong-proposal")report.consistencyResult.output.proposalId="other";
    const mutations:string[]=[];
    vi.spyOn(db,"select").mockImplementation(()=>({from:()=>({where:async()=>[h.target.project]})}) as never);
    vi.spyOn(db,"transaction").mockImplementation(async callback=>{
      let proposalSelects=0;
      const tx={select:()=>({from:(table:unknown)=>({where:()=>{
        const data=table===projects?[h.target.project]:table===proposals?(proposalSelects++===0?[candidate]:h.rows):table===chapters?h.target.chapters:
          table===bibles?[h.target.bible]:table===runs?[h.target.run]:[];
        const query={then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(data).then(resolve),orderBy:()=>query,limit:()=>query,
          for:async()=>table===runs&&mode==="missing-run"?[]:data};
        return query;
      }})}),update:()=>({set:(values:{status:string})=>({where:()=>{
        mutations.push(values.status);const result=values.status==="accepted"?[{...candidate,status:"accepted"}]:[];
        return {then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(result).then(resolve),returning:async()=>result};
      }})})};
      return callback(tx as never);
    });
    vi.stubEnv("READ_CONNECTIONS_ENABLED","true");
    try{
      if(mode==="valid"){expect((await approveManuscriptProposal("owner","project",candidate.id)).status).toBe("accepted");expect(mutations).toEqual(["rejected","accepted"]);}
      else{await expect(approveManuscriptProposal("owner","project",candidate.id)).rejects.toMatchObject({status:409});expect(mutations).toEqual([]);}
    }finally{vi.unstubAllEnvs();vi.restoreAllMocks();}
  });
});
