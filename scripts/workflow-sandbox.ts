import {
  lighthouseMysteryCase,
  clockworkFairytaleCase,
  orbitalSciFiCase,
  type MockBibleCase,
} from "../tests/fixtures/mock-bibles";
import {
  initWorkflowSandboxDirectories,
  cleanupWorkflowSandboxLogs,
} from "../src/agents/write/sandbox/cleanup";
import { executeWorkflowInSandbox } from "../src/agents/write/sandbox/workflow-runner";

async function main() {
  const args = process.argv.slice(2);
  const shouldClean = args.includes("--clean");
  const useLive = args.includes("--live");
  const adversarial = args.includes("--adversarial");

  const bibleArg =
    args.find((a) => a.startsWith("--bible="))?.split("=")[1] || "all";
  const modelArg =
    args.find((a) => a.startsWith("--model="))?.split("=")[1] ||
    "claude-3-5-sonnet-20241022";

  console.log("==================================================================");
  console.log("   WEAVER WRITE LANE: COMPREHENSIVE MULTI-AGENT WORKFLOW HARNESS  ");
  console.log("   (Intake ➔ Writers ➔ Barrier ➔ Reader ➔ Editors ➔ Consistency   ");
  console.log("    ➔ Human Gate #2 ➔ Revision Rounds 1 & 2 ➔ Cap Enforcement)    ");
  console.log("==================================================================");

  initWorkflowSandboxDirectories();

  if (shouldClean) {
    const { purgedCount } = cleanupWorkflowSandboxLogs();
    console.log(`🧹 Cleaned up ${purgedCount} stale workflow trace/review file(s).`);
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
    console.error(
      `❌ Unknown bible: "${bibleArg}". Available: lighthouse, clockwork, orbital, all`
    );
    process.exit(1);
  }

  console.log(
    `🎯 Mode: ${useLive ? `LIVE ANTHROPIC (${modelArg})` : "DETERMINISTIC SIMULATION"}`
  );
  console.log(`⚠️ Adversarial Injection: ${adversarial ? "ENABLED" : "OFF"}`);
  console.log(`📚 Executing ${selectedCases.length} mock bible(s)...\n`);

  for (const bibleCase of selectedCases) {
    console.log(`------------------------------------------------------------------`);
    console.log(`📖 Suite: ${bibleCase.name}`);
    console.log(`   Premise: "${bibleCase.brief.premise}"`);
    console.log(`   Genre: ${bibleCase.brief.genre} | Tone: ${bibleCase.brief.tone}`);
    console.log(`------------------------------------------------------------------`);

    const tStart = Date.now();
    const result = await executeWorkflowInSandbox(bibleCase, {
      useLiveModel: useLive,
      liveModelId: modelArg,
      adversarial,
    });
    const elapsed = Date.now() - tStart;

    console.log(`\n✅ Completed in ${elapsed}ms (${result.trace.steps.length} steps, ${result.trace.handOffAudits.length} hand-offs)`);
    console.log(`   📄 Trace Log:      ${result.tracePath}`);
    console.log(`   📝 Summary:        ${result.summaryPath}`);
    console.log(`   📊 Review Report:  ${result.conclusionsPath}\n`);
  }

  console.log("==================================================================");
  console.log("   🎉 ALL MULTI-AGENT WORKFLOW PIPELINES EXECUTED SUCCESSFULLY    ");
  console.log("==================================================================");
}

main().catch((err) => {
  console.error("FATAL: Workflow sandbox execution failed:", err);
  process.exit(1);
});
