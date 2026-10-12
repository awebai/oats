# #994 live runs: what a Claude start paints, and when

Issue awebai/oats#994 wants three things shown by a run before anything is built
(decisions 6132990030 and 6133250945):

- that `--no-chrome` removes the Chrome screen where it appears, and what decides
  whether it appears;
- what a Claude without the flag does with it, in the launch shape and in the
  package-probe shape;
- frames of starts that ask nothing, and of folder trust, each with the time of
  every capture, so the rule for a start that expects no confirmation is shown
  against when a question is first painted.

These scripts start one executable in one pane, on a private tmux socket, and
watch it. **They send no key, ever. They fetch nothing.** They do not drive the
kernel: no spawn, no deployment, no `oats` command.

**No run has been made with a real Claude by these scripts.** Only stub dry runs
have (see "Dry runs"). The branch is not for merging.

## Run

```bash
mkdir /tmp/live994                      # a short scratch directory outside your home
export LIVE_994_BASE=/tmp/live994

./run.sh plain --prepare                # creates the run folder, prints its path, stops
# ... trust that path in the configuration you prepared (or leave it untrusted, for `trust`) ...

LIVE_994_EXECUTABLE=/abs/path/to/claude-or-your-wrapper \
LIVE_994_CONFIG_DIR=/abs/path/to/the/prepared/config \
  ./run.sh plain

./cleanup.sh <out-dir>                  # only if a run stopped before its own cleanup
```

`./run.sh <mode> [NAME] [--prepare] [--checkout <oats checkout>]`

- `--checkout` is the OATS checkout the kernel's readings are imported from. The
  default is the checkout that holds these scripts. `host.json` records its head.
- `--prepare` needs only `LIVE_994_BASE`.

One mode per run. Make the runs one at a time.

### Modes

`<x>` is the executable. Every pane mode runs in `<base>/run-<mode>/home`, whose
`TASK.md` is nine lines that ask for nothing.

| Mode | What runs | Shows |
|---|---|---|
| `probe` | no pane: `<x> --no-chrome plugin list --json`, then `<x> plugin list --json` | each exit status, whether stdout parses as a JSON array, the first line of stderr |
| `plain` | `<x> -- '@TASK.md'`, folder trusted | a start that asks nothing |
| `no-chrome` | `<x> --no-chrome -- '@TASK.md'`, folder trusted | the flag is accepted in the launch shape |
| `approved` | `<x> --channels plugin:aweb-channel@awebai-marketplace -- '@TASK.md'`, folder trusted | the shape the reporting deployment starts |
| `approved-optout NAME` | as `approved`, with `NAME=1` in the pane's environment; `NAME` is `DISABLE_TELEMETRY`, `DO_NOT_TRACK` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | what the approved shape paints under a telemetry opt-out. Captured and reported, nothing is judged |
| `trust` | `<x> -- '@TASK.md'`, folder **not** trusted | when the folder-trust question is first painted |
| `old` | `probe`, then `no-chrome`, with `LIVE_994_OLD_CLAUDE` as `<x>` | what a Claude without the flag does with it |
| `chrome-offer` | as `plain` | the Chrome screen, on a host that shows it |
| `chrome-flag` | as `no-chrome` | the flag removes it |
| `chrome-env` | as `plain`, with `CLAUDE_CODE_ENABLE_CFC=0` in the pane's environment | the variable removes it |
| `chrome-yolo` | `<x> --dangerously-skip-permissions -- '@TASK.md'` | bypass mode is not offered it |

The `chrome-*` modes differ from `plain` and `no-chrome` only in the Claude
configuration the operator brings. The script does not create it.

### Environment

