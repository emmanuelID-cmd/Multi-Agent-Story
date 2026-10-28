import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkflowSandboxPaths } from "./cleanup";

export interface WorkflowStepTrace {
  stepId: string;
  phase:
    | "intake_context"
    | "drafting"
    | "write_barrier"
    | "reader_handoff"
    | "editor_receiving"
    | "editorial_proposals"
    | "proposal_barrier"
    | "consistency_check"
    | "human_gate"
    | "revision_cycle"
    | "cap_exhaustion";
  agentId?: string;
  agentAlias?: string;
  inputSummary: string;
  outputSummary: string;
  durationMs: number;
  tokens?: { input: number; output: number };
  hashes?: Record<string, string>;
  status: "PASS" | "FLAGGED" | "FAIL" | "SIMULATED" | "complete" | "partial" | "blocked" | "unavailable";
  notes?: string;
}

export interface HandOffAudit {
  seam: string;
  sourceAgent: string;
  destinationAgent: string;
  status: "VALID" | "INVALID" | "SIMULATED";
  details: string;
}

export interface WeakPointRecord {
  category: "CONTINUITY" | "LATENCY" | "TOKEN_BUDGET" | "LENS_DIFFERENTIATION" | "TYPOGRAPHY" | "ROUND_CAP";
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  recommendation: string;
}

export interface WorkflowRunTrace {
  runId: string;
  bibleId: string;
  bibleName: string;
  bibleVersion: number;
  timestamp: string;
  mode: "SIMULATION" | "LIVE";
  modelId: string;
  totalDurationMs: number;
  totalTokens: { inputTokens: number; outputTokens: number };
  steps: WorkflowStepTrace[];
  handOffAudits: HandOffAudit[];
  weakPoints: WeakPointRecord[];
}

export class SandboxWorkflowTracer {
  private runId: string;
  private bibleId: string;
  private bibleName: string;
  private bibleVersion: number;
  private mode: "SIMULATION" | "LIVE";
  private modelId: string;
  private startTime: number;
  private steps: WorkflowStepTrace[] = [];
  private handOffs: HandOffAudit[] = [];
  private weakPoints: WeakPointRecord[] = [];
  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  constructor(params: {
    runId: string;
    bibleId: string;
    bibleName: string;
    bibleVersion: number;
    mode: "SIMULATION" | "LIVE";
    modelId: string;
  }) {
    this.runId = params.runId;
    this.bibleId = params.bibleId;
    this.bibleName = params.bibleName;
    this.bibleVersion = params.bibleVersion;
    this.mode = params.mode;
    this.modelId = params.modelId;
    this.startTime = Date.now();
  }

  recordStep(step: WorkflowStepTrace): void {
    this.steps.push(step);
    if (step.tokens) {
      this.totalInputTokens += step.tokens.input;
      this.totalOutputTokens += step.tokens.output;
    }
  }

  recordHandOff(audit: HandOffAudit): void {
    this.handOffs.push(audit);
  }

  recordWeakPoint(wp: WeakPointRecord): void {
    this.weakPoints.push(wp);
  }

  finalize(): WorkflowRunTrace {
    return {
      runId: this.runId,
      bibleId: this.bibleId,
      bibleName: this.bibleName,
      bibleVersion: this.bibleVersion,
      timestamp: new Date().toISOString(),
      mode: this.mode,
      modelId: this.modelId,
      totalDurationMs: Date.now() - this.startTime,
      totalTokens: {
        inputTokens: this.totalInputTokens,
        outputTokens: this.totalOutputTokens,
      },
      steps: this.steps,
      handOffAudits: this.handOffs,
      weakPoints: this.weakPoints,
    };
  }

  writeTraceFiles(baseDir = process.cwd()): { tracePath: string; summaryPath: string } {
    const trace = this.finalize();
    const paths = resolveWorkflowSandboxPaths(baseDir);

    const filenameBase = `workflow-trace-${this.bibleId}-${this.runId}`;
    const tracePath = join(paths.traces, `${filenameBase}.json`);
    const summaryPath = join(paths.reviews, `workflow-summary-${this.bibleId}-${this.runId}.txt`);

    writeFileSync(tracePath, JSON.stringify(trace, null, 2), "utf8");

    // Write human-readable summary
    let summary = `======================================================================\n`;
    summary += ` WEAVER MULTI-AGENT WORKFLOW EXECUTION SUMMARY\n`;
    summary += ` Bible: ${trace.bibleName} (${trace.bibleId}) v${trace.bibleVersion}\n`;
    summary += ` Run ID: ${trace.runId} | Mode: ${trace.mode} (${trace.modelId})\n`;
    summary += ` Timestamp: ${trace.timestamp} | Total Elapsed: ${trace.totalDurationMs}ms\n`;
    summary += ` Tokens: In ${trace.totalTokens.inputTokens} | Out ${trace.totalTokens.outputTokens}\n`;
    summary += `======================================================================\n\n`;

    summary += `--- EXECUTION TIMELINE (${trace.steps.length} steps) ---\n`;
    for (const step of trace.steps) {
      const tokenStr = step.tokens ? ` [${step.tokens.input}/${step.tokens.output} tokens]` : "";
      summary += `[${step.status}] [${step.phase}] ${step.agentAlias ? `${step.agentAlias} (${step.agentId}): ` : ""}${step.outputSummary} (${step.durationMs}ms)${tokenStr}\n`;
      if (step.notes) summary += `       Note: ${step.notes}\n`;
    }

    summary += `\n--- HAND-OFF INTEGRITY AUDITS (${trace.handOffAudits.length} seams) ---\n`;
    for (const ho of trace.handOffAudits) {
      summary += `[${ho.status}] ${ho.seam} (${ho.sourceAgent} -> ${ho.destinationAgent}): ${ho.details}\n`;
    }

    if (trace.weakPoints.length > 0) {
      summary += `\n--- WEAK POINTS & FAILURE MODES (${trace.weakPoints.length} observed) ---\n`;
      for (const wp of trace.weakPoints) {
        summary += `[${wp.severity}] [${wp.category}] ${wp.description}\n`;
        summary += `       Recommendation: ${wp.recommendation}\n`;
      }
    }

    writeFileSync(summaryPath, summary, "utf8");

    return { tracePath, summaryPath };
  }
}
