import { randomUUID } from "node:crypto";
import { z } from "zod";
import { limits } from "../../contracts";
import { intakeRecordSchema } from "../../contracts/intake";
import { sha256, type ReadDependencies } from "../../agents/read/runtime";
import type { ResearchDossier, ResearchInput } from "../../agents/read/contracts";
import { AppError } from "../projects";
import { storyReadModel } from "../story-budget";
import { prepareConfirmedResearchInput, type ConfirmedIntakeRepository, type ConfirmedResearchRequest } from "./confirmed-intake";
import { acquireResearchEvidence, approvedSourceFingerprint, runAcquiredConfirmedResearch, type AcquisitionOptions, type ApprovedResearchSource } from "./research-acquisition";
import { acceptanceRow, assertResearchCapacity, dbResearchRepository, parseAcceptance, parseCandidate, researchAcceptanceSchema, sealCandidate,
  type ResearchCandidate, type ResearchProject, type ResearchRepository, type ResearchRow, type ResearchSnapshot, type ResearchWriter } from "./dossier-storage";

export const RESEARCH_CRITERIA_VERSION=1;
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const acceptResearchRequestSchema=z.strictObject({candidateId:z.uuid(),candidateVersion:z.number().int().positive(),candidateHash:digest,operationId:z.uuid()});
export type AcceptResearchRequest=z.infer<typeof acceptResearchRequestSchema>;
export const transientResearchSourceSchema=z.strictObject({kind:z.enum(["licensed_text","historical_context"]),work:z.string().trim().min(1).max(300),author:z.string().trim().min(1).max(300),
  publicationDate:z.string().trim().max(40).nullable(),sourceUrl:z.url().max(2_000),locator:z.string().trim().min(1).max(200),
  licenseReference:z.string().trim().min(1).max(300),dimensionIds:z.array(z.string().min(1).max(128)).min(1).max(24),
  text:z.string().min(1).max(5_000),confirmPermission:z.literal(true)});
export const createResearchRequestSchema=z.strictObject({operationId:z.uuid(),sources:z.array(transientResearchSourceSchema).min(1).max(3)});
export const transientResearchAcceptanceSchema=acceptResearchRequestSchema.extend({transientSources:z.array(z.strictObject({
  sourceId:z.string().min(1).max(128),licenseReference:z.string().trim().min(1).max(300),
  text:z.string().min(1).max(5_000),confirmPermission:z.literal(true)})).max(24).optional()});
type Dependencies={repository?:ResearchRepository;confirmedRepository?:ConfirmedIntakeRepository;acquisition?:AcquisitionOptions;signal?:AbortSignal;
  requireTransientResubmission?:boolean;transientTexts?:Map<string,string>};
function stopped(signal:AbortSignal){
  if(signal.aborted)throw new AppError(503,"Research acceptance stopped. Try again.");
}
function bounded<T>(action:()=>Promise<T>,signal:AbortSignal):Promise<T>{
  stopped(signal);
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(value?:T,error?:unknown)=>{
      if(settled)return;
      settled=true;
      signal.removeEventListener("abort",abort);
      if(error)reject(error);else resolve(value as T);
    };
    const abort=()=>finish(undefined,new AppError(503,"Research acceptance stopped. Try again."));
    signal.addEventListener("abort",abort,{once:true});
    Promise.resolve().then(()=>{stopped(signal);return action();}).then(value=>finish(value),error=>finish(undefined,error));
  });
}
/** Cancellation before lock acquisition returns promptly. Once work starts, wait for the commit verdict. */
function lockedAcceptance<T>(repository:ResearchRepository,ownerId:string,projectId:string,signal:AbortSignal,
  work:(snapshot:ResearchSnapshot,writer:ResearchWriter)=>Promise<T>):Promise<T>{
  stopped(signal);
  return new Promise((resolve,reject)=>{
    let entered=false;
    let settled=false;
    const finish=(value?:T,error?:unknown)=>{
      if(settled)return;
      settled=true;
      signal.removeEventListener("abort",abort);
      if(error)reject(error);else resolve(value as T);
    };
    const abort=()=>{if(!entered)finish(undefined,new AppError(503,"Research acceptance stopped. Try again."));};
    signal.addEventListener("abort",abort,{once:true});
    Promise.resolve().then(()=>{
      stopped(signal);
      return repository.locked(ownerId,projectId,(snapshot,writer)=>{
        entered=true;
        signal.removeEventListener("abort",abort);
        return work(snapshot,writer);
      });
    }).then(value=>finish(value),error=>finish(undefined,error));
  });
}

