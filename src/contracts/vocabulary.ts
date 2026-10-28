import { z } from "zod";
import { inspectText } from "./input-policy";

export const LC_FRESHNESS_MS = 24 * 60 * 60 * 1000;
/** Future, invalid and expired timestamps cannot authorize vocabulary use. */
export function isLcFresh(retrievedAt: string, now = Date.now()): boolean {
  const age = now - Date.parse(retrievedAt);
  return Number.isFinite(age) && age >= 0 && age < LC_FRESHNESS_MS;
}

export const lcKindSchema = z.enum(["genreForm", "subject"]);
export type LcKind = z.infer<typeof lcKindSchema>;
export const lcQuerySchema = z.string().trim().min(1).max(80).refine(value =>
  inspectText(value, "label", "searchWords", "lc-lookup").verdict === "ACCEPT", "Enter short search words without hidden formatting.");
export const lcConceptSchema = z.strictObject({
  kind: lcKindSchema, uri: z.string().regex(/^http:\/\/id\.loc\.gov\/authorities\/(?:genreForms\/gf|subjects\/sh)[0-9]+$/),
  label: z.string().min(1).max(200), sourceUrl: z.url().startsWith("https://id.loc.gov/authorities/"),
  retrievedAt: z.iso.datetime(),
});
export type LcConcept = z.infer<typeof lcConceptSchema>;
export type LcLookup = { status: "available" | "empty" | "unavailable"; reasonCode: string; kind: LcKind;
  query: string; candidates: LcConcept[]; retrievedAt: string };
