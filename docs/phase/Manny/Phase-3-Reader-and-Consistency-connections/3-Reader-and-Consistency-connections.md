# Manny Phase 3: Reader and Consistency connections

Owner: Manny.

Status: complete October 28, 2026. All three required sub-phases were independently reviewed and verified within the approved synthetic implementation scope. SQL migration was not needed; existing PostgreSQL JSONB storage was reused.

Keep this approved phase order and folder setup. Changes to scope/order need an explicit plan update.

## Ordered sub-phases

- [3.1: Actual Reader snapshots](3.1-Actual-Reader-snapshots.md)
- [3.2: Rejection and bounded repair](3.2-Rejection-and-bounded-repair.md)
- [3.3: Exact-proposal Consistency](3.3-Exact-proposal-Consistency.md)

## Boundaries and completion

Run relevant tests during each sub-phase; later reliability phases consolidate gaps rather than postpone verification. Record evidence in the canonical checklist and do not check a spanning item before all its criteria pass. Production remains opt-in and unverified: no live Writer/Editor producer, PostgreSQL contention, deployment, provider call, or user-facing request/resume UI was verified in this phase.

## Completion record — October 28, 2026

- **3.1 / M04:** Complete. The opt-in application worker uses the authenticated saved request and assigned owner-scoped chapter/Bible inputs with independent Bible and draft identities. Details: [3.1 completion record](3.1-Actual-Reader-snapshots.md).
- **3.2 / M05:** Complete. Actual Editor receiving wrappers consume the Reader handoff; rejection reaches one durable Reader repair, with dispatch/output recorded separately and retries preserving the editorial round. Details: [3.2 completion record](3.2-Rejection-and-bounded-repair.md).
- **3.3 / M06:** Complete. Each proposal has its own exact-bound Consistency report, required before advancement and again before human approval. Details: [3.3 completion record](3.3-Exact-proposal-Consistency.md).
- **Validation:** 135/135 post-remediation focused synthetic tests passed across 10 files; `npm.cmd run typecheck` passed. The broader 435/435 suite was run before the last target-authority changes and is not a post-fix full-suite claim. SECURITY cleared the targeted target-binding/status issues; independent REVIEWER approved within the tested scope.
- **Not completed / limitations:** No live PostgreSQL contention, deployed auth, paid model/provider calls, live Writer/Editor producer verification, new UI controls, schema migration, or Phase 4 work. Existing fixtures remain labeled synthetic/unverified and live dispatch stays opt-in.
- **SQL disposition:** Existing JSONB was sufficient for this connection; no migration was required and the separate `sql-foundation` lane was not modified.

[Completion rules](../../README.md#completion-and-accountability) | [Commit groups](../../COMMIT-GROUPS.md)
