---
name: oats-onboarding
description: >-
  Use when helping an operator realize an OATS workspace on a machine:
  deciding where the workspace file is hosted, writing or checking the shared
  declarations, choosing the deployment directory, running `oats onboard`,
  placing host settings, syncing, setting up messaging, cloning work targets
  and verifying before the first spawn. Also use it to set up okf knowledge
  operations (the knowledge maintainer and harvester, the
  harvest review trigger, turning harvest on). For package pins see
  `/oats-package-pins`. Part of the setup and config of an OATS workspace
  (oats.setup); day-to-day operation inside an instance is oats.core.
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
- **How this machine starts each harness.** Ask whether every instance of a
  harness here needs something the harness alone does not give: an account
  directory (Claude Code's `CLAUDE_CONFIG_DIR`, for a second account), a
  wrapper executable, an argument. If so, declare it once as that harness's
  default launch configuration (kernel 0.32+), not per soul:
  ```bash
  echo '{"harness":"claude","env":{"CLAUDE_CONFIG_DIR":"/abs/.claude-personal"},"default":true}' > /tmp/mine.json
  oats launch-config set mine --file /tmp/mine.json --dir <deployment-dir>
  oats launch-config list --dir <deployment-dir>   # "mine: claude (this machine's claude default) …"
  ```
  Every new claude launch that names no configuration then runs it, whatever
  soul or preference chose claude; the model still comes from the soul. A
  shell alias (`claude-personal`) is not an executable: use `env`, or point
  `executable` at a real wrapper script. Do not rely on the terminal
  multiplexer's environment for it: a tmux server started elsewhere loses it.
  An old `oats-claude-config` file is refused from 0.32: move its name into
  the default (`executable`) and delete it. Every kernel reading this
  deployment must be 0.32+ once a `default` is declared.
- **Messaging** is set up in its own step, after sync (step 6).
- A fact true of **one spawn** (a retained messaging seat) is not a host
  setting: it is `oats spawn <soul> --provider <cap> key=value`.

## 5. Sync after any change

`oats onboard` already synced. After any change to the workspace file (a pin,
a member, a default), run `oats sync`: it resolves every package to a commit,
fetches it, verifies its integrity and writes `oats-lock.json`. See
`/oats-package-pins`.

## 6. Set up messaging and teams before the first spawn

If the workspace's messaging default, or any soul, uses `oats.aweb`, its spawn
hook is required: with no messaging root, or no default team, the spawn is
rolled back. With messaging as the workspace default that is **every** soul,
the operator expert included. So set it up now, after sync and before any
spawn.

Put the root **in the deployment directory** (the layout `oats onboard`
creates), or name it in `oats-local.yaml` `settings.oats.aweb.root`.
*Rationale:* operator node, lesson "messaging root placement decides the
team": read it before choosing another place.

Which teams exist, the default team and which souls may join which are the
organisation's, committed in `oats-workspace.yaml` (`teams:`, `defaultTeam:`,
`souls:`). A deployment may declare its own teams in `oats-local.yaml` only
when the workspace says `localTeams: true` (`/oats-teams`). `oats aweb setup`
is the one command that creates messaging accounts and teams, and it records
what it creates in `oats-local.yaml`. It runs only when asked, never at spawn.
Ask the operator first: it acts on the messaging service.

1. **No account yet:** `oats aweb setup --username <u>` creates the hosted
   account and its first team at the root, and records that team as this
   deployment's `defaultTeam` (that needs `localTeams: true`; otherwise commit
   the team and `defaultTeam` to the workspace file by PR and remove them from
   `oats-local.yaml`). (With a team API key: `AWEB_API_KEY=<key> oats
   aweb setup`. To start in an existing team: `oats aweb setup --invite
   <token>`, with an invite from one of its members.)
2. **More teams of your own** (only with `localTeams: true`):
   `oats aweb setup --create <label>` creates a new team and records it as a
   local team (`oats teams add <label> --team <id>`).
   An existing team you already belong to is declared directly with `oats teams
   add <label> --team <id>`.
