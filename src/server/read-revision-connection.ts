import type { Brief } from "../contracts";
import { criticEditorAModel, criticEditorBModel } from "../agents/editors";
import { EditorialHandoffRejectionError } from "../agents/handoff";
import { sha256 } from "../agents/read/runtime";
import type { RevisionCycleInput } from "../agents/write/revision";
import { createReadConnections, resolveReadSource, type ReadConnectionOptions } from "./read-connections";
import { ReadConnectionError, type ReadAssignment } from "./read-connection-contracts";

export type ReadRevisionAssignments={critic_editor_a:ReadAssignment;critic_editor_b:ReadAssignment};
export const revisionReaderOperation=(a:ReadAssignment)=>`reader:${sha256(a.requestId)}`;
export function revisionProposalIds(runId:string):[string,string]{
  return ["a","b"].map(editor=>{
    const h=sha256(`read-proposal:v1:${runId}:${editor}`);
    return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
  }) as [string,string];
}

/** The actual revision consumer: Reader evidence enters the existing model-backed Editor receiving boundary. */
export function createReadRevisionConnection(input:{ownerId:string;projectId:string;targetRunId:string;
  assignments:ReadRevisionAssignments;options:ReadConnectionOptions;brief?:Brief}):NonNullable<RevisionCycleInput["readConnection"]>{
  const service=createReadConnections(input.options);
  return {async edit(editorId,chapters,model){
    const a=input.assignments[editorId],operationId=revisionReaderOperation(a);
    const repo=input.options.repository??(await import("./read-connection-storage")).dbReadConnectionRepository;
    async function target(){
      await repo.locked(input.ownerId,input.projectId,input.targetRunId,async s=>{
        if(s.project.ownerId!==input.ownerId||s.project.id!==input.projectId||s.run.projectId!==input.projectId||
          s.run.id!==input.targetRunId||s.run.bibleId!==s.bible.id||s.bible.version!==a.bibleVersion||
          s.project.version!==a.stateVersion||s.run.canceledAt||!["pending","running"].includes(s.run.status)||
          a.targetRunId!==input.targetRunId)throw new ReadConnectionError("TARGET_REVISION_CHANGED");
      });
    }
    await target();await service.recordRequest(input.ownerId,input.projectId,a);
    let op=await service.prepareReader(input.ownerId,input.projectId,a.runId,a.requestId,operationId);
    for(let attempt=0;attempt<2;attempt++){
      const handoff=op.readerResults.at(-1)?.output?.handoff;
      if(!handoff||!["ready_for_review","partial"].includes(op.status))throw new ReadConnectionError("READER_CANDIDATE_UNAVAILABLE");
      const source=await repo.locked(input.ownerId,input.projectId,a.runId,async s=>resolveReadSource(s,a));
      if(JSON.stringify(source.snapshot.chapters.map(c=>({chapterIndex:c.chapterIndex,bibleVersion:c.bibleVersion,text:c.text})))!==
        JSON.stringify([...chapters].sort((a,b)=>a.chapterIndex-b.chapterIndex)))throw new ReadConnectionError("EDITOR_ASSIGNED_SOURCE_CHANGED");
      await target();
      const priorOutput=op.editorOutputs.find(out=>out.editorId===editorId&&out.generation===op.generation&&out.handoffHash===sha256(JSON.stringify(handoff)));
      if(priorOutput)return {handoff,result:{proposal:priorOutput.proposal,usage:priorOutput.usage,modelUsed:priorOutput.modelUsed}};
      let accepted=false;
      try{
        const result=await (editorId==="critic_editor_a"?criticEditorAModel:criticEditorBModel)({
          bibleVersion:a.bibleVersion,approvedBible:source.bible,baseChapters:chapters,handoff,
          expectedRecordedRequest:a.recordedRequest,userEditorialInstructions:a.recordedRequest,
          sourceAssignment:{draftVersion:a.draftVersion,chapters:source.snapshot.chapters},
          brief:input.brief,
          async onReceivingValidated(){
            await target();await service.recordEditorExecution(input.ownerId,input.projectId,a.runId,operationId,editorId,handoff,"accepted_for_execution");accepted=true;
          },
        },model,input.options.runtime.signal);
        await target();await service.recordEditorExecution(input.ownerId,input.projectId,a.runId,operationId,editorId,handoff,"output_produced",result.modelUsed,result);
        return {handoff,result};
      }catch(error){
        if(error instanceof EditorialHandoffRejectionError){
          const next=await service.receiveReader(input.ownerId,input.projectId,a.runId,operationId,editorId);
          if(next.generation===op.generation||next.status==="exhausted")throw error;
          op=next;continue;
        }
        if(accepted)await service.recordEditorExecution(input.ownerId,input.projectId,a.runId,operationId,editorId,handoff,"failed");
        throw error;
      }
    }
    throw new ReadConnectionError("READER_REPAIR_EXHAUSTED");
  }};
}
