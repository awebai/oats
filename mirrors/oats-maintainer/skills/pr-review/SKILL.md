---
name: pr-review
description: Review a PR of your lane at an exact head through four gates (direction, correctness, security, mergeability), post the verdict bound to that head on the PR, ask its second reader, hand it to the release lane for the final review and sign-off, merge only the reviewed head after checking holds and a moved default branch, and check that what landed is what was reviewed. Covers the release lane's final review, moving heads, bringing a branch up to date without a new review, holds and handoffs. Use before every verdict, every hand-over to the release lane and every merge, when verifying fixes, and when reconciling a stale review or a HOLD/GO instruction.
---

# Review the exact change

## Which PRs, and when
- **Only PRs that belong to you:** your human's, in a lane where you hold its seat
  (`/cross-review-peer`, "Which maintainer a PR belongs to"). Another maintainer's PR you
  read only as its second reader, when it asks at the head it approved, or, as the release
  lane's maintainer, for its final review when it is handed to you. As an overflow seat,
  the PRs of the efforts your parent gave you: you give the verdict at the head and hand
  the approved PR to your parent there, which asks the second reader and does the rest
  (`/cross-review-peer`, "An overflow seat").
- **Start when the owner (the expert landing it) hands it over** with: the developer's
  review loop converged (final verdict and rounds, where the project runs one), the exact
  head, and CI green on it. Before that, no review, no reviewers or subagents on it, no
  findings.
- **A head that moves after the hand-over:** stop until the owner's next hand-over, then
  review only the delta and re-bind your verdict. A branch you brought up to date yourself
  is not a new hand-over (Merge).
