# Multi-Agent-Story contributor instructions

## Required instruction sources

Read [README.md](README.md) and the [PRD](docs/prd/Multi-Agent-Story-Builder-PRD.md)
before planning project changes. Current user instructions take precedence, then
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

- **Manny: READ Agents.** Own authorized state retrieval, research metadata,
  evidence attribution, and proposed read contracts.
- **Justin: WRITE Agents.** Own chapter drafting and revision proposals using
  the approved story state and shared contract.
- **Shared:** versioned schemas, task envelopes, fixtures, integration boundaries,
  and schema changes require coordination before either lane depends on them.

Manny's approved implementation lane is [READ](docs/read-lane.md).
Preserve existing Justin WRITE, worker, and interface work without extending or
deleting it. The optional metadata adapters remain disabled by default; do not
enable live providers or connect a model as part of a READ-only change.

These assignments do not permit one contributor to overwrite another's work or
grant a product agent additional permissions. Product planning roles do not
write chapter prose. Critics annotate; editors propose; application code commits
only an authenticated writer's accepted proposal against its current base version.
Keep [the team handoff](docs/TEAM-REFERENCE.md) current under the Team Reference skill.

## Product invariants

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
JSON-serialized story data; role-specific tool names are fixed, optional metadata
with any non-ACCEPT verdict is excluded, and chapter outputs are schema-checked.
These are bounded controls, not proof that prompt injection is detected. Model
text cannot grant server permissions: routes require an authenticated user and
project services check ownership. SQL parameter binding and prompt-injection
handling address different risks. See [the input-boundary notes](docs/input-boundaries.md)
for the implemented map, detector result fields, test coverage, and gaps.

## Research and configuration

NYT Books and Gutendex metadata are the approved research scope for this
assignment. No NYC geographic filter is established. Gutendex excerpts, other
adapters, sales forecasts, and composite popularity scoring remain deferred.
Verify official documentation, current availability, permitted use, authentication,
quotas, and fields before implementing or enabling an adapter.

Preserve source URLs without credentials, retrieval dates, provider identifiers,
match confidence, missing fields, and explicit unavailable status. No fabricated
records or missing-as-zero scores. Research failure must support story-only use.
Never interpret Gutenberg copyright metadata as worldwide permission to ingest text.

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

Keep entry points at the root, PRD artifacts under `docs/prd/`, and team handoff
under `docs/`. Add feature directories only when implementation establishes them.
Preserve PRD bytes when organizing artifacts; verify moves with SHA-256 hashes.
Inventory durable state before risky changes. A synchronized folder or local Git
directory alone is not evidence of backup; report unverified restores honestly.

Verify the exact repository root, branch, status, and remote before Git actions.
Preserve pre-existing untracked and modified files. If no remote exists, do not
invent one or attempt synchronization. Agree persistent contributor branch names
before creating them. The persistent `manny/read-agents` lane owns READ work;
the separate persistent `manny/sql-foundation` lane owns schema and migration
work. All changes to `main` go through reviewed pull requests. Before each lane
switch or update, inspect its dirty tree, exact local and remote tips, ancestry,
and commits unique to the target. Fast-forward a non-main lane only when its
tip is an ancestor of the verified destination and no work can be overwritten.
If the target lane has commits absent from the destination, histories diverge,
or local changes could be overwritten, stop and give the human exact evidence
and safe recommendations. Never reset, delete, or merge automatically to make
branches appear synchronized. After a successful PR merge,
fast-forward both persistent lanes to `main` when `main`
contains their work and each lane passes these checks. Return to the READ lane
for non-SQL work. Delete any branch only after it is merged, has no unique
work, and deletion is explicitly approved. Ask explicitly before branching,
staging, committing, pushing, merging, or deleting a branch; general elevated
access is not approval of a specific action.
Shared work follows the external PR-first and commit/review-summary requirements.
Record only verified pushes in the team handoff; do not report local work as pushed.

Run appropriate validation and the Line Return Reference skill after each file
change. Before approval, scan every changed file, report exact changed lines,
check Markdown fences and whitespace, and preview documentation through links.
For future application changes, use the PRD eval fixtures and applicable security,
API, input validation, accessibility, and frontend checks. Never claim unrun tests pass.
