# Shared Phase 3: Durable execution and recovery

Owner: Shared; execution lead: Manny (assigned October 29, 2026).

Status: complete (October 29, 2026; synthetic persistence and recovery validation only). All required sub-phases 3.1–3.3 are complete; Shared 5.3 rechecks behavior against later connectors.

Keep this approved phase order and folder setup. Changes to scope/order need an explicit plan update.

## Ordered sub-phases

- [3.1: Storage review and conditional SQL work](3.1-Storage-review-and-conditional-SQL-work.md)
- [3.2: Atomic state and dependency recording](3.2-Atomic-state-and-dependency-recording.md)
- [3.3: Worker recovery and idempotency](3.3-Worker-recovery-and-idempotency.md)

## Boundaries and completion

Run relevant tests during each sub-phase; later reliability phases consolidate gaps rather than postpone verification. Record evidence in the canonical checklist and do not check a spanning item before all its criteria pass. No product implementation is authorized by this documentation.

[Completion rules](../../README.md#completion-and-accountability) | [Commit groups](../../COMMIT-GROUPS.md)
