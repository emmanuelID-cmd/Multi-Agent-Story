import { chapterSchema, type Chapter, type Fixture, type Bible, type Brief } from "../contracts";
import type { WriteModel } from "./write/model";
import {
  generateChapterProse,
  type GenerateChapterInput,
  type GenerateChapterResult,
} from "./write/runtime";

export function draftChapterOne(bibleVersion: number): Chapter {
  return chapterSchema.parse({
    chapterIndex: 1,
    bibleVersion,
    text: "[Synthetic fixture — not model-generated prose]\n\n" +
      "Mara watched a blue signal blink beyond the lighthouse. She marked its pattern on paper and checked the tide. She could not swim, so she kept clear of the water and prepared the harbor boat. The light was a clue, not a command.",
  });
}

export function draftChapterTwo(bibleVersion: number, fixture: Fixture): Chapter {
  const text = fixture === "continuity"
    ? "Mara swam toward the signal. This deliberately contradicts approved fact F1 and must remain visible to the continuity critic."
    : "Mara investigated from the boat, following the marked pattern. A shuttered lantern on the breakwater made the blue signal: it was human-made. She called to the missing sailor and planned a safe approach without entering the water.";

  return chapterSchema.parse({
    chapterIndex: 2,
    bibleVersion,
    text: `[Synthetic fixture — not model-generated prose]\n\n${text}`,
  });
}

export function draftChapterThree(bibleVersion: number): Chapter {
  return chapterSchema.parse({
    chapterIndex: 3,
    bibleVersion,
    text: "[Synthetic fixture — not model-generated prose]\n\n" +
      "Mara secured the boat alongside the breakwater and helped the missing sailor aboard. They returned to the harbor together. The human-made signal had guided the rescue, and the boat had kept her out of the water. She recorded what remained to investigate after everyone was safe.",
  });
}

export function draftChapter(index: number, bibleVersion: number, fixture: Fixture): Chapter {
  switch (index) {
    case 1:
      return draftChapterOne(bibleVersion);
    case 2:
      return draftChapterTwo(bibleVersion, fixture);
    case 3:
      return draftChapterThree(bibleVersion);
    default:
      throw new Error(`Invalid chapter index: ${index}`);
  }
}

export interface DraftChapterModelInput {
  index: 1 | 2 | 3;
  bibleVersion: number;
  approvedBible: Bible;
  brief?: Brief;
  precedingChapters?: Chapter[];
}

/**
 * Live model-backed chapter generation for J02.
 * Connects all three chapter writers (1: Grimm, 2: Andersen, 3: Perrault)
 * to model-generated prose using the approved bible.
 *
 * CRITICAL INVARIANT: Failures are never replaced by fixture prose.
 */
export async function draftChapterModel(
  input: DraftChapterModelInput,
  model: WriteModel,
  signal?: AbortSignal
): Promise<GenerateChapterResult> {
  const chapterInput: GenerateChapterInput = {
    chapterIndex: input.index,
    bibleVersion: input.bibleVersion,
    approvedBible: input.approvedBible,
    brief: input.brief,
    precedingChapters: input.precedingChapters,
  };
  return generateChapterProse(chapterInput, model, signal);
}