| Variable | Meaning | Default |
|---|---|---|
| `LIVE_994_BASE` | the scratch base: an existing directory, outside the home directory, at most 70 bytes long. Everything is written inside it | required |
| `LIVE_994_EXECUTABLE` | absolute path of the Claude binary, or of your wrapper that isolates and then runs Claude with the arguments it was given | required (not for `old`); never taken from `PATH` |
| `LIVE_994_OLD_CLAUDE` | the same, for a Claude without `--no-chrome` | required for `old` |
| `LIVE_994_CLAUDE_BINARY` | absolute path of the real binary, read only for the version in `host.json` when the executable is a wrapper. For `old`, point it at the old binary | the executable |
| `LIVE_994_CONFIG_DIR` | an existing Claude configuration directory you prepared. The pane gets it as `CLAUDE_CONFIG_DIR` | required, except in the `chrome-*` modes with a `HOME` in `LIVE_994_EXTRA_ENV`, and in a dry run |
| `LIVE_994_EXTRA_ENV` | space-separated `NAME=value` pairs for the pane and the probe only (a value cannot hold a space). `host.json` records the names, never a value. Applied last | none |
| `LIVE_994_SECONDS` | how long the pane is watched | `20` |
| `LIVE_994_PANE` | the pane size, `WxH` | `110x35` |
| `LIVE_994_ALSO_FORBID` | space-separated strings the sanitation check also refuses in any written file (the address of a signed-in account, for one). It reaches the check only: never the pane, never a file, never a log line | none |
| `LIVE_994_DRY_RUN=yes` | a stub dry run: the executable must be this directory's `stub-claude.sh` | unset |
| `LIVE_994_STUB_SCENARIO` | which frames the stub paints, in a dry run only | `session` |

The pane's whole environment is `PATH`, a throwaway `HOME` (`throwaway-home/` in
the out dir), `TERM`, `LANG`, `CLAUDE_CONFIG_DIR` when a configuration directory
is given, the variable a mode sets, and `LIVE_994_EXTRA_ENV`. tmux adds its own
(`TMUX`, `TMUX_PANE`, `TERM`). Nothing else of the caller's reaches it: `run.sh`
starts everything under `env -i`.

### Refusals (exit 2, nothing started)

- a mode that is not in the table; `approved-optout` without one of its three
  names; an option other than `--prepare` and `--checkout`;
- `node`, `tmux` or `git` missing from `PATH`; Node older than 20; a platform
  other than macOS and Linux;
- `LIVE_994_BASE` unset, relative, not an existing directory, the root
  directory, not your own or writable by another user, longer than 70 bytes,
  with a `#` in its path, inside the home directory or holding it, inside an
  OATS instance home, or with the user name, the host name or a
  `LIVE_994_ALSO_FORBID` string in its path (every frame names the run folder);
- inside the base, a `run-<mode>`, a `run-<mode>/home` or a `tmux` that is a
  link, is not your own directory, or that another user can write; a `TASK.md`
  there that is a link. A link is never followed: everything this script writes
  lands inside the base;
- the executable unset, relative, not an executable file, or ending in a
  semicolon; the same for `LIVE_994_CLAUDE_BINARY` when it is set;
- `old` without `LIVE_994_OLD_CLAUDE`;
- this directory's stub without `LIVE_994_DRY_RUN=yes`; `LIVE_994_DRY_RUN=yes`
  with any other executable; `LIVE_994_DRY_RUN` set to anything but `yes`;
  `LIVE_994_STUB_SCENARIO` outside a dry run;
- no `LIVE_994_CONFIG_DIR` (outside a dry run, and outside a `chrome-*` mode
  that has a `HOME` in `LIVE_994_EXTRA_ENV`); one that is not an existing
  directory; one that holds the base, or that is the base's `run-*`, `out-*`
  or `tmux` directory or inside one;
- `LIVE_994_SECONDS` that is not a whole number, shorter than the clean window
  (2 s), or over 600; `LIVE_994_PANE` that is not `WxH` from 20x5 to 500x200;
- `LIVE_994_EXTRA_ENV` with an entry that is not `NAME=value`; with
  `CLAUDE_CONFIG_DIR`, a `LIVE_994_*` or a `TMUX*` name; with the variable the
  mode itself sets; in `approved-optout`, with any of the three opt-out
  variables (the run sets one, the one it is given); or with `HOME` outside the
  `chrome-*` modes, or a `HOME` that is not an existing directory;
