import { describe, expect, it, vi } from "vitest";
import {
  orderedChapters,
  type Chapter,
  type Bible,
} from "../src/contracts";
import {
  buildManuscriptEnvelope,
  verifyManuscriptEnvelope,
  hashChapterText,
  hashManuscriptContent,
  SHA256_HEX_REGEX,
  type RevisedManuscript,
} from "../src/agents/write/runtime";
import {
  approveManuscriptProposal,
  exportProject,
  AppError,
} from "../src/server/projects";
import { db } from "../src/server/db";
import { projects, proposals, chapters, bibles, runs } from "../src/server/db/schema";

const baseChapters: Chapter[] = [
  {
    chapterIndex: 1,
    bibleVersion: 1,
    text: "Mara watched the blue pulse from the lighthouse glass. Mindful that she could not swim, she readied the skiff.",
  },
  {
    chapterIndex: 2,
    bibleVersion: 1,
    text: "From the steady skiff, Mara closed the distance to the breakwater rocks where the shuttered lantern pulsed.",
  },
  {
    chapterIndex: 3,
    bibleVersion: 1,
    text: "Pulling the drenched sailor aboard, Mara maneuvered the skiff back through the surf toward the harbor.",
  },
];

const revisedManuscriptA: RevisedManuscript = {
  kind: "manuscript_a",
  editorialLens: "continuity_and_pacing",
  rationale: "Disciplined transitions and verified nautical alignment with Fact F1.",
  chapters: [
    {
      chapterIndex: 1,
      bibleVersion: 1,
      text: "[Revised A] Mara checked the rhythmic signal from the lantern tower, staying safely aboard the skiff.",
    },
    {
      chapterIndex: 2,
      bibleVersion: 1,
      text: "[Revised A] Approaching strictly by boat, she identified the shuttered lantern on the rocks.",
    },
    {
      chapterIndex: 3,
      bibleVersion: 1,
      text: "[Revised A] With steady boat maneuvering, she recovered the sailor and set course for shore.",
    },
  ],
  changesMade: [
    {
      chapterIndex: 2,
      summary: "Reinforced boat maneuvering.",
      justification: "Adheres to Fact F1 that Mara cannot swim.",
    },
  ],
};

const revisedManuscriptB: RevisedManuscript = {
  kind: "manuscript_b",
  editorialLens: "voice_and_atmosphere",
  rationale: "Deepened coastal brine mist and evocative lantern glow.",
  chapters: [
    {
      chapterIndex: 1,
      bibleVersion: 1,
      text: "[Revised B] Salt spray and cold Atlantic squalls clung to the granite tower as the blue beacon pulsed.",
    },
    {
      chapterIndex: 2,
      bibleVersion: 1,
      text: "[Revised B] Oarlocks groaned against the surging tide as Mara tracked the cobalt glow through thick fog.",
    },
    {
      chapterIndex: 3,
      bibleVersion: 1,
      text: "[Revised B] Amber harbor light welcomed them back through the mist, safe from the grasping black deep.",
    },
  ],
  changesMade: [
    {
      chapterIndex: 1,
      summary: "Enriched sensory texture.",
      justification: "Establishes atmospheric tone of coastal isolation.",
    },
  ],
};

