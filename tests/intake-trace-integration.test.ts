import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { briefSchema, type Brief } from "../src/contracts";
import { AnthropicReadModel, type ReadModel } from "../src/agents/read/model";
import { IntakeTrace, type IntakeTraceEvent } from "../src/server/intake-trace";
import type { IntakeRepository } from "../src/server/intake";
import { AppError } from "../src/server/projects";

const hooks = vi.hoisted(() => ({
  repository: undefined as IntakeRepository | undefined,
  model: undefined as ReadModel | undefined,
  traces: [] as { id: string; events: IntakeTraceEvent[] }[],
}));
vi.mock("@/contracts/intake", async () => await import("../src/contracts/intake"));
vi.mock("@/server/projects", async () => {
  const actual = await import("../src/server/projects");
  return {
    ...actual,
    getProjectById: async (id: string) => {
      if (id !== "synthetic-project") throw new actual.AppError(404, "Project unavailable.");
      return { id, ownerId: "synthetic-owner" };
    },
  };
});
vi.mock("@/server/intake-http", async () => await import("../src/server/intake-http"));
vi.mock("@/server/http", async () => {
  const { AppError } = await import("../src/server/projects");
  return {
    requireUser: async () => "synthetic-owner",
    sameOrigin: (request: Request) => { if (request.headers.get("origin") !== "http://localhost:3000") throw new AppError(403, "Request unavailable."); },
    failure: (error: unknown) => error instanceof AppError ? Response.json({ error: error.message }, { status: error.status }) : Response.json({ error: "Temporarily unavailable." }, { status: 503 }),
  };
});
vi.mock("@/server/intake-trace", async () => {
  const { IntakeTrace } = await import("../src/server/intake-trace");
  return { localIntakeTrace: (id: string) => {
    const captured = { id, events: [] as IntakeTraceEvent[] };
    hooks.traces.push(captured);
    return new IntakeTrace(id, event => captured.events.push(event));
  } };
});
vi.mock("@/server/intake", async () => {
  const actual = await import("../src/server/intake");
  return { updateProjectIntake: (owner: string, project: string, request: Parameters<typeof actual.updateProjectIntake>[2], dependencies: Parameters<typeof actual.updateProjectIntake>[3]) =>
    actual.updateProjectIntake(owner, project, request, { ...dependencies, repository: hooks.repository, model: hooks.model }) };
});
import { POST } from "../src/app/api/projects/[id]/intake/route";

const raw = "Mara finds a signal at the harbor.";
const modelOutput = { summary: "A signal is found.", observations: [{ field: "characters", quote: "Mara", ambiguous: false }],
  suggestions: [{ field: "genre", question: "Which genre?", reason: "Genre is absent.", options: ["Mystery"], dependsOn: null }] };
const captured: { case: string; expected: string; actual: string; httpStatus: number; correlated: boolean; preserved: boolean; events: IntakeTraceEvent[] }[] = [];
afterAll(() => {
  if (process.env.INTAKE_TRACE_EVIDENCE !== "1") return;
  const dir = join(process.cwd(), ".tools", "reviews");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "intake-trace-integration.json"), JSON.stringify({ version: 1, kind: "synthetic-whole-path", cases: captured,
    limits: "No live provider or database. HTTP bodies with story text are excluded from this artifact." }, null, 2) + "\n", { mode: 0o600 });
});
function repository() {
  let brief: Brief = briefSchema.parse({ premise: raw, genre: "", audience: "", tone: "", desiredEnding: "",
    intake: { version: 1, revision: 0, rawText: raw, status: "draft", decisions: [] } });
  const value: IntakeRepository = { mutate: async (_owner, _project, change) => { brief = change(brief, false); return { brief }; } };
  return { value, get brief() { return brief; } };
}
function request(signal?: AbortSignal) { return new Request("http://localhost:3000/api/projects/synthetic-project/intake", { method: "POST", signal,
  headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ action: "analyze", expectedRevision: 0 }) }); }
function wire(stopReason: "end_turn" | "max_tokens") {
  return { content: [{ type: "text", text: JSON.stringify(modelOutput) }], stop_reason: stopReason, usage: { input_tokens: 10, output_tokens: 20 } };
}

