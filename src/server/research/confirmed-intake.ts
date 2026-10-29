import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { projects } from "../db/schema";
import { AppError } from "../projects";
import { intakeRecordSchema, intakeFields, scopeFromIntake, assertIntakeDecisionsReviewed } from "../../contracts/intake";
import { researchInputSchema, type ResearchInput, type ResearchAuthority, type ReadVersions } from "../../agents/read/contracts";
import { intakeHash } from "../../agents/intake";
import { createHash, randomUUID } from "node:crypto";
import { runResearch, type ReadDependencies } from "../../agents/read/runtime";
import { limits } from "../../contracts";
import type { ReadResult, ResearchDossier } from "../../agents/read/contracts";
import type { ProviderEvidence } from "./book-metadata";
import type { AcquisitionReport } from "./research-acquisition";
import { isLcFresh } from "../../contracts/vocabulary";

type ProjectRecord = { id: string; ownerId: string; version: number; brief: { intake?: unknown } };
export type ConfirmedIntakeRepository = {
  get: (ownerId: string, projectId: string) => Promise<ProjectRecord | undefined>;
};
const dbRepository: ConfirmedIntakeRepository = {
  async get(ownerId, projectId) {
    const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId))).limit(1);
    return project;
  },
};

function abortCode(signal?: AbortSignal): "TIMEOUT" | "CANCELED" {
  return signal?.reason === "TIMEOUT" ? "TIMEOUT" : "CANCELED";
}
function boundedProject(repository: ConfirmedIntakeRepository, ownerId: string, projectId: string,
  deadlineAt: number, signal?: AbortSignal): Promise<ProjectRecord | undefined> {
  if (signal?.aborted) return Promise.reject(new Error(abortCode(signal)));
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return Promise.reject(new Error("TIMEOUT"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: ProjectRecord | undefined, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(undefined, new Error(abortCode(signal)));
    const timer = setTimeout(() => finish(undefined, new Error("TIMEOUT")), remaining);
    signal?.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      if (signal?.aborted) throw new Error(abortCode(signal));
      return repository.get(ownerId, projectId);
    }).then(
      value => finish(value), error => finish(undefined, error));
  });
}
function boundedAcquisition<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(abortCode(signal)));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error(abortCode(signal)));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(action).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export type ConfirmedResearchRequest = {
  authority: ResearchAuthority; versions: ReadVersions;
  expectedRevision: number; expectedAnalysisId: string; expectedAnalysisHash: string; expectedSourceHash: string;
  criteriaVersion: number;
  eligibleSources: ResearchInput["eligibleSources"]; // Legacy caller field; never grants source approval.
  benchmarkRequest?: ResearchInput["benchmarkRequest"];
};

