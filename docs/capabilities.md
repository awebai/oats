# Capability packages

A **capability** is OATS's reusable unit of behaviour. It can contribute
skills, instance instructions, requirements, namespaced commands, and approved
lifecycle hooks. A soul — not the capability — decides which souls receive it,
by naming it with where it comes from (`from:`; see [workspaces](workspaces.md)).

The [official marketplace policy](official-marketplace.md) defines the reviewed
package list and its acceptance criteria. Finding an official package does not
pin, approve or give it to any soul; those remain explicit, separate choices.

An **integration** is a capability that implements one exclusive fundamental
layer: `knowledge`, `messaging`, or `tasks`. General capabilities claim no
layer and compose additively.

## Mental model

A capability lives in one of two kinds of source:

1. a **member repo** of the workspace, at `capabilities/<name>/oats.json` —
   unversioned, always the member's latest state, trusted by membership;
2. a **package** (`oats-package/` in a repo, pinned by version in the
   workspace's `packages:`, locked and approved once per version —
   [packages.md](packages.md)).

A soul says `capabilities: { <name>: { from: here | <repo key> | package } }`
(or `off`); the workspace supplies defaults. At spawn every resolved
capability is **copied whole** into the instance (`<home>/.oats/modules/<name>/`,
skills into `<home>/.agents/skills/<name>/`), and the instance's `AGENTS.md` is
generated without changing the canonical soul. Nothing is installed or
activated at a deployment.

## Manifest

A self-contained package has an `oats.json`:

```json
{
  "capability": "example.team-chat",
  "command": "team-chat",
  "version": "1.2.3",
  "compatibility": { "oats": ">=0.6.2" },
  "description": "Messaging through Team Chat.",
  "layer": "messaging",
  "requires": [
    { "command": "team-chat", "why": "send and receive messages" },
    {
      "runtime": "pi",
      "package": "npm:team-chat-pi",
      "why": "real-time push events in pi sessions"
    }
  ],
  "skills": ["skills"],
  "inject": "injects/team-chat.md",
  "commands": { "auth": "bin/team-chat.mjs auth" },
  "environment": ["EXAMPLE_IDENTITY_HOME"],
  "hooks": {
    "spawn": "bin/team-chat-hook.mjs spawn",
    "retire": "bin/team-chat-hook.mjs retire"
  }
}
```

- `capability` is a namespaced ID. Duplicate IDs are errors. A capability that
  declares launch environment must use a lowercase dotted vendor prefix such
  as `aweb.identity`, because that prefix owns the corresponding `AWEB_*`
  namespace.
- `command` is an optional, unique CLI namespace. The example exposes
  `oats team-chat auth`.
- `layer` is optional and may name exactly one fundamental layer. Two active
  packages cannot implement the same layer for one soul.
- `skills` entries can be skill directories or roots containing skills.
- `inject` is optional instance instruction Markdown.
- Only `soul-scaffold`, `spawn`, and `retire` hooks are accepted. A hook is a
  command string, or `{ command, required }`. `required: true` is valid **only
  on `spawn`**: the hook's failure then fails the spawn and rolls it back,
  instead of producing an instance whose capability never configured itself —
  an aweb identity that could not be minted leaves an agent believing it can be
  woken by mail. Every other hook stays best-effort and only warns, so advisory
  work never becomes a spawn blocker. `retire` and `soul-scaffold` cannot be
  required: they run outside a spawn transaction, so there is no moment to
  enforce them.
- A capability declaring a **required** spawn hook should declare a `retire` hook
  too. Without one, OATS has no way to undo what the spawn hook did and no way to
  know whether it did anything, so a failure quarantines the home rather than
  rolling it back — the operator cleans up by hand and removes it with `--force`.
- A required hook must also be **able** to run: a package capability whose
  version is not approved in the lock is refused at resolution
  (`E_PACKAGE_UNAPPROVED`, remedy `oats sync`), so a required hook never
  silently fails to configure an instance.
- When a required hook fails and its compensation cannot finish, the instance
  home is **retained**, not deleted — it holds the credentials and metadata a
  retry needs, and removing it would turn a transient cleanup failure into
  permanent external residue. It is marked `.oats-rollback-incomplete.json`, so
  `oats status` reports it as retained state rather than a live instance, and
  `oats retire <instance>` retries the cleanup — re-running the retire hooks and
  the rollback-owned Git steps, and verifying both. A retry that still cannot
  finish keeps the home again, names what is outstanding, and exits nonzero.
