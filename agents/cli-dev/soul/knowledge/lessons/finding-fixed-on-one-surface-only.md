---
type: Lesson
title: A state-rendering finding must be closed on every surface that computes the state
description: Round 2 fixed "running null renders as stopped" in the sidebar row, dot and count while the Active overview, the default surface, still labelled the same instances idle.
tags: [desktop, review, ui-state, verification]
timestamp: 2026-09-05
---

Round 1 of the Desktop remote-projection review raised: an instance whose
runtime state is unknown (`running === null`: an unreachable host, or a local
herdr target that `deployment.mjs` could not read) rendered as stopped. Round
2 answered it precisely: `instance-presentation.mjs` grew `runtimeState()`,
and `shell.mjs` used it for the sidebar row class, the status dot and the
`n/m, k unknown` count.

The finding was still open. `views/hierarchy.mjs` (the Active overview, the
app's home surface, and now reachable for remote workspaces because the same
branch added them to the workspace switcher) computed `list.length - running`
as idle, rendered `hnode idle` with a hollow `off` dot, and set
`aria-label="<name>, idle"`. `views/clusters.mjs` counted cluster members the
same way. A screen reader was told "idle" about an instance nobody could
observe.

The generalisable part: a finding phrased as "X renders as Y" names the
surface where it was noticed, not its extent. Closing it means grepping for
the predicate (here `.running` across the renderer) and deciding for each
site, rather than fixing the site the finding cited. The new helper made the
fix mechanically easy, and its existence made the remaining sites look fixed
because the vocabulary was now in the codebase.

The same shape produced a second miss in the same round: `hierarchy.mjs`'s
`openTerm` built a terminal reference of `{ instance, home, agentsRoot }`,
omitting `server`; `findRosterInstance` filters candidates by server, so from
the overview every remote instance resolved to unknown. The sidebar's
equivalent call passed `server`, so the feature worked from one surface and
not the other. Both misses are the same audit gap: the branch made a second
surface remote-aware by adding remote workspaces to the switcher, without
walking that surface's code.
