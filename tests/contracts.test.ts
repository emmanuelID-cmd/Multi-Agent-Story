import { describe, expect, it } from "vitest";
import { bibleSchema, briefSchema, canDispatch, chapterSchema, limits, orderedChapters } from "../src/contracts";

const bible = {
  facts: [{ id: "F1", text: "Mara cannot swim." }],
  beats: [1, 2, 3].map(chapterIndex => ({ chapterIndex, text: `Beat ${chapterIndex}` })),
};

describe("approved story contracts", () => {
  it("requires a usable brief and one distinct beat for each chapter", () => {
    expect(briefSchema.safeParse({ premise: "short" }).success).toBe(false);
    expect(bibleSchema.safeParse(bible).success).toBe(true);
    expect(bibleSchema.safeParse({ ...bible, beats: [bible.beats[0], bible.beats[0], bible.beats[2]] }).success).toBe(false);
    expect(chapterSchema.safeParse({ chapterIndex: 4, bibleVersion: 1, text: "Invalid index" }).success).toBe(false);
  });

  it("assembles by chapter index and rejects incomplete or stale outputs", () => {
    const outputs = [3, 1, 2].map(chapterIndex => ({ chapterIndex, bibleVersion: 1, text: `Chapter ${chapterIndex}` }));
    expect(orderedChapters(outputs, 1).map(chapter => chapter.chapterIndex)).toEqual([1, 2, 3]);
    expect(() => orderedChapters(outputs.slice(0, 2), 1)).toThrow("All three unique chapters are required.");
    expect(() => orderedChapters([{ ...outputs[0], bibleVersion: 2 }, ...outputs.slice(1)], 1)).toThrow("Stale chapter version.");
  });

  it("stops dispatch at the token and cost boundaries", () => {
    expect(canDispatch(limits.tokens - 1000, limits.costUsd)).toBe(true);
    expect(canDispatch(limits.tokens - 999, 0)).toBe(false);
    expect(canDispatch(0, limits.costUsd, { tokens: 1000, cost: 0.01 })).toBe(false);
  });
});
