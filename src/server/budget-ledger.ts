import { pool } from "./db";
import type { PoolClient } from "pg";

export const STORY_BUDGET_LIMITS = Object.freeze({ tokens: 60_000, costMicroUsd: 3_000_000 });

export const AGENT_ROLES = [
  "coordinator", "research", "reader", "consistency", "bible_a", "bible_b", "bible_c",
  "chapter_writer_1", "chapter_writer_2", "chapter_writer_3", "critic_editor_a", "critic_editor_b",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export type RoleRate = Readonly<{
  inputMicroUsdPerMillion: number;
  outputMicroUsdPerMillion: number;
}>;
export type StoryBudgetRates = Readonly<Record<AgentRole, RoleRate>>;

export type ReservationStatus = "dispatched" | "uncertain" | "settled" | "blocked";
export type Reservation = Readonly<{
  projectId: string;
  ownerId: string;
  operationId: string;
  requestFingerprint: string;
  role: AgentRole;
  inputTokenBound: number;
  outputTokenBound: number;
  inputMicroUsdPerMillion: number;
  outputMicroUsdPerMillion: number;
  reservedTokens: number;
  reservedCostMicroUsd: number;
  status: ReservationStatus;
  actualInputTokens?: number;
  actualOutputTokens?: number;
  actualCostMicroUsd?: number;
}>;

export type BudgetTotals = Readonly<{
  settledTokens: number;
  settledCostMicroUsd: number;
  reservedTokens: number;
  reservedCostMicroUsd: number;
  blocked: boolean;
}>;

export type NewReservation = Reservation;
export type ReserveResult = Readonly<{
  kind: "created" | "replay" | "blocked";
  reservation: Reservation;
  totals: BudgetTotals;
}>;
export type SettleResult = Readonly<{
  kind: "settled" | "replay" | "overrun";
  reservation: Reservation;
  totals: BudgetTotals;
}>;

/** Repository methods must verify project ownership and serialize by project. */
export interface StoryBudgetRepository {
  getReservation(input: { ownerId: string; projectId: string; operationId: string }): Promise<Reservation | undefined>;
  reserve(reservation: NewReservation, limits: typeof STORY_BUDGET_LIMITS): Promise<ReserveResult>;
  settle(input: { ownerId: string; projectId: string; operationId: string; actualInputTokens: number; actualOutputTokens: number; actualCostMicroUsd: number }): Promise<SettleResult>;
  markUncertain(input: { ownerId: string; projectId: string; operationId: string }): Promise<{ reservation: Reservation; totals: BudgetTotals }>;
}

export class StoryBudgetError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StoryBudgetError";
  }
}

