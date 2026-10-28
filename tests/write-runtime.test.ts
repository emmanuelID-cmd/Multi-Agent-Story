import { describe, expect, it } from "vitest";
import type { Bible, Chapter } from "../src/contracts";
import { AnthropicWriteModel } from "../src/agents/write/model";
import {
  generateChapterProse,
  generateEditorialProposal,
  revisedManuscriptSchema,
} from "../src/agents/write/runtime";
import { getPromptForRole } from "../src/agents/write/prompts";

const testBible: Bible = {
  facts: [
    { id: "F1", text: "Mara, a lighthouse keeper, cannot swim." },
    { id: "F2", text: "The blue signal is human-made." },
    { id: "F3", text: "The missing sailor is rescued using a boat." },
  ],
  beats: [
    { chapterIndex: 1, text: "Mara spots a pulsing blue light past the breakwater." },
    { chapterIndex: 2, text: "Mara navigates the harbor skiff through rising gale waters." },
    { chapterIndex: 3, text: "Mara reaches the breakwater, rescues the sailor, and returns safely." },
  ],
};

const baseChapters: Chapter[] = [
  { chapterIndex: 1, bibleVersion: 1, text: "Chapter 1: The beacon was silent..." },
  { chapterIndex: 2, bibleVersion: 1, text: "Chapter 2: The skiff rocked against the black waves..." },
  { chapterIndex: 3, bibleVersion: 1, text: "Chapter 3: The harbor lantern guided them home..." },
];

