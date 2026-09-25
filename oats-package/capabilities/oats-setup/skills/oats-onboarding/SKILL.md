---
name: oats-onboarding
description: >-
  Use when helping an operator realize an OATS workspace on a machine: deciding
  where the workspace file is hosted, writing or checking the shared
  declarations, choosing the deployment directory, running `oats onboard`,
  placing host settings, syncing, setting up messaging, cloning work targets
  and verifying before the first spawn. For package pins see oats-package-pins.
---

# Onboarding a deployment

This skill is the **procedure**. The **why** of each step — and what goes
wrong without it — is the operator knowledge node (`oats/oats-operator-expert`
in the central base); the concept named at a step is the one to consult before
advising. The **contract** is `docs/workspaces.md` and `docs/configuration.md`
in the installed kernel (`"$(oats root)/docs/"` — they ship with it and
match the running version). Do not restate either to the operator from
memory; read them.

Explain each decision, ask before writing a file, declaring a package or
spawning, and never run a step on a deployment the operator did not name.

## 1. Ask two things first

1. **Which directory is the deployment?** Ask; never impose a name. It is
   usually the folder that already holds the operator's clones. `oats onboard`
   adds only `oats-local.yaml`, `oats-lock.json` and `agents/` there.
2. **Which repository hosts the workspace file?** Get its reference
   (`git:github.com/<org>/<repo>`, `https://…`, `git@host:…`). If there is no
   workspace yet, continue with step 2; otherwise go to step 3.

## 2. Hosting and the shared declarations (only if the workspace is new)

- **Hosting rule.** If any member is private, host the workspace file in a
  dedicated private repository that is not itself a public member; decide
  this before the first sync. *Rationale:* operator node, decision
  "private member requires a private workspace host".
- **Trust is declaration.** Listing a member is the whole trust decision for
  its capabilities, and listing a package in `packages:` is the whole trust
  decision for that package: their hooks and scripts run on every operator's
  machine at spawn. Before declaring a package, show the operator what it
  runs (its manifests' `commands` and `hooks`). In a mixed organisation keep
  executables in packages (a reviewed pin, locked to a commit) or private
  members; public members carry souls.
- Write `oats-workspace.yaml` in the host, `oats-membership.yaml` in every
  member (the host included), and `souls/<name>/` for each soul, as reviewed
  changes. Shapes, field by field: `docs/workspaces.md` ("The files"). No absolute paths, accounts or team
  ids in any shared file. *Rationale:* operator node, lesson "place each fact
  at the scope that owns it".

## 3. Onboard

```bash
oats onboard <deployment-dir> --workspace <repo-ref>
```

Read the report row by row. Every member must be `confirmed` (`✓↔`); any other
status (`no-backlink`, `backlink-elsewhere`, `not-listed`, `cannot-read`) is
fixed in the member's repository or the operator's Git access, not worked
around. `oats workspace status --dir <deployment-dir>` re-reads the same
picture.

## 4. Host settings before the first spawn

Some packages need host-owned values; they go under `settings.<capability>`
in `<deployment-dir>/oats-local.yaml`, never in a committed file. Read each
package's manifest (`oats.json#settings`) for its keys — the installed
provider is the authority, not a doc example. *Rationale:* operator node,
lesson "the installed provider is the authority for a setting".

- **Knowledge (`oats.okf`)**: `bindings-file` and `state-dir`, both absolute
  host paths, and a bindings file that binds every base alias the souls'
  `okf.json` name, under exactly those aliases (the workspace file lists them
  next to `stores:`). Use real paths: the provider's path check refuses a
  path that traverses a symlink (`E_PATH symlink not allowed`; on macOS `/tmp`
  is one — use `/private/tmp`). A soul whose knowledge slot is `oats.okf`
  does not spawn until these exist — set them before spawning any soul, the
  operator expert included.
- **Messaging** is set up in its own step, after sync (step 6).
- A fact true of **one spawn** (a retained messaging seat) is not a host
  setting: it is `oats spawn <soul> --provider <cap> key=value`.

## 5. Sync after any change

`oats onboard` already synced. After any change to the workspace file (a pin,
a member, a default), run `oats sync`: it resolves every package to a commit,
fetches it, verifies its integrity and writes `oats-lock.json`. See
**oats-package-pins**.

## 6. Set up messaging before the first spawn

If the workspace's messaging default, or any soul, uses `oats.aweb`, its spawn
hook is required: with no initialised aweb root among the places it looks, the
spawn is rolled back. With messaging as the workspace default that is **every**
soul, the operator expert included. So set the root up now, after sync and
before any spawn.

Put the root **in the deployment directory**. The hook looks in the parent of
`agents/`, which is the deployment directory when `agents/` sits directly in it
(the layout `oats onboard` creates). Where the root sits decides which team
the instances join.
*Rationale:* operator node, lesson "messaging root placement decides the
team" — read it before choosing another place.

The root must be a **member of the team the workspace's messaging payload
names** (`messaging:` / `messaging.byTeam` in the workspace file). `aw init`
alone in a clean directory creates a hosted account and joins no team, so every
spawn would still be refused. Obtain the membership first:

1. **Join the team** from the clean deployment directory. An existing member
   of that team creates an invite; the operator joins here. (Or, for a new
   team, create it here.)

   ```bash
   aw team invite --team-id <team id>              # run by an existing member, where their root is
   cd <deployment-dir>
   aw team join <invite-token> --name <alias>      # the operator, in the clean deployment directory
   ```
2. **Connect**, only if the join did not: `aw init --do-not-touch-agents-md`.
3. **Check**: `aw check --online`, then `aw team list --json` must show the
   payload's team as the active one. A root in another team mints instances
   into the wrong one.

Joining and initialising act on the messaging service: ask the operator first,
and let them run it. oats.aweb 1.12.0's `oats aweb setup` still reads the
earlier configuration file's team block; in a workspace-model deployment use
`aw` directly as above.

## 7. Clone work targets

Only souls with `work: worktree | checkout` need a clone of their repository.
The kernel looks, in order, at `oats spawn … --repo <path>`, the local file's
`clones:` map, then `<deployment-dir>/<repo name>` (`agents-repo` for a
member named `agents`). Clone with the operator's own credentials; a
directory whose origin is another repository is refused, not used.

## 8. Verify before the first real spawn

Positive enumeration, in order — absence of errors proves nothing
(*rationale:* operator node, playbook "outsider verification of a rebuild"):

```bash
oats workspace status --dir <deployment-dir>   # every member confirmed, every package locked
oats souls --dir <deployment-dir>              # every expected soul, with origin and team
oats spawn <soul> --preview                    # modules at locked commits; merged settings show the host values
```

Then spawn one soul with `--no-launch` and check its home: exactly one "You run
on OATS" block in `AGENTS.md` (two means `oats.core` did not resolve), the
expected skills under `.agents/skills/`, and — with messaging — a spawn the
aweb hook did not roll back: its output carries a `Comms:` line, and
`instance.json` → `capabilityMeta["oats.aweb"].team` equals the payload's team.
Only then spawn for real.

## Never

Re-onboard, re-point or clean a deployment the operator did not name; declare
a package without showing the operator what it runs; edit
`oats-lock.json` or `instance.json` by hand; put host facts in shared files;
initialise or copy a messaging root above the deployment directory; treat a
scaffold as a working session.
