import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Annotation, StateGraph, START, END, MemorySaver, interrupt, Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { and, desc, eq, isNull, like } from "drizzle-orm";
import { db } from "../server/db";
import { runs, tasks, chapters, bibles, critiques, evidence, projects, proposals } from "../server/db/schema";
import { chapterSchema, orderedChapters, canDispatch, limits, type Bible, type Chapter, type Fixture } from "../contracts";
import { getGenreBenchmarks } from "../server/research";
import { buildWriterContext } from "./context";
import { draftChapter } from "./writers";
import { buildFixtureHandoff, validateHandoff, repairFixtureHandoff, type ReaderToEditorHandoff } from "./handoff";
import { criticEditorA, criticEditorB } from "./editors";
import { consistencyShell } from "./consistency-shell";
import { buildManuscriptEnvelope } from "./write/runtime";
import { executeRevisionCycle } from "./write/revision";
import type { WriteModel, WriteModelCall } from "./write/model";
import { matchesCurrentTaskAttempt, matchesTaskAttemptLease, taskAttemptInputHash, taskAttemptOperationId, type TaskAttemptIdentity } from "../server/task-attempt";

const State = Annotation.Root({ runId: Annotation<string> });
export async function writeChapter(runId: string, index: number, delayMs = (4-index)*80) {
  const claim = await db.transaction(async tx=>{
    const [observedRun]=await tx.select().from(runs).where(eq(runs.id,runId));
    if(!observedRun||observedRun.canceledAt||!["running","pending"].includes(observedRun.status))return null;
    if(!canDispatch(observedRun.usedTokens,0)){
      const [lockedRun]=await tx.select().from(runs).where(eq(runs.id,runId)).for("update");
      if(lockedRun&&!lockedRun.canceledAt&&["running","pending"].includes(lockedRun.status)&&!canDispatch(lockedRun.usedTokens,0))
        await tx.update(runs).set({status:"paused"}).where(eq(runs.id,runId));
      return null;
    }
    const [project]=await tx.select().from(projects).where(eq(projects.id,observedRun.projectId)).for("update");
    if(!project)return null;
    const [run]=await tx.select().from(runs).where(eq(runs.id,runId)).for("update");
    if(!run||run.projectId!==project.id||run.canceledAt||!["running","pending"].includes(run.status))return null;
    if(!canDispatch(run.usedTokens,0)){
      await tx.update(runs).set({status:"paused"}).where(eq(runs.id,runId));
      return null;
    }
    const [bible]=await tx.select().from(bibles).where(and(eq(bibles.id,run.bibleId),eq(bibles.projectId,project.id))).for("share");
    const [task]=await tx.select().from(tasks).where(and(eq(tasks.runId,runId),eq(tasks.chapterIndex,index))).for("update");
    const savedInput=task?.savedInput as {version?:unknown}|undefined;
    if(!bible||!task||project.version!==bible.version||savedInput?.version!==bible.version||
      task.status==="completed"||task.status==="running"||task.attempts>=2)return null;
    const attemptNumber=task.attempts+1;
    const identity:TaskAttemptIdentity={
      taskId:task.id,runId:run.id,projectId:project.id,ownerId:project.ownerId,attemptNumber,
      operationId:taskAttemptOperationId(task.id,attemptNumber),projectVersion:project.version,
      bibleId:bible.id,bibleVersion:bible.version,savedInputHash:taskAttemptInputHash(task.savedInput),
    };
    await tx.update(tasks).set({status:"running",attempts:attemptNumber,updatedAt:new Date()}).where(eq(tasks.id,task.id));
    return {task,fixture:run.fixture,identity};
  });
  if(!claim)return {};
  const {task,identity,fixture}=claim;
  const started=Date.now();
  try {
    const context=buildWriterContext(task.savedInput,index,task.savedInput.version);
    if(!context.canDispatch)throw Error("INPUT_REVIEW_REQUIRED: review the brief field constraints.");
    const signal=AbortSignal.timeout(limits.timeoutMs);
    await delay(delayMs,undefined,{signal});
    if(fixture==="timeout"&&index===2)throw Error("SYNTHETIC_TIMEOUT: chapter 2 timeout fixture. No real model call occurred.");
    const output=draftChapter(index, context.bibleVersion, fixture as Fixture);
    await db.transaction(async tx=>{
      const [project]=await tx.select().from(projects).where(eq(projects.id,identity.projectId)).for("update");
      if(!project)return;
      const [run]=await tx.select().from(runs).where(eq(runs.id,identity.runId)).for("update");
      if(!run)return;
      const [taskState]=await tx.select().from(tasks).where(eq(tasks.id,identity.taskId)).for("update");
      if(!taskState)return;
      const [bible]=await tx.select().from(bibles).where(and(eq(bibles.id,run.bibleId),eq(bibles.projectId,project.id))).for("share");
      if(!bible||output.bibleVersion!==identity.bibleVersion||
        !matchesCurrentTaskAttempt(identity,{project,run,bible,task:taskState})){
        if(matchesTaskAttemptLease(identity,taskState))
          await tx.update(tasks).set({status:"failed",error:"STALE_RESULT: Dependencies changed before the result could be committed.",elapsedMs:Date.now()-started,updatedAt:new Date()})
            .where(and(eq(tasks.id,identity.taskId),eq(tasks.status,"running"),eq(tasks.attempts,identity.attemptNumber)));
        return;
      }
      await tx.insert(chapters).values({id:randomUUID(),runId,...output}).onConflictDoNothing();
      await tx.update(tasks).set({status:"completed",error:null,elapsedMs:Date.now()-started,updatedAt:new Date()})
        .where(and(eq(tasks.id,identity.taskId),eq(tasks.status,"running"),eq(tasks.attempts,identity.attemptNumber)));
    });
  }catch(error){
    await db.transaction(async tx=>{
      const [project]=await tx.select().from(projects).where(eq(projects.id,identity.projectId)).for("update");
      if(!project)return;
      const [run]=await tx.select().from(runs).where(eq(runs.id,identity.runId)).for("update");
      if(!run)return;
      const [taskState]=await tx.select().from(tasks).where(eq(tasks.id,identity.taskId)).for("update");
      if(!taskState)return;
      const [bible]=await tx.select().from(bibles).where(and(eq(bibles.id,run.bibleId),eq(bibles.projectId,project.id))).for("share");
      const current=!!bible&&matchesCurrentTaskAttempt(identity,{project,run,bible,task:taskState});
      if(!current&&!matchesTaskAttemptLease(identity,taskState))return;
      await tx.update(tasks).set({status:"failed",error:current?(error instanceof Error?error.message:"Task failed."):"STALE_RESULT: Dependencies changed before the result could be committed.",elapsedMs:Date.now()-started,updatedAt:new Date()})
        .where(and(eq(tasks.id,identity.taskId),eq(tasks.status,"running"),eq(tasks.attempts,identity.attemptNumber)));
    });
  }
  return {};
}
export async function finishRun(runId: string) {
  if(process.env.READ_CONNECTIONS_ENABLED==="true"){
    const watch=watchRevisionCancel(runId);
    try{await (await import("../server/read-revision-workflow")).executeReadConnectedRun(runId,fixtureEditorialModel(),fixtureEditorialModel(),watch.signal);return {};}
    catch(error){
      if(error instanceof Error&&error.message==="EXPLICIT_AUTHENTICATED_READ_REQUEST_REQUIRED"){
        await db.update(runs).set({status:"paused"}).where(and(eq(runs.id,runId),eq(runs.status,"running")));return {};
      }throw error;
    }
    finally{watch.stop();}
  }
  return db.transaction(async tx=>{
    const [run]=await tx.select().from(runs).where(eq(runs.id,runId)).for("update");
    if(!run||run.canceledAt||run.status==="paused"||run.status==="completed")return {};
    const all=await tx.select().from(tasks).where(eq(tasks.runId,runId));
    if(all.length!==3||all.some(t=>t.status!=="completed")){await tx.update(runs).set({status:"failed"}).where(eq(runs.id,runId));return {};}
    const [bible]=await tx.select().from(bibles).where(eq(bibles.id,run.bibleId));
    if(!bible){await tx.update(runs).set({status:"failed"}).where(eq(runs.id,runId));return {};}
    let outputs: ReturnType<typeof orderedChapters>;
    try {
      outputs=orderedChapters(await tx.select().from(chapters).where(eq(chapters.runId,runId)),bible.version);
    } catch {
      await tx.update(runs).set({status:"failed"}).where(eq(runs.id,runId));
      return {};
    }

    const [firstTask]=await tx.select().from(tasks).where(eq(tasks.runId,runId)).limit(1);
    const saved = firstTask?.savedInput as {
      revisionRound?: number;
      editorialInstructions?: string;
      hasAdditionalInstructions?: boolean;
      brief?: { desiredEnding?: string };
      userInstructions?: { recordedRequest?: string };
    } | undefined;
    const revisionRounds = saved?.revisionRound ?? 0;
    // Round 0 records the writer's desired ending. A missing ending fails the run
    // instead of inventing a rescue. Later rounds are saved by the revision cycle.
    const desiredEnding = saved?.brief?.desiredEnding?.trim() ?? "";
    if (revisionRounds === 0 && !desiredEnding) {
      await tx.update(runs).set({ status: "failed" }).where(eq(runs.id, runId));
      return {};
    }
    const recordedRequest = revisionRounds > 0
      ? (saved?.editorialInstructions ?? saved?.userInstructions?.recordedRequest ?? "")
      : desiredEnding;
    const hasAdditionalInstructions = Boolean(saved?.hasAdditionalInstructions);

    // 1. Reader handoff shell and harness validation
    const initialHandoff=buildFixtureHandoff(outputs,bible.version,recordedRequest,revisionRounds,1,hasAdditionalInstructions);
    let validation=validateHandoff(initialHandoff,recordedRequest);
    let validHandoff=initialHandoff;
    if(!validation.valid){
      validHandoff=repairFixtureHandoff(initialHandoff,recordedRequest);
      validation=validateHandoff(validHandoff,recordedRequest);
      if(!validation.valid){
        await tx.update(runs).set({status:"failed"}).where(eq(runs.id,runId));
        return {};
      }
    }

    // 2. Parallel Critic/Editors A & B
    const manuscriptA=criticEditorA(validHandoff,outputs,bible.data);
    const manuscriptB=criticEditorB(validHandoff,outputs,bible.data);

    // Validate both manuscripts before inserting proposals: must be indexes 1, 2, 3 on approved bible version
    try {
      orderedChapters(manuscriptA.chapters, bible.version);
      orderedChapters(manuscriptB.chapters, bible.version);
    } catch {
      await tx.update(runs).set({status:"failed"}).where(eq(runs.id,runId));
      return {};
    }

    // 3. Consistency shell
    const checkA=consistencyShell("manuscript_a");
    const checkB=consistencyShell("manuscript_b");

    // 4. Reject older pending manuscripts for this project before inserting new pair
    await tx.update(proposals)
      .set({ status: "rejected" })
      .where(and(
        eq(proposals.projectId, run.projectId),
        eq(proposals.status, "pending"),
        like(proposals.kind, "manuscript_%")
      ));

    // Store manuscript proposals for Gate #2 review
    const envelopeA = buildManuscriptEnvelope({ runId, baseVersion: bible.version, baseChapters: outputs, manuscript: manuscriptA });
    const envelopeB = buildManuscriptEnvelope({ runId, baseVersion: bible.version, baseChapters: outputs, manuscript: manuscriptB });
    const dataA = { ...manuscriptA, envelope: envelopeA };
    const dataB = { ...manuscriptB, envelope: envelopeB };

    await tx.insert(proposals).values([
      { id:randomUUID(), projectId:run.projectId, baseVersion:bible.version, kind:"manuscript_a", data:dataA },
      { id:randomUUID(), projectId:run.projectId, baseVersion:bible.version, kind:"manuscript_b", data:dataB },
    ]);

    const contradiction=outputs.find(c=>c.text.includes("Mara swam"));
    const critique={
      synthetic:true,
      revisionRounds,
      continuity:{score:contradiction?2:4,notes:contradiction?[{chapterIndex:2,passage:"Mara swam toward the signal.",severity:"critical",factId:"F1",rationale:"Approved F1 says Mara cannot swim.",proposedEdit:"Mara approached in the boat."}]:[]},
      style:{score:4,label:"Synthetic fixture score, not evaluated model quality."},
      pacing:{score:4,label:"Synthetic fixture score, not evaluated model quality."},
      marketReader:{availability:"unavailable",score:null},
      consistency:{versionA:checkA,versionB:checkB},
      unresolvedIssues:[
        ...(contradiction?["Base chapter 2 contains a critical continuity contradiction; resolved in Version A & B proposals."]:[]),
        `Consistency findings: ${checkA.reason}`,
      ],
    };
    await tx.insert(critiques).values({id:randomUUID(),runId,data:critique}).onConflictDoNothing();
    const research=await getGenreBenchmarks(run.fixture);
    await tx.insert(evidence).values(research.map(data=>({id:randomUUID(),projectId:run.projectId,runId,data})));
    await tx.update(runs).set({status:"completed"}).where(eq(runs.id,runId));
    return {};
  });
}
/**
 * Fixture editors for the worker. Their prose comes from the existing Fontaine and Lang
 * fixtures, and the model name says fixture so this path never calls a live provider.
 * Tests and the sandbox pass their own models into the revision cycle instead.
 */
