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
Read §8b before relying on it: oats.aweb 1.12.0 mints into the `team` the
payload names, but the `.aw` root it mints FROM is still found by search and
must hold that team's membership (1.11.2 ignored `team` altogether).

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
  oats.okf: v2.1.5
  oats.aweb: v1.12.2
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
| `requires.knowledge: { capability: oats.okf, source: git:…@v2.1.4#oats-package }` | `capabilities: { oats.okf: { from: package } }` — or nothing, if the workspace default already says so |
| `requires.capabilities.<cap>: { source: git:… }` | `<cap>: { from: package }` (published) or `<cap>: { from: here }` / `{ from: <repo key> }` (a member capability) |
| `source: repo:…` / `path:` | `{ from: here }` |
| `defaults.capabilities` | fold into `capabilities:`; use `off` to remove a workspace default |
| `stores.inherit` | delete (stores are declared once in the workspace) |
| `imports` | delete |
| `kind`, `type`, `repo`, `runtime`, `model`, `launch-config` | delete — model/runtime/launch config are spawn-time choices; `team:` replaces `type:` as the grouping |
| `knowledge:` / `messaging:` payload | keep as is (opaque provider payload); `none` empties the slot. **For `oats.okf` see the box below: the payload is the binding's SETTINGS keys only; what the soul owns/reads stays in `okf.json`** |
| — | `compatibility: { <cap>: ">=x.y" }` if you want a floor |

```yaml
schemaVersion: 2
name: release-manager
description: Cuts, verifies and announces releases.
work: worktree
team: engineering
capabilities:
  acme-release-tooling: { from: here }
# knowledge: — nothing here for oats.okf: the workspace default fills the slot and
#   souls/release-manager/okf.json (below) says what this soul owns and reads.
messaging:
  channels: [acme-eng]
```

`name` must equal the soul's directory name; `name`, `description` and `work`
are required. Capabilities the repo exports live at
`capabilities/<name>/oats.json` — the manifest is unchanged; you may add
`private: true` / `team:`.

**`oats.okf` 2.1.3 reads `souls/<name>/okf.json`, not a `knowledge:` payload.**
Earlier drafts of this guide showed `knowledge: { owns: …, reads: … }` or
`knowledge: { store, root }` on the soul; **no shipped provider consumes those
keys**. What OKF 2.1.3 actually reads at spawn is two things:

1. **`<soul>/okf.json`** (travels with the soul, fetched into the per-commit
   soul cache like `AGENTS.md`) — the soul's knowledge declaration, exactly
   these keys and no others:

   ```json
   { "version": 1,
     "owner": "release-manager",
     "owns":  ["org/release-manager"],
     "reads": ["org/platform-engineer"] }
   ```

   `owner` is the stable owner id (what `owners.json` pins, §7b); `owns` /
   `reads` are `<base alias>/<node>` references into the bases the machine's
   bindings file declares (`oats okf init` / `oats okf migrate` write it;
   `capabilities/oats-okf/lib/config.mjs#validateDeclaration` is the
   authority). Keep the file where 0.24 had it — it moves with the soul in
   §3b. A soul without `okf.json` whose slot resolves to `oats.okf` fails the
   required spawn hook (`soul has no okf.json`), by design.
2. **The merged payload, as `OATS_SETTINGS`** — the binding's **settings
   keys only**, the list in `capabilities/oats-okf/oats.json#settings`:
   `bindings-file`, `state-dir` (both required, absolute host paths →
   `oats-local.yaml`, §5), `harvest-runtime`, `harvest-model` (optional). Any
   other key — `owns`, `reads`, `store`, `root`, `stores` — is refused
   (`unknown OATS_SETTINGS property`). So for `oats.okf` the soul's
   `knowledge:` payload is normally **absent** (the workspace default
   `defaults.knowledge: { oats.okf: { from: package } }` fills the slot) or
   carries a soul-true binding setting such as `harvest-runtime: claude`;
   `knowledge: none` opts the soul out.

`stores:` in the workspace file names repositories for the **workspace**; where
OKF's bases live inside them is a **bindings-file** concern today (`bases.<alias>`
with `repository` + `root`), not a soul payload key. A soul payload grammar for
OKF (`owns`/`reads`/`root` on `soul.yaml`) is an OKF follow-up (it lands with an
`oats.okf` release that declares it in its binding, and this guide will say so);
until then the kernel forwards the payload opaquely and OKF refuses what it does
not know.

