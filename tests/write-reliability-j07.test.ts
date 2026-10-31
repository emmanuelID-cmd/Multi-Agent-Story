import { describe, expect, it, vi } from "vitest";
import {
  orderedChapters,
  chapterSchema,
  type Chapter,
  type Bible,
} from "../src/contracts";
import {
  buildManuscriptEnvelope,
  verifyManuscriptEnvelope,
  generateChapterProse,
  generateEditorialProposal,
  hashManuscriptContent,
  cleanProseTypography,
  type RevisedManuscript,
} from "../src/agents/write/runtime";
import type { WriteModel, WriteModelCall } from "../src/agents/write/model";
import { validateEditorReceivingHandoff, buildFixtureHandoff } from "../src/agents/handoff";
import { executeRevisionCycle } from "../src/agents/write/revision";
import { rewriteRun, retryRun } from "../src/server/projects";
import { enqueue } from "../src/worker/queue";

vi.mock("../src/worker/queue", () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
}));
import { db } from "../src/server/db";
import { projects, bibles, runs, tasks, proposals, critiques } from "../src/server/db/schema";

const mockBible: Bible = {
  facts: [
    { id: "F1", text: "Mara cannot swim and avoids deep water unless safely aboard a boat." },
    { id: "F2", text: "The blue beacon pulses every three minutes." },
  ],
  beats: [
    { chapterIndex: 1, text: "Mara prepares the boat as the beacon pulses." },
    { chapterIndex: 2, text: "Mara crosses the rocky swells toward the reef." },
    { chapterIndex: 3, text: "Mara reaches the rocks and completes the rescue." },
  ],
};

const baseChapters: Chapter[] = [
  { chapterIndex: 1, bibleVersion: 1, text: "Chapter 1 text." },
  { chapterIndex: 2, bibleVersion: 1, text: "Chapter 2 text." },
  { chapterIndex: 3, bibleVersion: 1, text: "Chapter 3 text." },
];

