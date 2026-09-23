# Rebuilding a 0.24.x deployment for the workspace model (0.25)

The workspace model ([workspaces.md](workspaces.md)) is a **clean v2**: no
converter, no dual-schema reader, no `oats migrate`. This guide is what ships
instead (decision 15 of `workspace-model-v2`). It is short because the new
surface is small: three shared files, one local file, one command.

## 0. 0.24.x keeps working

A 0.24.x kernel keeps spawning 0.24.x deployments indefinitely. Nothing forces
the move: install 0.25 when you are ready to rebuild, not before. A 0.25 kernel
reads only v2 files — a 0.24 `oats-workspace.yaml` (`schemaVersion: 1`), a
`soul.yaml` with `requires:`/`source:`, an `oats.yaml`, an `oats-config.yaml` or
a lock v1/v2 is an error **naming the schema** (`E_WORKSPACE_SCHEMA "… reads
schemaVersion 2 only; found 1"`, `E_LOCK_SCHEMA`), never a silent fallback.
Keep the 0.24 kernel installed until the last 0.24 deployment you care about is
rebuilt; the two do not share files.

## 1. Decide the one workspace

One workspace per organisation. Pick the repo that **hosts**
`oats-workspace.yaml` (a dedicated `agents` repo is common; any member can host
it). Decide the team labels you want (`global`, `engineering`, …) — labels
organise and may add defaults; they never gate anything.

**If any member is private, host the workspace file in a private repo that is
not a public member.** The workspace file names every member, so whoever can
read it sees the member list: a public host would publish the private repo's
name; hosting inside the private member hides the workspace from public
contributors entirely. A dedicated private repo (`<org>/workspace`) is the
honest shape. Public contributors who can read a public member but not the
host still get that member's souls through the standalone case (`from: here`
capabilities plus `oats.core`), so a public soul stays usable.

Two teams that need two different messaging identities (an open-source team
and a hosted-operations team, say) stay in ONE workspace: `team:` is a label,
and the provider payload is addressed by label under `messaging.byTeam` (§2).

## 2. Write `oats-workspace.yaml` v2 in the host repo

Start from the 0.24 file and rewrite it:

| 0.24 | v2 |
|---|---|
| `schemaVersion: 1` | `schemaVersion: 2` |
| `members: [{ source: git:… }]` | `members: [git:…]` — plain refs, **no** `@revision` |
| `imports:` of your **own** repos' souls | delete — member souls are discovered by convention |
| `imports:` of a **stranger's** soul (with `revision`) | `external: [{ source: git:<repo>@<full OID>, soul: <path> }]` |
| `teams: { private: per-human }` (the messaging payload) | `messaging: { private: per-human }`; `teams:` now declares **labels** |
| `defaults.knowledge: { capability, source }` | `defaults.knowledge: { <cap>: { from: package } }` (one entry, or `none`) |
| per-soul `stores.<x>.inherit` | `stores: { <name>: git:<repo> }` once, here |
| `catalog:` | delete (bare versions use the official catalog; `OATS_PACKAGE_CATALOG` overrides) |
| — | `packages: { <id>: <version> \| git:<repo>@<ref> }` — every version your souls used to carry in `source:` lines, **once** |
| — | `defaults.capabilities: { oats.core: { from: package } }` and whatever every soul should get |

```yaml
schemaVersion: 2
name: acme
members:
  - git:github.com/acme/agents
  - git:github.com/acme/platform
packages:
  oats.framework: v1.1.3
  oats.okf: v2.1.3
  oats.aweb: v1.11.2
teams:
  global: { description: Org-wide }
  engineering: { description: Platform }
defaults:
  capabilities: { oats.core: { from: package } }
  knowledge: { oats.okf: { from: package } }
  messaging: { oats.aweb: { from: package } }
  tasks: none
stores:
  org: git:github.com/acme/knowledge
messaging:
  private: per-human
```

No absolute paths anywhere (they belong in `oats-local.yaml`). `from:` values
that name a repo are **canonical keys** — `github.com/acme/agents`, not
`git:github.com/acme/agents` and not `https://…`.

## 3. Add `oats-membership.yaml` to every member (replaces `oats.yaml`)

```yaml
schemaVersion: 2
workspace: git:github.com/acme/agents
team: engineering          # optional default label for this repo's souls/capabilities
```

Delete `oats.yaml`. Its `exports:` lists are gone: every `souls/*/soul.yaml` and
`capabilities/*/oats.json` is discoverable; add `private: true` to the ones that
should stay internal. The host repo backlinks to itself like any member.

## 4. Edit every `soul.yaml` to v2

| 0.24 | v2 |
|---|---|
| `schemaVersion: 1` | `schemaVersion: 2` |
| `requires.knowledge: { capability: oats.okf, source: git:…@v2.1.3#oats-package }` | `capabilities: { oats.okf: { from: package } }` — or nothing, if the workspace default already says so |
| `requires.capabilities.<cap>: { source: git:… }` | `<cap>: { from: package }` (published) or `<cap>: { from: here }` / `{ from: <repo key> }` (a member capability) |
| `source: repo:…` / `path:` | `{ from: here }` |
| `defaults.capabilities` | fold into `capabilities:`; use `off` to remove a workspace default |
| `stores.inherit` | delete (stores are declared once in the workspace) |
| `imports` | delete |
| `kind`, `type`, `repo`, `runtime`, `model`, `launch-config` | delete — model/runtime/launch config are spawn-time choices; `team:` replaces `type:` as the grouping |
| `knowledge:` / `messaging:` payload | keep as is (opaque provider payload); `none` empties the slot |
| — | `compatibility: { <cap>: ">=x.y" }` if you want a floor |

