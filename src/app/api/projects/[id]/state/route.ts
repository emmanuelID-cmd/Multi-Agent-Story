import { parseReadVersion, readFailure, requireReadUser } from "../../../../../server/read-http";
import { readStoryState } from "../../../../../server/read-state";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const ownerId = await requireReadUser();
    const version = parseReadVersion(request);
    return Response.json(await readStoryState(ownerId, (await context.params).id, version));
  } catch (error) {
    return readFailure(error);
  }
}
