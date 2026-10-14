# Evidence for awebai/oats#993: a spawn's checks read the environment its pane will have

This directory is the hand-over of #993's development for a successor on another host. It holds no
product code: the change is on its own branch (below). Host-specific values are placeholders:
`<work>` is a work tree of the #993 branch, `<node22-bin>` the directory of a Node 22 binary.
State on 2026-10-14: the work was stopped at a clean point by the maintainers' pause (no PR, no new
build, no new review round).

## The refs

| What | Ref | Head | Base |
|---|---|---|---|
| The change, rebased once after the approval | `agents/oats-kernel-developer-pane-environment-checks` | `602baa049df7f5cf4d7246ece1abe7cb0f207ad1` (two commits: `fbfb3883` the change, `602baa04` the review-round-1 delta) | `c6abdfb0376a5084dc749ad6c44acbcd8d653537` |
| The head the reviewer approved | `agents/oats-kernel-developer-pane-environment-checks-approved` | `ace34a687cb0d38063ad0fb64f998f52b746d4bc` (`d78f9b47` + `ace34a68`) | `7f3811f6f8aafd79e04031dd838968881cb14d49` |

`git range-diff 7f3811f6..ace34a68 c6abdfb0..602baa04`: the first commit differs only in the
context of the import lines of `lib/core.mjs` (the one rebase conflict: main's #1058 added
`launchConfigUnknownFix`, `launchPreferenceUnmatchedProblem` and `lib/shell-word.mjs`; resolved by
keeping main's two import lines and the change's `harness-trust.mjs` import); the second is `=`.
No PR exists. The expert opens it after accepting the branch.

## Review

One code-reviewer, on another harness and model than the developer's, attached to the work tree.
**Two rounds; final verdict APPROVE, on `ace34a68`.**

Round 1 was CHANGES NEEDED with three findings, all fixed, none disputed:
1. [blocker] A tmux that is there but cannot say whether the server runs (`list-sessions` refused,
   or cut off) made `oats harness trust` write the calling process's file. Now that failed read
   refuses with `E_RUNTIME_ENDPOINT_UNKNOWN`, plan and apply, before any write;
   read-only commands keep answering from this process and say so.
2. [major] A launch configuration that sets `HOME` and no selector was no trust target. Now
   `trustTargets` adds the default file under that `HOME` when the launch has no selector at all;
   an unset reference, a relative or empty `HOME` or a missing directory is a named problem
   (`E_CONFIG_BROKEN`).
3. [major] The package probe could run another program than the lookup selected (a relative entry
   in the pane's `PATH` resolved in the caller's directory). Now the probe runs the executable the
   lookup resolved, and gets the pane's `PATH` with relative and empty entries resolved against the
   pane's working directory (`panePathFrom`).

During round 1 the shared tree was at another base for 30 seconds (02:46:07Z–02:46:37Z on
2026-10-13, at `601cbe81`/`dd424f88`). The reviewer's answer: its first reads of
`docs/desktop-cli-api.md` and `docs/implementation.md` reflected the other base; it re-read both as
`git diff 7f3811f6 d78f9b47`; no conclusion of the review rests on the other versions.

## What is left (none of it started)

1. **The reviewer's word on the range-diff above.** The reviewer approved `ace34a68`, not
   `602baa04`. A reviewer has to read the range-diff and say whether the approval carries over.
2. **The call on M10** (reader table below): no test fails when the probe ignores the executable
   the lookup selected. The expert decides: a test that separates "the probe runs the selected
   executable" from "the probe gets the pane-resolved `PATH`", or drop one of the two.
3. **The rebase.** Main has moved past `c6abdfb0`. Rebase once onto the tip of that moment, get the
   reviewer's word on that range-diff, redo the reader table and the runs at that head, push, hand
   back. Never force-push the approved branch.

Then the hand-back to the expert (contents listed under "For the hand-back").

## Reader table

`tools/mutate.cjs` puts each reader of the pane's environment back on the spawning process (or
undoes a round-1 fix), one at a time, runs the named test files in the sandbox, and restores the
file. Result at `602baa04`: [`reader-table-602baa04.txt`](reader-table-602baa04.txt).
**14 of 15 fail a test.** Where a second file shows "NO TEST FAILS" (M5 `pane-path`, M9
`harness-trust-launch`), `pane-environment` fails for that reader.

**M10 fails no test.** Finding 3 was fixed by two changes: the probe runs the selected executable,
and it gets the pane's `PATH` resolved against the pane's directory. The second alone already makes
the probe find the same program in the regression test, so that test cannot tell the first one
from its absence. Open call, item 2 above.

The patterns in `mutate.cjs` match `602baa04` exactly once each (checked 2026-10-14). After a
rebase or an edit, check them again before trusting a "NO TEST FAILS": `rep.cjs` throws when a
pattern matches zero or several times, and the line then says `ERROR`.

## Paragraph for an issue: a start that creates its session has no second check

