# Weaver: remaining automated MVP build checklist

Prepared October 26, 2026 against [PRD v4](../prd/drafts/PRD-v4-draft.md).
This is a read-only implementation inventory, not authorization to execute it.
No task below was implemented by preparing this document. Justin's remaining
work is listed for coordination; Manny does not take ownership of it.

**Meaning of automated:** the application runs the authorized agent/tool steps,
validates outputs, persists state and recovers from failures. It still waits for
the writer's required brief/scope, dossier, bible and final-proposal decisions.
No agent can approve for the writer. A missing required check stops its dependent
path rather than triggering an automatic success or fixture fallback.

## Completion and phase tracking

Follow the [owner phase plans](../phase/README.md) and their primary 26-item map.
These are the canonical item checkboxes; phase files reference them instead of
duplicating their completion state. Phase planning alone completed none of the 26;
S01's product decisions were subsequently approved October 26, 2026.

After each assignment actually passes its acceptance criteria and review, check
that item and append a dated record below explaining what was completed, why
it qualifies, affected files/artifact versions, validation commands and actual
X/Y, reviewer and limitations. Update its phase record and owner index together.
Never check a partial assignment merely because a plan or fixture exists.

### Verified completion log

Preparing this phase system completed no implementation item. The later S01
decision record reflects explicit user approvals, not a live agent result.

| Item | Date / reviewer | Completed work and acceptance explanation | Evidence / actual tests X/Y | Limitations |
| --- | --- | --- | --- | --- |
| S01 | October 26, 2026 / user approval recorded by PLANNER | Approved full-input preservation, confirmed-only scope, freshness checks, future restore semantics, missing-source handling, component-specific rejection routing and connection-only adapters. | Explicit S01 conversation approvals; PRD Section 7g and decision register checked against them. Tests: N/A for the decision itself. | Does not complete M01, resolve S02-S04 or implement history, live providers or peer behavior changes. |
| M01 | October 26, 2026 / independent REVIEWER approved after SECURITY and two bounded FIXER cycles | Added owner-scoped confirmed-intake preparation and Research execution; the complete 12,000-character original, exact choices and named confirmed dimensions reach actual model context. Revision/source/analysis checks reject wrong-owner, unconfirmed, forged and stale input; asynchronous freshness, one shared deadline and cancellation suppress obsolete or late results. | `tests/confirmed-intake.test.ts`: 13/13 targeted; full suite 144/144 across 16 files; typecheck and diff check passed. Connector and phase record link the exact source paths. | Synthetic model/provider/repository evidence only. No live DB/worker/web dispatch, source acquisition, dossier acceptance, durable history, WRITE or SQL changes. |
| M02 | October 26, 2026 / independent REVIEWER approved after two SECURITY rounds, one FIXER cycle and affected security recheck | Connected confirmed Research to both provider outcomes and a trusted reviewed-source reader, enforcing exact confirmed dimensions, source identity/rights/owner/hash checks and bounded source failures. Explicit unavailable and overflow outcomes prevent invented evidence; metadata remains distinct from located text. | `tests/research-acquisition.test.ts`, `tests/book-metadata.test.ts`, `tests/confirmed-intake.test.ts`: 32/32 targeted; full suite 155/155 across 17 files; typecheck and diff check passed. Implementation notes document the actual entry points and configuration boundary. | Synthetic providers/model/readers only. No production rights registry or permitted text resolver configured; live access, dossier acceptance and planning dispatch are not established by M02. |
| S03 | October 26, 2026 / explicit user approval recorded by PLANNER | Agreed round 0, two requested revision rounds maximum, stable dispatch identity and no reset on retries, Reader repair or failed/rejected results. | User selected the proposed counting rule; decision register and PRD Section 7j record the agreement. Tests: N/A for the product decision. | Does not complete shared execution-counter enforcement, Manny repair wiring or Justin revision work. |
| S04 | October 26, 2026 / explicit user approval recorded by PLANNER | Agreed existing full-manuscript proposal compatibility, separate exact-version identity envelope and an explicit authenticated editorial request independent of desired ending. | User selected the connection rules; decision register and PRD Section 7j record the agreement. Tests: N/A for the product decision. | Does not implement Editor/Reader/Consistency connections or claim separate Justin code review. Shared behavior changes remain a separate dependency. |
| M03 | October 27, 2026 / independent REVIEWER approved after two SECURITY rounds, one FIXER cycle and affected security recheck | Persisted immutable Research candidates, provider queries, source decisions/exclusions and coverage in existing PostgreSQL JSON. Added owned summary/detail and strict authenticated acceptance with fresh source identity/rights/content checks, exact intake/candidate binding, atomic writes and idempotent commit-aware replay. Both provider outcomes stay visible; an empty result never replaces missing required evidence. | 41/41 affected targeted tests; 174/174 full unit tests across 19 files; typecheck and diff check passed. Source hashes are retained in local Phase 2.2 verification evidence; implementation notes identify service, repository and route. | Synthetic repository/source/model evidence only; actual PostgreSQL timing and live provider/deployment behavior untested. Production source catalog/reader is unconfigured; no SQL migration, WRITE behavior, new frontend or planner/worker dispatch. Parent Phase 2 implementation is complete; stop after its authorized integration/cleanup. |
| J01 | October 27, 2026 / Justin (lane owner) | Established WRITE model adapter (`AnthropicWriteModel`) with tiered routing (Haiku for Writers, Sonnet/Haiku for Critics), role-based prompts with fairy tale personas (Grimm, Andersen, Perrault, Fontaine, Lang), structured output schemas (`chapterSchema`, `revisedManuscriptSchema`), 120s timeouts, 1MB payload caps, and sanitized error mapping. Existing Mara fixtures preserved. | `tests/write-model.test.ts` (9/9), `tests/write-runtime.test.ts` (7/7); full test suite 190/190 passing across 21 files; TypeScript check passed. | Synthetic model/fetcher evidence only. Live paid model calls and full chapter orchestration (J02/J03) belong to subsequent phases. |
| J02 | October 27, 2026 / Justin (lane owner) | Connected three model-backed writers (Grimm -> Beat 1, Andersen -> Beat 2, Perrault -> Beat 3) using approved Bible, beats, and brief. Added writer tools allowlist (`read_story_state`, `propose_story_update`) throwing `AGENT_TOOL_DENIED` on unpermitted tools. Added anti-imitation invariants to system prompts. Preserved fixtures and eliminated Mara fixture fallback in live paths. | `tests/write-writers-j02.test.ts` (17/17), `tests/write-runtime.test.ts` (7/7); full test suite 207/207 passing across 22 files; TypeScript check passed. | Deterministic mock model verification; live API runs wait for Shared 4.1 authorization. |


