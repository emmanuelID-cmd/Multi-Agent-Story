import { describe, expect, it, vi } from "vitest";
import { intakeJsonBody } from "../src/server/intake-http";

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
});
