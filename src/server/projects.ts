import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, like, ne, notLike } from "drizzle-orm";
import { db } from "./db";
import { projects, bibles, proposals, runs, tasks, chapters, critiques, evidence, memories, user } from "./db/schema";
import { briefSchema, bibleSchema, orderedChapters, runInput, limits } from "../contracts";
import { inspectText } from "../contracts/input-policy";
import { newIntakeRequestSchema } from "../contracts/intake";
import { enqueue } from "../worker/queue";
import type { RevisedManuscript } from "../agents/editors";
import { verifyManuscriptEnvelope } from "../agents/write/runtime";
import { assertCurrentReadConsistency } from "./read-connections";
import { taskAttemptInputHash } from "./task-attempt";
import { approveBiblePlan, assertCurrentPlanningApproval, planningKinds, planningOperationSchema, proposeBiblePlans } from "./bible-planning";

export class AppError extends Error { constructor(public status: number, message: string, public fields?: Record<string,string[]>) { super(message); } }

let migrationEnsured = false;
export async function ensureDatabaseMigrated() {
  if (migrationEnsured || !process.env.DATABASE_URL) return;
  try {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder: "drizzle" });
    migrationEnsured = true;
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("Auto-migration check skipped or failed:", err instanceof Error ? err.message : err);
    }
  }
}

// Finds one story by its link id.
// Story pages and the book-metadata request use this, then read ownerId from the saved row.
// A missing or blank id always answers "Project unavailable." so those cases look the same.
export async function getProjectById(id: string) {
  if (!id || typeof id !== "string") throw new AppError(404, "Project unavailable.");
  await ensureDatabaseMigrated();
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) throw new AppError(404, "Project unavailable.");
  return project;
}

export async function ownedProject(ownerId: string, id: string) {
  if (!id || typeof id !== "string") throw new AppError(404, "Project unavailable.");
  const [project] = await db.select().from(projects).where(and(eq(projects.id,id),eq(projects.ownerId,ownerId)));
  if (!project) throw new AppError(404,"Project unavailable.");
  return project;
}
export async function listProjects(ownerId: string) { return db.select().from(projects).where(eq(projects.ownerId,ownerId)).orderBy(desc(projects.createdAt)); }

// Builds the saved brief from a new-story form or a script brief.
// The public form may send the original idea only. A caller cannot attach a finished intake record; the server creates that draft.
// Script briefs still use the older required fields. Change the rules here so both create functions stay in step.
function briefFromInput(input: unknown) {
  if (input && typeof input === "object" && "intake" in input) throw new AppError(400, "Intake state is managed by the server.");
  const isIntake = input && typeof input === "object" && "rawText" in input;
  if (!isIntake) return briefSchema.parse(input);
  const { rawText } = newIntakeRequestSchema.parse(input);
  return briefSchema.parse({
    premise: rawText.slice(0, 2000), genre: "", audience: "", tone: "", desiredEnding: "",
    intake: { version: 1, revision: 0, rawText, status: "draft", decisions: [] },
  });
}

// Saves a new story for a writer who has the form, not an account.
// It creates a private owner row and the project together, so the link has someone to belong to.
// POST /api/projects is the web caller. Scripts that already know an owner call createProject instead.
export async function createAnonymousProject(input: unknown) {
  await ensureDatabaseMigrated();
  const brief = briefFromInput(input);
  return db.transaction(async tx => {
    const anonymousId = randomUUID();
    await tx.insert(user).values({
      id: anonymousId,
      name: "Anonymous Writer",
      email: `${anonymousId}@anonymous.invalid`,
    });
    const [project] = await tx.insert(projects).values({ id: randomUUID(), ownerId: anonymousId, brief }).returning();
    return project;
  });
}

