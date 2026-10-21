import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { writeChapter } from "../src/agents/graph";
import { db, pool } from "../src/server/db";
import { chapters, runs, tasks, user } from "../src/server/db/schema";
import { approveProposal, createProject, projectState, proposePlan, retryRun, startRun } from "../src/server/projects";
import { queue } from "../src/worker/queue";

const readyMessage = "Synthetic story worker ready.";
const waitLimitMs = 30_000;

async function waitFor(condition: () => Promise<boolean>, description: string) {
  const deadline = Date.now() + waitLimitMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await delay(100);
  }
  throw Error(`Timed out waiting for ${description}.`);
}

async function startWorker() {
  const child = spawn(process.execPath, ["--env-file=.env", "--import", "tsx", "src/worker/index.ts"], {
    cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Worker startup timed out.")), waitLimitMs);
      const finish = (error?: Error) => { clearTimeout(timer); if (error) reject(error); else resolve(); };
      child.stdout?.on("data", (chunk: Buffer) => {
        output = (output + chunk.toString("utf8")).slice(-2048);
        if (output.includes(readyMessage)) finish();
      });
      child.stderr?.on("data", () => { /* Drain without exposing process output or configuration. */ });
      child.once("error", error => finish(error));
      child.once("exit", () => finish(Error("Worker exited before readiness.")));
    });
    return child;
  } catch (error) {
    await stopWorker(child);
    throw error;
  }
}

async function stopWorker(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(10_000).then(() => { throw Error("Owned worker did not stop within 10 seconds."); })]);
}

async function main() {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point to the isolated development database.");
  assert.equal((await db.select().from(runs).where(eq(runs.status, "running"))).length, 0, "Do not start the recovery worker while unrelated runs are active.");
  const tag = randomUUID();
  const ownerId = `synthetic-recovery-${tag}`;
  await db.insert(user).values({ id: ownerId, name: "Synthetic recovery user", email: `recovery-${tag}@example.invalid` });
  const project = await createProject(ownerId, {
    premise: "Mara follows a blue signal to rescue a missing sailor by boat.",
    genre: "Adventure", audience: "Adult", tone: "Hopeful", desiredEnding: "The sailor returns safely.",
  });
  const proposal = await proposePlan(ownerId, project.id);
  const bible = await approveProposal(ownerId, project.id, proposal.id);
  const run = await startRun(ownerId, project.id, { fixture: "normal" }, false);
  await writeChapter(run.id, 3, 0);
  const [savedChapter] = await db.select().from(chapters).where(and(eq(chapters.runId, run.id), eq(chapters.chapterIndex, 3)));
  assert.ok(savedChapter, "Chapter 3 must be durable before the simulated interruption.");

  // Simulate persisted rows after process loss; only this uniquely created fixture is changed.
  await db.update(runs).set({ status: "running" }).where(eq(runs.id, run.id));
  await db.update(tasks).set({ status: "running", attempts: 1 }).where(and(eq(tasks.runId, run.id), eq(tasks.chapterIndex, 2)));

  let worker: ChildProcess | undefined;
  let client: Awaited<ReturnType<typeof queue>> | undefined;
  try {
    worker = await startWorker();
    await waitFor(async () => (await projectState(ownerId, project.id)).run?.status === "failed", "startup recovery");
    const recovered = await projectState(ownerId, project.id);
    assert.equal(recovered.bible?.id, bible.id);
    assert.equal(recovered.bible?.version, bible.version);
    assert.equal(recovered.tasks.find(task => task.chapterIndex === 2)?.status, "failed");
    assert.equal(recovered.tasks.find(task => task.chapterIndex === 2)?.attempts, 1);
    assert.deepEqual(recovered.chapters.map(chapter => chapter.id), [savedChapter.id]);

    client = await queue();
    await retryRun(ownerId, project.id, true);
    await waitFor(async () => (await projectState(ownerId, project.id)).run?.status === "completed", "queued retry completion");
    const completed = await projectState(ownerId, project.id);
    assert.equal(completed.bible?.id, bible.id);
    assert.deepEqual(completed.chapters.map(chapter => chapter.chapterIndex), [1, 2, 3]);
    assert.equal(completed.chapters[2].id, savedChapter.id);
    assert.deepEqual(completed.tasks.map(task => task.attempts), [1, 2, 1]);
    assert.equal(new Set(completed.chapters.map(chapter => chapter.id)).size, 3);
    const completedIds = completed.chapters.map(chapter => chapter.id);

    await stopWorker(worker);
    worker = undefined;
    worker = await startWorker();
    const afterRestart = await projectState(ownerId, project.id);
    assert.equal(afterRestart.run?.status, "completed");
    assert.equal(afterRestart.bible?.id, bible.id);
    assert.deepEqual(afterRestart.chapters.map(chapter => chapter.id), completedIds);
    assert.deepEqual(afterRestart.tasks.map(task => task.attempts), [1, 2, 1]);
    console.log("Synthetic worker recovery: interrupted rows, queued retry, and process restart passed.");
  } finally {
    try { if (client) await client.stop(); }
    finally { await stopWorker(worker); }
  }
}

try { await main(); }
finally { await pool.end(); }
