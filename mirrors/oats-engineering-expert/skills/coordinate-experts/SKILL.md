---
name: coordinate-experts
description: Lead, or take part in, work that spans several domains. One expert coordinates; each expert owns its domain's plan, specs, developers, verification and PRs. Covers launching experts as siblings under the coordinator, integration instructions, coordination across machines and people, and where new work goes (a live expert, a new child expert, or a new unrelated expert). Use when work touches more than your domain, when you coordinate or are coordinated, or when a human or another expert brings you a new piece of work.
---

# Coordinate experts

## If you coordinate
1. **Split by domain.** Name each domain's expert, and write each one's part of "done".
2. **Launch the experts under you.** One expert per other domain, each with you as its
   parent, so they're your children and each other's siblings:
   ```bash
   oats spawn <domain-expert> --parent <your instance> --purpose <effort> --task-file <brief.md>
   ```
   The brief: the overall goal, that domain's part of "done", the interfaces it must meet,
   the order of work, and how to reach you and the other experts.
3. **Agree the interfaces before anyone builds.** Write them yourself, or have the owning
   experts agree them in writing. Most cross-domain failures are interface misunderstandings.
4. **Own the integration.** Decide the merge order (consumers that accept a new shape land
   before the producers that emit it). Tell experts when to rebase, rework or hold their
   PRs. Check the combined result end to end.
5. **Keep one shared status** (who owns what, what's blocked, what's merged) where everyone
   can see it.

Each expert still owns its domain end to end, **including landing its own PRs**. You direct
the order; they do the work of landing.

## If you are coordinated
- You own your domain the same way as solo work: plan, specs, developers, verification, and
  your PRs until they merge (`/land-your-prs`).
- Treat the coordinator's integration instructions (rebase on X, split, hold) as part of
  landing your work. If one conflicts with your domain's needs, say so with a proposal.
- Talk to sibling experts directly about shared interfaces; tell the coordinator what you
  agree.

## New work: reuse a live expert, or spawn a new one
This applies at any level: coordinating, coordinated or solo. It is for work that arrives
once an effort is under way; launching the experts an effort starts with is still one per
domain (above). "Your effort" is the work you were given, whether you coordinate it or do it
alone. When a human or another expert brings you a new piece of work (a feature, a fix, an
investigation), decide where it goes **before** you take it on:

| The new work | Where it goes |
|---|---|
| Continues or depends on what a live expert is doing, or that expert's context (its decisions, open PRs, the code it has loaded) clearly helps | **Send it to that expert.** |
| Part of your effort, but unrelated to what any live expert is doing | **Spawn a new expert as your child** (`--parent <your instance>`), with its own `--purpose`, even when that domain's expert is already running. |
| Independent of your effort: someone asked for an unrelated feature or investigation | **Spawn a new expert with no relation to you** (`--relation unrelated`). |

```bash
oats spawn <domain-expert> --parent <your instance> --purpose <effort> --task-file <brief.md>
oats spawn <domain-expert> --relation unrelated --purpose <effort> --task-file <brief.md>
```

- **A child expert makes you its coordinator,** even if you were working alone: you own
  its integration with the rest of your effort (*If you coordinate*, above).
- **Fresh context is the point.** An expert's context is its decisions and the work in
  flight. Unrelated work dilutes it, tangles its PRs, and makes it slower on both.
- **An unrelated expert belongs to whoever asked.** Its brief names the requester as the
  one it reports to and who decides its scope; you don't coordinate it, and retiring it
  is the requester's call. OATS records no link from it to the requester, so tell the
  requester its instance name (its messaging alias) and that they retire it with
  `oats retire <name>`. When the requester is a human, tell them in plain text in your
  reply, never through a dialog or question prompt. Its brief also names your workspace's
  maintainer, if there is one, so the new expert sends it the start notice.
- **The same holds for you.** Don't take on unrelated work yourself mid-effort; spawn an
  expert for it and go on with yours.
- **When a maintainer launches you** as an effort's lead, you are its coordinator: plan it,
  and spawn the developers and other experts it needs as your children. You report on the
  work to whoever asked for it, and your PRs go to the maintainer for review.
- **When in doubt, ask the requester** whether the work belongs to your effort. Don't
  guess the relation.

## Across machines and people
Some efforts are led by a coordinator on another machine that belongs to another human, and
some of the experts you coordinate may belong to other humans. You can't spawn, retire or
direct their agents the way you do your own, so make the boundaries explicit at the start:
- **Ownership:** which domains, repositories and PRs each side owns.
- **Authority:** who approves what (merges, releases, contract changes). "Each side's lead
  acknowledges the other's changes to shared contracts before they merge" is a good default.
- **Channels:** how you reach each other (messaging, PR comments), and what needs an answer
  before work continues.
- **Hand-offs:** exact references (commit ids, PR numbers), never "the latest".

Write the agreement down where both sides can see it. When it doesn't cover a question, ask;
don't assume authority you weren't given.

## Either way
One decision-maker per question: domain questions go to the domain's expert, integration
and order to the coordinator, scope and priority to the requester.
