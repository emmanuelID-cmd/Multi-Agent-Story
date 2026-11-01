"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { type Bible } from "../contracts";
import type { BibleProposal } from "../contracts/planning";
import type { projectState } from "../server/projects";
import styles from "./workspace.module.css";
import StoryIntake from "./story-intake";
import ModelStateIndicator, { type ModelRunningState } from "./model-state-indicator";
import ResearchReview from "./research-review";
import { showBibleCandidate, canRetryBiblePlanning } from "./planning-visibility";
import { manuscriptConsistencyLabel } from "./manuscript-status";
import { isCurrentConsistencyStatus } from "../agents/consistency-current";

type Snapshot = Awaited<ReturnType<typeof projectState>>;
type Fields = Record<string, string[]>;
type ReadRecovery = { operations: { agent: "reader" | "consistency"; operationId: string; status: string; reasonCode: string; savedResultStatus: string; dependencyVersions: { projectState: number; approvedBible: number; draft: number; request: number; editorialRound: number }; retryAvailable: boolean }[] };
type ConsistencyPair = { versionA?: { status?: string }; versionB?: { status?: string } };
type RecentStory = { id: string; premise: string; updatedAt: number };

export type PipelineStage = "intake" | "research" | "plan" | "draft";

export const PIPELINE_STAGES = [
  {
    id: "intake" as const,
    number: 1,
    title: "Story Idea & Scope",
    subtitle: "Premise, genre & character scope",
    icon: "💡",
  },
  {
    id: "research" as const,
    number: 2,
    title: "Reference Research",
    subtitle: "Classic literature & Gutendex evidence",
    icon: "🔍",
  },
  {
    id: "plan" as const,
    number: 3,
    title: "Story Bible & Plan",
    subtitle: "Candidate Bibles A, B, C & directives",
    icon: "📜",
  },
  {
    id: "draft" as const,
    number: 4,
    title: "Drafting & Review",
    subtitle: "3 chapters, editorial revisions & export",
    icon: "✒️",
  },
] as const;

function consistencyPair(critique: unknown): ConsistencyPair {
  return (critique as { consistency?: ConsistencyPair } | null)?.consistency ?? {};
}

function showFailedConsistencyGate(state: Snapshot): boolean {
  const run = state.run;
  if (!run || (run.status !== "paused" && run.status !== "completed")) return false;
  if (!state.bible) return true;
  if (state.project.brief.intake && run.status === "paused") return true;
  const pair = consistencyPair(state.critique);
  if (pair.versionA?.status === "unavailable") return false;
  const versionBStatus = pair.versionB?.status;
  const versionANotCurrent = !isCurrentConsistencyStatus(pair.versionA?.status);
  const versionBNotCurrent = versionBStatus !== undefined && !isCurrentConsistencyStatus(versionBStatus);
  return versionANotCurrent || versionBNotCurrent;
}

function manuscriptAcceptEnabled(state: Snapshot): boolean {
  if (!state.project.brief.intake) return true;
  if (state.run?.status !== "completed") return false;
  const pair = consistencyPair(state.critique);
  if (pair.versionA?.status === "unavailable" || !pair.versionA?.status) return true;
  return isCurrentConsistencyStatus(pair.versionA?.status) && isCurrentConsistencyStatus(pair.versionB?.status);
}

async function api(path: string, body?: unknown) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await res.json();
  if (!res.ok) throw Object.assign(Error(data.error || data.message || "Temporarily unavailable."), { fields: data.fields, status: res.status });
  return data;
}

const RECENT_KEY = "weaver_recent_stories";

function loadRecents(): RecentStory[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecent(item: RecentStory) {
  if (typeof window === "undefined") return;
  try {
    const list = loadRecents().filter(s => s.id !== item.id);
    list.unshift(item);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)));
  } catch {}
}

