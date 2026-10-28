import { z } from "zod";
import { sha256 } from "../../agents/read/runtime";
import { researchInputSchema, type ResearchInput } from "../../agents/read/contracts";
import { inspectText, type InputFinding } from "../../contracts/input-policy";
import { readBookBenchmarks, type ProviderEvidence } from "./book-metadata";
import { runConfirmedResearch, type ConfirmedIntakeRepository, type ConfirmedResearchRequest } from "./confirmed-intake";
import type { ReadDependencies } from "../../agents/read/runtime";

const id = z.string().min(1).max(128).regex(/^[\p{L}\p{N}._:-]+$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const approvalSchema = z.strictObject({
  sourceId: id, kind: z.enum(["licensed_text", "public_domain_text", "historical_context"]),
  work: z.string().min(1).max(300), author: z.string().max(300), publicationDate: z.string().max(40).nullable(),
  sourceUrl: z.url().max(2_000), locator: z.string().min(1).max(200), expectedSha256: digest,
  rights: z.strictObject({basis: z.string().min(1).max(2_000), type: z.enum(["us_public_domain", "user_license"]),
    jurisdiction: z.literal("US"), purpose: z.literal("research_text_analysis"),
    verifiedAt: z.iso.datetime(), validThrough: z.iso.datetime(), evidenceRef: z.string().min(1).max(300) }),
  identity: z.discriminatedUnion("type", [
    z.strictObject({type: z.literal("gutendex"), providerRecordId: z.string().min(1).max(200)}),
    z.strictObject({type: z.literal("licensed_user"), ownerId: id, projectId: id}),
  ]),
  matches: z.array(z.strictObject({dimensionId: id, confirmedValue: z.string().min(1).max(2_000), evidenceRef: z.string().min(1).max(300)})).min(1).max(24),
});
export type ApprovedResearchSource = z.input<typeof approvalSchema>;
export function approvedSourceFingerprint(value: ApprovedResearchSource): string | null {
  const parsed = approvalSchema.safeParse(value);
  return parsed.success ? sha256(JSON.stringify(parsed.data)) : null;
}
export type AcquisitionReport = {
  queries: {provider: "nyt" | "gutendex"; genre: string; topicPhrase:string|null; subjectUri:string|null; scopeVersion:"intake-v3"|"legacy";
    endpoint: string; status: ProviderEvidence["status"]; reasonCode: string; checkedAt: string; recordIds: string[]}[];
  sources: {sourceId: string; status: "eligible" | "blocked" | "unavailable"; reasonCode: string;
    matchedDimensions: string[]; gapDimensions: string[]; providerRecordId: string | null;
    kind: string; work: string; author: string; publicationDate: string | null;
    sourceUrl: string; locator: string; rightsBasis: string; rightsEvidenceRef: string; rightsVerifiedAt: string; rightsValidThrough:string;
    reviewFingerprint:string; textSha256: string;
    findings: InputFinding[]}[];
  gaps: {dimensionId: string; reasonCode: string}[];
};
export type AcquisitionOptions = {
  /** Entries and reader must be supplied by a trusted server-side integration, never model or request text. */
  approvedSources?: readonly ApprovedResearchSource[];
  readApprovedText?: (source: ApprovedResearchSource, signal: AbortSignal) => Promise<{text: string; fetchedAt: string}>;
  readBenchmarks?: NonNullable<ReadDependencies["readBenchmarks"]>;
};

function cleanUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password &&
    ![...url.searchParams.keys()].some(key => /key|token|secret|credential/i.test(key)); }
  catch { return false; }
}
function approvalFindings(source: z.output<typeof approvalSchema>): InputFinding[] {
  const fields:{ref:string;value:string|null;kind:"label"|"metadata"}[] = [
    {ref:"work",value:source.work,kind:"label"},{ref:"author",value:source.author,kind:"label"},
    {ref:"publicationDate",value:source.publicationDate,kind:"label"},{ref:"locator",value:source.locator,kind:"label"},
    {ref:"rights.basis",value:source.rights.basis,kind:"metadata"},
    {ref:"rights.evidenceRef",value:source.rights.evidenceRef,kind:"label"},
    ...source.matches.map((match,index) => ({ref:`matches.${index}.evidenceRef`,value:match.evidenceRef,kind:"label" as const})),
  ];
  const findings:InputFinding[]=[];
  for(const field of fields){
    if(field.value===null)continue;
    const format=inspectText(field.value,field.kind,field.ref,source.sourceId);
    const finding=format.verdict==="ACCEPT"?inspectText(field.value,"metadata",field.ref,source.sourceId):format;
    if(finding.verdict!=="ACCEPT")findings.push(finding);
  }
  return findings;
}
function bounded<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(signal.reason === "TIMEOUT" ? "TIMEOUT" : "CANCELED"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error(signal.reason === "TIMEOUT" ? "TIMEOUT" : "CANCELED"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(action).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Resolve only reviewed source IDs through a trusted reader; metadata links are never fetched here. */
export async function acquireResearchEvidence(input: ResearchInput, options: AcquisitionOptions, signal: AbortSignal) {
  const parsed = researchInputSchema.parse(input);
  const read = options.readBenchmarks ?? ((request: z.output<typeof researchInputSchema>["benchmarkRequest"], signal: AbortSignal) => readBookBenchmarks(request, {signal}));
  const outcomes = await bounded(() => read(parsed.benchmarkRequest, signal), signal);
  const report: AcquisitionReport = {queries: outcomes.map(o => ({provider:o.provider,genre:parsed.benchmarkRequest.genre,
    topicPhrase:o.queryProvenance?.topicPhrase??parsed.benchmarkRequest.topicPhrase??null,
    subjectUri:o.queryProvenance?.subjectUri??parsed.benchmarkRequest.subjectUri??null,
    scopeVersion:o.queryProvenance?.scopeVersion??parsed.benchmarkRequest.intakeVersion??"legacy",
    endpoint:o.sourceUrl,status:o.status,reasonCode:o.reasonCode,checkedAt:o.checkedAt,recordIds:o.records.map(r => r.providerRecordId)})),sources:[],gaps:[]};
  const eligibleSources: z.output<typeof researchInputSchema>["eligibleSources"] = [];
  const expected = new Map<string,string>(parsed.confirmedIntake?.scope.dimensions.map(d => [d.field,d.value]) ?? []);
  const now = Date.now();
  if ((options.approvedSources?.length ?? 0) > 24) {
    report.sources.push({sourceId:"approval_catalog",status:"blocked",reasonCode:"SOURCE_APPROVAL_LIMIT_EXCEEDED",
      matchedDimensions:[],gapDimensions:parsed.dimensions.map(d=>d.id),providerRecordId:null,kind:"unknown",work:"",author:"",publicationDate:null,
      sourceUrl:"",locator:"",rightsBasis:"",rightsEvidenceRef:"",rightsVerifiedAt:"",rightsValidThrough:"",reviewFingerprint:"",textSha256:"",findings:[]});
    report.gaps=parsed.dimensions.map(d=>({dimensionId:d.id,reasonCode:"SOURCE_APPROVAL_LIMIT_EXCEEDED"}));
    return {input:{...parsed,eligibleSources},providerOutcomes:outcomes,report};
  }
  const seen = new Set<string>();
  for (const [index,candidate] of (options.approvedSources ?? []).entries()) {
    const valid = approvalSchema.safeParse(candidate);
    if (!valid.success) {
      report.sources.push({sourceId:`invalid_approval_${index}`,status:"blocked",reasonCode:"APPROVAL_INVALID",
        matchedDimensions:[],gapDimensions:parsed.dimensions.map(d=>d.id),providerRecordId:null,kind:"unknown",work:"",author:"",publicationDate:null,
        sourceUrl:"",locator:"",rightsBasis:"",rightsEvidenceRef:"",rightsVerifiedAt:"",rightsValidThrough:"",reviewFingerprint:"",textSha256:"",findings:[]});
      continue;
    }
    const source = valid.data;
    const findings=approvalFindings(source);
    const matchedDimensions = source.matches.filter(m => expected.get(m.dimensionId) === m.confirmedValue).map(m => m.dimensionId);
    const gapDimensions = parsed.dimensions.filter(d => !matchedDimensions.includes(d.id)).map(d => d.id);
    const providerRecordId = source.identity.type === "gutendex" ? source.identity.providerRecordId : null;
    const entry: AcquisitionReport["sources"][number] = {sourceId:source.sourceId,status:"blocked",reasonCode:"UNVERIFIED_SOURCE",
      matchedDimensions,gapDimensions,providerRecordId,kind:source.kind,work:source.work,author:source.author,publicationDate:source.publicationDate,
      sourceUrl:cleanUrl(source.sourceUrl) ? source.sourceUrl : "[invalid source URL]",locator:source.locator,rightsBasis:source.rights.basis,rightsEvidenceRef:source.rights.evidenceRef,
      rightsVerifiedAt:source.rights.verifiedAt,rightsValidThrough:source.rights.validThrough,
      reviewFingerprint:approvedSourceFingerprint(source)!,textSha256:source.expectedSha256,findings};
    report.sources.push(entry);
    const gut = outcomes.find(o => o.provider === "gutendex");
    const record = providerRecordId ? gut?.records.find(r => r.providerRecordId === providerRecordId) : undefined;
    if (findings.length) entry.reasonCode = "UNSAFE_APPROVAL_METADATA";
    else if (seen.has(source.sourceId)) entry.reasonCode = "DUPLICATE_SOURCE_ID";
    else if (!cleanUrl(source.sourceUrl)) entry.reasonCode = "SOURCE_URL_INVALID";
    else if (new Set(source.matches.map(m => m.dimensionId)).size !== source.matches.length ||
      source.matches.some(m => expected.get(m.dimensionId) !== m.confirmedValue)) entry.reasonCode = "CONFIRMED_DIMENSION_MISMATCH";
    else if (Date.parse(source.rights.verifiedAt) > now || Date.parse(source.rights.validThrough) < now ||
      Date.parse(source.rights.validThrough) < Date.parse(source.rights.verifiedAt)) entry.reasonCode = "RIGHTS_REVIEW_STALE";
    else if ((source.kind === "public_domain_text" && source.rights.type !== "us_public_domain") ||
      (source.kind === "licensed_text" && source.rights.type !== "user_license")) entry.reasonCode = "RIGHTS_KIND_MISMATCH";
    else if (source.rights.type === "user_license" && source.identity.type !== "licensed_user") entry.reasonCode = "LICENSED_OWNER_MISMATCH";
    else if (source.identity.type === "licensed_user" &&
      (source.identity.ownerId !== parsed.authority.ownerId || source.identity.projectId !== parsed.authority.projectId || source.rights.type !== "user_license")) entry.reasonCode = "LICENSED_OWNER_MISMATCH";
    else if (source.identity.type === "gutendex" && (!record || !["available","partial"].includes(gut?.status ?? "unavailable"))) entry.reasonCode = "PROVIDER_RECORD_UNAVAILABLE";
    else if (source.identity.type === "gutendex" && parsed.benchmarkRequest.intakeVersion === "intake-v3" && record?.relevance !== "matched") entry.reasonCode = "PROVIDER_SUBJECT_NO_MATCH";
    else if (record && (record.title !== source.work || !record.authors.includes(source.author))) entry.reasonCode = "WORK_IDENTITY_MISMATCH";
    else if (record?.copyright !== false && source.rights.type === "us_public_domain") entry.reasonCode = "CATALOG_RIGHTS_UNCERTAIN";
    else if (!options.readApprovedText) {entry.status = "unavailable"; entry.reasonCode = "APPROVED_READER_UNAVAILABLE";}
    else {
      try {
        const payload = await bounded(() => options.readApprovedText!(source,signal),signal);
        if (!payload.text || payload.text.length > 10_000 || !z.iso.datetime().safeParse(payload.fetchedAt).success) entry.reasonCode = "TEXT_INVALID";
        else if (sha256(payload.text) !== source.expectedSha256) entry.reasonCode = "TEXT_DIGEST_MISMATCH";
        else if (inspectText(payload.text,"metadata",source.sourceId,"approved-source").verdict !== "ACCEPT") entry.reasonCode = "UNSAFE_SOURCE_TEXT";
        else {
          eligibleSources.push({sourceId:source.sourceId,kind:source.kind,work:source.work,author:source.author,
            publicationDate:source.publicationDate,sourceUrl:source.sourceUrl,fetchedAt:payload.fetchedAt,
            rightsBasis:source.rights.basis,jurisdiction:"US",rightsVerified:true,locator:source.locator,
            approvedDimensionIds:matchedDimensions,text:payload.text,sha256:source.expectedSha256});
          entry.status = "eligible";entry.reasonCode = "OK";
        }
      } catch (error) {
        if (signal.aborted) throw error;
        entry.status = "unavailable";entry.reasonCode = "TEXT_READ_UNAVAILABLE";
      }
    }
    seen.add(source.sourceId);
  }
  for (const dimension of parsed.dimensions) if (!report.sources.some(s => s.status === "eligible" && s.matchedDimensions.includes(dimension.id)))
    report.gaps.push({dimensionId:dimension.id,reasonCode:"ELIGIBLE_SOURCE_MISSING"});
  return {input:{...parsed,eligibleSources},providerOutcomes:outcomes,report};
}

export function runAcquiredConfirmedResearch(request: ConfirmedResearchRequest, dependencies: ReadDependencies,
  repository?: ConfirmedIntakeRepository, options: AcquisitionOptions = {}) {
  return runConfirmedResearch(request,dependencies,repository,(input,signal) => acquireResearchEvidence(input,
    {...options,readBenchmarks:options.readBenchmarks ?? dependencies.readBenchmarks},signal));
}
