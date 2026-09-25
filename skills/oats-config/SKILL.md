---
name: oats-config
description: >-
  Use when someone asks about oats-config.yaml, the classic config cascade,
  agent types, capability activation or injection overrides. The workspace
  model has no config cascade and no config-editing verbs; this skill says
  where each of those concerns lives now. For setting up a deployment use the
  oats.setup capability's oats-onboarding and oats-package-pins skills.
---

# Where configuration lives in the workspace model

There is no configuration cascade to edit. Each fact lives in the one file
that owns it, and `oats sync` reads them over the Git remotes. The classic
`init`, `use`, `config` and `inject` verbs answer `E_UNKNOWN_COMMAND` with
their replacement. Contract: `docs/workspaces.md` and `docs/configuration.md`
in the installed kernel (`"$(oats root)/docs/"`).

| Concern | Where it lives | Changed by |
|---|---|---|
| Members, packages, teams, defaults, stores, messaging payload | `oats-workspace.yaml` in the workspace's host repository | a reviewed change to that repository, then `oats sync` |
| A repository's membership and default team | `oats-membership.yaml` in that repository | a reviewed change |
| Which capabilities a soul gets | the soul's `soul.yaml` `capabilities: { <cap>: { from: here \| <repo key> \| package } }`, plus the workspace `defaults` (and `defaults.byTeam.<team>`) | a reviewed change; `off` removes a default, `<slot>: none` empties a slot |
| Host facts (absolute paths, state directories) | `oats-local.yaml` `settings.<cap>` on each machine, never committed | the operator |
| A fact about one spawn | `oats spawn <soul> --provider <cap> key=value` | the spawner |
| Launch settings (runtime, model, permission bypass) | spawn flags, or a named launch configuration (`oats launch-config set <name> --file <json>`) | the operator |
| A capability's instruction inject | the capability itself, in its member repository or package | a reviewed change there; the workspace model has no local override |

Agent types are gone: a soul's own `soul.yaml` and the workspace's team
labels (`defaults.byTeam`) replace them.

## Slots

Knowledge, messaging and tasks are exclusive slots. A capability whose manifest
declares `layer: <slot>` fills it; two in one slot is `E_SLOT_CONFLICT`. A slot
default must be a capability of that layer, and a soul's `<slot>: none` empties
the slot.

## Check the result

```bash
oats workspace status                # members confirmed, packages locked
oats souls                           # every soul, its origin and team
oats capabilities                    # member and package capabilities
oats spawn <soul> --preview          # the exact modules, skills and merged settings a spawn would use
```
