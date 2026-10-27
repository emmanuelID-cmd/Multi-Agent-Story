# Weaver phase system

Approved ownership plan for the remaining MVP, against [PRD v4](../prd/drafts/PRD-v4-draft.md). The [canonical 26-item checklist](../implementation/weaver-mvp-build-checklist.md) remains the only item completion register. Preparing these documents implements none of those 26 items.

## Folder convention

Every numbered phase has its own folder named `Phase-<integer>-<phase-title>`, including phases without sub-phases. Use the approved integer phase title, with spaces replaced by hyphens. Keep numeric files inside: `Manny/Phase-1-Confirmed-intake-to-Research-contract/1.md`, or `Manny/Phase-3-Reader-and-Consistency-connections/3.md` beside `3.1.md`, `3.2.md` and `3.3.md`. Sub-phase filenames do not repeat their subtitles. Owner-level README files remain indexes. This replaces the earlier folder naming convention without changing phase numbers, order, ownership or completion status.

## Owner plans

- [Manny: READ](Manny/README.md)
- [Justin: WRITE](Justin/README.md)
- [Shared: integration, persistence and application](Shared/README.md)
- [Unassigned: deferred decisions](unassigned/deferred-unassigned-phase.md)
- [Phase commit groups](COMMIT-GROUPS.md)

## Order and dependencies

Preserve each approved owner's phase order. Justin may adjust his own reference plan under his own rules; those rules override this organization for him, while shared contracts and product gates remain binding. Shared execution ownership must be assigned before implementation.

Resolve each applicable S01-S04 decision before its dependent wiring. S01's product decisions were approved October 26, 2026 (decision register and PRD Section 7g); S02-S04 remain unresolved. Agreed fixture adapters allow component development before full web integration; they never authorize production dispatch on fixture evidence. Tests accompany each component phase. Later reliability phases close remaining gaps.

Shared 3.1 reviews existing storage first; SQL is conditional. Shared 3.2 closes I03 only after that review and durable atomic state work are complete. Shared 3.3 recovery coverage must be rechecked for every later connector. Shared 4.1 waits for accepted Research and a planning-owner decision. Shared 4.2 establishes graph boundaries; I02 remains open until Shared 5.2 supplies and verifies its export connector. Shared 5.1/5.2 may use the established graph foundation without waiting for I02 final check-off. This separates development dependencies from final acceptance and avoids a circular prerequisite.

No step may invent an unresolved contract. Deferred decisions remain gates for their dependents. Independently authorized work may proceed without those assumptions. Do not silently reorder the plan or edit Justin behavior.

## Completion and accountability

1. Keep each of the 26 canonical checkboxes unchecked until its complete assignment and acceptance criteria pass. A plan, fixture, partial connector or provider HTTP 200 is insufficient.
2. After an assignment is verified complete, check its canonical item and add a dated explanation: what changed, why the criteria are satisfied, affected files/artifact versions, validation commands and actual X/Y, reviewer and remaining limitations.
3. Update the relevant phase completion record and owner index in the same authorized change. A parent phase completes only when all required children do; task IDs spanning children remain open until all required work passes.
4. Failed or blocked checks remain visible and unchecked. Conditional SQL reuse is recorded as N/A with evidence; it does not skip required persistence behavior.
5. Shared 1.1 documentation completion is a supporting milestone, not a completed item among the 26. No product work begins from this document alone.

## Phase branch lifecycle

For Manny's authorized builds, create one temporary branch for the active phase
from the latest fetched, verified `developer`. Obtain approval of the exact
branch name first. Phase 1's approved branch is
`manny/phase-1-intake-to-research`. Do not begin a dependent phase while its
required decisions or prior acceptance criteria remain unresolved.

1. Build the approved phase, preserving owner boundaries; run tests during the
   work and record actual X/Y. Complete required SECURITY and REVIEWER checks.
2. Check off the assignment only when all criteria pass, with the completed-work
   explanation and evidence. Do not publish partial phase work as complete.
3. Inspect every relevant worktree, fetch remote updates, check incoming/outgoing
   commits and open PRs, and verify exact tips, ancestry and unique work before
   committing, pushing, switching or merging.
4. Follow the phase commit body, revised team-reference skill and final empty
   review-summary requirement. Push the temporary branch to its own remote ref;
   its PR targets `developer`, never `main` or the persistent READ branch.
5. Merge only after the required checks/reviews pass and the PR remains safe.
   Fetch the resulting `developer` tip. Fast-forward eligible non-main branches
   only when clean, authorized by ownership, and ancestors of that tip. Main is
   excluded. Synchronization publishes existing reviewed commits only; if new
   commits are required, follow the ordinary review-summary publication rules.
