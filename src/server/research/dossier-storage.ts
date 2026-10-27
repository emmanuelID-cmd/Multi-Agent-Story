import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { limits } from "../../contracts";
import { providerSchema, sha256 } from "../../agents/read/runtime";
import { eligibleSourceSchema, researchAnalysisSchema } from "../../agents/read/contracts";
import { db } from "../db";
import { projects, proposals } from "../db/schema";
import { AppError } from "../projects";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.number().int().positive().max(1_000_000);
const reference = z.string().max(2_000);
const findingSchema=z.strictObject({fieldRef:z.string().max(128),source:z.string().max(128),
  verdict:z.enum(["ACCEPT","FLAG","REJECT"]),reasonCode:z.string().max(100),
  requiredEvidenceImpact:z.enum(["none","review","unavailable"]),humanCorrectionNeeded:z.boolean()});
export const acquisitionProvenanceSchema=z.strictObject({
  queries:z.array(z.strictObject({provider:z.enum(["nyt","gutendex"]),genre:z.string().max(80),
    endpoint:reference,status:providerSchema.shape.status,reasonCode:z.string().max(100),
    checkedAt:z.iso.datetime(),recordIds:z.array(z.string().max(200)).max(20)})).length(2),
  sources:z.array(z.strictObject({sourceId:z.string().max(128),status:z.enum(["eligible","blocked","unavailable"]),
    reasonCode:z.string().max(100),matchedDimensions:z.array(z.string().max(128)).max(24),
    gapDimensions:z.array(z.string().max(128)).max(24),providerRecordId:z.string().max(200).nullable(),
    kind:z.string().max(40),work:z.string().max(300),author:z.string().max(300),
    publicationDate:z.string().max(40).nullable(),sourceUrl:reference,locator:z.string().max(200),
    rightsBasis:reference,rightsEvidenceRef:z.string().max(300),rightsVerifiedAt:z.string().max(40),
    rightsValidThrough:z.string().max(40),reviewFingerprint:z.union([digest,z.literal("")]),
    textSha256:z.union([digest,z.literal("")]),findings:z.array(findingSchema).max(32)})).max(24),
  gaps:z.array(z.strictObject({dimensionId:z.string().max(128),reasonCode:z.string().max(100)})).max(24),
});
export const storedDossierSchema = z.strictObject({
  dossierVersion: positive, briefVersion: positive, scopeVersion: positive, criteriaVersion: positive,
  providerOutcomes: z.strictObject({nyt:providerSchema,gutendex:providerSchema}),
  sources: z.array(eligibleSourceSchema.omit({text:true})).max(24),
  items: researchAnalysisSchema.shape.items,
  synthesis: researchAnalysisSchema.shape.synthesis,
  gaps: researchAnalysisSchema.shape.gaps,
  limitations: researchAnalysisSchema.shape.limitations,
  coverage: z.array(z.strictObject({dimensionId:z.string().min(1).max(128),status:z.enum(["supported","partial","missing"]),itemIds:z.array(z.string().min(1).max(128)).max(80)})).max(24),
  gateRecommendation:z.enum(["ACCEPT_CANDIDATE","BLOCKED_REQUIRED_EVIDENCE"]),accepted:z.literal(false),
});
export const researchCandidateBodySchema = z.strictObject({
  schemaVersion:z.literal(1),kind:z.literal("research_dossier"),candidateId:z.uuid(),version:positive,
  operationId:z.string().min(1).max(128),runId:z.string().min(1).max(128),
  ownerId:z.string().min(1).max(128),projectId:z.string().min(1).max(128),projectVersion:z.number().int().nonnegative(),
  intake:z.strictObject({revision:z.number().int().nonnegative(),analysisId:z.uuid(),analysisHash:digest,sourceHash:digest,snapshotHash:digest,scopeHash:digest}),
  criteriaVersion:positive,dossier:storedDossierSchema,provenance:acquisitionProvenanceSchema,
  sourceReviews:z.array(z.strictObject({sourceId:z.string().min(1).max(128),sourceUrl:z.url().max(2_000),locator:z.string().min(1).max(200),
    textSha256:digest,rightsEvidenceRef:z.string().min(1).max(300),rightsVerifiedAt:z.iso.datetime(),rightsValidThrough:z.iso.datetime(),
    reviewFingerprint:digest,matchedDimensions:z.array(z.string().min(1).max(128)).min(1).max(24)})).max(24),
});
export const researchCandidateSchema=researchCandidateBodySchema.extend({payloadHash:digest});
export type ResearchCandidate=z.infer<typeof researchCandidateSchema>;
export const researchAcceptanceSchema=z.strictObject({
  schemaVersion:z.literal(1),kind:z.literal("research_acceptance"),operationId:z.uuid(),
  ownerId:z.string().min(1).max(128),projectId:z.string().min(1).max(128),candidateId:z.uuid(),
  candidateVersion:positive,candidateHash:digest,intakeSnapshotHash:digest,sourceVerifiedAt:z.iso.datetime(),acceptedAt:z.iso.datetime(),
});
export type ResearchAcceptance=z.infer<typeof researchAcceptanceSchema>;
export type ResearchRecordData=ResearchCandidate|ResearchAcceptance;
export type ResearchRow={id:string;projectId:string;baseVersion:number;kind:string;status:string;data:unknown};
export type ResearchProject={id:string;ownerId:string;version:number;brief:{intake?:unknown}};
export type ResearchSnapshot={project:ResearchProject;rows:ResearchRow[]};
export type ResearchWriter={insert:(row:{id:string;projectId:string;baseVersion:number;kind:"research_dossier"|"research_acceptance";status:"pending"|"accepted";data:ResearchRecordData})=>Promise<ResearchRow>;
  accept:(candidateId:string)=>Promise<void>};
