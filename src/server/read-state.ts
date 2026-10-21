import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { bibleSchema, briefSchema, chapterSchema } from "../contracts";
import { assertAgentTool } from "../contracts/input-policy";
import { db } from "./db";
import { bibles, chapters, critiques, evidence, memories, projects, runs } from "./db/schema";

export class ReadError extends Error {
  constructor(public readonly status: 400 | 401 | 404, message: string) { super(message); }
}

const missing = () => new ReadError(404, "Project unavailable.");
const versionSchema = z.number().int().min(1).max(10_000);
const memorySchema = z.object({
  factIds: z.array(z.string().min(1).max(80)).max(64),
  plannedEvents: z.string().max(2_000),
  unresolvedThreads: z.array(z.string().max(1_000)).max(32),
  summary: z.string().max(2_000),
});
const critiqueSchema = z.object({ unresolvedIssues: z.array(z.string().max(1_000)).max(64) });
const evidenceSchema = z.object({
  provider: z.enum(["nyt", "gutendex"]),
  availability: z.enum(["available", "unavailable", "not_requested"]),
  sourceUrl: z.url().max(2_000),
  fetchedAt: z.iso.datetime(),
  records: z.array(z.object({ title: z.string().max(300), providerId: z.string().max(200), synthetic: z.literal(true) })).max(100),
  limitation: z.string().max(1_000),
}).refine(value => value.sourceUrl === (value.provider === "nyt" ? "https://developer.nytimes.com/" : "https://gutendex.com/"));
const runStatus = z.enum(["pending", "running", "paused", "completed", "failed", "canceled"]);

type ProjectRow = { version: number; brief: unknown };
type BibleRow = { id: string; version: number; data: unknown };
type RunRow = { id: string; status: string };
type ChapterRow = { chapterIndex: number; bibleVersion: number; text: string };
type MemoryRow = { chapterIndex: number; data: unknown };
type EvidenceRow = { data: unknown };

export interface ReadRepository {
  project(ownerId: string, projectId: string): Promise<ProjectRow | undefined>;
  bible(projectId: string, version: number): Promise<BibleRow | undefined>;
  run(projectId: string, bibleId: string): Promise<RunRow | undefined>;
  chapters(runId: string, bibleVersion: number): Promise<ChapterRow[]>;
  memories(bibleId: string): Promise<MemoryRow[]>;
  critique(runId: string): Promise<unknown | undefined>;
  evidence(projectId: string, runId: string): Promise<EvidenceRow[]>;
}

