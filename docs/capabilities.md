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
  `oats team-chat auth`.
- `compatibility.oats` is the kernel range the capability runs on. The kernel
  refuses to compose a capability whose range does not admit it
  (`E_CAPABILITY_INCOMPATIBLE`, naming capability, range and kernel) wherever a
  soul or capability agent resolves (spawn, `spawn --preview`, `inspect
  --soul`, operator commands). `oats inspect` shows each module's
  `compatibility: { ok, range, kernel }`; a home whose spawned module no longer
  admits the running kernel reports a `capability-incompatible` problem.
- `layer` is optional; when present it names which core capability this is
  (`knowledge`, `messaging` or `tasks`). A soul has at most one capability per
  slot.
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
  enforce them. The kernel no longer runs `soul-scaffold` (it ran when
  `oats create` wrote a soul); a manifest may still declare it.
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
of its own repo) and `team: <label>`
(the one workspace team label it is listed under; without it, the primary of
its repository's default). The machine-readable contract is
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
`defaults.byTeam[<label>]` for each of the soul's team labels, in order ⊕
`soul.capabilities` — later wins, `off` removes, a soul `<slot>: none` drops
the workspace's slot default. Two labels that give one capability different
entries are `E_TEAM_CONFLICT`, naming both labels; identical entries are fine,
and a capability the soul names itself settles it (the soul's entry wins). A resolved
capability whose manifest says `layer: X` fills slot X; two for one slot are
`E_SLOT_CONFLICT`. Provider settings start from the manifest's own declared
defaults (`settings.<key>.default`, the lowest layer), then take the workspace's
`messaging` payload (its base: no `byTeam` entry is merged, per teams
amendment K) for the messaging slot, the soul's
slot payload, `oats-local.yaml` `settings.<cap>`, and `oats spawn --provider`,
deep-merged in that order. There are no agent types, no `global`, no
per-deployment activation or exclusion maps.

### Several team labels

A soul's `team` (or its repository's default in `oats-membership.yaml`) is a
label or a non-empty list of distinct labels; the first is the **primary**:

```yaml
# souls/release-manager/soul.yaml
schemaVersion: 2
name: release-manager
description: Cuts and ships releases.
work: worktree
team: [engineering, reviewers]
```

- `OATS_TEAM_LABEL` is the primary label. The merged messaging payload takes
  **no** label's `byTeam` entry, the primary's included (teams amendment K), so
  `OATS_TEAM_ID` (the payload's `team`) is the personal team a host, soul or
  spawn set; empty means the provider's default.
- Every label is an **eligible team**: the kernel hands the messaging provider
  `teams`, one `{ label, team, mapped, payload }` per label in order. `payload`
  is `workspace.messaging` ⊕ `byTeam[<label>]` when the workspace maps the
  label (`team` is then its team id), else the base alone with `mapped: false`
  and `team: null`. A soul with no label gets `[]` (personal only).
- `teams` travels **beside** a provider's settings, never inside them:
  `OATS_TEAMS` (the JSON), `OATS_TEAM_LABELS` (comma-joined) and
  `OATS_TEAMS_SOURCE` in the environment of every hook, home command and
  provider check. The environment is their only channel: a check's stdin
  request stays the released binding wire, which providers decode strictly.
  The variables are empty (not `[]`) when a home's teams are unknown.
- `OATS_TEAMS_SOURCE` is `live` (read from the workspace now, or a fresh
  resolution) or `recorded` (the spawn-time list). **A provider leaves a joined
  team only on a `live` list**: a recorded one lacks every team mapped since
  the spawn, so acting on it could drop a valid membership.
- Joining an eligible team is the provider's explicit act (a spawn choice or a
  command at any time); the kernel never joins anything.
- For an existing home the teams are **live** where they are acted on: its
  launch hook (`oats session start|restart`), its messaging module's commands
  and `messaging:` operations (`oats operation run --home`), and `oats inspect
  --home` read the soul's labels and the workspace's `messaging` as they stand
  now — two repository reads (the workspace host, the soul's own repo), never a
  discovery; `oats readiness --home` takes them from the discovery it already
  runs. The home's modules and skills stay as spawned. Every other capability
  command and operation gets the teams the spawn recorded in `instance.json`
  (`teams`), marked `recorded`, at no remote cost; so does any read where the
  workspace cannot be reached.
- **Known limitation (0.26.0):** a scheduled wake's session start uses the
  recorded teams (`OATS_TEAMS_SOURCE=recorded`), so its launch hook leaves
  nothing; the next operator start or messaging command is live.
- A label in the workspace's `teams:` but not in `messaging.byTeam` is a
  discovery warning (`unmapped-team-label`, one per label naming its souls); a
  label not in `teams:` at all is the `E_TEAM_UNKNOWN` problem.

## Exact harness composition

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
`oats sync` into `oats-lock.json` (lockfileVersion 3); declaring it is the
workspace's decision to trust it. A soul names a package capability with
`from: package`. Everything about declaring, syncing, locking and publishing
packages is in [packages.md](packages.md). There is no installed
copy at a deployment and no `oats install`/`trust`/`update`/`remove`.

One package can carry capabilities meant for **different souls**. oats.okf
4.0.0 ships three:

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

## Capability-defined agents

A manifest may declare `agents: ["agents/<name>"]` — package-relative soul
directories (`soul.yaml` + `AGENTS.md` directly inside). *(Open thread: under
the workspace model these are re-based on member souls — a package repo's
expert soul is an ordinary `souls/<name>-expert/` in the member; the classic
lookup still exists for 0.24 layouts.)* From kernel 0.28.0, **package souls**
replace them ([packages.md](packages.md#package-souls)); the
`agents:` path is removed after oats.okf 4.0.0, the last package using it, is
mirrored.

## Commands and hooks

Operational commands resolve only when their capability is one of the current
instance's modules (or the soul's resolved set). Workspace commands (`sync`,
`package`, `workspace status`, `capabilities`, `souls`, `doctor`) are always
available.

A manifest's `helperInjection` and a hook's `inputs` are **ignored since 0.26**:
they served the captured path (removed in 0.26), are still accepted so that
existing manifests load, and change nothing.

Hooks receive `OATS_EVENT`, `OATS_CAPABILITY`, `OATS_LAYER`, `OATS_INSTANCE`,
`OATS_HOME`, `OATS_AGENT`, `OATS_SOUL`, `OATS_CONTEXT`, `OATS_WORKSPACE`,
`OATS_ROOT`, `OATS_LEVEL`, `OATS_SETTINGS`, and `OATS_META`. A final JSON line may
return `meta`, `brief`, `warning`, or harness-specific `launch` arguments. A
**spawn hook only** may also return an `env` object for the launched process;
returning `env` from retire or soul-scaffold is an explicit contract error.

A **launch hook** runs at every start and restart of a home for each provider
recorded at spawn (under its recorded settings). Its `launch` arguments and
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
`settings.<capability>`; a committed workspace or soul file (every
`messaging.byTeam` entry of a label the soul carries included) or a
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

The environment prefix applies to the initial Pi or Claude process. `--no-launch`
validates command preparation but launches no harness. The fallback shell
after that process exits does not inherit command-scoped assignments, and OATS
has no restart command or replay policy yet. The generated command is persisted
as before; hooks must contribute locators, selectors, or broker endpoints—not
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

| Capability | Kind | Provides | Package |
|---|---|---|---|
| `oats.core` | additive | day-to-day OATS operation for an instance | `oats.framework` |
| `oats.setup` | additive | whole-architecture knowledge for an onboarding expert | `oats.framework` |
| `oats.okf` | knowledge core capability | External owned OKF bases, durable notes/record custody, independent judgment and inspection | `oats.okf` |
| `oats.aweb` | messaging core capability | aweb identity lifecycle and messaging skills | `oats.aweb` |
| `oats.jira` | tasks core capability | Jira task protocol via `acli` | `oats.jira` |
| `oats.linear` | tasks core capability | Linear GraphQL task commands and workflow | `oats.linear` |
| `oats.authoring` | additive | capability, skill, and soul authoring guidance | `oats.authoring` |

Each is pinned by a bare version in `packages:` and resolved through the
[official catalog](official-catalog.md); each package repo is also a member
of the OATS workspace carrying its expert soul (`okf-expert`, `aweb-expert`, …).
The framework's own souls say `oats.okf: { from: package }` — membership never
turns a package into a latest-state capability.

## Operations a capability declares

A manifest may declare `operations` (named actions or views delegating to
its own commands) that a GUI or a schedule invokes through `oats operation
run <layer>:<name>`; `oats inspect --json` reports them with availability.
See [docs/design/operations-contract.md](design/operations-contract.md).

## Readiness check (`binding.check`)

A slot provider (knowledge, messaging, tasks) that declares `binding` in its
manifest is asked by `oats readiness` whether it is ready for the subject. The
subject is an instance home (`--home`) or a soul (`--soul`). The command named
by `binding.check` receives one request and answers once. The kernel relays
that answer to consumers as it came: readiness `providers` items. For the
consumer side, see [desktop-cli-api.md](desktop-cli-api.md#oats-readiness---home---soul---dir---policy---json-readinessapi-2).
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
 "settings":{"team":"acme:eng","root":"/srv/aw"},
 "input":{"context":{"kind":"workspace","workspace":"github.com/acme/agents","deployment":"/srv/acme",
                     "soul":"release-manager","team":"engineering","instance":"release-manager-1",
                     "home":"/srv/acme/agents/release-manager/instances/release-manager-1"},
          "action":{"kind":"readiness"}}}
```

- `slot` is the manifest's `layer`.
- `settings` is the merged provider payload: the one the spawn recorded for a
  home, or the one the resolution computes for a soul.
- The request has exactly these keys; a provider may decode it strictly. The
  soul's eligible teams (see *Several team labels*) are not on stdin: the check
  reads them from `OATS_TEAMS` / `OATS_TEAMS_SOURCE` / `OATS_TEAM_LABELS`.
- `context.team` is the soul's primary team label, or `null`.
- `instance` and `home` are `null` for a soul subject.

**Environment:**
- Every ambient `OATS_*`, `OAS_*` and `PI_*` variable is removed. Other
  variables pass through.
- The kernel sets:
  - `OATS_CAPABILITY` and `OATS_SETTINGS` (the payload as JSON);
  - `OATS_CLI_BIN`;
  - `OATS_WORKSPACE` (the deployment);
  - the team variables `OATS_TEAM_ID` (the messaging payload's `team`: the
    personal team if one is set; empty = the provider's default),
    `OATS_TEAM_SCOPE`, `OATS_TEAM_LABEL`, `OATS_TEAM_NAME`,
    `OATS_TEAM_LABELS`, `OATS_TEAMS`, `OATS_TEAMS_SOURCE`, `OATS_WORKSPACE_NAME` and
    `OATS_WORKSPACE_KEY`;
  - `OATS_AGENT` (the soul);
  - `OATS_SOUL` when the soul directory is known;
  - for a home, `OATS_INSTANCE` and `OATS_INSTANCE_HOME`.
- A home's `OATS_WORKSPACE_NAME` is `""` until spawn records the workspace
  name.

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
