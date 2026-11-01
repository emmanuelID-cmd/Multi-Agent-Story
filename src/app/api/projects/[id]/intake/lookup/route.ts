import { z } from "zod";
import { lcKindSchema, lcQuerySchema } from "@/contracts/vocabulary";
import { failure, sameOrigin } from "@/server/http";
import { AppError, getProjectById } from "@/server/projects";
import { intakeJsonBody } from "@/server/intake-http";
import { lookupProjectIntake } from "@/server/intake";

const requestSchema = z.strictObject({ expectedRevision: z.number().int().nonnegative(), kind: lcKindSchema, words: lcQuerySchema });
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const { id } = await context.params;
    const project = await getProjectById(id);
    const ownerId = project.ownerId;
    const parsed = requestSchema.safeParse(await intakeJsonBody(request));
    if (!parsed.success) throw new AppError(400, "Enter short search words and choose a vocabulary type.");
    return Response.json(await lookupProjectIntake(ownerId, id, parsed.data.expectedRevision, parsed.data.kind, parsed.data.words));
  } catch (error) { return failure(error); }
}