function intakeIdentity(project:ResearchProject){
  const parsed=intakeRecordSchema.safeParse(project.brief.intake);
  if(!parsed.success)
    throw new AppError(409,"Confirm the current story scope before reviewing research.");
  const intake=parsed.data;
  if(intake.status!=="confirmed"||!intake.confirmed||!intake.analysis)
    throw new AppError(409,"Confirm the current story scope before reviewing research.");
  return {revision:intake.revision,analysisId:intake.analysis.id,
    analysisHash:sha256(JSON.stringify(intake.analysis)),
    sourceHash:sha256(intake.rawText),snapshotHash:sha256(JSON.stringify(intake)),scopeHash:sha256(JSON.stringify(intake.confirmed.scope))};
}
function sameIntake(a:ResearchCandidate["intake"],b:ReturnType<typeof intakeIdentity>){return JSON.stringify(a)===JSON.stringify(b);}
function candidateRows(snapshot:ResearchSnapshot){
  return snapshot.rows.filter(row=>row.kind==="research_dossier").map(row=>{
    const data=parseCandidate(row.data);
    if(row.projectId!==snapshot.project.id||data.projectId!==snapshot.project.id||
      data.ownerId!==snapshot.project.ownerId||data.candidateId!==row.id||
      row.baseVersion!==data.projectVersion||!["pending","accepted"].includes(row.status))
      throw new AppError(409,"Research dossier record is inconsistent.");
    return {row,data};
  });
}
function currentCandidate(snapshot:ResearchSnapshot,request:AcceptResearchRequest){
  const candidates=candidateRows(snapshot);
  const selected=candidates.find(item=>item.row.id===request.candidateId);
  if(!selected||selected.data.candidateId!==request.candidateId||selected.data.version!==request.candidateVersion||
    selected.data.payloadHash!==request.candidateHash||selected.row.projectId!==snapshot.project.id||
    selected.data.ownerId!==snapshot.project.ownerId||selected.data.projectId!==snapshot.project.id||
    selected.row.baseVersion!==snapshot.project.version||selected.data.projectVersion!==snapshot.project.version)
    throw new AppError(409,"Research dossier changed. Review the current candidate.");
  if(candidates.some(item=>item.data.version>selected.data.version)||
    candidates.filter(item=>item.data.version===selected.data.version).length!==1)
    throw new AppError(409,"A newer research dossier is available. Review that candidate.");
  if(!sameIntake(selected.data.intake,intakeIdentity(snapshot.project))||selected.data.criteriaVersion!==RESEARCH_CRITERIA_VERSION||
    selected.data.dossier.criteriaVersion!==selected.data.criteriaVersion)
    throw new AppError(409,"The confirmed research scope changed. Create a fresh dossier.");
  if(!["pending","accepted"].includes(selected.row.status))throw new AppError(409,"Research dossier is no longer pending.");
  return selected;
}
/** Use the acceptance boundary's own freshness checks for review labels. */
function candidateIsCurrent(snapshot:ResearchSnapshot,data:ResearchCandidate){
  try{
    currentCandidate(snapshot,{candidateId:data.candidateId,candidateVersion:data.version,
      candidateHash:data.payloadHash,operationId:"00000000-0000-4000-8000-000000000000"});
    return true;
  }catch(error){
    if(error instanceof AppError&&error.status===409)return false;
    throw error;
  }
}
function existingOperation(snapshot:ResearchSnapshot,request:AcceptResearchRequest){
  const matches=snapshot.rows.filter(row=>row.kind==="research_acceptance").map(row=>({row,data:parseAcceptance(row.data)}))
    .filter(item=>item.data.operationId===request.operationId);
  if(matches.length>1)throw new AppError(409,"Research acceptance operation is inconsistent.");
  const existing=matches[0];
  if(existing&&(existing.row.projectId!==snapshot.project.id||existing.row.baseVersion!==snapshot.project.version||
    existing.row.status!=="accepted"||existing.data.ownerId!==snapshot.project.ownerId||
    existing.data.projectId!==snapshot.project.id||existing.data.intakeSnapshotHash!==intakeIdentity(snapshot.project).snapshotHash||
    existing.data.candidateId!==request.candidateId||existing.data.candidateVersion!==request.candidateVersion||
    existing.data.candidateHash!==request.candidateHash))throw new AppError(409,"Acceptance operation belongs to a different dossier.");
  return existing?.data;
}
function noProse(candidate:ResearchCandidate){
  if(Buffer.byteLength(JSON.stringify(candidate),"utf8")>262_144)
    throw new AppError(409,"Research dossier exceeds its bounded storage contract.");
}
function normalizedEchoText(value:string){
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu,"");
}
function collectStrings(value:unknown,into:string[]){
  if(typeof value==="string"){into.push(normalizedEchoText(value));return;}
  if(Array.isArray(value)){for(const item of value)collectStrings(item,into);return;}
  if(value&&typeof value==="object")for(const item of Object.values(value))collectStrings(item,into);
}
/** Fail closed when saved model output repeats a long, verbatim span from transient user text. */
function rejectTransientSourceEcho(dossier:ResearchDossier,sources:Map<string,string>){
  if(!sources.size)return;
  const output:string[]=[];
  collectStrings(dossier,output);
  for(const raw of sources.values()){
    const source=normalizedEchoText(raw);
    if(source.length<4)continue;
    const width=Math.min(32,source.length);
    for(let start=0;start<=source.length-width;start++){
      const span=source.slice(start,start+width);
      if(output.some(text=>text.includes(span)))
        throw new AppError(409,"Research output repeated text from a transient source. The excerpt was not saved; review the source or try again.");
    }
  }
}
export async function listResearchCandidates(ownerId:string,projectId:string,repository:ResearchRepository=dbResearchRepository){
  const snapshot=await repository.load(ownerId,projectId);
  assertResearchCapacity(snapshot);
  const candidates=candidateRows(snapshot);
  if(candidates.length>50)throw new AppError(409,"Research candidate history exceeds this review endpoint. Archive support is required.");
  return candidates.sort((a,b)=>b.data.version-a.data.version).map(({row,data})=>({
    id:row.id,version:data.version,hash:data.payloadHash,status:row.status,current:candidateIsCurrent(snapshot,data),criteriaVersion:data.criteriaVersion,
    intake:data.intake,coverage:data.dossier.coverage,gaps:data.dossier.gaps,
    gateRecommendation:data.dossier.gateRecommendation,
  }));
}
export async function getResearchCandidate(ownerId:string,projectId:string,candidateId:string,repository:ResearchRepository=dbResearchRepository){
  if(!z.uuid().safeParse(candidateId).success)throw new AppError(400,"Invalid research candidate ID.");
  const snapshot=await repository.load(ownerId,projectId);
  assertResearchCapacity(snapshot);
  const selected=candidateRows(snapshot).find(item=>item.row.id===candidateId);
  if(!selected)throw new AppError(404,"Research dossier unavailable.");
  return {id:selected.row.id,version:selected.data.version,hash:selected.data.payloadHash,status:selected.row.status,current:candidateIsCurrent(snapshot,selected.data),
    criteriaVersion:selected.data.criteriaVersion,intake:selected.data.intake,
    dossier:selected.data.dossier,sourceReviews:selected.data.sourceReviews,provenance:selected.data.provenance};
}

