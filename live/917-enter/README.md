# #917 live runs: a real Claude, at the fixed head

Merge condition 2 of PR #917 (Pepe's review 5481510495, refined in comment
6107369947). There are two runs, both at the head that merges, and both on a
host with a real Claude:

- **enter:** Claude's network is denied, the development-channel confirmation
  appears, and OATS itself answers it with one Enter;
- **notice:** telemetry and non-essential traffic are off, so Claude ignores the
  flag (see "Why Claude ignored the flag"), and OATS records `flag-ignored` and
  sends no key.

Each run reports who ran it, the platform, the Claude version, and the
`launch-prompt` events of each start, with the exact frame the kernel judged.
Drafted by oats-kernel-developer-launch-prompts. **Neither run has been made
with a real Claude by these scripts**; only stub dry runs have (see "Dry runs").

## Run

The checkout passed to `run.sh` must be at the #917 head. Prepare it beforehand,
with its `node_modules` (`npm ci`): **the scripts fetch nothing**.

```bash
# macOS
./run.sh enter  <checkout>     # sandbox-exec denies the network (claude-sandboxed.sh)
./run.sh notice <checkout>     # network up

# Linux: bring your own isolation wrapper for the enter run
LIVE_ENTER_EXECUTABLE=/abs/path/to/your-wrapper ./run.sh enter <checkout>
./run.sh notice <checkout>

./cleanup.sh <out-dir>         # only if a run stopped before its own cleanup
```

**Environment:**

| Variable | Meaning | Default |
|---|---|---|
| `LIVE_ENTER_EXECUTABLE` | the `enter` run's executable, an absolute path to a wrapper that denies Claude the network and then runs Claude with the arguments it was given | macOS: `claude-sandboxed.sh`; Linux: none, so it is required |
| `LIVE_ENTER_CLAUDE_BINARY` | the real Claude binary, an absolute path | macOS: `/opt/homebrew/bin/claude`; Linux: `command -v claude` |
| `LIVE_ENTER_EXTRA_ENV` | space-separated `NAME=value` pairs added to the launch configuration's env only (the telemetry A/B below), recorded in `host.json` as `extraLaunchEnv` | none |
| `LIVE_ENTER_EXPECT` | what the run must show: `completed` or `flag-ignored` | `completed` for enter, `flag-ignored` for notice |
| `LIVE_ENTER_CLAUDE` + `LIVE_ENTER_DRY_RUN=yes` | a stub in place of the binary, for a mechanics dry run only; `run.sh` refuses the first without the second | unset |

The launch configuration passes the binary to the wrapper as `CLAUDE_BINARY`,
for a wrapper that wants it. `claude-sandboxed.sh` names Homebrew's Claude
itself, so on macOS a stub replaces it too. On Linux a stub runs through
`LIVE_ENTER_EXECUTABLE` when one is set.

**`run.sh` refuses:**
- a checkout with uncommitted changes;
- a `LIVE_ENTER_EXECUTABLE` or `LIVE_ENTER_CLAUDE_BINARY` that is not an
  absolute, executable path;
- on Linux, no Claude binary, or an `enter` run without `LIVE_ENTER_EXECUTABLE`;
- on macOS, for the default `enter` executable, a `claude-sandboxed.sh` that is
  not executable, or no `/usr/bin/sandbox-exec`.

It runs from a neutral directory (`./out-<mode>-<UTC>/`) with no instance or
tmux identity in its environment, writes every observation there, and prints a
summary. Exit status: **0** when what the run had to show was shown (below) and
cleanup left nothing; **3** when the kernel's record and rows showed it but the
witness holds no frame for the audited digest (see "Frame not sampled");
**1** for anything else, an unclean cleanup included.

**The checkout can be this branch itself.** The live branch's only commit adds
`live/917-enter/` on top of the #917 head. `host.json` records `oatsHead`, its
subject, and its first parent (`oatsHeadFirstParent`). When the checkout is the
live branch, that first parent is the #917 head and the kernel code is
identical.

## Matching the #886 A6 capture, and why Claude ignored the flag

The A6 capture showed the confirmation: Claude 2.1.296 (npm) on linux-arm64, in
`node:22-trixie@sha256:def2655045ff1ee91b28a48cb3ec84feafef6d128bda0ff6903e7847ed0b27b4`,
`--network none`, as the container's root. The `enter` run now seeds exactly
what A6 had:

