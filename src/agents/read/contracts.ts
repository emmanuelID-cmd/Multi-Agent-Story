import { z } from "zod";
import type { ProviderEvidence } from "../../server/research/book-metadata";
import { intakeAnalysisSchema, intakeDecisionSchema, intakeScopeSchema, intakeText } from "../../contracts/intake";

const id = z.string().min(1).max(128).regex(/^[\p{L}\p{N}._:-]+$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().positive().max(1_000_000);
const prose = z.string().min(1).max(2_000);

export const authoritySchema = z.strictObject({
  runId: id, taskId: id, operationId: id, ownerId: id, projectId: id,
  stateVersion: version, requestVersion: version,
  prdVersion: z.string().min(1).max(80),
});
export type ReadAuthority = z.infer<typeof authoritySchema>;
export const researchAuthoritySchema = authoritySchema.extend({ stateVersion: z.number().int().nonnegative().max(1_000_000) });
export type ResearchAuthority = z.infer<typeof researchAuthoritySchema>;

export const readVersionsSchema = z.strictObject({
  contract: z.literal("read-v1"), prompt: z.literal("read-v1"),
  harness: z.string().min(1).max(80), model: z.string().min(1).max(100),
});
export type ReadVersions = z.infer<typeof readVersionsSchema>;

export const briefSchema = z.strictObject({
  premise: prose, genre: z.string().min(1).max(80),
  optionalDetails: z.record(z.string().max(80), z.string().max(2_000)).default({}),
  acceptedSuggestions: z.record(z.string().max(80), z.string().max(2_000)).default({}),
});
export const researchDimensionSchema = z.strictObject({
  id, label: z.string().min(1).max(120), claimType: z.enum(["bibliographic", "historical", "craft"]),
});
export const eligibleSourceSchema = z.strictObject({
  sourceId: id, kind: z.enum(["licensed_text", "public_domain_text", "historical_context"]),
  work: z.string().min(1).max(300), author: z.string().max(300),
  publicationDate: z.string().max(40).nullable(), sourceUrl: z.url().max(2_000),
  fetchedAt: z.iso.datetime(), rightsBasis: prose, jurisdiction: z.string().min(1).max(80),
  rightsVerified: z.literal(true), locator: z.string().min(1).max(200),
  text: z.string().min(1).max(10_000), sha256: digest,
});
export const confirmedIntakeSchema = z.strictObject({
  revision: z.number().int().nonnegative().max(1_000_000),
  rawText: intakeText, sourceHash: digest, analysisHash: digest,
  analysis: intakeAnalysisSchema,
  decisions: z.array(intakeDecisionSchema).max(18),
  scope: intakeScopeSchema,
});
export const researchInputSchema = z.strictObject({
  authority: researchAuthoritySchema, versions: readVersionsSchema,
  briefVersion: version, scopeVersion: version, criteriaVersion: version,
  scopeConfirmed: z.boolean(), brief: briefSchema,
  confirmedIntake: confirmedIntakeSchema.optional(),
  dimensions: z.array(researchDimensionSchema).min(1).max(24),
  eligibleSources: z.array(eligibleSourceSchema).max(24),
  benchmarkRequest: z.strictObject({ genre: z.string().min(1).max(80), providers: z.tuple([z.literal("nyt"), z.literal("gutendex")]), nytList: z.enum(["hardcover-fiction", "trade-fiction-paperback"]).default("hardcover-fiction"), limit: z.number().int().min(1).max(10).default(5) }),
});
export type ResearchInput = z.input<typeof researchInputSchema>;

export const evidenceItemSchema = z.strictObject({
  itemId: id, sourceId: id,
  kind: z.enum(["metadata_fact", "located_text_observation", "historical_fact", "interpretation"]),
  dimensionId: id, claim: prose,
  locator: z.string().min(1).max(200).nullable(),
  quote: z.string().max(600).nullable(), confidence: z.number().min(0).max(1),
});
export const researchAnalysisSchema = z.strictObject({
  items: z.array(evidenceItemSchema).max(80),
  synthesis: z.array(z.strictObject({ dimensionId: id, observation: prose, itemIds: z.array(id).min(1).max(12) })).max(24),
  gaps: z.array(z.strictObject({ dimensionId: id, reason: prose, correction: prose })).max(24),
  limitations: z.array(prose).max(24).default([]),
});
export type ResearchAnalysis = z.infer<typeof researchAnalysisSchema>;
export type ResearchDossier = {
  dossierVersion: number; briefVersion: number; scopeVersion: number; criteriaVersion: number;
  providerOutcomes: { nyt: ProviderEvidence; gutendex: ProviderEvidence };
  sources: Omit<z.infer<typeof eligibleSourceSchema>, "text">[];
  items: ResearchAnalysis["items"]; synthesis: ResearchAnalysis["synthesis"];
  gaps: ResearchAnalysis["gaps"];
  limitations: ResearchAnalysis["limitations"];
  coverage: { dimensionId: string; status: "supported" | "partial" | "missing"; itemIds: string[] }[];
  gateRecommendation: "ACCEPT_CANDIDATE" | "BLOCKED_REQUIRED_EVIDENCE";
  accepted: false;
};

export const chapterRefSchema = z.strictObject({
  chapterIndex: z.number().int().min(1).max(3), sourceId: id,
  bibleVersion: version, draftVersion: version, sha256: digest,
  text: z.string().min(1).max(20_000),
});
export const factSchema = z.strictObject({ id, text: prose });
export const readSnapshotSchema = z.strictObject({
  ownerId: id, projectId: id, stateVersion: version,
  bibleVersion: version, draftVersion: version,
  proposalId: id.optional(), proposalVersion: version.optional(),
  chapters: z.array(chapterRefSchema).length(3), facts: z.array(factSchema).min(1).max(64),
});
export type ReadSnapshot = z.infer<typeof readSnapshotSchema>;
export const readerInputSchema = z.strictObject({
  authority: authoritySchema, versions: readVersionsSchema,
  bibleVersion: version, draftVersion: version,
  editorialTask: z.strictObject({ action: z.enum(["critique", "revise"]), scope: z.array(z.number().int().min(1).max(3)).min(1).max(3), expectedOutput: prose }),
  recordedRequest: z.string().max(2_000), hasAdditionalInstructions: z.boolean(),
  revision: z.number().int().nonnegative().max(2),
});
export type ReaderInput = z.infer<typeof readerInputSchema>;
export const locatedFindingSchema = z.strictObject({
  chapterIndex: z.number().int().min(1).max(3), sourceId: id,
  quote: z.string().min(1).max(600),
  factId: id.nullable(), observation: prose,
});
export const readerAnalysisSchema = z.strictObject({
  findings: z.array(locatedFindingSchema).max(32),
  missingItems: z.array(z.string().min(1).max(200)).max(24),
  confidence: z.number().min(0).max(1),
});
export type ReaderAnalysis = z.infer<typeof readerAnalysisSchema>;

export const consistencyInputSchema = z.strictObject({
  authority: authoritySchema, versions: readVersionsSchema,
  bibleVersion: version, draftVersion: version,
  proposalId: id, proposalVersion: version, proposalSha256: digest,
});
export type ConsistencyInput = z.infer<typeof consistencyInputSchema>;
export const consistencyAnalysisSchema = z.strictObject({
  findings: z.array(locatedFindingSchema.extend({ severity: z.enum(["low", "medium", "high"]), suggestedCorrection: prose })).max(64),
  unresolvedIssues: z.array(prose).max(32),
  checkedFactIds: z.array(id).max(64),
  checkedChapterIndexes: z.array(z.number().int().min(1).max(3)).max(3),
});
export type ConsistencyAnalysis = z.infer<typeof consistencyAnalysisSchema>;

export type TraceEvent = {
  runId: string; taskId: string; operationId: string; agentId: "research" | "reader" | "consistency";
  eventId: string; at: string; event: "started" | "tool_dispatch" | "tool_completed" | "model_dispatch" | "model_completed" | "validation_failed" | "blocked" | "completed" | "failed" | "canceled";
  attempt: number; durationMs?: number; code?: string; versions: ReadVersions; stateVersion: number;
};
export type ReadResult<T> = {
  status: "ready_for_review" | "blocked" | "partial" | "failed" | "canceled";
  reasonCode: string; output?: T; usage: { inputTokens: number; outputTokens: number };
  attempts: number; traceId: string;
};
