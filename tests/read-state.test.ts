import { describe, expect, it, vi } from "vitest";
import { parseReadVersion, readFailure } from "../src/server/read-http";
import { ReadError, readStoryState, type ReadRepository } from "../src/server/read-state";

const brief = { premise: "Mara follows a blue signal to rescue a missing sailor.", genre: "Adventure", audience: "Adult", tone: "Hopeful", desiredEnding: "A safe boat rescue." };
const bible = { facts: [{ id: "F1", text: "Mara cannot swim." }], beats: [1, 2, 3].map(chapterIndex => ({ chapterIndex, text: `Beat ${chapterIndex}` })) };
const memory = { factIds: ["F1"], plannedEvents: "Find the signal.", unresolvedThreads: [], summary: "Mara travels by boat." };
const evidence = { provider: "nyt", availability: "unavailable", sourceUrl: "https://developer.nytimes.com/", fetchedAt: "2026-10-21T00:00:00.000Z", records: [], limitation: "Fixture only." };

function repository(): ReadRepository {
  return {
    project: vi.fn(async () => ({ version: 2, brief })),
    bible: vi.fn(async () => ({ id: "bible-2", version: 2, data: bible })),
    run: vi.fn(async () => ({ id: "run-2", status: "completed" })),
    chapters: vi.fn(async () => [3, 1, 2].map(chapterIndex => ({ chapterIndex, bibleVersion: 2, text: `Chapter ${chapterIndex}` }))),
    memories: vi.fn(async () => [3, 1, 2].map(chapterIndex => ({ chapterIndex, data: memory }))),
    critique: vi.fn(async () => ({ unresolvedIssues: ["The signal is unexplained."] })),
    evidence: vi.fn(async () => [{ data: evidence }]),
  };
}
const withRepo = (repo: ReadRepository) => async <T>(work: (repo: ReadRepository) => Promise<T>) => work(repo);

