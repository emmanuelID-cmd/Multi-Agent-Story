import { z } from "zod";
import { intakeRecordSchema } from "../contracts/intake";

const identity = {
  id: z.uuid(),
  version: z.number().int().positive(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["pending", "accepted", "rejected"]),
  current: z.boolean(),
};
const coverage = z.object({ dimensionId: z.string(), status: z.enum(["supported", "partial", "missing"]) });
const gap = z.object({ dimensionId: z.string(), reason: z.string(), correction: z.string() });
const summarySchema = z.object({ ...identity, gateRecommendation: z.enum(["ACCEPT_CANDIDATE", "BLOCKED_REQUIRED_EVIDENCE"]) });
export const researchListSchema = z.array(summarySchema).max(50);
export const researchDetailSchema = z.object({
  ...identity,
  sourceReviews:z.array(z.object({sourceId:z.string(),rightsEvidenceRef:z.string(),requireTransientResubmission:z.boolean().default(false)})).max(24).default([]),
  dossier: z.object({
    briefVersion: z.number().int().nonnegative(), scopeVersion: z.number().int().nonnegative(),
    gateRecommendation: z.enum(["ACCEPT_CANDIDATE", "BLOCKED_REQUIRED_EVIDENCE"]),
    providerOutcomes: z.object({
      nyt: z.object({ status: z.string(), reasonCode: z.string() }),
      gutendex: z.object({ status: z.string(), reasonCode: z.string() }),
    }),
    coverage: z.array(coverage).max(24), gaps: z.array(gap).max(24),
    sources: z.array(z.object({ sourceId: z.string(), work: z.string(), author: z.string(),
      sourceUrl: z.string(), locator: z.string(), rightsBasis: z.string(), fetchedAt: z.string() })).max(24),
    items: z.array(z.object({ itemId: z.string(), dimensionId: z.string(), sourceId: z.string(),
      kind: z.string(), claim: z.string(), locator: z.string().nullable(), quote: z.string().nullable(),
      confidence: z.number().min(0).max(1) })).max(80),
    synthesis: z.array(z.object({ dimensionId: z.string(), observation: z.string() })).max(24),
    limitations: z.array(z.string()).max(24),
  }),
});
export type ResearchSummary = z.infer<typeof summarySchema>;
export type ResearchDetail = z.infer<typeof researchDetailSchema>;
type ResearchDecisionDetail = Pick<ResearchDetail, "id" | "version" | "hash" | "status" | "current"> &
  { dossier: Pick<ResearchDetail["dossier"], "gateRecommendation"> };
export type ResearchDimensionOption={id:string;value:string};

export function confirmedResearchDimensions(value:unknown):ResearchDimensionOption[]{
  const parsed=intakeRecordSchema.safeParse(value);
  if(!parsed.success||parsed.data.status!=="confirmed"||!parsed.data.confirmed)return [];
  return parsed.data.confirmed.scope.dimensions.map(dimension=>({id:dimension.field,value:dimension.value}));
}

/** Never choose arbitrarily when two records claim the same newest version. */
export function newestResearchCandidate(items: ResearchSummary[]): ResearchSummary | null {
  if (!items.length) return null;
  const newest = Math.max(...items.map(item => item.version));
  const matches = items.filter(item => item.version === newest);
  if (matches.length !== 1) throw new Error("Research history is ambiguous. Refresh before reviewing.");
  return matches[0];
}

export function canAcceptResearch(summary: ResearchSummary | null, detail: ResearchDecisionDetail | null): boolean {
  return !!summary && !!detail && summary.id === detail.id && summary.version === detail.version &&
    summary.hash === detail.hash && summary.current && detail.current && summary.status === "pending" && detail.status === "pending" &&
    summary.gateRecommendation === "ACCEPT_CANDIDATE" && detail.dossier.gateRecommendation === "ACCEPT_CANDIDATE";
}

export function researchAcceptance(detail: Pick<ResearchDetail, "id" | "version" | "hash">, operationId: string) {
  return { candidateId: detail.id, candidateVersion: detail.version, candidateHash: detail.hash, operationId };
}
