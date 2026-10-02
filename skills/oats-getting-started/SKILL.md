---
name: oats-getting-started
description: >-
  How to start with OATS (Open Agent Team Specification) from nothing — install
  the CLI and pi adapter, decide which repository hosts the organisation's
  workspace, write the three shared declarations (oats-workspace.yaml,
  oats-membership.yaml, souls/<name>/soul.yaml), realize the workspace on this
  machine with `oats onboard` and spawn the first soul. Use
  for "get started with OATS", "set up/install/adopt OATS", "create my first
  agent", or "how do I start using OATS".
---

# Getting started with OATS

OATS gives an organisation durable **souls** (role definitions kept in Git),
disposable **instances** (a soul at work, in its own home) and **capabilities**
(skills, instructions and hooks copied whole into each instance at spawn). One
**workspace** per organisation lists the repositories that belong to it. Do not
run setup blindly: explain each decision and ask before writing a file,
declaring a package or spawning.

This skill is the one pre-workspace bootstrap. Once the first instance exists,
the `oats.setup` capability's skills (and the `oats-operator-expert` soul, where
the workspace offers it) carry the rest; spawned instances get their own skills.

## 1. Install

```bash
npm install -g @awebai/oats
pi install npm:@awebai/oats-pi
```

Install matching versions and upgrade both together (`oats update`). Reload pi
after installing or upgrading the adapter. Check with `oats version`.

## 2. Decide where the workspace is hosted — first

The workspace file names every member repository, so whoever can read it sees
the member list. Ask:

- **Does the organisation already have an OATS workspace?** Then skip to step 4
  with its repository reference.
- **Is any repository that will join private?** Then the workspace file lives
  in a private repository that is not itself a public member (a dedicated
  `<org>/workspace` repository is the honest shape). Otherwise any member,
  often a dedicated `agents` repository, can host it.

Every member runs its capabilities' hooks on every operator's machine, gated
only by membership. In a mixed public/private organisation keep executable
capabilities in packages or private members, and only souls in public members.

## 3. Write the shared declarations (in Git, reviewed like code)

In the host repository, `oats-workspace.yaml`:

```yaml
schemaVersion: 2
name: acme
members:
  - git:github.com/acme/agents          # the host is a member too
  - git:github.com/acme/platform
packages:
  oats.framework: v1.4.2                # bare versions resolve through the official catalog
  oats.okf: v4.1.1
defaults:
  capabilities: { oats.core: { from: package } }
  knowledge: { oats.okf: { from: package } }
```

Take the current package versions from the official catalog
(`package-catalog.json` in the OATS repository); ask which slots the user wants
filled (knowledge, messaging, tasks) instead of copying the example. No absolute
paths or accounts go in this file. Teams come with messaging (step 6).

Declaring a package in `packages:` is the decision to trust it: its commands
and hooks run on every machine that spawns a soul using it. Show the user what
each package runs (its capability manifests' `commands` and `hooks`) before
adding its pin.

In **every** member repository, including the host, `oats-membership.yaml`:

```yaml
schemaVersion: 2
workspace: git:github.com/acme/agents
```

Membership is reciprocal: the workspace lists the repository and the
repository names the workspace back. Neither alone is membership.

A soul lives at `souls/<name>/` in a member repository: `soul.yaml`,
`AGENTS.md` (its canonical instructions) and `CLAUDE.md -> AGENTS.md`.

```yaml
schemaVersion: 2
name: backend-expert
description: Owns backend architecture and implementation.
work: worktree            # worktree | checkout | directory | workspace
```

A soul says where each extra capability comes from (`{ from: package }`,
`{ from: here }` or `{ from: <member repo key> }`), never a version. A soul
whose knowledge slot is filled by `oats.okf` also needs `okf.json` beside
`soul.yaml`; `docs/knowledge.md` in the OATS repository shows its shape.
Commit and push; OATS reads members over their remotes, not from local clones.

## 4. Realize the workspace on this machine

Ask the user **which directory** holds this machine's deployment — usually the
folder that already holds their clones. There is no required name.

```bash
oats onboard <dir> --workspace git:github.com/acme/agents
```

It writes `<dir>/oats-local.yaml` (the one per-machine file, never committed)
and `agents/`, confirms each member, resolves and locks the packages, and prints
the next steps. Fix any member that is not confirmed (`oats workspace status` says why) before going on.

Host-owned settings a package asks for (absolute paths, state directories) go
under `settings:` in `oats-local.yaml`, never in the workspace file. For
`oats.okf` that is `bindings-file` and `state-dir`; its own skill explains the
bindings file.

## 5. Sync after any change

```bash
oats sync --dir <dir>          # resolve every pin to a commit, fetch, verify integrity, write oats-lock.json
```

Run it after any change to the workspace file. It asks nothing; the lock pins
each package to an exact commit and integrity, and content that no longer
matches is refused (`E_PACKAGE_INTEGRITY`). Member capabilities come from
membership.

## 6. Give the deployment a team (with messaging)

If a messaging capability fills the messaging slot, every instance lives in a
team, and readiness fails with `E_TEAM_UNCONFIGURED` until this deployment has
a default team. Create the team with the messaging provider (its own skills say
how), then record it:

```bash
oats teams add research --team <provider team id>   # a local team; the first one becomes the default
oats teams
```

A team the whole organisation uses is committed in `oats-workspace.yaml` as
`teams.<label>` with its provider id; which souls join which team on this
machine is `oats soul teams` (`/oats-teams`, in `oats.setup`).

## 7. Spawn the first soul

A soul with `work: worktree | checkout` needs a clone of its repository at
`<dir>/<repo name>` (or named in `oats-local.yaml` `clones:`).

```bash
oats souls --dir <dir>                                  # what the workspace offers, with origin and teams
oats spawn backend-expert --preview                     # modules, commits, merged provider settings — nothing created
oats spawn backend-expert --task "First concrete task"
oats status
```

Create and spawn only when asked. After the first spawn, the `oats.setup`
skills carry the rest of the deployment (messaging, more souls, rebuilds); the
`oats.authoring` package teaches writing capabilities, skills and souls. The
model in full is `docs/workspaces.md` in the OATS repository.
