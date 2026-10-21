/** Field-aware signals supplement, and never replace, authorization. */
export type InputFinding = {
  fieldRef:string; source:string; verdict:"ACCEPT"|"FLAG"|"REJECT";
  reasonCode:string; requiredEvidenceImpact:"none"|"review"|"unavailable";
  humanCorrectionNeeded:boolean;
};
export function inspectText(value:string,kind:"creative"|"label"|"metadata",fieldRef:string,source:string):InputFinding {
  let verdict:InputFinding["verdict"]="ACCEPT";let reasonCode="WITHIN_FIELD_CONTRACT";
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)){verdict="REJECT";reasonCode="UNEXPECTED_CONTROL_CHARACTER";}
  else if(kind==="label"&&/[\r\n\u200b\u202a-\u202e\u2066-\u2069]/u.test(value)){verdict="REJECT";reasonCode="SINGLE_LINE_FORMAT_EXCEPTION";}
  else if(/[\u202a-\u202e\u2066-\u2069]/u.test(value)){verdict="FLAG";reasonCode="DIRECTIONAL_FORMAT_REVIEW";}
  else if(/<\|(?:system|assistant|im_start)\|>|\[INST\]|<\/?system>/iu.test(value)){verdict="FLAG";reasonCode="ROLE_DELIMITER_SIGNAL";}
  else if(kind==="metadata"&&/(?:ignore\s+(?:previous|all|approval)|publish\s+(?:now|this)|reveal\s+(?:secrets|credentials)|تجاهل\s+التعليمات)/iu.test(value)){verdict="FLAG";reasonCode="INSTRUCTION_SIGNAL";}
  return {fieldRef,source,verdict,reasonCode,requiredEvidenceImpact:verdict==="REJECT"?"unavailable":verdict==="FLAG"?"review":"none",humanCorrectionNeeded:verdict!=="ACCEPT"};
}
const tools={reader:["read_story_state","get_genre_benchmarks"],writer:["read_story_state","propose_story_update"],critic:["read_story_state","propose_story_update"],showrunner:["read_story_state","get_genre_benchmarks","run_story_tasks","propose_story_update"]} as const;
export function assertAgentTool(role:keyof typeof tools,tool:string){
  if(!(tools[role] as readonly string[]).includes(tool))throw Error("AGENT_TOOL_DENIED");
}
/** Optional external free text is quarantined on any flag; raw text is never logged. */
export function metadataForContext(text:string,source:string){
  const finding=inspectText(text,"metadata","description",source);
  return {finding,text:finding.verdict==="ACCEPT"?text:null};
}
