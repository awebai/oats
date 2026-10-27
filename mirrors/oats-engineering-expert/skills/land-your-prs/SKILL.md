---
name: land-your-prs
description: Own a PR from opening to merge, including one a developer built for you. Open it well, monitor it for reviews and checks from bots, agents and humans, triage each comment, get fixes made, rebase or rework when integration needs it, and merge by the repository's rules. Use whenever work in your domain becomes a PR, while PRs are open, and when a coordinator asks you to rework one.
---

# Land your PRs

You land every PR in your domain, even when a developer wrote it or another expert
coordinates the effort.

## Open
- One PR per coherent piece of work. The description: the goal, what changed, how it was
  verified, the adversarial review's verdict, what's out of scope.
- Link the spec, and the PRs it depends on or that depend on it.

## Monitor
Watch CI, bot reviewers and agent and human comments until it merges: by your harness's or
messaging layer's notifications where they exist, else at each task boundary.

## Triage each comment
| The comment | Do |
|---|---|
| A real bug or a broken contract | Send it to the developer who built it, or fix it yourself if trivial and take the delta through a code reviewer. |
| A reasonable improvement within scope | Fix it, or reply why not. |
| Out of scope | Reply, and record it as a follow-up. |
| Wrong | Reply politely with the evidence (a test, a spec line). |
| A bot's low-confidence or style noise | Leave it, unless the repository says otherwise. |

Reply to every human or agent comment, and resolve the thread once handled. Batch the
fixes; the developer takes them through its review loop as a delta (its reviewer, or a new
one if that one was retired), and the new head is ready when the loop converges.

## Rebase and rework
- Keep the PR mergeable: rebase or merge from the target when it drifts, and re-run the
  checks.
- In coordinated work, follow the coordinator's integration instructions
  (`/coordinate-experts`, "If you are coordinated").

## Hand over to the maintainer
- Hand it to one maintainer: the one who launched or delegated your effort, or your
  human's maintainer in the lane the work is in (`/coordinate-experts`, "Your maintainer").
  Name it in the description. If a second maintainer reads the PR, your maintainer asks
  it, not you. Add its lane's label when your brief or the map names one.
- Don't push to a PR under the maintainer's review without telling it. Batch its review
  fixes, let the loop converge again, then hand over the new head with the delta.
- After the hand-over, leave the branch alone: when the default branch moves, the
  maintainer updates your branch on the forge and comes back to you only for a conflict.
  Fetch before you touch the branch again.

## Merge
- Merge by the repository's rules: required approvals, required checks, who presses the
  button. If a named maintainer merges, getting its approval and merge is your job: ask,
  answer its review, follow up.
- After merge, check the target branch's CI on the merged commit; fix forward if it breaks.
- Tell the requester or coordinator it's in, and retire the developers you launched for it
  unless the requester wants them kept.
