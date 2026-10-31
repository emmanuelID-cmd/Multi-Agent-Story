import { queue } from "./queue";
import { executeRun } from "../agents/graph";
import { pool } from "../server/db";
import { recoverInterruptedRuns } from "./recovery";
import { z } from "zod";

const lock=await pool.connect();
const {rows}=await lock.query("SELECT pg_try_advisory_lock(574219) AS acquired");
if(!rows[0].acquired)throw Error("A story worker is already running for this database.");
const boss=await queue();
// A single-worker restart marks interrupted attempts failed; completed outputs stay immutable.
await recoverInterruptedRuns();
await boss.work<{runId:string}>("story-run",{batchSize:1},async jobs=>{
  for(const job of jobs){
    try{
      if(!job.data?.runId || !z.string().uuid().safeParse(job.data.runId).success){
        throw Error("INVALID_RUN_ID: Queue job payload must contain a valid UUID runId.");
      }
      await executeRun(job.data.runId);
    }catch(err){
      console.error("A synthetic run failed; saved work is preserved.", err instanceof Error ? err.message : err);
    }
  }
});
console.log("Synthetic story worker ready. No live model or research requests enabled.");
async function stop(){await boss.stop();await lock.query("SELECT pg_advisory_unlock(574219)");lock.release();await pool.end();process.exit(0);}
process.once("SIGINT",stop);process.once("SIGTERM",stop);
