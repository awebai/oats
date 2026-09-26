# Framework capability payload

The **oats.framework** package: the Git-distributed payload that ships three
independently selected, resource-only capabilities. Package identity and
version live in `oats-package.json`; each capability's identity, version and
floor live in its own `oats.json`. The package root is `oats-package/`, not the
npm root; the kernel npm tarball does not contain it.

| Capability | Resources | Authority |
| --- | --- | --- |
| `oats.core` | `oats-operate`, `oats-souls`, and the capability-owned "You run on OATS" injection | How an agent works inside an instance of the workspace model; no hooks, commands, and not a core capability |
| `oats.setup` | `oats-onboarding`, `oats-package-pins` | How an operator realizes and pins a deployment; no automatic provisioning |
| `oats.knowledge-theory` | `knowledge-capability-authoring` with its complete local references (the package soul `knowledge-theory-expert` uses it) | Optional authoring theory; no mandatory runtime doctrine, harvester or OKF dependency |

## How a workspace selects them

A workspace pins the package once and souls name capabilities by source, never
by version (`docs/workspaces.md`):

```yaml
# oats-workspace.yaml
packages:
  oats.framework: <version>        # a bare version resolves through package-catalog.json
defaults:
  capabilities:
    oats.core: { from: package }   # every soul gets the operating guidance
```

```yaml
# souls/<operator soul>/soul.yaml
capabilities:
  oats.setup: { from: package }    # only souls that set up deployments
```

In the standalone view (a member whose workspace host the operator cannot
read) `oats.core` is the kernel's default, resolved from the catalog through
the operator's own lock. Either way the package is locked and approved per
version like any other; its capabilities add no commands or hooks.

## What the skills teach, and from where

- `oats.core` teaches the instance's two directories, work modes, what was
  materialized into the home, drift, the read-only views, spawning with a
  declared relation, and acting on other instances only when told to. It does
  not tell an instance about its own retirement: retirement reaches an
  instance through its task, its human, or a capability that owns that
  workflow.
- `oats.setup` is procedure. The judgement behind each step is the operator
  knowledge node (`oats/oats-operator-expert`), cited by concept name; the
  contract is the kernel's shipped `docs/` (`workspaces.md`,
  `configuration.md`, `packages.md`), read from the
  installed kernel so it always matches the running version.
- Every `oats` command and flag the core and setup skills show is checked
  against the shipped CLI by `test/operational-skills-cli.test.mjs`.

## Maintainers

`node scripts/check-knowledge-theory-package.mjs` is the manifest/inventory
gate for all three capabilities; `--write` only synchronizes the theory
references from canonical docs. The optional theory curriculum begins at
[the local authoring guide](capabilities/oats-knowledge-theory/skills/knowledge-capability-authoring/references/knowledge-capability-authoring.md).
Git preserves the canonical theory expert's `CLAUDE.md -> AGENTS.md` alias;
acquisition must not synthesize an alias missing from a partial copy.
Publishing a new package version and its catalog entry is release work: never
claim a version that the catalog does not list.
