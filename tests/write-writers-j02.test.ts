import { describe, expect, it } from "vitest";
import type { Bible, Brief, Chapter } from "../src/contracts";
import {
  draftChapterModel,
  draftChapterOne,
  draftChapterTwo,
  draftChapterThree,
} from "../src/agents/writers";
import {
  executeWriterTool,
  assertWriterTool,
  ALLOWED_WRITER_TOOLS,
} from "../src/agents/write/tools";
import {
  SHARED_WRITER_DIRECTIVE,
  SHARED_EDITOR_DIRECTIVE,
  getPromptForRole,
} from "../src/agents/write/prompts";
import type { WriteModel, WriteModelResponse } from "../src/agents/write/model";

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

const testBrief: Brief = {
  premise: "A solitary lighthouse keeper investigates an enigmatic signal.",
  genre: "Mystery",
  audience: "Adult Fiction",
  tone: "Atmospheric and grounded",
  desiredEnding: "The sailor is saved and the keeper returns safely to shore.",
};

function createMockModel(responseProvider: (req: any) => string): WriteModel {
  return {
    async complete(request) {
      if (request.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const text = responseProvider(request);
      return {
        modelUsed: "claude-3-5-haiku-mock",
        value: { text },
        usage: { inputTokens: 120, outputTokens: 450 },
      } satisfies WriteModelResponse;
    },
  };
}

describe("J02: Three Model-Backed Chapter Writers", () => {
  it("generates Chapter 1 (Grimm) bound to approved bible version and Beat 1", async () => {
    let capturedRole = "";
    let capturedBeat = "";
    const mockModel = createMockModel((req) => {
      capturedRole = req.role;
      capturedBeat = req.data.assignedBeat;
      return "The lantern room smelled of kerosene and cold salt air. Mara stood before the glass.";
    });

    const result = await draftChapterModel(
      {
        index: 1,
        bibleVersion: 1,
        approvedBible: testBible,
        brief: testBrief,
      },
      mockModel
    );

    expect(result.chapter.chapterIndex).toBe(1);
    expect(result.chapter.bibleVersion).toBe(1);
    expect(result.chapter.text).toContain("The lantern room smelled of kerosene");
    expect(capturedRole).toBe("chapter_writer_1");
    expect(capturedBeat).toBe(testBible.beats[0].text);
  });

  it("generates Chapter 2 (Andersen) receiving Chapter 1 as preceding context", async () => {
    const ch1: Chapter = {
      chapterIndex: 1,
      bibleVersion: 1,
      text: "Chapter 1 prose from Mara.",
    };

    let capturedPreceding: any[] = [];
    let capturedRole = "";
    const mockModel = createMockModel((req) => {
      capturedRole = req.role;
      capturedPreceding = req.data.precedingChapters;
      return "Mara pushed the harbor boat away from the wooden pilings, hands blistered from the oars.";
    });

    const result = await draftChapterModel(
      {
        index: 2,
        bibleVersion: 1,
        approvedBible: testBible,
        brief: testBrief,
        precedingChapters: [ch1],
      },
      mockModel
    );

    expect(result.chapter.chapterIndex).toBe(2);
    expect(result.chapter.bibleVersion).toBe(1);
    expect(result.chapter.text).toContain("hands blistered from the oars");
    expect(capturedRole).toBe("chapter_writer_2");
    expect(capturedPreceding).toHaveLength(1);
    expect(capturedPreceding[0].chapterIndex).toBe(1);
  });

  it("generates Chapter 3 (Perrault) receiving Chapters 1 & 2 as preceding context", async () => {
    const ch1: Chapter = {
      chapterIndex: 1,
      bibleVersion: 1,
      text: "Chapter 1 prose.",
    };
    const ch2: Chapter = {
      chapterIndex: 2,
      bibleVersion: 1,
      text: "Chapter 2 prose.",
    };

    let capturedPreceding: any[] = [];
    let capturedRole = "";
    const mockModel = createMockModel((req) => {
      capturedRole = req.role;
      capturedPreceding = req.data.precedingChapters;
      return "The breakwater stones were slick with kelp, but Mara gripped the sailor's wrist firmly.";
    });

    const result = await draftChapterModel(
      {
        index: 3,
        bibleVersion: 1,
        approvedBible: testBible,
        brief: testBrief,
        precedingChapters: [ch1, ch2],
      },
      mockModel
    );

    expect(result.chapter.chapterIndex).toBe(3);
    expect(result.chapter.bibleVersion).toBe(1);
    expect(result.chapter.text).toContain("Mara gripped the sailor's wrist firmly");
    expect(capturedRole).toBe("chapter_writer_3");
    expect(capturedPreceding).toHaveLength(2);
  });

  it("fails fast when an assigned beat is missing in approved bible", async () => {
    const incompleteBible: Bible = {
      facts: testBible.facts,
      beats: [testBible.beats[0]], // Only beat 1
    };
    const mockModel = createMockModel(() => "Prose");

    await expect(
      draftChapterModel(
        {
          index: 2,
          bibleVersion: 1,
          approvedBible: incompleteBible,
        },
        mockModel
      )
    ).rejects.toThrow("Missing beat for chapter index 2");
  });
});

describe("J02: No Fixture Fallback on Model Failure", () => {
  it("propagates model network/API errors without substituting Mara fixture prose", async () => {
    const failingModel: WriteModel = {
      async complete() {
        throw new Error("Anthropic API 500: internal server error");
      },
    };

    let thrownError: Error | null = null;
    try {
      await draftChapterModel(
        {
          index: 1,
          bibleVersion: 1,
          approvedBible: testBible,
        },
        failingModel
      );
    } catch (e: any) {
      thrownError = e;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError?.message).toContain("Anthropic API 500");
    // Explicitly verify the fixture function was NOT called as a silent fallback
    const fixtureCh1 = draftChapterOne(1);
    expect(thrownError?.message).not.toContain(fixtureCh1.text);
  });

  it("propagates schema validation errors when model returns empty or malformed output", async () => {
    const malformedModel: WriteModel = {
      async complete() {
        return {
          modelUsed: "claude-3-5-haiku-mock",
          value: { text: "" }, // Empty string fails min(1) constraint
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
    };

    await expect(
      draftChapterModel(
        {
          index: 2,
          bibleVersion: 1,
          approvedBible: testBible,
        },
        malformedModel
      )
    ).rejects.toThrow();
  });

  it("aborts when AbortSignal is canceled", async () => {
    const controller = new AbortController();
    controller.abort();

    const mockModel = createMockModel(() => "Prose");
    await expect(
      draftChapterModel(
        {
          index: 1,
          bibleVersion: 1,
          approvedBible: testBible,
        },
        mockModel,
        controller.signal
      )
    ).rejects.toThrow("The operation was aborted.");
  });
});

describe("J02: Writer Tool Allowlist & Policy Boundaries", () => {
  const context = {
    approvedBible: testBible,
    bibleVersion: 1,
    chapterIndex: 2 as const,
    brief: testBrief,
    precedingChapters: [
      { chapterIndex: 1, bibleVersion: 1, text: "Ch 1 text" },
    ],
  };

  it("permits allowed tools: read_story_state and propose_story_update", () => {
    expect(ALLOWED_WRITER_TOOLS).toEqual(["read_story_state", "propose_story_update"]);
    expect(() => assertWriterTool("read_story_state")).not.toThrow();
    expect(() => assertWriterTool("propose_story_update")).not.toThrow();
  });

  it("throws AGENT_TOOL_DENIED when an unpermitted tool is invoked", () => {
    expect(() => assertWriterTool("execute_bash_command")).toThrow("AGENT_TOOL_DENIED");
    expect(() => assertWriterTool("write_arbitrary_file")).toThrow("AGENT_TOOL_DENIED");
    expect(() => assertWriterTool("approve_story_state")).toThrow("AGENT_TOOL_DENIED");
    expect(() => executeWriterTool("execute_bash_command", {}, context)).toThrow(
      "AGENT_TOOL_DENIED"
    );
  });

  it("executes read_story_state for approved bible facts and assigned beat", () => {
    const result: any = executeWriterTool(
      "read_story_state",
      { operation: "get_approved_bible" },
      context
    );
    expect(result.bibleVersion).toBe(1);
    expect(result.assignedBeat).toBe(testBible.beats[1].text);
    expect(result.facts).toEqual(testBible.facts);
  });

  it("executes read_story_state for preceding chapters", () => {
    const result: any = executeWriterTool(
      "read_story_state",
      { operation: "get_preceding_chapters" },
      context
    );
    expect(result.precedingChapters).toHaveLength(1);
    expect(result.precedingChapters[0].chapterIndex).toBe(1);
  });

  it("executes propose_story_update and returns validated proposal payload", () => {
    const result: any = executeWriterTool(
      "propose_story_update",
      {
        chapterIndex: 2,
        bibleVersion: 1,
        text: "Valid proposed chapter 2 prose.",
      },
      context
    );
    expect(result.acceptedForValidation).toBe(true);
    expect(result.chapter.chapterIndex).toBe(2);
    expect(result.chapter.bibleVersion).toBe(1);
    expect(result.chapter.text).toBe("Valid proposed chapter 2 prose.");
  });

  it("rejects propose_story_update with mismatched chapter index or stale bible version", () => {
    expect(() =>
      executeWriterTool(
        "propose_story_update",
        {
          chapterIndex: 1, // context index is 2
          bibleVersion: 1,
          text: "Mismatched index",
        },
        context
      )
    ).toThrow("Mismatched chapter index");

    expect(() =>
      executeWriterTool(
        "propose_story_update",
        {
          chapterIndex: 2,
          bibleVersion: 99, // context version is 1
          text: "Stale version",
        },
        context
      )
    ).toThrow("Stale bible version");
  });
});

describe("J02: Anti-Imitation System Prompt Invariants", () => {
  it("enforces that SHARED_WRITER_DIRECTIVE contains the operational emblem invariant", () => {
    expect(SHARED_WRITER_DIRECTIVE).toContain("ROLE ALIAS AS OPERATIONAL EMBLEM");
    expect(SHARED_WRITER_DIRECTIVE).toContain("NOT an instruction to imitate the historical author's prose style");
    expect(SHARED_WRITER_DIRECTIVE).toContain("strictly adhere to the genre, tone, and character voices defined in the user's brief");
  });

  it("enforces that SHARED_EDITOR_DIRECTIVE contains the operational emblem invariant", () => {
    expect(SHARED_EDITOR_DIRECTIVE).toContain("ROLE ALIAS AS OPERATIONAL EMBLEM");
    expect(SHARED_EDITOR_DIRECTIVE).toContain("NOT an instruction to imitate the historical author's prose style");
  });

  it("verifies that all three writer roles inherit the anti-imitation invariant", () => {
    const roles = ["chapter_writer_1", "chapter_writer_2", "chapter_writer_3"] as const;
    for (const role of roles) {
      const prompt = getPromptForRole(role);
      expect(prompt.systemPrompt).toContain("ROLE ALIAS AS OPERATIONAL EMBLEM");
      expect(prompt.systemPrompt).toContain("approved story bible");
    }
  });

  it("verifies that critic editors inherit the craft lens focus without historical imitation", () => {
    const fontaine = getPromptForRole("critic_editor_a");
    expect(fontaine.systemPrompt).toContain("CONTINUITY AND PACING");
    expect(fontaine.systemPrompt).toContain("structural clarity, causal discipline, and elegant pacing");
    expect(fontaine.systemPrompt).not.toContain("Fontaine's characteristic clarity");

    const lang = getPromptForRole("critic_editor_b");
    expect(lang.systemPrompt).toContain("VOICE AND ATMOSPHERE");
    expect(lang.systemPrompt).toContain("sensory depth, resonant mood, and evocative atmospheric color");
    expect(lang.systemPrompt).not.toContain("Lang's characteristic depth");
  });
});
