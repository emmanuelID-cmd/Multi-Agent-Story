import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(async () => "owner"), sameOrigin: vi.fn(), update: vi.fn(),
  traces: [] as { id: string; record: ReturnType<typeof vi.fn>; finish: ReturnType<typeof vi.fn>; firstFailure?: string; availability: string }[],
}));
vi.mock("@/contracts/intake", async () => await import("../src/contracts/intake"));
vi.mock("@/server/projects", async () => await import("../src/server/projects"));
vi.mock("@/server/intake-http", async () => await import("../src/server/intake-http"));
vi.mock("@/server/http", () => ({
  requireUser: mocks.requireUser, sameOrigin: mocks.sameOrigin,
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
  beforeEach(() => { vi.clearAllMocks(); mocks.traces.length = 0; mocks.update.mockReset(); mocks.requireUser.mockResolvedValue("owner"); });
  it("returns the same safe ID in the header and successful body", async () => {
    mocks.update.mockResolvedValue({ intake: { status: "analyzed" } });
    const response = await POST(request({ action: "analyze", expectedRevision: 0 }), context);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.traceId).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers.get("x-trace-id")).toBe(body.traceId);
    expect(mocks.update).toHaveBeenCalledWith("owner", "abc", { action: "analyze", expectedRevision: 0 }, expect.objectContaining({ trace: mocks.traces[0] }));
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
  it("creates no trace before authorization succeeds", async () => {
    mocks.requireUser.mockRejectedValue({ status: 401, message: "Sign in to continue." });
    const response = await POST(request({ action: "analyze", expectedRevision: 0 }), context);
    expect(response.status).toBe(401);
    expect(mocks.traces).toHaveLength(0);
    expect(response.headers.get("x-trace-id")).toBeNull();
  });
});
