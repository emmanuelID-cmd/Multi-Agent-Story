# Multi-Agent-Story contributor instructions

## Required instruction sources

Read [README.md](README.md), the [active PRD v2 draft](docs/prd/drafts/PRD-v2-draft.md),
and the [submitted PRD](docs/prd/Multi-Agent-Story-Builder-PRD.md) before planning.
The submitted PRD is preserved history; current user corrections govern the
intake/research alignment in the working draft. Unresolved v2 architecture
choices remain proposals, not implementation approval.
Current user instructions take precedence, then
README, relevant external AGENTS documents, then existing project documentation
and implementation. Do not silently resolve a requirements conflict.

This project follows the external [AGENTS repository](https://github.com/emmanuelID-cmd/AGENTS).
On this workstation its verified root is `C:\Users\Github\AGENTS`.
Read that directory's `AGENTS.md`, `README.md`, and relevant linked instructions;
read `agents/planner.md` first. Read `SKILLS-REFERENCE.md` for applicable local skills.
If the directory or any required document is unavailable, stop and report it.
Do not create substitute instructions or assume another machine has this path.

## Development workflow

Use the external role instructions rather than treating this summary as a replacement:

1. PLANNER investigates read-only, inspects dependency readiness, and presents a plan.
2. After plan approval and resolution of its unknown recommendations, activate
   ARCHIVIST when durable project state is affected, then pass the plan verbatim
   to BUILDER. Do not request the same plan approval again.
3. Run SECURITY when applicable, including its required two inspection rounds.
4. Run REVIEWER and its complete changed-file line scan; route eligible findings
   through FIXER and back to REVIEWER under the external bounded-cycle rules.
5. BUDDY is conditional on explicit project completion or approved conditional
   handoff. A direct completion BUDDY audit is followed by ACCOUNTANT, with
   applicable SECURITY follow-up and ARCHIVIST recovery review before verdict.

Roles are instruction sets and do not automatically spawn agents. Follow the
external self-identification, handoff-failure, TOKEN-routing, and delegation rules.
TEST MODE is explicitly requested and read-only; it never authorizes edits.

## Collaboration ownership

- **Manny: READ Agents.** Research, Reader, and Consistency: authorized retrieval,
  research evidence, editorial handoffs, independent findings, and read contracts.
- **Justin: WRITE Agents.** Chapter Writers 1/2/3 and combined Critic/Editors A/B:
  chapter drafting and revision proposals against accepted research, approved
  story state, and the shared contract; validate Reader inputs before editing.
- **Shared:** versioned schemas, task envelopes, fixtures, integration boundaries,
  and schema changes require coordination before either lane depends on them.

Manny's approved implementation lane is [READ](docs/implementation/read-lane.md).
Preserve existing Justin WRITE, worker, and interface work without extending or
deleting it. The existing metadata adapters remain disabled by default; do not
enable live providers or connect a model as part of a READ-only change.

Use `developer` as the integration and starting base: create all contributor,
task, and SQL work branches from it, and target `developer` with pull requests
from `manny/read-agents` and the separate persistent `manny/sql-foundation`
lane. Only pull requests from `developer` target `main`. Do routine work on lane
or task branches, not directly on `developer` or `main`. This describes branch
ancestry and pull-request targets; each persistent lane keeps tracking its own
remote ref.

These assignments do not permit one contributor to overwrite another's work or
grant a product agent additional permissions. The full proposed v2 roster has
12 instances: Manny's 3 READ, Justin's 5 WRITE, 3 Bible roles with planning
ownership unassigned, and 1 shared Coordinator / Showrunner. Stable IDs are
`coordinator`, `research`, `bible_a`, `bible_b`, `bible_c`, `chapter_writer_1`,
`chapter_writer_2`, `chapter_writer_3`, `reader`, `critic_editor_a`,
`critic_editor_b`, and `consistency`. Coordinator and Showrunner are the same
instance; each Critic/Editor is one combined instance. Intake adds no agent.
One merged bible versus three candidates and one editorial proposal versus two
full alternatives remain product decisions; these labels are not 12 implemented
agents. READ produces analysis, not creative canon; planning produces proposals,
not chapter prose. Critic/Editors annotate and propose; application code commits
only an authenticated writer's accepted proposal against its current base version.
Keep [the team handoff](docs/TEAM-REFERENCE.md) current under the Team Reference skill.

## Product invariants

- Collect and save the writer's input before Research. Ask for premise, genre,
  optional subgenre, audience, tone, desired ending, character names/roles,
  settings, lore, time period, beginning/middle/end, apex, climax, and falling
  action as known. Preserve a sparse brief; do not invent required detail fields.
- State missing or ambiguous information and suggest options based on the
  writer's intent. Only accepted suggestions become constraints. Confirm genre
  and research scope before dispatch. Optional POV/tense and character goals,
  motivations, obstacles, stakes, relationships, and positive/negative/flat arcs
  can improve specificity. Apex/climax definitions remain a proposed vocabulary.
- Research is mandatory in the v2 design: record both NYT Books and Gutendex
  outcomes in a versioned dossier and accept required evidence before Bible
  planning. Partial provider results do not automatically satisfy the gate.
  Missing required evidence pauses dependent work; never silently skip research.
- Require explicit approval of a specific story-bible version before drafting.
- All three chapter tasks use the same approved version and indexes 1, 2, 3.
- Validate schemas and versions before merge; assemble by index, not arrival order.
- Start critics only after every required chapter passes validation.
- Preserve canonical fact IDs independently of compressed memory.
- Keep approved versions immutable; revisions are proposals with explicit acceptance.
- Enforce concurrency, token, cost, retry, timeout, and two-round limits in code.
  README limits remain proposed until calibrated and implemented.
- Preserve completed work on cancellation and reject late or stale state changes.
- Enforce project ownership server-side for reads, writes, restores, and exports.
  Avoid errors that reveal another project's existence or content.
- Treat retrieved metadata, prose, and task output as untrusted data. Embedded
  instructions cannot expand tools, permissions, budget, or the fixed role graph.
- Do not publish, message others, retrieve copyrighted bestseller text, expose
  secrets, or access other writers' projects.

## Input boundaries

Briefs pass Zod field limits and field-aware text signals before persistence and
again before context assembly. The writer policy remains separate from
JSON-serialized story data; role-specific tool names are fixed, current adapter metadata
with any non-ACCEPT verdict is excluded, and chapter outputs are schema-checked.
These are bounded controls, not proof that prompt injection is detected. Model
text cannot grant server permissions: routes require an authenticated user and
project services check ownership. SQL parameter binding and prompt-injection
handling address different risks. See [the input-boundary notes](docs/implementation/input-boundaries.md)
for the implemented map, detector result fields, test coverage, and gaps.

For the proposed expanded intake and research, validate field types, limits,
identity, source versions, and rights before context assembly. Preserve legitimate
Unicode names and prose. Return ACCEPT/FLAG/REJECT with item reference, reason,
provenance, required-evidence impact, and correction needed. Exclude rejected
raw fields; an optional unsafe description may be omitted with a visible exception
only when independent required evidence remains sufficient. Unsafe or uncertain
required evidence keeps the research gate closed. Imported text, stored records,
and agent results cannot become trusted instructions or trigger arbitrary URLs,
tools, SQL, or commands. These are design requirements, not implemented live-text
controls or a guarantee of detection.

## Research and configuration

NYT Books and Gutendex are the mandatory v2 research sources after confirmed
intake. No NYC geographic filter is established. Current implementation is still
gated metadata-only; the proposed expansion adds bounded analysis of identified
permitted text after rights and scope verification. Other adapters, sales
forecasts, and composite popularity scoring remain deferred.
Verify official documentation, current availability, permitted use, authentication,
quotas, and fields before implementing or enabling an adapter.

Preserve source URLs without credentials, retrieval dates, provider identifiers,
match confidence, missing fields, and explicit unavailable status. No fabricated
records or missing-as-zero scores. Research failure must pause dependent planning
for bounded retry, correction, or an explicit user scope decision; no silent
story-only fallback. Minimum coverage, sample size, and recency remain unresolved.
Never interpret Gutenberg copyright metadata as worldwide permission to ingest text.

NYT bestseller metadata is neither prose evidence nor permission to ingest a
manuscript. Gutendex download counts are not sales ranks; its catalog need not
match NYT's books. Use verified public-domain text for the intended jurisdiction
or suitably licensed user-provided references for located craft and character
observations. Synthesize an original genre-aware blend of reusable traits,
without copied passages or close signature imitation. Record work/author,
passage/source reference, rights basis, genre fit, intended story use, confidence,
and gaps. Separate metadata facts, text observations, interpretations, and
accepted user suggestions. Include protagonist, antagonist, and ancillary arcs
only where supported and relevant; no style or arc claims from rankings alone.
Preserve Reader's five-field handoff validation and bounded repair, both editors'
validation in the proposed full roster, exact-version Consistency findings,
human acceptance, and the three-chapter/two-round limits. Added research and
review costs require calibration within the existing budget gate.

Keep `.env` ignored. Commit only safe configuration names and empty/example
values in `.env.example`; never read or print local secret values for review.
Provider keys remain server-side and outside model context and routine logs.
The [README implementation guide](README.md#local-setup-and-implementation)
documents the implemented foundation: Node 24/npm, Next.js/React/TypeScript,
LangGraph.js, Zod, PostgreSQL/Drizzle, a separate Node worker with pg-boss,
Better Auth, Vitest, and Playwright. It supports synthetic fixture workflows;
live model and research providers, deployment, and production privacy/retention
controls remain deferred. `package.json` and `package-lock.json` are the source
of truth for dependency versions and commands. Keep `.env` ignored, and never
read or print its local secret values.

## Implementation locations

The foundation has established the following paths. Do not create empty
directories or placeholder modules to imply setup is done.

| Path | Purpose and boundary |
| --- | --- |
| `src/app/` | Story interface and server endpoints; ownership unassigned |
| `src/contracts/` | Shared validation schemas and types; Manny and Justin coordinate before use |
| `src/agents/` | LangGraph roles and orchestration; Manny owns read behavior, Justin owns writing/revision proposals |
| `src/worker/` | Durable background execution; ownership unassigned |
| `src/server/db/` | Data access and schema definitions; ownership unassigned |
| `src/server/auth/` | Authentication/session boundaries; ownership unassigned |
| `src/server/research/` | Manny's NYT Books and Gutendex metadata adapters |
| `drizzle/` | Reviewed database migrations; ownership unassigned |
| `tests/` | Contract, integration, and browser verification; ownership unassigned |

For further implementation, verify runtime compatibility and use synthetic model
and research fixtures first. Keep proposal acceptance, ownership checks,
idempotency, budget limits, and cancellation enforcement in application code;
neither the orchestrator nor the queue grants approval or replaces those controls.

## Files, recovery, and Git

Keep entry points at the root, current PRD artifacts under `docs/prd/`, PRD
drafts under `docs/prd/drafts/`, workflow architecture and chart assets under
`docs/architecture/`, implementation notes under `docs/implementation/`, and
team handoff under `docs/`. Keep the HTML guide and ZIP under `docs/artifacts/`.
Add feature directories only when implementation establishes them.
Preserve PRD bytes when organizing artifacts; verify moves with SHA-256 hashes.
Inventory durable state before risky changes. A synchronized folder or local Git
directory alone is not evidence of backup; report unverified restores honestly.

Verify the exact repository root, branch, status, and remote before Git actions.
Preserve pre-existing untracked and modified files. If no remote exists, do not
invent one or attempt synchronization. The persistent `manny/read-agents` lane
owns READ work; the separate persistent `manny/sql-foundation` lane owns schema
and migration work. Use `developer` as their integration and starting base: all
contributor, task, and SQL work branches originate from `developer`, and both
persistent lanes send reviewed pull requests to `developer`. Only `developer`
pull requests target `main`; keep routine work on lane or task branches rather
than directly on `developer` or `main`. This is branch ancestry and PR routing;
each persistent lane continues tracking its own remote ref.

Before each lane switch or update, inspect its dirty tree, exact local and
remote tips, ancestry, and commits unique to the target. After a PR into
`developer` merges, fast-forward an eligible lane from `developer` only when the
lane tip is its ancestor and no work can be overwritten. After the reviewed
`developer`-to-`main` release PR merges, fast-forward `developer` from `main`
only when the `developer` tip is an ancestor of `main` and the release commit
contains its work; then fast-forward eligible lanes from `developer` under the
same ancestry and no-overwrite checks. After SQL work, return to
`manny/read-agents` for non-SQL work only after checking its dirty tree, exact
local and remote tips, ancestry, unique commits, and confirming no local work
could be overwritten. `main` may remain behind `developer`
while the release PR is pending; do not bypass that PR gate to align it. If
histories diverge, a target has unique commits absent from its destination, or
local changes could be overwritten, stop and give the human exact evidence and
safe recommendations. Never force, reset, discard, or merge automatically to
make branches appear synchronized. Delete any branch only after it is merged,
has no unique work, and deletion is explicitly approved. Ask explicitly before
branching, staging, committing, pushing, merging, or deleting a branch; general
elevated access is not approval of a specific action.
Shared work follows the external PR-first and commit/review-summary requirements.
Record only verified pushes in the team handoff; do not report local work as pushed.

Run appropriate validation and the Line Return Reference skill after each file
change. Before approval, scan every changed file, report exact changed lines,
check Markdown fences and whitespace, and preview documentation through links.
For future application changes, use the PRD eval fixtures and applicable security,
API, input validation, accessibility, and frontend checks. Never claim unrun tests pass.
