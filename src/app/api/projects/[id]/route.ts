import {z} from "zod";
import { projectState,proposePlan,approveProposal,approveManuscriptProposal,rewriteRun,startRun,cancelRun,retryRun,exportProject,AppError } from "@/server/projects";
import {requireUser,failure,sameOrigin} from "@/server/http";
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,context:Context){try{return Response.json(await projectState(await requireUser(),(await context.params).id));}catch(e){return failure(e);}}
const action=z.discriminatedUnion("action",[
  z.object({action:z.literal("plan")}),
  z.object({action:z.literal("approve"),proposalId:z.uuid()}),
  z.object({action:z.literal("approve-manuscript"),proposalId:z.uuid()}),
  z.object({action:z.literal("rewrite"),feedback:z.string().max(500).optional()}),
  z.object({action:z.literal("run"),fixture:z.enum(["normal","continuity","timeout","research-outage","adversarial"]).default("normal")}),
  z.object({action:z.literal("cancel")}),z.object({action:z.literal("retry")}),z.object({action:z.literal("export")})]);
export async function POST(request:Request,context:Context){try{
  sameOrigin(request);const owner=await requireUser();const {id}=await context.params;const data=action.parse(await request.json());
  switch(data.action){
    case "plan":return Response.json(await proposePlan(owner,id));
    case "approve":return Response.json(await approveProposal(owner,id,data.proposalId));
    case "approve-manuscript":return Response.json(await approveManuscriptProposal(owner,id,data.proposalId));
    case "rewrite":return Response.json(await rewriteRun(owner,id,data.feedback),{status:202});
    case "run":return Response.json(await startRun(owner,id,data),{status:202});
    case "cancel":await cancelRun(owner,id);return Response.json({ok:true});
    case "retry":return Response.json({runId:await retryRun(owner,id)},{status:202});
    case "export":return new Response(await exportProject(owner,id),{headers:{"Content-Type":"text/markdown; charset=utf-8","Content-Disposition":"attachment; filename=synthetic-story.md"}});
    default:throw new AppError(400,"Unknown action.");
  }
}catch(e){return failure(e);}}
