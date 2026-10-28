import { describe, expect, it } from "vitest";
import {
  orderedChapters,
  type Chapter,
  type Bible,
  type Brief,
} from "../src/contracts";
import {
  buildFixtureHandoff,
  validateEditorReceivingHandoff,
  EditorialHandoffRejectionError,
  type ReaderToEditorHandoff,
} from "../src/agents/handoff";
import {
  criticEditorA,
  criticEditorB,
  criticEditorAModel,
  criticEditorBModel,
  type CriticEditorModelInput,
} from "../src/agents/editors";
import {
  ALLOWED_CRITIC_TOOLS,
  assertCriticTool,
} from "../src/agents/write/tools";
import {
  EDITOR_PROMPTS,
  SHARED_EDITOR_DIRECTIVE,
} from "../src/agents/write/prompts";
import {
  AnthropicWriteModel,
  type WriteModel,
  type WriteModelResponse,
} from "../src/agents/write/model";

const testBible: Bible = {
  facts: [
    { id: "F1", text: "Mara, a lighthouse keeper, cannot swim." },
    { id: "F2", text: "The blue signal is human-made." },
    { id: "F3", text: "The missing sailor is rescued using a harbor boat." },
  ],
  beats: [
    { chapterIndex: 1, text: "Discover the blue signal from the lantern tower." },
    { chapterIndex: 2, text: "Investigate its human origin from the harbor boat." },
    { chapterIndex: 3, text: "Rescue the missing sailor at the breakwater." },
  ],
};

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

const recordedRequest = "A safe rescue by boat with tight continuity.";

