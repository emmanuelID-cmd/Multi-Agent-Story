import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { scopeFromIntake, type IntakeAnalysis, type IntakeRecord } from "../src/contracts/intake";
import { intakeHash } from "../src/agents/intake";
import { sha256 } from "../src/agents/read/runtime";
import { limits } from "../src/contracts";
import { fixtureProviders } from "../src/agents/read-harness-fixtures";
import type { ReadModel } from "../src/agents/read/model";
import type { ApprovedResearchSource } from "../src/server/research/research-acquisition";
import { acceptResearchCandidate, createResearchCandidate, getResearchCandidate, listResearchCandidates } from "../src/server/research/dossier-service";
import { acquisitionProvenanceSchema, type ResearchRepository, type ResearchRow, type ResearchSnapshot } from "../src/server/research/dossier-storage";

const rawText="A horror story in München during the 1930s.";
const analysis:IntakeAnalysis={id:randomUUID(),sourceHash:intakeHash(rawText),model:"synthetic",promptVersion:"intake-v1",summary:"A story.",usage:{inputTokens:1,outputTokens:1},missing:[],suggestions:[],observations:[
  {field:"genre",quote:"horror",ambiguous:false},{field:"setting",quote:"München",ambiguous:false},{field:"timePeriod",quote:"1930s",ambiguous:false},
]};
const intake:IntakeRecord={version:1,revision:1,rawText,status:"confirmed",analysis,decisions:[],confirmed:{at:new Date().toISOString(),analysisId:analysis.id,scope:scopeFromIntake(analysis,[])}};
const craftText="The bell rang after the door was locked. The character searched for its source.";
const contextText="München was the selected place. The 1930s was the selected period.";
const yesterday=new Date(Date.now()-86_400_000).toISOString();
const tomorrow=new Date(Date.now()+86_400_000).toISOString();
function approval(id:string,kind:ApprovedResearchSource["kind"],text:string,matches:[string,string][]):ApprovedResearchSource{
  return {sourceId:id,kind,work:"Synthetic licensed reference",author:"Test author",publicationDate:null,
    sourceUrl:`https://example.invalid/approved/${id}`,locator:`approved:${id}:1`,expectedSha256:sha256(text),
    rights:{basis:"Synthetic user license for this test.",type:"user_license",jurisdiction:"US",purpose:"research_text_analysis",verifiedAt:yesterday,validThrough:tomorrow,evidenceRef:`license:${id}`},
    identity:{type:"licensed_user",ownerId:"owner",projectId:"project"},matches:matches.map(([dimensionId,confirmedValue])=>({dimensionId,confirmedValue,evidenceRef:`review:${dimensionId}`}))};
}
const craft=approval("craft","licensed_text",craftText,[["genre","horror"]]);
const context=approval("context","historical_context",contextText,[["setting","München"],["timePeriod","1930s"]]);
const model:ReadModel={modelId:"synthetic",complete:async()=>({value:{items:[
  {itemId:"g",sourceId:"craft",kind:"located_text_observation",dimensionId:"genre",claim:"The bell creates a question.",locator:"approved:craft:1",quote:"The bell rang after the door was locked.",confidence:1},
  {itemId:"s",sourceId:"context",kind:"historical_fact",dimensionId:"setting",claim:"The context names München.",locator:"approved:context:1",quote:"München was the selected place.",confidence:1},
  {itemId:"p",sourceId:"context",kind:"historical_fact",dimensionId:"timePeriod",claim:"The context names the 1930s.",locator:"approved:context:1",quote:"The 1930s was the selected period.",confidence:1},
],synthesis:[],gaps:[],limitations:[]},usage:{inputTokens:100,outputTokens:50}})};
const budget={maxTokens:60_000,maxCostUsd:0.25,inputUsdPerMillion:1,outputUsdPerMillion:5};
const request={authority:{runId:"run",taskId:"task",operationId:"create_1",ownerId:"owner",projectId:"project",stateVersion:0,requestVersion:1,prdVersion:"v4"},
  versions:{contract:"read-v1" as const,prompt:"read-v1" as const,harness:"dossier-test",model:"synthetic"},expectedRevision:1,
  expectedAnalysisId:analysis.id,expectedAnalysisHash:sha256(JSON.stringify(analysis)),expectedSourceHash:intakeHash(rawText),criteriaVersion:1,eligibleSources:[]};