function fixtureEditorialModel(): WriteModel {
  return {
    async complete(call: WriteModelCall) {
      if (call.signal.aborted) {
        const reason = call.signal.reason;
        throw reason instanceof Error ? reason : new DOMException("Operation canceled.", "AbortError");
      }
      const data = call.data as {
        bibleVersion?: number;
        approvedFacts?: Bible["facts"];
        baseChapters?: Array<{ chapterIndex: number; text: string; bibleVersion?: number }>;
        readerHandoff?: ReaderToEditorHandoff;
      };
      if (call.role !== "critic_editor_a" && call.role !== "critic_editor_b") {
        throw new Error(`Fixture editorial model cannot write ${call.role}.`);
      }
      if (!data.readerHandoff) {
        throw new Error("Fixture editor is missing the reader handoff.");
      }
      const bibleVersion = data.bibleVersion ?? data.readerHandoff.version.bibleVersion;
      const reading = orderedChapters(
        (data.baseChapters ?? []).map((chapter) => ({
          chapterIndex: chapter.chapterIndex,
          bibleVersion,
          text: chapter.text,
        })),
        bibleVersion
      );
      const bible = { facts: data.approvedFacts ?? [], beats: [] } as Bible;
      const manuscript = call.role === "critic_editor_a"
        ? criticEditorA(data.readerHandoff, reading, bible)
        : criticEditorB(data.readerHandoff, reading, bible);
      return {
        value: {
          rationale: manuscript.rationale,
          chapters: manuscript.chapters.map((chapter) => ({
            chapterIndex: chapter.chapterIndex,
            text: chapter.text,
          })),
          changesMade: manuscript.changesMade,
        },
        usage: { inputTokens: 0, outputTokens: 0 },
        modelUsed: call.role === "critic_editor_a" ? "fixture-editor-fontaine" : "fixture-editor-lang",
      };
    },
  };
}

