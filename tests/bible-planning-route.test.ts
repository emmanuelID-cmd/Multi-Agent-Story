import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  class AppError extends Error { constructor(public status: number, message: string) { super(message); } }
  return { plan: vi.fn(), approve: vi.fn(), origin: vi.fn(), AppError };
});
vi.mock("@/server/projects", () => ({ projectStateById: vi.fn(), getProjectById: vi.fn(async (id: string) => {
  if (id !== "project") throw new mocks.AppError(404, "Project unavailable.");
  return { id, ownerId: "stored-owner" };
}), proposePlan: mocks.plan, approveProposal: mocks.approve,
  approveManuscriptProposal: vi.fn(), rewriteRun: vi.fn(), startRun: vi.fn(), cancelRun: vi.fn(), retryRun: vi.fn(), exportProject: vi.fn(),
  AppError: mocks.AppError }));
vi.mock("@/server/http", () => ({ sameOrigin: mocks.origin,
  failure: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : "Unavailable" }, { status: error && typeof error === "object" && "status" in error ? Number(error.status) : 400 }) }));
import { POST } from "../src/app/api/projects/[id]/route";
const context = { params: Promise.resolve({ id: "project" }) };
const proposalId = "10000000-0000-4000-8000-000000000001";
function request(body: unknown) { return new Request("http://localhost:3000/api/projects/project", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.clearAllMocks(); mocks.plan.mockResolvedValue({}); mocks.approve.mockResolvedValue({}); });
describe("Bible planning route connection", () => {
  it("checks origin, then uses the stored owner for a known story", async () => {
    const req = request({ action: "plan", operationId: proposalId });
    expect((await POST(req, context)).status).toBe(200);
    expect(mocks.plan).toHaveBeenCalledWith("stored-owner", "project", proposalId, req.signal);
    const missing = await POST(request({ action: "plan", operationId: proposalId }), { params: Promise.resolve({ id: "missing" }) });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Project unavailable." });
    expect(mocks.plan).toHaveBeenCalledTimes(1);
    mocks.origin.mockImplementationOnce(() => { throw Object.assign(Error("Origin"), { status: 403 }); });
    expect((await POST(request({ action: "plan" }), context)).status).toBe(403);
    expect(mocks.plan).toHaveBeenCalledTimes(1);
  });
  it("rejects forged owner, budget, tools and research authority before any service call", async () => {
    for (const extra of [{ ownerId: "forged" }, { budget: { maxCostUsd: 1000 } }, { tools: ["approve"] }, { acceptedDossier: {} }])
      expect((await POST(request({ action: "plan", operationId: proposalId, ...extra }), context)).status).toBe(400);
    expect(mocks.plan).not.toHaveBeenCalled();
  });
  it("requires explicit duplicate-usage confirmation and authenticates retry ownership", async () => {
    const retryOfOperationId = "20000000-0000-4000-8000-000000000002";
    for (const confirmDuplicateProviderCall of [false, undefined])
      expect((await POST(request({ action: "retry-bible-planning", operationId: proposalId, retryOfOperationId, confirmDuplicateProviderCall }), context)).status).toBe(400);
    expect(mocks.plan).not.toHaveBeenCalled();
    const req = request({ action: "retry-bible-planning", operationId: proposalId, retryOfOperationId, confirmDuplicateProviderCall: true });
    expect((await POST(req, context)).status).toBe(200);
    expect(mocks.plan).toHaveBeenCalledWith("stored-owner", "project", proposalId, req.signal, retryOfOperationId);
    const missing = await POST(request({ action: "retry-bible-planning", operationId: proposalId, retryOfOperationId, confirmDuplicateProviderCall: true }), { params: Promise.resolve({ id: "missing" }) });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Project unavailable." });
    expect(mocks.plan).toHaveBeenCalledTimes(1);
  });
  it("forwards exact version/hash selection while retaining the legacy ID-only action", async () => {
    expect((await POST(request({ action: "approve", proposalId, proposalVersion: 2, proposalHash: "a".repeat(64) }), context)).status).toBe(200);
    expect(mocks.approve).toHaveBeenLastCalledWith("stored-owner", "project", proposalId, { proposalVersion: 2, proposalHash: "a".repeat(64) });
    expect((await POST(request({ action: "approve", proposalId }), context)).status).toBe(200);
    expect(mocks.approve).toHaveBeenLastCalledWith("stored-owner", "project", proposalId, undefined);
    expect((await POST(request({ action: "approve", proposalId, ownerId: "forged" }), context)).status).toBe(400);
    expect(mocks.approve).toHaveBeenCalledTimes(2);
  });
  it("rejects oversized request data before model or approval work", async () => {
    expect((await POST(request({ action: "plan", extra: "x".repeat(300_000) }), context)).status).toBe(400);
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
  });
});
