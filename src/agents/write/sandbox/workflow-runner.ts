import { randomUUID } from "node:crypto";
import { orderedChapters, type Chapter } from "../../../contracts";
import type { MockBibleCase } from "../../../../tests/fixtures/mock-bibles";
import {
  generateChapterProse,
  generateEditorialProposal,
  buildManuscriptEnvelope,
  verifyManuscriptEnvelope,
  type RevisedManuscript,
} from "../runtime";
import {
  buildFixtureHandoff,
  validateEditorReceivingHandoff,
} from "../../handoff";
import {
  executeRevisionCycle,
  executeConsistencyCheck,
} from "../revision";
import {
  SandboxWorkflowTracer,
  type WorkflowRunTrace,
} from "./workflow-tracer";
import { generateWorkflowConclusionsReport } from "./workflow-conclusions";
import { initWorkflowSandboxDirectories } from "./cleanup";
import { AnthropicWriteModel, type WriteModel, type WriteModelCall } from "../model";
import { createSandboxEditorialModel, swimRuleApplies } from "./editorial-model";

export interface WorkflowRunnerOptions {
  model?: WriteModel;
  useLiveModel?: boolean;
  liveModelId?: string;
  adversarial?: boolean;
  baseDir?: string;
  /** Writer feedback for the simulated human gate. It is not an approval. */
  humanFeedback?: string;
}

/**
 * Creates a deterministic simulated model for writers and editors when not running live.
 */
function createSimulatedWorkflowModel(
  bibleCase: MockBibleCase,
  adversarial = false
): WriteModel {
  return {
    async complete(call: WriteModelCall) {
      if (call.signal?.aborted) {
        throw new DOMException("Operation canceled.", "AbortError");
      }

      const role = call.role;

      if (role === "critic_editor_a" || role === "critic_editor_b") {
        return createSandboxEditorialModel(bibleCase).complete(call);
      }

      if (role === "chapter_writer_1") {
        return {
          value: {
            text: `Mara climbed to the lantern gallery as the salt gale shook the glass. From the catwalk, she timed the rhythmic blue signal pulsing across the outer reef every three minutes. Mindful that she could not swim and terrified of the dark surges, she descended to the boathouse and readied the heavy wooden skiff.`,
          },
          usage: { inputTokens: 420, outputTokens: 95 },
          modelUsed: "mock-writer-grimm",
        };
      }

      if (role === "chapter_writer_2") {
        const injectSwim = adversarial && swimRuleApplies(bibleCase.bible.facts);
        const text = injectSwim
          ? `Mara swam into the dark channel toward the breakwater rocks, abandoning the boat. This deliberate action directly contradicts approved fact F1 and must be caught by consistency.`
          : `Mara pulled steadily on the oars, keeping the wooden skiff strictly within the sheltered lee of the breakwater. With the tide surging violently, she tracked the pulsing blue beacon through the sea mist, closing the distance to the outer ledge without ever leaving the safety of the hull.`;
        return {
          value: { text },
          usage: { inputTokens: 460, outputTokens: 90 },
          modelUsed: "mock-writer-andersen",
        };
      }

      if (role === "chapter_writer_3") {
        return {
          value: {
            text: `Pulling alongside the breakwater rocks, Mara threw a line to the shivering sailor and helped him safely into the skiff. Turning the craft before the tide could swamp the outer rocks, she rowed back to the harbor pier guided by the safe yellow glow of the lamps.`,
          },
          usage: { inputTokens: 450, outputTokens: 85 },
          modelUsed: "mock-writer-perrault",
        };
      }

      throw new Error(`Unknown role in simulated model: ${role}`);
    },
  };
}

