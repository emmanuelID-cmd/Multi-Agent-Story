import { writeFileSync } from "node:fs";
import { orderedChapters, type Chapter } from "../../../contracts";
import type { ReaderToEditorHandoff } from "../../handoff";
import type { WriteAgentRole } from "../model";
import {
  type RevisedManuscript,
  type ManuscriptEnvelope,
  verifyManuscriptEnvelope,
} from "../runtime";

export interface EditorTraceStep {
  role: WriteAgentRole;
  alias: "Fontaine" | "Lang";
  lens: "continuity_and_pacing" | "voice_and_atmosphere";
  modelUsed: string;
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
  proposal: RevisedManuscript;
  envelope: ManuscriptEnvelope;
  envelopeValid: boolean;
  barrierPassed: boolean;
  antiImitationAudit: { passed: boolean; offendingWordsFound: string[] };
  typographyAudit: { passed: boolean; collisionsFound: string[] };
  editorialAudit: { passed: boolean; violations: string[] };
  changesCount: number;
  wordDeltas: { ch1: number; ch2: number; ch3: number };
}

export interface EditorRunTrace {
  runId: string;
  bibleId: string;
  bibleName: string;
  bibleVersion: number;
  startedAt: string;
  completedAt: string;
  baseChaptersSummary: {
    hashes: string[];
    totalWords: number;
    chapters: Array<{ chapterIndex: number; wordCount: number }>;
  };
  handoffAudit: {
    valid: boolean;
    confidence: number;
    coveredChapters: number[];
    recordedRequest: string;
  };
  steps: EditorTraceStep[];
  comparativeLensAnalysis: {
    continuityChangesCount: number;
    voiceChangesCount: number;
    fontaineDistinctiveNotes: string;
    langDistinctiveNotes: string;
  };
  totalTokens: {
    inputTokens: number;
    outputTokens: number;
    total: number;
  };
  totalDurationMs: number;
}

export class SandboxEditorTracer {
  private readonly steps: EditorTraceStep[] = [];
  private readonly startedAt: string;
  private readonly runId: string;