- The **escape hatch is `oats retire <instance> --force`**, for a home OATS cannot
  identify at all: no `instance.json` and no **usable** cleanup descriptor. Usable
  means it satisfies the versioned cleanup contract the rollback writes, checked
  to the depth the retry consumes it: `version`, a context `repo`, a recognised
  `work` mode (plus a `branch` for `worktree` — an unknown mode would skip the
  rollback-owned Git cleanup and call it done), a real non-empty capability set,
  and the record of what still owes cleanup — retire hooks by capability id, plus
  the rollback-owned Git steps (`worktree`, `branch`) where the mode has them. That
  record can never be empty: a quarantine exists because something is outstanding,
  and one claiming otherwise would give the retry nothing to prove. A marker failing any of
  that is no more retryable than a missing one, and is treated as missing so the
  escape hatch works.
- A retry clears the quarantine only by **proving the outstanding work happened**:
  every retire hook the marker records as owing cleanup must have run and reported
  success, and every Git step it records must be re-run and verified. A retry that resolves no
  capabilities — a hand-edited descriptor, or config drift since the spawn — is an
  incomplete cleanup, not a clean one, and the home stays.
- Because some cleanups can never succeed (a capability offering no way to undo its
  own setup, a permanently unreachable remote), **`--force` also overrides
  retention**: the home is removed, and everything still outstanding is printed as
  state the operator now owns. Nothing is ever permanently unremovable through OATS,
  and nothing is silently dropped. Without `--force` that state fails closed with
  `E_UNIDENTIFIED_INSTANCE_HOME` rather than deleting whatever credentials the
  directory still holds; `--force` removes it and leaves any external state for
  the operator to clean up by hand.
- `requires` declares what must exist before the capability works. Two kinds:
  - a **host command** (`command`), satisfied by a binary on `PATH`;
  - a **runtime package** (`runtime` + `package`, optionally `marketplace`),
    satisfied by that runtime's own package manager — `npm:@scope/name` for pi,
    `plugin@marketplace` for Claude Code. It is raised only for deployments that use the named
    runtime — a Claude-only deployment is never asked to install a pi package —
    and is verified in the runtime's package list, never on `PATH`. A version
    selector is allowed and ignored for identity, so `@latest` and a pinned
    version are one requirement.
  A runtime package is **verified at spawn, never installed there**: installing
  would mutate the operator's runtime configuration without asking, in the
  middle of a spawn. A missing, uninstalled or disabled package fails the spawn
  with the consent command that fixes it.
- OATS never installs a host requirement silently. A missing host command is
  the operator's to install; `oats doctor` reports it. Consent to install is
  separate from package approval.
- `environment` lists the exact launch variables executable trust approves;
  spawn hook output must be a subset and use the capability vendor prefix.
- Target names never appear in a package manifest.

`capability` is the only manifest identity field; it may also carry
`private: true` (usable only by souls of its own repo) and `team: <label>`
(a workspace team label). The machine-readable contract is
[`capability-manifest.schema.json`](capability-manifest.schema.json).

## Who gets a capability

```yaml
# oats-workspace.yaml — shared defaults
defaults:
  capabilities:
    oats.core: { from: package }
    acme-house-style: { from: github.com/acme/agents }
  knowledge: { oats.okf: { from: package } }        # slot default: a layer capability
  messaging: none
  tasks: none
  byTeam:
    engineering:
      capabilities: { acme-release-tooling: { from: github.com/acme/agents } }

# souls/release-manager/soul.yaml — the soul's own choices
capabilities:
  acme-release-tooling: { from: here }
  acme-deploy: { from: package }
  acme-house-style: off
knowledge:
  owns: release-manager
```

Composition order: `defaults.<slot>` ⊕ `defaults.capabilities` ⊕
`defaults.byTeam[<soul team>]` ⊕ `soul.capabilities` — later wins, `off`
removes, a soul `<slot>: none` drops the workspace's slot default. A resolved
capability whose manifest says `layer: X` fills slot X; two for one slot are
`E_SLOT_CONFLICT`. Provider settings come from three homes — the soul's slot
payload, `oats-local.yaml` `settings.<cap>`, and `oats spawn --provider` — and
are deep-merged in that order. There are no agent types, no `global`, no
per-deployment activation or exclusion maps.

## Exact runtime composition

Every spawned instance receives:

- canonical soul skills;
- a **full copy** of every capability the soul resolved to, under
  `<instance>/.oats/modules/<capability>/` (manifest, `bin/`, injects, skills);
- those capabilities' skills copied to `<instance>/.agents/skills/<capability>/<skill>/`.

