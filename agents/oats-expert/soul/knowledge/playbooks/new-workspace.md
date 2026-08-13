---
type: Playbook
title: Standing up a new OATS workspace
description: Steps to configure scoped capability packages, create portable souls, and verify exact instance-local composition in a new OATS workspace.
tags: [workspaces, setup, capabilities]
timestamp: 2026-07-11
---

1. Choose config scope (laptop/workspace/repository) and run `oats init` with
   approved knowledge/messaging/tasks choices. Acquisition does not imply
   activation.
2. Define explicit soul groups only when several known souls share a package.
   Activate general or layer capability packages with global/group/soul
   targets; keep deployment policy out of manifests and committed souls.
3. Acquire external packages with `oats install`, inspect `oats-lock.json`, and
   run `oats trust` only for reviewed commands, hooks, and launch-environment
   authority at that exact integrity.
4. Create the agents root and souls (`oats create <name> …`). Author canonical
   `soul/AGENTS.md` for durable role/boundaries; use soul `skills/` only for
   role-private procedures.
5. Run `oats doctor <repo> --soul <name>` and review active layer exclusivity,
   target/settings provenance, trust, exact skill sources, and final composed
   instructions.
6. Spawn scaffold-only for both intended runtimes when portability matters.
   Verify soul instructions remain byte-identical, instance `AGENTS.md` is a
   generated regular file, `CLAUDE.md` is canonical, `.agents/skills` exactly
   matches `instance.json`, and an unrelated ancestor skill is absent.
7. Inspect hook metadata/scaffold ownership, then retire the probe. Resolve all
   conflicts before launching work.