/** Server-owned snapshot assembly. Caller supplies current scheduler versions, never model text. */
export async function prepareConfirmedResearchInput(request: ConfirmedResearchRequest,
  repository: ConfirmedIntakeRepository = dbRepository,
  boundary: { deadlineAt?: number; signal?: AbortSignal } = {}): Promise<ResearchInput> {
  const { authority } = request;
  const project = await boundedProject(repository, authority.ownerId, authority.projectId,
    Math.min(boundary.deadlineAt ?? Infinity, Date.now() + limits.timeoutMs), boundary.signal);
  if (!project || project.id !== authority.projectId || project.ownerId !== authority.ownerId)
    throw new AppError(404, "Project unavailable.");
  if (project.version !== authority.stateVersion) throw new AppError(409, "Project changed. Reload before research.");
  const parsed = intakeRecordSchema.safeParse(project.brief.intake);
  if (!parsed.success) throw new AppError(409, "Confirmed intake unavailable.");
  const intake = parsed.data;
  if (intake.status !== "confirmed" || !intake.confirmed || !intake.analysis ||
      intake.revision !== request.expectedRevision || intake.analysis.id !== request.expectedAnalysisId ||
      intake.confirmed.analysisId !== request.expectedAnalysisId ||
      intake.analysis.sourceHash !== request.expectedSourceHash || intakeHash(intake.rawText) !== request.expectedSourceHash ||
      createHash("sha256").update(JSON.stringify((project.brief.intake as { analysis: unknown }).analysis)).digest("hex") !== request.expectedAnalysisHash ||
      authority.requestVersion !== intake.revision)
    throw new AppError(409, "Confirmed intake changed. Reload before research.");
  if (new Set(intake.analysis.observations.map(o => o.field)).size !== intake.analysis.observations.length ||
      intake.analysis.observations.some(o => !intake.rawText.includes(o.quote)))
    throw new AppError(409, "Confirmed intake is invalid.");
  if (intake.version === 2) for (const kind of ["genreForm", "subject"] as const) {
    const selected = intake.selection?.[kind];
    const snapshot = intake.lookups?.[kind];
    if (selected && (!snapshot || snapshot.revision !== intake.revision - 1 || snapshot.analysisId !== intake.analysis.id ||
        snapshot.sourceHash !== intake.analysis.sourceHash || !isLcFresh(snapshot.retrievedAt) || !isLcFresh(selected.retrievedAt) ||
        !snapshot.candidates.some(candidate => candidate.uri === selected.uri && candidate.label === selected.label)))
      throw new AppError(409, "Confirmed vocabulary is invalid.");
  }
  let scope;
  try {
    assertIntakeDecisionsReviewed(intake.analysis, intake.decisions, intake.selection);
    scope = scopeFromIntake(intake.analysis, intake.decisions, intake.selection, intake.version === 2);
  } catch { throw new AppError(409, "Confirmed intake is invalid."); }
  if (JSON.stringify(scope) !== JSON.stringify(intake.confirmed.scope))
    throw new AppError(409, "Confirmed scope changed. Reload before research.");
  const observations = new Map(intake.analysis.observations.filter(o => !o.ambiguous).map(o => [o.field, o.quote]));
  const optionalDetails = Object.fromEntries(scope.dimensions.filter(d => d.field !== "premise" && d.field !== "genre" && observations.get(d.field) === d.value).map(d => [d.field, d.value]));
  const acceptedSuggestions = Object.fromEntries(scope.dimensions.filter(d => d.field !== "premise" && d.field !== "genre" && observations.get(d.field) !== d.value).map(d => [d.field, d.value]));
  const fieldLabels = new Map(intakeFields.map(field => [field.id, field.label]));
  const input: ResearchInput = {
    authority, versions: request.versions,
    briefVersion: intake.revision, scopeVersion: intake.revision, criteriaVersion: request.criteriaVersion,
    scopeConfirmed: true,
    brief: { premise: scope.dimensions.find(d => d.field === "premise")?.value ?? "See the full confirmed original story idea.",
      genre: scope.genre, optionalDetails, acceptedSuggestions },
    confirmedIntake: { revision: intake.revision, rawText: intake.rawText, sourceHash: request.expectedSourceHash,
      analysisHash: createHash("sha256").update(JSON.stringify(intake.analysis)).digest("hex"),
      analysis: intake.analysis, decisions: intake.decisions, selection: intake.selection, scope },
    dimensions: scope.dimensions.map(d => ({ id: d.field, label: `Research confirmed ${fieldLabels.get(d.field)} only.`,
      claimType: d.field === "timePeriod" || d.field === "setting" ? "historical" as const : "craft" as const })),
    eligibleSources: [],
    benchmarkRequest: scope.vocabulary ? { genre: scope.genre, providers: ["nyt", "gutendex"], intakeVersion: "intake-v3",
      topicPhrase: scope.vocabulary.gutendexPhrase, subjectUri: scope.vocabulary.subject?.uri ?? null } :
      request.benchmarkRequest ?? { genre: scope.genre, providers: ["nyt", "gutendex"] },
  };
  return researchInputSchema.parse(input);
}

