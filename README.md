# Multi-Agent Story Builder

A collaboration assignment to turn a fiction premise into an ordered, editable
three-chapter draft, with writer-approved planning and bounded critique.

**Status:** documentation and proposed contracts only. No application, database,
provider integration, or evaluation results exist yet.

## Project references

- [Product requirements](docs/prd/Multi-Agent-Story-Builder-PRD.md)
- [PRD PDF](docs/prd/Multi-Agent-Story-Builder-PRD.pdf)
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
Storage, runtime, authentication provider, and schema tooling remain unselected.
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

## Local configuration and setup status

There is no install, start, build, or test command yet. LangGraph is a provisional
PRD candidate pending an integration spike; no stack or package manager is selected.
This documentation work requires no dependency installation.

An empty `.env` is local-only and ignored. The tracked [.env.example](.env.example)
documents the proposed `NYT_BOOKS_API_KEY` configuration name without a value.
Map it in a server-side adapter only after implementation approval. Never expose
it in browser code, model prompts, request logs, or exported evidence URLs.
Model-provider variables will be documented after provider selection.

## Validation and release gates

Before implementation, freeze fixtures for the PRD's three eval cases: normal
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
  docs/
    TEAM-REFERENCE.md
    prd/
      Multi-Agent-Story-Builder-PRD.md
      Multi-Agent-Story-Builder-PRD.pdf
```

At initial inspection this local repository was on `main`, with no commits or
remote. Its GitHub identity is not verified. Preserve existing PRD content;
do not infer cloud backup from its OneDrive path. Branch creation, staging,
committing, pushing, and merging require explicit approval under external AGENTS.
