---
name: okf-propose
description: >-
  The compulsory harvest procedure for working instances with oats.okf:
  keep instance knowledge current, judge durable claims at a finished task
  or PR hand-over, write one proposal and launch one knowledge harvester.
  Read at task start and before a harvest checkpoint. Covers the soul
  opt-out, promotion and duplicate checks, memory pressure, one-at-a-time
  spawning, proposal provenance, deferral and hand-back. The harvester's
  own publication procedure is knowledge-harvest, not this skill.
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

## When a checkpoint merits a harvest

A **harvest checkpoint** is a finished task or a PR hand-over. Make **at most
one proposal for that completed unit of work**: handing over its PR and then
closing the same task are not two opportunities. Never launch per commit,
per review round, on every decision, or merely because a PR was opened.
Capture decisions and discoveries when they happen; collect them for the
next harvest checkpoint. Most checkpoints propose nothing.

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

## Launch only when the gates permit it

A harvester is another model session on a shared host. These gates are
instructions, not a scheduler or a resource reservation:

- **One harvester at a time per instance.** Read log.md for your last
  harvester's name, then `oats status`. While it still lists that harvester,
  do not spawn another, even if it has handed over or appears idle. Retired
  is not the same as stopped. Keep new claims for the next eligible proposal.
- **No spawn under memory pressure.** Immediately before spawning, run
  `free -g` on Linux: if `available` is less than **8 GB**, do not spawn.
  If the host is otherwise under memory pressure, do not spawn either. On
  a host without `free`, use its documented available-memory check; if you
  cannot establish at least 8 GB available, defer and report that limit.
  Do not stop somebody else's instances or change host setup to make room.

From your instance home, first append `--preview` to the following command
and read the resolved harvester composition. When both gates permit it,
run the command without `--preview`:

```sh
oats spawn oats.okf/knowledge-harvester --task-file <proposal> --relation unrelated
```

Use that relation exactly as written, without extra relation flags. The
kernel picks the harness and model; pass no harness, model, wrapper or
permission bypass. A scaffold is not a running harvester.

Record the checkpoint, proposal path and returned harvester instance name
in log.md; keep STATE.md's current picture up to date. Report a refused or
uncertain spawn, do not retry it in a loop or spawn around it.

If a gate blocks you, keep the proposal and its backing notes, record the
reason in STATE.md and log.md, and name the deferred proposal and claims in
your hand-back. Reconsider at a later natural task boundary, not by sleeping,
polling or busy-waiting. If the last harvester is still listed at hand-back,
name it and any claims still waiting. Do not wait for it to finish.

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
