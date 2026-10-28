import { z } from "zod";
import { chapterSchema, orderedChapters, type Chapter, type Bible, type Brief } from "../../contracts";
import { assertAgentTool } from "../../contracts/input-policy";
import type { ReaderToEditorHandoff } from "../handoff";

export const ALLOWED_WRITER_TOOLS = ["read_story_state", "propose_story_update"] as const;
export type WriterToolName = (typeof ALLOWED_WRITER_TOOLS)[number];

export function assertWriterTool(toolName: string): asserts toolName is WriterToolName {
  assertAgentTool("writer", toolName);
}

export const ALLOWED_CRITIC_TOOLS = ["read_story_state", "propose_story_update"] as const;
export type CriticToolName = (typeof ALLOWED_CRITIC_TOOLS)[number];

export function assertCriticTool(toolName: string): asserts toolName is CriticToolName {
  assertAgentTool("critic", toolName);
}

export const readStoryStateSchema = z.object({
  operation: z.enum(["get_approved_bible", "get_preceding_chapters"]),
});
export type ReadStoryStateInput = z.infer<typeof readStoryStateSchema>;

export const criticReadStoryStateSchema = z.object({
  operation: z.enum(["get_approved_bible", "get_base_chapters", "get_reader_handoff"]),
});
export type CriticReadStoryStateInput = z.infer<typeof criticReadStoryStateSchema>;

export const proposeStoryUpdateSchema = z.object({
  chapterIndex: z.number().int().min(1).max(3),
  bibleVersion: z.number().int().positive(),
  text: z.string().min(1).max(20000),
});
export type ProposeStoryUpdateInput = z.infer<typeof proposeStoryUpdateSchema>;

export const criticProposeStoryUpdateSchema = z.object({
  bibleVersion: z.number().int().positive(),
  chapterIndex: z.number().int().min(1).max(3).optional(),
  text: z.string().min(1).max(20000).optional(),
  chapters: z
    .array(
      z.object({
        chapterIndex: z.number().int().min(1).max(3),
        text: z.string().min(1).max(20000),
      })
    )
    .min(1)
    .max(3)
    .optional(),
});
export type CriticProposeStoryUpdateInput = z.infer<typeof criticProposeStoryUpdateSchema>;

export interface WriterToolContext {
  approvedBible: Bible;
  bibleVersion: number;
  chapterIndex: 1 | 2 | 3;
  brief?: Brief;
  precedingChapters?: Chapter[];
}

export interface CriticToolContext {
  approvedBible: Bible;
  bibleVersion: number;
  baseChapters: Chapter[];
  handoff: ReaderToEditorHandoff;
  role?: "critic_editor_a" | "critic_editor_b";
}

export interface ProposedStoryUpdateResult {
  acceptedForValidation: boolean;
  chapter: Chapter;
}

export interface CriticProposedStoryUpdateResult {
  acceptedForValidation: boolean;
  chapters: Chapter[];
}

/**
 * Execute a permitted writer tool against the writer context.
 * Throws AGENT_TOOL_DENIED if the tool is not in the writer's allowlist.
 */
export function executeWriterTool(
  toolName: string,
  rawArgs: unknown,
  context: WriterToolContext
): unknown {
  assertWriterTool(toolName);

  if (toolName === "read_story_state") {
    const parsed = readStoryStateSchema.parse(rawArgs);
    if (parsed.operation === "get_approved_bible") {
      const assignedBeat = context.approvedBible.beats.find(
        (b) => b.chapterIndex === context.chapterIndex
      );
      return {
        bibleVersion: context.bibleVersion,
        assignedBeat: assignedBeat?.text ?? null,
        facts: context.approvedBible.facts,
      };
    }
    if (parsed.operation === "get_preceding_chapters") {
      return {
        precedingChapters: (context.precedingChapters ?? [])
          .filter((c) => c.chapterIndex < context.chapterIndex)
          .map((c) => ({
            chapterIndex: c.chapterIndex,
            text: c.text,
          })),
      };
    }
  }

  if (toolName === "propose_story_update") {
    const parsed = proposeStoryUpdateSchema.parse(rawArgs);
    if (parsed.chapterIndex !== context.chapterIndex) {
      throw new Error(
        `Mismatched chapter index: proposed ${parsed.chapterIndex}, assigned ${context.chapterIndex}.`
      );
    }
    if (parsed.bibleVersion !== context.bibleVersion) {
      throw new Error(
        `Stale bible version: proposed ${parsed.bibleVersion}, approved ${context.bibleVersion}.`
      );
    }

    const validatedChapter = chapterSchema.parse({
      chapterIndex: parsed.chapterIndex,
      bibleVersion: parsed.bibleVersion,
      text: parsed.text,
    });

    return {
      acceptedForValidation: true,
      chapter: validatedChapter,
    } satisfies ProposedStoryUpdateResult;
  }

  throw new Error(`Unhandled writer tool: ${toolName}`);
}

/**
 * Execute a permitted critic tool against the critic context.
 * Throws AGENT_TOOL_DENIED if the tool is not in the critic's allowlist.
 */
export function executeCriticTool(
  toolName: string,
  rawArgs: unknown,
  context: CriticToolContext
): unknown {
  assertCriticTool(toolName);

  if (toolName === "read_story_state") {
    const parsed = criticReadStoryStateSchema.parse(rawArgs);
    if (parsed.operation === "get_approved_bible") {
      return {
        bibleVersion: context.bibleVersion,
        facts: context.approvedBible.facts,
        beats: context.approvedBible.beats,
      };
    }
    if (parsed.operation === "get_base_chapters") {
      return {
        bibleVersion: context.bibleVersion,
        chapters: context.baseChapters.map((c) => ({
          chapterIndex: c.chapterIndex,
          bibleVersion: c.bibleVersion,
          text: c.text,
        })),
      };
    }
    if (parsed.operation === "get_reader_handoff") {
      return {
        version: context.handoff.version,
        task: context.handoff.task,
        completeness: context.handoff.completeness,
        sourceReferences: context.handoff.sourceReferences,
        userInstructions: context.handoff.userInstructions,
      };
    }
  }

  if (toolName === "propose_story_update") {
    const parsed = criticProposeStoryUpdateSchema.parse(rawArgs);
    if (parsed.bibleVersion !== context.bibleVersion) {
      throw new Error(
        `Stale bible version: proposed ${parsed.bibleVersion}, approved ${context.bibleVersion}.`
      );
    }

    const rawChapters = parsed.chapters ?? (
      parsed.chapterIndex && parsed.text
        ? [{ chapterIndex: parsed.chapterIndex, text: parsed.text }]
        : []
    );

    if (rawChapters.length === 0) {
      throw new Error("Missing chapters in proposal update.");
    }

    // A critic proposal is the whole manuscript. One chapter or a repeated index is not accepted.
    const validatedChapters = orderedChapters(
      rawChapters.map((ch) =>
        chapterSchema.parse({
          chapterIndex: ch.chapterIndex,
          bibleVersion: parsed.bibleVersion,
          text: ch.text,
        })
      ),
      parsed.bibleVersion
    );

    return {
      acceptedForValidation: true,
      chapters: validatedChapters,
    } satisfies CriticProposedStoryUpdateResult;
  }

  throw new Error(`Unhandled critic tool: ${toolName}`);
}
