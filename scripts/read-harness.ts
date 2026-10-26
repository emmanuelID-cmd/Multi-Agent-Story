import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { criticEditorA, criticEditorB } from "../src/agents/editors";
import { validateHandoff } from "../src/agents/handoff";
import { modelFromEnvironment, type ModelCall, type ModelResponse, type ReadModel } from "../src/agents/read/model";
import { proposalDigest, runConsistency, runReader, runResearch, sha256, type ReadDependencies } from "../src/agents/read/runtime";
import type { ReadAuthority, ReadResult, TraceEvent } from "../src/agents/read/contracts";
import { fixtureBible, fixtureChapters, fixtureProviders, fixtureResearchInput, fixtureSnapshot, FixtureReadModel, recordedRequest } from "../src/agents/read-harness-fixtures";
import { readBookBenchmarks } from "../src/server/research/book-metadata";

const HARNESS = "read-harness-v1";
const MAX_TOKENS = 60_000;
const MAX_USD = 0.25;
const INPUT_USD_PER_MILLION = 1;
const OUTPUT_USD_PER_MILLION = 5;

type Mode = "fixture" | "live_model";
type Summary = { status: ReadResult<unknown>["status"]; reasonCode: string; attempts: number; traceId: string; inputTokens: number; outputTokens: number };
export type HarnessReport = {
  runId: string; mode: Mode; providerMode: "fixture" | "gated_live"; fixture: "normal" | "continuity";
  status: "verification_complete_awaiting_human" | "blocked" | "failed";
  research?: Summary; reader?: Summary; consistency: Record<string, Summary>;
  fixtureApproval?: { kind: "synthetic_coordinator_fixture_only"; dossierSha256: string; briefVersion: number; scopeVersion: number; criteriaVersion: number; dossierVersion: number };
  sourceHashes?: Record<string, string>; proposalHashes: Record<string, string>;
  artifacts: Record<string, { path: string; sha256: string }>;
  editorMode: "existing_synthetic_functions"; agentCalls: string[]; failureCodes: string[];
  usage: { inputTokens: number; outputTokens: number; estimatedUsd: number };
};

function summarize(result: ReadResult<unknown>): Summary {
  return { status: result.status, reasonCode: result.reasonCode, attempts: result.attempts, traceId: result.traceId, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };
}

/** A single ceiling across all three READ agents and both proposal checks. */
export class SharedBudgetModel implements ReadModel {
  readonly modelId: string;
  readonly calls: string[] = [];
  inputTokens = 0;
  outputTokens = 0;
  constructor(private readonly inner: ReadModel) { this.modelId = inner.modelId; }
  get estimatedUsd(): number { return (this.inputTokens * INPUT_USD_PER_MILLION + this.outputTokens * OUTPUT_USD_PER_MILLION) / 1_000_000; }
  async complete(call: ModelCall): Promise<ModelResponse> {
    const inputReserve = Buffer.byteLength(call.system + JSON.stringify(call.data), "utf8");
    const projectedTokens = this.inputTokens + this.outputTokens + inputReserve + call.maxOutputTokens;
    const projectedUsd = ((this.inputTokens + inputReserve) * INPUT_USD_PER_MILLION + (this.outputTokens + call.maxOutputTokens) * OUTPUT_USD_PER_MILLION) / 1_000_000;
    if (projectedTokens > MAX_TOKENS || projectedUsd > MAX_USD) throw new Error("BUDGET_EXHAUSTED");
    this.calls.push(call.agent);
    let charged = false;
    try {
      const response = await this.inner.complete(call);
      this.inputTokens += response.usage.inputTokens;
      this.outputTokens += response.usage.outputTokens;
      charged = true;
      if (this.inputTokens + this.outputTokens > MAX_TOKENS || this.estimatedUsd > MAX_USD) throw new Error("BUDGET_EXHAUSTED");
      return response;
    } catch (error) {
      // A provider may bill an uncertain failed request; retain its full reservation.
      if (!charged) { this.inputTokens += inputReserve; this.outputTokens += call.maxOutputTokens; }
      throw error;
    }
  }
}

function taskAuthority(runId: string, taskId: string, stateVersion = 1): ReadAuthority {
  return { runId, taskId, operationId: `${taskId}-operation`, ownerId: "synthetic_owner", projectId: "synthetic_mara", stateVersion, requestVersion: 1, prdVersion: "v3-draft" };
}

