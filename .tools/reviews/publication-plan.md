# Publication plan: Multi-Agent-Story

## Context

HEAD already contains the shared synthetic foundation and historical workflow/chart documentation at `4b340485bd0cf94b52294150c44b28d4ba890aa3`. The unstaged tree contains the approved documentation organization, project-first workspace, portable guide, developer routing, and PRD alignment. The index is empty. The external AGENTS repository is a separate repository and is not included.

## Approach

Publish on `manny/read-agents` through focused commits without rewriting working files. Use prepared index snapshots to separate earlier organization/routing from later requirements and corrections; a single combined commit would obscure independent tasks.

## Steps

1. Verify the exact root, remote, source branch, destination, incoming history, and open PRs.
2. Validate the complete outgoing file set and prepare the existing team handoff.
3. Stage and commit the six scoped groups below in order; validate each staged file list.
4. Create the required final metadata-only review-summary commit with a verified SHA range.
5. Push only `manny/read-agents`, verify its remote tip, and open its PR into `developer`.
6. Recheck tree and branch alignment; apply only authorized safe fast-forwards without bypassing the PR.

## Acceptance criteria

The intended branch is published to the correct repository; no source, SQL, secrets, or external repository files are included. The working tree and index are clean after all approved files are committed. The PR targets developer. Commit bodies retain all required headings; the summary has no tree changes. Unit tests report 37/37; move, ZIP, link, fence, and whitespace checks pass.

## Out of scope

Merging the PR, advancing main directly, provider activation, application implementation, deletion, and publishing ignored local review/preparation files.

## Unknowns

None blocking publication. Product design questions remain explicitly unresolved in the PRD. With no incoming changes, there is currently no fast-forward update to apply; integrating outgoing READ commits requires the separate developer PR review.

## Plan handoff

The user's commit, push, PR, clean-tree inspection, and safe-fast-forward requests authorize this publication sequence. Proceed through preparation, review, scoped commits, push verification, and PR creation.

## Commit grouping and line scan

### 1. docs(layout): organize project references and preserve drafts

Purpose: Keep architecture, implementation notes, and historical drafts discoverable without changing runtime behavior.

- README.md: current lines 10, 18-19, 56, 266-278, 282-287; prior removed/replaced lines 10, 18, 55.
- AGENTS.md: current lines 45, 83, 135-139; prior removed/replaced lines 45, 83, 135-136.
- docs/README.md: new lines 1-25.
- docs/prd/drafts/PRD-v2-draft.md: add historical baseline lines 1-381; group 5 applies the reviewed alignment.
- docs/prd/drafts/PRD-v2-draft - Copy.md: new lines 1-381, preserved historical copy.
- docs/architecture/drafts/multi-agent-workflow-v2-draft.md and docs/architecture/drafts/copies/multi-agent-workflow-v2-draft.md: new lines 1-177 each.
- docs/read-lane.md -> docs/implementation/read-lane.md: move lines 1-80, identical Git content.
- docs/artifacts/flow-architecture-sketch.svg -> docs/architecture/assets/flow-architecture-sketch.svg: move lines 1-250, identical Git content.
- docs/artifacts/flow-architecture-sketch.jpg -> docs/architecture/assets/flow-architecture-sketch.jpg: identical binary move; no line numbers.
- docs/multi-agent-workflow.md -> docs/architecture/multi-agent-workflow.md: moved full file; current lines 32; prior removed/replaced lines 32.
- docs/input-boundaries.md -> docs/implementation/input-boundaries.md: moved full file; current lines 15, 17, 19-20, 22, 24, 26, 28-30, 32, 86; prior removed/replaced lines 15, 17, 19-20, 22, 24, 26, 28-30, 32, 86.

Validation: Verified move hashes and local links; preserved submitted PRD and duplicate drafts; unit tests 37/37.

Proposed commit body:

