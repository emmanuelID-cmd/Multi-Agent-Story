import { describe, expect, it } from "vitest";
import { safeCoordinatorEvent } from "../scripts/intake-trace-view";

const id = "5e3939d8-6d4c-4ba4-8f76-7fc6296e25a4";
const safe = { at: "2026-10-27T18:00:00.000Z", agentId: "coordinator", event: "model_http", code: "MODEL_HTTP_RATE_LIMIT", traceId: id, attempt: 1, httpStatus: 429 };

describe("read-only intake trace viewer", () => {
  it("accepts a strict Coordinator event", () => {
    expect(safeCoordinatorEvent(safe, id)).toEqual(safe);
  });

  it("withholds tampered event values and extra fields", () => {
    for (const bad of [
      { ...safe, code: "secret-canary" }, { ...safe, field: "secret-canary" },
      { ...safe, issue: "secret-canary" }, { ...safe, secret: "secret-canary" },
      { ...safe, traceId: "../secret" }, { ...safe, httpStatus: 900 },
      { ...safe, modelId: "secret-canary" },
      { ...safe, event: "output_schema", path: "suggestions[0].secret-canary" },
      { ...safe, event: "output_schema", path: "suggestions[99].question" },
      { ...safe, event: "output_schema", issue: "too_big", path: "suggestions[0].question", limit: 999 },
    ]) expect(safeCoordinatorEvent(bad, id)).toBeNull();
  });

  it("accepts only the configured limit for an allowed property path", () => {
    const event = { ...safe, event: "output_schema", code: "OUTPUT_SCHEMA_INVALID", issue: "too_big", path: "suggestions[0].question", limit: 300 };
    expect(safeCoordinatorEvent(event, id)).toEqual(event);
  });
});
