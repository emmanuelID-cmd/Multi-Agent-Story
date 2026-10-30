import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { bibleSchema, limits, type Bible } from "../contracts";
import { intakeRecordSchema } from "../contracts/intake";
import { biblePlanningInputSchema, bibleApprovalRecordSchema, bibleProposalSetSchema, parseBibleProposal,
  resolveBibleSelection, sealBibleProposal, validateBibleProposalSetForInput,
  type BiblePlanningInput, type BibleApprovalRecord, type BibleProposal } from "../contracts/planning";
import { generateBibleAlternatives, planningReservation, planningAttemptBudget, type PlanningBudget } from "../agents/bible-planning";
import type { ReadModel } from "../agents/read/model";
import { sha256 } from "../agents/read/runtime";
import { db } from "./db";
import { bibles, memories, projects, proposals } from "./db/schema";
import { AppError } from "./projects";
import { configuredReadConnections } from "./read-connection-http";
import { storyReadModel } from "./story-budget";
import { prepareConfirmedResearchInput } from "./research/confirmed-intake";
import { parseAcceptance, parseCandidate, type ResearchProject, type ResearchRow } from "./research/dossier-storage";

const hash = (data: unknown) => sha256(JSON.stringify(data));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const planningOperationSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal("bible_planning_operation"), operationId: z.uuid(),
  ownerId: z.string().min(1).max(128), projectId: z.string().min(1).max(128), baseStateVersion: z.number().int().nonnegative(),
  inputHash: digest, taskId: z.uuid(), proposalVersion: z.number().int().positive(), model: z.literal("claude-haiku-5-5"),
  promptVersion: z.literal("bible-planning-v1"), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
  reservedCostUsd: z.number().finite().nonnegative(), retryOfOperationId: z.uuid().optional(), createdAt: z.iso.datetime(),
});
export type PlanningOperation = z.infer<typeof planningOperationSchema>;
export type PlanningData = PlanningOperation | BibleProposal | BibleApprovalRecord;
export type PlanningSnapshot = { project: ResearchProject; rows: ResearchRow[] };
export type PlanningWriter = {
  insert: (row: ResearchRow & { data: PlanningData }) => Promise<void>;
  status: (id: string, status: string) => Promise<void>;
  approve: (bible: { id: string; projectId: string; version: number; data: Bible }) => Promise<void>;
};
export type PlanningRepository = {
  load: (ownerId: string, projectId: string) => Promise<PlanningSnapshot>;
  locked: <T>(ownerId: string, projectId: string, work: (snapshot: PlanningSnapshot, writer: PlanningWriter) => Promise<T>) => Promise<T>;
};
export const planningKinds = ["research_dossier", "research_acceptance", "bible_a", "bible_b", "bible_c", "bible_planning_operation", "accepted_bible"];
const MAX_ROWS = 200;
function capacity(snapshot: PlanningSnapshot, extra = 0) {
  if (snapshot.rows.length + extra > MAX_ROWS) throw new AppError(409, "Planning history requires archive support.");
}
function owned(snapshot: PlanningSnapshot, ownerId: string, projectId: string) {
  if (snapshot.project.ownerId !== ownerId || snapshot.project.id !== projectId || snapshot.rows.some(r => r.projectId !== projectId))
    throw new AppError(404, "Project unavailable.");
  capacity(snapshot);
}
export const dbPlanningRepository: PlanningRepository = {
  async load(ownerId, projectId) {
    const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId))).limit(1);
    if (!project) throw new AppError(404, "Project unavailable.");
    const rows = await db.select().from(proposals).where(and(eq(proposals.projectId, projectId), inArray(proposals.kind, planningKinds))).limit(MAX_ROWS + 1);
    const snapshot = { project, rows }; owned(snapshot, ownerId, projectId); return snapshot;
  },
  async locked(ownerId, projectId, work) {
    return db.transaction(async tx => {
      const timeout = `${limits.timeoutMs}ms`;
      await tx.execute(sql`select set_config('statement_timeout', ${timeout}, true), set_config('lock_timeout', ${timeout}, true)`);
      const [project] = await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId))).for("update");
      if (!project) throw new AppError(404, "Project unavailable.");
      const rows = await tx.select().from(proposals).where(and(eq(proposals.projectId, projectId), inArray(proposals.kind, planningKinds))).limit(MAX_ROWS + 1);
      const snapshot = { project, rows }; owned(snapshot, ownerId, projectId);
      return work(snapshot, {
        async insert(row) { await tx.insert(proposals).values(row); },
        async status(id, status) { await tx.update(proposals).set({ status }).where(and(eq(proposals.id, id), eq(proposals.projectId, projectId))); },
        async approve(bible) {
          await tx.insert(bibles).values(bible);
          await tx.insert(memories).values(bible.data.beats.map(beat => ({ id: randomUUID(), bibleId: bible.id, chapterIndex: beat.chapterIndex,
            data: { factIds: bible.data.facts.map(f => f.id), plannedEvents: beat.text, unresolvedThreads: [], summary: "Accepted Bible planning handoff; canonical facts remain in the approved Bible." } })));
          await tx.update(projects).set({ version: bible.version }).where(eq(projects.id, projectId));
        },
      });
    });
  },
};