| | A6 | `enter` now |
|---|---|---|
| `.claude.json` | onboarding done, `lastOnboardingVersion` = the binary's version, `theme: dark`, the dummy key's last 20 characters approved, `cachedGrowthBookFeatures: {tengu_harbor: true}`, the cwd trusted | the same keys and values; the trusted cwd is the instance home |
| other config files | none (no `settings.json`) | none |
| key | `ANTHROPIC_API_KEY=oats-fixture-no-credential` | the same |
| environment | `CLAUDE_CONFIG_DIR`, `ANTHROPIC_BASE_URL=http://127.0.0.1:9`, `DISABLE_AUTOUPDATER=1`, `TERM=xterm-256color`, `LANG=C.UTF-8` | the same, plus a throwaway `HOME`, `XDG_CACHE_HOME` and `TMPDIR` in the base (A6's `HOME` was the throwaway container's) |
| `DISABLE_TELEMETRY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | not set | not set (earlier versions of these scripts set both) |

**Why Claude ignored the flag.** This comes from reading the 2.1.296 bundle,
not from a run. Claude enables channels only when its GrowthBook gate
`tengu_harbor` reads true. With GrowthBook off, Claude answers that gate false
without reading the cached value, then ignores the flag and prints
"Channels are not currently available". Claude turns GrowthBook off when
telemetry is opted out: `DISABLE_TELEMETRY`, `DO_NOT_TRACK` or
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. Every run that ignored the flag had
two of those set:
- the macOS run at 74946384, network up;
- the macOS run in the sandbox, network denied;
- the Linux run at b5e8c877, network denied.

A6 had neither, and showed the confirmation. So the `enter` run never sets them.
The `notice` run sets the two the earlier runs had, which is what produced the
notice there.

## The telemetry A/B (for the enter run)

Both runs use the same head, host, wrapper and binary, and differ in one
variable:

- **A:** `run.sh enter` as seeded. Expect the confirmation, one Enter, then
  `completed` (`LIVE_ENTER_EXPECT` defaults to `completed`).
- **B:** the same, with `DISABLE_TELEMETRY=1` added to the launch environment:
  `LIVE_ENTER_EXTRA_ENV="DISABLE_TELEMETRY=1" LIVE_ENTER_EXPECT=flag-ignored`.
  Expect `flag-ignored` and no key. As in the notice run, the restart carries
  the evidence, since a fresh config's spawn may keep the notice hidden.

Exit 0 on both means the prediction held: Claude Code disables channels when
telemetry is opted out. Report both out dirs, A first.

## The Claude version

It is read from the binary's real path, as the kernel reads it: the
`claudeVersion`/`claudeVersionSource` of `host.json`. Where the path carries no
version (an npm install on Linux, for example), both stay `unknown`. `host.json`
then adds `claudeVersionOutput`: what `<executable> --version` printed. In
`enter` that output comes through the network-denying wrapper, with the
throwaway environment, taken by `drive.mjs` once before any start. The kernel
never runs Claude to read a version.

The audit's own `claudeVersion` reads the launch executable, so through a
wrapper it is `unknown`; that is accepted. A Claude version other than the
entry's captures (for example 2.1.288) is a finding to report, not a failure of
the scripts.

## What the scripts touch (audit, file by file)

Nothing below fetches from a network: no npm, no git clone or fetch of a remote,
no curl. Nothing writes outside three places:
- the fixture's scratch base (`<tmpdir>/oats-v2-*`, or `/tmp/oats-v2-*` when
  tmpdir is long);
- the fixture's private tmux dir (`/tmp/oats-tmux-*`);
- the run's out dir.

- **`run.sh`:**
  - reads the checkout with `git -C <checkout> status --porcelain` and
    `rev-parse` (local);
  - creates `out-<mode>-<UTC>/` beside itself and changes into it;
  - runs `node drive.mjs` under `env -i`, with only `PATH`, a throwaway `HOME`
    (`caller-home/` in the out dir), `TERM`, `LANG` and the run's own
    `LIVE_ENTER_*` settings. So the caller's environment (an agent session's
    tokens, an instance or tmux identity) never reaches the fixture, the kernel,
    tmux or Claude;
  - tees `run.log` into the out dir, and prints the summary from the out dir's
    JSON.
- **`drive.mjs`:**
  - **Imports:** loads `test/helpers/v2-deployment.mjs`,
    `lib/launch-prompt-fixtures.mjs` and the checkout's own `yaml` from
    `node_modules`.
  - **Git and version reads:** `git -C <checkout> rev-parse HEAD` / `log -1` /
    `rev-parse HEAD^` (local). `<executable> --version` once, only when the
    binary's path has no version (above).
  - **The fixture creates, inside the scratch base:**
    - a bare workspace repository, with local file clones of it and a local
      push and pull (no remote);
    - the deployment and its `oats-local.yaml`;
    - an isolated `HOME`, `OATS_HOME_DIR` and remote cache;
    - the private `TMUX_TMPDIR`.
    It declares "no network, no packages, no catalog"; see its header.
  - **Its own directories in the base:**
    - `claude-config/.claude.json` (seeded);
    - `claude-home/` (Claude's `HOME`, and `XDG_CACHE_HOME` under it);
    - `claude-tmp/` (Claude's `TMPDIR`).
  - **CLI calls:** runs the checkout's `bin/oats.mjs` through the fixture (with
    its isolated environment) for `spawn`, `launch-config preview`,
    `session restart` and `retire`, all on the scratch deployment. The kernel
    starts tmux only on the private socket and Claude only through the launch
    configuration.
  - **Claude's environment** is throwaway and, in `enter`, A6's:
    - a dummy API key;
    - `ANTHROPIC_BASE_URL` on a dead local port;
    - auto-update off;
    - in `enter`, the network denied by the wrapper;
    - in `notice` only, telemetry and non-essential traffic off.
  - **Out dir:** writes every observation file there. Starts
    `watch-panes.mjs`, and stops it at the end.
  - **Cleanup:** `fx.cleanup()` kills the private tmux server by its socket,
    checks that no process works in the base, and removes the base and the
    tmux dir. Then `pgrep -fl <base>` confirms.
- **`watch-panes.mjs`:** only `tmux -u -S <private socket>` `list-panes` and
  `capture-pane -p`, read-only. It never sends a key. `list-panes` on a missing
  socket fails, so it never starts a server. It writes `frames/` and
  `frames.jsonl` in the out dir, and exits when its stdin closes.
- **`claude-sandboxed.sh`** (macOS `enter`):
  `exec /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' /opt/homebrew/bin/claude "$@"`.
  It writes nothing itself.
