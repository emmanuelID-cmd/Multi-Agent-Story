import { AppError } from "./projects";

/** Shared by saved-intake actions and sparse project creation; never log body text. */
export async function intakeJsonBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    throw new AppError(400, "Expected a JSON request.");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 80_000))
    throw new AppError(400, "Keep the request within 80,000 bytes.");
  if (!request.body) throw new AppError(400, "Invalid request body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let interrupted = false;
  let complete = false;
  let rejectStop!: (error: AppError) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  void stopped.catch(() => {});
  const stop = () => {
    interrupted = true;
    rejectStop(new AppError(400, "The input request stopped. Try again."));
  };
  request.signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, 5_000);
  if (request.signal.aborted) stop();
  try {
    while (true) {
      if (interrupted) throw new AppError(400, "The input request stopped. Try again.");
      const next = await Promise.race([reader.read(), stopped]);
      if (interrupted) throw new AppError(400, "The input request stopped. Try again.");
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 80_000) throw new AppError(400, "Keep the request within 80,000 bytes.");
      chunks.push(next.value);
    }
    complete = true;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", stop);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new AppError(400, "Use a valid JSON request."); }
}
