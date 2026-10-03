# Capability packages

A **capability** is OATS's reusable unit of behaviour. It can contribute
skills, instance instructions, requirements, namespaced commands, and declared
lifecycle hooks. A soul — not the capability — decides which souls receive it,
by naming it with where it comes from (`from:`; see [workspaces](workspaces.md)).

The [official catalog policy](official-catalog.md) defines the reviewed
package list and its acceptance criteria. Finding an official package does not
declare it or give it to any soul; declaring it in `packages:` is the
workspace's trust decision, and giving it to a soul is a separate choice.

A **core capability** fills one of the three positions a soul has: knowledge,
messaging or tasks, at most one of each per soul. The manifest's `layer` field
names which core capability it is. Other capabilities claim no `layer` and
compose additively.

## Mental model

A capability lives in one of two kinds of source:

1. a **member repo** of the workspace, at `capabilities/<name>/oats.json` —
   unversioned, always the member's latest state, trusted by membership;
2. a **package** (`oats-package/` in a repo, pinned by version in the
   workspace's `packages:` — the declaration is the trust — and locked to a
   commit and integrity; [packages.md](packages.md)).

A soul says `capabilities: { <name>: { from: here | <repo key> | package } }`
(or `off`); the workspace supplies defaults. At spawn every resolved
capability is **copied whole** into the instance (`<home>/.oats/modules/<name>/`,
its skills flat into `<home>/.agents/skills/<skill>/`), and the instance's `AGENTS.md` is
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
      "harness": "pi",
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
  `oats team-chat auth`. Inside an instance home it runs the home's copy of
  the capability. From a deployment directory (an **operator command**) it
  resolves as a spawn of a soul would: the soul named by `--soul <name>`, or,
  without `--soul`, the first soul of the deployment by name, not disabled
  there, whose resolution provides the namespace (souls whose resolution is
  refused are skipped). The chosen soul is named on stderr (`oats <namespace>:
  no --soul given; running as soul <member>/<soul>, …`), so the command's
  stdout, its `--json` envelope included, is the provider's alone. When no
  soul provides the namespace, the command is refused with `E_BAD_ARGS` (`no
  soul of this deployment provides the <namespace> namespace; pass --soul
  <name>`, with any skipped souls and their codes in `details.skipped`).
  `--soul` without a name is `E_BAD_ARGS`. With `--server <id>` the same
  command runs on that server's deployment ([servers.md](servers.md#run-there)).
- `compatibility.oats` is the kernel range the capability runs on. The kernel
  refuses to compose a capability whose range does not admit it
  (`E_CAPABILITY_INCOMPATIBLE`, naming capability, range and kernel) wherever a
  soul resolves (spawn, `spawn --preview`, `inspect
  --soul`, operator commands). `oats inspect` shows each module's
  `compatibility: { ok, range, kernel }`; a home whose spawned module no longer
  admits the running kernel reports a `capability-incompatible` problem.
- `layer` is optional; when present it names which core capability this is
  (`knowledge`, `messaging` or `tasks`). A soul has at most one capability per
  slot.
- `skills` entries can be skill directories or roots containing skills.
- `inject` is optional instance instruction Markdown.
- The hooks are `spawn`, `launch` and `retire`. A hook is a
  command string, or `{ command, required }`. `required: true` is valid **only
  on `spawn`**: the hook's failure then fails the spawn and rolls it back,
  instead of producing an instance whose capability never configured itself —
  an aweb identity that could not be minted leaves an agent believing it can be
  woken by mail. Every other hook stays best-effort and only warns, so advisory
  work never becomes a spawn blocker. `launch` and `retire` cannot be
  required: they run outside a spawn transaction, so there is no moment to
  enforce them. A `soul-scaffold` hook is tolerated and ignored.
- A capability declaring a **required** spawn hook should declare a `retire` hook
  too. Without one, OATS has no way to undo what the spawn hook did and no way to
  know whether it did anything, so a failure quarantines the home rather than
  rolling it back — the operator cleans up by hand and removes it with `--force`.
- A required hook must also be **able** to run: a package capability the lock
  does not pin is refused at resolution (`E_PACKAGE_MISSING`, remedy `oats
  sync`), and drifted content is `E_PACKAGE_INTEGRITY`, so a required hook
  never silently fails to configure an instance.
- When a required hook fails and its compensation cannot finish, the instance
  home is **retained**, not deleted — it holds the credentials and metadata a
  retry needs, and removing it would turn a transient cleanup failure into
  permanent external residue. It is marked `.oats-rollback-incomplete.json`, so
  `oats status` reports it as retained state rather than a live instance, and
  `oats retire <instance>` retries the cleanup — re-running the retire hooks and
  the worktree removal, verifying both, and verifying (never deleting) the
  branch: a branch is deleted only with `--delete-branch`. A retry that still cannot
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
  escape hatch works. `--force` never skips work preservation, which runs
  before the retire hooks and refuses with `E_WORK_PRESERVATION_FAILED` when
  its recovery cannot be verified.
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
  - a **harness package** (`harness` + `package`, optionally `marketplace`),
    satisfied by that harness's own package manager — `npm:@scope/name` for pi,
    `plugin@marketplace` for Claude Code. It is raised only for deployments that use the named
    harness — a Claude-only deployment is never asked to install a pi package —
    and is verified in the harness's package list, never on `PATH`. A version
    selector is allowed and ignored for identity, so `@latest` and a pinned
    version are one requirement.
  A harness package is **verified at spawn, never installed there**: installing
  would mutate the operator's harness configuration without asking, in the
  middle of a spawn. A missing, uninstalled or disabled package fails the spawn
  with the consent command that fixes it.
