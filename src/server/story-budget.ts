import { createStoryBudgetLedger, DbStoryBudgetRepository, AGENT_ROLES, type StoryBudgetRates } from "./budget-ledger";
import { budgetReadModel, budgetWriteModel } from "./story-budget-model";
import type { ReadModel } from "../agents/read/model";
import { AnthropicWriteModel } from "../agents/write/model";

function rate(prefix: string) {
  const parse = (name: string) => {
    const value = Number(process.env[name]);
    const micro = Math.ceil(value * 1_000_000);
    if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(micro)) throw Error("STORY_BUDGET_RATES_UNAVAILABLE");
    return micro;
  };
  return { inputMicroUsdPerMillion: parse(`${prefix}_INPUT_USD_PER_MILLION`),
    outputMicroUsdPerMillion: parse(`${prefix}_OUTPUT_USD_PER_MILLION`) };
}

/** Called on the server only. Missing rates or unapplied SQL fail closed before a paid dispatch. */
function ledgerFor(lane: "read" | "write") {
  const rates = Object.fromEntries(AGENT_ROLES.map(role => [role, lane === "read" ? rate("READ") :
    rate(role.startsWith("chapter_writer_") ? "WRITE_WRITER" : "WRITE_CRITIC")])) as StoryBudgetRates;
  return createStoryBudgetLedger({ repository: new DbStoryBudgetRepository(), rates });
}

export function storyReadModel(model: ReadModel, ownerId: string, projectId: string, operationId: string): ReadModel {
  return budgetReadModel(model, { ownerId, projectId, operationId, ledger: ledgerFor("read") });
}

export function storyWriteModel(ownerId: string, projectId: string, operationId: string) {
  if (process.env.WRITE_CONNECTIONS_ENABLED !== "true" || !process.env.ANTHROPIC_API_KEY)
    throw Error("WRITE_CONNECTIONS_UNAVAILABLE");
  const model = new AnthropicWriteModel(process.env.ANTHROPIC_API_KEY);
  return budgetWriteModel(model, { ownerId, projectId, operationId, ledger: ledgerFor("write") },
    call => model.resolveModelForRole(call.role));
}
