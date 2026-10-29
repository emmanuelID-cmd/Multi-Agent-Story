import { and, eq } from "drizzle-orm";
import { db } from "../server/db";
import { runs, tasks } from "../server/db/schema";

/** Convert process-owned in-flight rows to explicit, user-retryable failures. */
export async function recoverInterruptedRuns() {
  const interrupted = await db.select().from(runs).where(eq(runs.status, "running"));
  for (const run of interrupted) {
    await db.transaction(async tx => {
      const [current] = await tx.select().from(runs)
        .where(and(eq(runs.id, run.id), eq(runs.status, "running"))).for("update");
      if (!current) return;
      const inFlight = await tx.select().from(tasks)
        .where(and(eq(tasks.runId, run.id), eq(tasks.status, "running"))).for("update");
      for (const task of inFlight) {
        await tx.update(tasks).set({ status: "failed", error: "Worker restarted. Retry saved input once.", updatedAt: new Date() })
          .where(and(eq(tasks.id, task.id), eq(tasks.status, "running"), eq(tasks.attempts, task.attempts)));
      }
      await tx.update(runs).set({ status: "failed" })
        .where(and(eq(runs.id, run.id), eq(runs.status, "running")));
    });
  }
}