```text
docs(layout): organize project references and preserve drafts

What changed:

- Keep architecture, implementation notes, and historical drafts discoverable without changing runtime behavior.
- Files: README.md, AGENTS.md, docs/prd/drafts/PRD-v2-draft.md, docs/README.md, docs/multi-agent-workflow.md, docs/architecture/multi-agent-workflow.md, docs/artifacts/flow-architecture-sketch.jpg, docs/architecture/assets/flow-architecture-sketch.jpg, docs/artifacts/flow-architecture-sketch.svg, docs/architecture/assets/flow-architecture-sketch.svg, docs/input-boundaries.md, docs/implementation/input-boundaries.md, docs/read-lane.md, docs/implementation/read-lane.md, docs/architecture/drafts/multi-agent-workflow-v2-draft.md, docs/architecture/drafts/copies/multi-agent-workflow-v2-draft.md, docs/prd/drafts/PRD-v2-draft - Copy.md.

Why:

- Keep architecture, implementation notes, and historical drafts discoverable without changing runtime behavior.

Collaboration:

- Manny's READ lane publishes the approved project documentation; Justin's WRITE implementation remains preserved.

Boundaries:

- No application, SQL, provider activation, or external AGENTS repository changes. Justin's temporary review remains local and ignored.

Validation:

- Verified move hashes and local links; preserved submitted PRD and duplicate drafts; unit tests 37/37.
```

### 2. chore(workspace): prioritize the Multi-Agent-Story folder

Purpose: Open this project first in the saved VS Code workspace while retaining the user's external instruction folder reference.

- Multi-Agent-Story.code-workspace: new lines 1-11.

Validation: Workspace JSON parses; first folder is this project; second folder is a relative reference, not copied external content.

Proposed commit body:

```text
chore(workspace): prioritize the Multi-Agent-Story folder

What changed:

- Open this project first in the saved VS Code workspace while retaining the user's external instruction folder reference.
- Files: Multi-Agent-Story.code-workspace.

Why:

- Open this project first in the saved VS Code workspace while retaining the user's external instruction folder reference.

Collaboration:

- Manny's READ lane publishes the approved project documentation; Justin's WRITE implementation remains preserved.

Boundaries:

- No application, SQL, provider activation, or external AGENTS repository changes. Justin's temporary review remains local and ignored.

Validation:

- Workspace JSON parses; first folder is this project; second folder is a relative reference, not copied external content.
```

### 3. docs(artifact): add the portable story guide archive

Purpose: Make the existing self-contained HTML guide available as the requested downloadable ZIP.

- docs/artifacts/story-builder-guide.zip: new binary archive; one HTML entry, SHA-256 identical to the tracked HTML.

Validation: ZIP contains only story-builder-guide.html; its SHA-256 matches the tracked HTML guide.

Proposed commit body:

```text
docs(artifact): add the portable story guide archive

What changed:

- Make the existing self-contained HTML guide available as the requested downloadable ZIP.
- Files: docs/artifacts/story-builder-guide.zip.

Why:

- Make the existing self-contained HTML guide available as the requested downloadable ZIP.

Collaboration:

- Manny's READ lane publishes the approved project documentation; Justin's WRITE implementation remains preserved.

Boundaries:

- No application, SQL, provider activation, or external AGENTS repository changes. Justin's temporary review remains local and ignored.

Validation:

- ZIP contains only story-builder-guide.html; its SHA-256 matches the tracked HTML guide.
```

### 4. docs(git): route contributor pull requests through developer

Purpose: Use developer as the contributor/SQL integration base and preserve reviewed release PRs to main.

- README.md: current lines 290-299, 302-315; prior removed/replaced lines 290-294, 297-307.
- AGENTS.md: current lines 50-57, 154-181; prior removed/replaced lines 146-162.

Validation: Reviewed routing, safe fast-forward direction, divergence stops, persistent SQL separation, and return to READ lane.

Proposed commit body:

```text
docs(git): route contributor pull requests through developer

What changed:

- Use developer as the contributor/SQL integration base and preserve reviewed release PRs to main.
- Files: README.md, AGENTS.md.

Why:

- Use developer as the contributor/SQL integration base and preserve reviewed release PRs to main.

Collaboration:

- Manny's READ lane publishes the approved project documentation; Justin's WRITE implementation remains preserved.

Boundaries:

- No application, SQL, provider activation, or external AGENTS repository changes. Justin's temporary review remains local and ignored.

Validation:

- Reviewed routing, safe fast-forward direction, divergence stops, persistent SQL separation, and return to READ lane.
```

### 5. docs(prd): require research after confirmed story intake

Purpose: Align the working PRD and contributor docs with intake-first mandatory research, supported craft analysis, and traceable ownership.

