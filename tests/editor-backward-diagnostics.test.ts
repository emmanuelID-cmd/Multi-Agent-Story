import { describe, expect, it } from "vitest";
import { type Chapter } from "../src/contracts";
import { buildFixtureHandoff, type ReaderToEditorHandoff } from "../src/agents/handoff";
import {
  analyzeEditorTraceBackward,
  type BackwardAnalysisResult,
} from "../src/agents/write/sandbox/editor-tracer";
import { type RevisedManuscript } from "../src/agents/write/runtime";

const baseChapters: Chapter[] = [
  { chapterIndex: 1, bibleVersion: 1, text: "Ch 1 text." },
  { chapterIndex: 2, bibleVersion: 1, text: "Ch 2 text." },
  { chapterIndex: 3, bibleVersion: 1, text: "Ch 3 text." },
];

const recordedRequest = "Clean test request.";

const validProposal: RevisedManuscript = {
  kind: "manuscript_a",
  editorialLens: "continuity_and_pacing",
  rationale: "Disciplined narrative pacing and transition polish.",
  chapters: [
    { chapterIndex: 1, bibleVersion: 1, text: "Revised 1." },
    { chapterIndex: 2, bibleVersion: 1, text: "Revised 2." },
    { chapterIndex: 3, bibleVersion: 1, text: "Revised 3." },
  ],
  changesMade: [
    {
      chapterIndex: 2,
      summary: "Polished pacing.",
      justification: "Avoids dragging.",
    },
  ],
};