6. Under the user's phase-cleanup authorization, delete only this completed
   temporary branch after verifying both its local and remote tips are integrated
   and contain no unique work. Return to `manny/read-agents`. Keep persistent
   READ, SQL, teammate, integration and release branches.

Dirty trees, unexpected remote advancement, divergence, unmerged unique work or
missing teammate-owner authorization stop the affected operation. Report exact
evidence and safe options to the human; do not force, reset, rebase or discard
work. Justin controls his own WRITE phase organization and implementation.

## SQL ownership and lane identity

SQL is shared: either contributor may work on approved database tasks. Canonical lane: sql-foundation, based on developer, with PRs to developer. Manny's non-SQL READ work stays on manny/read-agents. Switch out of the SQL lane for non-SQL work; check dirty worktrees, fresh tips, ancestry and unique commits before switching/fast-forwarding. Stop with evidence and safe recommendations if alignment is unsafe. Never fast-forward main to align lanes.

Existing local/remote legacy ref manny/sql-foundation is not renamed or deleted by documentation. Shared 1.2 remains pending until the separately authorized, verified Git transition is complete. Preserve historical handoff references.

## Primary completion map: all 26 items

Each ID appears once below at its primary completion location; supporting phases may contribute without closing it.

| Item | Owner | Primary completion phase |
| --- | --- | --- |
| I01 | Shared | [4.1](Shared/Phase-4-Planning-and-complete-orchestration/4.1.md) |
| I02 | Shared | [4.2](Shared/Phase-4-Planning-and-complete-orchestration/4.2.md) |
| I03 | Shared | [3.2](Shared/Phase-3-Durable-execution-and-recovery/3.2.md) |
| I04 | Shared | [3.3](Shared/Phase-3-Durable-execution-and-recovery/3.3.md) |
| I05 | Shared | [5.1](Shared/Phase-5-Application-completion-and-acceptance-evidence/5.1.md) |
| I06 | Shared | [5.2](Shared/Phase-5-Application-completion-and-acceptance-evidence/5.2.md) |
| I07 | Shared | [5.3](Shared/Phase-5-Application-completion-and-acceptance-evidence/5.3.md) |
| J01 | Justin | [1](Justin/Phase-1-Live-WRITE-runtime-boundary/1.md) |
| J02 | Justin | [2.1](Justin/Phase-2-Chapter-generation-and-write-barrier/2.1.md) |
| J03 | Justin | [2.2](Justin/Phase-2-Chapter-generation-and-write-barrier/2.2.md) |
| J04 | Justin | [3.1](Justin/Phase-3-Editorial-proposals/3.1.md) |
| J05 | Justin | [3.2](Justin/Phase-3-Editorial-proposals/3.2.md) |
| J06 | Justin | [4.1](Justin/Phase-4-Revision-cycle-and-WRITE-verification/4.1.md) |
| J07 | Justin | [4.2](Justin/Phase-4-Revision-cycle-and-WRITE-verification/4.2.md) |
| M01 | Manny | [1](Manny/Phase-1-Confirmed-intake-to-Research-contract/1.md) |
| M02 | Manny | [2.1](Manny/Phase-2-Research-evidence-and-dossier-acceptance/2.1.md) |
| M03 | Manny | [2.2](Manny/Phase-2-Research-evidence-and-dossier-acceptance/2.2.md) |
| M04 | Manny | [3.1](Manny/Phase-3-Reader-and-Consistency-connections/3.1.md) |
| M05 | Manny | [3.2](Manny/Phase-3-Reader-and-Consistency-connections/3.2.md) |
| M06 | Manny | [3.3](Manny/Phase-3-Reader-and-Consistency-connections/3.3.md) |
| M07 | Manny | [4.1](Manny/Phase-4-READ-reliability-evidence/4.1.md) |
| M08 | Manny | [4.2](Manny/Phase-4-READ-reliability-evidence/4.2.md) |
| S01 | unassigned | [deferred](unassigned/deferred-unassigned-phase.md) |
| S02 | unassigned | [deferred](unassigned/deferred-unassigned-phase.md) |
| S03 | unassigned | [deferred](unassigned/deferred-unassigned-phase.md) |
| S04 | unassigned | [deferred](unassigned/deferred-unassigned-phase.md) |

## Current boundary

The initial documentation system, branding and PRD v4 were integrated in PR #13. The user subsequently approved Manny phase execution and the temporary phase lifecycle. S01's product decisions are approved; consult the canonical checklist and each phase record for actual implementation status. SQL, live provider enablement, durable history, WRITE behavior and unresolved S02-S04 decisions are not silently included in Manny Phase 1.
