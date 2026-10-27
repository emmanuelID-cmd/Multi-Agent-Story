import { z } from "zod";
import { chapterSchema, type Chapter, type Bible, type Brief } from "../../contracts";
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

export interface GenerateEditorialProposalInput {
  role: "critic_editor_a" | "critic_editor_b";
  bibleVersion: number;
  approvedBible: Bible;
  baseChapters: Chapter[];
  handoff?: ReaderToEditorHandoff;
  userEditorialInstructions?: string;
}

/**
 * Generate a single chapter using the assigned model-backed Chapter Writer
 * (chapter_writer_1: Grimm, chapter_writer_2: Andersen, chapter_writer_3: Perrault).
 */
export async function generateChapterProse(
  input: GenerateChapterInput,
  model: WriteModel,
  signal: AbortSignal = new AbortController().signal
): Promise<Chapter> {
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
          genre: input.brief.genre,
          tone: input.brief.tone,
          desiredEnding: input.brief.desiredEnding,
        }
      : undefined,
    precedingChapters: input.precedingChapters?.map((c) => ({
      chapterIndex: c.chapterIndex,
      text: c.text,
    })),
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
  return chapterSchema.parse({
    chapterIndex: input.chapterIndex,
    bibleVersion: input.bibleVersion,
    text: parsed.text,
  });
}

/**
 * Generate a 3-chapter manuscript revision proposal using the assigned Critic/Editor
 * (critic_editor_a: Fontaine, critic_editor_b: Lang).
 */
export async function generateEditorialProposal(
  input: GenerateEditorialProposalInput,
  model: WriteModel,
  signal: AbortSignal = new AbortController().signal
): Promise<RevisedManuscript> {
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
  const revisedChapters: Chapter[] = wireResult.chapters
    .sort((a, b) => a.chapterIndex - b.chapterIndex)
    .map((c) =>
      chapterSchema.parse({
        chapterIndex: c.chapterIndex,
        bibleVersion: input.bibleVersion,
        text: c.text,
      })
    );

  return revisedManuscriptSchema.parse({
    kind,
    editorialLens,
    rationale: wireResult.rationale,
    chapters: revisedChapters,
    changesMade: wireResult.changesMade,
  });
}
