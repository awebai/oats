---
name: oats-setup-model
description: >-
  Use first when someone wants to understand an OATS setup: what the
  workspace, members, packages, souls, capabilities, teams, instances and
  automations are, how they relate and why; "where does X come from", "why is
  X here", "why can't I see / spawn / join Y", "who is this agent acting as",
  "what runs on this machine". Explains the model and names the command that
  answers each question. To change something, continue with
  oats-workspace-config, oats-teams, oats-package-pins or oats-automations.
  Part of the setup and config of an OATS workspace (oats.setup); day-to-day
  operation inside an instance is oats.core.
---

# The OATS setup model

Load this before explaining or changing a setup: every answer below is "read
it from the command, then explain it with the model". The contracts are the
installed kernel's docs (`"$(oats root)/docs/"`): `workspaces.md`,
`souls-and-instances.md`, `capabilities.md`, `packages.md`, `schedules.md`.
Cite them; do not restate them from memory. Start every explanation with the
reads:

```bash
oats workspace status     # members and why each is in or out, locked packages
oats souls                # every soul, its origin and its team labels
oats capabilities         # every capability, its origin
oats status               # the instances on this machine, and their drift
```

## The relations

```
 GitHub account (a person, or a machine user)
   │  can read ──► member repos ──► its view of the workspace
   │  is `owner` of ──► workspace automations
   │
 WORKSPACE  (oats-workspace.yaml in the host repo, shared through Git)
   ├─ members ◄──two-way handshake──► oats-membership.yaml in each member   (= trust)
   │     each member contributes:  souls/  capabilities/  oats-triggers/ oats-schedules/
   ├─ packages (pinned) ──► capabilities + souls + trigger templates, at one locked commit
   ├─ teams (labels) ──► defaults.byTeam (capabilities)   messaging.byTeam (messaging teams)
   ├─ defaults ──► capabilities every soul gets, one per core slot
   ├─ stores ──► knowledge bases, bound on each machine
   └─ external ──► souls borrowed from non-members, commit-pinned
                                │
 SOUL (a durable role) = workspace defaults → team defaults per label → its own list
                                │ spawned by a person, an agent or an automation
 INSTANCE (one incarnation) = a home + ./work, on ONE machine, fixed to what it was given
                                │
 THIS MACHINE (the deployment directory): oats-local.yaml, oats-lock.json, agents/, clones, the host timer
```

## The pieces, and why they are that way

