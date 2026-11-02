"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { assertIntakeDecisionsReviewed, intakeFields, intakeText, resolveIntake, scopeFromIntake, type IntakeDecision, type IntakeField, type IntakeRecord } from "../contracts/intake";
import styles from "./story-intake.module.css";
import { inspectText } from "../contracts/input-policy";
import { lcQuerySchema, type LcKind } from "../contracts/vocabulary";
import ModelStateIndicator, { type ModelRunningState } from "./model-state-indicator";

const RECENT_KEY = "weaver_recent_stories";
function getRecentStories(): Array<{ id: string; premise: string; updatedAt: number }> {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

type Props =
  | { mode: "create"; onCreated: (id: string) => Promise<void> }
  | { mode: "saved"; projectId: string; intake: IntakeRecord; locked: boolean; onRefresh: () => Promise<IntakeRecord | undefined> };
type ApiError = Error & { fields?: Record<string, string[]>; status?: number; traceId?: string; traceAvailability?: string };
type Metadata = { evidence: { provider: string; status: string; reasonCode: string; records: unknown[] }[] };
const groups = ["Foundation", "People and world", "Story direction"] as const;

export const STANDARD_GENRES = [
  "Adventure",
  "Mystery",
  "Fantasy",
  "Science Fiction",
  "Historical Fiction",
  "Horror / Gothic",
  "Thriller / Suspense",
  "Folk & Fairy Tale",
  "Coming of Age / Drama",
  "Action / Exploration",
  "Romance",
] as const;

export function inferGenreSuggestions(text: string): string[] {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {
    "Adventure": 0,
    "Mystery": 0,
    "Fantasy": 0,
    "Science Fiction": 0,
    "Historical Fiction": 0,
    "Horror / Gothic": 0,
    "Thriller / Suspense": 0,
    "Folk & Fairy Tale": 0,
    "Coming of Age / Drama": 0,
  };

  if (/ship|docks?|island|sea|ocean|sailor|voyage|journey|explore|treasure|map|quest|wilderness|jungle|mountain|sail/i.test(lower)) {
    scores["Adventure"] += 3;
    scores["Historical Fiction"] += 1;
  }
  if (/secret|unfamiliar|mystery|clue|detective|strange|curious|disappear|vanish|solve|investigate|hidden/i.test(lower)) {
    scores["Mystery"] += 3;
    scores["Thriller / Suspense"] += 2;
  }
  if (/magic|spell|dragon|wizard|curse|enchanted|fairy|portal|kingdom|beast|monster|elf|prophecy/i.test(lower)) {
    scores["Fantasy"] += 4;
    scores["Folk & Fairy Tale"] += 2;
  }
  if (/future|space|robot|alien|cyber|technology|star|planet|laboratory|scientist|time\s*machine/i.test(lower)) {
    scores["Science Fiction"] += 4;
  }
  if (/ghost|haunt|dark|nightmare|shadow|creepy|death|graveyard|fear|horror|dread|coffin/i.test(lower)) {
    scores["Horror / Gothic"] += 4;
  }
  if (/kids|boy|girl|children|growing|youth|friendship|school|teen|coming\s*of\s*age|playing/i.test(lower)) {
    scores["Coming of Age / Drama"] += 2;
    scores["Adventure"] += 1;
  }
  if (/century|castle|sword|ancient|war|king|queen|emperor|medieval|victorian|history/i.test(lower)) {
    scores["Historical Fiction"] += 3;
  }

  const sorted = Object.entries(scores)
    .filter(([_, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([genre]) => genre);

  return sorted.length >= 2 ? sorted.slice(0, 4) : ["Adventure", "Mystery", "Fantasy", "Historical Fiction"];
}

export function inferSubjectSuggestions(text: string, genre?: string): string[] {
  const lower = text.toLowerCase();
  const suggestions: string[] = [];
  if (/lighthouse|tower|beacon/.test(lower)) suggestions.push("Lighthouses");
  if (/clock|compass|watch|apprentice|brass|gear|mechanism/.test(lower)) suggestions.push("Clocks", "Inventions");
  if (/sea|sailor|ocean|ship|island|captain|voyage/.test(lower)) suggestions.push("Sea stories", "Islands");
  if (/magic|wizard|witch|spell|curse|realm|dragon/.test(lower)) suggestions.push("Magic", "Quests");
  if (/detective|clue|investigat|crime|murder|theft|secret/.test(lower)) suggestions.push("Mystery", "Detective stories");
  if (/space|planet|star|alien|robot|future/.test(lower)) suggestions.push("Science fiction", "Space flight");

  if (genre) {
    if (genre.includes("Adventure")) suggestions.push("Adventure stories", "Voyages and travels");
    else if (genre.includes("Mystery")) suggestions.push("Mystery fiction", "Detective stories");
    else if (genre.includes("Fantasy")) suggestions.push("Fantasy fiction", "Fairy tales");
    else if (genre.includes("Historical")) suggestions.push("Historical fiction");
    else if (genre.includes("Horror")) suggestions.push("Ghost stories", "Horror tales");
  }

  const unique = [...new Set(suggestions)];
  return unique.length >= 2 ? unique.slice(0, 4) : ["Adventure stories", "Mystery fiction", "Magic", "Sea stories"];
}

async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || data.message || "The request is unavailable. Try again."), { fields: data.fields, status: response.status, traceId: data.traceId, traceAvailability: data.traceAvailability });
  return data;
}

