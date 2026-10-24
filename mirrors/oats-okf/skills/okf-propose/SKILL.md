---
name: okf-propose
description: >-
  The compulsory harvest procedure for working instances with oats.okf:
  keep instance knowledge current and, at every harvest checkpoint (a PR
  handed over for review, a finished task, and in a long-lived role such as
  a maintainer's a feature ready, a release or deploy shipped, or a direction
  decision taken with the human), judge
  durable claims, write one proposal and launch one knowledge harvester.
  Read at task start and at each checkpoint. Covers the checkpoints, the
  soul opt-out, promotion and duplicate checks, the checkpoint record,
  one-at-a-time spawning, proposal provenance, carrying a proposal over and
  hand-back. The harvester's own publication procedure is knowledge-harvest,
  not this skill.
---

# Propose knowledge at checkpoints

This duty comes from `oats.okf`, not from a task briefing. Keep STATE.md,
log.md and notes/ current throughout the work; use `okf-instance-knowledge`
for what to capture. Never write accepted knowledge yourself.

## Read your duty from the provider

At task start and before a harvest checkpoint, run `oats okf status` from
instance home. Its `result.harvest` is the state the provider wrote at spawn:

- `on`: follow the checkpoint procedure below.
- `off` (`reason: soul-opt-out`): no harvest duty; never propose or spawn a
  harvester, but still consult and keep instance knowledge current.
- `unknown` (`reason: spawn-state-missing`), or a command failure: do not
  propose. Report it; a new spawn with the current provider establishes the
  state. Never infer `on`, read the soul file to decide, or repair the policy
  by hand. A restart does not recompose an old home's provider.

This is the one provider-owned answer. A task briefing does not decide your
duty. The private `okf-harvest-policy.json` in home is written by the provider,
not a user setting or a publication authorization; the harvester still checks
the source independently.

## When to harvest

A **harvest checkpoint** is any of these moments. Each one is yours to act
on, and none waits for a task to close:

- **You hand over a PR for review:** you open it, or mark it ready, and tell
  its reviewer or maintainer. The work it carries is done enough to know
  what it taught.
- **You finish a task,** before you hand back or retire.
- **In a long-lived role** whose task never finishes (a maintainer, an
  expert holding an area, a support desk):
  - **a feature is ready:** its last PR merged or approved;
  - **you ship a release or a deploy;**
  - **a direction decision is taken with your human.**

These are not checkpoints: a commit, a review round or a new head of the
same PR, and each decision you make while working (a direction decision taken
with your human is the checkpoint above). Capture decisions and discoveries
the moment they happen, in notes/; the next checkpoint carries them.

**One proposal per checkpoint, carrying only what no earlier proposal
carried.** A PR handed over and then the same task closing are two
checkpoints, and the second proposes only what was learned since the first.

At a checkpoint, first update STATE.md, log.md and the relevant notes. Then:

1. **Respect the soul opt-out.** `knowledge: { harvest: off }` removes the
   harvest duty, not consultation or working-memory upkeep. An opted-out
   soul never proposes or spawns a harvester. No task, note, host or spawn
   setting can turn that duty back on. The harvester's required spawn hook
   independently refuses an opted-out recorded source.
2. **Read `knowledge-theory` and apply its promotion test.** Keep only what
   changes how a future instance of this soul decides or acts and cannot be
   recovered by reading the repository. No code descriptions, task residue,
   secrets, personal data or tool noise. Nothing durable, no proposal.
3. **Consult accepted knowledge first:** `oats okf search` for the claim,
   then `cat` the relevant concept. Already accepted with nothing to add:
   no proposal. A refinement or candidate supersession cites the accepted
   concept and says what changes and why. A blocked read is not evidence
   that the claim is new: record the blocker rather than inventing knowledge.
4. **Claim only for nodes your soul owns.** Each concept is its own claim
   within the one proposal. For a lesson whose home is a node you only read,
   name the lesson and that node in one line in your hand-back for its owner;
   do not claim it in this harvest.
5. **Check your log for this checkpoint.** Do not submit the same work again
   after a restart, compaction, a review fix or a hand-over acknowledgment.
   Recover an uncertain spawn's recorded result before any further action;
   a missing reply is not permission to spawn a duplicate.
6. **Record the checkpoint in log.md, whatever its outcome:** what the
   checkpoint was (`PR #123 handed over`, `v2.4.0 shipped`), and either the
   proposal and its harvester, or `nothing to propose` with the reason in a
   few words. A checkpoint with no line in log.md is a harvest skipped.

## Write one self-contained proposal

Write `proposals/<YYYY-MM-DD>-<slug>.md` in your instance home, not the work
repository. Use this form:

```markdown
# OKF proposal: <one-line claim>

Source: instance <your instance name>, home <your instance home>, soul <your soul's name>

## What
<Claim, one concept each; name its owned node.>

## Why
<Why it outlives this task; what a future instance would do differently.>

## Evidence
<What was observed and when; task refs; accepted concepts confirmed,
refined or contradicted, cited with their accepted commit. State limits.>

## Backing notes
- notes/<file>.md
```