- README.md: current lines 16-17, 29, 60-62, 64-126, 149-151, 158-159, 166-169, 189, 202-209, 211-227, 318-322; prior removed/replaced lines 16, 28, 59-66, 90-91, 98, 124, 137-143, 235-237.
- AGENTS.md: current lines 5-10, 42-46, 52, 64-74, 80-92, 113, 121-131, 134-138, 144-146, 149-163; prior removed/replaced lines 5-6, 38-41, 47, 59-60, 86, 96-98, 104.
- docs/prd/drafts/PRD-v2-draft.md: current lines 3, 5, 7, 60, 66, 74, 93, 95, 101, 103-105, 107, 111, 113-116, 138, 151, 156, 160, 162-177, 180-181, 183, 193, 195, 197, 201, 203, 205, 221, 223-224, 229-230, 237-239, 241-246, 263-264, 282, 288, 293, 297, 301, 303, 307-310, 312, 316-318, 324-332, 348, 352, 363, 375, 395, 408-409, 411-412, 414; prior removed/replaced lines 3, 5, 7, 60, 66, 74, 93, 95, 101, 103-105, 107, 111, 134, 147, 152, 156, 160, 162, 172, 174, 176, 180, 182, 184, 200, 202, 213-215, 250, 256, 261, 265, 269, 271, 275-278, 280, 284-286, 292-299, 315, 319, 330, 342, 362, 375-376, 378-379, 381.

Validation: R01-R29 preserved; both provider outcomes and accepted evidence precede planning; 12 proposed instances mapped; documentation review and unit tests 37/37.

Proposed commit body:

```text
docs(prd): require research after confirmed story intake

What changed:

- Align the working PRD and contributor docs with intake-first mandatory research, supported craft analysis, and traceable ownership.
- Files: README.md, AGENTS.md, docs/prd/drafts/PRD-v2-draft.md.

Why:

- Align the working PRD and contributor docs with intake-first mandatory research, supported craft analysis, and traceable ownership.

Collaboration:

- Manny's READ lane publishes the approved project documentation; Justin's WRITE implementation remains preserved.

Boundaries:

- No application, SQL, provider activation, or external AGENTS repository changes. Justin's temporary review remains local and ignored.

Validation:

- R01-R29 preserved; both provider outcomes and accepted evidence precede planning; 12 proposed instances mapped; documentation review and unit tests 37/37.
```

### 6. docs(contracts): clarify sparse intake and permitted references

Purpose: Resolve the two review findings and include the prepared teammate handoff for the complete publication.

- README.md: current lines 149, 172-174; prior removed/replaced lines 149.
- AGENTS.md: current lines 106; prior removed/replaced lines 106.
- docs/TEAM-REFERENCE.md: new lines 297-341; existing history retained.

Validation: Independent re-review APPROVE; optional intake fields and permission-qualified reference rule checked; 73 Justin review blocks match current locations; unit tests 37/37.

Proposed commit body:

```text
docs(contracts): clarify sparse intake and permitted references

What changed:

- Resolve the two review findings and include the prepared teammate handoff for the complete publication.
- Files: README.md, AGENTS.md, docs/TEAM-REFERENCE.md.

Why:

- Resolve the two review findings and include the prepared teammate handoff for the complete publication.

Collaboration:

- Manny's READ lane publishes the approved project documentation; Justin's WRITE implementation remains preserved.

Boundaries:

- No application, SQL, provider activation, or external AGENTS repository changes. Justin's temporary review remains local and ignored.

Validation:

- Independent re-review APPROVE; optional intake fields and permission-qualified reference rule checked; 73 Justin review blocks match current locations; unit tests 37/37.
```

### Final review summary

`chore(review): summarize documentation publication before push` will describe the verified remote baseline through the final work commit, using their full SHAs. It will contain no file changes. Its required What changed / Why / Collaboration / Boundaries / Validation sections precede one final REVIEW block.

## Local-only material

The user-requested Justin change-only file remains ignored under `.tools/reviews/`. Ignored Git preparation snapshots, this plan, test caches, and the PR-body file are local operational material and excluded from publication. No environment values were read or staged.

## Secondary Checks

- Unit tests: 37/37; seven files passed.
- Tracked diff whitespace: PASS.
- Source documentation links and Markdown fences: PASS.
- ZIP integrity: one expected HTML entry matches SHA-256.
- Initial remote state: no open PRs, no incoming commits, no divergent lane histories.