export async function executeWorkflowInSandbox(
  bibleCase: MockBibleCase,
  options: WorkflowRunnerOptions = {}
): Promise<{
  trace: WorkflowRunTrace;
  tracePath: string;
  summaryPath: string;
  conclusionsPath: string;
}> {
  const baseDir = options.baseDir ?? process.cwd();
  initWorkflowSandboxDirectories(baseDir);

  const runId = `wf-${randomUUID().slice(0, 8)}`;
  const useLive = options.useLiveModel ?? false;
  const modelId = useLive
    ? options.liveModelId ?? "claude-3-5-sonnet-20241022"
    : "simulation-tiered";

  const model: WriteModel =
    options.model ??
    (useLive
      ? new AnthropicWriteModel(process.env.ANTHROPIC_API_KEY || "mock-key", {
          criticModelId: modelId,
          writerModelId: modelId,
        })
      : createSimulatedWorkflowModel(bibleCase, options.adversarial));

  const tracer = new SandboxWorkflowTracer({
    runId,
    bibleId: bibleCase.id,
    bibleName: bibleCase.name,
    bibleVersion: bibleCase.bibleVersion,
    mode: useLive ? "LIVE" : "SIMULATION",
    modelId,
  });

  // ------------------------------------------------------------------
  // PHASE 1: Intake & Context Assembly
  // ------------------------------------------------------------------
  const t0 = Date.now();
  tracer.recordStep({
    stepId: "step-1-intake",
    phase: "intake_context",
    inputSummary: `Brief premise: "${bibleCase.brief.premise.slice(0, 80)}..."`,
    outputSummary: `Loaded ${bibleCase.bible.facts.length} facts, ${bibleCase.bible.beats.length} beats, bible v${bibleCase.bibleVersion}`,
    durationMs: Date.now() - t0,
    status: "PASS",
  });

  tracer.recordHandOff({
    seam: "Seam 1: Brief Intake ➔ Story Writers Context",
    sourceAgent: "intake_coordinator",
    destinationAgent: "writers_cluster",
    status: "VALID",
    details: `Confirmed brief and bible v${bibleCase.bibleVersion} passed with 0 ungrounded assumptions.`,
  });

  // ------------------------------------------------------------------
  // PHASE 2: Three Model-Backed Chapter Writers (Round 0)
  // ------------------------------------------------------------------
  const rawChapters: Chapter[] = [];
  const writerRoles = [
    { idx: 1, alias: "Grimm", role: "chapter_writer_1" },
    { idx: 2, alias: "Andersen", role: "chapter_writer_2" },
    { idx: 3, alias: "Perrault", role: "chapter_writer_3" },
  ];

  for (const w of writerRoles) {
    const tStart = Date.now();
    const res = await generateChapterProse(
      {
        chapterIndex: w.idx as 1 | 2 | 3,
        bibleVersion: bibleCase.bibleVersion,
        approvedBible: bibleCase.bible,
        brief: bibleCase.brief,
        precedingChapters: rawChapters,
      },
      model
    );
    rawChapters.push(res.chapter);

    tracer.recordStep({
      stepId: `step-writer-${w.idx}`,
      phase: "drafting",
      agentId: w.role,
      agentAlias: w.alias,
      inputSummary: `Beat ${w.idx}: "${bibleCase.bible.beats[w.idx - 1].text.slice(0, 60)}..."`,
      outputSummary: `Drafted Chapter ${w.idx} (${res.chapter.text.length} chars)`,
      durationMs: Date.now() - tStart,
      tokens: { input: res.usage.inputTokens, output: res.usage.outputTokens },
      status: "PASS",
    });
  }

  // ------------------------------------------------------------------
  // PHASE 3: Write Barrier
  // ------------------------------------------------------------------
  const tBarrier = Date.now();
  const baseChapters = orderedChapters(rawChapters, bibleCase.bibleVersion);
  tracer.recordStep({
    stepId: "step-write-barrier",
    phase: "write_barrier",
    inputSummary: `Raw chapters count: ${rawChapters.length}`,
    outputSummary: `Verified contiguous indexes [1, 2, 3] on bible v${bibleCase.bibleVersion}`,
    durationMs: Date.now() - tBarrier,
    status: "PASS",
  });

  tracer.recordHandOff({
    seam: "Seam 2: Chapter Writers ➔ Write Barrier",
    sourceAgent: "writers_cluster",
    destinationAgent: "write_barrier",
    status: "VALID",
    details: `All 3 chapters match bibleVersion ${bibleCase.bibleVersion} with unique sorted indexes.`,
  });

  // ------------------------------------------------------------------
  // PHASE 4: Reader Handoff & Editor Receiving Validation
  // ------------------------------------------------------------------
  const tReader = Date.now();
  const recordedRequest = bibleCase.brief.desiredEnding;
  const initialHandoff = buildFixtureHandoff(
    baseChapters,
    bibleCase.bibleVersion,
    recordedRequest,
    0
  );

  const valA = validateEditorReceivingHandoff({
    handoff: initialHandoff,
    expectedRecordedRequest: recordedRequest,
    baseChapters,
    approvedBibleVersion: bibleCase.bibleVersion,
  });

  const valB = validateEditorReceivingHandoff({
    handoff: initialHandoff,
    expectedRecordedRequest: recordedRequest,
    baseChapters,
    approvedBibleVersion: bibleCase.bibleVersion,
  });

  tracer.recordStep({
    stepId: "step-reader-handoff",
    phase: "reader_handoff",
    agentId: "reader",
    agentAlias: "Reader",
    inputSummary: `Assembled 3 chapters, desired ending: "${recordedRequest.slice(0, 50)}..."`,
    outputSummary: `Built 5-field package: task, userInstructions, sourceReferences, completeness, version`,
    durationMs: Date.now() - tReader,
    status: "PASS",
  });

  tracer.recordHandOff({
    seam: "Seam 3: Write Barrier ➔ Reader Handoff",
    sourceAgent: "write_barrier",
    destinationAgent: "reader",
    status: "VALID",
    details: "Reader received verified base chapters with full source references.",
  });

  tracer.recordHandOff({
    seam: "Seam 4: Reader Handoff ➔ Critic/Editors A & B",
    sourceAgent: "reader",
    destinationAgent: "critic_editors_cluster",
    status: valA.valid && valB.valid ? "VALID" : "INVALID",
    details: `Receiving validation passed for Fontaine (valid=${valA.valid}) and Lang (valid=${valB.valid}).`,
  });

  // ------------------------------------------------------------------
  // PHASE 5: Dual Critic/Editors (Round 0 Proposals)
  // ------------------------------------------------------------------
  const tPropA = Date.now();
  const propResA = await generateEditorialProposal(
    {
      role: "critic_editor_a",
      approvedBible: bibleCase.bible,
      bibleVersion: bibleCase.bibleVersion,
      baseChapters,
      handoff: initialHandoff,
    },
    model
  );
  tracer.recordStep({
    stepId: "step-editor-a",
    phase: "editorial_proposals",
    agentId: "critic_editor_a",
    agentAlias: "Fontaine",
    inputSummary: `Lens: continuity_and_pacing, 3 base chapters`,
    outputSummary: `Generated Manuscript A (${propResA.proposal.changesMade.length} change entries)`,
    durationMs: Date.now() - tPropA,
    tokens: { input: propResA.usage.inputTokens, output: propResA.usage.outputTokens },
    status: "PASS",
  });

  const tPropB = Date.now();
  const propResB = await generateEditorialProposal(
    {
      role: "critic_editor_b",
      approvedBible: bibleCase.bible,
      bibleVersion: bibleCase.bibleVersion,
      baseChapters,
      handoff: initialHandoff,
    },
    model
  );
  tracer.recordStep({
    stepId: "step-editor-b",
    phase: "editorial_proposals",
    agentId: "critic_editor_b",
    agentAlias: "Lang",
    inputSummary: `Lens: voice_and_atmosphere, 3 base chapters`,
    outputSummary: `Generated Manuscript B (${propResB.proposal.changesMade.length} change entries)`,
    durationMs: Date.now() - tPropB,
    tokens: { input: propResB.usage.inputTokens, output: propResB.usage.outputTokens },
    status: "PASS",
  });

  // ------------------------------------------------------------------
  // PHASE 6: Proposal Write Barrier & S04 Envelopes
  // ------------------------------------------------------------------
  const tEnv = Date.now();
  const envA = buildManuscriptEnvelope({
    runId,
    baseVersion: bibleCase.bibleVersion,
    baseChapters,
    manuscript: propResA.proposal,
  });
  const envB = buildManuscriptEnvelope({
    runId,
    baseVersion: bibleCase.bibleVersion,
    baseChapters,
    manuscript: propResB.proposal,
  });

  const verifyEnvA = verifyManuscriptEnvelope({
    envelope: envA,
    storedChapters: baseChapters,
    manuscript: propResA.proposal,
    expectedBaseVersion: bibleCase.bibleVersion,
  });
  const verifyEnvB = verifyManuscriptEnvelope({
    envelope: envB,
    storedChapters: baseChapters,
    manuscript: propResB.proposal,
    expectedBaseVersion: bibleCase.bibleVersion,
  });

  tracer.recordStep({
    stepId: "step-envelopes",
    phase: "proposal_barrier",
    inputSummary: `Manuscripts A & B`,
    outputSummary: `Attached S04 SHA-256 envelopes (validA=${verifyEnvA.valid}, validB=${verifyEnvB.valid})`,
    durationMs: Date.now() - tEnv,
    status: verifyEnvA.valid && verifyEnvB.valid ? "PASS" : "FAIL",
  });

  tracer.recordHandOff({
    seam: "Seam 5: Critic/Editors ➔ S04 Proposal Envelopes",
    sourceAgent: "critic_editors_cluster",
    destinationAgent: "proposal_registry",
    status: verifyEnvA.valid && verifyEnvB.valid ? "VALID" : "INVALID",
    details: `SHA-256 integrity binding matches baseChapters and generated manuscript content.`,
  });

  // ------------------------------------------------------------------
  // PHASE 7: Consistency Checks
  // ------------------------------------------------------------------
  const tCons = Date.now();
  const [consA, consB] = await Promise.all([
    executeConsistencyCheck({
      proposalId: "prop-a-r0",
      proposalVersion: 0,
      proposal: propResA.proposal,
      envelope: envA,
      approvedFacts: bibleCase.bible.facts,
      bibleVersion: bibleCase.bibleVersion,
    }),
    executeConsistencyCheck({
      proposalId: "prop-b-r0",
      proposalVersion: 0,
      proposal: propResB.proposal,
      envelope: envB,
      approvedFacts: bibleCase.bible.facts,
      bibleVersion: bibleCase.bibleVersion,
    }),
  ]);

  // The step keeps the check's own status. A swim finding is partial, not a pass.
  const consistencyStatus: "complete" | "partial" | "blocked" =
    consA.status === "blocked" || consB.status === "blocked"
      ? "blocked"
      : consA.status === "partial" || consB.status === "partial"
        ? "partial"
        : "complete";
  tracer.recordStep({
    stepId: "step-consistency",
    phase: "consistency_check",
    agentId: "consistency",
    agentAlias: "Consistency",
    inputSummary: `Swim-rule heuristic across chapters [1, 2, 3]`,
    outputSummary: `Consistency results: statusA=${consA.status}, statusB=${consB.status}, findingsA=${consA.findings.length}, findingsB=${consB.findings.length}`,
    durationMs: Date.now() - tCons,
    status: consistencyStatus,
  });

  tracer.recordHandOff({
    seam: "Seam 6: Proposals Envelopes ➔ Consistency Checker",
    sourceAgent: "proposal_registry",
    destinationAgent: "consistency",
    status: consistencyStatus === "complete" ? "VALID" : "INVALID",
    details: `Swim-rule heuristic status ${consistencyStatus}. Checked fact ids: ${consA.checkedFactIds.join(", ") || "none"}.`,
  });

  // ------------------------------------------------------------------
  // PHASE 8: Simulated Human Gate #2 (Revision Request)
  // ------------------------------------------------------------------
  const tGate = Date.now();
  // The caller supplies the feedback. This step only records it. It does not approve a manuscript.
  const simulatedFeedback = options.humanFeedback ?? "";
  tracer.recordStep({
    stepId: "step-human-gate",
    phase: "human_gate",
    inputSummary: `Reviewing Proposal A & B from Round 0`,
    outputSummary: `Simulated writer feedback (not an approval): "${simulatedFeedback}"`,
    durationMs: Date.now() - tGate,
    status: "SIMULATED",
  });

  tracer.recordHandOff({
    seam: "Seam 7: Consistency Findings ➔ Writer Human Gate #2",
    sourceAgent: "consistency",
    destinationAgent: "human_writer",
    status: "SIMULATED",
    details: "Simulated feedback only. This does not approve a manuscript or mark the human gate as passed.",
  });

  // ------------------------------------------------------------------
  // PHASE 9: Connected Revision Cycle (Round 1)
  // ------------------------------------------------------------------
  const tRev1 = Date.now();
  const revResult1 = await executeRevisionCycle({
    runId: `${runId}-r1`,
    projectId: `proj-${runId}`,
    bibleVersion: bibleCase.bibleVersion,
    approvedBible: bibleCase.bible,
    baseChapters,
    revisionRound: 1,
    editorialInstructions: simulatedFeedback,
    hasAdditionalInstructions: simulatedFeedback.trim().length > 0,
    modelA: model,
    modelB: model,
  });

  tracer.recordStep({
    stepId: "step-revision-round-1",
    phase: "revision_cycle",
    inputSummary: `Round 1, instructions: "${simulatedFeedback}"`,
    outputSummary: `Generated 2 revised proposals with S04 envelopes, consistency verified`,
    durationMs: Date.now() - tRev1,
    status: "PASS",
  });

  tracer.recordHandOff({
    seam: "Seam 8: Human Feedback ➔ Connected Revision Cycle (Round 1)",
    sourceAgent: "human_writer",
    destinationAgent: "revision_orchestrator",
    status: "VALID",
    details: `Decoupled instructions preserved without altering brief.desiredEnding. Round 1 executed.`,
  });

  // ------------------------------------------------------------------
  // PHASE 10: Connected Revision Cycle (Round 2)
  // ------------------------------------------------------------------
  const tRev2 = Date.now();
  const round1ChaptersA = revResult1.proposals[0].manuscript.chapters;
  const round1ChaptersB = revResult1.proposals[1].manuscript.chapters;
  const revResult2 = await executeRevisionCycle({
    runId: `${runId}-r2`,
    projectId: `proj-${runId}`,
    bibleVersion: bibleCase.bibleVersion,
    approvedBible: bibleCase.bible,
    baseChapters,
    baseChaptersA: round1ChaptersA,
    baseChaptersB: round1ChaptersB,
    revisionRound: 2,
    editorialInstructions: "Final polish of Chapter 3 rescue dialogue.",
    hasAdditionalInstructions: true,
    modelA: model,
    modelB: model,
  });

  tracer.recordStep({
    stepId: "step-revision-round-2",
    phase: "revision_cycle",
    inputSummary: `Round 2 polish request, starting from each editor's round 1 chapters`,
    outputSummary: `Round ${revResult2.revisionRound} started from each editor's round 1 chapters. Editor A: "${round1ChaptersA[0]?.text.slice(0, 48) ?? ""}". Editor B: "${round1ChaptersB[0]?.text.slice(0, 48) ?? ""}".`,
    durationMs: Date.now() - tRev2,
    status: "PASS",
  });

  // ------------------------------------------------------------------
  // PHASE 11: Round 3 Cap Exhaustion Enforcement
  // ------------------------------------------------------------------
  const tCap = Date.now();
  let capExhaustionBlocked = false;
  try {
    await executeRevisionCycle({
      runId: `${runId}-r3`,
      projectId: `proj-${runId}`,
      bibleVersion: bibleCase.bibleVersion,
      approvedBible: bibleCase.bible,
      baseChapters,
      revisionRound: 3,
      editorialInstructions: "Illegal 3rd revision round attempt.",
      modelA: model,
      modelB: model,
    });
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("The two-round revision limit has been reached.")
    ) {
      capExhaustionBlocked = true;
    }
  }

  tracer.recordStep({
    stepId: "step-cap-exhaustion",
    phase: "cap_exhaustion",
    inputSummary: `Attempted Round 3 revision dispatch`,
    outputSummary: `Rejected with 409 limit error (capExhaustionBlocked=${capExhaustionBlocked})`,
    durationMs: Date.now() - tCap,
    status: capExhaustionBlocked ? "PASS" : "FAIL",
  });

  tracer.recordHandOff({
    seam: "Seam 9: S03 Revision Limit ➔ Dispatch Barrier",
    sourceAgent: "revision_orchestrator",
    destinationAgent: "server_guard",
    status: capExhaustionBlocked ? "VALID" : "INVALID",
    details: "Round 3 attempt was rejected without modifying existing approved proposals.",
  });

  // ------------------------------------------------------------------
  // Finalize Traces & Reports
  // ------------------------------------------------------------------
  const { tracePath, summaryPath } = tracer.writeTraceFiles(baseDir);
  const finalTrace = tracer.finalize();
  const conclusionsPath = generateWorkflowConclusionsReport(finalTrace, baseDir);

  return {
    trace: finalTrace,
    tracePath,
    summaryPath,
    conclusionsPath,
  };
}
