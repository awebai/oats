---
name: coordinate-developers
description: Launch and drive developers to build what you specified, one per surface, several in parallel when surfaces are independent. Use when a spec is ready to build, when choosing how many developers to run, when a developer asks a question or returns work, or when work must be re-assigned.
---

# Coordinate developers

## Launch
- **One developer per surface.** Two surfaces mean two developers, in parallel if the
  plan allows. Don't give one developer two unrelated surfaces.
- Spawn the developer soul that owns the surface, as your child, with the spec as its
  task:
  ```bash
  oats spawn <developer-soul> --parent <your instance> --purpose <short-slug> --task-file <spec.md>
  ```
  The spec is the brief; add only what the spec can't hold: the branch or PR to
  target, and who else is working next to it.
- Tell a developer about the developers it shares an interface with, so they can talk
  directly instead of through you.

## While they work
- Answer questions quickly: a blocked developer is the most expensive thing in the
  team. If a question reveals a hole in the spec, fix the spec and tell everyone it affects.
- Don't micromanage the approach. The spec fixes WHAT and the constraints; the developer
  chooses HOW (including whether to parallelize).
- Watch the interfaces. When two developers disagree about a shared shape, you decide.

## When work comes back
- It must come with: what was done, how it was verified (tests, real runs), the
  adversarial review's final verdict, and anything deliberately not done.
- Verify it (`/verify-developer-work`). Return it with specific reasons, or
  accept it.
- On a return, the SAME developer fixes it; don't spawn a new one per round.

## Finish
- Accepted work goes into a PR you own until it merges (`/land-your-prs`). Retire
  the developers you launched when it's merged, unless the requester wants them kept.