- OATS never installs a host requirement silently. A missing host command is
  the operator's to install; `oats doctor` reports it. Consent to install is
  separate from declaring the package.
- `environment` lists the exact launch variables the capability may set;
  spawn hook output must be a subset and use the capability vendor prefix.
- Target names never appear in a package manifest.

`capability` is the only manifest identity field; it may also carry
`private: true` (a **repo-owned** capability: listed, but usable only by souls
of its own repo). The machine-readable contract is
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

# souls/release-manager/soul.yaml — the soul's own choices
capabilities:
  acme-release-tooling: { from: here }
  acme-deploy: { from: package }
  acme-house-style: off
knowledge:
  harvest: off                                        # this soul's knowledge-slot payload
```

Composition order: `defaults.<slot>` ⊕ `defaults.capabilities` ⊕
`soul.capabilities` — later wins, `off` removes, a soul `<slot>: none` drops
the workspace's slot default. Teams compose nothing, so a soul's composition
is the same for every person and machine. A resolved capability whose manifest says `layer: X` fills slot X; two for one slot are
`E_SLOT_CONFLICT`. Provider settings start from the manifest's own declared
defaults (`settings.<key>.default`, the lowest layer), then take the workspace's
`messaging` payload for the messaging slot, the soul's
slot payload, `oats-local.yaml` `settings.<cap>`, and `oats spawn --provider`,
deep-merged in that order. There are no agent types, no `global`, no
per-deployment activation or exclusion maps.

### Teams in the provider environment

A soul's teams here (the workspace's shared teams, `defaultTeam` and `souls:`, and
the deployment's `oats-local.yaml` `teams` and `defaultTeam` where the workspace
allows them — see [workspaces.md](workspaces.md#teams)) travel **beside** a
provider's settings, never inside them, in the environment of every hook, home
command and provider check:

- `OATS_DEFAULT_TEAM` — the soul's default label; `OATS_DEFAULT_TEAM_ID` — its
  provider id; `OATS_DEFAULT_TEAM_FROM` — `soul` (the soul's `souls:` default in
  the workspace file), `deployment` (the local `defaultTeam`) or `workspace` (the
  workspace's `defaultTeam`).
- No default configured: none of the three is set. An **unmapped** default (a
  shared team declared without an id): `OATS_DEFAULT_TEAM` and
  `OATS_DEFAULT_TEAM_FROM` are set and `OATS_DEFAULT_TEAM_ID` is not. What a
  provider does then is its own contract; a messaging provider typically
  refuses the spawn, naming the unmapped label, or saying no team is
  configured.
- `OATS_TEAMS` — JSON `[{label, team, default, from: "shared"|"local", via}]`:
  every mapped team the soul may be in here, the default included
  (`default: true`), default first, then by label; `via` says why
  (`default`, `workspace`, `local`). Eligible to join = the rows with
  `default: false`, and no other team: a provider refuses a join outside them.
  Unset when a home's teams are unknown (none recorded, and unreadable now).
- `OATS_TEAMS_SOURCE` — `live` (the workspace and `oats-local.yaml` read now, or
  a fresh resolution) or `recorded` (the spawn-time record). **A provider leaves
  a joined team only on a `live` list**: a recorded one lacks every change since
  the spawn.

The environment is their only channel: a check's stdin request stays the
released binding wire, which providers decode strictly. Joining a team other
than the default is the provider's explicit act (a spawn choice or a command at
any time); the kernel never joins anything.

For an existing home the teams are **live** where they are acted on: its launch
hook (`oats session start|restart`), its messaging module's commands and
`messaging:` operations (`oats operation run --home`), and `oats inspect
--home` read the workspace host and the deployment's `oats-local.yaml` as they
stand now — one repository read, never a discovery; `oats readiness --home`
takes them from the discovery it already runs. The home's modules and skills
stay as spawned. Every other capability command and operation gets the teams
the spawn recorded in `instance.json` (`teams`, `defaultTeam`), marked
`recorded`, at no remote cost; so does any read where the workspace cannot be
reached. A scheduled wake's session start uses the recorded teams, so its
launch hook leaves nothing; the next operator start or messaging command is
live.

## What an instance receives

Every spawned instance gets a **full copy** of each capability its soul
resolved to, under `<home>/.oats/modules/<capability>/` (manifest, `bin/`,
injects, skills), and those skills flat under `<home>/.agents/skills/<skill>/`
beside the soul's own, one level deep where harnesses discover them. Its generated `AGENTS.md` is the
soul's `AGENTS.md`, the kernel and work-mode blocks, then each module's inject
in name order. Two composed skills with one name fail the spawn
(`E_SKILL_DUPLICATE`). The harness then starts normally, with its own skill
discovery; the details are in [souls-and-instances.md](souls-and-instances.md).
Change a capability's inject or skills in its repository, then spawn a new
instance: the generated files are not a source.

See what a capability ships before any instance has it:

```bash
oats capabilities show oats.okf                          # inject path and size, each skill's files, problems
oats capabilities show oats.okf --file injects/okf.md    # one listed file's text
oats capabilities show nw-house-style --member github.com/nw/agents --json
```

`oats capabilities show <name>` reads one row of `oats capabilities` at that
row's commit (a package at its locked commit, after spawn's lock check): the
inject text exactly as committed, and each skill, enumerated as a spawn
enumerates it, with its description and files. `--file <path>` prints one
file the show lists (the inject or a skill file), and no other file of the
capability. Use `--member <repoKey>` or `--package <id>` when two rows share
the name. The JSON contract is in
[desktop-cli-api.md](desktop-cli-api.md#oats-capabilities-show).

Inspect a composition before it exists:

```bash
oats spawn release-manager --preview          # modules (from / commit / changedSince), teams + default, resolution revision
oats spawn release-manager --preview --json
```

## Distribution packages

A **package** is the versioned tier: a directory with an `oats-package.json`
that enumerates one or more capabilities (schema
[`oats-package.schema.json`](oats-package.schema.json)). It is pinned once in
the workspace's `packages:`, resolved to an exact commit + integrity by
`oats sync` into `oats-lock.json` (lockfileVersion 3); declaring it is the
workspace's decision to trust it. A soul names a package capability with
`from: package`. Everything about declaring, syncing, locking and publishing
packages is in [packages.md](packages.md). There is no installed
copy at a deployment and no `oats install`/`trust`/`update`/`remove`.

One package can carry capabilities meant for **different souls**. oats.okf
ships three:

- `oats.okf` fills every working soul's knowledge slot;
- `oats.okf-harvest` is composed only into its harvester soul;
- `oats.okf-maintenance` is composed only into its maintainer soul.

Each is its own manifest with its own skills, inject and commands. One pin
versions all three, together with the package's souls
([knowledge.md](knowledge.md#who-gets-which-okf-skills)). Split a package this
way when roles need different instructions: a soul composes only the
capability it names, so no role carries another's procedure.

## Member capabilities

A capability at `<member repo>/capabilities/<name>/oats.json` is discoverable
by every soul in the workspace (`oats capabilities` lists it with origin
`member <repo key> @ <commit>`) and is named with `from: <repo key>` — or
`from: here` by souls of the same repo. It is trusted by **membership**: the
repo's access control is the boundary and its latest default-branch state is
what is copied. `private: true` in the manifest makes it **repo-owned**: still
listed (`private: true`, marked "(repo-owned)"), but usable only from its own
repo (`E_CAPABILITY_PRIVATE` elsewhere). A member's `oats-package/` is **not** a member capability: it is
reported as `publishes` and consumed only as a package.

## Agents a capability needs

A capability declares no agents (a manifest `agents:` is refused with
`E_CAPABILITY_AGENTS_REMOVED`). Ship the agent as a soul: a **package soul**
beside the package's capabilities ([packages.md](packages.md#package-souls)),
such as oats.engineering's `code-reviewer` beside `oats.code-review`, or a **member soul** in a
member repository, using the capability `from: here`.

## Commands and hooks

Operational commands resolve only when their capability is one of the current
instance's modules (or the soul's resolved set). Workspace commands (`sync`,
`package`, `workspace status`, `capabilities`, `souls`, `doctor`) are always
available.

A manifest's `helperInjection` and a hook's `inputs` are tolerated and ignored.

Hooks receive:

- `OATS_EVENT`, `OATS_CAPABILITY`, `OATS_LAYER`, `OATS_LEVEL`;
- `OATS_INSTANCE`, `OATS_INSTANCE_HOME` (the home, absolute; `OATS_HOME` is a
  compatibility alias), `OATS_AGENT`, `OATS_SOUL`, `OATS_SOUL_ID`,
  `OATS_CONTEXT`, `OATS_WORKSPACE`, `OATS_ROOT`;
- `OATS_CLI_BIN` (the running kernel's `bin/oats.mjs`);
- `OATS_SETTINGS`, `OATS_SETTINGS_ORIGINS`, `OATS_META`;
- the team and workspace variables of
  [Teams in the provider environment](#teams-in-the-provider-environment),
  plus `OATS_WORKSPACE_NAME`, `OATS_WORKSPACE_KEY` and `OATS_TEAM_SCOPE`
  (the deployment directory). `OATS_TEAM_NAME` is always empty.

A spawn hook also gets `OATS_TASK`, `OATS_REPO`, `OATS_BRANCH`, `OATS_WORK`,
`OATS_HARNESS`, `OATS_KIND` and, for a spawn a trigger started,
`OATS_TRIGGER_EVENT_FILE`. A launch hook also gets `OATS_HARNESS` and
`OATS_PREVIOUS_HARNESS`, and `OATS_LAUNCH_PREVIEW=1` when it runs for a
preview (only a preview-aware hook does, below); on a real run
`OATS_LAUNCH_PREVIEW` is not set.

`OATS_SETTINGS_ORIGINS` says where each leaf of
`OATS_SETTINGS` came from: a JSON object from a JSON pointer to `{ kind, at }`,
`kind` being `manifest-default`, `workspace`, `soul`, `host`, `spawn` or
`anchor` (the last layer that set it), e.g.
`{"/harvest":{"kind":"soul","at":"soul.yaml#/knowledge"}}`. A provider tells a
soul-set value from a host-set one there, and never reads `soul.yaml` for it;
a home with none recorded gives `{}`. A final JSON line may return `meta`,
`brief`, `warning`, or harness-specific `launch` arguments; a preview-aware
launch hook's preview answer may add `volatileEnv` (below). A **spawn or
launch hook** may also return an `env` object for the launched process;
returning `env` from a retire hook is an explicit contract error.

A **launch hook** runs at every start and restart of a home for each provider
recorded at spawn (under its recorded settings). Its `launch` arguments and
`env` replace that provider's previous contribution whole. Its `meta`, when
returned, replaces that provider's entry in `instance.json.capabilityMeta`
after the start succeeds — the same record the spawn hook wrote and the retire
hook later reads as `OATS_META` — so a provider that re-issues a credential at
start (a renewed session grant, for example) leaves the CURRENT one on record. A
launch hook that answers without `meta` keeps its previous entry; a start whose
preparation fails changes nothing.

A launch hook may do idempotent provider registration on a real start (an
aweb home registering with the host wake broker, for example). How the
kernel runs it depends on whether its capability declares **preview
awareness**: `"launchPreview": true` at the top level of its manifest. The
kernel reads the declaration from the home's own module copy, so a home keeps
the behaviour of the module it was spawned with.

**A preview-aware hook** must change nothing under `OATS_LAUNCH_PREVIEW=1`,
and must return the same contribution (`launch` arguments and `env`) as for
a real start. It runs twice per start:

1. **As a preview, under `OATS_LAUNCH_PREVIEW=1`.** The start's preflight uses
   this contribution: trust, environment ownership, the harness-package
   probe and the rendered command. `oats launch-config preview` (which
   Desktop's start dialog uses) runs only this pass.
2. **For real, without the flag.** This pass runs only once preflight has
   passed, including the check that the home is not already running
   (`E_SESSION_RUNNING`), and before a restart stops the running harness.

The real run's `meta` and warnings are what the start records. If its
contribution differs from its preview contribution, the start is refused
with `E_LAUNCH_PREPARATION` and nothing is stopped or started.

Some values only a real run can know, such as a credential minted at start.
A preview answer may list those names in `volatileEnv` (for example
`"volatileEnv": ["AWEB_IDENTITY_HOME"]`, beside `env`). For those names:

- The start takes the values from the real run, records them, and renders
  the launch command again with them.
- The comparison leaves those values out. Everything else must still be
  identical.

Each name must be one the same hook returned in `env`. Preflight sees only
the preview's value, so a volatile name must not affect how the harness
resolves its packages. The kernel refuses (`E_LAUNCH_PREPARATION`) a volatile
`CLAUDE_CONFIG_DIR`, `CODEX_HOME` or `PI_CODING_AGENT_DIR`. It reads
`volatileEnv` only from a preview answer and never records it.

**A hook that does not declare preview awareness** runs once per start, for
real, during preflight, before the checks that use its contribution. A
refused start may therefore already have run it. `oats launch-config preview`
never runs it. The preview shows that capability's recorded contribution, and
its `capabilities` check says the hook was not run.

`launchPreview` is a top-level key so that a kernel older than 0.37 ignores
it and runs the hook once, as it always did. A key inside the hook's
declaration would make such a kernel refuse the whole package.

Hook environment values are strings, at most 8192 UTF-8 bytes, with no NUL or
newlines. Names use the portable environment grammar and must belong to an
unambiguous vendor namespace. Only a dotted capability ID participates: its
component before the first `.` must be lowercase alphanumeric. Thus `aweb.*`
may contribute only `AWEB_*`; `aweb@evil` and `aweb/evil` are not vendor forms
for this contract. Hyphenated vendors are also excluded because translating a
hyphen to `_` would let `aweb-evil.*` collide with names already inside
`aweb.*`'s `AWEB_*` namespace.

Hook environment values must not be secrets. A codex launch also passes them
to Codex as command-line arguments (`-c shell_environment_policy.set.<NAME>=…`,
so its tool commands see them), and any local user can read those. A secret
reaches a launch through a launch configuration's environment reference.

A manifest's `settings.<key>` may carry `hostOnly: true`. Such a
key is a fact about the machine — a custody directory, a state root — and the
resolver accepts it only from the deployment's own `oats-local.yaml`
`settings.<capability>`; a committed workspace or soul file or a
`--provider` flag carrying it is refused (`E_WORKSPACE_SCHEMA`, reason
`host-only-key`).
Declare it for any key whose value points at something a committed file must
never be able to choose.

A hook may return only names in its manifest's exact `environment` declaration.
For package capabilities that declaration is part of the integrity-locked tree
the workspace declared; for member capabilities it is part of what membership
trusts. Undeclared output is fatal. This positive authority is the contract
boundary — adding a new launch variable requires a visible manifest change
(and, for a package, a new version, reviewed as a new pin).

`OATS_*`, `PI_AGENT_*`, kernel launch variables, and known shell/bootstrap/loader
names are also rejected as defense in depth. The denylist includes current Node,
JVM, .NET, Python, Perl, Ruby, Lua, PHP, ELF, and dyld surfaces, but is explicitly
not the authority boundary: harness bootstrap names are open-ended, so the
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

The environment prefix applies to the harness process (pi, Claude Code or
Codex). `--no-launch` validates command preparation but launches no harness.
The fallback shell after that process exits does not inherit command-scoped
assignments; `oats session start|restart` runs the launch hooks again. The
generated command is persisted; hooks must contribute locators, selectors, or broker endpoints—not
bearer tokens or private key material. An instance-lifetime local principal may
be selected by a home locator. A replaceable execution serving a durable global
identity must instead use a custody/action broker or equivalent narrow adapter;
this mechanism must never copy or expose that global identity's root keys to the
worker process. Session-scoped execution credentials need a separate lifecycle
and must not be encoded into this persisted spawn command.

Spawn order is by capability name; retirement reverses successful
spawn order. Hooks run from the instance's own copy
(`<home>/.oats/modules/<cap>/`).

## Official packages

The official packages and the capabilities and souls each carries are listed
in the [official catalog](official-catalog.md#the-packages). Each is pinned by a bare version in
`packages:`; each package repository is also a member of the OATS workspace,
carrying its expert soul. The framework's own souls say
`oats.okf: { from: package }`: membership never turns a package into a
latest-state capability.

### oats.core: needs input

oats.core (2.4.0 and later, kernel 0.40.0 and later) tells the deployment
when an instance is blocked on a human, in two independent ways. Each shows
on `oats status` and in `oats instance events`. The verbs' contract
(`oats instance waiting`, `oats instance attention`, the `waiting` event) is
in [desktop-cli-api.md](desktop-cli-api.md#waiting-on-you). Claims are
display-only: nothing in the kernel acts on them.

**The agent's own claim.** The oats.core inject and `/oats-operate` teach
every instance this protocol. When it has asked a human something and cannot
continue without the answer, it runs
`oats instance attention --message "<one line>"` from its home and ends its
turn. Once it has the answer, it runs `oats instance attention --clear`. The
claim belongs to producer `agent`. Only `--clear` or the next session start,
restart or stop clears it. The message is one line of at most 200
characters; control characters, the Unicode line and paragraph separators,
bidi controls (U+202A–202E, U+2066–2069), U+200B, U+2060, U+FEFF and tag
characters (U+E0000–E007F) are refused, and everything else (emoji ZWJ
sequences, ZWNJ, LRM, RLM, ALM) is allowed.

**The Claude Code emitter.** For a Claude instance, oats.core's spawn and
launch hooks (`bin/oats-core.mjs`, preview-aware) write Claude Code hooks
into the home's project settings, `<home>/.claude/settings.json`. Each one
runs `bin/claude-waiting.sh` from the home's module copy, which calls
`oats instance waiting set|clear --producer oats.core`:

| Claude Code event | Matcher | Action |
| --- | --- | --- |
| `Notification` | `permission_prompt` | set `permission` |
| `Notification` | `elicitation_dialog` | set `question` |
| `PreToolUse` | `AskUserQuestion` | set `question` |
| `PreToolUse` | `^(?!AskUserQuestion$).*` (every other tool) | clear, unless a subagent made the call |
| `PostToolUse` | `*` | clear, unless a subagent made the call |
| `PostToolUseFailure` | `*` | clear, unless a subagent made the call |
| `UserPromptSubmit`, `Stop`, `SessionEnd` | none | clear, not debounced (a turn boundary) |

Claude Code shows an AskUserQuestion through its permission dialog, so that
dialog's own `permission_prompt` follows the question's set: the script keeps
the current reason in its marker, and a permission prompt never relabels an
open question. A granted tool that fails fires `PostToolUseFailure`, not
`PostToolUse`, so that clears too.

**Subagents' tool calls do not clear.** Background and parallel subagents
in the same session fire the same tool hooks, so the main thread's prompt
could be cleared while the human is still on it. On Claude Code 2.1.288 a
subagent's tool event carries a top-level `agent_id` (main-thread events
have none), so a tool clear reads the hook's JSON input and skips the clear
when it finds one. The read happens only when there is a claim to clear,
takes at most 64 KiB and 1 s, and looks only at the text before
the first `"hook_event_name"`: a string value escapes its quotes, so that
text holds top-level keys only. Anything else (no key, an input cut short,
another key order, nothing read) means the main thread, and the clear goes
ahead. A permission `Notification` carries no `agent_id` and no tool id,
even when a subagent asked, so a claim never knows who set it.

**A refused permission prompt is not observable.** On Claude Code 2.1.288,
answering "No" at a permission prompt interrupts the turn and fires no hook
(no `PostToolUse`, `PostToolUseFailure`, `PostToolBatch` or `Stop`; probed).
Claude then waits for the human ("What should Claude do instead?"), and the
claim stays, still labelled `permission`, until the human's next prompt
clears it.

- **Its own entries only.** oats.core marks its entries by the absolute
  path of its `claude-waiting.sh`. Each run removes only the entries that
  name that path (and any matcher group or event array the removal
  empties), then appends its current ones. Every other key and entry stays
  as it was, in order. The file is written atomically, mode 0600, and only
  when its content changes. A temp file an interrupted write left behind
  (`.claude/.settings.json.oats-core-<pid>-<ms>.tmp`) is removed by the next
  spawn or start once its writer is gone, so it needs no retirement
  exclusion. If the file is a symlink, not a regular file,
  not valid JSON, or not a JSON object with a well-formed `hooks` map,
  oats.core leaves it alone and warns. The same applies when `.claude` is a
  symlink or not a directory.
- **When it writes.** It writes at spawn, because `oats spawn` runs no
  launch hook, and at every `oats session start|restart`, so the node and
  CLI paths it bakes in follow the current kernel. A launch preview writes
  nothing. Every pass answers `{}`: no launch arguments and no env. Codex
  and pi homes get nothing.
- **It never hurts the session.** Claude Code reads a hook's stdout and exit
  code as decisions. So every command runs the script through `/bin/sh`
  with stdout and stderr on `/dev/null` and ends in `; exit 0`, under a 5 s
  Claude hook timeout. Stdin, Claude's JSON input, reaches the script, which
  moves it to a private descriptor and detaches its own stdin, stdout and
  stderr first. It reads the input only for a tool clear, bounded as above,
  always exits 0, and kills the CLI after 2 s: with no call starting 2 s
  after the hook began, the worst case is about 4 s, well under Claude's 5 s
  hook timeout.
- **Debounce.** The script keeps private state outside the home, in a file
  per home: `<dir>/<first 16 hex of sha256(home)>.claude`, where `<dir>`
  is per user: `$XDG_RUNTIME_DIR/oats-waiting` when that is set and
  absolute, else `$TMPDIR/oats-waiting-<uid>` when `TMPDIR` is absolute,
  else `/tmp/oats-waiting-<uid>`. The spawn and launch
  hook computes that path and vets the directory once: it creates it 0700
  and uses it only when it is a real directory the user owns, mode exactly
  0700, with no ACL (also one macOS shows only as `@`). An existing directory
  is never changed. The hook passes the marker path to every command (or
  `''` when the directory is refused), so the script, which runs on every
  tool call, needs no `ls` or hash: it only re-checks that the directory is
  still a real directory the user owns (only the user could have changed its
  mode since). The marker holds the latest intent (`permission`, `question`
  or `clear`), `<marker>.applied` what the CLI last recorded, and
  `<marker>.lock` is the reconciler's lock. A tool clear when both say clear
  (and no forced call is due) does nothing and starts no node process, so
  the hooks that fire on every tool call cost a `/bin/sh` and a few file
  reads. The turn-boundary clears (`UserPromptSubmit`, `Stop`,
  `SessionEnd`) are not debounced: each gets a CLI call (see Order and
  retry), a node process per prompt and per stop. A symlink is never followed. An
  unusable marker (a refused, missing or replaced directory, a state path
  that is not a regular file, a lock path that is not a directory) means no
  debounce: set and clear then always call the (idempotent) CLI. The launch
  hook resets the state at every spawn and start, as the kernel's session
  boundary voids the claims. The script runs the CLI from the home, so its
  cwd never matters.
- **Order and retry.** Each event writes its intent to the marker at once,
  so the marker is always the latest intent. Then, if the lock is free, it
  reconciles: one process at a time brings the recorded claim to the latest
  intent, re-reading it after each CLI call (at most 3), so the calls land
  in the order the events came, whatever their speed. Before each call it
  records the claim as `unknown`, and records the intent only once the call
  succeeds: a call that fails or is killed may still have written the claim
  (the kernel writes the home log before the workspace log), so the next
  event always calls the CLI after one. An event that finds the lock held
  never waits: it exits, and the holder applies its intent on its next
  read, or on the read it makes after letting the lock go. The lock is a
  directory holding its holder's token (pid and start time); one whose
  holder is gone (pid dead, or taken over 5 s ago, past Claude's hook
  timeout, which also covers a reused pid and a machine that slept) is
  broken by the next event, as is one a minute old with no pid yet.
  Reapers take turns under a second lock, `<marker>.lock.reap`, and judge
  the lock again there, so a stale judgement never removes the lock another
  reaper has just taken; a reap lock a minute old (a reaper killed in its
  instant) is removed. A holder records a call and lets the lock go only
  while the lock still holds its token. A failed call, or a reconciliation
  the time budget stops (no call starts 2 s after the hook began), leaves
  the recorded claim and the intent apart, and the next event finishes it.
  A turn-boundary clear writes `<marker>.force` beside its intent; the call
  that next applies the intent consumes it. A turn-boundary clear gets a CLI
  call: from that hook, or, if another hook holds the lock, from that holder
  if it still has time; otherwise from the next event. The state files are
  only ever deleted by the launch hook.
- **It never touches the agent's claim.** The script only ever passes
  `--producer oats.core`.
- **Not "unknown work" at retirement.** Harness project settings in the home
  are configuration, not work: the retirement fingerprint of a home ignores
  exactly `.claude/settings.json`. oats.core writes it at spawn before the
  retirement baseline is taken, and again at every start.

**Why the project settings file, not `--settings`.** On Claude Code
2.1.288, Claude honours only the last `--settings` flag on a command line:
that file replaces earlier ones wholesale, even one with no hooks. The
project `.claude/settings.json` composes with the user's settings (under any
`CLAUDE_CONFIG_DIR`) and with a `--settings`. So any capability that needs
Claude settings uses the same managed `<home>/.claude/settings.json` with
its own marker, never `--settings`. oats.core leaves
`.claude/settings.local.json` to Claude Code, which writes its "don't ask
again" permission rules there.

**Limits.**

- If the user's Claude configuration sets `disableAllHooks` or
  `allowManagedHooksOnly`, the emitter's hooks never run, so there is no
  claim: the waiting state reads null, not "not waiting".
- The kernel's write is not fenced against an obsolete writer
  ([#568](https://github.com/awebai/oats/issues/568)), so two rare paths can
  leave the claim wrong while the emitter's state says it is right; the next
  tool clear then skips it. (1) A hook suspended past 5 s mid-call (the
  machine slept, the process was stopped) has its lock broken, and its call
  can land after its successor's. (2) A reaper killed at a precise instant
  can leave a reap lock that two later hooks remove at once, letting two
  reconcilers run. Either can show a claim when nothing waits, or hide a
  question. A turn-boundary clear gets a CLI call: from that hook, or, if
  another hook holds the lock, from that holder if it still has time;
  otherwise from the next event. So a wrongly shown claim lasts until the
  end of the turn, or, if the turn's last hook found a reconciliation out
  of time, until the next event (the human's next prompt). A hidden
  question lasts until the human answers it (their prompt or the answer's
  tool event clears it).
- If the marker and the claim disagree (someone deleted the marker by hand,
  say), a stale claim can remain until the turn ends, or the next set or
  clear or session boundary.
- When a subagent asks for permission and the human approves, the
  subagent's own tool events are skipped too, so the claim stays until the
  next main-thread event: the main thread's next tool call, the subagent's
  completion (Claude submits it as a `<task-notification>` prompt), a
  `Stop` or the human's prompt. A foreground subagent holds the main thread
  until it finishes, so after its prompt is approved the claim can last the
  whole subagent run. That shows "needs input" too long, never hides a real
  block.
- A `Stop` or `UserPromptSubmit` always clears, even one the main thread
  produces while a subagent's prompt is open (a background subagent's
  completion is submitted as a prompt).
- A Claude instance spawned before the upgrade gets the emitter only when
  it is respawned. Its launch hook comes from its recorded module copy.

## Operations a capability declares

A manifest may declare `operations`: named actions or views that a GUI, a
schedule or an operator invokes without knowing the provider.

```json
"operations": {
  "harvest": { "kind": "action", "command": "harvest", "context": "home", "description": "Promote this instance's notes" },
  "inspect": { "kind": "view",   "command": "inspect", "context": "home", "description": "Show this instance's working knowledge" }
}
```

- `command` names one of the manifest's `commands`. `kind` is `action`
  (default) or `view`; `context` is `home` (default: runs in an instance
  home) or `scope`.
- Optional `args` declare `{ name, flag, required, description }`; the runner
  passes `--arg name=value` as those flags and refuses unknown or missing
  required ones.
- A view answers `{ documents: [{ label, kind: "markdown"|"text", path?, text? }], summary? }`;
  the kernel validates that shape and relays it.

`oats inspect --json` lists each operation with its availability.
`oats operation run <layer>:<name> (--home <abs> | --soul <name>) [--arg k=v …] --json`
resolves the provider that fills `<layer>` for the subject and runs its
command exactly as `oats <namespace> <command>` would, with the hook
identity variables of that subject and the invoking process's own identity
removed. It refuses an undeclared operation (`E_OPERATION_UNKNOWN`), a slot
with no provider or a home operation without `--home`
(`E_OPERATION_UNAVAILABLE`), and a missing host command
(`E_CAPABILITY_REQUIRES`).

The provider must exit 0 with exactly one JSON envelope on stdout. Otherwise
the outcome is **unconfirmed**: `E_OPERATION_TIMEOUT` (after 240 s) or
`E_OPERATION_RESULT`, with `error.details { unconfirmed: true, exit, envelope?, stderr? }`.
A provider's own `ok: false` is relayed with its code. A schedule of kind
`operation` runs the same command ([schedules.md](schedules.md)). The JSON
shapes are in [desktop-cli-api.md](desktop-cli-api.md#inspect-readiness-and-operation-run-on-the-workspace-model-operationsapi-2-soulsapi-2-readinessapi-2-oats-0260).

## Readiness check (`binding.check`)

A slot provider (knowledge, messaging, tasks) that declares `binding` in its
manifest is asked by `oats readiness` whether it is ready for the subject. The
subject is an instance home (`--home`) or a soul (`--soul`). The command named
by `binding.check` receives one request and answers once. The kernel relays
that answer to consumers as it came: readiness `providers` items. For the
consumer side, see [desktop-cli-api.md](desktop-cli-api.md#oats-readiness---home-----soul----dir----policy---json--readinessapi-2).
This check reads configuration only; it binds nothing and does not change a
spawn's fail-closed hooks.

```json
"commands": { "binding-check": "bin/my-provider.mjs binding-check" },
"binding": { "version": 1, "normalize": "binding-normalize", "bind": "binding-bind", "check": "binding-check" }
```

**Invocation.** The kernel runs the command's script with `node`, from the
module directory. That is the home's module copy for `--home`, or the
deployment's verified module store for `--soul`. The script must resolve inside
the module and be a regular file. The command's words after the script are
passed as arguments; no shell is involved.

**Request** — one JSON document on stdin:

```json
{"schemaVersion":1,"phase":"check","slot":"messaging","capability":"my.provider",
 "settings":{"root":"/srv/aw"},
 "input":{"context":{"kind":"workspace","workspace":"github.com/acme/agents","deployment":"/srv/acme",
                     "soul":"release-manager","instance":"release-manager-1",
                     "home":"/srv/acme/agents/release-manager/instances/release-manager-1"},
          "action":{"kind":"readiness"}}}
