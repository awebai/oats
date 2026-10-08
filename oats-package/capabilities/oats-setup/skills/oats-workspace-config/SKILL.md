---
name: oats-workspace-config
description: >-
  Use when reading or changing a workspace's shared OATS configuration: any
  field of oats-workspace.yaml (members, packages, teams, defaults, messaging,
  stores, external), oats-membership.yaml or a soul.yaml; adding a
  member, a team, a soul's teams or a default capability; deciding whether a
  fact belongs in a shared file or on one machine; or explaining a refusal
  like "why can't I
  spawn X" or an E_* code; or setting up Claude channel delivery on a host
  (the approved route: Claude's managed settings, `claudeChannelMode:
  approved`). For package pins use `/oats-package-pins`, for
  teams (shared or local, and which souls may join them) `/oats-teams`, for
  triggers and schedules `/oats-automations`.
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
| host paths, custody, settings a manifest marks host-owned, clones, launch configurations and launch preferences (`souls.launch`), souls disabled here; local teams and a local default team, only when the workspace says `localTeams: true` (`oats teams`) | `oats-local.yaml` in the deployment directory | **this machine** |
| exact package commits and integrity | `oats-lock.json` | this machine, written by `oats sync` only |
| Claude's channel admission for aweb channel delivery (`channelsEnabled`, `allowedChannelPlugins`) | Claude's managed-settings file, outside `oats-local.yaml`: `/etc/claude-code/managed-settings.json` (Linux), `/Library/Application Support/ClaudeCode/managed-settings.json` (macOS) | this machine, owned by the OS admin (root, sudo); OATS never writes it. See [Claude channel delivery (approved route)](#claude-channel-delivery-approved-route) below |
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
fixed in the repo or in the operator's Git access, never worked around.

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

## Claude channel delivery (approved route)

A host step of `/oats-onboarding` card 4, for Claude seats on aweb channel
delivery. With `claudeChannelMode: approved`, oats.aweb starts Claude with
`--channels plugin:aweb-channel@awebai-marketplace` and Claude shows no
“WARNING: Loading development channels” prompt: it admits the plugin when a
root-owned managed-settings file on the machine lists it. The route does not
depend on the Claude version and needs no launch-prompt consent
(`launchPromptAnswers` applies only to development mode). Contract:
`docs/configuration.md`, “Claude channel delivery: the approved route”;
provider behaviour and receive proof: `/oats-aweb` §4.

**Prerequisites:** the intake selects Claude seats with channel delivery on
this host; a human admin with sudo on this machine, because OATS never writes
the managed-settings file; and which managed-policy source governs the
account. Claude reads its managed policy from the **first source present**:
server-managed settings (a claude.ai Team/Enterprise organization's admin
console), then an MDM profile (`com.anthropic.claudecode` on macOS), then the
file. On an account governed by server-managed settings or MDM the file is
ignored: the organization admin sets the same two keys there instead, and
steps 1–2 do not apply. Pro/Max accounts and plain API-key use have no
server-managed settings, so the file applies.

1. **Read what is there.** The file is `/etc/claude-code/managed-settings.json`
   on Linux and `/Library/Application Support/ClaudeCode/managed-settings.json`
   on macOS. Claude also reads drop-ins in `managed-settings.d/*.json` beside
   it. Read the file and any drop-ins before changing anything.
2. **The admin sets two keys**, in a file owned by root, mode 0644. The content
   is exactly:

   ```json
   {"channelsEnabled": true, "allowedChannelPlugins": [{"plugin": "aweb-channel", "marketplace": "awebai-marketplace"}]}
   ```

   If the file exists, merge these two keys into it and never overwrite its
   other keys (to an existing `allowedChannelPlugins`, add the aweb-channel
   entry). **Setting `allowedChannelPlugins` replaces Anthropic's default
   channel allowlist on this host** (the official discord, telegram, fakechat
   and imessage plugins): if the host uses any of them, list them too. Always
   include `channelsEnabled: true`: API-key users need it whenever any managed
   policy exists, and so do Team/Enterprise subscribers; Pro/Max ignore it.
   When no file exists yet, on Linux:

   ```bash
   sudo install -d -m 0755 /etc/claude-code
   echo '{"channelsEnabled": true, "allowedChannelPlugins": [{"plugin": "aweb-channel", "marketplace": "awebai-marketplace"}]}' \
     | sudo tee /etc/claude-code/managed-settings.json >/dev/null
   sudo chown root /etc/claude-code/managed-settings.json
   sudo chmod 0644 /etc/claude-code/managed-settings.json
   ```

   On macOS:

   ```bash
   sudo install -d -m 0755 "/Library/Application Support/ClaudeCode"
   echo '{"channelsEnabled": true, "allowedChannelPlugins": [{"plugin": "aweb-channel", "marketplace": "awebai-marketplace"}]}' \
     | sudo tee "/Library/Application Support/ClaudeCode/managed-settings.json" >/dev/null
   sudo chown root "/Library/Application Support/ClaudeCode/managed-settings.json"
   sudo chmod 0644 "/Library/Application Support/ClaudeCode/managed-settings.json"
   ```

   Read it back: `ls -l` shows owner root and `-rw-r--r--`, and the file is
   valid JSON with both keys.
3. **The plugin.** `aweb-channel` is installed from the marketplace named
   `awebai-marketplace` (GitHub `awebai/claude-plugins`) and enabled, in the
   Claude config directory the host's Claude launch configuration uses (its
   `CLAUDE_CONFIG_DIR`, else `~/.claude`). The allowlist matches the
   marketplace by name.
4. **OATS settings**, in this host's `oats-local.yaml` under
   `settings.oats.aweb`: `claudeChannelMode: approved` (host-only), and
   `delivery: channel` for the whole host, or per spawn with
   `--provider oats.aweb delivery=channel`. With channel delivery, pi uses its
   `@awebai/pi` extension and Codex always uses the host broker.

**Effects:** a machine-wide Claude policy file and host settings; no home
changes. **Existing homes** keep the delivery and channel mode recorded at
their spawn: respawn a home to adopt this route. Never restart running agents
as part of setup without the operator's word.

**Success** (read at `/oats-onboarding` cards 6 and 8):

1. The spawn preview shows `settings.oats.aweb.claudeChannelMode: approved`
   and `delivery: channel`.
2. The started session shows no development prompt, and its banner says
   `Channels (experimental) messages from plugin:aweb-channel@awebai-marketplace inject directly in this session · restart without --channels to stop`.
3. The banner does not say `not on the approved channels allowlist`,
   `not on your org's approved channels list` or `blocked by org policy`.
4. Receive is proven only by the `/oats-aweb` nonce exchange.

**Next:** return to `/oats-onboarding` card 4's sync.

**Failure → remedy:** the banner says `not on the approved channels
allowlist`, `not on your org's approved channels list` or `blocked by org
policy`, or the development prompt still appears: Claude did not admit the
plugin. Check, in order: the preview shows `claudeChannelMode: approved` (else
fix step 4 and respawn); whether server-managed settings or MDM govern the
account (then the organization admin sets the two keys there); the file is at
the OS's path, owned by root, mode 0644, valid JSON with both keys and the
exact plugin and marketplace names; the plugin is installed and enabled from
`awebai-marketplace` in the launch's config directory; the home was spawned
before the change (respawn it). The admitted banner without a completed nonce
exchange is not receive: `/oats-aweb` §4.

**Limits:** channels are an Anthropic research preview, and Anthropic's
account-level feature flag gates them on every route; neither is an OATS
setting.

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
| `E_WORKSPACE_SCHEMA` | a declaration file is malformed; the path is named | fix that field (a member `@revision`, a non-canonical `from:`, an absolute path, a `hostOnly` key in a committed payload, a removed team key: `byTeam`, a soul or membership `team`, `external[].team`; reason `removed-key`: `souls.teams` / `souls.default` in `oats-local.yaml`, which prints the `souls:` snippet to commit; reason `local-teams-closed`: local `teams` / `defaultTeam` without `localTeams: true`, see `/oats-teams`) |
| `E_LOCAL_MISSING` | no `oats-local.yaml` in reach | run from the deployment directory or pass `--dir`; on a new machine, `/oats-onboarding` |
| `E_MEMBERSHIP_UNCONFIRMED`, `E_NOT_A_MEMBER` | the soul or capability belongs to a repo that is not a confirmed member | `oats workspace status`; fix the listing, the backlink or the Git access |
| `E_SOUL_UNKNOWN` | no confirmed member, external entry or package ships that soul | `oats souls`; the soul is merged on the member's default branch, its member is confirmed, its package is pinned and synced |
| `E_SOUL_AMBIGUOUS` | two souls share the bare name | use the qualified name it lists (`<member>/<soul>`, `<package>/<soul>`) |
| `E_SOUL_DISABLED` | `souls.disabled` in this machine's `oats-local.yaml` | re-enable there, if the operator agrees |
| `E_TEAM_UNKNOWN` | the local `defaultTeam` in `oats-local.yaml` is declared in neither file; the spawn is refused | `oats teams add` it, or `oats teams default` another label; see `/oats-teams` |
| `E_TEAM_NOT_ELIGIBLE` | the provider refused to join a team the soul may not join | add the label to the soul's `souls:` entry by PR, or join another team; see `/oats-teams` |
| `E_TEAM_UNCONFIGURED` | messaging is active and the soul has no default team | commit `defaultTeam:` (or a `souls:` `default`) in `oats-workspace.yaml`; with `localTeams: true`, `oats teams add` (the first becomes the default) or `oats teams default <label>` |
| `E_TEAM_IN_USE`, `E_TEAM_SHARED`, `E_TEAM_EXISTS` | `oats teams remove`/`add` refused: still the local default, shared (edit by PR), or already declared | see `/oats-teams` |
| `E_HARNESS_UNAVAILABLE` | the harness a launch preference (or flag) chose is not installed here; `details.from`/`at` name the layer | install it, or override it on this machine in `oats-local.yaml` `souls.launch` |
| `E_LAUNCH_CONFIG_UNKNOWN` | `souls.launch` names a launch configuration this `oats-local.yaml` lacks | declare it (`oats launch-config set`), or change `souls.launch` |
| `E_LAUNCH_CONFIG_INVALID` | a launch configuration is malformed, or two are `default: true` for one harness (`details.configurations` names both) | fix the entry; keep one default per harness (clear the old one first) |
| `E_CLAUDE_CONFIG_REMOVED` | an `oats-claude-config` file is in reach of a new claude launch; 0.32 no longer reads it | declare its name as the claude default (`executable: <name>`, `default: true`), then delete the file |
| `E_SLOT_CONFLICT` | two capabilities fill one slot, a slot default of the wrong layer, or `none` beside the soul's own capability of that layer | keep one per slot |
| `E_CAPABILITY_MISSING` | a capability is not where `from:` says, or `--provider` names one the soul does not resolve | `oats capabilities`; correct the `from:` or pin the package |
| `E_CAPABILITY_PRIVATE` | a repo-owned capability used by another repo's soul | use it only from its own repo, or ask its owners to share it |
| `E_PACKAGE_MISSING` | `from: package` but the lock lacks it, or the package is no longer declared | pin it (`/oats-package-pins`), then `oats sync` |
| `E_PACKAGE_INTEGRITY` | a tag moved or the content changed under a pin | pin a new version; see `/oats-package-pins` |
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