/** Queries execute together in one read-only snapshot. Each dependent key comes from an owned parent row. */
export async function inReadSnapshot<T>(work: (repo: ReadRepository) => Promise<T>): Promise<T> {
  return db.transaction(async tx => work({
    async project(ownerId, projectId) {
      const [row] = await tx.select({ version: projects.version, brief: projects.brief }).from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId))).limit(1);
      return row;
    },
    async bible(projectId, version) {
      const [row] = await tx.select({ id: bibles.id, version: bibles.version, data: bibles.data }).from(bibles)
        .where(and(eq(bibles.projectId, projectId), eq(bibles.version, version))).limit(1);
      return row;
    },
    async run(projectId, bibleId) {
      const [row] = await tx.select({ id: runs.id, status: runs.status }).from(runs)
        .where(and(eq(runs.projectId, projectId), eq(runs.bibleId, bibleId)))
        .orderBy(desc(runs.createdAt), desc(runs.id)).limit(1);
      return row;
    },
    async chapters(runId, bibleVersion) {
      return tx.select({ chapterIndex: chapters.chapterIndex, bibleVersion: chapters.bibleVersion, text: chapters.text })
        .from(chapters).where(and(eq(chapters.runId, runId), eq(chapters.bibleVersion, bibleVersion)))
        .orderBy(asc(chapters.chapterIndex));
    },
    async memories(bibleId) {
      return tx.select({ chapterIndex: memories.chapterIndex, data: memories.data }).from(memories)
        .where(eq(memories.bibleId, bibleId)).orderBy(asc(memories.chapterIndex));
    },
    async critique(runId) {
      const [row] = await tx.select({ data: critiques.data }).from(critiques)
        .where(eq(critiques.runId, runId)).limit(1);
      return row?.data;
    },
    async evidence(projectId, runId) {
      return tx.select({ data: evidence.data }).from(evidence)
        .where(and(eq(evidence.projectId, projectId), eq(evidence.runId, runId)));
    },
  }), { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function readStoryState(ownerId: string, projectId: string, version?: number, read = inReadSnapshot) {
  assertAgentTool("reader", "read_story_state");
  if (version !== undefined && !versionSchema.safeParse(version).success) throw new ReadError(400, "Invalid version.");
  return read(async repo => {
    const project = await repo.project(ownerId, projectId);
    if (!project) throw missing();
    const stateVersion = version ?? project.version;
    if (version !== undefined && stateVersion > project.version) throw missing();
    const brief = briefSchema.safeParse(project.brief);
    if (!Number.isInteger(stateVersion) || stateVersion < 0 || stateVersion > 10_000 || !brief.success)
      return { projectId, stateVersion, status: "unavailable" as const, brief: null, bible: null, run: null, memoryStatus: "not_requested" as const, memoryHandoffs: [], chapters: [], issuesStatus: "not_requested" as const, unresolvedIssues: null, evidenceStatus: "not_requested" as const, evidence: [] };
    if (stateVersion === 0) {
      if (version !== undefined) throw missing();
      return { projectId, stateVersion, status: "unavailable" as const, brief: brief.data, bible: null, run: null, memoryStatus: "not_requested" as const, memoryHandoffs: [], chapters: [], issuesStatus: "not_requested" as const, unresolvedIssues: null, evidenceStatus: "not_requested" as const, evidence: [] };
    }
    const bibleRow = await repo.bible(projectId, stateVersion);
    if (!bibleRow) {
      if (version !== undefined) throw missing();
      return { projectId, stateVersion, status: "unavailable" as const, brief: brief.data, bible: null, run: null, memoryStatus: "not_requested" as const, memoryHandoffs: [], chapters: [], issuesStatus: "not_requested" as const, unresolvedIssues: null, evidenceStatus: "not_requested" as const, evidence: [] };
    }
    const bible = bibleSchema.safeParse(bibleRow.data);
    if (bibleRow.version !== stateVersion || !bible.success)
      return { projectId, stateVersion, status: "unavailable" as const, brief: brief.data, bible: null, run: null, memoryStatus: "not_requested" as const, memoryHandoffs: [], chapters: [], issuesStatus: "not_requested" as const, unresolvedIssues: null, evidenceStatus: "not_requested" as const, evidence: [] };

    const memoryRows = await repo.memories(bibleRow.id);
    const factIds = new Set(bible.data.facts.map(fact => fact.id));
    const memoryHandoffs = memoryRows.flatMap(row => {
      const parsed = memorySchema.safeParse(row.data);
      return parsed.success && Number.isInteger(row.chapterIndex) && row.chapterIndex >= 1 && row.chapterIndex <= 3
        && parsed.data.factIds.every(id => factIds.has(id))
        ? [{ chapterIndex: row.chapterIndex, ...parsed.data }] : [];
    }).sort((a, b) => a.chapterIndex - b.chapterIndex);
    const memoryStatus = memoryRows.length === 0 ? "unavailable" as const
      : memoryRows.length === 3 && memoryHandoffs.length === 3 && new Set(memoryHandoffs.map(item => item.chapterIndex)).size === 3
        ? "available" as const : "partial" as const;
    const selectedRun = await repo.run(projectId, bibleRow.id);
    if (!selectedRun) return { projectId, stateVersion, status: "partial" as const, brief: brief.data, bible: bible.data, run: null, memoryStatus, memoryHandoffs, chapters: [], issuesStatus: "not_requested" as const, unresolvedIssues: null, evidenceStatus: "not_requested" as const, evidence: [] };

    const [chapterRows, critiqueRaw, evidenceRows] = await Promise.all([
      repo.chapters(selectedRun.id, stateVersion), repo.critique(selectedRun.id), repo.evidence(projectId, selectedRun.id),
    ]);
    const seen = new Set<number>();
    const ordered = chapterRows.flatMap(row => {
      const parsed = chapterSchema.safeParse(row);
      if (!parsed.success || parsed.data.bibleVersion !== stateVersion || seen.has(parsed.data.chapterIndex)) return [];
      seen.add(parsed.data.chapterIndex);
      return [parsed.data];
    }).sort((a, b) => a.chapterIndex - b.chapterIndex);
    const critique = critiqueSchema.safeParse(critiqueRaw);
    const sources = evidenceRows.flatMap(row => {
      const parsed = evidenceSchema.safeParse(row.data);
      return parsed.success ? [parsed.data] : [];
    });
    const issuesStatus = critique.success ? "available" as const : "unavailable" as const;
    const evidenceStatus = evidenceRows.length === 0 ? "unavailable" as const
      : sources.length === evidenceRows.length ? "available" as const : "partial" as const;
    const status = runStatus.safeParse(selectedRun.status);
    return {
      projectId, stateVersion,
      status: status.success && status.data === "completed" && ordered.length === 3 && memoryStatus === "available" && issuesStatus === "available" ? "completed" as const : "partial" as const,
      brief: brief.data, bible: bible.data,
      run: { status: status.success ? status.data : "unavailable" },
      memoryStatus, memoryHandoffs, chapters: ordered, issuesStatus,
      unresolvedIssues: critique.success ? critique.data.unresolvedIssues : null,
      evidenceStatus, evidence: sources,
    };
  });
}
