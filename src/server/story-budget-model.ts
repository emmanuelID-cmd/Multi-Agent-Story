import { createHash } from "node:crypto";
import { z } from "zod";
import type { ModelCall, ReadModel } from "../agents/read/model";
import type { WriteModel, WriteModelCall } from "../agents/write/model";
import { acquireModelSlot } from "../agents/read/runtime";

/** The SQL lane supplies the durable, owner-checked implementation. No model owns this authority. */
export interface ModelBudgetLedger {
  reserve(input: { ownerId: string; projectId: string; operationId: string; requestFingerprint: string;
    role: ModelCall["agent"] | WriteModelCall["role"]; estimatedInputTokens: number; overheadTokens: number;
    maxOutputTokens: number }): Promise<{ replayed: boolean }>;
  settle(input: { ownerId: string; projectId: string; operationId: string;
    actualInputTokens: number; actualOutputTokens: number }): Promise<unknown>;
  markUncertain(input: { ownerId: string; projectId: string; operationId: string }): Promise<unknown>;
  release(input: { ownerId: string; projectId: string; operationId: string }): Promise<unknown>;
}
export type ModelBudgetContext = { ownerId: string; projectId: string; operationId: string; ledger: ModelBudgetLedger };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * Holds a token budget, runs one model call, then records the usage the model reports.
 * It connects a planning step to the shared ledger: the same planning id, role, and
 * prompt replay one reservation, and a changed prompt gets its own hold.
 * Keep the hash inputs together. If a later edit drops the prompt hash, a rewritten
 * chapter can be rejected as a duplicate of the old one.
 */
function budgetedCall<C extends ModelCall | WriteModelCall, R extends { usage: { inputTokens: number; outputTokens: number } }>(
  context: ModelBudgetContext, modelIdentity: (call: C) => string, complete: (call: C) => Promise<R>,
) {
  let haltedReason: string | undefined;
  return async (call: C): Promise<R> => {
    if (call.signal.aborted) throw Error("CANCELED");
    if (haltedReason) throw Error(haltedReason);
    const role = "agent" in call ? call.agent : call.role;
    const maxOutputTokens = call.maxOutputTokens ?? (role.startsWith("chapter_writer_") ? 4096 : 8192);
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) throw Error("MODEL_BUDGET_INVALID");
    const payload = { model: modelIdentity(call), role, system: call.system, data: call.data,
      schema: z.toJSONSchema(call.schema), maxOutputTokens,
      temperature: "temperature" in call ? call.temperature : undefined };
    // The byte length is only a local ceiling for the token estimate.
    const byteLength = Buffer.byteLength(JSON.stringify(payload), "utf8");
    const estimatedTokens = Math.ceil(byteLength / 4);
    const payloadDigest = digest(payload);
    const identity = { ownerId: context.ownerId, projectId: context.projectId,
      operationId: digest([context.operationId, role, payloadDigest]) };
    let reservation: { replayed: boolean };
    try {
      reservation = await context.ledger.reserve({ ...identity, role, estimatedInputTokens: estimatedTokens, overheadTokens: 4096, maxOutputTokens,
        requestFingerprint: payloadDigest });
    } catch (error) {
      if (error instanceof Error && ["PROJECT_BUDGET_EXCEEDED", "PROJECT_BUDGET_BLOCKED", "TOKEN_RESERVATION_LIMIT", "COST_RESERVATION_LIMIT"].includes(error.message))
        throw Error("BUDGET_EXHAUSTED");
      throw error;
    }
    // Even a settled replay is not permission to make another paid call.
    if (reservation.replayed) {
      haltedReason = "MODEL_BUDGET_REPLAY_REQUIRES_RECOVERY";
      throw Error(haltedReason);
    }
    let completeStarted = false;
    try {
      if (call.signal.aborted) {
        await context.ledger.release(identity).catch(() => undefined);
        throw Error("CANCELED");
      }
      completeStarted = true;
      const response = await complete({ ...call, maxOutputTokens });
      if (!response.usage || ![response.usage.inputTokens, response.usage.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0))
        throw Error("MODEL_USAGE_INVALID");
      await context.ledger.settle({ ...identity, actualInputTokens: response.usage.inputTokens,
        actualOutputTokens: response.usage.outputTokens });
      return response;
    } catch (error) {
      if (!completeStarted) {
        await context.ledger.release(identity).catch(() => undefined);
      } else {
        haltedReason = "MODEL_BUDGET_UNCERTAIN_REQUIRES_RECOVERY";
        // Failed or uncertain dispatches retain their reservation across process restarts.
        await context.ledger.markUncertain(identity).catch(() => undefined);
      }
      if (error instanceof Error && error.message === "SETTLEMENT_EXCEEDED_RESERVATION") throw Error("BUDGET_EXHAUSTED");
      throw error;
    }
  };
}

export function budgetReadModel(model: ReadModel, context: ModelBudgetContext): ReadModel {
  return { modelId: model.modelId, complete: budgetedCall<ModelCall, Awaited<ReturnType<ReadModel["complete"]>>>(
    context, () => model.modelId, call => model.complete(call)) };
}

export function budgetWriteModel(model: WriteModel, context: ModelBudgetContext,
  modelIdentity: (call: WriteModelCall) => string): WriteModel {
  const complete = budgetedCall<WriteModelCall, Awaited<ReturnType<WriteModel["complete"]>>>(
    context, modelIdentity, call => model.complete(call));
  return { async complete(call) {
    const release = await acquireModelSlot(call.signal);
    try { return await complete(call); } finally { release(); }
  } };
}
