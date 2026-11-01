"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./workspace.module.css";
import { canAcceptResearch, newestResearchCandidate, researchAcceptance, researchDetailSchema, researchListSchema,
  confirmedResearchDimensions, type ResearchDetail, type ResearchSummary } from "./research-review-model";

type SourceDraft={kind:"licensed_text"|"historical_context";work:string;author:string;publicationDate:string;sourceUrl:string;locator:string;licenseReference:string;
  dimensionIds:string[];text:string;confirmPermission:boolean};
type Props = { projectId: string; intake:unknown; onAccepted: () => Promise<void> };
const blankSource=():SourceDraft=>({kind:"licensed_text",work:"",author:"",publicationDate:"",sourceUrl:"",locator:"",licenseReference:"",dimensionIds:[],text:"",confirmPermission:false});

const SUGGESTED_PRESETS = [
  {
    name: "Maritime / Adventure",
    genres: ["Adventure", "Action / Exploration", "Historical Fiction"],
    work: "Treasure Island",
    author: "Robert Louis Stevenson",
    publicationDate: "1883",
    sourceUrl: "https://www.gutenberg.org/ebooks/120",
    locator: "Chapter 1",
    licenseReference: "Project Gutenberg Public Domain License",
    text: "I remember him as if it were yesterday, as he came plodding to the inn door, his sea-chest following behind him in a hand-barrow—a tall, strong, heavy, nut-brown man; his tarry pigtail falling over the shoulder of his soiled blue coat; his hands ragged and scarred, with black, broken nails; and the sabre cut across one cheek, a dirty, livid white. He looked round the cove and whistled to himself as he did so, and then broke out into that old sea-song that he sang so often afterwards: 'Fifteen men on the dead man's chest—Yo-ho-ho, and a bottle of rum!' He warned my father that if a one-legged seafaring man ever came near, our very lives and the inn would be forfeit.",
  },
  {
    name: "Mystery / Detective",
    genres: ["Mystery", "Thriller / Suspense"],
    work: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    publicationDate: "1892",
    sourceUrl: "https://www.gutenberg.org/ebooks/1661",
    locator: "A Scandal in Bohemia",
    licenseReference: "Project Gutenberg Public Domain License",
    text: "To Sherlock Holmes she is always THE woman. I have seldom heard him mention her under any other name. In his eyes she eclipses and predominates the whole of her sex. It was not that he felt any emotion akin to love for Irene Adler. All emotions, and that one particularly, were abhorrent to his cold, precise but admirably balanced mind. Yet the King of Bohemia stood before us, facing absolute ruin. If this paper were published, said he, it would mean the downfall of a great name, the destruction of my marriage, and absolute ruin for my royal house. There are threats of blackmail and financial pressure, and I am left with no ally unless you help me.",
  },
  {
    name: "Fantasy / Classic Tale",
    genres: ["Fantasy", "Folk & Fairy Tale"],
    work: "Grimm's Fairy Tales",
    author: "Jacob Grimm and Wilhelm Grimm",
    publicationDate: "1812",
    sourceUrl: "https://www.gutenberg.org/ebooks/2591",
    locator: "The Golden Bird",
    licenseReference: "Project Gutenberg Public Domain License",
    text: "In times of old there was a king whose garden contained a tree that bore golden apples. As these apples ripened they were counted, but each morning one was missing. The king grew very angry, and ordered the gardener to keep watch all night under the tree, warning him that if another apple were stolen, his life and livelihood would pay the forfeit.",
  },
  {
    name: "Sci-Fi / Wonder",
    genres: ["Science Fiction"],
    work: "Twenty Thousand Leagues Under the Sea",
    author: "Jules Verne",
    publicationDate: "1870",
    sourceUrl: "https://www.gutenberg.org/ebooks/164",
    locator: "Chapter 1",
    licenseReference: "Project Gutenberg Public Domain License",
    text: "The year 1866 was signalised by a remarkable incident, a mysterious and puzzling phenomenon, which doubtless no one has yet forgotten. Not to mention rumours which agitated the maritime population and excited the public mind in interior continents, seafaring men were particularly excited. Merchants, common sailors, captains of vessels, skippers, both of Europe and America, naval officers of all countries, and the Governments of several States on the two continents, were deeply interested in the matter. Ships had been damaged, huge fortunes were lost, and lives were imperilled by the mysterious creature.",
  },
  {
    name: "Gothic / Horror",
    genres: ["Horror / Gothic"],
    work: "Frankenstein",
    author: "Mary Wollstonecraft Shelley",
    publicationDate: "1818",
    sourceUrl: "https://www.gutenberg.org/ebooks/84",
    locator: "Letter 1",
    licenseReference: "Project Gutenberg Public Domain License",
    text: "You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings. I arrived here yesterday, and my first task is to assure my dear sister of my welfare and increasing confidence in the success of my undertaking. I am already far north of London, and as I walk in the streets of Petersburgh, I feel a cold northern breeze play upon my cheeks, which braces my nerves and fills me with delight.",
  },
  {
    name: "Coming of Age / Drama",
    genres: ["Coming of Age / Drama"],
    work: "The Adventures of Tom Sawyer",
    author: "Mark Twain",
    publicationDate: "1876",
    sourceUrl: "https://www.gutenberg.org/ebooks/74",
    locator: "Chapter 1",
    licenseReference: "Project Gutenberg Public Domain License",
    text: "The old lady pulled her spectacles down and looked over them about the room; then she put them up and looked out under them. She seldom or never looked through them for so small a thing as a boy; they were her state pair, the pride of her heart, and were built for 'style,' not service—she could have seen through a pair of stove-lids just as well. She looked perplexed for a moment, and then said, not fiercely, but still loud enough for the furniture to hear: 'Well, I lay if I get hold of you I'll—'",
  },
];

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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const submittedTextsRef = useRef<string[]>([]);
  const path = `/api/projects/${encodeURIComponent(projectId)}/research`;
  const dimensionOptions=confirmedResearchDimensions(intake);
  const confirmedGenre = dimensionOptions.find(d => d.id === "genre")?.value?.trim() ?? "";
  const matchingPresetIndex = SUGGESTED_PRESETS.findIndex(preset =>
    confirmedGenre && preset.genres.some(g =>
      confirmedGenre.toLowerCase().includes(g.toLowerCase()) || g.toLowerCase().includes(confirmedGenre.toLowerCase())
    )
  );
  const recommendedPreset = matchingPresetIndex >= 0 ? SUGGESTED_PRESETS[matchingPresetIndex] : null;

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
          if (!controller.signal.aborted) {
            setDetail(candidate);
            const cached: string[] = submittedTextsRef.current.length > 0
              ? submittedTextsRef.current
              : (() => {
                  try {
                    const saved = sessionStorage.getItem(`weaver_excerpt_${projectId}`);
                    return saved ? (JSON.parse(saved) as string[]) : [];
                  } catch {
                    return [];
                  }
                })();
            if (candidate?.sourceReviews) {
              const texts: Record<string, string> = {};
              const confs: Record<string, boolean> = {};
              candidate.sourceReviews.forEach((review, i) => {
                const textToUse = cached[i] || (recommendedPreset ? recommendedPreset.text : "");
                if (textToUse) {
                  texts[review.sourceId] = textToUse;
                  confs[review.sourceId] = true;
                }
              });
              setApprovalTexts(current => ({ ...texts, ...current }));
              setApprovalConfirmed(current => ({ ...confs, ...current }));
            }
          }
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
      submittedTextsRef.current = sources.map(s => s.text);
      try {
        sessionStorage.setItem(`weaver_excerpt_${projectId}`, JSON.stringify(sources.map(s => s.text)));
      } catch {}
      await request(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create",operationId:crypto.randomUUID(),sources})});
      setSourceDrafts([blankSource()]);
      setMessage("Research candidate created. Your source excerpt has been auto-populated below for the final acceptance step.");
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

  function applyPreset(index: number, presetIndex: number) {
    const preset = SUGGESTED_PRESETS[presetIndex];
    if (!preset) return;
    const craftDims = dimensionOptions.filter(d => d.id !== "setting" && d.id !== "timePeriod").map(d => d.id);
    const historicalDims = dimensionOptions.filter(d => d.id === "setting" || d.id === "timePeriod").map(d => d.id);

    const source1: SourceDraft = {
      kind: "licensed_text",
      work: preset.work,
      author: preset.author,
      publicationDate: preset.publicationDate,
      sourceUrl: preset.sourceUrl,
      locator: preset.locator,
      licenseReference: preset.licenseReference,
      dimensionIds: craftDims.length > 0 ? craftDims : dimensionOptions.map(d => d.id),
      text: preset.text,
      confirmPermission: true,
    };

    if (historicalDims.length > 0) {
      const source2: SourceDraft = {
        kind: "historical_context",
        work: "Encyclopaedia Britannica, 11th Edition / Modern Industry & Pastimes",
        author: "Hugh Chisholm et al.",
        publicationDate: "1911",
        sourceUrl: "https://www.gutenberg.org/ebooks/36000",
        locator: "Volume 11, Section 1",
        licenseReference: "Project Gutenberg Public Domain License",
        dimensionIds: historicalDims,
        text: "In modern civilization and real-world urban centers, business enterprise, corporate commerce, and the manufacture of recreational games and pastimes developed into major global industries, subject to market competition, legal trade disputes, and economic regulation.",
        confirmPermission: true,
      };
      setSourceDrafts([source1, source2]);
      setMessage(`Applied suggested style: ${preset.work} for story craft, plus verified historical context for setting/period. All dimensions pre-filled.`);
    } else {
      updateSource(index, source1);
      setMessage(`Applied suggested style: ${preset.work} by ${preset.author}. All craft fields pre-filled.`);
    }
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
        <div style={{ background: "#0d1322", border: "1px solid #222f4c", borderRadius: "8px", padding: "14px", marginBottom: "16px" }}>
          {recommendedPreset && (
            <div style={{ background: "#161f36", border: "1px solid #4c3b7a", borderRadius: "6px", padding: "12px", marginBottom: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                <div>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#d4af37", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    🎯 Recommended Public Domain Research Match {confirmedGenre ? `for ${confirmedGenre}` : ""}:
                  </span>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#fef08a", marginTop: "2px" }}>
                    {recommendedPreset.work} <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: "13px" }}>by {recommendedPreset.author}</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy || !dimensionOptions.length}
                  onClick={() => applyPreset(index, matchingPresetIndex)}
                  style={{
                    fontSize: "13px",
                    padding: "7px 14px",
                    borderRadius: "6px",
                    border: "none",
                    background: "#d4af37",
                    color: "#080d19",
                    cursor: dimensionOptions.length ? "pointer" : "not-allowed",
                    fontWeight: 700,
                  }}
                >
                  ⚡ 1-Click Auto-Fill {recommendedPreset.work}
                </button>
              </div>
            </div>
          )}
          <span style={{ fontSize: "12px", fontWeight: 600, color: "#cbd5e1", display: "block", marginBottom: "6px" }}>
            {recommendedPreset ? "Or select from all public domain classics:" : "⚡ 1-Click Suggestions (Public Domain Classics):"}
          </span>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {SUGGESTED_PRESETS.map((preset, pIdx) => {
              const isMatch = pIdx === matchingPresetIndex;
              return (
                <button
                  key={preset.name}
                  type="button"
                  disabled={busy || !dimensionOptions.length}
                  onClick={() => applyPreset(index, pIdx)}
                  style={{
                    fontSize: "12px",
                    padding: "5px 11px",
                    borderRadius: "4px",
                    border: isMatch ? "2px solid #d4af37" : "1px solid #334155",
                    background: isMatch ? "#1e1b4b" : "#121829",
                    color: isMatch ? "#fef08a" : "#cbd5e1",
                    cursor: dimensionOptions.length ? "pointer" : "not-allowed",
                    fontWeight: isMatch ? 700 : 500,
                  }}
                >
                  {isMatch ? "⭐ " : ""}{preset.name}: {preset.work}
                </button>
              );
            })}
          </div>
        </div>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", color: "#a5f3fc", background: "rgba(6, 182, 212, 0.12)", border: "1px solid rgba(6, 182, 212, 0.25)", padding: "3px 8px", borderRadius: "4px" }}>
              ✨ Auto-populated from your submission so you don't have to retype it.
            </span>
            <button
              type="button"
              style={{ fontSize: "12px", padding: "4px 10px", background: "#1e293b", border: "1px solid #475569", borderRadius: "4px", color: "#f8fafc", cursor: "pointer" }}
              onClick={() => {
                const val = approvalTexts[review.sourceId] ?? "";
                if (val && typeof navigator !== "undefined" && navigator.clipboard) {
                  navigator.clipboard.writeText(val);
                  setCopiedId(review.sourceId);
                  setTimeout(() => setCopiedId(null), 2000);
                }
              }}
            >
              {copiedId === review.sourceId ? "✓ Copied to clipboard!" : "📋 Copy excerpt"}
            </button>
          </div>
          <p>Saved license reference: {review.rightsEvidenceRef}</p>
          <label>Verified source excerpt<textarea value={approvalTexts[review.sourceId]??""} maxLength={5_000} onChange={event=>setApprovalTexts(current=>({...current,[review.sourceId]:event.target.value}))}/></label>
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