/** Pull chapter text out of a stored manuscript proposal so an editor can revise that copy. */
function chaptersFromManuscript(data: unknown, bibleVersion: number): Chapter[] {
  const chaptersOnProposal = (data as { chapters?: unknown[] } | null)?.chapters ?? [];
  return orderedChapters(chaptersOnProposal, bibleVersion);
}

/** Mark a revision failed only while it is still running, so a finished or canceled run stays as it is. */
async function markRevisionFailed(runId: string) {
  await db.update(runs).set({ status: "failed" }).where(and(eq(runs.id, runId), eq(runs.status, "running")));
}

/**
 * Stop the editors if the writer cancels the run, or if this revision runs past the same
 * time limit as a chapter task. Call stop() when the revision finishes so the check ends.
 */
function watchRevisionCancel(runId: string): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  const timeout = AbortSignal.timeout(limits.timeoutMs);
  const abortFromTimeout = () => {
    const reason = timeout.reason instanceof Error
      ? timeout.reason
      : new DOMException("The revision timed out.", "TimeoutError");
    controller.abort(reason);
  };
  if (timeout.aborted) abortFromTimeout();
  else timeout.addEventListener("abort", abortFromTimeout, { once: true });

  const timer = setInterval(() => {
    void db.select().from(runs).where(eq(runs.id, runId)).then(([row]) => {
      if (!row || row.canceledAt || row.status === "canceled") {
        controller.abort(new DOMException("Operation canceled.", "AbortError"));
      }
    }).catch(() => {
      controller.abort(new DOMException("Operation canceled.", "AbortError"));
    });
  }, 250);

  return {
    signal: controller.signal,
    stop() {
      clearInterval(timer);
      timeout.removeEventListener("abort", abortFromTimeout);
    },
  };
}

