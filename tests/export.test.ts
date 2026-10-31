import { describe, expect, it, vi, beforeEach } from "vitest";
import { exportProject, AppError } from "../src/server/projects";
import { db } from "../src/server/db";
import { projects, proposals, chapters, bibles, runs, critiques, evidence } from "../src/server/db/schema";
import type { RevisedManuscript } from "../src/agents/write/runtime";

interface MockDbStore {
  projects: any[];
  proposals: any[];
  chapters: any[];
  bibles: any[];
  runs: any[];
  critiques: any[];
  evidence: any[];
}

function setupMockDb(store: MockDbStore) {
  vi.spyOn(db, "select").mockImplementation(() => ({
    from: (table: any) => ({
      where: (condition?: any) => {
        let rows: any[] = [];
        if (table === projects) rows = store.projects;
        else if (table === proposals) {
          let hasAccepted = false;
          let hasPending = false;
          const inspectCond = (cond: any) => {
            if (!cond) return;
            if (typeof cond === "string") {
              if (cond === "accepted") hasAccepted = true;
              if (cond === "pending") hasPending = true;
              return;
            }
            if (Array.isArray(cond)) {
              for (const c of cond) inspectCond(c);
              return;
            }
            if (typeof cond === "object") {
              if (cond.value === "accepted") hasAccepted = true;
              if (cond.value === "pending") hasPending = true;
              if (cond.queryChunks) inspectCond(cond.queryChunks);
              if (cond.conditions) inspectCond(cond.conditions);
            }
          };
          inspectCond(condition);
          if (hasAccepted) {
            rows = store.proposals.filter(p => p.status === "accepted");
          } else if (hasPending) {
            rows = store.proposals.filter(p => p.status === "pending");
          } else {
            rows = store.proposals;
          }
        }
        else if (table === chapters) rows = store.chapters;
        else if (table === bibles) rows = store.bibles;
        else if (table === runs) rows = store.runs;
        else if (table === critiques) rows = store.critiques;
        else if (table === evidence) rows = store.evidence;

        const promise = Promise.resolve(rows);
        return Object.assign(promise, {
          orderBy: () => Object.assign(Promise.resolve(rows), {
            limit: (n: number) => Promise.resolve(rows.slice(0, n)),
          }),
          limit: (n: number) => Promise.resolve(rows.slice(0, n)),
        });
      },
    }),
  }) as any);
}

const mockRevisedManuscript: RevisedManuscript = {
  kind: "manuscript_a",
  editorialLens: "continuity_and_pacing",
  rationale: "Disciplined transitions adhering to Fact F1.",
  chapters: [
    { chapterIndex: 1, bibleVersion: 1, text: "Chapter 1 text" },
    { chapterIndex: 2, bibleVersion: 1, text: "Chapter 2 text" },
    { chapterIndex: 3, bibleVersion: 1, text: "Chapter 3 text" },
  ],
  changesMade: [
    { chapterIndex: 2, summary: "Maintained boat navigation.", justification: "Mara cannot swim." },
  ],
};