/** Reads only server-loaded records. A request or model cannot assert research acceptance. */
export async function prepareBiblePlanningInput(snapshot: PlanningSnapshot, taskId: string, operationId: string,
  baseStateVersion = snapshot.project.version): Promise<BiblePlanningInput> {
  const { project } = snapshot; owned(snapshot, project.ownerId, project.id);
  const dossiers = snapshot.rows.filter(r => r.kind === "research_dossier").map(row => ({ row, data: parseCandidate(row.data) }));
  const latest = Math.max(0, ...dossiers.map(d => d.data.version));
  const matches = dossiers.filter(d => d.data.version === latest);
  if (matches.length !== 1) throw new AppError(409, "Accept the current research dossier before planning.");
  const { row, data: candidate } = matches[0];
  if (row.status !== "accepted" || row.id !== candidate.candidateId || row.baseVersion !== baseStateVersion ||
      candidate.projectVersion !== baseStateVersion || candidate.ownerId !== project.ownerId || candidate.projectId !== project.id ||
      candidate.criteriaVersion !== 1 || candidate.dossier.criteriaVersion !== candidate.criteriaVersion || candidate.dossier.gateRecommendation !== "ACCEPT_CANDIDATE")
    throw new AppError(409, "Current accepted research is unavailable.");
  const acceptances = snapshot.rows.filter(r => r.kind === "research_acceptance").map(row => ({ row, data: parseAcceptance(row.data) }))
    .filter(item => item.data.candidateId === candidate.candidateId);
  if (acceptances.length !== 1) throw new AppError(409, "Current research acceptance is unavailable.");
  const accepted = acceptances[0];
  if (accepted.row.status !== "accepted" || accepted.row.baseVersion !== baseStateVersion || accepted.data.ownerId !== project.ownerId ||
      accepted.data.projectId !== project.id || accepted.data.candidateVersion !== candidate.version || accepted.data.candidateHash !== candidate.payloadHash ||
      accepted.data.intakeSnapshotHash !== candidate.intake.snapshotHash || !z.uuid().safeParse(accepted.row.id).success)
    throw new AppError(409, "Research acceptance binding changed.");
  const intake = intakeRecordSchema.parse(project.brief.intake);
  if (!intake.analysis || !intake.confirmed || hash(intake) !== candidate.intake.snapshotHash ||
      hash(intake.confirmed.scope) !== candidate.intake.scopeHash)
    throw new AppError(409, "Confirmed story intent changed.");
  const verified = await prepareConfirmedResearchInput({
    authority: { runId: operationId, taskId, operationId, ownerId: project.ownerId, projectId: project.id,
      stateVersion: baseStateVersion, requestVersion: candidate.intake.revision, prdVersion: "v4-draft" },
    versions: { contract: "read-v1", prompt: "read-v1", harness: "bible-planning-v1", model: "claude-haiku-5-5" },
    expectedRevision: candidate.intake.revision, expectedAnalysisId: candidate.intake.analysisId,
    expectedAnalysisHash: candidate.intake.analysisHash, expectedSourceHash: candidate.intake.sourceHash,
    criteriaVersion: candidate.criteriaVersion, eligibleSources: [],
  }, { get: async () => ({ ...project, version: baseStateVersion }) });
  const dossier = candidate.dossier;
  if (dossier.sources.length !== candidate.sourceReviews.length || dossier.sources.some(source => !candidate.sourceReviews.some(review =>
    review.sourceId === source.sourceId && review.textSha256 === source.sha256 && review.sourceUrl === source.sourceUrl &&
    review.locator === source.locator && Date.parse(review.rightsValidThrough) > Date.now())) ||
    dossier.gaps.length || dossier.briefVersion !== verified.briefVersion || dossier.scopeVersion !== verified.scopeVersion ||
    verified.dimensions.some(d => dossier.coverage.filter(c => c.dimensionId === d.id && c.status === "supported" && c.itemIds.length > 0).length !== 1))
    throw new AppError(409, "Accepted research coverage or source permission changed.");
  const provider = (key: "nyt" | "gutendex") => {
    const { status, reasonCode, sourceUrl, checkedAt, fetchedAt, records } = dossier.providerOutcomes[key];
    return { status, reasonCode, sourceUrl, checkedAt, fetchedAt, recordIds: records.map(r => r.providerRecordId) };
  };
  return biblePlanningInputSchema.parse({ schemaVersion: 1,
    task: { taskId, operationId, ownerId: project.ownerId, projectId: project.id, stateVersion: baseStateVersion, prdVersion: "v4-draft" },
    intent: { originalText: intake.rawText, confirmedInputHash: candidate.intake.snapshotHash, briefVersion: verified.briefVersion,
      scopeVersion: verified.scopeVersion, confirmedDimensions: intake.confirmed.scope.dimensions.map(d => ({ field: d.field, value: d.value,
        source: Object.hasOwn(verified.brief.acceptedSuggestions ?? {}, d.field) ? "accepted_suggestion" : "user" })) },
    research: { dossierId: candidate.candidateId, dossierVersion: candidate.version, dossierHash: candidate.payloadHash,
      acceptanceId: accepted.row.id, acceptedAt: accepted.data.acceptedAt, briefVersion: dossier.briefVersion,
      scopeVersion: dossier.scopeVersion, criteriaVersion: dossier.criteriaVersion, providerOutcomes: { nyt: provider("nyt"), gutendex: provider("gutendex") },
      sourceReferences: dossier.sources.map(({ sourceId, kind, work, author, sourceUrl, locator, rightsBasis, jurisdiction, rightsVerified }) =>
        ({ sourceId, kind, work, author, sourceUrl, locator, rightsBasis, jurisdiction, rightsVerified })),
      evidence: dossier.items, synthesis: dossier.synthesis.map(({ itemIds, ...s }) => ({ ...s, evidenceItemIds: itemIds })), gaps: dossier.gaps, limitations: dossier.limitations,
      coverage: dossier.coverage.map(({ itemIds, ...c }) => ({ ...c, evidenceItemIds: itemIds })) },
  });
}

