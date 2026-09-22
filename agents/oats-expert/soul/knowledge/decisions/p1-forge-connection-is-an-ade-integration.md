---
type: Decision
title: P1 — forge connections (GitHub, GitLab…) are ADE/workstation integrations, not capabilities; the Desktop reads PR/checks/reviews through the forge's own CLI under native credential custody
status: accepted
description: The redesign's PR card needs forge facts the kernel must not fetch. First draft proposed an official capability `oats.forge`; the human corrected the level — a forge connection applies to the OATS installation/workstation, not to a soul, exactly like signing in to GitHub in VS Code. Accepted 2026-09-22 — a per-machine "Connections" surface in the ADE, backed by the forge's official CLI (`gh` first) whose own credential store is the custody; OATS holds no token; the Desktop server performs reads at its existing guarded boundary; no kernel dispatch contract is needed. Kernel's only addition is the instance's remote URL host on K1 so the ADE can pick the backend without running Git.
tags: [decision, desktop, ade, forge, github, gitlab, connections, credentials, gh, auto-pr, s8, p1]
timestamp: 2026-09-22
---

**Status: accepted (human, 2026-09-22).** Supersedes the first draft of P1
(`oats.forge` as an official *capability* with a kernel additive-view dispatch
contract) and amends §5 of the lifecycle decision (automatic PR is now
ADE-owned, not "provider-owned").

# Context

Slice 2a ships the Git panel on K1 (`oats instance git|diff`: kernel, local,
read-only, helper-free). The design's same panel shows a **PR card** — number,
title, state, draft, base, checks, review decision, URL — and "Open PR
automatically" at spawn. Those facts live on a **forge** (the established term
for GitHub/GitLab/Gitea/Forgejo-class collaboration platforms), not in Git.

The first draft reached for the framework's usual answer — a capability — and
the human corrected the *level*: **a forge connection does not apply to a
soul; it applies to the OATS installation.** Capabilities shape what an agent
*is* (instructions, skills, hooks, provider bindings). Signing in to GitHub
changes nothing about any agent; it changes what the *operator's workstation*
can see. VS Code has the same split: Git is built in and local; GitHub is an
**Accounts** sign-in, per machine, that every workspace's Git panel then uses.

# Decision

## 1. Level: workstation, in the ADE

- The Desktop gains a **Connections** surface (Settings → Connections /
  Accounts, and an inline "Connect GitHub" affordance on the PR card when not
  connected): one card per supported forge showing *Connected as `<login>` on
  `<host>`* / *Not connected* / *CLI not installed*, with **Connect** and
  **Disconnect**.
- Per machine, not per deployment, workspace, soul or instance. Nothing is
  written into `oats-config.yaml`, `soul.yaml`, `instance.json`, locks or the
  catalog. No capability, no activation, no injection, no `oats use`.
