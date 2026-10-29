import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ReadModel } from "../src/agents/read/model";
import { assertNoPostgresTargetOverrides, assertSafePostgresTestTarget, samePostgresTarget } from "./postgres-target";

const testUrl = process.env.PHASE3_TEST_DATABASE_URL;
assert.ok(testUrl, "Set PHASE3_TEST_DATABASE_URL to a disposable local PostgreSQL test database.");
const parsedUrl = assertSafePostgresTestTarget(testUrl);
const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname), "The recovery test database must be local.");
assert.ok(databaseName.startsWith("phase3_test_"), "The database name must start with phase3_test_.");
if (process.env.DATABASE_URL) {
  assert.ok(!samePostgresTarget(process.env.DATABASE_URL, parsedUrl), "Refusing to use the configured application database as the recovery test database.");
}
assert.notEqual(process.env.READ_CONNECTIONS_ENABLED, "true", "Live READ connections must stay disabled in the recovery test.");
process.env.DATABASE_URL = testUrl;
process.env.READ_CONNECTIONS_ENABLED = "false";

const [{ and, eq }, { db, pool }, schema, projectServices, graph, workerQueue, workerRecovery] = await Promise.all([
  import("drizzle-orm"),
  import("../src/server/db"),
  import("../src/server/db/schema"),
  import("../src/server/projects"),
  import("../src/agents/graph"),
  import("../src/worker/queue"),
  import("../src/worker/recovery"),
]);
const { bibles, chapters, projects, proposals, runs, tasks, user } = schema;
const { AppError, approveProposal, cancelRun, createProject, projectState, proposePlan, retryRun, rewriteRun, startRun } = projectServices;
const { executeRun, writeChapter } = graph;
const { queue } = workerQueue;
const { recoverInterruptedRuns } = workerRecovery;

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
  const child = spawn(process.execPath, ["--import", "tsx", "src/worker/index.ts"], {
    cwd: process.cwd(),
    env: {
      DATABASE_URL: testUrl!,
      READ_CONNECTIONS_ENABLED: "false",
      NODE_ENV: "test",
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
    },
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
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

async function editorProposalSnapshot(projectId: string, includeStatus: boolean) {
  const rows = await db.select().from(proposals).where(eq(proposals.projectId, projectId));
  return rows.filter(row => ["manuscript_a", "manuscript_b"].includes(row.kind))
    .map(row => includeStatus
      ? { id: row.id, kind: row.kind, status: row.status, data: row.data }
      : { id: row.id, kind: row.kind, data: row.data })
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function chapterSnapshot(runId: string) {
  return (await db.select().from(chapters).where(eq(chapters.runId, runId)))
    .map(row => ({ id: row.id, chapterIndex: row.chapterIndex, bibleVersion: row.bibleVersion, text: row.text }))
    .sort((a, b) => a.chapterIndex - b.chapterIndex);
}

async function main() {
  const versionResult = await pool.query<{ current_database: string; server_version_num: string }>(
    "select current_database(), current_setting('server_version_num') as server_version_num",
  );
  assert.equal(versionResult.rows[0]?.current_database, databaseName);
  assert.ok(versionResult.rows[0]?.server_version_num.startsWith("17"), "The recovery test requires isolated PostgreSQL 17.");
  const schemaExists = await pool.query<{ table_name: string | null }>(
    "select to_regclass('public.projects')::text as table_name",
  );
  if (!schemaExists.rows[0]?.table_name) {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder: "drizzle" });
  }
  assert.equal((await db.select().from(runs).where(eq(runs.status, "running"))).length, 0, "Do not start recovery while another synthetic run is active.");
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

    const attemptsBeforeStaleDelivery = recovered.tasks.map(task => task.attempts);
    await executeRun(run.id, false); // Simulate a stale queue delivery after worker-start recovery.
    const afterStaleDelivery = await projectState(ownerId, project.id);
    assert.equal(afterStaleDelivery.run?.status, "failed", "A stale queue delivery must not requeue a recovered failure.");
    assert.deepEqual(afterStaleDelivery.tasks.map(task => task.attempts), attemptsBeforeStaleDelivery);
    assert.deepEqual(afterStaleDelivery.chapters.map(chapter => chapter.id), [savedChapter.id]);

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

    const duplicateRun = await startRun(ownerId, project.id, { fixture: "normal" }, false);
    await Promise.all([executeRun(duplicateRun.id, false), executeRun(duplicateRun.id, false)]);
    const duplicateState = await projectState(ownerId, project.id);
    assert.equal(duplicateState.run?.status, "completed");
    assert.deepEqual(duplicateState.tasks.map(task => task.attempts), [1, 1, 1]);
    assert.equal(duplicateState.chapters.length, 3, "Concurrent duplicate deliveries must save exactly one chapter set.");

    async function interruptRevision(revisionRunId: string, expectedRound: number, savedProposals: unknown) {
      await db.update(runs).set({ status: "running" }).where(eq(runs.id, revisionRunId));
      await db.update(tasks).set({ status: "running", attempts: 1 }).where(eq(tasks.runId, revisionRunId));
      const before = await db.select().from(tasks).where(eq(tasks.runId, revisionRunId));
      assert.deepEqual(before.map(task => (task.savedInput as { revisionRound: number }).revisionRound), [expectedRound, expectedRound, expectedRound]);
      assert.deepEqual(await editorProposalSnapshot(project.id, true), savedProposals);
      await recoverInterruptedRuns(); // Same transactional recovery service called by worker startup.
      const recovered = await projectState(ownerId, project.id);
      assert.equal(recovered.run?.id, revisionRunId);
      assert.equal(recovered.run?.status, "failed");
      assert.deepEqual(recovered.tasks.map(task => [task.status, task.attempts]), [["failed", 1], ["failed", 1], ["failed", 1]]);
      assert.deepEqual(await editorProposalSnapshot(project.id, true), savedProposals);
      const recoveredTasks = await db.select().from(tasks).where(eq(tasks.runId, revisionRunId));
      await executeRun(revisionRunId, false); // Stale queue delivery must not replay this revision.
      const after = await db.select().from(tasks).where(eq(tasks.runId, revisionRunId));
      assert.deepEqual(after.map(task => [task.status, task.attempts]), recoveredTasks.map(task => [task.status, task.attempts]));
      assert.deepEqual(await editorProposalSnapshot(project.id, true), savedProposals);
    }

    const revisionOne = await rewriteRun(ownerId, project.id, "Make the transition clearer.", false);
    const sourceChaptersBeforeRevisions = await chapterSnapshot(duplicateRun.id);
    const roundZeroProposals = await editorProposalSnapshot(project.id, true);
    await interruptRevision(revisionOne.id, 1, roundZeroProposals);
    await retryRun(ownerId, project.id, false);
    await executeRun(revisionOne.id, false);
    const roundOneState = await projectState(ownerId, project.id);
    assert.equal(roundOneState.run?.status, "completed");
    assert.deepEqual(roundOneState.tasks.map(task => (task.savedInput as { revisionRound: number }).revisionRound), [1, 1, 1]);
    assert.deepEqual(roundOneState.tasks.map(task => task.attempts), [2, 2, 2]);
    assert.deepEqual(await chapterSnapshot(duplicateRun.id), sourceChaptersBeforeRevisions);
    const roundZeroIds = new Set((roundZeroProposals as Array<{ id: string; status: string }>).filter(row => row.status === "pending").map(row => row.id));
    const afterRoundOneProposals = await editorProposalSnapshot(project.id, false);
    for (const row of roundZeroProposals as Array<{ id: string; kind: string; data: unknown }>) {
      assert.deepEqual(afterRoundOneProposals.find((current: { id: string }) => current.id === row.id), { id: row.id, kind: row.kind, data: row.data });
    }
    assert.ok(roundZeroIds.size === 2, "The prior Editor A/B pair remains pending until its revision succeeds.");

    const revisionTwo = await rewriteRun(ownerId, project.id, "Keep the agreed ending.", false);
    const roundOneProposals = await editorProposalSnapshot(project.id, true);
    await interruptRevision(revisionTwo.id, 2, roundOneProposals);
    await retryRun(ownerId, project.id, false);
    await executeRun(revisionTwo.id, false);
    const roundTwoState = await projectState(ownerId, project.id);
    assert.equal(roundTwoState.run?.status, "completed");
    assert.deepEqual(roundTwoState.tasks.map(task => (task.savedInput as { revisionRound: number }).revisionRound), [2, 2, 2]);
    assert.deepEqual(roundTwoState.tasks.map(task => task.attempts), [2, 2, 2]);
    assert.deepEqual(await chapterSnapshot(duplicateRun.id), sourceChaptersBeforeRevisions);
    const afterRoundTwoProposals = await editorProposalSnapshot(project.id, false);
    for (const row of roundOneProposals as Array<{ id: string; kind: string; data: unknown }>) {
      assert.deepEqual(afterRoundTwoProposals.find((current: { id: string }) => current.id === row.id), { id: row.id, kind: row.kind, data: row.data });
    }
    await assert.rejects(rewriteRun(ownerId, project.id, "One more revision.", false), error => error instanceof AppError && error.status === 409);

    const readProject = await createProject(ownerId, {
      premise: "A lighthouse keeper guides a lost sailor back to shore.",
      genre: "Adventure", audience: "Adult", tone: "Hopeful", desiredEnding: "The sailor returns by boat.",
    });
    const readPlan = await proposePlan(ownerId, readProject.id);
    await approveProposal(ownerId, readProject.id, readPlan.id);
    const readRun = await startRun(ownerId, readProject.id, { fixture: "normal" }, false);
    await executeRun(readRun.id, false);
    const readState = await projectState(ownerId, readProject.id);
    assert.equal(readState.run?.status, "completed");
    const { createReadConnections } = await import("../src/server/read-connections");
    const readAbort = new AbortController();
    let readModelCalls = 0;
    const readModel: ReadModel = {
      modelId: "synthetic-recovery-reader",
      async complete(call) {
        readModelCalls++;
        return new Promise<never>((_resolve, reject) => {
          const interrupted = () => reject(new Error("SYNTHETIC_PROCESS_INTERRUPTION"));
          call.signal.addEventListener("abort", interrupted, { once: true });
          if (call.signal.aborted) interrupted();
        });
      },
    };
    const readOptions = {
      runtime: {
        model: readModel,
        signal: readAbort.signal,
        budget: { maxTokens: 60_000, maxCostUsd: 3, inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
      },
      versions: { contract: "read-v1" as const, prompt: "read-v1" as const, harness: "read-connections-v1", model: readModel.modelId },
    };
    const readAssignment = {
      schemaVersion: 1 as const,
      requestId: `recovery-read-${tag}`,
      requestVersion: 1,
      runId: readRun.id,
      targetRunId: readRun.id,
      stateVersion: readState.project.version,
      bibleVersion: readState.bible!.version,
      draftVersion: 1,
      editorialRound: 0,
      editorialTask: { action: "revise" as const, scope: [1, 2, 3] as [1, 2, 3], expectedOutput: "A located review handoff." },
      recordedRequest: "",
      hasAdditionalInstructions: false,
      source: { kind: "draft" as const },
    };
    const firstReadService = createReadConnections(readOptions);
    await firstReadService.recordRequest(ownerId, readProject.id, readAssignment);
    const inFlightRead = firstReadService.prepareReader(ownerId, readProject.id, readRun.id, readAssignment.requestId, `recovery-reader-${tag}`);
    type PersistedReadOperation = { operationId: string; status: string; budgetReservation?: { settled: boolean }; receipts: unknown[]; readerResults: unknown[] };
    let inFlightRecord: PersistedReadOperation | undefined;
    const readDeadline = Date.now() + 5_000;
    while (Date.now() < readDeadline && !inFlightRecord) {
      const rows = await db.select().from(proposals).where(and(eq(proposals.projectId, readProject.id), eq(proposals.kind, "read_operation")));
      inFlightRecord = rows.map(row => row.data as PersistedReadOperation).find(row => row.operationId === `recovery-reader-${tag}` && row.status === "running");
      if (!inFlightRecord) await delay(10);
    }
    assert.ok(inFlightRecord, "The READ dispatch intent must persist before the injected model call waits.");
    const restartedReadService = createReadConnections(readOptions);
    const afterServiceRestart = await restartedReadService.prepareReader(ownerId, readProject.id, readRun.id,
      readAssignment.requestId, `recovery-reader-${tag}`);
    assert.equal(afterServiceRestart.status, "running");
    assert.equal(afterServiceRestart.budgetReservation?.settled, false);
    assert.equal(afterServiceRestart.readerResults.length, 0);
    assert.equal(afterServiceRestart.receipts.length, 0, "An uncertain in-flight effect cannot become an accepted handoff.");
    assert.equal(readModelCalls, 1, "Reopening the exact operation must not redispatch the injected model.");
    readAbort.abort();
    const stoppedRead = await inFlightRead;
    assert.equal(stoppedRead.status, "canceled");
    assert.equal(readModelCalls, 1);

    const staleProject = await createProject(ownerId, {
      premise: "A cartographer finds a safe passage home.",
      genre: "Adventure", audience: "Adult", tone: "Hopeful", desiredEnding: "The crew returns safely.",
    });
    const staleProposal = await proposePlan(ownerId, staleProject.id);
    const staleBible = await approveProposal(ownerId, staleProject.id, staleProposal.id);
    const staleRun = await startRun(ownerId, staleProject.id, { fixture: "normal" }, false);
    await db.update(runs).set({ status: "failed" }).where(eq(runs.id, staleRun.id));
    await db.update(projects).set({ version: staleBible.version + 1 }).where(eq(projects.id, staleProject.id));
    await assert.rejects(
      retryRun(ownerId, staleProject.id, false),
      error => error instanceof AppError && error.status === 409,
      "Retry must wait until the current approved dependencies are restored or a new run is created.",
    );
    const staleState = await projectState(ownerId, staleProject.id);
    assert.equal(staleState.run?.status, "failed");
    assert.deepEqual(staleState.tasks.map(task => [task.status, task.attempts]), [["pending", 0], ["pending", 0], ["pending", 0]]);

    const timeoutProject = await createProject(ownerId, {
      premise: "A lighthouse keeper signals a boat through fog.",
      genre: "Adventure", audience: "Adult", tone: "Hopeful", desiredEnding: "The crew returns safely.",
    });
    const timeoutProposal = await proposePlan(ownerId, timeoutProject.id);
    await approveProposal(ownerId, timeoutProject.id, timeoutProposal.id);
    const timeoutRun = await startRun(ownerId, timeoutProject.id, { fixture: "timeout" }, false);
    await executeRun(timeoutRun.id, false);
    const firstTimeout = await projectState(ownerId, timeoutProject.id);
    assert.equal(firstTimeout.run?.status, "failed");
    const savedTimeoutChapters = firstTimeout.chapters.map(chapter => chapter.id);
    await retryRun(ownerId, timeoutProject.id, false);
    await executeRun(timeoutRun.id, false);
    const secondTimeout = await projectState(ownerId, timeoutProject.id);
    assert.equal(secondTimeout.run?.status, "failed");
    assert.deepEqual(secondTimeout.tasks.map(task => task.attempts), [1, 2, 1]);
    assert.deepEqual(secondTimeout.chapters.map(chapter => chapter.id), savedTimeoutChapters);
    await assert.rejects(retryRun(ownerId, timeoutProject.id, false), error => error instanceof AppError && error.status === 409);

    const canceledProject = await createProject(ownerId, {
      premise: "A lighthouse keeper signals a boat through fog.",
      genre: "Adventure", audience: "Adult", tone: "Hopeful", desiredEnding: "The crew returns safely.",
    });
    const canceledProposal = await proposePlan(ownerId, canceledProject.id);
    await approveProposal(ownerId, canceledProject.id, canceledProposal.id);
    const canceledRun = await startRun(ownerId, canceledProject.id, { fixture: "normal" }, false);
    await writeChapter(canceledRun.id, 3, 0);
    const late = writeChapter(canceledRun.id, 2, 100);
    await delay(20);
    await cancelRun(ownerId, canceledProject.id);
    await late;
    await writeChapter(canceledRun.id, 1, 0);
    const canceledState = await projectState(ownerId, canceledProject.id);
    assert.equal(canceledState.run?.status, "canceled");
    assert.deepEqual(canceledState.chapters.map(chapter => chapter.chapterIndex), [3]);
    assert.equal(canceledState.tasks.find(task => task.chapterIndex === 2)?.status, "canceled");

    console.log("Synthetic worker recovery checks passed: restart, explicit retry, stale delivery, current-dependency gate, timeout limit, cancellation/late result, completed-artifact preservation, and restart persistence.");
  } finally {
    try { if (client) await client.stop(); }
    finally { await stopWorker(worker); }
  }
}

try { await main(); }
finally { await pool.end(); }