- **`cleanup.sh`:** reads `state.json`, kills the private tmux server by its
  socket, sends SIGTERM to processes naming the base, and removes the base and
  the tmux dir. Before any `rm -rf` it refuses:
  - a base that is not a fixture temp dir (`/tmp/oats-*`,
    `/var/folders/*/oats-*`, or their `/private` forms);
  - a tmux dir that is not `/tmp/oats-tmux-*` or `/private/tmp/oats-tmux-*`.
- **Claude itself** writes to its config dir, `HOME`, cache and `TMPDIR`, all
  in the base. The kernel writes the instance home and its event logs inside
  the scratch deployment.

## Linux notes (from the 2.1.288 leg)

- **Deny the resolver too.** A network namespace alone leaves the system
  resolver reachable through its socket under `/run`, so a host name still
  resolves and the host sends DNS queries for the run. Give Claude an empty
  `/run` (bubblewrap: `--tmpfs /run`) or use a container with `--network none`.
  Check that a lookup fails inside the wrapper before running.
- **The caller's environment is emptied** by `run.sh` (above). Nothing else is
  needed for that.
- **Name the binary** with `LIVE_ENTER_CLAUDE_BINARY` where `claude` on `PATH`
  is a version manager's launcher. A launcher may try to fetch the latest
  release, and it exits with no network.

## The steps

1. **`host.json`** records:
   - who ran it, the host and the platform;
   - the Claude binary, its real path and its version (above);
   - the launch executable and its own version reading, the `CLAUDE_BINARY`
     passed to a wrapper, and `dryRunStub`;
   - the oats head, its subject and its first parent.
2. **`oats spawn dev --name live-enter --launch-config live --json`**.
3. **`oats launch-config preview --home <home> --json`** (`preview.json`).
4. **`oats session restart --home <home> --json`**. The same pane takes a new
   process, and the controller proves ownership by the new PID and a fresh
   screen.
5. **`oats retire live-enter --json`** (`retire-answer.json`).
6. **Cleanup** (above). `cleanup.json` records the result.

