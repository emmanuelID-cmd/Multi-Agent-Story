import { createHash } from "node:crypto";
import { z } from "zod";
import { chapterSchema, orderedChapters, type Chapter, type Bible, type Brief } from "../../contracts";
import type { ReaderToEditorHandoff } from "../handoff";
import type { WriteModel, WriteAgentRole } from "./model";
export type { WriteModel, WriteAgentRole };
import { getPromptForRole } from "./prompts";

export const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;

/**
 * Tidies mechanical punctuation so stored prose is easier to read.
 * It strips a leading banner such as "[Revised Version A]" or "[Chapter 1]",
 * collapses a doubled period, and leaves initials like "U.S.A." intact.
 * A fragment such as "With disciplined precision, ." is kept as written so an
 * editorial check can still see that the sentence was not finished.
 */
export function cleanProseTypography(text: string): string {
  if (!text) return "";
  let cleaned = text;

  // Drop a leading revision banner before other rules, including "[Revised Version A]".
  cleaned = cleaned.replace(/^\[Revised Version[^\]]*\]\s*/i, "");
  cleaned = cleaned.replace(/^\[(Revised\s*[A-Z]?|Chapter\s*\d+)\]\s*/i, "");

  // Remove a space that sits right before punctuation, but keep "comma, space, period".
  cleaned = cleaned.replace(/(?<!,)\s+([,.:;?!])/g, "$1");

  // Collapse a comma glued to a period. Do not turn "precision, ." into a finished sentence.
  cleaned = cleaned.replace(/,\.(?!\.)/g, ".");
  cleaned = cleaned.replace(/\.\s*,/g, ".");

  cleaned = cleaned.replace(/[;:]\s*\./g, ".");
  cleaned = cleaned.replace(/,,+/g, ",");
  cleaned = cleaned.replace(/\.{4,}/g, "...");
  cleaned = cleaned.replace(/(?<!\.)\.\.(?!\.)/g, ".");
  cleaned = cleaned.replace(/([!?])\s*\./g, "$1");

  // Add a missing space after punctuation, but not inside initials such as "U.S.A.".
  cleaned = cleaned.replace(/(?<![A-Z])\.([A-Z])/g, ". $1");
  cleaned = cleaned.replace(/([?!])([A-Z])/g, "$1 $2");

  return cleaned.trim();
}

