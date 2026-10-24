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

- [Active PRD v2 working draft](docs/prd/drafts/PRD-v2-draft.md) — intake-first research alignment; product choices remain under review
- [Original submitted PRD](docs/prd/Multi-Agent-Story-Builder-PRD.md) — preserved historical baseline
- [PRD PDF](docs/prd/Multi-Agent-Story-Builder-PRD.pdf)
- [Documentation index](docs/README.md)
- [Multi-agent workflow](docs/architecture/multi-agent-workflow.md)
- [Contributor instructions](AGENTS.md)
- [Team handoff](docs/TEAM-REFERENCE.md)
- [WRITE lane implementation](docs/implementation/write-lane.md)
- [External AGENTS guide](https://github.com/emmanuelID-cmd/AGENTS)

## Collaboration

| Contributor | Assignment | Approved interpretation |
| --- | --- | --- |
| Manny | READ Agents | Research, Reader, and Consistency analysis; authorized retrieval, evidence attribution, and read contracts |
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
The WRITE lane provides 3 candidate bibles at Gate #1, parallel chapter drafting, two competing editorial manuscripts (Version A and Version B) at Gate #2, an outer 2-round revision loop, and synthetic shells for Reader and Consistency.
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

The following is the proposed v2 flow, not behavior already implemented by the
fixture workspace. The submitted PRD, architecture drafts, and guide snapshots
remain historical references where they differ from this intake/research correction.

1. Collect and save the writer's brief before research. Ask for premise, genre,
   optional subgenre, audience, tone, desired ending, character names and roles,
   settings, lore, time period, beginning/middle/end direction, apex, climax,
   and falling action as known.
2. Show missing or ambiguous details and offer suggestions grounded in the
   writer's intent. Preserve valid input; confirm the genre and research scope.
   Suggestions become constraints only when the writer accepts them.
3. Run mandatory Research using both NYT Books and Gutendex. Save both provider
   outcomes in a versioned dossier. Required evidence must be accepted before
   any Bible planning; insufficient evidence pauses work for bounded recovery
   or a visible scope decision, with no silent story-only fallback.
4. Plan plot, character, and world against the accepted dossier. The v2 roster
   includes three Bible roles; one merged bible versus three candidate bibles
   remains a product decision.
5. Wait for the writer to approve the exact story-bible version and three beats.
6. Dispatch three indexed chapter writers against the same approved version.
7. Validate every chapter, assemble by index, and have Reader prepare the
   required versioned handoff. Critic/Editors validate it before editing;
   Consistency checks the exact resulting versions. One revision proposal
   versus two complete editorial alternatives remains a product decision.
8. Wait for human acceptance of changes, with at most two revision rounds and
   a budget check before every dispatch. Limits never imply automatic success.
9. Export ordered chapters, bible, unresolved issues, versions, and evidence
   as Markdown; label partial work explicitly.

Group intake into story, cast, world, and plot questions, retaining answers
between steps. A sparse brief is saveable; the detailed prompts are not all
new mandatory fields. More information can improve specificity, without
guaranteeing quality. Suggested optional details include point of view, tense,
character goals, motivations, obstacles, stakes, relationships, and turning
points. Positive, negative, and flat arcs are valid; ancillary characters need
development only where relevant. The draft proposes apex as peak pressure and
climax as the decisive confrontation, pending the writer's vocabulary choice.
Use focused follow-ups, keyboard access, visible status, field guidance, and
clear recovery actions. This is a design specification, not a new interface.

### Proposed agent roster

The full v2 architecture has **12 proposed instances**, including unresolved
planning and editorial alternatives. These are trace labels, not 12 implemented
live agents. Coordinator and Showrunner name one agent; each Critic/Editor is
one combined agent. Intake belongs to Coordinator, not an extra agent.

| Trace ID | Agent name | Development lane |
| --- | --- | --- |
| `coordinator` | Coordinator / Showrunner | Shared |
| `research` | Research | Manny READ |
| `bible_a` | Bible A — plot / mystery | Planning ownership unassigned |
| `bible_b` | Bible B — character / emotion | Planning ownership unassigned |
| `bible_c` | Bible C — world / atmosphere | Planning ownership unassigned |
| `chapter_writer_1` | Chapter Writer 1 | Justin WRITE |
| `chapter_writer_2` | Chapter Writer 2 | Justin WRITE |
| `chapter_writer_3` | Chapter Writer 3 | Justin WRITE |
| `reader` | Reader | Manny READ |
| `critic_editor_a` | Critic / Editor A — continuity / pacing | Justin WRITE |
| `critic_editor_b` | Critic / Editor B — voice / atmosphere | Justin WRITE |
| `consistency` | Consistency | Manny READ |

Counts: Manny 3 READ + Justin 5 WRITE + 3 unassigned planning + 1 shared = 12.
READ agents return analysis and handoffs; WRITE agents return proposals. Both
Critic/Editors validate Reader inputs. Only authenticated application acceptance
commits approved story state; ownership labels grant no runtime permissions.

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
| Project | id, owner_id, brief_version, brief {premise, genre?, subgenre?, audience?, tone?, desired_ending?, characters?, settings?, lore?, time_period?, direction?, apex?, climax?, falling_action?, pov?, tense?}, current_state_version, created_at | Server checks ownership for every operation; save sparse input; confirm genre and research scope before mandatory research |
| IntakeReview | id, project_id, brief_version, supplied_facts[], missing_items[], suggestions [{id, text, status}], confirmed_scope, confirmed_at? | Distinguish supplied, suggested, accepted, and unresolved information; no suggestion silently becomes a constraint |
| StoryBibleVersion | id, project_id, version, research_dossier_id, facts [{id, kind, text}], character_arcs[], chapter_beats [{chapter_index, beats, relevant_fact_ids}], approval_status, approved_at | Uses accepted current research; approved versions immutable; chapter indexes exactly 1, 2, 3; facts have stable IDs |
| Run | id, project_id, bible_version_id, status, revision_round, limits, usage, canceled_at, started_at, finished_at | Only an approved bible; rounds 0 through 2; server enforces limits and cancellation |
| Task | id, project_id, run_id, role, chapter_index?, input_version, saved_input_ref, attempt, status, output_ref?, error_code?, elapsed_ms, usage | Fixed role graph; one retry; chapter index required for writers; stale or canceled results cannot commit |
| ChapterVersion | id, project_id, run_id, task_id, chapter_index, bible_version_id, draft_version, text, approval_status | Unique task attempt result; ordered merge; no overwrite of approved text |
| MemoryHandoff | id, project_id, bible_version_id, chapter_index, fact_ids, summary, planned_events, unresolved_threads | Compression cannot replace canonical facts; parallel writers receive planned handoffs without requiring another writer's finished prose |
| Critique | id, project_id, run_id, draft_version_refs, dimension, availability, score?, notes [{chapter_index, passage_ref, severity, rationale, fact_ids, evidence_ids, proposed_edit}] | Critics wait for all valid chapters; scores 1 through 5 only when available; actionable notes have locations |
| Proposal | id, project_id, base_state_version, kind, diff, affected_fact_ids, chapter_version_refs, validation_issues, status, decided_at | Pending, accepted, rejected, or stale; application commits acceptance atomically only against current base version |
| ResearchEvidence | id, project_id, provider, provider_record_id?, title?, authors[], isbns[], source_url, fetched_at?, provider_published_at?, availability, permitted_use_status, match_confidence, missing_fields[], signals, text_reference?, passage_locator?, rights_basis?, observations[], inferences[] | Separate metadata from permitted-text observations and inference; unknown fields null; retain failures separately from empty results |
| ResearchDossier | id, project_id, version, brief_version, confirmed_scope, provider_outcomes[], evidence_ids[], craft_profiles[], character_observations[], required_criteria, gaps[], status, accepted_at? | Both provider outcomes recorded; readable current evidence meets agreed criteria before planning; a partial provider outcome alone is insufficient; brief/scope changes invalidate affected acceptance |

Proposed task states: pending, running, completed, failed, canceled. Proposed run
states: pending, running, paused, completed, failed, canceled. A completed run
requires all required chapter outputs validated; partial drafts remain labeled.
Availability values: available, empty, unavailable, rate_limited, not_requested.
Match confidence: confirmed, tentative, unmatched; title alone cannot confirm identity.
Dossier gate states are proposed as pending, blocked, or accepted. A provider's
`not_requested` outcome never satisfies the mandatory research gate. There is
no `research_enabled` bypass in the v2 design. These additions are conceptual;
the current runtime schema and SQL have not been extended by this documentation.
Permitted-use status: unverified, allowed, restricted; activate collection only
after provider-use review. Optional fields marked `?` may be null.
An intake draft may omit these optional fields. Genre and confirmed scope become
required at the research gate. When supplied, characters and settings are arrays;
direction contains optional beginning, middle, and end entries.

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

Provider documentation rechecked October 22, 2026. The approved interpretation of "NYC Data"
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

The current adapters remain metadata-only and disabled by default. The v2
design expands research to bounded analysis of identified, permitted text;
this change does not enable ingestion or a live provider. Verify rights for
the intended jurisdiction or the user's license before analysis. A Gutendex
copyright flag is not global rights clearance; see [Gutenberg permissions](https://www.gutenberg.org/policy/permission.html).
NYT metadata is bestseller context, not an open license to manuscript text.
Gutendex download popularity is not a sales rank, and the catalogs need not
contain the same works. Open Library and Hardcover remain deferred.

Research should produce an original genre-aware blend of reusable craft traits,
with per-work references, located observations, intended story use, confidence,
and gaps. Example profile: horror; slow disclosure, restricted viewpoint,
atmospheric detail, and escalating uncertainty, supported by permitted passages.
Do not infer craft or protagonist, antagonist, and ancillary-character arcs
from title/rank alone, copy passages, or claim unsupported signature imitation.
Keep source facts, text observations, inference, and writer-accepted choices
distinct; the writer's creative intent controls the resulting plan.

Before extending or enabling adapters, verify provider availability and terms,
request/response validation, credentials, caching/retention, quotas, timeouts,
matching, and text-use scope. Minimum research coverage, sample size, and
recency remain decisions to calibrate; five books is an assumption, not a gate.
Outage, empty results, rate limits, or unsafe required evidence pause planning
for bounded recovery or an explicit scope decision. No silent story-only
continuation, composite popularity score, or fabricated evidence is permitted.

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

Before broader product release, freeze fixtures for the active PRD's eval cases:
sparse intake and accepted suggestions; mandatory research before planning;
permitted-text attribution and unsupported craft claims; normal approved drafting;
continuity errors and ambiguous/missing research; adversarial metadata,
timeout/retry, cross-project access, cancellation, and late responses.
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

The committed synthetic foundation is the shared starting point. Use `developer`
as the integration and starting base for all contributor, task, and SQL work
branches. Schema and migration changes belong on the separate persistent
`manny/sql-foundation` lane; Manny's READ work belongs on `manny/read-agents`.
Both lanes send reviewed pull requests to `developer`; only pull requests from
`developer` target `main`. Do routine work on lane or task branches rather than
directly on `developer` or `main`. These rules describe branch ancestry and PR
targets; each persistent lane continues tracking its own remote ref. Verify
publication and branch status from Git and the [team handoff](docs/TEAM-REFERENCE.md),
not from this static description.

Before switching or updating either lane, inspect its working tree, exact local
and remote tips, ancestry, and commits unique to the target. After a PR into
`developer` merges, fast-forward an eligible lane from `developer` only when the
lane tip is its ancestor and the operation cannot overwrite local changes.
After the reviewed `developer`-to-`main` release PR merges, fast-forward
`developer` from `main` only when the `developer` tip is an ancestor of `main`
and the release commit contains its work; then fast-forward eligible lanes from
`developer` under the same ancestry and no-overwrite checks. `main` may remain
behind `developer` while the release PR is pending; do not bypass the PR gate to
align it. If histories diverge, a target has unique commits absent from its
destination, or local changes could be overwritten, stop and present exact
evidence for a human decision. Never force, reset, discard, or delete work to
force alignment. Preserve existing PRD content and do not infer cloud backup
from its OneDrive path. Branching, staging, committing, pushing, merging, and
branch deletion remain subject to the approved plan and external AGENTS gates.
