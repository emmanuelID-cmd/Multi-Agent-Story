import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";

export async function GET(req: Request) {
  const auth = await getAuth();
  if (!auth) return new Response(JSON.stringify({ error: "Auth not configured" }), { status: 503, headers: { "Content-Type": "application/json" } });
  return toNextJsHandler(auth).GET(req);
}

export async function POST(req: Request) {
  const auth = await getAuth();
  if (!auth) return new Response(JSON.stringify({ error: "Auth not configured" }), { status: 503, headers: { "Content-Type": "application/json" } });
  return toNextJsHandler(auth).POST(req);
}
