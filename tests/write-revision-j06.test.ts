import { describe, expect, it, vi } from "vitest";
import { orderedChapters, type Chapter, type Bible } from "../src/contracts";
import {
  executeRevisionCycle,
  executeConsistencyCheck,
} from "../src/agents/write/revision";
import {
  verifyManuscriptEnvelope,
  type RevisedManuscript,
} from "../src/agents/write/runtime";
import type { WriteModel, WriteModelCall } from "../src/agents/write/model";
import { rewriteRun, startRun, approveManuscriptProposal, AppError } from "../src/server/projects";
import { db } from "../src/server/db";
import { projects, bibles, runs, tasks, proposals, critiques } from "../src/server/db/schema";
import { and, eq } from "drizzle-orm";

const mockBible: Bible = {
  facts: [
    { id: "F1", text: "Mara cannot swim and avoids deep water unless safely aboard a boat." },
    { id: "F2", text: "The blue beacon pulses every three minutes on the dot." },
  ],
  beats: [
    { chapterIndex: 1, text: "Mara spots the erratic blue pulse and prepares the skiff." },
    { chapterIndex: 2, text: "Mara rows through the breakers toward the outer reef." },
    { chapterIndex: 3, text: "Mara reaches the breakwater and rescues the stranded keeper." },
  ],
};

const baseChapters: Chapter[] = [
  {
    chapterIndex: 1,
    bibleVersion: 1,
    text: "Mara watched the blue pulse from the lighthouse glass. Mindful that she could not swim, she readied the skiff.",
  },
  {
    chapterIndex: 2,
    bibleVersion: 1,
    text: "From the steady skiff, Mara closed the distance to the breakwater rocks where the shuttered lantern pulsed.",
  },
  {
    chapterIndex: 3,
    bibleVersion: 1,
    text: "Pulling the drenched sailor aboard, Mara maneuvered the skiff back through the surf toward the harbor.",
  },
];

function createMockEditorModel(): WriteModel {
  return {
    async complete(call: WriteModelCall) {
      const role = call.role;
      const isA = role === "critic_editor_a";
      return {
        value: {
          rationale: isA
            ? "Tightened causal continuity and clarified boat navigation."
            : "Enhanced coastal fog, salt spray texture, and nautical atmosphere.",
          chapters: [
            {
              chapterIndex: 1,
              text: isA
                ? "[Revised A] Mara observed the lantern signal and readied the skiff with steady precision."
                : "[Revised B] Salt spray lashed the granite tower as the blue pulse cut through damp twilight.",
            },
            {
              chapterIndex: 2,
              text: isA
                ? "[Revised A] Guiding the boat through the breakers, she kept careful distance from the reef."
                : "[Revised B] The dark swells surged beneath the wooden hull, groaning in rhythm with the tide.",
            },
            {
              chapterIndex: 3,
              text: isA
                ? "[Revised A] Securing the survivor in the skiff, she turned the craft safely toward shore."
                : "[Revised B] Amber harbor lanterns welcomed them through the mist, safe from the grasping deep.",
            },
          ],
          changesMade: [
            {
              chapterIndex: 2,
              summary: isA ? "Reinforced boat maneuvering." : "Heightened atmospheric texture.",
              justification: isA ? "Adheres to Fact F1." : "Enhances sensory immersion.",
            },
          ],
        },
        usage: { inputTokens: 450, outputTokens: 380 },
        modelUsed: "claude-3-5-sonnet-20241022",
      };
    },
  };
}