```

- `slot` is the manifest's `layer`.
- `settings` is the merged provider payload: the one the spawn recorded for a
  home, or the one the resolution computes for a soul.
- The request has exactly these keys; a provider may decode it strictly. The
  soul's teams (see [Teams in the provider environment](#teams-in-the-provider-environment))
  are not on stdin: the check reads them from `OATS_DEFAULT_TEAM*`, `OATS_TEAMS`
  and `OATS_TEAMS_SOURCE`.
- `instance` and `home` are `null` for a soul subject.

**Environment:**
- Every ambient `OATS_*`, `OAS_*` and `PI_*` variable is removed. Other
  variables pass through.
- The kernel sets:
  - `OATS_CAPABILITY`, `OATS_SETTINGS` (the payload as JSON) and
    `OATS_SETTINGS_ORIGINS` (where each leaf came from, as hooks get it);
  - `OATS_CLI_BIN`;
  - `OATS_WORKSPACE` (the deployment);
  - the team variables `OATS_DEFAULT_TEAM`, `OATS_DEFAULT_TEAM_ID`,
    `OATS_DEFAULT_TEAM_FROM`, `OATS_TEAMS`, `OATS_TEAMS_SOURCE` (see
    [Teams in the provider environment](#teams-in-the-provider-environment)),
    `OATS_TEAM_SCOPE`, `OATS_TEAM_NAME`, `OATS_WORKSPACE_NAME` and
    `OATS_WORKSPACE_KEY`;
  - `OATS_AGENT` (the soul);
  - `OATS_SOUL`, the soul directory: a home's recorded one, or for a soul
    (`readiness --soul`, `inspect --soul`) its copy at the resolved commit,
    which the kernel materialises first as a spawn would (0.30; a copy that
    cannot be made fails readiness under `installed`, producer `soul copy`).
    An operator command (`oats <namespace> … --soul <name>` from the
    deployment) gets the soul's source at the resolved commit too: the copy a
    spawn left under the agents root, else a temporary copy removed when the
    command ends. A soul that cannot be read refuses the command; it never
    runs without `OATS_SOUL`;
  - for a home, `OATS_INSTANCE` and `OATS_INSTANCE_HOME`.
- `OATS_TEAM_SCOPE` is the deployment directory; `OATS_TEAM_NAME` is always
  empty.

**Answer** — exit 0, and exactly one JSON document on stdout (whitespace
around it is fine; progress text is not):

```json
{"schemaVersion":1,"phase":"check","slot":"messaging","capability":"my.provider","ok":true,
 "result":{"status":"ready","problems":[],"warnings":[{"code":"e2ee-disabled","message":"end-to-end encryption is off for this team"}]}}
