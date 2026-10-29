import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({status:"running",records:[] as unknown[],execute:vi.fn(),enqueue:vi.fn()}));
vi.mock("../src/server/read-revision-workflow",()=>({executeReadConnectedRun:state.execute}));
vi.mock("../src/worker/queue",()=>({enqueue:state.enqueue}));
vi.mock("../src/server/db",()=>{
  let lock:Promise<unknown>=Promise.resolve();
  const api={select:()=>({from:(table:unknown)=>({where:()=>{
    const rows=table===projects?[{id:"project",ownerId:"owner",version:2}]:table===runs?
      [{id:"target",projectId:"project",status:state.status,canceledAt:null}]:table===proposals?state.records:[];
    const query={then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(rows).then(resolve),for:async()=>rows,limit:()=>query};
    return query;
  }})}),update:(table:unknown)=>({set:(values:{status:string;data?:unknown})=>({where:async()=>{
    if(table===runs)state.status=values.status;
    else{const row=state.records.find(r=>(r as {kind?:string}).kind==="read_resume") as {status:string;data:unknown}|undefined;
      if(row){row.status=values.status;row.data=values.data;}}
  }})}),insert:()=>({values:async(row:unknown)=>{state.records.push(row);}})};
  return {db:{...api,transaction:(work:(tx:unknown)=>Promise<unknown>)=>{
    const next=lock.then(()=>work(api));lock=next.catch(()=>{});return next;
  }}};
});
import { projects, runs, proposals } from "../src/server/db/schema";
import { finishRun } from "../src/agents/graph";
import { resumeReadRevision } from "../src/server/read-revision-resume";

beforeEach(()=>{
  vi.clearAllMocks();state.status="running";state.records=[];state.enqueue.mockResolvedValue("job");
  vi.stubEnv("READ_CONNECTIONS_ENABLED","true");
  state.execute.mockRejectedValue(new Error("EXPLICIT_AUTHENTICATED_READ_REQUEST_REQUIRED"));
});
afterEach(()=>vi.unstubAllEnvs());
describe("opt-in explicit request scheduling race",()=>{
  it("pauses an early worker without editorial execution and resumes the same run after explicit authenticated authority is recorded",async()=>{
    await finishRun("target");expect(state.status).toBe("paused");
    await expect(resumeReadRevision("owner","project","target")).rejects.toMatchObject({code:"EXPLICIT_AUTHENTICATED_READ_REQUEST_REQUIRED"});
    expect(state.enqueue).not.toHaveBeenCalled();expect(state.status).toBe("paused");
    state.records.push({data:{schemaVersion:1,kind:"read_request",ownerId:"owner",projectId:"project",sourceFingerprint:"a".repeat(64),
      draftVersionAuthority:"authenticated_assignment",assignment:{schemaVersion:1,requestId:"human-request",requestVersion:1,
        runId:"target",targetRunId:"target",stateVersion:2,bibleVersion:2,draftVersion:5,editorialRound:0,
        editorialTask:{action:"revise",scope:[1,2,3],expectedOutput:"Two full proposals."},recordedRequest:"",hasAdditionalInstructions:false,source:{kind:"draft"}}}});
    const concurrent=await Promise.allSettled([resumeReadRevision("owner","project","target"),resumeReadRevision("owner","project","target")]);
    expect(concurrent.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(concurrent.filter(result=>result.status==="rejected")).toHaveLength(1);
    expect(state.enqueue).toHaveBeenCalledExactlyOnceWith("target");
    await expect(resumeReadRevision("owner","project","target")).rejects.toMatchObject({code:"PAUSED_READ_RUN_REQUIRED"});
    expect(state.enqueue).toHaveBeenCalledTimes(1);
  });
  it.each(["throw","unconfirmed"])("retains a paused/unknown reservation if enqueue is %s",async mode=>{
    state.status="paused";state.records.push({data:{schemaVersion:1,kind:"read_request",ownerId:"owner",projectId:"project",sourceFingerprint:"a".repeat(64),
      draftVersionAuthority:"authenticated_assignment",assignment:{schemaVersion:1,requestId:"human-request",requestVersion:1,
        runId:"target",targetRunId:"target",stateVersion:2,bibleVersion:2,draftVersion:5,editorialRound:0,
        editorialTask:{action:"revise",scope:[1,2,3],expectedOutput:"Two proposals."},recordedRequest:"",hasAdditionalInstructions:false,source:{kind:"draft"}}}});
    if(mode==="throw")state.enqueue.mockRejectedValueOnce(new Error("queue unavailable"));else state.enqueue.mockResolvedValueOnce(null);
    await expect(resumeReadRevision("owner","project","target")).rejects.toMatchObject({code:"READ_RESUME_QUEUE_UNAVAILABLE"});
    expect(state.status).toBe("paused");
    await expect(resumeReadRevision("owner","project","target")).rejects.toMatchObject({code:"READ_RESUME_ALREADY_RESERVED"});
    expect(state.enqueue).toHaveBeenCalledTimes(1);
  });
});
