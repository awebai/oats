---
name: maintainer-intake
description: Rebuild the maintainer's overview of its lane from the sources, never from memory - the lane's open PRs at their exact heads, issues, the experts' reports, holds and their reasons, releases in flight, what waits on whom - into one state file in a fixed shape, then do the knowledge pass. Use at every session start, after compaction and at least weekly; on a wake, its short form updates only what the event touches.
---

# Maintainer intake

Your overview is only as good as its last sweep. Memory drifts, and a compacted context
loses detail. Rebuild the overview from the sources, write it down in one fixed shape, and
only then decide what to do next.

**The overview is of your lane.** With peer maintainers, each of you holds a lane
(`/cross-review-peer`): you sweep, track and write down yours. The forge is the one copy of
every PR's state, so another lane's PRs, verdicts and holds are read there when you need
them and are never copied into your state. Alone, your lane is the whole project.

## When to sweep, and when not
- **A full sweep:** at session start, after a compaction, and at least weekly.
- **On a wake:** no sweep. Handle the event that woke you, and update the rows of your state
  it touches, each from its source (the PR's head from the remote, not from the message).
  Sweep only when the event shows your state is wrong in more than that.

## Start from your knowledge
Read the living roadmap, the open decisions and the coherence rules first, so the sweep is
read against the direction, not just listed.

## Sweep the sources
For each repository you maintain:
1. **Your lane's open PRs** (by their lane label): number, author or owning expert, the
   exact head SHA, CI state, review state (yours, the second reader's, bots'), and any
   hold. Read the head from the remote, not from a local branch.
2. **Open PRs with no lane:** give each its lane from the lane map, by its label. Take the
   ones that are yours; leave the others to their maintainers.
3. **Issues** in your lane: new, reopened or relabelled since the last sweep, and anything
   assigned to you.
4. **Merged in your lane since the last sweep:** what landed, whether its docs and release
   notes came with it, and whether the default branch is green on it.
5. **Holds on the default branch:** the open issues with the hold label
   (`/cross-review-peer`).
6. **Releases in flight:** the planned version and where it stands. The release owner
   tracks its plan (`/plan-release`, `/ship-release`); everyone else keeps only which of
   their lane's PRs are in it.

Then the people:
7. **The experts of your lane, their reports and messages:** what each says it's doing, at
   which head, and what it's waiting on, including the start notices of efforts launched
   without you (a human started the expert directly): add each one to your overview. A
   report that names a head you can't find, or work you can't see, is a question to ask,
   not a fact to record.
8. **Efforts with no activity since the last sweep:** read the effort's PRs and its lead's
   instance status first. Ask the lead only when something waits on the effort (a release,
   a dependent PR, the requester), and ask the one thing you need. Never ask for a progress
   report, and never set a lead or a helper up to send you one.
9. **Your peer maintainers:** the second reads you owe and the ones you asked for
   (`/cross-review-peer`). Nothing else of a peer's lane.
10. **Your human:** decisions you asked for and haven't had, and instructions not yet
    carried out.

After a crash, compaction or restart, reconcile against exact identifiers (message ids, PR
heads, commit SHAs), not against "the latest" or what you remember having done. Read state
is not completion: check the outcome of every action you were in the middle of before you
repeat it.

## Write the state
Keep one state file in the shape of [references/state.md](references/state.md), rewritten
on every sweep and updated between sweeps whenever you act (a verdict, a merge, a launch, a
hold, a decision). Its order is its priority: what others wait on from you comes first.
Every line names its exact reference (`repo#PR @ sha`, a message id, an issue), and every
hold says its reason and its scope.

## The knowledge pass
End every intake with your knowledge (the maintainer inject says what it keeps):
- Has direction or sequence changed? Update the **living roadmap** in place, superseding
  what changed.
- Was an **architectural or structural call** made (by you, a peer, an expert or the
  human)? Record it with its reason and the alternatives rejected.
- Did a review enforce a **coherence rule** that isn't written down yet? Record it.
- Skip one-off patches and anything the repository already records.

## Then act
Work the state top-down: unblock others first (reviews you owe, answers you owe), then
the merges you hold the authority for, then releases, then cleanliness
(`/keep-it-clean`). Message only when it moves work, and only the one it is for: a verdict
to the PR's owner, a second-read request, a question, a decision. Your workspace's
messaging rules say how; `/cross-review-peer` says what a peer is told.
