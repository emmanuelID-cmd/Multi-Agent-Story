import { createHash } from "node:crypto";
import { z } from "zod";
import { bibleSchema } from "./index";

const id = z.string().min(1).max(128).regex(/^[\p{L}\p{N}._:-]+$/u);
const uuid = z.uuid();
const version = z.number().int().positive().max(1_000_000);
const digest = z.string().regex(/^[a-f0-9]{64}$/);

/** Exact research evidence and confirmed story state made available to Bible planning. */
export const biblePlanningInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  task: z.strictObject({
    taskId: id,
    operationId: id,
    ownerId: id,
    projectId: id,
    stateVersion: z.number().int().nonnegative().max(1_000_000),
    prdVersion: z.string().min(1).max(80),
  }),
  intent: z.strictObject({
    // Story text is untrusted creative data; callers must keep it outside system instructions.
    originalText: z.string().min(1).max(12_000),
    confirmedInputHash: digest,
    briefVersion: version,
    scopeVersion: version,
    confirmedDimensions: z.array(z.strictObject({
      field: id,
      value: z.string().max(2_000),
      source: z.enum(["user", "accepted_suggestion"]),
    })).max(24),
  }),
  research: z.strictObject({
    dossierId: uuid,
    dossierVersion: version,
    dossierHash: digest,
    acceptanceId: uuid,
    acceptedAt: z.iso.datetime(),
    briefVersion: version,
    scopeVersion: version,
    criteriaVersion: version,
    providerOutcomes: z.strictObject({
      nyt: z.strictObject({
        status: z.enum(["available", "partial", "empty", "no_match", "unavailable", "not_requested", "rate_limited"]),
        reasonCode: z.string().min(1).max(100),
        sourceUrl: z.url().max(2_000),
        checkedAt: z.iso.datetime(),
        fetchedAt: z.iso.datetime().nullable(),
        recordIds: z.array(z.string().max(200)).max(20),
      }),
      gutendex: z.strictObject({
        status: z.enum(["available", "partial", "empty", "no_match", "unavailable", "not_requested", "rate_limited"]),
        reasonCode: z.string().min(1).max(100),
        sourceUrl: z.url().max(2_000),
        checkedAt: z.iso.datetime(),
        fetchedAt: z.iso.datetime().nullable(),
        recordIds: z.array(z.string().max(200)).max(20),
      }),
    }),
    sourceReferences: z.array(z.strictObject({
      sourceId: id,
      kind: z.enum(["licensed_text", "public_domain_text", "historical_context"]),
      work: z.string().min(1).max(300),
      author: z.string().max(300),
      sourceUrl: z.url().max(2_000),
      locator: z.string().min(1).max(200),
      rightsBasis: z.string().min(1).max(2_000),
      jurisdiction: z.string().min(1).max(80),
      rightsVerified: z.literal(true),
    })).max(24),
    evidence: z.array(z.strictObject({
      itemId: id,
      sourceId: id,
      dimensionId: id,
      kind: z.enum(["metadata_fact", "located_text_observation", "historical_fact", "interpretation"]),
      // Retrieved claims and quotes remain untrusted evidence, never task authority.
      claim: z.string().min(1).max(2_000),
      locator: z.string().min(1).max(200).nullable(),
      quote: z.string().max(600).nullable(),
      confidence: z.number().min(0).max(1),
    })).max(80),
    synthesis: z.array(z.strictObject({
      dimensionId: id,
      observation: z.string().min(1).max(2_000),
      evidenceItemIds: z.array(id).min(1).max(12),
    })).max(24),
    gaps: z.array(z.strictObject({
      dimensionId: id,
      reason: z.string().min(1).max(2_000),
      correction: z.string().min(1).max(2_000),
    })).max(24),
    limitations: z.array(z.string().min(1).max(2_000)).max(24),
    coverage: z.array(z.strictObject({
      dimensionId: id,
      status: z.enum(["supported", "partial", "missing"]),
      evidenceItemIds: z.array(id).max(80),
    })).max(24),
  }),
}).superRefine((input, context) => {
  for (const provider of ["nyt", "gutendex"] as const) {
    if (input.research.providerOutcomes[provider].status === "not_requested") {
      context.addIssue({
        code: "custom",
        path: ["research", "providerOutcomes", provider, "status"],
        message: "Bible planning requires a recorded outcome for each mandatory research provider.",
      });
    }
  }
  if (input.intent.briefVersion !== input.research.briefVersion) {
    context.addIssue({ code: "custom", path: ["research", "briefVersion"], message: "Research brief version does not match confirmed input." });
  }
  if (input.intent.scopeVersion !== input.research.scopeVersion) {
    context.addIssue({ code: "custom", path: ["research", "scopeVersion"], message: "Research scope version does not match confirmed input." });
  }
  const evidenceIds = new Set(input.research.evidence.map(item => item.itemId));
  const evidenceById = new Map(input.research.evidence.map(item => [item.itemId, item]));
  if (evidenceIds.size !== input.research.evidence.length) {
    context.addIssue({ code: "custom", path: ["research", "evidence"], message: "Evidence item IDs must be unique." });
  }
  const sourceReferences = new Set(input.research.sourceReferences.map(source => source.sourceId));
  if (sourceReferences.size !== input.research.sourceReferences.length) {
    context.addIssue({ code: "custom", path: ["research", "sourceReferences"], message: "Research source IDs must be unique." });
  }
  const sourceIds = new Set([
    ...input.research.sourceReferences.map(source => source.sourceId),
    ...input.research.providerOutcomes.nyt.recordIds.map(recordId => `nyt:${recordId}`),
    ...input.research.providerOutcomes.gutendex.recordIds.map(recordId => `gutendex:${recordId}`),
  ]);
  for (const item of input.research.evidence) {
    if (!sourceIds.has(item.sourceId)) {
      context.addIssue({ code: "custom", path: ["research", "evidence"], message: `Evidence item ${item.itemId} references a source absent from the accepted dossier.` });
    }
  }
  for (const synthesis of input.research.synthesis) {
    for (const itemId of synthesis.evidenceItemIds) {
      const evidence = evidenceById.get(itemId);
      if (!evidence || evidence.dimensionId !== synthesis.dimensionId) {
        context.addIssue({ code: "custom", path: ["research", "synthesis"], message: `Synthesis references missing or mismatched evidence item ${itemId}.` });
      }
    }
  }
  for (const coverage of input.research.coverage) {
    if (coverage.status === "supported" && coverage.evidenceItemIds.length === 0) {
      context.addIssue({ code: "custom", path: ["research", "coverage"], message: `Supported dimension ${coverage.dimensionId} must cite evidence.` });
    }
    for (const itemId of coverage.evidenceItemIds) {
      const evidence = evidenceById.get(itemId);
      if (!evidence || evidence.dimensionId !== coverage.dimensionId) {
        context.addIssue({ code: "custom", path: ["research", "coverage"], message: `Coverage references missing or mismatched evidence item ${itemId}.` });
      }
    }
  }
});
export type BiblePlanningInput = z.infer<typeof biblePlanningInputSchema>;

