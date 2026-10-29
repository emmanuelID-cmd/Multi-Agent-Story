import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { assertNoPostgresTargetOverrides, assertSafePostgresTestTarget, samePostgresTarget } from "./postgres-target";

const testUrl = process.env.PHASE3_TEST_DATABASE_URL;
assert.ok(testUrl, "Set PHASE3_TEST_DATABASE_URL to a disposable local PostgreSQL test database.");
const parsedUrl = assertSafePostgresTestTarget(testUrl);
const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname), "The Phase 3.2 test database must be local.");
assert.ok(databaseName.startsWith("phase3_test_"), "The database name must start with phase3_test_.");
if (process.env.DATABASE_URL) {
  const activeUrl = assertNoPostgresTargetOverrides(process.env.DATABASE_URL);
  assert.ok(
    !samePostgresTarget(activeUrl, parsedUrl),
    "Refusing to use the configured application database as the Phase 3.2 test database.",
  );
}
assert.notEqual(process.env.READ_CONNECTIONS_ENABLED, "true", "Do not enable live READ connections in this synthetic test.");

// The test URL is explicitly supplied and guarded above; .env is never loaded.
process.env.DATABASE_URL = testUrl;
process.env.READ_CONNECTIONS_ENABLED = "false";

const [{ db, pool }, schema, projectServices, graph] = await Promise.all([
  import("../src/server/db"),
  import("../src/server/db/schema"),
  import("../src/server/projects"),
  import("../src/agents/graph"),
]);
const versionResult = await pool.query<{ current_database: string; server_version_num: string }>(
  "select current_database(), current_setting('server_version_num') as server_version_num",
);
assert.equal(versionResult.rows[0]?.current_database, databaseName);
assert.ok(versionResult.rows[0]?.server_version_num.startsWith("17"), "The isolated database must be PostgreSQL 17.");

const schemaExists = await pool.query<{ table_name: string | null }>(
  "select to_regclass('public.projects')::text as table_name",
);
if (!schemaExists.rows[0]?.table_name) {
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  await migrate(db, { migrationsFolder: "drizzle" });
}

const { and, eq } = await import("drizzle-orm");
const { chapters, projects, runs, tasks, user } = schema;
const { AppError, approveProposal, createProject, proposePlan, startRun } = projectServices;
const { writeChapter } = graph;
const tag = randomUUID();
const ownerId = `phase3-owner-${tag}`;
const replacementOwnerId = `phase3-owner-new-${tag}`;
const brief = {
  premise: "A lighthouse keeper follows a blue signal to rescue a missing sailor.",
  genre: "Adventure",
  audience: "Adult",
  tone: "Hopeful",
  desiredEnding: "The sailor returns safely by boat.",
};

await db.insert(user).values([
  { id: ownerId, name: "Phase 3 synthetic owner", email: `phase3-${tag}@example.invalid` },
  { id: replacementOwnerId, name: "Phase 3 replacement owner", email: `phase3-new-${tag}@example.invalid` },
]);

async function approvedRun() {
  const project = await createProject(ownerId, brief);
  const proposal = await proposePlan(ownerId, project.id);
  await approveProposal(ownerId, project.id, proposal.id);
  const run = await startRun(ownerId, project.id, { fixture: "normal" }, false);
  return { project, run };
}

async function waitForRunning(runId: string, chapterIndex: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [task] = await db.select().from(tasks).where(and(eq(tasks.runId, runId), eq(tasks.chapterIndex, chapterIndex)));
    if (task?.status === "running") return task;
    await delay(10);
  }
  throw new Error("Timed out waiting for the synthetic task reservation.");
}

// Unauthorized requests are rejected, and the locked project read also
// rechecks owner identity before the run is inserted.
const ownerCheck = await approvedRun();
await assert.rejects(
  startRun(replacementOwnerId, ownerCheck.project.id, { fixture: "normal" }, false),
  error => error instanceof AppError && error.status === 404,
);
assert.equal((await db.select().from(runs).where(eq(runs.projectId, ownerCheck.project.id))).length, 1);