  constructor(
    readonly bibleId: string,
    readonly bibleName: string,
    readonly bibleVersion: number
  ) {
    this.runId = `editor-trace-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    this.startedAt = new Date().toISOString();
  }

  recordStep(step: EditorTraceStep): void {
    this.steps.push(step);
  }

  buildTrace(
    baseChaptersSummary: EditorRunTrace["baseChaptersSummary"],
    handoffAudit: EditorRunTrace["handoffAudit"]
  ): EditorRunTrace {
    const completedAt = new Date().toISOString();

    const fontaineStep = this.steps.find((s) => s.role === "critic_editor_a");
    const langStep = this.steps.find((s) => s.role === "critic_editor_b");

    const continuityChangesCount = fontaineStep?.proposal.changesMade.length ?? 0;
    const voiceChangesCount = langStep?.proposal.changesMade.length ?? 0;

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
      baseChaptersSummary,
      handoffAudit,
      steps: this.steps,
      comparativeLensAnalysis: {
        continuityChangesCount,
        voiceChangesCount,
        fontaineDistinctiveNotes: fontaineStep?.proposal.rationale ?? "No rationale provided.",
        langDistinctiveNotes: langStep?.proposal.rationale ?? "No rationale provided.",
      },
      totalTokens: {
        inputTokens: totalInput,
        outputTokens: totalOutput,
        total: totalInput + totalOutput,
      },
      totalDurationMs: totalDuration,
    };
  }

  static formatReviewMarkdown(trace: EditorRunTrace): string {
    const fontaine = trace.steps.find((s) => s.role === "critic_editor_a");
    const lang = trace.steps.find((s) => s.role === "critic_editor_b");

    const lines: string[] = [
      `# Editor Comparative Review: ${trace.bibleName}`,
      `**Run ID**: \`${trace.runId}\`  `,
      `**Bible Version**: \`v${trace.bibleVersion}\` | **Recorded Request**: "${trace.handoffAudit.recordedRequest}"  `,
      `**Total Tokens**: ${trace.totalTokens.total.toLocaleString()} (${trace.totalTokens.inputTokens.toLocaleString()} in / ${trace.totalTokens.outputTokens.toLocaleString()} out) | **Duration**: ${trace.totalDurationMs}ms`,
      "",
      "---",
      "",
      "## 1. Editorial Integrity & Gate Verification",
      `- **Reader Handoff**: ${
        trace.handoffAudit.valid
          ? `✅ Validated (Confidence: ${(trace.handoffAudit.confidence * 100).toFixed(0)}%, Chapters: [${trace.handoffAudit.coveredChapters.join(", ")}])`
          : "❌ REJECTED"
      }`,
      `- **Fontaine (Continuity & Pacing)**: Barrier: ${
        fontaine?.barrierPassed ? "✅ [1, 2, 3] Validated" : "❌ FAILED"
      } | S04 Envelope: ${
        fontaine?.envelopeValid ? `✅ Verified (${fontaine.envelope.proposalHash.slice(0, 16)}...)` : "❌ INVALID"
      } | Anti-Imitation: ${
        fontaine?.antiImitationAudit.passed ? "✅ Passed" : `❌ VIOLATION (${fontaine?.antiImitationAudit.offendingWordsFound.join(", ")})`
      } | Typography: ${
        fontaine?.typographyAudit.passed ? "✅ Clean" : `❌ DEFECTS (${fontaine?.typographyAudit.collisionsFound.join("; ")})`
      } | Editorial Quality: ${
        fontaine?.editorialAudit.passed ? "✅ Clean" : `❌ DEFECTS (${fontaine?.editorialAudit.violations.join("; ")})`
      }`,
      `- **Lang (Voice & Atmosphere)**: Barrier: ${
        lang?.barrierPassed ? "✅ [1, 2, 3] Validated" : "❌ FAILED"
      } | S04 Envelope: ${
        lang?.envelopeValid ? `✅ Verified (${lang.envelope.proposalHash.slice(0, 16)}...)` : "❌ INVALID"
      } | Anti-Imitation: ${
        lang?.antiImitationAudit.passed ? "✅ Passed" : `❌ VIOLATION (${lang?.antiImitationAudit.offendingWordsFound.join(", ")})`
      } | Typography: ${
        lang?.typographyAudit.passed ? "✅ Clean" : `❌ DEFECTS (${lang?.typographyAudit.collisionsFound.join("; ")})`
      } | Editorial Quality: ${
        lang?.editorialAudit.passed ? "✅ Clean" : `❌ DEFECTS (${lang?.editorialAudit.violations.join("; ")})`
      }`,
      "",
      "---",
      "",
      "## 2. Comparative Lens Rationales & Changes",
      "",
      `### Fontaine (Critic/Editor A) — Continuity & Pacing`,
      `* **Model**: \`${fontaine?.modelUsed ?? "N/A"}\` (${fontaine?.usage.inputTokens ?? 0} in / ${fontaine?.usage.outputTokens ?? 0} out in ${fontaine?.durationMs ?? 0}ms)`,
      `* **Rationale**: ${fontaine?.proposal.rationale ?? "N/A"}`,
      `* **Located Changes (${fontaine?.proposal.changesMade.length ?? 0})**:`,
    ];

    for (const change of fontaine?.proposal.changesMade ?? []) {
      lines.push(
        `  - **Ch ${change.chapterIndex}**: ${change.summary} *(Justification: ${change.justification})*`
      );
    }

    lines.push(
      "",
      `### Lang (Critic/Editor B) — Voice & Atmosphere`,
      `* **Model**: \`${lang?.modelUsed ?? "N/A"}\` (${lang?.usage.inputTokens ?? 0} in / ${lang?.usage.outputTokens ?? 0} out in ${lang?.durationMs ?? 0}ms)`,
      `* **Rationale**: ${lang?.proposal.rationale ?? "N/A"}`,
      `* **Located Changes (${lang?.proposal.changesMade.length ?? 0})**:`,
    );

    for (const change of lang?.proposal.changesMade ?? []) {
      lines.push(
        `  - **Ch ${change.chapterIndex}**: ${change.summary} *(Justification: ${change.justification})*`
      );
    }

    lines.push(
      "",
      "---",
      "",
      "## 3. Chapter-by-Chapter Comparative Prose",
      ""
    );

    for (const index of [1, 2, 3] as const) {
      const fCh = fontaine?.proposal.chapters.find((c) => c.chapterIndex === index);
      const lCh = lang?.proposal.chapters.find((c) => c.chapterIndex === index);

      lines.push(
        `### Chapter ${index}`,
        "",
        `#### Fontaine Revision (Continuity & Pacing)`,
        "> " + (fCh?.text.split("\n\n").join("\n>\n> ") ?? "No prose generated."),
        "",
        `#### Lang Revision (Voice & Atmosphere)`,
        "> " + (lCh?.text.split("\n\n").join("\n>\n> ") ?? "No prose generated."),
        "",
        "---",
        ""
      );
    }

