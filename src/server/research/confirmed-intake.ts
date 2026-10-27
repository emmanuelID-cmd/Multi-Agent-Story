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

export type ConfirmedResearchRequest = {
  authority: ResearchAuthority; versions: ReadVersions;
  expectedRevision: number; expectedAnalysisId: string; expectedAnalysisHash: string; expectedSourceHash: string;
  criteriaVersion: number;
  eligibleSources: ResearchInput["eligibleSources"];
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
  let scope;
  try {
    assertIntakeDecisionsReviewed(intake.analysis, intake.decisions);
    scope = scopeFromIntake(intake.analysis, intake.decisions);
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
      analysis: intake.analysis, decisions: intake.decisions, scope },
    dimensions: scope.dimensions.map(d => ({ id: d.field, label: `Research confirmed ${fieldLabels.get(d.field)} only.`,
      claimType: d.field === "timePeriod" || d.field === "setting" ? "historical" as const : "craft" as const })),
    eligibleSources: request.eligibleSources,
    benchmarkRequest: request.benchmarkRequest ?? { genre: scope.genre, providers: ["nyt", "gutendex"] },
  };
  return researchInputSchema.parse(input);
}

/** Recheck the same owned snapshot after asynchronous provider/model work before exposing a candidate. */
export async function runConfirmedResearch(request: ConfirmedResearchRequest, dependencies: ReadDependencies,
  repository: ConfirmedIntakeRepository = dbRepository): Promise<ReadResult<ResearchDossier>> {
  const deadlineAt = Date.now() + limits.timeoutMs;
  const attempt = new AbortController();
  const timeout = setTimeout(() => attempt.abort("TIMEOUT"), limits.timeoutMs);
  const cancel = () => attempt.abort("CANCELED");
  dependencies.signal?.addEventListener("abort", cancel, { once: true });
  if (dependencies.signal?.aborted) cancel();
  const boundary = { deadlineAt, signal: attempt.signal };
  let result: ReadResult<ResearchDossier> | undefined;
  let stage: "initial" | "runtime" | "recheck" = "initial";
  try {
    const input = await prepareConfirmedResearchInput(request, repository, boundary);
    stage = "runtime";
    result = await runResearch(input, { ...dependencies, signal: attempt.signal, beforeResearchModel: async () => {
      await prepareConfirmedResearchInput(request, repository, boundary);
      await dependencies.beforeResearchModel?.();
    } });
    if (attempt.signal.aborted) throw new Error(abortCode(attempt.signal));
    if (result.status === "canceled") return result;
    stage = "recheck";
    await prepareConfirmedResearchInput(request, repository, boundary);
    if (attempt.signal.aborted) throw new Error(abortCode(attempt.signal));
    return result;
  } catch (error) {
    const reasonCode = attempt.signal.aborted ? abortCode(attempt.signal) :
      error instanceof AppError ? error.status === 404 ? "PROJECT_UNAVAILABLE" : "STALE_CONFIRMED_INTAKE" :
      stage === "runtime" && error instanceof Error && error.message === "MODEL_VERSION_MISMATCH" ? "MODEL_VERSION_MISMATCH" :
      stage === "recheck" ? "CONFIRMATION_RECHECK_UNAVAILABLE" : "DEPENDENCY_UNAVAILABLE";
    const status = reasonCode === "CANCELED" ? "canceled" : reasonCode === "TIMEOUT" ? "partial" :
      reasonCode === "STALE_CONFIRMED_INTAKE" || reasonCode === "PROJECT_UNAVAILABLE" ? "blocked" : "failed";
    if (result?.status === "canceled" && reasonCode === "CANCELED") return result;
    try { dependencies.onTrace?.({ runId: request.authority.runId, taskId: request.authority.taskId,
      operationId: request.authority.operationId, agentId: "research", eventId: randomUUID(),
      at: new Date().toISOString(), event: status === "partial" || status === "blocked" ? "blocked" : status,
      attempt: result?.attempts ?? 0, code: reasonCode,
      versions: request.versions, stateVersion: request.authority.stateVersion }); } catch { /* telemetry cannot alter outcome */ }
    return { status, reasonCode, output: undefined, usage: result?.usage ?? { inputTokens: 0, outputTokens: 0 },
      attempts: result?.attempts ?? 0, traceId: result?.traceId ?? randomUUID() };
  } finally {
    clearTimeout(timeout);
    dependencies.signal?.removeEventListener("abort", cancel);
  }
}
