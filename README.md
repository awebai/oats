# OATS — Open Agent Team Specification

**Build durable specialist agents that compound expertise across sessions, tools, models, and repositories.**

OATS (Open Agent Team Specification, formerly published as OAS) makes agents
first-class project artifacts.
Instead of giving every task the same general assistant, a workspace can own a
backend expert, UI specialist, maintainer, reviewer, package owner, or any other
role—with a precise curriculum, durable knowledge, and a full provider-native
session you can enter and steer.

OATS works with both **Pi** and **Claude Code**. A team may mix providers and
models while sharing the same souls, package/config contracts, instance
lifecycle, and coordination topology.

## What is core and what is experimental

This repo carries three layers with different maturity, and the `oats`
runtime is the single entry point to all of them:

- **The turn record (core)** — `packages/record`. Every conversation an
  agent has (Claude Code, pi, Codex sessions; aw mail and chat) is
  captured as signed turns in an append-only, content-addressed,
  replicated record, searchable with exact provenance. `oats
  capture|recall|setup`. The normative spec and its conformance vectors
  live in `packages/record/docs/`. This is the load-bearing layer: the
  record outlives models, harnesses, and this repo's own designs.
- **The soul/instance runtime (shipped)** — the CLI you see below:
  souls, instances, capability packages, team topology. Maintained and
  in production use.
- **Experimental synthesis (unproven by design)** — `packages/experimental`,
  run as `oats experimental <dress|spawn|segments|mind>`. Tools that
  select lived conversation (segments, outfits) and spawn agents wearing
  it as native session history. Gated on the continuation-of-self
  experiments; interfaces and judgments there are rewritable clay. Ships
  only in this repo checkout, never in the published package — its
  absence from the tarball is exactly its status.

## Why OATS

### Specialists are real project assets

A specialist is stored as a **soul**: reviewed Markdown, YAML, skills, and
knowledge that travel with its repository. A soul can be instantiated many
times without losing its identity or accumulated expertise.

```text
agents/backend-expert/soul/
  soul.yaml
  AGENTS.md
  CLAUDE.md -> AGENTS.md
  skills/
  knowledge/
```

Each **instance** is a disposable incarnation with a full Pi or Claude Code
session, an explicit task, its own home, and a repository/workspace view. It is
not a hidden subagent call: you can attach to it, steer it, message it, stop it,
and inspect exactly what it received.

### Each instance gets the right curriculum

At spawn, OATS resolves the scoped config for the target soul and materializes
only the OATS-managed resources selected for that agent:

- the three kernel skills: `oats`, `oats-config`, and `oats-packages`;
- soul-private skills and instructions; and
- skills/injections from capabilities active for that soul or agent type.

Missing, duplicate, untrusted, incompatible, or escaping active resources fail
closed before an incomplete agent launches. `instance.json` records the
expected and materialized composition with provenance.

Provider-native behavior remains deliberate:

- **Pi** runs with ambient skill/context/template discovery curtailed, while
  operator-configured extensions remain enabled.
- **Claude Code** keeps the operator's user/repository settings, skills,
  plugins, MCP, hooks, and memory; OATS adds its canonical composed resources.

The guarantee is an exact **OATS-managed curriculum**, not a claim that every
provider exposes identical ambient behavior.

### Expertise compounds

With the official `oats.okf` knowledge package, an instance keeps resumable
working state and captures non-obvious lessons as it works. A memory-harvest
agent promotes durable knowledge and procedures back into the soul. Future
instances begin where earlier ones finished.

### Teams remain steerable

OATS instances are ordinary provider sessions hosted in tmux. They can have
explicit `child`, `parent`, `sibling`, or unrelated relationships and can use a
messaging capability such as `oats.aweb` for cross-machine identities and
real-time mail/chat awakenings.

The CLI is the mutation boundary; **OATS Desktop** is the situational-awareness
layer. It gives one view of identities, tasks, relationships, specialist
context, workspaces, real terminals, and lifecycle state when a team has too
many concurrent sessions for a flat terminal list to remain understandable.

## The mental model

> **Package distributes. Capability teaches or enables. Config assigns. Soul specializes. Instance works.**

