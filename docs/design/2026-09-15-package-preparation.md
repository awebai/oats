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

Whole-closure platform-invariance preflight remains the caller's responsibility and
must occur BEFORE any sibling npm materialization. The reusable callback factory does
not replace that transaction-level requirement or the full manifest codec.

One focused test pins exact provenance bytes, modes, links and absence of selection/
approval writes. Existing acquisition, integrity-drift, restore and no-install-script
regressions plus the scaffold-only dependency probe exercise the core adapter.

## Following integration

Extract the staged package dependency closure into one shared engine with explicit
source/manifest/materialization adapters. Portable preparation must consume already
observed repository snapshots, resolve each selector once, retain exact artifacts and
records, and update only its mutable selection snapshot. Existing old-format readers
remain literal evidence/migration paths, not ambient fallback for captured dispatch.
