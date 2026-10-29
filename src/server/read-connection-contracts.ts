import { z } from "zod";
import { readerInputSchema, readerAnalysisSchema, consistencyAnalysisSchema, readVersionsSchema } from "../agents/read/contracts";
import { readerToEditorHandoffSchema } from "../agents/handoff";
import { revisedManuscriptSchema } from "../agents/write/runtime";

export const connectionId = z.string().min(1).max(128).regex(/^[\p{L}\p{N}._:-]+$/u);
const version = z.number().int().positive().max(1_000_000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const readAssignmentSchema = z.strictObject({
  schemaVersion: z.literal(1), requestId: connectionId, requestVersion: version,
  runId: connectionId, stateVersion: version, bibleVersion: version, draftVersion: version,
  targetRunId:connectionId.optional(),
  editorialRound: z.number().int().min(0).max(2),
  editorialTask: readerInputSchema.shape.editorialTask,
  recordedRequest: z.string().max(2_000), hasAdditionalInstructions: z.boolean(),
  source: z.discriminatedUnion("kind", [z.strictObject({kind:z.literal("draft")}),
    z.strictObject({kind:z.literal("proposal"),proposalId:connectionId,proposalVersion:version})]),
}).refine(v => v.hasAdditionalInstructions ? Boolean(v.recordedRequest.trim()) : v.recordedRequest === "",
  "Record either explicit additional instructions or an explicit empty request.");
export type ReadAssignment = z.infer<typeof readAssignmentSchema>;
export const readRequestSchema = z.strictObject({
  schemaVersion:z.literal(1), kind:z.literal("read_request"), ownerId:connectionId, projectId:connectionId,
  assignment:readAssignmentSchema, sourceFingerprint:hash,
  draftVersionAuthority:z.literal("authenticated_assignment"),
});
export const rejectionSchema = z.strictObject({
  failedChecks:z.array(z.string().min(1).max(200)).min(1).max(32),
  missingItems:z.array(z.string().max(500)).max(32), requestedCorrection:z.string().min(1).max(2_000),
});
export const receiptSchema = z.strictObject({
  kind:z.literal("receiving_validation"),
  editorId:z.enum(["critic_editor_a","critic_editor_b"]), handoffHash:hash,
  handoffRevision:version, accepted:z.boolean(), rejection:rejectionSchema.optional(),
});
const readerOutputSchema = z.strictObject({handoff:readerToEditorHandoffSchema,
  findings:readerAnalysisSchema.shape.findings,sourceHashes:z.record(connectionId,hash)});
const consistencyOutputSchema = z.strictObject({proposalId:connectionId,proposalVersion:version,
  proposalSha256:hash,bibleVersion:version,status:z.enum(["complete","partial"]),
  findings:consistencyAnalysisSchema.shape.findings,unresolvedIssues:consistencyAnalysisSchema.shape.unresolvedIssues,
  checkedSourceRefs:z.array(connectionId).length(3)});
const resultBase = z.strictObject({status:z.enum(["ready_for_review","blocked","partial","failed","canceled"]),
  reasonCode:z.string().max(100),usage:z.strictObject({inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative()}),
  attempts:z.number().int().nonnegative().max(2),traceId:connectionId});
export const readerResultSchema=resultBase.extend({output:readerOutputSchema.optional()});
export const consistencyResultSchema=resultBase.extend({output:consistencyOutputSchema.optional()});
const budgetReservationSchema=z.strictObject({targetRunId:connectionId,maxTokens:z.number().int().nonnegative(),maxCostUsd:z.number().nonnegative(),
  inputUsdPerMillion:z.number().positive(),outputUsdPerMillion:z.number().positive(),settled:z.boolean()});
export const recoveryDecisionSchema=z.strictObject({decision:z.literal("retry_once"),decisionId:connectionId,
  duplicateProviderCallAcknowledged:z.literal(true),
  authorizedAt:z.string().datetime(),priorGeneration:version,priorStatus:z.enum(["running","blocked","partial","failed","unavailable"]),
  priorReasonCode:z.string().max(100),priorResult:z.union([readerResultSchema,consistencyResultSchema]).optional(),
  priorBudgetReservation:budgetReservationSchema.optional(),
  dependency:z.strictObject({requestVersion:version,stateVersion:version,bibleVersion:version,sourceFingerprint:hash})});
export const readOperationSchema=z.strictObject({
  schemaVersion:z.literal(1),kind:z.literal("read_operation"),ownerId:connectionId,projectId:connectionId,
  operationId:connectionId,requestId:connectionId,agent:z.enum(["reader","consistency"]),
  intentFingerprint:hash,sourceFingerprint:hash,versions:readVersionsSchema,
  generation:z.number().int().min(1).max(3),repairUsed:z.boolean(),recoveryDecisions:z.array(recoveryDecisionSchema).max(1).default([]),
  budgetHistory:z.array(z.strictObject({generation:version,reservation:budgetReservationSchema,
    result:z.union([readerResultSchema,consistencyResultSchema]).optional()})).max(3).default([]),
  status:z.enum(["running","ready_for_review","blocked","partial","failed","canceled","unavailable","exhausted"]),
  reasonCode:z.string().max(100),route:z.enum(["editor","reader_correction","writer_recovery","retrieval_recovery","human_review"]),
  origin:z.enum(["unverified","synthetic"]),verifiedLiveProducer:z.literal(false),
  draftVersionAuthority:z.literal("authenticated_assignment"),
  receipts:z.array(receiptSchema).max(8),
  editorExecutions:z.array(z.strictObject({editorId:z.enum(["critic_editor_a","critic_editor_b"]),
    handoffHash:hash,generation:version,status:z.enum(["accepted_for_execution","output_produced","failed"]),
    modelUsed:z.string().min(1).max(128).optional(),producerOrigin:z.enum(["unverified","synthetic"]).default("unverified")})).max(8).default([]),
  budgetReservation:budgetReservationSchema.optional(),
  editorOutputs:z.array(z.strictObject({editorId:z.enum(["critic_editor_a","critic_editor_b"]),handoffHash:hash,generation:version,
    proposal:revisedManuscriptSchema,usage:resultBase.shape.usage,modelUsed:z.string().min(1).max(128)})).max(4).default([]),
  readerResults:z.array(readerResultSchema).max(3),consistencyResult:consistencyResultSchema.optional(),
  proposalBinding:z.strictObject({proposalId:connectionId,proposalVersion:version,writeDigest:hash,
    readDigest:hash,rowDigest:hash,bibleDigest:hash,baseDigest:hash}).optional(),
});
export type ReadRequest=z.infer<typeof readRequestSchema>;
export type ReadOperation=z.infer<typeof readOperationSchema>;
export const readResumeSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal("read_resume"),ownerId:connectionId,projectId:connectionId,
  runId:connectionId,intentFingerprint:hash,status:z.enum(["reserved","queued","unknown"]),effectRef:connectionId.optional()});