**Carry `team:` on every soul, or on its repo's membership.** A soul's team is
`soul.yaml#team`, else `oats-membership.yaml#team`, else *unassigned*
(`null`). Labels never gate anything, but the kernel addresses provider payload
by label: an unlabelled soul receives the messaging **base** payload only —
`workspace.messaging` minus `byTeam`, no `byTeam.<label>` block, and no
`defaults.byTeam.<label>` capabilities either. If your 0.24 deployment had one
messaging identity per team (§1), a soul that loses its label silently lands
outside every team-addressed payload; nothing refuses it. Label the membership
when a whole repo belongs to one team, and the soul when it does not.

**Per-soul memory-harvest opt-out:** not available in OKF 2.1.3 or 2.1.4 — a
later OKF item. Neither `okf.json` (`version`, `owner`, `owns`, `reads`) nor the settings
payload (`bindings-file`, `state-dir`, `harvest-runtime`, `harvest-model`) has a
key that keeps a soul registered for reads while excluding it from harvest. A
soul that must not be harvested today says `knowledge: none` (no OKF at all for
that soul) or `oats.okf: off`; do not invent a key — both readers refuse unknown
keys.

## 5. Write `oats-local.yaml` on each machine

```
~/acme/                           # the directory YOU choose — an existing folder with your clones is the usual case
├── oats-local.yaml
├── agents/                       # instance homes — created by `oats sync` if absent (0.25.2)
└── platform/                     # member clones, wherever you keep them (here, or named in clones:)
```

```yaml
schemaVersion: 2
workspace: git:github.com/acme/agents
clones:                                     # optional: member clones that are NOT at <deployment>/<member name>
  github.com/acme/platform: /Users/ana/src/acme-platform
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

**Where the kernel looks for a member clone** (a `work: worktree | checkout`
soul needs one; nothing else does). In this order, first hit wins:

1. `oats spawn … --repo <abs path>` — this spawn only.
2. `oats-local.yaml` `clones: { <repo key>: <abs path> }` — the key is the
   member's **canonical key** (`github.com/acme/platform`; any ref spelling you
   write is normalised through `parseRepoRef`, so `git:github.com/acme/platform`
   and `https://github.com/acme/platform.git` address the same entry).
3. The convention: `<deployment>/<member name>` — the last path segment of the
   repo key (`platform` for `github.com/acme/platform`). One exception: a member
   whose name is `agents` is looked for at `<deployment>/agents-repo`, because
   `<deployment>/agents/` is the instance root (above).
4. None found → `E_CLONE_MISSING`, naming the three remedies. A directory that
   *is* found but whose `origin` remote is a **different repo** →
   `E_CLONE_MISMATCH` (the clone is not the member; nothing is spawned into it).

