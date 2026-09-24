---
type: Playbook
title: Rebuild a deployment in scratch against local bare remotes
description: To test a workspace-model rebuild without touching GitHub or live deployments, publish the held branches and the workspace draft to local bare repositories with file refs, point a scratch deployment at them, and run the real commands.
tags: [oats, workspace-model, rebuild, verification]
timestamp: 2026-09-23
---

The [workspace model v2](/decisions/workspace-model-v2.md) discovers everything over Git remotes, so a rebuild can be rehearsed end to end with three bare repositories under a scratch directory: the workspace host, and one per member. Push the held member branches (with the `oats-membership.yaml` backlink rewritten to the host's `file://` URL) as each bare repo's `main`, commit the workspace declaration with `file://` member refs into the host, and write an `oats-local.yaml` in a scratch deployment directory with scratch OKF paths (a copy of the real bindings with a scratch `stateDir`). Then run the documented sequence: `sync`, approve, `souls`, `capabilities`, `spawn --preview`, `spawn --no-launch`, `status`, `retire`, and the standalone case by making the host directory unreadable.

Lessons from the first run on 0.25.0: the member clone must be given with `--repo` (the local file's `clones:` mapping is not read); `agents/` must exist before the first spawn; a soul whose messaging slot is active needs an initialised aweb root among the hook's candidates, so give the scratch soul `messaging: none` to inspect a materialised home; drive the approval prompt through a pseudo-terminal with delayed input, because closing stdin at the prompt crashes the command.