describe("synthetic authenticated intake trace correlation", () => {
  beforeEach(() => { hooks.traces.length = 0; hooks.repository = undefined; hooks.model = undefined; });
  it("returns Project unavailable for a missing id and reuses the stored owner for a known id", async () => {
    const missing = await POST(request(), { params: Promise.resolve({ id: "missing" }) });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Project unavailable." });
    expect(hooks.traces).toHaveLength(0);
    const state = repository();
    let seenOwner = "";
    hooks.repository = { mutate: async (owner, project, change) => { seenOwner = owner; return state.value.mutate(owner, project, change); } };
    hooks.model = new AnthropicReadModel("synthetic-key-canary", async () => Response.json(wire("end_turn")));
    const known = await POST(request(), { params: Promise.resolve({ id: "synthetic-project" }) });
    expect(known.status).toBe(200);
    expect(seenOwner).toBe("synthetic-owner");
  });
  it.each([["normal", "end_turn", 200, "SUCCEEDED"], ["model_stop", "max_tokens", 503, "MODEL_STOP_MAX_TOKENS"]] as const)(
    "%s follows POST through the model and persistence boundary", async (name, stopReason, expectedStatus, expectedCode) => {
      const state = repository(); hooks.repository = state.value;
      let calls = 0;
      hooks.model = new AnthropicReadModel("synthetic-key-canary", async () => { calls++; return Response.json(wire(stopReason)); });
      const response = await POST(request(), { params: Promise.resolve({ id: "synthetic-project" }) });
      const body = await response.json();
      const trace = hooks.traces[0];
      expect(calls).toBe(1);
      expect(response.status).toBe(expectedStatus);
      expect(body.traceId).toBe(trace.id);
      expect(response.headers.get("x-trace-id")).toBe(trace.id);
      expect(trace.events.every(event => event.traceId === trace.id)).toBe(true);
      expect(trace.events.map(event => event.event)).toEqual(name === "normal" ?
        ["request", "request", "reserved", "reserved", "input_read", "model_request", "model_http", "model_envelope", "model_json", "output_schema", "grounding", "dependencies", "model_request", "persist", "persist", "outcome"] :
        ["request", "request", "reserved", "reserved", "input_read", "model_request", "model_http", "model_envelope", "model_request", "outcome"]);
      expect(trace.events.at(-1)?.code).toBe(expectedCode);
      expect(trace.events.filter(event => event.event === "outcome")).toHaveLength(1);
      expect(JSON.stringify(trace.events)).not.toMatch(/Mara|harbor|synthetic-key-canary|A signal is found/);
      if (name === "normal") expect(state.brief.intake).toMatchObject({ status: "analyzed", rawText: raw });
      else {
        expect(body.reasonCode).toBe(expectedCode);
        expect(state.brief.intake).toMatchObject({ status: "draft", rawText: raw, revision: 2 });
      }
      captured.push({ case: name, expected: expectedCode, actual: trace.events.at(-1)?.code ?? "MISSING", httpStatus: response.status,
        correlated: body.traceId === response.headers.get("x-trace-id") && trace.events.every(event => event.traceId === body.traceId),
        preserved: state.brief.intake?.rawText === raw, events: trace.events });
    },
  );
  it("keeps an invalid first quote separate from a later provider rate limit", async () => {
    const state = repository(); hooks.repository = state.value;
    let calls = 0;
    hooks.model = new AnthropicReadModel("synthetic-key-canary", async () => {
      calls++;
      return calls === 1 ? Response.json({ ...wire("end_turn"), content: [{ type: "text", text: JSON.stringify({ ...modelOutput,
        observations: [{ field: "characters", quote: "private-invalid-quote", ambiguous: false }] }) }] }) :
        new Response("private-provider-body", { status: 429 });
    });
    const response = await POST(request(), { params: Promise.resolve({ id: "synthetic-project" }) });
    const body = await response.json();
    const events = hooks.traces[0].events;
    expect(calls).toBe(2);
    expect(response.status).toBe(503);
    expect(events.find(event => event.event === "grounding" && event.code !== "PASSED")?.code).toBe("OUTPUT_QUOTE_INVALID");
    expect(events).toContainEqual(expect.objectContaining({ event: "model_request", attempt: 2, code: "MODEL_HTTP_RATE_LIMIT" }));
    expect(events.at(-1)?.code).toBe("MODEL_HTTP_RATE_LIMIT");
    expect(body.reasonCode).toBe("MODEL_HTTP_RATE_LIMIT");
    expect(body.traceId).toBe(response.headers.get("x-trace-id"));
    expect(state.brief.intake).toMatchObject({ status: "draft", rawText: raw });
    expect(JSON.stringify(events)).not.toMatch(/private-invalid-quote|private-provider-body|synthetic-key-canary/);
  });
  it("keeps a repaired quote separate from a later stale save", async () => {
    const state = repository(); let mutations = 0;
    hooks.repository = { mutate: async (owner, project, change) => {
      if (++mutations === 2) {
        await state.value.mutate(owner, project, brief => ({ ...brief, intake: { ...brief.intake!, revision: 2, status: "draft", rawText: "Later saved idea.", decisions: [] } } as Brief));
      }
      return state.value.mutate(owner, project, change);
    } };
    let calls = 0;
    hooks.model = new AnthropicReadModel("synthetic-key-canary", async () => {
      calls++;
      return Response.json({ ...wire("end_turn"), content: [{ type: "text", text: JSON.stringify(calls === 1 ? { ...modelOutput,
        observations: [{ field: "characters", quote: "private-invalid-quote", ambiguous: false }] } : modelOutput) }] });
    });
    const response = await POST(request(), { params: Promise.resolve({ id: "synthetic-project" }) });
    const body = await response.json();
    const events = hooks.traces[0].events;
    expect(calls).toBe(2);
    expect(response.status).toBe(409);
    expect(events.find(event => event.event === "grounding" && event.code !== "PASSED")?.code).toBe("OUTPUT_QUOTE_INVALID");
    expect(events).toContainEqual(expect.objectContaining({ event: "model_request", attempt: 2, code: "PASSED" }));
    expect(events.at(-1)?.code).toBe("STALE_INPUT");
    expect(body.reasonCode).toBe("STALE_INPUT");
    expect(state.brief.intake).toMatchObject({ status: "draft", rawText: "Later saved idea." });
    expect(JSON.stringify(events)).not.toContain("private-invalid-quote");
  });
  it("reports cancellation at the final save barrier after repairing an earlier quote", async () => {
    const state = repository(); const abort = new AbortController(); let mutations = 0;
    hooks.repository = { mutate: async (owner, project, change) => {
      if (++mutations === 2) abort.abort();
      return state.value.mutate(owner, project, change);
    } };
    let calls = 0;
    hooks.model = new AnthropicReadModel("synthetic-key-canary", async () => {
      calls++;
      return Response.json({ ...wire("end_turn"), content: [{ type: "text", text: JSON.stringify(calls === 1 ? { ...modelOutput,
        observations: [{ field: "characters", quote: "private-invalid-quote", ambiguous: false }] } : modelOutput) }] });
    });
    const response = await POST(request(abort.signal), { params: Promise.resolve({ id: "synthetic-project" }) });
    const body = await response.json();
    const events = hooks.traces[0].events;
    expect(calls).toBe(2);
    expect(response.status).toBe(409);
    expect(events.find(event => event.event === "grounding" && event.code !== "PASSED")?.code).toBe("OUTPUT_QUOTE_INVALID");
    expect(events).toContainEqual(expect.objectContaining({ event: "persist", code: "CANCELED" }));
    expect(events).not.toContainEqual(expect.objectContaining({ event: "persist", code: "REVISION_CONFLICT" }));
    expect(events.at(-1)?.code).toBe("CANCELED");
    expect(body.reasonCode).toBe("CANCELED");
    expect(body.traceId).toBe(response.headers.get("x-trace-id"));
    expect(state.brief.intake).toMatchObject({ status: "draft", rawText: raw });
    expect(JSON.stringify(events)).not.toMatch(/private-invalid-quote|synthetic-key-canary/);
  });
  it.each(["story-started", "intake-unavailable", "project-unavailable"] as const)("classifies final save guard %s", async guard => {
    const state = repository(); let mutations = 0;
    hooks.repository = { mutate: async (owner, project, change) => {
      if (++mutations === 2) {
        if (guard === "story-started") return { brief: change(state.brief, true) };
        if (guard === "intake-unavailable") return { brief: change({ ...state.brief, intake: undefined } as Brief, false) };
        throw new AppError(404, "Project unavailable.");
      }
      return state.value.mutate(owner, project, change);
    } };
    hooks.model = new AnthropicReadModel("synthetic-key-canary", async () => Response.json(wire("end_turn")));
    const response = await POST(request(), { params: Promise.resolve({ id: "synthetic-project" }) });
    const body = await response.json();
    const expected = guard === "story-started" ? "STORY_STARTED" : guard === "intake-unavailable" ? "INTAKE_UNAVAILABLE" : "PROJECT_UNAVAILABLE";
    const events = hooks.traces[0].events;
    expect(response.status).toBe(guard === "project-unavailable" ? 404 : 409);
    expect(events).toContainEqual(expect.objectContaining({ event: "persist", code: expected }));
    expect(events).not.toContainEqual(expect.objectContaining({ event: "persist", code: "REVISION_CONFLICT" }));
    expect(events.at(-1)?.code).toBe(expected);
    expect(body.reasonCode).toBe(expected);
    expect(state.brief.intake).toMatchObject({ status: "draft", rawText: raw });
  });
});
