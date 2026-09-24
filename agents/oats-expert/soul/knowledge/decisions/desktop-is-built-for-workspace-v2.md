---
type: Decision
title: The Desktop is built FOR workspace model v2 — the kernel's JSON is its model; it never parses a deployment file
status: accepted
description: ACCEPTED (human, 2026-09-24 — "the desktop should not just adapt to the new version, it should be natively built for it"). The Desktop's own 0.24 deployment model (reading oats-config.yaml, agents/<name>/soul, installed capabilities) is replaced by the kernel's JSON surfaces (status, inspect, workspace status, spawn preview, sync, version features[]); every mutation is a kernel verb. Phase F slices F1–F6; the 10B-0 lane lands on main first (no 0.24 maintenance line).
tags: [desktop, workspace-v2, kernel-boundary, phase-f, decision-record]
timestamp: 2026-09-24
---

## Context

The Desktop shipped against 0.24: it derives the roster itself from
`oats-config.yaml`, `agents/<name>/soul`, `local-agents/` and
`.agents/capabilities/installed/`, and drives a handful of CLI verbs. When
workspace model v2 landed (0.25.0–0.25.6) the Desktop was made to *accept*
0.25 kernels (`ACCEPT_RANGE` widened) — it launches and its verbs still answer
— but its model of what a deployment IS stayed 0.24's. A v2 deployment has
`oats-local.yaml` → workspace URL, souls in member repos materialised per
commit, packages resolved through the catalog and locked, modules copied whole
into each home, per-team payloads, and a roster the kernel itself computes
(`oats status --json` with module/soul drift and served identity).

The human's direction: not adaptation, a native build. Separately, the human
agreed that the in-flight 10B-0 work (terminal owner leases) lands on main and
ships in 0.25.6 rather than on a `release/0.24` maintenance line — nobody runs
0.24, and a maintenance line for zero users is cost without benefit.

## Decision

1. **The kernel's JSON is the Desktop's model.** Every fact shown comes from
   `oats status|inspect|workspace status|spawn --preview|readiness|version|sync
   --json`. The Desktop parses no deployment file. A missing fact is a kernel
   ask, never a Desktop-side parser.
2. **Every mutation is a kernel verb** with `--json` and, for spawn, the
   preview → `--expect-decision` apply protocol; the decision now binds
   provider facts by value (`effective.providers`, decision 27).
3. **Features, not versions.** `oats version --json` `features[]` gates each
   UI capability; `ACCEPT_RANGE` floor moves to the first kernel carrying the
   features Phase F depends on (`served-identity`, 0.25.6).
4. **Phase F** (`docs/design/2026-09-24-desktop-phase-f-boundary.md`): F1
   deployment model on kernel JSON (drops the 0.24 readers and the removed
   `oats catalog` DTO) → F2 onboarding + sync/approval → F3 spawn dialog on the
   v2 preview with the Identity select as `--provider` pairs → F4 instance
   card/roster on v2 facts → F5 the redesign frames on that base → F6
   version/doctor pane and the floor bump. The engineer learns v2 first (the
   boundary's §3 reading list and a hand-built scratch deployment).
5. **Acceptance**: the lead builds a fresh v2 deployment from the Northwind
   fixture using only the Desktop; every shown fact equals the kernel's JSON.

## Consequences

- `packages/desktop/server/deployment.mjs`'s readers are removed, not
  extended; `server/catalog.mjs`'s DTO validation goes.
- The Desktop gains a workspace header, a sync/approval sheet and an
  onboarding flow it never had — these are v2 concepts with no 0.24 analogue.
- Kernel JSON gaps found by Phase F become lead-lane kernel PRs (the pattern
  that produced K5–K8 and decision 27's K-items).
- `release/0.24` is inert.
