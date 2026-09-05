---
type: Lesson
title: A wrong-target guard is only as good as the projection that offers the action
description: retire --home made the action pick the right twin, while the roster that decides which twin the operator can act on still joined saved routes by name alone, reinstating the wrong-target hazard one layer up.
tags: [oats-cli, servers, roster, retire, review, desktop-api]
timestamp: 2026-09-05
---

The `servers-roster` branch added exact-home retirement so that a same-named
twin under another agent on the host is never the one retired. The action
layer got this right: the saved route's home travels as `--home`, an
explicit `--home` must equal the saved route, and an old remote is refused.

The projection did not. `rosterGroups` joined this machine's saved routes to
the remote's instance rows keyed on instance name only, so with twins it
marked whichever agent the remote enumerated first as `savedRoute: true` and
consumed the snapshot there. The twin that actually owned the route came out
`savedRoute: false`, read-only in the UI. A Desktop that gates lifecycle on
`savedRoute` therefore offered retire and harvest on the row that had no
route, and the CLI then correctly acted on the other home. Both layers
behaved exactly as specified and the pair retired the instance the operator
was not looking at.

Two things generalise:

- A correctness guard has a scope, and the scope is the layer it lives in.
  When a guard's premise is "these two things with the same name are
  different things", every join, map, cache key and dedupe on that name
  elsewhere is now suspect. Grep the identifier the guard disambiguates by
  (here: instance name) and check each use for whether it needs the
  disambiguator too.
- Fail-closed at the action does not rescue a wrong offer. The `--home`
  check cannot detect this, because by the time it runs the operator has
  already chosen a row and the home it is handed is internally consistent.

The same review found the sibling case: the store the projection reads is
itself keyed by (server, instance name), so a second routed spawn of a
colliding generated name on the same target silently overwrote the first
instance's route. `nextInstanceName` de-duplicates only within one agent's
`instances/` dir, so `dev --purpose foo-1` and `dev-foo --purpose 1` both
produce `dev-foo-1`. A name-keyed store cannot represent the state its own
feature says is legal.

Both were raised by a teammate mid-review and confirmed with a throwaway
harness that stubbed the ssh transport and called the exported function
directly: no fixtures, no network, about 30 lines, and it turns "I think the
join is wrong" into two printed rows. Commit 444967f fixed both (the join
matches name and home; a routed spawn refuses `E_ROUTE_EXISTS` on an
explicit name or reports `routeConflict` without overwriting on a generated
one). The lesson is the review method, not an open defect.

Related: [retry-hint-sites-travel-in-packs](retry-hint-sites-travel-in-packs.md).