| Concept | Meaning |
| --- | --- |
| **Package** | Git/local acquisition, exact lock, update, integrity, dependency, and review unit. |
| **Capability** | Independently targetable behavior inside a package: skills, instructions, commands, agents, requirements, or lifecycle hooks. |
| **Config template** | A complete reference `oats-config.yaml` a package ships. You adopt one explicitly, and it becomes your ordinary local config. |
| **Adopted base** | The exact template recorded at adoption, kept commit-safe so guided sync can compare against it. |
| **Config** | Local authority: selects layers, targets capabilities to agent types/souls, applies settings/exclusions/overrides. |
| **Soul** | Durable specialist identity, curriculum, and accumulated knowledge. |
| **Instance** | One disposable incarnation and provider-native working session. |

Acquisition never implies activation, and installing a package never adopts a
config template. A template is a starting point, not mandatory policy. After you
adopt one, local config may enable, disable, retarget, replace, or reconfigure
every capability independently, and you may change every copied setting.

## Instance home versus `work/`

Every instance has two operational surfaces:

```text
<instance-home>/
  AGENTS.md
  CLAUDE.md -> AGENTS.md
  TASK.md
  instance.json
  soul/
  .agents/skills/
  .claude/skills -> ../.agents/skills
  work/
```

- **Instance home** is the brain and operational boundary: instructions, task,
  soul reference, selected skills, provenance, and episodic state. Run OATS
  lifecycle commands and commands from active capabilities here.
- **`work/`** is the repository or workspace view. Repository reading, editing,
  Git, builds, tests, and commits happen there according to the work mode.

`OATS_INSTANCE_HOME` gives the absolute home to both runtimes and lifecycle
hooks. For Git-backed souls, homes live under the soul-owning repository's
**primary checkout**, even when spawn is invoked from a linked worktree; the
assigned `work/` may still be an isolated worktree. Placement that cannot be
proved fails closed.

Work modes:

- `worktree` — isolated branch/worktree for implementation;
- `checkout` — the repository's current shared checkout;
- `attached` — another instance's tree, for focused service agents/reviewers;
- `workspace` — read-only multi-repository team context.

See [Souls and instances](docs/souls-and-instances.md).

## Distribution packages

A Git repository may contain ordinary development content and one or more OATS
package payloads. The configured payload path is part of the source contract;
the official convention/default is `oats-package/`.

```text
example-package-repo/
  agents/example-package-expert/soul/   # development state, not distributed
  .github/
  README.md
  oats-package/                          # the acquired, hash-locked payload
    oats-package.json
    capabilities/                       # one dedicated root per capability
    config-templates/                   # optional reference configs
```

```bash
# Official short id (from the kernel-bundled catalog)
oats install oats.okf

# Git source: defaults to oats-package/
oats install https://github.com/example/project.git@v1.0.0

# Custom contained path, or explicit repository root
oats install 'https://github.com/example/project.git@v1.0.0#dist/oats'
oats install 'https://github.com/example/root-package.git@v1.0.0#.'

# Local paths name the exact package root
oats install ../project/oats-package
```

Installing a package materializes each capability it declares into
`.agents/capabilities/installed/<id>/`. There is no persistent package store.
The `lockfileVersion: 2` lock records two levels. A `packages` map holds source,
exact commit, selected path, payload integrity, and dependencies. A
`capabilities` map holds each capability's version, provider package, path,
artifact integrity, and executable trust. Bare `oats install` restores the exact
lock and never advances source state. Updating is explicit:

```bash
oats update <package-id>
```

## Official packages

