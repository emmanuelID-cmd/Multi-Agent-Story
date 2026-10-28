import { afterEach, describe, expect, it, vi } from "vitest";
import { briefSchema } from "../src/contracts";
import { intakeAnalysisSchema, intakeRecordSchema, resolveIntake, scopeFromIntake } from "../src/contracts/intake";
import { intakeHash, analyzeIntake } from "../src/agents/intake";
import { lookupProjectIntake, updateProjectIntake, type IntakeRepository } from "../src/server/intake";
import type { LcLookup } from "../src/contracts/vocabulary";
import { LC_FRESHNESS_MS } from "../src/contracts/vocabulary";

afterEach(() => vi.useRealTimers());

const rawText = "A sailor follows a family signal.";
const analysis = intakeAnalysisSchema.parse({ id:"eb45e244-ec9c-4935-8040-7148bb6074d2",sourceHash:intakeHash(rawText),
  model:"fixture",promptVersion:"intake-v3",summary:"A sailor follows a signal.",observations:[],
  suggestions:[{field:"genre",question:"Which genre?",reason:"Not stated",options:[],dependsOn:null}],
  missing:["genre"],usage:{inputTokens:1,outputTokens:1} });
function setup() {
  let brief = briefSchema.parse({premise:rawText,genre:"",audience:"",tone:"",desiredEnding:"",
    intake:{version:2,revision:0,rawText,status:"analyzed",analysis,decisions:[]}});
  const repository: IntakeRepository = {mutate:async (_owner,_project,change) => { brief=change(brief,false); return {brief}; }};
  return {repository,get brief(){return brief;}};
}
function result(kind:"genreForm"|"subject", revision=0): LcLookup {
  const genre = kind === "genreForm";
  const retrievedAt = new Date().toISOString();
  return {kind,query:genre?"fiction":"families",status:"available",reasonCode:"OK",retrievedAt,
    candidates:[{kind,uri:genre?"http://id.loc.gov/authorities/genreForms/gf2014026339":"http://id.loc.gov/authorities/subjects/sh85047009",
      label:genre?"Fiction":"Families",sourceUrl:"https://id.loc.gov/authorities/subjects/suggest2?q=test",retrievedAt}]};
}
describe("versioned intake vocabulary", () => {
  it.each(["intake-v1","intake-v2"] as const)("keeps saved %s option decisions readable and confirmable",async promptVersion=>{
    const legacyAnalysis=intakeAnalysisSchema.parse({...analysis,promptVersion,suggestions:[{field:"genre",question:"Which genre?",reason:"Not stated",options:["Mystery"],dependsOn:null}]});
    const decisions=[{field:"genre" as const,action:"accept" as const,optionIndex:0}];
    const saved=intakeRecordSchema.parse({version:1,revision:0,rawText,status:"analyzed",analysis:legacyAnalysis,decisions});
    expect(resolveIntake(saved.analysis!,saved.decisions).genre).toBe("Mystery");
    expect(scopeFromIntake(saved.analysis!,saved.decisions).vocabulary).toBeUndefined();
    let brief=briefSchema.parse({premise:rawText,genre:"",audience:"",tone:"",desiredEnding:"",intake:saved});
    const repository: IntakeRepository={mutate:async(_owner,_project,change)=>{brief=change(brief,false);return {brief};}};
    const confirmed=await updateProjectIntake("owner","project",{action:"confirm",expectedRevision:0,analysisId:legacyAnalysis.id,decisions,confirmScope:true},{repository});
    expect(confirmed.intake.confirmed?.scope.genre).toBe("Mystery");
    const reopened=await updateProjectIntake("owner","project",{action:"reopenVocabulary",expectedRevision:1},{repository});
    expect(reopened.intake).toMatchObject({status:"analyzed",rawText,decisions});
    expect(reopened.intake.analysis?.promptVersion).toBe(promptVersion);
  });
  it("checks revision around lookup and rejects forged or stale selection", async () => {
    const f=setup();
    const lookup=vi.fn(async () => result("subject"));
    await expect(lookupProjectIntake("owner","project",1,"subject","families",{repository:f.repository,lookup})).rejects.toMatchObject({status:409});
    expect(lookup).not.toHaveBeenCalled();
    const found=await lookupProjectIntake("owner","project",0,"subject","families",{repository:f.repository,lookup});
    expect(found.intake.lookups?.subject?.candidates).toHaveLength(1);
    await expect(updateProjectIntake("owner","project",{action:"selectVocabulary",expectedRevision:1,kind:"subject",uri:"http://id.loc.gov/authorities/subjects/sh999"},{repository:f.repository})).rejects.toMatchObject({status:400});
    await expect(updateProjectIntake("owner","project",{action:"selectVocabulary",expectedRevision:0,kind:"subject",uri:result("subject").candidates[0].uri},{repository:f.repository})).rejects.toMatchObject({status:409});
    const selected=await updateProjectIntake("owner","project",{action:"selectVocabulary",expectedRevision:1,kind:"subject",uri:result("subject").candidates[0].uri},{repository:f.repository});
    expect(selected.intake.selection?.subject?.label).toBe("Families");
  });
  it("preserves original genre and uses subject only as a distinct candidate topic", async () => {
    const f=setup();
    await lookupProjectIntake("owner","project",0,"subject","families",{repository:f.repository,lookup:async()=>result("subject")});
    await updateProjectIntake("owner","project",{action:"selectVocabulary",expectedRevision:1,kind:"subject",uri:result("subject").candidates[0].uri},{repository:f.repository});
    const confirmed=await updateProjectIntake("owner","project",{action:"confirm",expectedRevision:2,analysisId:analysis.id,
      decisions:[{field:"genre",action:"custom",value:"Family mystery"}],confirmScope:true},{repository:f.repository});
    expect(confirmed.intake.confirmed?.scope.genre).toBe("Family mystery");
    expect(confirmed.intake.confirmed?.scope.vocabulary).toMatchObject({originalGenre:"Family mystery",gutendexPhrase:"Families",mappingStatus:"mapped"});
    expect(confirmed.intake.confirmed?.scope.vocabulary?.genreForm).toBeNull();
  });
  it("keeps manual confirmation available when lookup is empty or unavailable", async () => {
    const f=setup();
    await expect(lookupProjectIntake("owner","project",0,"subject","families",{repository:f.repository,lookup:async()=>({...result("subject"),status:"unavailable",candidates:[]})})).rejects.toMatchObject({status:503});
    const confirmed=await updateProjectIntake("owner","project",{action:"confirm",expectedRevision:0,analysisId:analysis.id,
      decisions:[{field:"genre",action:"custom",value:"Mystery"}],confirmScope:true},{repository:f.repository});
    expect(confirmed.intake.confirmed?.scope.vocabulary).toMatchObject({originalGenre:"Mystery",gutendexPhrase:null,mappingStatus:"unmapped"});
  });
  it("retains the only selected genre on reopen without analysis or losing decisions", async () => {
    const f=setup();
    await lookupProjectIntake("owner","project",0,"genreForm","fiction",{repository:f.repository,lookup:async()=>result("genreForm")});
    await updateProjectIntake("owner","project",{action:"selectVocabulary",expectedRevision:1,kind:"genreForm",uri:result("genreForm").candidates[0].uri},{repository:f.repository});
    const decisions=[{field:"genre" as const,action:"defer" as const}];
    const confirmed=await updateProjectIntake("owner","project",{action:"confirm",expectedRevision:2,analysisId:analysis.id,decisions,confirmScope:true},{repository:f.repository});
    expect(confirmed.intake.confirmed?.scope.genre).toBe("Fiction");
    const reopened=await updateProjectIntake("owner","project",{action:"reopenVocabulary",expectedRevision:3},{repository:f.repository});
    expect(reopened.intake).toMatchObject({status:"analyzed",rawText,decisions,analysis,selection:confirmed.intake.selection});
    expect(reopened.intake.lookups?.genreForm?.revision).toBe(4);
    const reconfirmed=await updateProjectIntake("owner","project",{action:"confirm",expectedRevision:4,analysisId:analysis.id,decisions,confirmScope:true},{repository:f.repository});
    expect(reconfirmed.intake.confirmed?.scope.genre).toBe("Fiction");
  });
  it("preserves the prior selected term and revision when refresh is unavailable", async () => {
    const f=setup();
    await lookupProjectIntake("owner","project",0,"subject","families",{repository:f.repository,lookup:async()=>result("subject")});
    await updateProjectIntake("owner","project",{action:"selectVocabulary",expectedRevision:1,kind:"subject",uri:result("subject").candidates[0].uri},{repository:f.repository});
    const saved=structuredClone(f.brief);
    await expect(lookupProjectIntake("owner","project",2,"subject","new words",{repository:f.repository,lookup:async()=>({...result("subject"),status:"unavailable",candidates:[]})})).rejects.toMatchObject({status:503});
    expect(f.brief).toEqual(saved);
  });
  it("rejects selection and confirmation at the shared 24-hour freshness boundary", async () => {
    vi.useFakeTimers();
    const f=setup();
    await lookupProjectIntake("owner","project",0,"subject","families",{repository:f.repository,lookup:async()=>result("subject")});
    const uri=result("subject").candidates[0].uri;
    await updateProjectIntake("owner","project",{action:"selectVocabulary",expectedRevision:1,kind:"subject",uri},{repository:f.repository});
    vi.setSystemTime(Date.now()+LC_FRESHNESS_MS);
    await expect(updateProjectIntake("owner","project",{action:"selectVocabulary",expectedRevision:2,kind:"subject",uri},{repository:f.repository})).rejects.toMatchObject({status:409,fields:{vocabulary:[expect.stringContaining("Search again")]}});
    await expect(updateProjectIntake("owner","project",{action:"confirm",expectedRevision:2,analysisId:analysis.id,decisions:[{field:"genre",action:"custom",value:"Mystery"}],confirmScope:true},{repository:f.repository})).rejects.toMatchObject({status:409,fields:{vocabulary:[expect.stringContaining("Search again")]}});
    expect(f.brief.intake?.status).toBe("analyzed");
  });
  it("suppresses model genre options in v3 analysis without another lookup call", async () => {
    const model={modelId:"fixture",complete:vi.fn(async()=>({value:{summary:"A story",observations:[],suggestions:[{field:"genre",question:"What genre?",reason:"Missing",options:["Horror"],dependsOn:null}]},usage:{inputTokens:1,outputTokens:1}}))};
    const output=await analyzeIntake("owner",rawText,model);
    expect(output.promptVersion).toBe("intake-v3");
    expect(output.suggestions[0].options).toEqual([]);
    expect(model.complete).toHaveBeenCalledTimes(1);
  });
});