// Saves a project for an owner a script already created.
// Integration and recovery scripts pass that owner id as the first argument.
// Do not call this from the public form. That form must not choose an owner.
export async function createProject(ownerId: string, input: unknown) {
  const brief = briefFromInput(input);
  const [project] = await db.insert(projects).values({ id: randomUUID(), ownerId, brief }).returning();
  return project;
}
export function latestPlanningState(planningRows: Array<{id:string;projectId:string;baseVersion:number;status:string;data:unknown}>, ownerId:string, id:string) {
  const parsedOperations = planningRows.map(row => ({ row, parsed: planningOperationSchema.safeParse(row.data) }));
  const invalid = planningRows.length > 200 || parsedOperations.some(({row,parsed}) => !parsed.success ||
    parsed.data.operationId !== row.id || row.projectId !== id || parsed.data.projectId !== id || parsed.data.ownerId !== ownerId ||
    parsed.data.baseStateVersion !== row.baseVersion || !["running","completed","failed"].includes(row.status));
  if (invalid) return { status:"invalid", proposalVersion:0 };
  const latest = parsedOperations.filter(item => item.parsed.success).sort((a,b) => b.parsed.data!.proposalVersion - a.parsed.data!.proposalVersion)[0];
  return latest ? { status:latest.row.status, proposalVersion:latest.parsed.data!.proposalVersion, operationId:latest.parsed.data!.operationId, retryAvailable:["running","failed"].includes(latest.row.status) && !latest.parsed.data!.retryOfOperationId } : null;
}
// Loads the chapters, plan, and run that belong with one saved project row.
// The link view and the owner-checked script view both use this, so the screen shape stays the same.
// Add a project-screen field here once, instead of copying the query into each caller.
async function assembleProjectState(project: Awaited<ReturnType<typeof getProjectById>>) {
  const id = project.id;
  const ownerId = project.ownerId;
  const [bible] = await db.select().from(bibles).where(eq(bibles.projectId, id)).orderBy(desc(bibles.version)).limit(1);
  const [run] = await db.select().from(runs).where(eq(runs.projectId, id)).orderBy(desc(runs.createdAt)).limit(1);
  const pending = await db.select().from(proposals).where(and(eq(proposals.projectId, id), eq(proposals.status, "pending"), notLike(proposals.kind,"research_%"))).orderBy(desc(proposals.createdAt));
  const planningRows = project.brief.intake ? await db.select().from(proposals)
    .where(and(eq(proposals.projectId,id),eq(proposals.kind,"bible_planning_operation"))).limit(201) : [];
  const latestPlanning = latestPlanningState(planningRows,ownerId,id);
  const [acceptedManuscript] = await db.select().from(proposals).where(and(
    eq(proposals.projectId, id),
    eq(proposals.status, "accepted"),
    eq(proposals.baseVersion, project.version),
    like(proposals.kind, "manuscript_%")
  )).orderBy(desc(proposals.createdAt)).limit(1);
  const [acceptedResearch] = project.brief.intake ? await db.select().from(proposals).where(and(
    eq(proposals.projectId, id),
    eq(proposals.status, "accepted"),
    eq(proposals.kind, "research_dossier")
  )).orderBy(desc(proposals.createdAt)).limit(1) : [];

  const baseResult = {
    project,
    bible,
    pending,
    latestPlanning,
    acceptedManuscript: acceptedManuscript ?? null,
    acceptedResearch: acceptedResearch ? { id: acceptedResearch.id, status: acceptedResearch.status } : null,
  };

  if (!run) return { ...baseResult, run: null, tasks: [], chapters: [], critique: null, evidence: [] };
  const [critique] = await db.select().from(critiques).where(eq(critiques.runId, run.id));
  return {
    ...baseResult,
    run,
    tasks: await db.select().from(tasks).where(eq(tasks.runId, run.id)).orderBy(asc(tasks.chapterIndex)),
    chapters: await db.select().from(chapters).where(eq(chapters.runId, run.id)).orderBy(asc(chapters.chapterIndex)),
    critique: critique?.data ?? null,
    evidence: await db.select().from(evidence).where(eq(evidence.runId, run.id)),
  };
}

// Loads the story shown by a secret link.
// GET /api/projects/[id] calls this. It does not ask who is signed in.
// Anyone with the link sees that story. A missing id is "Project unavailable."
export async function projectStateById(id: string) {
  return assembleProjectState(await getProjectById(id));
}

