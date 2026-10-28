---
name: run-the-review-loop
description: The developer's side of adversarial code review: spawn one code-reviewer attached to your worktree, brief it without biasing it, iterate with the same instance until it approves, then retire it; finish once your PR is merged or closed so your expert retires you. Use when a piece of work is complete and verified on your local branch, before presenting it to your expert and before any PR exists, and when your expert says your PR is merged and green, or closed.
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
- Once your expert accepts, retire the reviewer without asking anyone: tell it the loop is
  closed, and once it replies "done, harvested: <harvester>" or "done, no harvest duty"
  (after "done, harvest pending: <proposal>", wait for the first), check
  `oats retire <name> --plan`, run `oats retire <name>`, note it (name, why), and remove
  its worktree if it is an extra one (`/worktrees`). Retire only your own children, and
  never give a new reviewer a retired one's name. None of this involves a human.
- Fixes requested on the PR come back as a delta: take them through a reviewer (the same
  one, or a new one if it was retired) and report when it converges, before your expert
  hands over the new head.

## Finish
An instance is **finished** when all of these hold:
- its work has landed: its PRs are merged (or deployed, where the effort deploys) with CI
  green on the merged commit, or closed, or the work was explicitly dropped. Handed back
  is not landed: it may still be needed for fixes and rebases;
- nothing waits on it: no open PR, review, question or hand-back of its own, and its own
  children are retired;
- with a harvest duty (oats.okf; `oats okf status` says `harvest: on`), its final harvest
  checkpoint ("you finish a task") is recorded in its log.md with the harvester's name, and
  the harvester is launched. The harvester snapshots its evidence at spawn and the retire
  keeps a recovery copy, so nobody waits for the harvester to finish.

Once you learn your PR is merged and green, or closed, or that the work was dropped (your
expert tells you, or you see it on the forge), finish unprompted:
1. Retire any reviewer you still run, as above: children are retired before their parent.
2. Leave nothing uncommitted or unpushed, and remove your extra worktrees (`/worktrees`):
   your expert checks `oats instance git` before it retires you, since a retire would keep
   such a work tree, not deliver it. When your work isn't a Git work tree (directory or
   workspace mode), it checks each repository your done report names instead.
3. With a harvest duty, run your final checkpoint and launch the harvester.
4. Send your done line: "done, harvested: <harvester>" or "done, no harvest duty". After
   "done, harvest pending: <proposal>" you are not finished: send "done, harvested:
   <harvester>" once the proposal goes through. When your work isn't a Git work tree, name
   each repository you used under it, with its branch. Your expert, your parent, then
   retires you with `oats retire <name>`, without asking anyone.
