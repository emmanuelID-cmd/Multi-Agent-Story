import { z } from "zod";
import type { ReadVersions } from "./contracts";

export type ModelCall = {
  agent: "research" | "reader" | "consistency" | "coordinator";
  system: string; data: unknown; schema: z.ZodType;
  maxOutputTokens: number; signal: AbortSignal;
  onDiagnostic?: (stage: "model_http" | "model_envelope" | "model_json", category: "PASSED" | "MODEL_HTTP_AUTH" | "MODEL_HTTP_CONFIG" | "MODEL_HTTP_RATE_LIMIT" | "MODEL_HTTP_UNAVAILABLE" | "MODEL_ENVELOPE_INVALID" | "MODEL_STOP_MAX_TOKENS" | "MODEL_STOP_OTHER" | "MODEL_JSON_INVALID" | "MODEL_STREAM_ERROR" | "MODEL_RESPONSE_TOO_LARGE", httpStatus?: number) => void;
};
export type ModelResponse = { value: unknown; usage: { inputTokens: number; outputTokens: number } };
export interface ReadModel { readonly modelId: string; complete(call: ModelCall): Promise<ModelResponse> }

/** Retain only the HTTP status, never the provider's potentially sensitive error body. */
export class ModelHttpError extends Error {
  constructor(readonly status: number) {
    super(status === 429 ? "MODEL_RATE_LIMITED" : "MODEL_UNAVAILABLE");
  }
}

const MAX_RESPONSE_BYTES = 1_048_576;
const envelope = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).max(16),
  stop_reason: z.literal("end_turn"),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});

/** Keep the provider grammar small; Zod remains the authoritative full validator after response. */
export function modelWireSchema(schema: z.ZodType): Record<string, unknown> {
  function convert(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(convert);
    if (!value || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of ["type", "enum", "const", "$ref", "format", "required", "default"]) {
      if (key in source) result[key] = source[key];
    }
    for (const key of ["properties", "$defs", "definitions"]) {
      if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key]))
        result[key] = Object.fromEntries(Object.entries(source[key]).map(([name, child]) => [name, convert(child)]));
    }
    for (const key of ["items", "anyOf", "allOf"]) if (key in source) result[key] = convert(source[key]);
    if (source.minItems === 1) result.minItems = 1;
    if (source.type === "object" || "properties" in source) result.additionalProperties = false;
    return result;
  }
  return convert(z.toJSONSchema(schema)) as Record<string, unknown>;
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("MODEL_RESPONSE_TOO_LARGE");
  }
  if (!response.body) throw new Error("MODEL_RESPONSE_INVALID");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let complete = false;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error("CANCELED");
      let next: ReadableStreamReadResult<Uint8Array>;
      try { next = await reader.read(); }
      catch { throw new Error("MODEL_STREAM_ERROR"); }
      if (next.done) { complete = true; break; }
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("MODEL_RESPONSE_TOO_LARGE");
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new Error("MODEL_RESPONSE_INVALID"); }
}

/** Server-only model adapter. The injected fetcher is for synthetic tests; no network call occurs during construction. */
export class AnthropicReadModel implements ReadModel {
  readonly modelId = "claude-haiku-5-5";
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {
    if (!apiKey) throw new Error("MODEL_CREDENTIAL_UNAVAILABLE");
  }
  async complete(call: ModelCall): Promise<ModelResponse> {
    const response = await this.fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST", redirect: "error", signal: call.signal,
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": this.apiKey },
      body: JSON.stringify({
        model: this.modelId, max_tokens: call.maxOutputTokens,
        system: call.system,
        messages: [{ role: "user", content: JSON.stringify({ evidenceData: call.data }) }],
        output_config: { effort: "medium", format: { type: "json_schema", schema: modelWireSchema(call.schema) } },
      }),
    });
    if (!response.ok) {
      call.onDiagnostic?.("model_http", response.status === 429 ? "MODEL_HTTP_RATE_LIMIT" : [401, 403].includes(response.status) ? "MODEL_HTTP_AUTH" : [400, 404].includes(response.status) ? "MODEL_HTTP_CONFIG" : "MODEL_HTTP_UNAVAILABLE", response.status);
      await response.body?.cancel().catch(() => undefined);
      throw new ModelHttpError(response.status);
    }
    call.onDiagnostic?.("model_http", "PASSED", response.status);
    let body: unknown;
    try { body = await boundedJson(response, call.signal); }
    catch (error) {
      if (error instanceof Error && error.message === "MODEL_RESPONSE_TOO_LARGE") call.onDiagnostic?.("model_envelope", "MODEL_RESPONSE_TOO_LARGE");
      else if (error instanceof Error && error.message === "MODEL_STREAM_ERROR" && !call.signal.aborted) call.onDiagnostic?.("model_envelope", "MODEL_STREAM_ERROR");
      else if (!response.body) call.onDiagnostic?.("model_envelope", "MODEL_ENVELOPE_INVALID");
      else if (!call.signal.aborted) call.onDiagnostic?.("model_envelope", "MODEL_JSON_INVALID");
      throw error;
    }
    const parsed = envelope.safeParse(body);
    if (!parsed.success) {
      const stop = body && typeof body === "object" && "stop_reason" in body ? (body as { stop_reason: unknown }).stop_reason : undefined;
      call.onDiagnostic?.("model_envelope", stop === "max_tokens" ? "MODEL_STOP_MAX_TOKENS" : typeof stop === "string" && stop !== "end_turn" ? "MODEL_STOP_OTHER" : "MODEL_ENVELOPE_INVALID");
      throw new Error("MODEL_RESPONSE_INVALID");
    }
    if (parsed.data.content.some(part => !["text", "thinking", "redacted_thinking"].includes(part.type))) { call.onDiagnostic?.("model_envelope", "MODEL_ENVELOPE_INVALID"); throw new Error("MODEL_RESPONSE_INVALID"); }
    const textBlocks = parsed.data.content.filter(part => part.type === "text");
    if (textBlocks.length !== 1 || !textBlocks[0].text) { call.onDiagnostic?.("model_envelope", "MODEL_ENVELOPE_INVALID"); throw new Error("MODEL_RESPONSE_INVALID"); }
    call.onDiagnostic?.("model_envelope", "PASSED");
    let value: unknown;
    try { value = JSON.parse(textBlocks[0].text); } catch { call.onDiagnostic?.("model_json", "MODEL_JSON_INVALID"); throw new Error("MODEL_RESPONSE_INVALID"); }
    call.onDiagnostic?.("model_json", "PASSED");
    return { value, usage: { inputTokens: parsed.data.usage.input_tokens, outputTokens: parsed.data.usage.output_tokens } };
  }
}

export function modelFromEnvironment(): AnthropicReadModel {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("MODEL_CREDENTIAL_UNAVAILABLE");
  return new AnthropicReadModel(key);
}

export function assertModelVersion(model: ReadModel, versions: ReadVersions): void {
  if (model.modelId !== versions.model) throw new Error("MODEL_VERSION_MISMATCH");
}
