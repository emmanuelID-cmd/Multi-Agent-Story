import { Pool, type PoolConfig } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const globals = globalThis as unknown as { storyPool?: Pool };

function getPoolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return { max: 12 };

  try {
    const url = new URL(connectionString);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
    const sslParam = url.searchParams.get("sslmode") || url.searchParams.get("ssl");
    const requiresSsl = sslParam === "require" || sslParam === "true";
    const needsSsl = !isLocal || requiresSsl;
    return {
      connectionString,
      max: 12,
      ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    };
  } catch {
    return { connectionString, max: 12 };
  }
}

export const pool = globals.storyPool ?? new Pool(getPoolConfig());
if (process.env.NODE_ENV !== "production") globals.storyPool = pool;
export const db = drizzle(pool, { schema });
