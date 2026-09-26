---
name: oats-workspace-config
description: >-
  Use when reading or changing a workspace's shared OATS configuration: any
  field of oats-workspace.yaml (members, packages, teams, defaults, byTeam,
  messaging, stores, external), oats-membership.yaml or a soul.yaml; adding a
  member, a team or a default capability; deciding whether a fact belongs in a
  shared file or on one machine; or explaining a refusal like "why can't I
  spawn X" or an E_* code. For package pins use oats-package-pins, for teams
  and messaging teams oats-teams, for triggers and schedules oats-automations.
  Part of the setup and config of an OATS workspace (oats.setup); day-to-day
  operation inside an instance is oats.core.
---

# Reading and changing the workspace configuration

The contract is `docs/workspaces.md` in the installed kernel
(`"$(oats root)/docs/"`), with the JSON schemas beside it. The kernel's
validators are the authority: when this skill and a refusal disagree, the
refusal wins. Read the contract for any field you are about to change.

## Read the current state first

```bash
oats workspace status --json      # members (confirmed or why not), locked packages, warnings, problems
oats souls --json                 # every soul: origin, team labels, work mode
oats capabilities --json          # member and package capabilities, with origin
oats spawn <soul> --preview       # what one soul would get: modules, merged settings, teams
```

Explain what you read in the human's terms before proposing anything:
which repositories are members and whether each is confirmed, what is pinned,
which labels exist and how they map to messaging teams, what every soul gets
by default.

## Where each fact lives

| Fact | File | Scope |
|---|---|---|
| members, package pins, team labels, defaults, stores, external souls, the messaging payload | `oats-workspace.yaml` in the **host** repo | shared (Git) |
| "this repo is a member", its default team label | `oats-membership.yaml` in **each** member | shared (Git) |
| a soul's role, work mode, labels, capability sources, slot payloads, floors | `souls/<name>/soul.yaml` (+ `AGENTS.md`, `skills/`, `okf.json`) | shared (Git) |
| workspace triggers and schedules | `oats-triggers/`, `oats-schedules/` in a member (kernel 0.29.0; see oats-automations) | shared (Git) |
| host paths, custody, settings a manifest marks host-owned, clones, launch configurations, souls disabled here | `oats-local.yaml` in the deployment directory | **this machine** |
| exact package commits and integrity | `oats-lock.json` | this machine, written by `oats sync` only |
| a fact about one spawn (a retained seat, a team to join now) | `oats spawn … --provider <cap> key=value` | one instance |

Never put an absolute path, an account, a team id or a host name in a shared
file (the workspace file refuses absolute paths). A per-machine value in Git
is wrong on every other machine.

## `oats-workspace.yaml`

| Field | Meaning | Refused when |
|---|---|---|
| `schemaVersion: 2`, `name` | required | missing, or another version |
| `members:` | repo refs (`git:github.com/<org>/<repo>`), **no `@revision`**; the host lists itself | a revision, a duplicate |
| `packages:` | `<id>: v<version>` (official catalog) or `git:<repo>@<tag or full commit>`; see oats-package-pins | a branch, an id outside the catalog in bare form |
| `teams:` | `<label>: { description }`, declared once | a label used elsewhere but not declared (`E_TEAM_UNKNOWN`, see oats-teams) |
| `defaults.capabilities` | `<capability>: { from: package \| <repo key> }` for every soul | `from: here` (souls only), a non-canonical repo key |
| `defaults.knowledge` / `messaging` / `tasks` | at most one capability per slot, or `none` | two capabilities, a capability of another layer (`E_SLOT_CONFLICT`) |
| `defaults.byTeam.<label>.capabilities` | added for souls carrying that label, in label order | two labels disagreeing on one capability (`E_TEAM_CONFLICT`) |
| `messaging:` | the messaging provider's payload; `byTeam.<label>` maps a label to a messaging team | a `byTeam` label not in `teams:` |
| `stores:` | `<alias>: <repo ref>`; knowledge bases are bound per machine by alias | a `#path` in the ref |
| `external:` | `{ source: <repo>@<full commit>, soul: souls/<name>, team? }`, a soul from a non-member | no revision |

A repo key in `from:` is spelled exactly as the kernel spells it: lowercase
host, `org/repo`, no scheme, no `git:`, no `.git` (`github.com/acme/agents`).
Unknown top-level keys are refused.

## `oats-membership.yaml`

```yaml
schemaVersion: 2
workspace: git:github.com/acme/agents   # the host repo: names the workspace back
team: engineering                       # optional default label (or a list) for this repo's items
```

A repo is a member only when the workspace lists it **and** this file names
the workspace back. `oats workspace status` shows `confirmed`, or
`not-listed`, `no-backlink`, `backlink-elsewhere` or `cannot-read`; each is
fixed in the repo or in the operator's Git access, never worked around.

## `soul.yaml` (v2)