/**
 * Rounds 1 and 2 skip the three writers. The editors run outside a database transaction,
 * then one short save stores the source chapters, both pending proposals, the finished tasks,
 * and the swim-rule critique together. The previous proposals are rejected only in that save.
 */
async function executeRequestedRevision(
  run: { id: string; projectId: string; bibleId: string },
  runTasks: Array<{
    id: string;
    savedInput: {
      revisionRound?: number;
      editorialInstructions?: string;
      hasAdditionalInstructions?: boolean;
      brief?: { desiredEnding?: string };
    };
  }>,
  revisionRound: number
) {
  const saved = runTasks[0]?.savedInput;
  const cancelWatch = watchRevisionCancel(run.id);
  try {
  if(process.env.READ_CONNECTIONS_ENABLED==="true"){
    await (await import("../server/read-revision-workflow")).executeReadConnectedRun(run.id,fixtureEditorialModel(),fixtureEditorialModel(),cancelWatch.signal);
    return;
  }
  // Count this attempt before the editors run, so a failed revision uses the one-retry limit.
  for (const task of runTasks) {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    if (!row || row.attempts >= 2) {
      throw new Error("The one-retry limit has been reached for this revision.");
    }
    await db.update(tasks).set({
      status: "running",
      attempts: row.attempts + 1,
      updatedAt: new Date(),
    }).where(eq(tasks.id, task.id));
  }

  const [bible] = await db.select().from(bibles).where(eq(bibles.id, run.bibleId));
  if (!bible) {
    throw new Error("Approved bible is missing, so this revision was not saved.");
  }

  const completed = await db
    .select()
    .from(runs)
    .where(and(eq(runs.projectId, run.projectId), eq(runs.status, "completed")))
    .orderBy(desc(runs.createdAt));
  const previous = completed.find((item) => item.id !== run.id);
  if (!previous) {
    throw new Error("A completed draft is required before a revision can start.");
  }

  const previousRows = await db.select().from(chapters).where(eq(chapters.runId, previous.id));
  const draftChapters = orderedChapters(
    previousRows.map((row) => ({
      chapterIndex: row.chapterIndex,
      bibleVersion: row.bibleVersion,
      text: row.text,
    })),
    bible.version
  );

  let readingA = draftChapters;
  let readingB = draftChapters;
  if (revisionRound === 2) {
    const pending = await db
      .select()
      .from(proposals)
      .where(and(
        eq(proposals.projectId, run.projectId),
        eq(proposals.status, "pending"),
        like(proposals.kind, "manuscript_%")
      ))
      .orderBy(desc(proposals.createdAt));
    const manuscriptA = pending.find((item) => item.kind === "manuscript_a");
    const manuscriptB = pending.find((item) => item.kind === "manuscript_b");
    if (!manuscriptA || !manuscriptB) {
      throw new Error("Round 2 needs each editor's previous proposal.");
    }
    readingA = chaptersFromManuscript(manuscriptA.data, bible.version);
    readingB = chaptersFromManuscript(manuscriptB.data, bible.version);
  }

  const [fresh] = await db.select().from(runs).where(eq(runs.id, run.id));
  if (!fresh || fresh.canceledAt || fresh.status === "canceled") {
    throw new Error("This revision was canceled before the editors ran.");
  }

  const fixtureModel = fixtureEditorialModel();
  const cycle = await executeRevisionCycle({
      runId: run.id,
      projectId: run.projectId,
      bibleVersion: bible.version,
      approvedBible: bible.data,
      baseChapters: draftChapters,
      baseChaptersA: readingA,
      baseChaptersB: readingB,
      // Each envelope records the chapters that editor read. The run still stores
      // one draft copy, and draftChapterHashes are what acceptance checks on the rows.
      revisionRound,
      editorialInstructions: saved?.editorialInstructions ?? "",
      hasAdditionalInstructions: Boolean(saved?.hasAdditionalInstructions),
      modelA: fixtureModel,
      modelB: fixtureModel,
      signal: cancelWatch.signal,
    });
    if (cancelWatch.signal.aborted) {
      const reason = cancelWatch.signal.reason;
      throw reason instanceof Error ? reason : new DOMException("Operation canceled.", "AbortError");
    }

    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(runs).where(eq(runs.id, run.id)).for("update");
      if (!locked || locked.canceledAt || !["running", "pending"].includes(locked.status)) return;

      await tx.update(proposals)
        .set({ status: "rejected" })
        .where(and(
          eq(proposals.projectId, run.projectId),
          eq(proposals.status, "pending"),
          like(proposals.kind, "manuscript_%")
        ));

      await tx.insert(chapters).values(draftChapters.map((chapter) => ({
        id: randomUUID(),
        runId: run.id,
        chapterIndex: chapter.chapterIndex,
        bibleVersion: chapter.bibleVersion,
        text: chapter.text,
      })));

      for (const task of runTasks) {
        await tx.update(tasks).set({
          status: "completed",
          error: null,
          updatedAt: new Date(),
        }).where(eq(tasks.id, task.id));
      }

      const [proposalA, proposalB] = cycle.proposals;
      await tx.insert(proposals).values([
        {
          id: proposalA.id,
          projectId: run.projectId,
          baseVersion: bible.version,
          kind: "manuscript_a",
          status: "pending",
          data: proposalA.manuscript,
        },
        {
          id: proposalB.id,
          projectId: run.projectId,
          baseVersion: bible.version,
          kind: "manuscript_b",
          status: "pending",
          data: proposalB.manuscript,
        },
      ]);

      // Keep the swim-rule result as returned. Do not copy the unavailable shell
      // into this critique, and do not relabel a finding as complete.
      await tx.insert(critiques).values({
        id: randomUUID(),
        runId: run.id,
        data: {
          synthetic: true,
          revisionRounds: revisionRound,
          consistency: {
            label: "swim-rule heuristic",
            versionA: proposalA.consistency,
            versionB: proposalB.consistency,
          },
          unresolvedIssues: [
            "Consistency on this revision is a swim-rule heuristic. READ consistency is not connected.",
            ...cycle.unresolvedIssues,
          ],
        },
      }).onConflictDoNothing();

      await tx.update(runs).set({ status: "completed" }).where(eq(runs.id, run.id));
    });
    const [savedRun] = await db.select().from(runs).where(eq(runs.id, run.id));
    if (savedRun?.status === "running") {
      throw new Error("This revision stopped before it was saved.");
    }
  } catch (error) {
    if(process.env.READ_CONNECTIONS_ENABLED==="true"&&error instanceof Error&&error.message==="EXPLICIT_AUTHENTICATED_READ_REQUEST_REQUIRED"){
      await db.update(runs).set({status:"paused"}).where(and(eq(runs.id,run.id),eq(runs.status,"running")));return;
    }
    await markRevisionFailed(run.id);
    throw error;
  } finally {
    cancelWatch.stop();
  }
}

export async function executeRun(runId: string, checkpoint = true) {
  const [run]=await db.update(runs).set({status:"running"})
    .where(and(eq(runs.id,runId),eq(runs.status,"pending"),isNull(runs.canceledAt)))
    .returning();
  // Queue deliveries can outlive an interrupted worker. Only an explicit
  // retry may move a failed run back to pending and authorize execution.
  if(!run||run.canceledAt)return;
  const runTasks = await db.select().from(tasks).where(eq(tasks.runId, runId));
  const revisionRound = (runTasks[0]?.savedInput as { revisionRound?: number } | undefined)?.revisionRound ?? 0;
  // Round 0 keeps the fixture writers and finishRun. Rounds 1 and 2 revise instead.
  if (revisionRound === 1 || revisionRound === 2) {
    await executeRequestedRevision(run, runTasks, revisionRound);
    return;
  }
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
