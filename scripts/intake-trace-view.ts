import { intakeCodes, intakeFieldIds, intakeIssueCodes, intakeSchemaLimit, intakeStages, safeIntakeSchemaPath } from "../src/server/intake-trace";

const safeNumber = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const safeDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value);
const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const keys = new Set(["at", "agentId", "event", "code", "traceId", "attempt", "operationId", "revision", "httpStatus", "field", "issue", "path", "limit", "modelId", "durationMs"]);

export function safeCoordinatorEvent(value: unknown, run: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (Object.keys(event).some(key => !keys.has(key))) return null;
  if (event.agentId !== "coordinator" || event.traceId !== run || !safeDate(event.at) ||
      !intakeStages.includes(event.event as typeof intakeStages[number]) || !intakeCodes.includes(event.code as typeof intakeCodes[number])) return null;
  if ("attempt" in event && (!safeNumber(event.attempt) || ![1, 2].includes(event.attempt as number))) return null;
  if ("operationId" in event && !uuid(event.operationId)) return null;
  if ("revision" in event && !safeNumber(event.revision)) return null;
  if ("httpStatus" in event && (!safeNumber(event.httpStatus) || (event.httpStatus as number) < 100 || (event.httpStatus as number) > 599)) return null;
  if ("field" in event && !intakeFieldIds.includes(event.field as typeof intakeFieldIds[number])) return null;
  if ("issue" in event && !intakeIssueCodes.includes(event.issue as string)) return null;
  if ("path" in event && (event.event !== "output_schema" || !safeIntakeSchemaPath(event.path))) return null;
  if ("limit" in event && (event.issue !== "too_big" || !safeIntakeSchemaPath(event.path) || event.limit !== intakeSchemaLimit(event.path))) return null;
  if ("modelId" in event && !["claude-haiku-5-5", "fixture", "other"].includes(event.modelId as string)) return null;
  if ("durationMs" in event && (!safeNumber(event.durationMs) || (event.durationMs as number) > 120_000)) return null;
  return event;
}
