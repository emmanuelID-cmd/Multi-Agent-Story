import { describe, expect, it } from "vitest";
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
    });
  });
});