export type ReadConnectionData=ReadRequest|ReadOperation|z.infer<typeof readResumeSchema>;
export class ReadConnectionError extends Error {
  constructor(readonly code:string, readonly route:ReadOperation["route"]="human_review", readonly status:400|404|409=409){super(code);}
}
export type ConnectionRow={id:string;projectId:string;baseVersion:number;kind:string;status:string;data:unknown};
export type ConnectionSnapshot={
  project:{id:string;ownerId:string;version:number};
  run:{id:string;projectId:string;bibleId:string;status:string;canceledAt:Date|null};
  bible:{id:string;projectId:string;version:number;data:unknown};
  chapters:{id:string;runId:string;chapterIndex:number;bibleVersion:number;text:string}[];
  rows:ConnectionRow[];origin:"unverified"|"synthetic";
};
export type ResolvedReadTarget={run:ConnectionSnapshot["run"];sourceRunId?:string;sourceProposalIds?:string[];
  editorialRound?:number;editorialInstructions?:string;hasAdditionalInstructions?:boolean};
export type ConnectionWriter={save:(row:ConnectionRow & {data:ReadConnectionData})=>Promise<void>;
  resolveTarget?:(targetRunId:string)=>Promise<ResolvedReadTarget>};
/** The adapter must scope and lock ownership plus the exact run before exposing data to the callback. */
export type ReadConnectionRepository={locked:<T>(ownerId:string,projectId:string,runId:string,
  work:(snapshot:ConnectionSnapshot,writer:ConnectionWriter)=>Promise<T>)=>Promise<T>};
