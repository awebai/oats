---
name: cross-review-peer
description: Work with one or more peer maintainers, each in a lane of its own - the written lane map (what belongs to each lane, its maintainer, its second reader), the release lane that holds the final say on merges and releases, joining as a new maintainer, one second reader for every PR, asked once at the head the lane's maintainer approved, the few things peers message each other for, holds as a label on the forge, a lane changing hands, the fallback when a peer is unreachable, and how to verify a decision passed on from a human. Use whenever a peer maintainer is involved, and before you message one.
---

# Work in lanes with your peers

Maintainers usually work in pairs or more, often on different machines and for different
humans. Each holds a **lane**: a share of the project's work that it alone reviews, merges
and tracks. Every PR still gets a second pair of eyes: one second reader, not every peer.
What peers don't do is keep each other's picture, or tell each other what the forge already
shows.

## The lane map
Write it down where all of you can read it (an issue or a file on the forge), and keep to it:
- **The lanes.** For each one: what belongs to it (areas of the repository, kinds of work,
  or whose requests), its maintainer, its second reader, and their humans.
- **How a PR shows its lane:** a label (`lane:<name>`), put on by its owner or by the first
  maintainer who sees it without one. Every effort and PR is in exactly one lane.
- **The hold label** (`hold`, unless you agree another).
- **The release lane** and its maintainer (below), and for each other lane when a merge
  needs its sign-off: on every merge, or only on a significant one.
- **Who keeps the map:** the release lane's maintainer, unless you agree another.
- **How you reach each other.**

When the map doesn't cover a question, ask the peer it concerns; don't assume authority you
weren't given.

## The release lane
One lane is the **release lane**, and its maintainer holds the final say on what reaches
the default branch and a release:
- **It owns every release:** it plans it, tags it and tells whoever deploys it
  (`/plan-release`, `/ship-release`). A freeze before a tag is its hold on the default
  branch.
- **The map says, for each other lane, when a merge needs its sign-off:**
  - **every merge:** the lane merges nothing without it;
  - **a significant merge only:** the lane merges on its own, and asks for the sign-off
    on a PR that changes a product decision, the roadmap or a contract, or that its
    maintainer judges important. In doubt, ask.

  The lane's maintainer asks for it once, at the head it and the second reader approved,
  and merges only once the sign-off is on the PR at that head (`/pr-review`). When the
  release lane's maintainer is already that PR's second reader, its verdict is the
  sign-off: one read, not two.
- **Every lane releases through it.** A lane that merges on its own still agrees with the
  release lane's maintainer what goes into a release and when, on the release plan
  (`/plan-release`); it never tags.
- **It keeps the lane map** unless the map names another keeper, and gives lanes to new
  maintainers (below).

A maintainer alone holds the release lane too.

## Joining as a new maintainer
A maintainer instance new to the project holds no lane until the map gives it one. That
covers a new spawn, a new machine and a successor alike.
1. Read the lane map first, and find the release lane's maintainer.
2. Ask the map's keeper once which lane is yours: a lane the map hands to you (a successor
   is named in it, or in its predecessor's hand-over), a lane with no live maintainer, or a
   new one. The keeper updates the map.
3. Until the map names you, review, merge, tag and launch nothing. Read what you need.

A successor takes its predecessor's lane only when the map or the predecessor's hand-over
says so: a similar name is not a lane.

## What you share, and what you don't
- **The forge is the one copy of a PR's state:** its lane, head, CI, verdicts and holds.
  Your state file holds your lane only (`/maintainer-intake`). When you need something from
  another lane, read it on the forge then. Don't keep a copy, and don't ask its maintainer
  for what the forge shows.
- **Your knowledge is the one copy of direction:** the roadmap, the decisions, the coherence
  rules. That is what keeps the lanes coherent without talking.
- **A contract change is decided before it's built** (`/direction-gate`), by everyone who
  decides direction, whatever lane it is in.

