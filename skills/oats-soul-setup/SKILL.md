---
name: oats-soul-setup
description: >-
  Use when preparing a source-complete portable soul for a fresh deployment,
  selecting a workspace-advertised import, or reasoning about source,
  deployment, work target, team, adoption, and provider-binding inputs. Triggers:
  "oats prepare", "OATS Soul Setup", "import soul by reference", "fresh OATS
  deployment". Do not use legacy oats-config.yaml cascading as portable policy.
---

# OATS Soul Setup

Portable preparation has two policy authorities and one resolver:

1. The soul supplies intrinsic hard requirements and rebindable defaults.
2. The workspace supplies admission, workspace defaults, imports/adoption,
   stores, team references, and catalogs.
3. Explicit operator choices may rebind defaults and bindings but cannot erase
   hard requirements.

There is no repository-default tier and no agent-type precedence in this model.
A package source, soul source, deployment/install location, work target, and team
membership are separate facts. Never derive one from another.

## Implemented preparation

Prepare an explicit source export by reference:

```bash
oats prepare \
  --dir <absolute-deployment> \
  --source <git-repository> --revision <selector> \
  --export <exported-soul-path> --alias <local-alias> \
  [--work directory] --json
```

Prepare an alias advertised by an explicit workspace:

```bash
oats prepare \
  --dir <absolute-deployment> \
  --workspace <git-repository> [--workspace-revision <selector>] \
  --alias <advertised-alias> [--work directory] --json
```

For explicit standalone context, operator/provider bindings or native launch and
helper choices, use the existing complete public request form:

```bash
oats prepare --request /absolute/preparation.json --json
```

Keep deployment/source and explicit workspace OR standaloneContextKey in that
request. Supported inputs also include operator, mode, launch and helperLaunches.
Do not mix request mode with source/context flags or explicit captured selectors;
unknown fields refuse, and inherited context is not preparation authority. Use
only nonsecret declarations and supported credential references, never secrets.

Preparation resolves one source observation, retains the required source and
software trees, resolves provider-owned nonsecret bindings through the same
choice engine, prepares dedicated compatible helpers, and publishes a complete
record before returning a resolution. It does not launch, enroll identities,
create teams, approve executables, or infer a publisher workspace.

## Read the result correctly

- `resolution: null` means no executable captured record was published.
- `needs-configuration` identifies missing bindings/provider inputs; do not fill
  them from current config.
- `approval-required` can accompany a complete retained record; approval remains
  a separate explicit action.
- `responsibleHuman: null` means messaging is explicitly disabled.
- Helper-authored software, knowledge, team, or resource policy currently
  requires dedicated preparation and refuses instead of inheriting the parent.

## Exact approval, scaffold and supported start

If binding code needs approval before a complete record exists, use the returned
artifact-set/capability IDs, then repeat the same preparation request. A complete
record can be inspected/approved and used by the existing captured routes:

```bash
oats trust <capability> --deployment <D> --artifact-set <returned-id> --json
oats inspect --deployment <D> --resolution <R> --composition --json
oats trust <capability> --deployment <D> --resolution <R> --json
oats spawn <subject> --deployment <D> --resolution <R> --home <new-H> --no-launch --json
oats session start --deployment <D> --resolution <R> --home <H> --request /absolute/native.json --json
```

These are alternatives/stages, not permission to approve automatically. A native
request supplies the explicit backend/task/optional stopGraceMs, not a new model.
Required spawn hooks still run with --no-launch; preserve incomplete receipts.
Keep the complete resolved home/resources and native auth/permissions; bypass
requires explicit user opt-in. Dispatch acceptance is not model or provider health.

## Current limits

Do not invent flags or derive a standalone key from a path, username, source alias
or machine identity. Workspace and standalone context are mutually exclusive.
Captured directory scaffolding and bounded start/restart are supported; captured
input/wake/public retirement, non-directory placement and unqualified runtime
contributions remain held. Do not drop requirements or use legacy dispatch as a
fallback. This renamed procedure introduces no new inspection/init/adopt command.
Old retained records keep their original skill names and bytes; do not rewrite
those resources or compare their names with today's skill inventory.
