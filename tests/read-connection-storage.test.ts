import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({rows:[] as unknown[][],locks:[] as string[],execute:vi.fn(),updates:vi.fn(),inserts:vi.fn()}));
vi.mock("../src/server/db",()=>({db:{transaction:async(work:(tx:unknown)=>Promise<unknown>)=>{
  let index=0;
  const tx={execute:state.execute,select:()=>{
    const result=state.rows[index++];
    const query={from:()=>query,where:()=>query,limit:()=>query,orderBy:()=>query,
      for:async(mode:string)=>{state.locks.push(mode);return result;}};
    return query;
  },update:()=>({set:()=>({where:state.updates})}),insert:()=>({values:state.inserts})};
  return work(tx);
}}}));
import { dbReadConnectionRepository } from "../src/server/read-connection-storage";
beforeEach(()=>{
  vi.clearAllMocks();state.locks.length=0;
  state.rows=[[{id:"project",ownerId:"owner",version:2}],[{id:"run",projectId:"project",bibleId:"bible",status:"completed",canceledAt:null}],
    [{id:"bible",projectId:"project",version:2,data:{}}],[{id:"chapter",runId:"run",chapterIndex:1}],[]];
});
describe("READ repository lock contract (synthetic transaction adapter)",()=>{
  it("resolves the exact target and its server-saved source pointer under run/task locks",async()=>{
    state.rows.push([{id:"target",projectId:"project",bibleId:"bible",status:"paused",canceledAt:null}],
      [1,2,3].map(chapterIndex=>({chapterIndex,savedInput:{readSourceRunId:"run",revisionRound:1,editorialInstructions:"",hasAdditionalInstructions:false}})));
    await dbReadConnectionRepository.locked("owner","project","run",async(_snapshot,writer)=>{
      expect(await writer.resolveTarget!("target")).toMatchObject({run:{id:"target"},sourceRunId:"run",editorialRound:1});
      expect(state.locks).toEqual(["update","update","share","share","update","update","share"]);
    });
  });
  it("locks owned parents and all source rows before exposing the final save boundary",async()=>{
    await dbReadConnectionRepository.locked("owner","project","run",async snapshot=>{
      expect(state.locks).toEqual(["update","update","share","share","update"]);
      expect(state.execute).toHaveBeenCalledOnce();
      expect(snapshot.origin).toBe("unverified");expect(snapshot.run.id).toBe("run");
    });
  });
  it("does not expose run or source rows after missing ownership",async()=>{
    state.rows[0]=[];const work=vi.fn();
    await expect(dbReadConnectionRepository.locked("other","project","run",work)).rejects.toMatchObject({code:"PROJECT_UNAVAILABLE",status:404});
    expect(work).not.toHaveBeenCalled();expect(state.locks).toEqual(["update"]);
  });
});
