# Configuration — `oats-local.yaml`

A deployment has **one** per-machine file: `oats-local.yaml`. It says which
workspace this machine realizes and holds the few facts that are true of this
host only. Everything shared — members, packages and their versions, teams,
defaults, stores, the messaging policy — lives in the workspace repo's
`oats-workspace.yaml`; everything about a soul lives in its `soul.yaml`
([workspaces.md](workspaces.md)).

**`oats-config.yaml` no longer exists.** Its `capabilities.layers` /
`additive` / `from:` / `global` / `agent-types` blocks are gone — activation is
derived from workspace defaults plus each soul's `capabilities:` — and its
`souls:` blocks are gone — per-instance provider content moved to
`oats spawn … --provider`. There is no `oats init`, no `oats use`, no config
scope chain, no adopted config templates. A 0.24.x deployment is rebuilt, not
converted: write `oats-local.yaml` with `oats onboard` and move what the old
file declared into `oats-workspace.yaml` and each soul's `soul.yaml`.

## The file

```yaml
schemaVersion: 2
workspace: git:github.com/acme/agents        # REQUIRED — the workspace host, observed over the remote

clones:                                      # optional — member clones that are not beside oats-local.yaml under their repo name
  github.com/acme/platform: /Users/ana/src/acme-platform

settings:                                    # optional — host-owned values per capability
  oats.okf:
    bindings-file: /Users/ana/.oats/okf-bindings.json
    state-dir: /Users/ana/.oats/okf
  oats.aweb:
    delivery: channel

souls:                                       # optional — souls this machine does not run
  disabled: [data-analyst]

launch-configs:                              # optional — named ways this host starts a harness
  personal:
    harness: claude
    executable: "./bin/claude-wrapper.sh"    # relative → against this deployment directory
    args: ["--verbose"]
    env:
      CLAUDE_CONFIG_DIR: { fromEnv: PERSONAL_CLAUDE_DIR }
    model: opus
    yolo: false
```

Schema: [`oats-local.schema.json`](oats-local.schema.json). Unknown keys are
refused (`E_WORKSPACE_SCHEMA`).

| key | meaning |
|---|---|
| `workspace` | Repo ref of the workspace host (`git:host/org/repo`, `https://…`, `git@host:…`, `file:///…`, `/abs/bare.git`). Read with your own Git credentials; the repo need not be cloned. |
| `clones` | `<canonical repo key>: <absolute path>` — where a member's clone lives when it is not at `<deployment>/<member name>/`. Only a soul's **work target** (`work: worktree \| checkout`) needs a clone. Lookup order: `spawn --repo`, then this map (keys normalised through `parseRepoRef`, so any ref spelling of the same repo matches), then `<deployment>/<member name>` (a member named `agents` → `<deployment>/agents-repo`, since `agents/` is the instance root); none → `E_CLONE_MISSING`; a directory whose `origin` is another repo → `E_CLONE_MISMATCH`. |
| `settings.<cap>.<key>` | Host-owned provider values the capability's manifest asks for — absolute paths, state roots, delivery modes. The workspace file **refuses** absolute paths; this is where they go. Merged into the capability's provider payload after the soul's own payload and before any `--provider` flag (see [three homes](workspaces.md#provider-payloads-have-three-homes)). |
| `souls.disabled` | Soul names not run on this machine; reported by `oats sync` ("disabled here"). |
| `launch-configs.<name>` | A named way to start a harness on this host (0.26.0; lead decision 2 — a spawn-time host choice, never a soul field): `harness` (`pi` \| `claude` \| `codex`, required; named `runtime` before 0.27.0, which is still read with a `deprecated-runtime-name` warning), `executable` (a bare name looked up on `PATH`, or a path — relative to this deployment directory), `args` (literal, no shell), `env` (a literal string, non-secret by contract and always redacted, or `{ fromEnv: NAME }` resolved on the host at start), `model`, `yolo`. Selected with `--launch-config <name>` on `oats spawn` and `oats session start \| restart`; explicit flags override its fields. Written by `oats launch-config set <name> --file <json>` / `remove <name>`, which rewrite only this block. Earlier kernels read `launch-configs:` from a scope's `oats-config.yaml`; 0.26.0 refuses it there with a message naming this move. |

## Where it sits and how it is found