For each start (`spawn`, `restart`) it writes:
- `<start>-answer.json`, the envelope with its `warnings` or error;
- `<start>-launchPrompts.json`, from `instance.json`: `launched`,
  `launchPrompts` and `launchPromptTarget`;
- `<start>-events.json`, that start's `launch-prompt` rows;
- `<start>-pane.txt`, the pane afterwards;
- `<start>-audited-frame.txt`: the exact bytes the kernel judged, found by the
  row's `signatureDigest` among the witness's frames. That is the frame it
  pressed Enter on, recognised as the notice, or blocked on.
- `<start>-evidence.json`:
  - `status`, `reason` and `launched`;
  - the rows and the entry;
  - `enterRows` (rows that carry the key) and `enterKeys` (submitted Enters);
  - `frameEqualsEntryOne`: the audited frame, normalized, equals entry one's
    text;
  - `frameMatchesFlagIgnored`: one notice block of the audited frame equals the
    flag-ignored entry;
  - `claudeSessionShown`;
  - the audit's `claudeVersion`.

`verdict.json` gives the result: `required` names the starts that must show it
(both for `completed`, the restart only for `flag-ignored`), and each start is
`shown`, `frame-not-sampled` or `failed`. A start that is not required may read
`failed`, as a hidden-notice spawn does.

**Frame not sampled.** The witness polls every 50 ms, and the kernel can act on
a frame sooner. In one of Pepe's plain runs, the kernel answered the confirmation
12 ms after auditing it, and the witness never captured that frame. When a
start's rows show the expected outcome (status, launched, the entry, the key
count, the warnings) but no witnessed frame has the audited `signatureDigest`,
the start is `frame-not-sampled`, and the run exits 3, not 1. The kernel's rows
still record what it judged, as the frame's digest, but that frame itself is
kept nowhere: the private evidence holds only later frames, and the run's retire
removes the home. The byte-for-byte frame proof is missing for that start, so
repeat the run if it is needed.

## What each run must show (exit 0)

- **enter, both spawn and restart:**
  - `completed` and `launched: true`;
  - the rows `attempted, submitted, completed`, for the entry
    `aweb-dev-channel-confirmation-1`;
  - exactly one Enter (`enterKeys: 1`, `enterRows: 2`, the attempt and its
    submission);
  - `frameEqualsEntryOne: true`.
- **notice, the restart:**
  - `flag-ignored` (reason `channels-unavailable`) and `launched: true`;
  - one row, `flag-ignored`, for the entry `aweb-dev-channel-flag-ignored-1`;
  - no key: `enterRows: 0`, no `attempted` or `submitted` row;
  - `frameMatchesFlagIgnored: true`;
  - the no-channel-delivery warning, and not the statement that OATS confirms
    the prompt.

  **What the spawn records.** On a fresh config, Claude can keep the notice
  behind `1 more notice hidden`, as it did in run 74946384. Then the spawn is
  `E_SPAWN_INCOMPLETE` with no key and the home retained. The reason is
  `blocked: unexpected prompt` if that screen held still for the 2 s settle
  window, or `blocked: observation timeout` if it kept changing until the 30 s
  bound (for example Claude's connection-retry spinner). Its record carries `claudeSessionShown: true` (the banner rule
  holds while the logo animates), and its error ends with the hint that Claude
  may have ignored the flag. That is the documented first-spawn limit. If the
  notice is visible at the spawn, the spawn records `flag-ignored` too. Either
  way, the restart carries the evidence.

**For the PR report:**
- the head;
- the Claude version (`host.json`);
- the exit status;
- the spawn and restart statuses;
- the key count (`enterKeys`);
- `frameEqualsEntryOne`.

## Dry runs

Stub dry runs exercise the mechanics, never Claude:
- the witness, the digest lookup, `frameEqualsEntryOne` and
  `frameMatchesFlagIgnored`;
- the verdicts;
- cleanup.

The stubs are not in this package. They are kept, with their outputs, in the
developer's instance home (`886/live-enter/dryrun-*`), on macOS and in a
`node:22-trixie` container.
- An enter stub draws entry one's real text, word-wrapped to its pane, and shows
  a session on Enter.
- A notice stub prints the live captures: the hidden-notice pane on its first
  start, the visible one after.
- Both log every key they read.
