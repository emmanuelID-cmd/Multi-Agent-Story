import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  AGENT_ROLES,
  createStoryBudgetLedger,
  STORY_BUDGET_LIMITS,
  StoryBudgetError,
  type AgentRole,
  type BudgetTotals,
  type Reservation,
  type RoleRate,
  type ReserveResult,
  type SettleResult,
  type StoryBudgetRates,
  type StoryBudgetRepository,
} from "../src/server/budget-ledger";

const rates = Object.fromEntries(AGENT_ROLES.map((role) => [role, {
  inputMicroUsdPerMillion: 1_000_000,
  outputMicroUsdPerMillion: 2_000_000,
}])) as StoryBudgetRates;

class MemoryBudgetRepository implements StoryBudgetRepository {
  private readonly reservations = new Map<string, Reservation>();
  private totals: BudgetTotals = { settledTokens: 0, settledCostMicroUsd: 0, reservedTokens: 0, reservedCostMicroUsd: 0, blocked: false };
  reserveCalls = 0;
  get totalsSnapshot() { return this.totals; }

  private key(projectId: string, operationId: string) { return `${projectId}:${operationId}`; }
  async getReservation(input: { ownerId: string; projectId: string; operationId: string }) {
    const row = this.reservations.get(this.key(input.projectId, input.operationId));
    return row?.ownerId === input.ownerId ? row : undefined;
  }
  async reserve(row: Reservation, limits: typeof STORY_BUDGET_LIMITS): Promise<ReserveResult> {
    this.reserveCalls += 1;
    const key = this.key(row.projectId, row.operationId);
    const existing = this.reservations.get(key);
    if (existing) {
      if (existing.ownerId !== row.ownerId) throw new StoryBudgetError("PROJECT_NOT_FOUND");
      if (existing.requestFingerprint !== row.requestFingerprint || existing.reservedTokens !== row.reservedTokens || existing.reservedCostMicroUsd !== row.reservedCostMicroUsd || existing.inputMicroUsdPerMillion !== row.inputMicroUsdPerMillion || existing.outputMicroUsdPerMillion !== row.outputMicroUsdPerMillion) throw new StoryBudgetError("IDEMPOTENCY_KEY_REUSE");
      return { kind: "replay", reservation: existing, totals: this.totals };
    }
    if (this.totals.blocked) return { kind: "blocked", reservation: row, totals: this.totals };
    if (this.totals.settledTokens + this.totals.reservedTokens + row.reservedTokens > limits.tokens || this.totals.settledCostMicroUsd + this.totals.reservedCostMicroUsd + row.reservedCostMicroUsd > limits.costMicroUsd) throw new StoryBudgetError("PROJECT_BUDGET_EXCEEDED");
    this.reservations.set(key, row);
    this.totals = { ...this.totals, reservedTokens: this.totals.reservedTokens + row.reservedTokens, reservedCostMicroUsd: this.totals.reservedCostMicroUsd + row.reservedCostMicroUsd };
    return { kind: "created", reservation: row, totals: this.totals };
  }
  async settle(input: { ownerId: string; projectId: string; operationId: string; actualInputTokens: number; actualOutputTokens: number; actualCostMicroUsd: number }): Promise<SettleResult> {
    const key = this.key(input.projectId, input.operationId);
    const row = await this.getReservation(input);
    if (!row) throw new StoryBudgetError("RESERVATION_NOT_FOUND");
    if (row.status === "settled") {
      if (row.actualInputTokens !== input.actualInputTokens || row.actualOutputTokens !== input.actualOutputTokens || row.actualCostMicroUsd !== input.actualCostMicroUsd) throw new StoryBudgetError("SETTLEMENT_REPLAY_MISMATCH");
      return { kind: "replay", reservation: row, totals: this.totals };
    }
    if (input.actualInputTokens > row.inputTokenBound || input.actualOutputTokens > row.outputTokenBound || input.actualCostMicroUsd > row.reservedCostMicroUsd) {
      this.totals = { ...this.totals, blocked: true };
      const blocked = { ...row, status: "blocked" as const, actualInputTokens: input.actualInputTokens, actualOutputTokens: input.actualOutputTokens, actualCostMicroUsd: input.actualCostMicroUsd };
      this.reservations.set(key, blocked);
      return { kind: "overrun", reservation: blocked, totals: this.totals };
    }
    this.totals = {
      ...this.totals,
      settledTokens: this.totals.settledTokens + input.actualInputTokens + input.actualOutputTokens,
      settledCostMicroUsd: this.totals.settledCostMicroUsd + input.actualCostMicroUsd,
      reservedTokens: this.totals.reservedTokens - row.reservedTokens,
      reservedCostMicroUsd: this.totals.reservedCostMicroUsd - row.reservedCostMicroUsd,
    };
    const settled = { ...row, status: "settled" as const, actualInputTokens: input.actualInputTokens, actualOutputTokens: input.actualOutputTokens, actualCostMicroUsd: input.actualCostMicroUsd };
    this.reservations.set(key, settled);
    return { kind: "settled", reservation: settled, totals: this.totals };
  }
  async markUncertain(input: { ownerId: string; projectId: string; operationId: string }) {
    const key = this.key(input.projectId, input.operationId);
    const row = await this.getReservation(input);
    if (!row) throw new StoryBudgetError("RESERVATION_NOT_FOUND");
    if (row.status === "settled") throw new StoryBudgetError("RESERVATION_ALREADY_SETTLED");
    const uncertain = { ...row, status: "uncertain" as const };
    this.reservations.set(key, uncertain);
    return { reservation: uncertain, totals: this.totals };
  }
}

