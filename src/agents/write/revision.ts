import { randomUUID } from "node:crypto";
import { orderedChapters, limits, type Chapter, type Bible } from "../../contracts";
import {
  buildFixtureHandoff,
  repairFixtureHandoff,
  validateEditorReceivingHandoff,
  EditorialHandoffRejectionError,
  type ReaderToEditorHandoff,
} from "../handoff";
import {
  buildManuscriptEnvelope,
  generateEditorialProposal,
  hashManuscriptContent,
  type ManuscriptEnvelope,
  type RevisedManuscript,
} from "./runtime";
import type { WriteModel } from "./model";

export interface ConsistencyFinding {
  chapterIndex: number;
  passage: string;
  factId?: string;
  severity: "low" | "medium" | "high";
  rationale: string;
  suggestedCorrection: string;
}

export interface ConsistencyCheckResult {
  proposalId: string;
  proposalVersion: number;
  proposalSha256: string;
  bibleVersion: number;
  status: "complete" | "partial" | "blocked" | "unavailable";
  findings: ConsistencyFinding[];
  unresolvedIssues: string[];
  checkedFactIds: string[];
  checkedChapterIndexes: number[];
}

export interface RevisionCycleInput {
  /** Optional READ connection only; legacy generation and prompts remain unchanged. */
  readConnection?:{edit:(editorId:"critic_editor_a"|"critic_editor_b",chapters:Chapter[],model:WriteModel)=>Promise<{
    handoff:ReaderToEditorHandoff;result:import("./runtime").GenerateEditorialProposalResult}>};
  proposalIds?:[string,string];
  runId: string;
  projectId: string;
  bibleVersion: number;
  approvedBible: Bible;
  baseChapters: Chapter[];
  /**
   * Editor A's starting chapters. Round 2 passes manuscript A's previous proposal.
   * When omitted, Editor A revises baseChapters.
   */
  baseChaptersA?: Chapter[];
  /**
   * Editor B's starting chapters. Round 2 passes manuscript B's previous proposal.
   * When omitted, Editor B revises baseChapters.
   */
  baseChaptersB?: Chapter[];
  /**
   * The one chapter copy that will be saved on the run.
   * Pass this when both envelopes must lock to that same saved copy,
   * because a run can store only one text for each chapter index.
   * When omitted, each envelope locks to that editor's own starting chapters.
   */
  envelopeBaseChapters?: Chapter[];
  revisionRound: number;
  editorialInstructions: string;
  hasAdditionalInstructions?: boolean;
  modelA?: WriteModel;
  modelB?: WriteModel;
  signal?: AbortSignal;
}

export interface RevisionProposalOutput {
  id: string;
  kind: "manuscript_a" | "manuscript_b";
  manuscript: RevisedManuscript;
  envelope: ManuscriptEnvelope;
  consistency: ConsistencyCheckResult;
  usage: { inputTokens: number; outputTokens: number };
  modelUsed: string;
}

export interface RevisionCycleResult {
  runId: string;
  projectId: string;
  revisionRound: number;
  editorialInstructions: string;
  hasAdditionalInstructions: boolean;
  handoff: ReaderToEditorHandoff;
  proposals: [RevisionProposalOutput, RevisionProposalOutput];
  unresolvedIssues: string[];
}

/**
 * A fact is part of the swim rule only when its text says the character cannot swim.
 * Other facts are left unchecked. This keeps a clockwork or orbital bible from
 * looking fully reviewed when this heuristic has nothing to compare.
 */
function factSaysCannotSwim(factText: string): boolean {
  const normalized = factText.toLowerCase();
  return normalized.includes("cannot swim") || normalized.includes("unable to swim");
}

const SWIM_ACTION =
  /\b(swam|swimming|dives? into the water|plunges? into the sea)\b/i;

/**
 * Local swim-rule check for one proposal.
 * It is not READ consistency. A hash or bible-version mismatch blocks the check.
 * A swim contradiction returns partial. Complete means the swim rule applied and
 * found nothing. Unavailable means no approved fact says the character cannot swim.
 * proposalVersion is the revision round supplied by the caller. bibleVersion stays the bible version.
 */