The official packages are independently versioned Git repositories in the
[`awebai`](https://github.com/awebai) organization:

| Package | Provides |
| --- | --- |
| [`oats-okf`](https://github.com/awebai/oats-okf) | `oats.okf` knowledge layer and memory harvesting |
| [`oats-aweb`](https://github.com/awebai/oats-aweb) | `oats.aweb` messaging/identity layer |
| [`oats-authoring`](https://github.com/awebai/oats-authoring) | capability, skill, soul, and integration authoring craft |
| [`oats-jira`](https://github.com/awebai/oats-jira) | adopter-selected Jira tasks layer |
| [`oats-linear`](https://github.com/awebai/oats-linear) | adopter-selected Linear tasks layer |
| [`oats-dev`](https://github.com/awebai/oats-dev) | OATS development config template plus `oats.review` |

External CLIs and runtime plugins are separate informed-consent requirements.
For example, aweb vendors its reviewed Markdown skills but declares Pi and
Claude channel adapters as runtime-specific requirements; spawn verifies them
and never installs them implicitly.

## Configuration and layers

Config is scoped from laptop → workspace → repository. Closer declarations win;
within a level, soul > agent type > global specificity. Explicit exclusions and
layer `none` are supported.

OATS has five conceptual layers:

1. **Soul** — durable specialist identity and curriculum (kernel).
2. **Knowledge** — capture/promotion contract (official option: `oats.okf`).
3. **Instances** — homes, work modes, sessions, lifecycle (kernel).
4. **Messaging** — reachable agent identities (official option: `oats.aweb`).
5. **Tasks** — durable work queue (optional `oats.jira`, `oats.linear`, or another provider).

Knowledge, messaging, and tasks are exclusive integration slots. Additive
capabilities such as authoring/review compose independently.

Inspect the resolved result with:

```bash
oats doctor [context] --soul <name> --json
```

See [Configuration](docs/configuration.md), [Layers](docs/layers.md), and
[Distribution packages](docs/packages.md).

## Install

```bash
npm install -g @awebai/oats@latest
pi install npm:@awebai/oats-pi@latest
```

Install matching kernel/Pi adapter versions. Claude Code uses the same generated
instance files without an OATS Claude adapter.

OATS Desktop is distributed through the
[GitHub Releases](https://github.com/awebai/oats/releases) page. macOS
arm64/x64 and Linux x64 installers are published with checksums and provenance.
The Desktop may also be run from `packages/desktop/` in a framework checkout.

## Start a workspace

### Basic setup

```bash
oats init
oats doctor
```

Or ask a Pi agent to load `oats-getting-started` and guide the setup.

### Adopt a package config template

```bash
mkdir my-workspace
cd my-workspace
oats init --package <package-id> --config <template>
oats install
```

`oats init --package` acquires and exact-locks the full closure, validates the
chosen template against its providers, and writes it as your local
`oats-config.yaml`. It also records the exact template as a commit-safe adopted
base under `.agents/config-templates/adopted/`, so `oats config diff` and
`oats config sync` can compare against it later. Bare `oats install` reconciles the
team boundary and nested repository locks.

For OATS framework and package development itself:

```bash
oats init --package oats.dev --config default
```

The template preserves the `oats-framework` team name, defines
`framework-authors`, `developers`, and `package-maintainers`, enables OKF and
aweb, keeps tasks optional, and assigns authoring and review appropriately. It
carries no provider team ID, credentials, account, or machine paths. Those stay
local, and you may change every copied setting.

## Upgrade from 0.18 official capabilities

**This section applies to OATS-named scopes only.** If your deployment was
created by OAS (`@oas-framework/oas` — files named `oas-config.yaml`,
`oas-lock.json`), the claim below does NOT hold for you: no `oas-*` name is
recognized by this kernel. Convert with `oats migrate --from-oas` — one
transactional command per scope; any failure restores the original OAS
bytes. Read [docs/migration-from-oas.md](docs/migration-from-oas.md) first.

For OATS-named scopes, existing valid v1 locks and installed capabilities
continue to work after the kernel upgrade. Preview and apply the guided
migration when ready:

```bash
oats migrate --official --recursive --dry-run --dir <team-root>
oats migrate --official --recursive --dir <team-root>
```

The command preserves config files and capability IDs, leaves custom/owned/path
capabilities untouched, does not transfer executable trust silently, and prints
exact trust/install follow-ups. `oats doctor` reports readiness and cutover state.

## CLI essentials

```bash
oats status --team
oats create <soul> --type <agent-type> --repo <repo> --work worktree
oats spawn <soul> --purpose <role> --task "..."
oats retire <instance>

oats install [<package-source>]
oats update <package-id>
oats trust <capability>
oats init --package <package-id> --config <template>
oats config diff
oats config sync
oats config adopt <package-id> --config <template>
oats doctor --json
```

Mainstream package/config/lock operations have deterministic CLI and stable JSON
forms. Do not hand-edit the lock or installed stores, and do not reconstruct
resolver behavior with ad-hoc shell commands.

## Learn more

- [Souls and instances](docs/souls-and-instances.md)
- [Configuration](docs/configuration.md)
- [Distribution packages](docs/packages.md)
- [Capabilities](docs/capabilities.md)
- [Knowledge](docs/knowledge.md)
- [Knowledge theory](docs/knowledge-theory.md)
- [Integrations](docs/integrations.md)
- [Implementation](docs/implementation.md)
- [OATS Desktop](docs/desktop.md)

## Origins

OATS grew from the a2am team architecture and the LFX engineering vision for
agent-native engineering. It builds on open formats and conventions including
AGENTS.md, Agent Skills, and OKF.
