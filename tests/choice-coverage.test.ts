import { describe, expect, it } from "vitest";
import type { Bible } from "../src/contracts";
import { briefSchema } from "../src/contracts";
import { intakeRecordSchema } from "../src/contracts/intake";
import type { BiblePlanningInput } from "../src/contracts/planning";
import {
  assertPlanningChoiceCoverage,
  planningCall,
  planningOutputSchema,
  planningRoles,
} from "../src/agents/bible-planning";
import {
  EDITOR_PROMPTS,
  SHARED_EDITOR_DIRECTIVE,
  SHARED_WRITER_DIRECTIVE,
  WRITER_PROMPTS,
} from "../src/agents/write/prompts";
import type { WriteModel } from "../src/agents/write/model";
import { generateChapterProse, generateEditorialProposal } from "../src/agents/write/runtime";

/**
 * One list of confirmed choices, shared by the planner check, the writer payload, and the editor payload.
 * The language line is one example among them. It is not its own rule.
 */
const confirmedChoices = [
  { field: "ending" as const, value: "They part at dawn and the farewell is never translated." },
  { field: "characterArcs" as const, value: "Elena and Jonah are cousins who refuse to forgive the unpaid debt." },
  { field: "lore" as const, value: "A promise spoken at dusk cannot be broken until the next dawn." },
  { field: "characters" as const, value: "Elena speaks only Spanish, and Jonah cannot answer her in that language." },
];

const digest = "a".repeat(64);

const storyBible: Bible = {
  facts: [
    { id: "F-ending", text: "They part at dawn and the farewell is never translated." },
    { id: "F-kin", text: "Elena and Jonah are cousins who refuse to forgive the unpaid debt." },
    { id: "F-rule", text: "A promise spoken at dusk cannot be broken until the next dawn." },
  ],
  beats: [
    { chapterIndex: 1, text: "Elena speaks only Spanish, and Jonah cannot answer her in that language." },
    { chapterIndex: 2, text: "The unpaid debt hardens between the cousins." },
    { chapterIndex: 3, text: "They part at dawn without a translated farewell." },
  ],
};

const fullCoverage = [
  { field: "ending", factId: "F-ending" },
  { field: "characterArcs", factId: "F-kin" },
  { field: "lore", factId: "F-rule" },
  { field: "characters", chapterIndex: 1 },
];

/** Builds one planner candidate around the shared choice list. The bible itself stays facts and beats. */
function candidate(coverage: unknown, bible: Bible = storyBible) {
  return planningOutputSchema.parse({
    role: "bible_a",
    confirmedInputHash: digest,
    dossierHash: digest,
    bible,
    coverage,
    conflicts: [],
  });
}

const savedBrief = briefSchema.parse({
  premise: "Elena and Jonah inherit a dusk promise they cannot translate to each other.",
  genre: "drama",
  audience: "adult",
  tone: "quiet",
  desiredEnding: confirmedChoices[0].value,
  intake: intakeRecordSchema.parse({
    version: 1,
    revision: 1,
    rawText: "Elena and Jonah inherit a dusk promise they cannot translate to each other.",
    status: "confirmed",
    decisions: [],
    confirmed: {
      at: "2026-10-31T18:00:00.000Z",
      analysisId: "6f1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
      scope: { genre: "drama", providers: ["nyt", "gutendex"], dimensions: confirmedChoices },
    },
  }),
});

