import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { intakeFields, intakeModelLimits } from "../contracts/intake";

export type IntakeStage = "request" | "input_read" | "reserved" | "model_request" | "model_http" | "model_envelope" | "model_json" | "output_schema" | "grounding" | "dependencies" | "persist" | "outcome";
export type IntakeCode = "STARTED" | "PASSED" | "SUCCEEDED" | "REQUEST_INVALID" | "INPUT_REVIEW_REQUIRED" |
  "REVISION_CONFLICT" | "OWNER_BUSY" | "PROJECT_UNAVAILABLE" | "INTAKE_UNAVAILABLE" | "STORY_STARTED" | "SCOPE_CONFIRMED" | "ANALYSIS_IN_PROGRESS" | "RESERVATION_REJECTED" | "MODEL_CREDENTIAL_UNAVAILABLE" | "MODEL_HTTP_AUTH" | "MODEL_HTTP_CONFIG" |
  "MODEL_HTTP_RATE_LIMIT" | "MODEL_HTTP_UNAVAILABLE" | "MODEL_NETWORK_ERROR" | "MODEL_ENVELOPE_INVALID" |
  "MODEL_STOP_MAX_TOKENS" | "MODEL_STOP_OTHER" | "MODEL_JSON_INVALID" | "MODEL_STREAM_ERROR" | "MODEL_RESPONSE_TOO_LARGE" |
  "OUTPUT_SCHEMA_INVALID" | "OUTPUT_QUOTE_INVALID" | "OUTPUT_DUPLICATE_FIELD" | "OUTPUT_DEPENDENCY_INVALID" |
  "BUDGET_EXCEEDED" | "CANCELED" | "TIMED_OUT" | "STALE_INPUT" | "PERSIST_FAILED" | "ANALYSIS_FAILED";
export const intakeStages: IntakeStage[] = ["request", "input_read", "reserved", "model_request", "model_http", "model_envelope", "model_json", "output_schema", "grounding", "dependencies", "persist", "outcome"];
export const intakeCodes: IntakeCode[] = ["STARTED", "PASSED", "SUCCEEDED", "REQUEST_INVALID", "INPUT_REVIEW_REQUIRED", "REVISION_CONFLICT", "OWNER_BUSY", "PROJECT_UNAVAILABLE", "INTAKE_UNAVAILABLE", "STORY_STARTED", "SCOPE_CONFIRMED", "ANALYSIS_IN_PROGRESS", "RESERVATION_REJECTED", "MODEL_CREDENTIAL_UNAVAILABLE", "MODEL_HTTP_AUTH", "MODEL_HTTP_CONFIG", "MODEL_HTTP_RATE_LIMIT", "MODEL_HTTP_UNAVAILABLE", "MODEL_NETWORK_ERROR", "MODEL_ENVELOPE_INVALID", "MODEL_STOP_MAX_TOKENS", "MODEL_STOP_OTHER", "MODEL_JSON_INVALID", "MODEL_STREAM_ERROR", "MODEL_RESPONSE_TOO_LARGE", "OUTPUT_SCHEMA_INVALID", "OUTPUT_QUOTE_INVALID", "OUTPUT_DUPLICATE_FIELD", "OUTPUT_DEPENDENCY_INVALID", "BUDGET_EXCEEDED", "CANCELED", "TIMED_OUT", "STALE_INPUT", "PERSIST_FAILED", "ANALYSIS_FAILED"];
export type IntakeTraceEvent = {
  at: string; agentId: "coordinator"; event: IntakeStage; code: IntakeCode; traceId: string;
  attempt?: number; operationId?: string; revision?: number; httpStatus?: number; field?: string; issue?: string; path?: string; limit?: number; modelId?: "claude-haiku-5-5" | "fixture" | "other"; durationMs?: number;
};
export type IntakeTraceSink = (event: IntakeTraceEvent) => void;

export const intakeFieldIds = intakeFields.map(field => field.id);
export const intakeIssueCodes = ["invalid_type", "too_big", "too_small", "invalid_value", "invalid_format", "unrecognized_keys", "custom"];
const fields = new Set<string>(intakeFieldIds);
const issues = new Set(intakeIssueCodes);

