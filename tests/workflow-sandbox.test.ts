import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  lighthouseMysteryCase,
  clockworkFairytaleCase,
  orbitalSciFiCase,
} from "./fixtures/mock-bibles";
import { executeWorkflowInSandbox } from "../src/agents/write/sandbox/workflow-runner";

describe("Weaver Multi-Agent Workflow Sandbox Harness & Conclusions", () => {
  it("runs the full 11-phase workflow cleanly for lighthouse mystery bible", async () => {
    const result = await executeWorkflowInSandbox(lighthouseMysteryCase);

    expect(result.trace).toBeDefined();
    expect(result.trace.steps.length).toBeGreaterThanOrEqual(13);
    expect(result.trace.handOffAudits).toHaveLength(9);

    // Verify all 9 seams are present and VALID
    for (const seam of result.trace.handOffAudits) {
      expect(seam.status).toBe("VALID");
    }

    // Verify files created on disk
    expect(existsSync(result.tracePath)).toBe(true);
    expect(existsSync(result.summaryPath)).toBe(true);
    expect(existsSync(result.conclusionsPath)).toBe(true);

    // Verify conclusions report content
    const report = readFileSync(result.conclusionsPath, "utf8");
    expect(report).toContain("Weaver Multi-Agent Workflow: Comprehensive Review & Conclusions Report");
    expect(report).toContain("Seam 1: Brief Intake");
    expect(report).toContain("Seam 9: S03 Revision Limit");
    expect(report).toContain("Connected Revision Cycle (J06)");
    expect(report).toContain("Reliability & Defensive Barriers (J07)");
  });

  it("handles adversarial contradiction injection and captures audit flags", async () => {
    const result = await executeWorkflowInSandbox(lighthouseMysteryCase, {
      adversarial: true,
    });

    expect(result.trace).toBeDefined();
    // In adversarial mode, Chapter 2 injects "Mara swam"
    // Verify Consistency flagged the contradiction
    const consistencyStep = result.trace.steps.find((s) => s.stepId === "step-consistency");
    expect(consistencyStep).toBeDefined();
  });

  it("executes across multiple diverse bibles (Clockwork & Orbital Sci-Fi)", async () => {
    const resClockwork = await executeWorkflowInSandbox(clockworkFairytaleCase);
    expect(resClockwork.trace.steps.length).toBeGreaterThanOrEqual(13);
    expect(resClockwork.trace.handOffAudits.every((h) => h.status === "VALID")).toBe(true);

    const resOrbital = await executeWorkflowInSandbox(orbitalSciFiCase);
    expect(resOrbital.trace.steps.length).toBeGreaterThanOrEqual(13);
    expect(resOrbital.trace.handOffAudits.every((h) => h.status === "VALID")).toBe(true);
  });
});
