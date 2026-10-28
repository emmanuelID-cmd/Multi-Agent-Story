import { join } from "node:path";
import {
  lighthouseMysteryCase,
  clockworkFairytaleCase,
  orbitalSciFiCase,
  type MockBibleCase,
} from "../tests/fixtures/mock-bibles";
import {
  initEditorSandboxDirectories,
  cleanupEditorSandboxLogs,
  resolveEditorSandboxPaths,
} from "../src/agents/write/sandbox/cleanup";
import { executeEditorsInSandbox } from "../src/agents/write/sandbox/editor-runner";
import { generateEditorConclusionsReport } from "../src/agents/write/sandbox/editor-conclusions";
import { type EditorRunTrace } from "../src/agents/write/sandbox/editor-tracer";

async function main() {
  const args = process.argv.slice(2);
  const shouldClean = args.includes("--clean");
  const useLive = args.includes("--live");
  const endToEnd = args.includes("--end-to-end");
  const adversarial = args.includes("--adversarial");

  const bibleArg = args.find((a) => a.startsWith("--bible="))?.split("=")[1] || "all";
  const modelArg = args.find((a) => a.startsWith("--model="))?.split("=")[1] || "claude-3-5-sonnet-20241022";

  console.log("==================================================================");
  console.log("   WEAVER WRITE LANE: CRITIC/EDITOR SANDBOX & EVALUATION SUITE    ");
  console.log("   (Fontaine: Continuity & Pacing  |  Lang: Voice & Atmosphere)   ");
  console.log("==================================================================");

  const paths = initEditorSandboxDirectories();

  if (shouldClean) {
    const { purgedCount } = cleanupEditorSandboxLogs();
    console.log(`🧹 Cleaned up ${purgedCount} stale editor sandbox trace/review file(s).`);
  }

  const allCases: MockBibleCase[] = [
    lighthouseMysteryCase,
    clockworkFairytaleCase,
    orbitalSciFiCase,
  ];

  const selectedCases =
    bibleArg === "all"
      ? allCases
      : allCases.filter((c) => c.id.toLowerCase() === bibleArg.toLowerCase());

  if (!selectedCases.length) {
    console.error(`❌ Unknown bible: "${bibleArg}". Available: lighthouse, clockwork, orbital, all`);
    process.exit(1);
  }

  console.log(`🎯 Mode: ${useLive ? `LIVE ANTHROPIC (${modelArg})` : "DETERMINISTIC SIMULATION"}`);
  console.log(`🔄 End-to-End Writers Pre-Pass: ${endToEnd ? "ENABLED" : "Standard Base Chapters"}`);
  console.log(`⚠️ Adversarial Injection: ${adversarial ? "ENABLED" : "OFF"}`);
  console.log(`📚 Executing ${selectedCases.length} mock bible(s)...\n`);

  const traces: EditorRunTrace[] = [];

  for (const bibleCase of selectedCases) {
    console.log(`------------------------------------------------------------------`);
    console.log(`📖 Suite: ${bibleCase.name}`);
    console.log(`   Premise: "${bibleCase.brief.premise}"`);
    console.log(`   Genre: ${bibleCase.brief.genre} | Tone: ${bibleCase.brief.tone}`);
    console.log(`------------------------------------------------------------------`);

    // Optionally inject adversarial contradiction if requested
    let baseChaptersOverride = undefined;
    if (adversarial && bibleCase.id === "lighthouse") {
      baseChaptersOverride = [
        {
          chapterIndex: 1,
          bibleVersion: bibleCase.bibleVersion,
          text: "Mara watched the blue pulse from the lighthouse glass. Mindful that she could not swim, she readied the skiff.",
        },
        {
          chapterIndex: 2,
          bibleVersion: bibleCase.bibleVersion,
          text: "Mara swam toward the signal. This deliberately contradicts approved fact F1 and must be corrected by Fontaine.",
        },
        {
          chapterIndex: 3,
          bibleVersion: bibleCase.bibleVersion,
          text: "Mara pulled the exhausted sailor into the boat and rowed back through the surge.",
        },
      ];
      console.log(`  💉 Injected deliberate Chapter 2 contradiction ("Mara swam") into base chapters.`);
    }

    const tStart = Date.now();
    const trace = await executeEditorsInSandbox(bibleCase, {
      useLiveModel: useLive,
      liveModelId: modelArg,
      baseChapters: baseChaptersOverride,
      endToEnd,
    });
    const elapsed = Date.now() - tStart;
    traces.push(trace);

    for (const step of trace.steps) {
      const emoji = step.role === "critic_editor_a" ? "📐" : "🎨";
      console.log(
        `  ${emoji} [${step.alias}] ${step.lens.toUpperCase()}: ${step.changesCount} located changes (${step.durationMs}ms)`
      );
      console.log(`     Model: \`${step.modelUsed}\` | Barrier: ${step.barrierPassed ? "✅ Passed" : "❌ FAILED"}`);
      console.log(`     S04 Envelope: ${step.envelopeValid ? `✅ Valid (${step.envelope.proposalHash.slice(0, 12)}...)` : "❌ INVALID"}`);
      console.log(`     Anti-Imitation: ${step.antiImitationAudit.passed ? "✅ Verified" : "❌ VIOLATION"}`);
      console.log(`     Rationale: "${step.proposal.rationale.slice(0, 95)}..."`);
    }

    console.log(`  ⏱️  Total Tokens: ${trace.totalTokens.total.toLocaleString()} in ${elapsed}ms\n`);
  }

  // Generate Executive Conclusions Report
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(paths.conclusions, `editor_conclusions_report_${timestamp}.md`);
  generateEditorConclusionsReport(traces, reportPath);

  console.log("==================================================================");
  console.log("🎉 EDITOR SANDBOX RUN COMPLETE");
  console.log(`   📁 Traces saved to:     ${paths.traces}`);
  console.log(`   📁 Reviews saved to:    ${paths.reviews}`);
  console.log(`   📄 Conclusions Report:  ${reportPath}`);
  console.log("==================================================================");
}

main().catch((err) => {
  console.error("Fatal editor sandbox error:", err);
  process.exit(1);
});
