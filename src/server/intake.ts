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

export async function updateProjectIntake(ownerId: string, projectId: string, request: IntakeRequest,
  dependencies: { repository?: IntakeRepository; model?: ReadModel; signal?: AbortSignal } = {}) {
  const repository = dependencies.repository ?? dbRepository;
  if (request.action === "save") {
    const project = await repository.mutate(ownerId, projectId, (brief, storyStarted) => {
      editable(storyStarted);
      const intake = currentIntake(brief);
      checkRevision(intake, request.expectedRevision);
      return wrap(brief, { version: 1, revision: intake.revision + 1, rawText: request.rawText, status: "draft", decisions: [] });
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
        return wrap(brief, { ...intake, revision: intake.revision + 1, decisions: request.decisions });
      }
      let scope;
      try { assertIntakeDecisionsReviewed(intake.analysis, request.decisions); scope = scopeFromIntake(intake.analysis, request.decisions); }
      catch { throw new AppError(400, "Review the selected details before confirmation. A genre is required."); }
      const values = Object.fromEntries(scope.dimensions.map(d => [d.field, d.value]));
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
  const reserved = await repository.mutate(ownerId, projectId, (brief, storyStarted) => {
    editable(storyStarted);
    const intake = currentIntake(brief);
    checkRevision(intake, request.expectedRevision);
    if (intake.status === "confirmed") throw new AppError(409, "The scope is already confirmed.");
    if (intake.status === "analyzing" && intake.startedAt && Date.now() - Date.parse(intake.startedAt) < 45_000)
      throw new AppError(409, "This idea is already being analyzed.");
    return wrap(brief, { version: 1, revision: intake.revision + 1, rawText: intake.rawText,
      status: "analyzing", decisions: [], operationId, startedAt: new Date().toISOString() });
  });
  const reservedIntake = currentIntake(reserved.brief);
  try {
    if (inspectText(reservedIntake.rawText, "creative", "rawText", "writer-intake").verdict !== "ACCEPT")
      throw Error("INTAKE_INPUT_REVIEW_REQUIRED");
    const model = dependencies.model ?? modelFromEnvironment();
    const analysis = await analyzeIntake(ownerId, reservedIntake.rawText, model, dependencies.signal);
    const project = await repository.mutate(ownerId, projectId, (brief, storyStarted) => {
      if (dependencies.signal?.aborted) throw new AppError(409, "Analysis was canceled. Your saved idea is preserved.");
      editable(storyStarted);
      const intake = currentIntake(brief);
      if (intake.revision !== reservedIntake.revision || intake.operationId !== operationId || intakeHash(intake.rawText) !== analysis.sourceHash)
        throw new AppError(409, "The story idea changed during analysis. Reload the latest version.");
      return wrap(brief, { version: 1, revision: intake.revision + 1, rawText: intake.rawText,
        status: "analyzed", analysis, decisions: [] });
    });
    return result(project);
  } catch (error) {
    await repository.mutate(ownerId, projectId, (brief) => {
      const intake = currentIntake(brief);
      if (intake.revision !== reservedIntake.revision || intake.operationId !== operationId) return brief;
      return wrap(brief, { version: 1, revision: intake.revision + 1, rawText: intake.rawText, status: "draft", decisions: [] });
    });
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