function safeTrace(event: TraceEvent): Record<string, unknown> {
  return {
    runId: event.runId, taskId: event.taskId, operationId: event.operationId,
    agentId: event.agentId, eventId: event.eventId, timestamp: event.at,
    event: event.event, attempt: event.attempt, durationMs: event.durationMs,
    code: event.code, versions: event.versions, stateVersion: event.stateVersion,
  };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export async function runHarness(options: { fixture?: "normal" | "continuity"; live?: boolean; providersLive?: boolean; outputRoot?: string } = {}): Promise<HarnessReport> {
  const fixture = options.fixture ?? "continuity";
  const mode: Mode = options.live ? "live_model" : "fixture";
  if (options.providersLive && !options.live) throw new Error("LIVE_PROVIDER_REQUIRES_LIVE_MODEL");
  const model = new SharedBudgetModel(options.live ? modelFromEnvironment() : new FixtureReadModel());
  const runId = randomUUID();
  const root = options.outputRoot ?? join(process.cwd(), ".tools", "agent-runs");
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const stream of ["events", "research", "reader", "consistency"]) writeFileSync(join(dir, `${stream}.jsonl`), "", { encoding: "utf8", flag: "wx", mode: 0o600 });
  const report: HarnessReport = { runId, mode, providerMode: options.providersLive ? "gated_live" : "fixture", fixture, status: "blocked", consistency: {}, proposalHashes: {}, artifacts: {}, editorMode: "existing_synthetic_functions", agentCalls: [], failureCodes: [], usage: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 } };
  const saveArtifact = (name: string, value: unknown) => {
    const path = `${name}.json`;
    writeJson(join(dir, path), value);
    const reference = { path, sha256: sha256(JSON.stringify(value)) };
    report.artifacts[name] = reference;
    return reference;
  };
  const events: TraceEvent[] = [];
  const onTrace = (event: TraceEvent) => {
    events.push(event);
    const line = JSON.stringify(safeTrace(event)) + "\n";
    appendFileSync(join(dir, "events.jsonl"), line, { encoding: "utf8", mode: 0o600 });
    appendFileSync(join(dir, `${event.agentId}.jsonl`), line, { encoding: "utf8", mode: 0o600 });
  };
  const deps: ReadDependencies = {
    model, onTrace,
    readBenchmarks: options.providersLive
      ? async request => readBookBenchmarks(request)
      : async () => fixtureProviders(),
    budget: { maxTokens: MAX_TOKENS, maxCostUsd: MAX_USD, inputUsdPerMillion: INPUT_USD_PER_MILLION, outputUsdPerMillion: OUTPUT_USD_PER_MILLION },
  };
  const versions = { contract: "read-v1" as const, prompt: "read-v1" as const, harness: HARNESS, model: model.modelId };
  const finish = () => {
    report.agentCalls = [...model.calls];
    report.usage = { inputTokens: model.inputTokens, outputTokens: model.outputTokens, estimatedUsd: model.estimatedUsd };
    writeJson(join(dir, "manifest.json"), { runId, mode, providerMode: report.providerMode, fixture, versions, eventCount: events.length, fixtureSource: "src/agents/read-harness-fixtures.ts", approvalKind: report.fixtureApproval?.kind ?? null });
    writeJson(join(dir, "report.json"), report);
    return report;
  };
  try {
    const researchInput = fixtureResearchInput(taskAuthority(runId, "research_task"), model.modelId);
    const research = await runResearch(researchInput, deps);
    report.research = summarize(research);
    const dossierArtifact = research.output ? saveArtifact("dossier", research.output) : undefined;
    if (research.status !== "ready_for_review" || !research.output || research.output.gateRecommendation !== "ACCEPT_CANDIDATE") {
      report.failureCodes.push(research.reasonCode);
      return finish();
    }
    if (Object.values(research.output.providerOutcomes).some(outcome => outcome.status !== "available")) {
      report.failureCodes.push("HARNESS_PROVIDER_EVIDENCE_UNAVAILABLE");
      return finish();
    }
    if (!dossierArtifact) throw new Error("DOSSIER_ARTIFACT_UNAVAILABLE");
    // This record permits this synthetic connector test only. It is never a product acceptance.
    report.fixtureApproval = { kind: "synthetic_coordinator_fixture_only", dossierSha256: dossierArtifact.sha256, briefVersion: research.output.briefVersion, scopeVersion: research.output.scopeVersion, criteriaVersion: research.output.criteriaVersion, dossierVersion: research.output.dossierVersion };

    const baseAuthority = taskAuthority(runId, "reader_task");
    const baseChapters = fixtureChapters(fixture);
    const baseSnapshot = fixtureSnapshot(baseAuthority, baseChapters);
    const reader = await runReader({ authority: baseAuthority, versions, bibleVersion: 1, draftVersion: 1, editorialTask: { action: "revise", scope: [1, 2, 3], expectedOutput: "Two complete three-chapter editorial proposals." }, recordedRequest, hasAdditionalInstructions: false, revision: 0 }, { ...deps, readSnapshot: async () => baseSnapshot });
    report.reader = summarize(reader);
    if (reader.output) saveArtifact("reader-handoff", reader.output);
    if (reader.status !== "ready_for_review" || !reader.output || !validateHandoff(reader.output.handoff, recordedRequest).valid ||
        Object.entries(reader.output.sourceHashes).some(([id, hash]) => baseSnapshot.chapters.find(chapter => chapter.sourceId === id)?.sha256 !== hash)) {
      report.failureCodes.push(reader.reasonCode);
      return finish();
    }
    report.sourceHashes = reader.output.sourceHashes;
    // Justin's existing functions are fixture connectors; no Writer or Editor model runs here.
    const proposals = [criticEditorA(reader.output.handoff, baseChapters, fixtureBible), criticEditorB(reader.output.handoff, baseChapters, fixtureBible)];
    for (const proposal of proposals) {
      const authority = taskAuthority(runId, `${proposal.kind}_consistency_task`, proposal.kind === "manuscript_a" ? 2 : 3);
      const snapshot = fixtureSnapshot(authority, proposal.chapters, 1, proposal.kind);
      const digest = proposalDigest(snapshot.chapters);
      report.proposalHashes[proposal.kind] = digest;
      const consistency = await runConsistency({ authority, versions, bibleVersion: 1, draftVersion: 1, proposalId: proposal.kind, proposalVersion: 1, proposalSha256: digest }, { ...deps, readSnapshot: async () => snapshot });
      report.consistency[proposal.kind] = summarize(consistency);
      if (consistency.output) saveArtifact(`consistency-${proposal.kind}`, consistency.output);
      if (consistency.status !== "ready_for_review" || consistency.output?.status !== "complete" || consistency.output.proposalSha256 !== digest || consistency.output.checkedSourceRefs.length !== 3) {
        report.failureCodes.push(`${proposal.kind}:${consistency.reasonCode}`);
        return finish();
      }
    }
    if (Object.keys(report.consistency).length === 2 && model.calls.filter(call => call === "consistency").length >= 2) report.status = "verification_complete_awaiting_human";
    else report.failureCodes.push("CONSISTENCY_BRANCH_MISSING");
    return finish();
  } catch (error) {
    report.status = "failed";
    report.failureCodes.push(error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : "HARNESS_FAILURE");
    return finish();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const allowed = new Set(["--live", "--providers-live", "--fixture", "normal", "continuity"]);
  const fixtureAt = args.indexOf("--fixture");
  const selected = fixtureAt >= 0 ? args[fixtureAt + 1] : "continuity";
  if (args.some(arg => !allowed.has(arg)) || !["normal", "continuity"].includes(selected) || (args.includes("--providers-live") && !args.includes("--live"))) {
    console.error("Usage: npm run agents:read -- [--fixture normal|continuity] [--live] [--providers-live]");
    process.exitCode = 2;
  } else {
    runHarness({ fixture: selected as "normal" | "continuity", live: args.includes("--live"), providersLive: args.includes("--providers-live") }).then(report => {
      console.log(JSON.stringify({ runId: report.runId, status: report.status, mode: report.mode, providerMode: report.providerMode, research: report.research?.status, reader: report.reader?.status, consistency: Object.fromEntries(Object.entries(report.consistency).map(([key, value]) => [key, value.status])), failureCodes: report.failureCodes, trace: `.tools/agent-runs/${report.runId}/events.jsonl` }));
      if (report.status !== "verification_complete_awaiting_human") process.exitCode = 1;
    }).catch(() => { console.error("READ harness could not start. Check configuration and fixture inputs."); process.exitCode = 1; });
  }
}