export default function Workspace({ workId }: { workId?: string }) {
  const router = useRouter();
  const selected = workId || "";
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Fields>({});
  const summary = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<Snapshot | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [activeStage, setActiveStage] = useState<PipelineStage>("intake");
  const stageManuallySelected = useRef(false);
  const isInitialized = useRef(false);
  const prevMilestones = useRef({
    intakeConfirmed: false,
    researchAccepted: false,
    bibleApproved: false,
  });
  const [fixture, setFixture] = useState("normal");
  const [pollFailure, setPollFailure] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [readRecovery, setReadRecovery] = useState<ReadRecovery | null>(null);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState<Record<string, boolean>>({});
  const [planningAcknowledged, setPlanningAcknowledged] = useState<Record<string, boolean>>({});
  const [recents, setRecents] = useState<RecentStory[]>([]);
  const [copied, setCopied] = useState(false);
  const [activeModelAction, setActiveModelAction] = useState<string | null>(null);
  const [modelElapsedSeconds, setModelElapsedSeconds] = useState(0);
  const [modelActionError, setModelActionError] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [customIntricacies, setCustomIntricacies] = useState<Array<{ id: string; category: string; text: string }>>([]);
  const [newIntricacyCategory, setNewIntricacyCategory] = useState<string>("Character");
  const [newIntricacyText, setNewIntricacyText] = useState<string>("");

  useEffect(() => {
    if (selected) {
      try {
        const saved = localStorage.getItem(`story_intricacies_${selected}`);
        if (saved) setCustomIntricacies(JSON.parse(saved));
        else setCustomIntricacies([]);
      } catch {
        setCustomIntricacies([]);
      }
    }
  }, [selected]);

  const saveCustomIntricacies = (updated: Array<{ id: string; category: string; text: string }>) => {
    setCustomIntricacies(updated);
    if (selected) {
      try {
        localStorage.setItem(`story_intricacies_${selected}`, JSON.stringify(updated));
      } catch {}
    }
  };

  useEffect(() => {
    setRecents(loadRecents());
  }, []);

  const refresh = async (id = selected) => {
    if (!id) return;
    try {
      const next = (await api(`/api/projects/${id}`)) as Snapshot;
      setState(next);
      setNotFound(false);
      setPollFailure("");
      saveRecent({
        id: next.project.id,
        premise: next.project.brief.premise.slice(0, 80),
        updatedAt: Date.now(),
      });
      setRecents(loadRecents());
      return next;
    } catch (e: any) {
      if (e.status === 404) {
        setNotFound(true);
      } else {
        setError(e.message);
      }
    }
  };

  useEffect(() => {
    setState(null);
    setNotFound(false);
    setReadRecovery(null);
    setRecoveryAcknowledged({});
    setPlanningAcknowledged({});
    isInitialized.current = false;
    stageManuallySelected.current = false;
    prevMilestones.current = {
      intakeConfirmed: false,
      researchAccepted: false,
      bibleApproved: false,
    };
    if (selected) {
      refresh(selected);
    }
  }, [selected]);

  useEffect(() => {
    if (!selected || !state?.run?.id) {
      setReadRecovery(null);
      return;
    }
    api(`/api/projects/${selected}/read?runId=${encodeURIComponent(state.run.id)}`)
      .then(setReadRecovery)
      .catch(() => setReadRecovery(null));
  }, [selected, state?.run?.id]);

  useEffect(() => {
    const isRunActive = !!state?.run && ["pending", "running"].includes(state.run.status);
    const isPlanningActive = state?.latestPlanning?.status === "running" || activeModelAction === "plan" || activeModelAction === "retry-bible-planning";
    if (!selected || (!isRunActive && !isPlanningActive)) return;
    const timer = setInterval(() => {
      refresh(selected).catch(() => setPollFailure("Progress temporarily unavailable. Saved outputs remain safe; select Refresh to retry."));
    }, 1500);
    return () => clearInterval(timer);
  }, [selected, state?.run?.status, state?.latestPlanning?.status, activeModelAction]);

  useEffect(() => {
    if (error) summary.current?.focus();
  }, [error]);

  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      const failure = e as Error & { fields?: Fields };
      setError(failure.message);
      if (failure.fields) setFields(failure.fields);
    } finally {
      setBusy(false);
    }
  }

  async function action(body: unknown) {
    const act = body as { action?: string };
    const actionName = act?.action || "action";
    setActiveModelAction(actionName);
    setModelElapsedSeconds(0);
    setModelActionError("");
    const startTime = Date.now();
    const intervalTimer = setInterval(() => {
      setModelElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    try {
      await perform(async () => {
        try {
          await api(`/api/projects/${selected}`, body);
        } catch (error) {
          await refresh().catch(() => undefined);
          throw error;
        }
        await refresh();
        setMessage("Saved. The view reflects the latest project state.");
      });
    } catch (e: any) {
      setModelActionError(e.message || "Model request failed.");
    } finally {
      clearInterval(intervalTimer);
      if (actionName !== "run") {
        setTimeout(() => setActiveModelAction(null), 8000);
      }
    }
  }

  const copyLink = async () => {
    const url = typeof window !== "undefined" ? `${window.location.origin}/${selected}` : `/${selected}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setMessage("Story link copied to clipboard.");
    } catch {
      setMessage(`Story link: ${url}`);
    }
  };

  const isPlanningRunning = (busy && (activeModelAction === "plan" || activeModelAction === "retry-bible-planning")) || state?.latestPlanning?.status === "running";
  const isPlanningFailed = state?.latestPlanning?.status === "failed" || (!!modelActionError && (activeModelAction === "plan" || activeModelAction === "retry-bible-planning"));
  const isPlanningTimeout = isPlanningFailed && (modelActionError?.toLowerCase().includes("timeout") || modelElapsedSeconds >= 120);
  const hasCandidates = state ? state.pending.some(p => ["bible_a", "bible_b", "bible_c"].includes(p.kind)) : false;
  const isPlanningCompleted = state?.latestPlanning?.status === "completed" || hasCandidates;

  let planningState: ModelRunningState = "idle";
  let planningTitle = "";
  let planningMessage = "";

  if (isPlanningRunning) {
    planningState = "loading";
    planningTitle = "Claude Haiku is generating candidate story bibles";
    planningMessage = "Planning 3 distinct directional candidates in parallel: Candidate A (Plot & Mystery), Candidate B (Character & Stakes), and Candidate C (World & Atmosphere)...";
  } else if (isPlanningTimeout) {
    planningState = "timeout";
    planningTitle = "Bible Planning Timed Out";
    planningMessage = "The model call exceeded the 120-second timeout limit. Your confirmed brief and accepted research are preserved. Use planning recovery below.";
  } else if (isPlanningFailed) {
    planningState = "fail";
    planningTitle = "Bible Planning Failed";
    planningMessage = modelActionError || "Candidate generation encountered an error. Review the planning recovery options below.";
  } else if (isPlanningCompleted) {
    planningState = "success";
    planningTitle = "Candidate Bibles Generated Successfully";
    planningMessage = "3 directional story bibles have been proposed. Review each direction and approve your preferred plan below.";
  }

  const isRunActive = !!state?.run && ["pending", "running"].includes(state.run.status);
  const isRunCompleted = state?.run?.status === "completed";
  const isRunFailed = state?.run?.status === "failed";
  const hasTaskTimeout = state?.tasks?.some(t => t.error?.toLowerCase().includes("timeout"));
  const isRunTimeout = isRunFailed && (hasTaskTimeout || fixture === "timeout");
  const completedTaskCount = state?.tasks?.filter(t => t.status === "completed").length || 0;
  const totalTaskCount = state?.tasks?.length || 3;

  let draftState: ModelRunningState = "idle";
  let draftTitle = "";
  let draftMessage = "";

  if (isRunActive) {
    draftState = "loading";
    draftTitle = "Story drafting and review in progress";
    draftMessage = `Writing and checking chapters with Writers 1–3 and Editors A & B. Completed: ${completedTaskCount} of ${totalTaskCount} tasks...`;
  } else if (isRunTimeout) {
    draftState = "timeout";
    draftTitle = "Drafting Run Timed Out";
    draftMessage = "One or more chapter tasks exceeded the task timeout limit (120s). You can retry failed tasks once below.";
  } else if (isRunFailed) {
    draftState = "fail";
    draftTitle = "Drafting Run Failed";
    draftMessage = "One or more chapter tasks failed. Review the task status cards below and use 'Retry failed tasks once'.";
  } else if (isRunCompleted) {
    draftState = "success";
    draftTitle = "Drafting Run Completed Successfully";
    draftMessage = "All 3 chapters were generated, verified, and editorial critique completed. Review the manuscript below.";
  }

  // Live timer for active drafting run or candidate planning
  useEffect(() => {
    if (!isRunActive && !isPlanningRunning) {
      if (!busy) setModelElapsedSeconds(0);
      return;
    }

    const runStartTime = isRunActive && state?.run?.createdAt
      ? new Date(state.run.createdAt).getTime()
      : Date.now();

    const updateTimer = () => {
      setModelElapsedSeconds(Math.max(0, Math.floor((Date.now() - runStartTime) / 1000)));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [isRunActive, isPlanningRunning, state?.run?.createdAt, state?.run?.id, busy]);

  const hasIntake = Boolean(state?.project.brief.intake);
  const isIntakeConfirmed = hasIntake ? state?.project.brief.intake?.status === "confirmed" : true;
  const isResearchAccepted = Boolean(
    state?.acceptedResearch?.status === "accepted" ||
    state?.bible ||
    hasCandidates
  );
  const isBibleApproved = Boolean(state?.bible);
  const isDraftCompleted = Boolean(state?.acceptedManuscript || (state?.run?.status === "completed" && state?.chapters.length === 3));

  function getFurthestActiveStage(currentState: Snapshot): PipelineStage {
    if (currentState.project.brief.intake) {
      if (currentState.project.brief.intake.status !== "confirmed") return "intake";
      const resAccepted = Boolean(
        currentState.acceptedResearch?.status === "accepted" ||
        currentState.bible ||
        currentState.pending.some(p => ["bible_a", "bible_b", "bible_c"].includes(p.kind))
      );
      if (!resAccepted) return "research";
      if (!currentState.bible) return "plan";
      return "draft";
    }
    if (!currentState.bible) return "plan";
    return "draft";
  }

  function isStageComplete(stageId: PipelineStage): boolean {
    if (stageId === "intake") return isIntakeConfirmed;
    if (stageId === "research") return isResearchAccepted;
    if (stageId === "plan") return isBibleApproved;
    if (stageId === "draft") return isDraftCompleted;
    return false;
  }

  function isStageAccessible(stageId: PipelineStage): boolean {
    if (stageId === "intake") return true;
    if (stageId === "research") return isIntakeConfirmed;
    if (stageId === "plan") return isResearchAccepted || !hasIntake;
    if (stageId === "draft") return isBibleApproved || Boolean(state?.run);
    return false;
  }

  const handleSelectStage = (newStage: PipelineStage) => {
    if (!isStageAccessible(newStage)) return;
    stageManuallySelected.current = true;
    setActiveStage(newStage);
  };

  useEffect(() => {
    if (!state) return;

    const currentMilestones = {
      intakeConfirmed: isIntakeConfirmed,
      researchAccepted: isResearchAccepted,
      bibleApproved: isBibleApproved,
    };

    if (!isInitialized.current) {
      isInitialized.current = true;
      prevMilestones.current = currentMilestones;
      setActiveStage(getFurthestActiveStage(state));
      return;
    }

    if (!prevMilestones.current.intakeConfirmed && currentMilestones.intakeConfirmed) {
      setActiveStage("research");
      stageManuallySelected.current = false;
    } else if (!prevMilestones.current.researchAccepted && currentMilestones.researchAccepted) {
      setActiveStage("plan");
      stageManuallySelected.current = false;
    } else if (!prevMilestones.current.bibleApproved && currentMilestones.bibleApproved) {
      setActiveStage("draft");
      stageManuallySelected.current = false;
    } else if (!stageManuallySelected.current) {
      setActiveStage(getFurthestActiveStage(state));
    }

    prevMilestones.current = currentMilestones;
  }, [state, isIntakeConfirmed, isResearchAccepted, isBibleApproved]);

  const fullUrl = typeof window !== "undefined" && selected ? `${window.location.origin}/${selected}` : selected ? `/${selected}` : "";

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#workspace">Skip to workspace</a>
      <aside className={styles.sidebar}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <img src="/weaver-logo.png" alt="Weaver Logo" style={{ width: "32px", height: "32px", borderRadius: "6px", border: "1px solid #d4af37", background: "#0c111e", padding: "2px", objectFit: "contain" }} />
          <p className={styles.brand}>Weaver</p>
        </div>
        <p className={styles.eyebrow}>THREADKEEPER ENGINE</p>
        <p className={styles.railCopy}>One shared plan.<br />Three coordinated chapters.<br />Live Claude Haiku.</p>
        <div className={styles.owners}>Manny · READ Agents<br />Justin · WRITE Agents</div>
      </aside>
      <div className={styles.main}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.scrollPenBadge} title="Weaver: Ink Pen Writing on Scroll">
              <span className={styles.scrollEmoji}>📜</span>
              <span className={styles.penEmoji}>🖋️</span>
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h1 className={styles.headerBrandTitle}>WEAVER</h1>
                <span className={styles.headerBrandTag}>MIDNIGHT FOLIO</span>
              </div>
              <p className={styles.headerBrandSub}>
                One shared plan · Three coordinated chapters · Live AI storytelling
              </p>
            </div>
          </div>
          <div className={styles.headerRight}>
            {selected && (
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button type="button" className={styles.headerBtn} disabled={busy} onClick={copyLink}>{copied ? "✓ Copied" : "🔗 Copy link"}</button>
                <button type="button" className={styles.headerBtn} disabled={busy} onClick={() => router.push("/")}>➕ New story</button>
              </div>
            )}
            <div className={styles.logoContainer} title="Weaver Threadkeeper Logo">
              <img src="/weaver-logo.png" alt="Weaver Logo" className={styles.topRightLogo} />
            </div>
          </div>
        </header>
        <main id="workspace" className={styles.content}>
          <span className={styles.badge}>LIVE STORY WORKSPACE · THREADKEEPER</span>
          <h1>A story starts with<br />a decision you approve.</h1>
          <p className={styles.lead}>
            Claude reviews your story idea and extracts narrative structure. Candidate bibles are proposed by live Claude Haiku and grounded in accepted research.
          </p>
          <div role="status" aria-live="polite">{busy ? "Saving…" : message}</div>
          {(error || Object.keys(fields).length > 0) && (
            <div role="alert" ref={summary} tabIndex={-1} className={styles.error}>
              <strong>{error || "Check these fields before continuing."}</strong>
              <ul>
                {Object.entries(fields).map(([key, notes]) => (
                  <li key={key}><a href={`#${key}`}>{key}: {notes.join(" ")}</a></li>
                ))}
              </ul>
            </div>
          )}

          {!selected ? (
            <>
              {recents.length > 0 && (
                <section className={styles.card}>
                  <h2>Recent stories on this device</h2>
                  <p>Stories previously created or opened on this browser. Share or bookmark their links to keep them safe.</p>
                  <ul>
                    {recents.map(r => (
                      <li key={r.id} style={{ margin: "8px 0" }}>
                        <a href={`/${r.id}`} style={{ fontWeight: 600, color: "#203e32" }}>
                          {r.premise || "Untitled story"}
                        </a>
                        <span style={{ fontSize: "12px", color: "#888", marginLeft: "10px" }}>
                          ({new Date(r.updatedAt).toLocaleDateString()})
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <StoryIntake
                mode="create"
                onCreated={async id => {
                  saveRecent({ id, premise: "New story", updatedAt: Date.now() });
                  router.push(`/${id}`);
                }}
              />
            </>
          ) : notFound ? (
            <section className={styles.card}>
              <h2>Story unavailable</h2>
              <p>The story link could not be found or has an invalid format. Check your link or start a new story.</p>
              <button className={styles.primary} onClick={() => router.push("/")}>Start a new story</button>
            </section>
          ) : state ? (
            <>
              <div className={styles.projectSummary}>
                <span>State version <strong>{state.project.version}</strong></span>
                <span>Approved bible <strong>{state.bible ? `v${state.bible.version}` : "Not yet approved"}</strong></span>
                <span>Run <strong>{state.run?.status || "Not started"}</strong></span>
              </div>
              {state.run?.status === "failed" && (
                <p role="alert" className={styles.fieldError}>Gate failed: {state.tasks.find(t => t.status === "failed")?.error || "Run failed before completion."}</p>
              )}
              {showFailedConsistencyGate(state) && (
                <p role="note" className={styles.fieldError}>
                  {!state.bible
                    ? "Bible approval missing."
                    : state.run?.status === "paused"
                    ? "Run paused: Consistency check is unavailable (READ lane disconnected); proposals are not fully approved."
                    : "Synthetic fixture run: Consistency check is unavailable (READ lane disconnected); proposals are not fully approved."}
                </p>
              )}
              {state.chapters.length === 3 && (
                <div className={styles.card} style={{ background: "#f0fdf4", borderColor: "#86efac" }}>
                  <h3 style={{ margin: "0 0 8px 0", color: "#166534" }}>Your chapters are saved</h3>
                  <p style={{ margin: "0 0 12px 0", color: "#15803d" }}>
                    All three chapters are safely stored in Postgres. Anyone with this secret link can return and continue this story at any time.
                  </p>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <code style={{ background: "#fff", padding: "4px 8px", borderRadius: "4px", border: "1px solid #bbf7d0" }}>{fullUrl}</code>
                    <button type="button" onClick={copyLink}>{copied ? "Copied!" : "Copy link"}</button>
                  </div>
                </div>
              )}
              {state.run && (
                <details className={styles.card}>
                  <summary id="read-recovery-heading" style={{ fontWeight: "bold", cursor: "pointer" }}>Reader and Consistency recovery</summary>
                  <p>Uncertain READ calls do not restart automatically. Check the saved dependency versions before authorizing the single retry.</p>
                  {!readRecovery ? (
                    <p role="status">Recovery status is unavailable. Refresh the project to check again.</p>
                  ) : readRecovery.operations.length === 0 ? (
                    <p>No saved READ operations for this run.</p>
                  ) : (
                    readRecovery.operations.map(operation => (
                      <article className={styles.task} key={operation.operationId}>
                        <h3>{operation.agent === "reader" ? "Reader" : "Consistency"} · {operation.status}</h3>
                        <p>Operation <code>{operation.operationId}</code></p>
                        <p>Saved result: {operation.savedResultStatus} · {operation.reasonCode}</p>
                        <p>Project v{operation.dependencyVersions.projectState} · Bible v{operation.dependencyVersions.approvedBible} · Draft v{operation.dependencyVersions.draft} · Request v{operation.dependencyVersions.request} · Round {operation.dependencyVersions.editorialRound}</p>
                        {operation.retryAvailable && (
                          <>
                            <label>
                              <input
                                type="checkbox"
                                checked={!!recoveryAcknowledged[operation.operationId]}
                                onChange={e => setRecoveryAcknowledged(current => ({ ...current, [operation.operationId]: e.target.checked }))}
                              /> Anthropic may count requests from both the original operation and this retry. This action does not create a Weaver end-user charge.
                            </label>
                            <button
                              disabled={busy || !recoveryAcknowledged[operation.operationId]}
                              onClick={() => perform(async () => {
                                await api(`/api/projects/${selected}/read`, {
                                  action: "retry_uncertain",
                                  runId: state.run!.id,
                                  operationId: operation.operationId,
                                  confirmDuplicateProviderCall: true,
                                });
                                setRecoveryAcknowledged(current => ({ ...current, [operation.operationId]: false }));
                                setReadRecovery(await api(`/api/projects/${selected}/read?runId=${encodeURIComponent(state.run!.id)}`));
                                setMessage("The retry decision was saved. Check the updated operation status.");
                              })}
                            >Authorize one retry</button>
                          </>
                        )}
                        {!operation.retryAvailable && operation.status !== "ready_for_review" && (
                          <p>No retry is available for this operation.</p>
                        )}
                      </article>
                    ))
                  )}
                </details>
              )}
              {(isPlanningRunning || isRunActive) && (
                <ModelStateIndicator
                  state="loading"
                  title={isPlanningRunning ? "Claude Haiku is generating candidate bibles..." : "Drafting & review tasks in progress..."}
                  message={isPlanningRunning ? "Running 3 planning roles (Plot & Mystery, Character & Stakes, World & Atmosphere)..." : `Drafting chapters (${completedTaskCount}/${totalTaskCount} completed)...`}
                  elapsedSeconds={modelElapsedSeconds}
                  maxSeconds={isPlanningRunning ? 120 : undefined}
                />
              )}

              {/* Sequential Connection Pipeline Header & Checkpoint Drop-box */}
              <div className={styles.pipelineBar}>
                <div className={styles.checkpointDropdownRow}>
                  <div className={styles.checkpointDropdownGroup}>
                    <label htmlFor="pipeline-checkpoint" className={styles.checkpointLabel}>
                      <span className={styles.checkpointIcon}>📍</span> Pipeline Checkpoint:
                    </label>
                    <select
                      id="pipeline-checkpoint"
                      className={styles.checkpointSelect}
                      value={activeStage}
                      onChange={e => handleSelectStage(e.target.value as PipelineStage)}
                    >
                      {PIPELINE_STAGES.map(s => {
                        const complete = isStageComplete(s.id);
                        const accessible = isStageAccessible(s.id);
                        const isActive = activeStage === s.id;
                        let statusSuffix = "";
                        if (complete) statusSuffix = "✓ Completed";
                        else if (isActive) statusSuffix = "• Active Setup";
                        else if (accessible) statusSuffix = "Available";
                        else statusSuffix = "🔒 Locked";

                        return (
                          <option key={s.id} value={s.id} disabled={!accessible}>
                            Stage {s.number}: {s.title} ({statusSuffix})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className={styles.pipelineStagePill}>
                    {activeStage === "intake" && "Stage 1 of 4 · Story Scope Setup"}
                    {activeStage === "research" && "Stage 2 of 4 · Reference Research Setup"}
                    {activeStage === "plan" && "Stage 3 of 4 · Story Direction & Bible"}
                    {activeStage === "draft" && "Stage 4 of 4 · Chapter Production & Review"}
                  </div>
                </div>

                <div className={styles.pipelineStepper} role="tablist" aria-label="Pipeline Stages">
                  {PIPELINE_STAGES.map(s => {
                    const complete = isStageComplete(s.id);
                    const accessible = isStageAccessible(s.id);
                    const isActive = activeStage === s.id;

                    return (
                      <button
                        key={s.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        disabled={!accessible}
                        className={`${styles.stepperStep} ${isActive ? styles.stepperStepActive : ""} ${complete ? styles.stepperStepComplete : ""} ${!accessible ? styles.stepperStepLocked : ""}`}
                        onClick={() => handleSelectStage(s.id)}
                      >
                        <div className={styles.stepBadge}>
                          {complete ? "✓" : !accessible ? "🔒" : s.number}
                        </div>
                        <div className={styles.stepInfo}>
                          <span className={styles.stepNumber}>Stage {s.number}</span>
                          <strong className={styles.stepTitle}>{s.title}</strong>
                          <span className={styles.stepSubtitle}>{s.subtitle}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Stage 1: Story Idea & Scope */}
              {activeStage === "intake" && (
                <section id="stage-intake" aria-label="Stage 1: Story Idea and Scope">
                  {state.project.brief.intake ? (
                    <>
                      <StoryIntake
                        key={selected}
                        mode="saved"
                        projectId={selected}
                        intake={state.project.brief.intake}
                        locked={!!state.bible || !!state.run || state.pending.length > 0}
                        onRefresh={async () => {
                          const next = await refresh(selected);
                          return next?.project.brief.intake;
                        }}
                      />
                      {isIntakeConfirmed && (
                        <div className={styles.stageAdvanceBanner}>
                          <div>
                            <span className={styles.stageAdvanceCheck}>✓</span>
                            <strong style={{ color: "#ffffff", fontSize: "14px" }}>Stage 1 Complete: Scope Confirmed</strong>
                            <p style={{ margin: "4px 0 0", color: "#a7f3d0", fontSize: "13px" }}>
                              Story premise and Library of Congress vocabulary are locked. Proceed to reference research.
                            </p>
                          </div>
                          <button
                            type="button"
                            className={styles.primary}
                            style={{ padding: "10px 20px", fontSize: "14px" }}
                            onClick={() => handleSelectStage("research")}
                          >
                            Proceed to Stage 2: Reference Research →
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <section className={styles.card}>
                      <h2>Legacy brief</h2>
                      <p>This project predates story intake. Its existing brief and synthetic workflow remain available.</p>
                      <button type="button" className={styles.primary} onClick={() => handleSelectStage("plan")}>
                        Proceed to Story Bible &amp; Plan →
                      </button>
                    </section>
                  )}
                </section>
              )}

              {/* Stage 2: Reference Research & Dossier */}
              {activeStage === "research" && (
                <section id="stage-research" className={styles.card} aria-label="Stage 2: Reference Research">
                  <div className={styles.stageToolbar}>
                    <button
                      type="button"
                      className={styles.secondaryAction}
                      onClick={() => handleSelectStage("intake")}
                    >
                      ← Return to Stage 1: Story Idea &amp; Scope
                    </button>
                    {isResearchAccepted && (
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={() => handleSelectStage("plan")}
                      >
                        Proceed to Stage 3: Story Bible &amp; Plan →
                      </button>
                    )}
                  </div>
                  <h2>Reference Research &amp; Evidence Dossier</h2>
                  <p>Validate narrative craft dimensions against classic literature (Gutendex) and verified historical context before planning.</p>
                  {state.project.brief.intake ? (
                    <ResearchReview
                      key={selected}
                      projectId={selected}
                      intake={state.project.brief.intake}
                      onAccepted={async () => {
                        await refresh(selected);
                      }}
                    />
                  ) : (
                    <p>This legacy fixture project has no Research dossier review.</p>
                  )}
                  {isResearchAccepted && (
                    <div className={styles.stageAdvanceBanner}>
                      <div>
                        <span className={styles.stageAdvanceCheck}>✓</span>
                        <strong style={{ color: "#ffffff", fontSize: "14px" }}>Stage 2 Complete: Research Dossier Accepted</strong>
                        <p style={{ margin: "4px 0 0", color: "#a7f3d0", fontSize: "13px" }}>
                          0 gaps remaining. Grounded reference evidence is accepted and sealed for story planning.
                        </p>
                      </div>
                      <button
                        type="button"
                        className={styles.primary}
                        style={{ padding: "10px 20px", fontSize: "14px" }}
                        onClick={() => handleSelectStage("plan")}
                      >
                        Proceed to Stage 3: Story Bible &amp; Plan →
                      </button>
                    </div>
                  )}
                  {state.evidence.length > 0 && (
                    <>
                      <h3>Synthetic run evidence</h3>
                      <p>These fixture records do not establish research acceptance.</p>
                      {state.evidence.map(e => <article className={styles.proposal} key={e.id}><pre>{JSON.stringify(e.data, null, 2)}</pre></article>)}
                    </>
                  )}
                </section>
              )}

              {/* Stage 3: Story Bible & Plan */}
              {activeStage === "plan" && (
                <section id="stage-plan" className={styles.card} aria-label="Stage 3: Story Bible and Plan">
                  <div className={styles.stageToolbar}>
                    <button
                      type="button"
                      className={styles.secondaryAction}
                      onClick={() => handleSelectStage("research")}
                    >
                      ← Return to Stage 2: Reference Research
                    </button>
                    {isBibleApproved && (
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={() => handleSelectStage("draft")}
                      >
                        Proceed to Stage 4: Chapter Drafting &amp; Review →
                      </button>
                    )}
                  </div>
                  <h2>Review Before Drafting</h2>
                  <p>Choose one of three directional candidate bibles proposed by Claude Haiku, customize writer directives, and approve your preferred story foundation.</p>
                  <ModelStateIndicator
                    state={planningState}
                    title={planningTitle}
                    message={planningMessage}
                    details={isPlanningFailed ? modelActionError : undefined}
                    elapsedSeconds={planningState === "loading" ? modelElapsedSeconds : undefined}
                    maxSeconds={planningState === "loading" ? 120 : undefined}
                  />
                  {!hasCandidates && !state.bible && (
                    <button
                      disabled={busy || !isResearchAccepted}
                      className={styles.primary}
                      onClick={() => action({ action: "plan", operationId: crypto.randomUUID() })}
                    >Propose candidate bibles</button>
                  )}
                {state.project.brief.intake && (
                  <p>
                    {state.project.brief.intake.status === "confirmed"
                      ? "Planning uses your confirmed brief and exact accepted research dossier. Missing evidence or unavailable model configuration pauses planning."
                      : "Confirm your brief and research scope above, then accept the required research dossier before planning."}
                  </p>
                )}
                {state.project.brief.intake && canRetryBiblePlanning(state.latestPlanning) && state.latestPlanning && "operationId" in state.latestPlanning && (
                  <article className={styles.task}>
                    <h3>Planning recovery</h3>
                    <p>Operation <code>{state.latestPlanning.operationId}</code> is failed or its outcome is uncertain. A retry may repeat requests that are still processing.</p>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!planningAcknowledged[state.latestPlanning.operationId!]}
                        onChange={e => setPlanningAcknowledged(current => ({ ...current, [state.latestPlanning!.operationId!]: e.target.checked }))}
                      /> Anthropic may count requests from both the original planning operation and this retry.
                    </label>
                    <button
                      disabled={busy || !planningAcknowledged[state.latestPlanning.operationId!]}
                      onClick={() => {
                        const target = state.latestPlanning!.operationId!;
                        setPlanningAcknowledged(current => ({ ...current, [target]: false }));
                        void perform(async () => {
                          try {
                            await api(`/api/projects/${selected}`, {
                              action: "retry-bible-planning",
                              operationId: crypto.randomUUID(),
                              retryOfOperationId: target,
                              confirmDuplicateProviderCall: true,
                            });
                          } finally {
                            await refresh();
                          }
                          setMessage("Planning retry completed.");
                        });
                      }}
                    >Confirm one retry</button>
                  </article>
                )}
                {(() => {
                  const candidateMeta: Record<string, { title: string; badge: string; badgeClass: string; summary: string }> = {
                    bible_a: {
                      title: "Candidate A · Plot & Mystery",
                      badge: "Plot & Mystery",
                      badgeClass: styles.candidateBadgeA,
                      summary: "Emphasizes narrative tension, uncovering clues, courier disappearance, and pacing of revelations.",
                    },
                    bible_b: {
                      title: "Candidate B · Character & Stakes",
                      badge: "Character & Stakes",
                      badgeClass: styles.candidateBadgeB,
                      summary: "Emphasizes Tomas Reyne, personal dilemmas, ally and rival dynamics, and emotional stakes.",
                    },
                    bible_c: {
                      title: "Candidate C · World & Atmosphere",
                      badge: "World & Atmosphere",
                      badgeClass: styles.candidateBadgeC,
                      summary: "Emphasizes coastal worldbuilding, low-tide salt shore, natural vs personal mana, and harbor guild night-markets.",
                    },
                  };

                  const candidateProposals = state.pending.filter(p =>
                    showBibleCandidate(p, state.project.version, Boolean(state.project.brief.intake), state.latestPlanning)
                  );

                  if (candidateProposals.length === 0) return null;

                  const activeProposal = candidateProposals.find(p => p.id === selectedCandidateId) || candidateProposals[0];
                  const activeEnvelope = activeProposal.data as Partial<BibleProposal>;
                  const activeBibleData = activeEnvelope.kind === "bible_candidate" ? activeEnvelope.bible! : activeProposal.data as Bible;
                  const activeMeta = candidateMeta[activeProposal.kind] || {
                    title: activeProposal.kind,
                    badge: "Candidate",
                    badgeClass: styles.candidateBadgeA,
                    summary: "AI-generated story foundation.",
                  };

                  return (
                    <div style={{ marginTop: "24px" }}>
                      <div className={styles.heading}>
                        <div>
                          <h3 style={{ margin: 0, fontSize: "18px", color: "#1a3328" }}>Choose Your Story Direction</h3>
                          <p style={{ margin: "4px 0 0", color: "#52525b", fontSize: "14px" }}>
                            Select one of the 3 candidate story bibles to establish your canonical facts and chapter beats.
                          </p>
                        </div>
                      </div>

                      <div className={styles.candidateSelectorGrid} role="radiogroup" aria-label="Candidate Story Bibles">
                        {candidateProposals.map(proposal => {
                          const env = proposal.data as Partial<BibleProposal>;
                          const bData = env.kind === "bible_candidate" ? env.bible! : proposal.data as Bible;
                          const meta = candidateMeta[proposal.kind] || {
                            title: proposal.kind,
                            badge: "Candidate",
                            badgeClass: styles.candidateBadgeA,
                            summary: "AI-generated story foundation.",
                          };
                          const isSelected = activeProposal.id === proposal.id;
                          return (
                            <div
                              key={proposal.id}
                              role="radio"
                              aria-checked={isSelected}
                              tabIndex={0}
                              className={`${styles.candidateCard} ${isSelected ? styles.candidateCardSelected : ""}`}
                              onClick={() => setSelectedCandidateId(proposal.id)}
                              onKeyDown={e => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedCandidateId(proposal.id);
                                }
                              }}
                            >
                              <div className={styles.candidateCardHeader}>
                                <h4 className={styles.candidateCardTitle}>{meta.title.split(" · ")[0]}</h4>
                                <span className={meta.badgeClass}>{meta.badge}</span>
                              </div>
                              <p className={styles.candidateDescription}>{meta.summary}</p>
                              <div className={styles.candidateStats}>
                                <span>{bData.facts.length} facts</span>
                                <span>•</span>
                                <span>3 chapters</span>
                                <span style={{ marginLeft: "auto" }}>
                                  {isSelected ? (
                                    <span className={styles.selectedPill}>✓ Selected</span>
                                  ) : (
                                    <span style={{ fontSize: "11px", color: "#64748b" }}>Select</span>
                                  )}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <article className={styles.proposal} style={{ borderTop: "2px solid #254d3e", paddingTop: "20px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", marginBottom: "16px" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                              <h3 style={{ margin: 0, fontSize: "18px" }}>{activeMeta.title}</h3>
                              <span className={activeMeta.badgeClass}>{activeMeta.badge}</span>
                              <span className={styles.selectedPill}>Selected Direction</span>
                            </div>
                            <p style={{ margin: "6px 0 0", color: "#52525b", fontSize: "14px" }}>
                              {activeMeta.summary} {activeEnvelope.kind === "bible_candidate" ? `(Proposal v${activeEnvelope.proposalVersion} · Base state v${activeProposal.baseVersion})` : ""}
                            </p>
                          </div>
                          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                            <button
                              disabled={busy}
                              className={styles.primary}
                              style={{ padding: "10px 22px", fontSize: "14px", fontWeight: "bold" }}
                              onClick={() => action({
                                action: "approve",
                                proposalId: activeProposal.id,
                                ...(activeEnvelope.kind === "bible_candidate" ? { proposalVersion: activeEnvelope.proposalVersion, proposalHash: activeEnvelope.payloadHash } : {}),
                              })}
                            >
                              Approve this exact plan
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className={styles.secondaryAction}
                              onClick={() => action({ action: "plan", operationId: crypto.randomUUID() })}
                              title="Reject these candidate directions and generate 3 fresh bibles with live Claude"
                            >
                              🔄 Reject & Re-plan
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className={styles.secondaryAction}
                              onClick={() => handleSelectStage("intake")}
                            >
                              ✏️ Return to Story Idea
                            </button>
                          </div>
                        </div>

                        <div className={styles.candidateDetailsGrid}>
                          <div>
                            <h4 style={{ margin: "0 0 10px", color: "#254d3e", fontSize: "14px", borderBottom: "1px solid #e5e7eb", paddingBottom: "6px" }}>
                              Chapter Outline (Beats)
                            </h4>
                            <div className={styles.beatTimeline}>
                              {activeBibleData.beats.map(b => (
                                <div key={b.chapterIndex} className={styles.beatCard}>
                                  <div className={styles.beatCardTitle}>Chapter {b.chapterIndex} Beat</div>
                                  <p className={styles.beatCardText}>{b.text}</p>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div>
                            <h4 style={{ margin: "0 0 10px", color: "#254d3e", fontSize: "14px", borderBottom: "1px solid #e5e7eb", paddingBottom: "6px" }}>
                              Canonical Story Facts ({activeBibleData.facts.length})
                            </h4>
                            <div className={styles.factsGrid}>
                              {activeBibleData.facts.map(f => (
                                <div key={f.id} className={styles.factItem}>
                                  <span className={styles.factIdTag}>{f.id}</span>
                                  <span>{f.text}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </article>

                      <div className={styles.intricaciesBox}>
                        <div className={styles.intricaciesHeader}>
                          <div>
                            <h3 style={{ margin: 0, fontSize: "16px", color: "#1a3328" }}>Add Your Own Intricacies &amp; Directives</h3>
                            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#52525b" }}>
                              Add specific character nuances, magic system quirks, plot twists, or lore details to weave into the story draft.
                            </p>
                          </div>
                          <span className={styles.intricacyBadge}>{customIntricacies.length} Intricacies Added</span>
                        </div>

                        {customIntricacies.length > 0 && (
                          <div className={styles.intricaciesList}>
                            {customIntricacies.map(item => (
                              <div key={item.id} className={styles.intricacyRow}>
                                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                                  <span className={styles.intricacyCategoryTag}>{item.category}</span>
                                  <span>{item.text}</span>
                                </div>
                                <button
                                  type="button"
                                  className={styles.removeIntricacyBtn}
                                  onClick={() => saveCustomIntricacies(customIntricacies.filter(i => i.id !== item.id))}
                                  title="Remove intricacy"
                                >✕</button>
                              </div>
                            ))}
                          </div>
                        )}

                        <form
                          onSubmit={e => {
                            e.preventDefault();
                            if (!newIntricacyText.trim()) return;
                            const newItem = {
                              id: crypto.randomUUID(),
                              category: newIntricacyCategory,
                              text: newIntricacyText.trim(),
                            };
                            saveCustomIntricacies([...customIntricacies, newItem]);
                            setNewIntricacyText("");
                          }}
                          className={styles.addIntricacyForm}
                        >
                          <select
                            className={styles.intricacySelect}
                            value={newIntricacyCategory}
                            onChange={e => setNewIntricacyCategory(e.target.value)}
                          >
                            <option value="Character">Character Nuance</option>
                            <option value="Magic & World">Magic &amp; World Rule</option>
                            <option value="Plot Twist">Plot Twist &amp; Secret</option>
                            <option value="Setting">Tactile Setting</option>
                            <option value="Relationship">Relationship Dynamic</option>
                          </select>
                          <input
                            type="text"
                            className={styles.intricacyInput}
                            placeholder="e.g. Tomas has a silver crest on his palm that flares when natural mana is drawn near..."
                            value={newIntricacyText}
                            onChange={e => setNewIntricacyText(e.target.value)}
                            maxLength={280}
                          />
                          <button type="submit" className={styles.primary}>Add Intricacy</button>
                        </form>
                      </div>
                    </div>
                  );
                })()}
                {state.bible && (
                  <article className={styles.proposal}>
                    <h3>Approved bible v{state.bible.version}</h3>
                    <ul>{state.bible.data.facts.map(f => <li key={f.id}>{f.id} · {f.text}</li>)}</ul>
                    <p>Immutable approved snapshot. Drafting uses this version.</p>
                  </article>
                )}
                {isBibleApproved && (
                  <div className={styles.stageAdvanceBanner}>
                    <div>
                      <span className={styles.stageAdvanceCheck}>✓</span>
                      <strong style={{ color: "#ffffff", fontSize: "14px" }}>Stage 3 Complete: Story Bible Approved</strong>
                      <p style={{ margin: "4px 0 0", color: "#a7f3d0", fontSize: "13px" }}>
                        Bible v{state.bible!.version} is approved and canonical facts are established. Ready for chapter drafting.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={styles.primary}
                      style={{ padding: "10px 20px", fontSize: "14px" }}
                      onClick={() => handleSelectStage("draft")}
                    >
                      Proceed to Stage 4: Chapter Drafting &amp; Review →
                    </button>
                  </div>
                )}
              </section>
              )}

              {/* Stage 4: Chapter Drafting & Review */}
              {activeStage === "draft" && (
              <section id="stage-draft" className={styles.card} aria-label="Stage 4: Chapter Drafting and Review">
                <div className={styles.stageToolbar}>
                  <button
                    type="button"
                    className={styles.secondaryAction}
                    onClick={() => handleSelectStage("plan")}
                  >
                    ← Return to Stage 3: Story Bible &amp; Plan
                  </button>
                  {isDraftCompleted && (
                    <span className={styles.stageAdvanceCheck} style={{ width: "auto", borderRadius: "16px", padding: "4px 12px", background: "#065f46", color: "#d1fae5" }}>
                      ✓ Manuscript Finalized
                    </span>
                  )}
                </div>
                <h2>Dispatch, Recover &amp; Review Chapters</h2>
                <p>Three concurrent synthetic chapter tasks written by Writers 1–3 and checked by Editors A &amp; B.</p>
                <ModelStateIndicator
                  state={draftState}
                  title={draftTitle}
                  message={draftMessage}
                  details={isRunFailed ? modelActionError : undefined}
                  elapsedSeconds={draftState === "loading" ? modelElapsedSeconds : undefined}
                />
                {customIntricacies.length > 0 && (
                  <div style={{ margin: "14px 0", padding: "14px 18px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ color: "#166534", fontSize: "14px" }}>
                        Active Writer Intricacies ({customIntricacies.length})
                      </strong>
                      <span style={{ fontSize: "11px", fontWeight: "bold", background: "#dcfce7", color: "#15803d", padding: "2px 8px", borderRadius: "10px" }}>
                        Ready for Drafting
                      </span>
                    </div>
                    <ul style={{ margin: "8px 0 0 16px", padding: 0, fontSize: "13px", color: "#15803d" }}>
                      {customIntricacies.map(i => (
                        <li key={i.id} style={{ margin: "4px 0" }}>
                          <strong style={{ color: "#166534" }}>[{i.category}]</strong> {i.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <label htmlFor="fixture">Test scenario</label>
                <select id="fixture" value={fixture} onChange={e => setFixture(e.target.value)}>
                  <option value="normal">Normal three-chapter fixture</option>
                  <option value="continuity">Continuity contradiction</option>
                  <option value="timeout">Chapter 2 times out twice</option>
                  <option value="research-outage">Research 429 / story-only fallback</option>
                  <option value="adversarial">Embedded metadata instruction</option>
                </select>
                <div className={styles.actions}>
                  <button
                    disabled={busy || !state.bible || ["pending", "running"].includes(state.run?.status || "")}
                    className={styles.primary}
                    onClick={() => action({ action: "run", fixture })}
                  >
                    {state.run?.status === "failed" ? "Start new chapter run" : (state.project.brief.intake ? "Start chapter drafting run" : "Start synthetic run")}
                  </button>
                  <button disabled={busy || !["pending", "running", "paused", "failed"].includes(state.run?.status || "")} onClick={() => action({ action: "cancel" })}>Cancel run</button>
                  <button disabled={busy || state.run?.status !== "failed" || !state.tasks.some(t => t.status !== "completed" && t.attempts < 2)} onClick={() => action({ action: "retry" })}>Retry failed tasks once</button>
                  <button
                    disabled={busy || !state.acceptedManuscript}
                    onClick={() => perform(async () => {
                      const response = await fetch(`/api/projects/${selected}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "export" }),
                      });
                      if (!response.ok) throw Error("Export unavailable.");
                      const url = URL.createObjectURL(await response.blob());
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "synthetic-story.md";
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                      setMessage("Export downloaded.");
                    })}
                  >Export Markdown</button>
                </div>
                {!state.bible && <p>Approve a plan in “Plan &amp; approve” first.</p>}
                {pollFailure && <p role="alert" className={styles.error}>{pollFailure}</p>}
                <div className={styles.taskGrid}>
                  {state.tasks.map(t => (
                    <article className={styles.task} key={t.id}>
                      <h3>Chapter {t.chapterIndex}</h3>
                      <strong>{t.status}</strong>
                      <p>Attempt {t.attempts} of 2 · {t.elapsedMs ?? 0} ms</p>
                      {t.error && <p className={styles.fieldError}>{t.error}</p>}
                    </article>
                  ))}
                </div>
                {state.run && state.run.status !== "completed" && <p role="status">Partial run · completed outputs remain available. Final critique waits for all three chapters.</p>}
                {state.chapters.map(c => (
                  <article className={styles.proposal} key={c.id}>
                    <h3>Draft Chapter {c.chapterIndex} · bible v{c.bibleVersion}</h3>
                    <p className={styles.prose}>{c.text}</p>
                  </article>
                ))}
                {state.acceptedManuscript && (
                  <article className={styles.proposal} style={{ borderColor: "#10b981", background: "#f0fdf4" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                      <h3>Accepted Final Manuscript · {state.acceptedManuscript.kind === "manuscript_a" ? "Version A (Continuity & Pacing · Fontaine)" : "Version B (Voice & Atmosphere · Lang)"}</h3>
                      <span style={{ fontSize: "0.8rem", padding: "2px 8px", background: "#d1fae5", color: "#065f46", borderRadius: "4px", fontWeight: "bold" }}>ACCEPTED MANUSCRIPT</span>
                    </div>
                    <p><strong>Rationale:</strong> {(state.acceptedManuscript.data as any).rationale}</p>
                    {(state.acceptedManuscript.data as any).changesMade && (state.acceptedManuscript.data as any).changesMade.length > 0 && (
                      <div style={{ margin: "10px 0", padding: "10px 14px", background: "#ffffff", borderRadius: "6px", border: "1px solid #d1fae5" }}>
                        <strong style={{ fontSize: "13px", color: "#065f46" }}>Editorial Changes Applied:</strong>
                        <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: "13px", color: "#047857" }}>
                          {(state.acceptedManuscript.data as any).changesMade.map((ch: any, idx: number) => (
                            <li key={idx} style={{ margin: "3px 0" }}>
                              <strong>Chapter {ch.chapterIndex}:</strong> {ch.summary} <span style={{ color: "#6b7280" }}>({ch.justification})</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(state.acceptedManuscript.data as any).chapters?.map((ch: any) => (
                      <div key={ch.chapterIndex}>
                        <p><strong>Chapter {ch.chapterIndex}</strong></p>
                        <p className={styles.prose}>{ch.text}</p>
                      </div>
                    ))}
                  </article>
                )}
                {state.pending.filter(p => p.kind.startsWith("manuscript_") && p.baseVersion === state.project.version).map(manuscript => {
                  const consistencyCurrent = manuscriptAcceptEnabled(state);
                  return (
                    <article className={styles.proposal} key={manuscript.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                        <h3>{manuscript.kind === "manuscript_a" ? "Revised Version A · Continuity & Pacing (Fontaine)" : "Revised Version B · Voice & Atmosphere (Lang)"}</h3>
                        <span style={{ fontSize: "0.8rem", padding: "2px 8px", background: "#fef3c7", color: "#92400e", borderRadius: "4px" }}>
                          {manuscriptConsistencyLabel(manuscript.kind, state.critique)}
                        </span>
                      </div>
                      <p><strong>Editorial Rationale:</strong> {(manuscript.data as any).rationale}</p>
                      {(manuscript.data as any).changesMade && (manuscript.data as any).changesMade.length > 0 && (
                        <div style={{ margin: "10px 0", padding: "10px 14px", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                          <strong style={{ fontSize: "13px", color: "#334155" }}>Located Editorial Changes:</strong>
                          <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: "13px", color: "#475569" }}>
                            {(manuscript.data as any).changesMade.map((ch: any, idx: number) => (
                              <li key={idx} style={{ margin: "3px 0" }}>
                                <strong>Chapter {ch.chapterIndex}:</strong> {ch.summary} <span style={{ color: "#64748b" }}>({ch.justification})</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(manuscript.data as any).chapters?.map((ch: any) => (
                        <div key={ch.chapterIndex}>
                          <p><strong>Chapter {ch.chapterIndex}</strong></p>
                          <p className={styles.prose}>{ch.text}</p>
                        </div>
                      ))}
                      <div className={styles.actions} style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid #e2e8f0" }}>
                        <button disabled={busy || !consistencyCurrent} className={styles.primary} onClick={() => action({ action: "approve-manuscript", proposalId: manuscript.id })}>
                          Accept this version as Final
                        </button>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, minWidth: "280px" }}>
                          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                            <input
                              placeholder="Enter custom fixes or instructions (e.g. cultural barrier, dialogue cadence...)"
                              value={feedbackText}
                              maxLength={500}
                              onChange={e => setFeedbackText(e.target.value)}
                              style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", flex: 1, minWidth: "220px", fontSize: "13px" }}
                            />
                            <button
                              disabled={busy || ((state.critique as any)?.revisionRounds ?? 0) >= 2}
                              onClick={() => {
                                action({ action: "rewrite", feedback: feedbackText });
                                setFeedbackText("");
                              }}
                            >Request editorial rewrite ({Math.max(0, 2 - ((state.critique as any)?.revisionRounds ?? 0))} left)</button>
                          </div>
                          <span style={{ fontSize: "11px", color: "#64748b" }}>
                            Tip: You can request minor phrasing/grammar polish or major narrative adjustments based on your feedback.
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })}
                {state.critique && (
                  <article className={styles.proposal}>
                    <h3>Located critique · synthetic fixture</h3>
                    <pre>{JSON.stringify(state.critique, null, 2)}</pre>
                  </article>
                )}
              </section>
              )}
            </>
          ) : (
            <p role="status">Loading project…</p>
          )}
        </main>
        <footer className={styles.footer}>Local synthetic foundation · No live manuscript processing · Source requirements remain in the repository PRD.</footer>
      </div>
    </div>
  );
}
