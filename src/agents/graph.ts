import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Annotation, StateGraph, START, END, MemorySaver, interrupt, Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { and, eq } from "drizzle-orm";
import { db } from "../server/db";
import { runs, tasks, chapters, bibles, critiques, evidence } from "../server/db/schema";
import { chapterSchema, orderedChapters, canDispatch, limits } from "../contracts";
import { getGenreBenchmarks } from "../server/research";
import {buildWriterContext} from "./context";

const State = Annotation.Root({ runId: Annotation<string> });
export async function writeChapter(runId: string, index: number, delayMs = (4-index)*80) {
  const task = await db.transaction(async tx=>{
    const [run]=await tx.select().from(runs).where(eq(runs.id,runId)).for("update");
    if(!run||run.canceledAt||!["running","pending"].includes(run.status))return null;
    if(!canDispatch(run.usedTokens,0)){await tx.update(runs).set({status:"paused"}).where(eq(runs.id,runId));return null;}
    const [task]=await tx.select().from(tasks).where(and(eq(tasks.runId,runId),eq(tasks.chapterIndex,index))).for("update");
    if(!task||task.status==="completed"||task.status==="running"||task.attempts>=2)return null;
    await tx.update(tasks).set({status:"running",attempts:task.attempts+1,updatedAt:new Date()}).where(eq(tasks.id,task.id));
    return {...task,fixture:run.fixture};
  });
  if(!task)return {};
  const started=Date.now();
  try {
    const context=buildWriterContext(task.savedInput,index,task.savedInput.version);
    if(!context.canDispatch)throw Error("INPUT_REVIEW_REQUIRED: review the brief field constraints.");
    const signal=AbortSignal.timeout(limits.timeoutMs);
    await delay(delayMs,undefined,{signal});
    if(task.fixture==="timeout"&&index===2)throw Error("SYNTHETIC_TIMEOUT: chapter 2 timeout fixture. No real model call occurred.");
    const paragraphs=[
      "Mara watched a blue signal blink beyond the lighthouse. She marked its pattern on paper and checked the tide. She could not swim, so she kept clear of the water and prepared the harbor boat. The light was a clue, not a command.",
      task.fixture==="continuity"?"Mara swam toward the signal. This deliberately contradicts approved fact F1 and must remain visible to the continuity critic.":"Mara investigated from the boat, following the marked pattern. A shuttered lantern on the breakwater made the blue signal: it was human-made. She called to the missing sailor and planned a safe approach without entering the water.",
      "Mara secured the boat alongside the breakwater and helped the missing sailor aboard. They returned to the harbor together. The human-made signal had guided the rescue, and the boat had kept her out of the water. She recorded what remained to investigate after everyone was safe.",
    ];
    const output=chapterSchema.parse({chapterIndex:index,bibleVersion:context.bibleVersion,text:`[Synthetic fixture — not model-generated prose]\n\n${paragraphs[index-1]}`});
    await db.transaction(async tx=>{
      const [run]=await tx.select().from(runs).where(eq(runs.id,runId)).for("update");
      if(!run||run.canceledAt||!["running","pending"].includes(run.status))return;
      const [bible]=await tx.select().from(bibles).where(eq(bibles.id,run.bibleId));
      if(!bible||bible.version!==output.bibleVersion)throw Error("Stale bible version.");
      await tx.insert(chapters).values({id:randomUUID(),runId,...output}).onConflictDoNothing();
      await tx.update(tasks).set({status:"completed",error:null,elapsedMs:Date.now()-started,updatedAt:new Date()}).where(eq(tasks.id,task.id));
    });
  }catch(error){
    await db.transaction(async tx=>{const [run]=await tx.select().from(runs).where(eq(runs.id,runId)).for("update");if(!run||run.canceledAt)return;
      await tx.update(tasks).set({status:"failed",error:error instanceof Error?error.message:"Task failed.",elapsedMs:Date.now()-started,updatedAt:new Date()}).where(eq(tasks.id,task.id));
    });
  }
  return {};
}
export async function finishRun(runId: string) {
  return db.transaction(async tx=>{
    const [run]=await tx.select().from(runs).where(eq(runs.id,runId)).for("update");
    if(!run||run.canceledAt||run.status==="paused"||run.status==="completed")return {};
    const all=await tx.select().from(tasks).where(eq(tasks.runId,runId));
    if(all.length!==3||all.some(t=>t.status!=="completed")){await tx.update(runs).set({status:"failed"}).where(eq(runs.id,runId));return {};}
    const [bible]=await tx.select().from(bibles).where(eq(bibles.id,run.bibleId));
    const outputs=orderedChapters(await tx.select().from(chapters).where(eq(chapters.runId,runId)),bible.version);
    const contradiction=outputs.find(c=>c.text.includes("Mara swam"));
    const critique={synthetic:true,revisionRounds:0,continuity:{score:contradiction?2:4,notes:contradiction?[{chapterIndex:2,passage:"Mara swam toward the signal.",severity:"critical",factId:"F1",rationale:"Approved F1 says Mara cannot swim.",proposedEdit:"Mara approached in the boat."}]:[]},style:{score:4,label:"Synthetic fixture score, not evaluated model quality."},pacing:{score:4,label:"Synthetic fixture score, not evaluated model quality."},marketReader:{availability:"unavailable",score:null},unresolvedIssues:contradiction?["Critical continuity contradiction in chapter 2. Revision proposal workflow is deferred beyond this foundation."]:[]};
    await tx.insert(critiques).values({id:randomUUID(),runId,data:critique}).onConflictDoNothing();
    const research=await getGenreBenchmarks(run.fixture);
    await tx.insert(evidence).values(research.map(data=>({id:randomUUID(),projectId:run.projectId,runId,data})));
    await tx.update(runs).set({status:"completed"}).where(eq(runs.id,runId));
    return {};
  });
}
export async function executeRun(runId: string, checkpoint = true) {
  const [run]=await db.select().from(runs).where(eq(runs.id,runId));
  if(!run||run.canceledAt||run.status==="completed")return;
  await db.update(runs).set({status:"running"}).where(and(eq(runs.id,runId),eq(runs.status,"pending")));
  const saver=checkpoint?PostgresSaver.fromConnString(process.env.DATABASE_URL!):undefined;
  try {
    if(saver)await saver.setup();
    const graph=new StateGraph(State)
      .addNode("chapter1",state=>writeChapter(state.runId,1))
      .addNode("chapter2",state=>writeChapter(state.runId,2))
      .addNode("chapter3",state=>writeChapter(state.runId,3))
      .addNode("critique",state=>finishRun(state.runId))
      .addEdge(START,"chapter1").addEdge(START,"chapter2").addEdge(START,"chapter3")
      .addEdge(["chapter1","chapter2","chapter3"],"critique").addEdge("critique",END)
      .compile({checkpointer:saver});
    await graph.invoke({runId},{configurable:{thread_id:runId},maxConcurrency:limits.concurrency});
  }catch{
    await db.update(runs).set({status:"failed"}).where(and(eq(runs.id,runId),eq(runs.status,"running")));
    throw Error("Run interrupted. Saved task inputs and completed outputs remain available.");
  }finally {if(saver)await saver.end();}
}

/** Isolated spike: approval interrupts are resumable and never self-approved. */
export function approvalSpike() {
  const state=Annotation.Root({version:Annotation<number>,approved:Annotation<boolean>});
  return new StateGraph(state).addNode("approval",s=>{
    let answer=interrupt({version:s.version,question:"Approve this exact version?"}) as {approved:boolean;version:number};
    while(answer.version!==s.version||!answer.approved){
      answer=interrupt({version:s.version,question:"Exact-version approval required. Review and approve this version."}) as {approved:boolean;version:number};
    }
    return {approved:true};
  }).addEdge(START,"approval").addEdge("approval",END).compile({checkpointer:new MemorySaver()});
}
export {Command};