export async function executeConsistencyCheck(params: {
  proposalId: string;
  proposalVersion: number;
  proposal: RevisedManuscript;
  envelope: ManuscriptEnvelope;
  approvedFacts: Array<{ id: string; text?: string; fact?: string }>;
  bibleVersion: number;
}): Promise<ConsistencyCheckResult> {
  const proposalDigest = hashManuscriptContent(params.proposal);

  if (
    params.envelope.baseVersion !== params.bibleVersion ||
    params.envelope.proposalHash !== proposalDigest
  ) {
    return {
      proposalId: params.proposalId,
      proposalVersion: params.proposalVersion,
      proposalSha256: proposalDigest,
      bibleVersion: params.bibleVersion,
      status: "blocked",
      findings: [],
      unresolvedIssues: [
        "PROPOSAL_VERSION_MISMATCH: Proposal envelope hash or baseVersion does not match.",
      ],
      checkedFactIds: [],
      checkedChapterIndexes: [],
    };
  }

  const checkedFactIds: string[] = [];
  const findings: ConsistencyFinding[] = [];
  const unresolvedIssues: string[] = [];
  const swimFacts = params.approvedFacts.filter((fact) =>
    factSaysCannotSwim(fact.text ?? fact.fact ?? "")
  );

  for (const fact of swimFacts) {
    const factText = fact.text ?? fact.fact ?? "";
    if (!checkedFactIds.includes(fact.id)) checkedFactIds.push(fact.id);
    for (const chapter of params.proposal.chapters) {
      if (!SWIM_ACTION.test(chapter.text)) continue;
      findings.push({
        chapterIndex: chapter.chapterIndex,
        passage: chapter.text.slice(0, 120),
        factId: fact.id,
        severity: "high",
        rationale: `Passage contradicts approved fact ${fact.id} ("${factText}").`,
        suggestedCorrection: "Ensure character remains in boat or on shore.",
      });
      unresolvedIssues.push(
        `Chapter ${chapter.chapterIndex} contradicts Fact ${fact.id}: protagonist cannot swim.`
      );
    }
  }

  const swimRuleApplicable = swimFacts.length > 0;
  const checkedChapterIndexes = swimRuleApplicable
    ? params.proposal.chapters
        .map((chapter) => chapter.chapterIndex)
        .sort((left, right) => left - right)
    : [];

  if (!swimRuleApplicable) {
    unresolvedIssues.push(
      "Swim rule was not applicable: no approved fact says the character cannot swim."
    );
  }

  return {
    proposalId: params.proposalId,
    proposalVersion: params.proposalVersion,
    proposalSha256: proposalDigest,
    bibleVersion: params.bibleVersion,
    status: !swimRuleApplicable
      ? "unavailable"
      : findings.length > 0
        ? "partial"
        : "complete",
    findings,
    unresolvedIssues,
    checkedFactIds,
    checkedChapterIndexes,
  };
}

/**
 * A failed recheck stops the revision before either proposal is written.
 * A result can be invalid even when it carries no rejection record, and that
 * case still stops the cycle so one editor cannot be saved without the other.
 */
function throwIfHandoffRecheckFailed(result: { valid: boolean; rejection?: {
  failedChecks: string[];
  missingItems: string[];
  requestedCorrection: string;
} }): void {
  if (result.valid) return;
  if (result.rejection) throw new EditorialHandoffRejectionError(result.rejection);
  throw new Error(
    "EDITORIAL_HANDOFF_REJECTED: the handoff recheck failed without a rejection record."
  );
}

/**
 * Orchestrates Justin's connected revision cycle (J06).
 * Routes revisions through:
 * 1. Refreshed Reader handoff with decoupled editorial instructions
 * 2. Independent Editor receiving validation (Fontaine & Lang)
 * 3. Model-backed proposal generation with distinct lenses
 * 4. Write barrier (`orderedChapters`) and S04 envelope integrity hashing
 * 5. Exact Consistency checking bound to proposal hashes
 */
