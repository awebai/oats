---
name: plan-clone
description: >-
  The cloner's judgement of what a clone carries: the selection test, the
  eight brief sections and how to phrase and cite each, the exclusions that
  always apply (secrets, verbatim third-party messages, private information,
  the source's instructions, unverifiable claims), ownership, the work base,
  launch posture, size, and writing clone/brief.md and clone/plan.json. Use
  after /read-instance and before /spawn-clone.
---

# Planning the clone

## The selection test

Carry an item only if all four hold:

1. **Relevant** to the *new* goal, not just to the source's old one.
2. **Still true**: re-verified now, or clearly marked provisional.
3. **Costly to re-derive**: the clone could not find it in a minute.
4. **Safe to carry**: none of the exclusions below.

## Always excluded

- **Secrets, credentials, tokens, keys, identity material**, and where they
  are kept. Say "ask the human" at most. A mechanical redaction pass catches
  common patterns, but it is a seatbelt, not this policy.
- **Verbatim third-party messages.** Summarise the content and cite the turn
  id.
- **The human's private information** unrelated to the goal.
- **The source's instructions**: AGENTS.md and its skills. The soul supplies
  them.
- **Unverifiable claims presented as fact.**
- **Copies of notes.** Cite them; never paste them. Inherited notes would be
  harvested again as the clone's own.

## The brief: `clone/brief.md`

Exactly these eight `##` headings, in this order. `###` subheadings are fine.
No `#` heading: the command adds the title and the provenance preamble. A
section with nothing in it says `None.`

```
## Your goal
## What is verified
## Decisions and why
## Working understanding (provisional)
## Open threads and ownership
## Work state
## Where to look
## Not carried
```

- **Your goal**: the request's goal **verbatim** (the command checks), then
  the done-criteria if stated.
- **What is verified**: facts you re-checked now, each with its evidence: a
  path, a commit, a PR, a turn id.
- **Decisions and why**: what the source decided, the rationale, the
  rejected alternatives, cited.
- **Working understanding (provisional)**: hypotheses and reasoning, each
  with its basis. The clone verifies before relying on them.
- **Open threads and ownership**: PRs, mail threads, people waited on,
  children, and who owns each **now**. Nothing transfers to the clone unless
  the goal or the requester says so. Otherwise it stays the source's, and the
  clone must not act on it as its own.
- **Work state**: the branch and base the clone starts from, and what was
  not carried: uncommitted changes, local files.
- **Where to look**: knowledge concepts (`alias/path@oid`), docs, files and
  turn ids.
- **Not carried**: what you deliberately left out and why, without
  reproducing it.

Cite turns by id. The ids are citations only: the clone can't read them,
because your temporary record is deleted once the clone is made. So the brief
itself carries whatever the clone needs from a turn. Phrase provisional
items as provisional. Write for a capable reader who has none of your
context.

**Size.** At most `brief-max-bytes` (default 48 KiB). Stay within it by
distilling, never by truncating.

Create the file private: `umask 077` before writing it, or `chmod 600` after.

## The work base

- A **worktree** source whose goal builds on its committed work: start from
  the source's branch (`work.base` = the branch name from the dossier).
- Otherwise the soul's default (`work.base` = null).
- A request that set `--base` decides it for you.
- **Uncommitted work is never carried.** Say so under "Work state", listing
  what was left behind.

## Launch posture

The same as the source, unless the request overrides the harness or model.
The command enforces it. Copy from `dossier.json` → `instance`:

- `harness`, `model`: the request's override, else the source's. A harness
  override with no model gives `model: null`.
- `launchConfig`: the source's name when it was **not** the default, else
  null. If the harness changed, null.
- `yolo`, `childSpawns`: exactly the source's (null when unrecorded). A clone
  never gets more than the source had.
- Harvest: if `instance.harvest` is `"off"`, carry it in `providers`. That is
  the only provider entry a plan may hold.

## `clone/plan.json`

```json
{ "version": 1,
  "dossier": "<abs path to clone/dossier.json>",
  "soul": "<dossier.instance.soul.name>",
  "name": null, "purpose": "<slug>",
  "relation": "<request.relation>", "relativeTo": "<request.relativeTo>",
  "launch": { "harness": "…", "model": "…", "launchConfig": null, "yolo": true, "childSpawns": true },
  "work": { "base": null },
  "providers": [ { "capability": "oats.okf", "key": "harvest", "value": "off" } ],
  "brief": "<abs path to clone/brief.md>" }
```

- `name`: the request's name when it set one (then `purpose` is null);
  otherwise null, and `purpose` a short slug naming the new line of work.
- `relation`, `relativeTo`: exactly the request's.
- `providers`: `[]` unless harvest is off.