describe("J05: S04 Proposal Envelope & Mathematical Integrity", () => {
  it("computes valid 64-character lowercase hex SHA-256 hashes", () => {
    const ch1Hash = hashChapterText(baseChapters[0].text);
    expect(ch1Hash).toMatch(SHA256_HEX_REGEX);

    const msHash = hashManuscriptContent(revisedManuscriptA);
    expect(msHash).toMatch(SHA256_HEX_REGEX);
  });

  it("builds an exact S04 envelope binding source chapter hashes, proposal hash, and runId", () => {
    const envelope = buildManuscriptEnvelope({
      runId: "run-test-1",
      baseVersion: 1,
      baseChapters,
      manuscript: revisedManuscriptA,
    });

    expect(envelope.envelopeVersion).toBe(1);
    expect(envelope.runId).toBe("run-test-1");
    expect(envelope.baseVersion).toBe(1);
    expect(envelope.proposalHash).toMatch(SHA256_HEX_REGEX);
    expect(envelope.sourceChapterHashes).toHaveLength(3);
    expect(envelope.sourceChapterHashes[0].chapterIndex).toBe(1);
    expect(envelope.sourceChapterHashes[0].sha256).toBe(hashChapterText(baseChapters[0].text));
    expect(envelope.sourceChapterHashes[1].sha256).toBe(hashChapterText(baseChapters[1].text));
    expect(envelope.sourceChapterHashes[2].sha256).toBe(hashChapterText(baseChapters[2].text));
  });

  it("verifies valid, untampered proposal envelopes", () => {
    const envelope = buildManuscriptEnvelope({
      runId: "run-test-1",
      baseVersion: 1,
      baseChapters,
      manuscript: revisedManuscriptA,
    });

    const result = verifyManuscriptEnvelope({
      envelope,
      storedChapters: baseChapters,
      manuscript: revisedManuscriptA,
      expectedBaseVersion: 1,
    });

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("detects tampered proposal text (PROPOSAL_HASH_MISMATCH)", () => {
    const envelope = buildManuscriptEnvelope({
      runId: "run-test-1",
      baseVersion: 1,
      baseChapters,
      manuscript: revisedManuscriptA,
    });

    // Tamper with chapter text in manuscript
    const tamperedManuscript: RevisedManuscript = {
      ...revisedManuscriptA,
      chapters: [
        { ...revisedManuscriptA.chapters[0], text: "Tampered unauthorized text insertion." },
        revisedManuscriptA.chapters[1],
        revisedManuscriptA.chapters[2],
      ],
    };

    const result = verifyManuscriptEnvelope({
      envelope,
      storedChapters: baseChapters,
      manuscript: tamperedManuscript,
      expectedBaseVersion: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Proposal content hash mismatch");
  });

  it("detects tampered proposal rationale", () => {
    const envelope = buildManuscriptEnvelope({
      runId: "run-test-1",
      baseVersion: 1,
      baseChapters,
      manuscript: revisedManuscriptA,
    });

    const tamperedManuscript: RevisedManuscript = {
      ...revisedManuscriptA,
      rationale: "Tampered rationale string.",
    };

    const result = verifyManuscriptEnvelope({
      envelope,
      storedChapters: baseChapters,
      manuscript: tamperedManuscript,
      expectedBaseVersion: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Proposal content hash mismatch");
  });

  it("detects tampered stored source chapters in DB", () => {
    const envelope = buildManuscriptEnvelope({
      runId: "run-test-1",
      baseVersion: 1,
      baseChapters,
      manuscript: revisedManuscriptA,
    });

    const tamperedStoredChapters: Chapter[] = [
      baseChapters[0],
      { ...baseChapters[1], text: "Tampered base chapter 2 in DB." },
      baseChapters[2],
    ];

    const result = verifyManuscriptEnvelope({
      envelope,
      storedChapters: tamperedStoredChapters,
      manuscript: revisedManuscriptA,
      expectedBaseVersion: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Source chapter 2 text hash mismatch");
  });

  it("detects mismatched base version", () => {
    const envelope = buildManuscriptEnvelope({
      runId: "run-test-1",
      baseVersion: 1,
      baseChapters,
      manuscript: revisedManuscriptA,
    });

    const result = verifyManuscriptEnvelope({
      envelope,
      storedChapters: baseChapters,
      manuscript: revisedManuscriptA,
      expectedBaseVersion: 2, // Project moved to version 2
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("does not match expected version (2)");
  });
});

describe("J05: Human Gate #2 Acceptance & Preservation Integration", () => {
  interface MockDbStore {
    projects: any[];
    proposals: any[];
    chapters: any[];
    bibles: any[];
    runs: any[];
  }

  function setupMockDb(store: MockDbStore) {
    // Top-level select for ownedProject
    vi.spyOn(db, "select").mockImplementation(() => ({
      from: (table: any) => ({
        where: (condition: any) => {
          let rows: any[] = [];
          if (table === projects) rows = store.projects;
          else if (table === proposals) rows = store.proposals;
          else if (table === chapters) rows = store.chapters;
          else if (table === bibles) rows = store.bibles;
          else if (table === runs) rows = store.runs;

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

    // Transaction mock
    vi.spyOn(db, "transaction").mockImplementation(async (callback: any) => {
      const tx = {
        select: () => ({
          from: (table: any) => ({
            where: (_cond: any) => {
              let rows: any[] = [];
              if (table === projects) rows = store.projects;
              else if (table === proposals) rows = store.proposals;
              else if (table === chapters) rows = store.chapters;
              else if (table === bibles) rows = store.bibles;
              else if (table === runs) rows = store.runs;

              const promise = Promise.resolve(rows);
              return Object.assign(promise, {
                for: (_mode: string) => Promise.resolve(rows),
                limit: (n: number) => Promise.resolve(rows.slice(0, n)),
              });
            },
          }),
        }),
        update: (table: any) => ({
          set: (values: any) => ({
            where: (_cond: any) => {
              if (table === proposals) {
                if (values.status === "accepted") {
                  for (const p of store.proposals) {
                    if (p.id === "prop-a") {
                      p.status = "accepted";
                    }
                  }
                } else if (values.status === "rejected") {
                  for (const p of store.proposals) {
                    if (p.id !== "prop-a" && p.kind.startsWith("manuscript_")) {
                      p.status = "rejected";
                    }
                  }
                }
              }
              const res = table === proposals ? store.proposals.filter(p => p.status === "accepted") : [];
              return {
                returning: () => Promise.resolve(res),
                then: (resolve: any, reject?: any) => Promise.resolve(res).then(resolve, reject),
              };
            },
          }),
        }),
      };
      return callback(tx);
    });
  }

  it("accepts manuscript_a at Human Gate #2, returns status accepted, rejects competing manuscript_b, and preserves base chapters", async () => {
    const envelopeA = buildManuscriptEnvelope({
      runId: "run-1",
      baseVersion: 1,
      baseChapters,
      manuscript: revisedManuscriptA,
    });
    const envelopeB = buildManuscriptEnvelope({
      runId: "run-1",
      baseVersion: 1,
      baseChapters,
      manuscript: revisedManuscriptB,
    });

    const store: MockDbStore = {
      projects: [{ id: "proj-1", ownerId: "user-1", version: 1, brief: { premise: "P" } }],
      bibles: [{ id: "bible-1", projectId: "proj-1", version: 1, data: {} }],
      runs: [{ id: "run-1", projectId: "proj-1", status: "completed" }],
      chapters: [
        { id: "c1", runId: "run-1", chapterIndex: 1, bibleVersion: 1, text: baseChapters[0].text },
        { id: "c2", runId: "run-1", chapterIndex: 2, bibleVersion: 1, text: baseChapters[1].text },
        { id: "c3", runId: "run-1", chapterIndex: 3, bibleVersion: 1, text: baseChapters[2].text },
      ],
      proposals: [
        {
          id: "prop-a",
          projectId: "proj-1",
          baseVersion: 1,
          kind: "manuscript_a",
          status: "pending",
          data: { ...revisedManuscriptA, envelope: envelopeA },
        },
        {
          id: "prop-b",
          projectId: "proj-1",
          baseVersion: 1,
          kind: "manuscript_b",
          status: "pending",
          data: { ...revisedManuscriptB, envelope: envelopeB },
        },
      ],
    };

    setupMockDb(store);

    const acceptedProposal = await approveManuscriptProposal("user-1", "proj-1", "prop-a");

    // 1. Return value must reflect accepted status (not stale pending)
    expect(acceptedProposal.status).toBe("accepted");
    expect(acceptedProposal.id).toBe("prop-a");

    // 2. Competing proposal B must be marked "rejected" in DB (preserved, not deleted!)
    const propB = store.proposals.find((p) => p.id === "prop-b");
    expect(propB).toBeDefined();
    expect(propB?.status).toBe("rejected");

    // 3. Base chapters in DB remain completely untouched and unmodified
    expect(store.chapters).toHaveLength(3);
    expect(store.chapters[0].text).toBe(baseChapters[0].text);
    expect(store.chapters[1].text).toBe(baseChapters[1].text);
    expect(store.chapters[2].text).toBe(baseChapters[2].text);
  });

  it("rejects when owner does not own project with 404 Project unavailable.", async () => {
    const store: MockDbStore = {
      projects: [], // No project for foreign owner
      bibles: [],
      runs: [],
      chapters: [],
      proposals: [],
    };
    setupMockDb(store);

    await expect(
      approveManuscriptProposal("wrong-owner", "proj-1", "prop-a")
    ).rejects.toThrow(new AppError(404, "Project unavailable."));
  });

  it("rejects non-manuscript proposals (e.g. bible_a) submitted to manuscript acceptance with 400", async () => {
    const store: MockDbStore = {
      projects: [{ id: "proj-1", ownerId: "user-1", version: 1 }],
      bibles: [],
      runs: [],
      chapters: [],
      proposals: [
        {
          id: "prop-bible",
          projectId: "proj-1",
          baseVersion: 1,
          kind: "bible_a", // Not a manuscript
          status: "pending",
          data: {},
        },
      ],
    };
    setupMockDb(store);

    await expect(
      approveManuscriptProposal("user-1", "proj-1", "prop-bible")
    ).rejects.toThrow(new AppError(400, "Only manuscript proposals can be accepted as final manuscripts."));
  });

  it("rejects stale proposals from older base versions with 409", async () => {
    const store: MockDbStore = {
      projects: [{ id: "proj-1", ownerId: "user-1", version: 2 }], // Project is at v2
      bibles: [],
      runs: [],
      chapters: [],
      proposals: [
        {
          id: "prop-stale",
          projectId: "proj-1",
          baseVersion: 1, // Stale version 1
          kind: "manuscript_a",
          status: "pending",
          data: revisedManuscriptA,
        },
      ],
    };
    setupMockDb(store);

    await expect(
      approveManuscriptProposal("user-1", "proj-1", "prop-stale")
    ).rejects.toThrow(new AppError(409, "Proposal base version does not match current project version."));
  });

  it("rejects already decided (accepted or rejected) proposals with 409", async () => {
    const store: MockDbStore = {
      projects: [{ id: "proj-1", ownerId: "user-1", version: 1 }],
      bibles: [],
      runs: [],
      chapters: [],
      proposals: [
        {
          id: "prop-already-decided",
          projectId: "proj-1",
          baseVersion: 1,
          kind: "manuscript_a",
          status: "accepted", // Already accepted
          data: revisedManuscriptA,
        },
      ],
    };
    setupMockDb(store);

    await expect(
      approveManuscriptProposal("user-1", "proj-1", "prop-already-decided")
    ).rejects.toThrow(new AppError(409, "Proposal is stale or already decided."));
  });

  it("rejects proposal when kind and editorialLens mismatch with 400", async () => {
    const mismatchedData: RevisedManuscript = {
      ...revisedManuscriptA,
      kind: "manuscript_a",
      editorialLens: "voice_and_atmosphere", // Mismatched lens for manuscript_a
    };

    const store: MockDbStore = {
      projects: [{ id: "proj-1", ownerId: "user-1", version: 1 }],
      bibles: [],
      runs: [],
      chapters: [],
      proposals: [
        {
          id: "prop-mismatch",
          projectId: "proj-1",
          baseVersion: 1,
          kind: "manuscript_a",
          status: "pending",
          data: mismatchedData,
        },
      ],
    };
    setupMockDb(store);

    await expect(
      approveManuscriptProposal("user-1", "proj-1", "prop-mismatch")
    ).rejects.toThrow(new AppError(400, "Proposal kind and editorial lens mismatch."));
  });

  it("rejects proposal when envelope verification detects tampered source chapter rows in DB with 409", async () => {
    const envelopeA = buildManuscriptEnvelope({
      runId: "run-1",
      baseVersion: 1,
      baseChapters,
      manuscript: revisedManuscriptA,
    });

    const store: MockDbStore = {
      projects: [{ id: "proj-1", ownerId: "user-1", version: 1 }],
      bibles: [],
      runs: [{ id: "run-1", projectId: "proj-1", status: "completed" }],
      chapters: [
        { id: "c1", runId: "run-1", chapterIndex: 1, bibleVersion: 1, text: baseChapters[0].text },
        { id: "c2", runId: "run-1", chapterIndex: 2, bibleVersion: 1, text: "Tampered row in DB" },
        { id: "c3", runId: "run-1", chapterIndex: 3, bibleVersion: 1, text: baseChapters[2].text },
      ],
      proposals: [
        {
          id: "prop-a",
          projectId: "proj-1",
          baseVersion: 1,
          kind: "manuscript_a",
          status: "pending",
          data: { ...revisedManuscriptA, envelope: envelopeA },
        },
      ],
    };
    setupMockDb(store);

    await expect(
      approveManuscriptProposal("user-1", "proj-1", "prop-a")
    ).rejects.toThrow(AppError);
  });
});
