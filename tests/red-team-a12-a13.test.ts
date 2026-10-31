import { describe, expect, it, vi, beforeEach } from "vitest";
import { startRun, approveProposal, retryRun, AppError } from "../src/server/projects";
import { db } from "../src/server/db";
import { projects, bibles, runs, tasks, proposals, chapters } from "../src/server/db/schema";
import { writeChapter } from "../src/agents/graph";

interface Store {
  projects: any[];
  bibles: any[];
  runs: any[];
  tasks: any[];
  proposals: any[];
  chapters: any[];
}

function createMockDb(store: Store) {
  const getTableRows = (table: any) => {
    if (table === projects) return store.projects;
    if (table === bibles) return store.bibles;
    if (table === runs) return store.runs;
    if (table === tasks) return store.tasks;
    if (table === proposals) return store.proposals;
    if (table === chapters) return store.chapters;
    return [];
  };

  const extractValues = (cond: any): any[] => {
    if (!cond) return [];
    if (typeof cond === "string" || typeof cond === "number") return [cond];
    if (Array.isArray(cond)) return cond.flatMap(extractValues);
    if (typeof cond === "object") {
      if ("value" in cond) return [cond.value];
      if ("queryChunks" in cond) return extractValues(cond.queryChunks);
      if ("conditions" in cond) return extractValues(cond.conditions);
    }
    return [];
  };

  const evaluateWhere = (table: any, condition: any) => {
    let rows = getTableRows(table);
    if (!condition) return rows;
    const vals = extractValues(condition);
    if (table === bibles) {
      if (vals.includes("b-1")) rows = rows.filter(b => b.id === "b-1");
      else if (vals.includes("b-2")) rows = rows.filter(b => b.id === "b-2");
    }
    return rows;
  };

  const wrapQuery = (rows: any[]) => {
    const promise = Promise.resolve(rows);
    return Object.assign(promise, {
      for: () => wrapQuery(rows),
      orderBy: () => wrapQuery(rows),
      limit: (n: number) => wrapQuery(rows.slice(0, n)),
    });
  };

  vi.spyOn(db, "select").mockImplementation(() => ({
    from: (table: any) => ({
      where: (condition?: any) => wrapQuery(evaluateWhere(table, condition)),
    }),
  }) as any);

  vi.spyOn(db, "transaction").mockImplementation(async (callback: any) => {
    const tx = {
      select: () => ({
        from: (table: any) => ({
          where: (condition?: any) => wrapQuery(evaluateWhere(table, condition)),
        }),
      }),
      update: (table: any) => ({
        set: (values: any) => ({
          where: async () => {
            const rows = getTableRows(table);
            for (const r of rows) Object.assign(r, values);
          },
        }),
      }),
      insert: (table: any) => ({
        values: (val: any) => {
          const rows = getTableRows(table);
          const items = Array.isArray(val) ? val : [val];
          rows.push(...items);
          const inserted = () => Promise.resolve(items);
          return {
            returning: inserted,
            // Chapter saves continue to returning() after the conflict clause.
            // Keep that step on the mock so a real insert is not cut off.
            onConflictDoNothing: () => ({ returning: inserted }),
          };
        },
      }),
    };
    return callback(tx);
  });
}

describe("Red team regression tests (A12, A13)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("A12: Parallel starts and approvals", () => {
    it("prevents two active runs on the same project (throws 409 'A run is already active.')", async () => {
      const store: Store = {
        projects: [{ id: "p-1", ownerId: "u-1", version: 1, brief: { premise: "A premise" } }],
        bibles: [{ id: "b-1", projectId: "p-1", version: 1, data: { facts: [] } }],
        runs: [{ id: "r-active", projectId: "p-1", status: "running" }],
        tasks: [],
        proposals: [],
        chapters: [],
      };
      createMockDb(store);

      await expect(startRun("u-1", "p-1", { fixture: "normal" }, false)).rejects.toMatchObject({
        status: 409,
        message: "A run is already active.",
      });
    });

    it("prevents two approvals from skipping or reusing a version (throws 409 'Proposal is stale.')", async () => {
      const store: Store = {
        projects: [{ id: "p-1", ownerId: "u-1", version: 2, brief: { premise: "A premise" } }],
        bibles: [{ id: "b-1", projectId: "p-1", version: 1, data: { facts: [] } }],
        runs: [],
        tasks: [],
        // Proposal was built on baseVersion 1, but project is already version 2
        proposals: [{ id: "prop-stale", projectId: "p-1", baseVersion: 1, kind: "bible_a", status: "pending", data: { facts: [], beats: [] } }],
        chapters: [],
      };
      createMockDb(store);

      await expect(approveProposal("u-1", "p-1", "prop-stale")).rejects.toThrow("Proposal is stale or already decided.");
    });
  });

  describe("A13: Stale retry after newer bible version", () => {
    it("refuses retryRun when the project bible has been updated to a newer version", async () => {
      const store: Store = {
        projects: [{ id: "p-1", ownerId: "u-1", version: 2, brief: { premise: "A premise" } }],
        // New bible is version 2
        bibles: [{ id: "b-2", projectId: "p-1", version: 2, data: { facts: [{ id: "F1", text: "New fact" }] } }],
        // Run was created under old bible b-1
        runs: [{ id: "r-1", projectId: "p-1", bibleId: "b-1", status: "failed", createdAt: new Date() }],
        tasks: [{
          id: "t-1",
          runId: "r-1",
          chapterIndex: 1,
          status: "failed",
          attempts: 1,
          savedInput: { bible: { facts: [] }, version: 1, brief: { premise: "A premise" } },
        }],
        proposals: [],
        chapters: [],
      };
      createMockDb(store);

      await expect(retryRun("u-1", "p-1", false)).rejects.toMatchObject({
        status: 409,
        message: "The approved Bible changed. Review the current plan before retrying.",
      });
    });
  });
});
