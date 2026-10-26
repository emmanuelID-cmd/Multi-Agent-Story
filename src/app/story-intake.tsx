"use client";

import { useEffect, useRef, useState } from "react";
import { assertIntakeDecisionsReviewed, intakeFields, intakeText, resolveIntake, scopeFromIntake, type IntakeDecision, type IntakeField, type IntakeRecord } from "../contracts/intake";
import styles from "./story-intake.module.css";
import { inspectText } from "../contracts/input-policy";

type Props =
  | { mode: "create"; onCreated: (id: string) => Promise<void> }
  | { mode: "saved"; projectId: string; intake: IntakeRecord; locked: boolean; onRefresh: () => Promise<IntakeRecord | undefined> };
type ApiError = Error & { fields?: Record<string, string[]>; status?: number };
type Metadata = { evidence: { provider: string; status: string; reasonCode: string; records: unknown[] }[] };
const groups = ["Foundation", "People and world", "Story direction"] as const;

async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || data.message || "The request is unavailable. Try again."), { fields: data.fields, status: response.status });
  return data;
}

export default function StoryIntake(props: Props) {
  const intake = props.mode === "saved" ? props.intake : undefined;
  const [rawText, setRawText] = useState(intake?.rawText || "");
  const [decisions, setDecisions] = useState<IntakeDecision[]>(intake?.decisions || []);
  const [custom, setCustom] = useState<Partial<Record<IntakeField, string>>>({});
  const [scopeChecked, setScopeChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<IntakeField, string>>>({});
  const [decisionErrors, setDecisionErrors] = useState<Partial<Record<IntakeField, string>>>({});
  const [textError, setTextError] = useState(false);
  const [scopeError, setScopeError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const errorRef = useRef<HTMLDivElement>(null);
  const lastRevision = useRef(intake?.revision);
  const preserveOnRevision = useRef(false);
  const summaryMessages = [...new Set([error, ...Object.values(fieldErrors), ...Object.values(decisionErrors), scopeError ? "Confirm the brief and research scope before continuing." : ""].filter(Boolean))];

  useEffect(() => {
    if (!intake || intake.revision === lastRevision.current) return;
    lastRevision.current = intake.revision;
    if (!preserveOnRevision.current) {
      setRawText(intake.rawText);
      setDecisions(intake.decisions);
      setCustom({});
    }
    preserveOnRevision.current = false;
    setScopeChecked(false);
    setMetadata(null);
    setDecisionErrors({});
    setFieldErrors({});
  }, [intake]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (intake?.status !== "analyzing") return;
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [intake?.status]);

  const edited = !!intake && rawText !== intake.rawText;
  const stalled = intake?.status === "analyzing" && !!intake.startedAt && now - Date.parse(intake.startedAt) >= 45_000;
  const analysis = !edited && intake?.status !== "draft" && intake?.status !== "analyzing" ? intake?.analysis : undefined;
  const labelFor = (field: IntakeField) => intakeFields.find(item => item.id === field)?.label || field;
  const decisionsFor = (field: IntakeField) => decisions.find(item => item.field === field);
  let values: Partial<Record<IntakeField, string>> = {};
  let previewError = "";
  if (analysis) {
    try { values = resolveIntake(analysis, decisions); }
    catch (cause) { previewError = (cause as Error).message; }
  }
  const pendingSuggestions = analysis?.suggestions.filter(item => !decisionsFor(item.field) && (!item.dependsOn || values[item.dependsOn])) || [];
  const dependentSuggestions = analysis?.suggestions.filter(item => item.dependsOn && !values[item.dependsOn]) || [];
  const deferredFields = decisions.filter(item => item.action === "reject" || item.action === "defer");
  const unansweredFields = analysis ? intakeFields.filter(item => item.id !== "genre" && !values[item.id] && !analysis.suggestions.some(suggestion => suggestion.field === item.id) && !deferredFields.some(decision => decision.field === item.id)) : [];

  function choose(decision: IntakeDecision) {
    setDecisions(previous => {
      const changed = JSON.stringify(previous.find(item => item.field === decision.field)) !== JSON.stringify(decision);
      const descendants = new Set<IntakeField>([decision.field]);
      if (changed) {
        let size = 0;
        while (descendants.size !== size) {
          size = descendants.size;
          for (const suggestion of analysis?.suggestions || []) {
            if (suggestion.dependsOn && descendants.has(suggestion.dependsOn)) descendants.add(suggestion.field);
          }
        }
      }
      return [...previous.filter(item => item.field !== decision.field && (!changed || !descendants.has(item.field))), decision];
    });
    setScopeChecked(false);
    setMetadata(null);
    setFieldErrors(previous => { const next = { ...previous }; delete next[decision.field]; return next; });
    setDecisionErrors(previous => { const next = { ...previous }; delete next[decision.field]; return next; });
    setError("");
  }
  function edit(value: string) {
    setRawText(value);
    setScopeChecked(false);
    setMetadata(null);
    setTextError(false);
    setFieldErrors({});
    setDecisionErrors({});
    setScopeError(false);
    setError("");
  }
  async function run(work: () => Promise<void>, refreshAfterFailure = false) {
    setBusy(true); setError(""); setMessage("");
    try { await work(); }
    catch (cause) {
      const failure = cause as ApiError;
      if (failure.fields?.rawText) setTextError(true);
      const detail = failure.fields ? Object.values(failure.fields).flat().join(" ") : "";
      setError(failure.status === 409 ? "This project changed elsewhere. Refresh the project, review your text, and try again." : `${failure.message}${detail ? ` ${detail}` : ""}`);
      if (refreshAfterFailure && props.mode === "saved") {
        preserveOnRevision.current = true;
        try { const updated = await props.onRefresh(); if (updated?.revision === intake?.revision) preserveOnRevision.current = false; }
        catch { preserveOnRevision.current = false; }
      }
    } finally { setBusy(false); }
  }
  function validateText() {
    const result = intakeText.safeParse(rawText);
    if (!result.success) { setTextError(true); setError(result.error.issues.map(issue => issue.message).join(" ")); return false; }
    return true;
  }
  async function act(body: unknown) {
    if (props.mode !== "saved") return;
    await post(`/api/projects/${props.projectId}/intake`, body);
    await props.onRefresh();
  }

  return <section className={styles.card} aria-labelledby="intake-title">
    <h2 id="intake-title">{props.mode === "create" ? "Start with your story idea" : "Story idea and research scope"}</h2>
    <p>Share what you know in your own words. You can start with a single sentence. The details below help Claude ask focused follow-up questions; only genre and your confirmed scope are needed before research.</p>
    <div className={styles.guide} aria-label="Story detail guide">
      {groups.map(group => <div key={group}><h3>{group}</h3><ul>{intakeFields.filter(field => field.group === group).map(field => <li key={field.id}>{field.label}</li>)}</ul></div>)}
    </div>
    <div className={styles.inputSection}>
      <label htmlFor="story-idea">Your story idea</label>
      <p id="story-idea-help" className={styles.hint}>1–12,000 characters. Include only details you want considered. You can revise the saved original until planning begins.</p>
      <textarea id="story-idea" value={rawText} maxLength={12_000} rows={7} disabled={busy || (props.mode === "saved" && props.locked)} aria-invalid={textError} aria-describedby={`story-idea-help${textError ? " intake-error" : ""}`} onChange={event => edit(event.target.value)} placeholder="A sailor finds a signal from an island that vanished years ago…" />
      <span className={styles.count}>{rawText.length.toLocaleString()} / 12,000</span>
    </div>
    {summaryMessages.length > 0 && <div id="intake-error" role="alert" tabIndex={-1} ref={errorRef} className={styles.error}><ul>{summaryMessages.map(message => <li key={message}>{message}</li>)}</ul></div>}
    <div role="status" aria-live="polite">{busy ? "Working…" : message}</div>
    <div className={styles.actions}>
      {props.mode === "create" ? <button className={styles.primary} disabled={busy} onClick={() => run(async () => {
        if (!validateText()) return;
        const project = await post("/api/projects", { rawText });
        await props.onCreated(project.id);
      })}>Save story idea</button> : <>
        {!props.locked && <button disabled={busy || !edited} onClick={() => run(async () => {
          if (!validateText()) return;
          await act({ action: "save", expectedRevision: intake!.revision, rawText });
          setMessage("Original idea saved. Analyze it again to review current suggestions.");
        })}>Save changes</button>}
        {!props.locked && intake?.status !== "confirmed" && <button className={styles.primary} disabled={busy || edited || (intake?.status === "analyzing" && !stalled)} onClick={() => run(async () => {
          await act({ action: "analyze", expectedRevision: intake!.revision });
          setMessage("Analysis requested. Refresh if it is still in progress.");
        }, true)}>{stalled ? "Retry analysis" : "Analyze with Claude"}</button>}
      </>}
    </div>
    {edited && <p className={styles.notice}>Your text has changed. Save it, then analyze again before reviewing or confirming.</p>}
    {intake?.status === "analyzing" && !edited && <p role="status" className={styles.notice}>{stalled ? "The analysis did not finish. Retry analysis to request a fresh Claude review, or refresh the project to check its latest state." : "Claude is analyzing this saved idea. Use Refresh in Your projects to check for the result."}</p>}
    {props.mode === "saved" && intake?.status === "draft" && !edited && <p className={styles.notice}>Your original idea is saved. Analyze with Claude when you are ready; the call uses paid model tokens.</p>}
    {intake?.confirmed && !edited && <div className={styles.review}><h3>Confirmed research scope</h3><p><strong>Genre:</strong> {intake.confirmed.scope.genre}</p><ul>{intake.confirmed.scope.dimensions.filter(item => item.field !== "genre").map(item => <li key={item.field}><strong>{labelFor(item.field)}:</strong> {item.value}</li>)}</ul><p>Sources: NYT Books and Gutendex. This confirmation saves the scope; it does not start live research or drafting.</p>
      {props.mode === "saved" && <button disabled={busy} onClick={() => run(async () => {
        const result = await post("/api/research/benchmarks", { projectId: props.projectId, genre: intake.confirmed!.scope.genre, providers: intake.confirmed!.scope.providers });
        setMetadata(result as Metadata);
        setMessage("Book metadata request finished. Provider status is shown below.");
      })}>Request book metadata</button>}
      {metadata && <div role="status"><h4>Metadata provider status</h4><ul>{metadata.evidence.map(item => <li key={item.provider}><strong>{item.provider === "nyt" ? "NYT Books" : "Gutendex"}:</strong> {item.status.replaceAll("_", " ")} ({item.reasonCode.replaceAll("_", " ")}), {item.records.length} records</li>)}</ul><p>Metadata only. These results do not establish prose rights or complete the research dossier.</p></div>}
    </div>}
    {analysis && intake?.status !== "confirmed" && <>
      <div className={styles.review}><h3>What Claude found in your text</h3><p>{analysis.summary}</p>
        {analysis.observations.length ? <ul>{analysis.observations.map((item, index) => <li key={`${item.field}-${index}`}><strong>{labelFor(item.field)}:</strong> “{item.quote}” {item.ambiguous ? <em>Needs clarification; excluded from the brief until you decide.</em> : <em>Quoted from your idea.</em>}</li>)}</ul> : <p>No details could be quoted with confidence. Add an answer below or revise your idea.</p>}
      </div>
      <div className={styles.review}><h3>Details to consider</h3><p>{intakeFields.filter(field => !values[field.id]).length} of 18 guide details are still open. These are optional except genre. Suggestions are separate from your text and become part of the brief only if you accept or write an answer.</p>
        {groups.map(group => {
          const fields = intakeFields.filter(field => field.group === group && !analysis.observations.some(item => item.field === field.id && !item.ambiguous) && (analysis.missing.includes(field.id) || analysis.suggestions.some(item => item.field === field.id)));
          if (!fields.length) return null;
          return <div key={group}><h4>{group}</h4>{fields.map(field => {
            const suggestion = analysis.suggestions.find(item => item.field === field.id);
            const decision = decisionsFor(field.id);
            const blocked = !!suggestion?.dependsOn && !values[suggestion.dependsOn];
            const entry = <fieldset className={styles.fieldset} disabled={blocked || busy} aria-invalid={!!decisionErrors[field.id]} aria-describedby={decisionErrors[field.id] ? `decision-error-${field.id}` : undefined}><legend>{field.label}{field.id === "genre" ? " — needed for research" : " — optional"}</legend>
              {decisionErrors[field.id] && <p id={`decision-error-${field.id}`} className={styles.blocker}>{decisionErrors[field.id]}</p>}
              {blocked && <p className={styles.hint}>Answer {labelFor(suggestion!.dependsOn!)} first to use this follow-up.</p>}
              {suggestion && <><p>{suggestion.question}</p><p className={styles.hint}>{suggestion.reason}</p><div className={styles.options}>{suggestion.options.map((option, index) => <label key={index}><input type="radio" name={`intake-${field.id}`} checked={decision?.action === "accept" && decision.optionIndex === index} onChange={() => choose({ field: field.id, action: "accept", optionIndex: index })} /><span>{option}</span></label>)}</div></>}
              <label htmlFor={`custom-${field.id}`}>Your answer</label><textarea id={`custom-${field.id}`} rows={2} maxLength={2_000} value={custom[field.id] ?? (decision?.action === "custom" ? decision.value : "")} aria-invalid={!!fieldErrors[field.id]} aria-describedby={fieldErrors[field.id] ? `custom-error-${field.id}` : undefined} onChange={event => { setCustom(current => ({ ...current, [field.id]: event.target.value })); if (event.target.value.trim()) setFieldErrors(previous => { const next = { ...previous }; delete next[field.id]; return next; }); if (decision?.action === "custom") choose({ field: field.id, action: "defer" }); }} />
              {fieldErrors[field.id] && <p id={`custom-error-${field.id}`} className={styles.blocker}>{fieldErrors[field.id]}</p>}
              <div className={styles.actions}><button type="button" onClick={() => { const value = (custom[field.id] ?? (decision?.action === "custom" ? decision.value : "")).trim(); const invalid = !value ? `Write an answer for ${field.label} first.` : inspectText(value, field.id === "genre" ? "label" : "creative", field.id, "intake-decision").verdict !== "ACCEPT" ? `Review the formatting in ${field.label}; remove role markers or hidden control characters.` : field.id === "genre" && value.length > 80 ? "Keep Genre within 80 characters." : ""; if (invalid) { setFieldErrors(previous => ({ ...previous, [field.id]: invalid })); setError("Review the highlighted answer."); return; } choose({ field: field.id, action: "custom", value }); }}>Use my answer</button><button type="button" aria-pressed={decision?.action === "reject"} onClick={() => choose({ field: field.id, action: "reject" })}>Reject suggestions</button><button type="button" aria-pressed={decision?.action === "defer"} onClick={() => choose({ field: field.id, action: "defer" })}>Decide later</button></div>
              {decision && <p className={styles.hint}>Current choice: {decision.action === "accept" ? "suggestion accepted" : decision.action === "custom" ? "your answer" : decision.action === "reject" ? "suggestions rejected" : "deferred"}.</p>}
            </fieldset>;
            return suggestion || field.id === "genre" ? <div key={field.id}>{entry}</div> : <details key={field.id} className={styles.optional}><summary>Add optional detail: {field.label}{decision?.action === "custom" ? " (answered)" : ""}</summary>{entry}</details>;
          })}</div>;
        })}
      </div>
      <div className={styles.actions}><button disabled={busy || !!previewError || JSON.stringify(decisions) === JSON.stringify(intake?.decisions)} onClick={() => run(async () => {
        await act({ action: "review", expectedRevision: intake!.revision, analysisId: analysis.id, decisions });
        setMessage("Review progress saved. You can return to these choices later.");
      })}>Save review progress</button><p className={styles.hint}>{JSON.stringify(decisions) === JSON.stringify(intake?.decisions) ? "Review choices are saved." : "Choices are unsaved. Save review progress to resume later, or confirm to save them with the scope."}</p></div>
      <div className={styles.review}><h3>Review your brief and research scope</h3><p>Only quoted, unambiguous details and answers you chose are included.</p>
        {previewError && <p role="alert" className={styles.error}>{previewError}</p>}
        <ul>{intakeFields.filter(field => values[field.id]).map(field => <li key={field.id}><strong>{field.label}:</strong> {values[field.id]}</li>)}</ul>
        {!values.genre && <p className={styles.blocker}>Genre is still needed. Add it under Foundation before confirming.</p>}
        {pendingSuggestions.length > 0 && <div><h4>Suggestions awaiting your decision</h4><ul>{pendingSuggestions.map(item => <li key={item.field}>{labelFor(item.field)} — choose an option, write an answer, reject, or decide later.</li>)}</ul></div>}
        {dependentSuggestions.length > 0 && <div><h4>Follow-up questions waiting on another detail</h4><ul>{dependentSuggestions.map(item => <li key={item.field}>{labelFor(item.field)} waits for {labelFor(item.dependsOn!)}. You can leave it unresolved.</li>)}</ul></div>}
        {deferredFields.length > 0 && <div><h4>Details you left open</h4><ul>{deferredFields.map(item => <li key={item.field}>{labelFor(item.field)} — {item.action === "reject" ? "suggestions rejected" : "decide later"}</li>)}</ul></div>}
        {unansweredFields.length > 0 && <div><h4>Other optional details still open</h4><ul>{unansweredFields.map(item => <li key={item.id}>{item.label}</li>)}</ul></div>}
        <p>Research dimensions are the details listed above. Required sources: NYT Books and Gutendex. Optional unresolved details can remain open.</p>
        <label className={styles.checkbox}><input type="checkbox" checked={scopeChecked} aria-invalid={scopeError} aria-describedby={scopeError ? "scope-error" : undefined} onChange={event => { setScopeChecked(event.target.checked); if (event.target.checked) setScopeError(false); }} /> I confirm this brief and research scope.</label>
        {scopeError && <p id="scope-error" className={styles.blocker}>Confirm the brief and research scope before continuing.</p>}
        <button className={styles.primary} disabled={busy} onClick={() => run(async () => {
          const missingDecisions = Object.fromEntries(pendingSuggestions.map(item => [item.field, `Review ${labelFor(item.field)}: choose an option, write an answer, reject, or decide later.`]));
          setDecisionErrors(missingDecisions);
          setScopeError(!scopeChecked);
          if (!values.genre) setFieldErrors(previous => ({ ...previous, genre: "Add a genre before confirming the research scope." }));
          if (previewError || !values.genre || !scopeChecked || pendingSuggestions.length) { setError(previewError || "Review the highlighted details before confirmation."); return; }
          assertIntakeDecisionsReviewed(analysis, decisions);
          scopeFromIntake(analysis, decisions);
          await act({ action: "confirm", expectedRevision: intake!.revision, analysisId: analysis.id, decisions, confirmScope: true });
          setMessage("Brief and research scope confirmed.");
        })}>Confirm brief and research scope</button>
      </div>
    </>}
  </section>;
}
