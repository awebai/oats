---
type: Decision
title: Five expert souls are the roster; their knowledge lives centrally in oats-knowledge and never teaches the code
status: accepted
description: The human chose option A on 2026-09-21 — the five reviewed experts (plus the non-owning setup expert) are the durable roster; developer roles are spawned per task and hold no node. The legacy per-soul bundles (399 concepts) were judged into 58 concepts in the public base under the theory's promotion bar, with an explicit exclusion of anything that teaches the code. Harvest into the base stays off until the new souls are running from it.
tags: [decision, roster, knowledge, centralisation, portable-souls, theory]
timestamp: 2026-09-21
---

Decided 2026-09-21 by the human with the redesign lead.

# Context

Phase 2 of the redesign (after the Git-workspace / Portable Souls
infrastructure shipped and was proven by an independent operator) is to
centralise knowledge and make the five souls real. The legacy roster carried
~400 concepts across nine per-soul bundles inside the framework repository,
much of it developer material: codebase maps, test recipes, release
procedures, PR residue. Two roster readings were possible: (A) five expert
souls, developer roles ephemeral; (B) developers keep durable souls and nodes.

# Decision

1. **Option A.** The roster is the five reviewed experts (`oats-expert`,
   `oats-kernel-expert`, `oats-desktop-expert`, `market-research-expert`,
   `oats-assistant`) plus `oats-setup-expert`, which owns no knowledge.
   Developer roles are spawned fresh per task from the experts' knowledge and
   hold no node; their material survives only as generalised expertise in an
   expert node, or not at all.
2. **The base carries expertise about OATS, never code teaching.** The
   theory's two-part test and reject list apply in full, with the human's
   explicit sharpening: no module maps, implementation walkthroughs, command
   or test recipes, coding conventions. Anything derivable from the repository
   is out; architecture passes only as rationale or decision. Everything is
   dated, role-attributed, universal (no deployment specifics), and marks its
   supersessions.
3. **Migration is judgement, not copying.** A fan-out assessed every legacy
   concept against the theory and the current architecture; per-node
   synthesis wrote each node coherently; a conformance audit and a rework pass
   fixed stale claims, code-teaching, undated bodies, duplicates and log
   conventions; the lead reviewed the whole base before the PR. Result: 58
   concepts / ~35k words (kernel 26, expert 18, desktop 13, assistant 1,
   market-research chartered and intentionally empty).
4. **Harvest stays off** until the new souls run from the central base in a
   fresh deployment; OKF `check` readiness work is deferred accordingly.
5. **Stewardship state collapses** to one owned typed-state concept in the
   base (`oats-expert/roadmap/current-direction`, prune-not-accumulate); the
   repository's program board remains the operational ledger outside the base.

# Consequences

- Public base `awebai/oats-knowledge` main carries the migrated knowledge;
  the six editions in `souls/` bind to it through `stores.oats` and need no
  pin change. The in-repo `agents/*/soul/knowledge/` bundles are now legacy and
  are decommissioned with the roster cutover (fresh `~/OATS` deployment on
  the workspace definition; this checkout becomes secondary).
- Lessons from the migration: assess from the CURRENT source tree, not a
  stale checkout — three of nine assessors noticed the architecture files were
  absent from the branch they were pointed at; an audit that names items by
  id makes the rework pass mechanical; concurrent writers must append under
  one date heading in `log.md`.

# Rejected

- Option B (durable developer souls with nodes): turns the base into work
  logs; the promotion bar already filters the material that would justify it.
- Bulk copy of the legacy bundles: fails the theory by construction.
