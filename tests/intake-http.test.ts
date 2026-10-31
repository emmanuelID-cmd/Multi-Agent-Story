import { describe, expect, it, vi } from "vitest";
import { intakeJsonBody } from "../src/server/intake-http";
import { failure } from "../src/server/http";

function request(body: string, extra: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/projects", { method: "POST", headers: { "content-type": "application/json", ...extra }, body });
}
describe("bounded intake request bodies", () => {
  it("reads Unicode prose without changing it", async () => {
    expect(await intakeJsonBody(request(JSON.stringify({ rawText: "海の物語 — Café" })))).toEqual({ rawText: "海の物語 — Café" });
  });
  it("rejects malformed JSON, wrong type and oversized declared or streamed bodies", async () => {
    for (const r of [request("{"), request("{}", { "content-type": "text/plain" }), request("{}", { "content-length": "80001" }), request(JSON.stringify({ rawText: "x".repeat(80_001) }))])
      await expect(intakeJsonBody(r)).rejects.toMatchObject({ status: 400 });
  });
  it("stops a stalled stream on cancellation without waiting for another chunk", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const r = new Request("http://localhost:3000/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half", signal: controller.signal } as RequestInit & { duplex: "half" });
    const reading = intakeJsonBody(r);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ status: 400 });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("maps SyntaxError in failure() to 400 Bad Request", async () => {
    const res = failure(new SyntaxError("Unexpected token in JSON"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Check the request payload format." });
  });

  it("keeps a non-JSON SyntaxError on the unavailable path", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = failure(new SyntaxError("Unexpected token ')'"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Temporarily unavailable. Your saved work is preserved." });
    expect(logged).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledWith("Project request failed; private inputs omitted.");
    logged.mockRestore();
  });
});
