# Package preparation integration

The source/data/discovery foundation is on main. This next increment reuses the
existing package engine instead of implementing an unrelated portable installer.
Public preparation/dispatch/migration is not complete at this checkpoint.

## Shared materialization

`lib/package-materialization.mjs:createCapabilityMaterializer` is now the single
materializer called by existing acquisition and exact restore. The kernel supplies
its existing runtime-dependency, declared-resource containment, dependency-link
containment and native-binary checks. The module has no core import, source resolver,
current lock lookup, approval decision or activation side effect.

The order remains: production dependency materialization with no lifecycle scripts;
complete containment/native checks; projection into staging; deterministic v1
installation provenance; integrity. Published flat capability roots still copy
rather than move so later template reads keep their source. Dedicated roots move
as before. Links and actual modes are retained.

`.oats-installation.json` remains exactly the same ordered two-space JSON, final LF
and mode0644. It records the supplied true source/commit/package path, never a writer
kernel version or a fabricated temporary local source. The legacy integrity result
remains literal compatibility evidence; new preparation calculates the explicit
new-format digest over the same resulting tree. No approval transfers between formats.

Materialization also rejects aliased capability roots and source-controlled links,
directories, executable entries or case aliases at the reserved provenance path BEFORE
dependency work. Generated provenance replaces its own entry atomically; it never writes
through an authored link or shared inode. Valid v1 bytes remain unchanged. A temporary
fixture reproduced an inherited acquisition overwrite through a provenance symlink
before this correction, then verified refusal and preservation of the unrelated target.

Whole-closure platform-invariance preflight remains the caller's responsibility and
must occur BEFORE any sibling npm materialization. The reusable callback factory does
not replace that transaction-level requirement or the full manifest codec.

One focused test pins exact provenance bytes, modes, links and absence of selection/
approval writes. Existing acquisition, integrity-drift, restore and no-install-script
regressions plus the scaffold-only dependency probe exercise the core adapter.

## Shared staged closure

`lib/package-closure.mjs:resolvePackageClosure` now owns the one bounded dependency
walk, identity/source-key collision checks, cycle detection and dependency-first
ordering. Existing acquisition delegates to it through its existing source, manifest,
compatibility and literal legacy-digest adapters. Source adapters must provide explicit
owned staging and cleanup; repeated edges cannot discard a reused authoritative root.

The default limits are 256 unique package identities, 64 dependency levels and 1024
source requests. These are resource guards, not another version solver. The engine
never installs, activates, writes a lock, grants approval or calls a catalog on its own.
Two focused graph tests and existing acquisition/closure/restore/incremental/platform
preflight regressions verify the extraction. The legacy source parser remains explicit
in the old adapter while the new preparation adapter uses the shared portable grammar.

Package dependencies in new preparation use `source-spec.mjs:parsePackageDependency3`:
pinned Git shorthand/raw transports share the portable parser, catalog convenience is
explicitly dependency-only, and local dependencies need an explicit base/authorization.
No catalog nickname becomes an intrinsic soul source and no remote dependency inherits
cwd or HOME. The legacy adapter retains its literal older parser until cutover.

## Portable package adapter

`lib/portable-package-preparation.mjs:preparePackageArtifacts` connects the shared
walker/materializer to frozen repository observations. It verifies required exports,
uses one staged source per normalized package request, binds repo: dependencies to
their declaring snapshot, applies whole-closure platform checks before materialization,
and retains new-format artifacts with their real source/commit/path provenance.
Raw package/capability JSON passes the strict codec before the existing full validators.

Local inputs require explicit authorization and a clean selected package subtree;
known deployment/auth/instance roots refuse rather than being copied. Git metadata
is not copied. Remote package dependencies cannot borrow adopter-local paths merely
because another root request was local. Owned staging cleanup uses the shared safe
read-only-directory cleanup, never changes original sources or retained artifacts.

The result contains the acquired artifact set and root package IDs plus owned cleanup.
It writes neither current selection locks nor approvals and activates nothing. Complete
composition must still select active capabilities, classify/resolve provider bindings,
retain source/runtime resources, commit the full record and perform selection CAS.
Three focused tests cover original local provenance/source deletion, real Git A plus
repo dependencies after upstream B, and export/private-state refusal before publication.

## Following integration

Complete the composition transaction and public consumers using this adapter. Portable
preparation must resolve each selector once, retain exact artifacts and records, and
update only its mutable selection snapshot. Existing old-format readers
remain literal evidence/migration paths, not ambient fallback for captured dispatch.
