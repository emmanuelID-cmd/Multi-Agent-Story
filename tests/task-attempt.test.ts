import { describe, expect, it } from "vitest";
import {
  matchesCurrentTaskAttempt,
  matchesTaskAttemptLease,
  taskAttemptInputHash,
  taskAttemptOperationId,
  type TaskAttemptIdentity,
  type TaskAttemptState,
} from "../src/server/task-attempt";

const identity: TaskAttemptIdentity = {
  taskId: "task-1",
  runId: "run-1",
  projectId: "project-1",
  ownerId: "owner-1",
  attemptNumber: 2,
  operationId: taskAttemptOperationId("task-1", 2),
  projectVersion: 3,
  bibleId: "bible-3",
  bibleVersion: 3,
  savedInputHash: taskAttemptInputHash({ version: 3, revisionRound: 1, readSourceProposalIds: ["proposal-1"] }),
};

function state(overrides: Partial<{
  project: Partial<TaskAttemptState["project"]>;
  run: Partial<TaskAttemptState["run"]>;
  bible: Partial<TaskAttemptState["bible"]>;
  task: Partial<TaskAttemptState["task"]>;
}> = {}): TaskAttemptState {
  return {
    project: { id: "project-1", ownerId: "owner-1", version: 3, ...overrides.project },
    run: { id: "run-1", projectId: "project-1", bibleId: "bible-3", status: "running", canceledAt: null, ...overrides.run },
    bible: { id: "bible-3", projectId: "project-1", version: 3, ...overrides.bible },
    task: {
      id: "task-1",
      runId: "run-1",
      status: "running",
      attempts: 2,
      savedInput: { version: 3, revisionRound: 1, readSourceProposalIds: ["proposal-1"] },
      ...overrides.task,
    },
  };
}

describe("durable task attempt identity", () => {
  it("accepts the exact current owner, versions, attempt, and saved dependencies", () => {
    expect(matchesCurrentTaskAttempt(identity, state())).toBe(true);
  });

  it("derives a stable operation ID from the persisted task and attempt number", () => {
    expect(taskAttemptOperationId("task-1", 2)).toBe("task:task-1:attempt:2");
    expect(taskAttemptOperationId("task-1", 2)).toBe(taskAttemptOperationId("task-1", 2));
    expect(taskAttemptOperationId("task-1", 1)).not.toBe(taskAttemptOperationId("task-1", 2));
  });

  it("recognizes only the same still-running persisted attempt lease", () => {
    expect(matchesTaskAttemptLease(identity, state().task)).toBe(true);
    expect(matchesTaskAttemptLease(identity, state({ task: { attempts: 3 } }).task)).toBe(false);
    expect(matchesTaskAttemptLease(identity, state({ task: { status: "failed" } }).task)).toBe(false);
    expect(matchesTaskAttemptLease(identity, state({ task: { savedInput: { version: 3, revisionRound: 2 } } }).task)).toBe(false);
  });

  it.each([
    ["replaced owner", { project: { ownerId: "owner-2" } }],
    ["changed project version", { project: { version: 4 } }],
    ["different run", { run: { id: "run-2" } }],
    ["changed Bible", { bible: { version: 4 } }],
    ["canceled run", { run: { status: "canceled", canceledAt: new Date() } }],
    ["changed attempt", { task: { attempts: 3 } }],
    ["replaced task", { task: { status: "pending" } }],
    ["changed saved dependencies", { task: { savedInput: { version: 3, revisionRound: 1, readSourceProposalIds: ["proposal-2"] } } }],
  ] as const)("rejects a late result after %s", (_reason, overrides) => {
    expect(matchesCurrentTaskAttempt(identity, state(overrides))).toBe(false);
  });

  it("hashes equivalent object key order identically", () => {
    expect(taskAttemptInputHash({ a: 1, b: { y: 2, x: 1 } })).toBe(taskAttemptInputHash({ b: { x: 1, y: 2 }, a: 1 }));
  });
});
