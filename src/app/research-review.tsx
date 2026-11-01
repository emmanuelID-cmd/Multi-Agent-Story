"use client";

import { useEffect, useState } from "react";
import styles from "./workspace.module.css";
import { canAcceptResearch, newestResearchCandidate, researchAcceptance, researchDetailSchema, researchListSchema,
  confirmedResearchDimensions, type ResearchDetail, type ResearchSummary } from "./research-review-model";

type SourceDraft={kind:"licensed_text"|"historical_context";work:string;author:string;publicationDate:string;sourceUrl:string;locator:string;licenseReference:string;
  dimensionIds:string[];text:string;confirmPermission:boolean};
type Props = { projectId: string; intake:unknown; onAccepted: () => Promise<void> };
const blankSource=():SourceDraft=>({kind:"licensed_text",work:"",author:"",publicationDate:"",sourceUrl:"",locator:"",licenseReference:"",dimensionIds:[],text:"",confirmPermission:false});
function validHttpsUrl(value:string){try{return new URL(value).protocol==="https:";}catch{return false;}}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, init);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error : "Research review is unavailable. Try refreshing.";
    throw new Error(message);
  }
  return data;
}

export default function ResearchReview({ projectId, intake, onAccepted }: Props) {
  const [summary, setSummary] = useState<ResearchSummary | null>(null);
  const [detail, setDetail] = useState<ResearchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const [sourceDrafts,setSourceDrafts]=useState<SourceDraft[]>([blankSource()]);
  const [approvalTexts,setApprovalTexts]=useState<Record<string,string>>({});
  const [approvalConfirmed,setApprovalConfirmed]=useState<Record<string,boolean>>({});
  const path = `/api/projects/${encodeURIComponent(projectId)}/research`;
  const dimensionOptions=confirmedResearchDimensions(intake);

  useEffect(() => { setActionError(""); }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError(""); setSummary(null); setDetail(null);
      try {
        const list = researchListSchema.parse(await request(path, { signal: controller.signal }));
        const latest = newestResearchCandidate(list);
        if (controller.signal.aborted) return;
        setSummary(latest);
        if (latest) {
          const candidate = researchDetailSchema.parse(await request(`${path}?candidateId=${encodeURIComponent(latest.id)}`, { signal: controller.signal }));
          if (!controller.signal.aborted) setDetail(candidate);
        }
      } catch {
        if (!controller.signal.aborted) setError("Research review is unavailable or its saved details could not be validated. Refresh to try again.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [path, revision]);

  async function accept() {
    if (!canAcceptResearch(summary, detail) || !detail) return;
    const transientReviews=detail.sourceReviews.filter(review=>review.requireTransientResubmission);
    const transientSources=transientReviews.map(review=>({sourceId:review.sourceId,licenseReference:review.rightsEvidenceRef,
      text:approvalTexts[review.sourceId]??"",confirmPermission:approvalConfirmed[review.sourceId]===true}));
    if(transientSources.some(source=>!source.text.trim()||!source.confirmPermission)){
      setActionError("Paste each same excerpt again and confirm you still have permission to use it.");
      return;
    }
    setBusy(true); setError(""); setActionError(""); setMessage("");
    try {
      await request(path, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({action:"accept",...researchAcceptance(detail, crypto.randomUUID()),transientSources}) });
      setApprovalTexts({});setApprovalConfirmed({});
      setMessage("Research acceptance saved. Refreshing the current dossier.");
      setRevision(current => current + 1);
      try { await onAccepted(); } catch { setMessage("Research acceptance saved. Refresh the project to update its status."); }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Research could not be accepted. Refresh and review it again.");
      setRevision(current => current + 1);
    } finally { setBusy(false); }
  }

  async function createCandidate(){
    if(!dimensionOptions.length||sourceDrafts.some(source=>!source.work.trim()||!source.author.trim()||!validHttpsUrl(source.sourceUrl)||
      !source.locator.trim()||!source.licenseReference.trim()||!source.dimensionIds.length||!source.text.trim()||!source.confirmPermission))return;
    setBusy(true);setError("");setActionError("");setMessage("");
    try{
      const sources=sourceDrafts.map(source=>({...source,publicationDate:source.publicationDate.trim()||null,
        dimensionIds:dimensionOptions.filter(option=>source.dimensionIds.includes(option.id)).map(option=>option.id)}));
      await request(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create",operationId:crypto.randomUUID(),sources})});
      setSourceDrafts([blankSource()]);
      setMessage("Research candidate saved. The original excerpt was removed from saved evidence and checked for long verbatim matches. Short fragments or paraphrases may still appear in saved findings.");
      setRevision(current=>current+1);
      try{await onAccepted();}catch{setMessage("Research candidate saved. Refresh the project to update its status.");}
    }catch(cause){setActionError(cause instanceof Error?cause.message:"Research could not be started. Your current source text remains in this page.");}
    finally{setBusy(false);}
  }

  function updateSource(index:number,update:Partial<SourceDraft>){
    setSourceDrafts(current=>current.map((source,sourceIndex)=>sourceIndex===index?{...source,...update}:source));
  }
  function toggleDimension(index:number,id:string,checked:boolean){
    const source=sourceDrafts[index];
    updateSource(index,{dimensionIds:checked?[...source.dimensionIds,id]:source.dimensionIds.filter(value=>value!==id)});
  }

  return <div>
    <div className={styles.heading}><div><h3>Research dossier review</h3><p>Review the current version and its evidence before accepting it for planning.</p></div>
      <button type="button" disabled={busy || loading} onClick={() => { setMessage(""); setActionError(""); setRevision(current => current + 1); }}>Refresh research</button></div>
    <div role="status" aria-live="polite">{loading ? "Loading research review…" : message}</div>
    {error && <p role="alert" className={styles.fieldError}>{error}</p>}
    {actionError && <p role="alert" className={styles.fieldError}>{actionError}</p>}
    {!loading && !error && !summary && <p>No research dossier has been created for this confirmed scope yet.</p>}
    {!loading && !error && summary && !detail && <p>Research details are unavailable. Refresh before deciding.</p>}
    {!loading && <section className={styles.proposal} aria-labelledby="research-create-heading">
      <h4 id="research-create-heading">Create a research candidate</h4>
      <p>Provide text you have permission to use. The excerpt is sent to the configured READ model for analysis. Weaver removes it from the saved evidence and checks model output for long verbatim matches before saving. This check cannot detect paraphrases or guarantee that the model did not restate the excerpt. Paste the same excerpt again if you accept the dossier. Permission is your attestation and is not independently verified.</p>
      {!dimensionOptions.length && <p role="alert" className={styles.fieldError}>Confirm the current story scope before starting research.</p>}
      {sourceDrafts.map((source,index)=><fieldset className={styles.task} key={index}>
        <legend>User-provided source {index+1}</legend>
        <label>Source purpose<select value={source.kind} onChange={event=>updateSource(index,{kind:event.target.value as SourceDraft["kind"]})}>
          <option value="licensed_text">Story craft, genre, dialogue, or narration</option>
          <option value="historical_context">Historical facts about setting or time period</option>
        </select></label>
        <label>Work title<input value={source.work} maxLength={300} onChange={event=>updateSource(index,{work:event.target.value})}/></label>
        <label>Author<input value={source.author} maxLength={300} onChange={event=>updateSource(index,{author:event.target.value})}/></label>
        <label>Publication date, if known<input value={source.publicationDate} maxLength={40} onChange={event=>updateSource(index,{publicationDate:event.target.value})}/></label>
        <label>Source link (reference only; Weaver will not fetch it)<input type="url" value={source.sourceUrl} maxLength={2_000} onChange={event=>updateSource(index,{sourceUrl:event.target.value})}/></label>
        <label>Page, chapter, or passage location<input value={source.locator} maxLength={200} onChange={event=>updateSource(index,{locator:event.target.value})}/></label>
        <label>License name, link, or permission reference<input value={source.licenseReference} maxLength={300} onChange={event=>updateSource(index,{licenseReference:event.target.value})}/></label>
        <fieldset><legend>Which confirmed details can this source support?</legend>{dimensionOptions.map(option=><label key={option.id}>
          <input type="checkbox" checked={source.dimensionIds.includes(option.id)} onChange={event=>toggleDimension(index,option.id,event.target.checked)}/>
          {option.id}: {option.value}</label>)}</fieldset>
        <label>Excerpt for analysis<textarea value={source.text} maxLength={5_000} onChange={event=>updateSource(index,{text:event.target.value})}/></label>
        <p className={styles.small}>{source.text.length} / 5,000 characters. Do not paste text you are not permitted to provide.</p>
        <label><input type="checkbox" checked={source.confirmPermission} onChange={event=>updateSource(index,{confirmPermission:event.target.checked})}/>
          I confirm I have permission to submit this text for research analysis. Weaver records this as my attestation; it does not independently verify the license terms.</label>
        {sourceDrafts.length>1&&<button type="button" disabled={busy} onClick={()=>setSourceDrafts(current=>current.filter((_,sourceIndex)=>sourceIndex!==index))}>Remove source</button>}
      </fieldset>)}
      <div className={styles.actions}>
        <button type="button" disabled={busy||sourceDrafts.length>=3} onClick={()=>setSourceDrafts(current=>[...current,blankSource()])}>Add another source</button>
        <button type="button" className={styles.primary} disabled={busy||!dimensionOptions.length||sourceDrafts.some(source=>!source.work.trim()||!source.author.trim()||
          !validHttpsUrl(source.sourceUrl)||!source.locator.trim()||!source.licenseReference.trim()||!source.dimensionIds.length||!source.text.trim()||!source.confirmPermission)}
          onClick={()=>void createCandidate()}>Analyze sources and create dossier</button>
      </div>
    </section>}
    {detail && summary && <article className={styles.proposal}>
      <h4>Dossier v{detail.version} · {detail.status}</h4>
      <p>Brief v{detail.dossier.briefVersion} · Research scope v{detail.dossier.scopeVersion}</p>
      <p><strong>Research gate:</strong> {!summary.current || !detail.current ? "Outdated: review the current brief and create fresh research" : detail.dossier.gateRecommendation === "ACCEPT_CANDIDATE" ? "Ready for your review" : "Blocked: required evidence is missing"}</p>
      <h4>Provider outcomes</h4><ul><li>NYT Books: {detail.dossier.providerOutcomes.nyt.status} ({detail.dossier.providerOutcomes.nyt.reasonCode})</li>
        <li>Gutendex: {detail.dossier.providerOutcomes.gutendex.status} ({detail.dossier.providerOutcomes.gutendex.reasonCode})</li></ul>
      <h4>Coverage</h4>{detail.dossier.coverage.length ? <ul>{detail.dossier.coverage.map(item => <li key={item.dimensionId}>{item.dimensionId}: {item.status}</li>)}</ul> : <p>No coverage recorded.</p>}
      {detail.dossier.gaps.length > 0 && <><h4>Gaps and next steps</h4><ul>{detail.dossier.gaps.map((item, index) => <li key={`${item.dimensionId}-${index}`}><strong>{item.dimensionId}:</strong> {item.reason} {item.correction}</li>)}</ul></>}
      <h4>Sources and rights</h4>{detail.dossier.sources.length ? <ul>{detail.dossier.sources.map(source => <li key={source.sourceId}>{source.work} · {source.author} · {source.locator}<br />{source.sourceUrl}<br />Rights: {source.rightsBasis} · Retrieved {source.fetchedAt}</li>)}</ul> : <p>No eligible text sources recorded.</p>}
      {detail.dossier.items.length > 0 && <><h4>Evidence</h4><ul>{detail.dossier.items.map(item => <li key={item.itemId}><strong>{item.dimensionId} · {item.kind}</strong> — {item.claim} (source {item.sourceId})<br />Location: {item.locator ?? "Not provided"}<br />Passage: {item.quote ?? "Verbatim passage not stored; source fingerprint is rechecked at approval."}<br />Recorded confidence: {item.confidence} (unverified estimate)</li>)}</ul></>}
      {detail.dossier.synthesis.length > 0 && <><h4>Research synthesis</h4><ul>{detail.dossier.synthesis.map((item, index) => <li key={`${item.dimensionId}-${index}`}><strong>{item.dimensionId}:</strong> {item.observation}</li>)}</ul></>}
      {detail.dossier.limitations.length > 0 && <><h4>Limitations</h4><ul>{detail.dossier.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
      {detail.status==="pending"&&detail.sourceReviews.some(review=>review.requireTransientResubmission)&&<section aria-labelledby="research-source-recheck-heading"><h4 id="research-source-recheck-heading">Recheck licensed excerpts before approval</h4>
        <p>Paste each same excerpt again. Weaver compares its fingerprint and the saved permission reference, then checks each passage fingerprint against the excerpt. The text is processed in memory and not saved.</p>
        {detail.sourceReviews.filter(review=>review.requireTransientResubmission).map(review=><fieldset className={styles.task} key={review.sourceId}><legend>{detail.dossier.sources.find(source=>source.sourceId===review.sourceId)?.work??"Licensed source"}</legend>
          <p>Saved license reference: {review.rightsEvidenceRef}</p>
          <label>Paste the same excerpt<textarea value={approvalTexts[review.sourceId]??""} maxLength={5_000} onChange={event=>setApprovalTexts(current=>({...current,[review.sourceId]:event.target.value}))}/></label>
          <label><input type="checkbox" checked={approvalConfirmed[review.sourceId]===true} onChange={event=>setApprovalConfirmed(current=>({...current,[review.sourceId]:event.target.checked}))}/>
            I still have permission to use this text, and the saved license reference remains accurate.</label>
        </fieldset>)}
      </section>}
      {detail.status === "accepted" ? <p>{summary.current && detail.current ? "Accepted for planning, subject to current server-side checks." : "Previously accepted research no longer matches the current brief. Create and review fresh research."}</p> :
        <button type="button" className={styles.primary} disabled={busy || !canAcceptResearch(summary, detail)||detail.sourceReviews.length===0||
          detail.sourceReviews.filter(review=>review.requireTransientResubmission).some(review=>!(approvalTexts[review.sourceId]??"").trim()||approvalConfirmed[review.sourceId]!==true)} onClick={() => void accept()}>Accept this exact dossier</button>}
      {detail.status === "pending" && !canAcceptResearch(summary, detail) && <p>Acceptance is unavailable until the current dossier is reviewable and required evidence is supported. Refresh after resolving the gaps.</p>}
    </article>}
  </div>;
}
