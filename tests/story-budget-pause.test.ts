import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  state: null as any,
}));

vi.mock("../src/contracts", async () => {
  const actual = await vi.importActual<typeof import("../src/contracts")>("../src/contracts");
  return {
    ...actual,
    canDispatch: vi.fn((usedTokens: number, usedCost: number, estimate?: { tokens: number; cost: number }) =>
      actual.canDispatch(usedTokens, usedCost, estimate)),
  };
});
vi.mock("../src/server/db", () => ({ db: {
  transaction: async (callback: (tx: any) => unknown) => callback(harness.state.api),
} }));
vi.mock("../src/agents/context", () => ({
  buildWriterContext: () => ({ canDispatch: true, bibleVersion: 7, chapterIndex: 1 }),
}));
vi.mock("../src/agents/writers", () => ({
  draftChapter: () => ({ chapterIndex: 1, bibleVersion: 7, text: "Fixture chapter." }),
  draftChapterModel: vi.fn(),
}));
vi.mock("../src/server/story-budget", () => ({ storyWriteModel: vi.fn() }));
vi.mock("../src/server/bible-planning", () => ({
  planningKinds: ["accepted_bible"],
  assertCurrentPlanningApproval: vi.fn(),
}));

import { canDispatch, limits } from "../src/contracts";
import { bibles, chapters, projects, proposals, runs, storyBudgetUsage, tasks } from "../src/server/db/schema";
import { writeChapter } from "../src/agents/graph";

/**
 * Builds one running chapter write with an optional ledger row.
 * The ledger row is present in the fake database only so a test can prove the
 * off switch never asks for it. Callers turn the provision gate on themselves.
 */
function setup(options?: { usedTokens?: number; usage?: Record<string, unknown> | null }) {
  const project = { id: "project-1", ownerId: "owner-1", version: 7, brief: { premise: "A saved idea" } };
  const run = { id: "run-1", projectId: project.id, bibleId: "bible-1", status: "running", canceledAt: null,
    usedTokens: options?.usedTokens ?? 0, fixture: "normal" };
  const bible = { id: "bible-1", projectId: project.id, version: 7, data: { facts: [], beats: [] } };
  const task = { id: "task-1", runId: run.id, chapterIndex: 1, status: "pending", attempts: 0,
    savedInput: { version: 7, bible: bible.data, brief: project.brief } };
  const rows = new Map<any, any[]>([[runs, [run]], [projects, [project]], [bibles, [bible]], [tasks, [task]], [proposals, []], [chapters, []]]);
  if (options?.usage) rows.set(storyBudgetUsage, [{ projectId: project.id, ownerId: project.ownerId, ...options.usage }]);
  const queried: unknown[] = [];
  const api: any = {
    select: () => ({ from: (table: any) => ({ where: () => {
      queried.push(table);
      const result: any = Promise.resolve(rows.get(table) ?? []);
      result.for = async () => rows.get(table) ?? [];
      result.limit = async (n: number) => (rows.get(table) ?? []).slice(0, n);
      return result;
    } }) }),
    update: (table: any) => ({ set: (values: any) => ({ where: async () => {
      const target = rows.get(table)?.[0];
      if (target) Object.assign(target, values);
    } }) }),
    insert: () => ({ values: (value: any) => ({ onConflictDoNothing: () => ({ returning: async () => {
      const list = Array.isArray(value) ? value : [value];
      rows.get(chapters)?.push(...list);
      return list;
    } }) }) }),
  };
  harness.state = { api, run, task, queried };
  return harness.state;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STORY_BUDGET_USAGE_PROVISIONED", "");
  vi.stubEnv("READ_CONNECTIONS_ENABLED", "");
  vi.stubEnv("WRITE_CONNECTIONS_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("story budget pause gate", () => {
  it("does not query story_budget_usage while the provision gate is off", async () => {
    const { run, task, queried } = setup({
      usedTokens: 0,
      usage: { settledTokens: 0, reservedTokens: 0, settledCostMicroUsd: 0, reservedCostMicroUsd: 0, blocked: true },
    });

    await writeChapter("run-1", 1, 0);

    expect(queried).not.toContain(storyBudgetUsage);
    expect(vi.mocked(canDispatch).mock.calls.every((call) => call[0] === 0 && call[1] === 0)).toBe(true);
    expect(run.status).toBe("running");
    expect(task.status).toBe("completed");
  });

  it("pauses from the run token count and a cost of zero while the gate is off", async () => {
    const { run, queried } = setup({
      usedTokens: limits.tokens,
      usage: { settledTokens: 0, reservedTokens: 0, settledCostMicroUsd: 0, reservedCostMicroUsd: 0, blocked: false },
    });

    await writeChapter("run-1", 1, 0);

    expect(queried).not.toContain(storyBudgetUsage);
    expect(vi.mocked(canDispatch).mock.calls.every((call) => call[0] === limits.tokens && call[1] === 0)).toBe(true);
    expect(run.status).toBe("paused");
  });

  it("converts 3_000_000 micro-dollars into 3 dollars before canDispatch when the gate is on", async () => {
    vi.stubEnv("STORY_BUDGET_USAGE_PROVISIONED", "true");
    const { run, task } = setup({
      usedTokens: limits.tokens,
      usage: {
        settledTokens: 0,
        reservedTokens: 0,
        settledCostMicroUsd: 1_000_000,
        reservedCostMicroUsd: 2_000_000,
        blocked: false,
      },
    });

    await writeChapter("run-1", 1, 0);

    expect(vi.mocked(canDispatch).mock.calls.every((call) => call[0] === 0 && call[1] === 3)).toBe(true);
    expect(run.status).toBe("running");
    expect(task.status).toBe("completed");
  });

  it("pauses a blocked ledger row when the gate is on", async () => {
    vi.stubEnv("STORY_BUDGET_USAGE_PROVISIONED", "true");
    const { run, task } = setup({
      usedTokens: 0,
      usage: { settledTokens: 0, reservedTokens: 0, settledCostMicroUsd: 0, reservedCostMicroUsd: 0, blocked: true },
    });

    await writeChapter("run-1", 1, 0);

    expect(run.status).toBe("paused");
    expect(task.status).toBe("pending");
  });

  it("uses the run token count and a cost of zero when the gate is on and the ledger row is missing", async () => {
    vi.stubEnv("STORY_BUDGET_USAGE_PROVISIONED", "true");
    const { run, task, queried } = setup({ usedTokens: 25, usage: null });

    await writeChapter("run-1", 1, 0);

    expect(queried).toContain(storyBudgetUsage);
    expect(vi.mocked(canDispatch).mock.calls.every((call) => call[0] === 25 && call[1] === 0)).toBe(true);
    expect(run.status).toBe("running");
    expect(task.status).toBe("completed");
  });
});
