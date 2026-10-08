# Configuration: `oats-local.yaml`

A deployment has **one** per-machine file, `oats-local.yaml`. It names the
workspace this machine realizes and holds the facts that are true of this host
only. Everything shared (members, packages and their versions, shared teams,
defaults, stores) lives in the workspace repository's `oats-workspace.yaml`,
and everything about a soul lives in its `soul.yaml` ([workspaces.md](workspaces.md)).
Write the first version with `oats onboard`; never commit it to a shared
repository.

## The file

```yaml
schemaVersion: 2
workspace: git:github.com/acme/agents        # REQUIRED: the workspace host, read over the remote

clones:                                      # member clones not beside this file under their repo name
  github.com/acme/platform: /Users/ana/src/acme-platform

settings:                                    # host-owned values per capability
  oats.okf:
    bindings-file: /Users/ana/.oats/okf-bindings.json

teams:                                       # LOCAL teams (only where the workspace says localTeams: true)
  ana-research: { team: "ana-research:acme.aweb.ai", description: Ana's research }
defaultTeam: ana-research                    # this deployment's default team (same condition)
souls:
  disabled: [legacy-bot]                     # souls not run on this machine

host:
  name: ana-laptop                           # which workspace triggers and schedules run here
session:                                     # terminal defaults for NEW launches on this host (0.31)
  tmuxSession: oats-agents                   # the tmux session new tmux instances open in
triggers:
  disabled: [platform/nightly-review]
schedules:
  disabled: [platform/weekly-digest]

launch-configs:                              # named ways this host starts a harness
  personal:
    harness: claude
    executable: "./bin/claude-wrapper.sh"    # relative → against this deployment directory
    args: ["--verbose"]
    env:
      CLAUDE_CONFIG_DIR: { fromEnv: PERSONAL_CLAUDE_DIR }
    model: opus
    yolo: false
  mine:
    harness: claude
    default: true                            # this host's baseline for every claude launch (0.32)
    env:
      CLAUDE_CONFIG_DIR: /home/ana/.claude-personal
```

Schema: [`oats-local.schema.json`](oats-local.schema.json). Unknown keys are
refused (`E_WORKSPACE_SCHEMA`).

