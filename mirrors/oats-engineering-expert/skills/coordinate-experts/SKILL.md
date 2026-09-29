---
name: coordinate-experts
description: Lead, or take part in, work that spans several domains. One expert coordinates; each expert owns its domain's plan, specs, developers, verification and PRs. Covers launching experts as siblings under the coordinator, integration instructions, and coordination across machines and people. Use when work touches more than your domain, or when you coordinate or are coordinated.
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
