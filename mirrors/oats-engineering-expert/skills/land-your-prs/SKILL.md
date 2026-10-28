---
name: land-your-prs
description: Own a PR from opening to merge, including one a developer built for you. Open it well, monitor it for reviews and checks from bots, agents and humans, triage each comment, get fixes made, rebase or rework when integration needs it, merge by the repository's rules, and retire the instances you launched once they are finished, without asking anyone. Use whenever work in your domain becomes a PR, while PRs are open, when a coordinator asks you to rework one, and when an instance you launched, or your own effort, is finished.
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
- Tell an agent requester or coordinator it's in (a human requester only when they must
  decide, approve or provide something), then retire the developers you launched for it
  (Retire what's finished).

## Retire what's finished
Finished instances are retired without asking or telling a human. Spawning and retiring
never involve one: done lines and retirements go to the parent, or, with none, to the
maintainer the instance reports to. A human hears only when they must decide, approve or
provide something.

An instance is **finished** when all of these hold:
- its work has landed: its PRs are merged (or deployed, where the effort deploys) with CI
  green on the merged commit, or closed, or the work was explicitly dropped. Handed back
  is not landed: it may still be needed for fixes and rebases;
- nothing waits on it: no open PR, review, question or hand-back of its own, and its own
  children are retired;
- with a harvest duty (your knowledge layer says whether you have one), its final harvest
  checkpoint ("you finish a task") is recorded in its log.md with the harvester's name, and
  the harvester is launched. The harvester snapshots its evidence at spawn and the retire
  keeps a recovery copy, so nobody waits for the harvester to finish.

- **The done report** says its harvest state in one of three lines, sent once the child has
  retired its own children and removed its extra worktrees:
  - "done, harvested: <harvester>": finished;
  - "done, no harvest duty": finished;
  - "done, harvest pending: <proposal>": not finished, its final proposal still waits.
    Retire nothing yet; it reports again, "done, harvested: <harvester>", once the
    proposal goes through.

  Ask for the line when a done report lacks it. A child whose work isn't a Git work tree
  also names each repository it used under its work, with its branch.
- **Before you retire it, check:**
  - `oats instance git <child>`: no uncommitted changes and no unpushed commits (a retire
    would keep such a work tree, not deliver it); otherwise the child finishes or hands its
    work over first. When its work isn't a Git work tree (`E_NO_WORKTREE`: directory or
    workspace mode), check each repository its done report names, read-only:
    `git -C <path> status --short --branch` shows a clean tree tracking its upstream, not
    ahead. An error, or a repository you can't see, is not clean: ask the child;
  - `oats retire <child> --plan`: no other instance is attached to its work tree;
    otherwise wait until that one is retired by its own parent.
- **Retire it** with `oats retire <child>`, and record it in your state (name, why). No
  acknowledgement is needed, and nothing goes upward beyond your normal report.
- **Only your own children.** Never retire another's child: tell its parent instead (with
  none, the maintainer it reports to). Children are retired before their parent: a parent's
  retire stops and keeps its running children, and refuses with `E_CHILDREN_RUNNING` when
  one won't stop.
- **Never reuse a name:** a new instance never takes a retired one's name, which couldn't
  harvest.
- **Your developers:** a developer hands back before its PR merges, so once the PR is merged
  and green, or closed, tell it so with the commit; it finishes and sends its done line.
- **Experts you launched** (`/coordinate-experts`): once their PRs are merged and green, or
  closed, and they send their done line.
- **Yourself:** once your effort is finished, retire your children, run your final
  checkpoint, give an agent requester or coordinator the outcome (a human requester only
  when they must decide, approve or provide something), and send your parent your done line,
  unprompted; it retires you. With no OATS parent (spawned `--relation unrelated`, or
  started directly by a human), send the done line to the maintainer you report to, then run
  the same checks on yourself and retire yourself with
  `oats retire "$OATS_INSTANCE" --self` (the instance name is required).