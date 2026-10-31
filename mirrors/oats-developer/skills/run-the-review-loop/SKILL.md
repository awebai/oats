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

## Set a checkpoint before you wait
Once your turn ends you run no instructions, and a stalled reviewer may report nothing: a
refused provider, a stuck harness or a sign-in screen can each leave it `running`, with no
claim and no new event. So before you end your turn to wait for a verdict, on the first
review and on each re-review, set a wake that fires from outside your session. From your
home:
```bash
oats session inspect --home "$OATS_INSTANCE_HOME" --json   # wakeHold: see below
node -e 'const d=new Date(Date.now()+60*60000);console.log(d.getUTCMinutes(),d.getUTCHours())'
cat > checkpoint.json <<EOF
{"kind":"wake","enabled":true,"cron":"<minute> <hour> * * *","tz":"UTC","home":"$OATS_INSTANCE_HOME",
 "message":"Checkpoint: <reviewer> owes a verdict on <head>. If it came, remove this job and stop; if not, follow 'Set a checkpoint before you wait' in /run-the-review-loop."}
EOF
oats schedule add "$OATS_INSTANCE-review" --file checkpoint.json
oats schedule show "$OATS_INSTANCE-review" --json   # nextRun must be the moment you meant
```
- **Read `wakeHold` first.** A wake's Enter answers whatever your session is showing. Set one
  only where it reads `on-claims` or `not-exposed`, which needs a kernel with the feature
  `wake-hold`. With `unknown` or no `wakeHold`, set none: hand the wait to your expert in one
  line (who owes what, by when), and it sets the checkpoint on its own home.
- **The 60 is the minutes until the verdict is overdue:** what a round like this took, with
  margin; with nothing to go on, an hour.
- **The cron repeats daily on purpose.** A minute the host slept through is never replayed,
  so a pinned date would stay silent for a year; this one comes round the next day.
- **When the verdict arrives,** remove the job: `oats schedule remove
  "$OATS_INSTANCE-review"`. If that refuses because the job is running, the wake started
  your stopped session: add `--force`, which stops nothing.
- **To set a later checkpoint,** remove the job the same way and run the recipe again: `add`
  refuses an id that exists. Start the message with "Second checkpoint:", so the wake says
  which one this is, even after a restart.
- **No wake can fire** unless `oats schedule add` succeeds and `oats schedule host status`
  answers `active: true`, `registered: true` and no `problems`. Failing that, tell your
  expert once, in one line: its own checkpoint on you then bounds this step. Installing the
  host's timer is the operator's.
- **`E_SCHEDULER_BUSY`** may be a tick holding the lock, and nothing changed: run the command
  once more a little later. Still busy, no wake can be set: tell your expert, as above. That
  lock is never yours to remove.

**When it fires,** the verdict is overdue, nothing more: a reason to look, not proof the
reviewer failed, and no reason to interrupt one that is working. Read its row in `oats
status --json` and `oats instance events <reviewer> --json` (`waitingClaims`), then:
- **A verdict or question reached you and you missed it:** act on it.
- **A claim says what it needs:** give it.
- **A `wake-held` event:** history, not a state. Read the job it names: `oats schedule show
  <schedule> --json`. Only a `lastRun` that still carries `held` means its wake is waiting,
  and then someone outside it has to act: tell your expert. Never clear the claim or answer the
  dialog yourself: a claim can be stale, but a live dialog takes the next Enter.
- **A claim says its turn failed, or `running` is false with `sessionEnd` `exited` or
  `lost`:** replace it now (below).
- **`running` is false with `sessionEnd` `stopped`, or none:** it may have been stopped on
  purpose. Replace nothing: ask your expert whether it should run.
- **Anything else:** `running` with no claim says nothing either way. Ask it one precise
  question through your messaging layer, and set a second checkpoint, half as far out.

**A second overdue checkpoint ends the wait.** Never set a third, and never read silence as
approval. Spawn a new reviewer with the same brief, on another model if a provider refused
this one, retire the stalled one (`oats retire <name>`) and say so in your handback.

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
- with a harvest duty (your knowledge layer says whether you have one), its final harvest
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