/** Recheck the same owned snapshot after asynchronous provider/model work before exposing a candidate. */
export async function runConfirmedResearch(request: ConfirmedResearchRequest, dependencies: ReadDependencies,
  repository: ConfirmedIntakeRepository = dbRepository,
  acquire?: (input: ResearchInput, signal: AbortSignal) => Promise<{ input: ResearchInput; providerOutcomes: ProviderEvidence[]; report: AcquisitionReport }>
): Promise<ReadResult<ResearchDossier> & { acquisition?: AcquisitionReport }> {
  const deadlineAt = Date.now() + limits.timeoutMs;
  const attempt = new AbortController();
  const timeout = setTimeout(() => attempt.abort("TIMEOUT"), limits.timeoutMs);
  const cancel = () => attempt.abort("CANCELED");
  dependencies.signal?.addEventListener("abort", cancel, { once: true });
  if (dependencies.signal?.aborted) cancel();
  const boundary = { deadlineAt, signal: attempt.signal };
  let result: ReadResult<ResearchDossier> | undefined;
  let stage: "initial" | "runtime" | "recheck" = "initial";
  let acquisition: AcquisitionReport | undefined;
  try {
    let input = await prepareConfirmedResearchInput(request, repository, boundary);
    // Request-supplied text is never an approval, including at the legacy entry point.
    input = { ...input, eligibleSources: [] };
    stage = "runtime";
    const acquired = acquire ? await boundedAcquisition(() => acquire(input, attempt.signal), attempt.signal) : undefined;
    if (acquired) { input = acquired.input; acquisition = acquired.report; }
    result = await runResearch(input, { ...dependencies,
      readBenchmarks: acquired ? async () => acquired.providerOutcomes : dependencies.readBenchmarks,
      signal: attempt.signal, beforeResearchModel: async () => {
      await prepareConfirmedResearchInput(request, repository, boundary);
      await dependencies.beforeResearchModel?.();
    } });
    if (attempt.signal.aborted) throw new Error(abortCode(attempt.signal));
    if (result.status === "canceled") return { ...result, acquisition };
    stage = "recheck";
    await prepareConfirmedResearchInput(request, repository, boundary);
    if (attempt.signal.aborted) throw new Error(abortCode(attempt.signal));
    return { ...result, acquisition };
  } catch (error) {
    const reasonCode = attempt.signal.aborted ? abortCode(attempt.signal) :
      error instanceof AppError ? error.status === 404 ? "PROJECT_UNAVAILABLE" : "STALE_CONFIRMED_INTAKE" :
      stage === "runtime" && error instanceof Error && error.message === "MODEL_VERSION_MISMATCH" ? "MODEL_VERSION_MISMATCH" :
      stage === "recheck" ? "CONFIRMATION_RECHECK_UNAVAILABLE" : "DEPENDENCY_UNAVAILABLE";
    const status = reasonCode === "CANCELED" ? "canceled" : reasonCode === "TIMEOUT" ? "partial" :
      reasonCode === "STALE_CONFIRMED_INTAKE" || reasonCode === "PROJECT_UNAVAILABLE" ? "blocked" : "failed";
    if (result?.status === "canceled" && reasonCode === "CANCELED") return { ...result, acquisition };
    const traceId = result?.traceId ?? randomUUID();
    try { dependencies.onTrace?.({ runId: request.authority.runId, taskId: request.authority.taskId,
      operationId: request.authority.operationId, agentId: "research", traceId, eventId: randomUUID(),
      at: new Date().toISOString(), event: status === "partial" || status === "blocked" ? "blocked" : status,
      attempt: result?.attempts ?? 0, code: reasonCode,
      versions: request.versions, stateVersion: request.authority.stateVersion }); } catch { /* telemetry cannot alter outcome */ }
    return { status, reasonCode, output: undefined, usage: result?.usage ?? { inputTokens: 0, outputTokens: 0 },
      attempts: result?.attempts ?? 0, traceId, acquisition };
  } finally {
    clearTimeout(timeout);
    dependencies.signal?.removeEventListener("abort", cancel);
  }
}
