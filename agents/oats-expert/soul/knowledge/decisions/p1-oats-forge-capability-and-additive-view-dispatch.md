---
type: Decision
title: P1 — forge data (PRs, checks, reviews) for the Desktop comes from an official `oats.forge` capability, dispatched through a typed additive-view contract
status: accepted
description: The redesign's Git & GitHub panel needs PR/checks/reviews facts that the kernel must not fetch itself (network, credentials, a specific forge). Accepted 2026-09-22: an official additive capability `oats.forge` (GitHub backend first; defined in the oats repo) owns forge reads; the kernel gains a typed structured-view dispatch for additive capabilities (today `operation run` only addresses layer slots); credentials stay in native custody (`gh auth`), never copied into OATS; automatic PR is provider-owned per the accepted lifecycle decision. Renderer never calls `gh`.
tags: [decision, desktop, forge, github, capability, oats.forge, dispatch, credentials, auto-pr, s8, p1]
timestamp: 2026-09-22
---

**Status: accepted (human, 2026-09-22).** Name settled as **`oats.forge`**: the
capability does not do Git — K1 in the kernel does (local, read-only). It talks
to a *forge* (the established term for GitHub/GitLab/Gitea/Forgejo-class
collaboration platforms: pull requests, checks, reviews). `oats.forge` would have
misdescribed it; `oats.github` would have baked one backend into the id and
split the view contract per forge. One capability, backends inside, one view
contract (`oats.forge:pull-request`) the Desktop consumes regardless of which
forge an instance's remote points at. **Defined in the oats repo**
(`capabilities/oats-forge/`), listed in the reviewed official catalog.

# Context

Slice 2a ships the Git panel on K1 (`oats instance git|diff`, kernel, local,
read-only). The design's same panel shows a **PR card**: number, title, state,
draft, base, checks (pass/fail/pending per check), review decision, URL — and
the accepted lifecycle decision §5 says "Open PR automatically" is a provider
feature (default off, first pushed commit, draft). Today the card renders
*unavailable pending P1*, which is honest but incomplete against "design to the
letter".

Three facts constrain the shape:

1. **The kernel must not talk to a forge.** It has no network policy, holds no
   credentials, and must stay provider-neutral (GitHub is one forge). The
   kernel's job is contracts and dispatch; messaging/knowledge/tasks are
   already capabilities for exactly this reason.
2. **`oats operation run` addresses only layer slots** (`<layer>:<name>`
   resolves the provider filling knowledge/messaging/tasks). An additive
   capability (no slot) has no structured-view dispatch path a GUI can call;
   its operations are reachable only by its own `oats <ns> <cmd>` command,
   which the Desktop deliberately does not compose argv for.
3. **The Desktop rule already holds: renderer never runs `gh`, never holds
   tokens; every read goes through the CLI at a server-owned boundary.**

# Options

**A. Kernel-native GitHub reader** (`oats instance pr`). Fastest to wire; but
puts network, a forge API, and credential discovery into the kernel, and locks
GitHub in. Rejected: it violates the layer the kernel exists to protect.

**B. Desktop server calls `gh` directly.** Keeps the kernel clean but makes the
Desktop a forge client with its own credential handling and no reuse for
tmux/CLI users or other consumers. Rejected: the Desktop consumes published
DTOs; it is not where policy lives.

**C. Official additive capability `oats.forge` + typed additive-view dispatch
(recommended).** The capability owns forge reads (GitHub backend via `gh`,
native custody); the kernel gains one generic addition — additive capabilities
may declare **structured views** the kernel can dispatch and validate — so the
Desktop asks the kernel for `oats.forge:pull-request` for an instance and gets a
typed, provider-attributed answer or a typed unavailability. Reusable by
every consumer; forge-neutral at the contract; credentials never move.

# Decision (proposed)

## 1. `oats.forge` is an official additive capability

- Lives in the oats repo under `capabilities/oats-forge/` and is listed in the
  reviewed `package-catalog.json` (official marketplace) like the other
  official capabilities. Not on every soul by default; **activated per
  deployment/soul by the operator** (`oats use oats.forge …`).
