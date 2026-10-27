---
name: launch-work
description: Turn work someone asks the maintainer for (usually a human's high-level picture of a feature, a fix, an investigation or a project) into launched work without leading it - find the lane and your human's maintainer in it, or spawn one for your human; delegate to a live expert or spawn one lead expert per effort as your child; brief it, tell the requester, track it, and retire it when done or cancelled. Use whenever a human describes work they want, anyone asks you to start, launch or hand off work, or a maintainer must be launched into a lane.
---

# Launch work

Every effort you launch gets one lead expert. It holds the expert role: it writes the spec
and plan, works out the detail with the human where needed, and coordinates developers and
other experts under itself as it sees fit. A lead you spawn for your human's work, in a
lane where you hold its seat, is your child.

## 1. Understand the request
- What is asked, by whom, and what "done" means to them. Ask only what changes who leads
  it, or how many efforts it is. Don't gather requirements.
- **How many efforts?** Separate goals that can land on their own are separate efforts,
  each with its own lead. One goal touching several domains is one effort.
- **Consult your knowledge:** does it fit the roadmap or jump the queue, which decisions it
  touches, who owns the domain. A request that needs a direction decision goes through
  `/direction-gate` before anyone builds.
- **Whose lane is it?** Launch only work in a lane where you hold your human's seat; as the
  release lane's maintainer, also a single effort no lane covers, whoever's. Read the map
  and presence first (`/cross-review-peer`, "Who is alive", "Which lane work goes to");
  when you can't tell, ask your human. Your human's work for another lane goes to your
  human's maintainer there:
  - **running:** pass the request to it, once, with the requester's words;
  - **`active` entry but not running:** mail it anyway, and tell your human it is stopped
    so they can start it. Never spawn a second one;
  - **none, or its entry is `left`:** spawn one for your human (Launching a maintainer into
    a lane), briefed with the lane and the requester's words.

  Work no lane covers: a single effort goes to the release lane's maintainer; work that
  keeps coming gets a new lane first, opened by you or the new maintainer
  (`/cross-review-peer`, "Project lanes").

  Launch nothing in another lane yourself, unless your human asks you to take that lane on:
  then take your human's seat there first. Tell the requester the maintainer's instance
  name, its lane, and how to reach it.
- **Another human's work** goes to that human's maintainer (or, for a single effort no lane
  covers, the release lane), or back to that human: spawning a maintainer for them is their
  call.

## 2. Find the expert
- **The domain:** from your knowledge and the expert map your soul or workspace keeps; with
  no map, ask your human. Across domains, the expert of the domain holding most of the risk
  or design leads and brings in the others.
- **The live instances:** who is running and on what (your state file, OATS status, your
  messaging roster).

## 3. Delegate or spawn
| The work | Do |
|---|---|
| Continues what a live expert is doing, or that expert's context (its decisions, open PRs, the code it has loaded) clearly helps | **Delegate it to that expert** by message, with the brief below: it leads this as an effort of its own, launched by you, confirms it takes it, and tells its own coordinator, if any. If it can't, spawn a new lead. A delegated lead is not your child. |
| Anything else | **Spawn a new instance of the domain's expert as your child:** `oats spawn <expert> --parent "$OATS_INSTANCE" --purpose <slug> --task-file <brief.md>` |

- **One lead per effort,** never one per domain: it brings in other experts as its
  children if needed.
- Don't pile unrelated work onto a busy expert to save a spawn.
- **Your children:** stopping or retiring you stops your leads, and theirs, first (a
  non-recursive stop spares them); a retire refuses (`E_CHILDREN_RUNNING`) while one won't
  stop. A retire stops every lead that is your child, handed over or not, keeps their
  homes, and moves them to your own parent (top level when you have none). So you are
  retired once your efforts are done, or once a successor has taken them over and can
  restart the stopped leads (`/cross-review-peer`, "A lane changes hands").

## 4. Brief the lead
1. **It leads this effort,** launched by you, so it sends you no start notice. You are its
   parent as its maintainer in the lane, not its coordinator: it plans and coordinates.
2. **The goal** and why, in a few sentences, and what "done" means to the requester.
3. **Who asked,** and that the lead reports on the work to them.
4. **What your knowledge says** that bears on it: decisions and coherence rules to respect,
   and where it sits on the roadmap.
5. **Delivery:** its PRs come to you for review, and to no other maintainer; you ask the
   second reader and hand the approved PR to the release lane for its sign-off, as your
   lane's arrangement says. With peers, name your lane's label for its PRs, and yourself as
   the maintainer its PR descriptions name.

Don't split the work by domain or surface for it.

## 5. Close the loop
- Tell the requester the lead's instance name and how to reach it: a human in plain text,
  never through a dialog.
- Add the effort, its lead, who asked and what you wait for to your state file, and the
  effort to your map entry.
- The lead then hands over its PRs like any expert (`/pr-review`) and tells you what blocks
  it.
- **Done** (PRs merged, requester satisfied): ask the requester whether to retire the lead;
  a human retires it or tells you to; for an agent requester, ask your human. Then close
  its row in your state and its line in your entry.
- **Cancelled:** leave nothing half-done (`/keep-it-clean`, "A cancelled effort"), then
  retire the lead the same way.

## Launching a maintainer into a lane
When your human's work needs a lane where your human has no maintainer, or your human asks
for one there, launch your project's maintainer soul for your human: a peer, independent of
you, never your child. If your human already has one in that lane, say so instead: a second
one means splitting the lane (`/cross-review-peer`).

```sh
oats spawn <maintainer soul> --relation unrelated --purpose <slug> --task-file <brief.md>
```

Its brief names the lane, where the map is, its human, the starting request in the
requester's words, and any efforts in flight it takes over. It adds its map entry
(`/cross-review-peer`, "Joining as a new maintainer") and launches the work itself. Tell
your human its instance name, its lane, how to reach it, and that they retire it with
`oats retire <name>`: OATS records no link between you.
