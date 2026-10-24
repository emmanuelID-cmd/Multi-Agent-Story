import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { projects, bibles, proposals, runs, tasks, chapters, critiques, evidence, memories } from "./db/schema";
import { briefSchema, bibleSchema, runInput } from "../contracts";
import { enqueue } from "../worker/queue";

export class AppError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function ownedProject(ownerId: string, id: string) {
  const [project] = await db.select().from(projects).where(and(eq(projects.id,id),eq(projects.ownerId,ownerId)));
  if (!project) throw new AppError(404,"Project unavailable.");
  return project;
}
export async function listProjects(ownerId: string) { return db.select().from(projects).where(eq(projects.ownerId,ownerId)).orderBy(desc(projects.createdAt)); }
export async function createProject(ownerId: string, input: unknown) {
  const brief = briefSchema.parse(input);
  const [project] = await db.insert(projects).values({ id:randomUUID(), ownerId, brief }).returning();
  return project;
}
export async function projectState(ownerId: string, id: string) {
  const project = await ownedProject(ownerId,id);
  const [bible] = await db.select().from(bibles).where(eq(bibles.projectId,id)).orderBy(desc(bibles.version)).limit(1);
  const [run] = await db.select().from(runs).where(eq(runs.projectId,id)).orderBy(desc(runs.createdAt)).limit(1);
  const pending = await db.select().from(proposals).where(and(eq(proposals.projectId,id),eq(proposals.status,"pending"))).orderBy(desc(proposals.createdAt));
  if (!run) return { project, bible, pending, run:null, tasks:[], chapters:[], critique:null, evidence:[] };
  const [critique] = await db.select().from(critiques).where(eq(critiques.runId,run.id));
  return { project, bible, pending, run,
    tasks:await db.select().from(tasks).where(eq(tasks.runId,run.id)).orderBy(asc(tasks.chapterIndex)),
    chapters:await db.select().from(chapters).where(eq(chapters.runId,run.id)).orderBy(asc(chapters.chapterIndex)),
    critique:critique?.data ?? null,
    evidence:await db.select().from(evidence).where(eq(evidence.runId,run.id)) };
}
export async function proposePlan(ownerId: string, id: string) {
  const project = await ownedProject(ownerId, id);
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
  const inserted = await db.insert(proposals).values([
    { id: randomUUID(), projectId: id, baseVersion: project.version, kind: "bible_a", data: bibleA },
    { id: randomUUID(), projectId: id, baseVersion: project.version, kind: "bible_b", data: bibleB },
    { id: randomUUID(), projectId: id, baseVersion: project.version, kind: "bible_c", data: bibleC },
  ]).returning();
  return inserted[0];
}
export async function approveProposal(ownerId: string, id: string, proposalId: string) {
  await ownedProject(ownerId, id);
  return db.transaction(async tx => {
    const [project] = await tx.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, ownerId))).for("update");
    if (!project) throw new AppError(404, "Project unavailable.");
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
    await tx.update(proposals).set({ status: "accepted" }).where(eq(proposals.id, proposalId));
    return proposal;
  });
}
export async function rewriteRun(ownerId: string, id: string, feedback?: string, dispatch = true) {
  await ownedProject(ownerId, id);
  const [run] = await db.select().from(runs).where(eq(runs.projectId, id)).orderBy(desc(runs.createdAt)).limit(1);
  if (!run) throw new AppError(409, "No run to rewrite.");
  const [critique] = await db.select().from(critiques).where(eq(critiques.runId, run.id));
  const currentRound = (critique?.data as { revisionRounds?: number } | undefined)?.revisionRounds ?? 0;
  if (currentRound >= 2) {
    throw new AppError(409, "The two-round revision limit has been reached. Existing proposals remain available.");
  }
  const nextRun = await db.transaction(async tx => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, id)).for("update");
    const [bible] = await tx.select().from(bibles).where(and(eq(bibles.projectId, id), eq(bibles.version, project.version)));
    if (!bible) throw new AppError(409, "Approve a story bible before drafting.");
    const active = await tx.select().from(runs).where(eq(runs.projectId, id));
    if (active.some(r => ["pending", "running"].includes(r.status))) throw new AppError(409, "A run is already active.");
    const [created] = await tx.insert(runs).values({
      id: randomUUID(),
      projectId: id,
      bibleId: bible.id,
      fixture: run.fixture,
    }).returning();
    await tx.insert(tasks).values([1, 2, 3].map(chapterIndex => ({
      id: randomUUID(),
      runId: created.id,
      chapterIndex,
      savedInput: {
        bible: bible.data,
        version: bible.version,
        brief: {
          ...project.brief,
          ...(feedback ? { desiredEnding: `${project.brief.desiredEnding} [Revision feedback: ${feedback}]` } : {}),
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
    const [project] = await tx.select().from(projects).where(eq(projects.id,id)).for("update");
    const [bible] = await tx.select().from(bibles).where(and(eq(bibles.projectId,id),eq(bibles.version,project.version)));
    if (!bible) throw new AppError(409,"Approve a story bible before drafting.");
    const active = await tx.select().from(runs).where(eq(runs.projectId,id));
    if (active.some(r=>["pending","running"].includes(r.status))) throw new AppError(409,"A run is already active.");
    const [created] = await tx.insert(runs).values({id:randomUUID(),projectId:id,bibleId:bible.id,fixture:parsed.fixture}).returning();
    await tx.insert(tasks).values([1,2,3].map(chapterIndex=>({id:randomUUID(),runId:created.id,chapterIndex,savedInput:{bible:bible.data,version:bible.version,brief:project.brief}})));
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
  await ownedProject(ownerId,id);
  const [run]=await db.select().from(runs).where(eq(runs.projectId,id)).orderBy(desc(runs.createdAt)).limit(1);
  if(!run)throw new AppError(409,"No run to retry.");
  await db.transaction(async tx=>{const [locked]=await tx.select().from(runs).where(eq(runs.id,run.id)).for("update");
    if(locked.status!=="failed")throw new AppError(409,"Only a failed run can be retried.");
    const all=await tx.select().from(tasks).where(eq(tasks.runId,run.id));
    const eligible=all.filter(t=>t.status!=="completed"&&t.attempts<2);
    if(!eligible.length)throw new AppError(409,"The one-retry limit has been reached. Completed outputs are preserved.");
    for(const task of eligible)await tx.update(tasks).set({status:"pending",error:null,updatedAt:new Date()}).where(eq(tasks.id,task.id));
    await tx.update(runs).set({status:"pending"}).where(eq(runs.id,run.id));
  });
  if(dispatch)await dispatchRun(run.id);
  return run.id;
}
export async function exportProject(ownerId: string,id: string) {
  const state=await projectState(ownerId,id);
  return `# Synthetic story foundation\n\nStatus: ${state.run?.status ?? "not started"}. Not an AI-generated production draft.\n\n## Brief\n${state.project.brief.premise}\n\n## Approved bible\n${JSON.stringify(state.bible?.data ?? null,null,2)}\n\n`+
    state.chapters.map(c=>`## Chapter ${c.chapterIndex} (bible v${c.bibleVersion})\n${c.text}`).join("\n\n")+
    `\n\n## Critique and unresolved issues\n${JSON.stringify(state.critique,null,2)}\n\n## Research evidence\n${JSON.stringify(state.evidence.map(e=>e.data),null,2)}\n`;
}
