# Portable migration evidence reader and planner

16 September 2026. This is the first read-only implementation slice of the
Portable Souls consumer migration. The retention contract and the fifteen
binding decisions in `2026-09-15-portable-souls-handoff.md` remain authoritative.

## Boundary

`lib/portable-migration-evidence.mjs` inventories an explicitly supplied bounded
set of deployment-local inputs:

- legacy/current lock files;
- instance homes (`instance.json` plus an optional rollback-incomplete cleanup
  descriptor); and
- schedule scopes (`oats-schedules.json` plus schedule state).

The caller supplies the target list. The reader does not recursively discover a
workspace, infer an owner from an alias, consult current config, fetch source,
execute a provider, inspect a live process, or write any file. Targets must be
contained by one explicit canonical deployment and may not traverse symlinked
parents. Metadata is read through the shared descriptor-backed bounded reader.
Every present document is identified by `oats.bytes.v1` over its literal bytes,
including historical whitespace and old field spelling.

The inventory deliberately emits a bounded summary rather than copying arbitrary
legacy settings, commands, task text, credentials, or hook output into a new
record. A valid-shaped `executionBinding` or scheduled execution capsule is
preserved as a candidate reference, but shape validation is not retained-input,
approval, host, provider, or lifecycle verification.

`verifyPortableMigrationInventory` repeats the same bounded reads and compares the
complete deterministic projection. Byte drift, disappearance, appearance, or a
changed summary returns `selection-changed`. This is a precondition for a future
apply operation, not an apply operation itself.

## Honest planning

`lib/portable-migration.mjs` is pure. `planPortableMigration(inventory)` emits only:

- `preserve`: retain an existing captured job authority while verifying it;
- `verify`: verify an existing captured reference and all separate readiness
  gates; or
- `hold`: preserve literal evidence because reconstruction is not established.

Every target remains `partial` or `unknown`. This planner cannot emit
`reconstructed`, sets `readyToApply:false`, and declares that it performs no
writes, provider execution, session or schedule changes, or trust transfer.

## Separate unselectable evidence store

`lib/portable-migration-store.mjs` validates `ResolutionEvidence1` and publishes
planned partial/unknown evidence under:

```text
<deployment>/.agents/resolution-evidence/<oats.json.v1 id>.json
```

The store is distinct from `.agents/resolutions/`; partial/unknown documents must
carry `resolution:null`. `listResolutionEvidence` provides bounded deterministic
diagnostics, treats an absent store as empty, ignores only managed metadata/staging,
and verifies every returned content address; corruption or unexpected entries fail
closed. `commitPlannedResolutionEvidence` re-reads and compares
the complete inventory before it creates the evidence store, recomputes the
planner output rather than trusting caller-supplied status, and publishes canonical
private bytes by atomic no-replace hard link. Matching existing bytes are reused;
damaged existing evidence refuses without repair. Publication changes no source
lock, home, schedule, session or approval state.

`commitHistoricalHomeCapabilityEvidence` can publish the narrow verified
home-to-v2-artifact association as `partial`. It persists capability/package IDs,
paths and old/new digests, but deliberately omits unclassified legacy source,
settings and command text; the original byte-addressed documents remain the
witnesses. It still grants no selection, approval or retention authority.

The validator can read a future `reconstructed` evidence document only when it has
no unresolved inputs and names a shaped resolution reference. This slice exposes
no writer for that state. A later dedicated historical verifier must establish and
publish the complete reconstructed record before it can publish that evidence.

Old v1/v2 lock rows remain literal historical evidence. Their legacy digest and
trust fields are not reinterpreted as owner-execute identity or exact-artifact
approval. `lib/legacy-lock-codec.mjs` is the acyclic bytes-in structural decoder
for both historical formats. It preserves the existing v1 entry, retired-entry,
v2 row/graph/back-reference, state-free empty-v2 and transitional-v2 semantics,
while routing ingress through the common bounded strict JSON decoder. Duplicate
decoded keys, malformed UTF-8 and oversized inputs therefore refuse before any
row is exposed. Retired capability policy is an injected pure callback; the
codec imports no core/config/filesystem module.

The migration inventory accepts this codec as `legacyLockDecoder`. Successful
structural verification removes only that unresolved item from the plan.
`verifyHistoricalLockCandidate` then rechecks the complete inventory, rereads the
chosen explicit target and returns the strictly decoded v1/v2 rows with their
literal witness and `trustAuthority:"none"`. It does not retain artifacts or
associate the lock with a home/job. A deployment lock still cannot establish which
revision an individual home or job used. Home runtime rows, rendered hook paths,
copied skills and launch metadata can narrow investigation but do not establish
the full source, capability, helper and managed-runtime closure. A legacy or
unknown scheduled attempt is held exactly; it is never rebound to today's
definition or lock.

`lib/portable-migration-artifacts.mjs` adds one narrower read-only proof for an
explicit materialized-v2 candidate. It requires the strict lock witness, verifies
the existing legacy artifact digest and exact `.oats-installation.json` provenance,
then measures the new owner-exec digest twice with the legacy digest bracketing it.
The result labels modes `observed-at-migration`, trust/selection authority `none`,
and retention `not-retained`. It does not support v1 without that format's separate
historical digest verifier and does not publish the candidate.
`verifyHistoricalHomeCapabilityCandidate` can additionally prove that one unchanged
home's `capabilityRuntime` names exactly one capability with the same old digest.
That is a narrow per-capability association only: the result remains `partial`,
retains the legacy trusted bit only as a claim, and leaves source revision, full
resources/helpers/runtime closure and new-format approval unresolved.

## Required follow-on seams

1. The acyclic strict legacy-lock byte decoder is implemented. Parent integration
   must replace `core.parseLockFileStrict`'s duplicate body with a tiny file-read
   wrapper around it and expose the bound bytes seam with the kernel's retired-ID
   callback. Until that integration lands, core remains the live parser and the
   migration inventory requires explicit decoder injection.
2. Parent lifecycle integration must provide the authoritative bounded target
   list, including quarantined/deferred homes and independent provider records.
   This module does not infer deployment topology.
3. Reconstructed publication needs a dedicated historical evidence verifier. It
   must establish every managed input, recheck unchanged witnesses, retain exact
   artifacts, require new-format executable approval, and use immutable guarded
   publication. It must not weaken the existing prepared-only
   `commitCapturedResolution` gate.
4. Partial/unknown evidence now has its own immutable evidence store and never
   enters `.agents/resolutions/` or becomes dispatch-selectable. A later lifecycle
   adapter may index these references without changing that authority boundary.

No live migration, lock conversion, timer, provider, instance, or deployment
operation is performed by this slice.
