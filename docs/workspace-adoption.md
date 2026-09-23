# Adopt the OATS development workspace

> **Superseded (workspace model, 0.25).** The 0.24 narrative this page carried
> — `oats.yaml` exports, `imports:` of pinned source editions, "classic local
> bootstrap" with `oats onboard --dir`, source-edition inspection and
> `oats prepare` pilots — is history: none of those files or verbs exist under
> the workspace model (decision 5 of `workspace-model-v2`: no migration, v1
> declaration files are schema errors). What replaces it is short and is
> written once: **[rebuild-to-v2.md](rebuild-to-v2.md)** (§5 for the
> deployment layout `oats onboard` creates) and [workspaces.md](workspaces.md)
> for the model. This page only says what the framework's own workspace looks
> like under v2 and how to join it.

## The framework's own workspace (decisions 18–21)

Decision 18 (W9) converts every repository of the OATS organisation to a v2
member: `oats-membership.yaml` naming the host, v2 `souls/*/soul.yaml`, and
`capabilities/*/oats.json` for what it exports at latest state. The `oats`
repository hosts `oats-workspace.yaml` and the official
`package-catalog.json`. Until that conversion has landed on `main`, the
repository's checked-in `oats-workspace.yaml` is still `schemaVersion: 1` and a
0.25 kernel refuses it by name (`E_WORKSPACE_SCHEMA`) — the commands below
describe the target, not a workspace you can join today.

A framework repository is a **member and a package publisher at once**, and the
two roles never collapse: `oats-okf`, `oats-aweb`, `oats-jira`, `oats-linear`,
`oats-authoring`, `oats-dev` are members (their `souls/` — `okf-expert`,
`aweb-expert`, … — are discoverable at latest state, team `global`) **and**
their `oats-package/` is consumed only as a package: `from: package`, pinned
in the workspace's `packages:`, locked and approved per version. The framework's
own souls therefore say `oats.okf: { from: package }` even though `oats-okf` is
a member. A bare version in `packages:` (`oats.okf: v2.1.3`) resolves through
the catalog; a package outside it is written `git:<repo>@<ref>`.

## Join it on your machine

```bash
oats onboard ~/oats-workspace --workspace git:github.com/awebai/oats
```

This writes `oats-local.yaml`, creates `agents/`, runs the first `sync`
(membership table, `packages:` resolved into `oats-lock.json`, approval asked
once per package version — exit `2` until approved in a terminal), and prints
which members to clone beside it. Read `oats souls` / `oats capabilities`,
then `oats spawn oats-setup-expert` for the guided rest. Exact shapes and
errors (`E_ALREADY_ONBOARDED`, `E_REPO_REF`, `details.rolledBack`):
[desktop-cli-api.md](desktop-cli-api.md#oats-onboard-dir---workspace-repo-ref---json--onboardapi-2).

Shared vs local is now one rule: **what is true of the workspace lives in the
host repo and the members (Git); what is true of this machine lives in
`oats-local.yaml` (`settings:`, `clones:`, `souls.disabled`, never committed);
what is true of one instance is given at spawn (`--provider <cap> k=v`)**. No
machine path, credential, private team identifier or store locator belongs in
the workspace file — its schema refuses absolute paths.

## Public contributors: the standalone view

The workspace file names every member, so a mixed public/private organisation
hosts it in a private repo that is not a public member (decision 26). A
contributor who can read a public member but not the host points
`oats-local.yaml` at the member and gets the **standalone view**: the member's
own souls with `from: here` capabilities plus `oats.core` (decision 25), marked
`standalone: true` in `oats sync --json` and in
`instance.json.workspace.standalone`. The view exists only for a repo that *is*
a member (it has `oats-membership.yaml`) whose host is unreadable for
access reasons; a repo without a backlink is `E_WORKSPACE_SCHEMA`, and a network
or timeout failure reading the host is `E_REMOTE_UNREADABLE`, never a silent
fallback.

## History

The 0.24 adoption record (PR23 and the portable-souls program) is kept in
[design/2026-09-20-redesign-program-board.md](design/2026-09-20-redesign-program-board.md)
and the superseded design notes under [design/](design/README.md).