```yaml
schemaVersion: 2
name: release-manager
description: Cuts, verifies and announces releases.
work: worktree
team: engineering
capabilities:
  acme-release-tooling: { from: here }
knowledge:
  owns: release-manager
  reads: [platform-engineer]
messaging:
  channels: [acme-eng]
```

`name` must equal the soul's directory name; `name`, `description` and `work`
are required. Capabilities the repo exports live at
`capabilities/<name>/oats.json` — the manifest is unchanged; you may add
`private: true` / `team:`.

## 5. Write `oats-local.yaml` on each machine

```
~/acme-workspace/                 # the taught convention: "<name>-workspace"
├── oats-local.yaml
├── agents/                       # instance homes
└── platform/                     # member clones, only where someone works IN them
```

```yaml
schemaVersion: 2
workspace: git:github.com/acme/agents
settings:                                   # what used to be `settings:` under capabilities.layers.* in oats-config.yaml
  oats.okf:
    bindings-file: /Users/ana/.oats/okf-bindings.json
    state-dir: /Users/ana/.oats/okf
souls:
  disabled: [data-analyst]
```

Move host paths from `oats-config.yaml` `settings:` here; the `souls:` blocks of
`oats-config.yaml` become `--provider` flags at spawn (step 8). Delete
`oats-config.yaml`; it is not read. Do not commit `oats-local.yaml`.
(`oats onboard <dir> --workspace <repo ref>` writes a minimal `oats-local.yaml`
and runs the first `sync` for you; add `settings:` afterwards.)

## 6. `oats sync`

From the deployment directory:

```
oats sync
```

It confirms every member (fix any `no-backlink` / `backlink-elsewhere` /
`cannot-read` row before going on), resolves `packages:` to commits, writes
`oats-lock.json` (lockfileVersion 3) and asks for executable approval once per
package version. The 0.24 lock is not read; delete it (`E_LOCK_SCHEMA` names
it if you leave it in the way).

## 7. Approve packages

Approval is **per package version, once, in the lock** — no `oats trust`, no
per-capability approval, no per-operator trust list. `oats sync` on a terminal
prints every executable (`commands.*` and `hooks.*.command` targets of every
capability the package provides) and asks `approve <id> <version>? [y/N]`.
Declined or non-interactive → exit `2`, the lock records the entry
unapproved, and spawns of souls using it are refused (`E_PACKAGE_UNAPPROVED`)
until you run `oats sync` in a terminal and say yes. Member capabilities need no
approval: membership is the trust.

## 8. Re-take a retained messaging seat with `spawn --provider`

In 0.24, an instance-specific messaging identity (a retained seat) was pinned in
`oats-config.yaml` under `souls:`. That home is gone; the fact belongs to the
**spawn**:

```bash
oats spawn release-manager --purpose seat --provider oats.aweb identity.source=retained:release-seat
```

`--provider <cap> key=value` is repeatable; dotted keys nest. The payload is
merged after the soul's `messaging:` and the machine's `settings.oats.aweb`, and
recorded in `instance.json.providers.oats.aweb`, so exactly one instance holds
the seat while other instances of the soul mint fresh identities. Consult your
messaging capability's documentation for the exact key it reads. The Desktop's
confirmed apply carries the same map.

## 9. Spawn, and check drift

```bash
oats souls                    # every non-private soul of every confirmed member, with origin and team
oats capabilities             # every capability, member (origin: member <key> @ <commit>) or package (package <id> v<ver>)
oats spawn <soul> --preview   # modules[] with from/commit/changedSince, team, resolution revision
oats spawn <soul> --purpose x
oats status                   # per instance: modules … [member moved since (now @ …)] / [capability no longer present]
```

## What disappears

| Gone | Replaced by |
|---|---|
| `oats-config.yaml` (and the laptop/workspace/repo config chain, `agent-types`, `capabilities.layers`/`additive`, `souls:`, adopted config templates) | `oats-workspace.yaml` defaults + `soul.yaml` `capabilities:`; `oats-local.yaml` for host settings; `spawn --provider` for per-instance facts |
| `oats.yaml` | `oats-membership.yaml` |
| `.agents/capabilities/installed/` and `owned/` | nothing is installed; `<instance>/.oats/modules/<cap>/` per instance; member capabilities under `<repo>/capabilities/` |
| `oats init`, `oats use`, `oats install`, `oats restore`, `oats trust`, `oats list`, `oats catalog`, `oats remove`, `oats migrate`, `oats config` | `oats sync`, `oats package add \| remove`, `oats workspace status`, `oats capabilities`, `oats souls` — each removed verb answers `E_UNKNOWN_COMMAND` naming its replacement |
| lock v1 / v2 | lock v3 (`packages` only, with `url`, `capabilities`, `approved`) |
| per-soul `source: git:…@v#…`, `repo:`, `path:` | `from: here \| <repo key> \| package` + `packages:` in the workspace |
| `imports:` of member souls, `exports:` lists | discovery by convention; `private: true` |
| `stores.<x>.inherit` | `stores:` in the workspace |
| `teams:` as the messaging payload | `messaging:`; `teams:` are labels |
| `@revision` on members | none — members are latest; frozen content is a package |
| ambient-skill exclusion at launch | the harness starts normally; capability skills are copied to `.agents/skills/<cap>/` |

## What is kept

Kernel-neutral provider payloads and the `binding` contract; per-version
executable approval (now in the lock); spawn preview / confirmed apply
(`decision.revision`, now binding the resolution revision) and idempotency;
retirement and retention; the official catalog; the canonical-plus-alias
instance construction (`CLAUDE.md → AGENTS.md`, `.claude/skills →
../.agents/skills`); every published Desktop CLI contract, extended as described
in [desktop-cli-api.md](desktop-cli-api.md#workspace-model-workspaceapi-2).
