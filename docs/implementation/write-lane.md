# Justin WRITE lane

The WRITE lane implements specialist chapter drafting, the write barrier, parallel editorial revisions, and the bounded revision loop. It does not implement Research, Reader, or Consistency, and connects to those components solely through labeled synthetic shells.

## Candidate story bibles

`proposePlan(ownerId, id)` in `src/server/projects.ts` stores three pending candidate proposals:
- `bible_a`: Candidate A focusing on plot momentum and the lighthouse signal mystery.
- `bible_b`: Candidate B focusing on character depth, emotional stakes, and Mara's mentor.
- `bible_c`: Candidate C focusing on coastal world rules, weather squalls, and heavy wooden dories.

The writer approves one candidate via `approveProposal(ownerId, id, proposalId)`. A kind guard enforces that only proposals with `kind.startsWith("bible_")` or `synthetic-plan` can be approved as story bibles; manuscript proposals submitted to this endpoint are rejected with status 400.

## Chapter drafting and write barrier

Parallel chapter tasks 1, 2, and 3 invoke pure fixture functions in `src/agents/writers.ts`:
- `draftChapterOne`: establishes the hook, coastal setting, and character stakes.
- `draftChapterTwo`: handles escalation and mid-story confrontation; respects test fixtures (`normal`, `continuity`, and `timeout`).
- `draftChapterThree`: resolves the mission by boat, keeping Mara safely out of the water.

The write barrier `orderedChapters(outputs, approvedVersion)` enforces that all three unique chapter indexes `[1, 2, 3]` are present, match the approved bible version, and are sorted strictly by index.

## Reader-to-Editor H3 handoff and shells

Before editorial revision begins, the handoff harness in `src/agents/handoff.ts` validates the five required fields:
1. `task`: task identifier, action, scope `[1, 2, 3]`, and expected output.
2. `userInstructions`: coordinator recorded request, revision index, and additional instructions flag. Must match recorded user authority.
3. `sourceReferences`: versioned chapter locators covering all three required chapters.
4. `completeness`: completion boolean, missing items list, and confidence.
5. `version`: schema version 1, handoff revision, bible version, and draft version.

Local synthetic shells owned by this lane:
- `buildFixtureHandoff`: constructs a deterministic 5-field handoff from the assembled draft.
- `repairFixtureHandoff`: provides one bounded repair revision when validation fails; second failure halts execution.
- `consistencyShell`: in `src/agents/consistency-shell.ts`, returns status `unavailable` with a fixed reason that the READ lane consistency service is disconnected. Never returns a pass, score, or "no issues".

## Parallel Critic / Editors and manuscripts

Two independent, pure editor functions in `src/agents/editors.ts` produce full 3-chapter manuscript proposals:
- `criticEditorA` (`manuscript_a`): continuity and pacing lens. Corrects contradictions (such as rewriting "Mara swam" into boat maneuvering) to honor fact F1 and sharpens transitions.
- `criticEditorB` (`manuscript_b`): voice and atmosphere lens. Elevates sensory imagery, oceanic fog, and prose cadence while strictly respecting canon.

Neither editor commits database state or approves canon. Proposals are stored as pending proposals (`kind: "manuscript_a"`, `"manuscript_b"`) for writer review at Human Gate #2.

## Bounded revision loop

The revision loop operates as an outer server-driven loop via `rewriteRun`:
- Verifies `revisionRounds < 2`.
- Increments the round counter, updates recorded user instructions, resets chapter tasks against the existing approved bible version, and re-dispatches execution.
- When `revisionRounds >= 2`, further rewrite requests are rejected with status 409, leaving both proposals and unresolved issues visible.
