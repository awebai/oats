---
type: Lesson
title: OKF state directory must sit outside every work tree
description: The OKF 2 spawn hook refuses a state directory that overlaps the instance's home or work, and a workspace-mode soul's work is the whole team scope, so keep the state directory outside the deployment root entirely.
tags: [okf, oats, deployment, spawn]
timestamp: 2026-09-21
---

OKF 2 validates bindings at spawn (`lib/config.mjs`): the state directory may not overlap any accepted base, the source home, or the source work tree, and the bindings document must lie outside state and bases. A soul in `work: workspace` mode has the whole team scope as its work tree, so a state directory placed anywhere under the deployment root (for example `<root>/okf/state`) fails with `oats-okf: state overlaps source home/work` and the spawn is rolled back. The same layout works for souls in worktree or directory mode, which is why it passes in one deployment and fails in another.

Put the state directory under the user's state area, for example `~/.local/state/oats-okf/<deployment>`, and keep only the bindings document inside the deployment root. Moving an existing state directory is a plain move: migration records and captures are referenced by id, and repointing `stateDir` in the bindings document is the only edit.
