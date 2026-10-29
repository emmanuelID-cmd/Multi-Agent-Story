# Shared Phase 2: Agreed integration contracts

Owner: Shared; implementation lead: Manny for the approved READ/Bible Planning contract.

Status: complete October 29, 2026; SECURITY and independent REVIEWER approved.

Research storage subset approved October 26, 2026: Manny Phase 2.2 may reuse
the existing Docker/PostgreSQL `proposals` JSON storage with a Research-only
kind, immutable versioned dossier payload and dedicated authenticated acceptance
service. Preserve owner/version checks, existing Writer/Editor behavior and
legacy pending-proposal controls. No migration is needed for this reuse. Apply
the PRD per-dimension gate; no new numeric threshold is agreed. See
[the bounded implementation agreement](../../Manny/Phase-2-Research-evidence-and-dossier-acceptance/2.2-Dossier-persistence-coverage-and-acceptance-connection.md#approved-implementation-agreement).
This resolves that storage decision only. S01-S04 product decisions are now
recorded; S02 assigns Manny the three Bible-planning roles and specifies three
independent proposals for human selection. Shared Phase 2 adds the typed Bible
proposal envelope to the existing JSON storage type; it does not add a migration
or connect a live planner/approval route.

Checklist IDs: none; supporting milestone, not an extra item in the 26.

Commit group: shared-2; proposed scope: shared.

Keep this approved phase order and folder setup. Changes to scope/order need an explicit plan update.

## Prerequisites

S01-S04 resolved and recorded by the relevant owners; contributor mappings agreed.

## Ordered tasks and scope

1. Define the typed planning input with the full confirmed original/dimensions, exact accepted Research dossier identity, both provider outcomes, source-linked evidence, synthesis, gaps and coverage.
2. Define three distinct, hash-bound Bible A/B/C proposals on the same planning task/input/dossier snapshot; validate the one exact human selection and application-recorded acceptance without merging candidates.
3. Map the accepted Bible to the existing Writer's `approvedBible`, `bibleVersion`, and chapter-index inputs while retaining an independent `draftVersion` in the outer task envelope.
4. Extend the existing JSON proposal type and validate READ/WRITE receiving compatibility without modifying Justin's runtime behavior or adding a SQL migration.

## Acceptance criteria

Input, candidate, selection, acceptance and Writer mappings enforce their documented identities, hashes and independent versions; evidence references resolve to the dossier; candidates share one authoritative input snapshot; both receiving lanes remain compatible; no Justin behavior is changed.

## Validation and evidence

`npm.cmd exec vitest run -- tests/shared-planning-contracts.test.ts tests/read-connections.test.ts tests/write-runtime.test.ts tests/write-editors-j04.test.ts tests/write-proposals-j05.test.ts`: 75/75 passed across five files after adding the mandatory-provider gate regression. `npm.cmd run typecheck` passed; `git diff --check` passed. SECURITY and independent REVIEWER approved after the targeted contract correction and historical-status cleanup. Synthetic inputs only; no live model, provider, database acceptance route or full-circle run was exercised.

## Exclusions

Do not expand literary scoring, experiments, market-reader scope or passage-level editing. Preserve the fixed twelve-role, three-chapter MVP and human approval gates. Peer implementation changes require the agreed connection boundary; listing Justin work does not authorize Manny to implement it. SQL belongs to the shared sql-foundation lane only when an approved storage change is necessary.

## Completion record

Contract implementation is complete as a supporting milestone, not one of the
canonical 26 product items. Live Bible
agent prompts/execution, authenticated persistence/acceptance wiring, and full
Coordinator orchestration remain open for later phases; I01 is not complete.

[Canonical checklist](../../../implementation/weaver-mvp-build-checklist.md) | [Accountability rules](../../README.md#completion-and-accountability) | [Commit groups](../../COMMIT-GROUPS.md)