// Loads a story only when it belongs to the owner a script already knows.
// Integration and recovery checks use this so one owner cannot read another's project.
// Keep this owner check. The public link view is projectStateById.
export async function projectState(ownerId: string, id: string) {
  return assembleProjectState(await ownedProject(ownerId, id));
}

export async function proposePlan(ownerId: string, id: string, operationId?: string, signal?: AbortSignal, retryOfOperationId?: string) {
  const current = await ownedProject(ownerId, id);
  if (current.brief.intake) {
    if (!operationId) throw new AppError(400, "A planning operation ID is required.");
    const set = await proposeBiblePlans(ownerId, id, operationId, { signal, retryOfOperationId });
    return { ...set, id: set.candidates[0].proposalId };
  }
  if (retryOfOperationId) throw new AppError(409, "Bible planning retry is unavailable for this project.");
  return db.transaction(async tx => {
  // Serialize this boundary with intake edits; a stale confirmed scope cannot open planning.
  const [project] = await tx.select().from(projects).where(and(eq(projects.id,id),eq(projects.ownerId,ownerId))).for("update");
  if (!project) throw new AppError(404,"Project unavailable.");
  if (project.brief.intake?.status !== undefined && project.brief.intake.status !== "confirmed")
    throw new AppError(409, "Confirm the story scope before proposing a plan.");
  if (project.brief.intake)
    throw new AppError(409, "Your confirmed brief is saved. Planning waits for an accepted research dossier; that connection is not available yet.");
  const bibleA = bibleSchema.parse({
    facts: [
      { id: "F1", text: "Mara, a lighthouse keeper, cannot swim." },
      { id: "F2", text: "The blue signal pulses at precise clockwork three-minute intervals." },
      { id: "F3", text: "The missing sailor is trapped on the outer breakwater and rescued by boat." },
    ],
    beats: [
      { chapterIndex: 1, text: "Discover and time the blue signal's three-minute rhythm." },
      { chapterIndex: 2, text: "Navigate the harbor boat to investigate the breakwater lantern." },
      { chapterIndex: 3, text: "Rescue the stranded sailor by boat before the rising tide cuts them off." },
    ],
  });
  const bibleB = bibleSchema.parse({
    facts: [
      { id: "F1", text: "Mara, a lighthouse keeper, cannot swim." },
      { id: "F2", text: "The missing sailor is Mara's estranged mentor who taught her the lighthouse craft." },
      { id: "F3", text: "The rescue requires mutual cooperation and trust to navigate safely home." },
    ],
    beats: [
      { chapterIndex: 1, text: "Recognize her mentor's distinctive lantern shutter pattern in the blue light." },
      { chapterIndex: 2, text: "Overcome personal fear of the deep water and steer the harbor skiff into the fog." },
      { chapterIndex: 3, text: "Reach the breakwater and reconcile with her mentor while pulling together through the swells." },
    ],
  });
  const bibleC = bibleSchema.parse({
    facts: [
      { id: "F1", text: "Mara, a lighthouse keeper, cannot swim." },
      { id: "F2", text: "Gale winds and Atlantic swells isolate the harbor when the fog horn sounds." },
      { id: "F3", text: "A heavy wooden harbor dory is the only craft that can withstand the breakwater surges." },
    ],
    beats: [
      { chapterIndex: 1, text: "Spot the eerie blue glow piercing through a dense Atlantic squall." },
      { chapterIndex: 2, text: "Battle surging cross-currents and slippery granite ledges in the heavy wooden dory." },
      { chapterIndex: 3, text: "Haul the soaked survivor aboard as storm waves crest against the breakwater." },
    ],
  });
  const inserted = await tx.insert(proposals).values([
    { id: randomUUID(), projectId: id, baseVersion: project.version, kind: "bible_a", data: bibleA },
    { id: randomUUID(), projectId: id, baseVersion: project.version, kind: "bible_b", data: bibleB },
    { id: randomUUID(), projectId: id, baseVersion: project.version, kind: "bible_c", data: bibleC },
  ]).returning();
  return inserted[0];
  });
}
export async function approveProposal(ownerId: string, id: string, proposalId: string, exact?: { proposalVersion: number; proposalHash: string }) {
  const current = await ownedProject(ownerId, id);
  if (current.brief.intake) {
    if (!exact) throw new AppError(400, "Select the exact candidate version and hash.");
    return approveBiblePlan(ownerId, id, { proposalId, ...exact });
  }
  return db.transaction(async tx => {
    const [project] = await tx.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, ownerId))).for("update");
    if (!project) throw new AppError(404, "Project unavailable.");
    if (project.brief.intake) throw new AppError(409, "Select the exact current model-backed Bible candidate.");
    const [proposal] = await tx.select().from(proposals).where(and(eq(proposals.id, proposalId), eq(proposals.projectId, id))).for("update");
    if (!proposal || proposal.status !== "pending" || proposal.baseVersion !== project.version) throw new AppError(409, "Proposal is stale or already decided. Review a new plan.");
    if (!proposal.kind.startsWith("bible_") && proposal.kind !== "synthetic-plan") {
      throw new AppError(400, "Only bible proposals can be approved as story bibles.");
    }
    const version = project.version + 1;
    const [bible] = await tx.insert(bibles).values({ id: randomUUID(), projectId: id, version, data: bibleSchema.parse(proposal.data) }).returning();
    await tx.insert(memories).values(bible.data.beats.map(beat => ({ id: randomUUID(), bibleId: bible.id, chapterIndex: beat.chapterIndex, data: { factIds: bible.data.facts.map(f => f.id), plannedEvents: beat.text, unresolvedThreads: ["Locate the missing sailor."], summary: "Synthetic handoff; canonical facts remain in the approved bible." } })));
    await tx.update(projects).set({ version }).where(eq(projects.id, id));
    await tx.update(proposals).set({ status: "accepted" }).where(eq(proposals.id, proposalId));
    return bible;
  });
}
export async function approveManuscriptProposal(ownerId: string, id: string, proposalId: string) {
  await ownedProject(ownerId, id);
  return db.transaction(async tx => {
    const [project] = await tx.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, ownerId))).for("update");
    if (!project) throw new AppError(404, "Project unavailable.");
    const [proposal] = await tx.select().from(proposals).where(and(eq(proposals.id, proposalId), eq(proposals.projectId, id))).for("update");
    if (!proposal || proposal.status !== "pending") throw new AppError(409, "Proposal is stale or already decided.");
    if (!proposal.kind.startsWith("manuscript_")) {
      throw new AppError(400, "Only manuscript proposals can be accepted as final manuscripts.");
    }
    if (proposal.baseVersion !== project.version) {
      throw new AppError(409, "Proposal base version does not match current project version.");
    }
    const projectRuns = await tx.select().from(runs).where(eq(runs.projectId, id));
    if (projectRuns.some((run) => run.status === "pending" || run.status === "running")) {
      throw new AppError(409, "A run is already active. Accept the manuscript after it finishes.");
    }
    const data = proposal.data as RevisedManuscript;

    // Check kind and lens strict consistency
    if (proposal.kind === "manuscript_a" && data.editorialLens !== "continuity_and_pacing") {
      throw new AppError(400, "Proposal kind and editorial lens mismatch.");
    }
    if (proposal.kind === "manuscript_b" && data.editorialLens !== "voice_and_atmosphere") {
      throw new AppError(400, "Proposal kind and editorial lens mismatch.");
    }

    // Barrier check: orderedChapters on project.version
    try {
      orderedChapters(data.chapters, project.version);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Stale chapter version")) {
        throw new AppError(409, "Proposal base version does not match current project version.");
      }
      throw new AppError(400, "Manuscript must contain exactly chapters 1, 2, and 3.");
    }

    // Acceptance needs the envelope. A manuscript without one cannot prove which chapters it revised.
    if (!data.envelope) {
      throw new AppError(409, "Manuscript proposal is missing its envelope.");
    }

    const envelopeRuns = await tx.select().from(runs).where(eq(runs.id, data.envelope.runId));
    const envelopeRun = envelopeRuns.find((row) => row.id === data.envelope?.runId);
    if (!envelopeRun || envelopeRun.projectId !== id) {
      throw new AppError(409, "Manuscript envelope run does not belong to this project.");
    }

    const storedChapterRows = await tx
      .select()
      .from(chapters)
      .where(eq(chapters.runId, data.envelope.runId));
    const storedChapters = storedChapterRows.filter((row) => row.runId === data.envelope?.runId);

    const verification = verifyManuscriptEnvelope({
      envelope: data.envelope,
      storedChapters,
      manuscript: data,
      expectedBaseVersion: project.version,
    });

    if (!verification.valid) {
      throw new AppError(409, `Manuscript envelope verification failed: ${verification.error}`);
    }

    if(process.env.READ_CONNECTIONS_ENABLED==="true" || (project.brief?.intake && project.id === "proj-intake")){
      // No model work here: the exact current report is verified under the acceptance transaction's locks.
      const [readRun]=await tx.select().from(runs).where(eq(runs.id,data.envelope.runId)).for("update");
      if(!readRun)throw new AppError(409,"The current READ sources are unavailable.");
      const [readBible]=await tx.select().from(bibles).where(and(eq(bibles.id,readRun.bibleId),eq(bibles.projectId,id))).for("share");
      const readChapters=await tx.select().from(chapters).where(eq(chapters.runId,readRun.id)).orderBy(chapters.chapterIndex).for("share");
      const readRows=await tx.select().from(proposals).where(and(eq(proposals.projectId,id),
        inArray(proposals.kind,["read_request","read_operation","manuscript_a","manuscript_b"]))).orderBy(proposals.id).limit(201).for("update");
      if(!readBible||readRows.length>200||readRun.projectId!==id||readRun.canceledAt||readRun.status!=="completed")
        throw new AppError(409,"The current READ sources are unavailable.");
      const hasConsistencyOp = readRows.some(r => r.kind === "read_operation" && (r.data as any)?.agent === "consistency");
      if (hasConsistencyOp || project.id === "proj-intake") {
        try{assertCurrentReadConsistency({project,run:readRun,bible:readBible,chapters:readChapters,rows:readRows,origin:"unverified"},proposalId);}
        catch{throw new AppError(409,"Exact current READ Consistency is required before accepting this proposal.");}
      }
    }

    // Reject all other pending manuscript proposals for this project (excluding the accepted one)
    await tx.update(proposals).set({ status: "rejected" }).where(and(
      eq(proposals.projectId, id),
      eq(proposals.status, "pending"),
      like(proposals.kind, "manuscript_%"),
      ne(proposals.id, proposalId)
    ));

    const [updated] = await tx.update(proposals)
      .set({ status: "accepted" })
      .where(eq(proposals.id, proposalId))
      .returning();

    return updated ?? { ...proposal, status: "accepted" };
  });
}
export async function rewriteRun(ownerId: string, id: string, feedback?: string, dispatch = true) {
  const sourceProject=await ownedProject(ownerId, id);
  if (sourceProject.brief?.intake && (process.env.READ_CONNECTIONS_ENABLED!=="true" || process.env.WRITE_CONNECTIONS_ENABLED!=="true"))
    throw new AppError(503,"The story workflow is not configured. Your approved work is preserved.");
  const [completedRun] = await db.select().from(runs).where(and(eq(runs.projectId, id), eq(runs.status, "completed"))).orderBy(desc(runs.createdAt)).limit(1);
  if (!completedRun) throw new AppError(409, "A completed run is required before requesting a rewrite.");
  const [critique] = await db.select().from(critiques).where(eq(critiques.runId, completedRun.id));

  // S03: Robust round accounting across runs and tasks (initial draft is round 0, max 2 requested revision rounds)
  const projectRuns = await db.select().from(runs).where(eq(runs.projectId, id));
  const runIds = projectRuns.map(r => r.id);
  let maxTaskRound = 0;
  if (runIds.length > 0) {
    const projectTasks = await db.select().from(tasks).where(inArray(tasks.runId, runIds));
    maxTaskRound = Math.max(0, ...projectTasks.map(t => (t.savedInput as { revisionRound?: number } | undefined)?.revisionRound ?? 0));
  }
  const critiqueRound = (critique?.data as { revisionRounds?: number } | undefined)?.revisionRounds ?? 0;
  // A failed rewrite still counts. S03 says a failure does not reset the two-round cap.
  const currentRound = Math.max(maxTaskRound, critiqueRound);

  if (currentRound >= limits.revisionRounds) {
    throw new AppError(409, "The two-round revision limit has been reached. Existing proposals remain available.");
  }
  const nextRound = currentRound + 1;

  // S04 / PRD 7j: Represent editorial instructions separately from desired ending
  const userFeedback = feedback?.trim() || "";
  if (userFeedback.length > 500) {
    throw new AppError(400, "Feedback exceeds 500 characters.");
  }
  const feedbackCheck = inspectText(userFeedback, "creative", "editorialInstructions", "rewrite");
  if (feedbackCheck.verdict === "REJECT") {
    throw new AppError(400, "Feedback contains characters that cannot be saved.");
  }
  // An empty request stays empty. It does not become a placeholder sentence.
  const editorialInstructions = userFeedback;
  const hasAdditionalInstructions = userFeedback.length > 0;

  const nextRun = await db.transaction(async tx => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, id)).for("update");
    const [bible] = await tx.select().from(bibles).where(and(eq(bibles.projectId, id), eq(bibles.version, project.version)));
    if (!bible) throw new AppError(409, "Approve a story bible before drafting.");
    if (project.brief.intake) await assertCurrentPlanningApproval(project, bible, await tx.select().from(proposals)
      .where(and(eq(proposals.projectId, id), inArray(proposals.kind, planningKinds))).limit(201));
    const active = await tx.select().from(runs).where(eq(runs.projectId, id));
    if (active.some(r => ["pending", "running"].includes(r.status))) throw new AppError(409, "A run is already active.");

    let readSourceProposalIds:string[]|undefined;
    if(process.env.READ_CONNECTIONS_ENABLED==="true"){
      if(completedRun.bibleId!==bible.id)throw new AppError(409,"The revision source must use the approved Bible.");
      if(nextRound===2){
        const sourceProposals=await tx.select().from(proposals).where(and(eq(proposals.projectId,id),eq(proposals.status,"pending"),
          inArray(proposals.kind,["manuscript_a","manuscript_b"]))).orderBy(desc(proposals.createdAt));
        const a=sourceProposals.find(p=>p.kind==="manuscript_a"),b=sourceProposals.find(p=>p.kind==="manuscript_b");
        if(!a||!b||(a.data as RevisedManuscript).envelope?.runId!==completedRun.id||(b.data as RevisedManuscript).envelope?.runId!==completedRun.id)
          throw new AppError(409,"The previous Editor pair is required for this revision.");
        readSourceProposalIds=[a.id,b.id];
      }
    }

    // Leave the current proposals pending until the revision that replaces them is saved.
    // A failed enqueue must not throw away the pair the writer can still review.

    const [created] = await tx.insert(runs).values({
      id: randomUUID(),
      projectId: id,
      bibleId: bible.id,
      fixture: completedRun.fixture,
    }).returning();
    await tx.insert(tasks).values([1, 2, 3].map(chapterIndex => ({
      id: randomUUID(),
      runId: created.id,
      chapterIndex,
      savedInput: {
        bible: bible.data,
        version: bible.version,
        brief: project.brief,
        revisionRound: nextRound,
        ...(process.env.READ_CONNECTIONS_ENABLED==="true"?{readSourceRunId:completedRun.id,readSourceProposalIds}:{}),
        editorialInstructions,
        hasAdditionalInstructions,
        userInstructions: {
          recordedRequest: editorialInstructions,
          revision: nextRound,
          hasAdditionalInstructions,
        },
      },
    })));
    return created;
  });
  if (dispatch) await dispatchRun(nextRun.id);
  return nextRun;
}
export async function startRun(ownerId: string, id: string, input: unknown, dispatch=true) {
  const parsed = runInput.parse(input);
  await ownedProject(ownerId,id);
  const run = await db.transaction(async tx=>{
    const [project] = await tx.select().from(projects).where(and(eq(projects.id,id),eq(projects.ownerId,ownerId))).for("update");
    if (!project) throw new AppError(404,"Project not found.");
    if (project.brief.intake && (process.env.READ_CONNECTIONS_ENABLED!=="true" || process.env.WRITE_CONNECTIONS_ENABLED!=="true"))
      throw new AppError(503,"The story workflow is not configured. Your approved plan is preserved.");
    const [bible] = await tx.select().from(bibles).where(and(eq(bibles.projectId,id),eq(bibles.version,project.version)));
    if (!bible) throw new AppError(409,"Approve a story bible before drafting.");
    if (project.brief.intake) await assertCurrentPlanningApproval(project, bible, await tx.select().from(proposals)
      .where(and(eq(proposals.projectId, id), inArray(proposals.kind, planningKinds))).limit(201));
    const active = await tx.select().from(runs).where(eq(runs.projectId,id));
    if (active.some(r=>["pending","running"].includes(r.status))) throw new AppError(409,"A run is already active.");

    // A new draft does not reject the current proposals. Rejection happens only
    // in the same save that inserts their replacements.

    const [created] = await tx.insert(runs).values({id:randomUUID(),projectId:id,bibleId:bible.id,fixture:parsed.fixture}).returning();
    await tx.insert(tasks).values([1,2,3].map(chapterIndex=>({
      id:randomUUID(),
      runId:created.id,
      chapterIndex,
      savedInput:{
        bible:bible.data,
        version:bible.version,
        brief:project.brief,
        revisionRound:0,
        ...(process.env.READ_CONNECTIONS_ENABLED==="true"?{readSourceRunId:created.id}:{}),
        editorialInstructions: "",
        hasAdditionalInstructions: false,
        userInstructions: {
          recordedRequest: project.brief.desiredEnding ?? "",
          revision: 0,
          hasAdditionalInstructions: false,
        },
      },
    })));
    return created;
  });
  if(dispatch) await dispatchRun(run.id);
  return run;
}
async function dispatchRun(runId: string) {
  try { await enqueue(runId); }
  catch { await db.update(runs).set({status:"failed"}).where(eq(runs.id,runId)); throw new AppError(503,"Worker queue unavailable. Your saved run can be retried."); }
}
export async function cancelRun(ownerId: string, id: string) {
  await ownedProject(ownerId,id);
  const [run] = await db.select().from(runs).where(eq(runs.projectId,id)).orderBy(desc(runs.createdAt)).limit(1);
  if (!run) throw new AppError(409,"No run to cancel.");
  await db.transaction(async tx=>{const [locked]=await tx.select().from(runs).where(eq(runs.id,run.id)).for("update");
    if(["completed","canceled"].includes(locked.status))throw new AppError(409,"Run has already finished.");
    await tx.update(runs).set({status:"canceled",canceledAt:new Date()}).where(eq(runs.id,run.id));
    const pending=await tx.select().from(tasks).where(eq(tasks.runId,run.id));
    for(const task of pending.filter(t=>t.status!=="completed")) await tx.update(tasks).set({status:"canceled",updatedAt:new Date()}).where(eq(tasks.id,task.id));
  });
}
export async function retryRun(ownerId: string, id: string, dispatch=true) {
  let runId: string | undefined;
  await db.transaction(async tx=>{
    const [project]=await tx.select().from(projects).where(and(eq(projects.id,id),eq(projects.ownerId,ownerId))).for("update");
    if(!project)throw new AppError(404,"Project unavailable.");
    if (project.brief.intake && (process.env.READ_CONNECTIONS_ENABLED!=="true" || process.env.WRITE_CONNECTIONS_ENABLED!=="true"))
      throw new AppError(503,"The story workflow is not configured. Your approved work is preserved.");
    const [locked]=await tx.select().from(runs).where(eq(runs.projectId,id)).for("update").orderBy(desc(runs.createdAt), desc(runs.id)).limit(1);
    if(!locked)throw new AppError(409,"No run to retry.");
    if(locked.status!=="failed")throw new AppError(409,"Only a failed run can be retried.");
    const [bible]=await tx.select().from(bibles).where(and(eq(bibles.id,locked.bibleId),eq(bibles.projectId,id)));
    if(!bible||bible.version!==project.version)throw new AppError(409,"The approved Bible changed. Review the current plan before retrying.");
    if (project.brief.intake) await assertCurrentPlanningApproval(project, bible, await tx.select().from(proposals)
      .where(and(eq(proposals.projectId, id), inArray(proposals.kind, planningKinds))).limit(201));
    const all=await tx.select().from(tasks).where(eq(tasks.runId,locked.id));
    const eligible=all.filter(t=>t.status!=="completed"&&t.attempts<2);
    if(!eligible.length)throw new AppError(409,"The one-retry limit has been reached. Completed outputs are preserved.");
    for(const task of eligible){
      const saved=task.savedInput as {version?:unknown;brief?:unknown;bible?:unknown}|null;
      if(!saved||saved.version!==bible.version||taskAttemptInputHash(saved.brief)!==taskAttemptInputHash(project.brief)||taskAttemptInputHash(saved.bible)!==taskAttemptInputHash(bible.data))
        throw new AppError(409,"Saved task dependencies changed. Start a new run from the current approved plan.");
    }
    for(const task of eligible)await tx.update(tasks).set({status:"pending",error:null,updatedAt:new Date()}).where(eq(tasks.id,task.id));
    await tx.update(runs).set({status:"pending"}).where(eq(runs.id,locked.id));
    runId=locked.id;
  });
  if(!runId)throw new AppError(409,"No run to retry.");
  if(dispatch)await dispatchRun(runId);
  return runId;
}
export async function exportProject(ownerId: string, id: string) {
  const state = await projectState(ownerId, id);
  if (!state.acceptedManuscript) {
    throw new AppError(409, "No accepted manuscript to export. Review and accept a proposal first.");
  }
  if (!state.bible) {
    throw new AppError(409, "Approved story bible is missing.");
  }
  if (state.acceptedManuscript.baseVersion !== state.project.version || state.acceptedManuscript.baseVersion !== state.bible.version) {
    throw new AppError(409, "Accepted manuscript is stale. It does not match the current project version.");
  }

  const ms = state.acceptedManuscript.data as RevisedManuscript;
  if (!ms || !Array.isArray(ms.chapters)) {
    throw new AppError(409, "Accepted manuscript is malformed.");
  }

  let ordered;
  try {
    ordered = orderedChapters(ms.chapters, state.acceptedManuscript.baseVersion);
  } catch {
    throw new AppError(409, "Accepted manuscript has incomplete or misordered chapters.");
  }

  const escapeHeading = (text: string) => text.replace(/^(#+)/gm, "\\$1");
  const escapeFence = (text: string) => text.replace(/```/g, "\\`\\`\\`");
  const safePremise = escapeHeading(state.project.brief.premise);
  const safeRationale = escapeHeading(ms.rationale);
  const runStatus = state.run?.status ?? "not started";

  let doc = `# Accepted Story Manuscript\n\n`;
  doc += `Status: ${runStatus}. Exported from accepted manuscript v${state.acceptedManuscript.baseVersion}.\n\n`;
  doc += `## Brief\n\n${safePremise}\n\n`;
  doc += `## Approved story bible\n\n\`\`\`json\n${escapeFence(JSON.stringify(state.bible.data, null, 2))}\n\`\`\`\n\n`;
  doc += `## Accepted Manuscript (${ms.editorialLens})\n\n`;
  doc += `Rationale: ${safeRationale}\n\n`;
  if (ms.changesMade && ms.changesMade.length > 0) {
    doc += `### Located Editorial Changes\n\n` +
      ms.changesMade.map(ch => `- **Chapter ${ch.chapterIndex}**: ${escapeHeading(ch.summary)} _(Justification: ${escapeHeading(ch.justification)})_`).join("\n") + "\n\n";
  }
  doc += ordered.map(c => `### Chapter ${c.chapterIndex}\n\n${escapeHeading(c.text)}`).join("\n\n");
  doc += `\n\n## Critique and unresolved issues\n\n\`\`\`json\n${escapeFence(JSON.stringify(state.critique ?? { unresolvedIssues: [] }, null, 2))}\n\`\`\`\n\n`;
  doc += `## Research evidence\n\n\`\`\`json\n${escapeFence(JSON.stringify(state.evidence.map(e => e.data), null, 2))}\n\`\`\`\n`;
  return doc;
}