export const bibleProposalBodySchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("bible_candidate"),
  proposalId: uuid,
  proposalVersion: version,
  role: z.enum(["bible_a", "bible_b", "bible_c"]),
  ownerId: id,
  projectId: id,
  baseStateVersion: z.number().int().nonnegative().max(1_000_000),
  planningTaskId: id,
  confirmedInputHash: digest,
  dossierId: uuid,
  dossierVersion: version,
  dossierHash: digest,
  acceptanceId: uuid,
  bible: bibleSchema,
  createdAt: z.iso.datetime(),
});
export const bibleProposalSchema = bibleProposalBodySchema.extend({ payloadHash: digest });
export type BibleProposal = z.infer<typeof bibleProposalSchema>;

export const bibleProposalSetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ownerId: id,
  projectId: id,
  planningTaskId: id,
  candidates: z.array(bibleProposalSchema).length(3),
}).superRefine((set, context) => {
  const roles = set.candidates.map(candidate => candidate.role);
  const proposalIds = set.candidates.map(candidate => candidate.proposalId);
  if (new Set(roles).size !== 3) {
    context.addIssue({ code: "custom", path: ["candidates"], message: "Return exactly one independent proposal from Bible A, B, and C." });
  }
  if (new Set(proposalIds).size !== 3) {
    context.addIssue({ code: "custom", path: ["candidates"], message: "Each candidate requires a distinct proposal identity." });
  }
  set.candidates.forEach((candidate, index) => {
    if (candidate.ownerId !== set.ownerId || candidate.projectId !== set.projectId || candidate.planningTaskId !== set.planningTaskId) {
      context.addIssue({ code: "custom", path: ["candidates", index], message: "Candidate ownership and task identity must match its set." });
    }
  });
  const first = set.candidates[0];
  if (first && set.candidates.some(candidate =>
    candidate.baseStateVersion !== first.baseStateVersion ||
    candidate.confirmedInputHash !== first.confirmedInputHash ||
    candidate.dossierId !== first.dossierId ||
    candidate.dossierVersion !== first.dossierVersion ||
    candidate.dossierHash !== first.dossierHash ||
    candidate.acceptanceId !== first.acceptanceId
  )) {
    context.addIssue({ code: "custom", path: ["candidates"], message: "All three proposals must use the same confirmed input and accepted dossier snapshot." });
  }
});
export type BibleProposalSet = z.infer<typeof bibleProposalSetSchema>;

