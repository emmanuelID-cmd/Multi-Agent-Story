import { failure, sameOrigin } from "../../../../../server/http";
import { intakeJsonBody } from "../../../../../server/intake-http";
import { AppError, getProjectById } from "../../../../../server/projects";
import { acceptResearchCandidate, createResearchCandidateForProject, createResearchRequestSchema,
  getResearchCandidate, listResearchCandidates, transientResearchAcceptanceSchema } from "../../../../../server/research/dossier-service";
import { configuredReadConnections } from "../../../../../server/read-connection-http";
import { z } from "zod";

type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){
  try{
    const projectId=(await context.params).id;
    const project = await getProjectById(projectId);
    const ownerId = project.ownerId;
    const candidateIds=new URL(request.url).searchParams.getAll("candidateId");
    if(candidateIds.length>1)throw new AppError(400,"Specify one research candidate ID.");
    return Response.json(candidateIds.length===0?await listResearchCandidates(ownerId,projectId):
      await getResearchCandidate(ownerId,projectId,candidateIds[0]));
  }
  catch(error){return failure(error);}
}
export async function POST(request:Request,context:Context){
  try{
    const projectId=(await context.params).id;
    const project = await getProjectById(projectId);
    const ownerId = project.ownerId;
    sameOrigin(request);
    const body=await intakeJsonBody(request);
    const create=createResearchRequestSchema.extend({action:z.literal("create")}).safeParse(body);
    if(create.success){
      const {action:_action,...submission}=create.data;
      const configured=configuredReadConnections(request.signal);
      if(!configured.runtime)throw new AppError(503,"Research model configuration is unavailable.");
      return Response.json(await createResearchCandidateForProject(ownerId,projectId,submission,configured.runtime,{signal:request.signal}));
    }
    const accept=transientResearchAcceptanceSchema.extend({action:z.literal("accept").optional()}).safeParse(body);
    if(!accept.success)throw new AppError(400,"Invalid research action.");
    const {action:_action,...acceptance}=accept.data;
    return Response.json(await acceptResearchCandidate(ownerId,projectId,acceptance,{signal:request.signal}));
  }catch(error){return failure(error);}
}
