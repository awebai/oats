---
type: Area Guide
title: The oats implementation
description: The reference implementation — universal CLI/kernel, targetable capability packages, exact instance-local pi/Claude composition, and locked/trusted executable surfaces.
tags: [implementation, cli, capabilities, integrations, security]
timestamp: 2026-07-14
---

The reference implementation ships two npm packages:

- **`@awebai/oats`**: runtime-neutral kernel (`lib/core.mjs`), universal
  `oats` CLI (`bin/oats.mjs`), bootstrap skills/instructions, and bundled
  capability packages.
- **`@awebai/oats-pi`**: runtime pi bridge for memory session events,
  pi-facing instance resource exposure, and the pre-workspace
  `oats-getting-started` bootstrap. It registers no operational tools and does
  not own skill resolution.

# Repository layout

```text
lib/core.mjs       souls/instances, config targets, package discovery,
                   composition, lock/trust, hooks, lifecycle
bin/oats.mjs        roster + config + package management + gated package commands
capabilities/      bundled packages (oats-okf/aweb/jira/linear/authoring)
skills/            kernel/bootstrap and authoring skills
injects/           kernel and work-mode instruction sources
packages/pi/       minimal pi adapter
test/              capability resolver/composition/security tests
```

Capability discovery uses bundled `capabilities/` plus each config scope's
`.agents/capabilities/`, split into `installed/` (acquired, locked, gitignored,
restorable via bare `oats install`) and `owned/` (authored at the scope,
committed, config-owned trusted). Within a scope `owned/` overrides
`installed/`; inner scopes override outer; all override bundled.

# Capability resolution

The kernel discovers namespaced manifests, resolves explicit global/group/soul
bindings for one soul, composes settings by specificity and config closeness,
and errors on ambiguous equal-specificity settings/enabled values. It enforces
unique IDs, command namespaces, skill names, and one integration per
fundamental layer. `layers.<layer>: none` suppresses an inherited slot; package
activation is exclusively config-owned through `capabilities`.

External packages require `oats-lock.json` source/version-or-commit/integrity.
Executable commands/hooks remain disabled until `oats trust` approves that
exact integrity. The lock records acquisition provenance; artifact and lock
are co-located at one scope, so bare `oats install` restores any
locked-but-missing artifact with integrity verification, and a committed
lock's trust survives restore on integrity match. `oats init --template
<name|path|git-url>` seeds a config as a provenance-stamped snapshot of a
local file or a git repo's default-branch `oats-config.yaml`; named templates
resolve through outer-scope `templates:` maps. Config may override a
capability's instruction injection per scope
(`capabilities.<id>.agents-md-injection: <path>|none|default`).

# Exact instance runtime

Spawn generates an instance regular `AGENTS.md` from canonical soul content
plus selected source-marked blocks, leaving the soul byte-identical. It
copies only kernel + soul + active package skill trees into real directories
under `.agents/skills`, records sources/settings/trust in `instance.json`, and keeps
`CLAUDE.md`/Claude skill compatibility symlinks canonical. Skill resolution is
fully owned by this spawn-time materialization, not by runtime adapter
discovery.

The accepted [strict instance curriculum](/decisions/strict-instance-curriculum.md)
requires every runtime adapter to disable ambient skill/instruction discovery
and expose only this instance-local composition while preserving the runtime's
built-in tools and native workflows. Pi and Claude Code must enforce the same
visible curriculum with supported runtime mechanisms; incomplete isolation
fails closed and doctor reports it. `instance.json` records the complete
selected skill/injection surface. `oats-getting-started` is the only
pre-workspace ambient bootstrap.

Current released main still enables harness-ambient coexistence from the
superseded 2026-07-14 adoption trade; strict adapter enforcement is an accepted
implementation change and the README must not describe it as shipped until its
runtime parity gates pass.

# Lifecycle and commands

Only `soul-scaffold`, `spawn`, and `retire` package hooks are accepted.
Scaffold/spawn order is outer config scope then capability ID; retire reverses
it. Scaffold files receive ownership metadata and cannot overwrite canonical
or another package's artifacts.

Operational `oats <namespace> <command>` dispatch verifies the package is
active in current instance/context and its executable surface is trusted.
Package management (`install`, `trust`, `use`, `doctor`) stays globally
available. Doctor can render the final composed instructions for a named soul.

# Releases

Tag-driven CI gives both packages one version and publishes them together. It
tests capability behavior and syntax-checks shipped `.mjs` files. The releases
must stay synchronized because exact pi isolation spans kernel launch flags and
adapter discovery.

Before release, run framework tests/checks, strict OKF validation, package dry
run, a scaffold spawn/retire probe, and a real pi session from packed
artifacts.
