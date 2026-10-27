import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({
  calls:[] as string[],requireUser:vi.fn<()=>Promise<string>>(),sameOrigin:vi.fn<(request:Request)=>void>(),
  intakeJsonBody:vi.fn<()=>Promise<unknown>>(),list:vi.fn<()=>Promise<unknown>>(),detail:vi.fn<()=>Promise<unknown>>(),accept:vi.fn<()=>Promise<unknown>>(),
}));
vi.mock("../src/server/http",()=>({
  requireUser:mocks.requireUser,sameOrigin:mocks.sameOrigin,
  failure:(error:unknown)=>Response.json({error:error instanceof Error?error.message:"Unavailable"},
    {status:error instanceof Error&&"status" in error&&typeof error.status==="number"?error.status:503}),
}));
vi.mock("../src/server/intake-http",()=>({intakeJsonBody:mocks.intakeJsonBody}));
vi.mock("../src/server/research/dossier-service",async importOriginal=>({
  ...await importOriginal<typeof import("../src/server/research/dossier-service")>(),
  listResearchCandidates:mocks.list,getResearchCandidate:mocks.detail,acceptResearchCandidate:mocks.accept,
}));

import { GET, POST } from "../src/app/api/projects/[id]/research/route";

const context={params:Promise.resolve({id:"project"})};
const body={candidateId:"11111111-1111-4111-8111-111111111111",candidateVersion:1,
  candidateHash:"a".repeat(64),operationId:"22222222-2222-4222-8222-222222222222"};
const request=()=>new Request("http://localhost:3000/api/projects/project/research",{method:"POST"});
beforeEach(()=>{
  vi.clearAllMocks();mocks.calls.length=0;
  mocks.requireUser.mockImplementation(async()=>{mocks.calls.push("auth");return "owner";});
  mocks.sameOrigin.mockImplementation(()=>{mocks.calls.push("origin");});
  mocks.intakeJsonBody.mockImplementation(async()=>{mocks.calls.push("body");return body;});
  mocks.list.mockImplementation(async()=>{mocks.calls.push("list");return [];});
  mocks.detail.mockImplementation(async()=>{mocks.calls.push("detail");return {id:"candidate"};});
  mocks.accept.mockImplementation(async()=>{mocks.calls.push("accept");return {candidateId:body.candidateId};});
});

describe("research dossier route boundary",()=>{
  it("authenticates GET before reading owned history",async()=>{
    mocks.requireUser.mockRejectedValueOnce(Object.assign(new Error("Sign in"),{status:401}));
    expect((await GET(request(),context)).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    expect((await GET(request(),context)).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("owner","project");
    const detail=new Request(`http://localhost:3000/api/projects/project/research?candidateId=${body.candidateId}`);
    expect((await GET(detail,context)).status).toBe(200);
    expect(mocks.detail).toHaveBeenCalledWith("owner","project",body.candidateId);
    const duplicate=new Request(`http://localhost:3000/api/projects/project/research?candidateId=${body.candidateId}&candidateId=${body.operationId}`);
    expect((await GET(duplicate,context)).status).toBe(400);
    expect(mocks.detail).toHaveBeenCalledTimes(1);
  });
  it("authenticates and checks origin before parsing or accepting",async()=>{
    mocks.requireUser.mockRejectedValueOnce(Object.assign(new Error("Sign in"),{status:401}));
    expect((await POST(request(),context)).status).toBe(401);
    expect(mocks.sameOrigin).not.toHaveBeenCalled();
    expect(mocks.intakeJsonBody).not.toHaveBeenCalled();
    mocks.sameOrigin.mockImplementationOnce(()=>{throw Object.assign(new Error("Origin"),{status:403});});
    expect((await POST(request(),context)).status).toBe(403);
    expect(mocks.intakeJsonBody).not.toHaveBeenCalled();
  });
  it("rejects malformed input before the acceptance service and passes authenticated identity",async()=>{
    mocks.intakeJsonBody.mockResolvedValueOnce({});
    expect((await POST(request(),context)).status).toBe(400);
    expect(mocks.accept).not.toHaveBeenCalled();
    mocks.intakeJsonBody.mockResolvedValueOnce({...body,ownerId:"forged"});
    expect((await POST(request(),context)).status).toBe(400);
    mocks.intakeJsonBody.mockResolvedValueOnce({...body,approvedSources:[]});
    expect((await POST(request(),context)).status).toBe(400);
    const req=request();
    expect((await POST(req,context)).status).toBe(200);
    expect(mocks.calls.slice(-4)).toEqual(["auth","origin","body","accept"]);
    expect(mocks.accept).toHaveBeenCalledWith("owner","project",body,{signal:req.signal});
  });
});
