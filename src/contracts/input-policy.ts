/** Field-aware signals supplement, and never replace, authorization. This is a bounded filter, not proof that hidden instructions are detected. */
export type InputFinding = {
  fieldRef:string; source:string; verdict:"ACCEPT"|"FLAG"|"REJECT";
  reasonCode:string; requiredEvidenceImpact:"none"|"review"|"unavailable";
  humanCorrectionNeeded:boolean;
};
export function inspectText(value:string,kind:"creative"|"label"|"metadata",fieldRef:string,source:string):InputFinding {
  let verdict:InputFinding["verdict"]="ACCEPT";let reasonCode="WITHIN_FIELD_CONTRACT";
  // Red-team fix: match patterns against a canonical form (NFKC folds fullwidth; soft hyphens removed; fold lookalikes on scan copy only).
  const canon=value.normalize("NFKC").replace(/\u00AD/gu,"").replace(/[іаеорсІАЕОРС]/gu, c => {
    const map: Record<string, string> = { "і":"i", "а":"a", "е":"e", "о":"o", "р":"p", "с":"c", "І":"I", "А":"A", "Е":"E", "О":"O", "Р":"P", "С":"C" };
    return map[c] ?? c;
  });
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)){verdict="REJECT";reasonCode="UNEXPECTED_CONTROL_CHARACTER";}
  // Invisible Unicode tag block (ASCII smuggling) and zero-width/format chars are rejected in every field kind.
  // (Legit uses kept: subdivision-flag emoji tag sequences, and ZWJ inside creative text for emoji like 👩‍🚀.)
  else if(/[\u{E0000}-\u{E007F}\u200B\u2060-\u2064\uFEFF]/u.test(value.replace(/\u{1F3F4}[\u{E0061}-\u{E007A}]{2,7}\u{E007F}/gu,""))||(kind!=="creative"&&/[\u200C\u200D]/u.test(value))){verdict="REJECT";reasonCode="INVISIBLE_FORMAT_CHARACTER";}
  else if(kind==="label"&&/[\r\n\u202a-\u202e\u2066-\u2069]/u.test(value)){verdict="REJECT";reasonCode="SINGLE_LINE_FORMAT_EXCEPTION";}
  else if(/[\u202a-\u202e\u2066-\u2069]/u.test(value)){verdict="FLAG";reasonCode="DIRECTIONAL_FORMAT_REVIEW";}
  else if(/<\|[a-z_]+\|>|\[\/?INST\]|<\/?system>|<<\/?SYS>>|^\s*#{1,6}\s*(?:system|assistant|developer)\s*:|\bsystem\s+override\b/imu.test(canon)){verdict="FLAG";reasonCode="ROLE_DELIMITER_SIGNAL";}
  else if(/(?:(?:ignore|disregard|forget|override)\s+(?:the\s+)?(?:previous|prior|all|above|approval|policy|instructions)|publish\s+(?:now|this|immediately)|reveal\s+(?:secrets|credentials|the\s+api\s+key)|تجاهل\s+التعليمات)/iu.test(canon)){verdict="FLAG";reasonCode="INSTRUCTION_SIGNAL";}
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
