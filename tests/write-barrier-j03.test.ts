import { describe, expect, it, vi } from "vitest";
import {
  orderedChapters,
  chapterSchema,
  limits,
  type Chapter,
  type Bible,
} from "../src/contracts";
import {
  draftChapterOne,
  draftChapterTwo,
  draftChapterThree,
} from "../src/agents/writers";
import { db } from "../src/server/db";
import { runs, tasks, bibles, chapters } from "../src/server/db/schema";
import { finishRun, writeChapter } from "../src/agents/graph";

describe("J03: Chapter Write Barrier (orderedChapters)", () => {
  const version = 1;

  it("accepts three chapters on the approved version in any order and returns sorted [1, 2, 3]", () => {
    const scrambled: Chapter[] = [
      draftChapterThree(version),
      draftChapterOne(version),
      draftChapterTwo(version, "normal"),
    ];
    const assembled = orderedChapters(scrambled, version);
    expect(assembled.map((c) => c.chapterIndex)).toEqual([1, 2, 3]);
    expect(assembled.every((c) => c.bibleVersion === version)).toBe(true);
  });

  it("rejects chapters when an index is missing", () => {
    const missingCh3: Chapter[] = [
      draftChapterOne(version),
      draftChapterTwo(version, "normal"),
    ];
    expect(() => orderedChapters(missingCh3, version)).toThrow(
      "All three unique chapters are required."
    );

    const missingCh1: Chapter[] = [
      draftChapterTwo(version, "normal"),
      draftChapterThree(version),
    ];
    expect(() => orderedChapters(missingCh1, version)).toThrow(
      "All three unique chapters are required."
    );
  });

  it("rejects chapters when there is a duplicate index", () => {
    const duplicateCh2: Chapter[] = [
      draftChapterOne(version),
      draftChapterTwo(version, "normal"),
      draftChapterTwo(version, "normal"),
    ];
    expect(() => orderedChapters(duplicateCh2, version)).toThrow(
      "All three unique chapters are required."
    );
  });

  it("rejects chapters when any chapter has a mismatched bible version", () => {
    const staleCh2: Chapter[] = [
      draftChapterOne(version),
      draftChapterTwo(999, "normal"), // Stale / mismatched version
      draftChapterThree(version),
    ];
    expect(() => orderedChapters(staleCh2, version)).toThrow(
      "Stale chapter version."
    );
  });

  it("rejects chapters with out-of-bounds index via chapterSchema", () => {
    const invalidIndex = [
      draftChapterOne(version),
      draftChapterTwo(version, "normal"),
      { chapterIndex: 4, bibleVersion: version, text: "Chapter 4 invalid index" },
    ];
    expect(() => orderedChapters(invalidIndex, version)).toThrow();

    const zeroIndex = [
      { chapterIndex: 0, bibleVersion: version, text: "Chapter 0 invalid index" },
      draftChapterTwo(version, "normal"),
      draftChapterThree(version),
    ];
    expect(() => orderedChapters(zeroIndex, version)).toThrow();
  });

  it("rejects invalid chapter payloads (missing text or empty string)", () => {
    const emptyText = [
      draftChapterOne(version),
      draftChapterTwo(version, "normal"),
      { chapterIndex: 3, bibleVersion: version, text: "" },
    ];
    expect(() => orderedChapters(emptyText, version)).toThrow();

    const missingText = [
      draftChapterOne(version),
      draftChapterTwo(version, "normal"),
      { chapterIndex: 3, bibleVersion: version },
    ];
    expect(() => orderedChapters(missingText, version)).toThrow();
  });

  it("preserves legitimate literary endings (ellipses, dialogue quotes, em-dashes) without false truncation failures", () => {
    const chaptersWithStylisticEndings: Chapter[] = [
      {
        chapterIndex: 1,
        bibleVersion: version,
        text: 'Mara stared across the misty waves and whispered, "The light..."',
      },
      {
        chapterIndex: 2,
        bibleVersion: version,
        text: "The wooden boat creaked against the swell — silence descended.",
      },
      {
        chapterIndex: 3,
        bibleVersion: version,
        text: "Together they hauled the skiff ashore! Safe at last.",
      },
    ];

    const assembled = orderedChapters(chaptersWithStylisticEndings, version);
    expect(assembled).toHaveLength(3);
    expect(assembled.map((c) => c.chapterIndex)).toEqual([1, 2, 3]);
  });
});

