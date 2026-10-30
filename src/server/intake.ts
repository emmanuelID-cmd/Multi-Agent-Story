import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db } from "./db";
import { bibles, projects, proposals } from "./db/schema";
import { AppError } from "./projects";
import { briefSchema, type Brief } from "../contracts";
import { assertIntakeDecisionsReviewed, intakeRecordSchema, resolveIntake, scopeFromIntake, type IntakeRecord, type IntakeRequest } from "../contracts/intake";
import { inspectText } from "../contracts/input-policy";
import { analyzeIntake, intakeHash } from "../agents/intake";
import { ModelHttpError, modelFromEnvironment, type ReadModel } from "../agents/read/model";
import type { IntakeCode, IntakeTrace } from "./intake-trace";
import { lookupLcVocabulary } from "./research/lc-vocabulary";
import type { LcLookup, LcKind } from "../contracts/vocabulary";
import { isLcFresh } from "../contracts/vocabulary";
import { storyReadModel } from "./story-budget";

type RecordWithBrief = { brief: Brief };
export type IntakeRepository = {
  mutate: (ownerId: string, projectId: string, change: (brief: Brief, storyStarted: boolean) => Brief) => Promise<RecordWithBrief>;
};

const dbRepository: IntakeRepository = {
  async mutate(ownerId, projectId, change) {
    return db.transaction(async tx => {
      const [project] = await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId))).for("update");
      if (!project) throw new AppError(404, "Project unavailable.");
      const [bible] = await tx.select({ id: bibles.id }).from(bibles).where(eq(bibles.projectId, projectId)).limit(1);
      const [proposal] = await tx.select({ id: proposals.id }).from(proposals).where(and(eq(proposals.projectId, projectId), like(proposals.kind, "bible_%"))).limit(1);
      const brief = change(project.brief, Boolean(bible || proposal));
      const [updated] = await tx.update(projects).set({ brief }).where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId))).returning();
      return updated;
    });
  },
};

function currentIntake(brief: Brief): IntakeRecord {
  const parsed = intakeRecordSchema.safeParse(brief.intake);
  if (!parsed.success) throw new AppError(409, "This project has no editable intake.");
  return parsed.data;
}

function checkRevision(intake: IntakeRecord, expectedRevision: number) {
  if (intake.revision !== expectedRevision) throw new AppError(409, "The story idea changed. Reload it before continuing.");
}

function editable(storyStarted: boolean) {
  if (storyStarted) throw new AppError(409, "The story plan has already started. Intake can no longer change.");
}

function wrap(brief: Brief, intake: IntakeRecord): Brief {
  return briefSchema.parse({ ...brief, intake });
}

function result(project: RecordWithBrief) { return { project, intake: currentIntake(project.brief) }; }

/** Ownership and revision are checked before the provider call and again before persistence. */
export async function lookupProjectIntake(ownerId: string, projectId: string, expectedRevision: number, kind: LcKind, words: string,
  dependencies: { repository?: IntakeRepository; lookup?: typeof lookupLcVocabulary } = {}) {
  const repository = dependencies.repository ?? dbRepository;
  const before = await repository.mutate(ownerId, projectId, (brief, storyStarted) => {
    editable(storyStarted);
    const intake = currentIntake(brief);
    checkRevision(intake, expectedRevision);
    if (intake.status !== "analyzed" || !intake.analysis) throw new AppError(409, "Analyze the saved idea before looking up terms.");
    return brief;
  });
  const prior = currentIntake(before.brief);
  const priorAnalysis = prior.analysis!;
  const lookup: LcLookup = await (dependencies.lookup ?? lookupLcVocabulary)(kind, words);
  const project = await repository.mutate(ownerId, projectId, (brief, storyStarted) => {
    editable(storyStarted);
    const intake = currentIntake(brief);
    checkRevision(intake, expectedRevision);
    if (intake.status !== "analyzed" || intake.analysis?.id !== priorAnalysis.id || intakeHash(intake.rawText) !== priorAnalysis.sourceHash)
      throw new AppError(409, "The story idea changed during lookup. Search again.");
    if (lookup.status === "unavailable")
      throw new AppError(503, "Library of Congress is temporarily unavailable. Your saved answers and choices are preserved. Try again later or use your answer.");
    const revision = intake.revision + 1;
    const snapshot = { revision, sourceHash: priorAnalysis.sourceHash, analysisId: priorAnalysis.id,
      kind, query: lookup.query, status: lookup.status, reasonCode: lookup.reasonCode,
      retrievedAt: lookup.retrievedAt, candidates: lookup.candidates };
    const lookups = { ...intake.lookups, [kind]: snapshot };
    const selection = { genreForm: intake.selection?.genreForm ?? null, subject: intake.selection?.subject ?? null, [kind]: null };
    for (const item of Object.values(lookups)) if (item) item.revision = revision;
    return wrap(brief, { ...intake, version: 2, revision, lookups, selection });
  });
  return result(project);
}

