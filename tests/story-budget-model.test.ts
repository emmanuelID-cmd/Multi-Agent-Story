import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { budgetReadModel, budgetWriteModel, type ModelBudgetLedger } from "../src/server/story-budget-model";
import type { ModelCall, ReadModel } from "../src/agents/read/model";

function fixture() {
  const entries = new Set<string>();
  const ledger: ModelBudgetLedger = {
    reserve: vi.fn(async input => {
      const replayed = entries.has(input.operationId);
      entries.add(input.operationId);
      return { replayed };
    }),
    settle: vi.fn(async () => undefined), markUncertain: vi.fn(async () => undefined), release: vi.fn(async () => undefined),
  };
  const complete = vi.fn(async () => ({ value: { text: "synthetic" }, usage: { inputTokens: 10, outputTokens: 20 } }));
  const model: ReadModel = { modelId: "synthetic", complete };
  const context = { ownerId: "owner", projectId: "story", operationId: "plan:1", ledger };
  const call: ModelCall = { agent: "bible_a", system: "Fixed policy", data: { name: "Élodie" },
    schema: z.object({ text: z.string() }), maxOutputTokens: 100, signal: new AbortController().signal };
  return { ledger, complete, model, context, call };
}

describe("shared story budget model boundary (synthetic)", () => {
  it("reserves before dispatch and settles actual input/output usage", async () => {
    const f = fixture();
    await budgetReadModel(f.model, f.context).complete(f.call);
    expect(f.ledger.reserve).toHaveBeenCalledBefore(f.complete);
    expect(f.complete).toHaveBeenCalledBefore(vi.mocked(f.ledger.settle));
    expect(f.ledger.settle).toHaveBeenCalledWith(expect.objectContaining({ actualInputTokens: 10, actualOutputTokens: 20 }));
    expect(f.ledger.reserve).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "owner", projectId: "story",
      role: "bible_a", estimatedInputTokens: expect.any(Number), overheadTokens: 4096, maxOutputTokens: 100 }));
  });

  it("blocks model dispatch when the durable shared cap is exhausted", async () => {
    const f = fixture();
    vi.mocked(f.ledger.reserve).mockRejectedValue(Error("STORY_BUDGET_EXHAUSTED"));
    await expect(budgetReadModel(f.model, f.context).complete(f.call)).rejects.toThrow("STORY_BUDGET_EXHAUSTED");
    expect(f.complete).not.toHaveBeenCalled();
  });

  it("does not redispatch the same operation after a wrapper/process restart", async () => {
    const f = fixture();
    await budgetReadModel(f.model, f.context).complete(f.call);
    await expect(budgetReadModel(f.model, f.context).complete(f.call)).rejects.toThrow("REPLAY_REQUIRES_RECOVERY");
    const calls = vi.mocked(f.ledger.reserve).mock.calls;
    expect(calls[0][0].operationId).toBe(calls[1][0].operationId);
    expect(calls[0][0].role).toBe(calls[1][0].role);
    expect(f.complete).toHaveBeenCalledTimes(1);
  });

  it("reserves a new operation when the same planning id and role get a changed payload", async () => {
    const f = fixture();
    const wrapped = budgetReadModel(f.model, f.context);
    await wrapped.complete(f.call);
    await wrapped.complete({ ...f.call, data: { name: "Renamed" } });
    const calls = vi.mocked(f.ledger.reserve).mock.calls;
    expect(calls[0][0].operationId).not.toBe(calls[1][0].operationId);
    expect(calls[0][0].role).toBe("bible_a");
    expect(calls[1][0].role).toBe("bible_a");
    expect(f.complete).toHaveBeenCalledTimes(2);
  });

  it("retains uncertain reservations when a provider fails", async () => {
    const f = fixture();
    f.complete.mockRejectedValue(Error("MODEL_UNAVAILABLE"));
    await expect(budgetReadModel(f.model, f.context).complete(f.call)).rejects.toThrow("MODEL_UNAVAILABLE");
    expect(f.ledger.markUncertain).toHaveBeenCalledTimes(1);
    expect(f.ledger.settle).not.toHaveBeenCalled();
  });

  it("rejects malformed usage and preserves the reservation", async () => {
    const f = fixture();
    f.complete.mockResolvedValue({ value: { text: "synthetic" }, usage: { inputTokens: -1, outputTokens: 20 } });
    await expect(budgetReadModel(f.model, f.context).complete(f.call)).rejects.toThrow("MODEL_USAGE_INVALID");
    expect(f.ledger.markUncertain).toHaveBeenCalledTimes(1);
  });

  it("prevents runtime retries from obtaining a fresh reservation after an uncertain call", async () => {
    const f = fixture();
    f.complete.mockRejectedValue(Error("MODEL_UNAVAILABLE"));
    const model = budgetReadModel(f.model, f.context);
    await expect(model.complete(f.call)).rejects.toThrow("MODEL_UNAVAILABLE");
    await expect(model.complete(f.call)).rejects.toThrow("UNCERTAIN_REQUIRES_RECOVERY");
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.ledger.reserve).toHaveBeenCalledTimes(1);
  });

  it("prevents runtime retries from dispatching after a replay refusal", async () => {
    const f = fixture();
    await budgetReadModel(f.model, f.context).complete(f.call);
    const restarted = budgetReadModel(f.model, f.context);
    await expect(restarted.complete(f.call)).rejects.toThrow("REPLAY_REQUIRES_RECOVERY");
    await expect(restarted.complete(f.call)).rejects.toThrow("REPLAY_REQUIRES_RECOVERY");
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.ledger.reserve).toHaveBeenCalledTimes(2);
  });

  it("does not reserve or dispatch an already canceled call", async () => {
    const f = fixture();
    await expect(budgetReadModel(f.model, f.context).complete({ ...f.call, signal: AbortSignal.abort() })).rejects.toThrow("CANCELED");
    expect(f.ledger.reserve).not.toHaveBeenCalled();
    expect(f.complete).not.toHaveBeenCalled();
  });

  it("uses the same owner/story ledger for WRITE without changing its prompt or data", async () => {
    const f = fixture();
    const complete = vi.fn(async () => ({ value: {}, usage: { inputTokens: 5, outputTokens: 10 }, modelUsed: "synthetic-write" }));
    const wrapped = budgetWriteModel({ complete }, f.context, () => "synthetic-write");
    const { agent: _agent, ...shared } = f.call;
    await wrapped.complete({ ...shared, role: "chapter_writer_1", maxOutputTokens: undefined });
    expect(f.ledger.reserve).toHaveBeenCalledWith(expect.objectContaining({ projectId: "story", role: "chapter_writer_1", maxOutputTokens: 4096 }));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ system: f.call.system, data: f.call.data, maxOutputTokens: 4096 }));
  });

  it("keeps independent role calls distinct within one planning operation", async () => {
    const f = fixture();
    const wrapped = budgetReadModel(f.model, f.context);
    await wrapped.complete(f.call);
    await wrapped.complete({ ...f.call, agent: "bible_b" });
    const calls = vi.mocked(f.ledger.reserve).mock.calls;
    expect(calls[0][0].operationId).not.toBe(calls[1][0].operationId);
    expect(calls.every(([input]) => input.projectId === "story")).toBe(true);
  });

  it("marks reservation uncertain when aborted during provider execution and avoids release", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.complete.mockImplementation(async () => {
      controller.abort();
      throw Error("CANCELED");
    });
    await expect(budgetReadModel(f.model, f.context).complete({ ...f.call, signal: controller.signal })).rejects.toThrow("CANCELED");
    expect(f.ledger.markUncertain).toHaveBeenCalled();
    expect(f.ledger.release).not.toHaveBeenCalled();
  });

  it("releases reservation when aborted before provider dispatch without marking uncertain", async () => {
    const f = fixture();
    const controller = new AbortController();
    vi.mocked(f.ledger.reserve).mockImplementation(async () => {
      controller.abort();
      return { replayed: false };
    });
    await expect(budgetReadModel(f.model, f.context).complete({ ...f.call, signal: controller.signal })).rejects.toThrow("CANCELED");
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.ledger.release).toHaveBeenCalled();
    expect(f.ledger.markUncertain).not.toHaveBeenCalled();
  });
});
