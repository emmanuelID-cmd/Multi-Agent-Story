import { intakeRequestSchema } from "@/contracts/intake";
import { requireUser, failure, sameOrigin } from "@/server/http";
import { AppError } from "@/server/projects";
import { updateProjectIntake } from "@/server/intake";
import { intakeJsonBody } from "@/server/intake-http";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const ownerId = await requireUser();
    sameOrigin(request);
    const parsed = intakeRequestSchema.safeParse(await intakeJsonBody(request));
    if (!parsed.success) throw new AppError(400, "Invalid intake request.");
    const { id } = await context.params;
    return Response.json(await updateProjectIntake(ownerId, id, parsed.data, { signal: request.signal }));
  } catch (error) { return failure(error); }
}
