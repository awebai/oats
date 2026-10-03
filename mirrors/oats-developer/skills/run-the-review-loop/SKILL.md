---
name: run-the-review-loop
description: The developer's side of adversarial code review. Spawn one code-reviewer per piece of work attached to your worktree, brief it without biasing it, iterate with the same instance until it approves, then retire it. Use when a piece of work is complete and verified on your local branch, before presenting it to your expert and before any PR exists.
---

# Run the review loop

## When
Once per **piece of work** (a spec's worth, usually one future PR), when it's complete and
your own verification passes. Not per commit. Not before the work runs.

**On the local branch, before any PR.** The review loop is pre-PR: it runs on your
worktree's branch, and no PR is opened for the work until the reviewer has approved AND your
expert has accepted the reviewed branch. Never open a PR to get the review.

**Consolidate first.** If the work ran across several worktrees, merge every path into ONE
worktree (the one whose branch will later become the PR) and verify there before spawning the
reviewer (`/worktrees`). The reviewer reviews one tree, and the whole piece of
work is in it.

## Spawn it once, attached to your tree
```bash
oats spawn code-reviewer --work attached --work-dir <the consolidated worktree> \
  --purpose <short-slug> --task-file <review-brief.md>
```
Attached mode shares your worktree (so it can read the code and run the tests) and makes
it your child. It must not edit the tree.

## Pick a different model
A reviewer on the same model as you tends to share your blind spots. Before spawning:
1. **Your model:** your own launch record (`instance.json` → `launch.runtime` (the harness) and `launch.model`).
2. **What the reviewer will actually run on:** `oats spawn code-reviewer --preview --json`
   → `launch`. Read both parts:
   - `launch.declared`: the soul's default (the package's preference);
   - `launch.effective`: what this machine will launch. When `launch.from` is `local`, the
     machine's `oats-local.yaml` overrides the default (`souls.launch`; `launch.at` names
     the entry). The operator set it, often because the default's harness isn't installed
     or isn't wanted here.
3. **Prefer the machine's override when it's another harness than yours.** Spawn without
   `--harness`/`--model`, so the override applies; don't force the soul's default over it.
4. **If the effective reviewer would run on your harness and model** (the override or the
   default), spawn it on another state-of-the-art model, on another harness when you can:
   currently **Codex with Astra, Claude Code with Opus 5.5, Fable, or the latest Grok**. Use
   a launch configuration this host defines (`oats launch-config list`), or
   `--harness`/`--model`. If none is available, use the effective one and say so in your
   handback.

## Brief it: context, not conclusions
The brief (`review-brief.md`) contains **exactly**:
1. **The goal** in two or three sentences: what the change is for.
2. **The spec** (or a link to it): the "done when", contracts, edge cases and out of scope.
3. **The diff range:** `git diff <base>...<head>` in that worktree, and the branch.
4. **How to run the relevant tests**, so it can confirm a suspected bug.
5. **Who to report to** (you) and how (your messaging layer, if there is one).

It must NOT contain: your design reasoning, what you think is risky, what you already
checked, or how confident you are. That is the bias the review exists to avoid. If the
reviewer needs a fact, it can ask you.

The reviewer's method (what it checks, how it reports) is its own `oats.code-review`
capability; you don't need it to run the loop.

## Iterate with the same instance
1. It reports findings with a verdict: `APPROVE`, `APPROVE WITH NITS` or `CHANGES NEEDED`.
2. For each finding: **fix it**, or **dispute it** with a concrete reason (a test, a
   contract, a spec line). Don't silently skip one.
3. Reply to the SAME reviewer: the new head, what you changed per finding, and your
   disputes. It re-reviews the delta and re-checks the disputed points.
4. Repeat until `APPROVE` or `APPROVE WITH NITS` (nits are yours to take or leave).

**Cap: 4 rounds.** If it still says `CHANGES NEEDED` after round 4, stop. Take the open
findings and your position on each to your expert, who decides.

## Close
- Keep the reviewer until your expert accepts the branch. If the expert returns it, fix it,
  then send the SAME reviewer the delta and the return's reasons, and hand back again only
  after it approves: every change on the branch is reviewed before a PR exists.
- Retire the reviewer once your expert accepts.
- Hand the reviewed branch to your expert. In your handback, include: the branch, the final
  verdict, the number of rounds, and any finding you disputed and how it was resolved.
- Don't open the PR: your expert reviews the branch first, then opens it (or asks you to).