/** Server-only creation path: the candidate always comes from the confirmed READ runner. */
export async function createResearchCandidate(request:ConfirmedResearchRequest,read:ReadDependencies,dependencies:Dependencies={}){
  if(request.criteriaVersion!==RESEARCH_CRITERIA_VERSION)throw new AppError(409,"Research criteria changed.");
  const repository=dependencies.repository??dbResearchRepository;
  const confirmed=dependencies.confirmedRepository??{get:async(ownerId:string,projectId:string)=>(await repository.load(ownerId,projectId)).project};
  const model=dependencies.repository?read.model:storyReadModel(read.model,request.authority.ownerId,request.authority.projectId,request.authority.operationId);
  const result=await runAcquiredConfirmedResearch(request,{...read,model,signal:dependencies.signal??read.signal},confirmed,dependencies.acquisition);
  if(!result.output||!result.acquisition||!["ready_for_review","blocked"].includes(result.status))
    throw new AppError(409,`Research could not create a reviewable dossier (${result.reasonCode}).`);
  const dossier=result.output;
  const provenance=result.acquisition;
  if(dossier.criteriaVersion!==request.criteriaVersion||dossier.briefVersion!==request.expectedRevision||
    dossier.scopeVersion!==request.expectedRevision||dossier.accepted!==false)
    throw new AppError(409,"Research dossier versions do not match confirmed input.");
  const reviewSources=provenance.sources.filter(item=>item.status==="eligible");
  if(reviewSources.length!==dossier.sources.length||
    dossier.sources.some(source=>!reviewSources.some(review=>review.sourceId===source.sourceId&&review.textSha256===source.sha256)))
    throw new AppError(409,"Research source provenance is incomplete.");
  const transientIds=new Set(dependencies.transientTexts?.keys()??[]);
  const quoteProofs=new Map<string,Array<{itemId:string;quoteSha256:string;start:number;length:number}>>();
  for(const item of dossier.items){
    if(!transientIds.has(item.sourceId)||item.kind==="interpretation")continue;
    if(!item.quote)throw new AppError(409,"Transient-source evidence is missing its validated passage.");
    const text=dependencies.transientTexts!.get(item.sourceId);
    const start=text?.indexOf(item.quote)??-1;
    if(start<0)throw new AppError(409,"Transient-source evidence no longer matches its passage.");
    quoteProofs.set(item.sourceId,[...(quoteProofs.get(item.sourceId)??[]),
      {itemId:item.itemId,quoteSha256:sha256(item.quote),start,length:item.quote.length}]);
  }
  const storedDossier=transientIds.size?{...dossier,items:dossier.items.map(item=>transientIds.has(item.sourceId)?{...item,quote:null}:item)}:dossier;
  if(dependencies.transientTexts)rejectTransientSourceEcho(storedDossier,dependencies.transientTexts);
  const initial=await repository.load(request.authority.ownerId,request.authority.projectId);
  const identity=intakeIdentity(initial.project);
  if(initial.project.version!==request.authority.stateVersion||identity.revision!==request.expectedRevision||
    identity.analysisId!==request.expectedAnalysisId||identity.analysisHash!==request.expectedAnalysisHash||
    identity.sourceHash!==request.expectedSourceHash)
    throw new AppError(409,"Confirmed intake changed before research storage.");
  return repository.locked(request.authority.ownerId,request.authority.projectId,async(snapshot,writer)=>{
    if(dependencies.signal?.aborted||read.signal?.aborted)throw new AppError(409,"Research storage was canceled.");
    if(snapshot.project.version!==initial.project.version||JSON.stringify(intakeIdentity(snapshot.project))!==JSON.stringify(identity))
      throw new AppError(409,"Confirmed intake changed before research storage.");
    const existing=candidateRows(snapshot);
    assertResearchCapacity(snapshot,1);
    if(existing.length>=50)throw new AppError(409,"Research candidate history exceeds this review endpoint. Archive support is required.");
    if(existing.some(item=>item.data.operationId===request.authority.operationId))
      throw new AppError(409,"This research operation already has a dossier candidate.");
    const version=Math.max(0,...existing.map(item=>item.data.version))+1;
    const candidate=sealCandidate({schemaVersion:1,kind:"research_dossier",candidateId:randomUUID(),version,
      operationId:request.authority.operationId,runId:request.authority.runId,ownerId:request.authority.ownerId,
      projectId:request.authority.projectId,projectVersion:snapshot.project.version,intake:identity,
      criteriaVersion:request.criteriaVersion,dossier:storedDossier,provenance,sourceReviews:reviewSources.map(item=>({sourceId:item.sourceId,
        sourceUrl:item.sourceUrl,locator:item.locator,textSha256:item.textSha256,rightsEvidenceRef:item.rightsEvidenceRef,
      rightsVerifiedAt:item.rightsVerifiedAt,rightsValidThrough:item.rightsValidThrough,
        reviewFingerprint:item.reviewFingerprint,matchedDimensions:item.matchedDimensions,
        ...(transientIds.has(item.sourceId)?{requireTransientResubmission:true,quoteProofs:quoteProofs.get(item.sourceId)??[]}: {})}))});
    noProse(candidate);
    const row=await writer.insert({id:candidate.candidateId,projectId:candidate.projectId,baseVersion:snapshot.project.version,
      kind:"research_dossier",status:"pending",data:candidate});
    if(dependencies.signal?.aborted||read.signal?.aborted)throw new AppError(409,"Research storage was canceled.");
    return {id:row.id,version:candidate.version,hash:candidate.payloadHash,gateRecommendation:dossier.gateRecommendation};
  });
}