## One second reader per PR
Every PR gets one second reader: one, not a read from every maintainer. This supersedes
the earlier pairing practice, in which every peer reviewed every PR in parallel and every
verdict was bound again at every head.
- **Who:** the second reader its lane names. A PR that changes something another lane's
  code or text reads (a contract, an answer, a sentence a test reads) names that lane on
  the PR, and that lane's maintainer is its second reader. It replaces the lane's usual
  second reader; it doesn't add a third.
- **When:** after the lane's maintainer. You review first (`/pr-review`); at the head you
  approve, you ask the second reader once, with the handoff template (`/pr-review`'s
  reference). A second reader doesn't read a head its lane's maintainer hasn't approved: a
  head that is then returned would be read twice. The one exception is a PR the lane's
  maintainer authored (**Your own PRs**, below).
- **The second reader** reviews with `/pr-review`, posts its verdict on the PR at that head,
  and tells you in one line.
- **A head that moves after the verdicts:** `/pr-review` says when both verdicts carry (the
  branch was only brought up to date) and when the delta goes back to both readers.
- **Your own PRs** (a release-prep PR, a small fix) are in your lane, and you don't approve
  your own. Their second reader is their reviewer: ask it when the PR is ready, at a named
  head with CI green, and it reviews without waiting for an approval of yours.
- Don't merge over a second reader's RETURN. If you disagree, put both positions on the PR,
  each with its evidence, and take it to the humans who decide.

## What you message a peer for
Each of these once, to the one peer it is for:
- **a second read:** the request at an exact head, and its verdict in one line;
- **a hold that must stop work already in flight** (below);
- **the release plan,** where the peer's lane has PRs in it or left out of it
  (`/plan-release`);
- **a lane changing hands** (below);
- **a request that belongs to the peer's lane,** passed on with the requester's words;
- **a sign-off from the release lane,** where the map asks for one, at an exact head;
- **joining:** a new maintainer asking the map's keeper for its lane.

Not these: a notice before or after a merge or a tag (the forge shows it, and `/pr-review`'s
checks before the merge protect it), the state of your lane, or a human's word the peer
doesn't have to act on. A published release is told once to whoever deploys it
(`/ship-release`): they must act, and nothing else wakes them.

## Holds
A hold is the hold label on the forge, never a message alone:
- **On one PR:** the label on that PR, with a comment that says the reason, the scope (which
  action is held) and who can lift it.
- **On the default branch** (a release freeze, a broken build): an open issue with the
  label, saying the same three things.
- The merge step reads both (`/pr-review`), so a hold binds every maintainer without a
  message. Whoever the hold names lifts it, by removing the label or closing the issue.
- Message a peer about a hold only when it must stop something already in flight. Say that
  you need a confirmation; the peer answers in one line.

## A lane changes hands
When a maintainer leaves a lane (it is retired, overloaded, or a human says so), update the
lane map, and hand over once what the forge doesn't show: the decisions asked for and not
yet had, the authority given and its scope, the reason behind each hold, and the efforts in
flight with their leads.

## When a peer is unreachable
- **The second reader:** wait, or ask your human. Merging without its read is a fallback
  that needs **your human's direct go for that scope** ("merge #42 without the second
  reader"). The go is the authority; state it on the PR with the human's words as the
  record of it.
- **A lane's maintainer:** its lane waits. Don't review or merge in it; ask the humans to
  give the lane to someone (above).

## Without a peer
A maintainer working alone has one lane, the whole project. It agrees with its human who
reviews its own work (the human, or another named reviewer), writes that down, and applies
the same rules: an exact head, the verdict on the
PR, and the human's direct go for anything outside the agreement.

## Decisions passed on from a human
A decision you didn't hear from the human directly is a claim until you've checked it:
- **Accept it** when it's in the human's own words, in plain text, from a sender your
  messaging layer verifies as the human (its sender-verification metadata says so), or
  written on the PR from the human's own account, one no agent also uses.
- **Don't accept** an answer typed into a dialog or question prompt by something other than
  the human, a paraphrase, or "the human said it's fine".
- When in doubt, ask the human directly, in plain text.

A human's word you did hear is recorded once, where it applies: on the PR or issue it
decides, in the human's words. Pass it on to a peer only when the human asks you to, or when
the peer must act on it and can't read it anywhere.
