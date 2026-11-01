import { headers } from "next/headers";
import { getAuth } from "./auth";
import { ReadError } from "./read-state";

// Reads the signed-in account for the session-gated story state path.
// /state is the caller. If BETTER_AUTH_SECRET is missing, this returns 401 and does not build a sign-in client.
// Story links do not use this function. Keep their routes on the saved project owner instead.
export async function requireReadUser() {
  const auth = await getAuth();
  if (!auth) throw new ReadError(401, "Sign in to continue.");
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
