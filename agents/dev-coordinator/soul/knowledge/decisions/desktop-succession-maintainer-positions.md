---
type: Decision
title: Desktop succession direction — maintainer positions
description: Adopted architecture and sunset positions for desktop-app succession that bind follow-up briefs for desktop distribution, web/TUI sunset, and soul succession.
tags:
  - desktop
  - succession
  - oats-web
  - tui
timestamp: 2026-07-24T12:00:00Z
---

# Desktop succession direction — maintainer positions

This decision records adopted maintainer positions from `oats-expert-direction-desktop` (message `58f700f3`, conversation `bf69757c`) on the human directives that the desktop app becomes THE panel, is never a capability, `oats-web` and the TUI sunset, and `oats-desktop-engineer` succeeds the desktop ownership area.

# Adopted positions

- **Server home**: the desktop backend lives under `packages/desktop/` and is bundled into the Electron artifact. Do not promote the HTTP server into `lib/`. Mutations such as spawn and harvest go through an installed compatible `oats ... --json` CLI, not adjacent-kernel imports, to avoid Electron-vs-global version skew. The current hardcoded chain is a transitional bridge only.
- **No-OATS line**: the desktop app may observe and interact with an existing deployment, but must not administer OATS without OATS. Reads and terminal attach work; every lifecycle mutation is disabled behind one "Install/update OATS" affordance. Re-probe after install without requiring an app reinstall. There is no hidden bundled kernel. First-run without a deployment is a workspace picker plus install guidance.
- **Sunset**: allow one full deprecation release. The clock starts when signed installers and replacement workflows are operational, not at PR merge. Release N deprecates the OATS pane, `oats web`, `oats.web`, and the control-pane export with runtime notices, migration guidance, and doctor/cleanup for configs naming `oats.web`. Release N+1 removes `capabilities/oats-web`, `lib/control-pane`, exports, tests, docs, and marketplace references.
- **npm**: keep the root package unchanged for now because desktop is already private/excluded. At removal, the tarball loses web/control-pane code and the `./control-pane` export.
- **Current PR**: ship the current bridge as-is. Constraints: document the coupling as transitional; diff/Jira are inert and not promised, so prune them from the installer unless re-approved; add no new panel/TUI features beyond correctness/security.
- **Succession**: `oats-desktop-engineer` owns `packages/desktop`, the bundled backend, and release automation. Migrate `tui-dev` and `webpanel-dev` knowledge topic-by-topic. Retire donor souls only after indexes and cross-links are updated. This canonical decision supersedes `decisions/web-pane.md` and Control Pane decisions once briefs are confirmed.