This order was documented before 0.25.2 but the kernel did not honour it (a
clone had to be `--repo`'d or sit at the convention); 0.25.2 implements it as
written here. If your host repo is named `agents`, clone it as
`<deployment>/agents-repo` or name it in `clones:`.

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
(`oats onboard <dir> --workspace <repo ref>` writes a minimal `oats-local.yaml`,
creates `agents/` and runs the first `sync` for you; add `settings:` afterwards.
Its `next.clone` list names **every** member that lacks a clone at the
convention — the host included: the host is a member like any other, and a
soul that lives in it and says `work: worktree` needs its clone too. Under an
explicit `standalone:` header the list says so and names only that repo.)

## 6. `oats sync`

From the deployment directory:

```
oats sync
```

It creates `agents/` if it is absent (0.25.2; a hand-written `oats-local.yaml`
no longer needs a `mkdir`), confirms every member (fix any `no-backlink` /
`backlink-elsewhere` / `cannot-read` row before going on), resolves `packages:`
to commits, fetches each package, verifies its integrity and writes
`oats-lock.json` (lockfileVersion 3). The 0.24 lock is not read; delete it
(`E_LOCK_SCHEMA` names it if you leave it in the way).

The legacy "You run on OATS" block is no longer composed into `AGENTS.md` when
`oats.core` resolves as a module (0.25.2): an instance gets **one** such block,
the one `oats.core`'s inject carries. If you see two, the soul resolved without
`oats.core` (check `oats spawn <soul> --preview`).

## 7. What the lock pins

Declaring a package in `packages:` is the trust decision: review what a package
runs (its capabilities' `commands.*` and `hooks.*.command` targets) before the
pin goes into the workspace file, because every operator who syncs runs it.
Member capabilities are trusted by membership in the same way.

`oats sync` then needs nothing from you: it resolves each pin to a commit,
fetches the package, computes the integrity of its tree, writes the lock and
exits `0`. The same command runs unchanged in CI and scripted rebuilds:

```bash
oats sync
```

The lock is what makes a rebuild reproducible. For an entry already locked at
the same version, the commit and the integrity must be unchanged — a moved tag
or changed content is `E_PACKAGE_INTEGRITY`, and a version string must change
when its content does. At spawn the package's capability list at the locked
commit must still match the lock, and only packages the workspace still
declares are used.

## 7b. OKF 2: start a FRESH `state-dir` — do not re-point the old one

OKF 2 pins each knowledge **owner** to a soul by path: at source registration
(the `oats.okf` spawn hook) it writes `owners.json` in `state-dir` as
`{ <owner id>: realpath($OATS_SOUL) }` and refuses a later registration whose
owner resolves to a different path (`E_OWNER stable owner ID already identifies
a different soul in this state namespace`).

Under v2 that path is no longer your checkout. `oats spawn` fetches the soul
from its member repo at the confirmed commit into the deployment's
**per-commit soul cache**, `agents/<name>/souls/<commit12>/` (immutable once
written; `agents/<name>/soul` is a kernel-swapped pointer to the current one),
and the kernel hands every lifecycle hook of the instance **its own commit's directory**
as `OATS_SOUL` (recorded as `instance.json` `soulDir`; homes carry no soul
link) — so the realpath the hook pins is `<deployment>/agents/<name>/souls/<commit12>`, which
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

## 8b. Where the team `.aw` lives now, and what `byTeam` does today

A freshly minted identity (every spawn without `identity.source`) needs an
**initialised aweb root**: a directory holding `.aw` with a team membership to
mint into. oats.aweb's spawn hook (1.11.2 and 1.12.0 alike) looks for `.aw` among these, first hit
wins: the declared team scope (`OATS_TEAM_SCOPE`, from the removed
`oats-config.yaml` `team:` block — **empty under v2**), the instance home, the
git repo containing the home, the resolution context (the soul's work repo) and
the git repo containing it, and the workspace root (`OATS_WORKSPACE`, which
under v2 is the **deployment directory** — the one holding `oats-local.yaml`).
None of these is the 0.24 team root you initialised with `oats aweb setup`, so
a rebuilt deployment mints nothing until you put `.aw` where the hook looks:

- **at the deployment directory** — `<deployment>/.aw`: one team for every
  messaging soul spawned here; or
- **inside a member clone** (gitignored — add `.aw/` to the clone's
  `.gitignore`; never commit `signing.key`): `<clone>/.aw` is found through the
  soul's work repo, so souls whose `work:` targets *that* member mint into
  *that* team.

`cp -R <old team root>/.aw <deployment>/.aw` (or into the clone) carries the
existing memberships over; `aw team list` from that directory shows the active
team. A `.aw` at your user home or above the deployment is **not** found on
purpose (a `.aw` there would be a different team; minting into it would be a
silent cross-team leak).

**Two teams, two identities — what actually decides the team in 1.11.2.** The
hook resolves the target team as: `OATS_TEAM_ID` / `OATS_TEAM_NAME` from the
removed `oats-config.yaml` `team:` block (empty under v2), else **the active
team at the `.aw` root it found**. It **does not read a `team` key from its
payload** (`OATS_SETTINGS`): the only payload keys 1.11.2 acts on are
`delivery` and `identity.source`/`identity.takeOver`. Consequently
`messaging.byTeam.<label>: { team: aweb:… }` is **kernel-merged and
delivered, but a NO-OP for oats.aweb 1.11.2** — the kernel does its part
(`spawn --preview` shows the merged `settings.oats.aweb` with the label's
`team`, and `instance.json.providers.oats.aweb` records it); the provider
ignores it until an oats.aweb release reads `team` from the payload. Until then
the only way to get per-label minting is **per-repo placement**: give each
team's member clone its own `.aw` whose active team is that team’s, and make
sure the souls of that team say `work: worktree | checkout` **on that repo**.
A soul with `work: directory | workspace` has no member clone as context and
falls through to `<deployment>/.aw` — one team only. Keep `byTeam` in the
workspace file anyway: it is the declared intent, the kernel honours it, and
the next oats.aweb picks it up without a workspace edit.

## 9. Spawn, and check drift

```bash
oats souls                    # every non-private soul of every confirmed member, with origin and team
oats capabilities             # every capability, member (origin: member <key> @ <commit>) or package (package <id> v<ver>)
oats spawn <soul> --preview   # modules[] with from/commit/changedSince, team, resolution revision,
                              #   providers (the --provider map as given) and settings.<cap> (the merged payload each provider receives)
oats spawn <soul> --purpose x
oats status                   # per instance: soul: <name> from <member> @ <c7>  [member moved since …]
                              #               modules … [member moved since (now @ …)] / [capability no longer present]
```

`--preview` (0.25.2) prints `providers` — exactly the `--provider <cap> k=v`
map you gave — and `settings.<cap>` — the **merged** payload the provider's
binding will receive (`workspace.messaging` base ⊕ `byTeam[team]` ⊕ soul slot
payload ⊕ `oats-local.yaml settings.<cap>` ⊕ `--provider`), so you can see
before creating anything that `state-dir` is the fresh one (§7b) and that the
team block reached the payload (§8b). `oats status` (0.25.2) shows drift for
the **soul source** as well as for modules: `soul: <name> from <member> @ <c7>`
with `[member moved since …]` when the member's default branch has moved past
the commit the instance was spawned from; `--json` carries it as
`instances[].soul { repoKey, commit, current, status }`. A moved soul is
information, not a fault — the running instance keeps its own commit (§7b);
re-spawn when you want the new one.

**Work modes and clones.** `work: worktree | checkout` needs the member clone
(§5 order); `work: directory` needs nothing; `work: workspace` (a coordination
soul) links `./work` to the **deployment directory** — the one holding
`oats-local.yaml`, with `agents/` and whatever clones sit beside it — read-only
across members, no branch (0.25.1). Such a soul finds a member whose clone is
elsewhere through `oats-local.yaml` `clones:`.

## What disappears

| Gone | Replaced by |
|---|---|
| `oats-config.yaml` (and the laptop/workspace/repo config chain, `agent-types`, `capabilities.layers`/`additive`, `souls:`, adopted config templates) | `oats-workspace.yaml` defaults + `soul.yaml` `capabilities:`; `oats-local.yaml` for host settings; `spawn --provider` for per-instance facts |
| `oats.yaml` | `oats-membership.yaml` |
| `agents/<name>/soul/` as the tracked soul source | `souls/<name>/` (tracked); `agents/` is deployment state — instance homes and the kernel's per-commit soul cache `agents/<name>/souls/<commit12>/` |
| `.agents/capabilities/installed/` and `owned/` | nothing is installed; `<instance>/.oats/modules/<cap>/` per instance; member capabilities under `<repo>/capabilities/` |
| `oats init`, `oats use`, `oats install`, `oats restore`, `oats trust`, `oats list`, `oats catalog`, `oats remove`, `oats migrate`, `oats config` | `oats sync`, `oats package add \| remove`, `oats workspace status`, `oats capabilities`, `oats souls` — each removed verb answers `E_UNKNOWN_COMMAND` naming its replacement |
| lock v1 / v2 | lock v3 (`packages` only, with `url`, `commit`, `integrity`, `capabilities`) |
| per-soul `source: git:…@v#…`, `repo:`, `path:` | `from: here \| <repo key> \| package` + `packages:` in the workspace |
| `imports:` of member souls, `exports:` lists | discovery by convention; `private: true` |
| `stores.<x>.inherit` | `stores:` in the workspace |
| `teams:` as the messaging payload | `messaging:`; `teams:` are labels |
| `@revision` on members | none — members are latest; frozen content is a package |
| ambient-skill exclusion at launch | the harness starts normally; capability skills are copied to `.agents/skills/<cap>/` |

## What is kept

Kernel-neutral provider payloads and the `binding` contract; exact
commit-and-integrity locking (now lock v3); spawn preview / confirmed apply
(`decision.revision`, now binding the resolution revision) and idempotency;
retirement and retention; the official catalog; the canonical-plus-alias
instance construction (`CLAUDE.md → AGENTS.md`, `.claude/skills →
../.agents/skills`); every published Desktop CLI contract, extended as described
in [desktop-cli-api.md](desktop-cli-api.md#workspace-model-workspaceapi-2).