| key | meaning |
|---|---|
| `workspace` | Repo ref of the workspace host (`git:host/org/repo`, `https://…`, `git@host:…`, `file:///…`, `/abs/bare.git`). Read with your own Git credentials; it need not be cloned. |
| `standalone` | A repo ref to realize on its own: its souls and `from: here` capabilities plus `oats.core`, with no workspace lookup. For a repository whose workspace this machine cannot read ([workspaces.md](workspaces.md#the-standalone-case)). |
| `clones` | `<repo key>: <absolute path>` for a member clone that is not at `<deployment>/<member name>/`. Only a soul whose work target needs a clone (`work: worktree \| checkout`) uses it. Lookup order: `spawn --repo`, then this map, then `<deployment>/<member name>` (a member named `agents` → `<deployment>/agents-repo`). None → `E_CLONE_MISSING`; a directory whose `origin` is another repository → `E_CLONE_MISMATCH`. |
| `launchPromptAnswers.homes.<absolute-home>` | Explicit per-home `awebDevelopmentChannel` boolean consent; defaults false. See [launch prompt consent](#exact-home-launch-prompt-consent). |
| `settings.<cap>.<key>` | Host-owned values a capability's manifest asks for: absolute paths, state roots, delivery modes. The workspace file refuses absolute paths; they go here. Merged into the capability's provider payload after the soul's own and before any `--provider` flag ([three homes](workspaces.md#provider-payloads-have-three-homes)). |
| `teams.<label>` | A **local** team: `{ team: <provider team id>, description? }`, a team only this deployment uses; every soul may join it. Allowed only where `oats-workspace.yaml` says `localTeams: true` (or in the standalone view); otherwise refused (`E_WORKSPACE_SCHEMA`, reason `local-teams-closed`). Shared teams are committed in `oats-workspace.yaml`; a label in both is `team-label-collision` (the shared one wins). Written by `oats teams add <label> --team <id>` and `oats teams remove <label>`. |
| `defaultTeam` | This deployment's default team: a label of a local or shared team, under the same condition as `teams`. A soul's own default in the workspace's `souls:` wins over it; it wins over the workspace's `defaultTeam`. The first `oats teams add` sets it (unless `--no-default`); `oats teams default <label>` changes it, and `--if-absent` / `--expect <label>` change it only where there is no effective default / it is that label. |
| `souls.disabled` | Souls not run on this machine; a spawn is refused with `E_SOUL_DISABLED`. A bare name disables every soul of that name; `<package>/<soul>` or `<member>/<soul>` disables one. |
| `session.tmuxSession` | The tmux session new tmux instances open their windows in (0.31). Absent: `OATS_TMUX_SESSION`, else `PI_AGENTS_TMUX_SESSION` (the pre-0.31 variable), else `oats-agents`. `session: { tmuxSession: pi-agents }` keeps the pre-0.31 layout. `oats inspect --json` reports it as `session`. |
| `host.name` | This machine's name. A workspace trigger or schedule runs only on the host named by its `runsOn` ([schedules.md](schedules.md)). |
| `automations.trust` | The workspace triggers and schedules (`<member>/<id>`) this host agrees to run, or `"*"` for every one the workspace places here (0.30). Absent or empty: none runs. See [Who runs workspace automations](#who-runs-workspace-automations). |
| `triggers.disabled`, `schedules.disabled` | Workspace triggers and schedules (`<member>/<id>`) this host does not run, without a commit. Written by `oats trigger disable` / `oats schedule disable`. |
| `launch-configs.<name>` | A named way to start a harness on this host, chosen at spawn or session start, never by the soul. `default: true` makes it this host's baseline for its harness (0.32). See [Launch configurations](#launch-configurations). |
| `souls.launch` | This machine's launch preference per soul (0.30): `"*"` for every soul, a soul's own entry (its name, or `<package>/<soul>`) over it. A value is a `launch-configs` name or an inline `{ harness, model? }`. It overrides the soul's own `launch:`; explicit spawn flags win over both. See [Launch preferences](#launch-preferences). |

Which teams a soul may join, and its default, are committed in the workspace's
`souls:`, never here: `souls.teams` and `souls.default` were removed in 0.38.0
(`E_WORKSPACE_SCHEMA`, reason `removed-key`; the refusal prints the `souls:` to
commit instead). How teams are resolved, and what a messaging provider does
with them, is in [workspaces.md](workspaces.md#teams).

## Claude channel delivery: the approved route

Claude seats on aweb channel delivery start without Claude's “WARNING:
Loading development channels” prompt through the **approved route**: the
`oats.aweb` setting `claudeChannelMode: approved` starts Claude with
`--channels plugin:aweb-channel@awebai-marketplace`, and Claude shows no
development prompt. Claude admits the plugin when a root-owned machine
managed-settings file lists it. The route does not depend on the Claude
version and needs no OATS mechanism beyond these settings. The operator's
ordered procedure is the `oats.setup` host step “Claude channel delivery
(approved route)” in `/oats-workspace-config`, which `/oats-onboarding` card 4
calls; the provider's side is `/oats-aweb` §4.

**The managed-settings file** is a host change made by a human admin with
sudo. OATS never writes it.

| | |
|---|---|
| Location | Linux: `/etc/claude-code/managed-settings.json`; macOS: `/Library/Application Support/ClaudeCode/managed-settings.json` |
| Owner and mode | root, `0644` |
| Content | exactly `{"channelsEnabled": true, "allowedChannelPlugins": [{"plugin": "aweb-channel", "marketplace": "awebai-marketplace"}]}` |
| Existing file | merge these two keys into it; never overwrite other keys |
| Drop-ins | Claude also reads `managed-settings.d/*.json` beside the file |

Setting `allowedChannelPlugins` **replaces Anthropic's default channel
allowlist** on that host. That list is the official discord, telegram,
fakechat and imessage plugins; a host that uses any of them must list them
too.

**Precedence.** Claude reads its managed policy from the first source
present: server-managed settings (a claude.ai Team/Enterprise organization's
admin console), then an MDM profile (`com.anthropic.claudecode` on macOS), then
the file. On an account governed by server-managed settings or MDM the file is
ignored, and the organization admin sets the same two keys there instead.
Pro/Max accounts and plain API-key use have no server-managed settings, so the
file applies. `channelsEnabled: true` is required for API-key users whenever
any managed policy exists, and for Team/Enterprise subscribers; Pro/Max ignore
it. It is harmless there: always include it.

**OATS side**, in this host's `oats-local.yaml` under `settings.oats.aweb`:

```yaml
settings:
  oats.aweb:
    claudeChannelMode: approved   # host-only
    delivery: channel             # host-wide; or per spawn: --provider oats.aweb delivery=channel
```

With channel delivery, pi uses its `@awebai/pi` extension and Codex always
uses the host broker.

**The plugin.** `aweb-channel` must be installed from the marketplace named
`awebai-marketplace` (GitHub `awebai/claude-plugins`) and enabled, in the
Claude config directory the host's Claude launch configuration uses (its
`CLAUDE_CONFIG_DIR`, else `~/.claude`).

**Existing homes** keep the delivery and channel mode recorded at their spawn.
Respawn a home to adopt the route. Setup never restarts running agents
without the operator's word.

**No launch-prompt opt-in** is needed in approved mode: the
[exact-home consent](#exact-home-launch-prompt-consent) applies only to
development mode, and qualifies only Claude 2.1.289 on `darwin-arm64`.

**Verify:**

1. `oats spawn <soul> --preview` shows `settings.oats.aweb.claudeChannelMode:
   approved` and `delivery: channel`.
2. The started session shows no development prompt, and its banner says
   `Channels (experimental) messages from plugin:aweb-channel@awebai-marketplace inject directly in this session · restart without --channels to stop`.
3. The banner does not say `not on the approved channels allowlist`,
   `not on your org's approved channels list` or `blocked by org policy`.
4. Receive is proven only by the `/oats-aweb` nonce exchange.

**Limits.** Channels are an Anthropic research preview. Anthropic's
account-level feature flag gates channels on every route. The allowlist
matches the marketplace by name.

## Exact-home launch prompt consent

`launchPromptAnswers` belongs only in the host's `oats-local.yaml`. It is
refused in workspace and soul declarations. Add an entry only for a home whose
owner has explicitly authorized Claude's aweb development-channel confirmation:

```yaml
launchPromptAnswers:
  homes:
    /absolute/canonical/instance/home:
      awebDevelopmentChannel: false
```

`awebDevelopmentChannel` is a strict boolean; absent means `false`. Unknown keys
are refused. `workspaceTrust` is unsupported: remove it and handle folder trust
through the explicit [native trust command](harness-trust.md). Launch prompt
consent does not authorize a native trust write.
Each home key is an exact absolute canonical path, with no symlink alias,
wildcard, dot segment, trailing separator, ancestor inheritance or soul-wide
default. A home not yet created uses its resolved existing directory ancestor
plus its intended suffix; launch checks the created home's identity again.
No existing home is enabled automatically. Removing an entry disables consent
for future launches.
On a case-insensitive filesystem (the macOS default) one home has several
letter-case spellings, and a key in any of them is valid. A key spelled exactly
as the home is launched decides. Otherwise the single key naming the same
directory decides, and `consentSource` points at that key. Several keys naming
it in different case, with none spelled exactly, decide nothing: no consent.
Consent never reaches another directory.

The sole confirmation covered is Claude's development-channel prompt for
`plugin:aweb-channel@awebai-marketplace`. The provider's `claudeChannelMode`
selects arguments; it does not grant consent. Approved-mode arguments, another
plugin, multiple plugins or contradictory channel arguments cannot qualify.
Environment values, spawn flags and saved launch recipes cannot enable consent.
Existing harness folder-trust configuration remains independent.
The version-independent route, with no prompt to answer, is
[the approved route](#claude-channel-delivery-the-approved-route).

Preview reports effective `launchPromptAnswers.awebDevelopmentChannel` and
`consentSource` without terminal capture or input. `--no-launch` never answers.
The qualified fixture is limited to Claude 2.1.289 on `darwin-arm64`, at terminal
geometry 110 columns by 35 rows, with executable SHA-256
`03d66745e3bb69ec727d66023696f3820bc0a00a8a5ba725eb6706d0c67cbe69`.
The launch must satisfy these guards and the exact complete frame, selection
and argument checks. Reported version alone is insufficient; another
executable, platform, geometry or prompt variant does not inherit acceptance.
The qualified channel frame starts on its accepted option and permits one
Enter only. Folder-trust and API-key questions remain unexpected and block.
A qualified normal-output boundary closes observation without asserting readiness.

**Qualified completion and limitation:** the existing exact captured and
source-derived empty API/subscription frames remain supported. After one recorded
submitted channel Enter, the same qualified Claude 2.1.289 darwin-arm64 executable
also recognizes the [bounded bottom input/footer structure](launch-prompt-completion.md)
at 110x35. Its six mode labels, five effort labels and finite hints are
source-qualified; header/billing/model and preceding task text are not structural
completion conditions. The 21 exact question markers take precedence over both
completion paths after submission. Normal `? for shortcuts` and `esc to interrupt`
are not markers. Input authorization and exact-home consent are unchanged.

**Accepted reporting risk:** an unknown dialog retaining the composer/footer can
be misclassified completed. Completion permanently closes input authority, but
proves neither absence of all questions nor idle/account/channel readiness.
Missing effort, trailing notices, wrapped footers and other unsupported shapes
still block. A feature-flag footer change can reduce matches without a binary
change. A matched structural frame must be saved privately before completed is
audited; failure reports incomplete with the answer and target preserved.

A submitted Enter can therefore precede `E_SPAWN_INCOMPLETE`; the pane may already
be active. Inspect the answer, checked event receipt and retained target, rather
than automatically retrying input or relaunching. Existing API fixtures used
isolated dummy credentials; the observed Max regression is a labeled home-only
sanitized derivative of one controller-compared in-progress frame, not a new
end-to-end launch proof or general production-success claim.

When a harness update changes the version-bound prompt frame, opted-in homes
block again with `blocked: unexpected prompt` until fixtures are refreshed.
There is no fallback keystroke or broader matching rule. The returned
`launchPrompts.receipt` identifies the launch-prompt event receipt; the home
and pane are retained for inspection. See [launch outcomes](execution-targets.md#launch-prompt-outcomes)
for recovery. Answering a confirmation never establishes harness or messaging
receive readiness.

## Launch configurations

An entry has `harness` (`pi` \| `claude` \| `codex`, required), `executable`
(a bare name looked up on `PATH`, or a path relative to this deployment
directory), `args` (literal, no shell), `env` (a literal string, or
`{ fromEnv: NAME }` resolved on the host at start), `model`, `yolo` and
`default` (0.32; see [the harness default](#the-harness-default)). A launch
configuration is a host choice: a soul never names one.

- Select one with `--launch-config <name>` on `oats spawn`,
  `oats session start` and `oats session restart`. A named configuration is
  a unit: a `--harness` that disagrees with it is refused
  (`E_LAUNCH_CONFIG_MISMATCH`); `--model` and `--yolo` override its fields.
- Without `--launch-config` or `--harness`, a spawn follows the soul's
  [launch preference](#launch-preferences) (else `pi` with its defaults), and
  an existing home keeps what it recorded. `--harness` alone leaves the recorded
  configuration behind and uses the new harness's defaults. A model never
  crosses harnesses.
- The executable must be a regular executable file; it is never run to probe
  it.
- `oats launch-config list` shows the effective entries;
  `oats launch-config set <name> --file <json>` and
  `oats launch-config remove <name>` rewrite only this block;
  `oats launch-config preview (--home <abs> | --soul <name>) --json` shows
  what a start would run (harness, model, executable, argv, redacted
  environment, command and preflight checks) and starts nothing.
- The old key `runtime` is still read as `harness`, with a
  `deprecated-runtime-name` warning.

### The harness default

`default: true` makes a configuration this host's baseline for its harness
(0.32, feature `launch-config-default`). Use it for what every launch of a
harness on this machine needs, whatever soul or preference chose it: an
account directory (`CLAUDE_CONFIG_DIR`), a wrapper `executable`, an argument.

- **When it applies:** a new launch that picks the harness without naming a
  configuration: a soul's `launch:`, an inline `souls.launch` preference,
  `--harness` (on a spawn, or on `session start|restart` of an existing
  home), `--reselect-launch`, and the host default (`pi`). It supplies the
  executable, args, env and `yolo`. A `yolo` recorded from a default stays
  with it: a later `--launch-config none` or another harness does not carry
  it over.
- **The model** comes from whatever picked the harness (`--model`, then the
  preference); the default's `model` is the last fallback, before the
  harness's own.
- **A named configuration runs as declared**: `--launch-config <name>` or a
  `souls.launch` name never inherits from the default. `--launch-config none`
  (or a `souls.launch` entry of `none`) asks for the bare harness and
  bypasses it.
- **One per harness.** A second `default: true` for the same harness is
  refused (`E_LAUNCH_CONFIG_INVALID`, naming both); move it by clearing the
  old one first.
- **Existing homes keep their launch** until `--reselect-launch` or a
  respawn, like any change of preference. Declaring a default is such a
  change: `oats readiness --home` warns `launch-changed` on each existing
  home the default would now apply to, until it is restarted with
  `--reselect-launch` or respawned.
- **It is visible.** `oats launch-config list` marks it; `spawn --preview`,
  `launch-config preview`, `instance.json` and `oats inspect --home` say when
  a launch's configuration came from the default (`launchConfigDefault`).
  A default with `yolo: true` turns yolo on for every launch of that harness
  here: the preview shows it.
- **Every kernel that reads the deployment needs OATS 0.32+.** OATS 0.31
  and older refuse the whole `oats-local.yaml` (`E_WORKSPACE_SCHEMA`) once a
  configuration declares `default`.

`oats-claude-config` (a one-line file naming the claude binary, found walking
up from the deployment) is no longer read. A new claude launch with one in
reach is refused (`E_CLAUDE_CONFIG_REMOVED`) naming the file: declare the
name it holds as the claude default (`executable: <name>`, `default: true`)
and delete the file. Homes launched with it keep their recorded executable.

### Launch preferences

A soul says what its role should run on, and each machine may override it
(0.30; the design is
[soul launch preferences](design/2026-09-28-soul-launch-preference.md)):

```yaml
# souls/<soul>/soul.yaml — only a harness and a model
launch: { harness: claude, model: claude-opus-5-5 }

# oats-local.yaml
souls:
  launch:
    "*": personal                                    # a launch configuration, for every soul here
    oats-expert: { harness: claude, model: claude-opus-5-5 }
    oats.engineering/code-reviewer: { harness: codex }   # a package soul
```

- **Precedence for a new launch:** `--launch-config` or `--harness`, then
  `souls.launch.<soul>`, then `souls.launch."*"`, then the soul's `launch:`,
  then `pi` with its defaults. `--model` alone keeps the deciding layer's
  harness and replaces only its model.
- A **launch configuration** name runs that configuration's full recipe. An
  **inline or soul preference** runs its harness the way this host starts it
  without a configuration: [the harness default](#the-harness-default) if
  one is declared, else the executable on `PATH` with no args and no env,
  with the preference's `model`. A preference without `model` uses the
  harness default's model, else the harness's own; it never borrows a lower
  layer's.
- **A missing harness is refused**, never replaced: `E_HARNESS_UNAVAILABLE`
  names the layer that chose it and the fix (install the harness, or override
  it here in `souls.launch`). `oats souls` still lists the soul, with the
  problem.
- **Existing homes keep their launch.** A changed preference does not affect
  a running or stopped home until `oats session restart --reselect-launch`
  (or `start --reselect-launch`) or a respawn. `session start|restart --model`
  keeps the recorded harness and replaces only the model. `oats readiness --home` shows
  the drift as the `launch-changed` warning; `oats inspect --home` shows
  `launch` (the record) beside `launchCurrent`.
- `oats souls`, `oats inspect --soul` and `oats spawn … --preview` show each
  soul's `launch`: its own preference, the effective launch, and which layer
  decided (`from`) and where (`at`).
- **Migration.** 0.29 refuses a soul.yaml it does not know, so a committed
  soul gains `launch:` only once every deployment of the workspace runs 0.30.
  Until then, set the preference in `souls.launch` on each machine.

**Environment references.** `{ fromEnv: SRC }` is rendered as a reference,
never a value, in the recorded command and in every answer. At start each
source variable must be set on the host (`E_LAUNCH_ENV_MISSING`, before
anything is created or stopped), and only the harness's pane receives it.
`list` and `preview` redact every environment value, literals included.

**The instance's `oats`.** Every launch (`oats spawn`, `session start`,
`session restart`, locally or through `--server`) writes `<home>/.oats/bin/oats`,
a link to the launching kernel's `bin/oats.mjs`, and runs the harness with
`<home>/.oats/bin` first on `PATH` and the rest of `PATH` unchanged. Plain
`oats` inside an instance is therefore the kernel that launched it, even on a
machine whose `PATH` finds another kernel first. A launch configuration's own
`PATH` (literal or `fromEnv`) comes after it. A restart by a different kernel
re-points the link to that kernel; `spawn --no-launch` writes it too. The
recipe in `instance.json` records the target as `launch.kernelBin` (no JSON
answer carries it); `oats status` prints it
(`kernel:`) under `--verbose`, or when it is not the `oats` running the status.
A launch that cannot write the link fails with `E_LAUNCH_SHIM` naming the path
and the cause: a spawn is rolled back, a start starts nothing. The recorded
`command` does not carry the `PATH`; the kernel adds it when it runs the
command. Hooks still receive `OATS_CLI_BIN`, unchanged.

**The launch recipe.** A spawn records what a start is made of in
`instance.json` under `launch`: the harness, the configuration and where it
came from, the executable, args, env, model, yolo, and each capability's
launch contribution with its settings and trust, and the kernel that launched
it (`kernelBin`, re-written by every start). One renderer turns it into
the `command`. Configuration `args` go after the harness's own options and
before capability arguments; every argument is single-quoted.

**Starting and restarting a home.** `oats session start --home <abs>` runs
the recorded recipe. With `--launch-config`, `--harness` or `--yolo`, the
recipe is resolved again against the home's recorded context and every check
runs first. With `--reselect-launch`, the launch preferences decide again
(the home's recorded soul and this deployment's `souls.launch`). A capability that contributed harness-specific arguments must
declare a `launch` hook to follow a harness change; otherwise the start is
refused (`E_LAUNCH_PREPARATION`). The checks use the preview run
(`OATS_LAUNCH_PREVIEW=1`) of the launch hooks whose capabilities declare
`launchPreview`. Those hooks run for real only after every check has passed,
so a start refused by preflight has run none of them for real. Other launch
hooks run once, for real, during the checks (see
[capabilities.md](capabilities.md)). A launch hook's warnings do not stop
the start: `session start|restart` print them (and answer them as
`warnings` under `--json`), as spawn does, and each is kept as a
`launch-warning` instance event (`oats instance events`).
`oats session restart` runs the same
checks, then sends SIGTERM to the harness and what it started, waits
(`--stop-grace <seconds>`, default 20) for them to exit, and starts again in
place. It never escalates: a harness still running is reported
(`E_SESSION_STOP_FAILED`) and nothing is launched. What a harness saves on
SIGTERM is its own; a wrapper script should `exec` the harness or forward
signals.

## Who runs workspace automations

A workspace trigger or schedule names the host that runs it (`runsOn`) and
the GitHub account it acts as (`owner`). Both come from a commit, so a host
also has to say yes itself (0.30):

```yaml
automations:
  trust:
    - agents/pr-review          # <member>/<id>
    - agents/nightly-digest
# or: trust: "*"                # every automation the workspace places on this host
```

- It runs only if `runsOn` is this host's `host.name`, its `owner` is this
  host's `gh` account, **and** `trust` admits it. `triggers.disabled` and
  `schedules.disabled` still opt out on top.
- A placed but untrusted one never runs. Its row has reason `untrusted`, and
  `oats workspace status` warns with the line to add.
- An entry that names nothing is a warning, not an error.
- `automations` is a host key: the committed `oats-workspace.yaml` refuses
  it.
- **Upgrading to 0.30:** a host that ran workspace automations must add its
  `trust` lines; until then they do not run there.
- Your own triggers and schedules (`oats trigger add`, `oats schedule add`)
  need no trust. Details: [schedules.md](schedules.md#workspace-triggers-and-schedules).

## The deployment directory

Every `oats` command that needs the workspace walks **up** from the current
directory (or `--dir`) to the nearest `oats-local.yaml`; its directory is the
deployment. Not found → `E_LOCAL_MISSING`. Nothing above that directory
composes into it: a deployment created inside another one sees only its own
files.

```
~/acme/
├── oats-local.yaml
├── oats-lock.json          # written by `oats sync` (packages.md)
├── oats-schedules.json     # this host's local schedules and triggers (schedules.md)
├── agents/                 # instance homes and the fetched soul copies
├── .oats/modules/          # the capability store for operator-level commands
└── <member clones>/        # only where someone works IN a repository
```

**The capability store.** A capability command run from the deployment for a
soul (`oats <namespace> <command> --soul <soul>`) fetches that capability at
its locked commit into `.oats/modules/<capability>@<commit12>/`, verifies its
content digest against the lock (recorded beside it as
`.<capability>@<commit12>.digest`) and runs that copy. A tree that no longer
matches its record is fetched again. An instance never uses the store: each
home has its own copy under `<home>/.oats/modules/<capability>/`
([souls-and-instances.md](souls-and-instances.md)). The store is a cache; it
is safe to delete.

## What is not in it

- **Which capabilities a soul gets:** the soul's `capabilities:` plus the
  workspace `defaults`.
- **Versions:** `packages:` in the workspace file; exact commits in
  `oats-lock.json`.
- **Trust:** membership for members, the workspace's `packages:` declaration
  for packages ([packages.md](packages.md#trust)).
- **Per-instance provider facts:** `oats spawn <soul> --provider <cap> key=value`,
  recorded in the instance's `instance.json`.
- **Shared teams, stores and defaults:** the workspace file.
- **Claude's channel admission:** Claude's own managed policy (server-managed
  settings, an MDM profile or the root-owned managed-settings file; see
  [the approved route](#claude-channel-delivery-the-approved-route)).

## Inspecting the effective configuration

```bash
oats workspace status          # members, locked packages, external souls
oats sync                      # confirm, resolve, lock, report the diff
oats teams                     # shared and local teams, and the default
oats soul teams <soul>         # the teams one soul may join here, and why
oats spawn <soul> --preview    # the exact modules, teams and provider payloads
oats doctor                    # this deployment's files and the lock
```

Environment: `OATS_REMOTE_CACHE` relocates the fetch cache (which also holds
the bounded parsed-read cache and the observations `--max-age` reuses; all of
it is safe to delete); `OATS_PACKAGE_CATALOG` names an alternative package
catalog file. The read verbs (`status`, `workspace status`, `souls`,
`capabilities`, `inspect`, the read forms of `teams` and `soul teams`, and
`spawn --preview`) take `--max-age <seconds>` to reuse a remote head observed that recently
([Observation reuse](desktop-cli-api.md#observation-reuse-feature-observe-max-age-oats-0311)).
