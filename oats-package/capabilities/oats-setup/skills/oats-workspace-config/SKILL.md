---
name: oats-workspace-config
description: >-
  Use when reading or changing a workspace's shared OATS configuration: any
  field of oats-workspace.yaml (members, packages, teams, defaults, messaging,
  stores, external), oats-membership.yaml or a soul.yaml; adding a
  member, a team, a soul's teams or a default capability; deciding whether a
  fact belongs in a shared file or on one machine; or explaining a refusal
  like "why can't I
  spawn X" or an E_* code. For package pins use `/oats-package-pins`, for
  teams (shared or local, and which souls may join them) `/oats-teams`, for
  triggers and schedules `/oats-automations`, for a host's message delivery
  (Claude channels, the host wake broker) `/oats-host-delivery`.
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
oats souls --json                 # every soul: origin, teams + default team, work mode
oats capabilities --json          # member and package capabilities, with origin
oats spawn <soul> --preview       # what one soul would get: modules, merged settings, teams + default team
oats teams --json                 # this deployment's teams (shared + local), the default, the workspace's souls:, problems
```

Explain what you read in the human's terms before proposing anything:
which repositories are members and whether each is confirmed, what is pinned,
which teams exist (shared or local, mapped or not), the default and which souls may join
which, what every soul gets by default.

## Where each fact lives

| Fact | File | Scope |
|---|---|---|
| members, package pins, shared teams, the default team, which souls may join which teams (`souls:`), whether local teams are allowed, defaults, stores, external souls, the messaging payload | `oats-workspace.yaml` in the **host** repo | shared (Git) |
| "this repo is a member" | `oats-membership.yaml` in **each** member | shared (Git) |
| a soul's role, work mode, capability sources, slot payloads, floors | `souls/<name>/soul.yaml` (+ `AGENTS.md`, `skills/`, `okf.json`) | shared (Git) |
| workspace triggers and schedules | `oats-triggers/`, `oats-schedules/` in a member (kernel 0.29.0; see `/oats-automations`) | shared (Git) |
| host paths, custody, settings a manifest marks host-owned, clones, launch configurations and launch preferences (`souls.launch`, written by `oats soul launch set` and `oats soul launch remove` from OATS 0.53.0), souls disabled here; local teams and a local default team, only when the workspace says `localTeams: true` (`oats teams`) | `oats-local.yaml` in the deployment directory | **this machine** |
| exact package commits and integrity | `oats-lock.json` | this machine, written by `oats sync` only |
| Claude's channel admission for aweb channel delivery (`channelsEnabled`, `allowedChannelPlugins`) | Claude's managed-settings file, outside `oats-local.yaml`: `/etc/claude-code/managed-settings.json` (Linux), `/Library/Application Support/ClaudeCode/managed-settings.json` (macOS) | this machine, owned by the OS admin (root, sudo); OATS never writes it. See `/oats-host-delivery` |
| the host wake broker's service (`aw wake run`) | a per-user unit: `~/.config/systemd/user/ai.aweb.wake.service` (Linux), `~/Library/LaunchAgents/ai.aweb.wake.plist` (macOS) | this machine, the user who runs the instances; the operator installs it. See `/oats-host-delivery` |
| the Git identity, SSH key, commit signing, global hooks and `gh` login that agents commit with | the person's own `~/.gitconfig`, `~/.ssh/`, `~/.config/git/hooks/` and gh's login, outside OATS's files | this machine, the user who runs the instances; the person sets them up with `/oats-git-setup` |
| a fact about one spawn (a retained seat, a team to join now) | `oats spawn … --provider <cap> key=value` | one instance |

Never put an absolute path, an account or a host name in a shared file (the
workspace file refuses absolute paths). The one team id a shared file holds is
a shared team's `team`: the same provider team for everyone. A per-machine value in Git
is wrong on every other machine.

## `oats-workspace.yaml`

| Field | Meaning | Refused when |
|---|---|---|
| `schemaVersion: 2`, `name` | required | missing, or another version |
| `members:` | repo refs (`git:github.com/<org>/<repo>`), **no `@revision`**; the host lists itself | a revision, a duplicate |
| `packages:` | `<id>: v<version>` (official catalog) or `git:<repo>@<tag or full commit>`; see `/oats-package-pins` | a branch, an id outside the catalog in bare form |
| `teams:` | shared teams: `<label>: { description?, team? }` (`team` is the provider team id; without it the team is unmapped) | a label referenced but declared nowhere (`E_TEAM_UNKNOWN`, see `/oats-teams`) |
| `defaultTeam`, `localTeams`, `souls:` | the workspace's default team (a shared label); whether deployments may declare their own teams (default `false`); per soul pattern (`"*"`, `<member\|package>/*`, `<member\|package>/<soul>`) `{ default?, teams?: [labels] \| any }`, the most specific key winning (see `/oats-teams`) | a label that is not a shared team of this file, a bare soul name as a `souls:` key (an unknown qualified name is only the warning `team-soul-unknown`) |
| `defaults.capabilities` | `<capability>: { from: package \| <repo key> }` for every soul | `from: here` (souls only), a non-canonical repo key |
| `defaults.knowledge` / `messaging` / `tasks` | at most one capability per slot, or `none` | two capabilities, a capability of another layer (`E_SLOT_CONFLICT`) |
| `messaging:` | the messaging provider's payload | `byTeam` (removed in 0.30: the id is `teams.<label>.team`) |
| `stores:` | `<alias>: <repo ref>`; knowledge bases are bound per machine by alias | a `#path` in the ref |
| `external:` | `{ source: <repo>@<full commit>, soul: souls/<name> }`, a soul from a non-member | no revision, a `team` (removed in 0.30) |

A repo key in `from:` is spelled exactly as the kernel spells it: lowercase
host, `org/repo`, no scheme, no `git:`, no `.git` (`github.com/acme/agents`).
Unknown top-level keys are refused, and so is `defaults.byTeam` (removed in
0.30: capabilities compose from the defaults and the soul only).

## `oats-membership.yaml`

```yaml
schemaVersion: 2
workspace: git:github.com/acme/agents   # the host repo: names the workspace back
```

A `team:` here is refused: a soul's teams are decided by `souls:` in
`oats-workspace.yaml`.

A repo is a member only when the workspace lists it **and** this file names
the workspace back. `oats workspace status` shows `confirmed`, or
`not-listed`, `no-backlink`, `backlink-elsewhere` or `cannot-read`; each is
fixed in the repo or in the operator's Git environment, never worked around.
From OATS 0.56.0, a `cannot-read` caused by a failed or unparseable Git
version probe preserves the partial remote cache and its pins. Fix the local Git failure and retry;
do not delete the cache to work around it. See `docs/workspaces.md` in the installed kernel (“Membership and trust”).

## `soul.yaml` (v2)

Required: `schemaVersion: 2`, `name` (equals the directory), `description`,
`work` (`worktree | checkout | directory | workspace`). Optional: `capabilities` (`<cap>: { from:
here | package | <repo key> }` or `off`), slot payloads `knowledge:`,
`messaging:`, `tasks:` (a provider's binding keys, or `none` to empty the
slot) and `compatibility` (floors on package versions). Beside it:
`AGENTS.md`, `CLAUDE.md → AGENTS.md`, `skills/`, and what the slot providers
read (`okf.json` for `oats.okf`). Harness, model and yolo are spawn flags or a
launch configuration, never soul fields. A soul may state only a preference
(`launch: {harness, model?}`); how this machine starts a harness (executable,
args, env, yolo) is a host launch configuration, and `default: true` on one
makes it the machine's baseline for its harness (0.32). `private:` on a soul
is ignored. A `team` is refused (a soul's teams are `souls:` in
`oats-workspace.yaml`).

## Provider payloads: three homes

A provider receives one merged payload:
`workspace.messaging` (messaging only) ⊕ the soul's slot
payload ⊕ `oats-local.yaml settings.<cap>` ⊕ `--provider <cap> k=v`. Put a key
in the narrowest home that is true: every instance of the soul → `soul.yaml`;
this machine → `settings`; this spawn → `--provider`. A key the manifest marks
`hostOnly` is accepted only from `settings`. `oats spawn <soul> --preview`
shows the merged `settings.<cap>` and where each key came from
(`settingsOrigins`); check it after every payload change.

## Host message delivery

A host's two delivery choices are not workspace configuration: Claude channel
delivery (`claudeChannelMode`, Claude's managed settings) and the host wake
broker (`aw wake run` as a per-user service). Both are taught in
`/oats-host-delivery`.

## Change a shared file

1. Read the state (above) and the contract section for the field.
2. Write the change as a **diff** and show it to the human, with why and
   what it changes for which souls.
3. Commit it to the repo that owns the file, by one of two routes. Never
   edit a shared file without one of them.
   - **Straight to the default branch,** only when all of these hold,
     checked right before the push:
     - the repo is the workspace's host (the host entry in
       `oats workspace status`), and the person created it as a new
       workspace (the setup expert's hand-over says `new`, or the person
       confirms it);
     - it belongs to their own GitHub account, not an organization:
       `gh repo view <o>/<r> --json isInOrganization,owner,defaultBranchRef`
       gives `false` and their login (`gh api user --jq .login`), and names
       `<branch>`, the default branch;
     - they are its only collaborator:
       `gh api repos/<o>/<r>/collaborators --jq 'map(.login)'`;
     - no rule guards its default branch: both
       `gh api repos/<o>/<r>/branches/<branch> --jq .protected` (`false`) and
       `gh api repos/<o>/<r>/rules/branches/<branch> --jq length` (`0`).

     Then push, and tell the person what changed.
   - **Otherwise a pull request** from a branch, which the repo's owner
     merges (name who): every member repository, and every repository
     others share. If a straight push is refused (by Git, GitHub or your
     harness's permission check), open a pull request instead; never try
     another way. If its output says a rule was bypassed, the change is
     already on the default branch: stop and tell the person, who decides
     whether to keep or revert it, and use pull requests for that
     repository from then on.
4. Once it is on the default branch, on each deployment: `oats sync`, then
   `oats workspace status` and `oats spawn <soul> --preview` for an affected
   soul. Confirm the new state is there by positive enumeration, not by the
   absence of errors.

A host fact (`oats-local.yaml`) is edited only on the machine it describes,
with that machine's operator's OK, and verified the same way. `oats doctor`
reports this deployment's local file and lock.

## Refusals and their fix

| Code | Usually means | Fix |
|---|---|---|
| `E_WORKSPACE_SCHEMA` | a declaration file is malformed; the path is named | fix that field (a member `@revision`, a non-canonical `from:`, an absolute path, a `hostOnly` key in a committed payload, a removed team key: `byTeam`, a soul or membership `team`, `external[].team`; reason `removed-key`: `souls.teams` / `souls.default` in `oats-local.yaml`, which prints the `souls:` snippet to commit; reason `local-teams-closed`: local `teams` / `defaultTeam` without `localTeams: true`, see `/oats-teams`) |
| `E_LOCAL_MISSING` | no `oats-local.yaml` in reach | run from the deployment directory or pass `--dir`; on a new machine, `/oats-onboarding` |
| `E_MEMBERSHIP_UNCONFIRMED`, `E_NOT_A_MEMBER` | the soul or capability belongs to a repo that is not a confirmed member | `oats workspace status`; fix the listing, the backlink or the Git access |
| `E_SOUL_UNKNOWN` | no confirmed member, external entry or package ships that soul | `oats souls`; the soul is merged on the member's default branch, its member is confirmed, its package is pinned and synced |
| `E_SOUL_AMBIGUOUS` | two souls share the bare name | use the qualified name it lists (`<member>/<soul>`, `<package>/<soul>`) |
| `E_SOUL_DISABLED` | `souls.disabled` in this machine's `oats-local.yaml` | re-enable there, if the operator agrees |
| `E_TEAM_UNKNOWN` | the local `defaultTeam` in `oats-local.yaml` is declared in neither file; the spawn is refused | `oats teams add` it, or `oats teams default` another label; see `/oats-teams` |
| `E_TEAM_NOT_ELIGIBLE` | the provider refused to join a team the soul may not join | add the label to the soul's `souls:` entry (a shared-file change), or join another team; see `/oats-teams` |
| `E_TEAM_UNCONFIGURED` | messaging is active and the soul has no default team | commit `defaultTeam:` (or a `souls:` `default`) in `oats-workspace.yaml`; with `localTeams: true`, `oats teams add` (the first becomes the default) or `oats teams default <label>` |
| `E_TEAM_IN_USE`, `E_TEAM_SHARED`, `E_TEAM_EXISTS` | `oats teams remove`/`add` refused: still the local default, shared (a shared-file change), or already declared | see `/oats-teams` |
| `E_HARNESS_UNAVAILABLE` | the harness a launch preference (or flag) chose is not installed here; `details.from`/`at` name the layer | install it, or pin the soul to another launch on this machine: `oats soul launch set <soul> --launch-config <name>` or `--harness <h>` (`'*'` for every soul without an entry), from OATS 0.53.0; on an older kernel, edit `souls.launch` in `oats-local.yaml` |
| `E_LAUNCH_CONFIG_UNKNOWN` | `souls.launch` names a launch configuration this `oats-local.yaml` lacks, or `oats soul launch set --launch-config <name>` names one it lacks (nothing was written) | declare it (`oats launch-config set`), or pin another (`oats soul launch set <soul> --launch-config <name>`, from OATS 0.53.0; on an older kernel, change `souls.launch` in `oats-local.yaml`) |
| `E_LAUNCH_PREFERENCE_UNKNOWN` | from OATS 0.53.0: `oats soul launch remove` named an entry `souls.launch` does not have; `details.keys` lists the entries it has | remove one of those: a soul's, `'*'`, or the exact text of a key (`oats soul launch remove <key>`) |
| `E_LAUNCH_PREFERENCE_UNMATCHED` | from OATS 0.53.0: `souls.launch` holds a key that names no soul this workspace offers (`details.keys`, each with the nearest soul keys), and this launch names none and its soul has no entry of its own. Refused: a spawn and its preview, and `session start` or `restart` with `--reselect-launch`. `oats souls` and `oats doctor` list the keys | in this order: pin the soul the key was meant for (`oats soul launch set <soul> --launch-config <name>`, or `--harness <h>`), then `oats soul launch remove <key>`. To go on once without changing the file, name the launch (`--launch-config <name>` or `--harness <h>`) |
| `E_LAUNCH_CONFIG_AMBIGUOUS` | from OATS 0.52.0: a spawn's harness has several launch configurations here, none `default: true`, and the spawn named none (`details.configurations` lists them) | name one (`--launch-config <name>`, `--launch-config none`, or a `souls.launch` name), or mark one `default: true` (`oats launch-config set`) |
| `E_LAUNCH_CONFIG_INVALID` | a launch configuration is malformed, or two are `default: true` for one harness (`details.configurations` names both) | fix the entry; keep one default per harness (clear the old one first) |
| `E_LOCAL_BUSY`, `E_LOCAL_CHANGED` | a command that rewrites `oats-local.yaml` (`oats teams`, `oats soul launch`, `oats launch-config set`/`remove`, `oats schedule`/`trigger enable`/`disable`) found the file's lock still held after 5 s, or the file kept changing while it edited; nothing was written | run the same command again once the other writer is done; for `E_LOCAL_BUSY` with no oats command running, remove the lock directory the error names (`details.lock`) |
| `E_CLAUDE_CONFIG_REMOVED` | an `oats-claude-config` file is in reach of a new claude launch; 0.32 no longer reads it | declare its name as the claude default (`executable: <name>`, `default: true`), then delete the file |
| `E_SLOT_CONFLICT` | two capabilities fill one slot, a slot default of the wrong layer, or `none` beside the soul's own capability of that layer | keep one per slot |
| `E_CAPABILITY_MISSING` | a capability is not where `from:` says, or `--provider` names one the soul does not resolve | `oats capabilities`; correct the `from:` or pin the package |
| `E_CAPABILITY_PRIVATE` | a repo-owned capability used by another repo's soul | use it only from its own repo, or ask its owners to share it |
| `E_PACKAGE_MISSING` | `from: package` but the lock lacks it, or the package is no longer declared | pin it (`/oats-package-pins`), then `oats sync` |
| `E_PACKAGE_INTEGRITY` | a tag moved or the content changed under a pin | pin a new version; see `/oats-package-pins` |
| `E_COMPATIBILITY` | a soul's `compatibility` floor is above the pinned version | bump the pin, or relax the floor, by a shared-file change |
| `E_CAPABILITY_INCOMPATIBLE` | a module's `compatibility.oats` excludes this kernel | update the kernel (`oats update`) or pin a compatible version |
| `E_SKILL_DUPLICATE` | two modules contribute a skill of the same name | drop one capability from the soul (`off`) |
| `E_CLONE_MISSING`, `E_CLONE_MISMATCH` | a `worktree`/`checkout` soul has no clone of its repo here, or `clones:` points at the wrong repo | clone it at `<deployment>/<repo name>` or set `clones:` on this machine |
| `E_LOCK_SCHEMA` | `oats-lock.json` is unreadable | `oats sync`; never edit the lock |

## Gotchas

- A new soul, member or default takes effect only for **new** spawns, after
  the change is on the default branch and `oats sync` has run. Running instances keep what
  they were given; `oats status` shows them as moved.
- `oats workspace status` reads the workspace's default branch over the
  remote, not your working copy: an unmerged change is invisible to it.
- `oats package add` edits `packages:` only when the host repo is the current
  checkout; otherwise it prints the line to commit.
- "Why can't I spawn X": run `oats spawn X --preview`. Its refusal names the
  code and the path, and the table above maps it to the owning file.
