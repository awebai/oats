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

clones:                                      # optional — member clones outside the <name>-workspace/ convention
  github.com/acme/platform: /Users/ana/src/acme-platform

settings:                                    # optional — host-owned values per capability
  oats.okf:
    bindings-file: /Users/ana/.oats/okf-bindings.json
    state-dir: /Users/ana/.oats/okf
  oats.aweb:
    delivery: channel

souls:                                       # optional — souls this machine does not run
  disabled: [data-analyst]
```

Schema: [`oats-local.schema.json`](oats-local.schema.json). Unknown keys are
refused (`E_WORKSPACE_SCHEMA`).

| key | meaning |
|---|---|
| `workspace` | Repo ref of the workspace host (`git:host/org/repo`, `https://…`, `git@host:…`, `file:///…`, `/abs/bare.git`). Read with your own Git credentials; the repo need not be cloned. |
| `clones` | `<canonical repo key>: <absolute path>` — where a member's clone lives when it is not at `<deployment>/<repo-name>/`. Only a soul's **work target** needs a clone. |
| `settings.<cap>.<key>` | Host-owned provider values the capability's manifest asks for — absolute paths, state roots, delivery modes. The workspace file **refuses** absolute paths; this is where they go. Merged into the capability's provider payload after the soul's own payload and before any `--provider` flag (see [three homes](workspaces.md#provider-payloads-have-three-homes)). |
| `souls.disabled` | Soul names not run on this machine; reported by `oats sync` ("disabled here"). |

## Where it sits and how it is found

Every `oats` command that needs the workspace (`sync`, `workspace status`,
`capabilities`, `souls`, `spawn`, `status` drift) walks **up** from the current
directory (or `--dir`) to the nearest `oats-local.yaml`; its directory is the
deployment. Not found → `E_LOCAL_MISSING`. Beside it:

```
~/acme-workspace/
├── oats-local.yaml
├── oats-lock.json          # written by `oats sync` (lock v3; docs/packages.md)
├── agents/                 # instance homes + fetched member-soul sources
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
- **Trust** — membership for members; per-version approval in the lock for
  packages. No per-operator trust list.
- **Per-instance provider facts** (a retained messaging seat, a one-off state
  root) — `oats spawn <soul> --provider <cap> key=value`, recorded in
  `instance.json.providers`.
- **Team labels, stores, messaging policy** — the workspace file.

## Inspecting the effective configuration

```bash
oats workspace status          # membership table, locked packages, approval state, external souls
oats sync                      # confirm, resolve, approve, report the diff
oats capabilities | oats souls # everything a soul may name, with origin and team
oats spawn <soul> --preview    # the exact modules (from/commit/changedSince), team, resolution revision
oats doctor                    # this deployment's oats-local.yaml and lock, plus kernel diagnostics
```

Environment knobs the kernel honours: `OATS_REMOTE_CACHE` (relocates the
invisible fetch cache), `OATS_PACKAGE_CATALOG` (an alternative catalog file).