/** Create a review candidate from current confirmed intake plus user-confirmed, transient text. */
export async function createResearchCandidateForProject(ownerId:string,projectId:string,value:unknown,read:ReadDependencies,dependencies:Dependencies={}){
  const submission=createResearchRequestSchema.parse(value);
  const repository=dependencies.repository??dbResearchRepository;
  const snapshot=await bounded(()=>repository.load(ownerId,projectId),dependencies.signal??read.signal??new AbortController().signal);
  const intake=intakeRecordSchema.safeParse(snapshot.project.brief.intake);
  if(!intake.success||intake.data.status!=="confirmed"||!intake.data.confirmed||!intake.data.analysis)
    throw new AppError(409,"Confirm the current story scope before research.");
  const dimensions=intake.data.confirmed.scope.dimensions;
  const sourceTexts=new Map<string,string>();
  const approvedSources:ApprovedResearchSource[]=submission.sources.map((source,index)=>{
    const selected=new Set(source.dimensionIds);
    if(selected.size!==source.dimensionIds.length||source.dimensionIds.some(id=>!dimensions.some(d=>d.field===id)))
      throw new AppError(400,"Choose only dimensions from the current confirmed story scope.");
    const textSha256=sha256(source.text);
    const sourceId=`licensed-${sha256(JSON.stringify({ownerId,projectId,operationId:submission.operationId,index,textSha256,sourceUrl:source.sourceUrl,locator:source.locator})).slice(0,32)}`;
    sourceTexts.set(sourceId,source.text);
    const now=new Date();
    const approval:ApprovedResearchSource={sourceId,kind:source.kind,work:source.work,author:source.author,
      publicationDate:source.publicationDate,sourceUrl:source.sourceUrl,locator:source.locator,expectedSha256:textSha256,
      rights:{basis:"The user confirms permission to submit this text for research analysis.",type:"user_license",jurisdiction:"US",
        purpose:"research_text_analysis",verifiedAt:now.toISOString(),validThrough:new Date(now.getTime()+24*60*60*1000).toISOString(),evidenceRef:source.licenseReference},
      identity:{type:"licensed_user",ownerId,projectId},
      matches:dimensions.filter(d=>selected.has(d.field)).map(d=>({dimensionId:d.field,confirmedValue:d.value,evidenceRef:source.licenseReference}))};
    return approval;
  });
  const request:ConfirmedResearchRequest={authority:{runId:submission.operationId,taskId:"research",operationId:submission.operationId,
      ownerId,projectId,stateVersion:snapshot.project.version,requestVersion:intake.data.revision,prdVersion:"v4-draft"},
    versions:{contract:"read-v1",prompt:"read-v1",harness:"research-dossier-v1",model:read.model.modelId},
    expectedRevision:intake.data.revision,expectedAnalysisId:intake.data.analysis.id,
    expectedAnalysisHash:sha256(JSON.stringify(intake.data.analysis)),expectedSourceHash:intake.data.analysis.sourceHash,
    criteriaVersion:RESEARCH_CRITERIA_VERSION,eligibleSources:[]};
  return createResearchCandidate(request,read,{...dependencies,repository,requireTransientResubmission:true,transientTexts:sourceTexts,acquisition:{...dependencies.acquisition,approvedSources,
    readApprovedText:async source=>{const text=sourceTexts.get(source.sourceId);if(!text)throw new Error("TRANSIENT_SOURCE_MISSING");
      return {text,fetchedAt:new Date().toISOString()};}}});
}

