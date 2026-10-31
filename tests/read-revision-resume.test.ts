import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const targetRunId = "a0000000-0000-4000-8000-000000000001";
const state=vi.hoisted(()=>({status:"running",records:[] as unknown[],execute:vi.fn(),enqueue:vi.fn(),barrier:vi.fn(),intake:false,taskUpdates:[] as unknown[]}));
vi.mock("../src/server/read-revision-workflow",()=>({executeReadConnectedRun:state.execute}));
vi.mock("../src/server/bible-planning",()=>({planningKinds:["accepted_bible"],assertCurrentPlanningApproval:state.barrier}));
vi.mock("../src/worker/queue",()=>({enqueue:state.enqueue}));
vi.mock("../src/server/db",()=>{
  let lock:Promise<unknown>=Promise.resolve();
  const api={select:()=>({from:(table:unknown)=>({where:()=>{
    const rows=table===projects?[{id:"project",ownerId:"owner",version:2,brief:state.intake?{intake:{}}:{}}]:table===bibles?
      [{id:"bible",projectId:"project",version:2,data:{}}]:table===runs?
      [{id:"a0000000-0000-4000-8000-000000000001",projectId:"project",bibleId:"bible",usedTokens:0,status:state.status,canceledAt:null}]:table===proposals?state.records:[];
    const query={then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(rows).then(resolve),for:async()=>rows,limit:()=>query};
    return query;
  }})}),update:(table:unknown)=>({set:(values:{status:string;data?:unknown})=>({where:async()=>{
    if(table===runs)state.status=values.status;
    else if(table===tasks)state.taskUpdates.push(values);
    else{const row=state.records.find(r=>(r as {kind?:string}).kind==="read_resume") as {status:string;data:unknown}|undefined;
      if(row){row.status=values.status;row.data=values.data;}}
  }})}),insert:()=>({values:async(row:unknown)=>{state.records.push(row);}})};
  return {db:{...api,transaction:(work:(tx:unknown)=>Promise<unknown>)=>{
    const next=lock.then(()=>work(api));lock=next.catch(()=>{});return next;
  }}};
});
import { bibles, projects, runs, proposals, tasks } from "../src/server/db/schema";
import { executeRun, finishRun, writeChapter } from "../src/agents/graph";
import { resumeReadRevision } from "../src/server/read-revision-resume";

beforeEach(()=>{
  vi.clearAllMocks();state.status="running";state.records=[];state.intake=false;state.taskUpdates=[];state.barrier.mockResolvedValue(undefined);state.enqueue.mockResolvedValue("job");
  vi.stubEnv("READ_CONNECTIONS_ENABLED","true");
  state.execute.mockRejectedValue(new Error("EXPLICIT_AUTHENTICATED_READ_REQUEST_REQUIRED"));
});
afterEach(()=>vi.unstubAllEnvs());
describe("opt-in explicit request scheduling race",()=>{
  it("pauses an early worker without editorial execution and resumes the same run after explicit authenticated authority is recorded",async()=>{
    await finishRun(targetRunId);expect(state.status).toBe("paused");
    await expect(resumeReadRevision("owner","project",targetRunId)).rejects.toMatchObject({code:"EXPLICIT_AUTHENTICATED_READ_REQUEST_REQUIRED"});
    expect(state.enqueue).not.toHaveBeenCalled();expect(state.status).toBe("paused");
    state.records.push({data:{schemaVersion:1,kind:"read_request",ownerId:"owner",projectId:"project",sourceFingerprint:"a".repeat(64),
      draftVersionAuthority:"authenticated_assignment",assignment:{schemaVersion:1,requestId:"human-request",requestVersion:1,
        runId:targetRunId,targetRunId,stateVersion:2,bibleVersion:2,draftVersion:5,editorialRound:0,
        editorialTask:{action:"revise",scope:[1,2,3],expectedOutput:"Two full proposals."},recordedRequest:"",hasAdditionalInstructions:false,source:{kind:"draft"}}}});
    const concurrent=await Promise.allSettled([resumeReadRevision("owner","project",targetRunId),resumeReadRevision("owner","project",targetRunId)]);
    expect(concurrent.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(concurrent.filter(result=>result.status==="rejected")).toHaveLength(1);
    expect(state.enqueue).toHaveBeenCalledExactlyOnceWith(targetRunId);
    await expect(resumeReadRevision("owner","project",targetRunId)).rejects.toMatchObject({code:"PAUSED_READ_RUN_REQUIRED"});
    expect(state.enqueue).toHaveBeenCalledTimes(1);
  });
  it("blocks stale approval before run claim, chapter claim, and READ resume",async()=>{
    state.intake=true; state.barrier.mockRejectedValue(new Error("stale approval"));
    state.status="pending";
    await expect(executeRun(targetRunId,false)).resolves.toBeUndefined();
    expect(state.status).toBe("failed");
    expect(state.taskUpdates).toMatchObject([{status:"failed",error:"Review the current accepted research and approved story bible before retrying this run."}]);
    expect(JSON.stringify(state.taskUpdates)).not.toContain("stale approval");
    state.status="pending";
    await expect(writeChapter(targetRunId,1,0)).rejects.toThrow("stale approval");
    expect(state.status).toBe("pending");
    state.status="paused";
    await expect(resumeReadRevision("owner","project",targetRunId)).rejects.toThrow("stale approval");
    expect(state.status).toBe("paused"); expect(state.records).toHaveLength(0);
    expect(state.enqueue).not.toHaveBeenCalled(); expect(state.barrier).toHaveBeenCalledTimes(3);
  });
  it.each(["throw","unconfirmed"])("retains a paused/unknown reservation if enqueue is %s",async mode=>{
    state.status="paused";state.records.push({data:{schemaVersion:1,kind:"read_request",ownerId:"owner",projectId:"project",sourceFingerprint:"a".repeat(64),
      draftVersionAuthority:"authenticated_assignment",assignment:{schemaVersion:1,requestId:"human-request",requestVersion:1,
        runId:targetRunId,targetRunId,stateVersion:2,bibleVersion:2,draftVersion:5,editorialRound:0,
        editorialTask:{action:"revise",scope:[1,2,3],expectedOutput:"Two proposals."},recordedRequest:"",hasAdditionalInstructions:false,source:{kind:"draft"}}}});
    if(mode==="throw")state.enqueue.mockRejectedValueOnce(new Error("queue unavailable"));else state.enqueue.mockResolvedValueOnce(null);
    await expect(resumeReadRevision("owner","project",targetRunId)).rejects.toMatchObject({code:"READ_RESUME_QUEUE_UNAVAILABLE"});
    expect(state.status).toBe("paused");
    await expect(resumeReadRevision("owner","project",targetRunId)).rejects.toMatchObject({code:"READ_RESUME_ALREADY_RESERVED"});
    expect(state.enqueue).toHaveBeenCalledTimes(1);
  });
});
