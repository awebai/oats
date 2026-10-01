---
name: execution-strategy
description: Decide how to execute a piece of work, leaning toward parallel dynamic workflows. Implement it yourself only when it's genuinely small; run a workflow in one worktree when the paths don't touch the same files, or across several worktrees when they do. Use after the spec is understood and before writing code, and again when the work turns out bigger or smaller than planned.
---

# Execution strategy

**Lean toward parallelism.** Most pieces of work split into paths (the change itself, its
tests, fixtures, docs, a migration, a second module) that can be built at the same time.
A **dynamic workflow** runs those paths as agents under a script that fixes who does what,
in what order, and how results come back. That makes coordination deterministic instead of
ad hoc. Use your harness's workflow tool; where there is none, run subagents in the same
fan-out, fan-in pattern.

## Choose one of three

| The work | Strategy | Why |
|---|---|---|
| Genuinely small, or one tightly coupled line of reasoning (a bug in one function, a small change and its test) | **Implement it yourself** | Splitting would cost more than it saves. |
| Paths that **don't touch the same files** (most features: code in one module, tests, fixtures, docs, another module) | **A dynamic workflow in ONE worktree** | Parallel agents can't collide; you integrate in place. The default for most work. |
| Paths that **touch the same files**, or need different branches or bases (two approaches to compare, a refactor under a feature, a stacked change) | **A dynamic workflow across SEVERAL worktrees** | Each path gets its own tree, so agents don't overwrite each other; the workflow's last stage merges them in order. |

When in doubt between the first two, take the workflow.

## Shape the workflow
1. **Plan:** split the spec into paths, each with its files, its part of "done when", and
   what it must not touch. Identify what one path needs from another (an interface, a
   helper) and decide it up front.
2. **Fan out:** one agent per path, each with a **self-contained brief**: the spec slice,
   the files, the interface it must meet, and how to verify its part. Agents don't share
   your context.
3. **Fan in:** a final stage (or you) integrates: merges the paths (in order, when they're
   in several worktrees), resolves conflicts, runs the full verification.
4. Keep the fan-out to what you can integrate and check: usually 2–6 paths.

## Under 10 agents, and your human's opt-in
- **Keep each workflow under 10 agents**, counting every agent it spawns across all its
  stages (fan-out, fan-in, verification). If the work genuinely needs 10 or more, **ask
  your human for permission before you run it**: say how many agents, why, and what the
  smaller shape would cost. Several workflows run back to back to get around the limit
  need the same permission.
- **Within the cap, where your harness lets you run a workflow without your human's
  explicit opt-in,** run it: don't wait to be asked, or for someone to say "workflow".
- **Where your harness requires your human's opt-in** (Claude Code's workflow tool
  does), that consent is theirs to give: these instructions never stand in for it. Use a
  standing opt-in they have configured for the session or in settings; otherwise ask
  once per task, with the planned agent count, and run within the cap once they agree.

## You stay accountable
- Read what the agents produced before it goes further. Don't pass unread code on.
- The result goes through consolidation (one worktree) and the adversarial review loop,
  the same as work you wrote yourself.

## Re-decide when reality changes
If paths turn out tangled, move them to separate worktrees or do that part yourself; if a
"small" change grows, move to a workflow. Say so in your notes.