function verifyCoverage(candidate:ResearchCandidate,input:ResearchInput,reacquired:Awaited<ReturnType<typeof acquireResearchEvidence>>){
  const dossier=candidate.dossier;
  if(dossier.gateRecommendation!=="ACCEPT_CANDIDATE")
    throw new AppError(409,"Research evidence does not cover every confirmed dimension.");
  if(dossier.providerOutcomes.nyt.provider!=="nyt"||dossier.providerOutcomes.gutendex.provider!=="gutendex"||
    dossier.providerOutcomes.nyt.status==="not_requested"||dossier.providerOutcomes.gutendex.status==="not_requested")
    throw new AppError(409,"Both required provider outcomes must be recorded before acceptance.");
  if(dossier.sources.length!==reacquired.input.eligibleSources.length||
    candidate.sourceReviews.length!==dossier.sources.length||reacquired.report.gaps.length)
    throw new AppError(409,"Required research sources are unavailable or changed.");
  for(const source of dossier.sources){
    const fresh=reacquired.input.eligibleSources.find(item=>item.sourceId===source.sourceId);
    const storedReview=candidate.sourceReviews.find(item=>item.sourceId===source.sourceId);
    const currentReview=reacquired.report.sources.find(item=>item.sourceId===source.sourceId&&item.status==="eligible");
    if(!fresh||!storedReview||!currentReview||fresh.sha256!==source.sha256||fresh.sourceUrl!==source.sourceUrl||
      fresh.locator!==source.locator||fresh.work!==source.work||fresh.author!==source.author||
      fresh.kind!==source.kind||fresh.publicationDate!==source.publicationDate||fresh.rightsBasis!==source.rightsBasis||
      JSON.stringify(fresh.approvedDimensionIds)!==JSON.stringify(source.approvedDimensionIds)||
      storedReview.rightsEvidenceRef!==currentReview.rightsEvidenceRef||storedReview.rightsVerifiedAt!==currentReview.rightsVerifiedAt||
      storedReview.rightsValidThrough!==currentReview.rightsValidThrough||storedReview.reviewFingerprint!==currentReview.reviewFingerprint||
      storedReview.textSha256!==source.sha256||storedReview.sourceUrl!==source.sourceUrl||storedReview.locator!==source.locator||
      JSON.stringify(storedReview.matchedDimensions)!==JSON.stringify(currentReview.matchedDimensions))
      throw new AppError(409,"A research source changed or lost permission.");
  }
  const observed=new Map<string,string[]>();
  for(const item of dossier.items){
    const dimension=input.dimensions.find(d=>d.id===item.dimensionId);
    if(!dimension)throw new AppError(409,"Research cites an unconfirmed dimension.");
    if(item.kind==="metadata_fact")throw new AppError(409,"Catalog metadata cannot establish confirmed research coverage.");
    const source=reacquired.input.eligibleSources.find(s=>s.sourceId===item.sourceId);
    if(item.kind==="interpretation"){
      if(!source||!source.approvedDimensionIds?.includes(item.dimensionId))
        throw new AppError(409,"A research interpretation cites an unapproved dimension.");
      continue;
    }
    const sourceReview=candidate.sourceReviews.find(review=>review.sourceId===item.sourceId);
    let passageSupported=false;
    if(sourceReview?.requireTransientResubmission){
      const proof=sourceReview.quoteProofs?.find(entry=>entry.itemId===item.itemId);
      const passage=proof&&source?source.text.slice(proof.start,proof.start+proof.length):"";
      passageSupported=item.quote===null&&!!proof&&passage.length===proof.length&&sha256(passage)===proof.quoteSha256;
    }else passageSupported=!!source&&!!item.quote&&source.text.includes(item.quote);
    if(!source||!source.approvedDimensionIds?.includes(item.dimensionId)||!passageSupported||item.locator!==source.locator||
      (dimension.claimType==="craft"&&(item.kind!=="located_text_observation"||source.kind==="historical_context"))||
      (dimension.claimType==="historical"&&(item.kind!=="historical_fact"||source.kind!=="historical_context")))
      throw new AppError(409,"A located research observation is no longer supported.");
    observed.set(item.dimensionId,[...(observed.get(item.dimensionId)??[]),item.itemId]);
  }
  const recomputed=input.dimensions.map(d=>({dimensionId:d.id,
    status:(observed.get(d.id)?.length&&!dossier.gaps.some(g=>g.dimensionId===d.id)?"supported":observed.get(d.id)?.length?"partial":"missing") as "supported"|"partial"|"missing",
    itemIds:observed.get(d.id)??[]}));
  if(recomputed.some(item=>item.status!=="supported")||JSON.stringify(recomputed)!==JSON.stringify(dossier.coverage))
    throw new AppError(409,"Research evidence does not cover every confirmed dimension.");
}