## Existing foundation to preserve

| Area | Evidence already present | Do not mistake it for |
| --- | --- | --- |
| Intake | Expanded helper, sparse saved idea, model analysis, individual choices and scope confirmation in `src/app/story-intake.tsx`, `src/server/intake.ts` and `src/agents/intake.ts` | A connected accepted-research-to-story loop |
| READ | Model-backed runners in `src/agents/read/runtime.ts`, contracts, tool/snapshot interfaces and synthetic harness tests | All web dispatch/acceptance connections or live book research |
| WRITE | Three chapter fixture functions, two full-manuscript editor fixture functions, proposal/revision plumbing and tests | Model-generated prose from the user's brief |
| Coordination | Graph barriers, indexed assembly, owner-scoped services, queue/worker and recovery primitives | A complete twelve-role live graph |
| Checks | Existing unit/browser suites and recorded controlled smoke examples | Measured reliability for the full live workflow |

## Dependency order

1. Agree shared contracts and assign the unowned planning/coordinator work.
2. Connect confirmed intake, real eligible Research evidence and exact dossier acceptance.
3. Connect model-backed planning and exact bible approval.
4. Connect Justin's live chapter/editor work and Manny's real Reader/Consistency work.
5. Connect durable worker recovery, human decisions and correctly labeled export.
6. Verify the complete chain and its failed-gate cases before claiming completion.

## Shared decisions before dependent wiring

