---
name: oats-config
description: >-
  How to configure OATS deployments with oats-config.yaml and the oats CLI.
  Use for capability activation, fundamental-layer integrations, agent
  types, targeting souls, binding settings, injection overrides, config
  scopes, or adopting a package config template. Triggers: "bind a layer",
  "target these souls", "agent type", "override an injection", "oats use",
  "oats init", "configure OATS", "oats-config.yaml", "adopt a config template".
  Package acquisition/update/remove, locks, restore, and trust mechanics
  belong to the oats-packages skill.
---

# Configuring OATS

Config lives in `oats-config.yaml` at laptop (`~`), workspace, and repository
levels; resolution walks from a soul's repository outward, closest scope wins.
Prefer the CLI for config edits (`oats init`, `oats use`, `oats type`,
`oats inject eject`, `oats create --type`); hand-editing is valid but the CLI
writes the canonical shape.

## Shape

```yaml
team:                          # deployment boundary (typically workspace scope)
  name: lfx-engineering
  # id: lfx-engineering:example.com   # provider team id (aweb <name>:<namespace>)
agent-types:
  developers:
    description: Agents that build the service
capabilities:
  layers:                      # exclusive fundamental slots
    knowledge:
      capability: oats.okf
      from: installed            # enforced provenance: installed|owned|path:<dir>
      # injection-override: .agents/injections/capabilities/oats.okf.md
    messaging: none            # explicit none suppresses inherited integrations
    tasks: none
  additive:                    # non-exclusive packages
    vendor.review:
      from: installed
      agent-types:
        developers:
          enabled: true
          settings: {depth: normal}
      souls:
        api-expert:
          enabled: true
          settings: {depth: exhaustive}
```

`global` means every soul governed by the declaring level. Bindings can also
target **agent types** (families — declared in config via `oats type add`,
joined via `type: <name>` in each soul.yaml) and individual souls. Matching
global + agent-type + soul bindings compose. Settings precedence is
soul > agent-type > global, then closer config. Equal-specificity conflicts
error. `false`/`enabled: false` is an explicit exclusion and follows the same
precedence. V1 does not target instances or use tags/selectors.

The closest `team:` declaration marks the deployment boundary: all repos
under it share one team (identity + `oats status --team` discovery + the
messaging provider's team). Declare it once at the workspace scope. With
aweb messaging active, `oats aweb setup` walks the onboarding (aw CLI →
workspace init → team create/join) and `oats aweb roster` shows the
cross-machine member directory.

```bash
oats type add <name> [--description <d>] [--dir <level>]
oats type list
```

## Injection overrides

Capability entries and the `oats:` kernel block take an
`injection-override: <path>|none|default`. Work-mode briefings are packaged
and NOT overridable; the only work-mode key is `setup:` (env bootstrap run in
each new worktree). The clean path is ejecting:

```bash
oats inject eject <capability-id|oats> [--dir <level>]
```

It copies the packaged default to the conventional
`.agents/injections/{capabilities/<id>.md, oats-defaults/oats.md}` path and
sets the override — the file then stops
tracking package updates, deliberately. Overrides are **not allowed** on
`from: owned`/`path:` capabilities: the scope owns the package source, so
edit `.agents/capabilities/owned/<id>/injects/` directly.

## Activate

Acquisition, trust, and package lifecycle → the **oats-packages** skill. The
config side is activation and targeting of already-acquired capabilities
(acquired or catalog availability never implies activation):

```bash
oats use <capability> --global [--dir <level>]
oats use <capability> --type <agent-type> [--disable]
oats use <capability> --soul <name> [--settings k=v [k2=v2 ...]]
```

`oats init` creates config and activates only explicit defaults.

## Package config templates

A distribution package can ship reference **config templates**. Adopting one
writes it as this scope's ordinary `oats-config.yaml` and records the exact
template as a commit-safe **adopted base** — provenance, never live inheritance.
Installing the package alone adopts no template.

```bash
oats init --package <id|path|git-url> [--config <name>]   # acquire + adopt one template
oats config diff                                          # report drift; never merges
oats config sync [--accept <regionId>=local|package]      # apply upstream; keep local edits
oats config sync --reset --yes                            # discard local; take the template verbatim
oats config adopt <package> [--config <name>]             # switch to a different base
```

The config is yours: retarget, disable, re-set, or replace anything the template
enabled; nested repository configs override it per the normal cascade; package
updates never rewrite it or the adopted base. `oats config sync` preserves your
untouched bytes, comments, and formatting, and a region changed both locally and
upstream is a conflict you must resolve explicitly. See docs/packages.md for the
full adoption and sync UX.

## Fundamental layers

Knowledge, messaging, and tasks are formal exclusive contracts. A package
manifest declaring one `layer` is an integration. Two active integrations for
the same layer error; a closer scope's entry (or `none`) overrides outer ones.

| Layer | Bundled | Requirement |
|---|---|---|
| knowledge | `oats.okf` | none |
| messaging | `oats.aweb` | `aw` CLI |
| tasks | none by default; `oats.jira` or `oats.linear` available | provider-specific |

Activation uses the manifest-declared layer — `oats use` writes the entry
under `capabilities.layers.<layer>` automatically:

```bash
oats use <capability> --global|--type <agent-type>|--soul <name>
oats use none --layer <layer>
```

`capabilities` is the only activation map: fundamental integrations under
`capabilities.layers.<layer>` (entry or explicit `none`), everything else
under `capabilities.additive`.

Rare hand-edited keys: `skill-overrides:` (names the winning source on
duplicate skill names), the top-level `agents-md-injection:` map (extra
unconditional instruction blocks), `templates:` (named init seeds).

## Verify

```bash
oats doctor [context] [--soul <name>] [--json]
```

Doctor shows config chain, acquired/active packages, layer selection, target
and settings provenance, requirements, trust, skill sources, instruction
blocks, and — with `--soul` — the final composed AGENTS.md.
