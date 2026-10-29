# Phase 3 READ connection harness

October 28, 2026. Test type: synthetic model/repository fixtures and mocked transaction adapter. PRD v4 draft, `read-v1` prompt/contract, `read-connections-v1` harness, version-1 application envelopes. Synthetic model ID: `fixture-read-connections`. No live provider/model calls, SQL migrations, browser checks or automatic trace rounds were run.

## Expected behavior and coverage

| Concern | Required observable behavior | Evidence |
| --- | --- | --- |
| Exact sources and ownership | Wrong owner/project/run denied before dispatch; three unique ordered chapter rows required | `read-connections.test.ts` |
| Independent versions | Bible2/draft5 accepted with explicit stored relationship; wrong Bible and changed source rejected | Connection tests and actual receiving validator |
| Draft revision provenance | Authenticated assignment is explicit; same revision cannot be rebound to changed source, old assignment becomes stale | Forged/stale revision test |
| Authority and injection | Empty request remains empty; later changes rejected; manuscript JSON and Unicode remain data | Request and injection-as-data tests |
| Durable repair | Initial attempt plus at most one repair; A/B receiving identity retained; new operation IDs, restart and concurrent duplicates cannot reset it | Durable receiving tests; runtime retry disabled |
| Exact Consistency | Separate A/B inputs; full WRITE digest and READ source digest differ; metadata/Bible/base changes block late success | Exact-proposal tests |
| Cancellation and dependency failure | Canceled work cannot complete; unavailable model has no successful required check; no-handoff timeout/model failure produces no rejection/repair | Connection tests plus existing READ runtime regressions |
| Request boundary | Session owner only; origin before body/work; bounded JSON; owner/model/budget/source overrides rejected | `read-connection-route.test.ts` |
| Transaction boundary | Source locks acquired before callback/save; ownership failure exposes no source | `read-connection-storage.test.ts` |
| WRITE preservation | Existing runtime, Editor, proposal, revision and reliability behavior remains | Affected WRITE regression files |
| Actual workflow consumer | Both actual Editor wrappers receive Reader evidence; rejection uses one durable repair; round-two inputs stay distinct | `read-revision-workflow.test.ts` |
| Durable Editor effects | Concurrent dispatch is reserved once; the first output survives second-Editor failure and restart without another model call | Workflow integration tests |
| Atomic report gates | Both pending transitions and real human acceptance reject stale, mismatched, missing and unavailable evidence | Workflow integration and actual approval function tests |
| UUID compatibility | Stable connected proposal IDs pass the existing actual approval HTTP UUID schema | `read-revision-approval-route.test.ts` |
| Scheduling and queue intent | Missing explicit request pauses; concurrent resume dispatches once; thrown/unconfirmed queue effects remain unknown and blocked | `read-revision-resume.test.ts` |
| Target-ledger authority | Exact owned target and saved source pointers are validated under locks; invented or failed targets cannot partition spending | Workflow and storage contract tests |
| Shared READ allowance | Reader and Consistency share the target's READ budget; timeout/transport uncertainty retains full reservation | Workflow budget tests |

## Coordination and recovery contract

The owner/project/run transaction adapter serializes protected operation intent and final result updates. Models run outside transactions, followed by exact revalidation. Production adapter takes project/run UPDATE, Bible/chapter SHARE and ordered proposal UPDATE locks with five-second limits. Synthetic repository tests serialize work and preserve records across a fresh service instance. Storage tests verify the source-lock contract with a mocked transaction builder; they are not a live database race test.

Operation IDs are stable and bound to request/source/config intent. Request IDs cannot reset an already-bound run/source/round; real proposal row identity is independent of caller revision labels. Target IDs are resolved under the repository transaction and cross-run targets must match the server-saved source run/proposal pointers and editorial intent. A targeted bypass test changes proposalVersion, draftVersion and request ID and confirms no second model call. The first authenticated proposal revision label is immutable, without a verified-producer-version claim. An alternate operation ID cannot reset a request. Typed validation receipts do not prove Editor ownership; separate actual runtime acceptance reserves dispatch, and full output is persisted atomically before output_produced is recorded. Crashed unknown effects stay reserved; confirmed saved outputs are reusable without redispatch.

Reader has zero nested content retries; durable repair has at most two generations and deducts prior usage. Consistency has at most two model attempts. Existing runtime bounds are three concurrent model calls and 120 seconds per operation. A durable validated-target ledger shares at most 60,000 tokens/USD 3 across READ operations; confirmed usage settles reservations, while uncertain dispatched failures retain their full allowance and require human reconciliation. This accounts only for READ, not total Writer/Editor/READ costs. Capacity is 200 relevant READ rows/project, with separately bounded resume history. Budgets are server-owned and positive pricing must be configured before live enablement.

The production consumer requires an explicit authenticated target-bound request; empty saved defaults are insufficient. It pauses if the request has not arrived. An authenticated resume action protects queue intent and requires manual reconciliation on unknown/unconfirmed outcomes. API scheduling is exercised synthetically; no dedicated request/resume UI was added. Production worker Editors remain fixtures, labeled by modelUsed and synthetic/unverified producer origin. Live-WRITE readiness is not claimed.

## Events and evidence protection

Existing READ runtime trace callbacks can expose run/task/operation/agent IDs, timestamps, event ordering, versions, attempt, duration and reason codes. This service installs no collector and opens no viewers. It stores structured outcomes, source references/hashes and necessary located findings in the owned project's existing JSONB; it does not store credentials or private model reasoning. HTTP failures expose bounded reason/route codes, and generic failures omit story text. Live streamed observability, production retention and expired-operation recovery are not implemented by this phase.

## Results and review handoff

- Full unit suite before the final target-ledger security remediation: 435/435 passed across 46 files. This is not a post-remediation full-suite claim.
- Latest post-remediation affected READ/WRITE checks: 135/135 passed across 10 files, including the failed standalone-target restriction.
- Overlapping test runs are not summed into a fabricated total.
- TypeScript: `npm.cmd run typecheck` passed with exit code 0.
- Live PostgreSQL contention, provider readiness, pricing calibration and deployed behavior: NOT TESTED.
- Opt-in worker/Editor/gate integration is tested synthetically. No dedicated READ request/resume UI or live Writer/Editor provenance claim.
- SECURITY/REVIEWER verdict and canonical M04/M05/M06 completion: pending independent review.

Checks use Vitest on the existing Windows/Node stack. PowerShell blocks `npm.ps1`, so commands use `npm.cmd`; no execution-policy change is needed. Historical trace artifacts and untracked `docs/temp` content are preserved. No SQL migration or new dependency is required.
