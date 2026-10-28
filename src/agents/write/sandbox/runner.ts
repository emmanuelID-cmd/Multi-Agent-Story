import { join } from "node:path";
import { orderedChapters, type Chapter } from "../../../contracts";
import { draftChapterModel } from "../../writers";
import { AnthropicWriteModel, type WriteModel, type WriteModelResponse } from "../model";
import { cleanProseTypography } from "../runtime";
import { SandboxTracer, type BibleRunTrace } from "./tracer";
import { type MockBibleCase } from "../../../../tests/fixtures/mock-bibles";
import { resolveSandboxPaths } from "./cleanup";

export interface SandboxExecutionOptions {
  model?: WriteModel;
  useLiveModel?: boolean;
  baseDir?: string;
}

function stripTerminal(s: string): string {
  return s.trim().replace(/[.,;:!?\s]+$/, "");
}

function lowerFirst(s: string): string {
  return s.length > 0 ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/**
 * Creates a deterministic narrative simulator that outputs rich,
 * genre-tailored prose adhering to the role prompts (Grimm, Andersen, Perrault)
 * without consuming Anthropic API credits.
 */
export function createSandboxSimulatedModel(bibleCase: MockBibleCase): WriteModel {
  return {
    async complete(call) {
      if (call.signal?.aborted) {
        throw new DOMException("Operation canceled.", "AbortError");
      }

      const role = call.role;
      const index = role === "chapter_writer_1" ? 1 : role === "chapter_writer_2" ? 2 : 3;
      const rawBeat = bibleCase.bible.beats.find((b) => b.chapterIndex === index)?.text ?? "";
      const beat = stripTerminal(rawBeat);

      let text = "";
      if (index === 1) {
        // Beat 1: World grounding, tactile stakes, opening incident
        const fact0 = lowerFirst(stripTerminal(bibleCase.bible.facts[0].text));
        text = `The air was sharp and laden with the grit of ${stripTerminal(bibleCase.expectedToneNotes).toLowerCase()}. ` +
          `The narrative grounded the physical setting where ${fact0}. ` +
          `Without hesitation, the journey commenced under the shadows: ${beat}. ` +
          `Every stone and shadow echoed with the warning that the boundaries were shifting, ` +
          `leaving an open path for what was to follow.`;
      } else if (index === 2) {
        // Beat 2: Emotional depth, internal conflict, midpoint crisis
        const fact1 = lowerFirst(stripTerminal(bibleCase.bible.facts[1]?.text ?? "the stakes had doubled"));
        text = `A lingering ache tightened in the chest as the initial excitement turned to dread. ` +
          `The narrative carried the continuity forward from the first encounter. ` +
          `It became painfully clear that ${fact1}. ` +
          `Facing the midpoint storm: ${beat}. ` +
          `Between tears and endurance, the crucible demanded everything before the night gave way.`;
      } else {
        // Beat 3: Climax, falling action, decisive resolution
        const fact2 = lowerFirst(stripTerminal(bibleCase.bible.facts[2]?.text ?? "no thread could be abandoned"));
        const desiredEnding = lowerFirst(stripTerminal(bibleCase.brief.desiredEnding));
        text = `The final hour arrived with the force of an unyielding tide. ` +
          `The story threads reached their decisive apex. ` +
          `Remembering that ${fact2}, ` +
          `the decisive action unfolded: ${beat}. ` +
          `With the climax met and the danger subdued, ${desiredEnding}. ` +
          `Peace settled across the landscape, unbroken and complete.`;
      }

      const cleanedText = cleanProseTypography(text);

      const precedingCount = Array.isArray((call.data as any)?.precedingChapters)
        ? (call.data as any).precedingChapters.length
        : 0;
      const promptTokens = 250 + precedingCount * 180;
      const completionTokens = Math.round(cleanedText.length / 4);

      return {
        modelUsed: "sandbox-simulated-haiku",
        value: { text: cleanedText },
        usage: { inputTokens: promptTokens, outputTokens: completionTokens },
      } satisfies WriteModelResponse;
    },
  };
}

/**
 * Executes a full 3-chapter writer sequence in the sandbox,
 * collecting telemetry and running the write barrier.
 */
export async function executeBibleInSandbox(
  bibleCase: MockBibleCase,
  options: SandboxExecutionOptions = {}
): Promise<BibleRunTrace> {
  const tracer = new SandboxTracer(bibleCase.id, bibleCase.name, bibleCase.bibleVersion);

  let model: WriteModel;
  if (options.model) {
    model = options.model;
  } else if (options.useLiveModel) {
    const key = process.env.WRITE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY required for live sandbox run.");
    model = new AnthropicWriteModel(key);
  } else {
    model = createSandboxSimulatedModel(bibleCase);
  }

  const generatedChapters: Chapter[] = [];

  // 1. Chapter 1: Grimm
  const t1Start = Date.now();
  const res1 = await draftChapterModel(
    {
      index: 1,
      bibleVersion: bibleCase.bibleVersion,
      approvedBible: bibleCase.bible,
      brief: bibleCase.brief,
    },
    model
  );
  const t1Duration = Date.now() - t1Start;
  generatedChapters.push(res1.chapter);
  tracer.recordStep({
    chapterIndex: 1,
    role: "chapter_writer_1",
    alias: "Grimm",
    assignedBeat: bibleCase.bible.beats.find((b) => b.chapterIndex === 1)!.text,
    precedingChaptersPassed: [],
    modelUsed: res1.modelUsed,
    usage: res1.usage,
    durationMs: t1Duration,
    chapterText: res1.chapter.text,
    charCount: res1.chapter.text.length,
    wordCount: res1.chapter.text.split(/\s+/).length,
    validationSuccess: true,
  });

  // 2. Chapter 2: Andersen (Receives Ch 1 context)
  const t2Start = Date.now();
  const res2 = await draftChapterModel(
    {
      index: 2,
      bibleVersion: bibleCase.bibleVersion,
      approvedBible: bibleCase.bible,
      brief: bibleCase.brief,
      precedingChapters: [res1.chapter],
    },
    model
  );
  const t2Duration = Date.now() - t2Start;
  generatedChapters.push(res2.chapter);
  tracer.recordStep({
    chapterIndex: 2,
    role: "chapter_writer_2",
    alias: "Andersen",
    assignedBeat: bibleCase.bible.beats.find((b) => b.chapterIndex === 2)!.text,
    precedingChaptersPassed: [1],
    modelUsed: res2.modelUsed,
    usage: res2.usage,
    durationMs: t2Duration,
    chapterText: res2.chapter.text,
    charCount: res2.chapter.text.length,
    wordCount: res2.chapter.text.split(/\s+/).length,
    validationSuccess: true,
  });

  // 3. Chapter 3: Perrault (Receives Ch 1 & 2 context)
  const t3Start = Date.now();
  const res3 = await draftChapterModel(
    {
      index: 3,
      bibleVersion: bibleCase.bibleVersion,
      approvedBible: bibleCase.bible,
      brief: bibleCase.brief,
      precedingChapters: [res1.chapter, res2.chapter],
    },
    model
  );
  const t3Duration = Date.now() - t3Start;
  generatedChapters.push(res3.chapter);
  tracer.recordStep({
    chapterIndex: 3,
    role: "chapter_writer_3",
    alias: "Perrault",
    assignedBeat: bibleCase.bible.beats.find((b) => b.chapterIndex === 3)!.text,
    precedingChaptersPassed: [1, 2],
    modelUsed: res3.modelUsed,
    usage: res3.usage,
    durationMs: t3Duration,
    chapterText: res3.chapter.text,
    charCount: res3.chapter.text.length,
    wordCount: res3.chapter.text.split(/\s+/).length,
    validationSuccess: true,
  });

  // 4. J03 Chapter Write Barrier Validation
  let barrierOutcome: { assembled: boolean; chapters?: Chapter[]; error?: string };
  try {
    const assembled = orderedChapters(generatedChapters, bibleCase.bibleVersion);
    barrierOutcome = { assembled: true, chapters: assembled };
  } catch (err) {
    barrierOutcome = {
      assembled: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const runTrace = tracer.buildTrace(barrierOutcome);

  // Save trace JSON and review Markdown if paths resolved
  const paths = resolveSandboxPaths(options.baseDir);
  SandboxTracer.saveTraceJson(
    runTrace,
    join(paths.traces, `${bibleCase.id}_trace.json`)
  );
  SandboxTracer.saveReviewMarkdown(
    runTrace,
    join(paths.reviews, `${bibleCase.id}_review.md`)
  );

  return runTrace;
}