describe("Editor Backward Diagnostics: Fault Isolation & Attribution", () => {
  it("returns faultCode: NONE when base chapters, handoff, and proposal are all healthy", () => {
    const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
    const result = analyzeEditorTraceBackward({
      baseChapters,
      handoff,
      proposal: validProposal,
      expectedBibleVersion: 1,
    });

    expect(result.faultCode).toBe("NONE");
    expect(result.isolatedAt).toBe("clean");
  });

  describe("Base Chapter Faults (BASE_CHAPTER_FAULT)", () => {
    it("isolates fault to BASE_CHAPTER_FAULT when base chapters are missing a chapter", () => {
      const incompleteBase = [baseChapters[0], baseChapters[1]]; // Missing Ch 3!
      const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);

      const result = analyzeEditorTraceBackward({
        baseChapters: incompleteBase,
        handoff,
        proposal: validProposal,
        expectedBibleVersion: 1,
      });

      expect(result.faultCode).toBe("BASE_CHAPTER_FAULT");
      expect(result.message).toContain("All three unique chapters are required");
      expect(result.isolatedAt).toContain("baseChapters write barrier");
    });

    it("isolates fault to BASE_CHAPTER_FAULT when base chapters contain duplicate indexes", () => {
      const duplicateBase = [baseChapters[0], baseChapters[0], baseChapters[2]];
      const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);

      const result = analyzeEditorTraceBackward({
        baseChapters: duplicateBase,
        handoff,
        proposal: validProposal,
        expectedBibleVersion: 1,
      });

      expect(result.faultCode).toBe("BASE_CHAPTER_FAULT");
      expect(result.message).toContain("All three unique chapters are required");
    });

    it("isolates fault to BASE_CHAPTER_FAULT when base chapters reference wrong bibleVersion", () => {
      const wrongVersionBase = baseChapters.map((c) => ({ ...c, bibleVersion: 2 }));
      const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);

      const result = analyzeEditorTraceBackward({
        baseChapters: wrongVersionBase,
        handoff,
        proposal: validProposal,
        expectedBibleVersion: 1, // Expected 1, found 2
      });

      expect(result.faultCode).toBe("BASE_CHAPTER_FAULT");
      expect(result.message).toContain("Stale chapter version");
    });
  });

  describe("Reader Handoff Faults (READER_HANDOFF_FAULT)", () => {
    it("isolates fault to READER_HANDOFF_FAULT when handoff completeness flag is false", () => {
      const faultyHandoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
      faultyHandoff.completeness.isComplete = false;
      faultyHandoff.completeness.missingItems = ["chapter_2 continuity analysis missing"];

      const result = analyzeEditorTraceBackward({
        baseChapters,
        handoff: faultyHandoff,
        proposal: validProposal,
        expectedBibleVersion: 1,
      });

      expect(result.faultCode).toBe("READER_HANDOFF_FAULT");
      expect(result.message).toContain("chapter_2 continuity analysis missing");
      expect(result.isolatedAt).toBe("handoff.completeness.isComplete");
    });

    it("isolates fault to READER_HANDOFF_FAULT when handoff confidence is below 0.8", () => {
      const lowConfidenceHandoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
      lowConfidenceHandoff.completeness.confidence = 0.65;

      const result = analyzeEditorTraceBackward({
        baseChapters,
        handoff: lowConfidenceHandoff,
        proposal: validProposal,
        expectedBibleVersion: 1,
      });

      expect(result.faultCode).toBe("READER_HANDOFF_FAULT");
      expect(result.message).toContain("below required threshold (0.8)");
      expect(result.isolatedAt).toBe("handoff.completeness.confidence");
    });

    it("isolates fault to READER_HANDOFF_FAULT when sourceReferences misses a required chapter", () => {
      const missingRefHandoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
      missingRefHandoff.sourceReferences = missingRefHandoff.sourceReferences.filter(
        (r) => r.locator !== "chapter_2"
      );

      const result = analyzeEditorTraceBackward({
        baseChapters,
        handoff: missingRefHandoff,
        proposal: validProposal,
        expectedBibleVersion: 1,
      });

      expect(result.faultCode).toBe("READER_HANDOFF_FAULT");
      expect(result.message).toContain("missing coverage for chapter_2");
      expect(result.isolatedAt).toBe("handoff.sourceReferences");
    });
  });

  describe("Editor Proposal Faults (EDITOR_PROPOSAL_FAULT)", () => {
    it("isolates fault to EDITOR_PROPOSAL_FAULT when proposed chapters fail the write barrier", () => {
      const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
      const malformedProposal: RevisedManuscript = {
        ...validProposal,
        chapters: [validProposal.chapters[0], validProposal.chapters[1]], // Missing Ch 3!
      };

      const result = analyzeEditorTraceBackward({
        baseChapters,
        handoff,
        proposal: malformedProposal,
        expectedBibleVersion: 1,
      });

      expect(result.faultCode).toBe("EDITOR_PROPOSAL_FAULT");
      expect(result.message).toContain("All three unique chapters are required");
      expect(result.isolatedAt).toContain("proposal.chapters write barrier");
    });

    it("isolates fault to EDITOR_PROPOSAL_FAULT when proposal rationale is empty", () => {
      const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
      const emptyRationaleProposal: RevisedManuscript = {
        ...validProposal,
        rationale: "   ",
      };

      const result = analyzeEditorTraceBackward({
        baseChapters,
        handoff,
        proposal: emptyRationaleProposal,
        expectedBibleVersion: 1,
      });

      expect(result.faultCode).toBe("EDITOR_PROPOSAL_FAULT");
      expect(result.message).toContain("missing rationale");
      expect(result.isolatedAt).toBe("proposal.rationale");
    });

    it("isolates fault to EDITOR_PROPOSAL_FAULT when proposal changesMade is empty", () => {
      const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
      const noChangesProposal: RevisedManuscript = {
        ...validProposal,
        changesMade: [],
      };

      const result = analyzeEditorTraceBackward({
        baseChapters,
        handoff,
        proposal: noChangesProposal,
        expectedBibleVersion: 1,
      });

      expect(result.faultCode).toBe("EDITOR_PROPOSAL_FAULT");
      expect(result.message).toContain("empty changesMade array");
      expect(result.isolatedAt).toBe("proposal.changesMade");
    });
  });
});
