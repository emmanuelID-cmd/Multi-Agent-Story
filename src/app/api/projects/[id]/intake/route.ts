import { intakeRequestSchema } from "@/contracts/intake";
import { requireUser, failure, sameOrigin } from "@/server/http";
import { AppError } from "@/server/projects";
import { updateProjectIntake } from "@/server/intake";
import { intakeJsonBody } from "@/server/intake-http";
import { randomUUID } from "node:crypto";
import { localIntakeTrace, type IntakeTrace } from "@/server/intake-trace";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  let trace: IntakeTrace | undefined;
  try {
    const ownerId = await requireUser();
    sameOrigin(request);
    trace = localIntakeTrace(randomUUID());
    console.info("Intake trace:", trace.id);
    trace.record("request", "STARTED");
    const parsed = intakeRequestSchema.safeParse(await intakeJsonBody(request));
    if (!parsed.success) { trace.record("request", "REQUEST_INVALID"); throw new AppError(400, "Invalid intake request."); }
    trace.record("request", "PASSED", { revision: parsed.data.expectedRevision });
    const { id } = await context.params;
    const result = await updateProjectIntake(ownerId, id, parsed.data, { signal: request.signal, trace });
    trace.finish("SUCCEEDED");
    return Response.json({ ...result, traceId: trace.id, traceAvailability: trace.availability }, { headers: { "X-Trace-Id": trace.id } });
  } catch (error) {
    if (!trace) return failure(error);
    const reasonCode = trace.terminalFailure ?? trace.latestFailure ?? (error instanceof AppError && error.status === 400 ? "REQUEST_INVALID" : error instanceof AppError && error.status === 409 ? "REVISION_CONFLICT" : "ANALYSIS_FAILED");
    trace.finish(reasonCode);
    const response = failure(error);
    const body = await response.json();
    return Response.json({ ...body, traceId: trace.id, reasonCode, traceAvailability: trace.availability },
      { status: response.status, headers: { "X-Trace-Id": trace.id } });
  }
}
