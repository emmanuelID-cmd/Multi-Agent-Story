# Multi-Agent Story Builder

A collaboration assignment to turn a fiction premise into an ordered, editable
three-chapter draft, with writer-approved planning and bounded critique.

**Status:** the local synthetic foundation is implemented. It includes
authentication, project ownership, a minimal story workspace, fixture-backed
workflow execution, and Markdown export. It has no live model or research
provider enabled, and it has not processed a real manuscript. Current development
is limited to Manny's [READ lane](docs/implementation/read-lane.md): owner-scoped state retrieval
and gated book-metadata adapters. Existing WRITE and interface work is preserved
for Justin; this READ pass does not claim that his lane is complete or reviewed.

## Project references

- [Product requirements](docs/prd/Multi-Agent-Story-Builder-PRD.md)
- [PRD PDF](docs/prd/Multi-Agent-Story-Builder-PRD.pdf)
- [Documentation index](docs/README.md)
- [Multi-agent workflow](docs/architecture/multi-agent-workflow.md)
- [Contributor instructions](AGENTS.md)
- [Team handoff](docs/TEAM-REFERENCE.md)
- [External AGENTS guide](https://github.com/emmanuelID-cmd/AGENTS)

## Collaboration

| Contributor | Assignment | Approved interpretation |
| --- | --- | --- |
| Manny | READ Agents | Authorized state retrieval, optional book research, source attribution, and read contracts |
| Justin | WRITE Agents | Chapter generation and revision proposals against approved state |
| Both | Shared contract | Agree on schemas, version handling, fixtures, and integration boundaries before implementation |

These are development ownership lanes. They are separate from the product's
Showrunner, planners, writers, critics, and editor, and from external workflow
roles such as PLANNER and REVIEWER. Ownership is not runtime authorization.

## Intended MVP

The current foundation implements a bounded slice of this product. It supports
authenticated synthetic users, owner-scoped projects and briefs, an exact-version
proposal approval, three chapter tasks dispatched through a worker, fixture-based
critique, cancellation and retry (at most two attempts), and Markdown export.
The displayed outputs are deterministic synthetic fixtures for the fixed Mara
test case; they are not a generated three-thousand-word story. Research is
reported as unavailable when no fixture evidence is supplied. The interface is
minimal but functional.

Full PRD revision editing, compare/restore UI, live model and research providers,
email verification and recovery delivery, deployment, and production privacy and
retention controls remain deferred.

Input handling validates briefs with Zod and field-aware signals, separates a
fixed writer policy from JSON-serialized story data, declares a fixed role-to-tool
allowlist, quarantines flagged optional metadata, and validates chapter outputs.
These controls reduce risk; keyword and role-delimiter signals do not prove that
content is safe. The current workflow uses fixtures and has no live model. See
[Input boundaries](docs/implementation/input-boundaries.md) for the implemented flow, server
authorization boundary, detector contract, test coverage, and remaining limits.

1. Collect premise, genre, audience, tone, and desired ending; research is optional.
2. Coordinate plot, character, and world planning into a proposed story bible.
3. Wait for the writer to approve that exact bible version and chapter beats.
4. Dispatch three indexed chapter writers against the same approved version.
5. Validate all required outputs, assemble chapters by index, then run continuity,
   style, pacing, and available market-reader critique.
6. Propose edits, wait for acceptance, and repeat critique for at most two rounds.
7. Export ordered chapters, bible, unresolved issues, versions, and evidence as Markdown.

Proposed scope: one English-language story of approximately 3,000 words, one
writer per project, three concurrent model tasks, one retry per failed task,
120-second task timeout, 60,000 tokens and USD 3 provider cost per run. These
are PRD assumptions to calibrate, not measured performance or enforced limits.
Proposed critique threshold: 4/5 per available dimension and no unresolved
critical continuity issue. Missing evidence is unavailable, never a zero score.

Canceling must preserve completed outputs and reject late writes. Retrying must
reuse saved input without rerunning successful tasks or duplicating chapters.
Approved versions must remain recoverable across failures and reloads.

## Proposed shared data schema

This is a conceptual contract, not SQL, a migration, or an executable validator.
The implemented foundation uses the runtime, storage, authentication library,
and validation tooling documented below; this conceptual table does not replace
the application contracts or migrations.
IDs below are opaque application identifiers; timestamps use ISO 8601 with timezone.
All project-scoped references must belong to the same authorized project.

| Entity | Proposed fields | Required invariants |
| --- | --- | --- |
| Project | id, owner_id, brief {premise, genre, audience, tone, desired_ending}, research_enabled, current_state_version, created_at | Server checks ownership for every read, write, restore, and export; research can be disabled |
| StoryBibleVersion | id, project_id, version, facts [{id, kind, text}], chapter_beats [{chapter_index, beats, relevant_fact_ids}], approval_status, approved_at | Approved versions immutable; chapter indexes exactly 1, 2, 3; facts have stable IDs |
| Run | id, project_id, bible_version_id, status, revision_round, limits, usage, canceled_at, started_at, finished_at | Only an approved bible; rounds 0 through 2; server enforces limits and cancellation |
| Task | id, project_id, run_id, role, chapter_index?, input_version, saved_input_ref, attempt, status, output_ref?, error_code?, elapsed_ms, usage | Fixed role graph; one retry; chapter index required for writers; stale or canceled results cannot commit |
| ChapterVersion | id, project_id, run_id, task_id, chapter_index, bible_version_id, draft_version, text, approval_status | Unique task attempt result; ordered merge; no overwrite of approved text |
| MemoryHandoff | id, project_id, bible_version_id, chapter_index, fact_ids, summary, planned_events, unresolved_threads | Compression cannot replace canonical facts; parallel writers receive planned handoffs without requiring another writer's finished prose |
| Critique | id, project_id, run_id, draft_version_refs, dimension, availability, score?, notes [{chapter_index, passage_ref, severity, rationale, fact_ids, evidence_ids, proposed_edit}] | Critics wait for all valid chapters; scores 1 through 5 only when available; actionable notes have locations |
| Proposal | id, project_id, base_state_version, kind, diff, affected_fact_ids, chapter_version_refs, validation_issues, status, decided_at | Pending, accepted, rejected, or stale; application commits acceptance atomically only against current base version |
| ResearchEvidence | id, project_id, provider, provider_record_id?, title?, authors[], isbns[], source_url, fetched_at, provider_published_at?, availability, permitted_use_status, match_confidence, missing_fields[], signals | Attributed metadata; unknown fields null; retain retrieval failures separately from empty results |

Proposed task states: pending, running, completed, failed, canceled. Proposed run
states: pending, running, paused, completed, failed, canceled. A completed run
requires all required chapter outputs validated; partial drafts remain labeled.
Availability values: available, empty, unavailable, rate_limited, not_requested.
Match confidence: confirmed, tentative, unmatched; title alone cannot confirm identity.
Permitted-use status: unverified, allowed, restricted; activate collection only
after provider-use review. Optional fields marked `?` may be null.

Research signals remain provider-specific: NYT list name, list date, rank, and
weeks on list; Gutendex subjects, bookshelves, languages, copyright status,
and download count. These signals do not measure literary quality or forecast sales.
Do not manufacture ratings or merge unrelated works to fill missing fields.

### Proposed internal tools

The PRD names `read_story_state`, `get_genre_benchmarks`, `run_story_tasks`, and
`propose_story_update`. These interfaces and the PRD's internal HTTP paths are
design proposals; none are implemented. Models receive scoped data and no
provider secrets. Only authenticated application actions can approve, restore,
cancel, export, or commit accepted proposals. Writers and critics cannot commit
approved state directly.

## Research sources and verification

Research checked October 20, 2026. The approved interpretation of "NYC Data"
is general book metadata from NYT Books and Gutendex, with no NYC geographic filter.
No book dataset has been collected; the schema is supplied instead.

- **NYT Books:** the [official OpenAPI specification](https://github.com/nytimes/public_api_specs/blob/master/books_api/books_api.yaml)
  documents bestseller lists and an API-key requirement. The developer overview
  could not be opened during verification. Live access, current terms, quotas,
  and pricing remain unverified; do not claim the integration is operational.
- **Gutendex:** [provider documentation](https://gutendex.com/) describes a JSON
  metadata API with paginated book results, title/author search, and topic filters.
  The documentation recommends self-hosting for long-term use. Hosted availability,
  usage terms, and sustainable request limits still need review before integration.

The approved addition covers Gutendex metadata only. Excerpts and full-text
ingestion remain deferred under the PRD. A copyright flag is not global rights
clearance. The PRD's Open Library and Hardcover candidates remain deferred here.
Before any adapter is built, approve its directory, request/response validation,
credential handling, caching and retention, quotas, timeout, and failure behavior.
Outage, empty result, or rate limit must allow a disclosed story-only fallback.
No composite popularity score or fabricated comparable-book evidence is permitted.

## Local setup and implementation

The implementation uses Node.js 24, npm, Next.js 16.4.2, React, TypeScript,
LangGraph.js, PostgreSQL 17, Drizzle, pg-boss, Better Auth, Zod, Vitest, and
Playwright. `package.json` and `package-lock.json` are the source of truth for
versions and commands. A clean checkout requires Node 24 and npm; install the
locked dependencies with `npm ci`. Copy
`.env.example` to `.env`, set distinct random local values for
`POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET`, and set `DATABASE_URL` to use the
same password. No real provider key is needed. Keep `.env` local and untracked.
A scoped `esbuild` override pins version 0.28.2 to address a development-tool
advisory; the latest `npm ci` completed and `npm audit` reported zero
vulnerabilities.

Start the local database with `docker compose up -d --wait`, then run
`npm run db:migrate`. In separate terminals, run `npm run dev` and
`npm run worker`. The web server binds to `127.0.0.1:3000`; PostgreSQL uses
`127.0.0.1:54329`.

Available checks are `npm run typecheck`, `npm run test`,
`npm run test:integration`, `npm run build`, and `npm run test:e2e`.
Integration checks need the local database and `.env`. Browser tests need their
Playwright browser installed, the migrated local database, and the app and worker
running. These are available commands; this document does not claim a particular
run passed.

### Implemented stack

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Runtime and packages | Node.js 24 and npm | JavaScript runtime and locked dependencies |
| Web application | Next.js App Router, React, TypeScript | Story workspace and server endpoints |
| Styling | CSS Modules and shared design tokens | Consistent layout and controls, using the existing guide as a visual reference |
| Orchestration | LangGraph.js | Fixture-backed workflow graph and checkpoints |
| Validation | Zod | Shared validation for briefs, task envelopes, agent outputs, and research metadata |
| Persistence | PostgreSQL and Drizzle | Project data, ownership relationships, and migrations |
| Background execution | Separate Node worker and pg-boss | Durable task dispatch backed by PostgreSQL |
| Authentication | Better Auth with PostgreSQL | Account authentication and sessions, with application-enforced project ownership |
| Verification | Vitest and Playwright | Contract/integration checks and browser workflow tests |

Manny and Justin use shared TypeScript contracts. Long-running work runs in the
worker. Queue delivery does not remove the need for idempotent task writes,
version checks, cancellation enforcement, or transactional approval. The current
fixture workflow does not establish live-provider behavior or full PRD readiness.

Official references: [Node releases](https://nodejs.org/en/about/previous-releases),
[Next.js](https://nextjs.org/docs/app/getting-started/installation),
[LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence),
[Zod](https://zod.dev/), [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started/postgresql-new),
[pg-boss](https://github.com/timgit/pg-boss), and
[Better Auth](https://better-auth.com/docs/installation).

### Implementation locations

```text
src/
  app/               # story interface and server endpoints
  contracts/         # shared Zod schemas and TypeScript contracts
  agents/            # LangGraph orchestration and role implementations
  worker/            # background execution and queue consumers
  server/
    db/              # database schema definitions and data access
    auth/            # authentication and server session handling
    research/        # NYT Books and Gutendex metadata adapters
drizzle/             # reviewed database migrations
tests/               # contract, integration, and browser checks
```

| Area | Coordination boundary |
| --- | --- |
| `src/contracts/` | Manny and Justin jointly agree schemas before either lane depends on them |
| `src/server/research/` | Manny owns research retrieval, validation, attribution, and unavailable states |
| `src/agents/` | Manny owns authorized read behavior; Justin owns writing and revision proposals; coordinate orchestration interfaces |
| `src/app/`, `src/worker/`, `src/server/db/`, `src/server/auth/`, `drizzle/`, `tests/` | Implemented foundation areas; contributor ownership remains unassigned |

### Current local runtime

The foundation uses portable, checksum-verified Node.js 24.22.0 under the
ignored `.tools/` directory. `.tools/runtime-path.txt` records its `bin` path;
the machine's default Node 26 installation remains unchanged. Docker Compose
provides the isolated PostgreSQL 17 service. The project `.env` contains local
random database and session secrets; never read or include those values in
documentation, logs, or review output. The model provider and deployment target
remain undecided, and production privacy and retention gates remain unresolved.

The HTML guide and ZIP are earlier document snapshots. They are not regenerated
as part of this foundation; their embedded text may predate the implementation.

## Validation and release gates

Before broader product release, freeze fixtures for the PRD's three eval cases: normal
approved drafting; continuity errors and ambiguous/missing research; adversarial
metadata, timeout/retry, cross-project access, cancellation, and late responses.
Verify version barriers, ordering, proposal acceptance, budget checks, recovery,
keyboard access, focus, error announcements, and screen-reader behavior.

The PRD proposes a 30-brief evaluation and 10-writer pilot, including paired
single-agent baselines. Its targets include 30% less continuity-repair time,
at most one critical contradiction in at least 90% of drafts, 80% actionable
notes, 95% recoverable completion, no unauthorized external writes, full evidence
attribution, and six of ten pilot writers returning within 14 days. No results
are claimed. Retention, deletion, provider processing, and consent disclosure
remain release blockers before external manuscript processing for pilot users.

## Repository layout and Git status

```text
Multi-Agent-Story/
  AGENTS.md
  README.md
  .gitignore
  .env                 # local only, ignored
  .env.example         # safe configuration template
  compose.yaml         # local PostgreSQL service
  package.json         # commands and dependency declarations
  package-lock.json    # locked dependency tree
  src/                 # application, contracts, worker, and server modules
  drizzle/             # database migrations
  tests/               # automated checks
  docs/
    TEAM-REFERENCE.md
    README.md
    architecture/
      multi-agent-workflow.md
      assets/
        flow-architecture-sketch.jpg
        flow-architecture-sketch.svg
      drafts/
        multi-agent-workflow-v2-draft.md
        copies/
          multi-agent-workflow-v2-draft.md
    implementation/
      read-lane.md
      input-boundaries.md
    prd/
      Multi-Agent-Story-Builder-PRD.md
      Multi-Agent-Story-Builder-PRD.pdf
      drafts/
        PRD-v2-draft.md
        PRD-v2-draft - Copy.md
    artifacts/
      story-builder-guide.html
      story-builder-guide.zip
```

The committed synthetic foundation is the shared starting point. Schema and
migration changes belong on the persistent `manny/sql-foundation` lane; Manny's
READ work belongs on `manny/read-agents`. Publish changes to `main` only through
reviewed pull requests. Verify publication and branch status from Git and the
[team handoff](docs/TEAM-REFERENCE.md), not from this static description.

Before switching or updating either lane, inspect its working tree, exact local
and remote tips, ancestry, and commits unique to the target. Fast-forward a
non-main lane only when its tip is an ancestor of the verified destination and
the operation cannot overwrite local changes. If histories diverge, the target
lane contains commits absent from the destination, or local changes could be
overwritten, stop and present exact evidence for a human decision;
never reset or delete work to force alignment. After each successful PR merge,
fast-forward both persistent lanes to `main` when `main` contains their work
and each lane passes those checks, so all branches can reach the same commit.
Preserve existing PRD content and do not infer cloud backup from its OneDrive
path. Branching, staging, committing, pushing, merging, and branch deletion
remain subject to the approved plan and external AGENTS gates.