`instance.json` records per module its source (`from`), commit and content
digest, and the composed skill names with their source. `.claude/skills` points
to the same canonical directory. **The harness starts normally**: pi, Claude
Code and Codex run their own skill discovery with cwd = the instance home;
ambient skills (user-level, the work tree's `.agents/skills/`) coexist with the
OATS-composed set. `instance.json` records what OATS composed, not everything
the harness may discover.

Duplicate skill names **within the composed set** fail the spawn naming both
capabilities (`E_SKILL_DUPLICATE`). A composed skill and an ambient skill with
one name is the harness's own precedence, not an error.

The instance's `AGENTS.md` is a generated regular file containing:

1. the canonical soul `AGENTS.md`;
2. the kernel and work-mode blocks;
3. each module's inject, in deterministic (name) order.

Its `CLAUDE.md` symlinks to `AGENTS.md`. The committed soul remains unchanged.
Edit the canonical soul or the capability's inject in its repo, then spawn a
new instance; do not edit generated blocks as source-of-truth changes.

Inspect a composition before it exists:

```bash
oats spawn release-manager --preview          # modules (from / commit / changedSince), team, resolution revision
oats spawn release-manager --preview --json
```

## Distribution packages

A **package** is the versioned tier: a directory with an `oats-package.json`
that enumerates one or more capabilities (schema
[`oats-package.schema.json`](oats-package.schema.json)). It is pinned once in
the workspace's `packages:`, resolved to an exact commit + integrity by
`oats sync` into `oats-lock.json` (lockfileVersion 3), and its executables are
approved once per version. A soul names a package capability with
`from: package`. Everything about declaring, syncing, locking, approving and
publishing packages is in [packages.md](packages.md). There is no installed
copy at a deployment and no `oats install`/`trust`/`update`/`remove`.

## Member capabilities

A capability at `<member repo>/capabilities/<name>/oats.json` is discoverable
by every soul in the workspace (`oats capabilities` lists it with origin
`member <repo key> @ <commit>`) and is named with `from: <repo key>` — or
`from: here` by souls of the same repo. It is trusted by **membership**: the
repo's access control is the boundary and its latest default-branch state is
what is copied. `private: true` in the manifest keeps it usable only from its
own repo. A member's `oats-package/` is **not** a member capability: it is
reported as `publishes` and consumed only as a package.

## Capability-defined agents

A manifest may declare `agents: ["agents/<name>"]` — package-relative soul
directories (`soul.yaml` + `AGENTS.md` directly inside). *(Open thread: under
the workspace model these are re-based on member souls — a package repo's
expert soul is an ordinary `souls/<name>-expert/` in the member; the classic
lookup still exists for 0.24 layouts.)*

## Commands and hooks

Operational commands resolve only when their capability is one of the current
instance's modules (or the soul's resolved set). Workspace commands (`sync`,
`package`, `workspace status`, `capabilities`, `souls`, `doctor`) are always
available.

Hooks receive `OATS_EVENT`, `OATS_CAPABILITY`, `OATS_LAYER`, `OATS_INSTANCE`,
`OATS_HOME`, `OATS_AGENT`, `OATS_SOUL`, `OATS_CONTEXT`, `OATS_WORKSPACE`,
`OATS_ROOT`, `OATS_LEVEL`, `OATS_SETTINGS`, and `OATS_META`. A final JSON line may
return `meta`, `brief`, `warning`, or runtime-specific `launch` arguments. A
**spawn hook only** may also return an `env` object for the launched process;
returning `env` from retire or soul-scaffold is an explicit contract error.

A **launch hook** runs at every start and restart of a home for each provider
captured at spawn (under its captured settings). Its `launch` arguments and
`env` replace that provider's previous contribution whole. Its `meta`, when
returned, replaces that provider's entry in `instance.json.capabilityMeta`
after the start succeeds — the same record the spawn hook wrote and the retire
hook later reads as `OATS_META` — so a provider that re-issues a credential at
start (a renewed session grant, for example) leaves the CURRENT one on record. A
launch hook that answers without `meta` keeps its previous entry; a start whose
preparation fails changes nothing. (Kernel ≥ 0.25.5; earlier kernels collected
launch `meta` and discarded it.)

