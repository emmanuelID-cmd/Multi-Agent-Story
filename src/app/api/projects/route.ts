import { createAnonymousProject } from "@/server/projects";
import { failure, sameOrigin } from "@/server/http";
import { intakeJsonBody } from "@/server/intake-http";

export async function GET() {
  return Response.json({ error: "Project unavailable." }, { status: 404 });
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await intakeJsonBody(request);
    return Response.json(await createAnonymousProject(body), { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
