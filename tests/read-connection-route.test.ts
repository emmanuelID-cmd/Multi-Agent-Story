import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks=vi.hoisted(()=>({user:vi.fn<()=>Promise<string>>(),origin:vi.fn<(r:Request)=>void>(),
  configure:vi.fn(),execute:vi.fn()}));
vi.mock("../src/server/http",()=>({requireUser:mocks.user,sameOrigin:mocks.origin,
  failure:(e:unknown)=>Response.json({error:"Unavailable"},{status:e instanceof z.ZodError?400:
    e instanceof Error&&"status" in e?Number(e.status):503})}));
vi.mock("../src/server/read-connection-http",async original=>({
  ...await original<typeof import("../src/server/read-connection-http")>(),
  configuredReadConnections:mocks.configure,executeReadConnectionAction:mocks.execute,
}));
import { POST } from "../src/app/api/projects/[id]/read/route";
import { readConnectionActionSchema, configuredReadConnections as mockedConfiguration } from "../src/server/read-connection-http";
import { ReadConnectionError } from "../src/server/read-connection-contracts";
const context={params:Promise.resolve({id:"project"})};
const body={action:"reader",runId:"run",requestId:"request",operationId:"reader"};
const request=(data:unknown=body)=>new Request("http://localhost:3000/api/projects/project/read",{
  method:"POST",headers:{"content-type":"application/json",origin:"http://localhost:3000"},body:JSON.stringify(data)});
beforeEach(()=>{
  vi.clearAllMocks();mocks.user.mockResolvedValue("session-owner");mocks.origin.mockImplementation(()=>{});
  mocks.configure.mockReturnValue({trusted:true});mocks.execute.mockResolvedValue({status:"ready_for_review",verifiedLiveProducer:false});
});

describe("authenticated READ connection route",()=>{
  it("authenticates and checks origin before body/configuration or downstream work",async()=>{
    mocks.user.mockRejectedValueOnce(Object.assign(new Error("Sign in"),{status:401}));
    expect((await POST(request(),context)).status).toBe(401);expect(mocks.origin).not.toHaveBeenCalled();
    mocks.origin.mockImplementationOnce(()=>{throw Object.assign(new Error("Origin"),{status:403});});
    expect((await POST(request(),context)).status).toBe(403);
    expect(mocks.configure).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("uses the session owner and bounded actual JSON reader",async()=>{
    const req=request();expect((await POST(req,context)).status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith("session-owner","project",body,{trusted:true});
    expect(mocks.configure).toHaveBeenCalledWith(req.signal);
    expect((await POST(request({text:"x".repeat(80_001)}),context)).status).toBe(400);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it("returns redacted typed unavailable states",async()=>{
    mocks.configure.mockImplementationOnce(()=>{throw new ReadConnectionError("READ_CONNECTIONS_DISABLED");});
    const response=await POST(request(),context);
    expect(response.status).toBe(409);expect(await response.json()).toEqual({error:"READ_CONNECTIONS_DISABLED",route:"human_review"});
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["ownerId","model","budget","sourceText"])("rejects client %s authority at the action schema",field=>{
    expect(readConnectionActionSchema.safeParse({...body,[field]:"forged"}).success).toBe(false);
  });
  it("requires valid stable IDs and limits receiver names",()=>{
    expect(readConnectionActionSchema.safeParse({...body,runId:"../other"}).success).toBe(false);
    expect(readConnectionActionSchema.safeParse({action:"receive_reader",runId:"run",operationId:"reader",editorId:"coordinator"}).success).toBe(false);
  });
  it("keeps live dispatch off by default and requires verified server pricing",async()=>{
    const actual=await vi.importActual<typeof import("../src/server/read-connection-http")>("../src/server/read-connection-http");
    vi.stubEnv("READ_CONNECTIONS_ENABLED","false");
    expect(()=>actual.configuredReadConnections(new AbortController().signal)).toThrow("READ_CONNECTIONS_DISABLED");
    vi.stubEnv("READ_CONNECTIONS_ENABLED","true");vi.stubEnv("READ_INPUT_USD_PER_MILLION","");
    expect(()=>actual.configuredReadConnections(new AbortController().signal)).toThrow("READ_CONFIGURATION_UNAVAILABLE");
    vi.unstubAllEnvs();expect(mockedConfiguration).toBe(mocks.configure);
  });
});
