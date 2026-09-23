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

**One thing a 0.25 kernel changes for a classic home it does launch.** Decision
13 ("harnesses start normally") is a property of the 0.25 *launcher*, not of the
v2 files: every `pi` launch a 0.25 kernel performs — `oats spawn`, `oats session
start|restart`, scheduled runs — starts pi with cwd = the instance home and pi's
own skill and context discovery intact (`--append-system-prompt <home>/AGENTS.md`,
no `--no-skills` / `--no-context-files` / `--no-prompt-templates` exclusion).
That holds for a classic 0.24 home (no `oats-local.yaml`, spawned through the
pre-v2 compose path that 0.25 still carries) exactly as for a module home. If you
relied on 0.24's ambient-skill exclusion to hide machine-level or repo-level
skills from an instance, that isolation is gone the moment a 0.25 kernel
launches it — keep the 0.24 kernel for those homes, or accept the ambient set
(the spawn preview lists composed skill names so a clash is visible).

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

## 3b. Move the souls: `agents/<name>/soul/` → `souls/<name>/`

In 0.24 a repo's souls lived at `agents/<name>/soul/` beside that soul's
instances. Under v2 discovery looks **only** at `souls/<name>/soul.yaml`; the
`agents/` directory belongs to the *deployment* (instance homes and, under the
kernel's per-commit soul cache, the fetched soul copies — see §7b) and is not
read as a soul source. Move every soul as a tracked rename so history follows:

```bash
mkdir -p souls
git mv agents/release-manager/soul souls/release-manager
# … one line per soul; then
git rm -r --cached agents 2>/dev/null; echo 'agents/' >> .gitignore   # instances were never meant to be tracked
```

`souls/<name>/` keeps its `AGENTS.md`, `CLAUDE.md → AGENTS.md` alias, `skills/`,
`knowledge/` and `soul.yaml` (rewritten in §4); the directory name must equal
`soul.yaml#name`. Then fix whatever enumerates the old path: repo tests, scripts,
CI checks and any `oats.yaml`-era `exports:` tooling that globbed
`agents/*/soul/soul.yaml` (`git grep -n 'agents/.*/soul'` finds them) — under v2
they enumerate `souls/*/soul.yaml`. A soul left under `agents/` is invisible to
`oats souls` and to `oats spawn`; nothing warns about it.

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

**Carry `team:` on every soul, or on its repo's membership.** A soul's team is
`soul.yaml#team`, else `oats-membership.yaml#team`, else *unassigned*
(`null`). Labels never gate anything, but the kernel addresses provider payload
by label: an unlabelled soul receives the messaging **base** payload only —
`workspace.messaging` minus `byTeam`, no `byTeam.<label>` block, and no
`defaults.byTeam.<label>` capabilities either. If your 0.24 deployment had one
messaging identity per team (§1), a soul that loses its label silently lands
outside every team-addressed payload; nothing refuses it. Label the membership
when a whole repo belongs to one team, and the soul when it does not.

**Per-soul memory-harvest opt-out:** not available in OKF 2.1.3 — an OKF 2.1.4
item. The 2.1.3 `knowledge:` payload admits `owner`, `owns`, `reads` and
`stores` (plus the kernel-rendered `runtime`/`execution`); there is no key that
keeps a soul registered for reads while excluding it from harvest. A soul that
must not be harvested today says `knowledge: none` (no OKF at all for that
soul) or `oats.okf: off`; do not invent a key — the binding refuses unknown
payload keys.

## 5. Write `oats-local.yaml` on each machine

```
~/acme/                           # the directory YOU choose — an existing folder with your clones is the usual case
├── oats-local.yaml
├── agents/                       # instance homes
└── platform/                     # member clones, wherever you keep them (here, or named in clones:)
```

```yaml
schemaVersion: 2
workspace: git:github.com/acme/agents
settings:                                   # what used to be `settings:` under capabilities.layers.* in oats-config.yaml
  oats.okf:
    bindings-file: /Users/ana/.oats/okf-bindings.json   # required by the OKF binding: absolute host path
    state-dir: /Users/ana/.oats/okf-state               # required by the OKF binding: absolute host path; FRESH for a rebuilt deployment (§7b)
    harvest-runtime: pi                                 # optional: pi | claude | codex (default pi)
  oats.aweb:
    delivery: channel                                   # channel (default) | session — see capabilities/oats-aweb/oats.json#settings.delivery
souls:
  disabled: [data-analyst]
```

`settings.<cap>` is merged into that capability's payload after the soul's
slot payload and before `spawn --provider` (decision 14); the keys are the
capability's own (`oats.json#settings`). For **`oats.okf` 2.1.3** the binding
requires both `bindings-file` and `state-dir` as normalized absolute host
paths (`setting state-dir is required (absolute host path)` is a refusal, not a
default) and accepts `harvest-runtime` / `harvest-model`. For **`oats.aweb`**
the one machine-level key is `delivery`: `channel` (the native aweb channel
packages wake the instance; default) or `session` (delivery is external —
`AWEB_DELIVERY=session`, the host wake broker registers the instance once it
exists; requires an `aw` that ships `aw wake`). `identity.source` is also legal
here but see §8 for why it belongs at spawn.

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

## 7b. OKF 2: start a FRESH `state-dir` — do not re-point the old one

OKF 2 pins each knowledge **owner** to a soul by path: at source registration
(the `oats.okf` spawn hook) it writes `owners.json` in `state-dir` as
`{ <owner id>: realpath(<home>/soul) }` and refuses a later registration whose
owner resolves to a different path (`E_OWNER stable owner ID already identifies
a different soul in this state namespace`).

Under v2 that path is no longer your checkout. `oats spawn` fetches the soul
from its member repo at the confirmed commit into the deployment's
**per-commit soul cache**, `agents/<name>/souls/<commit12>/` (immutable once
written; `agents/<name>/soul` is a kernel-swapped pointer to the current one),
and the instance's `<home>/soul` links **its own commit's directory** — so the
realpath the hook pins is `<deployment>/agents/<name>/souls/<commit12>`, which
never equals the 0.24 pin (`<repo>/agents/<name>/soul`) and changes whenever the
member moves. Two consequences:

- **Do not reuse the 0.24 `state-dir`.** Its `owners.json` pins every owner to
  the old path; the first v2 spawn of each soul would be refused with `E_OWNER`.
  Give the rebuilt deployment a fresh `state-dir` (§5) and a fresh
  `bindings-file` if the old one names the old state root. The old `state-dir`
  is **frozen custody**: read-only history (`oats okf inspect --source
  <old-state>/sources/<id>/source.json …` still works against it), never edited,
  never re-pointed at the new soul path. Accepted knowledge is not affected —
  it lives in the bases, not in `state-dir`.
- **The owner pin is per commit.** OKF 2.1.3 records the realpath at first
  registration and the kernel keeps that commit directory for as long as any
  instance links it, so a running instance's pin stays valid; a *later* spawn of
  the same soul at a newer member commit links a different directory and
  registers under the same owner id → `E_OWNER` again. Until OKF re-bases the
  pin on the owner identity rather than the path (an OKF 2.1.4 item), the
  practical rule is: one `state-dir` per (deployment, soul commit) is safe;
  moving a member that owns knowledge means a fresh `state-dir` for the new
  commit's spawns (the previous one becomes frozen custody, as above). Plan
  knowledge-owning souls' member commits deliberately.

## 8. Re-take a retained messaging seat with `spawn --provider`

In 0.24, an instance-specific messaging identity (a retained seat) was pinned in
`oats-config.yaml` under `souls:`. That home is gone; the fact belongs to the
**spawn**:

```bash
oats spawn release-manager --purpose seat --provider oats.aweb identity.source=/abs/path/to/retained/.aw
```

`--provider <cap> key=value` is repeatable; dotted keys nest. The payload is
merged after the soul's `messaging:` and the machine's `settings.oats.aweb`, and
recorded in `instance.json.providers.oats.aweb`, so exactly one instance holds
the seat while other instances of the soul mint fresh identities.

**The value is the path itself.** `oats.aweb` reads `identity.source` as the
absolute path of the `.aw` directory to retain (it must hold `signing.key`); the
kernel does not resolve symbolic seat names. Because it is an absolute path it is
a fact about ONE machine, so its other legal home is `oats-local.yaml`
(`settings.oats.aweb.identity.source: /abs/path`) — never the workspace file
(absolute paths are refused there, decision 14). Prefer the spawn form: a
machine-level setting would give the seat to EVERY instance of every messaging
soul on that machine, and a seat can be held once. The Desktop's
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
| `agents/<name>/soul/` as the tracked soul source | `souls/<name>/` (tracked); `agents/` is deployment state — instance homes and the kernel's per-commit soul cache `agents/<name>/souls/<commit12>/` |
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
