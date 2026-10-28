import { z } from "zod";
import { inspectText } from "../../contracts/input-policy";
import { LC_FRESHNESS_MS, isLcFresh, lcConceptSchema, lcQuerySchema, type LcConcept, type LcKind, type LcLookup } from "../../contracts/vocabulary";

const HOST = "https://id.loc.gov";
const MAX_BYTES = 262_144;
const cache = new Map<string, { expires: number; result: LcLookup }>();
const hitSchema = z.object({ uri: z.string(), aLabel: z.string(), more: z.object({ rdftypes: z.array(z.string()) }) });
const envelopeSchema = z.object({ hits: z.array(z.unknown()).max(3) });

function parseHit(raw: unknown, kind: LcKind, sourceUrl: string, retrievedAt: string): LcConcept | null {
  const hit = hitSchema.safeParse(raw);
  if (!hit.success) return null;
  const prefix = kind === "genreForm" ? "genreForms/gf" : "subjects/sh";
  const rdfType = kind === "genreForm" ? "GenreForm" : "Topic";
  if (!hit.data.uri.startsWith(`http://id.loc.gov/authorities/${prefix}`) ||
      !hit.data.more.rdftypes.includes(rdfType) ||
      inspectText(hit.data.aLabel, "label", "authorityLabel", "lc").verdict !== "ACCEPT") return null;
  const parsed = lcConceptSchema.safeParse({ kind, uri: hit.data.uri, label: hit.data.aLabel, sourceUrl, retrievedAt });
  return parsed.success ? parsed.data : null;
}

async function readBounded(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES || !response.body) throw Error("INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  const interrupted = new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(Error("TIMEOUT")), { once: true }));
  try {
    while (true) {
      if (signal.aborted) throw Error("TIMEOUT");
      const { value, done } = await Promise.race([reader.read(), interrupted]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw Error("RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw Error("INVALID_RESPONSE"); }
}

/** One explicit, bounded lookup. Invalid provider records never become choices. */
export async function lookupLcVocabulary(kind: LcKind, words: string, fetcher: typeof fetch = fetch): Promise<LcLookup> {
  const query = lcQuerySchema.parse(words);
  const path = kind === "genreForm" ? "genreForms" : "subjects";
  const url = new URL(`${HOST}/authorities/${path}/suggest2`);
  url.searchParams.set("q", query); url.searchParams.set("searchtype", "keyword"); url.searchParams.set("count", "3");
  const key = `${kind}:${query.toLocaleLowerCase()}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now() && isLcFresh(cached.result.retrievedAt)) return cached.result;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("TIMEOUT"), 15_000);
  const retrievedAt = new Date().toISOString();
  let result: LcLookup = { status: "unavailable", reasonCode: "PROVIDER_UNAVAILABLE", kind, query, candidates: [], retrievedAt };
  try {
    const response = await Promise.race([fetcher(url, { method: "GET", redirect: "error", signal: controller.signal,
      headers: { Accept: "application/x-suggestions+json, application/json" } }),
      new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(Error("TIMEOUT")), { once: true }))]);
    if (!response.ok) throw Error(response.status === 429 ? "RATE_LIMITED" : "PROVIDER_HTTP_ERROR");
    const parsed = envelopeSchema.safeParse(await readBounded(response, controller.signal));
    if (!parsed.success) throw Error("INVALID_RESPONSE");
    const candidates = parsed.data.hits.map(hit => parseHit(hit, kind, url.toString(), retrievedAt)).filter((item): item is LcConcept => item !== null);
    result = { status: candidates.length ? "available" : "empty", reasonCode: candidates.length ? "OK" : "NO_VERIFIED_CHOICES", kind, query, candidates, retrievedAt };
  } catch (error) {
    result.reasonCode = controller.signal.aborted ? "TIMEOUT" : error instanceof Error &&
      ["RATE_LIMITED", "PROVIDER_HTTP_ERROR", "INVALID_RESPONSE", "RESPONSE_TOO_LARGE"].includes(error.message) ? error.message : "PROVIDER_UNAVAILABLE";
  } finally { clearTimeout(timer); }
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  if (result.status !== "unavailable") cache.set(key, { expires: Date.parse(retrievedAt) + LC_FRESHNESS_MS, result });
  return result;
}