- The kernel is not involved in connections at all. No additive-view dispatch
  contract is introduced (the first draft's one kernel change is **dropped**).

## 2. Custody: the forge's own CLI holds the credential

- v1 backend is **GitHub via `gh`**. `gh` already implements the OAuth device/
  browser flow and stores the token in the OS keychain (or its own config);
  that store *is* the custody. **Connect** = the Desktop launches
  `gh auth login --web` in a Desktop-owned terminal pane (the human completes
  the device flow; the Desktop never sees the token). **Disconnect** =
  `gh auth logout` after confirmation. Status = `gh auth status` for
  connected/not, and `gh api user --jq .login` for the login shown on the card.
- OATS **never** stores, reads, copies, forwards or logs a token; never calls
  `gh auth token`; never puts credentials on the wire or in the renderer.
  Enterprise/self-hosted GitHub follows `gh`'s own host configuration.
- GitLab (`glab`) and others are later backends behind the same Connections
  card model; v1 is GitHub only. An instance whose remote host matches no
  connected backend renders **unsupported forge** / **not connected** —
  typed states, never a guess.

## 3. Reads: the Desktop server, at its existing guarded boundary

- The PR card is read by the **Desktop server** (not the renderer, not the
  kernel) with the same discipline as catalog/list/K1: one Host/Origin-guarded
  POST, workspace-pinned, strict body; the target instance resolved from the
  **server-owned roster**; fixed argv, `shell:false`, timeout/buffer caps,
  coalescing; a closed error vocabulary — no `gh` stderr or free text reaches
  the renderer; **remote workspaces refuse** (the connection is this
  machine's; no remote fallback).
- Backend selection and repository come from **K1's observation** (the kernel
  now reports the instance's `remote` — see §5), never from the renderer and
  never by the Desktop running Git (Desktop Git reads = K1 only, per 2a).
- v1 read: `pull-request` for the instance's branch —
  `gh pr view <branch> --repo <owner/repo> --json number,title,state,isDraft,baseRefName,headRefName,url,reviewDecision,statusCheckRollup,updatedAt`.
  Typed states: `available` (card), `no-pull-request` (distinct from an error),
  `not-connected`, `cli-not-installed`, `unsupported-forge`, `no-remote`,
  `unavailable` (with the closed reason). Every answer echoes the K1
  observation revision it was computed for; a changed branch/remote invalidates
  the card.

## 4. Automatic PR: ADE-owned, off, per spawn, honest about its reach

Amends lifecycle decision §5 ("provider-owned"): with no capability, the owner
is the **ADE**. Default **off**; enabled per spawn (K6 `openPullRequest:
{mode: "off" | "first-pushed-commit"}`) as a *recorded intent*. While the
Desktop runs and GitHub is connected, it observes K1's `upstream.ahead`
transition from `null`/0 to >0 on that instance and runs `gh pr create --draft
--base <base> --head <branch> --title <from opening instruction>`; idempotent
(if a PR already exists for the branch, it does nothing); records the PR id in
the instance's typed events (K2). Undrafting is human. **Reach is stated in
the UI**: it happens only while the ADE is running and connected — a tmux/CLI-
only operator uses `gh pr create` themselves; the spawn form says so when the
field is enabled. OATS never commits or pushes. Ships after K6, not in 2b.

## 5. The one kernel addition: K1 reports the remote

`oats instance git --json` gains `remote: { name, url, host, path } | null`
for the branch's upstream remote (else `origin`, else `null`) — read-only, via
the same hardened runner (`git remote get-url`, `git config
branch.<b>.remote`). `host`/`path` are parsed from the URL (`ssh` and `https`
forms) for backend selection and `--repo owner/repo`; no network, no forge
knowledge in the kernel. DTO in `docs/desktop-cli-api.md`.

# Consequences

- **No kernel dispatch contract**; no `capabilities/oats-forge/`; nothing in
  the official catalog. The first-draft names (`oats.git`, `oats.forge`) are
  retired; the concept is *Connections*.
- Desktop slice **2b** = Connections surface (GitHub card: status / Connect
  via `gh auth login --web` in an owned pane / Disconnect) + PR card on the
  `pull-request` read + typed unavailability states, with the security brief
  in `docs/design/2026-09-22-desktop-parity-seams.md` (P1 row). Engineer's
  lane; lead's security gate before wiring, as for catalog/K1.
- Kernel: `remote` on K1 (lead, small PR). K6 gains `openPullRequest`
  (recorded intent). K2 records PR ids.
- `docs/desktop-cli-api.md`, release notes and the lifecycle decision §5 are
  amended to say ADE-owned.

# Why not the first draft

A capability would have made a workstation fact look like an agent property:
activation per soul, injection text about GitHub in agents that never touch a
forge, a catalog entry and trust step for what is really "sign in on this
machine", and a new kernel dispatch surface to reach it. The human's framing —
*"a button in the ADE, however IDEs do it"* — is the smaller, truer design.