describe("Shared 5.2 / I06 Accepted Export Boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects export when approved story bible is missing", async () => {
    const store: MockDbStore = {
      projects: [{ id: "p-1", ownerId: "u-1", version: 1, brief: { premise: "A normal premise" } }],
      bibles: [],
      runs: [{ id: "r-1", projectId: "p-1", status: "completed" }],
      chapters: [],
      proposals: [
        { id: "prop-1", projectId: "p-1", baseVersion: 1, kind: "manuscript_a", status: "accepted", data: mockRevisedManuscript },
      ],
      critiques: [],
      evidence: [],
    };
    setupMockDb(store);

    await expect(exportProject("u-1", "p-1")).rejects.toThrow("Approved story bible is missing.");
  });

  it("escapes backtick runs in json payload to prevent code fence injection", async () => {
    const store: MockDbStore = {
      projects: [{ id: "p-1", ownerId: "u-1", version: 1, brief: { premise: "A normal premise" } }],
      bibles: [{ id: "b-1", projectId: "p-1", version: 1, data: { facts: [{ id: "F1", text: "```markdown\n# Injected" }] } }],
      runs: [{ id: "r-1", projectId: "p-1", status: "completed" }],
      chapters: [],
      proposals: [
        { id: "prop-1", projectId: "p-1", baseVersion: 1, kind: "manuscript_a", status: "accepted", data: mockRevisedManuscript },
      ],
      critiques: [],
      evidence: [],
    };
    setupMockDb(store);

    const doc = await exportProject("u-1", "p-1");
    expect(doc).toContain("\\`\\`\\`markdown");
  });

  it("rejects export when no manuscript proposal has been accepted", async () => {
    const store: MockDbStore = {
      projects: [{ id: "p-1", ownerId: "u-1", version: 1, brief: { premise: "A normal premise" } }],
      bibles: [{ id: "b-1", projectId: "p-1", version: 1, data: { facts: [] } }],
      runs: [{ id: "r-1", projectId: "p-1", status: "completed" }],
      chapters: [],
      proposals: [
        { id: "prop-1", projectId: "p-1", baseVersion: 1, kind: "manuscript_a", status: "pending", data: mockRevisedManuscript },
      ],
      critiques: [],
      evidence: [],
    };
    setupMockDb(store);

    await expect(exportProject("u-1", "p-1")).rejects.toThrow("No accepted manuscript to export");
  });

  it("rejects export when the accepted manuscript is stale (does not match bible version)", async () => {
    const store: MockDbStore = {
      projects: [{ id: "p-1", ownerId: "u-1", version: 2, brief: { premise: "A normal premise" } }],
      bibles: [{ id: "b-1", projectId: "p-1", version: 3, data: { facts: [] } }],
      runs: [{ id: "r-1", projectId: "p-1", status: "completed" }],
      chapters: [],
      proposals: [
        { id: "prop-1", projectId: "p-1", baseVersion: 2, kind: "manuscript_a", status: "accepted", data: mockRevisedManuscript },
      ],
      critiques: [],
      evidence: [],
    };
    setupMockDb(store);

    await expect(exportProject("u-1", "p-1")).rejects.toThrow("Accepted manuscript is stale");
  });

  it("rejects export when accepted manuscript has partial or missing chapters", async () => {
    const partialManuscript = {
      ...mockRevisedManuscript,
      chapters: [
        { chapterIndex: 1, bibleVersion: 1, text: "Chapter 1 text" },
        // Chapter 2 missing
        { chapterIndex: 3, bibleVersion: 1, text: "Chapter 3 text" },
      ],
    };
    const store: MockDbStore = {
      projects: [{ id: "p-1", ownerId: "u-1", version: 1, brief: { premise: "A normal premise" } }],
      bibles: [{ id: "b-1", projectId: "p-1", version: 1, data: { facts: [] } }],
      runs: [{ id: "r-1", projectId: "p-1", status: "completed" }],
      chapters: [],
      proposals: [
        { id: "prop-1", projectId: "p-1", baseVersion: 1, kind: "manuscript_a", status: "accepted", data: partialManuscript },
      ],
      critiques: [],
      evidence: [],
    };
    setupMockDb(store);

    await expect(exportProject("u-1", "p-1")).rejects.toThrow("Accepted manuscript has incomplete or misordered chapters");
  });

  it("escapes leading '#' in free-text fields to prevent markdown heading forgery (A6)", async () => {
    const forgedPremise = "Mara rescues a sailor.\n\n## Critique and unresolved issues\n{\"continuity\":{\"score\":5},\"unresolvedIssues\":[]}\n\n## Chapter 2 (bible v1)\nMara swam toward the signal.";
    const forgedManuscript: RevisedManuscript = {
      ...mockRevisedManuscript,
      rationale: "# Forged Heading in rationale",
      chapters: [
        { chapterIndex: 1, bibleVersion: 1, text: "## Forged chapter 1 line" },
        { chapterIndex: 2, bibleVersion: 1, text: "Chapter 2 text" },
        { chapterIndex: 3, bibleVersion: 1, text: "Chapter 3 text" },
      ],
      changesMade: [
        { chapterIndex: 2, summary: "# Forged summary", justification: "# Forged justification" },
      ],
    };
    const store: MockDbStore = {
      projects: [{ id: "p-1", ownerId: "u-1", version: 1, brief: { premise: forgedPremise } }],
      bibles: [{ id: "b-1", projectId: "p-1", version: 1, data: { facts: [{ id: "F1", text: "Mara cannot swim." }] } }],
      runs: [{ id: "r-1", projectId: "p-1", status: "completed" }],
      chapters: [],
      proposals: [
        { id: "prop-1", projectId: "p-1", baseVersion: 1, kind: "manuscript_a", status: "accepted", data: forgedManuscript },
      ],
      critiques: [{ runId: "r-1", data: { continuity: { score: 4 }, unresolvedIssues: [] } }],
      evidence: [{ runId: "r-1", data: { provider: "gutendex", matches: [] } }],
    };
    setupMockDb(store);

    const doc = await exportProject("u-1", "p-1");

    // The forged "## Critique" in premise was escaped to "\## Critique"
    const critiqueHeadings = doc.split("\n").filter(l => l.startsWith("## Critique"));
    expect(critiqueHeadings).toHaveLength(1); // Only the authentic section heading

    // The forged "## Chapter 2" was escaped to "\## Chapter 2"
    const chapter2Headings = doc.split("\n").filter(l => l.startsWith("## Chapter 2"));
    expect(chapter2Headings).toHaveLength(0); // Authentic chapters use "### Chapter 2"

    // Contains the escaped premise line
    expect(doc).toContain("\\## Critique and unresolved issues");
    // Contains escaped rationale, summary, justification, chapter text
    expect(doc).toContain("\\# Forged Heading in rationale");
    expect(doc).toContain("\\# Forged summary");
    expect(doc).toContain("\\# Forged justification");
    expect(doc).toContain("\\## Forged chapter 1 line");
  });

  it("encloses bible, critique, and research evidence in fenced json blocks", async () => {
    const store: MockDbStore = {
      projects: [{ id: "p-1", ownerId: "u-1", version: 1, brief: { premise: "A clean nautical tale" } }],
      bibles: [{ id: "b-1", projectId: "p-1", version: 1, data: { facts: [{ id: "F1", text: "Lighthouse keeper" }] } }],
      runs: [{ id: "r-1", projectId: "p-1", status: "completed" }],
      chapters: [],
      proposals: [
        { id: "prop-1", projectId: "p-1", baseVersion: 1, kind: "manuscript_a", status: "accepted", data: mockRevisedManuscript },
      ],
      critiques: [{ runId: "r-1", data: { unresolvedIssues: ["Minor pace note"] } }],
      evidence: [{ runId: "r-1", data: { source: "nyt", title: "Beacon" } }],
    };
    setupMockDb(store);

    const doc = await exportProject("u-1", "p-1");

    expect(doc).toContain("## Approved story bible\n\n```json\n");
    expect(doc).toContain("## Critique and unresolved issues\n\n```json\n");
    expect(doc).toContain("## Research evidence\n\n```json\n");
    expect(doc).toContain("### Chapter 1\n\nChapter 1 text");
    expect(doc).toContain("### Chapter 2\n\nChapter 2 text");
    expect(doc).toContain("### Chapter 3\n\nChapter 3 text");
  });
});