function mockFetcherWith(responseJson: unknown): typeof fetch {
  return async () =>
    Response.json({
      content: [{ type: "text", text: JSON.stringify(responseJson) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
}

describe("WRITE Runtime Boundary (J01)", () => {
  describe("Fairy Tale Persona & Prompt Verification", () => {
    it("returns correct alias and directives for all 5 roles", () => {
      expect(getPromptForRole("chapter_writer_1").alias).toBe("Grimm");
      expect(getPromptForRole("chapter_writer_1").systemPrompt).toContain("Grimm");
      expect(getPromptForRole("chapter_writer_1").systemPrompt).toContain("SEQUENTIAL CONTINUITY");

      expect(getPromptForRole("chapter_writer_2").alias).toBe("Andersen");
      expect(getPromptForRole("chapter_writer_2").systemPrompt).toContain("Andersen");

      expect(getPromptForRole("chapter_writer_3").alias).toBe("Perrault");
      expect(getPromptForRole("chapter_writer_3").systemPrompt).toContain("Perrault");

      expect(getPromptForRole("critic_editor_a").alias).toBe("Fontaine");
      expect(getPromptForRole("critic_editor_a").lens).toBe("continuity_and_pacing");

      expect(getPromptForRole("critic_editor_b").alias).toBe("Lang");
      expect(getPromptForRole("critic_editor_b").lens).toBe("voice_and_atmosphere");
    });
  });

  describe("generateChapterProse", () => {
    it("generates Chapter 1 with Grimm and binds exact bibleVersion", async () => {
      const mockModel = new AnthropicWriteModel("test-key", {
        fetcher: mockFetcherWith({
          text: "Mara shielded her eyes against the gale. The blue light pulsed once, twice...",
        }),
      });

      const result = await generateChapterProse(
        {
          chapterIndex: 1,
          bibleVersion: 42,
          approvedBible: testBible,
        },
        mockModel
      );

      expect(result.chapter.chapterIndex).toBe(1);
      expect(result.chapter.bibleVersion).toBe(42);
      expect(result.chapter.text).toContain("Mara shielded her eyes");
    });

    it("passes preceding chapters to Chapter 2 (Andersen) for continuity", async () => {
      let capturedPayload: any;
      const fetcher: typeof fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        capturedPayload = JSON.parse(body.messages[0].content).storyContext;
        return Response.json({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                text: "Holding fast to the gunwale, Mara pushed into the swell...",
              }),
            },
          ],
          stop_reason: "end_turn",
          usage: { input_tokens: 120, output_tokens: 60 },
        });
      };

      const mockModel = new AnthropicWriteModel("test-key", { fetcher });
      const result = await generateChapterProse(
        {
          chapterIndex: 2,
          bibleVersion: 1,
          approvedBible: testBible,
          precedingChapters: [baseChapters[0]],
        },
        mockModel
      );

      expect(result.chapter.chapterIndex).toBe(2);
      expect(capturedPayload.role).toBe("chapter_writer_2");
      expect(capturedPayload.alias).toBe("Andersen");
      expect(capturedPayload.precedingChapters).toHaveLength(1);
      expect(capturedPayload.precedingChapters[0].chapterIndex).toBe(1);
    });

    it("passes premise and audience from brief into writer payload", async () => {
      let capturedPayload: any;
      const fetcher: typeof fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        capturedPayload = JSON.parse(body.messages[0].content).storyContext;
        return Response.json({
          content: [{ type: "text", text: JSON.stringify({ text: "Grimm chapter text" }) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 150, output_tokens: 75 },
        });
      };

      const mockModel = new AnthropicWriteModel("test-key", { fetcher });
      const brief = {
        premise: "Mara follows a blue signal to rescue a missing sailor.",
        genre: "Adventure",
        audience: "Young Adult",
        tone: "Atmospheric",
        desiredEnding: "Safe rescue by boat.",
      };

      await generateChapterProse(
        {
          chapterIndex: 1,
          bibleVersion: 1,
          approvedBible: testBible,
          brief,
        },
        mockModel
      );

      expect(capturedPayload.brief.premise).toBe("Mara follows a blue signal to rescue a missing sailor.");
      expect(capturedPayload.brief.audience).toBe("Young Adult");
      expect(capturedPayload.brief.genre).toBe("Adventure");
      expect(capturedPayload.brief.tone).toBe("Atmospheric");
      expect(capturedPayload.brief.desiredEnding).toBe("Safe rescue by boat.");
    });

    it("defensively filters future chapters and sorts preceding chapters in strict ascending order", async () => {
      let capturedPayload: any;
      const fetcher: typeof fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        capturedPayload = JSON.parse(body.messages[0].content).storyContext;
        return Response.json({
          content: [{ type: "text", text: JSON.stringify({ text: "Chapter 2 prose" }) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 110, output_tokens: 55 },
        });
      };

      const mockModel = new AnthropicWriteModel("test-key", { fetcher });

      // Pass scrambled chapters including future chapter 3 when generating Chapter 2
      await generateChapterProse(
        {
          chapterIndex: 2,
          bibleVersion: 1,
          approvedBible: testBible,
          precedingChapters: [baseChapters[2], baseChapters[0]], // ch3, ch1
        },
        mockModel
      );

      // Chapter 3 must be filtered out because 3 >= 2
      expect(capturedPayload.precedingChapters).toHaveLength(1);
      expect(capturedPayload.precedingChapters[0].chapterIndex).toBe(1);

      // For Chapter 3, pass [ch2, ch1] scrambled
      await generateChapterProse(
        {
          chapterIndex: 3,
          bibleVersion: 1,
          approvedBible: testBible,
          precedingChapters: [baseChapters[1], baseChapters[0]], // ch2, ch1
        },
        mockModel
      );

      // Must be sorted [1, 2]
      expect(capturedPayload.precedingChapters).toHaveLength(2);
      expect(capturedPayload.precedingChapters[0].chapterIndex).toBe(1);
      expect(capturedPayload.precedingChapters[1].chapterIndex).toBe(2);
    });

    it("returns model telemetry (usage and modelUsed) alongside chapter prose", async () => {
      const mockModel = new AnthropicWriteModel("test-key", {
        fetcher: async () =>
          Response.json({
            content: [{ type: "text", text: JSON.stringify({ text: "Telemetric chapter prose" }) }],
            stop_reason: "end_turn",
            usage: { input_tokens: 220, output_tokens: 110 },
          }),
      });

      const result = await generateChapterProse(
        {
          chapterIndex: 1,
          bibleVersion: 5,
          approvedBible: testBible,
        },
        mockModel
      );

      // Chapter record
      expect(result.chapter.chapterIndex).toBe(1);
      expect(result.chapter.bibleVersion).toBe(5);
      expect(result.chapter.text).toBe("Telemetric chapter prose");

      // Telemetry properties
      expect(result.usage).toEqual({ inputTokens: 220, outputTokens: 110 });
      expect(result.modelUsed).toContain("claude");
    });

    it("throws if chapter beat is missing in approved bible", async () => {
      const emptyBible: Bible = { facts: [], beats: [] as any };
      const mockModel = new AnthropicWriteModel("test-key", {
        fetcher: mockFetcherWith({ text: "some text" }),
      });

      await expect(
        generateChapterProse(
          { chapterIndex: 1, bibleVersion: 1, approvedBible: emptyBible },
          mockModel
        )
      ).rejects.toThrow("Missing beat for chapter index 1");
    });
  });

  describe("generateEditorialProposal", () => {
    it("generates a complete revision proposal with Fontaine (Continuity & Pacing)", async () => {
      const mockModel = new AnthropicWriteModel("test-key", {
        fetcher: mockFetcherWith({
          rationale: "Tightened chapter transitions and aligned boat handling with Fact F1.",
          chapters: [
            { chapterIndex: 1, text: "Revised Ch 1 with crisp pacing." },
            { chapterIndex: 2, text: "Revised Ch 2 with tight nautical maneuvers." },
            { chapterIndex: 3, text: "Revised Ch 3 with swift resolution." },
          ],
          changesMade: [
            {
              chapterIndex: 2,
              summary: "Clarified boat navigation.",
              justification: "Maintains Fact F1 that Mara cannot swim.",
            },
          ],
        }),
      });

      const result = await generateEditorialProposal(
        {
          role: "critic_editor_a",
          bibleVersion: 7,
          approvedBible: testBible,
          baseChapters,
        },
        mockModel
      );

      expect(result.proposal.kind).toBe("manuscript_a");
      expect(result.proposal.editorialLens).toBe("continuity_and_pacing");
      expect(result.proposal.chapters).toHaveLength(3);
      expect(result.proposal.chapters.every((c) => c.bibleVersion === 7)).toBe(true);
      expect(result.proposal.changesMade).toHaveLength(1);
      expect(result.usage).toBeDefined();
      expect(result.modelUsed).toBeDefined();
      expect(() => revisedManuscriptSchema.parse(result.proposal)).not.toThrow();
    });

    it("generates a complete revision proposal with Lang (Voice & Atmosphere)", async () => {
      const mockModel = new AnthropicWriteModel("test-key", {
        fetcher: mockFetcherWith({
          rationale: "Enriched sensory ocean spray and eerie lantern luminescence.",
          chapters: [
            { chapterIndex: 1, text: "Lyrical Ch 1 drenched in brine and fog." },
            { chapterIndex: 2, text: "Atmospheric Ch 2 amid surging indigo currents." },
            { chapterIndex: 3, text: "Poetic Ch 3 under dawn's pale amber veil." },
          ],
          changesMade: [
            {
              chapterIndex: 1,
              summary: "Deepened coastal imagery.",
              justification: "Enhances mood and atmospheric immersion.",
            },
          ],
        }),
      });

      const result = await generateEditorialProposal(
        {
          role: "critic_editor_b",
          bibleVersion: 7,
          approvedBible: testBible,
          baseChapters,
        },
        mockModel
      );

      expect(result.proposal.kind).toBe("manuscript_b");
      expect(result.proposal.editorialLens).toBe("voice_and_atmosphere");
      expect(result.proposal.chapters).toHaveLength(3);
      expect(result.proposal.chapters.every((c) => c.bibleVersion === 7)).toBe(true);
      expect(result.usage).toBeDefined();
      expect(result.modelUsed).toBeDefined();
    });

    it("rejects fewer than 3 base chapters", async () => {
      const mockModel = new AnthropicWriteModel("test-key", {
        fetcher: mockFetcherWith({}),
      });

      await expect(
        generateEditorialProposal(
          {
            role: "critic_editor_a",
            bibleVersion: 1,
            approvedBible: testBible,
            baseChapters: [baseChapters[0], baseChapters[1]], // only 2 chapters
          },
          mockModel
        )
      ).rejects.toThrow("Exactly 3 contiguous base chapters are required");
    });
  });
});
