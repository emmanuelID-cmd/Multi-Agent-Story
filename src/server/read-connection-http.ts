import { z } from "zod";
import { limits } from "../contracts";
import { AnthropicReadModel } from "../agents/read/model";
import { createReadConnections, type ReadConnectionOptions } from "./read-connections";
import { connectionId, readAssignmentSchema, ReadConnectionError } from "./read-connection-contracts";

export const readConnectionActionSchema=z.discriminatedUnion("action",[
  z.strictObject({action:z.literal("record_request"),assignment:readAssignmentSchema}),
  z.strictObject({action:z.enum(["reader","consistency"]),runId:connectionId,requestId:connectionId,operationId:connectionId}),
  z.strictObject({action:z.literal("receive_reader"),runId:connectionId,operationId:connectionId,
    editorId:z.enum(["critic_editor_a","critic_editor_b"])}),
  z.strictObject({action:z.literal("resume_revision"),runId:connectionId}),
]);

/** Trusted server configuration only. Construction never dispatches a model call. */
export function configuredReadConnections(signal:AbortSignal):ReadConnectionOptions{
  if(process.env.READ_CONNECTIONS_ENABLED!=="true")throw new ReadConnectionError("READ_CONNECTIONS_DISABLED","human_review");
  const inputUsdPerMillion=Number(process.env.READ_INPUT_USD_PER_MILLION);
  const outputUsdPerMillion=Number(process.env.READ_OUTPUT_USD_PER_MILLION);
  if(![inputUsdPerMillion,outputUsdPerMillion].every(v=>Number.isFinite(v)&&v>0)||!process.env.ANTHROPIC_API_KEY)
    throw new ReadConnectionError("READ_CONFIGURATION_UNAVAILABLE","human_review");
  const model=new AnthropicReadModel(process.env.ANTHROPIC_API_KEY);
  return {runtime:{model,signal,budget:{maxTokens:limits.tokens,maxCostUsd:limits.costUsd,inputUsdPerMillion,outputUsdPerMillion}},
    versions:{contract:"read-v1",prompt:"read-v1",harness:"read-connections-v1",model:model.modelId}};
}

/** Called only after the route authenticates the session and checks origin/body limits. */
export async function executeReadConnectionAction(ownerId:string,projectId:string,input:unknown,options:ReadConnectionOptions){
  const action=readConnectionActionSchema.parse(input);
  if(action.action==="resume_revision")return (await import("./read-revision-resume")).resumeReadRevision(ownerId,projectId,action.runId);
  const service=createReadConnections(options);
  if(action.action==="record_request")return service.recordRequest(ownerId,projectId,action.assignment);
  if(action.action==="receive_reader")return service.receiveReader(ownerId,projectId,action.runId,action.operationId,action.editorId);
  return action.action==="reader"?service.prepareReader(ownerId,projectId,action.runId,action.requestId,action.operationId):
    service.checkConsistency(ownerId,projectId,action.runId,action.requestId,action.operationId);
}
