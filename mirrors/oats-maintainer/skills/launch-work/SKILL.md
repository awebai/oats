---
name: launch-work
description: Turn the work someone asks the maintainer for into launched work, without leading it - usually a human's high-level picture of what they want (a feature, a fix, an investigation, a project) - clarify only what changes who leads it, find the lane (routing work for another lane to its maintainer, or to one you spawn) and the best-suited expert, delegate to a live expert whose work it continues or spawn one lead expert per independent effort as your child, brief it, tell the requester, track it in the state file, and retire it when it is done or cancelled; also launching another maintainer into a lane, independent of you. Use whenever a human describes work they want, or anyone asks you to start, launch or hand off work.
---

# Launch work

You start work; experts lead it. Every effort you launch gets one lead expert, who writes
its spec and plan and coordinates the developers and other experts it needs. A lead you
spawn for work in a lane you hold is your child: you are its parent as the lane's
maintainer, not its coordinator, and it leads the effort.

This is your normal intake. Humans usually give you the high-level picture, a few sentences
about work they want done, not a spec. That is enough: your job is to get it to the right
lead with a good brief. The lead works out the detail, with the human where it needs them.

## 1. Understand the request
- What is asked, by whom, and what "done" means to them. Ask only what changes who should
  lead it, or how many efforts it is. Leave the rest for the lead: don't gather
  requirements, and don't write a spec.
- **How many efforts?** Work with separate goals that can land on their own is separate
  efforts, each with its own lead. One goal that touches several domains is one effort.
- **Consult your knowledge:** the roadmap (does this fit, does it jump the queue?), the
  decisions it touches, and who owns the domain. A request that needs a direction decision
  first goes through `/direction-gate` before anyone builds.
- **Whose lane is it?** Launch only work in a lane you hold. Work that belongs to another
  lane, or to a new project no lane covers, goes to a maintainer of its own:
  - **the lane has a maintainer:** pass the request to it, once, with the requester's words
    (`/cross-review-peer`);
  - **the lane has no maintainer, or there is no lane for it yet:** when the requester is
    your human, spawn a maintainer for that lane (Launching a maintainer into a lane,
    below), briefed with the lane and the requester's words; when it isn't, ask your human.
    A new lane is on the map before any work is launched in it: you define it, or the new
    maintainer does (`/cross-review-peer`, "Project lanes").

  Either way you launch nothing in that lane yourself, unless your human asks you to take
  that lane on: then claim or define it first (`/cross-review-peer`, "Taking one"). Tell the
  requester plainly who has the work now: the maintainer's instance name, its lane, and how
  to reach it. When no project lane covers the work, the release lane's maintainer may keep
  its human's new work in its own lane instead.

## 2. Find the expert
- **The domain:** from your knowledge and the expert map your soul or workspace keeps
  (which expert soul owns which area); with no map, ask your human. For work across
  domains, pick the domain where most of the risk or the design sits: its expert leads,
  and brings in the others.
- **The live instances:** who is running now and on what (your state file, your OATS
  status, your messaging roster).

## 3. Delegate or spawn
| The work | Do |
|---|---|
| Continues what a live expert is doing, or that expert's context (its decisions, open PRs, the code it has loaded) clearly helps | **Delegate it to that expert** by message, with the brief below: it leads this as an effort of its own, launched by you. It confirms it takes it, and tells its own coordinator, if it has one. If it can't take it, spawn a new lead. A delegated lead is not your child. |
| Anything else | **Spawn a new instance of the domain's expert as your child:** `oats spawn <expert> --parent "$OATS_INSTANCE" --purpose <slug> --task-file <brief.md>` |

- **One lead per effort,** never one per domain: the lead brings in the other experts as
  its children if it needs them. Several independent efforts get one lead each.
- **Never a developer directly:** specs and builds are the lead's job.
- **Your child, and what that means:** stopping or retiring you stops your leads, and
  theirs, first, and a retire moves them to your own parent. The inject says what follows,
  and `/cross-review-peer` ("A lane changes hands") how a successor takes them over.
- Don't pile unrelated work onto a busy expert, to save a spawn.

## 4. Brief the lead
The brief holds:
1. **That it leads this effort,** launched by you, so it sends you no start notice. You are
   its parent as the lane's maintainer, not its coordinator: it plans and coordinates the
   effort itself.
2. **The goal** and why, in a few sentences, and what "done" means to the requester.
3. **Who asked,** and that the lead reports on the work to them.
4. **What your knowledge says** that bears on it: the decisions and coherence rules it
   must respect, and where it sits on the roadmap.
5. **Delivery:** its PRs come to you for review, and to no other maintainer: you ask the
   second reader, and you hand the approved PR on to the release lane where your lane's
   arrangement says so. With peer maintainers, name your lane's label for it to put on its
   PRs (`/cross-review-peer`).

Don't split the work by domain or surface for it, and don't write its spec or plan:
planning and coordination are the lead's role.

## 5. Close the loop
- Tell the requester the lead's instance name and how to reach it. A human is told in
  plain text, never through a dialog.
- Add it to your state file: the effort, its lead, who asked, and what you're waiting for.
- From then on the lead reports PRs to you like any expert (`/pr-review`). Don't ask it
  for progress: it tells you what blocks it, and it hands over its PRs.
- **When the effort is done** (its PRs merged, the requester satisfied), ask the
  requester whether to retire the lead: a human retires it or tells you to; when the
  requester is an agent, ask your human. Then close the row in your state file.
- **When the effort is cancelled,** leave nothing half-done (`/keep-it-clean`, "A cancelled
  effort"), then retire its lead the same way.

## Launching a maintainer into a lane
When your human asks for another maintainer in a lane, yours or a new one, or asks for work
in a lane that has no maintainer or no lane yet (Whose lane is it?, above), launch an
instance of your project's maintainer soul. It is a peer, not a lead: independent of you,
never your child.

```sh
oats spawn <maintainer soul> --relation unrelated --purpose <slug> --task-file <brief.md>
```

Its brief names the lane, where the lane map is, its human, the request that started it in
the requester's words, and the efforts in flight it takes over, if any. It adds itself to
the lane's line on the map (`/cross-review-peer`, "Joining as a new maintainer"), and
launches the work itself. Tell your human its instance name, its lane, how to reach it, and
that they retire it with `oats retire <name>`: OATS records no link between you.
