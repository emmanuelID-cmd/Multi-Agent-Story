import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  lighthouseMysteryCase,
  clockworkFairytaleCase,
  orbitalSciFiCase,
} from "./fixtures/mock-bibles";
import { executeWorkflowInSandbox } from "../src/agents/write/sandbox/workflow-runner";
import { cleanupWorkflowSandboxLogs } from "../src/agents/write/sandbox/cleanup";

function expectRecordedSeams(audits: Array<{ seam: string; status: string }>) {
  expect(audits).toHaveLength(9);
  for (const seam of audits) {
    if (seam.seam.includes("Seam 7")) expect(seam.status).toBe("SIMULATED");
    else expect(seam.status).toBe("VALID");
  }
}

describe("Weaver Multi-Agent Workflow Sandbox Harness & Conclusions", () => {
  it("runs the full 11-phase workflow cleanly for lighthouse mystery bible", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "workflow-sandbox-"));
    try {
      const feedback = "Keep Mara in the boat during chapter 2.";
      const result = await executeWorkflowInSandbox(lighthouseMysteryCase, {
        baseDir,
        humanFeedback: feedback,
      });

      expect(result.trace).toBeDefined();
      expect(result.trace.steps.length).toBeGreaterThanOrEqual(13);
      expectRecordedSeams(result.trace.handOffAudits);
      expect(result.tracePath.startsWith(baseDir)).toBe(true);
      expect(result.tracePath).toContain(join("logs", "workflow-sandbox"));

      const gate = result.trace.steps.find((step) => step.stepId === "step-human-gate");
      expect(gate?.status).toBe("SIMULATED");
      expect(gate?.outputSummary).toContain(feedback);

      const consistency = result.trace.steps.find((step) => step.stepId === "step-consistency");
      expect(consistency?.status).toBe("complete");

      const round2 = result.trace.steps.find((step) => step.stepId === "step-revision-round-2");
      expect(round2?.outputSummary).toContain("Round 2");

      expect(existsSync(result.tracePath)).toBe(true);
      expect(existsSync(result.summaryPath)).toBe(true);
      expect(existsSync(result.conclusionsPath)).toBe(true);

      const report = readFileSync(result.conclusionsPath, "utf8");
      expect(report).toContain("Weaver Multi-Agent Workflow: Comprehensive Review & Conclusions Report");
      expect(report).toContain("Seam 1: Brief Intake");
      expect(report).toContain("Seam 9: S03 Revision Limit");
      expect(report).toContain("Audit status**: SIMULATED");
      expect(report).toContain("Connected Revision Cycle (J06)");
      expect(report).toContain("Reliability & Defensive Barriers (J07)");
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("handles adversarial contradiction injection and captures audit flags", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "workflow-sandbox-"));
    try {
      const result = await executeWorkflowInSandbox(lighthouseMysteryCase, {
        baseDir,
        adversarial: true,
        humanFeedback: "Note the contradiction.",
      });

      expect(result.trace).toBeDefined();
      const consistencyStep = result.trace.steps.find((step) => step.stepId === "step-consistency");
      expect(["complete", "partial", "blocked"]).toContain(consistencyStep?.status);
      expect(consistencyStep?.status).not.toBe("PASS");
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("executes across multiple diverse bibles (Clockwork & Orbital Sci-Fi)", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "workflow-sandbox-"));
    try {
      const resClockwork = await executeWorkflowInSandbox(clockworkFairytaleCase, {
        baseDir,
        humanFeedback: "Keep the midnight deadline.",
      });
      expect(resClockwork.trace.steps.length).toBeGreaterThanOrEqual(13);
      expectRecordedSeams(resClockwork.trace.handOffAudits);
      const clockworkConsistency = resClockwork.trace.steps.find((step) => step.stepId === "step-consistency");
      expect(clockworkConsistency?.status).toBe("complete");

      const resOrbital = await executeWorkflowInSandbox(orbitalSciFiCase, {
        baseDir,
        humanFeedback: "Keep the reflector aligned.",
      });
      expect(resOrbital.trace.steps.length).toBeGreaterThanOrEqual(13);
      expectRecordedSeams(resOrbital.trace.handOffAudits);
      const orbitalConsistency = resOrbital.trace.steps.find((step) => step.stepId === "step-consistency");
      expect(orbitalConsistency?.status).toBe("complete");
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("cleans workflow logs without deleting the writer sandbox logs", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "workflow-sandbox-"));
    try {
      const workflowTrace = join(baseDir, "logs", "workflow-sandbox", "traces");
      const writerTrace = join(baseDir, "logs", "sandbox", "traces");
      mkdirSync(workflowTrace, { recursive: true });
      mkdirSync(writerTrace, { recursive: true });
      writeFileSync(join(workflowTrace, "old-workflow.json"), "{}");
      writeFileSync(join(writerTrace, "keep-me.json"), "{}");

      cleanupWorkflowSandboxLogs(baseDir);

      expect(existsSync(join(workflowTrace, "old-workflow.json"))).toBe(false);
      expect(existsSync(join(writerTrace, "keep-me.json"))).toBe(true);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