export type ResearchRepository={load:(ownerId:string,projectId:string)=>Promise<ResearchSnapshot>;
  locked:<T>(ownerId:string,projectId:string,work:(snapshot:ResearchSnapshot,writer:ResearchWriter)=>Promise<T>)=>Promise<T>};
export const MAX_RESEARCH_ROWS=100;

export function assertResearchCapacity(snapshot:ResearchSnapshot,additional=0){
  if(snapshot.rows.length+additional>MAX_RESEARCH_ROWS)
    throw new AppError(409,"Research history exceeds this bounded endpoint. Archive support is required.");
}

function snapshotHash(value:unknown){return sha256(JSON.stringify(value));}
export function sealCandidate(body:z.input<typeof researchCandidateBodySchema>):ResearchCandidate{
  const parsed=researchCandidateBodySchema.parse(body);
  return researchCandidateSchema.parse({...parsed,payloadHash:snapshotHash(parsed)});
}
export function parseCandidate(raw:unknown):ResearchCandidate{
  const parsed=researchCandidateSchema.safeParse(raw);
  if(!parsed.success)throw new AppError(409,"Research dossier is unreadable. Create a fresh candidate.");
  const {payloadHash,...body}=parsed.data;
  if(payloadHash!==snapshotHash(body))throw new AppError(409,"Research dossier changed. Create a fresh candidate.");
  return parsed.data;
}
export function parseAcceptance(raw:unknown):ResearchAcceptance{
  const parsed=researchAcceptanceSchema.safeParse(raw);
  if(!parsed.success)throw new AppError(409,"Research acceptance record is unreadable.");
  return parsed.data;
}

/** All mutations of research proposals serialize on the owned project row. */
export const dbResearchRepository:ResearchRepository={
  async load(ownerId,projectId){
    const [project]=await db.select().from(projects).where(and(eq(projects.id,projectId),eq(projects.ownerId,ownerId))).limit(1);
    if(!project)throw new AppError(404,"Project unavailable.");
    const rows=await db.select().from(proposals).where(and(eq(proposals.projectId,projectId),inArray(proposals.kind,["research_dossier","research_acceptance"]))).limit(MAX_RESEARCH_ROWS+1);
    const snapshot={project,rows};
    assertResearchCapacity(snapshot);
    return snapshot;
  },
  async locked(ownerId,projectId,work){
    return db.transaction(async tx=>{
      const timeout=`${limits.timeoutMs}ms`;
      await tx.execute(sql`select set_config('statement_timeout', ${timeout}, true), set_config('lock_timeout', ${timeout}, true)`);
      const [project]=await tx.select().from(projects).where(and(eq(projects.id,projectId),eq(projects.ownerId,ownerId))).for("update");
      if(!project)throw new AppError(404,"Project unavailable.");
      const rows=await tx.select().from(proposals).where(and(eq(proposals.projectId,projectId),inArray(proposals.kind,["research_dossier","research_acceptance"]))).limit(MAX_RESEARCH_ROWS+1);
      const snapshot={project,rows};
      assertResearchCapacity(snapshot);
      const writer:ResearchWriter={
        async insert(row){const [saved]=await tx.insert(proposals).values(row).returning();return saved;},
        async accept(candidateId){await tx.update(proposals).set({status:"accepted"}).where(and(eq(proposals.id,candidateId),eq(proposals.projectId,projectId),eq(proposals.kind,"research_dossier")));},
      };
      return work(snapshot,writer);
    });
  },
};
export function acceptanceRow(data:ResearchAcceptance,baseVersion:number){return {id:randomUUID(),projectId:data.projectId,baseVersion,kind:"research_acceptance" as const,status:"accepted" as const,data};}
