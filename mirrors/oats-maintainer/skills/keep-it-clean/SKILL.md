---
name: keep-it-clean
description: Keep the project clean as it grows - an honest follow-up list, docs and release notes in step with every merge, drift and duplication across experts caught and consolidated, and dead PRs, branches, instances, docs and issues closed or retired - plus the knowledge pass that keeps the roadmap, architectural calls and coherence rules current. Use before every task boundary, and when an intake shows things piling up.
---

# Keep it clean

A project gets patchy one small exception at a time. Cleanliness is a duty you do at every
task boundary, not a quarter-end project.

## An honest follow-up list
- Every follow-up has: what, why, where it's tracked (an issue, a PR), and an owner.
- Non-blocking review findings become follow-ups when you approve, not "later".
- An item is closed, done or **dropped explicitly** with a reason. Nothing rots silently on
  the list; nothing is left off it because it's embarrassing.

## Docs and notes in step with every merge
- A behaviour change ships with its docs and its release-notes entry, in the same PR. Check
  it in review (`/pr-review`, mergeability).
- When something slipped through, fix it forward quickly, in a small PR, and add the gap to
  the coherence rules if it can happen again.

## Drift and duplication across experts
Several experts working in parallel drift apart. Look for:
- two solutions to the same problem, two helpers doing the same job, two names for the same
  thing;
- docs that contradict each other or the code;
- a change in one area that quietly copies a pattern another area replaced.

Name it, pick one owner and one shape (`/direction-gate`), and get the other consolidated.
Record the shape as a coherence rule.

## Retire what's dead
- Stale PRs: ask the owner whether to finish, hand over or close; close with a note.
- Merged or abandoned branches, idle instances you launched, obsolete docs and skills,
  issues nobody will do: close or retire them with a one-line reason. A lead you launched
  for a requester is retired on the requester's word (`/launch-work`).
- Ask before retiring what someone else owns.

## The knowledge pass
At the same boundary, keep your knowledge current (the maintainer inject says what it
holds): the living roadmap updated in place, new architectural calls with their reasons and
rejected alternatives, new coherence rules, and nothing that's just a one-off patch.