export async function executeRevisionCycle(
  input: RevisionCycleInput
): Promise<RevisionCycleResult> {
  if (input.signal?.aborted) {
    throw new DOMException("Operation canceled.", "AbortError");
  }

  // Round 0 is the initial draft. Only rounds 1 and 2 are revisions.
  if (input.revisionRound < (input.readConnection?0:1)) {
    throw new Error("Revision round must be at least 1.");
  }
  if (input.revisionRound > limits.revisionRounds) {
    throw new Error(
      `The two-round revision limit has been reached. Current requested round: ${input.revisionRound}.`
    );
  }
  // Both editors are required. There is no mock-key fallback and no live provider here.
  if (!input.modelA || !input.modelB) {
    throw new Error("Both editorial models are required.");
  }

  const readingA = input.baseChaptersA ?? input.baseChapters;
  const readingB = input.baseChaptersB ?? input.baseChapters;
  const lockedA = input.envelopeBaseChapters ?? readingA;
  const lockedB = input.envelopeBaseChapters ?? readingB;

  orderedChapters(readingA, input.bibleVersion);
  orderedChapters(readingB, input.bibleVersion);
  orderedChapters(lockedA, input.bibleVersion);
  orderedChapters(lockedB, input.bibleVersion);

  const hasAdditionalInstructions =
    input.hasAdditionalInstructions ?? Boolean(input.editorialInstructions.trim());

  // One shared instruction and bible version. Each editor still validates their own chapters.
  let handoff = buildFixtureHandoff(
    input.baseChapters,
    input.bibleVersion,
    input.editorialInstructions,
    input.revisionRound,
    1,
    hasAdditionalInstructions
  );

  if(!input.readConnection){
  const validationA = validateEditorReceivingHandoff({
    handoff,
    expectedRecordedRequest: input.editorialInstructions,
    baseChapters: readingA,
    approvedBibleVersion: input.bibleVersion,
  });

  const validationB = validateEditorReceivingHandoff({
    handoff,
    expectedRecordedRequest: input.editorialInstructions,
    baseChapters: readingB,
    approvedBibleVersion: input.bibleVersion,
  });

  if (!validationA.valid || !validationB.valid) {
    handoff = repairFixtureHandoff(handoff, input.editorialInstructions);
    const recheckA = validateEditorReceivingHandoff({
      handoff,
      expectedRecordedRequest: input.editorialInstructions,
      baseChapters: readingA,
      approvedBibleVersion: input.bibleVersion,
    });
    const recheckB = validateEditorReceivingHandoff({
      handoff,
      expectedRecordedRequest: input.editorialInstructions,
      baseChapters: readingB,
      approvedBibleVersion: input.bibleVersion,
    });
    throwIfHandoffRecheckFailed(recheckA);
    throwIfHandoffRecheckFailed(recheckB);
  }
  }

  const connected=input.readConnection?[
    await input.readConnection.edit("critic_editor_a",readingA,input.modelA),
    await input.readConnection.edit("critic_editor_b",readingB,input.modelB),
  ]:undefined;
  if(connected)handoff=connected[0].handoff;
  const [resA, resB] = connected?connected.map(c=>c.result):await Promise.all([
    generateEditorialProposal(
      {
        role: "critic_editor_a",
        approvedBible: input.approvedBible,
        bibleVersion: input.bibleVersion,
        baseChapters: readingA,
        handoff,
        userEditorialInstructions: input.editorialInstructions,
      },
      input.modelA,
      input.signal
    ),
    generateEditorialProposal(
      {
        role: "critic_editor_b",
        approvedBible: input.approvedBible,
        bibleVersion: input.bibleVersion,
        baseChapters: readingB,
        handoff,
        userEditorialInstructions: input.editorialInstructions,
      },
      input.modelB,
      input.signal
    ),
  ]);

  // 6. Write barrier on generated proposals
  orderedChapters(resA.proposal.chapters, input.bibleVersion);
  orderedChapters(resB.proposal.chapters, input.bibleVersion);

  // 7. S04 Envelopes with SHA-256 binding
  const envelopeA = buildManuscriptEnvelope({
    runId: input.runId,
    baseVersion: input.bibleVersion,
    baseChapters: lockedA,
    draftChapters: input.baseChapters,
    manuscript: resA.proposal,
  });

  const envelopeB = buildManuscriptEnvelope({
    runId: input.runId,
    baseVersion: input.bibleVersion,
    baseChapters: lockedB,
    draftChapters: input.baseChapters,
    manuscript: resB.proposal,
  });

  const manuscriptA: RevisedManuscript = {
    ...resA.proposal,
    envelope: envelopeA,
  };

  const manuscriptB: RevisedManuscript = {
    ...resB.proposal,
    envelope: envelopeB,
  };

  const proposalIdA = input.proposalIds?.[0]??randomUUID();
  const proposalIdB = input.proposalIds?.[1]??randomUUID();

  // 8. Exact Consistency check bound to proposals
  const [consistencyA, consistencyB] = await Promise.all([
    executeConsistencyCheck({
      proposalId: proposalIdA,
      proposalVersion: input.revisionRound,
      proposal: manuscriptA,
      envelope: envelopeA,
      approvedFacts: input.approvedBible.facts,
      bibleVersion: input.bibleVersion,
    }),
    executeConsistencyCheck({
      proposalId: proposalIdB,
      proposalVersion: input.revisionRound,
      proposal: manuscriptB,
      envelope: envelopeB,
      approvedFacts: input.approvedBible.facts,
      bibleVersion: input.bibleVersion,
    }),
  ]);

  const outputA: RevisionProposalOutput = {
    id: proposalIdA,
    kind: "manuscript_a",
    manuscript: manuscriptA,
    envelope: envelopeA,
    consistency: consistencyA,
    usage: resA.usage,
    modelUsed: resA.modelUsed,
  };

  const outputB: RevisionProposalOutput = {
    id: proposalIdB,
    kind: "manuscript_b",
    manuscript: manuscriptB,
    envelope: envelopeB,
    consistency: consistencyB,
    usage: resB.usage,
    modelUsed: resB.modelUsed,
  };

  return {
    runId: input.runId,
    projectId: input.projectId,
    revisionRound: input.revisionRound,
    editorialInstructions: input.editorialInstructions,
    hasAdditionalInstructions,
    handoff,
    proposals: [outputA, outputB],
    unresolvedIssues: [
      ...consistencyA.unresolvedIssues,
      ...consistencyB.unresolvedIssues,
    ],
  };
}
