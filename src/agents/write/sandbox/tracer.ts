import { writeFileSync } from "node:fs";
import { type Chapter } from "../../../contracts";
import type { WriteAgentRole } from "../model";

export interface ChapterTraceStep {
  chapterIndex: 1 | 2 | 3;
  role: WriteAgentRole;
  alias: string;
  assignedBeat: string;
  precedingChaptersPassed: number[];
  modelUsed: string;
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
  chapterText: string;
  charCount: number;
  wordCount: number;
  validationSuccess: boolean;
}

export interface BibleRunTrace {
  runId: string;
  bibleId: string;
  bibleName: string;
  bibleVersion: number;
  startedAt: string;
  completedAt: string;
  steps: ChapterTraceStep[];
  barrierResult: {
    assembled: boolean;
    chapterOrder: number[];
    versionMatches: boolean;
    error?: string;
  };
  handoffChecks: {
    ch1PassedToCh2: boolean;
    ch1And2PassedToCh3: boolean;
  };
  totalTokens: {
    inputTokens: number;
    outputTokens: number;
    total: number;
  };
  totalDurationMs: number;
}

export class SandboxTracer {
  private readonly steps: ChapterTraceStep[] = [];
  private readonly startedAt: string;
  private readonly runId: string;

  constructor(
    readonly bibleId: string,
    readonly bibleName: string,
    readonly bibleVersion: number
  ) {
    this.runId = `trace-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    this.startedAt = new Date().toISOString();
  }

  recordStep(step: ChapterTraceStep): void {
    this.steps.push(step);
  }

  buildTrace(barrierOutcome: {
    assembled: boolean;
    chapters?: Chapter[];
    error?: string;
  }): BibleRunTrace {
    const completedAt = new Date().toISOString();
    const ch2Step = this.steps.find((s) => s.chapterIndex === 2);
    const ch3Step = this.steps.find((s) => s.chapterIndex === 3);

    const ch1PassedToCh2 = Boolean(
      ch2Step && ch2Step.precedingChaptersPassed.includes(1)
    );
    const ch1And2PassedToCh3 = Boolean(
      ch3Step &&
        ch3Step.precedingChaptersPassed.includes(1) &&
        ch3Step.precedingChaptersPassed.includes(2)
    );

    const totalInput = this.steps.reduce((sum, s) => sum + s.usage.inputTokens, 0);
    const totalOutput = this.steps.reduce((sum, s) => sum + s.usage.outputTokens, 0);
    const totalDuration = this.steps.reduce((sum, s) => sum + s.durationMs, 0);

    return {
      runId: this.runId,
      bibleId: this.bibleId,
      bibleName: this.bibleName,
      bibleVersion: this.bibleVersion,
      startedAt: this.startedAt,
      completedAt,
      steps: this.steps,
      barrierResult: {
        assembled: barrierOutcome.assembled,
        chapterOrder: barrierOutcome.chapters?.map((c) => c.chapterIndex) ?? [],
        versionMatches:
          barrierOutcome.chapters?.every((c) => c.bibleVersion === this.bibleVersion) ??
          false,
        error: barrierOutcome.error,
      },
      handoffChecks: {
        ch1PassedToCh2,
        ch1And2PassedToCh3,
      },
      totalTokens: {
        inputTokens: totalInput,
        outputTokens: totalOutput,
        total: totalInput + totalOutput,
      },
      totalDurationMs: totalDuration,
    };
  }

  static formatReviewMarkdown(trace: BibleRunTrace): string {
    const lines: string[] = [
      `# Story Review: ${trace.bibleName}`,
      `**Run ID**: \`${trace.runId}\`  `,
      `**Bible Version**: \`v${trace.bibleVersion}\` | **Status**: ${
        trace.barrierResult.assembled ? "PASSED (Barrier Validated)" : "FAILED"
      }  `,
      `**Total Tokens**: ${trace.totalTokens.total.toLocaleString()} (${trace.totalTokens.inputTokens.toLocaleString()} in / ${trace.totalTokens.outputTokens.toLocaleString()} out) | **Total Duration**: ${trace.totalDurationMs}ms`,
      "",
      "---",
      "",
      "## 1. Sequential Continuity & Handoff Audit",
      `- **Chapter 1 $\\to$ Chapter 2**: ${
        trace.handoffChecks.ch1PassedToCh2
          ? "Passed (Ch 1 prose ingested by Andersen)"
          : "FAILED (Missing Ch 1 context)"
      }`,
      `- **Chapter 1 & 2 $\\to$ Chapter 3**: ${
        trace.handoffChecks.ch1And2PassedToCh3
          ? "Passed (Ch 1 & 2 prose ingested by Perrault)"
          : "FAILED (Missing earlier context)"
      }`,
      `- **Chapter Barrier (\`orderedChapters\`)**: ${
        trace.barrierResult.assembled
          ? `Ordered [${trace.barrierResult.chapterOrder.join(", ")}] verified`
          : `REJECTED: ${trace.barrierResult.error || "Unknown"}`
      }`,
      "",
      "---",
      "",
      "## 2. Chapter Prose & Author Personas",
    ];

    for (const step of trace.steps) {
      lines.push(
        `### Chapter ${step.chapterIndex} — ${step.alias} (\`${step.role}\`)`,
        `* **Assigned Beat**: ${step.assignedBeat}`,
        `* **Model Used**: \`${step.modelUsed}\` (${step.usage.inputTokens} prompt / ${step.usage.outputTokens} completion tokens in ${step.durationMs}ms)`,
        `* **Word Count**: ${step.wordCount} words (${step.charCount} chars)`,
        "",
        "> " + step.chapterText.split("\n\n").join("\n>\n> "),
        ""
      );
    }

    return lines.join("\n");
  }

  static saveTraceJson(trace: BibleRunTrace, filepath: string): void {
    writeFileSync(filepath, JSON.stringify(trace, null, 2), "utf-8");
  }

  static saveReviewMarkdown(trace: BibleRunTrace, filepath: string): string {
    const md = SandboxTracer.formatReviewMarkdown(trace);
    writeFileSync(filepath, md, "utf-8");
    return md;
  }
}
