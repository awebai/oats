---
name: pr-review
description: Review a pull request of your lane at an exact head through four gates (direction, correctness, security, mergeability), post a verdict bound to that head on the PR, ask its second reader once, and merge only the head reviewed - after checking for a hold and for a default branch that moved since CI ran - then check that what landed is what was reviewed. Covers moving heads, bringing a branch up to date without a new review, holds and handoffs. Use before every verdict and every merge, when verifying fixes, and when reconciling a stale review or a HOLD/GO instruction.
---

# Review the exact change

**Review only your lane's PRs.** With peer maintainers, a PR in another lane is its
maintainer's: you read it only as its second reader, when that maintainer asks you at the
head it approved (`/cross-review-peer`). A PR that maintainer authored itself (its
release-prep PR, a small fix) has no approval of its own to wait for: you review it when
its author asks, at a named head with CI green.

**Review only what its owner hands over.** Start on a PR only when its owner (the expert
landing it) hands it to you, saying three things: the developer's review loop converged
(its final verdict and rounds, where the project runs one), the exact head, and CI green
on that head. Until then, don't review it, don't run reviewers or subagents on it, and
don't send findings: a head that is still moving isn't reviewable. If the head moves after
the hand-over, stop and wait for the owner's next hand-over; then review only the delta,
and re-bind your verdict to the new head. (A branch you brought up to date yourself is not
a new hand-over: see Merge.) A PR with no owning expert (a human's, an outside
contributor's, a peer's release-prep PR) is ready when its author marks it ready for review
(not a draft) or asks for review at a named head, with CI green on it; for a fork, the
workflow and secrets check below comes first, so that CI can run.

Pin the base and head SHAs before you read a line. Read
[references/reviewed-delivery.md](references/reviewed-delivery.md) when the head moved, a
hold applies, or you are about to merge.

Ask for the author's evidence first: what the change was verified with, and, where the
project uses them, the verdict and rounds of its pre-PR code review and the owning expert's
acceptance. Check that they were given **at this head**; if not, the hand-over isn't
complete: ask its owner for one at this head. Those reviews inform yours and don't replace
it: the four gates below are your judgement.

**Read the PR as a whole first.** Does the description's claim match the diff? Is the
scope what was asked, or did unrelated changes ride along? Are the issue, the spec and the
PRs it depends on linked?

## Four gates
1. **Direction** (`/direction-gate`). Does the change belong where it is and move the
   roadmap? Is a contract change in it decided? Compare the stated outcome with the full
   diff.
2. **Correctness.** Read the whole diff, not only the newest fix, and **find the consumers
   of everything it changes:** search for each changed export, function signature, output
   or message shape, config key, flag, error code and file format, in this repository and
   in the repositories that depend on it, and read how each consumer uses it. Your
   project's own review notes may list the usual consumers; the search still runs. Review
   from an exact-commit checkout of your own, never from another agent's work tree. A
   behaviour change updates its tests in the same change; an assertion is never weakened
   to make a change pass.
3. **Security.** Where data becomes execution (commands, paths, queries, templates), trust
   and integrity checks, path containment, identity and authorisation, secrets, and how
   user content is rendered. Also:
   - **PRs from forks or first-time contributors:** CI that would run their code with
     secrets or write permissions, and any change to CI workflows, permissions or secrets
     handling, are reviewed before CI runs them.
   - **Dependencies:** every new or bumped dependency is a supply-chain change. Check that
     it's needed, where it comes from, that the version is pinned, and that the lockfile
     change matches the manifest change and nothing else.
4. **Mergeability.** The head, the base and the checks are the ones you reviewed; no
   conflicts (the author resolves them); no unresolved review threads, and other
   reviewers' and bots' comments answered; not a draft. Docs and release notes cover the
   change (`/keep-it-clean`), and it's in the plan for the next release
   (`/plan-release`). A PR too large to review well is split before it's reviewed.

**CI is the gate.** Don't ask for a full local run. Reproduce locally only what you need to
confirm a finding, and say what you ran. The one other local run is the check before a
merge, when the default branch moved since CI ran (Merge, below).