    return lines.join("\n");
  }

  static saveTraceJson(trace: EditorRunTrace, filepath: string): void {
    writeFileSync(filepath, JSON.stringify(trace, null, 2), "utf-8");
  }

  static saveReviewMarkdown(trace: EditorRunTrace, filepath: string): string {
    const md = SandboxEditorTracer.formatReviewMarkdown(trace);
    writeFileSync(filepath, md, "utf-8");
    return md;
  }
}

/**
 * Audit mechanical typography in chapter prose:
 * - Scans for duplicate periods ('..' not part of '...')
 * - Scans for excessive periods (4 or more)
 * - Scans for punctuation collisions (',.', '.,', ';.', ':.' '!.', '?.')
 * - Scans for duplicate commas (',,')
 * - Scans for stray spaces preceding punctuation marks
 */
export function auditTypographyInProse(chapters: Chapter[]): {
  passed: boolean;
  collisionsFound: string[];
} {
  const collisions: string[] = [];

  for (const ch of chapters) {
    const text = ch.text;

    // Double periods strictly not part of 3-dot ellipsis: e.g. "pattern.. "
    const doublePeriods = text.match(/(?<!\.)\.\.(?!\.)/g);
    if (doublePeriods) {
      collisions.push(`Ch ${ch.chapterIndex}: ${doublePeriods.length} double period(s) ('..')`);
    }

    // Excessive periods (>3)
    const quadPeriods = text.match(/\.{4,}/g);
    if (quadPeriods) {
      collisions.push(`Ch ${ch.chapterIndex}: excessive periods ('${quadPeriods[0]}')`);
    }

    // Punctuation collisions: ",." or ".," or ";." or "!." or "?."
    const punctCollisions = text.match(/[,;:!?]\s*\.|\.\s*[,;:!?]/g);
    if (punctCollisions) {
      collisions.push(`Ch ${ch.chapterIndex}: punctuation collision ('${punctCollisions.join("', '")}')`);
    }

    // Duplicate commas: ",,"
    const doubleCommas = text.match(/,,+/g);
    if (doubleCommas) {
      collisions.push(`Ch ${ch.chapterIndex}: duplicate comma ('${doubleCommas[0]}')`);
    }

    // Space before terminal: e.g. "word ."
    const spaceBeforePunct = text.match(/\s+[,.:;?!]/g);
    if (spaceBeforePunct) {
      collisions.push(`Ch ${ch.chapterIndex}: stray space before punctuation ('${spaceBeforePunct[0]}')`);
    }
  }

  return {
    passed: collisions.length === 0,
    collisionsFound: collisions,
  };
}

/**
 * Audit editorial quality, setting fidelity, and syntax:
 * - Ensures story text does not contain revision/fixture banners
 * - Ensures no setting contamination (e.g. harbor/skiff in clockwork/orbital)
 * - Ensures no mid-clause capitalization after "that " or "where "
 * - Ensures justifications are not raw dumps of brief.tone
 */
