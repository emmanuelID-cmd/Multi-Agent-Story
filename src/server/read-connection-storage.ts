import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { bibles, chapters, projects, proposals, runs, tasks } from "./db/schema";
import { ReadConnectionError, type ReadConnectionRepository } from "./read-connection-contracts";

export const MAX_READ_CONNECTION_ROWS=200;
/** Short owner/project/run locks. No model or remote work is allowed inside this callback. */
export const dbReadConnectionRepository:ReadConnectionRepository={
  async locked(ownerId,projectId,runId,work){
    return db.transaction(async tx=>{
      await tx.execute(sql`select set_config('statement_timeout', '5000ms', true), set_config('lock_timeout', '5000ms', true)`);
      const [project]=await tx.select().from(projects).where(and(eq(projects.id,projectId),eq(projects.ownerId,ownerId))).for("update");
      if(!project)throw new ReadConnectionError("PROJECT_UNAVAILABLE","retrieval_recovery",404);
      const [run]=await tx.select().from(runs).where(and(eq(runs.id,runId),eq(runs.projectId,projectId))).for("update");
      if(!run)throw new ReadConnectionError("PROJECT_UNAVAILABLE","retrieval_recovery",404);
      const [bible]=await tx.select().from(bibles).where(and(eq(bibles.id,run.bibleId),eq(bibles.projectId,projectId))).limit(1).for("share");
      if(!bible)throw new ReadConnectionError("BIBLE_UNAVAILABLE","retrieval_recovery");
      const chapterRows=await tx.select().from(chapters).where(eq(chapters.runId,runId))
        .orderBy(chapters.chapterIndex,chapters.id).for("share");
      const rows=await tx.select().from(proposals).where(and(eq(proposals.projectId,projectId),
        inArray(proposals.kind,["read_request","read_operation","manuscript_a","manuscript_b"])))
        .orderBy(proposals.id).limit(MAX_READ_CONNECTION_ROWS+1).for("update");
      if(rows.length>MAX_READ_CONNECTION_ROWS)throw new ReadConnectionError("READ_HISTORY_CAPACITY","human_review");
      return work({project,run,bible,chapters:chapterRows,rows,origin:"unverified"},{
        async resolveTarget(targetRunId){
          const [target]=await tx.select().from(runs).where(and(eq(runs.id,targetRunId),eq(runs.projectId,projectId))).for("update");
          if(!target)throw new ReadConnectionError("PROJECT_UNAVAILABLE","retrieval_recovery",404);
          const targetTasks=await tx.select().from(tasks).where(eq(tasks.runId,targetRunId)).orderBy(tasks.chapterIndex).for("share");
          const saved=targetTasks[0]?.savedInput as {readSourceRunId?:string;readSourceProposalIds?:string[];revisionRound?:number;
            editorialInstructions?:string;hasAdditionalInstructions?:boolean}|undefined;
          if(targetTasks.length!==3||targetTasks.some(t=>JSON.stringify(t.savedInput)!==JSON.stringify(targetTasks[0].savedInput)))
            throw new ReadConnectionError("TARGET_SOURCE_ASSIGNMENT_UNAVAILABLE");
          return {run:target,sourceRunId:saved?.readSourceRunId,sourceProposalIds:saved?.readSourceProposalIds,
            editorialRound:saved?.revisionRound,editorialInstructions:saved?.editorialInstructions,hasAdditionalInstructions:saved?.hasAdditionalInstructions};
        },
        async save(row){
          if(!["read_request","read_operation"].includes(row.kind)||row.projectId!==projectId)
            throw new ReadConnectionError("READ_RECORD_SCOPE_INVALID");
          const existing=rows.find(r=>r.id===row.id);
          if(existing){
            if(existing.kind!==row.kind)throw new ReadConnectionError("READ_RECORD_SCOPE_INVALID");
            await tx.update(proposals).set({status:row.status,data:row.data})
              .where(and(eq(proposals.id,row.id),eq(proposals.projectId,projectId),eq(proposals.kind,row.kind)));
          }else{
            if(rows.length>=MAX_READ_CONNECTION_ROWS)throw new ReadConnectionError("READ_HISTORY_CAPACITY");
            await tx.insert(proposals).values(row);
          }
        },
      });
    });
  },
};