export function createStoryBudgetLedger(options: { repository: StoryBudgetRepository; rates: StoryBudgetRates }) {
  return {
    async reserve(input: {
      ownerId: string;
      projectId: string;
      operationId: string;
      requestFingerprint: string;
      role: AgentRole;
      inputByteLength: number;
      overheadTokens: number;
      maxOutputTokens: number;
    }) {
      if (!input.ownerId || !input.projectId || !input.operationId || !input.requestFingerprint) throw new StoryBudgetError("INVALID_IDENTITY");
      if (!AGENT_ROLES.includes(input.role)) throw new StoryBudgetError("INVALID_ROLE");
      for (const value of [input.inputByteLength, input.overheadTokens, input.maxOutputTokens]) {
        if (!Number.isSafeInteger(value) || value < 0) throw new StoryBudgetError("INVALID_TOKEN_BOUND");
      }
      const inputTokenBound = input.inputByteLength + input.overheadTokens;
      const reservedTokens = inputTokenBound + input.maxOutputTokens;
      if (!Number.isSafeInteger(reservedTokens) || reservedTokens < 1 || reservedTokens > STORY_BUDGET_LIMITS.tokens) throw new StoryBudgetError("TOKEN_RESERVATION_LIMIT");
      const rate = options.rates[input.role];
      if (!rate || !validRate(rate.inputMicroUsdPerMillion) || !validRate(rate.outputMicroUsdPerMillion)) throw new StoryBudgetError("INVALID_SERVER_RATE");
      const reservedCostMicroUsd = costMicroUsd(inputTokenBound, input.maxOutputTokens, rate);
      if (reservedCostMicroUsd > STORY_BUDGET_LIMITS.costMicroUsd) throw new StoryBudgetError("COST_RESERVATION_LIMIT");
      const reservation: NewReservation = {
        ownerId: input.ownerId,
        projectId: input.projectId,
        operationId: input.operationId,
        requestFingerprint: input.requestFingerprint,
        role: input.role,
        inputTokenBound,
        outputTokenBound: input.maxOutputTokens,
        inputMicroUsdPerMillion: rate.inputMicroUsdPerMillion,
        outputMicroUsdPerMillion: rate.outputMicroUsdPerMillion,
        reservedTokens,
        reservedCostMicroUsd,
        status: "dispatched",
      };
      const result = await options.repository.reserve(reservation, STORY_BUDGET_LIMITS);
      if (result.kind === "blocked" || result.totals.blocked) throw new StoryBudgetError("PROJECT_BUDGET_BLOCKED");
      return {
        ...result,
        replayed: result.kind === "replay",
        remainingTokens: Math.max(0, STORY_BUDGET_LIMITS.tokens - result.totals.settledTokens - result.totals.reservedTokens),
        remainingCostMicroUsd: Math.max(0, STORY_BUDGET_LIMITS.costMicroUsd - result.totals.settledCostMicroUsd - result.totals.reservedCostMicroUsd),
      };
    },

    async settle(input: { ownerId: string; projectId: string; operationId: string; actualInputTokens: number; actualOutputTokens: number }) {
      for (const value of [input.actualInputTokens, input.actualOutputTokens]) {
        if (!Number.isSafeInteger(value) || value < 0) throw new StoryBudgetError("INVALID_ACTUAL_USAGE");
      }
      const reserved = await options.repository.getReservation?.({ ownerId: input.ownerId, projectId: input.projectId, operationId: input.operationId });
      const role = reserved?.role;
      if (!role) throw new StoryBudgetError("RESERVATION_NOT_FOUND");
      const actualCostMicroUsd = costMicroUsd(input.actualInputTokens, input.actualOutputTokens, {
        inputMicroUsdPerMillion: reserved.inputMicroUsdPerMillion,
        outputMicroUsdPerMillion: reserved.outputMicroUsdPerMillion,
      });
      const result = await options.repository.settle({ ...input, actualCostMicroUsd });
      if (result.kind === "overrun") throw new StoryBudgetError("SETTLEMENT_EXCEEDED_RESERVATION");
      return { ...result, replayed: result.kind === "replay" };
    },

    async markUncertain(input: { ownerId: string; projectId: string; operationId: string }) {
      return options.repository.markUncertain(input);
    },
  };
}

