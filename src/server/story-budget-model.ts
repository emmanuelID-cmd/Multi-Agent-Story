import { createHash } from "node:crypto";
import { z } from "zod";
import type { ModelCall, ReadModel } from "../agents/read/model";
import type { WriteModel, WriteModelCall } from "../agents/write/model";
import { acquireModelSlot } from "../agents/read/runtime";

/** The SQL lane supplies the durable, owner-checked implementation. No model owns this authority. */
export interface ModelBudgetLedger {
  reserve(input: { ownerId: string; projectId: string; operationId: string; requestFingerprint: string;
    role: ModelCall["agent"] | WriteModelCall["role"]; inputByteLength: number; overheadTokens: number;
    maxOutputTokens: number }): Promise<{ replayed: boolean }>;
  settle(input: { ownerId: string; projectId: string; operationId: string;
    actualInputTokens: number; actualOutputTokens: number }): Promise<unknown>;
  markUncertain(input: { ownerId: string; projectId: string; operationId: string }): Promise<unknown>;
}
export type ModelBudgetContext = { ownerId: string; projectId: string; operationId: string; ledger: ModelBudgetLedger };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function budgetedCall<C extends ModelCall | WriteModelCall, R extends { usage: { inputTokens: number; outputTokens: number } }>(
  context: ModelBudgetContext, modelIdentity: (call: C) => string, complete: (call: C) => Promise<R>,
) {
  let sequence = 0;
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
    // UTF-8 bytes conservatively bound text tokens; retain additional wire-format overhead.
    const inputByteLength = Buffer.byteLength(JSON.stringify(payload), "utf8");
    const identity = { ownerId: context.ownerId, projectId: context.projectId,
      operationId: digest([context.operationId, role, ++sequence]) };
    let reservation: { replayed: boolean };
    try {
      reservation = await context.ledger.reserve({ ...identity, role, inputByteLength, overheadTokens: 4096, maxOutputTokens,
        requestFingerprint: digest(payload) });
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
    try {
      if (call.signal.aborted) throw Error("CANCELED");
      const response = await complete({ ...call, maxOutputTokens });
      if (!response.usage || ![response.usage.inputTokens, response.usage.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0))
        throw Error("MODEL_USAGE_INVALID");
      await context.ledger.settle({ ...identity, actualInputTokens: response.usage.inputTokens,
        actualOutputTokens: response.usage.outputTokens });
      if (call.signal.aborted) throw Error("CANCELED");
      return response;
    } catch (error) {
      haltedReason = "MODEL_BUDGET_UNCERTAIN_REQUIRES_RECOVERY";
      // Failed or uncertain dispatches retain their reservation across process restarts.
      await context.ledger.markUncertain(identity).catch(() => undefined);
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
