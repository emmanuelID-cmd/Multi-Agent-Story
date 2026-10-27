# Manny phase plan

Keep this approved phase order and folder setup. Changes to scope/order need an explicit plan update.

Status: planning documentation; implementation tasks are not completed by creating these files.

Phase 1 (M01) completed October 26, 2026 on the approved temporary
`manny/phase-1-intake-to-research` branch. S01's decisions are recorded; full
confirmed input and freshness checks are verified with 13/13 targeted and
144/144 total tests, typecheck, SECURITY and independent REVIEWER approval.
No WRITE behavior, SQL, live-provider enablement or full web wiring is included.
Phase 2.1 (M02) completed on `manny/phase-2-1-provider-retrieval`: 32/32 targeted,
155/155 full tests, typecheck, two SECURITY rounds, one FIXER cycle, affected
security recheck and independent REVIEWER approval. Production source approval
records/text reader remain unconfigured. Phase 2.2 (M03) and parent Phase 2
completed October 27, 2026: 41/41 affected targeted and 174/174 full tests across
19 files, typecheck, two SECURITY rounds, one FIXER cycle, affected security
recheck and independent REVIEWER approval. Existing PostgreSQL JSON is reused
without a migration. Publish one Phase 2 PR, verify its safe integration and
cleanup, then stop; Phase 3/4 execution is deferred by the current user override.

[Master phase index](../README.md) | [Commit groups](../COMMIT-GROUPS.md)

- [Phase 1: Confirmed intake-to-Research contract](Phase-1-Confirmed-intake-to-Research-contract/1.md)
- [Phase 2: Research evidence and dossier acceptance](Phase-2-Research-evidence-and-dossier-acceptance/2.md)
- [Phase 3: Reader and Consistency connections](Phase-3-Reader-and-Consistency-connections/3.md)
- [Phase 4: READ reliability evidence](Phase-4-READ-reliability-evidence/4.md)
