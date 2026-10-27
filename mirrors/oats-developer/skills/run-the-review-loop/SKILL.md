---
name: run-the-review-loop
description: The developer's side of adversarial code review: spawn one code-reviewer attached to your worktree, brief it without biasing it, iterate with the same instance until it approves, then retire it. Use when a piece of work is complete and verified on your local branch, before presenting it to your expert and before any PR exists.
---

# Run the review loop

## When
Once per piece of work (a spec's worth, usually one future PR), on your local branch,
before any PR: when it's complete, consolidated into one worktree (`/worktrees`) and your
own verification passes there. Not per commit, not before the work runs.

## Spawn it once, attached to your tree
```bash
oats spawn code-reviewer --work attached --work-dir <the consolidated worktree> \
  --parent "$OATS_INSTANCE" --same-work --repo <repository> \
  --purpose <short-slug> --task-file <review-brief.md>
```
Always give both `--work-dir` and `--repo`. `<repository>` is the absolute path of the
worktree's clone: `repo` in your `instance.json`, or the clone you made an extra worktree
from. The reviewer is your child, on your work (`--same-work`), shares your tree to read
the code and run the tests, and must not edit it. On a kernel whose `oats version --json`
doesn't list the `instance-same-work` feature, leave `--same-work` out.

## Pick a different model
A reviewer on your model shares your blind spots. Before spawning, compare:
- yours: your `instance.json` → `launch.runtime` (the harness) and `launch.model`;
- the reviewer's: `oats spawn code-reviewer --preview --json` → `launch.declared` (the
  soul's default) and `launch.effective` (what this machine will launch; when
  `launch.from` is `local`, the machine's `oats-local.yaml` `souls.launch` entry named by
  `launch.at` overrides the default).

When the override is another harness than yours, spawn without `--harness`/`--model` so it
applies; don't force the soul's default over it. When the effective reviewer would run on
your harness and model, spawn it on another state-of-the-art model, on another harness when
you can: currently Codex with Astra, Claude Code with Opus 5.5, Fable, or the latest Grok,
through a launch configuration this host defines (`oats launch-config list`) or
`--harness`/`--model`. If none is available, use the effective one and say so in your
handback.

## Brief it: context, not conclusions
`review-brief.md` holds exactly:
1. The goal, in two or three sentences.
2. The spec, or a link to it: "done when", contracts, edge cases, out of scope.
3. The diff range (`git diff <base>...<head>` in that worktree) and the branch.
4. How to run the relevant tests, so it can confirm a suspected bug.
5. Who to report to (you), and how (your messaging layer, if any).

Leave out your design reasoning, what you think is risky, what you already checked and how
confident you are. The reviewer can ask you for a fact. Its method is its own
`oats.code-review` capability; you don't need it.

## Iterate with the same instance
1. It reports findings with a verdict: `APPROVE`, `APPROVE WITH NITS` or `CHANGES NEEDED`.
2. Fix each finding, or dispute it with a concrete reason (a test, a contract, a spec
   line). Skip none silently.
3. Reply to the same reviewer: the new head, your change per finding, your disputes. It
   re-reviews the delta and the disputed points.
4. Repeat until `APPROVE` or `APPROVE WITH NITS` (nits are yours to take or leave).

Cap: 4 rounds. Still `CHANGES NEEDED` after round 4: stop, and take the open findings with
your position on each to your expert, who decides.

## Close
- Hand the branch to your expert only once the loop converges, never intermediate heads,
  with: the branch and its head, what was done against "done when", how it was verified,
  the final verdict, the number of rounds, each disputed finding and its resolution, and
  anything deliberately left out.
- Keep the reviewer until your expert accepts. If the expert returns the branch, fix it,
  send the same reviewer the delta and the return's reasons, and hand back only after it
  approves: every change on the branch is reviewed before a PR exists.
- Once your expert accepts, retire the reviewer, then remove its worktree if it is an
  extra one (`/worktrees`).
- Fixes requested on the PR come back as a delta: take them through a reviewer (the same
  one, or a new one if it was retired) and report when it converges, before your expert
  hands over the new head.
