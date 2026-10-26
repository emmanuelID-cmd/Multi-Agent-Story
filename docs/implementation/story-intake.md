# Web story intake: implementation and verification contract

This implements PRD v3 R30/R31 in the real local home page. It replaces the
five-field entry form with a free-form idea and a visible helper. It is not
the standalone `story-intake-flow.html` demonstration. Drafting and editing
still run Justin's existing synthetic functions.

## Requirements and ownership

The writer's task is to describe a three-chapter story, inspect missing details,
make individual decisions, and confirm a research scope. Coordinator owns
intake in PRD v3 section 5a; its bounded analysis task uses Manny's existing
Anthropic adapter. It does not add a thirteenth agent or repurpose the Reader
that prepares chapter evidence for editors. Justin's prompts and generated
fixture prose are unchanged.

| Requirement | Implemented behavior | Acceptance evidence |
| --- | --- | --- |
| R30: helper and sparse brief | `intakeFields` lists 18 details in three groups; a 1–12,000-character original can be saved before genre is known | Contract tests; real save/reload browser test |
| R31: independent decisions | Each available model suggestion needs an option, custom answer, rejection, or deferment; dependent questions wait for their parent | Contract/service tests; interactive browser test |
| R31: final review | Supplied and chosen details are shown separately from unresolved details before explicit confirmation | Browser interaction and server confirmation checks |
| Input before research | Stored, exact-analysis confirmation and genre precede the metadata request | Scope-gate unit test; real unconfirmed-request browser test |
| Required dossier before planning | New intake projects cannot invoke fixture planning as a bypass | Server guard and UI notice; legacy fixture path preserved |

## Configured agent and system prompt

`src/agents/intake.ts` defines Coordinator's `story-intake` task and its fixed
system prompt. The task extracts only explicitly supplied details, returns
exact contiguous quotes, marks ambiguity, and proposes at most eight focused
follow-ups with one to three options each. Missing fields are derived by code,
not accepted from a model's success claim. Duplicate fields, invented quotes,
suggestions that overwrite unambiguous supplied details, self-dependencies and
dependency cycles are rejected. Exact quotes establish occurrence, not proof
that a semantic classification is correct; the writer reviews the result.

The actual adapter is `AnthropicReadModel`, using `claude-haiku-5-5` and medium
effort. The intake task has no tools, browsing, SQL, write, approval or publishing
permission. Input is JSON data under a separate fixed system prompt. Credentials
come from the server-only `ANTHROPIC_API_KEY`; no secret is sent in model context.
The fixed destination and schema output controls are inherited from the adapter.

The configured task permits two calls at most (one structured-result repair),
5,000 output tokens per call, a 35-second task timeout and a 14,000 aggregate
reported-token check. The aggregate check happens after a response; it is not a
provider billing cap or a price guarantee. A per-owner in-process guard prevents
overlapping intake calls in one server process; it is not a distributed quota.
No model failure substitutes a synthetic analysis.

## Shared state and coordination

The existing `projects.brief` JSON stores the original text, intake revision,
analysis ID and source hash, model/prompt versions, decisions and confirmed
scope. No SQL schema or migration was added. The five legacy string properties
remain a compatibility adapter; sparse intake permits unknown optional strings
without weakening legacy five-field validation. Unaccepted suggestions and raw
analysis metadata are excluded from Writer context; confirmed story details
are passed as untrusted data.

`POST /api/projects` accepts `{rawText}` and creates a draft. Client-supplied
intake state, analysis or confirmation is rejected. The owner-only endpoint
`POST /api/projects/{id}/intake` accepts these actions:

| Action | Required state | Effect |
| --- | --- | --- |
| `save` | Current `expectedRevision`, valid `rawText` | Saves the original; clears prior analysis, decisions and scope |
| `analyze` | Current revision, editable project | Reserves an operation, calls the model outside the transaction, then checks revision/operation/hash before saving |
| `review` | Current revision and analysis ID, partial decisions | Saves review progress without confirming or opening research; resumable after reload |
| `confirm` | Current revision and stored `analysisId`, decisions, `confirmScope: true` | Recomputes the brief and scope on the server; requires genre and explicit decisions on available suggestions |

