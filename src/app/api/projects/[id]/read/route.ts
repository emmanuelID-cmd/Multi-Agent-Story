import { sameOrigin, failure } from "../../../../../server/http";
import { getProjectById } from "../../../../../server/projects";
import { intakeJsonBody } from "../../../../../server/intake-http";
import { configuredReadConnections, executeReadConnectionAction, getReadRecoveryOperations } from "../../../../../server/read-connection-http";
import { ReadConnectionError } from "../../../../../server/read-connection-contracts";

export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const { id } = await context.params;
    const project = await getProjectById(id);
    const ownerId = project.ownerId;
    const runId=new URL(request.url).searchParams.get("runId");
    if(!runId)throw new ReadConnectionError("RUN_ID_REQUIRED","human_review",400);
    return Response.json(await getReadRecoveryOperations(ownerId,id,runId));
  }catch(error){
    if(error instanceof ReadConnectionError)return Response.json({error:error.code,route:error.route},{status:error.status});
    return failure(error);
  }
}

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const { id } = await context.params;
    const project = await getProjectById(id);
    const ownerId = project.ownerId;
    sameOrigin(request);
    const input=await intakeJsonBody(request);
    return Response.json(await executeReadConnectionAction(ownerId,id,input,configuredReadConnections(request.signal)));
  }catch(error){
    if(error instanceof ReadConnectionError)return Response.json({error:error.code,route:error.route},{status:error.status});
    return failure(error);
  }
}
