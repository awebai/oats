---
name: land-your-prs
description: Own a PR from opening to merge, including one a developer built for you. Open it well, monitor it for reviews and checks from bots, agents and humans, triage each comment, get fixes made, rebase or rework when integration needs it, and merge by the repository's rules. Use whenever work in your domain becomes a PR, while PRs are open, and when a coordinator asks you to rework one.
---

# Land your PRs

A piece of work isn't done when the code is written; it's done when it is merged and green.
You own that last stretch for every PR in your domain, even when a developer wrote the code
and even when another expert coordinates the wider effort.

## Open
- **Only after both reviews, on the branch.** A PR is opened for work that has passed the
  developer's adversarial review loop AND your own verification (`/verify-developer-work`),
  both on the local branch. Never open a PR to get a review: reviews happen before it.
- One PR per coherent piece of work. The description says: the goal, what changed, how it
  was verified, the adversarial review's verdict, and what's out of scope.
- Link the spec and any PRs it depends on or that depend on it.

## Monitor
Keep watching until it merges: CI checks, bot reviewers, and review comments from other
agents and from humans. Keep each open PR in your instance state at its exact head, with
its checks, reviews and what it waits on. Use your harness's or messaging layer's notifications where they
exist; otherwise check at each task boundary.

## Triage each comment
| The comment | Do |
|---|---|
| A real bug or a broken contract | Get it fixed: send it to the developer who built it (the same one), or fix it yourself if trivial and take the delta through a code reviewer, as a developer would. |
| A reasonable improvement within scope | Fix it, or reply why not, with the reason. |
| Out of scope | Reply, and record it as a follow-up. |
| Wrong | Reply with the evidence (a test, a spec line), politely. |
| A bot's low-confidence or style noise | Leave it unless the repository says otherwise. |

Reply to every human or agent comment and resolve the thread when it's handled. Batch the
fixes that follow review: the developer takes them through its review loop as a delta (its
reviewer, or a new one if that was retired), and the new head is ready when that loop
converges.

## Rebase and rework
- Keep the PR mergeable: rebase or merge from the target when it drifts, and re-run the
  checks.
- **In coordinated work**, the coordinator may ask you to rebase onto another domain's PR,
  split or reshape yours, or hold a merge until a dependency lands. Do it: integration
  order is the coordinator's call. Tell the coordinator if the request conflicts with
  something in your domain.

## Hand over to the maintainer
- Hand a PR to the maintainer only once three things hold, and say all three with the head:
  the review loop converged (the developer's, or yours for a fix you made), you verified
  it, and CI is green on that exact head.
- Don't push to a PR under the maintainer's review without telling it. Batch the review's
  fixes, let the loop converge again, then hand over the new head with the delta.

## Merge
- Merge by the repository's rules: required approvals, required checks, and who presses the
  button. If the repository names a maintainer who merges, getting their approval and
  merge is part of your job: ask, answer their review, follow up.
- After merge, check the target branch's CI on the merged commit, and fix forward if it
  breaks.
- Close the loop: tell the requester or coordinator it's in, and retire the developers you
  launched for it.
