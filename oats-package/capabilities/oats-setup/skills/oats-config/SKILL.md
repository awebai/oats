---
name: oats-config
description: >-
  Use when choosing OATS configuration scope, distinguishing Git workspace/source
  declarations from classic oats-config.yaml policy, or maintaining classic
  activation, agent types, targeting, overrides and templates. For new workspace
  adoption/portable preparation load oats-workspace-setup; classic policy never
  fills a captured record.
---

# OATS configuration: source/workspace first

Moved from the existing `oats-config` skill. For new deployments, the shared
`oats-workspace.yaml`, member/source `oats.yaml` and source-complete soul edition
are separate from local mappings, provider bindings, runtime and exact approvals.
Load **oats-workspace-setup** for that supported prepare/approve/scaffold/start
procedure; neither a classic template nor the config cascade adopts a workspace.

## Classic uncaptured configuration — 0.24 compatibility

> **Legacy-only procedure.** The cascading scopes, agent-type targeting and
> closest-team rules below are compatibility behavior for uncaptured instances.
> They are not portable composition authorities. Use **oats-workspace-setup** for
> the source/workspace two-authority model and never consult this cascade as a
> fallback during captured preparation or dispatch.

Config lives in `oats-config.yaml` at laptop (`~`), workspace, and repository
levels; resolution walks from a soul's repository outward, closest scope wins.
Prefer the CLI for config edits (`oats init`, `oats use`, `oats type`,
`oats inject eject`, `oats create --type`); hand-editing is valid but the CLI
writes the canonical shape.

## Shape

```yaml
team:                          # deployment boundary (typically workspace scope)
  name: example-team
  # id: example-team:example.com   # provider team id (aweb <name>:<namespace>)
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
classic adoption and sync UX in the framework release documentation; do not
assume those files exist in an installed skill or instance work tree.

## Fundamental layers

Knowledge, messaging, and tasks are formal exclusive contracts. A package
manifest declaring one `layer` is an integration. Two active integrations for
the same layer error; a closer scope's entry (or `none`) overrides outer ones.

| Layer | Reference provider (acquired separately) | Requirement |
|---|---|---|
| knowledge | `oats.okf` | provider store/owner/access configuration |
| messaging | `oats.aweb` | `aw` CLI plus legitimate identity/team setup |
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

## Transition and provider limits

Selecting these resource-only skills does not remove the 0.24 kernel copies.
If classic composition reports a duplicate skill, use its explicit supported
`skill-overrides` with the exact source reported by doctor, or wait for the
reviewed kernel transition. Do not invent precedence or edit installed snapshots.
This package does not auto-create a setup expert or silently add oats.core.

oats-aweb 1.10.3 lacks the portable binding interface; oats-aweb **1.11.0** (1.11.1 on OATS >=0.24.4 shows its named reasons)
(OATS >=0.24.2) adds it and reports `ready` only for an input-capable Claude/Codex
profile with an explicit private team and `delivery: session` — a strict-Pi print
primary truthfully reports `needs-configuration`. Required source
capabilities cannot be disabled to make a pilot pass. Actual native human/team,
permission and profile readiness are operator/provider responsibilities.