Intake revisions are separate from approved Bible versions. Owner-scoped row
locks serialize updates; stale operations return 409. Model calls never hold a
database lock. A pending reservation can be explicitly retried after 45 seconds
if interrupted; a late result cannot replace the new operation. Intake editing
stops once planning has begun. Planning uses the same short row-lock boundary.
No model output can approve on behalf of the writer.

## Failure and input boundaries

Authentication precedes origin, body, ownership and model access. Both new intake
routes bound JSON bodies to 80,000 bytes and five seconds, validate UTF-8 and
types, and cancel incomplete streams. Control characters are rejected; flagged
role/formatting text can remain saved for correction but is excluded from model
dispatch. Legitimate Unicode prose is preserved. These checks reduce injection
risk; they do not detect every semantic attack. SQL uses Drizzle-bound values;
prompt injection and SQL injection are separate concerns.

Missing credentials, unavailable service, invalid output, cancellation, timeout
or stale state leaves the saved original available. The UI shows loading and
actionable errors, refreshes failed analysis state for retry, and clears old
review/metadata when the original changes. Errors and ordinary logs do not echo
private inputs or provider response bodies. Saved project JSON is visible only
through authenticated owner-scoped project access; this work adds no retention
or deletion policy beyond the existing local foundation.

## Research handoff and current stopping point

The confirmed scope retains genre and all supplied or accepted dimensions,
including subgenre, characters, period, setting and story direction. The existing
book-metadata endpoint requires the saved genre and both NYT/Gutendex provider
outcomes for intake projects. It returns the scope alongside provider outcomes.
It does not acquire eligible prose or support every period/setting filter; its
existing live-read and terms gates remain in force. Metadata is not an accepted
research dossier. Full Research dispatch, evidence acceptance and planning
integration remain separate work; the application keeps that planning gate shut.

## Harness and verification

Vitest uses injected models and repositories to test source occurrence,
bounded repair, cancellation, missing genre, individual decisions, dependencies,
revision/hash checks, failure recovery and metadata gating. The Playwright intake
interaction uses a labeled simulated model response; a separate browser test
uses real local authentication, PostgreSQL save/reload and cross-owner/stale/
unconfirmed rejection. Neither test calls Claude or external book providers.

Analysis ID, source hash, usage, model and prompt revision are retained in the
owner's saved analysis. This request does not join the separate CLI READ trace
viewer and does not expose model private reasoning. No statistical
quality/reliability result is claimed by the deterministic tests.

On 26 October 2026, a controlled synthetic story submitted through authenticated
web intake returned HTTP 200 with status `analyzed`, ten extracted observations
and five suggestions. One ungrounded result was rejected before the bounded
repair succeeded. This verifies one live intake example, not general reliability
or a live research/drafting loop. The initial local failure was outbound network
access blocked in the restricted server process; a non-secret HTTPS probe failed
with `EACCES` there and connected successfully in the elevated environment.
The verified project server was restarted with authorized network access.

Connection, credential/access, configuration, rate-limit, provider availability,
timeout and invalid-result errors now give distinct recovery guidance and retain
the original idea. Provider error bodies are discarded; diagnostic logs contain
only fixed validation codes or allowlisted network codes. If a restricted launch
blocks outbound HTTPS, run the dev server from an authorized local terminal with
network access. Do not disable TLS verification or place keys in the browser.

To test manually: start Docker/PostgreSQL and `npm run dev`, sign in at
`http://127.0.0.1:3000/`, select New project, save an idea and select **Analyze
with Claude**. That explicit action sends the saved story idea to Anthropic.
Use synthetic local test material until the broader privacy/release gates are met.
