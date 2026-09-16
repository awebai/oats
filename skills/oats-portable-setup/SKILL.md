---
name: oats-portable-setup
description: >-
  Use when preparing a source-complete portable soul for a fresh deployment,
  selecting a workspace-advertised import, or reasoning about source,
  deployment, work target, team, adoption, and provider-binding inputs. Triggers:
  "oats prepare", "portable setup", "import soul by reference", "fresh OATS
  deployment". Do not use legacy oats-config.yaml cascading as portable policy.
---

# Preparing portable souls

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

## Not yet a public input

An explicit standalone context key, onboarding inspection facade, non-directory
work-target placement/setup, and managed launch/runtime capture are still being
integrated. Do not invent flags or derive a standalone key from a path, username,
source alias, or machine identity. A workspace context and standalone context are
mutually exclusive.
