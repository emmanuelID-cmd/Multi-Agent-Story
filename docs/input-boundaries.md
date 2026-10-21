# Input boundaries and injection risks

## Scope and inspected sources

This note documents the synthetic foundation's current handling of user brief
text and optional research metadata. It covers prompt-injection boundaries,
input validation, tool-name restrictions, output validation, and the separate
server authorization path. It does not change the PRD or claim that a detector
can identify every malicious or misleading input. The resumed implementation is
limited to Manny's READ lane. Existing WRITE, worker, and interface work is
preserved for Justin and is not being extended in this pass.

Inspected implementation and test sources:

- [`src/contracts/index.ts`](../src/contracts/index.ts) — brief, bible, chapter,
  fixture, evidence, and run schemas.
- [`src/contracts/input-policy.ts`](../src/contracts/input-policy.ts) — field
  signals, fixed role-to-tool map, and optional-metadata quarantine.
- [`src/agents/context.ts`](../src/agents/context.ts) and
  [`src/agents/graph.ts`](../src/agents/graph.ts) — writer context assembly,
  fixture execution, and chapter validation.
- [`src/server/research/index.ts`](../src/server/research/index.ts) —
  fixture-only research evidence.
- [`src/server/research/book-metadata.ts`](../src/server/research/book-metadata.ts)
  — disabled-by-default NYT Books and Gutendex metadata adapters and reader context.
- [`src/server/read-state.ts`](../src/server/read-state.ts) — owner-scoped,
  version-specific state reads in a read-only database transaction.
- [`src/server/http.ts`](../src/server/http.ts),
  [`src/server/projects.ts`](../src/server/projects.ts), and
  [`src/app/api/projects/[id]/route.ts`](../src/app/api/projects/%5Bid%5D/route.ts)
  — session checks, owner-scoped actions, and explicit approval.
- [`tests/input-boundary.test.ts`](../tests/input-boundary.test.ts) — Unicode,
  field signals, metadata quarantine, context separation, and tool rejection.

## Boundary map

| Stage | Implemented behavior | Boundary and limitation |
| --- | --- | --- |
| Brief entry and persistence | The workspace validates fields with `briefSchema`; the server parses again in `createProject`. Length and required-field rules are field-specific. | Client validation is for feedback. The server remains authoritative for accepted project data. |
| Field signals | `inspectText` returns `ACCEPT`, `FLAG`, or `REJECT`. Control characters are rejected; single-line labels reject line breaks, zero-width space, and bidi controls; bidi controls and role-delimiter patterns can be flagged; metadata instruction phrases can be flagged. | These are narrow signals, not semantic understanding. A `FLAG` on creative brief text is retained as data; a `REJECT` prevents dispatch. Findings are not yet shown in a dedicated correction workflow. |
| Context assembly | `buildWriterContext` parses the brief and bible, checks chapter index and approved version, and keeps `WRITER_POLICY` separate from JSON-serialized brief, facts, and chapter beat. | JSON encoding preserves the trusted/data boundary syntactically; it cannot stop the model from being influenced by malicious meaning in data. No live model is connected. |
| Tool scope | A fixed role-to-tool map is declared in `input-policy.ts`; the current writer context asserts `read_story_state`. | This code does not create a live model tool loop. A future provider adapter must enforce the same allowlist at dispatch and must not accept tools or permissions from conversation text. |
| Optional metadata | `metadataForContext` returns raw text only for `ACCEPT`. The new book adapters validate bounded provider responses, quarantine flagged titles, omit flagged authors, and retain safe structured findings. Reader policy remains separate from JSON evidence. | Live reads require both server feature gates; tests use mocks. Only allowlisted provider URLs are constructed, redirects are rejected, and pagination/full-text links are not followed. Semantic signals can miss attacks. |
| READ state | Session checks precede owner-scoped retrieval. Dependent queries use the selected project's bible and run keys in a read-only, repeatable-read transaction. Persisted rows are validated before return. | The endpoint returns story data, not model instructions. A future model consumer must keep this data outside trusted policy and enforce its tool permissions independently. |
| Output | Synthetic chapter objects pass `chapterSchema`; `orderedChapters` checks count, unique indexes, and bible version before assembly. | These checks validate structure and version, not truth, quality, or resistance to persuasive model output. Current chapter prose is fixed fixture text. |
| Human approval and server actions | Project routes require a session; mutating routes check origin; project services check ownership. The server accepts an explicit decision for a specific pending proposal and checks its base version before committing it. | Authorization is enforced by server code, outside any model context. This is local synthetic account authentication, not production identity or recovery delivery. |
| Database queries | Project services use Drizzle predicates such as `eq` and `and` for query values. | Parameter binding reduces SQL injection risk. It does not prevent prompt injection: a safely stored string can still contain instructions aimed at a model. |

## Detector result contract

`InputFinding` contains `fieldRef`, `source`, `verdict`, `reasonCode`,
`requiredEvidenceImpact`, and `humanCorrectionNeeded`. Current verdicts are
`ACCEPT`, `FLAG`, and `REJECT`. The implementation maps `REJECT` to
`unavailable` evidence impact, `FLAG` to `review`, and `ACCEPT` to `none`; it
sets `humanCorrectionNeeded` for either non-ACCEPT verdict. References and
provenance are carried without putting raw suspicious metadata in routine logs.

Optional metadata is excluded from context on either `FLAG` or `REJECT`, while
the structured finding remains available. Required brief fields have a different
policy: a `REJECT` blocks dispatch, while a `FLAG` can remain in JSON data because
the signal does not grant authority. The current workspace does not yet present
these findings as a user correction queue.

Unicode is not rejected wholesale. Tests include composed and decomposed
accents, Arabic text, and emoji; handling them is a preservation choice, not a
verdict or guarantee. Role-delimiter and instruction phrase matches are signals
only. Keyword-free, novel, multilingual, image, audio, and other unsupported
inputs may not be detected by these heuristics.

## Implemented controls and next bounded work

Implemented: server-side Zod validation; field-specific length and formatting
rules; separate policy and JSON data sections; a fixed role-to-tool map; optional
metadata exclusion on non-ACCEPT findings; chapter schema/version checks; and
server-side session, origin, and ownership checks around project actions.

Before enabling provider reads, verify current availability, terms, quotas, and
credentials. Before connecting a live model, ensure dispatch enforces the role
allowlist and add an observable human correction path for findings. Keep provider text and any
supported media as untrusted data. Validate final provider output against
deterministic contracts and tests; do not treat detector passes as proof of
safety.

## Test evidence and residual risk

[`tests/input-boundary.test.ts`](../tests/input-boundary.test.ts) covers valid
Unicode examples, hidden/control formatting in labels, a control character,
role-delimiter and instruction-like metadata, safe metadata, JSON data separation,
and denied writer tool names. The READ tests additionally cover ownership,
version scoping, malformed stored rows, provider timeouts and rate limits,
credential redaction, metadata quarantine, Unicode, and missing-versus-zero
signals. Exact executed counts are reported with the implementation checks;
mocked provider responses do not establish live readiness.

There is no live model, enabled research provider, imported media path, or production
identity flow in this foundation. Heuristic matches can miss attacks and can
flag benign content. Approved bible facts and beats have Zod type and size checks,
but `inspectText` currently scans brief fields rather than bible fact and beat
text; define and apply their field policy before any live model can receive them.
This is an implementation boundary summary, not a public vulnerability
dashboard or a security guarantee.