export async function updateProjectIntake(ownerId: string, projectId: string, request: IntakeRequest,
  dependencies: { repository?: IntakeRepository; model?: ReadModel; signal?: AbortSignal; trace?: IntakeTrace } = {}) {
  const repository = dependencies.repository ?? dbRepository;
  const trace = dependencies.trace;
  if (request.action === "save") {
    const project = await repository.mutate(ownerId, projectId, (brief, storyStarted) => {
      editable(storyStarted);
      const intake = currentIntake(brief);
      checkRevision(intake, request.expectedRevision);
      return wrap(brief, { version: 1, revision: intake.revision + 1, rawText: request.rawText, status: "draft", decisions: [] });
    });
    return result(project);
  }
  if (request.action === "reopenVocabulary") {
    const project = await repository.mutate(ownerId, projectId, (brief, storyStarted) => {
      editable(storyStarted);
      const intake = currentIntake(brief);
      checkRevision(intake, request.expectedRevision);
      if (intake.status !== "confirmed" || !intake.analysis || intakeHash(intake.rawText) !== intake.analysis.sourceHash)
        throw new AppError(409, "Confirmed intake unavailable for vocabulary review.");
      const revision = intake.revision + 1;
      const lookups = intake.lookups ? Object.fromEntries(Object.entries(intake.lookups).map(([kind, snapshot]) =>
        [kind, snapshot ? { ...snapshot, revision } : undefined])) as IntakeRecord["lookups"] : undefined;
      return wrap(brief, { ...intake, version: 2, revision, status: "analyzed",
        confirmed: undefined, lookups, selection: intake.selection });
    });
    return result(project);
  }
  if (request.action === "selectVocabulary") {
    const project = await repository.mutate(ownerId, projectId, (brief, storyStarted) => {
      editable(storyStarted);
      const intake = currentIntake(brief);
      checkRevision(intake, request.expectedRevision);
      if (intake.status !== "analyzed" || !intake.analysis)
        throw new AppError(409, "Analyze the saved idea before selecting a term.");
      const snapshot = intake.lookups?.[request.kind];
      if (request.uri && (!snapshot || snapshot.revision !== intake.revision || snapshot.sourceHash !== intakeHash(intake.rawText) ||
          snapshot.analysisId !== intake.analysis.id || snapshot.status !== "available" || !isLcFresh(snapshot.retrievedAt)))
        throw new AppError(409, "Search again before selecting a term.", { vocabulary: ["Search again and select a current Library of Congress term, or use your answer."] });
      const concept = request.uri ? snapshot?.candidates.find(item => item.uri === request.uri && item.kind === request.kind) : null;
      if (request.uri && !concept) throw new AppError(400, "Choose a term from the current search results.");
      const revision = intake.revision + 1;
      const lookups = intake.lookups ? { ...intake.lookups } : undefined;
      if (lookups) for (const item of Object.values(lookups)) if (item) item.revision = revision;
      return wrap(brief, { ...intake, version: 2, revision, lookups,
        selection: { genreForm: intake.selection?.genreForm ?? null, subject: intake.selection?.subject ?? null, [request.kind]: concept ?? null } });
    });
    return result(project);
  }
  if (request.action === "confirm" || request.action === "review") {
    const project = await repository.mutate(ownerId, projectId, (brief, storyStarted) => {
      editable(storyStarted);
      const intake = currentIntake(brief);
      checkRevision(intake, request.expectedRevision);
      if (intake.status !== "analyzed" || !intake.analysis || intake.analysis.id !== request.analysisId || intake.analysis.sourceHash !== intakeHash(intake.rawText))
        throw new AppError(409, "The analysis changed. Analyze the saved idea again.");
      if (request.action === "review") {
        try { resolveIntake(intake.analysis, request.decisions); }
        catch { throw new AppError(400, "Review the highlighted answers before saving review progress."); }
        const revision = intake.revision + 1;
        const lookups = intake.lookups ? Object.fromEntries(Object.entries(intake.lookups).map(([kind, snapshot]) =>
          [kind, snapshot ? { ...snapshot, revision } : undefined])) as IntakeRecord["lookups"] : undefined;
        return wrap(brief, { ...intake, revision: intake.revision + 1, decisions: request.decisions,
          lookups, selection: intake.selection });
      }
      let scope;
      try { assertIntakeDecisionsReviewed(intake.analysis, request.decisions, intake.selection); scope = scopeFromIntake(intake.analysis, request.decisions, intake.selection, intake.version === 2); }
      catch { throw new AppError(400, "Review the selected details before confirmation. A genre is required."); }
      const values = Object.fromEntries(scope.dimensions.map(d => [d.field, d.value]));
      if (intake.version === 2) {
        for (const kind of ["genreForm", "subject"] as const) {
          const selected = intake.selection?.[kind];
          const snapshot = intake.lookups?.[kind];
          if (selected && (!snapshot || snapshot.revision !== intake.revision || snapshot.analysisId !== intake.analysis.id ||
              snapshot.sourceHash !== intakeHash(intake.rawText) || !isLcFresh(snapshot.retrievedAt) || !isLcFresh(selected.retrievedAt) ||
              !snapshot.candidates.some(candidate => candidate.uri === selected.uri && candidate.label === selected.label)))
            throw new AppError(409, "Selected vocabulary changed. Search again before confirmation.", { vocabulary: ["Search again and select a current Library of Congress term, or use your answer."] });
        }
      }
      const next = { ...brief,
        premise: values.premise ?? brief.premise, genre: scope.genre,
        audience: values.audience ?? "", tone: values.tone ?? "", desiredEnding: values.ending ?? "",
        intake: { ...intake, revision: intake.revision + 1, status: "confirmed" as const,
          decisions: request.decisions, confirmed: { at: new Date().toISOString(), analysisId: intake.analysis.id, scope } },
      };
      const parsed = briefSchema.safeParse(next);
      if (!parsed.success) throw new AppError(400, "A confirmed detail exceeds the project brief limits. Shorten that detail and retry.");
      return parsed.data;
    });
    return result(project);
  }

  const operationId = randomUUID();
  trace?.record("reserved", "STARTED", { revision: request.expectedRevision, operationId });
  let reserved: RecordWithBrief;
  let reservationFailure: IntakeCode | undefined;
  try { reserved = await repository.mutate(ownerId, projectId, (brief, storyStarted) => {
    if (storyStarted) reservationFailure = "STORY_STARTED";
    editable(storyStarted);
    let intake: IntakeRecord;
    try { intake = currentIntake(brief); }
    catch (error) { reservationFailure = "INTAKE_UNAVAILABLE"; throw error; }
    if (intake.revision !== request.expectedRevision) reservationFailure = "REVISION_CONFLICT";
    checkRevision(intake, request.expectedRevision);
    if (intake.status === "confirmed") { reservationFailure = "SCOPE_CONFIRMED"; throw new AppError(409, "The scope is already confirmed."); }
    if (intake.status === "analyzing" && intake.startedAt && Date.now() - Date.parse(intake.startedAt) < 45_000)
      { reservationFailure = "ANALYSIS_IN_PROGRESS"; throw new AppError(409, "This idea is already being analyzed."); }
    return wrap(brief, { version: 2, revision: intake.revision + 1, rawText: intake.rawText,
      status: "analyzing", decisions: [], operationId, startedAt: new Date().toISOString() });
  }); } catch (error) {
    const code = reservationFailure ?? (error instanceof AppError ? error.status === 404 ? "PROJECT_UNAVAILABLE" : "RESERVATION_REJECTED" : "PERSIST_FAILED");
    trace?.record("reserved", code, { revision: request.expectedRevision, operationId });
    if (trace) trace.terminalFailure = code;
    throw error;
  }
  const reservedIntake = currentIntake(reserved.brief);
  trace?.record("reserved", "PASSED", { revision: reservedIntake.revision, operationId });
  try {
    if (inspectText(reservedIntake.rawText, "creative", "rawText", "writer-intake").verdict !== "ACCEPT") {
      trace?.record("input_read", "INPUT_REVIEW_REQUIRED", { revision: reservedIntake.revision, operationId });
      throw Error("INTAKE_INPUT_REVIEW_REQUIRED");
    }
    trace?.record("input_read", "PASSED", { revision: reservedIntake.revision, operationId });
    const configuredModel = dependencies.model ?? modelFromEnvironment();
    const model = dependencies.repository ? configuredModel : storyReadModel(configuredModel, ownerId, projectId, operationId);
    const analysis = await analyzeIntake(ownerId, reservedIntake.rawText, model, dependencies.signal, trace);
    trace?.record("persist", "STARTED", { revision: reservedIntake.revision, operationId });
    let project: RecordWithBrief;
    let persistFailure: IntakeCode | undefined;
    try { project = await repository.mutate(ownerId, projectId, (brief, storyStarted) => {
      if (dependencies.signal?.aborted) { persistFailure = "CANCELED"; trace?.record("persist", "CANCELED", { revision: reservedIntake.revision, operationId }); throw new AppError(409, "Analysis was canceled. Your saved idea is preserved."); }
      if (storyStarted) persistFailure = "STORY_STARTED";
      editable(storyStarted);
      let intake: IntakeRecord;
      try { intake = currentIntake(brief); }
      catch (error) { persistFailure = "INTAKE_UNAVAILABLE"; throw error; }
      if (intake.revision !== reservedIntake.revision || intake.operationId !== operationId || intakeHash(intake.rawText) !== analysis.sourceHash) {
        persistFailure = "STALE_INPUT";
        trace?.record("persist", "STALE_INPUT", { revision: intake.revision, operationId });
        throw new AppError(409, "The story idea changed during analysis. Reload the latest version.");
      }
      return wrap(brief, { version: 2, revision: intake.revision + 1, rawText: intake.rawText,
        status: "analyzed", analysis, decisions: [] });
    }); } catch (error) {
      if (persistFailure !== "CANCELED" && persistFailure !== "STALE_INPUT")
        trace?.record("persist", persistFailure ?? (error instanceof AppError && error.status === 404 ? "PROJECT_UNAVAILABLE" : "PERSIST_FAILED"), { revision: reservedIntake.revision, operationId });
      throw error;
    }
    trace?.record("persist", "PASSED", { revision: currentIntake(project.brief).revision, operationId });
    return result(project);
  } catch (error) {
    if (!trace?.latestFailure) {
      const code = error instanceof AppError ? "REVISION_CONFLICT" : error instanceof ModelHttpError ?
        error.status === 429 ? "MODEL_HTTP_RATE_LIMIT" : [401, 403].includes(error.status) ? "MODEL_HTTP_AUTH" : [400, 404].includes(error.status) ? "MODEL_HTTP_CONFIG" : "MODEL_HTTP_UNAVAILABLE" :
        error instanceof Error && error.message === "MODEL_CREDENTIAL_UNAVAILABLE" ? "MODEL_CREDENTIAL_UNAVAILABLE" :
        error instanceof Error && error.message === "INTAKE_CANCELED" ? "CANCELED" :
        error instanceof Error && error.message === "INTAKE_BUDGET_EXCEEDED" ? "BUDGET_EXCEEDED" :
        error instanceof Error && error.message === "INTAKE_OWNER_BUSY" ? "OWNER_BUSY" : "ANALYSIS_FAILED";
      if (error instanceof TypeError && error.message === "fetch failed") trace?.record("model_http", "MODEL_NETWORK_ERROR", { revision: reservedIntake.revision, operationId });
      else trace?.record(error instanceof AppError ? "persist" : "model_request", code, { revision: reservedIntake.revision, operationId });
    }
    if (trace) trace.terminalFailure = trace.latestFailure;
    try {
      await repository.mutate(ownerId, projectId, (brief) => {
        const intake = currentIntake(brief);
        if (intake.revision !== reservedIntake.revision || intake.operationId !== operationId) return brief;
        return wrap(brief, { version: 1, revision: intake.revision + 1, rawText: intake.rawText, status: "draft", decisions: [] });
      });
    } catch { trace?.record("persist", "PERSIST_FAILED", { revision: reservedIntake.revision, operationId }); }
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.message === "INTAKE_INPUT_REVIEW_REQUIRED") {
      const message = "Review role markers or directional formatting in your saved idea before analysis. Edit and save the text, then try again; the original is preserved.";
      throw new AppError(400, message, { rawText: [message] });
    }
    const preserved = " Your saved idea is preserved.";
    if (error instanceof ModelHttpError) {
      if ([401, 403].includes(error.status))
        throw new AppError(503, "Claude could not authorize analysis. The project maintainer needs to check the server API credentials and access." + preserved);
      if ([400, 404].includes(error.status))
        throw new AppError(503, "Claude rejected the analysis configuration. The project maintainer needs to check the model and response schema." + preserved);
      if (error.status === 429)
        throw new AppError(503, "Claude is limiting requests. Wait before trying analysis again." + preserved);
      throw new AppError(503, "Claude is temporarily unavailable. Try analysis again later." + preserved);
    }
    if (error instanceof Error && error.message === "MODEL_CREDENTIAL_UNAVAILABLE")
      throw new AppError(503, "Analysis has no server API credential. The project maintainer needs to configure it and restart the server." + preserved);
    if (error instanceof TypeError && error.message === "fetch failed") {
      const code = (error.cause as { code?: unknown } | undefined)?.code;
      const known = ["EACCES", "EPERM", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UND_ERR_CONNECT_TIMEOUT"];
      console.warn("Intake connection unavailable:", typeof code === "string" && known.includes(code) ? code : "NETWORK_ERROR");
      throw new AppError(503, "The server could not connect securely to Claude. The project maintainer needs to check its network and certificate setup." + preserved);
    }
    if (error instanceof Error && error.message === "INTAKE_CANCELED")
      throw new AppError(503, "Analysis timed out or was canceled. Try again when ready." + preserved);
    throw new AppError(503, "Analysis could not return a validated result. Try again when ready." + preserved);
  }
}
