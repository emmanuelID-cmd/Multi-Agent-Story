import { queue } from "./queue";
import { executeRun } from "../agents/graph";
import { db, pool } from "../server/db";
import { runs, tasks } from "../server/db/schema";
import { eq, inArray } from "drizzle-orm";

const lock=await pool.connect();
const {rows}=await lock.query("SELECT pg_try_advisory_lock(574219) AS acquired");
if(!rows[0].acquired)throw Error("A story worker is already running for this database.");
const boss=await queue();
// A single-worker restart marks interrupted attempts failed; completed outputs stay immutable.
const interrupted=await db.select().from(runs).where(eq(runs.status,"running"));
for(const run of interrupted){
  await db.update(tasks).set({status:"failed",error:"Worker restarted. Retry saved input once.",updatedAt:new Date()}).where(inArray(tasks.id,(await db.select().from(tasks).where(eq(tasks.runId,run.id))).filter(t=>t.status==="running").map(t=>t.id)));
  await db.update(runs).set({status:"failed"}).where(eq(runs.id,run.id));
}
await boss.work<{runId:string}>("story-run",{batchSize:1},async jobs=>{
  for(const job of jobs){try{await executeRun(job.data.runId);}catch{console.error("A synthetic run failed; saved work is preserved.");}}
});
console.log("Synthetic story worker ready. No live model or research requests enabled.");
async function stop(){await boss.stop();await lock.query("SELECT pg_advisory_unlock(574219)");lock.release();await pool.end();process.exit(0);}
process.once("SIGINT",stop);process.once("SIGTERM",stop);