**A user is a GitHub account**, a person or a machine user (a bot). OATS
reads Git with the operator's own credentials, so **what an account can read
is its view of the workspace**: a member it cannot read contributes nothing
for it (`cannot-read`), and a user who can read a member but not the host sees
the **standalone** view (that member's souls only, with `oats.core`). A host
runs a workspace automation only while its `gh` is logged in as the
automation's `owner`. A messaging identity is separate: each instance gets its
own, in the workspace's **default team**.

**The workspace** is one `oats-workspace.yaml` in a host repo (any member),
declared in Git so it is reviewed and the same for everyone. It lists members,
pins packages, declares team labels, sets defaults, names knowledge stores and
borrows external souls. Nothing is installed globally.

**Members and trust.** A repo is a member only when the workspace lists it
**and** its `oats-membership.yaml` points back. Why: whoever can push to the
member decides what its souls and capabilities are, the same trust as its
code, so membership is the trust decision and there is no per-tool approval.
Members are read at their **latest** default-branch state, not versioned.

**Packages** are the only versioned things: pinned in `packages:`, resolved by
`oats sync` to an exact commit and content fingerprint in `oats-lock.json`.
A package ships capabilities, and from kernel 0.28.0 souls and trigger
templates; **one pin versions all of it**. Declaring a package is the trust
decision. Why two tiers: your repos move fast and you trust them; shared
tooling must not change under you. A repo can be a member **and** publish a
package; the two never merge (`from: <repo>` reads its latest `capabilities/`,
`from: package` reads the lock).

**Capabilities** are bundles of skills, an instruction inject, commands and
hooks. Three are **core capabilities** with exactly one slot each per soul:
knowledge (`oats.okf`), messaging (`oats.aweb`) and tasks (`oats.jira`,
`oats.linear`), because an agent needs one memory, one address and one task
list. Everything else is additive; `oats.core` (operating inside OATS) is a
default almost every soul has. A capability comes `from: package`, `from:
<member repo key>` or, in a soul, `from: here` (its own repo or package). A
member capability marked `private: true` is **repo-owned**: listed, but usable
only by that repo's souls.

**Souls** are durable roles: `souls/<name>/` in a member, in a package
(`<package>/<soul>`), or borrowed through `external:`. **Composition** is
`workspace defaults → team defaults for each label → the soul's own list`,
later wins; `off` drops a default and `<slot>: none` empties a core slot.
`oats inspect --soul <name>` reports why each core capability is there
(`layers.<slot>.from`: `soul`, `workspace` or `team:<label>`). A soul's
knowledge (the nodes it owns and reads) lives in an external knowledge base,
not in the soul.

**Team labels organise; they never gate.** A label can add default
capabilities and makes a messaging team *eligible*. It grants no trust,
restricts no one and partitions no knowledge. Joining a messaging team is
explicit, at spawn or later (oats-teams).

**Instances** are incarnations of a soul on one machine: a **home** (its
instructions, task and state) and **`./work`** (per the soul's work mode:
`worktree`, `checkout`, `directory`, `workspace`, or `attached` at spawn). An
instance keeps the commits and package versions it was spawned with; `oats
status` shows **drift** when the member or pin moved since, and only a new
spawn picks it up. It was spawned by a person, by another instance (its
parent), or by an automation, with a harness (`pi`, `claude`, `codex`) and a
model.

**Automations** spawn or wake instances without a person. **Local** ones live
in this deployment's `oats-schedules.json`, run on this machine with its own
`gh`, and are machine-private. **Workspace** ones (kernel 0.29.0) are committed
in a member (`oats-triggers/`, `oats-schedules/`, or a `*.oats-trigger.yaml` /
`*.oats-schedule.yaml` file) and
name **where** they run (`runsOn`, a host's `host.name`) and **as whom**
(`owner`, a GitHub account); only that host, logged in as that account, runs
them. One host timer per machine runs every due automation (oats-automations).

**This machine** is the deployment directory: `oats-local.yaml` (which
workspace, host-owned settings such as paths and custody, clones, launch
configurations, souls disabled here, and from 0.29.0 its `host.name` and
`triggers.disabled` / `schedules.disabled`), `oats-lock.json` (written by `oats sync`), `agents/`
(the instance homes) and the host timer. None of it is in Git.

## Where does X come from, why is X here, why can't I Y

| Question | Ask | Read |
|---|---|---|
| Which repos are in, and which are not and why? | `oats workspace status` | each member's state: `confirmed`, `not-listed`, `no-backlink`, `backlink-elsewhere`, `cannot-read` |
| Which package versions are in use? | `oats workspace status` | the locked packages (commit and integrity) |
| Which souls exist, and from where? | `oats souls` | origin (`member <repo> @ <commit>`, `package <id> v<version>`, external) and team labels |
| Why can't I see soul X? | `oats workspace status`, `oats souls` | its member is unconfirmed or unreadable for this account; its package is not pinned or synced |
| Which capabilities exist, and from where? | `oats capabilities` | origin (member or package), repo-owned marks |
| What exactly would soul X get? | `oats spawn X --preview` | modules at their commits, skills, merged `settings.<cap>` with their origins, eligible `teams` |
| Why does soul X have capability C? | `oats inspect --soul X --json` | `layers.<slot>.from`; for additive ones, compare the soul's own list with the workspace and team defaults |
| Why can't I spawn soul X? | `oats spawn X --preview` | the refusal code and path; oats-workspace-config maps it to the fix |
| Which instances run here, and are they current? | `oats status` | each instance's soul source, modules and drift marks |
| What was an instance given, and why? | `oats inspect --home <abs home> --json` | recorded modules, payloads, `layers.<slot>.from` as recorded at spawn |
| Which teams can an instance join? | `oats spawn X --preview`; in a home, `oats aweb teams` | the eligible `teams` entries (`mapped`, team id) |
| What runs automatically, and where? | `oats trigger list`, `oats schedule list` | local and (0.29.0) workspace automations; for a workspace one, whether it runs here or why not |
| Would this trigger work on this host? | `oats trigger test <id>` | `gh` credentials, repo permissions, the soul resolving, the teams declared, what would fire |
| What is configured on this machine? | `oats doctor` | this deployment's local file and lock |

Use `--json` when you parse; read `oats help` for any flag not shown here.

## Gotchas

- **Shared vs this machine.** Most confusion comes from mixing them. A shared
  change (Git) reaches every machine at its next `oats sync`; a host fact
  changes one machine only. Say which one you are talking about.
- **Absence proves nothing.** A soul missing from `oats souls` is usually a
  membership or access fact, not a deleted soul: check `oats workspace status`
  for that account first.
- **The workspace view is the remote, not a working copy.** An unmerged change
  is invisible to every `oats` read until it merges.
- **A running instance never changes under itself.** Explaining an instance
  means reading what it recorded (`oats inspect --home`), not the workspace as
  it stands now.