- [x] **S01 — Manny + Justin / shared:** Product connection decisions approved by the user October 26, 2026; see PRD Section 7g and the decision register. Preserve both owners' behavior and validate each implemented adapter in its own phase. User approval is not a claim of separate Justin code review.
- [ ] **S02 — Shared / planning owner unassigned:** Assign ownership of Bible A/B/C and decide whether their proposals are merged or presented as alternatives. Keep the twelve-role roster and exact-version human bible gate; do not assign these three roles to Justin or Manny by assumption.
- [x] **S03 — Manny + Justin / shared:** Product decision approved October 26, 2026: initial draft round 0, at most two requested revision rounds, stable identity reserved at dispatch, retries/Reader repair retain it and failure cannot reset the cap. Shared `rewriteRun` enforcement remains implementation work; see the decision register and completion log.
- [x] **S04 — Manny + Justin / shared:** Product decision approved October 26, 2026: preserve complete three-chapter proposals and rationale/change summaries; validate exact source/base/proposal identities in a separate envelope. Store explicit editorial requests separately from desired ending. Connection-only scope preserves Justin behavior; implementation remains independently accountable.

## Manny — READ lane remaining work

- [x] **M01 — Intake-to-Research mapping:** Complete October 26, 2026; `prepareConfirmedResearchInput` and `runConfirmedResearch` preserve the full confirmed original/decisions, map supplied dimensions and enforce owned/current input with bounded failure states. See the completion log and [connector notes](confirmed-intake-research.md). No intake rerun or invented optional defaults.
- [x] **M02 — Eligible source acquisition:** Complete October 26, 2026 within the tested synthetic scope: connected NYT/Gutendex outcomes and trusted reviewed-source retrieval to confirmed Research, with exact dimension/identity/permission/hash checks, explicit gaps and bounded failure states. Metadata cannot become prose/style evidence. See [acquisition notes](research-acquisition.md); production approved-source records and a permitted text reader remain unconfigured.
- [x] **M03 — Dossier acceptance connection:** Complete October 27, 2026: immutable dossier versions and acquisition provenance use existing PostgreSQL JSON; owned history/detail and authenticated exact-version acceptance reject stale, unreadable, expired or insufficient evidence. Transaction/replay checks preserve valid work. See [dossier notes](research-dossier.md) and the completion log; production source catalog/reader and full planning integration remain separate.
- [ ] **M04 — Reader snapshot connection:** Replace the web fixture Reader connector with `runReader` using actual owner-scoped indexed chapters, approved facts, current source hashes/versions and the recorded editorial request. Keep Reader's preparation task distinct from editing and initial intake.
- [ ] **M05 — Receiving rejection and repair:** Map each Editor's rejection back through Coordinator to a specific Reader correction; persist the attempt identity and enforce the one bounded content repair. Preserve valid work and expose unresolved sources instead of filling them by invention.
- [ ] **M06 — Exact-proposal Consistency:** Connect `runConsistency` to each actual Editor proposal separately. Bind findings to proposal ID/version/hash and the relevant bible/facts; preserve unavailable/partial/failed results and invalidate reports when their inputs change.
- [ ] **M07 — READ harness gaps:** Reuse current coverage and add only missing connected-boundary tests: wrong owner/project/task, missing source, stale versions, embedded commands, rejected/failed repair, cancellation, duplicate delivery and unavailable/wrong-proposal Consistency. Verify blocked outputs cannot produce a downstream success label.
- [ ] **M08 — Safe diagnostics and documentation:** Correlate run/task/round/source versions across the connected READ path without secret/prose logging. Correct the stale `v2 handoff schema` diagnostic label and clarify the presentation's Reader-return wording in later authorized edits. Keep documented fixture/live status accurate.

## Justin — WRITE lane remaining work (inventory only)

- [x] **J01 — Live model boundary:** Established WRITE model configuration, role system prompts, structured output validation, cancellation/timeouts and execution-limit enforcement. The READ model configuration is not selected for WRITE by assumption; fairy tale personas (Grimm, Andersen, Perrault, Fontaine, Lang) and tiered model routing are live in `src/agents/write/`. Verified October 27, 2026.
- [x] **J02 — Three real chapter writers:** Connected all three chapter writers (Grimm, Andersen, Perrault) to model-generated prose using `draftChapterModel` and `generateChapterProse` with the approved Bible, accepted brief, and assigned beats. Implemented tool boundary (`read_story_state`, `propose_story_update`) with `AGENT_TOOL_DENIED` enforcement and anti-imitation prompt directives. Fixture functions preserved; zero Mara fixture fallback on live model failure. Verified October 27, 2026.