/** Human selection request; this schema does not grant approval or storage authority. */
export const bibleSelectionRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ownerId: id,
  projectId: id,
  proposalId: uuid,
  proposalVersion: version,
  proposalHash: digest,
});
export type BibleSelectionRequest = z.infer<typeof bibleSelectionRequestSchema>;

export function sealBibleProposal(body: z.input<typeof bibleProposalBodySchema>): BibleProposal {
  const parsed = bibleProposalBodySchema.parse(body);
  const payloadHash = createHash("sha256").update(JSON.stringify(parsed), "utf8").digest("hex");
  return bibleProposalSchema.parse({ ...parsed, payloadHash });
}

export function parseBibleProposal(raw: unknown): BibleProposal {
  const parsed = bibleProposalSchema.parse(raw);
  const { payloadHash, ...body } = parsed;
  const expected = createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex");
  if (payloadHash !== expected) throw new Error("BIBLE_PROPOSAL_HASH_MISMATCH");
  return parsed;
}

/**
 * Checks candidate consistency against the supplied task and dossier snapshots.
 * The caller must load canonical snapshots server-side and independently verify
 * authenticated ownership, current project state, and a real current dossier
 * acceptance before permitting planning or selection.
 */
export function validateBibleProposalSetForInput(inputRaw: unknown, setRaw: unknown) {
  const input = biblePlanningInputSchema.parse(inputRaw);
  const set = bibleProposalSetSchema.parse(setRaw);
  const candidates = set.candidates.map(parseBibleProposal);
  if (set.ownerId !== input.task.ownerId || set.projectId !== input.task.projectId || set.planningTaskId !== input.task.taskId) {
    throw new Error("BIBLE_SET_TASK_AUTHORITY_MISMATCH");
  }
  for (const candidate of candidates) {
    if (candidate.baseStateVersion !== input.task.stateVersion ||
      candidate.confirmedInputHash !== input.intent.confirmedInputHash ||
      candidate.dossierId !== input.research.dossierId ||
      candidate.dossierVersion !== input.research.dossierVersion ||
      candidate.dossierHash !== input.research.dossierHash ||
      candidate.acceptanceId !== input.research.acceptanceId) {
      throw new Error("BIBLE_PROPOSAL_SOURCE_MISMATCH");
    }
  }
  return { input, set: { ...set, candidates } };
}

