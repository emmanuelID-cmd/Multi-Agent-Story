import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
const mocks=vi.hoisted(()=>({approve:vi.fn()}));
vi.mock("@/server/projects",()=>({projectStateById:vi.fn(),getProjectById:vi.fn(async(id:string)=>{
  if(id!=="project")throw Object.assign(new Error("Project unavailable."),{status:404});
  return {id,ownerId:"stored-owner"};
}),proposePlan:vi.fn(),approveProposal:vi.fn(),approveManuscriptProposal:mocks.approve,
  rewriteRun:vi.fn(),startRun:vi.fn(),cancelRun:vi.fn(),retryRun:vi.fn(),exportProject:vi.fn(),AppError:Error}));
vi.mock("@/server/http",()=>({sameOrigin:()=>{},
  failure:(error:unknown)=>Response.json({error:error instanceof Error?error.message:"Invalid request"},{status:error instanceof z.ZodError?400:error instanceof Error&&"status" in error?Number(error.status):503})}));
import { POST } from "../src/app/api/projects/[id]/route";
import { revisionProposalIds } from "../src/server/read-revision-connection";

describe("actual human approval HTTP schema accepts connected proposal identities",()=>{
  it("accepts both stable UUID proposal IDs through the existing UUID gate and authenticates their recipient",async()=>{
    const ids=revisionProposalIds("target-run");expect(ids).toEqual(revisionProposalIds("target-run"));expect(ids[0]).not.toBe(ids[1]);
    for(const proposalId of ids){
      mocks.approve.mockResolvedValueOnce({id:proposalId,status:"accepted"});
      const response=await POST(new Request("http://localhost:3000/api/projects/project",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"approve-manuscript",proposalId})}),{params:Promise.resolve({id:"project"})});
      expect(response.status).toBe(200);expect(mocks.approve).toHaveBeenLastCalledWith("stored-owner","project",proposalId);
    }
    const invalid=await POST(new Request("http://localhost:3000/api/projects/project",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({action:"approve-manuscript",proposalId:"read-proposal:target:a"})}),{params:Promise.resolve({id:"project"})});
    expect(invalid.status).toBe(400);expect(mocks.approve).toHaveBeenCalledTimes(2);
    const missing=await POST(new Request("http://localhost:3000/api/projects/missing",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({action:"approve-manuscript",proposalId:ids[0]})}),{params:Promise.resolve({id:"missing"})});
    expect(missing.status).toBe(404);expect(await missing.json()).toEqual({error:"Project unavailable."});
    expect(mocks.approve).toHaveBeenCalledTimes(2);
  });
});
