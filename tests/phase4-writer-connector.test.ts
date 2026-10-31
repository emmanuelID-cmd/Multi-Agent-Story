import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z, ZodError } from "zod";

const harness = vi.hoisted(() => ({
  state: null as any,
  modelFactory: vi.fn(),
  modelDraft: vi.fn(),
  fixtureDraft: vi.fn(),
}));

vi.mock("../src/server/db", () => ({ db: {
  transaction: async (callback: (tx: any) => unknown) => callback(harness.state.api),
  select: () => harness.state.api.select(),
} }));
vi.mock("../src/agents/context", () => ({
  buildWriterContext: (saved: any, index: number, version: number) => ({
    canDispatch: true, bibleVersion: version, chapterIndex: index, saved,
  }),
}));
vi.mock("../src/agents/writers", () => ({
  draftChapter: harness.fixtureDraft,
  draftChapterModel: harness.modelDraft,
}));
vi.mock("../src/server/story-budget", () => ({ storyWriteModel: harness.modelFactory }));
vi.mock("../src/server/bible-planning", () => ({
  planningKinds: ["accepted_bible"],
  assertCurrentPlanningApproval: vi.fn(),
}));

import { bibles, chapters, projects, proposals, runs, tasks } from "../src/server/db/schema";
import { writeChapter, executeRun } from "../src/agents/graph";

function setup(intake: boolean) {
  const project = { id: "project-1", ownerId: "owner-1", version: 7,
    brief: { premise: "A saved idea", ...(intake ? { intake: { text: "A saved idea" } } : {}) } };
  const run = { id: "run-1", projectId: project.id, bibleId: "bible-1", status: "running", canceledAt: null, usedTokens: 0, fixture: "continuity" };
  const bible = { id: "bible-1", projectId: project.id, version: 7, data: { facts: [], beats: [] } };
  const task = { id: "task-2", runId: run.id, chapterIndex: 2, status: "pending", attempts: 0,
    savedInput: { version: 7, bible: bible.data, brief: project.brief } };
  const rows = new Map<any, any[]>([[runs, [run]], [projects, [project]], [bibles, [bible]], [tasks, [task]], [proposals, []], [chapters, []]]);
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  const api: any = {
    select: () => ({ from: (table: any) => ({ where: () => {
      const result: any = Promise.resolve(rows.get(table) ?? []);
      result.for = async () => rows.get(table) ?? [];
      result.limit = async (n: number) => (rows.get(table) ?? []).slice(0, n);
      return result;
    } }) }),
    update: (table: any) => ({ set: (values: any) => ({ where: async () => {
      updates.push({ table, values });
      const target = rows.get(table)?.[0];
      if (!target) return;
      const next = { ...values };
      if (next.usedTokens !== undefined && typeof next.usedTokens !== "number") delete next.usedTokens;
      Object.assign(target, next);
    } }) }),
    insert: (table: any) => ({ values: (value: any) => {
      const list = Array.isArray(value) ? value : [value];
      return { onConflictDoNothing: () => ({ returning: async () => {
        const existing = rows.get(table) ?? [];
        const fresh = list.filter((row: any) => !existing.some((saved: any) => saved.runId === row.runId && saved.chapterIndex === row.chapterIndex));
        existing.push(...fresh);
        rows.set(table, existing);
        return fresh;
      } }) };
    } }),
  };
  harness.state = { api, project, run, bible, task, rows, updates };
  return harness.state;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("READ_CONNECTIONS_ENABLED", "true");
  harness.modelFactory.mockReturnValue({ invoke: vi.fn() });
  harness.modelDraft.mockResolvedValue({ chapter: { chapterIndex: 2, bibleVersion: 7, text: "Model chapter." } });
  harness.fixtureDraft.mockReturnValue({ chapterIndex: 2, bibleVersion: 7, text: "Fixture chapter." });
});
afterEach(() => vi.unstubAllEnvs());