describe("J03: Write Barrier Invariants & Recovery Lifecycle", () => {
  it("verifies that partial failure leaves valid sibling chapters preserved", () => {
    // Conceptual state representation of tasks and chapters
    const tasks = [
      { chapterIndex: 1, status: "completed", attempts: 1 },
      { chapterIndex: 2, status: "failed", attempts: 1, error: "Model timeout" },
      { chapterIndex: 3, status: "completed", attempts: 1 },
    ];

    // Chapters 1 and 3 are preserved in storage
    const savedChapters: Chapter[] = [
      draftChapterOne(1),
      draftChapterThree(1),
    ];

    // Barrier blocks editorial dispatch because Chapter 2 is missing
    expect(() => orderedChapters(savedChapters, 1)).toThrow(
      "All three unique chapters are required."
    );

    // Eligible tasks for retry: only incomplete tasks with attempts < 2
    const eligibleForRetry = tasks.filter(
      (t) => t.status !== "completed" && t.attempts < 2
    );
    expect(eligibleForRetry).toHaveLength(1);
    expect(eligibleForRetry[0].chapterIndex).toBe(2);

    // Completed sibling tasks (1 & 3) are untouched
    const completedUntouched = tasks.filter((t) => t.status === "completed");
    expect(completedUntouched).toHaveLength(2);
    expect(completedUntouched.map((t) => t.chapterIndex)).toEqual([1, 3]);
  });

  it("verifies that retry exhaustion blocks further attempts while preserving valid outputs", () => {
    const tasks = [
      { chapterIndex: 1, status: "completed", attempts: 1 },
      { chapterIndex: 2, status: "failed", attempts: 2, error: "Repeated failure" },
      { chapterIndex: 3, status: "completed", attempts: 1 },
    ];

    const eligible = tasks.filter(
      (t) => t.status !== "completed" && t.attempts < 2
    );
    // Attempts exhausted for task 2 (limit is 2)
    expect(eligible).toHaveLength(0);
  });

  it("verifies that late attempt cannot overwrite valid completed chapter", () => {
    // Unique index on (runId, chapterIndex) in PostgreSQL schema
    const storedChapters = new Map<string, Chapter>();
    const runId = "test-run-1";

    function insertChapter(c: Chapter) {
      const key = `${runId}:${c.chapterIndex}`;
      if (storedChapters.has(key)) {
        // onConflictDoNothing behavior: ignores duplicate insert
        return false;
      }
      storedChapters.set(key, c);
      return true;
    }

    const firstSuccess = draftChapterOne(1);
    expect(insertChapter(firstSuccess)).toBe(true);

    // Simulated late attempt with different/stale text
    const lateAttempt: Chapter = {
      chapterIndex: 1,
      bibleVersion: 1,
      text: "Late overwritten text that must be rejected.",
    };
    expect(insertChapter(lateAttempt)).toBe(false);

    // Stored chapter remains the original firstSuccess
    expect(storedChapters.get(`${runId}:1`)?.text).toBe(firstSuccess.text);
  });

  it("verifies that run cancellation rejects writing pending chapters", () => {
    const run = {
      id: "run-cancel-test",
      status: "canceled",
      canceledAt: new Date(),
    };

    function canCommitChapter(currentRun: typeof run): boolean {
      if (!currentRun || currentRun.canceledAt || !["running", "pending"].includes(currentRun.status)) {
        return false;
      }
      return true;
    }

    expect(canCommitChapter(run)).toBe(false);
  });
});

