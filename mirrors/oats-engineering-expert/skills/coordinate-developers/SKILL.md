---
name: coordinate-developers
description: Launch and drive developers to build what you specified, one per surface, several in parallel when surfaces are independent. Use when a spec is ready to build, when choosing how many developers to run, when a developer asks a question or returns work, or when work must be re-assigned.
---

# Coordinate developers

## Launch
- One developer per surface; two surfaces, two developers, in parallel if the plan allows.
  Never one developer for two unrelated surfaces.
- Spawn the developer soul that owns the surface as your child, the spec as its task:
  ```bash
  oats spawn <developer-soul> --parent <your instance> --same-work --purpose <short-slug> --task-file <spec.md>
  ```
  Add only what the spec can't hold: the branch or PR to target, and who else works next
  to it.
- `--same-work` marks the developer as working on your work. A developer you started
  before the flag existed gets it with `oats instance same-work <developer> on`. On a
  kernel whose `oats version --json` doesn't list the `instance-same-work` feature, do
  neither: leave the flag out and skip the command.
- Tell each developer which developers share an interface with it, so they talk directly.
- Record each in your instance state: instance name, surface, spec, branch.

## While they work
- Answer questions quickly. If one reveals a hole in the spec, fix the spec and tell
  everyone it affects.
- The spec fixes what and the constraints; the developer chooses how (including whether to
  parallelize).
- Watch the interfaces; when two developers disagree about a shared shape, you decide.

## Set a checkpoint before you wait
Once your turn ends you run no instructions, and a stalled child may report nothing: a
refused provider, a stuck harness or a sign-in screen can each leave it `running`, with no
claim and no new event. So before you end your turn to wait on a child, set a wake that
fires from outside your session, one per child, each time you hand it something. From your
home:
```bash
oats session inspect --home "$OATS_INSTANCE_HOME" --json   # wakeHold: see below
node -e 'const d=new Date(Date.now()+240*60000);console.log(d.getUTCMinutes(),d.getUTCHours(),d.getUTCDay())'
cat > checkpoint-<slug>.json <<EOF
{"kind":"wake","enabled":true,"cron":"<minute> <hour> * * *","tz":"UTC","home":"$OATS_INSTANCE_HOME",
 "message":"Checkpoint: <child> owes <result>. If it came, remove this job and stop; if not, follow 'Set a checkpoint before you wait' in /coordinate-developers."}
EOF
oats schedule add "$OATS_INSTANCE-<slug>" --file checkpoint-<slug>.json
oats schedule show "$OATS_INSTANCE-<slug>" --json   # nextRun must be the moment you meant
```
- **Read `wakeHold` first.** A wake's Enter answers whatever your session is showing. Set one
  only where it reads `on-claims` or `not-exposed`, which needs a kernel with the feature
  `wake-hold`. With `unknown` or no `wakeHold`, set none: hand the wait to your parent (with
  none, your maintainer) in one line (who owes what, by when), and it sets the checkpoint on
  its own home.
- **A developer hands you its wait:** set that checkpoint as your own. If you can't set one
  either, hand it up the same way.
- **The 240 is the minutes until the result is overdue:** your plan's estimate, with margin.
  Past a day, put the weekday it prints in the last cron field.
- **The cron repeats on purpose.** A minute the host slept through is never replayed, so a
  pinned date would stay silent for a year; this one comes round again.
- **When the result arrives,** remove the job: `oats schedule remove
  "$OATS_INSTANCE-<slug>"`. If that refuses because the job is running, the wake started
  your stopped session: add `--force`, which stops nothing.
- **To set a later checkpoint,** remove the job the same way and run the recipe again: `add`
  refuses an id that exists. A second one's message starts "Second checkpoint:", so the wake
  says which one this is, even after a restart.
- **No wake can fire** unless `oats schedule add` succeeds and `oats schedule host status`
  answers `active: true`, `registered: true` and no `problems`. Failing that, tell your
  parent once, in one line (with none, your maintainer): its own checkpoint on you then
  bounds this step. Installing the host's timer is the operator's.
- **`E_SCHEDULER_BUSY`** may be a tick holding the lock, and nothing changed: run the command
  once more a little later. Still busy, no wake can be set: tell your parent, as above. That
  lock is never yours to remove.

**When it fires,** the result is overdue, nothing more: a reason to look, not proof the
child failed, and no reason to interrupt one that is working. Read its row in `oats status
--json`, `oats instance events <child> --json` (`waitingClaims`) and `oats instance git
<child>` (the branch head and its time), then:
- **A result or question reached you and you missed it:** act on it.
- **A claim says what it needs:** give it.
- **A `wake-held` event:** history, not a state. Read the job it names: `oats schedule show
  <schedule> --json`. Only a `lastRun` that still carries `held` means its wake is waiting,
  and then someone outside it has to act: tell your parent (with none, your maintainer). Never clear the claim or answer the
  dialog yourself: a claim can be stale, but a live dialog takes the next Enter.
- **The result moved** (new commits on its branch, a new PR): set a later first checkpoint.
  A start, a claim or a lifecycle event is not movement.
- **`running` is false, `sessionEnd` `exited`:** it ended by itself. Start it again with
  `oats session start --home <home>`, and set a second checkpoint.
- **`running` is false, `sessionEnd` `lost`:** add `--resume` to that start, and set a
  second checkpoint.
- **`running` is false, `sessionEnd` `stopped`, or none:** it may have been stopped on
  purpose. Don't start it: ask your parent (with none, your human) whether it should run.
- **A claim says its turn failed, or nothing shows:** `running` with no claim says nothing
  either way. Ask it one precise question through your messaging layer, which also gives a
  failed turn a new start, and set a second checkpoint, half as far out.

**A second overdue checkpoint with no movement ends the wait.** Never set a third on a child
whose result hasn't moved. Check `oats retire <child> --plan` and retire it: a work tree
holding work is kept, but the child's own children are only stopped and move to you, and
their wakes would start them again, so retire each of those too, the same way. Then hand the
spec and what the branches hold to a new child, and tell your parent. Don't stop a child
instead: a stopped home's pending wake starts it again.

## When work comes back
- A developer reports when its review loop has converged. Don't act on intermediate heads.
- Verify it (`/verify-developer-work`), then accept it or return it.
- Accepted work goes into a PR you own until it merges (`/land-your-prs`).
- Once that PR is merged and green, or closed, and the developer sends its done line,
  retire it without asking anyone (`/land-your-prs`, "Retire what's finished"). A hand-back
  isn't finished: the developer may still be needed for fixes and rebases.
