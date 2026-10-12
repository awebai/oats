# #994 live runs on Linux x86-64, Claude Code 2.1.288

Made on 2026-10-12, 22:40Z to 22:43Z, by the maintainer on Pepe's side, with the
scripts of this directory at `22f211aaa5485067843d9e796ad1a98e7897ece7`
(`sha256sum -c SHA256SUMS`: nine of nine before the first run). Each folder here
is one run's out dir as the scripts wrote it, without `throwaway-home/`.

Not for merging. The frames are raw captures: before one becomes a fixture it is
read again by whoever commits it.

## Host and isolation

- linux-x64, tmux 3.7c, Node v26.8.2, Claude Code 2.1.288 (the real binary, named
  by path; the `claude` on this host's path is a launcher that goes to the
  network first).
- **No network at any point.** The executable was the maintainer's own wrapper:
  a network namespace with the loopback only, an empty directory in place of the
  host's `/run` (the resolver and the system bus are sockets there), and the host
  user's home replaced by an empty file system with only the Claude binary bound
  back in, read-only. Checked first with a shell in place of Claude: one
  interface, no name resolved, nothing in `/run`, one file under the home.
- **None of this host's account.** A fresh configuration directory per run, a
  dummy key, the API address on a dead local port, the updater off. The wrapper
  refuses any `HOME` but the run's throwaway one.
- The caller's environment was emptied before `run.sh`, which empties it again.
- Load average of the host during the runs: 4.5 to 7.0 on 16 cores.

## The seed of each run

`.claude.json` with completed onboarding, the dummy key's approval and a theme,
and nothing else, except:

| Mode | Run folder trusted | Offline channel gate (`cachedGrowthBookFeatures.tengu_harbor`) | Channel plugin installed |
|---|---|---|---|
| `probe`, `plain`, `no-chrome` | yes | no | no |
| `approved`, `approved-optout` (three) | yes | **yes** | **no** |
| `trust` | **no** | no | no |

## What each run showed

All eight: `run.sh` exit 0, cleanup clean (server gone, pane's process group
gone), sanitation passed, 0 failed captures, no geometry change, 110x35.

| Run | Outcome | First non-blank | First marker | Session banner | Blank / distinct frames of 201 |
|---|---|---|---|---|---|
| `plain` | `no-prompt` at 2600 ms | 501 ms | never | 501 ms | 5 / 28 |
| `no-chrome` | `no-prompt` at 2400 ms | 400 ms | never | 400 ms | 4 / 28 |
| `approved` | `no-prompt` at 2400 ms | 400 ms | never | 400 ms | 4 / 28 |
| `trust` | `blocked: unexpected prompt` at 300 ms | 300 ms | 300 ms, six markers | never | 3 / 2 |
| `approved-optout DISABLE_TELEMETRY` | `no-prompt` at 2600 ms | 599 ms | never | 599 ms | 6 / 35 |
| `approved-optout DO_NOT_TRACK` | `no-prompt` at 2600 ms | 501 ms | never | 501 ms | 5 / 26 |
| `approved-optout CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `no-prompt` at 2600 ms | 500 ms | never | 500 ms | 5 / 33 |

`probe`: `--no-chrome plugin list --json` and `plugin list --json` both exit 0
with a JSON array on stdout and nothing on stderr.

`questionAfterNoPrompt` is false in every run.

## Findings

1. **2.1.288 on Linux accepts `--no-chrome`** in the launch shape and in the
   package-probe shape. With an API-key identity and no browser extension the
   start paints the same with and without it.
2. **A start that asks nothing is never still.** The first non-blank capture is
   the session banner (400 to 600 ms), and the screen goes on changing to the
   end of the 20 s (26 to 35 distinct frames; no settled frame). A rule that
   waited for an unchanged screen would end these as a timeout; "clean for 2 s"
   answers at 2.4 to 2.6 s.
3. **Folder trust is the first thing painted.** The first non-blank capture, at
   300 ms, is the question, with six of the kernel's markers, and it holds
   unchanged for the remaining 19.7 s. No clean capture comes before it, so the
   clean window never starts. In this run there is no gap in which the rule
   could answer `no-prompt` before the question.
4. **Under each of the three telemetry opt-out variables the approved shape
   paints nothing the plain approved run does not.** No marker, no entry of the
   flag-ignored list, one notice block: the same block `plain` has (Claude's
   notice about its default permission mode). `approved` and the three opt-out
   runs all carry one more line, "1 more notice hidden"; `plain` and `no-chrome`
   do not. No frame of any run holds the text of that hidden notice.
5. **So the screen does not say whether Claude took the channel option** in the
   approved shape, with or without an opt-out, in this seed. What the hidden
   notice says was not seen.
6. **The pane's process:** in every capture of every run tmux's
   `pane_current_command` is `sh`, `inspectSessionTarget` answers state
   `unknown`, and the kernel's predicate reads the harness as running from the
   first capture (0 ms). Two processes descend from the pane's process, the
   wrapper's sandbox and Claude, with a few more for single captures.

## Limits

- **`old` was not run:** this host has one Claude, 2.1.288. Nothing was
  installed for it.
- **A dummy-key identity, not an account,** and the channel plugin is not
  installed in the seed. A signed-in account with the plugin may paint the
  approved shape differently. Finding 4 is about this seed.
- **One run per mode.** The times are single readings on a host under load.
- No Chrome mode was run: this host has no extension.
- The first prompt is read from `TASK.md` and then every request to the API is
  refused by the dead port, so each frame after the banner shows Claude's own
  retry line. That is the wrapper's doing, not a start's.
