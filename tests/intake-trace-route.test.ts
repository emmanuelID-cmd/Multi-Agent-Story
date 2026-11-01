import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(), update: vi.fn(),
  traces: [] as { id: string; record: ReturnType<typeof vi.fn>; finish: ReturnType<typeof vi.fn>; firstFailure?: string; availability: string }[],
}));
vi.mock("@/contracts/intake", async () => await import("../src/contracts/intake"));
vi.mock("@/server/projects", async () => {
  const actual = await import("../src/server/projects");
  return {
    ...actual,
    getProjectById: vi.fn(async (id: string) => {
      if (id !== "abc") throw new actual.AppError(404, "Project unavailable.");
      return { id, ownerId: "stored-owner" };
    }),
  };
});
vi.mock("@/server/intake-http", async () => await import("../src/server/intake-http"));
vi.mock("@/server/http", () => ({
  sameOrigin: mocks.sameOrigin,
  failure: (error: { status?: number; message?: string }) => Response.json({ error: error.message ?? "Unavailable" }, { status: error.status ?? 503 }),
}));
vi.mock("@/server/intake", () => ({ updateProjectIntake: mocks.update }));
vi.mock("@/server/intake-trace", () => ({ localIntakeTrace: (id: string) => {
  const value = { id, availability: "AVAILABLE", record: vi.fn(function(this: { firstFailure?: string }, _stage: string, code: string) {
    if (!["STARTED", "PASSED", "SUCCEEDED"].includes(code) && !this.firstFailure) this.firstFailure = code;
  }), finish: vi.fn(function(this: { firstFailure?: string }, code: string) { if (code !== "SUCCEEDED" && !this.firstFailure) this.firstFailure = code; }) };
  mocks.traces.push(value);
  return value;
} }));
import { POST } from "../src/app/api/projects/[id]/intake/route";

const request = (body: unknown) => new Request("http://localhost:3000/api/projects/abc/intake", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify(body) });
const context = { params: Promise.resolve({ id: "abc" }) };

describe("intake route trace correlation", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.traces.length = 0; mocks.update.mockReset(); });
  it("returns the same safe ID in the header and successful body", async () => {
    mocks.update.mockResolvedValue({ intake: { status: "analyzed" } });
    const response = await POST(request({ action: "analyze", expectedRevision: 0 }), context);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.traceId).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers.get("x-trace-id")).toBe(body.traceId);
    expect(mocks.update).toHaveBeenCalledWith("stored-owner", "abc", { action: "analyze", expectedRevision: 0 }, expect.objectContaining({ trace: mocks.traces[0] }));
  });
  it("returns request failure code and ID without invoking analysis", async () => {
    const response = await POST(request({ action: "unknown", privateText: "secret-canary" }), context);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.reasonCode).toBe("REQUEST_INVALID");
    expect(body.traceId).toBe(response.headers.get("x-trace-id"));
    expect(JSON.stringify(body)).not.toContain("secret-canary");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("classifies malformed JSON before dispatch and emits one terminal outcome", async () => {
    const malformed = new Request("http://localhost:3000/api/projects/abc/intake", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: "{" });
    const response = await POST(malformed, context);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.reasonCode).toBe("REQUEST_INVALID");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.traces[0].finish).toHaveBeenCalledExactlyOnceWith("REQUEST_INVALID");
  });
  it("returns Project unavailable for a missing id and does not start a trace", async () => {
    const response = await POST(request({ action: "analyze", expectedRevision: 0 }), { params: Promise.resolve({ id: "missing" }) });
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.error).toBe("Project unavailable.");
    expect(mocks.traces).toHaveLength(0);
    expect(response.headers.get("x-trace-id")).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