describe("J06 — Connected Revision Cycle Integration", () => {
  it("executes Round 1 revision with refreshed Reader handoff and dual editor proposals", async () => {
    const model = createMockEditorModel();
    const result = await executeRevisionCycle({
      runId: "run-rev-1",
      projectId: "proj-1",
      bibleVersion: 1,
      approvedBible: mockBible,
      baseChapters,
      revisionRound: 1,
      editorialInstructions: "Focus on tension during the crossing and ensure Mara stays inside the boat.",
      hasAdditionalInstructions: true,
      modelA: model,
      modelB: model,
    });

    expect(result.revisionRound).toBe(1);
    expect(result.editorialInstructions).toBe(
      "Focus on tension during the crossing and ensure Mara stays inside the boat."
    );
    expect(result.hasAdditionalInstructions).toBe(true);
    expect(result.handoff.task.action).toBe("revise");
    expect(result.handoff.userInstructions.recordedRequest).toBe(
      "Focus on tension during the crossing and ensure Mara stays inside the boat."
    );
    expect(result.handoff.userInstructions.revision).toBe(1);
    expect(result.handoff.userInstructions.hasAdditionalInstructions).toBe(true);

    const [propA, propB] = result.proposals;
    expect(propA.kind).toBe("manuscript_a");
    expect(propA.manuscript.editorialLens).toBe("continuity_and_pacing");
    expect(propB.kind).toBe("manuscript_b");
    expect(propB.manuscript.editorialLens).toBe("voice_and_atmosphere");

    // S04 Envelope verification
    const envVerifyA = verifyManuscriptEnvelope({
      envelope: propA.envelope,
      storedChapters: baseChapters,
      manuscript: propA.manuscript,
      expectedBaseVersion: 1,
    });
    expect(envVerifyA.valid).toBe(true);

    const envVerifyB = verifyManuscriptEnvelope({
      envelope: propB.envelope,
      storedChapters: baseChapters,
      manuscript: propB.manuscript,
      expectedBaseVersion: 1,
    });
    expect(envVerifyB.valid).toBe(true);

    // Consistency check verification
    expect(propA.consistency.status).toBe("complete");
    expect(propA.consistency.checkedFactIds).toEqual(["F1", "F2"]);
    expect(propA.consistency.checkedChapterIndexes).toEqual([1, 2, 3]);
    expect(propA.consistency.findings).toHaveLength(0);

    expect(propB.consistency.status).toBe("complete");
    expect(propB.consistency.checkedFactIds).toEqual(["F1", "F2"]);
    expect(propB.consistency.checkedChapterIndexes).toEqual([1, 2, 3]);
  });

  it("enforces two-round cap: Round 2 succeeds, Round 3 throws limit error", async () => {
    const model = createMockEditorModel();

    // Round 2 is permitted
    const res2 = await executeRevisionCycle({
      runId: "run-rev-2",
      projectId: "proj-1",
      bibleVersion: 1,
      approvedBible: mockBible,
      baseChapters,
      revisionRound: 2,
      editorialInstructions: "Final polish of Chapter 3.",
      modelA: model,
      modelB: model,
    });
    expect(res2.revisionRound).toBe(2);

    // Round 3 is rejected
    await expect(
      executeRevisionCycle({
        runId: "run-rev-3",
        projectId: "proj-1",
        bibleVersion: 1,
        approvedBible: mockBible,
        baseChapters,
        revisionRound: 3,
        editorialInstructions: "Attempting a third revision round.",
        modelA: model,
        modelB: model,
      })
    ).rejects.toThrow("The two-round revision limit has been reached.");
  });

  it("consistency check detects contradictions against approved facts", async () => {
    const contradictingManuscript: RevisedManuscript = {
      kind: "manuscript_a",
      editorialLens: "continuity_and_pacing",
      rationale: "Deliberate test contradiction.",
      chapters: [
        { chapterIndex: 1, bibleVersion: 1, text: "Mara stood on the dock." },
        {
          chapterIndex: 2,
          bibleVersion: 1,
          text: "Mara swam across the churning channel toward the lantern. She ignored the boat.",
        },
        { chapterIndex: 3, bibleVersion: 1, text: "Mara hauled the sailor ashore." },
      ],
      changesMade: [{ chapterIndex: 2, summary: "Contradiction edit", justification: "Test" }],
    };

    const envelope = {
      envelopeVersion: 1 as const,
      runId: "test-run",
      baseVersion: 1,
      proposalHash: "mock-hash",
      sourceChapterHashes: [
        { chapterIndex: 1, bibleVersion: 1, sha256: "0".repeat(64) },
        { chapterIndex: 2, bibleVersion: 1, sha256: "0".repeat(64) },
        { chapterIndex: 3, bibleVersion: 1, sha256: "0".repeat(64) },
      ],
    };

    // If envelope hash doesn't match manuscript content, Consistency blocks with PROPOSAL_VERSION_MISMATCH
    const mismatch = await executeConsistencyCheck({
      proposalId: "p-mismatch",
      proposalVersion: 1,
      proposal: contradictingManuscript,
      envelope,
      approvedFacts: mockBible.facts,
      bibleVersion: 1,
    });
    expect(mismatch.status).toBe("blocked");
    expect(mismatch.unresolvedIssues[0]).toContain("PROPOSAL_VERSION_MISMATCH");

    // With matching hash, Consistency analyzes chapters and flags Fact F1 violation
    const validEnvelope = {
      ...envelope,
      proposalHash: (await import("../src/agents/write/runtime")).hashManuscriptContent(
        contradictingManuscript
      ),
    };
    const flagged = await executeConsistencyCheck({
      proposalId: "p-flagged",
      proposalVersion: 1,
      proposal: contradictingManuscript,
      envelope: validEnvelope,
      approvedFacts: mockBible.facts,
      bibleVersion: 1,
    });

    expect(flagged.status).toBe("complete");
    expect(flagged.findings).toHaveLength(1);
    expect(flagged.findings[0].factId).toBe("F1");
    expect(flagged.findings[0].severity).toBe("high");
    expect(flagged.findings[0].rationale).toContain("Mara cannot swim");
    expect(flagged.unresolvedIssues[0]).toContain("contradicts Fact F1");
  });

  it("server rewriteRun maintains separate editorial instructions and enforces 2-round cap", async () => {
    const ownerId = "test-writer-j06";
    const projectId = "proj-rewrite-test";

    const store = {
      projects: [
        {
          id: projectId,
          ownerId,
          version: 1,
          brief: {
            premise: "Mara keeps watch at the lighthouse.",
            audience: "Adult",
            genre: "Mystery",
            tone: "Suspenseful",
            desiredEnding: "A safe return by harbor boat.",
          },
        },
      ],
      bibles: [
        {
          id: "bible-rewrite-1",
          projectId,
          version: 1,
          data: mockBible,
        },
      ],
      runs: [
        {
          id: "run-round-0",
          projectId,
          bibleId: "bible-rewrite-1",
          fixture: "default",
          status: "completed",
          createdAt: new Date(),
        },
      ],
      critiques: [
        {
          id: "critique-r0",
          runId: "run-round-0",
          data: { revisionRounds: 0 },
        },
      ],
      tasks: [1, 2, 3].map((chapterIndex) => ({
        id: `task-r0-${chapterIndex}`,
        runId: "run-round-0",
        chapterIndex,
        status: "completed",
        savedInput: {
          bible: mockBible,
          version: 1,
          brief: {
            premise: "Mara keeps watch at the lighthouse.",
            desiredEnding: "A safe return by harbor boat.",
          },
          revisionRound: 0,
          editorialInstructions: "Initial draft generation",
          hasAdditionalInstructions: false,
        },
      })),
      proposals: [] as any[],
    };

    // Mock top-level db.select
    vi.spyOn(db, "select").mockImplementation(() => ({
      from: (table: any) => ({
        where: () => {
          let rows: any[] = [];
          if (table === projects) rows = store.projects;
          else if (table === runs) rows = store.runs;
          else if (table === critiques) rows = store.critiques;
          else if (table === tasks) rows = store.tasks;
          else if (table === bibles) rows = store.bibles;
          else if (table === proposals) rows = store.proposals;

          const p = Promise.resolve(rows);
          return Object.assign(p, {
            orderBy: () => Object.assign(Promise.resolve(rows), {
              limit: (n: number) => Promise.resolve(rows.slice(0, n)),
            }),
            limit: (n: number) => Promise.resolve(rows.slice(0, n)),
          });
        },
      }),
    }) as any);

    // Mock db.transaction
    vi.spyOn(db, "transaction").mockImplementation(async (callback: any) => {
      const tx = {
        select: () => ({
          from: (table: any) => ({
            where: () => {
              let rows: any[] = [];
              if (table === projects) rows = store.projects;
              else if (table === runs) rows = store.runs;
              else if (table === bibles) rows = store.bibles;
              else if (table === tasks) rows = store.tasks;
              else if (table === proposals) rows = store.proposals;

              const p = Promise.resolve(rows);
              return Object.assign(p, {
                for: () => Promise.resolve(rows),
                limit: (n: number) => Promise.resolve(rows.slice(0, n)),
              });
            },
          }),
        }),
        update: (table: any) => ({
          set: (vals: any) => ({
            where: () => Promise.resolve([]),
          }),
        }),
        insert: (table: any) => ({
          values: (vals: any) => {
            const arr = Array.isArray(vals) ? vals : [vals];
            if (table === runs) store.runs.push(...arr);
            if (table === tasks) store.tasks.push(...arr);
            return {
              returning: () => Promise.resolve(arr),
              then: (resolve: any, reject?: any) => Promise.resolve(arr).then(resolve, reject),
            };
          },
        }),
      };
      return callback(tx);
    });

    // 1. Request Round 1 Rewrite
    const run1 = await rewriteRun(
      ownerId,
      projectId,
      "Increase the wind speed and fog thickness during chapter 2.",
      false
    );
    expect(run1).toBeDefined();

    const tasksR1 = store.tasks.filter((t) => t.runId === run1.id);
    expect(tasksR1).toHaveLength(3);
    const inputR1 = tasksR1[0].savedInput;
    expect(inputR1.revisionRound).toBe(1);
    expect(inputR1.editorialInstructions).toBe(
      "Increase the wind speed and fog thickness during chapter 2."
    );
    expect(inputR1.hasAdditionalInstructions).toBe(true);
    // CRITICAL: project.brief.desiredEnding was NOT modified!
    expect(inputR1.brief.desiredEnding).toBe("A safe return by harbor boat.");

    // Simulate completion of Round 1
    const run1InStore = store.runs.find((r) => r.id === run1.id);
    if (run1InStore) run1InStore.status = "completed";
    store.critiques = [{ id: "critique-r1", runId: run1.id, data: { revisionRounds: 1 } }];

    // 2. Request Round 2 Rewrite
    const run2 = await rewriteRun(ownerId, projectId, "Tense dialogue in chapter 3.", false);
    const tasksR2 = store.tasks.filter((t) => t.runId === run2.id);
    expect(tasksR2).toHaveLength(3);
    const inputR2 = tasksR2[0].savedInput;
    expect(inputR2.revisionRound).toBe(2);
    expect(inputR2.editorialInstructions).toBe("Tense dialogue in chapter 3.");
    expect(inputR2.brief.desiredEnding).toBe("A safe return by harbor boat.");

    // Simulate completion of Round 2
    const run2InStore = store.runs.find((r) => r.id === run2.id);
    if (run2InStore) run2InStore.status = "completed";
    store.critiques = [{ id: "critique-r2", runId: run2.id, data: { revisionRounds: 2 } }];

    // 3. Request Round 3 Rewrite -> Expect 409 limit rejection
    await expect(
      rewriteRun(ownerId, projectId, "Another revision please.", false)
    ).rejects.toThrow("The two-round revision limit has been reached.");
  });
});