export function intakeSchemaLimit(path: string): number | undefined {
  if (path === "summary") return intakeModelLimits.summary;
  if (path === "observations") return intakeModelLimits.observations;
  if (path === "suggestions") return intakeModelLimits.suggestions;
  if (/^observations\[(?:\d{1,2})\]\.quote$/.test(path)) return intakeModelLimits.quote;
  if (/^suggestions\[(?:\d)\]\.question$/.test(path)) return intakeModelLimits.question;
  if (/^suggestions\[(?:\d)\]\.reason$/.test(path)) return intakeModelLimits.reason;
  if (/^suggestions\[(?:\d)\]\.options$/.test(path)) return intakeModelLimits.options;
  if (/^suggestions\[(?:\d)\]\.options\[(?:\d)\]$/.test(path)) return intakeModelLimits.option;
  return undefined;
}

export function safeIntakeSchemaPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length > 50) return false;
  if (path === "summary" || path === "observations" || path === "suggestions") return true;
  const observation = /^observations\[(\d{1,2})\](?:\.(field|quote|ambiguous))?$/.exec(path);
  if (observation) return Number(observation[1]) <= intakeModelLimits.observations;
  const suggestion = /^suggestions\[(\d)\](?:\.(field|question|reason|options|dependsOn)(?:\[(\d)\])?)?$/.exec(path);
  return !!suggestion && Number(suggestion[1]) <= intakeModelLimits.suggestions &&
    (suggestion[3] === undefined || (suggestion[2] === "options" && Number(suggestion[3]) <= intakeModelLimits.options));
}

export class IntakeTrace {
  firstFailure?: IntakeCode;
  latestFailure?: IntakeCode;
  terminalFailure?: IntakeCode;
  availability: "AVAILABLE" | "DISABLED" | "UNAVAILABLE";
  private count = 0;
  private closed = false;
  constructor(readonly id: string, private readonly sink?: IntakeTraceSink) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error("INVALID_TRACE_ID");
    this.availability = sink ? "AVAILABLE" : "DISABLED";
  }
  record(event: IntakeStage, code: IntakeCode, extra: { attempt?: number; operationId?: string; revision?: number; httpStatus?: number; field?: string; issue?: string; path?: string; limit?: number; modelId?: string; durationMs?: number } = {}) {
    if (this.closed) return;
    if (!intakeStages.includes(event) || !intakeCodes.includes(code)) return;
    if (code !== "STARTED" && code !== "PASSED" && code !== "SUCCEEDED") {
      this.firstFailure ??= code;
      this.latestFailure = code;
    }
    if (!this.sink || this.availability !== "AVAILABLE") return;
    if (this.count >= 48) { this.availability = "UNAVAILABLE"; return; }
    const safe: IntakeTraceEvent = { at: new Date().toISOString(), agentId: "coordinator", event, code, traceId: this.id };
    if (Number.isInteger(extra.attempt) && extra.attempt! >= 1 && extra.attempt! <= 2) safe.attempt = extra.attempt;
    if (extra.operationId && /^[a-f0-9-]{36}$/i.test(extra.operationId)) safe.operationId = extra.operationId;
    if (Number.isInteger(extra.revision) && extra.revision! >= 0) safe.revision = extra.revision;
    if (Number.isInteger(extra.httpStatus) && extra.httpStatus! >= 100 && extra.httpStatus! <= 599) safe.httpStatus = extra.httpStatus;
    if (extra.field && fields.has(extra.field)) safe.field = extra.field;
    if (extra.issue && issues.has(extra.issue)) safe.issue = extra.issue;
    if (event === "output_schema" && safeIntakeSchemaPath(extra.path)) {
      safe.path = extra.path;
      if (safe.issue === "too_big" && extra.limit === intakeSchemaLimit(extra.path)) safe.limit = extra.limit;
    }
    if (extra.modelId) safe.modelId = extra.modelId === "claude-haiku-5-5" || extra.modelId === "fixture" ? extra.modelId : "other";
    if (Number.isSafeInteger(extra.durationMs) && extra.durationMs! >= 0 && extra.durationMs! <= 120_000) safe.durationMs = extra.durationMs;
    try { this.sink(safe); this.count++; } catch { this.availability = "UNAVAILABLE"; }
  }
  finish(code: IntakeCode) {
    if (this.closed) return;
    this.record("outcome", code);
    this.closed = true;
  }
}

export function localIntakeTrace(id: string): IntakeTrace {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error("INVALID_TRACE_ID");
  if (process.env.NODE_ENV === "production") return new IntakeTrace(id);
  const path = join(process.cwd(), ".tools", "intake-runs", id);
  return new IntakeTrace(id, event => {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    appendFileSync(join(path, "events.jsonl"), JSON.stringify(event) + "\n", { encoding: "utf8", mode: 0o600 });
  });
}
