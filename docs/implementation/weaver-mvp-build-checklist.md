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
- [ ] **S03 — Manny + Justin / shared:** Confirm revision counting: initial draft round 0, stable round identity, increment point, rejected/failed proposal treatment and retry/Reader-repair accounting. Reconcile the existing `rewriteRun` counter without resetting the two-round cap.
- [ ] **S04 — Manny + Justin / shared:** Agree the live Editor proposal schema using existing full three-chapter manuscripts plus rationale/change summaries as the compatibility baseline. Specify exact base/proposal identity and validation; a new patch-only or passage-acceptance interface is not required.

## Manny — READ lane remaining work

- [x] **M01 — Intake-to-Research mapping:** Complete October 26, 2026; `prepareConfirmedResearchInput` and `runConfirmedResearch` preserve the full confirmed original/decisions, map supplied dimensions and enforce owned/current input with bounded failure states. See the completion log and [connector notes](confirmed-intake-research.md). No intake rerun or invented optional defaults.
- [ ] **M02 — Eligible source acquisition:** Connect both existing NYT/Gutendex adapters under their access/terms gates and resolve the permitted sources needed by the confirmed dimensions. Record queries, empty/partial/unavailable outcomes, identity/date/rights gaps and provenance. Metadata alone cannot become prose/style evidence.
- [ ] **M03 — Dossier acceptance connection:** Persist the actual Research candidate and per-dimension coverage, expose exact-version acceptance through the shared application boundary, and reject stale/unreadable/insufficient evidence. Reuse existing storage where suitable; any necessary migration is a separate SQL-lane decision.
- [ ] **M04 — Reader snapshot connection:** Replace the web fixture Reader connector with `runReader` using actual owner-scoped indexed chapters, approved facts, current source hashes/versions and the recorded editorial request. Keep Reader's preparation task distinct from editing and initial intake.
- [ ] **M05 — Receiving rejection and repair:** Map each Editor's rejection back through Coordinator to a specific Reader correction; persist the attempt identity and enforce the one bounded content repair. Preserve valid work and expose unresolved sources instead of filling them by invention.
- [ ] **M06 — Exact-proposal Consistency:** Connect `runConsistency` to each actual Editor proposal separately. Bind findings to proposal ID/version/hash and the relevant bible/facts; preserve unavailable/partial/failed results and invalidate reports when their inputs change.
- [ ] **M07 — READ harness gaps:** Reuse current coverage and add only missing connected-boundary tests: wrong owner/project/task, missing source, stale versions, embedded commands, rejected/failed repair, cancellation, duplicate delivery and unavailable/wrong-proposal Consistency. Verify blocked outputs cannot produce a downstream success label.
- [ ] **M08 — Safe diagnostics and documentation:** Correlate run/task/round/source versions across the connected READ path without secret/prose logging. Correct the stale `v2 handoff schema` diagnostic label and clarify the presentation's Reader-return wording in later authorized edits. Keep documented fixture/live status accurate.

## Justin — WRITE lane remaining work (inventory only)

- [ ] **J01 — Live model boundary:** Establish WRITE model configuration, role system prompts, scoped tools, structured output validation, cancellation/timeouts and existing execution-limit enforcement. The READ model configuration does not select Justin's model automatically.
- [ ] **J02 — Three real chapter writers:** Connect `draftChapterOne/Two/Three` or their agreed live adapters to model-generated prose using the same approved bible, accepted user constraints and assigned indexes/beats. Keep fixture functions available for deterministic tests; never substitute Mara fixture prose in a live success path.
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
