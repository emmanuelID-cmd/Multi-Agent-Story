import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  lighthouseMysteryCase,
  clockworkFairytaleCase,
  orbitalSciFiCase,
} from "./fixtures/mock-bibles";
import {
  initEditorSandboxDirectories,
  cleanupEditorSandboxLogs,
  resolveEditorSandboxPaths,
} from "../src/agents/write/sandbox/cleanup";
import { executeEditorsInSandbox } from "../src/agents/write/sandbox/editor-runner";
import { generateEditorConclusionsReport } from "../src/agents/write/sandbox/editor-conclusions";

describe("Editor Sandbox: Multi-Bible Trace & Verification", () => {
  it("initializes editor sandbox directories and verifies cleanup procedure", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "editor-sandbox-"));
    const paths = initEditorSandboxDirectories(baseDir);
    expect(existsSync(paths.root)).toBe(true);
    expect(paths.root).toContain(join("logs", "sandbox", "editors"));
    expect(existsSync(paths.traces)).toBe(true);
    expect(existsSync(paths.reviews)).toBe(true);
    expect(existsSync(paths.conclusions)).toBe(true);

    const { purgedCount } = cleanupEditorSandboxLogs(baseDir);
    expect(purgedCount).toBeGreaterThanOrEqual(0);
    rmSync(baseDir, { recursive: true, force: true });
  });

  const cases = [
    { name: "Lighthouse Mystery", fixture: lighthouseMysteryCase },
    { name: "The Clockwork Weaver", fixture: clockworkFairytaleCase },
    { name: "Orbital Archivist", fixture: orbitalSciFiCase },
  ];

  for (const { name, fixture } of cases) {
    it(`executes full dual-editor sandbox pipeline for ${name} with barrier & S04 envelope verification`, async () => {
      const baseDir = mkdtempSync(join(tmpdir(), "editor-sandbox-"));
      const trace = await executeEditorsInSandbox(fixture, { endToEnd: true, baseDir });

      expect(trace.bibleId).toBe(fixture.id);
      expect(trace.steps).toHaveLength(2);

      // 1. Critic/Editor A: Fontaine
      const fontaine = trace.steps.find((s) => s.role === "critic_editor_a");
      expect(fontaine).toBeDefined();
      expect(fontaine?.alias).toBe("Fontaine");
      expect(fontaine?.lens).toBe("continuity_and_pacing");
      expect(fontaine?.proposal.kind).toBe("manuscript_a");
      expect(fontaine?.barrierPassed).toBe(true);
      expect(fontaine?.envelopeValid).toBe(true);
      expect(fontaine?.antiImitationAudit.passed).toBe(true);
      expect(fontaine?.typographyAudit.passed).toBe(true);
      expect(fontaine?.editorialAudit.passed).toBe(true);
      expect(fontaine?.proposal.chapters).toHaveLength(3);
      expect(fontaine?.proposal.changesMade.length).toBeGreaterThan(0);

      // 2. Critic/Editor B: Lang
      const lang = trace.steps.find((s) => s.role === "critic_editor_b");
      expect(lang).toBeDefined();
      expect(lang?.alias).toBe("Lang");
      expect(lang?.lens).toBe("voice_and_atmosphere");
      expect(lang?.proposal.kind).toBe("manuscript_b");
      expect(lang?.barrierPassed).toBe(true);
      expect(lang?.envelopeValid).toBe(true);
      expect(lang?.antiImitationAudit.passed).toBe(true);
      expect(lang?.typographyAudit.passed).toBe(true);
      expect(lang?.editorialAudit.passed).toBe(true);
      expect(lang?.proposal.chapters).toHaveLength(3);
      expect(lang?.proposal.changesMade.length).toBeGreaterThan(0);

      // 3. Artifact Persistence
      const paths = resolveEditorSandboxPaths(baseDir);
      const traceFile = join(paths.traces, `${fixture.id}_editor_trace.json`);
      const reviewFile = join(paths.reviews, `${fixture.id}_editor_review.md`);
      expect(existsSync(traceFile)).toBe(true);
      expect(existsSync(reviewFile)).toBe(true);

      const reviewContent = readFileSync(reviewFile, "utf-8");
      expect(reviewContent).toContain(fixture.name);
      expect(reviewContent).toContain("Editor Comparative Review");
      expect(reviewContent).toContain("Fontaine");
      expect(reviewContent).toContain("Lang");
      expect(reviewContent).toContain("S04 Envelope");
    });
  }

  it("corrects deliberate continuity contradiction ('Mara swam') in Fontaine proposal", async () => {
    const contradictoryBaseChapters = [
      {
        chapterIndex: 1,
        bibleVersion: 1,
        text: "Mara watched the blue pulse from the lighthouse glass. Mindful that she could not swim, she readied the skiff.",
      },
      {
        chapterIndex: 2,
        bibleVersion: 1,
        text: "Mara swam toward the signal, testing the cold water directly.",
      },
      {
        chapterIndex: 3,
        bibleVersion: 1,
        text: "Mara pulled the sailor into the boat and rowed to safety.",
      },
    ];

    const baseDir = mkdtempSync(join(tmpdir(), "editor-sandbox-"));
    const trace = await executeEditorsInSandbox(lighthouseMysteryCase, {
      baseChapters: contradictoryBaseChapters,
      baseDir,
    });

    const fontaine = trace.steps.find((s) => s.role === "critic_editor_a");
    expect(fontaine).toBeDefined();
    expect(fontaine?.proposal.rationale).toContain("swimming contradiction");

    const ch2Revised = fontaine?.proposal.chapters.find((c) => c.chapterIndex === 2);
    expect(ch2Revised?.text).toContain("could not swim");
    expect(ch2Revised?.text).toContain("skiff");
    expect(ch2Revised?.text).not.toContain("Mara swam toward the signal");

    const ch2Change = fontaine?.proposal.changesMade.find((c) => c.chapterIndex === 2);
    expect(ch2Change?.summary).toContain("Corrected critical continuity contradiction");
    expect(ch2Change?.justification).toContain("cannot swim");
  });

  it("generates an Executive Editor Conclusions report synthesizing all multi-bible runs", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "editor-sandbox-"));
    const traces = await Promise.all([
      executeEditorsInSandbox(lighthouseMysteryCase, { endToEnd: true, baseDir }),
      executeEditorsInSandbox(clockworkFairytaleCase, { endToEnd: true, baseDir }),
      executeEditorsInSandbox(orbitalSciFiCase, { endToEnd: true, baseDir }),
    ]);

    const paths = resolveEditorSandboxPaths(baseDir);
    const conclusionsFile = join(paths.conclusions, "editor_conclusions_test.md");
    const report = generateEditorConclusionsReport(traces, conclusionsFile);

    expect(existsSync(conclusionsFile)).toBe(true);
    expect(report).toContain("Executive Editor Sandbox Conclusions Report");
    expect(report).toContain("ALL BARRIERS, ENVELOPES & AUDITS PASSED");
    expect(report).toContain("Lighthouse Mystery");
    expect(report).toContain("The Clockwork Weaver");
    expect(report).toContain("Orbital Archivist");
    expect(report).toContain("Fontaine (Pacing)");
    expect(report).toContain("Lang (Voice)");
  });
});