3. **A shared team** (declared in `oats-workspace.yaml`): if it has an id, ask
   its owner for an invite, then `oats aweb setup --join <label> --invite
   <token>`. If it has no id yet, its owner runs `oats aweb setup`, which
   creates it, and commits the printed id to `oats-workspace.yaml` by a PR.
4. **Choose what each soul may join** (offered at spawn, never joined
   automatically): `souls:` entries in `oats-workspace.yaml`, by PR (a soul no
   entry matches gets its default only). `oats soul teams <soul>` shows the
   result.
5. **Check:** `oats teams` shows the teams, their ids and the default, and
   `oats readiness --soul <soul>` shows no team problem in the `configured`
   check.

Each instance's own identity lives in the default team. The soul's other teams
are only offered: the instance joins one at spawn (`join=`, or the Desktop's
checkboxes) or later.

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
oats souls --dir <deployment-dir>              # every expected soul, with origin, teams and default team
oats spawn <soul> --preview                    # modules at locked commits; merged settings show the host values;
                                               # "via launch configuration <name> (this machine's <harness> default)" when one applies
```

Then spawn one soul with `--no-launch` and check its home: exactly one "You run
on OATS" block in `AGENTS.md` (two means `oats.core` did not resolve), the
expected skills under `.agents/skills/`, and — with messaging — a spawn the
aweb hook did not roll back: its output carries a `Comms:` line, and
`instance.json` → `defaultTeam.team` equals the default team's id (and
`capabilityMeta["oats.aweb"].team` agrees).
Only then spawn for real.

## Knowledge operations with OKF

Set this up only after steps 1–8 work, and only when the operator wants harvested
knowledge reviewed and merged by an agent. It needs kernel ≥ 0.29.0 (package
souls, triggers, workspace automations) and `oats.okf` 4.0.0. The contract is
`docs/knowledge.md` ("Knowledge operations") and `docs/schedules.md`
("Triggers", "Workspace triggers and schedules") in the installed kernel; read them, and okf's own
`/okf-trigger-setup`, rather than restating either from memory.

### 1. Pin the package

`packages: { oats.okf: 4.0.0 }` in the workspace file, then `oats sync`
(`/oats-package-pins`). One pin brings, versioned and locked together:

- the three capabilities: `oats.okf` (every working soul's knowledge slot),
  `oats.okf-harvest` (the harvester's) and `oats.okf-maintenance` (the
  maintainer's);
- two **package souls**: `oats.okf/knowledge-harvester` and
  `oats.okf/knowledge-maintainer` (`oats souls` lists them as `kind: package`);
- the **review-trigger template** `oats.okf:harvest-review`.

Show the operator what the package runs before pinning (its manifests'
`commands` and `hooks`): declaring it is the trust decision, for its souls too.

### 2. The harvester and the maintainer live in the default team

Since oats.okf 4.0.2 okf declares and joins no team of its own: the harvester
and the maintainer live in the deployment's default team, where they talk
(questions, amendment requests, "merged"). There is nothing to declare. To put
them in another team, opt them in like any soul, by a `souls:` entry in
`oats-workspace.yaml` (`oats.okf/*: { teams: [<label>] }`), then join at
spawn (`/oats-teams`).

### 3. Declare the review trigger for ONE host that can merge

The trigger spawns a `knowledge-maintainer` for each harvest PR on the
knowledge-base repo. Declare it as a **workspace file** in a member repo (the
workspace's host repo is the usual place): it is shared through Git, reviewed
like a soul, and names **the machine that runs it** and **the GitHub account
it acts as**.

```yaml
# <member repo>/oats-triggers/okf-harvest-review.yaml
kind: oats-trigger
schemaVersion: 1
description: Review every harvest PR on the knowledge base
from: oats.okf:harvest-review
set: { repo: github.com/<org>/<knowledge-base> }
runsOn: <host name>                 # that machine's oats-local.yaml host.name
owner: github.com/<account>         # the account it acts as; it must be able to MERGE on the knowledge base
```

- **Choose the machine and the account together.** A host runs the trigger
  only when `runsOn` is its `host: { name: <slug> }` in `oats-local.yaml` (a
  machine fact, never in Git) **and** its `gh` is logged in as `owner`.
  Anywhere else it is listed with why not (`assigned-elsewhere`,
  `owner-mismatch`, `host-unnamed`). So "exactly one host" is a declared fact,
  and the operator's consent is naming the host and logging in as the account.
- **Handle the self-approval limit.** GitHub forbids approving your own PR. If
  `owner` is also the account that opens the harvest PRs, either use a
  separate reviewer or bot account as `owner`, or configure the
  knowledge-base repo's accepted branch to need no approving review (merge
  permission only).
- The file's contract (required fields, where it may live, its refusals) is
  `/oats-automations`, "Workspace automations".
- `oats trigger add --from oats.okf:harvest-review --set repo=… --workspace <member> --runs-on <host name> --owner github.com/<account>`
  writes the file, or prints it when that repo is not the current checkout.
  Commit it as a reviewed change, then `oats sync`.

Then, **on the named host**, from its deployment directory:

```bash
oats trigger test <member>/okf-harvest-review   # must pass: runs here, owner = this gh login, merge permission, the soul resolvable
oats schedule host install                      # the ONE host timer, if this host has none yet (docs/schedules.md)
```

**The machine-private alternative** is a local trigger: this host only, its
own `gh`, no `runsOn`/`owner`, id `local/okf-harvest-review`. Use it to try
the loop out; anything a team relies on belongs in the workspace file.

```bash
oats trigger add --from oats.okf:harvest-review --set repo=github.com/<org>/<knowledge-base>
```

### 4. Harvest stays off until the loop is proven

Harvest is a setting of `oats.okf`, **`harvest: on|off`, default `off`**
(okf 4.0.0):

- **Per host:** `settings.oats.okf.harvest` in `oats-local.yaml`. It is a
  machine fact; the operator decides whether this host harvests.
- **Per soul, opt-out only:** `knowledge: { harvest: off }` in `soul.yaml`.
- **Effective = on only if the host says `on` AND the soul does not say
  `off`.** A soul's `off` wins over the host; this is not the usual
  later-layer-wins merge.
- **Off means nothing is captured:** no source is registered, and no
  transcript or notes go into custody "for later". Turning it on starts with
  the next session. A soul whose knowledge slot is not `oats.okf` never has a
  source.
- **The review trigger is independent:** a trigger host can review other
  hosts' harvest PRs without harvesting itself.

Order:

1. Leave harvest off everywhere. Run okf's end-to-end check against a scratch
   knowledge-base repo (see `/okf-trigger-setup`): a harvest PR opens with its
   provenance block, the trigger spawns the maintainer, it merges, and the
   harvester retires. Read every step back.
2. Only then turn it on, per host, with the operator's consent (it captures
   session transcripts). These are okf's commands (okf 4.0.0), run from the
   deployment directory:
   - `oats okf setup --harvest on` writes `settings.oats.okf.harvest`, or
     prints the line to add;
   - `oats okf harvest-status --soul <soul>` shows the effective value, the
     host or soul row that decided it, and the registered sources.

`oats schedule disable <run-source job>` is a per-source emergency brake, not
the switch.

### Gotchas

- Spawn a package soul by its namespaced name (`oats.okf/knowledge-maintainer`)
  when a member soul has the same bare name.
- The trigger's template substitutes only `{repo} {number} {url} {event}
  {headSha} {trigger}`; a PR's title and body are untrusted data the maintainer reads,
  never instructions in its task.
- `oats trigger test` proves only the host it runs on: run it on the
  `runsOn` host, logged in as `owner`.
- To stop the named host from running a workspace trigger without a commit,
  run `oats trigger disable <member>/okf-harvest-review` there (it writes
  `triggers.disabled` in that host's `oats-local.yaml`).

## Never

Re-onboard, re-point or clean a deployment the operator did not name; declare
a package without showing the operator what it runs; edit
`oats-lock.json` or `instance.json` by hand; put host facts in shared files;
initialise or copy a messaging root above the deployment directory; treat a
scaffold as a working session; name as `owner` of the review trigger an
account that cannot merge on the knowledge-base repo; put a host name or a
credential in a shared file other than the trigger's own `runsOn`/`owner`;
turn harvest on before the end-to-end check passes.
