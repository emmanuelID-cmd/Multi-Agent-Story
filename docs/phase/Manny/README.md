# Manny phase plan

Keep this approved phase order and folder setup. Changes to scope/order need an explicit plan update.

Status: Manny Phases 1–4 complete within the synthetic/mocked scopes recorded in each phase file and the canonical checklist. No live model/provider validation or production reliability is implied by the completed READ Phase 4.

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
without a migration. Phase 2B and its publication were completed separately.

Phase 3 completed October 28, 2026 within its recorded synthetic scope. Phase
4.1 (M07) and 4.2 (M08) completed October 29, 2026 after reviewer approval: focused READ
regression 141/141 across 11 files before the final privacy assertion
adjustment, focused assertion 1/1 afterward, typecheck passed and visual deck
checks 5/5. Phase 4 behavior tests used synthetic/mocked inputs; no live
model/provider calls were run.

[Master phase index](../README.md) | [Commit groups](../COMMIT-GROUPS.md)

- [Phase 1: Confirmed intake-to-Research contract](Phase-1-Confirmed-intake-to-Research-contract/1-Confirmed-intake-to-Research-contract.md)
- [Phase 2: Research evidence and dossier acceptance](Phase-2-Research-evidence-and-dossier-acceptance/2-Research-evidence-and-dossier-acceptance.md)

Supplemental Phase 2B plan: [Controlled vocabulary and intake/research alignment](Phase-2B-Controlled-vocabulary-and-intake-research-alignment/2B-Controlled-vocabulary-and-intake-research-alignment.md). Full implementation and `manny/phase-2b-vocabulary-alignment` were approved October 28, 2026. Readiness used 2/2 approved HTTP 200 data lookups. Sub-phases 2B.1-2B.4 are verified within the documented code/synthetic scope: 225/225 unit tests, typecheck/build, SECURITY 58/58 and REVIEWER approval. Phase 2B and 2B.5 completed after the separately authorized human browser check returned NYT OK and Gutendex HTTP 200. Publication was completed through PR #19.
- [Phase 3: Reader and Consistency connections](Phase-3-Reader-and-Consistency-connections/3-Reader-and-Consistency-connections.md) — completed October 28, 2026 within synthetic implementation scope. M04–M06 each have a completion record and are checked in the canonical checklist. Post-remediation affected tests passed 135/135 across 10 files; typecheck passed; targeted SECURITY cleared and independent REVIEWER approved. Live Writer/Editor provenance, provider calls, deployed behavior, PostgreSQL contention and request/resume UI remain unverified; dispatch stays opt-in.
- [Phase 4: READ reliability evidence](Phase-4-READ-reliability-evidence/4-READ-reliability-evidence.md) — complete October 29, 2026; M07 and M08 reviewed and checked in the canonical list.