```

- **The envelope** has exactly these keys. `schemaVersion`, `phase`, `slot`
  and `capability` echo the request.
- **A refusal** is `{…, "ok": false, "error": {"code", "message"?}}`.
  Readiness shows it as `unknown`, with your code.
- **`status`** is one of four values, and maps to the readiness item as
  follows:

  | `status` | readiness item | use it when |
  |---|---|---|
  | `ready` | `pass` | nothing is missing; `problems` must be `[]` |
  | `needs-configuration` | `fail` | a setting or host resource is missing |
  | `authorization-required` | `fail` | the operator must log in or grant access |
  | `unavailable` | `unknown` | you cannot tell right now (a service is down) |

- **`problems`** is a list of `{code, message}` strings. The codes are yours;
  they are not matched against `binding.reasons`. The first message becomes
  the item's reason.
- **`warnings`** is optional: `{code, message}` strings, relayed as they come.
  A warning never changes the status or the readiness summary.
- **Anything else is `unknown`** (`provider-unavailable`): a nonzero exit, two
  documents, unknown keys, a wrong echo, or `ready` with problems.

**Time.** Each check gets at most 30 s and is killed after that. All provider
checks in one readiness read share 60 s, and checks the budget does not reach
are not run (`unknown`, `time-budget-exhausted`). Answer from configuration
and local state. A provider that must call a remote service should bound that
call well inside the 30 s.
