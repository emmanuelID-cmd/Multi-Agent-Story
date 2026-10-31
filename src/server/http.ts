import { headers } from "next/headers";
import { auth } from "./auth";
import { AppError } from "./projects";
import { ZodError } from "zod";
export async function requireUser(){const session=await auth.api.getSession({headers:await headers()});if(!session)throw new AppError(401,"Sign in to continue.");return session.user.id;}
export function sameOrigin(request:Request){const origin=request.headers.get("origin");if(!origin||!["http://localhost:3000","http://127.0.0.1:3000"].includes(origin))throw new AppError(403,"Request unavailable.");}
export function failure(error:unknown){
  if(error instanceof SyntaxError && error.message.includes("JSON"))
    return Response.json({error:"Check the request payload format."},{status:400});
  if(error instanceof ZodError)return Response.json({error:"Check the highlighted fields.",fields:error.flatten().fieldErrors},{status:400});
  if(error instanceof AppError)return Response.json({error:error.message,...(error.fields?{fields:error.fields}:{})},{status:error.status});
  console.error("Project request failed; private inputs omitted.");return Response.json({error:"Temporarily unavailable. Your saved work is preserved."},{status:503});
}
