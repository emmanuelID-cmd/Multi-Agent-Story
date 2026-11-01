# Project Handoff

## Current task: PR #31 merge status and safe tree reconciliation

Prepared: 2026-11-01T00:07:54-04:00.

- Repository: `emmanuelID-cmd/Multi-Agent-Story`.
- Verified integration commit: `15977286a88097decc7121015dbf6db44e0ef9f0`; GitHub PR #31 is merged into `developer` at this commit on October 31, 2026, 23:42:03-04:00.
- The root worktree's `shared/phase-4-planning-orchestration` branch was fast-forwarded from `8c7b696` to the verified `developer` commit without conflicts. At reconciliation time, the remote phase branch was at `08d0293`, an ancestor of `developer`; no remote ref changed in that step.
- Tracked local edits were preserved in a Git stash before alignment. Three untracked ResearchReview copies were removed only after their blob IDs matched the files in `developer`. All 20 `docs/temp/` trace/checkpoint files remain untracked and local.
- `manny/read-agents`, `sql-foundation`, and `justins-side` are aligned with `developer`. `main` remains untouched at `4b34048`.
- I01 and I02 remain open. The shared ledger migration is not applied; no live model/provider call was made. README status already matches these facts.

### Next

- Correct this publication record through the existing PR-first workflow. If that documentation PR merges, fast-forward the eligible phase branch; do not change `main`.

---

## Previous task: PR #30 Code Review & Review Finding: Capability URL Authentication Pivot

Prepared: 2026-10-31T22:30:00-04:00.

