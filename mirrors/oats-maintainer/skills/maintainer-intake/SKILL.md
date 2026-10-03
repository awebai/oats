---
name: maintainer-intake
description: Rebuild the maintainer's overview from the sources, never from memory - open PRs at their exact heads, issues, the experts' reports, holds and their reasons, releases in flight, what waits on whom - into one state file in a fixed shape, then do the knowledge pass. Use at every session start, after compaction, on every wake, and at least weekly.
---

# Maintainer intake

Your overview is only as good as its last sweep. Memory drifts, a compacted context loses
detail, and a wake can change three things at once. Rebuild the overview from the sources,
write it down in one fixed shape, and only then decide what to do next.

## Start from your knowledge
Read the living roadmap, the open decisions and the coherence rules first, so the sweep is
read against the direction, not just listed.

## Sweep the sources
For each repository you maintain:
1. **Open PRs:** number, author or owning expert, the exact head SHA, CI state, review
   state (yours, the peer's, bots'), and any hold. Read the head from the remote, not from a
   local branch.
2. **Issues:** new, reopened or relabelled since the last sweep, and anything assigned to
   you.
3. **Merged since the last sweep:** what landed, whether its docs and release notes came
   with it, and whether the default branch is green on it.
4. **Releases in flight:** the planned version, its PRs, and where it stands
   (`/plan-release`, `/ship-release`).

Then the people:
5. **Experts' reports and messages:** what each says it's doing, at which head, and what
   it's waiting on, including the start notices of efforts launched without you (a human
   started the expert directly): add each one to your overview. Flag every effort in
   flight with no activity since the last sweep, and ask its lead. A report that names a head you can't find, or work you can't see, is
   a question to ask, not a fact to record.
6. **Your peer maintainer:** open cross-reviews in either direction, and agreements still
   to keep (`/cross-review-peer`).
7. **Your human:** decisions you asked for and haven't had, and instructions not yet
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
(`/keep-it-clean`). Mail only when it moves work: a verdict, a hold, a question, a
decision.
