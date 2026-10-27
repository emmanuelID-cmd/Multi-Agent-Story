# Research dossier storage and human acceptance

Manny Phase 2.2 reuses the existing PostgreSQL `proposals` JSON storage. The
Docker configuration remains PostgreSQL 17 in `compose.yaml`; this change adds
TypeScript payload types, repository queries and services, not a SQL migration.
Implementation verification uses synthetic repository, source and model adapters.

## Candidate and acceptance records

`createResearchCandidate` in `src/server/research/dossier-service.ts` stores output
from the confirmed Research runner. Each `research_dossier` has its own immutable
payload, candidate ID/version/hash, criteria version, owner/project, confirmed
intake identity and reviewed-source fingerprints. Bounded acquisition provenance
preserves the actual provider queries, source decisions/exclusions and gaps;
selected-version detail exposes them. Previous versions are retained.
Full source prose is omitted; findings, bounded quotations, source digests and
review references remain. The producer's `accepted` field stays false.

`acceptResearchCandidate` records a separate `research_acceptance` and changes
the selected row's status in one owned-project transaction. It checks the exact
current candidate, intake, scope and criteria, re-reads required text outside the
transaction, compares source identity/permission/content, and recomputes coverage.
Both provider outcomes must be recorded; empty, unavailable or rate-limited
outcomes stay visible and cannot themselves supply missing support. A provider
that was not requested keeps the gate closed. Metadata cannot replace located
craft or historical evidence. Source review
validity is rechecked at the acceptance boundary. A changed input, newer candidate,
unreadable source, expired permission or unsupported required dimension blocks it.

The operation ID binds a retry to the same candidate/version/hash and intake.
A previously committed matching acceptance returns its recorded result without
repeating source reads. It does not transfer approval to a newer dossier or scope.

## Authenticated application boundary

`GET /api/projects/{projectId}/research` returns owned history summaries.
Add `?candidateId={id}` to inspect one stored version's dossier and source reviews.
`POST` to that route accepts only `candidateId`, `candidateVersion`, `candidateHash`
and `operationId`. Session authentication supplies the owner; same-origin and
bounded JSON checks precede acceptance. Model output and browser JSON cannot
supply source permissions or impersonate the owner.

There is no public candidate-generation endpoint or new Research interface here.
The source approval catalog and permitted text reader remain server integration
dependencies. They are not configured by this change, so fresh production
acceptance remains unavailable until they are connected and reviewed. The HTTP
route does not start a model or enable provider gates.

## Transactions, limits and preserved behavior

Initial source/read waits and lock acquisition honor cancellation and deadlines.
Once transaction work starts, the service waits for its settlement; pre-commit
abort checks roll back unfinished writes. Cancellation after the callback reaches
commit does not claim to undo that commit: its actual result and matching replay
remain authoritative. PostgreSQL transaction-local statement/lock timeouts bound
database work; this is not proof that an unreachable database always settles
within an exact wall-clock deadline.

The technical MVP budget is 50 retained candidates and 100 Research rows per
project, with a 262,144-byte candidate payload. Summary listing and selected-detail
reads avoid returning every full dossier. New writes stop explicitly at capacity;
existing supported history remains readable. Nothing is automatically archived,
deleted or assigned a retention policy. Extending that capacity is later storage
work, not a minimum book count or literary evidence threshold.

Research kinds are excluded from legacy pending-proposal controls. They cannot
lock intake editing or pass bible/manuscript approval routes. Justin's agent
functions, prompts, tools and permissions are unchanged. Human dossier acceptance
records readiness; the existing fixture planner remains blocked and no story
generation starts automatically. Full planning/worker/interface integration is
separate work.
