import { join } from "node:path";
import {
  lighthouseMysteryCase,
  clockworkFairytaleCase,
  orbitalSciFiCase,
  type MockBibleCase,
} from "../tests/fixtures/mock-bibles";
import {
  initSandboxDirectories,
  cleanupSandboxLogs,
  resolveSandboxPaths,
} from "../src/agents/write/sandbox/cleanup";
import { executeBibleInSandbox } from "../src/agents/write/sandbox/runner";
import { generateConclusionsReport } from "../src/agents/write/sandbox/conclusions";
import { type BibleRunTrace } from "../src/agents/write/sandbox/tracer";

async function main() {
  const args = process.argv.slice(2);
  const shouldClean = args.includes("--clean");
  const useLive = args.includes("--live");

  const bibleArg = args.find((a) => a.startsWith("--bible="))?.split("=")[1] || "all";

  console.log("==================================================================");
  console.log("   WEAVER WRITE LANE SANDBOX (J01, J02, J03 Trace & Test Suite)   ");
  console.log("==================================================================");

  const paths = initSandboxDirectories();

  if (shouldClean) {
    const { purgedCount } = cleanupSandboxLogs();
    console.log(`🧹 Cleaned up ${purgedCount} stale sandbox trace/review file(s).`);
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

  console.log(`🎯 Executing ${selectedCases.length} mock bible(s) in mode: ${useLive ? "LIVE CLAUDE" : "SIMULATION"}...\n`);

  const traces: BibleRunTrace[] = [];

  for (const bibleCase of selectedCases) {
    console.log(`------------------------------------------------------------------`);
    console.log(`📖 Suite: ${bibleCase.name}`);
    console.log(`   Premise: "${bibleCase.brief.premise}"`);
    console.log(`   Genre: ${bibleCase.brief.genre} | Tone: ${bibleCase.brief.tone}`);
    console.log(`------------------------------------------------------------------`);

    const tStart = Date.now();
    const trace = await executeBibleInSandbox(bibleCase, { useLiveModel: useLive });
    const elapsed = Date.now() - tStart;
    traces.push(trace);

    for (const step of trace.steps) {
      console.log(`  ✍️  Ch ${step.chapterIndex} [${step.alias}]: ${step.wordCount} words generated (${step.durationMs}ms)`);
      const preview = step.chapterText.slice(0, 110).replace(/\n/g, " ");
      console.log(`     "${preview}..."`);
    }

    console.log(`  🔗 Handoff Ch1 -> Ch2: ${trace.handoffChecks.ch1PassedToCh2 ? "✅ Verified" : "❌ FAILED"}`);
    console.log(`  🔗 Handoff Ch1,2 -> Ch3: ${trace.handoffChecks.ch1And2PassedToCh3 ? "✅ Verified" : "❌ FAILED"}`);
    console.log(`  🛡️  Write Barrier (orderedChapters): ${trace.barrierResult.assembled ? "✅ [1, 2, 3] Validated" : "❌ REJECTED"}`);
    console.log(`  ⏱️  Total Tokens: ${trace.totalTokens.total.toLocaleString()} in ${elapsed}ms\n`);
  }

  // Generate Executive Conclusions Report
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(paths.conclusions, `conclusions_report_${timestamp}.md`);
  generateConclusionsReport(traces, reportPath);

  console.log("==================================================================");
  console.log("🎉 SANDBOX RUN COMPLETE");
  console.log(`   📁 Traces saved to:     ${paths.traces}`);
  console.log(`   📁 Reviews saved to:    ${paths.reviews}`);
  console.log(`   📄 Conclusions Report:  ${reportPath}`);
  console.log("==================================================================");
}

main().catch((err) => {
  console.error("Fatal sandbox error:", err);
  process.exit(1);
});
