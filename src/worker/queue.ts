import { PgBoss } from "pg-boss";
let boss: PgBoss | undefined;
export async function queue() {
  if (!boss) {
    const instance = new PgBoss({ connectionString: process.env.DATABASE_URL! });
    instance.on("error", () => console.error("Queue connection error. Check local database availability."));
    await instance.start();
    await instance.createQueue("story-run", { retryLimit: 0 });
    boss = instance;
  }
  return boss;
}
export async function enqueue(runId: string) { return (await queue()).send("story-run", { runId }, { singletonKey: runId, retryLimit: 0 }); }
