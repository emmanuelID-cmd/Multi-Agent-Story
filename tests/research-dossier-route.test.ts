import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({
  calls:[] as string[],sameOrigin:vi.fn<(request:Request)=>void>(),
  intakeJsonBody:vi.fn<()=>Promise<unknown>>(),list:vi.fn<()=>Promise<unknown>>(),detail:vi.fn<()=>Promise<unknown>>(),accept:vi.fn<()=>Promise<unknown>>(),
}));
vi.mock("../src/server/projects", async () => {
  const actual = await import("../src/server/projects");
  return {
    ...actual,
    getProjectById: vi.fn(async (id: string) => {
      if (id !== "project") throw new actual.AppError(404, "Project unavailable.");
      return { id, ownerId: "stored-owner" };
    }),
  };
});
vi.mock("../src/server/http",()=>({
  sameOrigin:mocks.sameOrigin,
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
  mocks.sameOrigin.mockImplementation(()=>{mocks.calls.push("origin");});
  mocks.intakeJsonBody.mockImplementation(async()=>{mocks.calls.push("body");return body;});
  mocks.list.mockImplementation(async()=>{mocks.calls.push("list");return [];});
  mocks.detail.mockImplementation(async()=>{mocks.calls.push("detail");return {id:"candidate"};});
  mocks.accept.mockImplementation(async()=>{mocks.calls.push("accept");return {candidateId:body.candidateId};});
});

describe("research dossier route boundary",()=>{
  it("returns Project unavailable for a missing id and reuses the stored owner",async()=>{
    const missing=await GET(request(),{params:Promise.resolve({id:"missing"})});
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({error:"Project unavailable."});
    expect(mocks.list).not.toHaveBeenCalled();
    expect((await GET(request(),context)).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("stored-owner","project");
    const detail=new Request(`http://localhost:3000/api/projects/project/research?candidateId=${body.candidateId}`);
    expect((await GET(detail,context)).status).toBe(200);
    expect(mocks.detail).toHaveBeenCalledWith("stored-owner","project",body.candidateId);
    const duplicate=new Request(`http://localhost:3000/api/projects/project/research?candidateId=${body.candidateId}&candidateId=${body.operationId}`);
    expect((await GET(duplicate,context)).status).toBe(400);
    expect(mocks.detail).toHaveBeenCalledTimes(1);
  });
  it("returns Project unavailable before origin or parsing, then checks origin",async()=>{
    const missing=await POST(request(),{params:Promise.resolve({id:"missing"})});
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({error:"Project unavailable."});
    expect(mocks.sameOrigin).not.toHaveBeenCalled();
    expect(mocks.intakeJsonBody).not.toHaveBeenCalled();
    mocks.sameOrigin.mockImplementationOnce(()=>{throw Object.assign(new Error("Origin"),{status:403});});
    expect((await POST(request(),context)).status).toBe(403);
    expect(mocks.intakeJsonBody).not.toHaveBeenCalled();
  });
  it("rejects malformed input before the acceptance service and passes the stored owner",async()=>{
    mocks.intakeJsonBody.mockResolvedValueOnce({});
    expect((await POST(request(),context)).status).toBe(400);
    expect(mocks.accept).not.toHaveBeenCalled();
    mocks.intakeJsonBody.mockResolvedValueOnce({...body,ownerId:"forged"});
    expect((await POST(request(),context)).status).toBe(400);
    mocks.intakeJsonBody.mockResolvedValueOnce({...body,approvedSources:[]});
    expect((await POST(request(),context)).status).toBe(400);
    const req=request();
    expect((await POST(req,context)).status).toBe(200);
    expect(mocks.calls.slice(-3)).toEqual(["origin","body","accept"]);
    expect(mocks.accept).toHaveBeenCalledWith("stored-owner","project",body,{signal:req.signal});
  });
});
