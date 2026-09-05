# OATS — Open Agent Team Specification

**Durable specialist agents that compound expertise across sessions, tools, models, and repositories.**

[![npm version](https://img.shields.io/npm/v/@awebai/oats.svg)](https://www.npmjs.com/package/@awebai/oats)
[![Pull Request CI](https://github.com/awebai/oats/actions/workflows/pull-request.yml/badge.svg)](https://github.com/awebai/oats/actions/workflows/pull-request.yml)
[![Release](https://img.shields.io/github/v/release/awebai/oats?display_name=tag)](https://github.com/awebai/oats/releases)
[![Node 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

OATS makes agents first-class project artifacts. Instead of giving every task
the same general assistant, a workspace owns a backend expert, a UI
specialist, a maintainer, a reviewer, a package owner, or any other role, each
with a precise curriculum, durable knowledge, and a full provider-native
session you can enter and steer.

OATS works with **Pi** and **Claude Code**. A team may mix providers and models
while sharing the same souls, package and config contracts, instance
lifecycle, and coordination topology. On machines where `oats setup` has run,
the append-only, searchable **turn record** captures supported local transcripts
and aw client logs. It outlives models, harnesses, and this repository's own
designs.

## Contents

- [Highlights](#highlights)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [The turn record](#the-turn-record)
- [Official packages](#official-packages)
- [OATS Desktop](#oats-desktop)
- [Maturity](#maturity)
- [Upgrading and migration](#upgrading-and-migration)
- [CLI essentials](#cli-essentials)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Releases and versioning](#releases-and-versioning)
- [Origins and acknowledgements](#origins-and-acknowledgements)
- [License](#license)

## Highlights

- **Specialists are project assets.** A soul is reviewed Markdown, YAML,
  skills, and knowledge that travel with the repository. It can be
  instantiated many times without losing its identity or accumulated
  expertise.
- **Instances are real sessions, not hidden subagent calls.** Each instance is
  a disposable incarnation with a full Pi or Claude Code session hosted in
  tmux, an explicit task, its own home, and a repository or workspace view.
  You can attach to it, steer it, message it, stop it, and inspect exactly
  what it received.
- **An exact curriculum, fail closed.** At spawn, OATS resolves the scoped
  config for the target soul and materializes only the resources selected for
  that agent. Missing, duplicate, untrusted, incompatible, or escaping
  resources stop the launch before an incomplete agent starts.
- **Expertise compounds.** With the official `oats.okf` knowledge package, an
  instance keeps resumable working state and captures non-obvious lessons. A
  memory-harvest agent promotes durable knowledge back into the soul, so
  future instances begin where earlier ones finished.
- **Hash-locked distribution.** Capabilities ship in Git-acquired packages
  with exact locks, integrity, dependency closure, and explicit executable
  trust. Acquisition never implies activation.
- **Teams stay steerable.** Instances have explicit `child`, `parent`, and
  `sibling` relationships, can carry cross-machine identities through a
  messaging layer such as `oats.aweb`, and are visible together in OATS
  Desktop.
- **Supported conversations stay on the record.** On machines where `oats
  setup` has run, OATS captures Claude Code, Pi, and Codex transcripts plus aw
  client logs. It skips sources matched by the local record's ignore list.
  Native session turns are content-addressed, not signed, and carry exact
  provenance. Projected aweb mail and chat keep their original message
  signatures verbatim. Search the captured content locally with `oats recall`.

## Quick start

Requires Node.js 22 or newer and tmux.

```bash
npm install -g @awebai/oats@latest
pi install npm:@awebai/oats-pi@latest   # only if you run agents in Pi
```

Initialize a workspace and check it:

```bash
cd my-workspace
oats init
oats doctor
```

Create a specialist and put it to work:

```bash
oats create backend-expert --type developers --repo . --work worktree
oats spawn backend-expert --purpose implement --task "Add rate limiting to the public API"
oats status --team
oats retire <instance>
```

Or adopt a complete reference configuration from an official package:

```bash
oats init --package oats.dev --config default
oats install
```

`oats init --package` acquires and exact-locks the full closure, validates the
chosen template against its providers, writes it as your local
`oats-config.yaml`, and records the adopted base so `oats config diff` and
`oats config sync` can compare against it later.

Start capturing the turn record on this machine:

```bash
oats setup
oats recall "rate limiting"
```

A Pi agent can also load the `oats-getting-started` skill and guide the setup.

## How it works

> **Package distributes. Capability teaches or enables. Config assigns. Soul specializes. Instance works.**

| Concept | Meaning |
| --- | --- |
| **Package** | Git or local acquisition, exact lock, update, integrity, dependency, and review unit. |
| **Capability** | Independently targetable behavior inside a package: skills, instructions, commands, agents, requirements, or lifecycle hooks. |
| **Config template** | A complete reference `oats-config.yaml` a package ships. You adopt one explicitly, and it becomes your ordinary local config. |
| **Adopted base** | The exact template recorded at adoption, kept commit-safe so guided sync can compare against it. |
| **Config** | Local authority: selects layers, targets capabilities to agent types and souls, applies settings, exclusions, and overrides. |
| **Soul** | Durable specialist identity, curriculum, and accumulated knowledge. |
| **Instance** | One disposable incarnation and provider-native working session. |

### Souls and instances

```text
agents/backend-expert/soul/
  soul.yaml
  AGENTS.md
  CLAUDE.md -> AGENTS.md
  skills/
  knowledge/
```

Every instance has two operational surfaces. The **instance home** is the
brain and operational boundary: instructions, task, soul reference, selected
skills, provenance, and episodic state. **`work/`** is the repository or
workspace view where reading, editing, Git, builds, tests, and commits happen.

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

Work modes: `worktree` (isolated branch for implementation), `checkout` (the
repository's shared checkout), `attached` (another instance's tree, for
service agents and reviewers), and `workspace` (read-only multi-repository
context). Placement that cannot be proved fails closed.

Provider behavior stays deliberate. Pi runs with ambient skill, context, and
template discovery curtailed while operator-configured extensions remain
enabled. Claude Code keeps the operator's settings, skills, plugins, MCP,
hooks, and memory, and OATS adds its canonical composed resources. The
guarantee is an exact OATS-managed curriculum, not identical ambient behavior
across providers.

### Configuration and layers

Config is scoped from laptop to workspace to repository. Closer declarations
win; within a level, soul beats agent type beats global. Explicit exclusions
and layer `none` are supported.

OATS has five conceptual layers:

1. **Soul**: durable specialist identity and curriculum (kernel).
2. **Knowledge**: capture and promotion contract (official option `oats.okf`).
3. **Instances**: homes, work modes, sessions, lifecycle (kernel).
4. **Messaging**: reachable agent identities (official option `oats.aweb`).
5. **Tasks**: durable work queue (optional `oats.jira`, `oats.linear`, or another provider).

Knowledge, messaging, and tasks are exclusive slots. Additive capabilities
such as authoring and review compose independently. Inspect the resolved
result with `oats doctor [context] --soul <name> --json`.

### Distribution packages

A Git repository may contain ordinary development content and one or more
package payloads; the default payload path is `oats-package/`.

```bash
oats install oats.okf                                             # official short id
oats install https://github.com/example/project.git@v1.0.0         # Git source
oats install 'https://github.com/example/project.git@v1.0.0#dist'  # contained path
oats install ../project/oats-package                               # local path
oats update <package-id>                                           # explicit advance
```

Installing materializes each capability into
`.agents/capabilities/installed/<id>/`. The `lockfileVersion: 2` lock records
packages (source, exact commit, path, payload integrity, dependencies) and
capabilities (version, provider, path, artifact integrity, executable trust).
Bare `oats install` restores the exact lock and never advances source state.

## The turn record

`packages/record` is the load-bearing layer. On each machine where `oats setup`
has run, it captures Claude Code, Pi, and Codex transcripts plus aw client logs.
It skips sources matched by that record root's ignore list. Native session
turns are content-addressed, not signed, and carry exact provenance. Projected
aweb mail and chat keep their original message signatures verbatim. The
append-only record can be replicated and searched locally through a SQLite
full-text index. It has no runtime dependencies beyond Node.

```bash
oats setup                 # install capture hooks and the background watcher
oats capture --status      # what is being captured, by whom
oats recall "<query>"      # search every captured session and message
```

The normative specification and its conformance vectors live in
[`packages/record/docs/`](packages/record/docs/).

## Official packages

Official packages are independently versioned Git repositories in the
[`awebai`](https://github.com/awebai) organization, referenced from the
kernel's bundled catalog:

| Package | Provides |
| --- | --- |
| [`oats-okf`](https://github.com/awebai/oats-okf) | `oats.okf` knowledge layer and memory harvesting |
| [`oats-aweb`](https://github.com/awebai/oats-aweb) | `oats.aweb` messaging and identity layer |
| [`oats-authoring`](https://github.com/awebai/oats-authoring) | capability, skill, soul, and integration authoring craft |
| [`oats-jira`](https://github.com/awebai/oats-jira) | adopter-selected Jira tasks layer |
| [`oats-linear`](https://github.com/awebai/oats-linear) | adopter-selected Linear tasks layer |
| [`oats-dev`](https://github.com/awebai/oats-dev) | OATS development config template plus `oats.review` |

External CLIs and runtime plugins are separate informed-consent requirements.
Spawn verifies them and never installs them implicitly.

## OATS Desktop

The CLI is the mutation boundary; OATS Desktop is the situational-awareness
layer. It shows identities, tasks, relationships, specialist context,
workspaces, real terminals, and lifecycle state in one view when a team has
too many concurrent sessions for a flat terminal list to remain readable.

Installers for macOS (arm64 and x64) and Linux (x64) are published on the
[Releases](https://github.com/awebai/oats/releases) page with checksums and
build provenance. The Desktop can also be run from `packages/desktop/` in a
framework checkout. See [OATS Desktop](docs/desktop.md).

## Maturity

This repository carries three layers of different maturity behind one `oats`
entry point:

| Layer | Where | Status |
| --- | --- | --- |
| Turn record | `packages/record` | **Core.** Stable, specified, conformance-tested. |
| Soul and instance runtime | `bin/`, `lib/`, `capabilities/` | **Shipped.** Maintained and in production use. |
| Synthesis tools (`oats experimental <dress\|spawn\|segments\|mind>`) | `packages/experimental` | **Experimental.** Unproven by design, interfaces may change, never included in the published package. |

## Upgrading and migration

**From OAS.** If a deployment was created by OAS (`@oas-framework/oas`, files
named `oas-config.yaml` and `oas-lock.json`), this kernel recognizes none of
those names. Convert each scope with one transactional command; any failure
restores the original bytes:

```bash
oats migrate --from-oas --dry-run
oats migrate --from-oas
```

Read [Migration from OAS](docs/migration-from-oas.md) first.

**From 0.18 official capabilities.** For OATS-named scopes, valid v1 locks and
installed capabilities keep working after the kernel upgrade. Preview and
apply the guided migration when ready:

```bash
oats migrate --official --recursive --dry-run --dir <team-root>
oats migrate --official --recursive --dir <team-root>
```

It preserves config files and capability ids, leaves custom, owned, and path
capabilities untouched, never transfers executable trust silently, and prints
exact follow-ups. `oats doctor` reports readiness and cutover state.

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
oats config diff | sync | adopt <package-id> --config <template>
oats doctor --json

oats setup | capture | recall "<query>"
```

Package, config, and lock operations have deterministic CLI and stable JSON
forms. Do not hand-edit the lock or installed stores.

## Documentation

- [Souls and instances](docs/souls-and-instances.md)
- [Configuration](docs/configuration.md)
- [Layers](docs/layers.md)
- [Distribution packages](docs/packages.md)
- [Capabilities](docs/capabilities.md)
- [Knowledge](docs/knowledge.md) and [Knowledge theory](docs/knowledge-theory.md)
- [Integrations](docs/integrations.md)
- [Implementation](docs/implementation.md)
- [OATS Desktop](docs/desktop.md)
- [Migration from OAS](docs/migration-from-oas.md)
- [Release notes](docs/release-notes/)
- [Architecture proposal, 2026-09-03](docs/2026-09-03-architecture-proposal.md): components, contracts, and what may be replaced (proposal, not shipped behavior)

## Contributing

Issues and pull requests are welcome at
[github.com/awebai/oats](https://github.com/awebai/oats).

```bash
git clone https://github.com/awebai/oats.git
cd oats
npm ci
npm run check
npm test
```

`npm test` runs the kernel, record, and experimental suites. The Desktop
suites need their own dependencies; install them once and the same command
picks them up:

```bash
(cd packages/desktop && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci)
```

Pull requests run the same checks on Node 22 through
[Pull Request CI](.github/workflows/pull-request.yml): tests, project
validation, a package dry run, and a clean-room install smoke test. Keep
changes small and reviewable, add a test with every behavior change, and
describe the reachable defect in the commit message.

## Releases and versioning

OATS follows [semantic versioning](https://semver.org/). Each release is a
Git tag `vX.Y.Z` with notes in [`docs/release-notes/`](docs/release-notes/).
A release publishes `@awebai/oats` and `@awebai/oats-pi` to npm and attaches
the Desktop installers, `SHA256SUMS`, and build provenance to the matching
[GitHub Release](https://github.com/awebai/oats/releases). The same release
can be built, staged, and published without GitHub Actions through the
[runnerless release lane](docs/release-lane.md). Official packages are
versioned and tagged in their own repositories and pinned by the kernel's
catalog.

## Origins and acknowledgements

OATS began as **OAS (Open Agent Specialization)**, designed and written by
Josep (Pepe) Garcia-Reyero Sais. The architecture, the kernel, the package
engine, the Desktop, and the official packages are his work; OATS continues
it under its current name, and his authorship is preserved throughout this
repository's history.

OATS grew from the a2am team architecture and the LFX engineering vision for
agent-native engineering. It builds on open formats and conventions including
AGENTS.md, Agent Skills, and OKF.

## License

[MIT](LICENSE) © 2026 OATS Framework
