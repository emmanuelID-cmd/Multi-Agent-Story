# Confirmed intake to Research: Manny Phase 1

Requirements: [PRD v4 Section 7g](../prd/drafts/PRD-v4-draft.md#7g-approved-s01-connection-decisions-october-26-2026), M01 and the user's approved S01 decisions. This is a READ-side connection, not the full web research-to-story loop.

## Contract and configuration

`src/server/research/confirmed-intake.ts` supplies `prepareConfirmedResearchInput` and `runConfirmedResearch`. The production repository selects a project by both owner and project ID. Its injectable repository supports deterministic tests without a database or external model. Callers must be trusted authenticated server/worker code; these functions are not a public HTTP endpoint and a model must never construct authoritative scheduler metadata.

The trusted request binds owner/project/run/task/operation, current project state version, the expected intake revision, analysis ID, analysis/source hashes, READ configuration versions and a criteria version. Criteria values and eligible sources belong to later approved Research work; Phase 1 does not invent acceptance thresholds, retrieve book text or enable providers. The request's revision and project state version are separate: a confirmed pre-planning project can have state version 0.

The additive `confirmedIntake` envelope in the existing READ input carries the complete saved original (up to 12,000 characters), grounded analysis, exact decisions, confirmed scope and digest/version references. Research receives that envelope in its actual model data alongside its short compatible brief. The short premise does not replace the full original. Existing synthetic READ inputs without this envelope remain supported for compatibility; authenticated intake callers use the confirmed adapter.

Only supplied confirmed fields become named Research dimensions. Genre remains the required craft dimension; supplied setting/timePeriod fields map to historical dimensions. The wrapper preserves accepted/custom/reject/defer decisions separately, with no defaults for unresolved optional preferences. It retains the original as untrusted data, not permission to invoke tools or change the search scope. A model is constrained to the named dimensions and validated source evidence.

## Handoff and failure behavior

Preparation rejects a missing or wrong-owner project, unconfirmed intake, changed revision or analysis identity/hash, ungrounded analysis observations and a scope that no longer matches the stored user decisions. The runtime checks the envelope again before provider/model work. Freshness checks around asynchronous work stop stale results from being exposed as current candidates; production atomic acceptance remains a later Shared concern.

Research still returns an unaccepted candidate or an honest blocked/failed outcome. This connection cannot accept a dossier, begin Bible planning, change canonical story state, write a manuscript or bypass source-access gates. Missing permitted evidence can therefore leave a synthetic test result blocked even when its full-input delivery assertion passes.

The user may revise intake before planning starts under the existing intake flow. A new confirmation must bind the changed input. A future version-history restore creates a new version rather than overwriting history, but durable history/restore controls are not built here. Editor rejection routing is agreed in S01; connecting that later route belongs to the relevant Reader/Editor phases.

## Harness and coordination

Tests in `tests/confirmed-intake.test.ts` inject an owned repository, synthetic provider outcomes and a model capture. They inspect actual Research context rather than a copied mapper result. They cover the full original's tail, exact decisions/dimensions, legitimate Unicode, instruction-like text kept as data, zero pre-planning version, stale/forged records and asynchronous freshness. Existing runtime tests cover bounded calls, budgets, cancellation and legacy fixtures.

No new model, system role, tools, permissions or dependencies are introduced. The existing READ model configuration, resource bounds and structured result validation remain in force; Research's prompt explicitly distinguishes confirmed dimensions from unaccepted suggestions and original text containing instructions. The new envelope is additive to `read-v1`; identify this adapter as Manny Phase 1 and record intake and configuration versions independently. No shared-state write lock is introduced for read-only preparation. Short reads and input revalidation do not provide durable task ownership or atomic dossier acceptance; those remain Shared Phase 3/Manny Phase 2 work.

Phase tests do not call live models/providers or launch the user's trace CLI. Synthetic tests may inspect existing instrumentation internally; that is not a completed trace-skill audit. Actual audits follow the trace skill with its independent reviewers and evidence protocol. Ordinary event streams retain safe IDs/codes, not the original story or model private reasoning.

## Verification status

Completed October 26, 2026: 13/13 targeted tests and 144/144 full tests across 16 files; typecheck and diff checks passed. Two SECURITY rounds plus targeted follow-up and independent REVIEWER approval cover the tested synthetic boundary. The shared 120-second deadline includes initial, per-attempt and final reads, with cancellation, cleanup and late-output suppression. Follow-up tests verify accurate model-mismatch and wrong-owner failure codes.

The [phase record](../phase/Manny/Phase-1-Confirmed-intake-to-Research-contract/1-Confirmed-intake-to-Research-contract.md) and [canonical checklist](weaver-mvp-build-checklist.md) record completion. This does not prove the live DB/worker/provider/model path or add atomic acceptance. No live research, full worker/web integration, dossier acceptance, history UI or Justin behavior change is claimed.
