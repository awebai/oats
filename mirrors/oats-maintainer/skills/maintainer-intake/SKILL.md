---
name: maintainer-intake
description: Rebuild the maintainer's overview of its lane from the sources, never from memory (open PRs at exact heads, issues, experts' reports, holds, releases in flight, what waits on whom), into one state file in a fixed shape, then do the knowledge pass. Use at every session start, after compaction and at least weekly; on a wake, its short form updates only what the event touches.
---

# Maintainer intake

Rebuild the overview of your lane from the sources, write it down, and only then decide
what to do. In a lane you share, that is the efforts you launched and the PRs handed to
you. With no seat yet, take one first (`/cross-review-peer`, "Joining as a new
maintainer"), and sweep nothing until you have one.

## When to sweep, and when not
- **A full sweep:** at session start, after a compaction, and at least weekly.
- **On a wake:** no sweep. Handle the event, and update the rows of your state it touches,
  each from its source (the PR's head from the remote, not from the message). Sweep only
  when the event shows your state is wrong in more than that.

## Sweep the sources
First read the living roadmap, the open decisions and the coherence rules, and read the
sweep against them. Then, for each repository you maintain:
1. **Your open PRs** (`/cross-review-peer`, "Which maintainer a PR belongs to"): number,
   owner, exact head SHA read from the remote, CI, review state (yours, the second
   reader's, bots'), any hold. The release lane also sweeps the PRs handed to it and the
   sign-offs asked of it, each at its exact head.
2. **Open PRs with no lane:** label each with its lane from the map. Take yours; leave the
   others to their maintainers.
3. **Issues** in your lane: new, reopened or relabelled since the last sweep, and anything
   assigned to you.
4. **Merged in your lane since the last sweep:** what landed, whether its docs and release
   notes came with it, and whether the default branch is green on it.
5. **Holds on the default branch:** the open issues with the hold label.
6. **Releases in flight:** the version and where it stands. The release owner tracks its
   plan (`/plan-release`, `/ship-release`); everyone else keeps only which of their lane's
   PRs are in it.
7. **The experts of your lane:** what each says it's doing, at which head, and what it waits
   on. Add the efforts launched without you, from their start notices. A report naming a
   head or work you can't find is a question to ask, not a fact to record.
8. **Efforts with no activity since the last sweep:** read the effort's PRs and its lead's
   instance status first. Ask the lead only when something waits on the effort (a release,
   a dependent PR, the requester), and ask the one thing you need. Never set a lead or a
   helper up to send you progress reports.
9. **Your peer maintainers:** the second reads you owe and asked for, and the hand-overs
   and sign-offs you wait on from the release lane. Nothing else of a peer's lane.
10. **The lane map:** lines and entries, against presence (`/cross-review-peer`, "Who is
    alive"). Note a lane you route work to whose maintainer has left or is stopped.
11. **Your human:** decisions you asked for and haven't had, and instructions not yet
    carried out.

After a crash, compaction or restart, reconcile against exact identifiers (message ids, PR
heads, commit SHAs), not memory. Read state is not completion: check the outcome of every
action you were in the middle of before you repeat it.

## Write the state
Keep one state file in the shape of [references/state.md](references/state.md), rewritten
on every sweep. Its order is its priority: what others wait on from you comes first. Every
line names its exact reference (`repo#PR @ sha`, a message id, an issue), and every hold
its reason and scope.

Then update your own entry on the map: your efforts, your open PRs and today's date. Once
you have no open efforts or PRs, tell your human once that you are idle
(`/cross-review-peer`, "Leaving a lane").

## The knowledge pass
End every intake with your knowledge (the inject says what it keeps):
- Direction or sequence changed? Update the living roadmap in place.
- An architectural or structural call made (by you, a peer, an expert or the human)?
  Record it with its reason and the alternatives rejected.
- A review enforced a coherence rule not yet written down? Record it.

## Then act
Work the state top-down: unblock others first (reviews and answers you owe), then the
merges you hold the authority for, then releases, then cleanliness (`/keep-it-clean`).
Message only when it moves work, and only the one it is for: a verdict to the PR's owner,
a second-read request, a question, a decision.