export function auditEditorialQuality(
  chapters: Chapter[],
  bibleId: string,
  role: string,
  proposal: RevisedManuscript
): {
  passed: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  // 1. Revision Banner check: story text must not contain "[Revised Version"
  for (const ch of chapters) {
    if (/\[Revised Version/i.test(ch.text)) {
      violations.push(`Ch ${ch.chapterIndex} contains fixture/revision banner in story text`);
    }
  }

  // 2. Setting Contamination check
  if (bibleId === "clockwork") {
    for (const ch of chapters) {
      const match = ch.text.match(/\b(harbor|skiff|boat|ocean|whale oil|undertow)\b/i);
      if (match) {
        violations.push(`Ch ${ch.chapterIndex} contains setting contamination (${match[0]} in clockwork story)`);
      }
    }
  } else if (bibleId === "orbital") {
    for (const ch of chapters) {
      const match = ch.text.match(/\b(harbor|skiff|boat|ocean|whale oil|cathedral|gargoyle)\b/i);
      if (match) {
        violations.push(`Ch ${ch.chapterIndex} contains setting contamination (${match[0]} in orbital story)`);
      }
    }
  }

  // 3. Mid-clause capitalization check: "that The", "where The"
  for (const ch of chapters) {
    const midClauseCap = ch.text.match(/\b(that|where)\s+([A-Z][a-z]+)/);
    if (midClauseCap) {
      violations.push(`Ch ${ch.chapterIndex} has mid-clause capitalization: "${midClauseCap[0]}"`);
    }
  }

  // 4. Justification check: must not just dump raw brief.tone
  for (const change of proposal.changesMade) {
    if (
      /the tactile ambiance of (atmospheric, grounded, and tense|dark, tactile, and ominous|contemplative, claustrophobic, and resolute)/i.test(
        change.justification
      )
    ) {
      violations.push(`Ch ${change.chapterIndex} justification is a raw tone string dump`);
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

export interface BackwardAnalysisResult {
  faultCode:
    | "NONE"
    | "BASE_CHAPTER_FAULT"
    | "READER_HANDOFF_FAULT"
    | "EDITOR_PROPOSAL_FAULT";
  message: string;
  isolatedAt: string;
}

/**
 * Diagnostic backward trace analyzer:
 * When an editorial evaluation fails, traces sequentially backward through:
 * 1. Base chapters write barrier
 * 2. Reader handoff completeness, confidence, and version
 * 3. Editor proposal schema, version matching, and envelope
 * Isolating the exact component responsible for the defect.
 */
export function analyzeEditorTraceBackward(params: {
  baseChapters: Chapter[];
  handoff: ReaderToEditorHandoff;
  proposal?: RevisedManuscript;
  expectedBibleVersion: number;
}): BackwardAnalysisResult {
  // 1. Check Base Chapters
  try {
    orderedChapters(params.baseChapters, params.expectedBibleVersion);
  } catch (err) {
    return {
      faultCode: "BASE_CHAPTER_FAULT",
      message: `Base chapters failed write barrier: ${err instanceof Error ? err.message : String(err)}`,
      isolatedAt: "baseChapters write barrier verification",
    };
  }

  // 2. Check Reader Handoff
  if (!params.handoff.completeness.isComplete) {
    return {
      faultCode: "READER_HANDOFF_FAULT",
      message: `Reader handoff marked incomplete: ${params.handoff.completeness.missingItems.join(", ")}`,
      isolatedAt: "handoff.completeness.isComplete",
    };
  }

  if (params.handoff.completeness.confidence < 0.8) {
    return {
      faultCode: "READER_HANDOFF_FAULT",
      message: `Reader handoff confidence (${params.handoff.completeness.confidence}) below required threshold (0.8)`,
      isolatedAt: "handoff.completeness.confidence",
    };
  }

  if (params.handoff.version.bibleVersion !== params.expectedBibleVersion) {
    return {
      faultCode: "READER_HANDOFF_FAULT",
      message: `Reader handoff version (${params.handoff.version.bibleVersion}) does not match expected (${params.expectedBibleVersion})`,
      isolatedAt: "handoff.version.bibleVersion",
    };
  }

  const coveredLocators = params.handoff.sourceReferences.map((r) => r.locator);
  for (const idx of [1, 2, 3]) {
    if (!coveredLocators.includes(`chapter_${idx}`)) {
      return {
        faultCode: "READER_HANDOFF_FAULT",
        message: `Reader handoff missing coverage for chapter_${idx}`,
        isolatedAt: "handoff.sourceReferences",
      };
    }
  }

  // 3. Check Editor Proposal
  if (params.proposal) {
    try {
      orderedChapters(params.proposal.chapters, params.expectedBibleVersion);
    } catch (err) {
      return {
        faultCode: "EDITOR_PROPOSAL_FAULT",
        message: `Editor proposal chapters failed barrier: ${err instanceof Error ? err.message : String(err)}`,
        isolatedAt: "proposal.chapters write barrier",
      };
    }

    if (!params.proposal.rationale || params.proposal.rationale.trim().length === 0) {
      return {
        faultCode: "EDITOR_PROPOSAL_FAULT",
        message: "Editor proposal missing rationale",
        isolatedAt: "proposal.rationale",
      };
    }

    if (!params.proposal.changesMade || params.proposal.changesMade.length === 0) {
      return {
        faultCode: "EDITOR_PROPOSAL_FAULT",
        message: "Editor proposal has empty changesMade array",
        isolatedAt: "proposal.changesMade",
      };
    }
  }

  return {
    faultCode: "NONE",
    message: "No faults detected in base chapters, Reader handoff, or Editor proposal.",
    isolatedAt: "clean",
  };
}