Hook environment values are strings, at most 8192 UTF-8 bytes, with no NUL or
newlines. Names use the portable environment grammar and must belong to an
unambiguous vendor namespace. Only a dotted capability ID participates: its
component before the first `.` must be lowercase alphanumeric. Thus `aweb.*`
may contribute only `AWEB_*`; `aweb@evil` and `aweb/evil` are not vendor forms
for this contract. Hyphenated vendors are also excluded because translating a
hyphen to `_` would let `aweb-evil.*` collide with names already inside
`aweb.*`'s `AWEB_*` namespace.

A manifest's `settings.<key>` may carry `hostOnly: true` (decision 27). Such a
key is a fact about the machine — a custody directory, a state root — and the
resolver accepts it only from the deployment's own `oats-local.yaml`
`settings.<capability>`; a committed workspace or soul file or a `--provider`
flag carrying it is refused (`E_WORKSPACE_SCHEMA`, reason `host-only-key`).
Declare it for any key whose value points at something a committed file must
never be able to choose.

A hook may return only names in its manifest's exact `environment` declaration.
For package capabilities that declaration is part of the integrity-locked tree
and of what the per-version approval showed; for member capabilities it is
part of what membership trusts. Undeclared output is fatal. This positive
authority is the contract boundary — adding a new launch variable requires a
visible manifest change (and, for a package, a new approved version).

`OATS_*`, `PI_AGENT_*`, kernel launch variables, and known shell/bootstrap/loader
names are also rejected as defense in depth. The denylist includes current Node,
JVM, .NET, Python, Perl, Ruby, Lua, PHP, ELF, and dyld surfaces, but is explicitly
not the authority boundary: runtime bootstrap names are open-ended, so the
manifest declaration and trust review enforce what an artifact may contribute.
Two capabilities claiming the same name is an error even when their values
match.

Environment names are sorted before shell-quoted command construction, and a
contributed value deliberately overrides an ambient value of the same name.
Invalid or colliding contributions abort before `instance.json` and session
launch. OATS enters the same rollback transaction as a required spawn-hook
failure: declared retire compensation runs in reverse, worktree-mode Git state
is removed and verified, and the home is deleted only after cleanup completes.
A failed compensation, unverifiable topology removal, or reported spawn state
without a retire hook uses the standard retryable quarantine instead. Ordinary
advisory hook execution failure itself contributes no environment.

The environment prefix applies to the initial Pi or Claude process. `--no-launch`
validates command preparation but has no runtime consumer. The fallback shell
after that process exits does not inherit command-scoped assignments, and OATS
has no restart command or replay policy yet. The generated command is persisted
as before; hooks must contribute locators, selectors, or broker endpoints—not
bearer tokens or private key material. An instance-lifetime local principal may
be selected by a home locator. A replaceable execution serving a durable global
identity must instead use a custody/action broker or equivalent narrow adapter;
this mechanism must never copy or expose that global identity's root keys to the
worker process. Session-scoped execution credentials need a separate lifecycle
and must not be encoded into this persisted spawn command.

Spawn/scaffold order is by capability name; retirement reverses successful
spawn order. Hooks run from the instance's own copy
(`<home>/.oats/modules/<cap>/`). Scaffold hooks cannot modify or delete
canonical or another capability's files. OATS records ownership, restores the
pre-hook snapshot, and raises a conflict instead of accepting destructive or
last-writer-wins behavior.

## Official packages

| Capability | Kind | Provides | Package |
|---|---|---|---|
| `oats.core` | additive | day-to-day OATS operation for an instance | `oats.framework` |
| `oats.setup` | additive | whole-architecture knowledge for an onboarding expert | `oats.framework` |
| `oats.okf` | knowledge integration | External owned OKF bases, durable notes/record custody, independent judgment and inspection | `oats.okf` |
| `oats.aweb` | messaging integration | aweb identity lifecycle and messaging skills | `oats.aweb` |
| `oats.jira` | tasks integration | Jira task protocol via `acli` | `oats.jira` |
| `oats.linear` | tasks integration | Linear GraphQL task commands and workflow | `oats.linear` |
| `oats.authoring` | additive | capability, skill, and soul authoring guidance | `oats.authoring` |

Each is pinned by a bare version in `packages:` and resolved through the
[official catalog](official-marketplace.md); each package repo is also a member
of the OATS workspace carrying its expert soul (`okf-expert`, `aweb-expert`, …).
The framework's own souls say `oats.okf: { from: package }` — membership never
turns a package into a latest-state capability.

## Operations a capability declares

A manifest may declare `operations` (named actions or views delegating to
its own commands) that a GUI or a schedule invokes through `oats operation
run <layer>:<name>`; `oats inspect --json` reports them with availability.
See [docs/design/operations-contract.md](design/operations-contract.md).
