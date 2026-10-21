import { parseBenchmarkBody, verifyBenchmarkOrigin, getProjectBenchmarks } from "../../../../server/research/benchmark-http";
import { readFailure, requireReadUser } from "../../../../server/read-http";

export async function POST(request: Request) {
  try {
    const ownerId = await requireReadUser();
    verifyBenchmarkOrigin(request);
    const input = await parseBenchmarkBody(request);
    return Response.json(await getProjectBenchmarks(ownerId, input));
  } catch (error) {
    return readFailure(error);
  }
}
