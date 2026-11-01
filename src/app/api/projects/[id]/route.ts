import {z} from "zod";
import { projectStateById,getProjectById,proposePlan,approveProposal,approveManuscriptProposal,rewriteRun,startRun,cancelRun,retryRun,exportProject,AppError } from "@/server/projects";
import {failure,sameOrigin} from "@/server/http";
import {intakeJsonBody} from "../../../../server/intake-http";
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){try{return Response.json(await projectStateById((await context.params).id));}catch(e){return failure(e);}}
const action=z.discriminatedUnion("action",[
  z.strictObject({action:z.literal("plan"),operationId:z.uuid().optional()}),
  z.strictObject({action:z.literal("retry-bible-planning"),operationId:z.uuid(),retryOfOperationId:z.uuid(),confirmDuplicateProviderCall:z.literal(true)}),
  z.strictObject({action:z.literal("approve"),proposalId:z.uuid(),proposalVersion:z.number().int().positive().optional(),proposalHash:z.string().regex(/^[a-f0-9]{64}$/).optional()}),
  z.object({action:z.literal("approve-manuscript"),proposalId:z.uuid()}),
  z.object({action:z.literal("rewrite"),feedback:z.string().max(500).optional()}),
  z.object({action:z.literal("run"),fixture:z.enum(["normal","continuity","timeout","research-outage","adversarial"]).default("normal")}),
  z.object({action:z.literal("cancel")}),z.object({action:z.literal("retry")}),z.object({action:z.literal("export")})]);
export async function POST(request:Request,context:Context){try{
  sameOrigin(request);const {id}=await context.params;const project=await getProjectById(id);const owner=project.ownerId;const data=action.parse(await intakeJsonBody(request));
  switch(data.action){
    case "plan":return Response.json(await proposePlan(owner,id,data.operationId,request.signal));
    case "retry-bible-planning":return Response.json(await proposePlan(owner,id,data.operationId,request.signal,data.retryOfOperationId));
    case "approve":return Response.json(await approveProposal(owner,id,data.proposalId,
      data.proposalVersion!==undefined&&data.proposalHash!==undefined?{proposalVersion:data.proposalVersion,proposalHash:data.proposalHash}:undefined));
    case "approve-manuscript":return Response.json(await approveManuscriptProposal(owner,id,data.proposalId));
    case "rewrite":return Response.json(await rewriteRun(owner,id,data.feedback),{status:202});
    case "run":return Response.json(await startRun(owner,id,data),{status:202});
    case "cancel":await cancelRun(owner,id);return Response.json({ok:true});
    case "retry":return Response.json({runId:await retryRun(owner,id)},{status:202});
    case "export":return new Response(await exportProject(owner,id),{headers:{"Content-Type":"text/markdown; charset=utf-8","Content-Disposition":"attachment; filename=synthetic-story.md"}});
    default:throw new AppError(400,"Unknown action.");
  }
}catch(e){return failure(e);}}
