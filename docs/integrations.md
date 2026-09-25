# Integrations: binding an implementation to a contract

An **integration** is a capability package selected to fill one exclusive
slot: `knowledge`, `messaging` (the communication contract), or `tasks`.
The contracts themselves are in [the OATS contracts](layers.md); this
document is about choosing an implementation, and about building one.

Read [capability packages](capabilities.md) first for manifests, acquisition,
targeting, instance-local composition, locks, trust, hooks, and commands.

## The slots

For each soul, OATS resolves zero or one implementation per slot:

| Slot | Contract | Bundled implementations |
| --- | --- | --- |
| `knowledge` | [knowledge](layers.md#the-knowledge-contract) | `oats.okf` |
| `messaging` | [communication](layers.md#the-communication-contract) | `oats.aweb` |
| `tasks` | [tasks](layers.md#the-tasks-contract) | `oats.jira`, `oats.linear` |

A capability manifest becomes an integration by declaring one `layer`. It
may not declare several. Two active packages for one slot and one soul are a
configuration error; capabilities without `layer` compose additively.

Exclusivity is the point. Task state belongs to the selected tasks
implementation even when a messaging tool also offers task features, and
conversation belongs to the messaging implementation even when a tracker
offers comments.

## Selecting an integration

The workspace supplies a default per slot; a soul may name another, or `none`.
The manifest already declares the slot, so a soul's `capabilities:` entry does
not repeat it — a capability with `layer: knowledge` fills the knowledge slot
wherever it arrives from:

```yaml
# oats-workspace.yaml — one default per slot, for every soul
defaults:
  knowledge: { oats.okf: { from: package } }
  messaging: { oats.aweb: { from: package } }
  tasks: { oats.linear: { from: package } }

# souls/planner/soul.yaml — keep the defaults, supply the soul's payloads
knowledge:
  owns: planner
  reads: [developer]
messaging:
  channels: [product]
tasks:
  team: ENG
  project: Agent Platform

# souls/support-triager/soul.yaml — opt out of one slot, replace another
knowledge: none                            # empties the slot
capabilities:
  oats.jira: { from: package }             # its manifest says layer: tasks → replaces the default
```

Packages are pinned once in the workspace's `packages:`
(`oats.okf: v2.1.3`, …) and synced ([packages.md](packages.md)). Host-owned
values (absolute paths) go in `oats-local.yaml`:

```yaml
settings:
  oats.okf:
    bindings-file: /absolute/config/okf-bindings.json
  oats.aweb:
    delivery: channel
```

Every soul gets one implementation per slot. Two layered capabilities arriving
for one slot (a default plus a soul entry, or two soul entries) is
`E_SLOT_CONFLICT`; spell `<cap>: off` to remove the one you do not want. `none`
is a slot selection, not a policy: a soul with `messaging: none` has no address.

## Bundled integrations

**`oats.okf` v2** fills `knowledge`: external owned OKF bases, immutable
reader views, instance `STATE.md`/`log.md`/`notes/`, durable notes-and-record
custody and an independent directory worker. Git delivery is PR-only; plain
directory delivery is recoverable and needs no Git/gh. Explicit bindings,
`soul/okf.json` and accepted base metadata are required before a working source
can spawn. `owns`/`reads` are responsibility/context, not ACLs. See
[knowledge](knowledge.md) for the **prepared** version scope, provisioning and
commands.

**`oats.aweb`** fills `messaging`: mints an instance identity at spawn (local
mode) or grants an instance an expiring session as a resident global identity
(global mode), removes or revokes it at retire, contributes the aweb messaging
and team skills, wires the channel plugin so sessions are woken by mail, and
exposes `oats aweb roster` and `oats aweb setup`. Requires the `aw` CLI.

**`oats.jira`** fills `tasks`: the `jira-tasks` protocol and an advisory
spawn hook. Requires `acli`; settings commonly include `site` and `project`.

**`oats.linear`** fills `tasks`: JSON-first `oats linear` commands, the
`linear-tasks` skill, and an advisory spawn hook. Uses `LINEAR_API_KEY`;
secrets never belong in OATS config. See
`capabilities/oats-linear/README.md` for its support boundary.

> **Removed: `oats.web`.** The browser web-panel capability was retired in
> favor of the OATS Desktop app (`packages/desktop/`), which bundles the same
> zero-dependency loopback server. If an `oats-workspace.yaml` (`packages:`,
> `defaults.capabilities`) or a `soul.yaml` still names `oats.web`, remove that
> entry and `oats sync`.

## Building an integration

A slot provider that declares `binding` answers `oats readiness` through its
`binding.check` command; the request, environment and answer are specified in
[capabilities.md](capabilities.md#readiness-check-bindingcheck).

Building an integration is implementing a contract. The checklist per slot:

**Any slot.** A namespaced capability manifest with exactly one `layer`; an
`inject` block that tells the instance what this implementation is and which
skill to load before first use; skills that carry the craft; commands that
support `--json`; hooks only on the accepted events; `requires` for every
host command and runtime package; `environment` for every launch variable
contributed, under the vendor prefix. Package commands and hooks reach the
kernel only through `OATS_CLI_BIN` and the JSON envelope, never by importing
kernel files. Never name target souls in the manifest; targeting belongs to
configuration.

**Knowledge.** Each capability owns its complete runtime and format, including
reader/capture instructions, judgment and provider-native delivery. Do not
assume a soul bundle, attached worker, Git store or mandatory shared harvester.
The optional [authoring guide](knowledge-capability-authoring.md) describes the
reference model and how to adapt or replace it. OKF v2 is one implementation:
explicit external ownership, instructional read-only sources, evidence custody
outside disposable homes, independent workers, PR-only Git and recoverable
non-Git publication. Existing lifecycle hooks and supported CLI/scheduler
commands implement it; no proposed universal `harvest` event is required.

**Communication.** Mint an address on `spawn` with a `required` hook and
remove it on `retire`; supply the roster; teach send, reply, chat, and "read
the event first" in the inject and skill; contribute launch arguments so the
session is woken; enforce the soul type's `reach` on both sides; state
whether the address outlives the instance; and keep task coordination out.
Any messaging provider emits `identity: { mode, alias, team, address|null,
resident|null, grant?: { id, expiresAt, scopes } }` in its spawn meta (and
in its launch meta when it renews); `oats.aweb` is the reference
implementation. **This is a messaging-layer contract, not an oats.aweb
detail** (decision 27): from kernel 0.25.6 the kernel copies it through as
the principal the instance *acts as* — `oats status --json
instances[].identity`, the roster's `identity:` line, `oats inspect --home …
selected.identity` — preferring the capability whose captured layer is
`messaging`, adding `provider: <capability id>`, and never interpreting
`grant`. The kernel offers no `--identity` flag: the choice travels as
`--provider <cap> identity.mode=… identity.resident=…` and is bound by the
spawn decision's `effective.providers`.

A provider whose settings include a **host fact** — a custody directory, a
state root — declares that key `hostOnly: true` in its manifest. The
resolver then accepts it **only** from the deployment's `oats-local.yaml`
`settings.<cap>` and refuses it in the workspace file, `byTeam` payloads, a
soul's slot payload and `--provider` flags (`E_WORKSPACE_SCHEMA`, reason
`host-only-key`, path and key named). The provider cannot enforce this
itself: it receives one merged payload without provenance.

**Tasks.** Teach claim, update, block, hand off, and complete; identify the
instance to the tracker in a way that survives it; keep conversation out.

The framework's `integrations-expert` soul remains the specialist for
contract design, and the `integration-authoring` skill routes work to it.
Test an integration as a capability package: acquire, lock, trust, activate,
spawn, retire, with the golden fixtures as the behavior oracle for the kernel
side.

## oats.okf v2 settings and recovery

V2 requires `bindings-file`, an absolute path to capability-owned JSON. Paths
inside it resolve from that file's directory. The source soul needs stable
`owner`, `owns` and `reads` declarations; every referenced accepted node must
exist and match its owner. Acquisition/activation never bootstraps a knowledge
base. If activating globally, provision each working soul first or target only
ready sources.

```yaml
# oats-local.yaml
settings:
  oats.okf:
    bindings-file: /absolute/config/okf-bindings.json
    harvest-runtime: claude
```

- `harvest-runtime: pi | claude | codex` defaults to `pi`, independently of the
  source. Select an installed/authenticated runtime on the execution host.
- `harvest-model` optionally pins its model. Omitted models use the harness
  default; native Claude/Codex names are not Pi provider-prefixed patterns.
- Old record-window settings and `--from-record --force` recovery are not v2
  interfaces. Every capture takes notes **and** record; use durable run receipts
  and explicit `retry`/`complete` reconciliation, never old watermark moves.

For remote sources, configure custody and credentials on their execution host,
not the viewer. One source job continues from stable deployment context after
retirement, subject to current activation/trust. Timer installation requires
explicit consent. `inspect` is read-only and combines identity-guarded live
memory with durable receipts; `--source` remains usable after home deletion.
[Command and recovery details](knowledge.md#inspection-and-operator-commands).

## oats.aweb late joins (1.10.3)

`aw team join` at spawn gets 120 s (a slow link is slow, not broken). If the
join is reported failed or is killed on timeout but the home then holds a
bound identity (signing key, team certificate, workspace alias), the hook
reports that alias in its meta so the kernel's compensation retires it
instead of orphaning it. The retire hook likewise reads the alias from the
home's `.aw/workspace.yaml` when its meta carries none.

## oats.aweb retire report (1.10.2)

On a host whose installed `aw` is 1.36.1 or later, the retire hook deletes
the workspace with `aw workspace delete <alias> --json` and reports what the
platform answered: `meta.aliasReusable` is true when `alias_released` is
true (the certificate was revoked and a later spawn may reuse the slug),
false otherwise with `meta.aliasReason` carrying the platform's reason and a
warning naming the fresh-purpose remedy. On an older `aw` the pre-1.36.1
report stands (`aliasReusable: false`, warning naming aweb-abim), because
that CLI cannot revoke the certificate.

## oats.aweb settings (1.12.2)

Set portable team policy in the workspace/soul `messaging:` payload; set host
facts in `oats-local.yaml` under `settings.oats.aweb.<key>`. Per-spawn
`oats spawn … --provider oats.aweb <key>=<value>` is for non-host settings only.
The effective payload is merged in order: workspace messaging, `byTeam[<primary label>]`,
soul messaging, `oats-local.yaml` `settings.oats.aweb`, then per-spawn
`--provider` values. `root`, `roots`, and `residents` are manifest-declared
`hostOnly: true`: absolute root/custody paths are accepted only from
`oats-local.yaml`; kernels since 0.25.6 refuse those keys in the workspace file,
`byTeam`, soul payloads and `--provider` flags with `E_WORKSPACE_SCHEMA` reason
`host-only-key`.

- `team: <team id>`. The payload team wins over `OATS_TEAM_ID`/
  `OATS_TEAM_NAME`; if both are set and differ, the hook warns and uses the
  payload. Workspace v2 spawns can have an empty `OATS_TEAM_ID`, so set this in
  the workspace file's `messaging:` / `messaging.byTeam.<label>.team`, or in
  `settings.oats.aweb.team` for a host override.
- `root: /absolute/dir`. Host-owned absolute directory whose `.aw` is the aweb
  minting root. A declared root without `.aw` is fatal; run `oats aweb setup`
  there or set `settings.oats.aweb.root` to the initialized root.
- `roots: { <team id>: /absolute/dir }`. Host-owned map for deployments that
  mint into several aweb teams. When a team is known, `roots[team]` wins over
  `root`.
- Minting root resolution for spawn and setup is: `roots[team]` when the team is
  known and present, else `root`. With no declared root, workspace v2 uses
  `<OATS_WORKSPACE>` (the deployment directory whose `.aw` is used) and never
  searches above it; classic deployments with `OATS_TEAM_SCOPE` keep the
  historical bounded candidate search order exactly (team scope, home, home git
  root, context, context git root, then workspace).
- `binding-check` answers `needs-configuration` before spawn with one problem
  per missing item: `no messaging root at <dir>: run oats aweb setup there or
  set settings.oats.aweb.root`; `no team: set messaging.byTeam.<label>.team in
  the workspace file or settings.oats.aweb.team`. With both present it answers
  `ready` (subject to captured-session checks when an invocation is supplied).
  In classic deployments this readiness check approximates the full bounded
  spawn search by checking `OATS_TEAM_SCOPE` before `OATS_WORKSPACE`; the spawn
  hook itself still keeps the exact 1.12.0 bounded candidate order. With no
  explicit team and no workspace team label, readiness follows spawn: an active
  aweb team at the root is enough to answer ready; an unmapped workspace team
  label still reports the team-setting remedy above.
- `oats aweb setup` is idempotent and uses existing aw primitives. With
  `--username <u>` it runs `aw init --username <u>` at the messaging root and
  tells the operator to map the workspace team to `default:<u>.aweb.ai` when
  that team is not already the configured target. With `AWEB_API_KEY` in the
  environment it runs `aw init` at the root for the hosted team behind the key.
  With `--invite <token>` it runs `aw team join <token>`. It never prints the
  API key or invite token, re-reads `aw team list --json` after the action, and
  prints the same ready/needs-configuration verdict as binding-check.
- `identity.mode: local | global` (default `local`). Any other value is fatal.
  Local mode is the historical behavior: a spawned team identity is minted for
  the instance, or `identity.source` uses the existing retained-seat flow below.
  Its spawn meta includes `identity: { mode: "local", alias, team, address:
  null, resident: null }` beside the existing top-level `alias`, `team`, and
  `delivery` keys. Local-mode spawn output contributes
  `env.AWEB_IDENTITY_HOME=<home>/.aw` (and retained-seat local mode contributes
  the same path) so `aw mail`, `aw chat`, `aw whoami`, `aw wake`, and
  `aw workspace status` work from the instance's `work/` or any other cwd.
- `identity.mode: global` makes the instance act as a resident global identity
  through an aweb session grant; it never mints a new global identity and never
  copies root keys into the instance home. `identity.resident` is required and
  resolves through `residents.<name>` to an absolute custody directory whose
  `.aw/identity.yaml` already exists. Missing or unresolved residents fail with
  the `oats-local.yaml settings.oats.aweb.residents.<name>` key to set. Optional
  `identity.scopes` defaults to exactly `[mail.read, mail.send, chat.read,
  chat.send]`; optional `identity.ttl` defaults to `8h` (aw accepts `60s` to
  `720h`). Spawn first runs `aw custody status --json` in the resident custody
  directory and uses exactly the reported `socket_path`; a status without a
  socket is refused. It then runs `aw id grant mint --team <team-id> --scope
  <comma-list> --ttl <ttl> --label oats:<instance> --out
  <home>/.aweb-identity --custody-socket <preflight-socket> --json` from the
  custody directory when aw is 1.36.2 or later for `--team`; grants need aw >=
  1.36.3 (`CUSTODY_ATTACH_MIN`) with aweb server >= 1.27.5 for
  `--custody-socket`. `AWEB_IDENTITY_HOME`
  is removed from mint/revoke child environments: grant commands are not
  identity-home-aware and intentionally refuse both `--identity-home` and
  external `AWEB_IDENTITY_HOME`, so cwd selects the custody identity. The hook
  parses the whole JSON document because aw `--json` output is indented across
  lines, with a fallback to the first brace-prefixed block when progress lines
  precede it; it then verifies the minted grant's `team_id`, reads back
  `<grantHome>/grant.yaml` (not `encryption.yaml`) and requires
  `custody.socket_path` to equal the preflight socket, and runs
  `aw custody status --json` with `AWEB_IDENTITY_HOME=<grantHome>` from the grant
  home to verify the resident alias and ready team row. Missing or mismatched
  custody attachment revokes the grant, removes the grant home and fails the
  spawn. It returns `env.AWEB_IDENTITY_HOME=<home>/.aweb-identity`. If the minted
  team differs, the hook revokes the grant and keeps nothing. Receiving, wake registration,
  and `aw whoami` work through a grant. On aw 1.36.1 the server rejected mail
  or chat sent through a grant with 422 (`from_did must match the authenticated
  sender`) because the client signed with the grant-key DID. aw 1.36.2 with
  aweb server 1.27.5, the floor, fixes this; grant mail and chat sends passed
  real-server acceptance there. A hosted team whose server has not yet adopted
  1.27.5 still refuses grant sends; the custody preflight reports that as
  needs-configuration before spawn through `grant_status_endpoint_ready`.
  Retire revokes
  `meta.identity.grant.id` through the custody directory; with no grant id it
  reports `nothing-to-revoke`. A failed revoke exits nonzero and reports the TTL
  expiry. A binding-less home readiness check for global mode never reports ready
  for a grant home whose `grant.yaml` lacks `custody.socket_path`; it reports
  `needs-configuration` / code `custody` and tells the operator to retire and
  respawn on an aw new enough to attach custody.
- `residents: { <name>: /abs/custody/dir }` is the host-owned map for global
  mode. Each custody directory's `.aw` holds the resident identity root keys and
  team certificate. Do not put this map in committed source; the hook cannot
  distinguish payload provenance.
- `delivery: channel | session` (default `channel`). `session` hands
  notification delivery to the host wake broker: `AWEB_DELIVERY=session` in
  the launch environment (declared by the manifest), no Claude channel flag,
  a pi extension that honours the opt-out (`@awebai/pi` 0.3.10 or later) and
  a Claude Code channel plugin that does too (`aweb-channel` 1.7.9 or later),
  both enforced as conditional requirements with a version floor when
  installed (an older plugin starts its own channel server beside the broker
  and can fetch a message before the broker delivers it), and a briefing
  and registration of the home with the host wake broker (`aw wake register`).
  Until an aw that ships `aw wake` exists (aweb-abil), session mode REFUSES
  to spawn rather than leave an instance that nothing wakes: it is for broker
  qualification only; leave the default otherwise.
- `identity: { source: "/abs/path/to/legacy/.aw" }`, per soul, explicit and
  never inferred. The spawned instance becomes the retained seat of that
  existing identity (same did:aw and address). The aweb service URL comes
  from the source's `workspace.yaml` (`aweb_url`); a hosted-init source has
  none, so set `OATS_AWEB_URL` (for example `https://app.aweb.ai/api`) in
  the spawn environment when the source lacks it: the identity-authority files
  are copied into the home's `.aw` (never `workspace.yaml` or caches), the
  coordination binding is reconnected with `aw workspace connect`, and the
  seat is verified online before the instance is briefed. A lock beside the
  source (`.aw-retained-seat.json`) refuses a second seat while a holder is
  live. Retire releases the lock and touches neither the identity nor the
  source; removing the legacy `.aw` is a human step. Rehearse on a disposable
  global identity first: a send, a claim and a heartbeat from the new home
  must all work before any real seat moves.

Requirement rows in a manifest may carry `when: { <setting>: <value> }` (the
row applies only when the capability's effective setting matches) and
`minVersion` (the version is read from the package.json under the install
directory the runtime's listing names; an older or absent manifest fails the
requirement with the install remedy). `ifInstalled: true` makes an absent
package satisfy the row, so the floor applies only to an ambient extension.
