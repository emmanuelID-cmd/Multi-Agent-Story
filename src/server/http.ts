import { headers } from "next/headers";
import { ZodError } from "zod";
import { getAuth } from "./auth";
import { AppError } from "./projects";
import { isAllowedRequestOrigin } from "./request-origin";

// Reads the signed-in account when a session secret is configured.
// Story links do not call this. If the secret is missing, or nobody is signed in, the answer is "Sign in to continue."
export async function requireUser() {
  const auth = await getAuth();
  if (!auth) throw new AppError(401, "Sign in to continue.");
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AppError(401, "Sign in to continue.");
  return session.user.id;
}

// Allows a browser call only from this app's own address.
// Local work is localhost or 127.0.0.1 on port 3000. A deployed site adds APP_URL, or Render's address when APP_URL is unset.
// The shared helper compares the full origin and ignores X-Forwarded-Host. Story forms call this before they save.
export function sameOrigin(request: Request) {
  if (!isAllowedRequestOrigin(request.headers.get("origin"))) throw new AppError(403, "Request unavailable.");
}

export function failure(error: unknown) {
  if (error instanceof SyntaxError && error.message.includes("JSON"))
    return Response.json({ error: "Check the request payload format." }, { status: 400 });
  if (error instanceof ZodError) return Response.json({ error: "Check the highlighted fields.", fields: error.flatten().fieldErrors }, { status: 400 });
  if (error instanceof AppError) return Response.json({ error: error.message, ...(error.fields ? { fields: error.fields } : {}) }, { status: error.status });
  console.error("Project request failed; private inputs omitted.");
  if (process.env.NODE_ENV !== "test") {
    console.error("[Diagnostic Server Error]:", error instanceof Error ? (error.stack ?? error.message) : error);
  }
  const reason = error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 150) : "Internal service error";
  return Response.json(
    { error: "Temporarily unavailable. Your saved work is preserved." },
    {
      status: 503,
      headers: {
        "x-diagnostic-reason": reason,
        "x-diagnostic-version": "afbb9c0",
      },
    }
  );
}
