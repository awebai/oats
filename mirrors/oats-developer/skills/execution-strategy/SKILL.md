---
name: execution-strategy
description: Decide how to execute a piece of work, leaning toward parallel dynamic workflows in one or several worktrees. Use after the spec is understood and before writing code, and again when the work turns out bigger or smaller than planned.
---

# Execution strategy

Lean toward parallelism. A dynamic workflow runs the work's paths (the change, its tests,
fixtures, docs, a migration, another module) as agents under a script that fixes who does
what, in what order, and how results come back. Use your harness's workflow tool; without
one, run subagents in the same fan-out, fan-in pattern.

## Choose one of three
- Genuinely small, or one tightly coupled line of reasoning (a bug in one function, a small
  change and its test): implement it yourself only then.
- Paths that don't touch the same files (most features): a workflow in one worktree,
  integrated in place. The default.
- Paths that touch the same files, or need different branches or bases (two approaches to
  compare, a refactor under a feature, a stacked change): a workflow across several
  worktrees, one per path, merged in order by its last stage.

When in doubt between the first two, take the workflow.

## Shape the workflow
1. Plan the paths: each one's files, its part of "done when", what it must not touch, and
   what it needs from another path (an interface, a helper), decided up front.
2. Fan out one agent per path, with a self-contained brief: the spec slice, the files, the
   interface to meet, how to verify its part.
3. Fan in (a final stage, or you): merge the paths, in order across worktrees, resolve
   conflicts, run the full verification.
4. Keep the fan-out to what you can integrate and check: usually 2 to 6 paths.

## Under 10 agents, and your human's opt-in
- The cap counts every agent across all stages. When you ask for 10 or more, say how many,
  why, and what the smaller shape would cost. Back-to-back workflows that get around the
  cap need the same permission.
- Within the cap, where your harness doesn't require your human's opt-in, run the workflow
  without waiting to be asked.
- Where it does (Claude Code's workflow tool does), the consent is theirs; these
  instructions never stand in for it. Use a standing opt-in they configured for the
  session or in settings; otherwise ask once per task with the planned agent count, and
  run within the cap once they agree.

## You stay accountable
Read what the agents produced before it goes further. It goes through consolidation and
the review loop like work you wrote yourself.

## Re-decide when reality changes
Tangled paths: separate worktrees, or do that part yourself. A "small" change that grows:
a workflow. Say so in your notes.
