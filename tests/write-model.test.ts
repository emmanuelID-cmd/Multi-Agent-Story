import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicWriteModel, ModelHttpError } from "../src/agents/write/model";

const sampleSchema = z.strictObject({ text: z.string().min(1) });
const makeCall = (role: "chapter_writer_1" | "critic_editor_a" = "chapter_writer_1") => ({
  role,
  system: "You are Grimm.",
  data: { premise: "A dark forest tale." },
  schema: sampleSchema,
  signal: new AbortController().signal,
});

function makeReply(extra: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify({ text: "Once upon a time in the deep woods." }) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 50, output_tokens: 25 },
    ...extra,
  };
}

describe("WRITE Anthropic Boundary (J01)", () => {
  it("dispatches with correct headers, system prompt, and payload", async () => {
    let requests = 0;
    const fetcher: typeof fetch = async (url, init) => {
      requests++;
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(init?.redirect).toBe("error");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-api-key")).toBe("test-api-key");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");

      const body = JSON.parse(String(init?.body));
      expect(body.system).toBe("You are Grimm.");
      expect(body.model).toBe("claude-haiku-5-5");
      expect(body.temperature).toBe(0.7);
      expect(body.messages[0].content).toContain("dark forest");
      expect(body.output_config.format.type).toBe("json_schema");
      return Response.json(makeReply());
    };

    const model = new AnthropicWriteModel("test-api-key", { fetcher });
    const output = await model.complete(makeCall("chapter_writer_1"));

    expect(requests).toBe(1);
    expect(output.modelUsed).toBe("claude-haiku-5-5");
    expect(output.usage).toEqual({ inputTokens: 50, outputTokens: 25 });
    expect(output.value).toEqual({ text: "Once upon a time in the deep woods." });
  });

  it("routes Chapter Writers to Haiku and Critics to Sonnet by default", async () => {
    const modelsUsed: string[] = [];
    const temperaturesUsed: number[] = [];

    const fetcher: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      modelsUsed.push(body.model);
      temperaturesUsed.push(body.temperature);
      return Response.json(makeReply());
    };

    const model = new AnthropicWriteModel("test-api-key", {
      fetcher,
      writerModelId: "claude-haiku-5-5",
      criticModelId: "claude-3-5-sonnet-20241022",
    });

    // Test Writer 1 (Grimm)
    await model.complete(makeCall("chapter_writer_1"));
    expect(modelsUsed[0]).toBe("claude-haiku-5-5");
    expect(temperaturesUsed[0]).toBe(0.7);

    // Test Critic A (Fontaine)
    await model.complete(makeCall("critic_editor_a"));
    expect(modelsUsed[1]).toBe("claude-3-5-sonnet-20241022");
    expect(temperaturesUsed[1]).toBe(0.4);
  });

  it("routes Critic B (Lang) to temperature 0.8", async () => {
    let capturedTemp = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      capturedTemp = body.temperature;
      return Response.json(makeReply());
    };

    const model = new AnthropicWriteModel("test-api-key", { fetcher });
    await model.complete({
      ...makeCall("chapter_writer_1"),
      role: "critic_editor_b",
    });

    expect(capturedTemp).toBe(0.8);
  });

  it("rejects missing API key before dispatch", () => {
    expect(() => new AnthropicWriteModel("")).toThrow("MODEL_CREDENTIAL_UNAVAILABLE");
  });

  it.each([429, 500, 401])("sanitizes HTTP %i errors without exposing private details", async (status) => {
    const fetcher: typeof fetch = async () =>
      new Response("sensitive stack trace or raw prompt reflected", { status });
    const model = new AnthropicWriteModel("test-api-key", { fetcher });

    const err = await model.complete(makeCall("chapter_writer_1")).catch((e) => e);
    expect(err).toBeInstanceOf(ModelHttpError);
    expect(err.status).toBe(status);
    expect(err.message).toBe(status === 429 ? "MODEL_RATE_LIMITED" : "MODEL_UNAVAILABLE");
    expect(err.message).not.toContain("sensitive");
  });

  it("rejects responses exceeding 1MB payload limit", async () => {
    const fetcher: typeof fetch = async () =>
      new Response("{}", { headers: { "content-length": "1048577" } });
    const model = new AnthropicWriteModel("test-api-key", { fetcher });

    await expect(model.complete(makeCall("chapter_writer_1"))).rejects.toThrow("MODEL_RESPONSE_INVALID");
  });

  it("respects AbortSignal cancellation", async () => {
    const controller = new AbortController();
    controller.abort();

    const fetcher: typeof fetch = async () => Response.json(makeReply());
    const model = new AnthropicWriteModel("test-api-key", { fetcher });

    await expect(
      model.complete({
        ...makeCall("chapter_writer_1"),
        signal: controller.signal,
      })
    ).rejects.toThrow();
  });
});
