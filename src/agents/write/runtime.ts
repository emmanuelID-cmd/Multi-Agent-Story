import { z } from "zod";
import { chapterSchema, orderedChapters, type Chapter, type Bible, type Brief } from "../../contracts";
import type { ReaderToEditorHandoff } from "../handoff";
import type { WriteModel, WriteAgentRole } from "./model";
import { getPromptForRole } from "./prompts";

export const revisedManuscriptSchema = z.object({
  kind: z.enum(["manuscript_a", "manuscript_b"]),
  editorialLens: z.enum(["continuity_and_pacing", "voice_and_atmosphere"]),
  rationale: z.string().min(1).max(5000),
  chapters: z.array(chapterSchema).length(3),
  changesMade: z.array(
    z.object({
      chapterIndex: z.number().int().min(1).max(3),
      summary: z.string().min(1).max(1000),
      justification: z.string().min(1).max(1000),
    })
  ).min(1),
});

export type RevisedManuscript = z.infer<typeof revisedManuscriptSchema>;

export const chapterProseWireSchema = z.object({
  text: z.string().min(1).max(20000),
});

export const revisedProposalWireSchema = z.object({
  rationale: z.string().min(1).max(5000),
  chapters: z.array(
    z.object({
      chapterIndex: z.number().int().min(1).max(3),
      text: z.string().min(1).max(20000),
    })
  ).length(3),
  changesMade: z.array(
    z.object({
      chapterIndex: z.number().int().min(1).max(3),
      summary: z.string().min(1).max(1000),
      justification: z.string().min(1).max(1000),
    })
  ).min(1),
});

export interface GenerateChapterInput {
  chapterIndex: 1 | 2 | 3;
  bibleVersion: number;
  approvedBible: Bible;
  brief?: Brief;
  precedingChapters?: Chapter[];
}

export interface GenerateChapterResult {
  chapter: Chapter;
  usage: { inputTokens: number; outputTokens: number };
  modelUsed: string;
}

export interface GenerateEditorialProposalInput {
  role: "critic_editor_a" | "critic_editor_b";
  bibleVersion: number;
  approvedBible: Bible;
  baseChapters: Chapter[];
  handoff?: ReaderToEditorHandoff;
  userEditorialInstructions?: string;
}

export interface GenerateEditorialProposalResult {
  proposal: RevisedManuscript;
  usage: { inputTokens: number; outputTokens: number };
  modelUsed: string;
}

/**
 * Generate a single chapter using the assigned model-backed Chapter Writer
 * (chapter_writer_1: Grimm, chapter_writer_2: Andersen, chapter_writer_3: Perrault).
 */
export async function generateChapterProse(
  input: GenerateChapterInput,
  model: WriteModel,
  signal: AbortSignal = new AbortController().signal
): Promise<GenerateChapterResult> {
  const role: WriteAgentRole = `chapter_writer_${input.chapterIndex}` as WriteAgentRole;
  const { alias, systemPrompt } = getPromptForRole(role);

  const assignedBeat = input.approvedBible.beats.find(
    (b) => b.chapterIndex === input.chapterIndex
  );
  if (!assignedBeat) {
    throw new Error(`Missing beat for chapter index ${input.chapterIndex} in approved bible.`);
  }

  // Assemble context for the writer
  const payload = {
    role,
    alias,
    chapterIndex: input.chapterIndex,
    bibleVersion: input.bibleVersion,
    assignedBeat: assignedBeat.text,
    approvedFacts: input.approvedBible.facts,
    brief: input.brief
      ? {
          premise: input.brief.premise,
          audience: input.brief.audience,
          genre: input.brief.genre,
          tone: input.brief.tone,
          desiredEnding: input.brief.desiredEnding,
        }
      : undefined,
    precedingChapters: input.precedingChapters
      ? input.precedingChapters
          .filter((c) => c.chapterIndex < input.chapterIndex)
          .sort((a, b) => a.chapterIndex - b.chapterIndex)
          .map((c) => ({
            chapterIndex: c.chapterIndex,
            text: c.text,
          }))
      : undefined,
  };

  const response = await model.complete({
    role,
    system: systemPrompt,
    data: payload,
    schema: chapterProseWireSchema,
    signal,
  });

  const parsed = chapterProseWireSchema.parse(response.value);

  // Authoritatively construct the Chapter record bound to the exact input bibleVersion
  const chapterRecord = chapterSchema.parse({
    chapterIndex: input.chapterIndex,
    bibleVersion: input.bibleVersion,
    text: parsed.text,
  });

  return {
    chapter: chapterRecord,
    usage: response.usage,
    modelUsed: response.modelUsed,
  };
}

/**
 * Generate a 3-chapter manuscript revision proposal using the assigned Critic/Editor
 * (critic_editor_a: Fontaine, critic_editor_b: Lang).
 */
export async function generateEditorialProposal(
  input: GenerateEditorialProposalInput,
  model: WriteModel,
  signal: AbortSignal = new AbortController().signal
): Promise<GenerateEditorialProposalResult> {
  const { alias, systemPrompt, lens } = getPromptForRole(input.role);

  if (input.baseChapters.length !== 3) {
    throw new Error("Exactly 3 contiguous base chapters are required for editorial proposal.");
  }

  const kind = input.role === "critic_editor_a" ? "manuscript_a" : "manuscript_b";
  const editorialLens = lens ?? (input.role === "critic_editor_a" ? "continuity_and_pacing" : "voice_and_atmosphere");

  const payload = {
    role: input.role,
    alias,
    kind,
    editorialLens,
    bibleVersion: input.bibleVersion,
    approvedFacts: input.approvedBible.facts,
    baseChapters: input.baseChapters.map((c) => ({
      chapterIndex: c.chapterIndex,
      text: c.text,
    })),
    readerHandoff: input.handoff,
    userEditorialInstructions: input.userEditorialInstructions || "Polish legibility, flow, and apply your distinct lens.",
  };

  const response = await model.complete({
    role: input.role,
    system: systemPrompt,
    data: payload,
    schema: revisedProposalWireSchema,
    signal,
  });

  const wireResult = revisedProposalWireSchema.parse(response.value);

  // Bind the chapters authoritatively to the base bibleVersion and validate
  const rawChapters: Chapter[] = wireResult.chapters
    .map((c) =>
      chapterSchema.parse({
        chapterIndex: c.chapterIndex,
        bibleVersion: input.bibleVersion,
        text: c.text,
      })
    );

  // Pass through orderedChapters write barrier to enforce [1, 2, 3] uniqueness and sorting
  const revisedChapters = orderedChapters(rawChapters, input.bibleVersion);

  const proposal = revisedManuscriptSchema.parse({
    kind,
    editorialLens,
    rationale: wireResult.rationale,
    chapters: revisedChapters,
    changesMade: wireResult.changesMade,
  });

  return {
    proposal,
    usage: response.usage,
    modelUsed: response.modelUsed,
  };
}
