---
type: Decision
title: Desktop succeeds the web and terminal panels as a standalone product
description: The Electron desktop app becomes OATS's sole panel, owns its bundled backend outside the kernel, degrades to observation without an installed OATS CLI, and removes oats.web and oats pane in the pre-release desktop migration as a documented breaking change.
status: accepted
tags: [desktop, control-pane, distribution, deprecation, architecture]
timestamp: 2026-07-24
---

# Context

OATS developed two operator surfaces before the desktop product: the universal
CLI's `oats pane` TUI and the `oats.web` browser capability. The desktop app now
combines the useful panel model with a hierarchy-first interface, brain and
markdown readers, and real tmux terminals through Electron and node-pty.

Keeping three panels would split product ownership and duplicate behavior.
Turning the desktop app into a capability would also confuse two different
contracts: OATS capabilities compose behavior into agent instances, while a
signed desktop installer is an operator-facing application that must be able
to start before the machine has installed the OATS CLI.

This decision supersedes the product and packaging direction in the [web pane
decision](/decisions/web-pane.md) and the continuing-product implications of
the [standalone TUI decision](/decisions/control-pane-live-standalone-tui.md),
[card architecture](/decisions/control-pane-v3-card-architecture.md), and
[visual language](/decisions/control-pane-visual-language.md). Those concepts
remain as the history and migration source for the replacement.

The first accepted form of this decision required a stability-gated N/N+1
notice and treated the initial desktop feature as a transitional oats.web
bridge. Human direction later on 2026-07-24 changed that timing: complete the
backend migration and legacy removal in PR #19, before the next release. This
amendment supersedes the earlier transition schedule while preserving the
standalone-product, ownership, no-OATS, package, and soul-succession boundaries.

# Decision

## One panel, distributed as a product

The desktop app becomes the OATS panel. It remains in the OATS monorepo under
`packages/desktop/`, but it is never acquired, activated, or targeted as an OATS
capability. Electron-builder produces signed installers through GitHub Actions;
the repository's GitHub Releases distribute those artifacts.

The desktop package stays private and outside the root npm package's published
files. `@awebai/oats` remains the runtime-neutral kernel and universal
CLI, with no Electron, node-pty, xterm, or desktop-application dependencies.

## The desktop package owns its backend

Once the browser capability is retired, the local HTTP/backend process has one
product consumer. Its source therefore belongs to `packages/desktop/` and is
bundled into the application. It does not move into `lib/` merely because the
transitional server imports kernel functions; `lib/` remains the reusable
runtime-neutral kernel surface.

Operational integration uses the public CLI boundary from the [standalone CLI
decision](/decisions/standalone-cli.md). The desktop backend detects a
compatible installed `oats` executable and invokes lifecycle or capability
operations through structured `oats ... --json` commands. If an operation needs
a stronger JSON seam, the CLI contract is extended rather than teaching the
desktop server to import an adjacent kernel implementation. A shared read-only
model belongs in `lib/` only if a non-desktop consumer independently justifies
it.

## No OATS means observe, not administer

Without an installed compatible OATS CLI, the app may open a recognizable
existing deployment and:

- display roster, hierarchy, brain, markdown, task/state, and git read views;
- attach to existing tmux sessions through its real terminal; and
- pass terminal input to those already-running sessions.

It does not perform OATS lifecycle, configuration, package, or memory mutations:
spawn, retire, create, harvest, install, trust, use, and related administration
remain disabled behind one consistent install-or-update affordance. Tmux is a
separate host prerequisite and receives its own diagnostic. After OATS is
installed, the app re-probes compatibility and enables operations without
requiring the desktop app to be reinstalled.

A machine with neither OATS nor an existing deployment receives workspace
selection and installation guidance, not a fabricated empty deployment. The
installer does not hide a second full operational kernel inside the app; doing
so would erase the degradation boundary and permit version skew against the
workspace's actual OATS installation.

## Immediate pre-release succession

PR #19 completes the ownership cut before the next release rather than shipping
a transitional bridge and waiting through an N/N+1 deprecation cycle. In that
same change:

- the desktop-owned backend moves under `packages/desktop/` and is bundled with
  the app, with no runtime dependency on the adjacent capability or private
  control-pane implementation;
- `capabilities/oats-web/`, `lib/control-pane/`, `oats pane`, the
  `./control-pane` package export, and their obsolete tests, docs, and
  marketplace surfaces are removed; and
- the root npm package remains free of desktop dependencies and loses the
  removed capability and export.

This is intentionally a **breaking release impact**. `oats.web` and the
`./control-pane` export have already shipped publicly, so absence of known
repository consumers does not imply absence of external consumers. The release
must name every removed command, capability, path, and export, and give
explicit replacement and cleanup steps. `oats doctor` or an equally
deterministic CLI diagnostic must recognize configs and locks that still name
`oats.web`, explain that the capability was removed, and direct the operator to
remove the stale activation/lock instead of failing mysteriously. Existing
installed copies are not retained as a product fallback.

Merge-before-release is allowed; release-before-replacement is not. No npm tag
or GitHub release containing the removals is cut until desktop installer build,
distribution, and replacement guidance are operational. This release gate
preserves an available replacement without delaying the source ownership cut.

## Soul succession

A durable `oats-desktop-engineer` soul owns the full desktop product:
`packages/desktop/`, its bundled backend, and desktop release automation. It
pairs with the durable UX designer role. The `tui-dev` and `webpanel-dev` souls
retire only after their still-relevant terminal, server, renderer, security,
testing, and release knowledge has been migrated topic by topic and is
reachable from the successor's indexes.

# PR #19 completion constraint

The feature is no longer accepted as an in-tree oats.web bridge. Before merge,
its server behavior must be self-owned under `packages/desktop/`, all adjacent
capability/control-pane dependencies must be gone, and the legacy product
surfaces must be removed completely. Dormant Diff and Jira source remains
outside the product promise and installer scope unless separately approved.
The substantial scope change receives a fresh full maintainer review rather
than inheriting approval from the transitional implementation.

This subsection is the PR #19 **merge gate**, not the final distribution gate.
A direct bridge from the in-tree desktop process to adjacent `lib/core.mjs` may
remain at merge only as explicit, tracked, **release-blocking migration debt**.
It does not satisfy the installed-CLI or no-OATS boundaries above. The
post-merge desktop distribution work must replace repository-root assumptions,
direct mutation imports, and `core.spawnInstance` calls with installed
`oats ... --json` integration plus observation-only behavior when the CLI is
absent. Therefore the maintainer does not return PR #19 solely for that bridge
when capability/control-pane adjacency is gone and the debt is accurately
recorded; no release may contain the bridge as the standalone architecture.

# Consequences

The desktop product can deliver a rich native experience without bloating the
kernel npm package or pretending to administer OATS when no compatible kernel is
installed. The source tree reaches one owner and one panel before release,
avoiding a second migration immediately afterward. The tradeoff is an
intentional breaking upgrade without a notice release: CLI diagnostics,
release notes, config/lock cleanup, and an operational installer become hard
release gates rather than later follow-ups. The exact first-publication shape is
binding in the [Desktop public release contract](/decisions/desktop-public-release-contract.md).
