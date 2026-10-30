# Bible planning connection (Shared Phase 4.1)

## Shared story accounting continuation, October 29, 2026

The approved Option 1 adds a durable project-scoped ledger shared by intake,
Research, Bible A/B/C, Writers, Reader, both Editors and Consistency. Separate
local safeguards remain conservative sub-limits, not separate story allowances.
The combined reservation ceiling is 60,000 tokens and USD 3, recorded as integer
microUSD with server-configured positive rates snapshotted per reservation.

SQL schema and migration work stays on `sql-foundation`. Bible proposal JSON
still uses existing storage; the common budget tables require the separate
reviewed migration. The SQL ledger and migration code merged into `developer` through PR #27. No database migration has been applied.
Existing projects are blocked by that migration because historical spending is
unknown; zero cannot stand in for missing usage. New projects receive an empty
ledger on their first reservation. Historical reconciliation is a separate gate.

The application model wrapper reserves before dispatch, settles confirmed usage,
and retains uncertain reservations. A replay or uncertain failure stops further
calls from that wrapper, including nested runtime retries. A fresh call requires
the existing explicit recovery path and remaining story capacity. Overruns block
the story and retain observed usage alongside the original cap hold.

`WRITE_CONNECTIONS_ENABLED` remains false by default. READ and WRITE opt-ins,
positive verified server rates, credentials and the migrated ledger are required
before a connected story can execute. This implementation does not enable them.
I01 remains unchecked at the user's direction until the completion rule is reinstated; no live model calls, production billing or PostgreSQL concurrency are claimed. I02 additionally needs the complete workflow and Shared 5.2 accepted-export boundary. Synthetic unit evidence
does not establish PostgreSQL concurrency, live billing or production reliability.

Manny owns Bible A/B/C under PRD v4 draft Section 7m and I01. Each role makes
one independent complete proposal from the same server-verified confirmed
intent and accepted Research dossier. A emphasizes plot/mystery, B character/
stakes, and C world/atmosphere. None reads the other candidates or writes canon.

`src/agents/bible-planning.ts` defines prompt `bible-planning-v1`, a strict
role/hash/Bible/conflict output, and the three stateless calls. The existing
Anthropic READ adapter pins `claude-haiku-5-5` with medium effort and serializes
evidence separately from system instructions. Models have no tools or approval
authority. Source claims and quotes remain untrusted data; the code does not
claim universal injection detection or semantic contradiction detection.

`src/server/bible-planning.ts` verifies owned canonical records, dossier and
acceptance identity/hash, current confirmed intake, mandatory provider outcomes,
per-dimension coverage and stored permission expiry. It reuses
`prepareConfirmedResearchInput` for confirmed-intake validation. This checks
stored source-review authority; it does not re-fetch licensed text or establish
new rights approval. Changed source infrastructure outside these records must
still be handled by the Research acceptance infrastructure.

`configuredReadConnections` supplies the existing server opt-in and positive,
finite verified rate configuration (`READ_CONNECTIONS_ENABLED`,
`READ_INPUT_USD_PER_MILLION`, `READ_OUTPUT_USD_PER_MILLION`, server-only
`ANTHROPIC_API_KEY`). No default price is assumed. Missing configuration stops
before dispatch. Synthetic test rates are not deployment prices.

The existing `proposals.data` JSON stores a versioned immutable reservation,
three immutable candidate envelopes, and the authenticated exact acceptance.
No SQL migration is needed. Project-row locking protects reservation, final
candidate insertion and approval; locks are released during model calls and
human review. The operation ID binds the complete input fingerprint. Completed
replay returns saved candidates; duplicate, changed, failed or uncertain work
cannot automatically call again. The owner may explicitly confirm one retry of the latest failed or uncertain
operation after acknowledging possible duplicate Anthropic usage. The original
reservation is preserved and its result cannot overwrite the retry. Each attempt
reserves at most half the configured cap (within 60,000 tokens / USD 3 total),
including on failure; an input that does not fit is rejected before dispatch.
Current confirmed intent, accepted research, source permissions and versions are
rechecked before retry. No retry happens automatically. Each call permits at most 4,096 output
tokens, with a shared three-call concurrency pool, 120-second operation deadline
and zero automatic paid retries. Ignored aborts cannot save late candidates. A
provider call retains its process-local concurrency slot until it actually settles,
even after cancellation or timeout. If all slots remain occupied, a confirmed retry
waits only until its existing deadline and fails closed; no slot is forcibly released.

All candidates must pass before the final transaction saves the set. Missing
evidence, stale state, malformed output, duplicate fact IDs, wrong role/hash or
reported conflict stops planning. These deterministic checks and model conflict
reports support human review; literary consistency is not proven by them.

The existing plan and approval actions send an operation ID and exact proposal
version/hash. The existing layout and controls are preserved. Approval writes
one immutable Bible and acceptance together and marks the alternatives rejected.
Draft/retry/rewrite entry points revalidate the accepted candidate, approved Bible
content and current sources before creating tasks. Justin's agent prompts,
tools, functions, permissions and chapter receiver inputs remain unchanged.
Legacy projects without intake retain their synthetic fixture path.

`tests/bible-planning.test.ts` uses injected models and a transactional in-memory
repository, including synthetic Research creation and acceptance. Cases cover
shared-source independent calls, exact selection, wrong owner, stale/forged
records, malformed/conflicting outputs, budgets, replay, concurrency,
cancellation, timeout and dispatch rejection. This is mock validation only;
live provider, real database, browser and production reliability are untested.
