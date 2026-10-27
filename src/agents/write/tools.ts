import { z } from "zod";
import { chapterSchema, type Chapter, type Bible, type Brief } from "../../contracts";
import { assertAgentTool } from "../../contracts/input-policy";

export const ALLOWED_WRITER_TOOLS = ["read_story_state", "propose_story_update"] as const;
export type WriterToolName = (typeof ALLOWED_WRITER_TOOLS)[number];

export function assertWriterTool(toolName: string): asserts toolName is WriterToolName {
  assertAgentTool("writer", toolName);
}

export const readStoryStateSchema = z.object({
  operation: z.enum(["get_approved_bible", "get_preceding_chapters"]),
});
export type ReadStoryStateInput = z.infer<typeof readStoryStateSchema>;

export const proposeStoryUpdateSchema = z.object({
  chapterIndex: z.number().int().min(1).max(3),
  bibleVersion: z.number().int().positive(),
  text: z.string().min(1).max(20000),
});
export type ProposeStoryUpdateInput = z.infer<typeof proposeStoryUpdateSchema>;

export interface WriterToolContext {
  approvedBible: Bible;
  bibleVersion: number;
  chapterIndex: 1 | 2 | 3;
  brief?: Brief;
  precedingChapters?: Chapter[];
}

export interface ProposedStoryUpdateResult {
  acceptedForValidation: boolean;
  chapter: Chapter;
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
