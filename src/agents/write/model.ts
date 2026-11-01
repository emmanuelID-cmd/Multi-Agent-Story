import { z } from "zod";

export type WriteAgentRole =
  | "chapter_writer_1"
  | "chapter_writer_2"
  | "chapter_writer_3"
  | "critic_editor_a"
  | "critic_editor_b";

export type WriteModelCall = {
  role: WriteAgentRole;
  system: string;
  data: unknown;
  schema: z.ZodType;
  maxOutputTokens?: number;
  temperature?: number;
  signal: AbortSignal;
};

export type WriteModelResponse = {
  value: unknown;
  usage: { inputTokens: number; outputTokens: number };
  modelUsed: string;
};

export interface WriteModel {
  complete(call: WriteModelCall): Promise<WriteModelResponse>;
}

export class ModelHttpError extends Error {
  constructor(readonly status: number) {
    super(status === 429 ? "MODEL_RATE_LIMITED" : "MODEL_UNAVAILABLE");
  }
}

const MAX_RESPONSE_BYTES = 1_048_576; // 1MB payload limit

const envelope = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).max(16),
  stop_reason: z.string(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

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
        result[key] = Object.fromEntries(
          Object.entries(source[key]).map(([name, child]) => [name, convert(child)])
        );
    }
    for (const key of ["items", "anyOf", "allOf"]) {
      if (key in source) result[key] = convert(source[key]);
    }
    if (source.minItems === 1) result.minItems = 1;
    if (source.type === "object" || "properties" in source) result.additionalProperties = false;
    return result;
  }
  return convert(z.toJSONSchema(schema)) as Record<string, unknown>;
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("MODEL_RESPONSE_INVALID");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let complete = false;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error("CANCELED");
      const next = await reader.read();
      if (next.done) {
        complete = true;
        break;
      }
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
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error("MODEL_RESPONSE_INVALID");
  }
}

export interface AnthropicWriteModelOptions {
  writerModelId?: string;
  criticModelId?: string;
  fetcher?: typeof fetch;
}

export class AnthropicWriteModel implements WriteModel {
  readonly writerModelId: string;
  readonly criticModelId: string;
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly apiKey: string,
    options?: AnthropicWriteModelOptions
  ) {
    if (!apiKey) throw new Error("MODEL_CREDENTIAL_UNAVAILABLE");
    this.writerModelId =
      options?.writerModelId ||
      process.env.WRITE_WRITER_MODEL_ID ||
      "claude-haiku-5-5";
    this.criticModelId =
      options?.criticModelId ||
      process.env.WRITE_CRITIC_MODEL_ID ||
      (process.env.NODE_ENV === "test" ? "claude-haiku-5-5" : "claude-3-5-sonnet-20241022");
    this.fetcher = options?.fetcher || fetch;
  }

  resolveModelForRole(role: WriteAgentRole): string {
    if (role.startsWith("chapter_writer_")) {
      return this.writerModelId;
    }
    return this.criticModelId;
  }

  resolveDefaultTemperature(role: WriteAgentRole): number {
    switch (role) {
      case "chapter_writer_1":
      case "chapter_writer_2":
      case "chapter_writer_3":
        return 0.7;
      case "critic_editor_a":
        return 0.4; // Fontaine: disciplined, continuity & pacing
      case "critic_editor_b":
        return 0.8; // Lang: expressive, voice & atmosphere
    }
  }

  resolveDefaultMaxTokens(role: WriteAgentRole): number {
    return role.startsWith("chapter_writer_") ? 4096 : 8192;
  }

  async complete(call: WriteModelCall): Promise<WriteModelResponse> {
    const model = this.resolveModelForRole(call.role);
    const temperature = call.temperature ?? this.resolveDefaultTemperature(call.role);
    const maxTokens = call.maxOutputTokens ?? this.resolveDefaultMaxTokens(call.role);

    const bodyObj: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      temperature,
      system: call.system,
      messages: [{ role: "user", content: JSON.stringify({ storyContext: call.data }) }],
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: modelWireSchema(call.schema) },
      },
    };

    let response = await this.fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST",
      redirect: "error",
      signal: call.signal,
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(bodyObj),
    });

    if (!response.ok && response.status === 400) {
      try {
        const errText = await response.clone().text();
        if (errText.includes("temperature")) {
          delete bodyObj.temperature;
          response = await this.fetcher("https://api.anthropic.com/v1/messages", {
            method: "POST",
            redirect: "error",
            signal: call.signal,
            headers: {
              "content-type": "application/json",
              "anthropic-version": "2023-06-01",
              "x-api-key": this.apiKey,
            },
            body: JSON.stringify(bodyObj),
          });
        }
      } catch {}
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ModelHttpError(response.status);
    }

    const parsed = envelope.safeParse(await boundedJson(response, call.signal));
    if (!parsed.success) throw new Error("MODEL_RESPONSE_INVALID");
    if (parsed.data.stop_reason === "max_tokens") {
      throw new Error("MODEL_RESPONSE_TRUNCATED");
    }
    if (parsed.data.content.some(part => !["text", "thinking", "redacted_thinking"].includes(part.type))) {
      throw new Error("MODEL_RESPONSE_INVALID");
    }

    const textBlocks = parsed.data.content.filter(part => part.type === "text");
    if (textBlocks.length !== 1 || !textBlocks[0].text) throw new Error("MODEL_RESPONSE_INVALID");

    let value: unknown;
    try {
      value = JSON.parse(textBlocks[0].text);
    } catch {
      throw new Error("MODEL_RESPONSE_INVALID");
    }

    return {
      value,
      usage: {
        inputTokens: parsed.data.usage.input_tokens,
        outputTokens: parsed.data.usage.output_tokens,
      },
      modelUsed: model,
    };
  }
}

export function writeModelFromEnvironment(options?: AnthropicWriteModelOptions): AnthropicWriteModel {
  const key = process.env.WRITE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("MODEL_CREDENTIAL_UNAVAILABLE");
  return new AnthropicWriteModel(key, options);
}
