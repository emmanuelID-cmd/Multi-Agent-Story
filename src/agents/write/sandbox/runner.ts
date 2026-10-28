import { join } from "node:path";
import { orderedChapters, type Chapter } from "../../../contracts";
import { draftChapterModel } from "../../writers";
import { AnthropicWriteModel, type WriteModel, type WriteModelResponse } from "../model";
import { SandboxTracer, type BibleRunTrace } from "./tracer";
import { type MockBibleCase } from "../../../../tests/fixtures/mock-bibles";
import { resolveSandboxPaths } from "./cleanup";

export interface SandboxExecutionOptions {
  model?: WriteModel;
  useLiveModel?: boolean;
  baseDir?: string;
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
      const beat = bibleCase.bible.beats.find((b) => b.chapterIndex === index)?.text ?? "";

      let text = "";
      if (index === 1) {
        // Grimm: World grounding, tactile stakes, opening incident
        text = `The air was sharp and laden with the grit of ${bibleCase.expectedToneNotes.toLowerCase()}. ` +
          `Grimm established the setting where ${bibleCase.bible.facts[0].text} ` +
          `Without hesitation, the journey commenced under the shadows: ${beat}. ` +
          `Every stone and shadow echoed with the warning that the boundaries were shifting, ` +
          `leaving an open path for what was to follow.`;
      } else if (index === 2) {
        // Andersen: Emotional depth, internal conflict, midpoint crisis
        text = `A lingering ache tightened in the chest as the initial excitement turned to dread. ` +
          `Andersen carried the continuity forward from the first encounter. ` +
          `It became painfully clear that ${bibleCase.bible.facts[1]?.text ?? "the stakes had doubled"}. ` +
          `Facing the midpoint storm: ${beat}. ` +
          `Between tears and endurance, the crucible demanded everything before the night gave way.`;
      } else {
        // Perrault: Climax, falling action, decisive resolution
        text = `The final hour arrived with the force of an unyielding tide. ` +
          `Perrault brought the narrative threads to their apex. ` +
          `Remembering that ${bibleCase.bible.facts[2]?.text ?? "no thread could be abandoned"}, ` +
          `the decisive action unfolded: ${beat}. ` +
          `With the climax met and the danger subdued, ${bibleCase.brief.desiredEnding} ` +
          `Peace settled across the landscape, unbroken and complete.`;
      }

      const precedingCount = Array.isArray((call.data as any)?.precedingChapters)
        ? (call.data as any).precedingChapters.length
        : 0;
      const promptTokens = 250 + precedingCount * 180;
      const completionTokens = Math.round(text.length / 4);

      return {
        modelUsed: "sandbox-simulated-haiku",
        value: { text },
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
  const ch1 = await draftChapterModel(
    {
      index: 1,
      bibleVersion: bibleCase.bibleVersion,
      approvedBible: bibleCase.bible,
      brief: bibleCase.brief,
    },
    model
  );
  const t1Duration = Date.now() - t1Start;
  generatedChapters.push(ch1);
  tracer.recordStep({
    chapterIndex: 1,
    role: "chapter_writer_1",
    alias: "Grimm",
    assignedBeat: bibleCase.bible.beats.find((b) => b.chapterIndex === 1)!.text,
    precedingChaptersPassed: [],
    modelUsed: "chapter_writer_1 (Haiku)",
    usage: { inputTokens: 250, outputTokens: Math.round(ch1.text.length / 4) },
    durationMs: t1Duration,
    chapterText: ch1.text,
    charCount: ch1.text.length,
    wordCount: ch1.text.split(/\s+/).length,
    validationSuccess: true,
  });

  // 2. Chapter 2: Andersen (Receives Ch 1 context)
  const t2Start = Date.now();
  const ch2 = await draftChapterModel(
    {
      index: 2,
      bibleVersion: bibleCase.bibleVersion,
      approvedBible: bibleCase.bible,
      brief: bibleCase.brief,
      precedingChapters: [ch1],
    },
    model
  );
  const t2Duration = Date.now() - t2Start;
  generatedChapters.push(ch2);
  tracer.recordStep({
    chapterIndex: 2,
    role: "chapter_writer_2",
    alias: "Andersen",
    assignedBeat: bibleCase.bible.beats.find((b) => b.chapterIndex === 2)!.text,
    precedingChaptersPassed: [1],
    modelUsed: "chapter_writer_2 (Haiku)",
    usage: { inputTokens: 430, outputTokens: Math.round(ch2.text.length / 4) },
    durationMs: t2Duration,
    chapterText: ch2.text,
    charCount: ch2.text.length,
    wordCount: ch2.text.split(/\s+/).length,
    validationSuccess: true,
  });

  // 3. Chapter 3: Perrault (Receives Ch 1 & 2 context)
  const t3Start = Date.now();
  const ch3 = await draftChapterModel(
    {
      index: 3,
      bibleVersion: bibleCase.bibleVersion,
      approvedBible: bibleCase.bible,
      brief: bibleCase.brief,
      precedingChapters: [ch1, ch2],
    },
    model
  );
  const t3Duration = Date.now() - t3Start;
  generatedChapters.push(ch3);
  tracer.recordStep({
    chapterIndex: 3,
    role: "chapter_writer_3",
    alias: "Perrault",
    assignedBeat: bibleCase.bible.beats.find((b) => b.chapterIndex === 3)!.text,
    precedingChaptersPassed: [1, 2],
    modelUsed: "chapter_writer_3 (Haiku)",
    usage: { inputTokens: 610, outputTokens: Math.round(ch3.text.length / 4) },
    durationMs: t3Duration,
    chapterText: ch3.text,
    charCount: ch3.text.length,
    wordCount: ch3.text.split(/\s+/).length,
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
