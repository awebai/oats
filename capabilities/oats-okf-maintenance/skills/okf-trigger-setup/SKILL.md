---
name: okf-trigger-setup
description: >-
  Set up and verify the OKF harvest-review trigger, which spawns a knowledge
  maintainer for each harvest PR: declare it as a workspace automation
  (`oats-triggers/okf-harvest-review.yaml` in a member repo, `from:
  oats.okf:harvest-review`, with `runsOn` naming the one host and `owner` the
  GitHub account that can merge on the knowledge-base repo), or locally with
  `oats trigger add` for a machine-private setup. Covers the okf team, the
  self-approval limit and `oats trigger test`. Use when setting up knowledge
  operations, when harvest PRs are not being reviewed, when moving the
  reviewer to another host, or when asked whether a host may run the
  maintainer.
---

# Setting up the harvest-review trigger

The trigger makes a harvest PR get reviewed: when a PR labelled `okf-harvest`
opens on the knowledge-base (KB) repository, the host tick spawns a new
`oats.okf/knowledge-maintainer` in the `okf` team to review it. It runs on one
machine, acting as one GitHub account, and that account must be able to
**merge** on the KB repository.

## 1. Choose the host and the account

- **The account (`owner`)** must be able to merge on the KB repository (push,
  maintain or admin). Check from the host:
  `gh api repos/<owner>/<repo> --jq .permissions`.
- **The host (`runsOn`)** is the one machine that runs the trigger, named by
  its `oats-local.yaml` `host: { name: <slug> }`, and logged in with `gh` as
  that account.
- **The harvest switch is independent**: a review host need not harvest (its
  `harvest` setting can stay `off`), and a harvesting host need not review.

## 2. The self-approval limit

GitHub forbids approving your own account's PR. If the harvester's host and
the reviewer's account are the same GitHub account, then either:
- the KB repository's `main` must not require approving reviews (merge
  permission is enough; the maintainer records its verdict as a PR comment,
  not an approval), or
- the trigger's `owner` is a separate reviewer account or machine user.

Say which one applies when you report the setup.

## 3. The okf team

The package souls carry `team: okf`. The workspace must declare it, with its
messaging mapping. Messaging is aweb (`oats.aweb`, the workspace default);
it needs oats.aweb 1.15.0 or later, which honours the `join=okf` the
harvester spawn and the trigger's `teams: [okf]` pass:

```yaml
# oats-workspace.yaml
teams:
  okf: { description: Knowledge operations }
defaults:
  messaging: { oats.aweb: { from: package } }
messaging:
  byTeam:
    okf: { team: aweb:<your-org>.okf }
```

Another messaging provider works the same way if it honours `join`.

Without it, the souls list with `E_TEAM_UNKNOWN`, and the harvester and the
maintainer cannot message each other.

## 4. Declare it in the workspace (the default)

A team relies on the review, so declare it in Git, in a member repository (the
workspace's host repo), in its `oats-triggers/` folder:

```yaml
# <member>/oats-triggers/okf-harvest-review.yaml
kind: oats-trigger
schemaVersion: 1
description: Review every OKF harvest PR on the knowledge base
from: oats.okf:harvest-review
set: { repo: github.com/<owner>/<kb-repo> }     # optional: base, harness, model
runsOn: <host.name of the one machine>
owner: github.com/<the merge-capable account>
```

- `kind: oats-trigger` and `schemaVersion: 1` make the file self-describing; a
  wrong kind is `E_AUTOMATION_SCHEMA`.
- The id is `id:` if present, else the filename stem (`okf-harvest-review`).
  Two files with the same id in one member are `E_AUTOMATION_DUPLICATE`.
- A file named `*.oats-trigger.yaml` anywhere in the member works too (never
  under `oats-package/`, `.git/` or `node_modules/`); `oats-triggers/` is the
  canonical place.

Or let the CLI write it: `oats trigger add --from oats.okf:harvest-review
--set repo=github.com/<owner>/<kb-repo> --workspace <member>` (it prints the
file when that repository is not the current checkout). Commit and merge it
like any other change.

A host runs it only when **both** its `host.name` equals `runsOn` **and** its
`gh` account equals `owner`. Everywhere else it is listed with the reason:
`assigned-elsewhere`, `owner-mismatch` or `host-unnamed`. That keeps exactly
one machine on it, and the operator's consent explicit. A host can opt out
without a commit: `automations.disabled: [<member>/okf-harvest-review]` in its
`oats-local.yaml`. Changes reach the host within about ten minutes (after
`oats sync`, or the tick's refresh).

## 5. Or add it locally (machine-private)

For a personal or experimental setup, add it to this deployment only. It runs
on this host with this host's `gh`, with no `runsOn` or `owner`:

```sh
oats trigger add --from oats.okf:harvest-review --set repo=github.com/<owner>/<kb-repo>
#   optional: --set base=main --set harness=claude --set model=opus --id okf-harvest-review
```

Never run the same review from two places: one workspace declaration, or one
local trigger on one host.

## 6. Test it on the host that runs it

```sh
oats trigger test <member>/okf-harvest-review   # or: oats trigger test okf-harvest-review (local)
oats schedule host install                      # the host timer, if the test says it is missing
oats trigger status
```

- `oats trigger test` checks gh auth and where its credential comes from, the
  repository and your merge permissions, the soul, its messaging capability,
  the okf team, the host/owner match, and what would fire now. It spawns
  nothing. It must pass before you report the setup done; fix what it names.
- **Credentials reach the tick through the host timer, not your shell.** A
  `GH_TOKEN` exported in your shell does not reach it; `gh auth login` with the
  keyring or config file does.
- Pause with `oats trigger disable <id>`; `remove` leaves running maintainers
  alone.

## 7. Labels

Harvest PRs carry `okf-harvest` (the harvester's completion creates the label
if the repository lacks it). The maintainer adds `okf-needs-human` when a PR
would supersede a human-accepted decision. To pre-create both:

```sh
gh label create okf-harvest --repo <owner>/<repo> --force --color 0E8A16 --description "OKF harvest PR (oats.okf)"
gh label create okf-needs-human --repo <owner>/<repo> --force --color D93F0B --description "OKF: needs a human decision"
```