Use **exactly one** `Source:` line, filled from your instance's identity.
It is a pointer for the harvester to verify against deployment records,
never authority. The optional `## Backing notes` section lists one
`- notes/<file>.md` per note, relative to your home. Only those named notes
are read; the harvester does not browse your entire home or transcript.

No secrets, credentials or private paths outside the Source line.
Never include personal data about people outside the team (clients, correspondents,
any other third party): a name, a contact detail, or anything else that identifies
a person, including detail derived from correspondence. Keep the lesson and leave
the person out. Naming the author of a published source you cite is fine.
That covers the names you choose as well: a note's file name, a task ref and an
instance's name are published as provenance when knowledge is harvested.

## Launch the harvester

**One harvester at a time per instance.** Read log.md for your last
harvester's name, then `oats status`. While it still lists that harvester,
do not spawn another, even if it has handed over or appears idle: retired is
not the same as stopped. Keep the proposal instead (below).

**Name your harvester explicitly with `--name`.** Never leave it to the
kernel's numbered default or use `--purpose`: a retired harvester's messaging
alias can remain occupied even when no instance is listed. For each new
proposal, run this once from instance home to print a fresh name:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const { instance } = JSON.parse(readFileSync('instance.json', 'utf8'));
if (typeof instance !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(instance)) {
  throw new Error('instance.json must name the source instance as a slug');
}
const prefix = instance.slice(0, 21).replace(/-+$/, '');
console.log(`${prefix}-${randomUUID().replaceAll('-', '')}-harvester`);
JS
```

The name is `<source-prefix>-<fresh-uuid-without-dashes>-harvester`: at most
21 source characters + 1 dash + 32 UUID characters + 10 for `-harvester` =
64, within both the kernel and aweb alias limits. Removing a trailing dash
from the prefix keeps it a slug. The full random UUID distinguishes proposals,
including ones from sources with the same truncated prefix; a timestamp alone
can collide across hosts or within a minute. Use only non-sensitive source
names, since the harvester name is also its messaging alias and provenance.

Record the printed name with the proposal path in log.md **before preview**.
Check `oats status` for that exact name (and `oats souls` for a soul-name
conflict); it must be unused in the deployment. The kernel checks again at
spawn: this check is not a reservation or proof that a messaging alias is free.
Reuse this recorded name after interruption; do not regenerate it for the
same proposal or between preview and apply.

Replace `<harvester-name>` with that exact name and `<proposal>` with the
proposal path. From instance home, first append `--preview` to this complete
command and read the resolved harvester composition, then run the same
command without `--preview`:

```sh
oats spawn oats.okf/knowledge-harvester --name <harvester-name> --task-file <proposal> --relation unrelated
```

Use that relation exactly as written, without extra relation flags. The
kernel picks the harness and model; pass no harness, model, wrapper or
permission bypass. A scaffold is not a running harvester.

Record the checkpoint, proposal path and returned harvester instance name
in log.md; keep STATE.md's current picture up to date. Report a refused or
uncertain spawn, do not retry it in a loop or spawn around it.

On `E_INSTANCE_NAME_TAKEN`, stop, record the chosen name and refusal, and
report it in your hand-back. Do not drop `--name`, switch to `--purpose`,
append a counter, regenerate a UUID or launch a replacement in a retry loop.
A later explicitly resolved attempt may choose and record a new unused name;
first establish that this proposal has no harvester already started. For an
uncertain result, recover the spawn/session record before any further action.
A messaging identity-minting failure is not `E_INSTANCE_NAME_TAKEN`: report
that exact failure to your spawner/operator and stop. Never remove a stale
certificate, re-onboard an identity or rename around that failure yourself.

**While your last harvester is still listed,** keep the proposal and its
backing notes, and note it as pending in STATE.md and log.md. At your next
checkpoint, add that checkpoint's claims to the pending proposal and launch
it then, once the last harvester is gone. Never sleep, poll or busy-wait for
it. If it is still listed at hand-back, name it, the pending proposal and
its claims in your hand-back. Do not wait for it to finish.

## What happens after launch

The harvester verifies the recorded source, its owned nodes and opt-out,
then snapshots the proposal and named evidence at spawn. It judges claims
against the accepted base, drops unsuitable or duplicate claims, and opens
reviewed knowledge PRs for eligible claims. A submitted PR is not accepted
knowledge. The knowledge maintainer reviews it; the source never merges its
own knowledge. The harvester retires once it has handed over.

Keep backing notes until that harvester retires. Retirement recovery can
supply the source evidence before capture; do not dispose of that recovery
before capture. After a successful capture, the snapshot is independent of
the source home and recovery. This preserves evidence; it does not itself
control the harvester session's lifetime. The proposal, source checks,
snapshot and review flow are unchanged from oats.okf 5.1.0.
