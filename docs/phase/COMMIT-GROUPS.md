# Phase commit groups

This catalogue does not independently authorize Git operations. The user's approved phase lifecycle authorizes publication, safe developer integration and temporary phase cleanup after verified completion. Follow the external git.md Solo Phase Commit and Commit Collaboration sections. Subjects and bodies describe completed milestones, never planned work as completed.

## Commit-ready rules

- Commit one completed phase/sub-phase at a time. Parent phases with children complete only when all required children do. Do not combine ownership lanes or unrelated pre-existing work.
- Use type(scope): phase N — concise specific outcome. Include Phase, What changed, Why, Collaboration, Boundaries and Validation sections with concrete results.
- Shared work names the actual implementer and coordinated owners. Justin may adapt his WRITE group organization under his own rules.
- Use developer as the integration/base; contributor/SQL PRs target developer; only developer PRs target main. Main remains unchanged during lane alignment.
- Before each authorized commit, inspect the current diff, line-scan every selected file and approve the exact staging set. Before an authorized push, update TEAM-REFERENCE.md under its skill; include the required final empty review-summary commit only at that publication stage under external git.md. Never report unpublished work as pushed.
- Branding, initial PRD v4 and phase-system preparation were published separately in PR #13. Future phase commits include only their approved work and related completion records; inspect current staged/unstaged changes and preserve unrelated work.
- Corrections follow external error-control rules and do not imply a partially built phase is complete.

## Phase branch publication and cleanup

Manny's active phase uses its own temporary branch from verified `developer`.
The exact approved Phase 1 name is `manny/phase-1-intake-to-research`.
After verified phase completion, inspect trees, remote changes and open PRs,
publish its scoped phase commit(s), team handoff and empty review-summary,
then PR to `developer` and merge only when safe. Fast-forward eligible branches
except `main`, preserving owner permissions and unique work. Verify both local
and remote temporary phase tips are integrated before deleting that phase branch
under the user's cleanup authorization; retain persistent lanes. See the
[complete lifecycle](README.md#phase-branch-lifecycle). No partial implementation
may be labeled a completed phase, and unresolved prerequisites remain gates.

## Proposed groups in approved owner order

| Group | Proposed subject | Boundary / ready condition |
| --- | --- | --- |
| manny-1 | feat(manny-read): phase 1 — confirmed intake-to-research contract | M01; all criteria in the phase file verified |
| manny-2.1 | feat(manny-read): phase 2.1 — provider/source retrieval | M02; all criteria in the phase file verified |
| manny-2.2 | feat(manny-read): phase 2.2 — dossier persistence, coverage and acceptance connection | M03; all criteria in the phase file verified |
| manny-2b | docs(manny-read): phase 2B — controlled vocabulary and intake/research alignment | Supplemental approved plan only; planned/not started; implementation, branch and publication are not authorized by this record |
| manny-3.1 | feat(manny-read): phase 3.1 — actual reader snapshots | M04; all criteria in the phase file verified |
| manny-3.2 | feat(manny-read): phase 3.2 — rejection and bounded repair | M05; all criteria in the phase file verified |
| manny-3.3 | feat(manny-read): phase 3.3 — exact-proposal consistency | M06; all criteria in the phase file verified |
| manny-4.1 | feat(manny-read): phase 4.1 — failure, freshness and recovery coverage | M07; all criteria in the phase file verified |
| manny-4.2 | feat(manny-read): phase 4.2 — safe diagnostics and documentation corrections | M08; all criteria in the phase file verified |
| justin-1 | feat(justin-write): phase 1 — live write runtime boundary | J01; all criteria in the phase file verified |
| justin-2.1 | feat(justin-write): phase 2.1 — three model-backed writers | J02; all criteria in the phase file verified |
| justin-2.2 | feat(justin-write): phase 2.2 — indexed output, version and completion validation | J03; all criteria in the phase file verified |
| justin-3.1 | feat(justin-write): phase 3.1 — receiving validation and live editorial work | J04; all criteria in the phase file verified |
| justin-3.2 | feat(justin-write): phase 3.2 — versioned manuscript proposals and preservation | J05; all criteria in the phase file verified |
| justin-4.1 | feat(justin-write): phase 4.1 — revision-cycle integration | J06; all criteria in the phase file verified |
| justin-4.2 | feat(justin-write): phase 4.2 — failure, cancellation and preservation coverage | J07; all criteria in the phase file verified |
| shared-1.1 | docs(shared): phase 1.1 — phase files, task coverage and commit groups | Supporting milestone; all criteria in the phase file verified |
| shared-1.2 | chore(shared): phase 1.2 — sql branch-name transition and current references | Supporting milestone; all criteria in the phase file verified |
| shared-2 | feat(shared): phase 2 — agreed integration contracts | Supporting milestone; all criteria in the phase file verified |
| shared-3.1 | feat(shared): phase 3.1 — storage review and conditional sql work | Supporting milestone; all criteria in the phase file verified |
| shared-3.2 | feat(shared): phase 3.2 — atomic state and dependency recording | I03; all criteria in the phase file verified |
| shared-3.3 | feat(shared): phase 3.3 — worker recovery and idempotency | I04; all criteria in the phase file verified |
| shared-4.1 | feat(shared): phase 4.1 — model-backed bible planning and approval | I01; all criteria in the phase file verified |
| shared-4.2 | feat(shared): phase 4.2 — full fixed graph and phase barriers | I02; all criteria in the phase file verified |
| shared-5.1 | feat(shared): phase 5.1 — actions, progress and approval connections | I05; all criteria in the phase file verified |
| shared-5.2 | feat(shared): phase 5.2 — accepted export | I06; all criteria in the phase file verified |
| shared-5.3 | feat(shared): phase 5.3 — full-circle and failed-gate verification | I07; all criteria in the phase file verified |

## Body template

Replace placeholders with verified facts at commit time; do not copy a completion assertion for unfinished work.

```text
Phase:
- Owner, phase/sub-phase and completed acceptance criteria.

What changed:
- Exact selected files and resulting behavior.

Why:
- Concrete milestone outcome.

Collaboration:
- Actual implementer, coordinated owners and referenced-but-unchanged peer work.

Boundaries:
- Deferred work and preserved owner/product boundaries.

Validation:
- Commands, actual X/Y, review evidence and remaining limitations.
```

The four unresolved decision items are completed through their jointly approved decision records, not by a fabricated implementation commit. Include settled records with the authorized contract milestone after the relevant owner approvals.
