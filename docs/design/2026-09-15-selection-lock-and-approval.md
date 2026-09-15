# Selection lock and approval — implementation boundary

The new private API in `lib/portable-lock.mjs` implements selection lock v3.
It is not yet connected to the public package CLI or migration. Old v1/v2
readers and `docs/oats-lock.schema.json` retain their existing interpretation.
The new structural schema is `docs/oats-lock-v3.schema.json`; changing the old
public CLI/schema to admit it remains an explicit consumer-cutover gate.

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

## Separate exact-artifact approval

`lib/artifact-approvals.mjs` owns `.agents/portable/approvals.json`. Its closed
version-1 ledger is keyed by capability ID, then integrity format and full digest.
Every entry must agree with its keys and carry explicit operator provenance.
Legacy digests, source/provider declarations and captured approval flags cannot
supply this new authority. Missing ledger means no approvals; malformed existing
metadata refuses, never repairs itself from a selection lock.

`approveCapturedCapability(deployment, resolution, id, operatorOrigin)` is the
explicit approval writer. It verifies the retained record, selected artifact and
provenance, then preserves previous approvals under the same scope write guard.
There is no bulk caller-supplied ledger overwrite or approval during discovery.
Approving B neither revokes nor rewrites A. Repeating A keeps its original receipt.

`inspectCapturedApprovals` verifies retained inputs and reads current local
approval authority without consulting current selections/configuration. It returns
per-capability facts, not a dispatch permit. Helpers have dedicated record checks.
The existing command/hook/environment classifier was extracted byte-identically
from core into `capability-execution.mjs`; both callers use it. An environment-only
artifact needs approval, and owner-execute changes require a new exact approval.
Declarative-only changes have no executable gate; they remain visible as changed
artifact identities. No approval for an unrelated managed harness resource follows
from a capability's approval.

All mutable publication uses an active synchronous scope-write context; saved or
fabricated contexts cannot publish after the guard is released. This is an internal
coordination safeguard, not a hostile-host permission system. Full manifest/launch
validation, action-specific trust checks, explicit CLI consent and runtime/provider
qualification still belong to the forthcoming preparation/dispatch integration.

## Shared structural schemas

`docs/portable.schema.json` owns the shared value definitions. The thin
`captured-resolution.schema.json`, `oats-lock-v3.schema.json` and
`artifact-approvals.schema.json` reference them without copying their types.
Generate with `node scripts/portable-schemas.mjs --write`; invocation without
`--write` checks drift. All four schemas compile offline. Existing current-format
schemas are unchanged; publishing these new wire schemas does not activate them
in the old installer or CLI.

Schema acceptance is structural, not a replacement for strict bounded decoding,
canonical source parsing, choice replay, cross-reference/digest equality, graph
closure, source/provenance verification or provider non-secret classification.
The existing launch/manifest codecs still own their complete contracts. Real
captured-record, lock and approval fixtures are checked against these schemas;
a separate test checks deterministic generation and authority/credential boundaries.

## Verification so far

Four focused tests cover A/B selection and failed-refresh visibility, canonical
keys/root correlation, full-snapshot CAS/legacy/symlink/guard refusal, and two
independent concurrent first writers. Existing captured-record and scaffold-only
spawn/inspect/retire tests cover the shared read-helper extraction. Two focused
captured-approval tests cover source-deleted A/B coexistence, poisoned current trust,
key/format refusal, environment-only gating, owner-execute changes and declarative
no-op. Two existing package-engine trust/environment regressions cover the classifier
extraction. These qualify the tested storage/approval boundaries, not public CLI
consent, complete preparation, native dispatch or live migration.