function operations(snapshot: PlanningSnapshot) {
  return snapshot.rows.filter(r => r.kind === "bible_planning_operation").map(row => {
    const data = planningOperationSchema.parse(row.data);
    if (row.id !== data.operationId || data.ownerId !== snapshot.project.ownerId || data.projectId !== snapshot.project.id || row.baseVersion !== data.baseStateVersion ||
        !["running", "completed", "failed"].includes(row.status)) throw new AppError(409, "Planning operation is inconsistent.");
    return { row, data };
  });
}
function proposalSet(snapshot: PlanningSnapshot, taskId: string) {
  const candidates = snapshot.rows.filter(row => ["bible_a", "bible_b", "bible_c"].includes(row.kind) &&
    (row.data as Partial<BibleProposal>)?.planningTaskId === taskId).map(row => {
    const data = parseBibleProposal(row.data);
    if (row.id !== data.proposalId || row.kind !== data.role || row.baseVersion !== data.baseStateVersion ||
        new Set(data.bible.facts.map(f => f.id)).size !== data.bible.facts.length ||
        !["pending", "accepted", "rejected"].includes(row.status)) throw new AppError(409, "Bible candidate record is inconsistent.");
    return data;
  });
  return bibleProposalSetSchema.parse({ schemaVersion: 1, ownerId: snapshot.project.ownerId, projectId: snapshot.project.id, planningTaskId: taskId, candidates });
}
export type PlanningDependencies = { repository?: PlanningRepository; model?: ReadModel; budget?: PlanningBudget; signal?: AbortSignal; retryOfOperationId?: string };
/** Waiting for a lock can be canceled promptly; once entered, await the transaction's commit/rollback verdict. */
function planningLock<T>(repository: PlanningRepository, ownerId: string, projectId: string, signal: AbortSignal,
  work: (snapshot: PlanningSnapshot, writer: PlanningWriter) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let entered = false;
    const abort = () => { if (!entered) reject(new AppError(409, "Planning stopped. Saved results remain available.")); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw new AppError(409, "Planning stopped. Saved results remain available.");
      return repository.locked(ownerId, projectId, (snapshot, writer) => {
        entered = true; signal.removeEventListener("abort", abort);
        if (signal.aborted) throw new AppError(409, "Planning stopped. Saved results remain available.");
        return work(snapshot, writer);
      });
    }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export async function proposeBiblePlans(ownerId: string, projectId: string, operationId: string, dependencies: PlanningDependencies = {}) {
  z.uuid().parse(operationId);
  if (dependencies.retryOfOperationId) z.uuid().parse(dependencies.retryOfOperationId);
  const repository = dependencies.repository ?? dbPlanningRepository;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("TIMEOUT"), limits.timeoutMs);
  const cancel = () => controller.abort("CANCELED");
  dependencies.signal?.addEventListener("abort", cancel, { once: true });
  if (dependencies.signal?.aborted) cancel();
  const stopped = () => { if (controller.signal.aborted) throw new AppError(409, "Planning stopped. Saved results remain available."); };
  let reservationId: string | undefined;
  try {
    const configured = dependencies.model && dependencies.budget ? { model: dependencies.model, budget: dependencies.budget } : configuredReadConnections(controller.signal).runtime;
    const { model, budget } = configured;
    const attemptBudget = planningAttemptBudget(budget);
    if (model.modelId !== "claude-haiku-5-5") throw Error("MODEL_VERSION_MISMATCH");
    const reserved = await planningLock(repository, ownerId, projectId, controller.signal, async (snapshot, writer) => {
      stopped(); owned(snapshot, ownerId, projectId);
      const previous = operations(snapshot);
      const prior = previous.find(op => op.data.operationId === operationId);
      const taskId = prior?.data.taskId ?? randomUUID();
      const input = await prepareBiblePlanningInput(snapshot, taskId, operationId); stopped();
      if (prior) {
        if (prior.data.retryOfOperationId !== dependencies.retryOfOperationId) throw new AppError(409, "Planning operation has a different retry target.");
        if (prior.data.inputHash !== hash(input)) throw new AppError(409, "Planning operation belongs to changed input.");
        if (prior.row.status !== "completed") throw new AppError(409, "Planning operation is unfinished or uncertain. Review before trying another operation.");
        return { input, operation: prior.data, existing: validateBibleProposalSetForInput(input, proposalSet(snapshot, taskId)).set };
      }
      if (dependencies.retryOfOperationId) {
        const target = previous.find(op => op.data.operationId === dependencies.retryOfOperationId);
        const latest = [...previous].sort((a, b) => b.data.proposalVersion - a.data.proposalVersion)[0];
        if (!target || target !== latest || !["running", "failed"].includes(target.row.status) || target.data.retryOfOperationId ||
            previous.some(op => op.data.retryOfOperationId === target.data.operationId))
          throw new AppError(409, "The current planning operation cannot be retried.");
        const originalInput = await prepareBiblePlanningInput(snapshot, target.data.taskId, target.data.operationId); stopped();
        if (hash(originalInput) !== target.data.inputHash) throw new AppError(409, "Planning sources changed. Retry is unavailable.");
      } else if (previous.some(op => op.row.status === "running") ||
          previous.sort((a,b)=>b.data.proposalVersion-a.data.proposalVersion)[0]?.row.status === "failed") {
        throw new AppError(409, "A planning operation is active or uncertain. Human recovery is required.");
      }
      let reserve;
      try{reserve=planningReservation(input,attemptBudget);}catch(error){
        if(error instanceof Error&&error.message==="BUDGET_EXHAUSTED")
          throw new AppError(409,"The confirmed story and research exceed the available planning budget. Shorten the story context or reduce research evidence; Weaver will not truncate it.");
        throw error;
      }
      if (reserve.inputTokens + reserve.outputTokens + previous.reduce((sum, op) => sum + op.data.inputTokens + op.data.outputTokens, 0) > budget.maxTokens ||
          reserve.costUsd + previous.reduce((sum, op) => sum + op.data.reservedCostUsd, 0) > budget.maxCostUsd)
        throw new AppError(409,"The remaining story planning budget cannot cover this request. Review the prior attempts or reduce research evidence before retrying.");
      capacity(snapshot, 4);
      const operation = planningOperationSchema.parse({ schemaVersion: 1, kind: "bible_planning_operation", operationId, ownerId, projectId,
        baseStateVersion: snapshot.project.version, inputHash: hash(input), taskId, model: model.modelId, promptVersion: "bible-planning-v1",
        proposalVersion: Math.max(0, ...previous.map(op => op.data.proposalVersion)) + 1,
        inputTokens: reserve.inputTokens, outputTokens: reserve.outputTokens, reservedCostUsd: reserve.costUsd, ...(dependencies.retryOfOperationId ? { retryOfOperationId: dependencies.retryOfOperationId } : {}), createdAt: new Date().toISOString() });
      if (dependencies.retryOfOperationId) await writer.status(dependencies.retryOfOperationId, "failed");
      await writer.insert({ id: operationId, projectId, baseVersion: snapshot.project.version, kind: operation.kind, status: "running", data: operation });
      stopped(); return { input, operation, existing: undefined };
    });
    if (reserved.existing) return reserved.existing;
    reservationId = operationId;
    const accountedModel = dependencies.repository ? model : storyReadModel(model, ownerId, projectId, operationId);
    const outputs = await generateBibleAlternatives(reserved.input, accountedModel, attemptBudget, controller.signal); stopped();
    return await planningLock(repository, ownerId, projectId, controller.signal, async (snapshot, writer) => {
      stopped(); owned(snapshot, ownerId, projectId);
      const current = operations(snapshot).find(op => op.data.operationId === operationId);
      if (!current || current.row.status !== "running" || hash(current.data) !== hash(reserved.operation)) throw new AppError(409, "Planning operation changed.");
      const input = await prepareBiblePlanningInput(snapshot, reserved.operation.taskId, operationId);
      if (hash(input) !== reserved.operation.inputHash) throw new AppError(409, "Story or research changed during planning.");
      capacity(snapshot, 3);
      const candidates = outputs.map(output => sealBibleProposal({ schemaVersion: 1, kind: "bible_candidate", proposalId: randomUUID(),
        proposalVersion: reserved.operation.proposalVersion, role: output.role, ownerId, projectId, baseStateVersion: snapshot.project.version,
        planningTaskId: input.task.taskId, confirmedInputHash: input.intent.confirmedInputHash, dossierId: input.research.dossierId,
        dossierVersion: input.research.dossierVersion, dossierHash: input.research.dossierHash, acceptanceId: input.research.acceptanceId,
        bible: output.bible, createdAt: new Date().toISOString() }));
      const set = validateBibleProposalSetForInput(input, { schemaVersion: 1, ownerId, projectId, planningTaskId: input.task.taskId, candidates }).set;
      for (const candidate of candidates) { stopped(); await writer.insert({ id: candidate.proposalId, projectId, baseVersion: snapshot.project.version, kind: candidate.role, status: "pending", data: candidate }); }
      stopped(); await writer.status(operationId, "completed"); stopped(); return set;
    });
  } catch (error) {
    let surfaced=error;
    if(error instanceof Error&&error.message==="PLANNING_CONFLICT")
      surfaced=new AppError(409,"A planning candidate conflicts with the confirmed story or accepted research. No plan was saved; review those inputs before using the one confirmed retry.");
    if(error instanceof Error&&error.message==="BUDGET_EXHAUSTED")
      surfaced=new AppError(409,"A planning response exceeded its reserved budget and was not saved. Review remaining capacity before using the one confirmed retry.");
    if (reservationId && !controller.signal.aborted) await repository.locked(ownerId, projectId, async (snapshot, writer) => {
      const operation = operations(snapshot).find(op => op.data.operationId === reservationId);
      if (operation?.row.status === "running") await writer.status(reservationId!, "failed");
    }).catch(() => undefined);
    throw surfaced;
  } finally { clearTimeout(timer); dependencies.signal?.removeEventListener("abort", cancel); }
}

