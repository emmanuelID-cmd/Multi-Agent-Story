import { requireUser, sameOrigin, failure } from "../../../../../server/http";
import { intakeJsonBody } from "../../../../../server/intake-http";
import { configuredReadConnections, executeReadConnectionAction, getReadRecoveryOperations } from "../../../../../server/read-connection-http";
import { ReadConnectionError } from "../../../../../server/read-connection-contracts";

export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const ownerId=await requireUser();
    const runId=new URL(request.url).searchParams.get("runId");
    if(!runId)throw new ReadConnectionError("RUN_ID_REQUIRED","human_review",400);
    return Response.json(await getReadRecoveryOperations(ownerId,(await context.params).id,runId));
  }catch(error){
    if(error instanceof ReadConnectionError)return Response.json({error:error.code,route:error.route},{status:error.status});
    return failure(error);
  }
}

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const ownerId=await requireUser();
    sameOrigin(request);
    const input=await intakeJsonBody(request);
    return Response.json(await executeReadConnectionAction(ownerId,(await context.params).id,input,configuredReadConnections(request.signal)));
  }catch(error){
    if(error instanceof ReadConnectionError)return Response.json({error:error.code,route:error.route},{status:error.status});
    return failure(error);
  }
}