describe("J07 — WRITE Reliability Evidence & Failure Recovery", () => {
  describe("Malformed & Truncated LLM Output Handling", () => {
    it("handles truncated/invalid chapter schema from writer model", async () => {
      const truncatedModel: WriteModel = {
        async complete() {
          return {
            value: { notText: "truncated data without text field" },
            usage: { inputTokens: 100, outputTokens: 20 },
            modelUsed: "mock-model",
          };
        },
      };

      await expect(
        generateChapterProse(
          {
            chapterIndex: 1,
            bibleVersion: 1,
            approvedBible: mockBible,
          },
          truncatedModel
        )
      ).rejects.toThrow();
    });

    it("handles editor model returning fewer than 3 chapters", async () => {
      const malformedEditorModel: WriteModel = {
        async complete() {
          return {
            value: {
              rationale: "Incomplete proposal",
              chapters: [
                { chapterIndex: 1, text: "Ch 1" },
                { chapterIndex: 2, text: "Ch 2" },
                // Missing chapter 3
              ],
              changesMade: [{ chapterIndex: 1, summary: "Edit", justification: "Test" }],
            },
            usage: { inputTokens: 200, outputTokens: 80 },
            modelUsed: "mock-model",
          };
        },
      };

      const handoff = buildFixtureHandoff(baseChapters, 1, "Standard request");

      await expect(
        generateEditorialProposal(
          {
            role: "critic_editor_a",
            approvedBible: mockBible,
            bibleVersion: 1,
            baseChapters,
            handoff,
          },
          malformedEditorModel
        )
      ).rejects.toThrow();
    });

    it("handles editor model returning non-consecutive or duplicate chapter indexes", async () => {
      const duplicateIndexModel: WriteModel = {
        async complete() {
          return {
            value: {
              rationale: "Duplicate indexes",
              chapters: [
                { chapterIndex: 1, text: "Ch 1" },
                { chapterIndex: 2, text: "Ch 2" },
                { chapterIndex: 2, text: "Duplicate Ch 2 instead of 3" },
              ],
              changesMade: [{ chapterIndex: 1, summary: "Edit", justification: "Test" }],
            },
            usage: { inputTokens: 200, outputTokens: 80 },
            modelUsed: "mock-model",
          };
        },
      };

      const handoff = buildFixtureHandoff(baseChapters, 1, "Standard request");

      await expect(
        generateEditorialProposal(
          {
            role: "critic_editor_a",
            approvedBible: mockBible,
            bibleVersion: 1,
            baseChapters,
            handoff,
          },
          duplicateIndexModel
        )
      ).rejects.toThrow();
    });
  });

  describe("Cancellation & AbortSignal Reliability", () => {
    it("immediately honors pre-aborted signal in generateChapterProse", async () => {
      const controller = new AbortController();
      controller.abort();

      const model: WriteModel = {
        async complete(call: WriteModelCall) {
          if (call.signal?.aborted) {
            throw new DOMException("Operation canceled.", "AbortError");
          }
          return {
            value: { text: "Chapter text" },
            usage: { inputTokens: 50, outputTokens: 50 },
            modelUsed: "mock",
          };
        },
      };

      await expect(
        generateChapterProse(
          { chapterIndex: 1, bibleVersion: 1, approvedBible: mockBible },
          model,
          controller.signal
        )
      ).rejects.toThrow("Operation canceled.");
    });

    it("immediately honors pre-aborted signal in executeRevisionCycle", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        executeRevisionCycle({
          runId: "run-cancel",
          projectId: "proj-cancel",
          bibleVersion: 1,
          approvedBible: mockBible,
          baseChapters,
          revisionRound: 1,
          editorialInstructions: "Revise",
          signal: controller.signal,
        })
      ).rejects.toThrow("Operation canceled.");
    });
  });

  describe("Barrier & Envelope Tamper Protection", () => {
    it("orderedChapters write barrier strictly enforces unique indexes [1, 2, 3] on approved bibleVersion", () => {
      // Missing index 3
      expect(() =>
        orderedChapters(
          [
            { chapterIndex: 1, bibleVersion: 1, text: "T1" },
            { chapterIndex: 2, bibleVersion: 1, text: "T2" },
          ],
          1
        )
      ).toThrow("All three unique chapters are required.");

      // Stale bible version on chapter 2
      expect(() =>
        orderedChapters(
          [
            { chapterIndex: 1, bibleVersion: 1, text: "T1" },
            { chapterIndex: 2, bibleVersion: 2, text: "T2" },
            { chapterIndex: 3, bibleVersion: 1, text: "T3" },
          ],
          1
        )
      ).toThrow("Stale chapter version.");
    });

    it("verifyManuscriptEnvelope detects tampered manuscript text or changes", () => {
      const manuscript: RevisedManuscript = {
        kind: "manuscript_a",
        editorialLens: "continuity_and_pacing",
        rationale: "Disciplined edits.",
        chapters: [
          { chapterIndex: 1, bibleVersion: 1, text: "Original Rev 1" },
          { chapterIndex: 2, bibleVersion: 1, text: "Original Rev 2" },
          { chapterIndex: 3, bibleVersion: 1, text: "Original Rev 3" },
        ],
        changesMade: [{ chapterIndex: 1, summary: "Edit", justification: "Reason" }],
      };

      const envelope = buildManuscriptEnvelope({
        runId: "run-env",
        baseVersion: 1,
        baseChapters,
        manuscript,
      });

      // Valid check passes
      expect(
        verifyManuscriptEnvelope({
          envelope,
          storedChapters: baseChapters,
          manuscript,
          expectedBaseVersion: 1,
        }).valid
      ).toBe(true);

      // Tampered chapter text
      const tamperedManuscript: RevisedManuscript = {
        ...manuscript,
        chapters: [
          { ...manuscript.chapters[0], text: "Tampered content insertion" },
          manuscript.chapters[1],
          manuscript.chapters[2],
        ],
      };
      const resultTampered = verifyManuscriptEnvelope({
        envelope,
        storedChapters: baseChapters,
        manuscript: tamperedManuscript,
        expectedBaseVersion: 1,
      });
      expect(resultTampered.valid).toBe(false);
      expect(resultTampered.error).toContain("Proposal content hash mismatch");
    });

    it("verifyManuscriptEnvelope detects tampered base chapters in database", () => {
      const manuscript: RevisedManuscript = {
        kind: "manuscript_b",
        editorialLens: "voice_and_atmosphere",
        rationale: "Atmospheric edits.",
        chapters: [
          { chapterIndex: 1, bibleVersion: 1, text: "Rev 1" },
          { chapterIndex: 2, bibleVersion: 1, text: "Rev 2" },
          { chapterIndex: 3, bibleVersion: 1, text: "Rev 3" },
        ],
        changesMade: [{ chapterIndex: 1, summary: "Atmosphere", justification: "Mood" }],
      };

      const envelope = buildManuscriptEnvelope({
        runId: "run-env-2",
        baseVersion: 1,
        baseChapters,
        manuscript,
      });

      const tamperedBaseChapters: Chapter[] = [
        baseChapters[0],
        { ...baseChapters[1], text: "Tampered base chapter 2 in database" },
        baseChapters[2],
      ];

      const res = verifyManuscriptEnvelope({
        envelope,
        storedChapters: tamperedBaseChapters,
        manuscript,
        expectedBaseVersion: 1,
      });
      expect(res.valid).toBe(false);
      expect(res.error).toContain("Source chapter 2 text hash mismatch");
    });
  });

  describe("Handoff Semantic Sufficiency & Boundary Hardening", () => {
    it("validateEditorReceivingHandoff rejects incomplete source chapter coverage", () => {
      const handoff = buildFixtureHandoff(baseChapters, 1, "Request");
      // Remove chapter 3 from source references
      const partialHandoff = {
        ...handoff,
        sourceReferences: handoff.sourceReferences.filter((s) => s.locator !== "chapter_3"),
      };

      const result = validateEditorReceivingHandoff({
        handoff: partialHandoff,
        expectedRecordedRequest: "Request",
        baseChapters,
        approvedBibleVersion: 1,
      });

      expect(result.valid).toBe(false);
      expect(result.rejection?.failedChecks).toContain("MISSING_REQUIRED_SOURCE_CHAPTER");
    });

    it("validateEditorReceivingHandoff rejects low confidence handoffs (< 0.8)", () => {
      const handoff = buildFixtureHandoff(baseChapters, 1, "Request");
      const lowConfidenceHandoff = {
        ...handoff,
        completeness: {
          isComplete: true,
          missingItems: [],
          confidence: 0.65,
        },
      };

      const result = validateEditorReceivingHandoff({
        handoff: lowConfidenceHandoff,
        expectedRecordedRequest: "Request",
        baseChapters,
        approvedBibleVersion: 1,
      });

      expect(result.valid).toBe(false);
      expect(result.rejection?.failedChecks).toContain("INSUFFICIENT_COMPLETENESS_CONFIDENCE");
    });
  });

  describe("Prose Typography & Sanitization Hygiene", () => {
    it("normalizes punctuation collisions, double periods, and misplaced whitespace", () => {
      const dirty = "Mara peered into the mist .She saw a lantern ..Then ,. a boat appeared ....Wait !.What ?";
      const cleaned = cleanProseTypography(dirty);
      expect(cleaned).toBe("Mara peered into the mist. She saw a lantern. Then. a boat appeared... Wait! What?");
    });

    it("strips leading bracketed version tags from model generated prose", () => {
      const taggedA = "[Revised A] Mara readied the skiff with disciplined boat maneuvering.";
      expect(cleanProseTypography(taggedA)).toBe(
        "Mara readied the skiff with disciplined boat maneuvering."
      );

      const taggedCh = "[Chapter 2] The tide surged violently against the harbor wall.";
      expect(cleanProseTypography(taggedCh)).toBe(
        "The tide surged violently against the harbor wall."
      );

      const banner = "[Revised Version A — Continuity & Pacing]\n\nMara stayed in the boat.";
      expect(cleanProseTypography(banner)).toBe("Mara stayed in the boat.");
      expect(cleanProseTypography("[Revised Version A] The skiff held.")).toBe("The skiff held.");
    });

    it("leaves initials and an unfinished comma-period fragment alone", () => {
      expect(cleanProseTypography("U.S.A. stayed on the chart.")).toBe("U.S.A. stayed on the chart.");
      expect(cleanProseTypography("With disciplined precision, .")).toBe("With disciplined precision, .");
    });
  });

  describe("Envelope fail-closed checks and stable change hashes", () => {
    it("returns invalid instead of throwing when a source-hash entry is missing", () => {
      const manuscript: RevisedManuscript = {
        kind: "manuscript_a",
        editorialLens: "continuity_and_pacing",
        rationale: "Disciplined edits.",
        chapters: baseChapters,
        changesMade: [{ chapterIndex: 1, summary: "Edit", justification: "Reason" }],
      };
      const envelope = buildManuscriptEnvelope({
        runId: "run-missing-hash",
        baseVersion: 1,
        baseChapters,
        manuscript,
      });
      const missing = {
        ...envelope,
        sourceChapterHashes: envelope.sourceChapterHashes.filter((entry) => entry.chapterIndex !== 2),
      };
      const result = verifyManuscriptEnvelope({
        envelope: missing,
        storedChapters: baseChapters,
        manuscript,
        expectedBaseVersion: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Source hash entry missing");
    });

    it("hashes the same changesMade list regardless of order", () => {
      const first = {
        kind: "manuscript_a" as const,
        editorialLens: "continuity_and_pacing" as const,
        rationale: "Two edits.",
        chapters: baseChapters,
        changesMade: [
          { chapterIndex: 2, summary: "Boat", justification: "Fact F1" },
          { chapterIndex: 1, summary: "Opening", justification: "Pace" },
        ],
      };
      const reversed = {
        ...first,
        changesMade: [first.changesMade[1], first.changesMade[0]],
      };
      expect(hashManuscriptContent(first)).toBe(hashManuscriptContent(reversed));
    });
  });

  describe("Proposal preservation across failed dispatch and retry", () => {
    function projectStore() {
      return {
        projects: [
          {
            id: "proj-j07",
            ownerId: "writer-j07",
            version: 1,
            brief: {
              premise: "Mara keeps watch at the lighthouse.",
              audience: "Adult",
              genre: "Mystery",
              tone: "Suspenseful",
              desiredEnding: "A safe return by harbor boat.",
            },
          },
        ],
        bibles: [{ id: "bible-j07", projectId: "proj-j07", version: 1, data: mockBible }],
        runs: [
          {
            id: "run-j07-0",
            projectId: "proj-j07",
            bibleId: "bible-j07",
            fixture: "normal",
            status: "completed",
            createdAt: new Date(),
          },
        ] as Array<Record<string, unknown>>,
        critiques: [{ id: "critique-j07", runId: "run-j07-0", data: { revisionRounds: 0 } }],
        tasks: [1, 2, 3].map((chapterIndex) => ({
          id: `task-j07-${chapterIndex}`,
          runId: "run-j07-0",
          chapterIndex,
          status: "completed",
          attempts: 1,
          savedInput: {
            revisionRound: 0,
            brief: { desiredEnding: "A safe return by harbor boat." },
          },
        })) as Array<Record<string, unknown>>,
        proposals: [
          { id: "keep-a", projectId: "proj-j07", kind: "manuscript_a", status: "pending" },
          { id: "keep-b", projectId: "proj-j07", kind: "manuscript_b", status: "pending" },
        ],
      };
    }

    function mockProjectDb(store: ReturnType<typeof projectStore>) {
      const rowsFor = (table: unknown) => {
        if (table === projects) return store.projects;
        if (table === runs) return store.runs;
        if (table === critiques) return store.critiques;
        if (table === tasks) return store.tasks;
        if (table === bibles) return store.bibles;
        if (table === proposals) return store.proposals;
        return [];
      };
      const selectable = (table: unknown) => {
        const rows = rowsFor(table);
        const pending = Promise.resolve(rows);
        const newestFirst = [...rows].sort((left, right) => {
          const leftTime = left && typeof left === "object" && "createdAt" in left
            ? new Date(left.createdAt as string | Date).getTime()
            : 0;
          const rightTime = right && typeof right === "object" && "createdAt" in right
            ? new Date(right.createdAt as string | Date).getTime()
            : 0;
          return rightTime - leftTime;
        });
        // Pretends the database locked these rows before sorting them.
        // retryRun calls for("update") right after where(), then orderBy() and limit().
        const lockedRows = () => Object.assign(Promise.resolve(rows), {
          orderBy: () => Object.assign(Promise.resolve(newestFirst), {
            limit: (count: number) => Promise.resolve(newestFirst.slice(0, count)),
          }),
          limit: (count: number) => Promise.resolve(rows.slice(0, count)),
        });
        return Object.assign(pending, {
          orderBy: () => Object.assign(Promise.resolve(newestFirst), {
            limit: (count: number) => Promise.resolve(newestFirst.slice(0, count)),
          }),
          limit: (count: number) => Promise.resolve(rows.slice(0, count)),
          for: lockedRows,
        });
      };

      vi.spyOn(db, "select").mockImplementation(() => ({
        from: (table: unknown) => ({ where: () => selectable(table) }),
      }) as never);
      vi.spyOn(db, "update").mockImplementation((table: unknown) => ({
        set: (values: { status?: string }) => ({
          where: () => {
            if (table === runs && values.status === "failed") {
              const latest = store.runs[store.runs.length - 1];
              if (latest) latest.status = "failed";
            }
            if (table === proposals && values.status === "rejected") {
              for (const proposal of store.proposals) {
                if (proposal.status === "pending") proposal.status = "rejected";
              }
            }
            return Promise.resolve([]);
          },
        }),
      }) as never);
      vi.spyOn(db, "transaction").mockImplementation(async (callback: any) => {
        const tx = {
          select: () => ({
            from: (table: unknown) => ({ where: () => selectable(table) }),
          }),
          update: (table: unknown) => ({
            set: (values: { status?: string; error?: string | null }) => ({
              where: () => {
                if (table === proposals && values.status === "rejected") {
                  for (const proposal of store.proposals) {
                    if (proposal.status === "pending") proposal.status = "rejected";
                  }
                }
                if (table === tasks && values.status === "pending") {
                  for (const task of store.tasks) {
                    if (task.status !== "completed" && Number(task.attempts ?? 0) < 2) {
                      task.status = "pending";
                      task.error = null;
                    }
                  }
                }
                if (table === runs && values.status) {
                  const latest = store.runs[store.runs.length - 1];
                  if (latest && latest.status === "failed") latest.status = values.status;
                }
                return Promise.resolve([]);
              },
            }),
          }),
          insert: (table: unknown) => ({
            values: (vals: unknown) => {
              const arr = (Array.isArray(vals) ? vals : [vals]) as Array<Record<string, unknown>>;
              if (table === runs) store.runs.push(...arr);
              if (table === tasks) store.tasks.push(...arr);
              return {
                returning: () => Promise.resolve(arr),
                then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
                  Promise.resolve(arr).then(resolve, reject),
              };
            },
          }),
        };
        return callback(tx);
      });
    }

    it("leaves the previous pending proposals pending when dispatch fails", async () => {
      const store = projectStore();
      mockProjectDb(store);
      vi.mocked(enqueue).mockRejectedValueOnce(new Error("queue down"));

      try {
        await expect(rewriteRun("writer-j07", "proj-j07", "More fog.", true)).rejects.toThrow(
          "Worker queue unavailable"
        );
        expect(store.proposals.map((proposal) => proposal.status)).toEqual(["pending", "pending"]);
        expect(store.runs.some((run) => run.status === "failed")).toBe(true);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("keeps revisionRound at 1 when a round-1 task is retried", async () => {
      const store = projectStore();
      store.runs.unshift({
        id: "run-j07-1",
        projectId: "proj-j07",
        bibleId: "bible-j07",
        fixture: "normal",
        status: "failed",
        createdAt: new Date(Date.now() + 60_000),
      });
      store.tasks.push(
        ...[1, 2, 3].map((chapterIndex) => ({
          id: `task-round1-${chapterIndex}`,
          runId: "run-j07-1",
          chapterIndex,
          status: "failed",
          attempts: 1,
          savedInput: { bible: mockBible, version: 1, brief: store.projects[0].brief, revisionRound: 1, editorialInstructions: "More fog." },
        }))
      );
      mockProjectDb(store);

      try {
        await retryRun("writer-j07", "proj-j07", false);
        const retried = store.tasks.filter((task) => task.runId === "run-j07-1");
        expect(retried).toHaveLength(3);
        expect(retried.every((task) => (task.savedInput as { revisionRound: number }).revisionRound === 1)).toBe(true);
        expect(retried.every((task) => task.status === "pending")).toBe(true);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});
