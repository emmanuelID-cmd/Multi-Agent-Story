import { createHash } from "node:crypto";

export type TaskAttemptIdentity = {
  taskId: string;
  runId: string;
  projectId: string;
  ownerId: string;
  attemptNumber: number;
  operationId: string;
  projectVersion: number;
  bibleId: string;
  bibleVersion: number;
  savedInputHash: string;
};

export type TaskAttemptState = {
  project: { id: string; ownerId: string; version: number };
  run: { id: string; projectId: string; bibleId: string; status: string; canceledAt: Date | null };
  bible: { id: string; projectId: string; version: number };
  task: {
    id: string;
    runId: string;
    status: string;
    attempts: number;
    savedInput: unknown;
  };
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function taskAttemptInputHash(savedInput: unknown): string {
  return createHash("sha256").update(canonicalJson(savedInput), "utf8").digest("hex");
}

/** App-local bookkeeping only; this does not guarantee provider-side idempotency. */
export function taskAttemptOperationId(taskId: string, attemptNumber: number): string {
  if (!taskId || !Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error("Invalid task attempt identity.");
  }
  return `task:${taskId}:attempt:${attemptNumber}`;
}

export function matchesCurrentTaskAttempt(identity: TaskAttemptIdentity, current: TaskAttemptState): boolean {
  return current.project.id === identity.projectId
    && current.project.ownerId === identity.ownerId
    && current.project.version === identity.projectVersion
    && current.run.id === identity.runId
    && current.run.projectId === identity.projectId
    && current.run.bibleId === identity.bibleId
    && ["running", "pending"].includes(current.run.status)
    && current.run.canceledAt === null
    && current.bible.id === identity.bibleId
    && current.bible.projectId === identity.projectId
    && current.bible.version === identity.bibleVersion
    && current.task.id === identity.taskId
    && current.task.runId === identity.runId
    && current.task.status === "running"
    && current.task.attempts === identity.attemptNumber
    && identity.operationId === taskAttemptOperationId(current.task.id, current.task.attempts)
    && taskAttemptInputHash(current.task.savedInput) === identity.savedInputHash;
}

/** True only while this exact persisted task attempt still owns the task row. */
export function matchesTaskAttemptLease(
  identity: TaskAttemptIdentity,
  task: TaskAttemptState["task"],
): boolean {
  return task.id === identity.taskId
    && task.runId === identity.runId
    && task.status === "running"
    && task.attempts === identity.attemptNumber
    && identity.operationId === taskAttemptOperationId(task.id, task.attempts)
    && taskAttemptInputHash(task.savedInput) === identity.savedInputHash;
}