describe("Phase 4 writer connector", () => {
  it("dispatches intake projects through the configured model with approved Bible, index, and attempt identity", async () => {
    const { task } = setup(true);
    await writeChapter("run-1", 2, 0);

    expect(harness.modelFactory).toHaveBeenCalledWith("owner-1", "project-1", "task:task-2:attempt:1");
    expect(harness.modelDraft).toHaveBeenCalledWith(expect.objectContaining({
      index: 2, bibleVersion: 7, approvedBible: task.savedInput.bible, brief: task.savedInput.brief,
    }), expect.anything(), expect.any(AbortSignal));
    expect(harness.fixtureDraft).not.toHaveBeenCalled();
    expect(task.status).toBe("completed");
  });

  it("keeps legacy projects on fixture drafting", async () => {
    const { task } = setup(false);
    await writeChapter("run-1", 2, 0);

    expect(harness.fixtureDraft).toHaveBeenCalledWith(2, 7, "continuity");
    expect(harness.modelFactory).not.toHaveBeenCalled();
    expect(harness.modelDraft).not.toHaveBeenCalled();
    expect(task.status).toBe("completed");
  });

  it("fails the task when WRITE model configuration is unavailable without fixture fallback", async () => {
    const { task } = setup(true);
    harness.modelFactory.mockImplementation(() => { throw new Error("WRITE_MODEL_NOT_CONFIGURED"); });

    await writeChapter("run-1", 2, 0);

    expect(harness.modelDraft).not.toHaveBeenCalled();
    expect(harness.fixtureDraft).not.toHaveBeenCalled();
    expect(task.status).toBe("failed");
    expect(task.error).toBe("WRITE_MODEL_NOT_CONFIGURED");
  });

  it("fails the task with BIBLE_FACT_MISMATCH when savedInput facts do not match approved bible", async () => {
    const { task } = setup(false);
    task.savedInput = {
      ...task.savedInput,
      bible: { facts: [{ id: "F1", text: "Tampered fact" }], beats: [] },
    };

    await writeChapter("run-1", 2, 0);

    expect(harness.fixtureDraft).not.toHaveBeenCalled();
    expect(task.status).toBe("failed");
    expect(task.error).toContain("BIBLE_FACT_MISMATCH");
  });

  it("stores a model chapter ZodError as INVALID_CHAPTER_OUTPUT without the raw issue list", async () => {
    const { task, rows } = setup(true);
    let zodError: unknown;
    try {
      z.object({ text: z.string() }).parse({ text: 12 });
    } catch (error) {
      zodError = error;
    }
    const issueList = zodError instanceof Error ? zodError.message : "";
    expect(zodError).toBeInstanceOf(ZodError);
    expect(issueList).toContain("Invalid input: expected string, received number");
    harness.modelDraft.mockRejectedValue(zodError);

    await writeChapter("run-1", 2, 0);

    expect(task.status).toBe("failed");
    expect(task.error).toBe("INVALID_CHAPTER_OUTPUT: Model chapter output failed schema validation.");
    expect(task.error).not.toContain("Invalid input: expected string, received number");
    expect(task.error).not.toContain("invalid_type");
    const storedText = (rows.get(chapters) ?? []).map((row: { text?: string }) => row.text ?? "").join("\n");
    expect(storedText).not.toContain("Invalid input: expected string, received number");
  });

  it("adds provider tokens to the run only when a chapter row is inserted", async () => {
    const state = setup(true);
    harness.modelDraft.mockResolvedValue({
      chapter: { chapterIndex: 2, bibleVersion: 7, text: "Model chapter." },
      usage: { inputTokens: 11, outputTokens: 7 },
    });

    await writeChapter("run-1", 2, 0);
    const tokenWrites = () => state.updates.filter((update) => Object.prototype.hasOwnProperty.call(update.values, "usedTokens"));
    expect(tokenWrites()).toHaveLength(1);

    state.task.status = "pending";
    state.task.attempts = 0;
    await writeChapter("run-1", 2, 0);
    expect(tokenWrites()).toHaveLength(1);
  });

  it("rejects invalid worker runId with INVALID_RUN_ID", async () => {
    for (const invalid of ["undefined", "123", "not-a-uuid", "' OR 1=1 --"]) {
      await expect(executeRun(invalid as any, false)).rejects.toThrow("INVALID_RUN_ID");
    }
  });
});
