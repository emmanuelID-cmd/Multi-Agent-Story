import { createProject,listProjects } from "@/server/projects";
import {requireUser,failure,sameOrigin} from "@/server/http";
export async function GET(){try{return Response.json(await listProjects(await requireUser()));}catch(e){return failure(e);}}
export async function POST(request:Request){try{sameOrigin(request);return Response.json(await createProject(await requireUser(),await request.json()),{status:201});}catch(e){return failure(e);}}
