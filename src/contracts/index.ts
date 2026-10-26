import { z } from "zod";
import {inspectText} from "./input-policy";
import {intakeRecordSchema} from "./intake";

export const briefSchema = z.object({
  premise: z.string().trim().min(1).max(2000),
  genre: z.string().trim().max(80),
  audience: z.string().trim().max(100),
  tone: z.string().trim().max(100),
  desiredEnding: z.string().trim().max(500),
  intake: intakeRecordSchema.optional(),
}).superRefine((brief,ctx)=>{
  if(!brief.intake){
    if(brief.premise.length<10)ctx.addIssue({code:"custom",path:["premise"],message:"Use at least 10 characters for the premise."});
    for(const field of ["genre","audience","tone","desiredEnding"] as const)
      if(!brief[field])ctx.addIssue({code:"custom",path:[field],message:`Enter ${field === "desiredEnding" ? "the desired ending" : field}.`});
  }
  for(const [field,value] of Object.entries(brief)){
    if(typeof value!=="string")continue;
    const finding=inspectText(value,field==="premise"||field==="desiredEnding"?"creative":"label",field,"project-brief");
    if(finding.verdict==="REJECT")ctx.addIssue({code:"custom",path:[field],message:"Remove unexpected hidden/control characters; keep labels on one line."});
  }
});
export type Brief = z.infer<typeof briefSchema>;
export const chapterIndex = z.number().int().min(1).max(3);
export const bibleSchema = z.object({
  facts: z.array(z.object({ id: z.string().min(1).max(80), text: z.string().min(1).max(1000) })).min(1).max(64),
  beats: z.array(z.object({ chapterIndex, text: z.string().min(1).max(2000) })).length(3),
}).refine(b => new Set(b.beats.map(v => v.chapterIndex)).size === 3, "Each chapter needs a unique index.");
export type Bible = z.infer<typeof bibleSchema>;
export const chapterSchema = z.object({ chapterIndex, bibleVersion: z.number().int().positive(), text: z.string().min(1).max(20000) });
export type Chapter = z.infer<typeof chapterSchema>;
export const fixtureSchema = z.enum(["normal", "continuity", "timeout", "research-outage", "adversarial"]);
export const runInput = z.object({ fixture: fixtureSchema.default("normal") });
export type Fixture = z.infer<typeof fixtureSchema>;
export const limits = { concurrency: 3, retries: 1, timeoutMs: 120_000, tokens: 60_000, costUsd: 3, revisionRounds: 2 } as const;
export const evidenceSchema = z.object({
  provider: z.enum(["nyt", "gutendex"]), availability: z.enum(["available", "unavailable", "not_requested"]),
  sourceUrl: z.url(), fetchedAt: z.iso.datetime(), records: z.array(z.object({
    title: z.string(), providerId: z.string(), synthetic: z.literal(true),
  })), limitation: z.string(),
});
export function orderedChapters(outputs: unknown[], version: number) {
  const chapters = outputs.map(o => chapterSchema.parse(o));
  if (chapters.length !== 3 || new Set(chapters.map(c => c.chapterIndex)).size !== 3) throw Error("All three unique chapters are required.");
  if (chapters.some(c => c.bibleVersion !== version)) throw Error("Stale chapter version.");
  return chapters.sort((a,b) => a.chapterIndex - b.chapterIndex);
}
export function canDispatch(usedTokens: number, usedCost: number, estimate = { tokens: 1000, cost: 0 }) {
  return usedTokens + estimate.tokens <= limits.tokens && usedCost + estimate.cost <= limits.costUsd;
}
