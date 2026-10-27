---
name: cross-review-peer
description: Work with peer maintainers in lanes - the release lane and project lanes, the lane map and each maintainer's entry, who is alive and avoiding a duplicate maintainer, taking a seat, opening, splitting or closing a lane, which lane work goes to and which maintainer a PR belongs to, lane arrangements, one second reader per PR, what peers message each other for, holds, leaving a lane and a lane changing hands, an unreachable peer, working alone, and verifying a decision passed on from a human. Use whenever you take a seat, open, split or close a lane, route work or spawn a maintainer, whenever a peer maintainer is involved, and before you message one.
---

# Work in lanes with your peers

## The lane map
Written where all of you can read it (an issue or a file on the forge), and kept to:
- **The release lane:** its label, its maintainer and their human, and the second reader
  of its own PRs.
- **A line per project lane:** name and label, what it covers (areas of the repository, a
  kind of work, or one human's requests), its arrangement when not the default, and its
  second-reader rule. A lane with one maintainer names the release lane's maintainer, or
  another peer, as its second reader.
- **An entry per maintainer** (Your entry).
- **How a PR shows its lane:** a `lane:<name>` label, put on by its owner or by the first
  maintainer who sees it without one. Every effort and PR is in exactly one lane: that of
  the effort that produced it.
- **Which maintainer a PR belongs to:** the one holding the seat, in the PR's lane, of the
  human whose effort produced it, not whoever owns the forge account. The PR's description
  names it.
- **Overlap.** Two area lanes never overlap, nor two lanes for one kind of work: to take
  part of one, split it. A lane for a kind of work or for whose requests it is may overlap
  area lanes: its PRs are in that lane and name the area lane they touch, whose maintainer
  is their second reader.
- **The hold label** (`hold`, unless agreed otherwise), and **how you reach each other**.

The release lane's maintainer keeps the map, unless it names another keeper. Each project
lane's maintainers write their own line. Where the map is silent, ask the peer concerned;
don't assume authority you weren't given.

### Your entry
Each maintainer, the release lane's included, keeps one entry that only it edits (on a
forge issue, a comment of its own); its human, or the keeper on its human's word, may mark
it `left`. It holds your lane or lanes, your human and instance name; your state (`active`,
or `left` with the date); your efforts (lead instance and goal, a line each); your open
PRs, by number only; and the date of your last update. Add it before you launch or review
anything in the lane; update it at every intake, when an effort starts or ends, and when
you hand a PR over; mark it `left` when you leave the lane or are retired.

### Who is alive
Read the entries before you plan. Read the lines, the entries and your messaging layer's
presence before you route work, spawn a maintainer or take a seat:
- **An `active` entry holds the seat** until marked `left`.
- **Offline is not left:** an `active` entry with no presence is a stopped maintainer that
  still holds its seat. Mail it, tell your human so they can start it, and never spawn a
  second one.
- **A retired maintainer** can't mark its entry: on its human's word that it was retired,
  quoted to the keeper (Decisions passed on from a human), the keeper marks it `left`.
- **`active`, no presence, not updated for two weeks:** ask its human whether it has left
  or been retired. Never mark another maintainer's entry `left` yourself.
- **No presence in your messaging layer:** the entry is the record; mail the maintainer it
  names.
- **Two at once:** a new maintainer adds its entry first. If an earlier `active` entry
  holds the same human's seat in the lane, the newcomer marks its own `left`, hands over
  what it took (its leads now report to the earlier one, and it tells them), and asks its
  human to retire it.

