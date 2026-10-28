import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  lighthouseMysteryCase,
  clockworkFairytaleCase,
  orbitalSciFiCase,
  corruptedBibleCase,
} from "./fixtures/mock-bibles";
import {
  cleanupSandboxLogs,
  initSandboxDirectories,
  resolveSandboxPaths,
} from "../src/agents/write/sandbox/cleanup";
import { executeBibleInSandbox } from "../src/agents/write/sandbox/runner";
import { generateConclusionsReport } from "../src/agents/write/sandbox/conclusions";
import { draftChapterModel } from "../src/agents/writers";
import { createSandboxSimulatedModel } from "../src/agents/write/sandbox/runner";

describe("Writer Sandbox: Isolated Multi-Bible Trace & Verification", () => {
  it("executes cleanup procedure and initializes empty log directories", () => {
    const paths = initSandboxDirectories();
    expect(existsSync(paths.root)).toBe(true);
    expect(existsSync(paths.traces)).toBe(true);
    expect(existsSync(paths.reviews)).toBe(true);
    expect(existsSync(paths.conclusions)).toBe(true);

    const { purgedCount } = cleanupSandboxLogs();
    expect(purgedCount).toBeGreaterThanOrEqual(0);
  });

  const cases = [
    { name: "Lighthouse Mystery", fixture: lighthouseMysteryCase },
    { name: "The Clockwork Weaver", fixture: clockworkFairytaleCase },
    { name: "Orbital Archivist", fixture: orbitalSciFiCase },
  ];

  for (const { name, fixture } of cases) {
    it(`executes full J01-J03 pipeline for ${name} with sequential handoffs and barrier assembly`, async () => {
      const trace = await executeBibleInSandbox(fixture);

      // Verify general trace structure
      expect(trace.bibleId).toBe(fixture.id);
      expect(trace.steps).toHaveLength(3);

      // J01: Persona & Role Verification
      expect(trace.steps[0].alias).toBe("Grimm");
      expect(trace.steps[0].role).toBe("chapter_writer_1");
      expect(trace.steps[1].alias).toBe("Andersen");
      expect(trace.steps[1].role).toBe("chapter_writer_2");
      expect(trace.steps[2].alias).toBe("Perrault");
      expect(trace.steps[2].role).toBe("chapter_writer_3");

      // J02: Sequential Preceding Chapter Handoffs
      expect(trace.steps[0].precedingChaptersPassed).toHaveLength(0);
      expect(trace.steps[1].precedingChaptersPassed).toEqual([1]);
      expect(trace.steps[2].precedingChaptersPassed).toEqual([1, 2]);
      expect(trace.handoffChecks.ch1PassedToCh2).toBe(true);
      expect(trace.handoffChecks.ch1And2PassedToCh3).toBe(true);

      // J03: Chapter Write Barrier Gate
      expect(trace.barrierResult.assembled).toBe(true);
      expect(trace.barrierResult.chapterOrder).toEqual([1, 2, 3]);
      expect(trace.barrierResult.versionMatches).toBe(true);
      expect(trace.barrierResult.error).toBeUndefined();

      // Telemetry & Output Files
      const paths = resolveSandboxPaths();
      const traceFile = join(paths.traces, `${fixture.id}_trace.json`);
      const reviewFile = join(paths.reviews, `${fixture.id}_review.md`);
      expect(existsSync(traceFile)).toBe(true);
      expect(existsSync(reviewFile)).toBe(true);

      const reviewContent = readFileSync(reviewFile, "utf-8");
      expect(reviewContent).toContain(fixture.name);
      expect(reviewContent).toContain("Sequential Continuity & Handoff Audit");
      expect(reviewContent).toContain("Grimm");
      expect(reviewContent).toContain("Andersen");
      expect(reviewContent).toContain("Perrault");
    });
  }

  it("generates an executive conclusions report synthesizing all test runs", async () => {
    const traces = await Promise.all([
      executeBibleInSandbox(lighthouseMysteryCase),
      executeBibleInSandbox(clockworkFairytaleCase),
      executeBibleInSandbox(orbitalSciFiCase),
    ]);

    const paths = resolveSandboxPaths();
    const conclusionsFile = join(paths.conclusions, "conclusions_report_test.md");
    const report = generateConclusionsReport(traces, conclusionsFile);

    expect(existsSync(conclusionsFile)).toBe(true);
    expect(report).toContain("Executive Sandbox Conclusions Report");
    expect(report).toContain("ALL BARRIERS PASSED");
    expect(report).toContain("Lighthouse Mystery");
    expect(report).toContain("The Clockwork Weaver");
    expect(report).toContain("Orbital Archivist");
  });

  it("fails fast on corrupted adversarial bible without Mara fixture fallback", async () => {
    const mockModel = createSandboxSimulatedModel(lighthouseMysteryCase);

    await expect(
      draftChapterModel(
        {
          index: 3, // Beat 3 is missing in corruptedBibleCase
          bibleVersion: corruptedBibleCase.bibleVersion,
          approvedBible: corruptedBibleCase.bible,
        },
        mockModel
      )
    ).rejects.toThrow("Missing beat for chapter index 3 in approved bible.");
  });
});
