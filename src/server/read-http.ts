import { headers } from "next/headers";
import { auth } from "./auth";
import { ReadError } from "./read-state";

export async function requireReadUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new ReadError(401, "Sign in to continue.");
  return session.user.id;
}

export function readFailure(error: unknown) {
  if (error instanceof ReadError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: "Temporarily unavailable." }, { status: 503 });
}

export function parseReadVersion(request: Request) {
  const values = new URL(request.url).searchParams.getAll("version");
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !/^[1-9]\d{0,3}$|^10000$/.test(values[0])) throw new ReadError(400, "Invalid version.");
  return Number(values[0]);
}
