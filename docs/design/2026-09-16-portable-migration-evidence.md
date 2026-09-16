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

Old v1/v2 lock rows remain literal historical evidence. Their legacy digest and
trust fields are not reinterpreted as owner-execute identity or exact-artifact
approval. A deployment lock also cannot establish which revision an individual
home or job used. Home runtime rows, rendered hook paths, copied skills and launch
metadata can narrow investigation but do not establish the full source,
capability, helper and managed-runtime closure. A legacy or unknown scheduled
attempt is held exactly; it is never rebound to today's definition or lock.

## Required follow-on seams

1. An acyclic strict legacy-lock **byte decoder**, equivalent to the existing
   authoritative v1/v2 semantics, must verify lock rows. The migration module
   must not import `core.mjs` or duplicate that parser.
2. Parent lifecycle integration must provide the authoritative bounded target
   list, including quarantined/deferred homes and independent provider records.
   This module does not infer deployment topology.
3. Reconstructed publication needs a dedicated historical evidence verifier. It
   must establish every managed input, recheck unchanged witnesses, retain exact
   artifacts, require new-format executable approval, and use immutable guarded
   publication. It must not weaken the existing prepared-only
   `commitCapturedResolution` gate.
4. Partial/unknown evidence needs its own immutable evidence store and must never
   enter `.agents/resolutions/` or become dispatch-selectable.

No live migration, lock conversion, timer, provider, instance, or deployment
operation is performed by this slice.
