import { createProject,listProjects } from "@/server/projects";
import {requireUser,failure,sameOrigin} from "@/server/http";
import {intakeJsonBody} from "@/server/intake-http";
export async function GET(){try{return Response.json(await listProjects(await requireUser()));}catch(e){return failure(e);}}
export async function POST(request:Request){try{const owner=await requireUser();sameOrigin(request);return Response.json(await createProject(owner,await intakeJsonBody(request)),{status:201});}catch(e){return failure(e);}}
