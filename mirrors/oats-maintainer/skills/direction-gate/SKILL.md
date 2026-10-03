---
name: direction-gate
description: Judge whether a change belongs where it is and moves the project the way its roadmap and recorded decisions say - before a contract or structural change is built, and as the first gate of every PR review. Consult the recorded decisions first, and record each new architectural call with its reason and the alternatives rejected. Use before deciding any contract or structural change, and in every review.
---

# Direction gate

A project stays coherent when every change is placed by the same reasoning. This gate asks
that reasoning out loud, before a change is built when it's a contract or a structure, and
again in review, against the full diff.

## Read before you judge
- **The recorded decisions:** your knowledge's accepted decisions, the living roadmap, and
  the coherence rules. Say whether your answer rests on an accepted decision or on an
  open question.
- **The change as it is, not as it's described:** compare the PR's stated outcome with its
  full diff. A description that says "fix" over a diff that adds a new surface is a
  direction question.

## Ask
1. **Does it belong here?** The right layer, module, package or repository; core or
   extension; code, configuration or docs. Name where it would belong if not here.
2. **Does it move the roadmap?** Forward on the stated direction, a detour that's small and
   said out loud, or a pull in another direction (which needs a decision, not a merge).
3. **Is it a contract change?** Anything other people's code or configuration relies on:
   a public API, a config key, a file format, a message shape, an environment variable, a
   command's output. A contract change is **decided before it's built**: who breaks, what
   they must change, and how the failure tells them (an error that names the fix, not a
   silent change). A correctness fix doesn't justify a new contract.
4. **Is it the simplest shape that fits?** No second way to do something the project
   already does one way; no new mechanism where an existing one stretches.
5. **Does it keep the coherence rules?** If it breaks one, either the change bends or the
   rule changes, explicitly and recorded.

## Outcomes
| Finding | Do |
|---|---|
| Fits | Go on with the other review gates. |
| Fits with changes | Say the change needed and why, with the decision or rule it rests on. |
| Needs a decision | Stop. Put the question to whoever decides it (your soul or human says who), with the options and your recommendation. Nothing is built or merged on it meanwhile. |
| Doesn't belong | Say where it would belong, and whether part of it can land here. |

## Record
- A new **architectural or structural call**: its reason and the alternatives rejected,
  in your knowledge. Supersede the decision it replaces; don't leave both standing.
- A changed direction: update the **living roadmap** in place.
- A **coherence rule** you just enforced for the first time: write it down.
