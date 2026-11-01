import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/server/db";

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL not set; skipping database migrations.");
  process.exit(0);
}

try {
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("Database migrations applied.");
} finally {
  await pool.end();
}
