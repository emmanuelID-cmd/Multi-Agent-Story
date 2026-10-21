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
  const project = await ownedProject(ownerId,id);
  const data = bibleSchema.parse({ facts:[
    {id:"F1",text:"Mara, a lighthouse keeper, cannot swim."},
    {id:"F2",text:"The blue signal is human-made."},
    {id:"F3",text:"The missing sailor is rescued using a boat."}],
    beats:[{chapterIndex:1,text:"Discover the blue signal."},{chapterIndex:2,text:"Investigate its human origin."},{chapterIndex:3,text:"Rescue the missing sailor by boat."}] });
  const [proposal] = await db.insert(proposals).values({ id:randomUUID(), projectId:id, baseVersion:project.version, kind:"synthetic-plan", data }).returning();
  return proposal;
}
export async function approveProposal(ownerId: string, id: string, proposalId: string) {
  await ownedProject(ownerId,id);
  return db.transaction(async tx=>{
    const [project] = await tx.select().from(projects).where(and(eq(projects.id,id),eq(projects.ownerId,ownerId))).for("update");
    if (!project) throw new AppError(404,"Project unavailable.");
    const [proposal] = await tx.select().from(proposals).where(and(eq(proposals.id,proposalId),eq(proposals.projectId,id))).for("update");
    if (!proposal || proposal.status!=="pending" || proposal.baseVersion!==project.version) throw new AppError(409,"Proposal is stale or already decided. Review a new plan.");
    const version = project.version+1;
    const [bible] = await tx.insert(bibles).values({ id:randomUUID(),projectId:id,version,data:bibleSchema.parse(proposal.data) }).returning();
    await tx.insert(memories).values(bible.data.beats.map(beat=>({id:randomUUID(),bibleId:bible.id,chapterIndex:beat.chapterIndex,data:{factIds:bible.data.facts.map(f=>f.id),plannedEvents:beat.text,unresolvedThreads:["Locate the missing sailor."],summary:"Synthetic handoff; canonical facts remain in the approved bible."}})));
    await tx.update(projects).set({version}).where(eq(projects.id,id));
    await tx.update(proposals).set({status:"accepted"}).where(eq(proposals.id,proposalId));
    return bible;
  });
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
