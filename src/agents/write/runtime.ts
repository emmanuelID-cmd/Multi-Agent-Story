import { createHash } from "node:crypto";
import { z } from "zod";
import { chapterSchema, orderedChapters, type Chapter, type Bible, type Brief } from "../../contracts";
import type { ReaderToEditorHandoff } from "../handoff";
import type { WriteModel, WriteAgentRole } from "./model";
export type { WriteModel, WriteAgentRole };
import { getPromptForRole } from "./prompts";

export const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;

/**
 * Normalizes mechanical typographical and punctuation collisions in narrative prose:
 * - Collapses accidental double periods '..' (not 3-dot ellipses) into '.'
 * - Replaces excessive periods (4 or more) with '...'
 * - Removes whitespace immediately preceding punctuation marks
 * - Resolves comma-period collisions (',.' or '.,' -> '.')
 * - Resolves semicolon/colon-period collisions (';.' or ':.' -> '.')
 * - Normalizes duplicate commas (',,' -> ',')
 * - Strips duplicate terminal marks (e.g. '!.' or '?.' -> '!' or '?')
 * - Strips leading bracketed version tags (e.g. '[Revised A]' or '[Chapter 1]')
 * Preserves intentional three-dot ellipses ('...') and dialogue styling.
 */
export function cleanProseTypography(text: string): string {
  if (!text) return "";
  let cleaned = text;

  // 1. Remove spaces immediately before punctuation: "word ." -> "word."
  cleaned = cleaned.replace(/\s+([,.:;?!])/g, "$1");

  // 2. Fix comma-period collisions: ",." or ".," -> "."
  cleaned = cleaned.replace(/,\s*\./g, ".").replace(/\.\s*,/g, ".");

  // 3. Fix semicolon/colon-period collisions: ";." or ":." -> "."
  cleaned = cleaned.replace(/[;:]\s*\./g, ".");

  // 4. Fix duplicate commas: ",," -> ","
  cleaned = cleaned.replace(/,,+/g, ",");

  // 5. Fix excessive periods (4 or more) into standard 3-dot ellipsis: "...." -> "..."
  cleaned = cleaned.replace(/\.{4,}/g, "...");

  // 6. Fix accidental double periods (strictly 2 dots, not part of 3-dot ellipsis)
  cleaned = cleaned.replace(/(?<!\.)\.\.(?!\.)/g, ".");

  // 7. Fix exclamation/question marks followed by periods: "!." -> "!" and "?." -> "?"
  cleaned = cleaned.replace(/([!?])\s*\./g, "$1");

  // 8. Ensure single whitespace after terminal punctuation when immediately preceding a capitalized word
  cleaned = cleaned.replace(/([.?!])([A-Z])/g, "$1 $2");

  // 9. Strip leading bracketed tags (e.g., "[Revised A] " or "[Chapter 1] ")
  cleaned = cleaned.replace(/^\[(Revised\s*[A-Z]?|Chapter\s*\d+)\]\s*/i, "");

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
    changesMade: manuscript.changesMade.map((ch) => ({
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
}): ManuscriptEnvelope {
  const sortedBase = params.baseChapters.slice().sort((a, b) => a.chapterIndex - b.chapterIndex);
  const sourceChapterHashes = sortedBase.map((c) => ({
    chapterIndex: c.chapterIndex,
    bibleVersion: c.bibleVersion,
    sha256: hashChapterText(c.text),
  }));

  const proposalHash = hashManuscriptContent(params.manuscript);

  return {
    envelopeVersion: 1,
    runId: params.runId,
    baseVersion: params.baseVersion,
    proposalHash,
    sourceChapterHashes,
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
  for (let i = 0; i < 3; i++) {
    const stored = sortedStored[i];
    const sourceRef = params.envelope.sourceChapterHashes[i];
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
    baseChapters: input.baseChapters.map((c) => ({
      chapterIndex: c.chapterIndex,
      text: c.text,
    })),
    readerHandoff: input.handoff,
    userEditorialInstructions: input.userEditorialInstructions || "Polish legibility, flow, and apply your distinct lens.",
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