function setup() {
  const repository = new MemoryBudgetRepository();
  const ledger = createStoryBudgetLedger({ repository, rates });
  const request = {
    ownerId: "owner-1", projectId: "project-1", operationId: "op-1", requestFingerprint: "sha256:input-1",
    role: "research" as AgentRole, inputByteLength: 12, overheadTokens: 3, maxOutputTokens: 10,
  };
  return { repository, ledger, request };
}

describe("shared story budget ledger", () => {
  it("blocks pre-migration projects with unknown history while future projects initialize at zero", async () => {
    const migration = await readFile(new URL("../drizzle/0001_shared_story_budget_ledger.sql", import.meta.url), "utf8");
    const schema = await readFile(new URL("../src/server/db/schema.ts", import.meta.url), "utf8");
    const adapter = await readFile(new URL("../src/server/budget-ledger.ts", import.meta.url), "utf8");
    expect(migration).toMatch(/INSERT INTO "story_budget_usage" \("projectId", "ownerId", "blocked"\)\s+SELECT "id", "ownerId", true FROM "projects"/);
    expect(schema).toMatch(/blocked: boolean\(\)\.notNull\(\)\.default\(false\)/);
    expect(adapter).toMatch(/INSERT INTO story_budget_usage \("projectId", "ownerId"\) VALUES \(\$1,\$2\) ON CONFLICT/);
  });

  it("reserves byte-length plus schema/system overhead and output under fixed caps", async () => {
    const { ledger, request } = setup();
    const result = await ledger.reserve(request);
    expect(result.reservation.inputTokenBound).toBe(15);
    expect(result.reservation.reservedTokens).toBe(25);
    expect(result.reservation.reservedCostMicroUsd).toBe(35);
    expect(result.remainingTokens).toBe(59_975);
  });

  it("rejects unsafe role, invalid rates, and requests above the fixed token cap", async () => {
    const { ledger, request } = setup();
    await expect(ledger.reserve({ ...request, role: "client-role" as AgentRole })).rejects.toMatchObject({ code: "INVALID_ROLE" });
    await expect(ledger.reserve({ ...request, inputByteLength: 60_001 })).rejects.toMatchObject({ code: "TOKEN_RESERVATION_LIMIT" });
    const badRates = { ...rates, research: { inputMicroUsdPerMillion: -1, outputMicroUsdPerMillion: 1 } };
    await expect(createStoryBudgetLedger({ repository: new MemoryBudgetRepository(), rates: badRates }).reserve(request)).rejects.toMatchObject({ code: "INVALID_SERVER_RATE" });
  });

  it("returns matching dispatched replay without making a second dispatch eligible", async () => {
    const { ledger, repository, request } = setup();
    await ledger.reserve(request);
    const replay = await ledger.reserve(request);
    expect(replay.replayed).toBe(true);
    expect(replay.reservation.status).toBe("dispatched");
    expect(repository.reserveCalls).toBe(2);
    await expect(ledger.reserve({ ...request, requestFingerprint: "sha256:changed" })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSE" });
  });

  it("keeps uncertain reservations charged and rejects redispatch", async () => {
    const { ledger, request } = setup();
    await ledger.reserve(request);
    await ledger.markUncertain({ ownerId: request.ownerId, projectId: request.projectId, operationId: request.operationId });
    const replay = await ledger.reserve(request);
    expect(replay.reservation.status).toBe("uncertain");
    expect(replay.remainingTokens).toBe(59_975);
  });

  it("settles known exact usage once and releases only its unused estimate", async () => {
    const { ledger, request } = setup();
    await ledger.reserve(request);
    const settled = await ledger.settle({ ownerId: request.ownerId, projectId: request.projectId, operationId: request.operationId, actualInputTokens: 10, actualOutputTokens: 5 });
    expect(settled.totals.settledTokens).toBe(15);
    expect(settled.totals.reservedTokens).toBe(0);
    expect(settled.totals.settledCostMicroUsd).toBe(20);
    expect((await ledger.settle({ ownerId: request.ownerId, projectId: request.projectId, operationId: request.operationId, actualInputTokens: 10, actualOutputTokens: 5 })).replayed).toBe(true);
    await expect(ledger.settle({ ownerId: request.ownerId, projectId: request.projectId, operationId: request.operationId, actualInputTokens: 9, actualOutputTokens: 5 })).rejects.toMatchObject({ code: "SETTLEMENT_REPLAY_MISMATCH" });
  });

  it("settles with the snapshotted trusted rates and keeps owner checks on reservation lookup", async () => {
    const repository = new MemoryBudgetRepository();
    const mutableRates = { ...rates, research: { ...rates.research } } as Record<AgentRole, RoleRate>;
    const ledger = createStoryBudgetLedger({ repository, rates: mutableRates });
    const { request } = setup();
    await ledger.reserve(request);
    mutableRates.research = { inputMicroUsdPerMillion: 9_000_000, outputMicroUsdPerMillion: 9_000_000 };
    const settled = await ledger.settle({ ownerId: request.ownerId, projectId: request.projectId, operationId: request.operationId, actualInputTokens: 10, actualOutputTokens: 5 });
    expect(settled.totals.settledCostMicroUsd).toBe(20);
    await expect(ledger.settle({ ownerId: "other-owner", projectId: request.projectId, operationId: request.operationId, actualInputTokens: 10, actualOutputTokens: 5 })).rejects.toMatchObject({ code: "RESERVATION_NOT_FOUND" });
  });

  it("blocks the project after settlement exceeds its reservation and keeps capacity held", async () => {
    const { ledger, repository, request } = setup();
    await ledger.reserve(request);
    await expect(ledger.settle({ ownerId: request.ownerId, projectId: request.projectId, operationId: request.operationId, actualInputTokens: 16, actualOutputTokens: 5 })).rejects.toMatchObject({ code: "SETTLEMENT_EXCEEDED_RESERVATION" });
    const observed = await repository.getReservation({ ownerId: request.ownerId, projectId: request.projectId, operationId: request.operationId });
    expect(observed).toMatchObject({ status: "blocked", actualInputTokens: 16, actualOutputTokens: 5, actualCostMicroUsd: 26 });
    expect(repository.totalsSnapshot).toMatchObject({ blocked: true, settledTokens: 0, reservedTokens: 25, reservedCostMicroUsd: 35 });
    await expect(ledger.reserve({ ...request, operationId: "op-2", requestFingerprint: "sha256:input-2" })).rejects.toMatchObject({ code: "PROJECT_BUDGET_BLOCKED" });
  });
});
