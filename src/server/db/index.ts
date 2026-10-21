import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
const globals = globalThis as unknown as { storyPool?: Pool };
export const pool = globals.storyPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
if (process.env.NODE_ENV !== "production") globals.storyPool = pool;
export const db = drizzle(pool, { schema });