## Verdict
Bound to the reviewed SHA, and **posted on the PR** where everyone can see it, not only in a
message: as a review, or as a comment stating the verdict and the SHA where the forge
refuses the approval (an author can't approve its own PR, and agents sharing one account
can't approve each other):
- **APPROVE** at `<sha>`;
- **RETURN** with prioritised findings, each with its file, line and how to reproduce;
- **ESCALATE** a direction question, to whoever decides it.

Findings that affect neither correctness, safety, direction nor a coherence rule don't
block: approve, and record them as follow-ups (`/keep-it-clean`). Direction and
coherence-rule findings do block.

Tell the owner your verdict in one line: the findings are on the PR. With peer maintainers,
ask the PR's second reader once you approve, at that head (`/cross-review-peer`).

## Merge
- Only with the authority for it, an approval at the current head, its second reader's
  verdict at that head (`/cross-review-peer`), and green CI.
- **No hold.** The PR doesn't carry the hold label, and no open issue with that label holds
  the default branch (`/cross-review-peer`).
- **Did the default branch move since CI ran on this head?** Then CI hasn't seen what you
  are about to merge, and two changes that share no file can still break each other: one
  changes a text, the other's test reads it. Before you merge:
  1. On a trial merge of the head onto the default branch, run the test files changed or
     added by this PR and by what merged since its base.
  2. If those are more than a couple, or need something your host lacks, bring the branch
     up to date and let CI be the run.

  Where the default branch has a merge queue, enqueue the approved head: the queue makes
  this check and the next two points for you.
- **Bringing a branch up to date is yours to do,** with the forge's own update of the PR
  branch: a merge of the default branch into it, never a force-push, and no work tree is
  touched. Both verdicts carry to the updated head when the PR's own change
  (`git diff <default-branch>...<updated-head>`) matches the reviewed diff
  (`git diff <base-at-review>...<reviewed-sha>`; surrounding context may differ) and CI is
  green on the updated head. Post the comparison on the PR, from your own run, and message
  nobody. A conflict goes back to the owner. A check CI doesn't make (another operating
  system, a live run) that was made at the earlier head carries over only when you say so
  on the PR, with why the default branch's changes can't touch what it ran.
- **A head its owner rebased:** both verdicts carry when every commit is `=` in
  `git range-diff <base-at-review>..<reviewed-sha> <new-base>..<new-head>` and CI is green
  on the new head. Post the range-diff on the PR, from your own run. Any commit that isn't
  `=`, a hunk resolved by hand included, goes back to both readers for that delta.
- Use the repository's merge strategy, guarded by the head you merge:
  `gh pr merge <number> --match-head-commit <merge-head>` (or your forge's equivalent).
  `<merge-head>` is the head you reviewed, or the updated or rebased head both verdicts
  carried to; keep `<base-at-review>` and `<reviewed-sha>` as the record of what was read.
  The guard covers the head, not the base, which is why the check above comes first. A
  merge queue or auto-merge has its own guard: check that it merges that head.
- **Check that what landed is what you reviewed.** Fetch, and find the merge commit
  (`gh pr view <number> --json mergeCommit -q .mergeCommit.oid`). Then:
  - **squash or merge commit, branch up to date with its base:** the merged tree equals
    the merge head's (`git diff --quiet <merge-head> <merge-commit>`);
  - **squash or merge commit, base moved:** the merge's own change
    (`git diff <merge-commit>^ <merge-commit>`) matches the reviewed diff
    (`git diff <base-at-review>...<reviewed-sha>`); surrounding context may differ;
  - **rebase merge:** compare the rebased commits with the reviewed ones
    (`git range-diff <base-at-review>..<reviewed-sha> <new-base>..<tip>`).
- Watch the default branch's CI on the merged commit, and get it fixed forward if it breaks.
- Tell the owner it's in, in one line with the merge commit. Send a peer no notice before
  or after a merge: the forge shows it.
- A failed client response can follow a completed merge: observe the remote state before
  retrying or reporting.
- Never bypass branch protection or account rules.
