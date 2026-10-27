import { requireUser, failure, sameOrigin } from "../../../../../server/http";
import { intakeJsonBody } from "../../../../../server/intake-http";
import { AppError } from "../../../../../server/projects";
import { acceptResearchRequestSchema, acceptResearchCandidate, getResearchCandidate, listResearchCandidates } from "../../../../../server/research/dossier-service";

type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){
  try{
    const ownerId=await requireUser();
    const projectId=(await context.params).id;
    const candidateIds=new URL(request.url).searchParams.getAll("candidateId");
    if(candidateIds.length>1)throw new AppError(400,"Specify one research candidate ID.");
    return Response.json(candidateIds.length===0?await listResearchCandidates(ownerId,projectId):
      await getResearchCandidate(ownerId,projectId,candidateIds[0]));
  }
  catch(error){return failure(error);}
}
export async function POST(request:Request,context:Context){
  try{
    const ownerId=await requireUser();
    sameOrigin(request);
    const parsed=acceptResearchRequestSchema.safeParse(await intakeJsonBody(request));
    if(!parsed.success)throw new AppError(400,"Invalid research acceptance request.");
    return Response.json(await acceptResearchCandidate(ownerId,(await context.params).id,parsed.data,{signal:request.signal}));
  }catch(error){return failure(error);}
}