function memoryRepository(){
  let snapshot:ResearchSnapshot={project:{id:"project",ownerId:"owner",version:0,brief:{intake}},rows:[]};
  let tail=Promise.resolve();
  const repository:ResearchRepository={
    async load(owner,project){if(owner!==snapshot.project.ownerId||project!==snapshot.project.id)throw Error("Project unavailable.");return structuredClone(snapshot);},
    async locked(owner,project,work){if(owner!==snapshot.project.ownerId||project!==snapshot.project.id)throw Error("Project unavailable.");
      const preceding=tail;let unlock!:()=>void;tail=new Promise<void>(resolve=>{unlock=resolve;});
      await preceding;
      try{
        const copy=structuredClone(snapshot);
        const result=await work(copy,{async insert(row){const saved:ResearchRow={...row};copy.rows.push(saved);return saved;},
          async accept(id){const row=copy.rows.find(item=>item.id===id);if(!row)throw Error("Missing candidate.");row.status="accepted";}});
        snapshot=copy;return result;
      }finally{unlock();}},
  };
  return {repository,get state(){return snapshot;},set state(next:ResearchSnapshot){snapshot=next;}};
}
function fixture(){
  const store=memoryRepository();
  const readBenchmarks=vi.fn(async()=>fixtureProviders());
  const readApprovedText=vi.fn(async(source:ApprovedResearchSource)=>({text:source.sourceId==="craft"?craftText:contextText,fetchedAt:new Date().toISOString()}));
  const acquisition={approvedSources:[craft,context],readBenchmarks,readApprovedText};
  return {store,acquisition,readBenchmarks,readApprovedText};
}
async function create(f:ReturnType<typeof fixture>,operationId="create_1"){
  return createResearchCandidate({...request,authority:{...request.authority,operationId}}, {model,budget},
    {repository:f.store.repository,acquisition:f.acquisition});
}
function acceptRequest(candidate:Awaited<ReturnType<typeof create>>,operationId=randomUUID()){
  return {candidateId:candidate.id,candidateVersion:candidate.version,candidateHash:candidate.hash,operationId};
}
function deferred(){
  let release!:()=>void;
  const promise=new Promise<void>(resolve=>{release=resolve;});
  return {promise,release};
}