export const selectBibleRequestSchema = z.strictObject({ proposalId: z.uuid(), proposalVersion: z.number().int().positive(), proposalHash: digest });
export async function approveBiblePlan(ownerId: string, projectId: string, value: unknown, repository: PlanningRepository = dbPlanningRepository) {
  const request = selectBibleRequestSchema.parse(value);
  return repository.locked(ownerId, projectId, async (snapshot, writer) => {
    owned(snapshot, ownerId, projectId);
    const row = snapshot.rows.find(r => r.id === request.proposalId);
    if (!row || row.status !== "pending" || !["bible_a", "bible_b", "bible_c"].includes(row.kind)) throw new AppError(409, "Bible candidate is stale or unavailable.");
    const candidate = parseBibleProposal(row.data);
    const operation = operations(snapshot).find(op => op.data.taskId === candidate.planningTaskId);
    if (!operation || operation.row.status !== "completed" || operations(snapshot).some(op => op.data.proposalVersion > operation.data.proposalVersion))
      throw new AppError(409, "Review the latest complete planning alternatives.");
    const input = await prepareBiblePlanningInput(snapshot, candidate.planningTaskId, operation.data.operationId);
    if (hash(input) !== operation.data.inputHash) throw new AppError(409, "Planning sources changed. Review fresh alternatives.");
    const selected = resolveBibleSelection(input, proposalSet(snapshot, candidate.planningTaskId), { schemaVersion: 1, ownerId, projectId, ...request });
    const bible = { id: randomUUID(), projectId, version: snapshot.project.version + 1, data: selected.bible };
    const approval = bibleApprovalRecordSchema.parse({ schemaVersion: 1, kind: "accepted_bible", approvalId: randomUUID(), ownerId, projectId,
      baseStateVersion: snapshot.project.version, proposalId: selected.proposalId, proposalVersion: selected.proposalVersion,
      proposalHash: selected.payloadHash, approvedBibleId: bible.id, bibleVersion: bible.version, acceptedAt: new Date().toISOString() });
    capacity(snapshot, 1);
    await writer.approve(bible);
    await writer.insert({ id: approval.approvalId, projectId, baseVersion: approval.baseStateVersion, kind: approval.kind, status: "accepted", data: approval });
    for (const alternative of proposalSet(snapshot, candidate.planningTaskId).candidates) await writer.status(alternative.proposalId, alternative.proposalId === selected.proposalId ? "accepted" : "rejected");
    return bible;
  });
}