A spawn judges its package gate and its folder trust twice, on the pane it expects and again on the
session it gets. `startInstanceSession` judges once, in `planLaunch`, before it stops or creates
anything. A start that reuses its recorded pane reads that pane, so the one case left is a start
that has to create its session (and the server, when none runs) and loses that creation to another
creator with another account: its gate passed on the environment the server would have been
created with, and its codex command trusts the home by a file the pane does not read. `PATH` is
looked up again there (`lookAgain`); the two checks would sit beside it, after
`ensureOatsTmuxSession`, with the gate's probe run again only when `PATH`, `HOME` or the selector
differ, and the command rendered again when codex's trust of the home changes. That code is the
lifecycle queue's.

## For the hand-back

- **Attention list, first:** the decided terms say that the `harness-trust` readiness item is
  `unknown` whenever the pane's environment is not established or cannot be read, and that a failed
  read makes the folder-trust check warn; they name no exception, and this change makes one: a
  codex launch under `yolo` keeps `pass` and stays quiet in both cases, because its trust of its
  home rests on no file (on main it passes whatever the file says), so "the file is not known" says
  nothing about it. Pinned in `test/harness-trust-launch.test.mjs`.
- **Attention list, one line:** in round 1 the trust writer was first made to refuse with no tmux on
  the command's `PATH` too; the expert put it back and the maintainer confirmed: no tmux is "nothing
  to ask with", which the code established and says in `warnings` (pinned beside the refusal test);
  a failed read is "asked and got no answer", and refuses.
- **Data files changed:** 18 goldens, `test/golden/claude-*/spawn-envelope.json`, one sentence each
  (the folder-trust warning of a `--no-launch` claude spawn now says whose file it read).
- **Behaviour the change made reachable in an existing test:** `test/harness-trust-cli.test.mjs`
  ran `oats harness trust` with no private `TMUX_TMPDIR`; the command now reads the OATS tmux server,
  so on a host with a live server it would have written that server's account's file. Its fixture
  now gets a private `TMUX_TMPDIR`, and resolves the CLI from the test file, not the working
  directory. Four files still pass the worker's environment on and have no private `TMUX_TMPDIR`:
  `test/cli-max-age.test.mjs`, `test/inspect-readiness.test.mjs`,
  `test/launch-config-cli-remote.test.mjs`, `test/launch-recipe.test.mjs`. Measured with a logging
  `tmux` first on `PATH`: none of them makes one of the new reads on a real server today
  (`launch-recipe` puts its own stand-in `tmux` first; `cli-max-age`'s calls come from
  `spawn --preview` and `status`, which read the server before this change too).
- **Limits, named in the docs:** a spawn's gate runs before the spawn hooks, so it does not know a
  selector a capability's hook sets (awebai/oats#1041); `oats spawn --json` answers the gate's codes
  as `E_SPAWN_FAILED` (awebai/oats#1047).
- **Readers of the changed sentences:** none parses one (`packages/desktop`, `packages/client`,
  `packages/tui`, `packages/pi`, `capabilities/`, `oats-package/`, `skills/`, `mirrors/`).
  `packages/desktop/test/readiness-launch-052.test.mjs` matches "folder trust is not established in"
  on its own fixture's text, which still begins that way.
- The runs, each with the binary named (below).

## Runs at `602baa04`

30 files, each on two binaries, 60 runs, all pass: the host's `node` (v26.8.2) and Node 22.23.3
(CI's major) by its absolute path with its directory first on `PATH`. No `oats: warning:` line in
any output (main's #1070 guard fails a root run on an unasserted one). `npm run validate` and
`npm run check` pass. The file list is in `tools/run-core-files.sh`. Not run: the root suite, the
Desktop's, the TUI's; CI is the gate.

## How to run the tools

```sh
WORK=<work> tools/t.sh pane-environment                                  # one file, host node
WORK=<work> PATH="<node22-bin>:$PATH" NODE=<node22-bin>/node tools/t.sh pane-environment
WORK=<work> NODE22_BIN=<node22-bin> tools/run-core-files.sh > runs.txt   # the 30 files x 2
WORK=<work> node tools/mutate.cjs        # the reader table (edits and restores files in <work>)
WORK=<work> node tools/mutate.cjs 10     # one entry
```

- `t.sh` runs one file in a sandbox: bubblewrap over the host's file system, a tmpfs over `/tmp`,
  its own process ids and `/proc`, dying with its parent, working directory in that tmpfs, `TMPDIR`
  unset, then `setsid -w`, then `node --test` with the file's absolute path. Several kernel tests
  start tmux servers and kill process groups: **on a host where a live OATS tmux server listens
  under `/tmp`, never run them outside such a sandbox, and never without `setsid -w`.** One file
  per invocation, never a batch.
- `mutate.cjs` edits the work tree: never run it while a reviewer reads a tree attached to it, and
  never edit the tree while any run is going (a mid-run edit once produced a spurious failure in
  `hook-events-forward-tolerant`).
- Facts the fixtures depend on: `oats readiness` needs `git` on `PATH` (without it:
  `E_REMOTE_UNREADABLE … (network)`); a launch's pane `PATH` starts with `<home>/.oats/bin`, which
  holds only the `oats` shim.
