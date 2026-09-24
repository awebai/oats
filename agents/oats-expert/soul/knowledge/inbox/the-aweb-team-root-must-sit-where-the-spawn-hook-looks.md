---
type: Lesson
title: The aweb team root must sit where the spawn hook looks
description: The aweb messaging hook finds its minting authority among the instance home, the home's git repository, the soul's context repository and the workspace root; in a workspace-model layout the team's .aw directory must be inside the member clone or at the deployment directory, and per-team minting needs one root per member clone.
tags: [oats, aweb, workspace-model, identity]
timestamp: 2026-09-23
---

`oats.aweb` 1.11.x mints a team-local identity at spawn by walking a bounded candidate list for an initialised `.aw`: the instance home, the git repository containing it, the soul's context repository and its git root, and the workspace root. It reads the team from the classic config block or from the active team at that root; it does not read a team from the provider payload, so a workspace file's per-label messaging payload does not steer it.

In the classic layout the team root sat beside the repo clone at the deployment root, which is not on that list once the deployment becomes a workspace-model directory. At rebuild, put each team's `.aw` inside the member clone that its souls work in (gitignored) or at the deployment directory; with two teams in one workspace, the per-clone placement is what gives per-label minting until the provider learns to read the payload.

See also [aweb workspace lifecycle](/lessons/aweb-workspace-lifecycle.md) for the broader minting-authority boundedness rule.
