import { join } from "node:path";
import { orderedChapters, type Chapter } from "../../../contracts";
import { buildFixtureHandoff, validateEditorReceivingHandoff } from "../../handoff";
import {
  AnthropicWriteModel,
  type WriteModel,
} from "../model";

/** Tests and the editor script still know the model by this name. */
export { createSandboxEditorialModel as createEditorSandboxSimulatedModel } from "./editorial-model";
import { verifyManuscriptEnvelope } from "../runtime";
import { executeRevisionCycle } from "../revision";
import { createSandboxEditorialModel } from "./editorial-model";
import {
  SandboxEditorTracer,
  type EditorRunTrace,
  type EditorTraceStep,
  auditTypographyInProse,
  auditEditorialQuality,
} from "./editor-tracer";
import { initEditorSandboxDirectories, initSandboxDirectories } from "./cleanup";
import { executeBibleInSandbox } from "./runner";
import { type MockBibleCase } from "../../../../tests/fixtures/mock-bibles";

export interface EditorSandboxExecutionOptions {
  model?: WriteModel;
  useLiveModel?: boolean;
  liveModelId?: string;
  baseChapters?: Chapter[];
  endToEnd?: boolean;
  userEditorialInstructions?: string;
  baseDir?: string;
}


/**
 * Performs anti-imitation check: ensures neither "Fontaine" nor "Lang"
 * appears within the actual narrative story prose.
 */
function auditAntiImitationInProse(chapters: Chapter[]): {
  passed: boolean;
  offendingWordsFound: string[];
} {
  const offending: string[] = [];
  const banned = ["Fontaine", "Jean de La Fontaine", "Lang", "Andrew Lang"];

  for (const ch of chapters) {
    for (const b of banned) {
      const regex = new RegExp(`\\b${b}\\b`, "i");
      if (regex.test(ch.text)) {
        if (!offending.includes(b)) offending.push(b);
      }
    }
  }

  return {
    passed: offending.length === 0,
    offendingWordsFound: offending,
  };
}

/**
 * Executes a full dual-editor sandbox run (Fontaine & Lang) on a story bible.
 */