export function hashChapterText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashManuscriptContent(manuscript: {
  kind: string;
  editorialLens: string;
  rationale: string;
  chapters: Array<{ chapterIndex: number; bibleVersion: number; text: string }>;
  changesMade: Array<{ chapterIndex: number; summary: string; justification: string }>;
}): string {
  const normalized = JSON.stringify({
    kind: manuscript.kind,
    editorialLens: manuscript.editorialLens,
    rationale: manuscript.rationale,
    chapters: manuscript.chapters
      .slice()
      .sort((a, b) => a.chapterIndex - b.chapterIndex)
      .map((c) => ({
        chapterIndex: c.chapterIndex,
        bibleVersion: c.bibleVersion,
        text: c.text,
      })),
    // Sort the change list before hashing so the same edits in a different order still match.
    changesMade: manuscript.changesMade
      .slice()
      .sort(
        (left, right) =>
          left.chapterIndex - right.chapterIndex || left.summary.localeCompare(right.summary)
      )
      .map((ch) => ({
        chapterIndex: ch.chapterIndex,
        summary: ch.summary,
        justification: ch.justification,
      })),
  });
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export const manuscriptEnvelopeSchema = z.object({
  envelopeVersion: z.literal(1),
  runId: z.string().min(1),
  baseVersion: z.number().int().positive(),
  proposalHash: z.string().regex(SHA256_HEX_REGEX),
  sourceChapterHashes: z
    .array(
      z.object({
        chapterIndex: z.number().int().min(1).max(3),
        bibleVersion: z.number().int().positive(),
        sha256: z.string().regex(SHA256_HEX_REGEX),
      })
    )
    .length(3),
  // The chapters the editor actually read. Round 2 can differ from the one draft stored on the run.
  sourceChapters: z
    .array(
      z.object({
        chapterIndex: z.number().int().min(1).max(3),
        bibleVersion: z.number().int().positive(),
        text: z.string().min(1),
      })
    )
    .length(3)
    .optional(),
  // Hashes of the single chapter copy saved on the run, when that copy is not the editor's source.
  draftChapterHashes: z
    .array(
      z.object({
        chapterIndex: z.number().int().min(1).max(3),
        bibleVersion: z.number().int().positive(),
        sha256: z.string().regex(SHA256_HEX_REGEX),
      })
    )
    .length(3)
    .optional(),
});

export type ManuscriptEnvelope = z.infer<typeof manuscriptEnvelopeSchema>;

export const revisedManuscriptSchema = z.object({
  kind: z.enum(["manuscript_a", "manuscript_b"]),
  editorialLens: z.enum(["continuity_and_pacing", "voice_and_atmosphere"]),
  rationale: z.string().min(1).max(5000),
  chapters: z.array(chapterSchema).length(3),
  changesMade: z.array(
    z.object({
      chapterIndex: z.number().int().min(1).max(3),
      summary: z.string().min(1).max(1000),
      justification: z.string().min(1).max(1000),
    })
  ).min(1),
  envelope: manuscriptEnvelopeSchema.optional(),
});

export type RevisedManuscript = z.infer<typeof revisedManuscriptSchema>;

export function buildManuscriptEnvelope(params: {
  runId: string;
  baseVersion: number;
  baseChapters: Chapter[];
  manuscript: RevisedManuscript;
  /** The one chapter copy stored on the run, when it is not the text the editor revised. */
  draftChapters?: Chapter[];
}): ManuscriptEnvelope {
  const sortedBase = params.baseChapters.slice().sort((a, b) => a.chapterIndex - b.chapterIndex);
  const sourceChapterHashes = sortedBase.map((c) => ({
    chapterIndex: c.chapterIndex,
    bibleVersion: c.bibleVersion,
    sha256: hashChapterText(c.text),
  }));
  const sourceChapters = sortedBase.map((c) => ({
    chapterIndex: c.chapterIndex,
    bibleVersion: c.bibleVersion,
    text: c.text,
  }));

  const proposalHash = hashManuscriptContent(params.manuscript);
  const draftChapterHashes = params.draftChapters
    ? params.draftChapters
        .slice()
        .sort((a, b) => a.chapterIndex - b.chapterIndex)
        .map((c) => ({
          chapterIndex: c.chapterIndex,
          bibleVersion: c.bibleVersion,
          sha256: hashChapterText(c.text),
        }))
    : undefined;

  return {
    envelopeVersion: 1,
    runId: params.runId,
    baseVersion: params.baseVersion,
    proposalHash,
    sourceChapterHashes,
    sourceChapters,
    ...(draftChapterHashes ? { draftChapterHashes } : {}),
  };
}

export function verifyManuscriptEnvelope(params: {
  envelope: ManuscriptEnvelope;
  storedChapters: Chapter[];
  manuscript: RevisedManuscript;
  expectedBaseVersion: number;
}): { valid: boolean; error?: string } {
  if (params.envelope.envelopeVersion !== 1) {
    return { valid: false, error: "Unsupported envelope version." };
  }

  if (params.envelope.baseVersion !== params.expectedBaseVersion) {
    return {
      valid: false,
      error: `Envelope baseVersion (${params.envelope.baseVersion}) does not match expected version (${params.expectedBaseVersion}).`,
    };
  }

  const expectedProposalHash = hashManuscriptContent(params.manuscript);
  if (params.envelope.proposalHash !== expectedProposalHash) {
    return { valid: false, error: "Proposal content hash mismatch (tampered manuscript)." };
  }

  if (params.storedChapters.length !== 3) {
    return { valid: false, error: "Stored source chapters count is not 3." };
  }

  const sortedStored = params.storedChapters.slice().sort((a, b) => a.chapterIndex - b.chapterIndex);
  const sourceHashes = Array.isArray(params.envelope.sourceChapterHashes)
    ? params.envelope.sourceChapterHashes
    : [];
  const recordedSource = params.envelope.sourceChapters;
  if (recordedSource?.length) {
    for (const source of recordedSource) {
      const sourceRef = sourceHashes.find((entry) => entry?.chapterIndex === source.chapterIndex);
      if (!sourceRef) {
        return { valid: false, error: `Source hash entry missing for chapter ${source.chapterIndex}.` };
      }
      if (hashChapterText(source.text) !== sourceRef.sha256) {
        return { valid: false, error: `Recorded source chapter ${source.chapterIndex} does not match its hash.` };
      }
    }
  }

  // When the editor read a different copy than the one row stored for this run,
  // the draft hashes are the rows. Otherwise the stored rows are the source.
  const rowHashes = params.envelope.draftChapterHashes?.length
    ? params.envelope.draftChapterHashes
    : sourceHashes;
  for (let i = 0; i < sortedStored.length; i++) {
    const stored = sortedStored[i];
    const sourceRef = rowHashes.find((entry) => entry?.chapterIndex === stored.chapterIndex);
    // A missing hash entry fails the check. It must not throw and accidentally look valid.
    if (!sourceRef) {
      return { valid: false, error: `Source hash entry missing for chapter ${stored.chapterIndex}.` };
    }
    if (stored.chapterIndex !== sourceRef.chapterIndex) {
      return { valid: false, error: `Chapter index mismatch for source chapter ${i + 1}.` };
    }
    if (stored.bibleVersion !== sourceRef.bibleVersion) {
      return { valid: false, error: `Bible version mismatch for source chapter ${i + 1}.` };
    }
    const computedHash = hashChapterText(stored.text);
    if (computedHash !== sourceRef.sha256) {
      return { valid: false, error: `Source chapter ${stored.chapterIndex} text hash mismatch.` };
    }
  }

  return { valid: true };
}

export const chapterProseWireSchema = z.object({
  text: z.string().min(1).max(20000),
});

export const revisedProposalWireSchema = z.object({
  rationale: z.string().min(1).max(5000),
  chapters: z.array(
    z.object({
      chapterIndex: z.number().int().min(1).max(3),
      text: z.string().min(1).max(20000),
    })
  ).length(3),
  changesMade: z.array(
    z.object({
      chapterIndex: z.number().int().min(1).max(3),
      summary: z.string().min(1).max(1000),
      justification: z.string().min(1).max(1000),
    })
  ).min(1),
});

/**
 * Reads the choices the writer already confirmed on the saved intake.
 * Chapter writers and editors both receive this same list, beside the short premise, audience, genre, tone, and ending.
 * A story with no confirmed intake sends an empty list, so older projects keep working.
 * Leave every kind of choice in this one list. Do not add a separate rule for language, relationships, or any other single detail.
 */
export function confirmedDimensionsFromBrief(brief?: Brief): Array<{ field: string; value: string }> {
  const dimensions = brief?.intake?.status === "confirmed" ? brief.intake.confirmed?.scope.dimensions ?? [] : [];
  return dimensions
    .filter(item => item.value.trim().length > 0)
    .map(item => ({ field: item.field, value: item.value }));
}

export interface GenerateChapterInput {
  chapterIndex: 1 | 2 | 3;
  bibleVersion: number;
  approvedBible: Bible;
  brief?: Brief;
  precedingChapters?: Chapter[];
}

export interface GenerateChapterResult {
  chapter: Chapter;
  usage: { inputTokens: number; outputTokens: number };
  modelUsed: string;
}

export interface GenerateEditorialProposalInput {
  role: "critic_editor_a" | "critic_editor_b";
  bibleVersion: number;
  approvedBible: Bible;
  baseChapters: Chapter[];
  handoff?: ReaderToEditorHandoff;
  userEditorialInstructions?: string;
  /** Saved story brief. Confirmed intake choices are copied onto the editorial payload. */
  brief?: Brief;
}

export interface GenerateEditorialProposalResult {
  proposal: RevisedManuscript;
  usage: { inputTokens: number; outputTokens: number };
  modelUsed: string;
}

/**
 * Generate a single chapter using the assigned model-backed Chapter Writer
 * (chapter_writer_1: Grimm, chapter_writer_2: Andersen, chapter_writer_3: Perrault).
 */
export async function generateChapterProse(
  input: GenerateChapterInput,
  model: WriteModel,
  signal: AbortSignal = new AbortController().signal
): Promise<GenerateChapterResult> {
  const role: WriteAgentRole = `chapter_writer_${input.chapterIndex}` as WriteAgentRole;
  const { alias, systemPrompt } = getPromptForRole(role);

  const assignedBeat = input.approvedBible.beats.find(
    (b) => b.chapterIndex === input.chapterIndex
  );
  if (!assignedBeat) {
    throw new Error(`Missing beat for chapter index ${input.chapterIndex} in approved bible.`);
  }

  // Assemble context for the writer
  const payload = {
    role,
    alias,
    chapterIndex: input.chapterIndex,
    bibleVersion: input.bibleVersion,
    assignedBeat: assignedBeat.text,
    approvedFacts: input.approvedBible.facts,
    brief: input.brief
      ? {
          premise: input.brief.premise,
          audience: input.brief.audience,
          genre: input.brief.genre,
          tone: input.brief.tone,
          desiredEnding: input.brief.desiredEnding,
        }
      : undefined,
    confirmedDimensions: confirmedDimensionsFromBrief(input.brief),
    precedingChapters: input.precedingChapters
      ? input.precedingChapters
          .filter((c) => c.chapterIndex < input.chapterIndex)
          .sort((a, b) => a.chapterIndex - b.chapterIndex)
          .map((c) => ({
            chapterIndex: c.chapterIndex,
            text: c.text,
          }))
      : undefined,
  };

  const response = await model.complete({
    role,
    system: systemPrompt,
    data: payload,
    schema: chapterProseWireSchema,
    signal,
  });

  const parsed = chapterProseWireSchema.parse(response.value);

  // Authoritatively construct the Chapter record bound to the exact input bibleVersion
  const chapterRecord = chapterSchema.parse({
    chapterIndex: input.chapterIndex,
    bibleVersion: input.bibleVersion,
    text: cleanProseTypography(parsed.text),
  });

  return {
    chapter: chapterRecord,
    usage: response.usage,
    modelUsed: response.modelUsed,
  };
}

/**
 * Generate a 3-chapter manuscript revision proposal using the assigned Critic/Editor
 * (critic_editor_a: Fontaine, critic_editor_b: Lang).
 */
export async function generateEditorialProposal(
  input: GenerateEditorialProposalInput,
  model: WriteModel,
  signal: AbortSignal = new AbortController().signal
): Promise<GenerateEditorialProposalResult> {
  const { alias, systemPrompt, lens } = getPromptForRole(input.role);

  if (input.baseChapters.length !== 3) {
    throw new Error("Exactly 3 contiguous base chapters are required for editorial proposal.");
  }

  const kind = input.role === "critic_editor_a" ? "manuscript_a" : "manuscript_b";
  const editorialLens = lens ?? (input.role === "critic_editor_a" ? "continuity_and_pacing" : "voice_and_atmosphere");

  const payload = {
    role: input.role,
    alias,
    kind,
    editorialLens,
    bibleVersion: input.bibleVersion,
    approvedFacts: input.approvedBible.facts,
    confirmedDimensions: confirmedDimensionsFromBrief(input.brief),
    baseChapters: input.baseChapters.map((c) => ({
      chapterIndex: c.chapterIndex,
      text: c.text,
    })),
    readerHandoff: input.handoff,
    userEditorialInstructions: input.userEditorialInstructions ?? "",
  };

  const response = await model.complete({
    role: input.role,
    system: systemPrompt,
    data: payload,
    schema: revisedProposalWireSchema,
    signal,
  });

  const wireResult = revisedProposalWireSchema.parse(response.value);

  // Bind the chapters authoritatively to the base bibleVersion and validate
  const rawChapters: Chapter[] = wireResult.chapters
    .map((c) =>
      chapterSchema.parse({
        chapterIndex: c.chapterIndex,
        bibleVersion: input.bibleVersion,
        text: cleanProseTypography(c.text),
      })
    );

  // Pass through orderedChapters write barrier to enforce [1, 2, 3] uniqueness and sorting
  const revisedChapters = orderedChapters(rawChapters, input.bibleVersion);

  const proposal = revisedManuscriptSchema.parse({
    kind,
    editorialLens,
    rationale: wireResult.rationale,
    chapters: revisedChapters,
    changesMade: wireResult.changesMade,
  });

  return {
    proposal,
    usage: response.usage,
    modelUsed: response.modelUsed,
  };
}
