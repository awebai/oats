---
name: coordinate-developers
description: Launch and drive developers to build what you specified, one per surface, several in parallel when surfaces are independent. Use when a spec is ready to build, when choosing how many developers to run, when a developer asks a question or returns work, or when work must be re-assigned.
---

# Coordinate developers

## Launch
- One developer per surface; two surfaces, two developers, in parallel if the plan allows.
  Never one developer for two unrelated surfaces.
- Spawn the developer soul that owns the surface as your child, the spec as its task:
  ```bash
  oats spawn <developer-soul> --parent <your instance> --purpose <short-slug> --task-file <spec.md>
  ```
  Add only what the spec can't hold: the branch or PR to target, and who else works next
  to it.
- Tell each developer which developers share an interface with it, so they talk directly.
- Record each in your instance state: instance name, surface, spec, branch.

## While they work
- Answer questions quickly. If one reveals a hole in the spec, fix the spec and tell
  everyone it affects.
- The spec fixes what and the constraints; the developer chooses how (including whether to
  parallelize).
- Watch the interfaces; when two developers disagree about a shared shape, you decide.

## When work comes back
- A developer reports when its review loop has converged. Don't act on intermediate heads.
- Verify it (`/verify-developer-work`), then accept it or return it.
- Accepted work goes into a PR you own until it merges (`/land-your-prs`).