/** Selects one exact candidate; it never merges proposals or treats request data as authorization. */
export function resolveBibleSelection(inputRaw: unknown, setRaw: unknown, requestInput: unknown) {
  const { set } = validateBibleProposalSetForInput(inputRaw, setRaw);
  const request = bibleSelectionRequestSchema.parse(requestInput);
  if (request.ownerId !== set.ownerId || request.projectId !== set.projectId) throw new Error("BIBLE_SELECTION_OWNER_MISMATCH");
  const candidate = set.candidates.find(item => item.proposalId === request.proposalId);
  if (!candidate || candidate.proposalVersion !== request.proposalVersion || candidate.payloadHash !== request.proposalHash) {
    throw new Error("BIBLE_SELECTION_STALE");
  }
  return candidate;
}

/** Shape of an application-recorded acceptance; schema validation alone does not prove authentication or persistence. */
export const bibleApprovalRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("accepted_bible"),
  approvalId: uuid,
  ownerId: id,
  projectId: id,
  baseStateVersion: z.number().int().nonnegative().max(1_000_000),
  proposalId: uuid,
  proposalVersion: version,
  proposalHash: digest,
  approvedBibleId: id,
  bibleVersion: version,
  acceptedAt: z.iso.datetime(),
});
export type BibleApprovalRecord = z.infer<typeof bibleApprovalRecordSchema>;

/** Chapter-draft envelope keeps the accepted Bible version independent from draft history. */
export const chapterDraftTaskSchema = z.strictObject({
  schemaVersion: z.literal(1),
  taskId: id,
  operationId: id,
  ownerId: id,
  projectId: id,
  runId: id,
  baseStateVersion: z.number().int().nonnegative().max(1_000_000),
  chapterIndex: z.number().int().min(1).max(3),
  approvalId: uuid,
  acceptedBibleId: id,
  selectedProposalId: uuid,
  selectedProposalVersion: version,
  selectedProposalHash: digest,
  bibleVersion: version,
  draftVersion: version,
  approvedBibleHash: digest,
  approvedBible: bibleSchema,
}).superRefine((task, context) => {
  const actual = createHash("sha256").update(JSON.stringify(task.approvedBible), "utf8").digest("hex");
  if (task.approvedBibleHash !== actual) {
    context.addIssue({ code: "custom", path: ["approvedBibleHash"], message: "Approved Bible content hash does not match the task payload." });
  }
});
export type ChapterDraftTask = z.infer<typeof chapterDraftTaskSchema>;

/**
 * Maps only the existing writer's established inputs. Before calling, a trusted
 * application service must load and authenticate the acceptance record and
 * confirm current project state. This mapping does not establish authorization.
 * draftVersion remains in the outer task record.
 */
export function toChapterWriterInput(taskInput: unknown, selectedProposalInput: unknown, approvalInput: unknown) {
  const task = chapterDraftTaskSchema.parse(taskInput);
  const selected = parseBibleProposal(selectedProposalInput);
  const approval = bibleApprovalRecordSchema.parse(approvalInput);
  if (selected.proposalId !== task.selectedProposalId || selected.proposalVersion !== task.selectedProposalVersion ||
    selected.payloadHash !== task.selectedProposalHash || selected.ownerId !== task.ownerId || selected.projectId !== task.projectId ||
    selected.baseStateVersion !== task.baseStateVersion ||
    approval.approvalId !== task.approvalId || approval.ownerId !== task.ownerId || approval.projectId !== task.projectId ||
    approval.baseStateVersion !== task.baseStateVersion || approval.proposalId !== task.selectedProposalId ||
    approval.proposalVersion !== task.selectedProposalVersion || approval.proposalHash !== task.selectedProposalHash ||
    approval.approvedBibleId !== task.acceptedBibleId || approval.bibleVersion !== task.bibleVersion ||
    JSON.stringify(selected.bible) !== JSON.stringify(task.approvedBible)) {
    throw new Error("CHAPTER_TASK_BIBLE_PROPOSAL_MISMATCH");
  }
  return {
    chapterIndex: task.chapterIndex as 1 | 2 | 3,
    bibleVersion: task.bibleVersion,
    approvedBible: task.approvedBible,
  };
}