- [ ] **J03 — Writer output validation:** Ensure all three unique indexes, exact approved versions and valid non-truncated outputs pass before editorial dispatch. Reject stale/late results and preserve completed valid chapters for bounded recovery.
- [ ] **J04 — Two real Critic/Editors:** Connect both existing roles to actual accepted Reader evidence and live editorial proposal generation. Each receiving Editor validates semantic sufficiency before editing, and neither may fabricate missing sources or authorize canon changes.
- [ ] **J05 — Proposal contract and preservation:** Return the jointly agreed versioned manuscript proposals and located changes/rationale, preserving the approved original and distinct alternatives. Apply only authenticated user acceptance against the current base; model text cannot commit changes.
- [ ] **J06 — Connected revision cycle:** Route requested revisions through refreshed Reader evidence, both receiving decisions, new proposals and exact Consistency checks under the agreed cap. Do not hide a failed check or silently alter the user's ending to represent the editorial task.
- [ ] **J07 — WRITE reliability evidence:** Add/update Justin's tests for live-adapter success, malformed/truncated output, wrong index/version, invalid handoff, failures/cancellation and proposal preservation. Keep existing fixture tests and peer READ tests intact; broad literary tuning is secondary.

## Planning, Coordinator and application integration — shared/unassigned owner

- [ ] **I01 — Model-backed planning:** Replace static Bible candidates with the agreed three planning outputs derived from accepted Research and confirmed intent. Validate conflicts/output versions and wait for explicit bible approval before writer dispatch.
- [ ] **I02 — End-to-end fixed graph:** Connect intake -> Research acceptance -> planning/bible approval -> writers -> Reader -> Editors -> exact Consistency -> user decision -> export. Enforce phase barriers and existing concurrency limits in application code, not just prompts. Replace fixture shells only when their real connectors are validated.
- [ ] **I03 — Durable state and safe commits:** Persist task/attempt/round/dependency/acceptance references so reloads and worker restarts cannot lose authority or reuse stale results. Keep live network/model calls outside long database transactions; perform final state/version checks under short atomic commits.
- [ ] **I04 — Recovery and idempotency:** Verify retry, cancellation, timeout, interrupted worker, duplicate delivery and resume behavior for every newly connected task. Reject late writes, preserve approved artifacts and never reset attempt/round limits by reopening a task.
- [ ] **I05 — Existing UI connections:** Connect current actions, progress/error states and approval screens to actual stored artifacts and gates. No interface redesign or passage-level editing feature is required. A run cannot appear fully checked because a fixture graph finished while required Consistency remains unavailable.
- [ ] **I06 — Accepted export:** Export the accepted current ordered manuscript and relevant bible/evidence/unresolved labels. Do not export a stale competing proposal as accepted or describe an unchecked/partial result as complete.
- [ ] **I07 — Connected integration evidence:** Run synthetic full-circle and adversarial/fail-state tests across both lanes, then an explicitly authorized controlled live smoke test. Record actual provider/model modes and X/Y results; one HTTP 200 or fixture pass is not a full-loop reliability result.

## Boundaries and separate gates

- SQL changes are conditional and shared ownership: either contributor may work on the persistent `sql-foundation` lane. Inspect reuse first; use the separate lane only for an approved necessary schema change. Follow Shared 3.1/3.2 and the pending Shared 1.2 legacy-ref transition.
- Keep human gates; "fully automated" does not authorize auto-accepting a dossier, bible, edit or final manuscript.
- No work on Justin's behavior is authorized by listing J01-J07. Shared contract changes and peer behavior changes need the existing owner agreement.
- Extra comparison arms, long-history experiments, emotional/voice scoring expansion, new market-reader functionality and finer passage acceptance are deferred.
- Existing consent, retention, source-rights and disclosure decisions remain prerequisites before real user manuscript processing/release; they are not implemented or silently added to today's READ build.
- No live agent runs, product-code changes, provider enablement, SQL changes, trace execution, Git commits or pushes were performed to prepare this checklist. The existing unit suite was run only for verification.