- Repository: `emmanuelID-cmd/Multi-Agent-Story`.
- Branch: `developer`; baseline commit: `376c101` (PR #30 merge).
- Execution owner: Justin Day (`justin-day-pursuit`).

### Key Review Finding: Authentication Model Pivot (Better Auth -> Capability Story URLs)

A comprehensive code review and intent matching analysis of PR #30 (`feat(write): unblock end-to-end editorial pipeline, model indicators, and export`, commit `78591cb`, merged as PR #30 `376c101`) identified an architectural pivot in access control and identity that was implemented but not prominently declared in the PR summary:

1. **Session Auth Replaced by Secret Capability URLs:**
   - Across all API routes (`src/app/api/projects/`), `requireUser()` (Better Auth session verification) was removed. Route handlers now retrieve the story via `getProjectById(id)` and derive `ownerId` directly from the stored project record (`project.ownerId`).
   - Better Auth client instantiation is now lazy in `src/server/auth/index.ts` (`getAuth()`), returning `null` when `BETTER_AUTH_SECRET` is unset, preventing startup crashes and allowing the server to run in prototype mode without session configuration.
   - Project listing without an ID (`GET /api/projects`) now returns 404 ("Project unavailable."). Anonymous project creation (`createAnonymousProject`) generates an unguessable UUID and pairs it with an anonymous user row (`@anonymous.invalid`).
   - Access and authorization are granted by possession of the secret capability story URL (`/[workId]`), acting as a prototype stand-in for accounts. Client `localStorage` tracks recent story IDs on that browser device.

2. **Security & Integration Implications:**
   - **Bearer Credential Surface:** Possession of the unguessable UUID link grants full reading, drafting, editing, cancel, and export capabilities. UUIDs have 122 bits of entropy, but appear in browser history, localStorage, and shared links without session revocation mechanisms.
   - **Origin Boundaries Intact:** `sameOrigin(request)` remains strictly enforced on all mutation POST endpoints via `src/server/request-origin.ts`, which validates loopback port 3000 and configured `APP_URL` / `RENDER_EXTERNAL_URL` while ignoring spoofable `X-Forwarded-Host`.
   - **Lane Alignment Requirement:** Manny's READ agents and Bible planning routes must be aware that downstream routes no longer expect or require session cookies/headers. Route tests across 8 test suites have been updated to mock `getProjectById` rather than `requireUser`.

3. **Additional PR #30 Review Findings & Follow-Ups:**
   - **Fragile Fixture Detection (`editors.ts`):** `isMaraFixture()` checks `baseChapters.some(c => c.text.includes("Mara"))`, which creates a semantic false-positive hazard if user content mentions "Mara". Recommended to replace with an explicit fixture flag.
   - **Production Hardcoded Test IDs (`graph.ts`, `projects.ts`):** Conditional branches explicitly check `project.id === "proj-intake"` or `run.id === "proj-intake-run"`.
   - **Error Handling (`model.ts`):** Anthropic 400 temperature retry silently catches exceptions in `catch {}`.
   - **Budget Limit Parsing (`budget-ledger.ts`):** `process.env.STORY_BUDGET_MAX_TOKENS` parsed at module load without `NaN` validation.

### Done
- [x] Code review and intent matching completed for PR #30.
- [x] Documented the architectural authentication model pivot in team reference and handoff files to ensure full alignment between Justin (WRITE) and Manny (READ).
- [x] All 61 test suites (594 unit and contract tests) pass cleanly.

### Not completed
- [ ] Refactor `isMaraFixture()` to use an explicit fixture metadata flag rather than text matching.
- [ ] Remove hardcoded `"proj-intake"` test IDs from production execution branches in `graph.ts` and `projects.ts`.
- [ ] Add `NaN` validation and logging to model error retries.
- [ ] Live Anthropic model and research provider calls remain gated behind flags.

---

## Previous task: Shared Phases 4.2–5.3 & Red-Team Vulnerability Resolution

Prepared: 2026-10-31T12:08:34-04:00. Push verified 2026-10-31T12:10:05-04:00.

- Repository: `emmanuelID-cmd/Multi-Agent-Story`.
- Branch: `justins-side`; baseline commit: `8c7b696`.
- Execution owner: Shared (Justin & Manny).

### Done

- [x] `retryRun` locks the latest run with `.for("update")` immediately after `.where()`, then `.orderBy()` and `.limit(1)`, in `src/server/projects.ts`. Confirmed in that function. `tests/write-reliability-j07.test.ts` passed 17/17.
- [x] Input policy & writer dispatch hardening (A1, A2, A11): canonical NFKC normalization, Cyrillic lookalike letter folding on detection scan copy only, rejection of invisible Unicode tag blocks and zero-width/format chars, role-delimiter flagging across fields, and `canDispatch` requiring `ACCEPT` across all findings.
- [x] Continuity fixture gate (A3): whitespace and zero-width characters, including U+2060 and U+00AD, are stripped before `/\bmara\s+(?:swam|dove\s+in(?:\s+and\s+swam)?)\b/i`. That pattern matches “Mara dove in and swam” and “Mara dove in the boat,” and it does not match “Mara cannot swim” or “the sailor swam.” The critique records the matching passage from the stripped text.
- [x] Dispatch safety & error sanitization (A4, A5, A8, A9, A10, A12, A13): fact hash & version mismatch failure in `writeChapter`, sanitized Zod task input errors, strict boolean/version validation in `approvalSpike`, worker UUID validation, `SyntaxError` 400 mapping in `failure()`, and parallel start/approval and superseded bible retry regressions.
- [x] Confirmed research blocks unless `inspectText` returns `ACCEPT`. A `FLAG`, including an instruction phrase, does not reach the research model.
- [x] Shared story budget: a reservation stores `Math.ceil(byteLength / 4)` plus overhead and the output bound, not the raw byte length. The operation id is `digest([context.operationId, role, digest(payload)])`, so a changed prompt is a new reservation and a reused id with a different fingerprint still throws `IDEMPOTENCY_KEY_REUSE`. A hold is released only before the provider call starts. Chapter writes do not query `story_budget_usage` while `STORY_BUDGET_USAGE_PROVISIONED` is off. Provider tokens are added to the run only after a chapter row is inserted. HTTP 400 is limited to a `SyntaxError` whose message contains “JSON.”
- [x] Synthetic graph barriers are in the tree. Intake projects pause when required Consistency is not current. The fixture continuity check strips U+2060 and U+00AD and records the cleaned passage. I02 stays open because this is not a live twelve-role graph.
- [x] Shared 5.1 / I05: UI visibility in `src/app/workspace.tsx` showing stored task status, project state version, failed-gate alerts for paused, failed, and completed runs, with manuscript acceptance disabled until Consistency is current.
- [x] Shared 5.2 / I06: clean accepted export in `src/server/projects.ts` exporting only accepted ordered manuscripts with strict chapter order, rejection of missing approved story bible (409), heading injection prevention (escaped `#` on all free-text lines), and fenced ````json blocks with backtick run escaping.
- [x] Synthetic full-circle coverage is split. A paused intake run stays paused, `approveManuscriptProposal` returns 409, and export returns 409. A legacy project with no intake brief finishes completed, accepts through `approveManuscriptProposal`, and exports accepted manuscript markdown with the bible and evidence in fenced JSON. `tests/full-circle-synthetic.test.ts` passed 8/8 and `tests/red-team-a12-a13.test.ts` passed 3/3. I07 stays open.

### Not completed

- I01, I02, and I07 remain unchecked.
- Live Anthropic model and research provider calls remain disabled (`READ_CONNECTIONS_ENABLED` and `WRITE_CONNECTIONS_ENABLED` stay false).
- Database migration `drizzle/0001_shared_story_budget_ledger.sql` remains unapplied.
- Pushed `justins-side` to `origin`. Previous tip `8c7b696`. Verified remote tip `5ebc7717727a9f58a498badd220b8d15d36ca008`. `main` stays at `4b34048`. No branch is deleted. No pull request was opened.

### Validation and limits

- Focused unit files from the review plan: 76/76 passed across 10 files (`story-budget-model` 13/13, `budget-ledger` 9/9, `input-boundary` 3/3, `intake-http` 5/5, `phase4-writer-connector` 7/7, `write-reliability-j07` 17/17, `export` 7/7, `full-circle-synthetic` 8/8, `red-team-a12-a13` 3/3, `read-revision-resume` 4/4).
- `npx vitest run` full unit suite: 59 files, 585/585 passed.
- No live provider call. Migration `drizzle/0001_shared_story_budget_ledger.sql` was not applied.

---

## Previous task: Empty test marker cleanup

Prepared: 2026-10-29T18:40:48-04:00. Pre-push handoff; publication is not yet verified.

- Repository: `emmanuelID-cmd/Multi-Agent-Story`.
- Branch: `shared/remove-helloworld-test`; PR target: `developer`.
- Verified remote baseline: `eab83e513484708babb845d3ca6132fa029efc34`, the merge commit for PR #25.
- Outgoing author: Emmanuel De Jesus (Manny), verified from existing Git history. The task commit is being prepared; no push is claimed.

### Done

- [x] Removed `helloworld.txt` after verifying the file was zero bytes.
- [x] Preserved Justin's original unique commit through PR #25, merged into `developer` as `eab83e513484708babb845d3ca6132fa029efc34`.
- [x] Kept the in-progress Phase 4 work in the original worktree; it is not included in this cleanup.

### Not completed

- None within this empty-marker cleanup. This does not claim that Phase 4 or the overall product is complete.

### Validation and limits

- Confirmed `helloworld.txt` had length 0 before removal; Git reports a deletion with no content lines.
- `npm.cmd run test -- tests/architecture-v3.test.ts` passed (3/3); no test specifically covers deletion of a zero-byte marker. No application behavior, database state, or provider/model call was changed.

---

## Previous handoff: Shared Phase 2

Prepared: 2026-10-29T05:11:53-04:00

## Outcome

Shared Phase 2 establishes Manny's typed Bible-planning contract and checks the
selected proposal adapter against the existing Writer receiver. PR #22 is the
already-merged baseline; this phase's verified `developer` baseline is
`d6f29627b36e40fe75c0223c8a574f9f957154b0`. The phase implementation has passed
SECURITY and independent REVIEWER checks and is ready for its authorized PR to
`developer`.

## Done

- Recorded the October 29 S02 decision: Manny owns Bible A/B/C planning, which
  returns three independently versioned candidates from the same confirmed
  intent and accepted dossier. The user selects one exact candidate; proposals
  do not merge automatically.
- Updated the app `AGENTS.md`, README, PRD v4 draft, decision register, teammate
  handoff, and phase records. Marked the October 28 Justin ownership language
  as historical and superseded.
- Added typed planning input, research evidence binding, three-candidate
  proposal set, exact selection and acceptance shapes, and a version-preserving
  adapter to the established chapter-writer input. Added the proposal type to
  the existing JSONB TypeScript union without a SQL migration.
- Rejected `not_requested` outcomes for either mandatory provider at the
  planning contract boundary. The caller must separately load canonical
  server-side snapshots and verify current authenticated ownership, state and
  dossier acceptance; these schemas do not provide that authorization.
- Verified against existing READ and WRITE receiver tests without changing
  Justin's prompts, functions, tools, permissions, design or behavior.

## Not completed

- Live Bible-planning prompts, model execution, authenticated storage/approval
  service and Coordinator dispatch remain future work under Shared Phase 4.1.
- I01 and a full-circle user workflow remain incomplete. No live provider,
  model, database acceptance route or end-to-end run was exercised.
- No canonical product implementation item is checked off by this supporting
  contract phase. No SQL migration or Justin runtime change is included.
- `docs/temp/` is pre-existing untracked material and is preserved outside this
  change. `main` remains unchanged.

## Validation and review

- Focused unit suite: **75/75 passed** across five files, including planning,
  READ connection, Writer runtime, J04 Editor, and J05 proposal coverage.
- `npm.cmd run typecheck`: passed.
- `git diff --check`, trailing-whitespace scan, and changed-Markdown fence scan:
  passed.
- SECURITY: approved the mandatory-provider validation and clarified
  server-side authorization boundary.
- Independent REVIEWER: READY; confirmed the S02 historical status and final
  phase status records.

This handoff records Shared Phase 2 preparation for the application
repository's phase push. The Phase 2 changes described here are not yet
committed, pushed, or merged; the earlier PR #22 merge is already complete.


## Previous handoff history


## 2026-10-28T18:34:17-04:00 — Phase 2B complete; prepared for push

- Repository: emmanuelID-cmd/Multi-Agent-Story; active branch: manny/phase-2b-vocabulary-alignment. Integrated developer 271f6c62f1bf5eab1394fd86bc6252eb5e753d27, preserving all Justin WRITE implementation and completed statuses. Work commits: f2b0a57 (diagnostics), 5a931a9 (naming), f396a09 (vocabulary), bf5c261 (reconciliation). main 4b34048 is excluded.
- Completed bounded LC Suggest2 official choices and manual answers, legacy support, immutable confirmed provenance, and subject-to-Gutendex mapping/relevance. Gutendex uses a 30-second timeout; NYT uses 5 seconds; neither retries, and HTTP status handling is safe.
- Validation: integrated unit tests 379/379 across 40 files and typecheck PASS; latest focused tests 14/14. Human checks confirmed Claude saved suggestions, LC choices/reconfirmation, NYT five records OK, and app Gutendex available OK HTTP 200. User standalone Node check: HTTP 200, 0.49 seconds, 681 matches, 32 records. One fresh focused SECURITY inspection cleared using current evidence; final independent REVIEWER approved all acceptance criteria after two metadata findings were fixed. Earlier 225-test suite/build evidence is historical; production build was not rerun.
- Deferred: Phases 3/4 remain paused; canonical 26-item register unchanged. No completion claim for full-text rights/acquisition, style synthesis, or Bible. Original SQL branch name manny/sql-foundation persists; renaming is outside this task. Historical documents, temporary files, and trace archives remain local and untracked, excluded from publication.
- Publication is authorized but has not occurred; no PR exists yet. Resume with TEAM-REFERENCE.md pointer, empty review summary, push, PR targeting developer, merge if checks permit, safe eligible lane alignment, and phase-branch cleanup.
## 2026-10-28 — Phase 3 completion

Branch `manny/phase-3-reader-consistency`; verified remote developer baseline `d7763182219816a6c60b8be5f11727820b295baa`. M04/M05/M06 are complete in synthetic implementation scope. Final remediation validation: 135/135 affected tests across 10 files and typecheck passed; 435/435 full-suite result predates final security remediation. Targeted SECURITY check was clear and independent REVIEWER approved.

Feature remains opt-in. There are no live Writer/Editor producers, provider calls, live PostgreSQL contention, or user request/resume UI. M07/M08 and Phase 4 remain untouched; main is unchanged; historical docs and temporary traces are preserved. Next: verify the remote, commit and push this branch, open a PR to developer, merge only if safe, then fast-forward eligible non-main branches and delete this merged phase branch. Do not start Phase 4.

## 2026-10-29 � Shared Phase 3 completion / pre-push

Shared Phase 3 is complete and approved for publication on `shared/phase-3-durable-execution-recovery`, based on `origin/developer` at `ad4e90d0d360966d6ff77bec24167fe4227e0164`; no PRs are open. Keep `main` untouched and exclude the pre-existing untracked `docs/temp/`.

I03 atomically records state and dependencies. I04 adds worker recovery and idempotency, plus an owner-only READ recovery panel and action. No migration or Justin-owned behavior change was required. A separate `AGENTS.md` wording correction clarifies that the skills registry is read from external `C:\Users\Github\AGENTS`, not copied into this app repository.

Validation: 144/144 affected unit tests passed across 12 files (READ 118, postgres-target guard 14, task-attempt 12); typecheck and isolated synthetic PostgreSQL 17 recovery scenarios passed. Earlier I03 validation passed six isolated PostgreSQL scenarios. SECURITY and REVIEWER cleared/approved the work.

Limits: dependency and recovery tests were synthetic; no live provider call or real external billing verification was performed. Duplicate Anthropic usage remains possible and acknowledged. Recovery covered orderly restart and simulated interrupted state, not a hard kill during a provider call. Next: prepare the TEAM-REFERENCE pointer and complete the authorized publication workflow, preserving these limits.

## 2026-10-29 - SQL shared budget ledger prerequisite

- Commit `9541123` on `sql-foundation` adds the shared story budget ledger schema and migration, server ledger code, and synthetic ledger tests across six files. No database migration was applied.
- Validation: synthetic tests passed 8/8, Node 24 TypeScript check passed, and offline Drizzle verification passed.
- Phase 4.1 and 4.2 remain incomplete. READ/Bible/WRITE runtime adapters and workflow/export are pending. Remote push is not yet verified.
## 2026-10-30 - Shared Phase 4.1 implementation handoff to Justin

### Verified base and outgoing work

- App repository: emmanuelID-cmd/Multi-Agent-Story. Active branch: `shared/phase-4-planning-orchestration`.
- Before restoring the saved edits, this branch was fast-forwarded to verified `origin/developer` at `4b870c325436aea86ea9c0bc00c96066b80222ea`. The Phase 4.1 implementation commit is `d9c8e41b4162009946a867d43a4e577409787d96`, authored by Emmanuel De Jesus. Initial push was verified at `8e7dbf3` on `origin/shared/phase-4-planning-orchestration`; PR #28 targets `developer`: https://github.com/emmanuelID-cmd/Multi-Agent-Story/pull/28.
- Shared SQL budget ledger PR #27 is already merged into `developer`. SQL remains on `sql-foundation`; no migration was applied. `main` was not changed (last verified at `4b340485bd0cf94b52294150c44b28d4ba890aa3`).

### Shared Phase 4.1 status

- The implementation adds three independent model-backed Bible proposals from confirmed intake and accepted Research, exact version/hash approval, stale-state barriers, and shared-ledger adapters for the existing READ, Bible, Writer and Editor dispatch paths.
- The approved story cap is USD 3 and 60,000 tokens total across READ, Bible planning and WRITE. Connectors remain disabled until migration, verified rates and lane opt-ins are configured.
- Focused synthetic suite: 115/115 passed across eight files; TypeScript typecheck passed. Available runtime was Node 26.12.1 although the repository targets Node 24. The tests used mocks; no live model/provider call or database migration was run.
- I01 remains unchecked at the user's direction until the completion rule is reinstated. This is a handoff status, not a Phase 4.1 completion claim.

### Stop point and preserved work

- After the authorized PR merges into `developer`, fast-forward eligible clean non-main branches only when ancestry and ownership allow; leave `main` untouched. Stop there until the user reinstates the completion rule/continuation.
- Do not start Shared Phase 4.2 now. I02 still needs the complete fixed graph, user review, and Shared Phase 5.2 accepted-export integration.
- Preserve Justin's Writer/Editor prompts, tools, permissions and core behavior. Only budget/connection adapters were added in the outgoing Phase 4.1 commit.
- The remaining unstaged auth and ResearchReview/source-submission changes, related research tests, and all 20 `docs/temp/` files are excluded from this push and remain locally preserved for separate ownership/scope review.

### Publication state

- Initial branch push verified October 30, 2026 at `8e7dbf3`; PR #28 is open from `shared/phase-4-planning-orchestration` to `developer`.
- Next: publish this PR-link handoff update, verify required checks/review and ancestry, merge only when safe, then fast-forward eligible non-main branches and stop. Keep `main` untouched and preserve the excluded local work.

## 2026-10-31 - ResearchReview carried onto the current READ lane

- Current integration base: `manny/read-agents` at `08d02939e43fb62260db1c1002f0eda2030706f6`, equal to verified `origin/developer` after Justin's PR #29 and #30 updates.
- Commit `62a7621` carries the preserved ResearchReview work onto this current base. It adds transient licensed-source submission, versioned dossier candidate creation and exact human acceptance, and combines those actions with Justin's project-owner lookup, capability URL route model, and deferred auth/database initialization.
- The existing READ model adapter and shared story-budget wrapper are used. Source excerpts are excluded from stored dossier prose and must be resubmitted for acceptance. No live model/provider call or migration was run during this integration.
- `git diff --check` passed. Tests and typecheck were not run in this turn.
- The original root worktree remains untouched as a recovery copy, including its pre-existing ResearchReview edits and all 20 `docs/temp/` files. No Phase 4 checklist item is checked; I01/I02 remain open.
- Initial push verified on `manny/read-agents` at `33759a9`; PR #31 is open to `developer`: https://github.com/emmanuelID-cmd/Multi-Agent-Story/pull/31. The handoff/doc update is being prepared for publication. Merge only if required review and checks allow; keep `main` untouched.

## 2026-10-31 - PR #31 auth-origin review correction

- Review found configured auth origins accepted external HTTP URLs. `configuredAuthOrigin` now accepts HTTPS deployment origins and HTTP only for localhost, IPv4 loopback, or IPv6 loopback. ResearchReview and Justin's Writer/Editor implementation remain unchanged.
- Added focused regression cases in `tests/auth-gate.test.ts`. Validation: auth-gate 4/4 passed, TypeScript typecheck passed, and `git diff --check` passed. No live model/provider call or database migration.
- Intended PR update: `manny/read-agents` to `developer`, PR #31. Changes are prepared locally; push is not yet verified. Next: publish the reviewed correction, obtain required PR approval, then integrate and fast-forward eligible non-main lanes without touching `main` or the dirty Phase 4 worktree.
