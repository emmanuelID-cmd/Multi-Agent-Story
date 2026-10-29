import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { projects, proposals, runs } from "./db/schema";
import { connectionId, readRequestSchema, readResumeSchema, ReadConnectionError } from "./read-connection-contracts";
import { sha256 } from "../agents/read/runtime";

/** Authenticated connection-only resume; never invents instructions or reruns active work. */
export async function resumeReadRevision(ownerId:string,projectId:string,runId:string){
  [ownerId,projectId,runId].forEach(value=>connectionId.parse(value));
  if(process.env.READ_CONNECTIONS_ENABLED!=="true")throw new ReadConnectionError("READ_CONNECTIONS_DISABLED");
  const reserved=await db.transaction(async tx=>{
    const [project]=await tx.select().from(projects).where(and(eq(projects.id,projectId),eq(projects.ownerId,ownerId))).for("update");
    if(!project)throw new ReadConnectionError("PROJECT_UNAVAILABLE","retrieval_recovery",404);
    const [run]=await tx.select().from(runs).where(and(eq(runs.id,runId),eq(runs.projectId,projectId))).for("update");
    if(!run||run.canceledAt||run.status!=="paused")throw new ReadConnectionError("PAUSED_READ_RUN_REQUIRED");
    const records=await tx.select().from(proposals).where(and(eq(proposals.projectId,projectId),eq(proposals.kind,"read_request"))).limit(201);
    if(records.length>200||!records.some(row=>{
      const parsed=readRequestSchema.safeParse(row.data);return parsed.success&&parsed.data.ownerId===ownerId&&
        parsed.data.assignment.targetRunId===runId&&parsed.data.assignment.stateVersion===project.version;
    }))throw new ReadConnectionError("EXPLICIT_AUTHENTICATED_READ_REQUEST_REQUIRED");
    const previous=await tx.select().from(proposals).where(and(eq(proposals.projectId,projectId),eq(proposals.kind,"read_resume"))).limit(201).for("update");
    const targetRecords=records.map(row=>readRequestSchema.safeParse(row.data)).filter(parsed=>parsed.success&&
      parsed.data.ownerId===ownerId&&parsed.data.assignment.targetRunId===runId);
    const intentFingerprint=sha256(JSON.stringify(targetRecords.map(parsed=>parsed.success?parsed.data:null).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))));
    if(previous.length>200||previous.some(row=>{
      const parsed=readResumeSchema.safeParse(row.data);return parsed.success&&parsed.data.runId===runId&&
        (parsed.data.status!=="queued"||parsed.data.intentFingerprint===intentFingerprint);
    }))throw new ReadConnectionError("READ_RESUME_ALREADY_RESERVED");
    const record=readResumeSchema.parse({schemaVersion:1,kind:"read_resume",ownerId,projectId,runId,intentFingerprint,status:"reserved"});
    const id=`read-resume:${runId}:${intentFingerprint}`;
    await tx.insert(proposals).values({id,projectId,baseVersion:project.version,kind:"read_resume",status:"reserved",data:record});
    await tx.update(runs).set({status:"pending"}).where(eq(runs.id,runId));
    return {id,record};
  });
  let effectRef:string|undefined;
  try{
    const queued=await (await import("../worker/queue")).enqueue(runId);
    if(!queued)throw new ReadConnectionError("READ_RESUME_QUEUE_UNCONFIRMED");
    effectRef=queued;
    await db.update(proposals).set({status:"queued",data:{...reserved.record,status:"queued",effectRef}})
      .where(and(eq(proposals.id,reserved.id),eq(proposals.projectId,projectId)));
  }
  catch{
    await db.update(proposals).set({status:"unknown",data:{...reserved.record,status:"unknown",effectRef}})
      .where(and(eq(proposals.id,reserved.id),eq(proposals.projectId,projectId)));
    await db.update(runs).set({status:"paused"}).where(and(eq(runs.id,runId),eq(runs.status,"pending")));
    throw new ReadConnectionError("READ_RESUME_QUEUE_UNAVAILABLE","retrieval_recovery");
  }
  return {runId,status:"pending" as const};
}