describe("confirmed choice coverage", () => {
  it("rejects a candidate that leaves a confirmed choice uncovered or points at a missing fact or beat", () => {
    const omitted = candidate(fullCoverage.filter(entry => entry.field !== "lore"));
    expect(() => assertPlanningChoiceCoverage(confirmedChoices, omitted)).toThrow("PLANNING_COVERAGE");

    const missingFact = candidate(fullCoverage.map(entry => (
      entry.field === "lore" ? { field: "lore", factId: "F-missing" } : entry
    )));
    expect(() => assertPlanningChoiceCoverage(confirmedChoices, missingFact)).toThrow("PLANNING_COVERAGE");

    const missingBeat = {
      bible: { facts: storyBible.facts, beats: storyBible.beats.filter(beat => beat.chapterIndex !== 1) },
      coverage: fullCoverage,
    };
    expect(() => assertPlanningChoiceCoverage(confirmedChoices, missingBeat)).toThrow("PLANNING_COVERAGE");
  });

  it("accepts a candidate that points every confirmed choice at a real fact or beat", () => {
    const kept = planningOutputSchema.parse({
      role: "bible_b",
      confirmedInputHash: digest,
      dossierHash: digest,
      bible: { ...storyBible, characterVulnerabilities: ["a special case"] },
      coverage: fullCoverage,
      conflicts: [],
    });
    expect(Object.keys(kept.bible).sort()).toEqual(["beats", "facts"]);
    expect(kept.bible).toEqual(storyBible);
    expect(kept.bible).not.toHaveProperty("characterVulnerabilities");
    expect(() => assertPlanningChoiceCoverage(confirmedChoices, kept)).not.toThrow();
    expect(() => assertPlanningChoiceCoverage(
      [...confirmedChoices, { field: "tone", value: "   " }],
      kept,
    )).not.toThrow();
  });

  it("tells every planner to restate each confirmed choice without a special-case tag", () => {
    const input = {} as BiblePlanningInput;
    const signal = new AbortController().signal;
    for (const role of planningRoles) {
      const system = planningCall(input, role, signal).system;
      expect(system).toContain("Restate every non-empty confirmed choice in at least one fact or beat.");
      expect(system).toContain("Plot, character, and world emphasis may still differ.");
      expect(system).toContain("Do not drop a choice to make the plot smoother.");
      expect(system).not.toContain("cohere smoothly");
      expect(system).not.toMatch(/friction-only|friction tag|characterVulnerabilities|language barrier|language-barrier/i);
    }
    expect(planningCall(input, "bible_a", signal).system).toContain("plot and mystery");
    expect(planningCall(input, "bible_b", signal).system).toContain("character and stakes");
    expect(planningCall(input, "bible_c", signal).system).toContain("world and atmosphere");
  });

  it("states the shared writer and editor rule and keeps each craft lens", () => {
    expect(SHARED_WRITER_DIRECTIVE).toContain("confirmed choices that its beat carries");
    expect(SHARED_WRITER_DIRECTIVE).toContain("solving it, skipping it, or treating it as flavor");
    expect(SHARED_EDITOR_DIRECTIVE).toContain("approved facts and the confirmed choices");
    expect(SHARED_EDITOR_DIRECTIVE).toContain("dropped or contradicted choice is restored");
    expect(SHARED_EDITOR_DIRECTIVE).toContain("Their lenses stay continuity and voice");

    expect(WRITER_PROMPTS.chapter_writer_1.systemPrompt).toContain("Establish the world, protagonist, physical setting, and tactile reality.");
    expect(WRITER_PROMPTS.chapter_writer_1.alias).toBe("Grimm");
    expect(WRITER_PROMPTS.chapter_writer_2.systemPrompt).toContain("interpersonal friction");
    expect(WRITER_PROMPTS.chapter_writer_2.alias).toBe("Andersen");
    expect(WRITER_PROMPTS.chapter_writer_3.systemPrompt).toContain("decisive climax");
    expect(WRITER_PROMPTS.chapter_writer_3.alias).toBe("Perrault");
    expect(EDITOR_PROMPTS.critic_editor_a.lens).toBe("continuity_and_pacing");
    expect(EDITOR_PROMPTS.critic_editor_a.alias).toBe("Fontaine");
    expect(EDITOR_PROMPTS.critic_editor_b.lens).toBe("voice_and_atmosphere");
    expect(EDITOR_PROMPTS.critic_editor_b.alias).toBe("Lang");

    const prompts = [
      SHARED_WRITER_DIRECTIVE,
      SHARED_EDITOR_DIRECTIVE,
      ...Object.values(WRITER_PROMPTS).map(prompt => prompt.systemPrompt),
      ...Object.values(EDITOR_PROMPTS).map(prompt => prompt.systemPrompt),
    ];
    for (const prompt of prompts) {
      expect(prompt).toContain(prompt === SHARED_EDITOR_DIRECTIVE || prompt.includes("Fontaine")
        ? "approved facts and the confirmed choices"
        : "confirmed choices that its beat carries");
      expect(prompt).not.toMatch(/friction-only|friction tag|characterVulnerabilities|language barrier|language-barrier/i);
    }
  });

  it("sends the same confirmed choices on the chapter and editorial payloads", async () => {
    const seen: Array<{ role: string; system: string; data: { confirmedDimensions?: unknown; brief?: { desiredEnding?: string } } }> = [];
    const model: WriteModel = {
      async complete(call) {
        seen.push({ role: call.role, system: call.system, data: call.data as { confirmedDimensions?: unknown; brief?: { desiredEnding?: string } } });
        if (call.role === "critic_editor_a") {
          return {
            value: {
              rationale: "Restored the confirmed choices the draft had dropped.",
              chapters: [1, 2, 3].map(chapterIndex => ({
                chapterIndex,
                text: `Chapter ${chapterIndex} keeps the cousins and the dusk promise.`,
              })),
              changesMade: [{
                chapterIndex: 1,
                summary: "Restored the dusk promise.",
                justification: "The confirmed world rule was missing from the draft.",
              }],
            },
            usage: { inputTokens: 3, outputTokens: 3 },
            modelUsed: "stub-editor",
          };
        }
        return {
          value: { text: "Elena spoke, and Jonah could not answer her in Spanish." },
          usage: { inputTokens: 2, outputTokens: 2 },
          modelUsed: "stub-writer",
        };
      },
    };

    await generateChapterProse({
      chapterIndex: 1,
      bibleVersion: 1,
      approvedBible: storyBible,
      brief: savedBrief,
    }, model);
    await generateEditorialProposal({
      role: "critic_editor_a",
      bibleVersion: 1,
      approvedBible: storyBible,
      baseChapters: [1, 2, 3].map(chapterIndex => ({
        chapterIndex: chapterIndex as 1 | 2 | 3,
        bibleVersion: 1,
        text: `Draft chapter ${chapterIndex}.`,
      })),
      brief: savedBrief,
    }, model);

    expect(seen).toHaveLength(2);
    expect(seen[0].data.confirmedDimensions).toEqual(confirmedChoices);
    expect(seen[1].data.confirmedDimensions).toEqual(confirmedChoices);
    expect(seen[0].data.brief?.desiredEnding).toBe(confirmedChoices[0].value);
    expect(seen[0].system).toContain("confirmed choices that its beat carries");
    expect(seen[0].system).toContain("Establish the world");
    expect(seen[1].system).toContain("approved facts and the confirmed choices");
    expect(seen[1].system).toContain("CONTINUITY AND PACING");
    expect(seen[0].system).not.toMatch(/friction-only|friction tag|characterVulnerabilities/i);
    expect(seen[1].system).not.toMatch(/friction-only|friction tag|characterVulnerabilities/i);
  });
});
