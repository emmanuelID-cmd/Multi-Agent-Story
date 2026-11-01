import { describe, expect, it } from "vitest";
import { canAcceptResearch, newestResearchCandidate, researchAcceptance, researchDetailSchema, researchListSchema } from "../src/app/research-review-model";

const id = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const summary = { id, version: 2, hash: "a".repeat(64), status: "pending" as const, current: true, gateRecommendation: "ACCEPT_CANDIDATE" as const };
const detail = { ...summary, dossier: { briefVersion: 1, scopeVersion: 1, gateRecommendation: "ACCEPT_CANDIDATE" as const,
  providerOutcomes: { nyt: { status: "available", reasonCode: "OK" }, gutendex: { status: "available", reasonCode: "OK" } },
  coverage: [{ dimensionId: "genre", status: "supported" as const }], gaps: [], sources: [], items: [], synthesis: [], limitations: [] } };

describe("Research review selection and acceptance", () => {
  it("selects the newest version regardless of response order and rejects ambiguous histories", () => {
    const older = { ...summary, id: operationId, version: 1 };
    expect(newestResearchCandidate([older, summary])).toEqual(summary);
    expect(newestResearchCandidate([])).toBeNull();
    expect(() => newestResearchCandidate([summary, { ...summary, id: operationId }])).toThrow("ambiguous");
  });
  it("requires matching newest ID, version, hash, pending status and supported evidence", () => {
    expect(canAcceptResearch(summary, detail)).toBe(true);
    expect(canAcceptResearch(null, detail)).toBe(false);
    expect(canAcceptResearch(summary, null)).toBe(false);
    expect(canAcceptResearch(summary, { ...detail, id: operationId })).toBe(false);
    expect(canAcceptResearch(summary, { ...detail, version: 3 })).toBe(false);
    expect(canAcceptResearch(summary, { ...detail, hash: "b".repeat(64) })).toBe(false);
    expect(canAcceptResearch(summary, { ...detail, status: "accepted" })).toBe(false);
    expect(canAcceptResearch({ ...summary, current: false }, detail)).toBe(false);
    expect(canAcceptResearch(summary, { ...detail, current: false })).toBe(false);
    expect(canAcceptResearch(summary, { ...detail, dossier: { ...detail.dossier, gateRecommendation: "BLOCKED_REQUIRED_EVIDENCE" } })).toBe(false);
    expect(canAcceptResearch({ ...summary, gateRecommendation: "BLOCKED_REQUIRED_EVIDENCE" }, detail)).toBe(false);
  });
  it("creates the exact server acceptance request without owner or evidence authority", () => {
    expect(researchAcceptance(detail, operationId)).toEqual({ candidateId: id, candidateVersion: 2,
      candidateHash: "a".repeat(64), operationId });
  });
  it("rejects malformed or incomplete responses before exposing a decision", () => {
    expect(researchListSchema.safeParse([summary]).success).toBe(true);
    expect(researchListSchema.safeParse([{ ...summary, hash: "bad" }]).success).toBe(false);
    expect(researchDetailSchema.safeParse(detail).success).toBe(true);
    expect(researchDetailSchema.safeParse({ ...detail, dossier: { ...detail.dossier, coverage: [{ dimensionId: "genre", status: "unknown" }] } }).success).toBe(false);
    expect(researchDetailSchema.safeParse({ ...detail, dossier: { ...detail.dossier, providerOutcomes: {} } }).success).toBe(false);
  });
  it("retains the located passage, source and confidence for review", () => {
    const item = { itemId: "e1", dimensionId: "genre", sourceId: "s1", kind: "located_text_observation",
      claim: "A bell builds suspense", locator: "chapter 1", quote: "A bell rang.", confidence: 0.7 };
    const parsed = researchDetailSchema.parse({ ...detail, dossier: { ...detail.dossier, items: [item] } });
    expect(parsed.dossier.items[0]).toEqual(item);
    expect(researchDetailSchema.safeParse({ ...detail, dossier: { ...detail.dossier, items: [{ ...item, confidence: 2 }] } }).success).toBe(false);
  });
});
