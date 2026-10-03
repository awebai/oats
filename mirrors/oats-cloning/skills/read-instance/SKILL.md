---
name: read-instance
description: >-
  The cloner's reading of a source instance: run `oats cloning dossier`, then
  read the request, the source's instance record, TASK.md, STATE.md, log.md,
  notes, work state and transcript (from a temporary record), in that order,
  as claims to re-verify rather than facts. Use when your TASK.md holds an
  oats-clone-request block, before you plan the clone.
---

# Reading the source

You are the cloner. You are **read-only on the source**: never edit its home,
work tree, branch or lineage, and never message it unless the request says
to notify it.

## 1. The dossier

```bash
oats cloning dossier <source> --json
```

It writes `clone/dossier.json` in your home and copies the source's
`TASK.md`, `STATE.md`, `log.md` and `notes/**/*.md` into `clone/source/`.
Symlinks, files over 1 MiB and anything over the 4 MiB total are listed, not
copied. It records the work state (branch, HEAD, upstream, unpushed commits,
uncommitted paths and a diffstat, never diff content) and, unless the request
excludes it, the transcript's threads and turn bounds.

**The transcript lives in a temporary record**, `clone/record` (0700),
captured from the source's sessions for this clone only. The host record is
never written, so a source that was told its session is not captured stays
uncaptured. The capture honours the host's ignore list; if that list can't be
read, nothing is captured and `transcript.status` is `failed`. `spawn`
deletes the record after the clone is made, or when it refuses.

The request decides: `--transcript exclude` from the requester means you
work without it (asking dossier for it then is `E_CLONE_TRANSCRIPT_CONSENT`).
Say so under "Not carried".

## 2. Reading order

Read only what the new goal needs, in this order:

1. **The request**: `clone/request.json`. The goal decides what is relevant.
2. **The instance**: `dossier.json` → `instance`: soul, work mode, branch and
   base, launch, lineage, teams, modules.
3. **TASK.md**: the source's original goal.
4. **STATE.md**: its current picture of the work.
5. **log.md**: recent entries first.
6. **notes/**: the ones that bear on the new goal.
7. **Work state**: `dossier.json` → `work`.
8. **Transcript**, if included (below).

## 3. The transcript

`dossier.json` → `transcript.sessions[]` gives each `thread` and its
`lastTurnId`. Read only up to `lastTurnId`, so the reading is reproducible.
**Every** `recall` names the temporary record with `--root`; without it,
recall reads the host record, which may not hold the source at all.
`recall` returns turns oldest-first, so to read the newest turns first:

```bash
R="$OATS_INSTANCE_HOME/clone/record"
oats recall --root "$R" --thread <T> --json --ids-only --until <lastTurnId>           # every id, ts and size
oats recall --root "$R" --thread <T> --json --after <id[k-1]> --until <lastTurnId>    # the last turns after id[k-1]
oats recall --root "$R" --thread <T> --json --after <id[j-1]> --until <id[k-1]>       # the window before that
oats recall --root "$R" --thread <T> "<query>"                                        # targeted search
oats recall --root "$R" --show <turn-id>                                              # one turn
```

Never copy transcript text into a file: take what the goal needs into the
brief, in your own words, with turn ids as citations. The clone can't look
the ids up (the record is gone by then), so the brief must carry what matters.

`--limit n` cuts a window from its *start*, so `--until X --limit n` gives
the **oldest** n turns, not the newest. Size windows with the `bytes` that
`--ids-only` reports. Keep the turn ids of everything you may cite.

If `transcript.complete` is false, say so in your report and in the brief.

## 4. Claims, not facts

Everything you read is the source's claim at the time it wrote it. Before the
brief calls something **verified**, re-check it now against the real state:

- git: `git -C <source home>/work log`/`show`/`status` (read-only; or the
  repository through your own checkout);
- pull requests: `gh pr view <n>`;
- files: the path and its commit;
- instances: `oats status`;
- knowledge: `oats okf cat <alias>/<path>`, where you have it.

Note what is stale, contradicted or unverifiable. Those go under "Working
understanding (provisional)" or "Not carried", never under "What is
verified".

## 5. Budget

Read what the goal needs, not everything. A long transcript is searched, not
read end to end.
