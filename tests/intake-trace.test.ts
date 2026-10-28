import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeIntake } from "../src/agents/intake";
import { AnthropicReadModel, type ModelCall, type ReadModel } from "../src/agents/read/model";
import { IntakeTrace, type IntakeCode, type IntakeTraceEvent } from "../src/server/intake-trace";
import { updateProjectIntake, type IntakeRepository } from "../src/server/intake";
import { briefSchema, type Brief } from "../src/contracts";
import { AppError } from "../src/server/projects";

const raw = "Mara finds a signal at the harbor.";
const evidence: { case: string; expected: string; actual: string; events: IntakeTraceEvent[] }[] = [];
function capture(name: string, expected: IntakeCode, t: ReturnType<typeof trace>) {
  t.value.finish(name === "normal" || name === "grounding_repair" ? "SUCCEEDED" : expected);
  evidence.push({ case: name, expected, actual: t.value.firstFailure ?? "SUCCEEDED", events: t.events });
}
afterAll(() => {
  if (process.env.INTAKE_TRACE_EVIDENCE !== "1") return;
  const dir = join(process.cwd(), ".tools", "reviews", "intake-trace-cases");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const item of evidence) writeFileSync(join(dir, `${item.case}.jsonl`), item.events.map(event => JSON.stringify(event)).join("\n") + "\n", { mode: 0o600 });
  writeFileSync(join(process.cwd(), ".tools", "reviews", "intake-trace-evidence.json"), JSON.stringify({
    version: 1, kind: "synthetic-unit-evidence", prd: "PRD-v4-draft", promptVersion: "intake-v1",
    model: "claude-haiku-5-5 production configuration; fixture model for deterministic tests", fixtureVersion: 1,
    cases: evidence.map(({ case: name, expected, actual, events }) => ({ case: name, expected, actual, outcome: events.at(-1)?.code, eventCount: events.length, pass: expected === actual })),
    limitation: "Unit fixtures and local trace events only; no live provider, database, or formal independent trace audit.",
  }, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(join(process.cwd(), ".tools", "reviews", "intake-trace-fixtures.json"), JSON.stringify({
    version: 1, kind: "synthetic-protected-fixture", rawText: raw, modelOutput: valid,
    notes: "This local ignored fixture contains invented prose solely for deterministic tests. It is never a trace event.",
  }, null, 2) + "\n", { mode: 0o600 });
});
const valid = { summary: "A signal is found.", observations: [{ field: "characters", quote: "Mara", ambiguous: false }],
  suggestions: [{ field: "genre", question: "Which genre?", reason: "Genre is absent.", options: ["Mystery"], dependsOn: null }] };
function trace() {
  const events: IntakeTraceEvent[] = [];
  const value = new IntakeTrace("5e3939d8-6d4c-4ba4-8f76-7fc6296e25a4", event => events.push(event));
  return { value, events };
}
function model(values: unknown[]): ReadModel {
  let index = 0;
  return { modelId: "fixture", complete: vi.fn(async () => ({ value: values[index++], usage: { inputTokens: 1, outputTokens: 2 } })) };
}
function repository() {
  let brief: Brief = briefSchema.parse({ premise: raw, genre: "", audience: "", tone: "", desiredEnding: "",
    intake: { version: 1, revision: 0, rawText: raw, status: "draft", decisions: [] } });
  const value: IntakeRepository = { mutate: async (_owner, _project, change) => {
    brief = change(brief, false);
    return { brief };
  } };
  return { value, get brief() { return brief; } };
}

describe("Coordinator intake diagnostics", () => {
  it("records a normal single-attempt completion", async () => {
    const t = trace();
    await analyzeIntake("owner-trace-normal", raw, model([valid]), undefined, t.value);
    expect(t.value.firstFailure).toBeUndefined();
    expect(t.events).toContainEqual(expect.objectContaining({ event: "model_request", code: "PASSED", attempt: 1 }));
    capture("normal", "SUCCEEDED", t);
  });
  it("records each attempt and retains the first bad quote after a valid repair", async () => {
    const t = trace();
    const result = await analyzeIntake("owner-trace-1", raw, model([{ ...valid, observations: [{ field: "characters", quote: "not in source", ambiguous: false }] }, valid]), undefined, t.value);
    expect(result.observations[0].quote).toBe("Mara");
    expect(t.value.firstFailure).toBe("OUTPUT_QUOTE_INVALID");
    expect(t.events).toEqual(expect.arrayContaining([expect.objectContaining({ event: "grounding", code: "OUTPUT_QUOTE_INVALID", attempt: 1, field: "characters" }), expect.objectContaining({ event: "model_request", code: "PASSED", attempt: 2, modelId: "fixture" })]));
    expect(JSON.stringify(t.events)).not.toContain(raw);
    expect(JSON.stringify(t.events)).not.toContain("not in source");
    capture("grounding_repair", "OUTPUT_QUOTE_INVALID", t);
  });

  it("distinguishes schema and dependency failures without recording returned content", async () => {
    for (const [bad, expected] of [[{ ...valid, summary: "" }, "OUTPUT_SCHEMA_INVALID"], [{ ...valid, suggestions: [{ ...valid.suggestions[0], dependsOn: "genre" }] }, "OUTPUT_DEPENDENCY_INVALID"]] as const) {
      const t = trace();
      await expect(analyzeIntake("owner-trace-2", raw, model([bad, bad]), undefined, t.value)).rejects.toThrow();
      expect(t.value.firstFailure).toBe(expected);
      expect(t.events.filter(event => event.code === expected)).toHaveLength(2);
      expect(JSON.stringify(t.events)).not.toContain("Genre is absent");
      capture(expected === "OUTPUT_SCHEMA_INVALID" ? "schema" : "dependency", expected, t);
    }
  });

  it("classifies provider stop and malformed text JSON while keeping the first failure", async () => {
    for (const [body, expected] of [[{ content: [], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 1 } }, "MODEL_STOP_MAX_TOKENS"],
      [{ content: [{ type: "text", text: "{secret-canary" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }, "MODEL_JSON_INVALID"]] as const) {
      const t = trace();
      const adapter = new AnthropicReadModel("secret-key-canary", async () => Response.json(body));
      await expect(analyzeIntake("owner-trace-3", raw, adapter, undefined, t.value)).rejects.toThrow();
      expect(t.value.firstFailure).toBe(expected);
      expect(t.events).toContainEqual(expect.objectContaining({ event: "model_http", code: "PASSED", httpStatus: 200, attempt: 1 }));
      expect(JSON.stringify(t.events)).not.toMatch(/secret-canary|secret-key-canary|Mara/);
      capture(expected === "MODEL_STOP_MAX_TOKENS" ? "model_stop" : "model_json", expected, t);
    }
  });

  it("classifies HTTP status without provider body or credentials", async () => {
    const t = trace();
    const adapter = new AnthropicReadModel("secret-key-canary", async () => new Response("secret-body-canary", { status: 429 }));
    await expect(analyzeIntake("owner-trace-4", raw, adapter, undefined, t.value)).rejects.toThrow();
    expect(t.value.firstFailure).toBe("MODEL_HTTP_RATE_LIMIT");
    expect(t.events).toContainEqual(expect.objectContaining({ event: "model_http", code: "MODEL_HTTP_RATE_LIMIT", httpStatus: 429 }));
    expect(JSON.stringify(t.events)).not.toMatch(/secret-body-canary|secret-key-canary/);
  });

  it("classifies a declared oversized provider body before parsing it", async () => {
    const t = trace();
    const adapter = new AnthropicReadModel("secret-key-canary", async () => new Response("secret-body-canary", { headers: { "content-length": "1048577" } }));
    await expect(analyzeIntake("owner-trace-oversize", raw, adapter, undefined, t.value)).rejects.toThrow();
    expect(t.value.firstFailure).toBe("MODEL_RESPONSE_TOO_LARGE");
    expect(JSON.stringify(t.events)).not.toMatch(/secret-body-canary|secret-key-canary/);
  });

  it("classifies a throwing response stream as transport rather than JSON", async () => {
    const t = trace();
    const stream = new ReadableStream<Uint8Array>({ pull() { throw Error("private-stream-error"); } });
    const adapter = new AnthropicReadModel("secret-key-canary", async () => new Response(stream));
    await expect(analyzeIntake("owner-trace-stream", raw, adapter, undefined, t.value)).rejects.toThrow();
    expect(t.value.firstFailure).toBe("MODEL_STREAM_ERROR");
    expect(t.events).toContainEqual(expect.objectContaining({ event: "model_envelope", code: "MODEL_STREAM_ERROR", attempt: 1 }));
    expect(t.events).not.toContainEqual(expect.objectContaining({ code: "MODEL_JSON_INVALID" }));
    expect(JSON.stringify(t.events)).not.toMatch(/private-stream-error|secret-key-canary/);
  });

  it("classifies a successful response with no body as an invalid envelope", async () => {
    const t = trace();
    const adapter = new AnthropicReadModel("secret-key-canary", async () => new Response(null, { status: 200 }));
    await expect(analyzeIntake("owner-trace-empty-body", raw, adapter, undefined, t.value)).rejects.toThrow();
    expect(t.value.firstFailure).toBe("MODEL_ENVELOPE_INVALID");
    expect(t.events).toContainEqual(expect.objectContaining({ event: "model_http", code: "PASSED", httpStatus: 200 }));
    expect(t.events).toContainEqual(expect.objectContaining({ event: "model_envelope", code: "MODEL_ENVELOPE_INVALID", attempt: 1 }));
    expect(t.events).not.toContainEqual(expect.objectContaining({ code: "MODEL_JSON_INVALID" }));
    expect(JSON.stringify(t.events)).not.toContain("secret-key-canary");
  });

  it("records stale persistence and cancellation while preserving the saved idea", async () => {
    const r = repository(); const t = trace();
    let release!: (value: { value: typeof valid; usage: { inputTokens: number; outputTokens: number } }) => void;
    const delayed: ReadModel = { modelId: "fixture", complete: () => new Promise(resolve => { release = resolve; }) };
    const pending = updateProjectIntake("owner-trace-5", "project", { action: "analyze", expectedRevision: 0 }, { repository: r.value, model: delayed, trace: t.value });
    await Promise.resolve();
    await updateProjectIntake("owner-trace-5", "project", { action: "save", expectedRevision: 1, rawText: "Changed idea." }, { repository: r.value });
    release({ value: valid, usage: { inputTokens: 1, outputTokens: 1 } });
    await expect(pending).rejects.toMatchObject({ status: 409 });
    expect(t.value.firstFailure).toBe("STALE_INPUT");
    capture("stale", "STALE_INPUT", t);
    expect(r.brief.intake).toMatchObject({ status: "draft", rawText: "Changed idea." });

    const c = repository(); const ct = trace(); const abort = new AbortController();
    const wait: ReadModel = { modelId: "fixture", complete: () => new Promise(() => {}) };
    const canceled = updateProjectIntake("owner-trace-6", "project", { action: "analyze", expectedRevision: 0 }, { repository: c.value, model: wait, signal: abort.signal, trace: ct.value });
    await Promise.resolve(); abort.abort();
    await expect(canceled).rejects.toMatchObject({ status: 503 });
    expect(ct.value.firstFailure).toBe("CANCELED");
    capture("cancel", "CANCELED", ct);
    expect(c.brief.intake).toMatchObject({ status: "draft", rawText: raw });
  });

  it("records the timeout category without waiting for a real model", async () => {
    vi.useFakeTimers();
    try {
      const t = trace();
      const wait: ReadModel = { modelId: "fixture", complete: () => new Promise(() => {}) };
      const pending = analyzeIntake("owner-trace-timeout", raw, wait, undefined, t.value);
      const assertion = expect(pending).rejects.toThrow("INTAKE_CANCELED");
      await vi.advanceTimersByTimeAsync(35_001);
      await assertion;
      expect(t.value.firstFailure).toBe("TIMED_OUT");
      capture("timeout", "TIMED_OUT", t);
    } finally { vi.useRealTimers(); }
  });

  it("withholds a provider callback that arrives after cancellation", async () => {
    const t = trace(); const abort = new AbortController();
    let call: ModelCall | undefined;
    const wait: ReadModel = { modelId: "fixture", complete: async next => { call = next; return new Promise(() => {}); } };
    const pending = analyzeIntake("owner-trace-late", raw, wait, abort.signal, t.value);
    abort.abort();
    await expect(pending).rejects.toThrow("INTAKE_CANCELED");
    const count = t.events.length;
    call?.onDiagnostic?.("model_http", "PASSED", 200);
    expect(t.events).toHaveLength(count);
    expect(t.value.firstFailure).toBe("CANCELED");
    t.value.finish("CANCELED");
    expect(t.events.filter(event => event.event === "outcome")).toHaveLength(1);
    t.value.record("model_json", "PASSED");
    expect(t.events.filter(event => event.event === "outcome")).toHaveLength(1);
  });

  it("classifies reservation and final persistence failures at their actual boundaries", async () => {
    for (const failAt of [1, 2]) {
      const r = repository(); const t = trace(); let calls = 0;
      const broken: IntakeRepository = { mutate: async (owner, project, change) => {
        if (++calls === failAt) throw Error("private database canary");
        return r.value.mutate(owner, project, change);
      } };
      await expect(updateProjectIntake(`owner-trace-db-${failAt}`, "project", { action: "analyze", expectedRevision: 0 },
        { repository: broken, model: model([valid]), trace: t.value })).rejects.toThrow();
      expect(t.value.firstFailure).toBe("PERSIST_FAILED");
      expect(t.events).toContainEqual(expect.objectContaining({ event: failAt === 1 ? "reserved" : "persist", code: "PERSIST_FAILED" }));
      expect(JSON.stringify(t.events)).not.toContain("private database canary");
      expect(r.brief.intake).toMatchObject({ status: "draft", rawText: raw });
    }
  });

  it("distinguishes reservation guards and owner-scoped absence", async () => {
    const base = repository().brief;
    const cases = [
      { name: "story started", brief: base, started: true, revision: 0, code: "STORY_STARTED" },
      { name: "no intake", brief: { ...base, intake: undefined } as Brief, started: false, revision: 0, code: "INTAKE_UNAVAILABLE" },
      { name: "revision", brief: base, started: false, revision: 1, code: "REVISION_CONFLICT" },
      { name: "confirmed scope", brief: { ...base, intake: { ...base.intake!, status: "confirmed" } } as Brief, started: false, revision: 0, code: "SCOPE_CONFIRMED" },
      { name: "active analysis", brief: { ...base, intake: { ...base.intake!, status: "analyzing", startedAt: new Date().toISOString() } } as Brief, started: false, revision: 0, code: "ANALYSIS_IN_PROGRESS" },
    ] as const;
    for (const item of cases) {
      const t = trace();
      const guarded: IntakeRepository = { mutate: async (_owner, _project, change) => ({ brief: change(item.brief, item.started) }) };
      await expect(updateProjectIntake(`owner-reservation-${item.name}`, "project", { action: "analyze", expectedRevision: item.revision },
        { repository: guarded, model: model([valid]), trace: t.value })).rejects.toMatchObject({ status: 409 });
      expect(t.events).toContainEqual(expect.objectContaining({ event: "reserved", code: item.code }));
      expect(t.value.terminalFailure).toBe(item.code);
    }
    const t = trace();
    const absent: IntakeRepository = { mutate: async () => { throw new AppError(404, "Project unavailable."); } };
    await expect(updateProjectIntake("owner-reservation-absent", "project", { action: "analyze", expectedRevision: 0 },
      { repository: absent, model: model([valid]), trace: t.value })).rejects.toMatchObject({ status: 404 });
    expect(t.events).toContainEqual(expect.objectContaining({ event: "reserved", code: "PROJECT_UNAVAILABLE" }));
    expect(t.value.terminalFailure).toBe("PROJECT_UNAVAILABLE");
  });

  it("marks storage unavailable without changing analysis and filters arbitrary event fields", async () => {
    const t = new IntakeTrace("5e3939d8-6d4c-4ba4-8f76-7fc6296e25a4", () => { throw Error("disk secret canary"); });
    const result = await analyzeIntake("owner-trace-7", raw, model([valid]), undefined, t);
    expect(result.observations[0].quote).toBe("Mara");
    expect(t.availability).toBe("UNAVAILABLE");
    const events: IntakeTraceEvent[] = [];
    new IntakeTrace("5e3939d8-6d4c-4ba4-8f76-7fc6296e25a4", event => events.push(event))
      .record("request", "STARTED", { field: "secret-canary", issue: "secret-canary", modelId: "secret-canary" });
    expect(events[0]).toMatchObject({ modelId: "other" });
    expect(JSON.stringify(events)).not.toContain("secret-canary");
  });
});