export default function StoryIntake(props: Props) {
  const router = useRouter();
  const intake = props.mode === "saved" ? props.intake : undefined;
  const locked = props.mode === "saved" && props.locked;
  const [recentStories, setRecentStories] = useState<Array<{ id: string; premise: string; updatedAt: number }>>([]);
  const [rawText, setRawText] = useState(intake?.rawText || "");
  const [decisions, setDecisions] = useState<IntakeDecision[]>(intake?.decisions || []);
  const [custom, setCustom] = useState<Partial<Record<IntakeField, string>>>({});
  const [searchWords, setSearchWords] = useState<Record<LcKind, string>>({ genreForm: "", subject: "" });
  const [searchErrors, setSearchErrors] = useState<Partial<Record<LcKind, string>>>({});
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
  const [analyzingSeconds, setAnalyzingSeconds] = useState(0);
  const [analysisError, setAnalysisError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const lastRevision = useRef(intake?.revision);
  const preserveOnRevision = useRef(false);
  const summaryMessages = [...new Set([error, ...Object.values(fieldErrors), ...Object.values(decisionErrors), scopeError ? "Confirm the brief and research scope before continuing." : ""].filter(Boolean))];

  useEffect(() => {
    setRecentStories(getRecentStories());
  }, [props.mode === "saved" ? props.projectId : undefined]);

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
    if (intake?.status !== "analyzing") {
      setAnalyzingSeconds(0);
      return;
    }
    const started = intake.startedAt ? Date.parse(intake.startedAt) : Date.now();
    setAnalyzingSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    const timer = window.setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
      setAnalyzingSeconds(elapsed);
      setNow(Date.now());
      if (props.mode === "saved" && props.onRefresh) {
        props.onRefresh().catch(() => undefined);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [intake?.status, intake?.startedAt, props]);

  const edited = !!intake && rawText !== intake.rawText;
  const stalled = intake?.status === "analyzing" && !!intake.startedAt && now - Date.parse(intake.startedAt) >= 45_000;
  const analysis = !edited && intake?.status !== "draft" && intake?.status !== "analyzing" ? intake?.analysis : undefined;

  let intakeModelState: ModelRunningState = "idle";
  let intakeModelTitle = "";
  let intakeModelMessage = "";

  if (intake?.status === "analyzing" && !edited) {
    if (stalled || analyzingSeconds >= 45) {
      intakeModelState = "timeout";
      intakeModelTitle = "Analysis Timed Out";
      intakeModelMessage = "The analysis did not finish within 45 seconds. The model request may be stalled or rate-limited. Click 'Retry analysis' to try again.";
    } else {
      intakeModelState = "loading";
      intakeModelTitle = "Claude is analyzing your story idea";
      intakeModelMessage = "Extracting narrative premise, setting, characters, arcs, and suggesting genre/structural options. Results will appear automatically.";
    }
  } else if (analysisError || (error && error.toLowerCase().includes("analysis"))) {
    intakeModelState = "fail";
    intakeModelTitle = "Analysis Failed";
    intakeModelMessage = analysisError || error;
  } else if (analysis && intake?.status === "analyzed" && !edited) {
    intakeModelState = "success";
    intakeModelTitle = "Analysis Complete";
    intakeModelMessage = "Claude successfully analyzed your story idea. Review suggestions and confirmed elements below.";
  }
  const labelFor = (field: IntakeField) => intakeFields.find(item => item.id === field)?.label || field;
  const decisionsFor = (field: IntakeField) => decisions.find(item => item.field === field);
  let values: Partial<Record<IntakeField, string>> = {};
  let previewError = "";
  if (analysis) {
    try { values = resolveIntake(analysis, decisions); }
    catch (cause) { previewError = (cause as Error).message; }
    if (!values.genre && intake?.selection?.genreForm) values.genre = intake.selection.genreForm.label;
  }
  const pendingSuggestions = analysis?.suggestions.filter(item => !(item.field === "genre" && intake?.selection?.genreForm) &&
    !decisionsFor(item.field) && (!item.dependsOn || values[item.dependsOn])) || [];
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
    setBusy(true); setError(""); setAnalysisError(""); setMessage("");
    try { await work(); }
    catch (cause) {
      const failure = cause as ApiError;
      if (failure.fields?.rawText) setTextError(true);
      const detail = failure.fields ? Object.values(failure.fields).flat().join(" ") : "";
      const notice = failure.fields?.vocabulary ? "Search again and select a current Library of Congress term, or use your answer. Your saved story and answers are preserved."
        : failure.status === 409 ? "This project changed elsewhere. Refresh the project, review your text, and try again." : `${failure.message}${detail ? ` ${detail}` : ""}`;
      const fullError = notice + (failure.traceId && /^[a-f0-9-]{36}$/i.test(failure.traceId) ? ` Trace ID: ${failure.traceId}${failure.traceAvailability === "UNAVAILABLE" ? " (local trace unavailable)" : failure.traceAvailability === "DISABLED" ? " (local trace disabled)" : ""}.` : "");
      setError(fullError);
      if (failure.message?.toLowerCase().includes("analysis") || failure.message?.toLowerCase().includes("claude") || failure.message?.toLowerCase().includes("timeout")) {
        setAnalysisError(fullError);
      }
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
  async function search(kind: LcKind, overrideWord?: string) {
    if (props.mode !== "saved" || !intake) return;
    const wordToUse = overrideWord ?? searchWords[kind];
    const parsed = lcQuerySchema.safeParse(wordToUse);
    if (!parsed.success) { setSearchErrors(previous => ({ ...previous, [kind]: "Enter 1–80 plain search characters." }));
      setError("Review the highlighted search words."); return; }
    setSearchErrors(previous => ({ ...previous, [kind]: undefined }));
    await run(async () => {
      preserveOnRevision.current = true;
      await post(`/api/projects/${props.projectId}/intake/lookup`, { expectedRevision: intake.revision, kind, words: parsed.data });
      await props.onRefresh();
      setMessage("Vocabulary lookup finished. Review the verified choices below.");
    }, true);
  }
  async function select(kind: LcKind, uri: string | null) {
    if (!intake) return;
    await run(async () => { preserveOnRevision.current = true;
      await act({ action: "selectVocabulary", expectedRevision: intake.revision, kind, uri });
      setMessage(uri ? "Verified term selected." : "Your answer remains unmapped.");
    }, true);
  }

  return <section className={styles.card} aria-labelledby="intake-title">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "4px" }}>
      <h2 id="intake-title" style={{ margin: 0 }}>{props.mode === "create" ? "Start with your story idea" : "Story idea and research scope"}</h2>
      {props.mode === "saved" && intake && (
        <span className={styles.revisionBadge}>
          Revision {intake.revision} · {intake.status}
        </span>
      )}
    </div>
    <p>Share what you know in your own words. You can start with a single sentence. The details below help Claude ask focused follow-up questions; only genre and your confirmed scope are needed before research.</p>
    <div className={styles.guide} aria-label="Story detail guide">
      {groups.map(group => <div key={group}><h3>{group}</h3><ul>{intakeFields.filter(field => field.group === group).map(field => <li key={field.id}>{field.label}</li>)}</ul></div>)}
    </div>
    <div className={styles.inputSection}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <label htmlFor="story-idea" style={{ margin: 0 }}>Your story idea</label>
        {!(props.mode === "saved" && props.locked) && !rawText && (
          <button
            type="button"
            className={styles.autoFillBtn}
            onClick={() => edit("A sailor finds a signal from an island that vanished years ago…")}
            title="Populate example idea as regular editable text"
          >
            ⚡ Auto-Fill Example
          </button>
        )}
      </div>
      <p id="story-idea-help" className={styles.hint}>1–12,000 characters. Include only details you want considered. You can revise the saved original until planning begins.</p>
      <textarea id="story-idea" value={rawText} maxLength={12_000} rows={5} disabled={busy || (props.mode === "saved" && props.locked)} aria-invalid={textError} aria-describedby={`story-idea-help${textError ? " intake-error" : ""}`} onChange={event => edit(event.target.value)} placeholder="A sailor finds a signal from an island that vanished years ago…" />
      <div className={styles.plagiarismWarning} role="note">
        <span style={{ fontSize: "14px", flexShrink: 0 }}>⚠️</span>
        <span>
          <strong>Warning:</strong> do not copy text word for word (verbatim) when writing the context for your writing assistant story building.
        </span>
      </div>
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
    <ModelStateIndicator
      state={intakeModelState}
      title={intakeModelTitle}
      message={intakeModelMessage}
      elapsedSeconds={intakeModelState === "loading" ? analyzingSeconds : undefined}
      maxSeconds={intakeModelState === "loading" ? 45 : undefined}
      onRetry={stalled ? () => run(async () => { await act({ action: "analyze", expectedRevision: intake!.revision }); }, true) : undefined}
      retryLabel="Retry analysis"
    />
    {edited && <p className={styles.notice}>Your text has changed. Save it, then analyze again before reviewing or confirming.</p>}
    {intake?.status === "analyzing" && !edited && <p role="status" className={styles.notice}>{stalled ? "The analysis did not finish. Retry analysis to request a fresh Claude review, or refresh the project to check its latest state." : "Claude is analyzing this saved idea. Use Refresh in Your projects to check for the result."}</p>}
    {props.mode === "saved" && intake?.status === "draft" && !edited && <p className={styles.notice}>Your original idea is saved. Analyze with Claude when you are ready; the call uses paid model tokens.</p>}
    {intake?.confirmed && !edited && <div className={styles.review}><h3>Confirmed research scope</h3><p><strong>Genre:</strong> {intake.confirmed.scope.genre}</p><ul>{intake.confirmed.scope.dimensions.filter(item => item.field !== "genre").map(item => <li key={item.field}><strong>{labelFor(item.field)}:</strong> {item.value}</li>)}</ul><p>Sources: NYT Books and Gutendex. This confirmation saves the scope; it does not start live research or drafting.</p>
      {intake.confirmed.scope.vocabulary && <p><strong>LC genre/form:</strong> {intake.confirmed.scope.vocabulary.genreForm?.label ?? "Unmapped"}. <strong>LC subject:</strong> {intake.confirmed.scope.vocabulary.subject?.label ?? "Unmapped"}. <strong>Gutendex topic:</strong> {intake.confirmed.scope.vocabulary.gutendexPhrase ?? "Unmapped; no Gutendex topic request"}.</p>}
      {props.mode === "saved" && !props.locked && <button disabled={busy} onClick={() => run(async () => {
        await act({ action: "reopenVocabulary", expectedRevision: intake.revision });
        setMessage("Vocabulary choices reopened. Your original idea and decisions are preserved.");
      }, true)}>Revise vocabulary choices</button>}
      {props.mode === "saved" && <button disabled={busy} onClick={() => run(async () => {
        const result = await post("/api/research/benchmarks", { projectId: props.projectId, genre: intake.confirmed!.scope.genre, providers: intake.confirmed!.scope.providers });
        setMetadata(result as Metadata);
        setMessage("Book metadata request finished. Provider status is shown below.");
      })}>Request book metadata</button>}
      {metadata && <div role="status"><h4>Metadata provider status</h4><ul>{metadata.evidence.map(item => <li key={item.provider}><strong>{item.provider === "nyt" ? "NYT Books" : "Gutendex"}:</strong> {item.status.replaceAll("_", " ")} ({item.reasonCode.replaceAll("_", " ")}), {item.records.length} records</li>)}</ul><p>Metadata only. These results do not establish prose rights or complete the research dossier. No match, unmapped, and provider unavailable require different corrections.</p></div>}
    </div>}
    {analysis && intake?.status !== "confirmed" && <>
      <div className={styles.review}><h3>Look up verified book terms</h3><p>Enter only short search words, then choose Search. The Library of Congress returns up to three verified terms. Your answer stays in your words even when no term is selected.</p>
        {(["genreForm", "subject"] as const).map(kind => { const snapshot = intake?.lookups?.[kind]; const selected = intake?.selection?.[kind];
          const label = kind === "genreForm" ? "Genre/form (LCGFT)" : "Subject (LCSH · Needed for Gutendex research)";
          const quickSubjects = kind === "subject" ? inferSubjectSuggestions(rawText, values.genre) : [];
          return <div key={kind} className={styles.vocabulary}><label htmlFor={`vocabulary-${kind}`}>{label} search words</label>
            <p className={styles.hint}>{kind === "subject" ? "A selected subject becomes your candidate Gutendex topic; required to query Project Gutenberg public domain records." : "A genre/form term describes the work, but does not become a Gutendex topic automatically."}</p>
            {quickSubjects.length > 0 && !selected && (
              <div style={{ marginBottom: "10px" }}>
                <span style={{ fontSize: "12px", color: "#fef08a", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  ✨ Quick Subject Suggestions (click to search Library of Congress):
                </span>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {quickSubjects.map(term => (
                    <button
                      key={term}
                      type="button"
                      disabled={busy || edited || locked}
                      onClick={() => {
                        setSearchWords(previous => ({ ...previous, [kind]: term }));
                        void search(kind, term);
                      }}
                      className={styles.chip}
                      style={{ fontSize: "12px", padding: "4px 8px" }}
                    >
                      🔍 {term}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className={styles.actions}><input id={`vocabulary-${kind}`} type="text" maxLength={80} value={searchWords[kind]}
              aria-invalid={!!searchErrors[kind]} aria-describedby={searchErrors[kind] ? `vocabulary-error-${kind}` : undefined}
              onChange={event => { setSearchWords(previous => ({ ...previous, [kind]: event.target.value }));
                setSearchErrors(previous => ({ ...previous, [kind]: undefined })); }} disabled={busy || edited || locked} />
              <button type="button" disabled={busy || edited || locked} onClick={() => search(kind)}>Search Library of Congress</button></div>
            {searchErrors[kind] && <p id={`vocabulary-error-${kind}`} className={styles.blocker}>{searchErrors[kind]}</p>}
            {snapshot && <div role="status"><p>Source: Library of Congress {label}. {snapshot.status === "available" ? `${snapshot.candidates.length} verified choices` : snapshot.status === "empty" ? "No verified choices" : "Temporarily unavailable"}.</p>
              {snapshot.status === "available" && <div className={styles.options}>{snapshot.candidates.map(item => <label key={item.uri}><input type="radio" name={`vocabulary-${kind}`} checked={selected?.uri === item.uri}
                onChange={() => select(kind, item.uri)} disabled={busy || locked} /><span>{item.label}</span></label>)}</div>}
              <p className={styles.hint}>Retrieved {new Date(snapshot.retrievedAt).toLocaleString()}. Terms are catalog identities, not story suggestions.</p></div>}
            <button type="button" disabled={busy || locked} onClick={() => select(kind, null)}>Your answer / leave unmapped</button>
            <p className={styles.hint}>Current choice: {selected ? `${selected.label} (verified ${kind === "genreForm" ? "LCGFT" : "LCSH"})` : "Unmapped"}.</p>
          </div>; })}
      </div>
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
              {suggestion && <><p>{suggestion.question}</p><p className={styles.hint}>{suggestion.reason}</p>{field.id !== "genre" && <div className={styles.options}>{suggestion.options.map((option, index) => <label key={index}><input type="radio" name={`intake-${field.id}`} checked={decision?.action === "accept" && decision.optionIndex === index} onChange={() => choose({ field: field.id, action: "accept", optionIndex: index })} /><span>{option}</span></label>)}</div>}</>}
              {field.id === "genre" ? (
                <div style={{ background: "#0d1322", border: "1px solid #222f4c", borderRadius: "8px", padding: "12px", marginBottom: "10px" }}>
                  <p style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#94a3b8" }}>
                    Select a genre that best categorizes your story idea. This drives AI literature research and pacing.
                  </p>
                  <strong style={{ display: "block", marginBottom: "6px", color: "#fef08a", fontSize: "12px" }}>
                    ✨ AI Suggestions (detected from your story idea):
                  </strong>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
                    {inferGenreSuggestions(rawText).map(g => {
                      const isSelected = decision?.action === "custom" && decision.value === g;
                      return (
                        <button
                          key={g}
                          type="button"
                          onClick={() => {
                            setCustom(current => ({ ...current, genre: g }));
                            choose({ field: "genre", action: "custom", value: g });
                          }}
                          className={`${styles.chip} ${isSelected ? styles.chipSelected : ""}`}
                        >
                          {isSelected ? "✓ " : ""}{g}
                        </button>
                      );
                    })}
                  </div>

                  <label htmlFor="genre-select" style={{ fontWeight: 600, fontSize: "12px", display: "block", marginBottom: "4px", color: "#e2e8f0" }}>
                    Or select from standard genres:
                  </label>
                  <select
                    id="genre-select"
                    value={decision?.action === "custom" ? decision.value : ""}
                    onChange={e => {
                      if (e.target.value) {
                        setCustom(current => ({ ...current, genre: e.target.value }));
                        choose({ field: "genre", action: "custom", value: e.target.value });
                      }
                    }}
                    className={styles.storyDropdown}
                    style={{ marginBottom: "6px" }}
                  >
                    <option value="">-- Choose a genre --</option>
                    {STANDARD_GENRES.map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>

                  {decision?.action === "custom" && decision.value && (
                    <div style={{ marginTop: "8px", padding: "6px 10px", background: "#1f1938", border: "1px solid #d4af37", borderRadius: "6px", color: "#fef08a", fontSize: "12px", fontWeight: 600 }}>
                      ✓ Selected Genre: <strong>{decision.value}</strong>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {suggestion && (
                    <div style={{ marginBottom: "6px" }}>
                      <p style={{ margin: "0 0 3px", fontSize: "13px", color: "#f8fafc" }}>{suggestion.question}</p>
                      <p className={styles.hint} style={{ margin: "0 0 6px" }}>{suggestion.reason}</p>
                      <div className={styles.chipContainer}>
                        {suggestion.options.map((option, index) => {
                          const isSelected = decision?.action === "accept" && decision.optionIndex === index;
                          const isRecommended = index === 0;
                          return (
                            <button
                              key={index}
                              type="button"
                              className={`${styles.chip} ${isSelected ? styles.chipSelected : ""} ${isRecommended ? styles.chipRecommended : ""}`}
                              onClick={() => {
                                if (isSelected) {
                                  choose({ field: field.id, action: "defer" });
                                } else {
                                  choose({ field: field.id, action: "accept", optionIndex: index });
                                }
                              }}
                            >
                              {isSelected ? "✓ " : ""}{option} {isRecommended && !isSelected ? "⭐" : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {decision && decision.action !== "defer" && (
                    <p className={styles.hint} style={{ margin: "4px 0" }}>
                      Current choice: {decision.action === "accept" ? `suggestion accepted (${suggestion?.options[decision.optionIndex] ?? ""})` : decision.action === "custom" ? decision.value : "deferred"}.
                    </p>
                  )}
                </>
              )}
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
        {pendingSuggestions.length > 0 && <div><h4>Suggestions awaiting your decision</h4><ul>{pendingSuggestions.map(item => <li key={item.field}>{labelFor(item.field)} (will remain open if unselected)</li>)}</ul></div>}
        {dependentSuggestions.length > 0 && <div><h4>Follow-up questions waiting on another detail</h4><ul>{dependentSuggestions.map(item => <li key={item.field}>{labelFor(item.field)} waits for {labelFor(item.dependsOn!)}. You can leave it unresolved.</li>)}</ul></div>}
        {deferredFields.length > 0 && <div><h4>Details you left open</h4><ul>{deferredFields.map(item => <li key={item.field}>{labelFor(item.field)} — {item.action === "reject" ? "suggestions rejected" : "decide later"}</li>)}</ul></div>}
        {unansweredFields.length > 0 && <div><h4>Other optional details still open</h4><ul>{unansweredFields.map(item => <li key={item.id}>{item.label}</li>)}</ul></div>}
        {!intake?.selection?.subject && (
          <div style={{ background: "#1c1917", border: "1px solid #78350f", borderRadius: "6px", padding: "10px 14px", margin: "10px 0" }}>
            <span style={{ fontSize: "13px", color: "#fef08a" }}>
              💡 <strong>Tip for Gutendex Research:</strong> Library of Congress Subject is currently unmapped. Selecting a verified Subject heading in &ldquo;Look up verified book terms&rdquo; above enables Project Gutenberg public domain research matching your topic.
            </span>
          </div>
        )}
        <p>Research dimensions are the details listed above. Required sources: NYT Books and Gutendex. Optional unresolved details can remain open.</p>
        <label className={styles.checkbox}><input type="checkbox" checked={scopeChecked} aria-invalid={scopeError} aria-describedby={scopeError ? "scope-error" : undefined} onChange={event => { setScopeChecked(event.target.checked); if (event.target.checked) setScopeError(false); }} /> I confirm this brief and research scope.</label>
        {scopeError && <p id="scope-error" className={styles.blocker}>Confirm the brief and research scope before continuing.</p>}
        <button className={styles.primary} disabled={busy} onClick={() => run(async () => {
          setScopeError(!scopeChecked);
          if (!values.genre) {
            setFieldErrors(previous => ({ ...previous, genre: "Select a genre before confirming the research scope." }));
            setError("Select a genre before confirming.");
            return;
          }
          if (!scopeChecked) {
            setError("Check the confirmation box before continuing.");
            return;
          }
          const autoDecisions = [...decisions];
          for (const s of analysis.suggestions) {
            if (!autoDecisions.some(d => d.field === s.field)) {
              autoDecisions.push({ field: s.field, action: "defer" });
            }
          }
          assertIntakeDecisionsReviewed(analysis, autoDecisions, intake?.selection);
          scopeFromIntake(analysis, autoDecisions, intake?.selection, intake?.version === 2);
          await act({ action: "confirm", expectedRevision: intake!.revision, analysisId: analysis.id, decisions: autoDecisions, confirmScope: true });
          setMessage("Brief and research scope confirmed.");
        })}>Confirm brief and research scope</button>
      </div>
    </>}
  </section>;
}