Required: `schemaVersion: 2`, `name` (equals the directory), `description`,
`work` (`worktree | checkout | directory | workspace`). Optional: `team` (a
label or a list, the first is the primary), `capabilities` (`<cap>: { from:
here | package | <repo key> }` or `off`), slot payloads `knowledge:`,
`messaging:`, `tasks:` (a provider's binding keys, or `none` to empty the
slot) and `compatibility` (floors on package versions). Beside it:
`AGENTS.md`, `CLAUDE.md → AGENTS.md`, `skills/`, and what the slot providers
read (`okf.json` for `oats.okf`). Harness, model and yolo are spawn flags or a
launch configuration, never soul fields. `private:` on a soul is ignored.

## Provider payloads: three homes

A provider receives one merged payload:
`workspace.messaging` (messaging only, without `byTeam`) ⊕ the soul's slot
payload ⊕ `oats-local.yaml settings.<cap>` ⊕ `--provider <cap> k=v`. Put a key
in the narrowest home that is true: every instance of the soul → `soul.yaml`;
this machine → `settings`; this spawn → `--provider`. A key the manifest marks
`hostOnly` is accepted only from `settings`. `oats spawn <soul> --preview`
shows the merged `settings.<cap>` and where each key came from
(`settingsOrigins`); check it after every payload change.

## Change a shared file

1. Read the state (above) and the contract section for the field.
2. Write the change as a **diff** and show it to the human, with why and
   what it changes for which souls.
3. Commit it on a branch of the repo that owns the file and open a pull
   request. Never push to its default branch, and never edit a shared file
   without a PR.
4. After it merges, on each deployment: `oats sync`, then
   `oats workspace status` and `oats spawn <soul> --preview` for an affected
   soul. Confirm the new state is there by positive enumeration, not by the
   absence of errors.

A host fact (`oats-local.yaml`) is edited only on the machine it describes,
with that machine's operator's OK, and verified the same way. `oats doctor`
reports this deployment's local file and lock.

## Refusals and their fix

| Code | Usually means | Fix |
|---|---|---|
| `E_WORKSPACE_SCHEMA` | a declaration file is malformed; the path is named | fix that field (a member `@revision`, a non-canonical `from:`, an absolute path, a `byTeam` label not declared, `byTeam` or a `hostOnly` key in a committed payload) |
| `E_LOCAL_MISSING` | no `oats-local.yaml` in reach | run from the deployment directory or pass `--dir`; on a new machine, oats-onboarding |
| `E_MEMBERSHIP_UNCONFIRMED`, `E_NOT_A_MEMBER` | the soul or capability belongs to a repo that is not a confirmed member | `oats workspace status`; fix the listing, the backlink or the Git access |
| `E_SOUL_UNKNOWN` | no confirmed member, external entry or package ships that soul | `oats souls`; the soul is merged on the member's default branch, its member is confirmed, its package is pinned and synced |
| `E_SOUL_AMBIGUOUS` | two souls share the bare name | use the qualified name it lists (`<member>/<soul>`, `<package>/<soul>`) |
| `E_SOUL_DISABLED` | `souls.disabled` in this machine's `oats-local.yaml` | re-enable there, if the operator agrees |
| `E_TEAM_UNKNOWN` | a label not declared in `teams:` (still listed) | declare it; see oats-teams |
| `E_TEAM_CONFLICT` | two of a soul's labels give one capability different entries | make the `defaults.byTeam` entries agree, or name the capability in the soul |
| `E_SLOT_CONFLICT` | two capabilities fill one slot, a slot default of the wrong layer, or `none` beside the soul's own capability of that layer | keep one per slot |
| `E_CAPABILITY_MISSING` | a capability is not where `from:` says, or `--provider` names one the soul does not resolve | `oats capabilities`; correct the `from:` or pin the package |
| `E_CAPABILITY_PRIVATE` | a repo-owned capability used by another repo's soul | use it only from its own repo, or ask its owners to share it |
| `E_PACKAGE_MISSING` | `from: package` but the lock lacks it, or the package is no longer declared | pin it (oats-package-pins), then `oats sync` |
| `E_PACKAGE_INTEGRITY` | a tag moved or the content changed under a pin | pin a new version; see oats-package-pins |
| `E_COMPATIBILITY` | a soul's `compatibility` floor is above the pinned version | bump the pin, or relax the floor, by PR |
| `E_CAPABILITY_INCOMPATIBLE` | a module's `compatibility.oats` excludes this kernel | update the kernel (`oats update`) or pin a compatible version |
| `E_SKILL_DUPLICATE` | two modules contribute a skill of the same name | drop one capability from the soul (`off`) |
| `E_CLONE_MISSING`, `E_CLONE_MISMATCH` | a `worktree`/`checkout` soul has no clone of its repo here, or `clones:` points at the wrong repo | clone it at `<deployment>/<repo name>` or set `clones:` on this machine |
| `E_LOCK_SCHEMA` | `oats-lock.json` is unreadable | `oats sync`; never edit the lock |

## Gotchas

- A new soul, member or default takes effect only for **new** spawns, after
  the change is merged and `oats sync` has run. Running instances keep what
  they were given; `oats status` shows them as moved.
- `oats workspace status` reads the workspace's default branch over the
  remote, not your working copy: an unmerged change is invisible to it.
- `oats package add` edits `packages:` only when the host repo is the current
  checkout; otherwise it prints the line for the PR.
- "Why can't I spawn X": run `oats spawn X --preview`. Its refusal names the
  code and the path, and the table above maps it to the owning file.
