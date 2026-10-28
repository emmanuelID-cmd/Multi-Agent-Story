# Phase 2B: Controlled vocabulary and intake research alignment

Owner: Manny (READ)
Status: COMPLETE ? all sub-phases, source review, synthetic verification and human browser acceptance passed October 28, 2026. Publication is authorized and in progress.

Phase 2B is supplemental to completed Manny Phase 2. It records the bounded plan to align verified Library of Congress vocabulary with writer intake and later Gutendex lookup. Phase 3 Reader Consistency and Phase 4 READ reliability retain their existing numbering and remain paused under the current user override. The 26-item canonical checklist is unchanged.

Approved active branch: `manny/phase-2b-vocabulary-alignment`, created from verified `developer` base `6475361824cf5320917e8dca9499c87fa26ad2eb`. The before/after dirty-worktree hashes match in `.tools/reviews/phase2b-branch-baseline.json`; no commit, push or merge is claimed.

## Sub-phases

- [2B.1: Readiness and scope baseline](2B.1-Readiness-and-scope-baseline.md)
- [2B.2: Vocabulary integration](2B.2-Vocabulary-integration.md)
- [2B.3: Grounded intake choices](2B.3-Grounded-intake-choices.md)
- [2B.4: Gutendex query alignment](2B.4-Gutendex-query-alignment.md)
- [2B.5: Verification and documentation](2B.5-Verification-and-documentation.md)

## Phase boundary

Complete sub-phases in order. Do not begin dependent implementation until readiness confirms public-source access and the approved scope. The complete Phase 2B parent remains the future PR boundary; do not publish a partial sub-phase as a completed phase. The complete implementation plan and exact branch were approved. Commit, push, merge and live browser checks retain their separately applicable approval gates.

## Initial implementation checkpoint (superseded below)

October 28, 2026: approved implementation is present. Final synthetic unit suite: 225/225 (100%), 26/26 files; focused vocabulary checks: 17/17 (100%); typecheck PASS; production build PASS, including the dynamic intake lookup route. No live provider or Claude execution occurred in these checks. See `.tools/reviews/phase2b-builder-results.md` for files, exact changed lines, hashes and actual synthetic test counts. SECURITY two inspections and independent REVIEWER are pending; no acceptance checkbox is completed by implementation alone. Parent Phase 2B and 2B.5 remain NOT COMPLETE until required review and separately authorized human browser checks pass. No new live provider/model calls, publication, SQL or Justin WRITE changes are claimed.

## Verification update - October 28, 2026

Sub-phases 2B.1-2B.4 are verified in the stated code/synthetic scope. The parent and 2B.5 remain open for human browser acceptance; no Phase 3/4 work or Git publication is claimed.

Why checked: the implementation and its stated acceptance conditions were verified through source review and synthetic execution. New intake uses only validated LC choices or manual answers, preserves writer wording, and binds distinct Gutendex query provenance to confirmed state. Existing v1/v2 decisions remain readable. Legacy metadata compatibility is explicit; it is not a claim of verified genre mapping. Selected-term expiry, failed-refresh preservation and reopen recovery have targeted coverage.

Evidence: `.tools/reviews/phase2b-builder-results.md`, `.tools/reviews/phase2b-security-results.md`, `.tools/reviews/phase2b-reviewer-results.md` (local verification records). Human browser evidence remains unverified. The canonical 26-item checklist and Phase 3/4 pause are unchanged.

## Human acceptance and closeout ? October 28, 2026

The user confirmed saved Claude analysis/suggestions, LC selection and reconfirmation, and application metadata retrieval: NYT available/OK with five records; Gutendex available/OK with HTTP 200. The separate one-request Node diagnostic returned HTTP 200 in 0.49 seconds, 681 total matches and 32 returned records. These user-run live checks are distinct from synthetic tests and do not establish prose rights, source-text acquisition, style synthesis or a Research-to-Bible run. Earlier timeout/HTTP failures remain recorded; their exact cause is unconfirmed. Gutendex now has a bounded 30-second deadline, no automatic retries, and numeric upstream HTTP diagnostics. Latest affected metadata tests: 14/14 passed. Phase 3/4 stay paused; the canonical 26-item checklist is unchanged. All Phase 2B criteria are satisfied; publication and safe integration were subsequently authorized by the user.