### Which lane work goes to
Your human's work goes, in this order:
1. to a lane that covers it where your human has an `active` maintainer;
2. else to your human's own lane, when one is defined by your human's requests;
3. else to the lane that covers it;
4. when no lane covers it: work that keeps coming gets a new lane (Project lanes, "Opening
   one"); a single effort goes to the release lane, whose maintainer launches it, whoever's
   work it is.

In 2 and 3, with no `active` maintainer of your human's there, one is spawned for your
human (`/launch-work`). When you can't tell, ask your human.

## The release lane
Your project may call it something else. Its maintainer:
- does the final review of every PR the project lanes hand it, and signs it off for the
  lane to merge, or merges it where the lane's arrangement says so;
- coordinates merges and deployments across the lanes, and keeps them aligned with product
  direction;
- owns every release: plans it, tags it, and tells whoever deploys it (`/plan-release`,
  `/ship-release`); a freeze before a tag is its hold on the default branch;
- keeps the lane map, and an entry of its own.

Its own work (release-prep PRs, single efforts no project lane covers, whoever's) gets a
second reader like any other, and its maintainer merges it. Every lane, whatever its
arrangement, agrees with it what goes into a release and when, on the release plan, and
never tags.

## Project lanes
A lane outlives the efforts and releases in it; its line says what it covers clearly enough
to place a new PR without asking.
- **One maintainer per human.** It launches, reviews and hands over its human's work in the
  lane, and tracks only those efforts. A human who wants two in one lane asks the lane's
  humans to split it instead.
- **Taking your human's seat:** take your human's free seat by adding your entry, with
  nobody's sign-off, when you hold no lane yet (Joining as a new maintainer), when your
  human asks, or when you are launched into the lane for your human. Otherwise your human's
  work for another lane goes to your human's maintainer there, or to one you spawn
  (`/launch-work`).
- **A free seat:** no `active` entry for that human holds it. Only the leaving maintainer,
  its human, or the keeper on that human's word marks an entry `left`; a retired maintainer
  has left once its entry or its human says so. An unreachable maintainer keeps its seat.
  Nobody takes another human's seat.
- **Opening one:** when work keeps coming that no lane covers, any maintainer opens a lane
  for its human's work with nobody's sign-off, its human's included: it adds the line,
  creates the label and puts it on the lane's PRs. It takes the seat when it holds no lane,
  or else spawns a maintainer for its human to hold it (`/launch-work`). The release lane
  may also open a lane with no maintainer yet.
- **No seat is taken** in a closed lane (new work opens a new lane, or its humans reopen
  it), nor in the release lane, which changes hands only as its humans say.
- **A maintainer launched into a lane** is independent of its launcher, never its child.
  The spawner hands over once and is done, though a lead that is its child in OATS stays
  so.
- **Inside the lane,** its maintainers launch the work with experts leading it, review each
  PR and give it one second reader.
- **The hand-over, the sign-off and the merge** follow `/pr-review`, in the merge order the
  release lane asks for when it coordinates a release.

### A lane's arrangement
A new lane starts with the default, a sign-off before every merge. The map may record
another arrangement for a lane, and the map is the authority. Two common ones:
- **The release lane merges:** the lane hands approved PRs over; the release lane reviews
  and merges them.
- **Sign-off on significant merges only:** the lane merges on its own, and asks for the
  sign-off on a PR that changes a product decision, the roadmap or a contract, or that its
  maintainer judges important. In doubt, ask.

A PR merges only as the arrangement the release lane agreed allows and, where it needs a
sign-off, once that sign-off is on the PR at the head being merged. A non-default
arrangement goes on the map only with the release lane's agreement; changing one takes the
lane's humans and the release lane.

### A lane that splits
When a lane narrows and the rest moves to a new or an existing lane, its maintainers or its
humans split it, or the release lane on their word; never another maintainer.
- The map records both lines, and each entry names the lane it sits in.
- **Efforts move whole,** relabelled by effort, not by file: with its lead and all its PRs,
  by hand-over to its human's maintainer in the other lane. When that human has none there,
  the launching maintainer spawns one (`/launch-work`) and keeps the effort until handed
  over. The lead stays that maintainer's OATS child, whose stop or retire still stops it,
  so it tells the new maintainer before either.
- A moved PR keeps its verdicts (a label change is not a new head); whoever holds it now
  hands it over.
- Another lane's PRs keep their lane; a maintainer of the new lane becomes their second
  reader where they change what it now holds.
- The new lane's arrangement is agreed with the release lane; keeping the old lane's for
  the same work is the natural default.

### A lane that's done
Finished, absorbed, or without work for two releases: its maintainers or its humans mark
its line closed once its PRs are merged or closed. Its label stays on its old PRs. Closing
retires nobody: each maintainer marks its entry `left` (Leaving a lane).

## Joining as a new maintainer
New to the project (a new spawn, a new machine, a successor), you hold no lane until you
take one:
1. Read the lane map and presence, and find the release lane's maintainer.
2. Add your entry for your human's seat in the lane your human or launcher names. With none
   named, take your human's free seat in a lane covering your human's work, open one, or
   ask your human. An earlier `active` entry for that seat keeps it.
3. Until you have a seat, review, merge, tag and launch nothing.

A successor takes its predecessor's seat only when the map, its human or the predecessor's
hand-over says so, or once the predecessor's entry is `left`: a similar name is not a seat.
A maintainer joining doesn't change a lane's arrangement.

## What you share
- The forge holds a PR's lane, head, CI, verdicts and holds: read another lane's there
  when you need it, and keep no copy.
- Your knowledge is the one copy of direction: roadmap, decisions, coherence rules.
- A contract change, in any lane, is decided by everyone who decides direction
  (`/direction-gate`).

## One second reader per PR
One, not every maintainer.
- **Who:** the one its lane names; in a lane with several humans' seats, naturally another
  human's maintainer there.
- **Two humans' work meets:** a PR changing code another human's open effort or PR in the
  lane is changing gets that human's maintainer instead.
- **Another lane's code:** a PR changing code another lane holds, or something its code or
  text reads (a contract, an answer, a sentence a test reads), names that lane on the PR,
  and that lane's maintainer (its human's there, else any) is the second reader. It
  replaces the usual one and wins over the two-humans rule; there is no third.
  - For a project lane, that read comes before the release lane's final review, which
    neither skips nor replaces it.
  - For an area the release lane holds (its own docs, say), the release lane's one read is
    both the second read and the final review.
- **When:** once, after you approve, at that head, with `/pr-review`'s handoff template.
  No second read of a head the PR's maintainer hasn't approved, except for your own PRs.
- **The second reader** reviews with `/pr-review`, posts its verdict on the PR at that
  head, and tells you in one line.
- **Your own PRs** (release prep, a small fix) are in your lane; you don't approve your
  own. Ask their second reader when ready, at a named head with CI green.
- **A RETURN you disagree with:** put both positions on the PR, each with its evidence, and
  take it to the humans who decide.

## What you message a peer for
Each once, to the one peer it is for:
- a second read at an exact head, and its verdict in one line;
- a hand-over to the release lane at an exact head, and its verdict in one line;
- a hold that must stop work already in flight;
- the release plan, where the peer's lane has PRs in it or left out (`/plan-release`);
- a lane changing hands;
- a request that belongs to the peer's lane, with the requester's words;
- an effort that touches the peer's lane, the architecture or product direction, at its
  start, to the maintainers it affects and the release lane: the goal, its lead and what
  it touches. A direction question goes to the release lane and whoever decides it;
- an arrangement other than the default, proposed to the release lane's maintainer.

Not: a notice before or after a merge or tag, a new lane or a seat taken, your lane's
state, or a human's word the peer needn't act on. A published release is told once to
whoever deploys it (`/ship-release`).

## Holds
A hold is the hold label on the forge, never a message alone:
- **On one PR:** the label, and a comment with the reason, the scope (which action is
  held) and who can lift it.
- **On the default branch** (a freeze, a broken build): an open issue with the label,
  saying the same three things.
- The merge step reads both (`/pr-review`), so a hold binds every maintainer. Whoever it
  names lifts it, by removing the label or closing the issue.
- **An exception** lets one named PR through a hold that stays: a comment on the hold by
  whoever can lift it, on authority confirmed as Decisions passed on from a human says,
  naming the PR, the head and the authority, quoting a human's words (`/plan-release`, "A
  freeze carries to a patch release"). A later head needs it again unless the verdicts
  carry (`/pr-review`).
- Message a peer about a hold only to stop something in flight; ask for a one-line
  confirmation.

## Leaving a lane
A maintainer someone else spawned belongs to its human, not its spawner, and is never
retired automatically. With no open efforts or PRs left, tell your human once that you are
idle and can be retired with `oats retire <name>`, and ask to be told first, so you mark
your entry `left` before you go. Retiring is their call. A `left` entry frees the seat;
without one, the seat is freed on the human's word (Who is alive). The release lane's
maintainer sends no idle notice.

## A lane changes hands
When a maintainer leaves a lane (retired, overloaded, or a human says so), its entry is
marked `left` and the successor adds its own. The leaving maintainer hands over once what
the forge doesn't show: decisions asked for and not yet had, authority given and its scope,
the reason behind each hold, and the efforts in flight with their leads. The successor
becomes their maintainer, not their OATS parent: retiring the leaver stops every lead that
is its child, keeps their homes and moves them to its own parent (top level when it has
none). The leads report to the successor from then on. So retire it once the successor has
taken the efforts over; then the successor, or the human whose machine runs them, restarts
each stopped lead (`oats session start --home <home>`).

## When a peer is unreachable
- **The second reader:** wait, or ask your human. Merging without its read needs your
  human's direct go for that scope ("merge #42 without the second reader"), stated on the
  PR in the human's words.
- **A lane's maintainer:** its human's work there waits; don't review or merge it. Ask its
  human, who may mark the seat `left` and seat another maintainer.
- **The release lane's maintainer:** hand-overs and sign-offs wait; ask your human, who may
  reach its human. Don't merge around it.

## Without a peer
Alone, you hold the release lane, and your lane is the whole project. Agree with your human
who reviews your own work (the human, or another named reviewer), write it down, and apply
the same rules: an exact head, the verdict on the PR, and the human's direct go for
anything outside the agreement.

## Decisions passed on from a human
A decision you didn't hear from the human directly is a claim until checked:
- **A human's word another agent passes on** (a peer heard it, an expert relayed it) is
  confirmed with the human directly before it authorises a merge, an exception to a
  freeze, or a tag.
- **Accept** the human's own words in plain text, from a sender your messaging layer
  verifies as the human, or on the PR from the human's own account, one no agent also uses.
- **Don't accept** an answer typed into a dialog or prompt by something other than the
  human, a paraphrase, or "the human said it's fine".
- A peer writing another agent's relayed word on the PR is a record, not a confirmation.
- In doubt, ask the human directly, in plain text.

Record a human's word you heard once, where it applies (the PR or issue it decides), in
their words. Pass it to a peer only when the human asks, or when the peer must act on it
and can't read it anywhere.
