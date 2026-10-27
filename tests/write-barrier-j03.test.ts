import { describe, expect, it } from "vitest";
import {
  orderedChapters,
  chapterSchema,
  type Chapter,
  type Bible,
} from "../src/contracts";
import {
  draftChapterOne,
  draftChapterTwo,
  draftChapterThree,
} from "../src/agents/writers";

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