function validRate(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function costMicroUsd(inputTokens: number, outputTokens: number, rate: RoleRate): number {
  const cost = (BigInt(inputTokens) * BigInt(rate.inputMicroUsdPerMillion) + BigInt(outputTokens) * BigInt(rate.outputMicroUsdPerMillion) + 999_999n) / 1_000_000n;
  const result = Number(cost);
  if (!Number.isSafeInteger(result)) throw new StoryBudgetError("COST_OVERFLOW");
  return result;
}

type DbReservationRow = {
  projectId: string; operationId: string; requestFingerprint: string; role: AgentRole;
  inputTokenBound: number; outputTokenBound: number; reservedTokens: number; reservedCostMicroUsd: number;
  inputMicroUsdPerMillion: number; outputMicroUsdPerMillion: number;
  actualInputTokens: number | null; actualOutputTokens: number | null; actualCostMicroUsd: number | null; status: ReservationStatus;
};
type DbUsageRow = { settledTokens: number; settledCostMicroUsd: number; reservedTokens: number; reservedCostMicroUsd: number; blocked: boolean };

/** PostgreSQL adapter. Its transactions only cover reservation/settlement bookkeeping. */
export class DbStoryBudgetRepository implements StoryBudgetRepository {
  async getReservation(input: { ownerId: string; projectId: string; operationId: string }): Promise<Reservation | undefined> {
    const result = await pool.query<DbReservationRow & { ownerId: string }>(
      `SELECT r.*, p."ownerId" FROM story_budget_reservations r JOIN projects p ON p."id"=r."projectId" WHERE r."projectId"=$1 AND p."ownerId"=$2 AND r."operationId"=$3`,
      [input.projectId, input.ownerId, input.operationId],
    );
    return result.rows[0] && fromDb(result.rows[0], input.ownerId);
  }

  async reserve(reservation: NewReservation, limits: typeof STORY_BUDGET_LIMITS): Promise<ReserveResult> {
    return this.withProjectLock(reservation.ownerId, reservation.projectId, async (client) => {
      await client.query(`INSERT INTO story_budget_usage ("projectId", "ownerId") VALUES ($1,$2) ON CONFLICT ("projectId") DO NOTHING`, [reservation.projectId, reservation.ownerId]);
      const totals = await this.readUsage(client, reservation.projectId);
      if (totals.blocked) return { kind: "blocked", reservation, totals };
      const existing = await client.query<DbReservationRow>(`SELECT * FROM story_budget_reservations WHERE "projectId"=$1 AND "operationId"=$2 FOR UPDATE`, [reservation.projectId, reservation.operationId]);
      if (existing.rows[0]) {
        const prior = fromDb(existing.rows[0], reservation.ownerId);
        if (!sameReservation(prior, reservation)) throw new StoryBudgetError("IDEMPOTENCY_KEY_REUSE");
        return { kind: "replay", reservation: prior, totals };
      }
      if (totals.settledTokens + totals.reservedTokens + reservation.reservedTokens > limits.tokens || totals.settledCostMicroUsd + totals.reservedCostMicroUsd + reservation.reservedCostMicroUsd > limits.costMicroUsd) throw new StoryBudgetError("PROJECT_BUDGET_EXCEEDED");
      await client.query(`INSERT INTO story_budget_reservations ("projectId","operationId","requestFingerprint","role","inputTokenBound","outputTokenBound","inputMicroUsdPerMillion","outputMicroUsdPerMillion","reservedTokens","reservedCostMicroUsd") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [reservation.projectId, reservation.operationId, reservation.requestFingerprint, reservation.role, reservation.inputTokenBound, reservation.outputTokenBound, reservation.inputMicroUsdPerMillion, reservation.outputMicroUsdPerMillion, reservation.reservedTokens, reservation.reservedCostMicroUsd]);
      const next = { ...totals, reservedTokens: totals.reservedTokens + reservation.reservedTokens, reservedCostMicroUsd: totals.reservedCostMicroUsd + reservation.reservedCostMicroUsd };
      await client.query(`UPDATE story_budget_usage SET "reservedTokens"=$2,"reservedCostMicroUsd"=$3,"updatedAt"=now() WHERE "projectId"=$1`, [reservation.projectId, next.reservedTokens, next.reservedCostMicroUsd]);
      return { kind: "created", reservation, totals: next };
    });
  }

  async settle(input: { ownerId: string; projectId: string; operationId: string; actualInputTokens: number; actualOutputTokens: number; actualCostMicroUsd: number }): Promise<SettleResult> {
    return this.withProjectLock(input.ownerId, input.projectId, async (client) => {
      const totals = await this.readUsage(client, input.projectId);
      const selected = await client.query<DbReservationRow>(`SELECT * FROM story_budget_reservations WHERE "projectId"=$1 AND "operationId"=$2 FOR UPDATE`, [input.projectId, input.operationId]);
      if (!selected.rows[0]) throw new StoryBudgetError("RESERVATION_NOT_FOUND");
      const prior = fromDb(selected.rows[0], input.ownerId);
      if (prior.status === "settled") {
        if (prior.actualInputTokens !== input.actualInputTokens || prior.actualOutputTokens !== input.actualOutputTokens || prior.actualCostMicroUsd !== input.actualCostMicroUsd) throw new StoryBudgetError("SETTLEMENT_REPLAY_MISMATCH");
        return { kind: "replay", reservation: prior, totals };
      }
      if (prior.status === "blocked") throw new StoryBudgetError("PROJECT_BUDGET_BLOCKED");
      if (input.actualInputTokens > prior.inputTokenBound || input.actualOutputTokens > prior.outputTokenBound || input.actualInputTokens + input.actualOutputTokens > prior.reservedTokens || input.actualCostMicroUsd > prior.reservedCostMicroUsd) {
        // Observed usage is recorded separately; the original reservation remains the charged cap hold.
        await client.query(`UPDATE story_budget_usage SET "blocked"=true,"updatedAt"=now() WHERE "projectId"=$1`, [input.projectId]);
        await client.query(`UPDATE story_budget_reservations SET "actualInputTokens"=$3,"actualOutputTokens"=$4,"actualCostMicroUsd"=$5,"status"='blocked',"updatedAt"=now() WHERE "projectId"=$1 AND "operationId"=$2`, [input.projectId, input.operationId, input.actualInputTokens, input.actualOutputTokens, input.actualCostMicroUsd]);
        return { kind: "overrun", reservation: { ...prior, status: "blocked", actualInputTokens: input.actualInputTokens, actualOutputTokens: input.actualOutputTokens, actualCostMicroUsd: input.actualCostMicroUsd }, totals: { ...totals, blocked: true } };
      }
      const next: BudgetTotals = {
        ...totals,
        settledTokens: totals.settledTokens + input.actualInputTokens + input.actualOutputTokens,
        settledCostMicroUsd: totals.settledCostMicroUsd + input.actualCostMicroUsd,
        reservedTokens: totals.reservedTokens - prior.reservedTokens,
        reservedCostMicroUsd: totals.reservedCostMicroUsd - prior.reservedCostMicroUsd,
      };
      await client.query(`UPDATE story_budget_usage SET "settledTokens"=$2,"settledCostMicroUsd"=$3,"reservedTokens"=$4,"reservedCostMicroUsd"=$5,"updatedAt"=now() WHERE "projectId"=$1`, [input.projectId, next.settledTokens, next.settledCostMicroUsd, next.reservedTokens, next.reservedCostMicroUsd]);
      await client.query(`UPDATE story_budget_reservations SET "actualInputTokens"=$3,"actualOutputTokens"=$4,"actualCostMicroUsd"=$5,"status"='settled',"updatedAt"=now() WHERE "projectId"=$1 AND "operationId"=$2`, [input.projectId, input.operationId, input.actualInputTokens, input.actualOutputTokens, input.actualCostMicroUsd]);
      return { kind: "settled", reservation: { ...prior, status: "settled", actualInputTokens: input.actualInputTokens, actualOutputTokens: input.actualOutputTokens, actualCostMicroUsd: input.actualCostMicroUsd }, totals: next };
    });
  }

  async markUncertain(input: { ownerId: string; projectId: string; operationId: string }): Promise<{ reservation: Reservation; totals: BudgetTotals }> {
    return this.withProjectLock(input.ownerId, input.projectId, async (client) => {
      const totals = await this.readUsage(client, input.projectId);
      const selected = await client.query<DbReservationRow>(`SELECT * FROM story_budget_reservations WHERE "projectId"=$1 AND "operationId"=$2 FOR UPDATE`, [input.projectId, input.operationId]);
      if (!selected.rows[0]) throw new StoryBudgetError("RESERVATION_NOT_FOUND");
      const prior = fromDb(selected.rows[0], input.ownerId);
      if (prior.status === "settled") throw new StoryBudgetError("RESERVATION_ALREADY_SETTLED");
      if (prior.status === "blocked") throw new StoryBudgetError("PROJECT_BUDGET_BLOCKED");
      if (prior.status === "dispatched") await client.query(`UPDATE story_budget_reservations SET "status"='uncertain',"updatedAt"=now() WHERE "projectId"=$1 AND "operationId"=$2`, [input.projectId, input.operationId]);
      return { reservation: { ...prior, status: "uncertain" }, totals };
    });
  }

  private async readUsage(client: PoolClient, projectId: string): Promise<BudgetTotals> {
    const result = await client.query<DbUsageRow>(`SELECT "settledTokens","settledCostMicroUsd","reservedTokens","reservedCostMicroUsd","blocked" FROM story_budget_usage WHERE "projectId"=$1 FOR UPDATE`, [projectId]);
    if (!result.rows[0]) throw new StoryBudgetError("BUDGET_USAGE_NOT_FOUND");
    return result.rows[0];
  }

  private async withProjectLock<T>(ownerId: string, projectId: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      await client.query("SET LOCAL lock_timeout = '5000ms'");
      const project = await client.query(`SELECT "id" FROM projects WHERE "id"=$1 AND "ownerId"=$2 FOR UPDATE`, [projectId, ownerId]);
      if (!project.rowCount) throw new StoryBudgetError("PROJECT_NOT_FOUND");
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function sameReservation(a: Reservation, b: Reservation): boolean {
  return a.requestFingerprint === b.requestFingerprint && a.role === b.role && a.inputTokenBound === b.inputTokenBound && a.outputTokenBound === b.outputTokenBound && a.inputMicroUsdPerMillion === b.inputMicroUsdPerMillion && a.outputMicroUsdPerMillion === b.outputMicroUsdPerMillion && a.reservedTokens === b.reservedTokens && a.reservedCostMicroUsd === b.reservedCostMicroUsd;
}

function fromDb(row: DbReservationRow, ownerId: string): Reservation {
  return {
    projectId: row.projectId, ownerId, operationId: row.operationId, requestFingerprint: row.requestFingerprint,
    role: row.role, inputTokenBound: row.inputTokenBound, outputTokenBound: row.outputTokenBound,
    inputMicroUsdPerMillion: row.inputMicroUsdPerMillion, outputMicroUsdPerMillion: row.outputMicroUsdPerMillion,
    reservedTokens: row.reservedTokens, reservedCostMicroUsd: row.reservedCostMicroUsd, status: row.status,
    ...(row.actualInputTokens === null ? {} : { actualInputTokens: row.actualInputTokens }),
    ...(row.actualOutputTokens === null ? {} : { actualOutputTokens: row.actualOutputTokens }),
    ...(row.actualCostMicroUsd === null ? {} : { actualCostMicroUsd: row.actualCostMicroUsd }),
  };
}