- **Backends** are internal to the capability; v1 ships **GitHub** via the
  installed `gh` CLI. Backend selection is by the instance's remote URL host,
  refusing unknown hosts as `unsupported-forge` — never guessing.
- Reads it owns (all read-only, all attributed to the observation of the
  instance's branch from K1): `pull-request` (number, title, state, draft,
  base/head, url, checks[], reviewDecision, updatedAt), later `checks` detail
  and `reviews`.
- Writes it may own **only** through the accepted decision §5: automatic draft
  PR on first pushed commit, idempotent update, PR id recorded in the
  instance's typed events (K2). Default **off**; enabled per spawn. OATS
  never commits or pushes.

## 2. Typed additive-view dispatch (kernel contract change — the one seam)

- Manifest: an additive capability may declare `views: { <name>: { command,
  context: "home"|"scope", input: {schema}, output: {schema} } }`. Views are
  **read-only by contract**; the kernel refuses a view whose command is not
  under the capability's trusted executable surface, exactly as `operation run`
  does for layer operations.
- CLI: `oats view <capability>:<name> --home <abs> --json` (naming to be
  confirmed; the point is *additive*, addressed by capability id, not by
  slot). Kernel resolves activation for that home's soul/context, checks trust,
  runs `oats <ns> <cmd>` with the validated input, validates the output against
  the declared schema, and answers a typed envelope with `provider`,
  `capability`, `version`, `observation` (echoing the K1 revision it was
  computed against). Missing/inactive capability, untrusted surface, or
  backend `unsupported-forge`/`not-authenticated` → typed **unavailable**
  reasons, never fabricated data, never an empty-healthy card.
- Same execution discipline as `operation run`: fixed argv, no shell, timeout,
  the provider's whole envelope relayed on failure, receipts never trusted on
  nonzero exit.

## 3. Credentials: native custody, never copied

- The GitHub backend uses **`gh`'s own authentication** on the machine running
  the CLI. OATS stores no token, never reads `gh`'s config, never passes
  credentials through the Desktop boundary or the network. "Not authenticated"
  is a typed unavailability with the exact remedy (`gh auth login`).
- The Desktop displays the PR card **from the CLI's answer only**; it never
  runs `gh`, never holds a token, never fetches GitHub itself. Same rule as
  the catalog/list/K1 routes: fixed argv at a server-owned boundary.
- Enterprise/self-hosted GitHub follows `gh`'s host configuration; other forges
  are future backends behind the same view contract.

## 4. Automatic PR (restating the accepted decision §5, now with an owner)

Provider-owned by `oats.forge`; **off** by default; enabled per spawn (K6 field
`openPullRequest: {mode: "off" | "first-pushed-commit"}`, later `draft` vs
`ready` if ever wanted); triggers on the first non-empty pushed commit;
opens a **draft** against the selected base, title from the opening
instruction; idempotent on later pushes; PR id into typed events (K2).
Undrafting is human.

# Consequences

- Desktop slice **2b** (PR card) consumes `oats view oats.forge:pull-request`
  through the existing server boundary discipline; renders typed unavailability
  (capability not active / `gh` not authenticated / unsupported forge) as such.
- K6 gains the `openPullRequest` field; K2 (typed events) records PR ids.
- Kernel change is one generic contract (additive views), reusable beyond git;
  proposed as a small PR with schema validation + tests; documented in
  `docs/desktop-cli-api.md` and the operations contract.
- Capability implementation is ordinary capability work (own repo dir, own
  tests, `gh` behind an adapter with inert fixtures); it is *not* kernel code.

# Resolved with the human

- Option C accepted; name **`oats.forge`** (forge-neutral id, GitHub backend
  first); defined in the oats repo.
- CLI verb: `oats view <capability>:<name>` (additive, addressed by capability
  id — kept distinct from slot-addressed `operation run`); lead's call, no
  objection raised.
- Automatic PR: off by default, per-spawn only in v1 (no deployment-level
  "on"); lead's call, no objection raised.
