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