describe("owner-scoped story state", () => {
  it("makes missing and foreign projects indistinguishable and stops before dependent reads", async () => {
    for (const owner of ["unknown", "other-owner"]) {
      const repo = repository();
      repo.project = vi.fn(async () => undefined);
      await expect(readStoryState(owner, "project-1", undefined, withRepo(repo))).rejects.toMatchObject({ status: 404, message: "Project unavailable." });
      expect(repo.project).toHaveBeenCalledWith(owner, "project-1");
      expect(repo.bible).not.toHaveBeenCalled();
      expect(repo.run).not.toHaveBeenCalled();
    }
  });

  it("selects the exact approved version and scopes every dependent read to its keys", async () => {
    const repo = repository();
    repo.bible = vi.fn(async (_projectId, version) => ({ id: `bible-${version}`, version, data: bible }));
    repo.run = vi.fn(async (_projectId, bibleId) => ({ id: `run-${bibleId}`, status: "completed" }));
    const result = await readStoryState("owner", "project-1", 1, withRepo(repo));
    expect(repo.project).toHaveBeenCalledWith("owner", "project-1");
    expect(repo.bible).toHaveBeenCalledWith("project-1", 1);
    expect(repo.run).toHaveBeenCalledWith("project-1", "bible-1");
    expect(repo.memories).toHaveBeenCalledWith("bible-1");
    expect(repo.chapters).toHaveBeenCalledWith("run-bible-1", 1);
    expect(repo.evidence).toHaveBeenCalledWith("project-1", "run-bible-1");
    expect(result.stateVersion).toBe(1);
    expect(result.chapters).toEqual([]);
    expect(result.status).toBe("partial");
  });

  it("returns generic 404 for foreign or missing explicit versions", async () => {
    const repo = repository();
    repo.bible = vi.fn(async () => undefined);
    await expect(readStoryState("owner", "project-1", 1, withRepo(repo))).rejects.toMatchObject({ status: 404, message: "Project unavailable." });
    expect(repo.run).not.toHaveBeenCalled();
    await expect(readStoryState("owner", "project-1", 3, withRepo(repo))).rejects.toMatchObject({ status: 404, message: "Project unavailable." });
  });

  it("sorts valid chapters and memories and reports a complete run", async () => {
    const repo = repository();
    const result = await readStoryState("owner", "project-1", undefined, withRepo(repo));
    expect(result.status).toBe("completed");
    expect(result.chapters.map(chapter => chapter.chapterIndex)).toEqual([1, 2, 3]);
    expect(result.memoryHandoffs.map(handoff => handoff.chapterIndex)).toEqual([1, 2, 3]);
    expect(result.unresolvedIssues).toEqual(["The signal is unexplained."]);
    expect(result.issuesStatus).toBe("available");
    expect(result.memoryStatus).toBe("available");
    expect(result.evidenceStatus).toBe("available");
    expect(result.evidence).toEqual([evidence]);
    expect(JSON.stringify(result)).not.toContain("savedInput");
    expect(Object.keys(result)).not.toContain("ownerId");
  });

  it("withholds mismatched and invalid persisted rows and labels the draft partial", async () => {
    const repo = repository();
    repo.chapters = vi.fn(async () => [
      { chapterIndex: 1, bibleVersion: 2, text: "Valid." },
      { chapterIndex: 2, bibleVersion: 1, text: "Wrong version." },
      { chapterIndex: 3, bibleVersion: 2, text: "" },
    ]);
    repo.memories = vi.fn(async () => [{ chapterIndex: 1, data: { ...memory, factIds: ["foreign-fact"] } }]);
    repo.evidence = vi.fn(async () => [{ data: { ...evidence, sourceUrl: "javascript:bad()" } }]);
    const result = await readStoryState("owner", "project-1", undefined, withRepo(repo));
    expect(result.status).toBe("partial");
    expect(result.chapters.map(chapter => chapter.chapterIndex)).toEqual([1]);
    expect(result.memoryHandoffs).toEqual([]);
    expect(result.memoryStatus).toBe("partial");
    expect(result.evidenceStatus).toBe("partial");
    expect(result.evidence).toEqual([]);
  });

  it("does not equate missing or corrupt critique with zero unresolved issues", async () => {
    for (const value of [undefined, { unresolvedIssues: "invalid" }]) {
      const repo = repository();
      repo.critique = vi.fn(async () => value);
      const result = await readStoryState("owner", "project-1", undefined, withRepo(repo));
      expect(result.status).toBe("partial");
      expect(result.issuesStatus).toBe("unavailable");
      expect(result.unresolvedIssues).toBeNull();
    }
  });

  it("rejects stored evidence URLs outside the exact trusted source and with credentials or query keys", async () => {
    for (const sourceUrl of [
      "https://attacker.test/", "https://name:secret@developer.nytimes.com/",
      "https://developer.nytimes.com/?api-key=secret", "https://gutendex.com/extra",
    ]) {
      const repo = repository();
      repo.evidence = vi.fn(async () => [{ data: { ...evidence, sourceUrl } }]);
      const result = await readStoryState("owner", "project-1", undefined, withRepo(repo));
      expect(result.evidenceStatus).toBe("partial");
      expect(result.evidence).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(sourceUrl);
    }
  });

  it("allows a missing current bible as unavailable and never calls a write repository method", async () => {
    const repo = repository();
    repo.project = vi.fn(async () => ({ version: 0, brief }));
    const result = await readStoryState("owner", "project-1", undefined, withRepo(repo));
    expect(result.status).toBe("unavailable");
    expect(result.issuesStatus).toBe("not_requested");
    expect(result.unresolvedIssues).toBeNull();
    expect(repo.bible).not.toHaveBeenCalled();
    expect(Object.keys(repo)).toEqual(["project", "bible", "run", "chapters", "memories", "critique", "evidence"]);
  });
});

describe("read version query", () => {
  it("accepts one bounded canonical version and rejects duplicates or malformed values", () => {
    expect(parseReadVersion(new Request("https://example.test/state"))).toBeUndefined();
    expect(parseReadVersion(new Request("https://example.test/state?version=10000"))).toBe(10000);
    for (const query of ["version=0", "version=-1", "version=01", "version=10001", "version=1.1", "version=1&version=2", "version=%20", "version=NaN"])
      expect(() => parseReadVersion(new Request(`https://example.test/state?${query}`))).toThrow("Invalid version.");
  });

  it("returns public errors without exposing private failures", async () => {
    const hidden = readFailure(new Error("private database detail"));
    expect(hidden.status).toBe(503);
    expect(await hidden.json()).toEqual({ error: "Temporarily unavailable." });
    const missing = readFailure(new ReadError(404, "Project unavailable."));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Project unavailable." });
  });
});
