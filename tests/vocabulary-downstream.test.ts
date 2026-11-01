import { afterEach, describe, expect, it, vi } from "vitest";
import { intakeHash } from "../src/agents/intake";
import { intakeAnalysisSchema, scopeFromIntake, type IntakeRecord } from "../src/contracts/intake";
import { LC_FRESHNESS_MS, type LcConcept } from "../src/contracts/vocabulary";
import { getProjectBenchmarks } from "../src/server/research/benchmark-http";
import { prepareConfirmedResearchInput } from "../src/server/research/confirmed-intake";
import { sha256 } from "../src/agents/read/runtime";

const mocks=vi.hoisted(()=>({ project:vi.fn(), read:vi.fn(async()=>[]) }));
vi.mock("../src/server/read-state",async importOriginal=>({
  ...await importOriginal<typeof import("../src/server/read-state")>(),
  inReadSnapshot: async (read: (repo: {project:typeof mocks.project})=>unknown)=>read({project:mocks.project}),
}));
vi.mock("../src/server/research/book-metadata",async importOriginal=>({
  ...await importOriginal<typeof import("../src/server/research/book-metadata")>(),readBookBenchmarks:mocks.read,
}));
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});

function fixture(mapped=true) {
  const rawText="A horror story.";
  const analysis=intakeAnalysisSchema.parse({id:"eb45e244-ec9c-4935-8040-7148bb6074d2",sourceHash:intakeHash(rawText),
    model:"fixture",promptVersion:"intake-v3",summary:"A story.",observations:[{field:"genre",quote:"horror",ambiguous:false}],
    suggestions:[],missing:[],usage:{inputTokens:1,outputTokens:1}});
  const subject: LcConcept={kind:"subject",uri:"http://id.loc.gov/authorities/subjects/sh85047009",label:"Families",
    sourceUrl:"https://id.loc.gov/authorities/subjects/suggest2?q=families",retrievedAt:new Date().toISOString()};
  const selection={genreForm:null,subject:mapped?subject:null};
  const intake: IntakeRecord={version:2,revision:3,rawText,status:"confirmed",analysis,decisions:[],selection,
    lookups:mapped?{subject:{revision:2,sourceHash:analysis.sourceHash,analysisId:analysis.id,kind:"subject",query:"families",
      status:"available",reasonCode:"OK",retrievedAt:subject.retrievedAt,candidates:[subject]}}:undefined,
    confirmed:{at:new Date().toISOString(),analysisId:analysis.id,scope:scopeFromIntake(analysis,[],selection,true)}};
  const project={id:"a9f57b79-c0c8-409e-9f50-d5caf0b12345",ownerId:"owner",version:0,
    brief:{premise:rawText,genre:"horror",audience:"",tone:"",desiredEnding:"",intake}};
  const request={authority:{runId:"run",taskId:"task",operationId:"operation",ownerId:"owner",projectId:project.id,
    stateVersion:0,requestVersion:3,prdVersion:"v4-draft"},
    versions:{contract:"read-v1" as const,prompt:"read-v1" as const,harness:"synthetic",model:"fixture"},expectedRevision:3,
    expectedAnalysisId:analysis.id,expectedAnalysisHash:sha256(JSON.stringify(intakeAnalysisSchema.parse(analysis))),expectedSourceHash:analysis.sourceHash,
    criteriaVersion:1,eligibleSources:[]};
  mocks.project.mockResolvedValue(project);
  return {project,request,input:{projectId:project.id,genre:"horror",providers:["nyt","gutendex"] as ["nyt","gutendex"],limit:5,nytList:"hardcover-fiction" as const}};
}

describe("server-confirmed vocabulary downstream freshness",()=>{
  it("rejects expired selected evidence at both entry points before provider dispatch",async()=>{
    vi.useFakeTimers();
    const f=fixture();
    vi.setSystemTime(Date.now()+LC_FRESHNESS_MS);
    await expect(getProjectBenchmarks("owner",f.input)).rejects.toMatchObject({status:400});
    await expect(prepareConfirmedResearchInput(f.request,{get:async()=>f.project})).rejects.toMatchObject({status:409});
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([true,false])("keeps v3 subject provenance distinct without raw genre fallback (mapped=%s)",async mapped=>{
    const f=fixture(mapped);
    await getProjectBenchmarks("owner",f.input);
    const research=await prepareConfirmedResearchInput(f.request,{get:async()=>f.project});
    const expected={genre:"horror",intakeVersion:"intake-v3",topicPhrase:mapped?"Families":null,
      subjectUri:mapped?"http://id.loc.gov/authorities/subjects/sh85047009":null};
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining(expected));
    expect(research.benchmarkRequest).toMatchObject(expected);
    expect(research.confirmedIntake?.rawText).toBe(f.project.brief.intake.rawText);
  });
});
