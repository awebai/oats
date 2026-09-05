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

Configuration activates the package for the intended target; the manifest
already declares the slot, so `oats use` writes the entry under
`capabilities.layers.<slot>`:

```yaml
agent-types:
  product-agents:
    description: Planner, developer, and reviewer souls (they declare `type: product-agents`)

capabilities:
  layers:
    knowledge:
      capability: oats.okf
      from: installed
    messaging:
      capability: oats.aweb
      from: installed
      agent-types:
        product-agents:
          enabled: true
          settings:
            team: example-team
    tasks:
      capability: oats.linear
      from: installed
      agent-types:
        product-agents:
          enabled: true
          settings:
            team: ENG
            project: Agent Platform
```

CLI equivalents:

```bash
oats use oats.okf --global
oats use oats.aweb --type product-agents
oats use oats.linear --type product-agents
oats use none --layer tasks        # leave an inherited slot deliberately unfilled
```

Every matching soul gets one implementation per slot. A non-matching soul can
resolve a different one or leave a slot unfilled. `none` is a layer
selection, not a policy: a soul with `messaging: none` has no address, which
is different from a soul whose type restricts its reach.

## Bundled integrations

**`oats.okf`** fills `knowledge`: OKF soul bundles, instance `STATE.md`,
`log.md`, and `notes/`, the `okf` and `memory-harvest` skills, and
`oats okf harvest`, which promotes pending notes after a commit through the
capability-defined `memory-harvest` soul. Its scaffold and spawn hooks own
memory mechanics; the kernel stays knowledge-format agnostic.

**`oats.aweb`** fills `messaging`: mints an instance identity at spawn,
removes it at retire, contributes the aweb messaging and team skills, wires
the channel plugin so sessions are woken by mail, and exposes
`oats aweb roster` and `oats aweb setup`. Requires the `aw` CLI.

**`oats.jira`** fills `tasks`: the `jira-tasks` protocol and an advisory
spawn hook. Requires `acli`; settings commonly include `site` and `project`.

**`oats.linear`** fills `tasks`: JSON-first `oats linear` commands, the
`linear-tasks` skill, and an advisory spawn hook. Uses `LINEAR_API_KEY`;
secrets never belong in OATS config. See
`capabilities/oats-linear/README.md` for its support boundary.

> **Removed: `oats.web`.** The browser web-panel capability was retired in
> favor of the OATS Desktop app (`packages/desktop/`), which bundles the same
> zero-dependency loopback server. If an `oats-lock.json` or
> `oats-config.yaml` still names `oats.web`, remove that entry. Full
> migration steps: [desktop-succession](desktop-succession.md).

## Building an integration

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

**Knowledge.** Scaffold the soul's store on `soul-scaffold`; create instance
ephemeral state on `spawn`; teach the read side (index-first, selective,
binding) in the inject and skill; ship a harvester as a capability-defined
soul and a command that spawns it attached to the source instance's tree;
route promotions by custody (commit, pull request, or direct edit); apply the
promotion doctrine in the contract; and, once the `harvest` event exists,
declare it instead of relying on the instance to call the command.

**Communication.** Mint an address on `spawn` with a `required` hook and
remove it on `retire`; supply the roster; teach send, reply, chat, and "read
the event first" in the inject and skill; contribute launch arguments so the
session is woken; enforce the soul type's `reach` on both sides; state
whether the address outlives the instance; and keep task coordination out.

**Tasks.** Teach claim, update, block, hand off, and complete; identify the
instance to the tracker in a way that survives it; keep conversation out.

The framework's `integrations-expert` soul remains the specialist for
contract design, and the `integration-authoring` skill routes work to it.
Test an integration as a capability package: acquire, lock, trust, activate,
spawn, retire, with the golden fixtures as the behavior oracle for the kernel
side.

## oats.okf harvest settings (1.5.1)

The harvester can use a different harness from the source instance. Select one
that is installed and authenticated on the host where the harvest runs:

```bash
oats use oats.okf --settings harvest-runtime=claude
```

- `harvest-runtime: pi | claude | codex` defaults to `pi`.
- `harvest-model` is optional. Pi defaults to `github-copilot/gpt-5.5` and
  accepts Pi provider/model patterns. Claude and Codex use their configured
  default when omitted; an explicit value must be a native model name
  (for example `sonnet` or `gpt-5.5`), without a Pi provider prefix.

These settings apply to note and record harvests, including deferred retirement
and remote harvests. For a remote instance, configure its host's knowledge
binding; the local viewer does not supply its own provider credentials.

If a record harvester was spawned but did not advance its watermark, planning
the same windows again warns with that instance and the boundary IDs and skips
another spawn. Inspect the previous attempt first. `oats okf harvest
--from-record --force` retries those windows explicitly; it still refuses to
start a second harvester while the first one's home exists. The check uses the
existing prepared watermark file and does not treat a successful spawn as
completed learning.

## oats.aweb settings (1.10.0)

Set with `oats use oats.aweb --settings <key>=<value>` at a scope, or per
soul through the binding's `settings:` map.

- `delivery: channel | session` (default `channel`). `session` hands
  notification delivery to the host wake broker: `AWEB_DELIVERY=session` in
  the launch environment (declared by the manifest), no Claude channel flag,
  a pi extension that honours the opt-out (`@awebai/pi` 0.3.10 or later,
  enforced as a conditional requirement with a version floor), and a briefing
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
