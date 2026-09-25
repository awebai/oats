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
converted: [rebuild-to-v2.md](rebuild-to-v2.md).

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
    runtime: claude
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
| `launch-configs.<name>` | A named way to start a harness on this host (0.26.0; lead decision 2 — a spawn-time host choice, never a soul field): `runtime` (`pi` \| `claude` \| `codex`, required), `executable` (a bare name looked up on `PATH`, or a path — relative to this deployment directory), `args` (literal, no shell), `env` (a literal string, non-secret by contract and always redacted, or `{ fromEnv: NAME }` resolved on the host at start), `model`, `yolo`. Selected with `--launch-config <name>` on `oats spawn` and `oats session start \| restart`; explicit flags override its fields. Written by `oats launch-config set <name> --file <json>` / `remove <name>`, which rewrite only this block. Earlier kernels read `launch-configs:` from a scope's `oats-config.yaml`; 0.26.0 refuses it there with a message naming this move. |

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
  workspace `defaults` (and `defaults.byTeam`). There is no per-deployment
  activation or targeting.
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
