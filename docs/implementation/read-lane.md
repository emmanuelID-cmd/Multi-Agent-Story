# Manny READ lane

The READ lane exposes authorized story state and optional book metadata. It does
not approve plans, revise chapters, write database rows, or dispatch writing
tasks. The existing Justin WRITE implementation, worker, and workspace remain
preserved as uncommitted work outside this lane.

## Story state

`GET /api/projects/{id}/state?version={v}` requires a Better Auth session. The
optional `version` is a positive integer from 1 through 10000; when omitted,
the service uses the project's current approved version. The first database
query requires the project ID and session owner. A missing project, a foreign
project, and a missing explicit version return the same `404 Project unavailable.`
response. Subsequent reads use only that project's approved bible, a run linked
to that bible, and chapters matching its version. A repeatable-read, read-only
transaction gives the response one database snapshot.

The response contains the brief, approved bible facts and beats, validated
memory handoffs, ordered chapter text, unresolved issues, and research evidence
for the selected run. It omits saved task inputs, session data, owner IDs, and
credentials. `status` is `unavailable` when no usable approved version exists,
`partial` when a draft is absent or incomplete, and `completed` when the linked
run is completed with three valid chapters, complete handoffs, and a valid
critique. `memoryStatus`, `issuesStatus`, and `evidenceStatus` distinguish
`available`, `partial`, `unavailable`, and `not_requested` sections. An absent or
invalid critique has `unresolvedIssues: null`; it does not mean there are no
issues. Stored JSON and chapter values are validated before they are returned;
invalid entries are withheld. Stored evidence source URLs must match the fixed
provider URLs exactly, so credentials, query keys, and unrelated hosts cannot
be returned through this route.

## Book metadata

`POST /api/research/benchmarks` requires a session, an accepted local origin,
and a JSON body of at most 4096 bytes. Body reading has a five-second deadline;
an aborted or stalled request is canceled and receives a generic invalid-body
response. Example request:

```json
{"projectId":"a9f57b79-c0c8-409e-9f50-d5caf0b12345","genre":"Mystery","providers":["nyt","gutendex"],"nytList":"hardcover-fiction","limit":5}
```

`projectId` and `genre` are required. `providers`, `nytList`, and `limit` have
server defaults; the allowed providers are NYT Books and Gutendex, and the limit
is 1 through 10. Unknown fields, including client-supplied enable flags, API
keys, and URLs, are rejected. The service checks project ownership before
calling the metadata adapter. Missing and foreign projects receive the same
generic 404. Provider output is returned as read-only evidence and is not saved
to story state.

Each provider result states `available`, `empty`, `unavailable`,
`rate_limited`, or `not_requested`, with a reason code, source URL, check time,
retrieval time when fetched, quarantined-record count, and validated records.
Missing rank, weeks-on-list, and download signals stay `null`; no score or
sales forecast is inferred. Record IDs, source URLs, missing fields, and match
confidence preserve provenance. The adapter's `publishedDate` value for NYT
records is the **list date**, not a book publication date. Metadata titles and
authors are untrusted input; flagged values are excluded from agent context.

Live requests remain disabled by `LIVE_BOOK_METADATA=false` and
`BOOK_METADATA_TERMS_REVIEWED=false` in `.env.example`. Those are server-side
gates. `NYT_BOOKS_API_KEY` is a server-side name only; no value belongs in this
document, API input, response, or logs. With live reads disabled, provider
results say `not_requested` and make no network call. The adapter also bounds
provider responses to 1 MiB, follows no redirects or pagination links, and
uses a five-second request timeout. An outage leaves story-only work available.
The accepted origins currently match the local Better Auth configuration;
deployment needs an explicit origin configuration review before this endpoint
is exposed elsewhere.
Caching and per-user provider quotas are not implemented. Review and configure
those limits before enabling either live metadata gate.

The [Gutendex documentation](https://gutendex.com/) describes the public
metadata fields and topic/language parameters and recommends self-hosting for
long-term use. The [NYT Books API specification](https://github.com/nytimes/public_api_specs/blob/master/books_api/books_api.yaml)
documents the current list endpoint and API key. Live provider availability,
terms, quotas, and permitted production use have not been verified. Provider
calls in tests use synthetic mocked responses; no live records have been
retrieved by this implementation.
