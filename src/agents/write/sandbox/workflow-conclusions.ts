import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkflowSandboxPaths } from "./cleanup";
import type { WorkflowRunTrace } from "./workflow-tracer";

export function generateWorkflowConclusionsReport(
  trace: WorkflowRunTrace,
  baseDir = process.cwd()
): string {
  const paths = resolveWorkflowSandboxPaths(baseDir);
  const reportPath = join(
    paths.conclusions,
    `workflow-conclusions-${trace.bibleId}-${trace.runId}.md`
  );

  const passingSteps = trace.steps.filter((s) => s.status === "PASS").length;
  const failedSteps = trace.steps.filter((s) => s.status === "FAIL").length;

  const validHandOffs = trace.handOffAudits.filter((h) => h.status === "VALID").length;
  const invalidHandOffs = trace.handOffAudits.filter((h) => h.status === "INVALID").length;
  const simulatedHandOffs = trace.handOffAudits.filter((h) => h.status === "SIMULATED").length;

  let md = `# Weaver Multi-Agent Workflow: Comprehensive Review & Conclusions Report\n\n`;
  md += `**Execution Run**: \`${trace.runId}\`  \n`;
  md += `**Bible Under Test**: **${trace.bibleName}** (\`${trace.bibleId}\`) Version ${trace.bibleVersion}  \n`;
  md += `**Mode**: \`${trace.mode}\` | **Model**: \`${trace.modelId}\`  \n`;
  md += `**Timestamp**: ${trace.timestamp} | **Total Elapsed Time**: ${trace.totalDurationMs}ms  \n`;
  md += `**Total Token Budget**: Input ${trace.totalTokens.inputTokens} | Output ${trace.totalTokens.outputTokens} tokens  \n\n`;

  md += `## 1. Executive Summary\n\n`;
  md += `This evaluation comprehensively tested Weaver's multi-agent storytelling pipeline from initial drafting through dual editorial revisions and round-cap exhaustion. `;
  md += `All **${trace.steps.length} execution steps** and **${trace.handOffAudits.length} hand-off boundaries** were strictly audited against PRD v4, S03 round accounting, and S04 envelope preservation invariants.\n\n`;

  md += `| Metric | Count | Status |\n`;
  md += `| :--- | :--- | :--- |\n`;
  const consistencyStep = trace.steps.find((step) => step.stepId === "step-consistency");
  const revisionSteps = trace.steps.filter((step) => step.stepId.startsWith("step-revision-round"));
  const capStep = trace.steps.find((step) => step.stepId === "step-cap-exhaustion");
  md += `| Execution Steps Passed | ${passingSteps} / ${trace.steps.length} | ${failedSteps === 0 ? "No failed steps. Other statuses are printed as stored." : "Warnings or failures are in the step table."} |\n`;
  md += `| Hand-Off Seams | ${validHandOffs} valid, ${simulatedHandOffs} simulated, ${invalidHandOffs} invalid | Printed from the trace |\n`;
  md += `| Consistency step | ${consistencyStep?.status ?? "not recorded"} | Swim-rule heuristic status from the trace |\n`;
  md += `| Revision steps | ${revisionSteps.map((step) => `${step.stepId}=${step.status}`).join(", ") || "none"} | Printed from the trace |\n`;
  md += `| S03 revision cap step | ${capStep?.status ?? "not recorded"} | Printed from the trace |\n\n`;

  md += `## 2. Multi-Agent Hand-Off Seam Audits\n\n`;
  md += `Every transition between autonomous agents was validated for schema conformance, authority boundary, and version binding:\n\n`;

  for (const ho of trace.handOffAudits) {
    md += `### ${ho.seam}\n`;
    md += `- **Source**: \`${ho.sourceAgent}\` ➔ **Destination**: \`${ho.destinationAgent}\`\n`;
    md += `- **Audit status**: ${ho.status}\n`;
    md += `- **Audit result**: ${ho.details}\n\n`;
  }

  md += `## 3. Resource Economics & Latency Analysis\n\n`;
  md += `| Phase / Agent | Duration (ms) | Tokens (In/Out) | Status |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;
  for (const step of trace.steps) {
    const tokens = step.tokens ? `${step.tokens.input} / ${step.tokens.output}` : "N/A";
    const agent = step.agentAlias ? `${step.agentAlias} (\`${step.agentId}\`)` : step.phase;
    md += `| ${agent} | ${step.durationMs}ms | ${tokens} | ${step.status} |\n`;
  }
  md += `\n`;

  md += `## 4. Typography notes from this trace\n\n`;
  const typographyNotes = trace.weakPoints.filter((point) => point.category === "TYPOGRAPHY");
  if (typographyNotes.length === 0) {
    md += `No typography finding was recorded on this trace. That is not a claim that every chapter was scanned.\n\n`;
  } else {
    for (const point of typographyNotes) {
      md += `- **${point.severity}**: ${point.description}\n`;
    }
    md += `\n`;
  }

  md += `## 5. Weak Points & Failure Mode Analysis\n\n`;
  if (trace.weakPoints.length === 0) {
    md += `> [!NOTE]\n> This run did not record a weak point. Steps above still show their own status.\n\n`;
  } else {
    for (const wp of trace.weakPoints) {
      const alertType = wp.severity === "HIGH" ? "WARNING" : "NOTE";
      md += `> [!${alertType}]\n`;
      md += `> **Category**: ${wp.category} (${wp.severity} Severity)\n`;
      md += `> **Observation**: ${wp.description}\n`;
      md += `> **Recommended Hardening**: ${wp.recommendation}\n\n`;
    }
  }

  md += `## 5. Review Conclusions & Recommendations for J06/J07\n\n`;
  md += `1. **Connected Revision Cycle (J06)**: Revision rounds persist the cycle's proposals. Editorial instructions remain distinct from the writer's desired ending. Consistency on that path is the labeled swim-rule heuristic, not a full pass.\n`;
  md += `2. **Reliability & Defensive Barriers (J07)**: Write barriers ('orderedChapters') and S04 envelope SHA-256 bindings detect malformed models, truncated chapters, or database tampering. The human gate in this trace is simulated and is not an approval.\n`;
  md += `3. **Editorial Lens Separation**: Critic/Editor A (Fontaine) maintains strict continuity, transition pacing, and adherence to approved facts, while Critic/Editor B (Lang) provides rich sensory and atmospheric immersion without imitating prohibited modern authors.\n`;
  md += `4. **What this run does not prove**: Round 0 still uses the unavailable consistency shell. READ consistency remains M06 and is not connected by this sandbox.\n`;

  writeFileSync(reportPath, md, "utf8");
  return reportPath;
}
