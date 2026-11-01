import { PgBoss } from "pg-boss";

let boss: PgBoss | undefined;

function getQueueConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return { connectionString: "" };
  try {
    const url = new URL(connectionString);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
    const sslParam = url.searchParams.get("sslmode") || url.searchParams.get("ssl");
    const requiresSsl = sslParam === "require" || sslParam === "true";
    const needsSsl = !isLocal || requiresSsl;
    return {
      connectionString,
      ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    };
  } catch {
    return { connectionString };
  }
}

export async function queue() {
  if (!boss) {
    const instance = new PgBoss(getQueueConfig());
    instance.on("error", () => console.error("Queue connection error. Check local database availability."));
    await instance.start();
    await instance.createQueue("story-run", { retryLimit: 0 });
    boss = instance;
  }
  return boss;
}
export async function enqueue(runId: string) { return (await queue()).send("story-run", { runId }, { singletonKey: runId, retryLimit: 0 }); }
