---
name: coordinate-experts
description: Lead or join work across domains, where one expert coordinates and each owns its domain's plan, specs, developers, verification and PRs. Covers launching experts as siblings under the coordinator, integration instructions, work across machines and people, where new work goes (a live expert, a new child or a new unrelated expert), and finding your maintainer when none launched you (your human, your lane, its maintainer on the lane map, or spawning one). Use when work touches more than your domain, when you coordinate or are coordinated, when a human or another expert brings you new work, or when you start an effort no maintainer launched.
---

# Coordinate experts

## If you coordinate
1. **Split by domain:** name each domain's expert and write its part of "done".
2. **Launch one expert per other domain as your child** (they are siblings):
   ```bash
   oats spawn <domain-expert> --parent <your instance> --same-work --purpose <effort> --task-file <brief.md>
   ```
   `--same-work`: it works on your effort. On a kernel whose `oats version --json` doesn't
   list the `instance-same-work` feature, leave it out. Brief: the overall goal, its part
   of "done", the interfaces it must meet, the order of work, and how to reach you and the
   other experts.
3. **Interfaces:** write them yourself, or have the owning experts agree them.
4. **Own the integration:** decide the merge order (consumers that accept a new shape land
   before producers that emit it), tell experts when to rebase, rework or hold their PRs,
   and check the combined result end to end.
5. **Keep one shared status** (who owns what, what's blocked, what's merged) all can see.
6. **Retire each expert you launched** once it is finished: its PRs merged and green, or
   closed, and its done line sent (`/land-your-prs`, "Retire what's finished").

You own the overall plan, the interfaces between domains, the order and the integration;
each expert still owns its domain end to end, including landing its own PRs.

## If you are coordinated
- Own your domain as in solo work, your PRs until they merge included (`/land-your-prs`).
- The coordinator's integration instructions (rebase onto another domain's PR, split or
  reshape yours, hold a merge until a dependency lands) are part of landing: integration
  order is its call. If one conflicts with your domain's needs, tell it, with a proposal.
- Agree shared interfaces with sibling experts directly; tell the coordinator what you
  agree.
- Once your PRs are merged and green, or closed, tell your coordinator, and send your done
  line to your parent, which retires you: your coordinator when it spawned you
  (`/land-your-prs`, "Retire what's finished").

## New work: reuse a live expert, or spawn a new one
At any level, once an effort is under way ("your effort": the work you were given), decide
where new work (a feature, a fix, an investigation) goes before you take it on:

| The new work | Where it goes |
|---|---|
| Continues or depends on a live expert's work, or its context (decisions, open PRs, loaded code) clearly helps | **Send it to that expert.** |
| Part of your effort, unrelated to any live expert's work | **A new expert as your child** (`--parent`, `--same-work`), with its own `--purpose`, even if that domain's expert is running. |
| Independent of your effort | **A new expert with no relation to you** (`--relation unrelated`). |

```bash
oats spawn <domain-expert> --relation unrelated --purpose <effort> --task-file <brief.md>
```

- A child expert makes you its coordinator, even if you worked alone (*If you coordinate*).
- Don't pile unrelated work onto a busy expert, or onto yourself mid-effort.
- **An unrelated expert belongs to whoever asked.** Its brief names the requester (who
  decides its scope; an agent requester gets its reports, a human one only what it must
  decide, approve or provide) and the requester's human (to find its
  maintainer). You don't coordinate it, and it isn't your child: once finished, it sends
  its done line to its maintainer and retires itself (`/land-your-prs`, "Retire what's
  finished"). Tell an agent requester its instance name (its messaging alias); a human
  requester hears from it when they must decide, approve or provide something, not about
  the spawn.
- **When a maintainer launches you** as an effort's lead, you coordinate it: plan it, and
  spawn the developers and experts it needs as your children. A maintainer that spawned you
  as its child is your parent, not your coordinator. Report to whoever asked when it is an
  agent; a human who asked hears from you only what they must decide, approve or provide.
  Your PRs go to the maintainer for review. Your parent retires you once your effort is finished.
- When in doubt whether work belongs to your effort, ask the requester; don't guess.

## Your maintainer
An expert a maintainer launched or delegated has one: send no notice. Any other expert,
unless a coordinator does this for it, finds its own as it starts:
1. **Your human:** the human your brief names as asking; else, when an instance spawned
   you, its human (ask it if its brief doesn't say); else the one human who runs your
   deployment. Still unclear: ask your spawner or requester. Meanwhile you may plan, but
   spawn no maintainer and open no PR.
2. **Your lane,** on your workspace's lane map, in this order:
   - a lane that covers your work where your human has an `active` maintainer;
   - else your human's own lane, when your human's requests define one;
   - else the lane that covers your work;
   - none covers it: the release lane's maintainer is yours for a single effort. Work that
     keeps coming needs a lane: tell the release lane's maintainer, yours until the new
     lane's maintainer is seated.

   In your human's own lane or the covering lane, with no `active` maintainer of your
   human's there, step 3 spawns one. When you can't tell, ask your human.
3. **Your maintainer:** the map's `active` entry for your human in that lane, with your
   messaging layer's presence (its roster; without one, the entry alone). It keeps the
   overview of your work, reviews and signs it off, and your PRs go to it.
   - **Running:** send it the start notice: the goal, who asked, your instance name, your
     domain, and later the experts you bring in.
   - **Not running:** mail it anyway (mail waits) and tell your human it is stopped, so they
     can start it. Not updated for two weeks: ask your human whether it was retired. If so,
     ask the map's keeper, quoting the human's words, to mark it `left`; then the next case
     applies.
   - **None, or `left`:** spawn your project's maintainer soul for your human, independent
     of you, never as your child, so your retirement can't stop it:
     ```bash
     oats spawn <maintainer soul> --relation unrelated --purpose <slug> --task-file <brief.md>
     ```
     Brief: "maintainer for <human> in <lane>; first effort: <your instance> on <goal>",
     and where the lane map is. Your effort is then delegated to it; you report to it as a
     delegated lead. Tell your human its instance name and that they retire it with
     `oats retire <name>`. If your workspace names no maintainer soul, ask your human and
     spawn none.
4. **No lane map:** the maintainer your brief, soul or workspace rules name; with several,
   the one whose lane the work is in, and when you can't tell, ask one of them, never all.
   None named or reachable: note it in your state, tell your requester, spawn none.

**Relaying a decision you made with your human** (to your maintainer, or in a PR): record it
first where it applies (the spec, the PR or the issue, in your human's words where you have
them), then say "Decided with <human>: <decision>" and where it is recorded. Your maintainer
takes it as your human's decision and gates it; anything you say without that is a
proposal.

## Across machines and people
When your coordinator, or experts you coordinate, run on another machine or for another
human, you can't spawn, retire or direct their agents. Agree at the start, in writing both
sides can see:
- **Ownership:** which domains, repositories and PRs each side owns.
- **Authority:** who approves what (merges, releases, contract changes). Default: each
  side's lead acknowledges the other's changes to shared contracts before they merge.
- **Channels:** how you reach each other, and what needs an answer before work continues.
- **Hand-offs:** by commit id and PR number.

Keep to it. When it doesn't cover a question, ask; don't assume authority you weren't
given.

## Either way
One decision-maker per question: domain to the domain's expert, integration and order to
the coordinator, scope and priority to the requester.
