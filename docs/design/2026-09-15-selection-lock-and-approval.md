# Selection lock and approval — implementation boundary

The new private API in `lib/portable-lock.mjs` implements selection lock v3.
It is not yet connected to the public package CLI or migration. Old v1/v2
readers and `docs/oats-lock.schema.json` retain their existing interpretation.
New-format schema publication and consumer cutover remain integration gates.

## Future selections, not historical authority

A lock has `lockfileVersion: 3`, `artifactSets` and `selections`. Artifact sets
reuse `validateArtifactSet`; their keys hash the canonical complete set.
Selection keys hash the normalized `{source,path}` request through the same
source and canonical-JSON codecs used by captured records. Each non-null
`current` or `available` reference must name an existing set with one matching
root package and its complete dependency closure. Direct local-capability
captures belong in resolutions, not fabricated package selections.

Multiple sets can contain different versions of the same capability. This is
not a multi-version composition within one instance. A captured resolution
embeds its own selected set; reading it never consults this mutable lock.

`current` and `available` are distinct. A failed/offline refresh can preserve
both A and B while recording failure, without claiming either is latest.
`observedAt` is the last successful observation's canonical UTC ISO timestamp,
not an automatically generated timestamp for a failed refresh. No lock field
can grant trust. Preparation must verify actual resources and exact approval
before selecting executable B; writing a syntactically valid lock is neither
that verification nor consent. A pin to B cannot silently fall back to A.

## Explicit scope and compare-and-swap

`readLock3(deployment)` returns `{lock,integrity}`; both are null if absent.
The integrity is a versioned canonical-JSON CAS token, not executable trust.
Malformed, noncanonical, symlinked and unsupported files refuse. Old versions
require their explicit evidence/migration reader; even an empty v1 file is not
silently treated as a fresh v3 deployment.

`writeLock3(deployment, expectedPreviousIntegrity, next)` validates the whole
next snapshot and compares the exact previous token under a cooperative scope
guard. It commits the entire snapshot atomically or reports `selection-changed`;
no implicit row merging or artifact/record deletion occurs. First publication
is no-replace. Identical snapshots may be kept, but a stale expected token still
refuses. Staging is private and ignored before publication.

All new portable-state writers use `portable-state.mjs`. A held/crashed guard
is not auto-reaped; recovery is explicit. This serializes cooperating new
writers, not legacy operations, hostile host processes or power loss. A live
legacy cutover still needs the separately reviewed migration barrier. No such
cutover or live lock write was performed while implementing this module.

`portable-files.mjs` shares the bounded descriptor-backed metadata read with
captured records, preserving their size/identity/content-change checks.

## Verification so far

Four focused tests cover A/B selection and failed-refresh visibility, canonical
keys/root correlation, full-snapshot CAS/legacy/symlink/guard refusal, and two
independent concurrent first writers. Existing captured-record and scaffold-only
spawn/inspect/retire tests cover the shared read-helper extraction. This does not
qualify executable approval, preparation, native dispatch or live migration.

The separate exact-artifact approval ledger is the next implementation step;
it must not inherit old digest approval or accept a captured `approved` flag.