describe("Research dossier storage and human acceptance",()=>{
  it("stores an immutable bounded candidate, re-reads text and accepts exact current evidence once",async()=>{
    const f=fixture();const candidate=await create(f);
    expect(candidate.gateRecommendation).toBe("ACCEPT_CANDIDATE");
    expect(f.store.state.rows).toHaveLength(1);
    expect(JSON.stringify(f.store.state.rows[0].data)).not.toContain(craftText);
    expect(JSON.stringify(f.store.state.rows[0].data)).not.toContain(contextText);
    const listed=await listResearchCandidates("owner","project",f.store.repository);
    expect(listed).toMatchObject([{id:candidate.id,version:1,status:"pending"}]);
    expect(listed[0].coverage.map(c=>c.status)).toEqual(["supported","supported","supported"]);
    expect(JSON.stringify(listed[0])).not.toContain("sourceReviews");
    expect((await getResearchCandidate("owner","project",candidate.id,f.store.repository)).dossier.coverage).toEqual(listed[0].coverage);
    const accept=acceptRequest(candidate);
    const result=await acceptResearchCandidate("owner","project",accept,{repository:f.store.repository,acquisition:f.acquisition});
    expect(result).toMatchObject({candidateId:candidate.id,candidateHash:candidate.hash,ownerId:"owner"});
    expect(f.store.state.rows.map(r=>r.kind)).toEqual(["research_dossier","research_acceptance"]);
    expect(f.store.state.rows[0].status).toBe("accepted");
    expect(f.readBenchmarks).toHaveBeenCalledTimes(1);
    expect(f.readApprovedText).toHaveBeenCalledTimes(4);
    f.acquisition.readApprovedText=vi.fn(async()=>{throw Error("Reader offline after commit.");});
    expect(await acceptResearchCandidate("owner","project",accept,{repository:f.store.repository,acquisition:f.acquisition})).toEqual(result);
    expect(f.store.state.rows).toHaveLength(2);
  });
  it("persists bounded query and excluded-source provenance with the exact dossier version",async()=>{
    const f=fixture();
    const excluded={...approval("excluded","licensed_text",craftText,[["genre","horror"]]),
      rights:{...craft.rights,validThrough:yesterday}};
    f.acquisition.approvedSources=[craft,context,excluded];
    const candidate=await create(f);
    const detail=await getResearchCandidate("owner","project",candidate.id,f.store.repository);
    expect(detail.provenance.queries.map(query=>query.provider)).toEqual(["nyt","gutendex"]);
    expect(detail.provenance.queries.every(query=>query.genre==="horror"&&query.endpoint.length>0)).toBe(true);
    expect(detail.provenance.sources.find(source=>source.sourceId==="excluded")).toMatchObject({
      status:"blocked",reasonCode:"RIGHTS_REVIEW_STALE"});
    expect(detail.sourceReviews.map(source=>source.sourceId)).toEqual(["craft","context"]);
    expect(JSON.stringify(detail.provenance)).not.toContain(craftText);
    expect(acquisitionProvenanceSchema.safeParse({...detail.provenance,fullText:craftText}).success).toBe(false);
    expect(acquisitionProvenanceSchema.safeParse({...detail.provenance,
      sources:[{...detail.provenance.sources[0],work:"x".repeat(301)}]}).success).toBe(false);
  });
  it("accepts independent eligible coverage with an honest empty provider outcome",async()=>{
    const f=fixture();
    f.readBenchmarks.mockImplementation(async()=>fixtureProviders().map(outcome=>outcome.provider==="gutendex"?
      {...outcome,status:"empty" as const,records:[],reasonCode:"NO_RESULTS"}:outcome));
    const candidate=await create(f);
    expect(candidate.gateRecommendation).toBe("ACCEPT_CANDIDATE");
    const accepted=await acceptResearchCandidate("owner","project",acceptRequest(candidate),
      {repository:f.store.repository,acquisition:f.acquisition});
    expect(accepted.candidateId).toBe(candidate.id);
    expect((await getResearchCandidate("owner","project",candidate.id,f.store.repository)).dossier.providerOutcomes.gutendex.status).toBe("empty");
  });
  it("keeps an unrequested provider outcome blocked despite eligible text",async()=>{
    const f=fixture();
    f.readBenchmarks.mockImplementation(async()=>fixtureProviders().map(outcome=>outcome.provider==="gutendex"?
      {...outcome,status:"not_requested" as const,records:[],fetchedAt:null,reasonCode:"LIVE_READS_DISABLED"}:outcome));
    const candidate=await create(f);
    expect(candidate.gateRecommendation).toBe("BLOCKED_REQUIRED_EVIDENCE");
    await expect(acceptResearchCandidate("owner","project",acceptRequest(candidate),
      {repository:f.store.repository,acquisition:f.acquisition})).rejects.toThrow("does not cover");
    expect(f.store.state.rows).toHaveLength(1);
  });
  it("rejects wrong owner, changed intake, new candidate and a reused acceptance operation",async()=>{
    const f=fixture();const first=await create(f);const a=acceptRequest(first);
    await expect(acceptResearchCandidate("other","project",a,{repository:f.store.repository,acquisition:f.acquisition})).rejects.toThrow("Project unavailable");
    const second=await create(f,"create_2");
    await expect(acceptResearchCandidate("owner","project",a,{repository:f.store.repository,acquisition:f.acquisition})).rejects.toThrow("newer research dossier");
    const b=acceptRequest(second,a.operationId);
    await acceptResearchCandidate("owner","project",b,{repository:f.store.repository,acquisition:f.acquisition});
    await expect(acceptResearchCandidate("owner","project",{...b,candidateHash:"0".repeat(64)},
      {repository:f.store.repository,acquisition:f.acquisition})).rejects.toThrow();
    const changed=structuredClone(f.store.state);
    (changed.project.brief.intake as IntakeRecord).revision=2;f.store.state=changed;
    await expect(acceptResearchCandidate("owner","project",b,{repository:f.store.repository,acquisition:f.acquisition})).rejects.toThrow("scope changed");
  });
  it("blocks unreadable, insufficient and source-changed candidates without an acceptance write",async()=>{
    const f=fixture();const candidate=await create(f);const a=acceptRequest(candidate);
    const broken=structuredClone(f.store.state);(broken.rows[0].data as Record<string,unknown>).payloadHash="0".repeat(64);f.store.state=broken;
    await expect(listResearchCandidates("owner","project",f.store.repository)).rejects.toThrow("Research dossier changed");
    await expect(acceptResearchCandidate("owner","project",a,{repository:f.store.repository,acquisition:f.acquisition})).rejects.toThrow();
    const g=fixture();const fresh=await create(g);const b=acceptRequest(fresh);
    const changedReviews:ApprovedResearchSource[]=[
      {...context,publicationDate:"1930"},
      {...context,author:"Changed author"},
      {...context,kind:"licensed_text"},
      {...context,rights:{...context.rights,basis:"Different permission basis"}},
      {...context,identity:{type:"licensed_user",ownerId:"other",projectId:"project"}},
    ];
    for(const changed of changedReviews){
      g.acquisition.approvedSources=[craft,changed];
      await expect(acceptResearchCandidate("owner","project",b,{repository:g.store.repository,acquisition:g.acquisition})).rejects.toThrow();
    }
    expect(g.store.state.rows).toHaveLength(1);
    const h=fixture();const partial=await create(h);const c=acceptRequest(partial);
    h.acquisition.approvedSources=[craft];
    await expect(acceptResearchCandidate("owner","project",c,{repository:h.store.repository,acquisition:h.acquisition})).rejects.toThrow("sources are unavailable");
    expect(h.store.state.rows).toHaveLength(1);
  });
  it("rejects unknown rights and reader outage, and never treats a changed text digest as sufficient",async()=>{
    const f=fixture();const candidate=await create(f);const a=acceptRequest(candidate);
    await expect(acceptResearchCandidate("owner","project",a,{repository:f.store.repository})).rejects.toThrow("not configured");
    f.acquisition.approvedSources=[craft,{...context,rights:{...context.rights,validThrough:yesterday}}];
    await expect(acceptResearchCandidate("owner","project",a,{repository:f.store.repository,acquisition:f.acquisition})).rejects.toThrow();
    f.acquisition.approvedSources=[craft,context];
    f.acquisition.readApprovedText=vi.fn(async source=>({text:source.sourceId==="craft"?craftText:"Changed text",fetchedAt:new Date().toISOString()}));
    await expect(acceptResearchCandidate("owner","project",a,{repository:f.store.repository,acquisition:f.acquisition})).rejects.toThrow();
    expect(f.store.state.rows).toHaveLength(1);
  });
  it("times out a stalled initial repository read before source access",async()=>{
    const f=fixture();const candidate=await create(f);
    const stalled:ResearchRepository={...f.store.repository,load:async()=>new Promise<ResearchSnapshot>(()=>{})};
    vi.useFakeTimers();
    try{
      const pending=acceptResearchCandidate("owner","project",acceptRequest(candidate),{repository:stalled,acquisition:f.acquisition});
      const outcome=expect(pending).rejects.toThrow("stopped");
      await vi.advanceTimersByTimeAsync(limits.timeoutMs);
      await outcome;
      expect(f.readApprovedText).toHaveBeenCalledTimes(2);
      expect(f.store.state.rows).toHaveLength(1);
    }finally{vi.useRealTimers();}
  });
  it("cancels while waiting for the project lock and prevents a late acceptance",async()=>{
    const f=fixture();const candidate=await create(f);const gate=deferred();const controller=new AbortController();
    const base=f.store.repository;
    const waiting:ResearchRepository={...base,locked:async(owner,project,work)=>{await gate.promise;return base.locked(owner,project,work);}};
    const pending=acceptResearchCandidate("owner","project",acceptRequest(candidate),
      {repository:waiting,acquisition:f.acquisition,signal:controller.signal});
    await vi.waitFor(()=>expect(f.readApprovedText).toHaveBeenCalledTimes(4));
    controller.abort();
    await expect(pending).rejects.toThrow("stopped");
    gate.release();
    await vi.waitFor(()=>expect(f.store.state.rows).toHaveLength(1));
  });
  it("rejects rights that expire while waiting for the acceptance lock",async()=>{
    const f=fixture();const candidate=await create(f);const gate=deferred();const waiting=deferred();
    const base=f.store.repository;
    const delayed:ResearchRepository={...base,locked:async(owner,project,work)=>{
      waiting.release();await gate.promise;return base.locked(owner,project,work);
    }};
    vi.useFakeTimers({toFake:["Date"]});
    try{
      vi.setSystemTime(new Date(Date.parse(tomorrow)-1_000));
      const pending=acceptResearchCandidate("owner","project",acceptRequest(candidate),
        {repository:delayed,acquisition:f.acquisition});
      await waiting.promise;
      vi.setSystemTime(new Date(Date.parse(tomorrow)+1_000));
      gate.release();
      await expect(pending).rejects.toThrow("permission expired");
      expect(f.store.state.rows).toHaveLength(1);
      expect(f.store.state.rows[0].status).toBe("pending");
    }finally{vi.useRealTimers();}
  });
  it("rejects rights that expire while an approved source is being reread",async()=>{
    const f=fixture();const candidate=await create(f);const gate=deferred();const reading=deferred();
    f.acquisition.readApprovedText=vi.fn(async source=>{
      if(source.sourceId==="craft"){reading.release();await gate.promise;}
      return {text:source.sourceId==="craft"?craftText:contextText,fetchedAt:new Date().toISOString()};
    });
    vi.useFakeTimers({toFake:["Date"]});
    try{
      vi.setSystemTime(new Date(Date.parse(tomorrow)-1_000));
      const pending=acceptResearchCandidate("owner","project",acceptRequest(candidate),
        {repository:f.store.repository,acquisition:f.acquisition});
      await reading.promise;
      vi.setSystemTime(new Date(Date.parse(tomorrow)+1_000));
      gate.release();
      await expect(pending).rejects.toThrow();
      expect(f.store.state.rows).toHaveLength(1);
    }finally{vi.useRealTimers();}
  });
  it("rolls back when cancellation arrives while an acceptance insert is awaiting",async()=>{
    const f=fixture();const candidate=await create(f);const gate=deferred();const entered=deferred();
    const controller=new AbortController();const base=f.store.repository;
    const delayed:ResearchRepository={...base,locked:(owner,project,work)=>base.locked(owner,project,(snapshot,writer)=>
      work(snapshot,{...writer,insert:async row=>{const saved=await writer.insert(row);entered.release();await gate.promise;return saved;}}))};
    const pending=acceptResearchCandidate("owner","project",acceptRequest(candidate),
      {repository:delayed,acquisition:f.acquisition,signal:controller.signal});
    await entered.promise;
    controller.abort();
    await expect(pending).rejects.toThrow("stopped");
    gate.release();
    await vi.waitFor(()=>expect(f.store.state.rows).toHaveLength(1));
    expect(f.store.state.rows[0].status).toBe("pending");
  });
  it("returns the committed record when cancellation arrives after callback work but before commit",async()=>{
    const f=fixture();const candidate=await create(f);const gate=deferred();const ready=deferred();
    const controller=new AbortController();const base=f.store.repository;
    const delayed:ResearchRepository={...base,locked:(owner,project,work)=>base.locked(owner,project,async(snapshot,writer)=>{
      const result=await work(snapshot,writer);ready.release();await gate.promise;return result;
    })};
    const acceptance=acceptRequest(candidate);
    const pending=acceptResearchCandidate("owner","project",acceptance,
      {repository:delayed,acquisition:f.acquisition,signal:controller.signal});
    await ready.promise;
    controller.abort();gate.release();
    const result=await pending;
    expect(result).toMatchObject({operationId:acceptance.operationId,candidateId:candidate.id});
    expect(f.store.state.rows).toHaveLength(2);
    expect(f.store.state.rows[0].status).toBe("accepted");
  });
  it("serializes duplicate acceptance requests and returns the same committed operation",async()=>{
    const f=fixture();const candidate=await create(f);const acceptance=acceptRequest(candidate);
    const [first,second]=await Promise.all([
      acceptResearchCandidate("owner","project",acceptance,{repository:f.store.repository,acquisition:f.acquisition}),
      acceptResearchCandidate("owner","project",acceptance,{repository:f.store.repository,acquisition:f.acquisition}),
    ]);
    expect(first).toEqual(second);
    expect(f.store.state.rows).toHaveLength(2);
  });
  it("rejects history capacity explicitly while retaining prior versions",async()=>{
    const f=fixture();const candidate=await create(f);
    const inflated=structuredClone(f.store.state);
    for(let index=1;index<=100;index++)inflated.rows.push({...structuredClone(inflated.rows[0]),id:randomUUID()});
    f.store.state=inflated;
    await expect(acceptResearchCandidate("owner","project",acceptRequest(candidate),
      {repository:f.store.repository,acquisition:f.acquisition})).rejects.toThrow("bounded endpoint");
    expect(f.store.state.rows).toHaveLength(101);
  });
  it("keeps selected earlier dossiers inspectable at the storage limit",async()=>{
    const f=fixture();const first=await create(f);const second=await create(f,"create_2");
    const filled=structuredClone(f.store.state);
    for(let index=2;index<100;index++)filled.rows.push({id:randomUUID(),projectId:"project",baseVersion:0,
      kind:"research_acceptance",status:"accepted",data:{}});
    f.store.state=filled;
    const summary=await listResearchCandidates("owner","project",f.store.repository);
    expect(summary.map(item=>item.id)).toEqual([second.id,first.id]);
    expect((await getResearchCandidate("owner","project",first.id,f.store.repository)).id).toBe(first.id);
    await expect(create(f,"create_3")).rejects.toThrow("bounded endpoint");
    expect(f.store.state.rows).toHaveLength(100);
  });
});
