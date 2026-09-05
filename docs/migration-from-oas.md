# Migrating from OAS to OATS

OATS is the successor to OAS. **OATS 0.22.0 was published on 2026-09-03**:
the kernel, Pi adapter, and Desktop assets are available. The published
kernel acquired the official OKF, aweb, authoring, and development packages
from its catalog during the 2026-09-05 qualification. You no longer need a
framework checkout to migrate.

Use the migration command rather than renaming files by hand. The OATS
kernel does not read `oas-*` configuration names or `oas.*` capability IDs.
An unchanged agent-directory layout can make an old scope look familiar
while its knowledge and messaging configuration remains unmigrated.

## Upgrade one scope

Finish or preserve active work before changing a daily-use deployment.
Install OATS alongside the old CLI, then inspect the plan for the exact
scope you intend to convert:

```bash
npm install -g @awebai/oats@latest
pi install npm:@awebai/oats-pi@latest
oats migrate --from-oas --dry-run --dir /path/to/scope
```

Read any held or unmapped package rows before applying. A dry run reports
what can be converted; it is not a guarantee that every historical package
version has a supported replacement. When the plan is correct:

```bash
oats migrate --from-oas --dir /path/to/scope
oats doctor /path/to/scope
```

Run the exact `oats trust <capability> --dir <scope>` commands printed by
migration for the executable capabilities you approve. Trust does not
transfer automatically. Verify the team ID and messaging membership with
`oats aweb setup --dir /path/to/scope`, then exercise a real task, harvest,
and retirement as described in [Run your first team](first-team.md).

For a multi-repository deployment, start with one scope. The explicit
`--recursive --dir /path/to/workspace` form converts every discovered OAS
scope, with a separate transaction for each; it is not one transaction for
the whole workspace.

If you use Desktop, install [OATS Desktop](desktop.md) too. The old OAS
Desktop discovers the old package name and cannot operate the new CLI.
OATS Desktop 0.22.0 accepts kernel versions `>=0.22.0 <0.23.0`.

## What the command converts

One transaction covers two phases within a scope:

1. Rename `oas-config.yaml` and `oas-lock.json` to their `oats-` names;
   convert the `oas:` defaults key and catalog-mapped capability IDs;
   rename installed `oas.json` manifests and soul scaffold-owner files.
2. Convert the old lock to official package lockfile version 2, acquiring
   the replacement artifacts and removing superseded installed directories.

The catalog includes aliases for the seven OAS 0.20 capability IDs, mapping
`oas.*` names to the corresponding `oats.*` packages and capabilities.
Aliases guide migration; they are not runtime compatibility shims.
Comments and unrelated configuration text are preserved, including old
names in comments. Those comments can be updated separately.

A failure in either phase restores that scope's original OAS bytes. A
second successful run finds nothing to convert. `oats doctor` and migration
commands identify visible OAS-named scopes and give a remedy rather than
silently declaring an unmigrated deployment ready.

## Compatibility and remaining transition work

The migration fixtures were built from an OAS 0.20.x deployment. OAS
0.21.x uses the same file names and configuration keys, but may lock package
versions outside the OATS catalog's mapped line. Inspect the dry run before
converting those scopes; do not replace an unmapped version by guessing.

The old `@oas-framework/*` packages have not been deprecated as part of
this rollout. Their update checks therefore do not announce the OATS
rename; deprecation belongs to their maintainer. An existing OAS deployment
can keep running until its own migration plan is ready. This is no longer a
requirement to wait for OATS publication.

See the [0.22.0 release notes](release-notes/v0.22.0.md) for the rename,
package versions, and compatibility changes, and the
[first-team qualification](first-team-demo.md) for current operating evidence.
