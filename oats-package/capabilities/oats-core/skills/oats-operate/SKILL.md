---
name: oats-operate
description: >-
  Use when operating OATS from inside an instance: your home and work
  directories, what a module is, reading `oats status` (modules, soul source,
  drift), spawning with preview then apply, relations, stopping or retiring
  instances you spawned, lifecycle events and doctor. For which souls exist and where they
  come from, use oats-souls; deployment setup belongs to oats.setup.
---

# Operating OATS from an instance

OATS realizes an organisation's **workspace** (a Git-shared declaration of
member repositories and pinned packages) on a machine, in a **deployment
directory** the operator chose. Souls are defined in member repositories;
instances are spawned from them into homes under the deployment's `agents/`.

Run `oats` commands from **your instance home** (they find the deployment by
walking up to `oats-local.yaml`), or pass `--dir <deployment>`. Use `--json`
when you parse output. When a flag is not shown here, read `oats help` — never
invent one.

## Your two directories

```
<deployment>/agents/<soul>/instances/<instance>/   ← your home ($OATS_INSTANCE_HOME)
├── AGENTS.md            composed instructions: the soul's own + each module's inject + work-mode block
├── CLAUDE.md → AGENTS.md
├── .agents/skills/<capability>/<skill>/             every skill you were given, copied
├── .claude/skills → ../.agents/skills
├── .oats/modules/<capability>/                      each capability, copied whole
├── instance.json        what you were given and from where
├── TASK.md              this task
└── work/                your repository view (per your work mode)
```

- **The home is your state and your brain**: instructions, task, working
  notes, whatever your knowledge capability keeps. OATS operational commands
  run here.
- **`work/` is where repository work happens**: reading, editing, building,
  testing, Git. Never run Git from the home root or from the operator's own
  checkout.
- **A change to a soul is repository work**: an ordinary, reviewed change to
  the member repository that defines it, made in a work tree.

Work modes (from the soul's `work:`): `worktree` — your own branch in a Git
worktree of the soul's repository; `checkout` — a shared checkout;
`directory` — an owned directory, no repository; `workspace` — `work/` is the
deployment directory itself, read-only across members, for coordination.

## Modules: what you were given

A **module** is one capability copied whole into your home at spawn — its
skills, instruction inject, scripts and hooks — from one of two sources:

- a **member** repository at its latest commit (trusted by membership), or
- a **package** at the version the workspace pins (trusted by that
  declaration, locked to a commit and integrity).

`instance.json` records each module's source, commit and content digest
(`modules`), the provider payloads it received (`providers`), and the soul
source (`workspace.soul`). A running instance never changes under itself: a
member moving or a package being bumped affects only new spawns.

## Status and drift

```bash
oats status                  # souls, instances, and per instance: soul source + modules
oats status --json
```

Per instance, status shows `soul: <name> from <member> @ <commit>` and each
module's recorded source. An unmarked row is current; otherwise it is marked
`[member moved since (now @ …)]` (a package module: package moved since),
`[soul no longer present]`, `[capability no longer present]`,
`[package no longer locked]`, or `[member <reason>]` when the member is not
confirmed. Drift is information, not a fault: the
running instance keeps its commit; a re-spawn picks up the new state.

Other read-only views:

```bash
oats workspace status        # members confirmed or why not; locked packages
oats souls                   # souls the workspace offers (see oats-souls)
oats capabilities            # capabilities, member or package, with origin and team
oats instance events <instance>          # what happened to an instance, as recorded
oats instance git <instance>             # its work tree: branch, status, ahead/behind
oats doctor                  # this deployment's local file and lock, plus diagnostics
```

## Spawn: preview, then apply

Spawn only when your task or your human asks for it.

```bash
oats spawn <soul> --preview                         # nothing is created
oats spawn <soul> --purpose <slug> --task "…" --parent "$OATS_INSTANCE"
oats spawn <soul> --purpose <slug> --no-launch      # scaffold only
```

The preview lists the modules with source, commit and `changedSince` the
newest earlier instance of that soul, the team, the resolution revision, the
composed skill names and `settings.<capability>` — the merged payload each
provider will receive. Read it before creating anything; a spawn that uses a
preview's decision is refused if the member moved in between.

**Relations.** An instance you spawn for your own work is your **child**:
pass `--parent "$OATS_INSTANCE"` (sugar for `--relative-to <you> --relation
child`). Use `--relation sibling|parent|unrelated --relative-to <instance>`
only when that is the true relation; without one the new instance is
top-level. Ask your human when the relation is unclear.

**Naming.** `--purpose <slug>` names the instance `<soul>-<slug>`; without it
the kernel numbers it.

A soul with `work: worktree | checkout` needs a clone of its repository on
this machine; the kernel finds it through `--repo <path>`, the local file's
`clones:`, or `<deployment>/<repo name>`, and names the remedies when none
exists. Setting that up is the operator's (oats.setup), not yours.

## Stopping, starting and retiring other instances

```bash
oats instance stop <instance> --plan                 # what Stop would touch
oats session start --home <abs-home>                 # start a stopped instance in its home
oats retire <instance> --plan                        # what Remove would touch, with retention
oats retire <instance>                               # retire (window, hooks, worktree, home)
```

These act on **other** instances — typically children you spawned — and only
when your task or your human says so. Retirement runs every module's retire
hook (identities, scheduled jobs) and retains a worktree with work in it
unless told to discard.

## Rules

- Never edit `instance.json`, `oats-lock.json`, `oats-local.yaml` or anything
  under `.oats/` by hand. Report a wrong value instead.
- Never re-onboard, sync or change a deployment from an instance
  unless that is your task; those are operator actions (oats.setup).
- A scaffold is not a working session, a sent message is not a delivered
  one, and a green command on the wrong tree is not evidence. Say which tree
  and which instance a result belongs to.
- Report infrastructure faults to your spawner or human; do not self-repair.