Every `oats` command that needs the workspace (`sync`, `workspace status`,
`capabilities`, `souls`, `spawn`, `status` drift) walks **up** from the current
directory (or `--dir`) to the nearest `oats-local.yaml`; its directory is the
deployment. Not found → `E_LOCAL_MISSING`. The deployment is also a
**configuration boundary**: nothing above the directory holding
`oats-local.yaml` composes into it (a deployment created inside another
scope — a scratch deployment under a repository, a fixture under an operator
workspace — sees only its own files; `oats inspect` reports it, not the outer
scope, as the workspace). Beside it:

```
~/acme-workspace/
├── oats-local.yaml
├── oats-lock.json          # written by `oats sync` (lock v3; docs/packages.md)
├── agents/                 # instance homes + fetched member-soul sources (created by `oats sync` / `oats onboard` if absent)
└── <member clones>/        # only where someone works IN a repo
```

Never commit `oats-local.yaml` to a shared repo: it names one machine's paths.
Two operators of the same workspace share the declarations through Git and
nothing else.

## What is NOT in it

- **Which capabilities a soul gets** — the soul's `capabilities:` plus the
  workspace `defaults`. There is no per-deployment activation or targeting.
  (Which *teams* a soul belongs to on this machine IS here: `teams`,
  `defaultTeam`, `souls.teams`, `souls.default` — see
  [workspaces.md](workspaces.md#teams).)
- **Versions** — `packages:` in the workspace file; exact commits in
  `oats-lock.json`.
- **Trust** — membership for members; the declaration in the workspace's
  `packages:` for packages (no approval step). No per-operator trust list.
- **Per-instance provider facts** (a retained messaging seat, a one-off state
  root) — `oats spawn <soul> --provider <cap> key=value`, recorded in
  `instance.json.providers`.
- **Team labels, stores, messaging policy** — the workspace file.

## Inspecting the effective configuration

```bash
oats workspace status          # membership table, locked packages, external souls
oats sync                      # confirm, resolve, lock, report the diff
oats capabilities | oats souls # everything a soul may name, with origin and team
oats spawn <soul> --preview    # the exact modules (from/commit/changedSince), team, resolution revision
oats doctor                    # this deployment's oats-local.yaml and lock, plus kernel diagnostics
```

Environment knobs the kernel honours: `OATS_REMOTE_CACHE` (relocates the
invisible fetch cache), `OATS_PACKAGE_CATALOG` (an alternative catalog file).

## Launch configurations

An entry has `harness` (`pi` \| `claude` \| `codex`, required), `executable`
(a bare name looked up on `PATH`, or a path relative to this deployment
directory), `args` (literal, no shell), `env` (a literal string, or
`{ fromEnv: NAME }` resolved on the host at start), `model` and `yolo`. A
launch configuration is a host choice: a soul never names one.

- Select one with `--launch-config <name>` on `oats spawn`,
  `oats session start` and `oats session restart`. A named configuration is
  a unit: a `--harness` that disagrees with it is refused
  (`E_LAUNCH_CONFIG_MISMATCH`); `--model` and `--yolo` override its fields.
- Without `--launch-config`, a spawn uses the harness's defaults, and an
  existing home keeps what it recorded. `--harness` alone leaves the recorded
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

**Environment references.** `{ fromEnv: SRC }` is rendered as a reference,
never a value, in the recorded command and in every answer. At start each
source variable must be set on the host (`E_LAUNCH_ENV_MISSING`, before
anything is created or stopped), and only the harness's pane receives it.
`list` and `preview` redact every environment value, literals included.

**The launch recipe.** A spawn records what a start is made of in
`instance.json` under `launch`: the harness, the configuration and where it
came from, the executable, args, env, model, yolo, and each capability's
launch contribution with its settings and trust. One renderer turns it into
the `command`. Configuration `args` go after the harness's own options and
before capability arguments; every argument is single-quoted.

**Starting and restarting a home.** `oats session start --home <abs>` runs
the recorded recipe. With `--launch-config`, `--harness` or `--yolo`, the
recipe is resolved again against the home's recorded context and every check
runs first. A capability that contributed harness-specific arguments must
declare a `launch` hook to follow a harness change; otherwise the start is
refused (`E_LAUNCH_PREPARATION`). `oats session restart` runs the same
checks, then sends SIGTERM to the harness and what it started, waits
(`--stop-grace <seconds>`, default 20) for them to exit, and starts again in
place. It never escalates: a harness still running is reported
(`E_SESSION_STOP_FAILED`) and nothing is launched. What a harness saves on
SIGTERM is its own; a wrapper script should `exec` the harness or forward
signals.