/** Connection-only dispatch barrier: leaves the existing WRITE receiver inputs unchanged. */
export async function assertCurrentPlanningApproval(project: ResearchProject, bible: { id: string; projectId: string; version: number; data: unknown }, rows: ResearchRow[]) {
  if (!project.brief.intake) return; // Preserve legacy synthetic fixtures.
  const snapshot = { project, rows }; owned(snapshot, project.ownerId, project.id);
  const matches = rows.filter(r => r.kind === "accepted_bible" && (r.data as Partial<BibleApprovalRecord>)?.approvedBibleId === bible.id);
  if (matches.length !== 1) throw new AppError(409, "Exact human Bible approval is required before drafting.");
  const row = matches[0], approval = bibleApprovalRecordSchema.parse(row.data);
  if (row.id !== approval.approvalId || row.status !== "accepted" || row.baseVersion !== approval.baseStateVersion || approval.ownerId !== project.ownerId ||
      approval.projectId !== project.id || bible.projectId !== project.id || approval.bibleVersion !== bible.version || bible.version !== project.version ||
      approval.baseStateVersion + 1 !== project.version) throw new AppError(409, "Bible approval changed.");
  const selectedRow = rows.find(r => r.id === approval.proposalId);
  if (!selectedRow || selectedRow.status !== "accepted") throw new AppError(409, "Selected Bible is unavailable.");
  const selected = parseBibleProposal(selectedRow.data);
  const operation = operations(snapshot).find(op => op.data.taskId === selected.planningTaskId);
  if (!operation || operation.row.status !== "completed") throw new AppError(409, "Planning operation is unavailable.");
  const input = await prepareBiblePlanningInput(snapshot, selected.planningTaskId, operation.data.operationId, approval.baseStateVersion);
  if (hash(input) !== operation.data.inputHash) throw new AppError(409, "Approved planning sources changed.");
  resolveBibleSelection(input, proposalSet(snapshot, selected.planningTaskId), { schemaVersion: 1, ownerId: project.ownerId, projectId: project.id,
    proposalId: approval.proposalId, proposalVersion: approval.proposalVersion, proposalHash: approval.proposalHash });
  if (JSON.stringify(bibleSchema.parse(bible.data)) !== JSON.stringify(selected.bible)) throw new AppError(409, "Approved Bible content changed.");
}
