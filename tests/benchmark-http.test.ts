import { describe, expect, it, vi } from "vitest";
import { getProjectBenchmarks, parseBenchmarkBody, verifyBenchmarkOrigin } from "../src/server/research/benchmark-http";
import type { readBookBenchmarks } from "../src/server/research/book-metadata";

const projectId = "a9f57b79-c0c8-409e-9f50-d5caf0b12345";
const body = (value: unknown) => new Request("http://localhost:3000/api/research/benchmarks", {
  method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify(value),
});
const input = { projectId, genre: "Mystery", providers: ["gutendex"] as ["gutendex"], nytList: "hardcover-fiction" as const, limit: 5 };
function stalledBody(signal?: AbortSignal) {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ cancel });
  const request = new Request("http://localhost:3000/api/research/benchmarks", {
    method: "POST", headers: { "content-type": "application/json" }, body: stream, signal, duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, cancel };
}

describe("authenticated project benchmark request boundary", () => {
  it("accepts only a bounded request with known fields and a valid project", async () => {
    const parsed = await parseBenchmarkBody(body({ projectId, genre: "Mystery" }));
    expect(parsed).toEqual({ projectId, genre: "Mystery", providers: ["nyt", "gutendex"], nytList: "hardcover-fiction", limit: 5 });
    for (const invalid of [
      { ...input, enabled: true }, { ...input, termsReviewed: true }, { ...input, nytKey: "client-key" },
      { ...input, url: "https://elsewhere.test" }, { ...input, providers: ["other"] },
      { ...input, genre: "Mystery\u200b" }, { ...input, projectId: "invalid" },
    ]) await expect(parseBenchmarkBody(body(invalid))).rejects.toMatchObject({ status: 400 });
  });

  it("rejects oversized, malformed, non-JSON, and cross-origin requests", async () => {
    await expect(parseBenchmarkBody(body({ projectId, genre: "x".repeat(5_000) }))).rejects.toMatchObject({ status: 400 });
    await expect(parseBenchmarkBody(new Request("http://localhost:3000/api/research/benchmarks", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{" },
    ))).rejects.toMatchObject({ status: 400 });
    await expect(parseBenchmarkBody(new Request("http://localhost:3000/api/research/benchmarks", {
      method: "POST", headers: { "content-type": "text/plain" }, body: "hi" },
    ))).rejects.toMatchObject({ status: 400 });
    expect(() => verifyBenchmarkOrigin(body({ projectId, genre: "Mystery" }))).not.toThrow();
    expect(() => verifyBenchmarkOrigin(new Request("http://localhost:3000/api/research/benchmarks", {
      headers: { origin: "https://elsewhere.test" },
    }))).toThrow("Request unavailable.");
  });

  it("ends a stalled body at five seconds and cancels the reader without waiting for stream cleanup", async () => {
    vi.useFakeTimers();
    try {
      const { request, cancel } = stalledBody();
      const rejection = expect(parseBenchmarkBody(request)).rejects.toMatchObject({ status: 400, message: "Invalid request body." });
      await vi.advanceTimersByTimeAsync(5_000);
      await rejection;
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(request.body?.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("cancels pre-aborted and mid-read aborted bodies promptly", async () => {
    for (const abortBeforeParse of [true, false]) {
      const controller = new AbortController();
      const { request, cancel } = stalledBody(controller.signal);
      if (abortBeforeParse) controller.abort();
      const rejection = expect(parseBenchmarkBody(request)).rejects.toMatchObject({ status: 400, message: "Invalid request body." });
      if (!abortBeforeParse) controller.abort();
      await rejection;
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(request.body?.locked).toBe(false);
    }
  });

  it("rejects a pre-aborted request even when valid JSON is already buffered", async () => {
    const controller = new AbortController();
    const request = new Request("http://localhost:3000/api/research/benchmarks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, genre: "Mystery" }), signal: controller.signal,
    });
    controller.abort();
    await expect(parseBenchmarkBody(request)).rejects.toMatchObject({ status: 400, message: "Invalid request body." });
    expect(request.body?.locked).toBe(false);
  });

  it("checks ownership before any provider call and uses the same generic 404 for missing and foreign projects", async () => {
    const read = vi.fn<typeof readBookBenchmarks>().mockResolvedValue([]);
    for (const ownerId of ["missing-owner", "other-owner"]) {
      const ownsProject = vi.fn(async () => false);
      await expect(getProjectBenchmarks(ownerId, input, { ownsProject, read })).rejects.toMatchObject({ status: 404, message: "Project unavailable." });
      expect(ownsProject).toHaveBeenCalledWith(ownerId, projectId);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("passes only validated metadata fields to the provider after ownership", async () => {
    const calls: string[] = [];
    const ownsProject = vi.fn(async () => { calls.push("ownership"); return true; });
    const read = vi.fn<typeof readBookBenchmarks>(async () => { calls.push("provider"); return []; });
    const result = await getProjectBenchmarks("owner", input, { ownsProject, read });
    expect(calls).toEqual(["ownership", "provider"]);
    expect(read).toHaveBeenCalledWith({ genre: "Mystery", providers: ["gutendex"], nytList: "hardcover-fiction", limit: 5 });
    expect(result).toEqual({ projectId, evidence: [] });
  });
});