// A dependency/version change after reservation must reject the chapter and
// persist a stale failure for the same attempt.
const staleVersion = await approvedRun();
const staleVersionWrite = writeChapter(staleVersion.run.id, 1, 350);
await waitForRunning(staleVersion.run.id, 1);
await db.update(projects).set({ version: 2 }).where(eq(projects.id, staleVersion.project.id));
await staleVersionWrite;
const [staleVersionTask] = await db.select().from(tasks).where(and(eq(tasks.runId, staleVersion.run.id), eq(tasks.chapterIndex, 1)));
assert.equal(staleVersionTask.status, "failed");
assert.match(staleVersionTask.error ?? "", /^STALE_RESULT:/);
assert.equal((await db.select().from(chapters).where(eq(chapters.runId, staleVersion.run.id))).length, 0);

// Owner changes have the same stale-result protection.
const staleOwner = await approvedRun();
const staleOwnerWrite = writeChapter(staleOwner.run.id, 1, 350);
await waitForRunning(staleOwner.run.id, 1);
await db.update(projects).set({ ownerId: replacementOwnerId }).where(eq(projects.id, staleOwner.project.id));
await staleOwnerWrite;
const [staleOwnerTask] = await db.select().from(tasks).where(and(eq(tasks.runId, staleOwner.run.id), eq(tasks.chapterIndex, 1)));
assert.equal(staleOwnerTask.status, "failed");
assert.match(staleOwnerTask.error ?? "", /^STALE_RESULT:/);
assert.equal((await db.select().from(chapters).where(eq(chapters.runId, staleOwner.run.id))).length, 0);

// If a newer attempt has replaced the reservation, the older result cannot
// write a chapter or alter the newer task row.
const replacedAttempt = await approvedRun();
const replacedAttemptWrite = writeChapter(replacedAttempt.run.id, 1, 350);
const reservedTask = await waitForRunning(replacedAttempt.run.id, 1);
await db.update(tasks).set({ attempts: reservedTask.attempts + 1 }).where(eq(tasks.id, reservedTask.id));
await replacedAttemptWrite;
const [newerAttemptTask] = await db.select().from(tasks).where(eq(tasks.id, reservedTask.id));
assert.equal(newerAttemptTask.status, "running");
assert.equal(newerAttemptTask.attempts, reservedTask.attempts + 1);
assert.equal((await db.select().from(chapters).where(eq(chapters.runId, replacedAttempt.run.id))).length, 0);

// Duplicate delivery reserves one attempt and produces one durable chapter.
const duplicate = await approvedRun();
await Promise.all([
  writeChapter(duplicate.run.id, 1, 120),
  writeChapter(duplicate.run.id, 1, 120),
]);
const [duplicateTask] = await db.select().from(tasks).where(and(eq(tasks.runId, duplicate.run.id), eq(tasks.chapterIndex, 1)));
const duplicateChapters = await db.select().from(chapters).where(eq(chapters.runId, duplicate.run.id));
assert.equal(duplicateTask.status, "completed");
assert.equal(duplicateTask.attempts, 1);
assert.equal(duplicateChapters.length, 1);

// A fresh PostgreSQL connection can reload the persisted task, run, and chapter.
const { Pool } = await import("pg");
const reloadPool = new Pool({ connectionString: testUrl, max: 1 });
try {
  const reloaded = await reloadPool.query<{ task_status: string; attempts: number; chapter_count: string; run_status: string }>(
    `select t.status as task_status, t.attempts, r.status as run_status,
            (select count(*) from chapters c where c."runId" = r.id)::text as chapter_count
       from tasks t join runs r on r.id = t."runId"
      where t."runId" = $1 and t."chapterIndex" = 1`,
    [duplicate.run.id],
  );
  assert.deepEqual(reloaded.rows[0], { task_status: "completed", attempts: 1, run_status: "pending", chapter_count: "1" });
} finally {
  await reloadPool.end();
}

console.log("Phase 3.2 isolated persistence checks passed: owner gate, stale version/owner rejection, newer-attempt preservation, duplicate delivery, and fresh-connection reload.");
await pool.end();
