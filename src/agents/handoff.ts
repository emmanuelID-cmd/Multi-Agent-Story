import { z } from "zod";
import { chapterIndex, type Chapter } from "../contracts";

export const handoffTaskSchema = z.object({
  taskId: z.string().min(1),
  action: z.enum(["critique", "revise"]),
  scope: z.array(chapterIndex).min(1).max(3),
  expectedOutput: z.string().min(1),
});

export const handoffInstructionsSchema = z.object({
  recordedRequest: z.string().max(2000),
  revision: z.number().int().nonnegative(),
  hasAdditionalInstructions: z.boolean(),
});

export const handoffSourceRefSchema = z.object({
  sourceId: z.string().min(1),
  version: z.number().int().positive(),
  locator: z.string().min(1),
  status: z.enum(["available", "unavailable"]),
});

export const handoffCompletenessSchema = z.object({
  isComplete: z.boolean(),
  missingItems: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  uncertaintyReason: z.string().optional(),
});

export const handoffVersionSchema = z.object({
  schemaVersion: z.literal(1),
  handoffRevision: z.number().int().positive(),
  bibleVersion: z.number().int().positive(),
  draftVersion: z.number().int().positive(),
});

export const readerToEditorHandoffSchema = z.object({
  task: handoffTaskSchema,
  userInstructions: handoffInstructionsSchema,
  sourceReferences: z.array(handoffSourceRefSchema).min(1),
  completeness: handoffCompletenessSchema,
  version: handoffVersionSchema,
});

export type ReaderToEditorHandoff = z.infer<typeof readerToEditorHandoffSchema>;

export interface HandoffValidationResult {
  valid: boolean;
  rejection?: {
    failedChecks: string[];
    missingItems: string[];
    requestedCorrection: string;
  };
}

/**
 * Validates the five required fields of the Reader-to-Editor handoff.
 * Verifies that the recordedRequest strictly matches the coordinator's recorded user request,
 * and ensures untrusted text / embedded commands cannot elevate into user authority.
 */
export function validateHandoff(
  handoff: unknown,
  expectedRecordedRequest: string
): HandoffValidationResult {
  const parsed = readerToEditorHandoffSchema.safeParse(handoff);
  if (!parsed.success) {
    const missing = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
    return {
      valid: false,
      rejection: {
        failedChecks: ["SCHEMA_CONFORMANCE_FAILED"],
        missingItems: missing,
        requestedCorrection: "Supply all five required fields matching the v2 handoff schema.",
      },
    };
  }

  const data = parsed.data;
  const failedChecks: string[] = [];
  const missingItems: string[] = [];

  // Authority boundary: the handoff's user instructions must match the coordinator's recorded user request
  if (data.userInstructions.recordedRequest !== expectedRecordedRequest) {
    failedChecks.push("USER_INSTRUCTION_MISMATCH");
    missingItems.push("User instructions must match coordinator recorded request exactly.");
  }

  // Completeness check
  if (!data.completeness.isComplete) {
    failedChecks.push("INCOMPLETE_HANDOFF_COVERAGE");
    missingItems.push(...data.completeness.missingItems);
  }

  // Source references check: must cover all required chapters
  const availableLocators = new Set(
    data.sourceReferences.filter(r => r.status === "available").map(r => r.locator)
  );
  for (const idx of data.task.scope) {
    if (!availableLocators.has(`chapter_${idx}`)) {
      failedChecks.push("MISSING_REQUIRED_SOURCE_CHAPTER");
      missingItems.push(`chapter_${idx}`);
    }
  }

  if (failedChecks.length > 0) {
    return {
      valid: false,
      rejection: {
        failedChecks,
        missingItems,
        requestedCorrection: "Re-read assigned sources and provide verified references matching recorded authority.",
      },
    };
  }

  return { valid: true };
}

/**
 * Shell for Reader's five-field handoff creation.
 * Deterministically constructs a valid handoff from assembled chapters and approved bible version.
 */
export function buildFixtureHandoff(
  chapters: Chapter[],
  bibleVersion: number,
  recordedRequest: string,
  revisionRound = 0,
  handoffRevision = 1
): ReaderToEditorHandoff {
  return {
    task: {
      taskId: `editorial-task-v${bibleVersion}`,
      action: "revise",
      scope: [1, 2, 3],
      expectedOutput: "Two full 3-chapter manuscript proposals with distinct editorial lenses.",
    },
    userInstructions: {
      recordedRequest,
      revision: revisionRound,
      hasAdditionalInstructions: false,
    },
    sourceReferences: chapters.map(c => ({
      sourceId: `chapter-${c.chapterIndex}-v${c.bibleVersion}`,
      version: c.bibleVersion,
      locator: `chapter_${c.chapterIndex}`,
      status: "available" as const,
    })),
    completeness: {
      isComplete: true,
      missingItems: [],
      confidence: 1.0,
    },
    version: {
      schemaVersion: 1,
      handoffRevision,
      bibleVersion,
      draftVersion: 1,
    },
  };
}

/**
 * Shell for Reader's bounded repair.
 * Returns one repaired handoff revision when requested; cannot loop infinitely.
 * Does not claim isComplete: true if any required chapter reference is missing.
 */
export function repairFixtureHandoff(
  rejectedHandoff: ReaderToEditorHandoff,
  recordedRequest: string
): ReaderToEditorHandoff {
  const availableLocators = new Set(
    rejectedHandoff.sourceReferences.filter(r => r.status === "available").map(r => r.locator)
  );
  const hasAllChapters = rejectedHandoff.task.scope.every(idx => availableLocators.has(`chapter_${idx}`));

  return {
    ...rejectedHandoff,
    userInstructions: {
      ...rejectedHandoff.userInstructions,
      recordedRequest,
    },
    completeness: {
      ...rejectedHandoff.completeness,
      isComplete: hasAllChapters,
      missingItems: hasAllChapters ? [] : rejectedHandoff.completeness.missingItems,
      confidence: hasAllChapters ? 1.0 : 0.5,
    },
    version: {
      ...rejectedHandoff.version,
      handoffRevision: rejectedHandoff.version.handoffRevision + 1,
    },
  };
}
