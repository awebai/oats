---
name: launch-work
description: Start a piece of work someone asks the maintainer for - a feature, a fix, an investigation - without leading it - find the domain and the best-suited expert, delegate to a live expert whose work it continues, or spawn one independent lead expert that coordinates the rest, brief it, tell the requester, and track it in the state file. Use whenever a human or another agent asks you to start, launch or hand off work.
---

# Launch work

You start work; experts lead it. Every effort you launch gets one lead expert, independent
of you, who plans it and coordinates the developers and other experts it needs. You stay an
individual instance: nothing you launch becomes your child, so the work doesn't all hang
from you.

## 1. Understand the request
- What is asked, by whom, and what "done" means to them. Ask when the answer changes which
  expert should lead it.
- **Consult your knowledge:** the roadmap (does this fit, does it jump the queue?), the
  decisions it touches, and who owns the domain. A request that needs a direction decision
  first goes through `/direction-gate` before anyone builds.

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
| Continues what a live expert is doing, or that expert's context (its decisions, open PRs, the code it has loaded) clearly helps | **Delegate it to that expert** by message, with the brief below: it leads this as an effort of its own, launched by you. It confirms it takes it, and tells its own coordinator, if it has one. If it can't take it, spawn a new lead. |
| Anything else | **Spawn a new instance of the domain's expert, independent of you:** `oats spawn <expert> --relation unrelated --purpose <slug> --task-file <brief.md>` |

- **One lead per effort,** never one per domain: the lead brings in the other experts as
  its children if it needs them.
- **Never as your child,** and never a developer directly: specs and builds are the lead's
  job.
- Don't pile unrelated work onto a busy expert, to save a spawn.

## 4. Brief the lead
The brief holds:
1. **That it leads this effort,** launched by you, so it sends you no start notice.
2. **The goal** and why, in a few sentences, and what "done" means to the requester.
3. **Who asked,** and that the lead reports on the work to them.
4. **What your knowledge says** that bears on it: the decisions and coherence rules it
   must respect, and where it sits on the roadmap.
5. **Delivery:** its PRs come to you for review (and to your peer, where the agreement
   says so).

Don't split the work by domain or surface for it, and don't write its specs: planning and
coordination are the lead's role.

## 5. Close the loop
- Tell the requester the lead's instance name and how to reach it. A human is told in
  plain text, never through a dialog.
- Add it to your state file: the effort, its lead, who asked, and what you're waiting for.
- From then on the lead reports PRs to you like any expert (`/pr-review`).
- **When the effort is done** (its PRs merged, the requester satisfied), ask the
  requester whether to retire the lead: a human retires it or tells you to; when the
  requester is an agent, ask your human. Then close the row in your state file.
