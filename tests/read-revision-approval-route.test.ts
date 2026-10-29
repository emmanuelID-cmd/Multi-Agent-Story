import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
const mocks=vi.hoisted(()=>({approve:vi.fn()}));
vi.mock("@/server/projects",()=>({projectState:vi.fn(),proposePlan:vi.fn(),approveProposal:vi.fn(),approveManuscriptProposal:mocks.approve,
  rewriteRun:vi.fn(),startRun:vi.fn(),cancelRun:vi.fn(),retryRun:vi.fn(),exportProject:vi.fn(),AppError:Error}));
vi.mock("@/server/http",()=>({requireUser:async()=>"session-owner",sameOrigin:()=>{},
  failure:(error:unknown)=>Response.json({error:"Invalid request"},{status:error instanceof z.ZodError?400:503})}));
import { POST } from "../src/app/api/projects/[id]/route";
import { revisionProposalIds } from "../src/server/read-revision-connection";

describe("actual human approval HTTP schema accepts connected proposal identities",()=>{
  it("accepts both stable UUID proposal IDs through the existing UUID gate and authenticates their recipient",async()=>{
    const ids=revisionProposalIds("target-run");expect(ids).toEqual(revisionProposalIds("target-run"));expect(ids[0]).not.toBe(ids[1]);
    for(const proposalId of ids){
      mocks.approve.mockResolvedValueOnce({id:proposalId,status:"accepted"});
      const response=await POST(new Request("http://localhost:3000/api/projects/project",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"approve-manuscript",proposalId})}),{params:Promise.resolve({id:"project"})});
      expect(response.status).toBe(200);expect(mocks.approve).toHaveBeenLastCalledWith("session-owner","project",proposalId);
    }
    const invalid=await POST(new Request("http://localhost:3000/api/projects/project",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({action:"approve-manuscript",proposalId:"read-proposal:target:a"})}),{params:Promise.resolve({id:"project"})});
    expect(invalid.status).toBe(400);expect(mocks.approve).toHaveBeenCalledTimes(2);
  });
});