function createMockModel(responseProvider: (req: any) => any): WriteModel {
  return {
    async complete(request) {
      if (request.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const value = responseProvider(request);
      return {
        modelUsed: "claude-haiku-mock",
        value,
        usage: { inputTokens: 250, outputTokens: 600 },
      } satisfies WriteModelResponse;
    },
  };
}

describe("J04: Reader Handoff Receiving & Semantic Sufficiency Validation", () => {
  it("accepts a fully populated, semantically sufficient 5-field handoff", () => {
    const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
    const result = validateEditorReceivingHandoff({
      handoff,
      expectedRecordedRequest: recordedRequest,
      baseChapters,
      approvedBibleVersion: 1,
    });

    expect(result.valid).toBe(true);
    expect(result.rejection).toBeUndefined();
  });

  it("rejects when handoff schema is missing required top-level fields", () => {
    const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest) as any;
    delete handoff.userInstructions;

    const result = validateEditorReceivingHandoff({
      handoff,
      expectedRecordedRequest: recordedRequest,
      baseChapters,
      approvedBibleVersion: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.rejection?.failedChecks).toContain("SCHEMA_CONFORMANCE_FAILED");
    expect(result.rejection?.requestedCorrection).toContain("Supply all five required fields");
  });

  it("rejects when recorded request does not match coordinator authority", () => {
    const handoff = buildFixtureHandoff(
      baseChapters,
      1,
      "unauthorized user instruction override"
    );

    const result = validateEditorReceivingHandoff({
      handoff,
      expectedRecordedRequest: recordedRequest,
      baseChapters,
      approvedBibleVersion: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.rejection?.failedChecks).toContain("USER_INSTRUCTION_MISMATCH");
    expect(result.rejection?.missingItems).toContain(
      "User instructions must match coordinator recorded request exactly."
    );
  });

  it("rejects when completeness flag is false (incomplete coverage)", () => {
    const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
    handoff.completeness.isComplete = false;
    handoff.completeness.missingItems = ["chapter_2 continuity analysis"];

    const result = validateEditorReceivingHandoff({
      handoff,
      expectedRecordedRequest: recordedRequest,
      baseChapters,
      approvedBibleVersion: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.rejection?.failedChecks).toContain("INCOMPLETE_HANDOFF_COVERAGE");
    expect(result.rejection?.missingItems).toContain("chapter_2 continuity analysis");
  });

  it("rejects when reported confidence is below the required threshold (0.8)", () => {
    const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
    handoff.completeness.confidence = 0.65;

    const result = validateEditorReceivingHandoff({
      handoff,
      expectedRecordedRequest: recordedRequest,
      baseChapters,
      approvedBibleVersion: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.rejection?.failedChecks).toContain("INSUFFICIENT_COMPLETENESS_CONFIDENCE");
    expect(result.rejection?.missingItems[0]).toContain("below required threshold (0.8)");
  });

  it("rejects when source references miss a required chapter", () => {
    const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
    // Remove chapter 2 from source references
    handoff.sourceReferences = handoff.sourceReferences.filter(
      (r) => r.locator !== "chapter_2"
    );

    const result = validateEditorReceivingHandoff({
      handoff,
      expectedRecordedRequest: recordedRequest,
      baseChapters,
      approvedBibleVersion: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.rejection?.failedChecks).toContain("MISSING_REQUIRED_SOURCE_CHAPTER");
    expect(result.rejection?.missingItems).toContain("chapter_2");
  });

  it("rejects when handoff bibleVersion does not match approved version", () => {
    const handoff = buildFixtureHandoff(baseChapters, 2, recordedRequest); // version 2

    const result = validateEditorReceivingHandoff({
      handoff,
      expectedRecordedRequest: recordedRequest,
      baseChapters,
      approvedBibleVersion: 1, // expected version 1
    });

    expect(result.valid).toBe(false);
    expect(result.rejection?.failedChecks).toContain("BIBLE_VERSION_MISMATCH");
  });

  it("rejects when base chapters fail the write barrier", () => {
    const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
    const corruptedBaseChapters = [baseChapters[0], baseChapters[0], baseChapters[2]]; // duplicate ch1

    const result = validateEditorReceivingHandoff({
      handoff,
      expectedRecordedRequest: recordedRequest,
      baseChapters: corruptedBaseChapters,
      approvedBibleVersion: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.rejection?.failedChecks).toContain("BASE_CHAPTERS_BARRIER_FAILED");
  });
});

describe("J04: Model-Backed Critic/Editor A (Fontaine: Continuity & Pacing)", () => {
  it("generates a complete manuscript_a proposal with continuity & pacing lens", async () => {
    let capturedRole = "";
    let capturedData: any = null;
    const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);

    const mockModel = createMockModel((req) => {
      capturedRole = req.role;
      capturedData = req.data;
      return {
        rationale: "Sharpened causal transitions and ensured nautical compliance with Fact F1.",
        chapters: [
          { chapterIndex: 1, text: "Revised Chapter 1 with disciplined pacing." },
          { chapterIndex: 2, text: "Revised Chapter 2 strictly maneuvering by boat." },
          { chapterIndex: 3, text: "Revised Chapter 3 with coherent rescue resolution." },
        ],
        changesMade: [
          {
            chapterIndex: 2,
            summary: "Enforced boat-only rescue approach.",
            justification: "Honors Fact F1 that Mara cannot swim.",
          },
        ],
      };
    });

    const input: CriticEditorModelInput = {
      bibleVersion: 1,
      handoff,
      baseChapters,
      approvedBible: testBible,
      expectedRecordedRequest: recordedRequest,
    };

    const result = await criticEditorAModel(input, mockModel);

    // Verify proposal structure
    expect(result.proposal.kind).toBe("manuscript_a");
    expect(result.proposal.editorialLens).toBe("continuity_and_pacing");
    expect(result.proposal.rationale).toContain("Sharpened causal transitions");
    expect(result.proposal.chapters).toHaveLength(3);
    expect(result.proposal.chapters.map((c) => c.chapterIndex)).toEqual([1, 2, 3]);
    expect(result.proposal.chapters.every((c) => c.bibleVersion === 1)).toBe(true);
    expect(result.proposal.changesMade).toHaveLength(1);

    // Verify telemetry
    expect(result.usage.inputTokens).toBe(250);
    expect(result.usage.outputTokens).toBe(600);
    expect(result.modelUsed).toBe("claude-haiku-mock");

    // Verify context sent to model
    expect(capturedRole).toBe("critic_editor_a");
    expect(capturedData.alias).toBe("Fontaine");
    expect(capturedData.editorialLens).toBe("continuity_and_pacing");
    expect(capturedData.approvedFacts).toEqual(testBible.facts);
  });

  it("aborts and throws EditorialHandoffRejectionError without calling model on invalid handoff", async () => {
    let modelCalled = false;
    const failingModel = createMockModel(() => {
      modelCalled = true;
      return {};
    });

    const invalidHandoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
    invalidHandoff.completeness.isComplete = false;
    invalidHandoff.completeness.missingItems = ["chapter_3 resolution analysis"];

    const input: CriticEditorModelInput = {
      bibleVersion: 1,
      handoff: invalidHandoff,
      baseChapters,
      approvedBible: testBible,
      expectedRecordedRequest: recordedRequest,
    };

    await expect(criticEditorAModel(input, failingModel)).rejects.toThrow(
      EditorialHandoffRejectionError
    );
    expect(modelCalled).toBe(false);
  });
});

describe("J04: Model-Backed Critic/Editor B (Lang: Voice & Atmosphere)", () => {
  it("generates a complete manuscript_b proposal with voice & atmosphere lens", async () => {
    let capturedRole = "";
    let capturedData: any = null;
    const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);

    const mockModel = createMockModel((req) => {
      capturedRole = req.role;
      capturedData = req.data;
      return {
        rationale: "Elevated sensory brine mist and eerie beacon luminance across all three chapters.",
        chapters: [
          { chapterIndex: 1, text: "Lyrical Chapter 1 heavy with cold fog and iron tang." },
          { chapterIndex: 2, text: "Atmospheric Chapter 2 amidst dark swells and creaking wood." },
          { chapterIndex: 3, text: "Poetic Chapter 3 under the pale amber beam of survival." },
        ],
        changesMade: [
          {
            chapterIndex: 1,
            summary: "Deepened coastal texture.",
            justification: "Evokes atmospheric immersion of the solitary keeper.",
          },
        ],
      };
    });

    const input: CriticEditorModelInput = {
      bibleVersion: 1,
      handoff,
      baseChapters,
      approvedBible: testBible,
      expectedRecordedRequest: recordedRequest,
    };

    const result = await criticEditorBModel(input, mockModel);

    // Verify proposal structure
    expect(result.proposal.kind).toBe("manuscript_b");
    expect(result.proposal.editorialLens).toBe("voice_and_atmosphere");
    expect(result.proposal.rationale).toContain("Elevated sensory brine mist");
    expect(result.proposal.chapters).toHaveLength(3);
    expect(result.proposal.chapters.map((c) => c.chapterIndex)).toEqual([1, 2, 3]);
    expect(result.proposal.chapters.every((c) => c.bibleVersion === 1)).toBe(true);
    expect(result.proposal.changesMade).toHaveLength(1);

    // Verify context sent to model
    expect(capturedRole).toBe("critic_editor_b");
    expect(capturedData.alias).toBe("Lang");
    expect(capturedData.editorialLens).toBe("voice_and_atmosphere");
    expect(capturedData.approvedFacts).toEqual(testBible.facts);
  });

  it("aborts and throws EditorialHandoffRejectionError without calling model on invalid handoff", async () => {
    let modelCalled = false;
    const failingModel = createMockModel(() => {
      modelCalled = true;
      return {};
    });

    const invalidHandoff = buildFixtureHandoff(baseChapters, 1, "tampered request");

    const input: CriticEditorModelInput = {
      bibleVersion: 1,
      handoff: invalidHandoff,
      baseChapters,
      approvedBible: testBible,
      expectedRecordedRequest: recordedRequest,
    };

    await expect(criticEditorBModel(input, failingModel)).rejects.toThrow(
      EditorialHandoffRejectionError
    );
    expect(modelCalled).toBe(false);
  });
});

describe("J04: Invariants, Anti-Imitation & Tool Boundaries", () => {
  it("resolves distinct temperature configurations for Fontaine (0.4) vs Lang (0.8)", () => {
    const anthropicModel = new AnthropicWriteModel("test-key");
    expect(anthropicModel.resolveDefaultTemperature("critic_editor_a")).toBe(0.4);
    expect(anthropicModel.resolveDefaultTemperature("critic_editor_b")).toBe(0.8);
    expect(anthropicModel.resolveDefaultMaxTokens("critic_editor_a")).toBe(8192);
    expect(anthropicModel.resolveDefaultMaxTokens("critic_editor_b")).toBe(8192);
  });

  it("SHARED_EDITOR_DIRECTIVE specifies Fontaine and Lang as operational emblems and bans names in prose", () => {
    expect(SHARED_EDITOR_DIRECTIVE).toContain("ROLE ALIAS AS OPERATIONAL EMBLEM");
    expect(SHARED_EDITOR_DIRECTIVE).toContain(
      "Never mention or refer to Fontaine or Lang inside the revised story prose."
    );
    expect(EDITOR_PROMPTS.critic_editor_a.alias).toBe("Fontaine");
    expect(EDITOR_PROMPTS.critic_editor_b.alias).toBe("Lang");
  });

  it("never silently falls back to Mara fixture on live model failure", async () => {
    const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
    const brokenModel: WriteModel = {
      async complete() {
        throw new Error("Anthropic API rate limit exceeded");
      },
    };

    const input: CriticEditorModelInput = {
      bibleVersion: 1,
      handoff,
      baseChapters,
      approvedBible: testBible,
      expectedRecordedRequest: recordedRequest,
    };

    let capturedError: Error | null = null;
    try {
      await criticEditorAModel(input, brokenModel);
    } catch (e: any) {
      capturedError = e;
    }

    expect(capturedError).toBeDefined();
    expect(capturedError?.message).toContain("Anthropic API rate limit exceeded");

    // Ensure fixture proposal was NOT substituted
    const fixtureA = criticEditorA(handoff, baseChapters, testBible);
    expect(capturedError?.message).not.toContain(fixtureA.rationale);
  });

  it("propagates AbortSignal when operation is canceled", async () => {
    const controller = new AbortController();
    controller.abort();

    const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
    const mockModel = createMockModel(() => ({}));

    const input: CriticEditorModelInput = {
      bibleVersion: 1,
      handoff,
      baseChapters,
      approvedBible: testBible,
      expectedRecordedRequest: recordedRequest,
    };

    await expect(
      criticEditorAModel(input, mockModel, controller.signal)
    ).rejects.toThrow("The operation was aborted.");
  });

  it("enforces critics' tool allowlist throwing AGENT_TOOL_DENIED on unauthorized tools", () => {
    expect(ALLOWED_CRITIC_TOOLS).toEqual(["read_story_state", "propose_story_update"]);

    expect(() => assertCriticTool("read_story_state")).not.toThrow();
    expect(() => assertCriticTool("propose_story_update")).not.toThrow();
    expect(() => assertCriticTool("unauthorized_write")).toThrow("AGENT_TOOL_DENIED");
    expect(() => assertCriticTool("publish_story")).toThrow("AGENT_TOOL_DENIED");
    expect(() => assertCriticTool("execute_sql")).toThrow("AGENT_TOOL_DENIED");
  });

  it("preserves input baseChapters array and objects immutably", async () => {
    const handoff = buildFixtureHandoff(baseChapters, 1, recordedRequest);
    const mockModel = createMockModel(() => ({
      rationale: "Edited.",
      chapters: [
        { chapterIndex: 1, text: "New 1" },
        { chapterIndex: 2, text: "New 2" },
        { chapterIndex: 3, text: "New 3" },
      ],
      changesMade: [{ chapterIndex: 1, summary: "Sum", justification: "Just" }],
    }));

    const ch1OriginalText = baseChapters[0].text;
    const input: CriticEditorModelInput = {
      bibleVersion: 1,
      handoff,
      baseChapters,
      approvedBible: testBible,
      expectedRecordedRequest: recordedRequest,
    };

    await criticEditorAModel(input, mockModel);

    // Verify input baseChapters was not mutated in place
    expect(baseChapters[0].text).toBe(ch1OriginalText);
    expect(baseChapters).toHaveLength(3);
  });
});
