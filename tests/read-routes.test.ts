import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requireReadUser: vi.fn<() => Promise<string>>(),
  parseReadVersion: vi.fn<() => number | undefined>(),
  parseBenchmarkBody: vi.fn<() => Promise<unknown>>(),
  verifyBenchmarkOrigin: vi.fn<() => void>(),
  getProjectBenchmarks: vi.fn<() => Promise<unknown>>(),
  readStoryState: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("../src/server/read-http", () => ({
  requireReadUser: mocks.requireReadUser,
  parseReadVersion: mocks.parseReadVersion,
  readFailure: (error: unknown) => Response.json({ error: "Unavailable." }, { status: error instanceof Error && error.message === "auth" ? 401 : 503 }),
}));
vi.mock("../src/server/research/benchmark-http", () => ({
  parseBenchmarkBody: mocks.parseBenchmarkBody,
  verifyBenchmarkOrigin: mocks.verifyBenchmarkOrigin,
  getProjectBenchmarks: mocks.getProjectBenchmarks,
}));
vi.mock("../src/server/read-state", () => ({ readStoryState: mocks.readStoryState }));

import { POST } from "../src/app/api/research/benchmarks/route";
import { GET } from "../src/app/api/projects/[id]/state/route";

const request = new Request("http://localhost:3000/api/research/benchmarks", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.requireReadUser.mockImplementation(async () => { mocks.calls.push("auth"); return "owner"; });
  mocks.verifyBenchmarkOrigin.mockImplementation(() => { mocks.calls.push("origin"); });
  mocks.parseBenchmarkBody.mockImplementation(async () => { mocks.calls.push("body"); return { projectId: "project", genre: "Mystery" }; });
  mocks.getProjectBenchmarks.mockImplementation(async () => { mocks.calls.push("ownership/provider"); return { evidence: [] }; });
  mocks.parseReadVersion.mockImplementation(() => { mocks.calls.push("version"); return undefined; });
  mocks.readStoryState.mockImplementation(async () => { mocks.calls.push("state"); return { status: "unavailable" }; });
});

describe("READ routes authenticate before downstream access", () => {
  it("stops unauthenticated benchmark POST before origin, body, ownership, or provider", async () => {
    mocks.requireReadUser.mockRejectedValueOnce(new Error("auth"));
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(mocks.parseBenchmarkBody).not.toHaveBeenCalled();
    expect(mocks.verifyBenchmarkOrigin).not.toHaveBeenCalled();
    expect(mocks.getProjectBenchmarks).not.toHaveBeenCalled();
  });

  it("authenticates and validates before benchmark service access", async () => {
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mocks.calls).toEqual(["auth", "origin", "body", "ownership/provider"]);
    expect(mocks.getProjectBenchmarks).toHaveBeenCalledWith("owner", { projectId: "project", genre: "Mystery" });
  });

  it("stops unauthenticated story GET before parsing version or reading state", async () => {
    mocks.requireReadUser.mockRejectedValueOnce(new Error("auth"));
    const response = await GET(new Request("http://localhost:3000/api/projects/project/state"), { params: Promise.resolve({ id: "project" }) });
    expect(response.status).toBe(401);
    expect(mocks.parseReadVersion).not.toHaveBeenCalled();
    expect(mocks.readStoryState).not.toHaveBeenCalled();
  });

  it("reads state after session and version parsing", async () => {
    const response = await GET(new Request("http://localhost:3000/api/projects/project/state"), { params: Promise.resolve({ id: "project" }) });
    expect(response.status).toBe(200);
    expect(mocks.calls).toEqual(["auth", "version", "state"]);
    expect(mocks.readStoryState).toHaveBeenCalledWith("owner", "project", undefined);
  });
});