- a checkout without the kernel modules below, that is not a git checkout, or
  with uncommitted changes under `lib/`;
- a run folder that already holds a different `TASK.md`.

## What the operator provides

**The isolation is yours.** The script starts the executable you name, with the
environment above, and nothing more: it denies no network and creates no
configuration. No network, a dummy key and a throwaway configuration are what you
arrange, in your wrapper or through `LIVE_994_EXTRA_ENV`.

**`plain`, `no-chrome`, `approved`, `approved-optout`, `trust`, `probe`, `old`.**
The capture method of `lib/launch-prompt-fixtures/README.md` ("Adding a
wording"): a throwaway configuration directory seeded only with completed
onboarding and a dummy-key approval, a dummy key, and no network.

- The run folder is trusted in that seed for every mode but `trust`, where it is
  left untrusted. `--prepare` prints the folder: trust exactly that path (it is
  the resolved one, `/private/tmp/...` on macOS).
- The dummy key and whatever else the method sets go in your wrapper or in
  `LIVE_994_EXTRA_ENV`. The `drive.mjs` of the #917 live run
  (`origin/live/917-enter-linux`) shows one such seed and environment.
- For `approved` and `approved-optout`, say in your report whether the seed
  carries the offline channel gate of that method
  (`cachedGrowthBookFeatures.tengu_harbor`) and whether the plugin is installed
  in that configuration. Both may change what Claude paints, and the script sees
  neither.
- Do not set a telemetry opt-out variable yourself in `approved`: that is what
  `approved-optout NAME` is for, one variable per run.
- `old` takes an executable you already have. Nothing is installed.

**`chrome-offer`, `chrome-flag`, `chrome-env`, `chrome-yolo`.** A host that shows
the Chrome screen: a signed-in account, the extension present, and a
configuration where the question was never answered. Two ways to bring it:

- `LIVE_994_CONFIG_DIR`, a configuration directory that has all of that; or
- no `LIVE_994_CONFIG_DIR`, and `HOME=<a home directory>` in
  `LIVE_994_EXTRA_ENV`. The pane then gets that `HOME` and no
  `CLAUDE_CONFIG_DIR`. **This runs your own signed-in Claude with your own
  configuration. Claude may write to it: the script answers nothing, but
  whatever Claude itself records stays. That is your decision.** The value of
  that `HOME` is never written, and it joins the strings the sanitation check
  forbids.

In these modes, know what you start:

- With a signed-in account and the network up, the first prompt (`@TASK.md`) is
  sent to the model. It asks for the one word "idle" and nothing else.
- `chrome-yolo` starts Claude in bypass-permissions mode. The prompt asks for
  nothing, and no key is sent, but nothing of this script stands between that
  session and the host. Isolate it as you see fit.
- A signed-in Claude may paint the account's name or address. **Read the
  `chrome-*` frames before they leave the host**, whatever the sanitation check
  says. `LIVE_994_ALSO_FORBID` makes the check refuse the strings you give it.
- The script reports one key of the configuration's `.claude.json`,
  `claudeInChromeDefaultEnabled`, before and after the run, as `absent`, `true`,
  `false` or `other` (`unreadable` if the file is not JSON, `not-read` with no
  configuration). The file is parsed in memory; that one value is kept and
  nothing else of it is.

**Do not attach to the run's tmux server.** A client resizes the pane. A change
of size is recorded and does not fail the run, but it is not the run you wanted.

## What the scripts touch (audit, file by file)

Nothing below uses a network: no npm, no install, no git fetch, no curl. Nothing
is written outside `LIVE_994_BASE`. Nothing is removed, by any script.

- **`run.sh`** (bash 3.2):
  - reads its arguments and the `LIVE_994_*` variables;
  - executes `node drive.mjs plan`, `node drive.mjs run` and `node report.mjs`,
    each under `env -i` with `PATH`, `HOME`, `TERM`, `LANG`, the `LIVE_994_*`
    settings, and the caller's home and user name as `LIVE_994_CALLER_HOME` and
    `LIVE_994_CALLER_USER` (read only by the base refusal and the sanitation
    check; never passed to the pane). `HOME` is `/nonexistent` for `plan`, then
    `throwaway-home/` in the out dir;
  - changes into the out dir before the run, a neutral directory;
  - writes nothing itself.
- **`drive.mjs`** (Node 20+):
  - **Imports** from the checkout, and copies none of it:
    `CLAUDE_QUESTION_MARKERS` (`lib/launch-prompt-completion.mjs`);
    `normalizeScreen`, `showsClaudeSession`, `matchFlagIgnoredEntry` and
    `claudeVersionOf` (`lib/launch-prompt-fixtures.mjs`); `inspectSessionTarget`
    (`lib/session-input.mjs`). That last module also exports a function that
    sends input to a pane; it is not imported.
  - **Reads:** `git -C <checkout> rev-parse HEAD` and
    `status --porcelain -- lib` (local); the real path of the executable, for
    the version, the way `claudeVersionOf` reads it (**the executable is never
    run to read a version**); the scripts of this directory, for their digests
    in `host.json`; `tmux -V`; for the `chrome-*` modes, the one key above.
    **It reads nothing else of `LIVE_994_CONFIG_DIR` and writes nothing there.**
    Claude itself may write its configuration directory.
  - **Creates**, inside the base: the run folder `run-<mode>/home` with its
    `TASK.md`; the out dir `out-<mode>[-<NAME>]-<UTC>/`; the directory `tmux/`,
    where the run's socket lives while its server runs.
  - **Executes:**
    - for `probe` and `old`, the executable twice, with the two probe argument
      lists, in the run folder, with the pane's environment, stdin closed and a
      60 s limit;
    - `tmux`, always as `tmux -u -S <the run's socket>`, and only these five
      subcommands, checked in one function: `new-session` (once: it starts the
      private server, with `tmux.conf` and the pane's environment),
      `display-message` and `capture-pane` (the captures), `list-panes` (the
      pane's process), `kill-server` (the cleanup). None of them can put input
      into a pane;
    - `ps -axo pid=,ppid=,comm=`, once per capture.
  - **The pane's command** is run by tmux directly, with no user shell:
    `/bin/sh -c '"$@"; printf "%s\n" "$?" > <out>/exit-<mode>; exec /bin/sh'`
    over the executable and its arguments. So the executable's exit status
    lands in `exit-<mode>`, and the pane then idles in a plain shell, as the
    kernel's own pane does.
  - **Cleanup:** kills the run's private tmux server by its socket, then asks
    (signal 0, which sends nothing) whether a process of the pane's group is
    left. Nothing else is killed. Interrupted (Ctrl-C, `SIGTERM`, `SIGHUP`), it
    still writes what it has and does this cleanup. The cleanup also runs when
    the evidence cannot be written (a full disk): the run then exits 1, and the
    cleanup's result is printed.
- **`verdict.mjs`:** computes the verdict from `timeline.json` alone.
  `node verdict.mjs <out-dir>` prints it again. Reads that one file, writes
  nothing, executes nothing.
- **`report.mjs`:** reads every regular file of the out dir except
  `throwaway-home/`; writes `summary.txt` and `sanitation.json` there; prints
  the summary. Executes nothing.
- **`cleanup.sh`:** reads `<out-dir>/state.json`; refuses a socket that is not
  `<base>/tmux/<UTC>-<pid>` and a server that holds anything but the session
  `live994`; runs `tmux -S <socket> list-sessions` and `kill-server` under
  `env -i`. Removes nothing.
- **`tmux.conf`:** one line, `set -g status off`, so the pane is exactly the
  size asked for. The private server reads this file and no other.
- **`stub-claude.sh`:** the dry-run stub. It is not Claude. It paints scripted
  frames, appends each call (folder, arguments, five variables) to
  `stub-calls.log` in the out dir, and reads no key.
- **`check-dry-runs.sh`:** runs the dry runs below, one at a time, under its own
  `LIVE_994_BASE`. To exercise the edge cases it also runs, on a run's private
  socket only, `tmux resize-window` and `tmux kill-server`, and it kills one
  dry run's own driver. It starts no executable but the stub.
- **Claude itself** writes where Claude writes: its configuration directory,
  and the pane's `HOME` (`throwaway-home/` unless you passed another).

## What a run writes

In `<base>/out-<mode>[-<NAME>]-<UTC>/`:

| File | Holds |
|---|---|
| `host.json` | mode, platform and architecture, the Claude version and where it was read from, whether the executable was a stub, the pane size asked for and seen, the pane's arguments, the **names** of its environment variables, the tmux and Node versions, the OATS head, the digests of these scripts. No host name, no user name, no account, no path |
| `frames/<mode>/t+<ms>.txt` | each capture that differs from the one before, byte for byte. **The only place screen text lives** |
| `timeline.json` | one row per capture (below) |
| `verdict.json`, `summary.txt` | the verdict (below). No screen text beyond marker strings of the kernel's own list |
| `exit-<mode>` | the executable's exit status, once it has exited |
| `probe.json` | `probe` and `old`: the two probe results, with the first line of stderr |
| `chrome-setting.json` | `chrome-*`: the one key, before and after |
| `cleanup.json`, `sanitation.json` | the cleanup and the check |
| `state.json`, `run.log` | the socket and the pane's process id, for `cleanup.sh`; the run's own lines |
| `throwaway-home/` | the pane's `HOME`. Whatever Claude wrote there. **Not evidence, not checked: do not send it** |

### The witness

Every 100 ms from the creation of the pane, for `LIVE_994_SECONDS`, the script
captures the visible pane the way the kernel's transport does
(`lib/launch-prompt-transport.mjs`, `snapshot`): one tmux invocation that reads
the pane's identity and geometry, runs `capture-pane -p`, and reads them again.
Visible text only: no scrollback, no colour, no cursor. A capture is refused, as
in the kernel, when the two readings differ, the pane is not alone in its
window, its process id changed, or the row count is not the pane's height.

`ms` counts from the moment `new-session` returned (`createTookMs` in the
timeline is how long that call took). A frame painted and replaced between two
captures is not seen.

Each `timeline.json` row:

| Field | Meaning |
|---|---|
| `ms`, `width`, `height` | when, and the geometry read around the capture |
| `blank` | `normalizeScreen(text) === ""` |
| `digest`, `changed`, `frame` | sha256 of the captured bytes; whether they differ from the capture before; the frame file, when they do |
| `markers` | the entries of `CLAUDE_QUESTION_MARKERS` the capture contains |
| `sessionBanner` | `showsClaudeSession(text)` |
| `noticeBlocks` | how many notice blocks are on screen: maximal runs of rows that begin with `▎` (U+258E). The kernel's `noticeBlocks` is not exported; this counts the same runs |
| `flagIgnoredEntry` | the id of the entry `matchFlagIgnoredEntry(text)` returns, or null |
| `exitFile` | whether `exit-<mode>` existed at this capture |
| `panePid`, `paneCommand` | what tmux says the pane runs (`#{pane_pid}`, `#{pane_current_command}`), as `inspectSessionTarget` read it |
| `paneState` | the `state` `inspectSessionTarget` returned: `shell` (the pane's command is a shell with no descendant that is not a shell), `stopped`, or `unknown` |
| `descendants` | how many processes descend from the pane's process, in the same `ps` sample |
| `harnessRunning` | the kernel's own predicate over that state (`harnessRunning` in `lib/core.mjs`, not exported, applied as written there): present, and neither a fallback shell nor a dead pane. Null when the process could not be read |
| `geometryChanged` | present when the size differs from the capture before |
| `failed`, `error` | a capture that failed, and why, as a fixed word. It is recorded and the run goes on; three in a row fail the run |

## How to read the verdict

The verdict applies, to the timeline alone, the rule for a start that expects no
confirmation:

- a capture is **clean** when it is non-blank and holds no marker;
- the first capture with a marker is `blocked: unexpected prompt`;
- the harness no longer running is `blocked: harness exited`;
- 2000 ms of consecutive clean captures is `no-prompt`. A blank capture, a
  capture with a marker and a failed capture each restart the window;
- none of them by the end of the observation is `blocked: observation timeout`.

Whichever comes first is `outcome`, at `outcomeMs`. The witness goes on capturing
after it, and that is the point:

- **`questionAfterNoPrompt`** is true when the rule had answered `no-prompt` and
  a marker was first painted after it. `questionAfterNoPromptTimes` gives both
  times. This is the value the runs are for: it says the rule would have
  answered `no-prompt` to a start that then asked a question.
- `firstNonBlankMs`, `firstMarkerMs` with `firstMarkers`, `cleanWindowStartMs`
  and `cleanWindowCompletedMs`. The window is the first one anywhere in the
  timeline, so it is reported even when a marker or an exit came first.
- `markerRuns` lists each stretch of consecutive captures that held a marker,
  with its capture count: a marker on screen for one capture still blocks, and
  shows as `captures: 1`.
- **`harness`**: `firstRunningMs` and `capturesBeforeRunning` (how many captures
  passed before the executable was read as running under the pane's process);
  `noLongerRunningMs`, the first of the first **two consecutive captures** that
  both read it as not running; `singleNotRunningReadings`, counted and never
  judged. One reading is not enough: before the pane's shell has started the
  executable, the pane reads exactly like one whose harness already exited. A
  capture whose process could not be read (`harnessRunning: null`) breaks a
  pair.
- `exitFile.firstSeenMs` and `exitFile.status`, beside it.
- `screenOnlyOutcome` is what the rule answers without the pane's process. For
  an executable that exits at once it is `no-prompt`, where `outcome` is
  `blocked: harness exited`.
- On a tie, the process decides before the screen: the harness gone at the
  capture that would complete the window, or that holds a marker, is
  `blocked: harness exited`.
- **`settledFrame`**: the last frame of the observation, with how long it had
  held unchanged (`heldMs`), `settled` (held for the window or longer), and that
  capture's `markers`, `noticeBlocks`, `sessionBanner` and `flagIgnoredEntry`.
- **`questionMatchedMarker`** (`trust`, `chrome-offer`): whether the settled
  frame holds a marker. False means the frame holds none of the kernel's
  markers: if it asks something, the kernel would not see it. The run does not
  fail; the summary says so in capitals. Read the frame.
- **`noticeBlocksAtSettledFrame`** (`approved-optout`): a count, no text.
- `failedCaptures`, `geometryChanges`, `failure` (`three consecutive captures
  failed`, `the pane could not be created`), `interrupted`.

A failed capture restarts the clean window, so with failed captures the reported
window is later than the kernel's would be; `failedCaptures` says when to mind.

## The sanitation check

After the run, `report.mjs` reads every file of the out dir except
`throwaway-home/` and fails (exit 1, naming each file and the class, never the
string) if any holds:

- the caller's home directory path (`home`), user name (`user`) or host name,
  whole or its first label (`host`);
- the value of a `HOME` passed in `LIVE_994_EXTRA_ENV` (`extra-env-home`);
- a string of `LIVE_994_ALSO_FORBID` (`also-forbid-<position>`).

The match is exact, byte for byte. It knows nothing else: not an account, not
another person's name. A run that fails it leaves its files where they are.

The probe's stderr line is printed in the summary only after the check has
passed over `probe.json`.

## Exit statuses

`run.sh`:

- **0**: the run was made, the check passed, and the cleanup left nothing. The
  outcome is whatever the verdict says: a run that observes `blocked` or a
  false `questionMatchedMarker` still exits 0.
- **1**: three captures in a row failed; the pane could not be created; the run
  was interrupted; the evidence could not be written; a file holds a forbidden
  string; or the private tmux server, or a process of the pane's group, is
  still there.
- **2**: refused. Nothing was started.

`cleanup.sh`: 0 when no server is left, 1 when it is still there, 2 refused.

## For the report

The out dir without `throwaway-home/`, or at least: `host.json`, `summary.txt`,
`verdict.json`, `timeline.json`, and the frames. For `approved*`, what the seed
held (above). For `chrome-*`, what the host had: the account kind, the
extension, and `chrome-setting.json`.

## Dry runs

`check-dry-runs.sh` runs every mode against `stub-claude.sh`, one at a time, and
compares each `verdict.json` with what that run must show. **The stub runs prove
the mechanics and the verdict arithmetic, nothing about Claude.** The stub
paints scripted frames: blank, a logo frame, a session frame; the folder-trust
screen of `test/fixtures/launch-prompts/frame-01.txt`, with its two workspace
rows replaced by the run folder; an "unknown option" line and an exit at once; a
question first painted at 3 s; an invented question with none of the kernel's
markers; a notice block.

```bash
mkdir /tmp/live994-check && LIVE_994_BASE=/tmp/live994-check ./check-dry-runs.sh
```

It has been run on Linux only. On macOS, run it before the first real run.

Its output at this head:

```text
#994 live-run dry runs: Linux x86_64, tmux 3.7c, node v26.8.2, bash 5.3.15
the stub is not Claude: these runs prove the mechanics and the verdict arithmetic, nothing about Claude
ok   probe: exit 0
ok   plain: exit 0; no-prompt at 2199 ms; non-blank 199, marker null, window 2199; harness running after 0 captures, gone null; 51 captures, 0 failed
ok   no-chrome: exit 0; no-prompt at 2199 ms; non-blank 199, marker null, window 2199; harness running after 0 captures, gone null; 51 captures, 0 failed
ok   approved: exit 0; no-prompt at 2300 ms; non-blank 200, marker null, window 2300; harness running after 0 captures, gone null; 51 captures, 0 failed
ok   trust: exit 0; blocked: unexpected prompt at 500 ms; non-blank 200, marker 500, window null; harness running after 0 captures, gone null; 51 captures, 0 failed
ok   old: exit 0; blocked: harness exited at 0 ms; non-blank 0, marker null, window 2000; harness never read as running, gone 0; 51 captures, 0 failed
ok   chrome-offer (a question with no marker): exit 0; no-prompt at 2099 ms; non-blank 0, marker null, window 2099; harness running after 0 captures, gone null; 51 captures, 0 failed
ok   chrome-flag: exit 0; no-prompt at 2199 ms; non-blank 199, marker null, window 2199; harness running after 0 captures, gone null; 51 captures, 0 failed
ok   chrome-env (the configuration under a HOME of the extra environment): exit 0; no-prompt at 2199 ms; non-blank 199, marker null, window 2199; harness running after 0 captures, gone null; 51 captures, 0 failed
ok   chrome-yolo: exit 0; no-prompt at 2200 ms; non-blank 200, marker null, window 2200; harness running after 0 captures, gone null; 51 captures, 0 failed
ok   approved-optout DISABLE_TELEMETRY: exit 0; no-prompt at 2199 ms; non-blank 199, marker null, window 2199; harness running after 0 captures, gone null; 51 captures, 0 failed
ok   approved-optout DO_NOT_TRACK: exit 0; no-prompt at 2199 ms; non-blank 199, marker null, window 2199; harness running after 0 captures, gone null; 51 captures, 0 failed
ok   approved-optout CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: exit 0; no-prompt at 2299 ms; non-blank 200, marker null, window 2299; harness running after 0 captures, gone null; 51 captures, 0 failed
ok   a question first painted at 3 s: exit 0; no-prompt at 2000 ms; non-blank 0, marker 3099, window 2000; harness running after 0 captures, gone null; 61 captures, 0 failed
ok   a screen that stays blank: exit 0; blocked: observation timeout; non-blank null, marker null, window null; harness running after 0 captures, gone null; 31 captures, 0 failed
ok   another pane size: exit 0; no-prompt at 2200 ms; non-blank 198, marker null, window 2200; harness running after 0 captures, gone null; 51 captures, 0 failed
ok   the pane resized mid-run: exit 0; no-prompt at 2199 ms; non-blank 199, marker null, window 2199; harness running after 0 captures, gone null; 51 captures, 0 failed
ok   the pane gone mid-run: exit 1; blocked: observation timeout; non-blank 198, marker null, window null; harness running after 0 captures, gone null; 14 captures, 3 failed
ok   the driver interrupted mid-run: exit 1; blocked: observation timeout; non-blank 199, marker null, window null; harness running after 0 captures, gone null; 12 captures, 0 failed
ok   one capture that fails: exit 0; no-prompt at 2499 ms; non-blank 99, marker null, window 2499; harness running after 0 captures, gone null; 51 captures, 1 failed
ok   a frame that holds the user name: exit 1; no-prompt at 2199 ms; non-blank 198, marker null, window 2199; harness running after 0 captures, gone null; 31 captures, 0 failed
ok   a frame that holds an also-forbidden string: exit 1; no-prompt at 2199 ms; non-blank 199, marker null, window 2199; harness running after 0 captures, gone null; 31 captures, 0 failed
ok   a frame that holds the HOME of the extra environment: exit 1; no-prompt at 2200 ms; non-blank 199, marker null, window 2200; harness running after 0 captures, gone null; 31 captures, 0 failed
ok   the evidence cannot be written: exit 1, and the private server is gone without cleanup.sh
ok   cleanup.sh after a killed driver: the server was left, cleanup.sh exit 0, no server after it
ok   refused, an unknown mode: exit 2, nothing started
ok   refused, an opt-out variable that is not one of the three: exit 2, nothing started
ok   refused, no executable: exit 2, nothing started
ok   refused, a relative executable: exit 2, nothing started
ok   refused, the stub without LIVE_994_DRY_RUN: exit 2, nothing started
ok   refused, LIVE_994_DRY_RUN with another executable: exit 2, nothing started
ok   refused, no configuration directory outside a dry run: exit 2, nothing started
ok   refused, old without LIVE_994_OLD_CLAUDE: exit 2, nothing started
ok   refused, seconds shorter than the clean window: exit 2, nothing started
ok   refused, a pane size that is not WxH: exit 2, nothing started
ok   refused, an extra environment entry that is not NAME=value: exit 2, nothing started
ok   refused, CLAUDE_CONFIG_DIR in the extra environment: exit 2, nothing started
ok   refused, HOME in the extra environment outside the chrome modes: exit 2, nothing started
ok   refused, a variable the mode sets, in the extra environment: exit 2, nothing started
ok   refused, an unknown option: exit 2, nothing started
ok   refused, a second opt-out variable in the extra environment: exit 2, nothing started
ok   refused, a base other users can write: exit 2, nothing started
ok   refused, a configuration directory where this script writes: exit 2, nothing written there
ok   refused, a link where the run folder, its home or its TASK.md goes: exit 2 each, nothing written through it
ok   refused, a base that is the home directory: exit 2, nothing started
ok   --prepare: exit 0, the run folder and its nine-line TASK.md, nothing else
ok   verdict: a marker on screen for one capture still blocks, and shows as one capture
ok   verdict: a blank capture restarts the window
ok   verdict: a failed capture restarts the window
ok   verdict: a marker after the window completed is questionAfterNoPrompt
ok   verdict: one not-running reading before the executable started is not judged
ok   verdict: a capture whose process could not be read breaks the pair
ok   verdict: two not-running readings in a row are a harness that exited
ok   verdict: the harness gone at the capture that completes the window is harness exited
ok   verdict: the harness gone after the window completed is no-prompt
ok   verdict: neither by the end is an observation timeout
ok   verdict: the settled frame is the last one, with how long it held
ok   verdict: a screen still changing at the end is not settled
ok   no script names a tmux command that sends input to a pane
ok   no process is left from any case
49 checks passed, 0 failed
```

## Integrity

`SHA256SUMS` covers every file here but itself:
`shasum -a 256 -c SHA256SUMS` (or `sha256sum -c SHA256SUMS`). `host.json` records
the digests of the scripts each run used.