export async function executeEditorsInSandbox(
  bibleCase: MockBibleCase,
  options: EditorSandboxExecutionOptions = {}
): Promise<EditorRunTrace> {
  const tracer = new SandboxEditorTracer(
    bibleCase.id,
    bibleCase.name,
    bibleCase.bibleVersion
  );

  // Three supplied chapters are the reading. A short list is a mistake, not a cue to start over.
  // The writer sandbox runs only when the caller asks for the full path and supplies no chapters.
  let baseChapters: Chapter[];
  if (options.baseChapters && options.baseChapters.length === 3) {
    baseChapters = options.baseChapters;
  } else if (options.baseChapters) {
    throw new Error("Editor sandbox needs chapters 1, 2, and 3. A shorter list is not replaced.");
  } else if (options.endToEnd) {
    initSandboxDirectories(options.baseDir);
    const writerTrace = await executeBibleInSandbox(bibleCase, {
      baseDir: options.baseDir,
    });
    baseChapters = writerTrace.steps.map((s) => ({
      chapterIndex: s.chapterIndex,
      bibleVersion: bibleCase.bibleVersion,
      text: s.chapterText,
    }));
  } else {
    throw new Error("Three base chapters are required unless --end-to-end is set.");
  }

  // Ensure base chapters pass write barrier
  orderedChapters(baseChapters, bibleCase.bibleVersion);

  const baseChaptersSummary = {
    hashes: baseChapters.map((c) => `${c.chapterIndex}:${c.text.length}chars`),
    totalWords: baseChapters.reduce((sum, c) => sum + c.text.split(/\s+/).length, 0),
    chapters: baseChapters.map((c) => ({
      chapterIndex: c.chapterIndex,
      wordCount: c.text.split(/\s+/).length,
    })),
  };

  // 2. Prepare 5-Field Reader Handoff
  const recordedRequest =
    options.userEditorialInstructions ??
    bibleCase.brief.desiredEnding ??
    "";

  const handoff = buildFixtureHandoff(
    baseChapters,
    bibleCase.bibleVersion,
    recordedRequest,
    0
  );

  const receiving = {
    handoff,
    expectedRecordedRequest: recordedRequest,
    baseChapters,
    approvedBibleVersion: bibleCase.bibleVersion,
  };
  const validationA = validateEditorReceivingHandoff(receiving);
  const validationB = validateEditorReceivingHandoff(receiving);
  const handoffAudit = {
    valid: validationA.valid && validationB.valid,
    confidence: handoff.completeness.confidence,
    coveredChapters: handoff.sourceReferences.map((r) => {
      const match = r.locator.match(/chapter_(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    }),
    recordedRequest,
  };

  // A failed handoff skips both proposals. The trace still records that the gate closed.
  if (handoffAudit.valid) {
    let model: WriteModel;
    if (options.model) {
      model = options.model;
    } else if (options.useLiveModel) {
      const key =
        process.env.WRITE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("ANTHROPIC_API_KEY required for live editor sandbox run.");
      model = new AnthropicWriteModel(key, {
        criticModelId: options.liveModelId ?? "claude-3-5-sonnet-20241022",
      });
    } else {
      model = createSandboxEditorialModel(bibleCase, baseChapters);
    }

    const started = Date.now();
    const cycle = await executeRevisionCycle({
      runId: `editor-run-${bibleCase.id}`,
      projectId: `editor-${bibleCase.id}`,
      bibleVersion: bibleCase.bibleVersion,
      approvedBible: bibleCase.bible,
      baseChapters,
      revisionRound: 1,
      editorialInstructions: recordedRequest,
      hasAdditionalInstructions: recordedRequest.trim().length > 0,
      modelA: model,
      modelB: model,
    });
    const durationMs = Date.now() - started;

    for (const proposal of cycle.proposals) {
      const manuscript = proposal.manuscript;
      let barrierPassed = false;
      try {
        orderedChapters(manuscript.chapters, bibleCase.bibleVersion);
        barrierPassed = true;
      } catch {
        barrierPassed = false;
      }
      const envelopeValid = verifyManuscriptEnvelope({
        envelope: proposal.envelope,
        storedChapters: baseChapters,
        manuscript,
        expectedBaseVersion: bibleCase.bibleVersion,
      }).valid;
      const role = proposal.kind === "manuscript_a" ? "critic_editor_a" : "critic_editor_b";
      const step: EditorTraceStep = {
        role,
        alias: role === "critic_editor_a" ? "Fontaine" : "Lang",
        lens: role === "critic_editor_a" ? "continuity_and_pacing" : "voice_and_atmosphere",
        modelUsed: proposal.modelUsed,
        usage: proposal.usage,
        durationMs,
        proposal: manuscript,
        envelope: proposal.envelope,
        envelopeValid,
        barrierPassed,
        antiImitationAudit: auditAntiImitationInProse(manuscript.chapters),
        typographyAudit: auditTypographyInProse(manuscript.chapters),
        editorialAudit: auditEditorialQuality(manuscript.chapters, bibleCase.id, role, manuscript),
        changesCount: manuscript.changesMade.length,
        wordDeltas: {
          ch1: (manuscript.chapters[0]?.text.split(/\s+/).length ?? 0) - baseChaptersSummary.chapters[0].wordCount,
          ch2: (manuscript.chapters[1]?.text.split(/\s+/).length ?? 0) - baseChaptersSummary.chapters[1].wordCount,
          ch3: (manuscript.chapters[2]?.text.split(/\s+/).length ?? 0) - baseChaptersSummary.chapters[2].wordCount,
        },
      };
      tracer.recordStep(step);
    }
  }

  // 6. Build Trace & Persist
  const runTrace = tracer.buildTrace(baseChaptersSummary, handoffAudit);
  const paths = initEditorSandboxDirectories(options.baseDir);

  SandboxEditorTracer.saveTraceJson(
    runTrace,
    join(paths.traces, `${bibleCase.id}_editor_trace.json`)
  );
  SandboxEditorTracer.saveReviewMarkdown(
    runTrace,
    join(paths.reviews, `${bibleCase.id}_editor_review.md`)
  );

  return runTrace;
}
