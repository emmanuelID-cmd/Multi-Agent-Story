# Shared Phase 3: Durable execution and recovery

Owner: Shared; execution owner assigned before implementation.

Status: planned. Parent completes only after every required sub-phase is verified; conditionally unnecessary SQL work needs an explicit reuse/N/A record.

Keep this approved phase order and folder setup. Changes to scope/order need an explicit plan update.

## Ordered sub-phases

- [3.1: Storage review and conditional SQL work](3.1-Storage-review-and-conditional-SQL-work.md)
- [3.2: Atomic state and dependency recording](3.2-Atomic-state-and-dependency-recording.md)
- [3.3: Worker recovery and idempotency](3.3-Worker-recovery-and-idempotency.md)

## Boundaries and completion

Run relevant tests during each sub-phase; later reliability phases consolidate gaps rather than postpone verification. Record evidence in the canonical checklist and do not check a spanning item before all its criteria pass. No product implementation is authorized by this documentation.

[Completion rules](../../README.md#completion-and-accountability) | [Commit groups](../../COMMIT-GROUPS.md)