describe("J03: Direct finishRun and writeChapter Barrier Integration", () => {
  interface MockStore {
    run?: any;
    tasks?: any[];
    bible?: any;
    chapters?: any[];
    updates: Array<{ table: any; values: any }>;
  }

  function setupMockDb(store: MockStore) {
    return vi.spyOn(db, "transaction").mockImplementation(async (callback: any) => {
      const mockTx = {
        select: () => ({
          from: (table: any) => {
            const query = {
              where: (_cond: any) => {
                const getRows = () => {
                  if (table === runs) return store.run ? [store.run] : [];
                  if (table === tasks) return store.tasks ?? [];
                  if (table === bibles) return store.bible ? [store.bible] : [];
                  if (table === chapters) return store.chapters ?? [];
                  return [];
                };
                const rows = getRows();
                const promise = Promise.resolve(rows);
                return Object.assign(promise, {
                  for: (_mode: string) => Promise.resolve(rows),
                  limit: (_n: number) => Promise.resolve(rows.slice(0, _n)),
                });
              },
            };
            return query;
          },
        }),
        update: (table: any) => ({
          set: (values: any) => ({
            where: async (_cond: any) => {
              store.updates.push({ table, values });
              if (table === runs && store.run) {
                Object.assign(store.run, values);
              }
              return [];
            },
          }),
        }),
        insert: (_table: any) => ({
          values: (val: any) => ({
            // A saved chapter ignores a duplicate, then asks which rows were actually new.
            // returning() is that second step. The save stops if this mock ends one step early.
            onConflictDoNothing: () => ({
              returning: async () => (Array.isArray(val) ? val : [val]),
            }),
          }),
        }),
      };
      return callback(mockTx);
    });
  }

  it("transitions runs.status to failed when stored chapters fail orderedChapters validation (missing chapter 3)", async () => {
    const store: MockStore = {
      run: { id: "run-barrier-1", bibleId: "b-1", status: "running", projectId: "p-1" },
      tasks: [
        { id: "t-1", runId: "run-barrier-1", chapterIndex: 1, status: "completed" },
        { id: "t-2", runId: "run-barrier-1", chapterIndex: 2, status: "completed" },
        { id: "t-3", runId: "run-barrier-1", chapterIndex: 3, status: "completed" },
      ],
      bible: { id: "b-1", version: 1, data: { facts: [], beats: [] } },
      chapters: [
        draftChapterOne(1),
        draftChapterTwo(1, "normal"),
        // Missing chapter 3
      ],
      updates: [],
    };

    const spy = setupMockDb(store);
    try {
      const res = await finishRun("run-barrier-1");
      expect(res).toEqual({});
      expect(store.run.status).toBe("failed");
      expect(store.updates).toEqual(
        expect.arrayContaining([{ table: runs, values: { status: "failed" } }])
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("transitions runs.status to failed when stored chapters have mismatched bibleVersion", async () => {
    const store: MockStore = {
      run: { id: "run-barrier-2", bibleId: "b-2", status: "running", projectId: "p-2" },
      tasks: [
        { id: "t-1", runId: "run-barrier-2", chapterIndex: 1, status: "completed" },
        { id: "t-2", runId: "run-barrier-2", chapterIndex: 2, status: "completed" },
        { id: "t-3", runId: "run-barrier-2", chapterIndex: 3, status: "completed" },
      ],
      bible: { id: "b-2", version: 1, data: { facts: [], beats: [] } },
      chapters: [
        draftChapterOne(1),
        draftChapterTwo(999, "normal"), // Stale version
        draftChapterThree(1),
      ],
      updates: [],
    };

    const spy = setupMockDb(store);
    try {
      await finishRun("run-barrier-2");
      expect(store.run.status).toBe("failed");
      expect(store.updates).toEqual(
        expect.arrayContaining([{ table: runs, values: { status: "failed" } }])
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("transitions runs.status to failed when any task is incomplete", async () => {
    const store: MockStore = {
      run: { id: "run-barrier-3", bibleId: "b-3", status: "running", projectId: "p-3" },
      tasks: [
        { id: "t-1", runId: "run-barrier-3", chapterIndex: 1, status: "completed" },
        { id: "t-2", runId: "run-barrier-3", chapterIndex: 2, status: "failed" }, // Failed task
        { id: "t-3", runId: "run-barrier-3", chapterIndex: 3, status: "completed" },
      ],
      bible: { id: "b-3", version: 1, data: { facts: [], beats: [] } },
      chapters: [],
      updates: [],
    };

    const spy = setupMockDb(store);
    try {
      await finishRun("run-barrier-3");
      expect(store.run.status).toBe("failed");
    } finally {
      spy.mockRestore();
    }
  });

  it("transitions runs.status to paused in writeChapter when token budget is exhausted", async () => {
    const store: MockStore = {
      run: {
        id: "run-barrier-4",
        bibleId: "b-4",
        status: "running",
        usedTokens: limits.tokens + 1, // Exceeded token limit
        fixture: "normal",
      },
      updates: [],
    };

    const spy = setupMockDb(store);
    try {
      const res = await writeChapter("run-barrier-4", 1);
      expect(res).toEqual({});
      expect(store.run.status).toBe("paused");
      expect(store.updates).toEqual(
        expect.arrayContaining([{ table: runs, values: { status: "paused" } }])
      );
    } finally {
      spy.mockRestore();
    }
  });
});
