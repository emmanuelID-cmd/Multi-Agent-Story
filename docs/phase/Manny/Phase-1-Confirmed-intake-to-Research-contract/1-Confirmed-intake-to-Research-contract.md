# Manny Phase 1: Confirmed intake-to-Research contract

Owner: Manny.

Status: complete October 26, 2026; M01 checked after SECURITY, bounded corrections and independent REVIEWER approval. Publication follows the approved temporary phase lifecycle.

Checklist IDs: M01.

Commit group: manny-1; proposed scope: manny-read.

Keep this approved phase order and folder setup. Changes to scope/order need an explicit plan update.

## Prerequisites

S01 product decisions approved by the user October 26, 2026 (PRD Section 7g and decision register); saved and confirmed intake required. The phase branch was explicitly approved and created from verified `developer` at `8645568fa37ea2e3588851f48a20b8b8c9e28aba`.

## Ordered tasks and scope

1. Inspect the saved original, accepted suggestions, deferred fields and confirmed search dimensions.
2. Map them into the authenticated, versioned ResearchInput without rerunning intake or filling optional gaps.
3. Test the boundary with agreed fixtures before connecting the complete web graph.

## Acceptance criteria

The exact confirmed intent and decision versions reach Research; wrong-owner, unconfirmed and stale inputs are rejected.

## Validation and evidence

Unit/contract tests for retained dimensions, optional omissions, ownership and stale confirmation; record X/Y.

## Exclusions

Do not expand literary scoring, experiments, market-reader scope or passage-level editing. Preserve the fixed twelve-role, three-chapter MVP and human approval gates. Peer implementation changes require the agreed connection boundary; listing Justin work does not authorize Manny to implement it. SQL belongs to the shared sql-foundation lane only when an approved storage change is necessary.

## Completion record

Completed M01: `src/server/research/confirmed-intake.ts` loads the owner-scoped current intake, binds its revision/analysis/source hashes and scope, and prepares an additive confirmed-intake envelope for the existing Research runner. The full original and exact decisions reach actual model data; no optional preferences are invented. Project state version 0 is supported for Research while Reader/Consistency retain their existing version rules.

Freshness checks reject changed state before each model attempt and withhold results that became stale during work. All reads share one existing 120-second deadline with cancellation; late read output cannot revive a stopped operation. Specific safe error codes distinguish stale input, unavailable project, model mismatch, timeout and recheck failure.

Evidence: 13/13 targeted tests, 144/144 full tests across 16 files, TypeScript and diff checks passed. SECURITY ran two rounds and targeted follow-up; independent REVIEWER approved after two bounded FIXER cycles corrected hanging reads and misleading failure codes. Test results and source hashes are in the ignored `.tools/reviews/phase1-test-results.txt`; initial findings are preserved in `.tools/reviews/phase1-security-review.md`.

The scope is the tested server-to-Research connection, not the full web workflow. Provider/source retrieval, rights provenance, accepted-dossier persistence, HTTP/worker wiring, version-history UI, WRITE behavior and SQL remain outside this phase. No live models/providers or user trace commands were run. See [connector contract and harness notes](../../../implementation/confirmed-intake-research.md).

[Canonical checklist](../../../implementation/weaver-mvp-build-checklist.md) | [Accountability rules](../../README.md#completion-and-accountability) | [Commit groups](../../COMMIT-GROUPS.md)
