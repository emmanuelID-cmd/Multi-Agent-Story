# Confirmed Research acquisition

Manny's Phase 2.1 implementation connects the confirmed-intake boundary to
provider metadata and a trusted, reviewed-source reader. Verification uses
synthetic providers, source records and model responses. It is not a live
provider run, a trace audit or configured production full-text retrieval.

## Execution boundary

`runAcquiredConfirmedResearch` in `src/server/research/research-acquisition.ts`
uses `runConfirmedResearch` to load the owned, confirmed intake, acquire its
evidence, run Research and recheck the same intake before returning a candidate.
The full saved original and confirmed dimensions remain available; caller-supplied
`eligibleSources` do not constitute permission and are discarded at the confirmed
entry point.

`acquireResearchEvidence` records both provider outcomes and reuses those results
in Research rather than issuing a second metadata query. Provider discovery uses
the confirmed genre. Trusted approval records bind a source to exact confirmed
dimension values; a genre match cannot authorize a historical-setting claim.
Source-to-dimension bindings are enforced when Research validates evidence items.

## Source permission and access

Source approvals and the text reader are trusted server configuration, never
model output, browser input or an automatically followed metadata URL. An approval
contains work/author identity, locator, expected digest, permission basis and
review references, jurisdiction, review validity and confirmed-dimension matches.
US public-domain reviews and suitable project/owner-bound user licenses are
distinct from catalog copyright flags. Historical evidence remains separate from
craft observations regardless of its permission basis.

The injected reader must implement the separately permitted access method and
honor bounded reads and cancellation. Its approval reference is an upstream review
claim, not independent legal verification performed by this service. There is no
production source approval registry or full-text resolver configured here.
Missing infrastructure produces unavailable sources and coverage gaps.

## Failure and context controls

Metadata adapters use fixed provider endpoints, redirect rejection, bounded
response bodies and cancellation. Unsafe metadata fields are excluded before
model context; unreviewed text-candidate URLs are not model evidence. NYT list
dates remain distinct from unknown book-publication dates; Gutendex author-year
filters cannot establish a work's publication date or story setting.

Invalid, expired, mismatched, inaccessible or changed sources have explicit
outcomes. Located evidence must match the permitted source, passage and dimension.
The confirmed execution has a shared deadline covering acquisition and model
work; late or stale input cannot produce a current successful candidate.

Research returns an unaccepted candidate. Dossier persistence and authenticated
exact-version human acceptance belong to Phase 2.2. Neither this service nor
provider availability starts planning or grants an agent approval authority.
