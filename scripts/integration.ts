import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { chapters, memories, tasks, user } from "../src/server/db/schema";
import { executeRun, writeChapter } from "../src/agents/graph";
import { AppError, approveProposal, cancelRun, createProject, exportProject, projectState, proposePlan, retryRun, startRun } from "../src/server/projects";
import { getGenreBenchmarks } from "../src/server/research";

const brief = {
  premise: "Mara, a lighthouse keeper, follows a blue signal to rescue a missing sailor.",
  genre: "Adventure", audience: "Adult", tone: "Hopeful", desiredEnding: "The sailor returns safely by boat.",
};

async function rejectsWithStatus(action: () => Promise<unknown>, status: number) {
  await assert.rejects(action, error => error instanceof AppError && error.status === status);
}

async function approvedProject(ownerId: string) {
  const project = await createProject(ownerId, brief);
  const proposal = await proposePlan(ownerId, project.id);
  const bible = await approveProposal(ownerId, project.id, proposal.id);
  return { project, bible };
}

async function main() {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point to the isolated development database.");
  const tag = randomUUID();
  const ownerId = `synthetic-owner-${tag}`;
  const otherId = `synthetic-other-${tag}`;
  await db.insert(user).values([
    { id: ownerId, name: "Synthetic owner", email: `owner-${tag}@example.invalid` },
    { id: otherId, name: "Synthetic other", email: `other-${tag}@example.invalid` },
  ]);

  const unapproved = await createProject(ownerId, brief);
  await rejectsWithStatus(() => startRun(ownerId, unapproved.id, { fixture: "normal" }, false), 409);
  const stale = await proposePlan(ownerId, unapproved.id);
  const first = await proposePlan(ownerId, unapproved.id);
  await approveProposal(ownerId, unapproved.id, first.id);
  await rejectsWithStatus(() => approveProposal(ownerId, unapproved.id, stale.id), 409);
  await rejectsWithStatus(() => approveProposal(ownerId, unapproved.id, first.id), 409);

  const { project, bible } = await approvedProject(ownerId);
  const memory = await db.select().from(memories).where(eq(memories.bibleId, bible.id));
  assert.deepEqual(memory.map(row => row.chapterIndex).sort(), [1, 2, 3]);
  assert.ok(memory.every(row => (row.data as { factIds: string[] }).factIds.includes("F1")));
  const normal = await startRun(ownerId, project.id, { fixture: "normal" }, false);
  await executeRun(normal.id, true);
  const complete = await projectState(ownerId, project.id);
  assert.equal(complete.run?.status, "completed");
  assert.deepEqual(complete.chapters.map(chapter => chapter.chapterIndex), [1, 2, 3]);
  assert.ok(complete.chapters.every(chapter => chapter.bibleVersion === bible.version));
  assert.ok(complete.chapters[2].createdAt.getTime() < complete.chapters[0].createdAt.getTime(), "Chapter 3 must finish before chapter 1 in this fixture.");
  assert.ok(complete.chapters.every(chapter => !chapter.text.includes("Mara swam")));
  assert.ok(complete.chapters[1].text.includes("human-made"));
  assert.ok(complete.chapters[2].text.includes("boat"));
  assert.equal(complete.critique?.marketReader && (complete.critique.marketReader as { availability: string }).availability, "unavailable");
  assert.equal(complete.evidence.length, 2);
  assert.ok(complete.evidence.every(item => (item.data as { availability: string }).availability === "unavailable"));
  const checkpoint = await pool.query<{ count: string }>("select count(*) from checkpoints where thread_id = $1", [normal.id]);
  assert.ok(Number(checkpoint.rows[0].count) > 0, "The LangGraph checkpoint must persist.");
  await executeRun(normal.id, true);
  assert.equal((await db.select().from(chapters).where(eq(chapters.runId, normal.id))).length, 3, "Re-execution must not duplicate chapters.");

  for (const operation of [
    () => projectState(otherId, project.id),
    () => exportProject(otherId, project.id),
    () => proposePlan(otherId, project.id),
    () => startRun(otherId, project.id, { fixture: "normal" }, false),
    () => cancelRun(otherId, project.id),
  ]) await rejectsWithStatus(operation, 404);
  assert.ok((await exportProject(ownerId, project.id)).indexOf("## Chapter 1") < (await exportProject(ownerId, project.id)).indexOf("## Chapter 3"));

  const continuityProject = await approvedProject(ownerId);
  const continuity = await startRun(ownerId, continuityProject.project.id, { fixture: "continuity" }, false);
  await executeRun(continuity.id, false);
  const critique = (await projectState(ownerId, continuityProject.project.id)).critique;
  const notes = (critique?.continuity as { notes: Array<{ chapterIndex: number; passage: string; factId: string; severity: string }> }).notes;
  assert.deepEqual(notes.map(note => [note.chapterIndex, note.factId, note.severity]), [[2, "F1", "critical"]]);
  assert.ok(notes[0].passage.includes("Mara swam"));

  const outage = await getGenreBenchmarks("research-outage");
  assert.ok(outage.every(item => item.availability === "unavailable" && item.records.length === 0 && item.limitation.includes("429")));
  const adversarialProject = await approvedProject(ownerId);
  const adversarial = await startRun(ownerId, adversarialProject.project.id, { fixture: "adversarial" }, false);
  await executeRun(adversarial.id, false);
  const adversarialState = await projectState(ownerId, adversarialProject.project.id);
  assert.equal(adversarialState.run?.status, "completed");
  assert.ok(adversarialState.evidence.every(item => (item.data as { availability: string; limitation: string }).availability === "unavailable"));
  assert.ok(adversarialState.evidence.every(item => (item.data as { limitation: string }).limitation.includes("treated as data")));
  assert.ok(adversarialState.chapters.every(chapter => !chapter.text.includes("publish")));

  const timeoutProject = await approvedProject(ownerId);
  const timeout = await startRun(ownerId, timeoutProject.project.id, { fixture: "timeout" }, false);
  await executeRun(timeout.id, false);
  const beforeRetry = await projectState(ownerId, timeoutProject.project.id);
  assert.equal(beforeRetry.run?.status, "failed");
  assert.deepEqual(beforeRetry.chapters.map(chapter => chapter.chapterIndex), [1, 3]);
  assert.equal(beforeRetry.critique, null, "Critique must wait for every required chapter.");
  const savedChapterIds = (await db.select().from(chapters).where(eq(chapters.runId, timeout.id))).map(chapter => chapter.id);
  await retryRun(ownerId, timeoutProject.project.id, false);
  await executeRun(timeout.id, false);
  const afterRetry = await projectState(ownerId, timeoutProject.project.id);
  assert.equal(afterRetry.run?.status, "failed");
  assert.deepEqual((await db.select().from(chapters).where(eq(chapters.runId, timeout.id))).map(chapter => chapter.id), savedChapterIds);
  assert.deepEqual(afterRetry.tasks.map(task => task.attempts), [1, 2, 1]);
  await rejectsWithStatus(() => retryRun(ownerId, timeoutProject.project.id, false), 409);

  const canceledProject = await approvedProject(ownerId);
  const canceled = await startRun(ownerId, canceledProject.project.id, { fixture: "normal" }, false);
  await writeChapter(canceled.id, 3, 0);
  const late = writeChapter(canceled.id, 2, 100);
  await delay(20);
  await cancelRun(ownerId, canceledProject.project.id);
  await late;
  await writeChapter(canceled.id, 1, 0);
  const stopped = await projectState(ownerId, canceledProject.project.id);
  assert.equal(stopped.run?.status, "canceled");
  assert.deepEqual(stopped.chapters.map(chapter => chapter.chapterIndex), [3]);
  assert.equal(stopped.tasks.find(task => task.chapterIndex === 3)?.status, "completed");
  assert.equal(stopped.tasks.find(task => task.chapterIndex === 2)?.status, "canceled");
  assert.equal((await db.select().from(tasks).where(eq(tasks.runId, canceled.id))).length, 3);

  console.log("Synthetic integration: approval, ordering, checkpoints, ownership, continuity, retry, and cancellation passed.");
}

try { await main(); }
finally { await pool.end(); }
