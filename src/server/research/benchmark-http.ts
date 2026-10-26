import { z } from "zod";
import { inReadSnapshot, ReadError } from "../read-state";
import { benchmarkRequest, readBookBenchmarks } from "./book-metadata";
import { intakeRecordSchema, type IntakeScope } from "../../contracts/intake";
import { briefSchema } from "../../contracts";

const MAX_REQUEST_BYTES = 4_096;
const BODY_DEADLINE_MS = 5_000;
const requestSchema = z.strictObject({ projectId: z.uuid(), ...benchmarkRequest.shape });

export function verifyBenchmarkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== "http://localhost:3000" && origin !== "http://127.0.0.1:3000")
    throw new ReadError(400, "Request unavailable.");
}

export async function parseBenchmarkBody(request: Request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    throw new ReadError(400, "Expected a JSON request.");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES))
    throw new ReadError(400, "Invalid request body.");
  if (!request.body) throw new ReadError(400, "Invalid request body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let completed = false;
  let interrupted = false;
  let rejectInterruption!: (error: ReadError) => void;
  const interruption = new Promise<never>((_, reject) => { rejectInterruption = reject; });
  void interruption.catch(() => {});
  const stop = () => {
    if (interrupted) return;
    interrupted = true;
    rejectInterruption(new ReadError(400, "Invalid request body."));
  };
  request.signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, BODY_DEADLINE_MS);
  if (request.signal.aborted) stop();
  try {
    while (true) {
      if (interrupted) throw new ReadError(400, "Invalid request body.");
      const { value, done } = await Promise.race([reader.read(), interruption]);
      if (interrupted) throw new ReadError(400, "Invalid request body.");
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) throw new ReadError(400, "Invalid request body.");
      chunks.push(value);
    }
    completed = true;
  } catch (error) {
    if (error instanceof ReadError) throw error;
    throw new ReadError(400, "Invalid request body.");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", stop);
    if (!completed || interrupted) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ReadError(400, "Invalid request body."); }
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw new ReadError(400, "Invalid benchmark request.");
  return parsed.data;
}

type BenchmarkInput = z.infer<typeof requestSchema>;
type Dependencies = {
  ownsProject: (ownerId: string, projectId: string) => Promise<boolean>;
  confirmedScope?: (ownerId: string, projectId: string) => Promise<IntakeScope | null | undefined>;
  read: typeof readBookBenchmarks;
};

const defaults: Dependencies = {
  ownsProject: async (ownerId, projectId) => Boolean(await inReadSnapshot(repo => repo.project(ownerId, projectId))),
  confirmedScope: async (ownerId, projectId) => inReadSnapshot(async repo => {
    const project = await repo.project(ownerId, projectId);
    if (!project) throw new ReadError(404, "Project unavailable.");
    const brief = briefSchema.safeParse(project?.brief);
    if (!brief.success) return null;
    if (!brief.data.intake) return undefined;
    const intake = intakeRecordSchema.parse(brief.data.intake);
    return intake.status === "confirmed" ? intake.confirmed?.scope ?? null : null;
  }),
  read: readBookBenchmarks,
};

export async function getProjectBenchmarks(ownerId: string, input: BenchmarkInput, dependencies: Dependencies = defaults) {
  const { projectId, ...query } = input;
  if (!await dependencies.ownsProject(ownerId, projectId)) throw new ReadError(404, "Project unavailable.");
  const scope = await dependencies.confirmedScope?.(ownerId, projectId);
  if (scope === null) throw new ReadError(400, "Confirm the story scope before requesting book metadata.");
  if (scope && (query.genre !== scope.genre || query.providers.length !== scope.providers.length ||
    query.providers.some(provider => !scope.providers.includes(provider))))
    throw new ReadError(400, "The metadata request must match the confirmed story scope.");
  const evidence = await dependencies.read(query);
  return scope ? { projectId, scope, evidence } : { projectId, evidence };
}