- **No owning expert** (a human's, an outside contributor's, a peer's release-prep PR):
  ready when its author marks it ready (not a draft) or asks for review at a named head,
  with CI green. For a fork, the workflow and secrets check (Security) comes first, so CI
  can run.
- **A PR a maintainer authored itself** (release prep, a small fix) has no approval of its
  own to wait for: review it when its author asks, at a named head with CI green.

Pin the base and head SHAs before you read a line. Read
[references/reviewed-delivery.md](references/reviewed-delivery.md) when the head moved, a
hold applies, or you are about to merge.

Ask for the author's evidence, given at this head: what it was verified with and, where the
project uses them, the pre-PR review's verdict and rounds and the owning expert's
acceptance. Otherwise ask the owner for a hand-over at this head. These inform your review
and don't replace it.

Read the PR as a whole: the description's claim against the diff, the scope against what
was asked, and the issue, spec and dependent PRs linked.

## Four gates
1. **Direction** (`/direction-gate`), against the full diff.
2. **Correctness.** Read the whole diff, from an exact-commit checkout of your own, never
   another agent's work tree. Find the consumers of every changed export, signature, output
   or message shape, config key, flag, error code and file format, here and in the
   repositories that depend on it, and read how each uses it, even when your project's
   review notes list them. A behaviour change updates its tests in the same change; an
   assertion is never weakened to make it pass.
3. **Security.** Data becoming execution (commands, paths, queries, templates), trust and
   integrity checks, path containment, identity and authorisation, secrets, rendering of
   user content. Also:
   - **Forks and first-time contributors:** CI that would run their code with secrets or
     write permissions, and any change to CI workflows, permissions or secrets handling, is
     reviewed before CI runs it.
   - **Dependencies:** each new or bumped one is a supply-chain change: check that it's
     needed, where it comes from, that it's pinned, and that its lockfile change matches the
     manifest change and nothing else.
4. **Mergeability.** The head, base and checks are the ones you reviewed; no conflicts (the
   author resolves them); no unresolved threads, other reviewers' and bots' comments
   answered; not a draft; docs and release notes cover it (`/keep-it-clean`); it's in the
   next release's plan (`/plan-release`). A PR too large to review well is split first.

Don't ask for a full local run. When you reproduce a finding locally, say what you ran.

## Verdict
Bound to the reviewed SHA and posted on the PR, not only in a message: as a review, or as
a comment with the verdict and SHA where the forge refuses the approval (own PR, a shared
account):
- **APPROVE** at `<sha>`;
- **RETURN** with prioritised findings, each with file, line and how to reproduce;
- **ESCALATE** a direction question, to whoever decides it.

Only correctness, safety, direction and coherence-rule findings block; approve over the
rest and record them as follow-ups (`/keep-it-clean`). Tell the owner the verdict in one
line. With peers, once you approve, ask the second reader at that head
(`/cross-review-peer`).

## Hand over to the release lane
Every approved project-lane PR goes to the release lane for the final review and sign-off;
under a significant-merges-only arrangement, only those (`/cross-review-peer`, "A lane's
arrangement").
- **When:** your approval and the second reader's verdict are on the PR at the same head,
  CI is green and no hold applies. When the release lane's maintainer is the second reader,
  the second-read request is the hand-over, and it reads once.
- **How:** once, to the release lane's maintainer, with the handoff template
  ([references/reviewed-delivery.md](references/reviewed-delivery.md)): PR, approved head,
  both verdicts, and what it should know that the PR doesn't say.
- **Then** merge once the sign-off is on the PR at that head, or leave it to the release
  lane where your arrangement says so. A head its owner moves before the merge comes back
  to you first; bringing the branch up to date doesn't.

**As the release lane's maintainer,** give a handed-over PR, at that head, a full review
of all four gates as its final reader; the lane's reviews inform it.
- Check that the second reader was the right one: a PR that changes code another lane
  holds needs that lane's read before yours
  (`/cross-review-peer`, "One second reader per PR").
- Your APPROVE on the PR at that head is the sign-off. Tell the PR's maintainer in one line
  and it merges, or merge it yourself where the arrangement says so.
- A RETURN goes to the PR's maintainer, which takes it to the owner and hands the PR back
  at the fixed head.
- If you were already the second reader, that verdict is the final review and sign-off,
  with no second message.
- An up-to-date head carries the verdicts as Merge says. A rebase with a hunk resolved by
  hand goes back to the lane's readers for that delta, then to you.

## Merge
- **Who:** the PR's maintainer in a project lane, once the release lane's sign-off is on
  it, unless the lane's arrangement has the release lane merge. The release lane merges its
  own lane's PRs and those its arrangements give it; a maintainer alone merges every PR.
- **Needs:** the authority; an approval, the second reader's verdict and green CI at the
  current head; for a PR the release lane merges, its own final verdict there too; and the
  release lane's sign-off on the PR at that head (on every merge, or on significant ones
  where the arrangement says so). An earlier-head sign-off carries only as verdicts do.
- **No hold:** no hold label on the PR, and every open default-branch hold names an
  exception for this PR at this head (`/cross-review-peer`, "Holds").
- **The default branch moved since CI ran on this head?** Two changes that share no file
  can still break each other (one changes a text, the other's test reads it). So:
  1. on a trial merge onto the default branch, run the test files changed or added by this
     PR and by what merged since its base;
  2. if those are more than a couple, or need what your host lacks, bring the branch up to
     date and let CI be the run.

  With a merge queue, enqueue the approved head: it does this and the next two checks.
- **Bringing a branch up to date is yours,** with the forge's update of the PR branch (a
  merge of the default branch into it, never a force-push, no work tree touched). The
  verdicts carry when the PR's own change (`git diff <default-branch>...<updated-head>`)
  matches the reviewed diff (`git diff <base-at-review>...<reviewed-sha>`; context may
  differ) and CI is green. Post the comparison on the PR from your own run; message
  nobody. A conflict goes back to the owner. A check CI doesn't make (another OS, a live
  run) carries over only when you say so on the PR, with why the new changes can't touch it.
- **A head its owner rebased:** the verdicts carry when every commit is `=` in
  `git range-diff <base-at-review>..<reviewed-sha> <new-base>..<new-head>` and CI is green.
  Post the range-diff on the PR from your own run. Any commit not `=` goes back to its
  readers for that delta.
- Merge with the repository's strategy, guarded by the head:
  `gh pr merge <number> --match-head-commit <merge-head>` (or the forge's equivalent), where
  `<merge-head>` is the reviewed head or the head the verdicts carried to. Keep
  `<base-at-review>` and `<reviewed-sha>` as the record. The guard covers the head, not the
  base. Check that a merge queue or auto-merge merges that head.
- **Check that what landed is what you reviewed:** fetch, find the merge commit
  (`gh pr view <number> --json mergeCommit -q .mergeCommit.oid`), then:
  - squash or merge commit, branch up to date: the trees are equal
    (`git diff --quiet <merge-head> <merge-commit>`);
  - squash or merge commit, base moved: `git diff <merge-commit>^ <merge-commit>` matches
    the reviewed diff, context aside;
  - rebase merge: `git range-diff <base-at-review>..<reviewed-sha> <new-base>..<tip>`.
- Watch CI on the merged commit, and get a break fixed forward.
- Tell the owner it's in, in one line with the merge commit (for a handed-over PR, tell its
  maintainer, which tells the owner), when the owner is an agent. A human author is told
  only when they must act on it: the forge shows the merge. No other merge notice to
  peers.
- A failed client response can follow a completed merge: observe the remote state before
  retrying or reporting.