/** An authenticated route supplies ownerId; model output and request JSON cannot call this service as a human. */
export async function acceptResearchCandidate(ownerId:string,projectId:string,value:unknown,dependencies:Dependencies={}){
  const parsedRequest=transientResearchAcceptanceSchema.parse(value);
  const {transientSources:submittedSources=[],...requestBody}=parsedRequest;
  const transientSources=submittedSources;
  const request=acceptResearchRequestSchema.parse(requestBody);
  const repository=dependencies.repository??dbResearchRepository;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort("TIMEOUT"),limits.timeoutMs);
  const cancel=()=>controller.abort("CANCELED");
  dependencies.signal?.addEventListener("abort",cancel,{once:true});
  if(dependencies.signal?.aborted)cancel();
  try{
    const initial=await bounded(()=>repository.load(ownerId,projectId),controller.signal);
    assertResearchCapacity(initial);
    const selected=currentCandidate(initial,request);
    const completed=existingOperation(initial,request);
    if(selected.row.status==="accepted"){
      if(completed)return completed;
      throw new AppError(409,"Research dossier was already decided.");
    }
    const candidate=selected.data;
    const confirmed:ConfirmedResearchRequest={authority:{runId:candidate.runId,taskId:"research_acceptance",operationId:candidate.operationId,
      ownerId,projectId,stateVersion:candidate.projectVersion,requestVersion:candidate.intake.revision,prdVersion:"v4-draft"},
      versions:{contract:"read-v1",prompt:"read-v1",harness:"acceptance-recheck",model:"source-recheck"},
      expectedRevision:candidate.intake.revision,expectedAnalysisId:candidate.intake.analysisId,
      expectedAnalysisHash:candidate.intake.analysisHash,expectedSourceHash:candidate.intake.sourceHash,
      criteriaVersion:candidate.criteriaVersion,eligibleSources:[]};
    const confirmedRepo:ConfirmedIntakeRepository=dependencies.confirmedRepository??{
      get:async(owner,project)=>(await repository.load(owner,project)).project};
    const input=await prepareConfirmedResearchInput(confirmed,confirmedRepo,{deadlineAt:Date.now()+limits.timeoutMs,signal:controller.signal});
    const sourceIds=new Set(candidate.dossier.sources.map(source=>source.sourceId));
    const textById=new Map<string,string>();
    for(const item of transientSources){
      if(textById.has(item.sourceId)||!sourceIds.has(item.sourceId))throw new AppError(400,"Research source resubmission does not match this dossier.");
      textById.set(item.sourceId,item.text);
    }
    const transientApprovals:ApprovedResearchSource[]=candidate.sourceReviews.flatMap(review=>{
      const stored=candidate.dossier.sources.find(source=>source.sourceId===review.sourceId);
      const provenance=candidate.provenance.sources.find(source=>source.sourceId===review.sourceId);
      if(!review.requireTransientResubmission||!stored||!(["licensed_text","historical_context"] as const).includes(stored.kind as "licensed_text"|"historical_context"))return [];
      const submitted=transientSources.find(item=>item.sourceId===review.sourceId);
      if(!submitted||!submitted.confirmPermission||submitted.licenseReference!==review.rightsEvidenceRef||sha256(submitted.text)!==review.textSha256)
        throw new AppError(400,"Paste the same excerpt again and confirm its existing license reference.");
      if(!provenance)throw new AppError(409,"Research source review is incomplete.");
      const confirmedDimensions=input.confirmedIntake?.scope.dimensions??[];
      const matches=review.matchedDimensions.map(dimensionId=>{
        const dimension=confirmedDimensions.find(item=>item.field===dimensionId);
        if(!dimension)throw new AppError(409,"Research source no longer matches the confirmed scope.");
        return {dimensionId,confirmedValue:dimension.value,evidenceRef:review.rightsEvidenceRef};
      });
      return [{sourceId:review.sourceId,kind:stored.kind,work:stored.work,author:stored.author,publicationDate:stored.publicationDate,
        sourceUrl:stored.sourceUrl,locator:stored.locator,expectedSha256:review.textSha256,
        rights:{basis:provenance.rightsBasis,type:"user_license",jurisdiction:"US",purpose:"research_text_analysis",
          verifiedAt:review.rightsVerifiedAt,validThrough:review.rightsValidThrough,evidenceRef:review.rightsEvidenceRef},
        identity:{type:"licensed_user",ownerId,projectId},matches}];
    });
    const configured=dependencies.acquisition;
    const approvedSources=[...(configured?.approvedSources??[]),...transientApprovals].filter(source=>sourceIds.has(source.sourceId))
      .filter((source,index,items)=>items.findIndex(item=>item.sourceId===source.sourceId)===index);
    if(approvedSources.length!==sourceIds.size)throw new AppError(503,"Approved research sources are unavailable or not configured.");
    const readApprovedText=async(source:ApprovedResearchSource,signal:AbortSignal)=>{
      const text=textById.get(source.sourceId);
      if(text!==undefined)return {text,fetchedAt:new Date().toISOString()};
      if(configured?.readApprovedText)return configured.readApprovedText(source,signal);
      throw new Error("APPROVED_READER_UNAVAILABLE");
    };
    const reacquired=await acquireResearchEvidence(input,{...configured,approvedSources,readApprovedText,
      readBenchmarks:async()=>[candidate.dossier.providerOutcomes.nyt,candidate.dossier.providerOutcomes.gutendex]},controller.signal);
    if(controller.signal.aborted)throw new AppError(503,"Research source recheck stopped. Try again.");
    verifyCoverage(candidate,input,reacquired);
    const verifiedAt=new Date().toISOString();
    return await lockedAcceptance(repository,ownerId,projectId,controller.signal,async(snapshot,writer)=>{
      stopped(controller.signal);
      const current=currentCandidate(snapshot,request);
      if(current.data.payloadHash!==candidate.payloadHash||
        JSON.stringify(intakeIdentity(snapshot.project))!==JSON.stringify(intakeIdentity(initial.project)))
        throw new AppError(409,"Research changed during source verification. Review again.");
      const prior=existingOperation(snapshot,request);
      if(prior){
        if(current.row.status!=="accepted")throw new AppError(409,"Research acceptance state is inconsistent.");
        return prior;
      }
      if(current.row.status!=="pending")throw new AppError(409,"Research dossier was already decided.");
      assertResearchCapacity(snapshot,1);
      if(candidate.sourceReviews.some(review=>Date.parse(review.rightsValidThrough)<Date.now()))
        throw new AppError(409,"A research source permission expired. Review again.");
      const freshApprovals=approvedSources;
      if(candidate.sourceReviews.some(review=>!freshApprovals.some(source=>source.sourceId===review.sourceId&&
        approvedSourceFingerprint(source)===review.reviewFingerprint)))
        throw new AppError(409,"A source review changed before acceptance.");
      stopped(controller.signal);
      const acceptance=researchAcceptanceSchema.parse({schemaVersion:1,kind:"research_acceptance",operationId:request.operationId,
        ownerId,projectId,candidateId:request.candidateId,candidateVersion:request.candidateVersion,
        candidateHash:request.candidateHash,intakeSnapshotHash:candidate.intake.snapshotHash,
        sourceVerifiedAt:verifiedAt,acceptedAt:new Date().toISOString()});
      await bounded(()=>writer.insert(acceptanceRow(acceptance,snapshot.project.version)),controller.signal);
      stopped(controller.signal);
      await bounded(()=>writer.accept(candidate.candidateId),controller.signal);
      if(candidate.sourceReviews.some(review=>Date.parse(review.rightsValidThrough)<Date.now()))
        throw new AppError(409,"A research source permission expired. Review again.");
      stopped(controller.signal);
      return acceptance;
    });
  }finally{clearTimeout(timeout);dependencies.signal?.removeEventListener("abort",cancel);}
}
