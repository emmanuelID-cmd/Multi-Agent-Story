import { AppError, getProjectById } from "../../../../server/projects";
import { parseBenchmarkBody, verifyBenchmarkOrigin, getProjectBenchmarks } from "../../../../server/research/benchmark-http";
import { readFailure } from "../../../../server/read-http";

// Loads book metadata for the story id in the request body.
// The saved owner on that row is passed through. This route does not ask who is signed in.
// Live NYT and Gutendex reads stay behind the existing metadata gates.
export async function POST(request: Request) {
  try {
    verifyBenchmarkOrigin(request);
    const input = await parseBenchmarkBody(request);
    const project = await getProjectById(input.projectId);
    return Response.json(await getProjectBenchmarks(project.ownerId, input));
  } catch (error) {
    if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status });
    return readFailure(error);
  }
}
