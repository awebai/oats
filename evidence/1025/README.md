# Evidence kit and measurements: what a test run leaves behind (awebai/oats#1025)

A record for whoever continues awebai/oats#1025 (part B, piece 2 of the test-infrastructure
work). It is not code of the repository and never a pull request. The work itself is on
`agents/oats-kernel-developer-fixture-inheritance-leftovers` (head `334be5d1`, base
`7d15b890`); its state and the three open review findings are in the hand-over brief.

The same directory also served the pieces before it, so some files belong to
awebai/oats#1010 (merged as #1045) and #910 (merged as #1070). Each entry below says which.

## Where it ran, and the placeholders

Everything here lived in one directory of the host, `/var/tmp/okd-fi`, and the scripts still
name it by that path. They are kept as they ran, except for host specifics:

- `$OATS_INSTANCE_HOME` (in shell scripts) and `<INSTANCE_HOME>` (in data) stand for the
  instance home that held the work trees (`.work-leftovers`, `.work-real-env`,
  `.work-warnings`).
- `$HOME` (in shell scripts) and `<HOME>` (in data) stand for the user's home directory.
- `<CLONE>` stands for the shared clone of the repository, `<SCRATCH>` for a session's
  scratch directory.

Node binaries: the host's `node` was v26.8.2; Node 22 was v22.23.3, run by its path with its
directory first on `PATH` (`$HOME/.local/share/mise/installs/node/22.23.3/bin/node`).

The raw output of the runs (each file's `.out`, the probes' `.jsonl` logs, CI logs, mail
bodies) is not here: it went to the instance home, which is kept with the instance's
recovery copy.

## The sandbox (all pieces)

Every local run was one test file at a time, never a batch, never the root suite, in the
maintainer's sandbox:

    bwrap --dev-bind / / --tmpfs /tmp --unshare-pid --proc /proc --die-with-parent --chdir /tmp env -u TMPDIR setsid -w node --test <absolute path of the file>

- `sbx.sh <node> <file>`: that command, plus a last line `@@LEFT <entries>`: what the file
  left in the sandbox's `/tmp`.
- `sbx-args.sh <node> <args...>`: the same with node's arguments given whole.
- `sbx-probe.sh`, `sbx-frames.sh`, `sbx-mkdtemp.sh`, `sbx-warn.sh`: the same with one probe of
  `probe/` loaded (`--import`, or `NODE_OPTIONS` so that node children load it too); each names
  its log by an environment variable given in its header.

## #1025, piece 2: what a test run leaves behind

Drivers:

- `p2g/one.sh <node> <tree> <file>`: one file as the root run (`scripts/run-tests.mjs`) starts
  it: a run directory `ot-XXXXXX`, the preload `scripts/test-file-tmpdir.mjs` of the tree
  giving the file its own temporary directory. Prints `@@FILE` (the name the preload records),
  `@@LEFT` (what is left in the file's directory: what the guard reads), `@@OUTSIDE` (what the
  file made in `/tmp` outside it: what the guard cannot see) and `@@RUN`.
- `p2f/run.sh [list] [summary]`: `one.sh` for each line `<file> <times>` of a list, on both
  Nodes. One TSV row a run: node, file, run number, exit, counts, entries left, entries outside,
  then the entries.
- `p2s/run.sh`, `p2s/resume.sh`: the sweep of every test file of the repository through
  `one.sh`, host Node; `resume.sh` continues where it stopped.
- `p2c/run.sh`, `p2m/run.sh`: earlier measurements of the edited files in plain `sbx.sh`
  (what each leaves in `/tmp`, counted, never cut).
- `p2w/wait-probes.sh <node> <tag> <N> <M>`: the probe copies of the two files that start
  Desktop servers, in their waiting form (see `probe/make-wait-probes.py`), N and M runs.
- `p2x/run.sh <node> <tag> <list> <after...>` and `p2x/one-fail.sh`: the failure-injection
  runs: each file of `p2x/list.txt` (the 27 edited test files) with `probe/inject-fail.mjs`,
  which makes every assertion throw from number `<after>` on, so what a failing test leaves is
  what the file's directory shows. Expected: exit not 0, failures, nothing left, nothing
  outside. **Never run**: the work stopped before it (the reviewer of round 1 asked for it).
  Example: `p2x/run.sh "$(command -v node)" n26 p2x/list.txt 0 5`.

Probes (`probe/`):

- `mkdtemp-probe.mjs`: logs each `mkdtempSync` whose name matches `MKDTEMP_PROBE_MATCH`, and
  each `rmSync` of it, with the process and the stack. It established the cause of the
  unremoved `oats-tmux-*` directories (run with `sbx-mkdtemp.sh`).
- `fake-probe.mjs`, `make-fake-probes.py`, `fake-account.py <log>`: probe copies of
  `test/desktop-server.test.mjs` and `test/desktop-cli-integration.test.mjs` whose fake CLI
  logs its start, first line and exit; the account shows fake CLI processes still running after
  the test's hook had seen its servers exit (the writer a retry or a rename would have hidden).
- `make-wait-probes.py <tree>`, `wait-account.py <log>`: the same files in the waiting form
  (the server's process group waited for); the account shows what each group still held when
  its server had exited, and that nothing ran after a hook found its groups empty. Its copies
  are `test/zz-probe-*.test.mjs` in the tree, to be deleted after use; check its patterns
  against the tree before reusing it.
- `inject-fail.mjs`: see `p2x` above.

Drafts and messages:

- `draft/process-group.mjs`, `draft/process-group.test.mjs`: `test/helpers/process-group.mjs`
  and `test/process-group.test.mjs` as committed in `334be5d1` (start a process as the leader of
  its own group, wait for the group on close, pass an interrupt on).
- `msg/amend-eight.txt`, `msg/amend-desktop.txt`: the commit messages, already reworded, for
  folding `334be5d1` into the commits it belongs to (the "eight more files" commit and the
  Desktop-server commit) with `--fixup=amend:` and an autosquash rebase.

Measurements (summaries and lists):

- `leftovers.txt`, `measured.txt`: before any fix, file by file, what each test file left in
  the temporary directory, and the files measured (from the suite runs of #1010).
- `p2/` (outputs only, in the home), `p2b/summary.txt`: the four files that end their
  deployment fixture, before and after.
- `p2c/summary.txt`, `p2c/summary-ten-files.txt`: the edited files in plain `sbx.sh`, both Nodes.
- `p2m/list.txt`, `p2m/summary.txt`: the measurement of 47 files that leave something.
- `p2s/list.txt`, `p2s/summary-n26.tsv` (669 files, Node 26), `p2s/list-n22.txt`,
  `p2s/summary-n22.tsv`: the sweep. Columns: file, exit, counts, entries left, entries
  outside, then the entries.
- `p2f/list*.txt`, `p2f/summary*.tsv`: the edited files as committed, both Nodes:
  `summary.tsv`/`summary-rest.tsv` (all edited files), `summary-wait.tsv` (5 runs a Node, wait
  inline), `summary-wait2.tsv` (3 runs a Node, the helper form at `618553e3`),
  `summary-pg.tsv` (the helper's own test), `summary-delta.tsv` (at `334be5d1`: process-group
  3 runs, desktop-server 3, desktop-cli-integration 2, a Node). All pass, nothing left,
  nothing outside.

## #1010 (merged as #1045): a fixture forces its environment on the real process.env

- `standin/tmux`, `standin2/tmux`, `standin2/git`: stand-ins first on `PATH` that log each call
  (`TMUX_TMPDIR` and arguments; `HOME`, `GIT_CONFIG_GLOBAL` and arguments) and answer like a host
  with no tmux server. `standin2/git.tsv` is the git log of one run (2203 calls made with the
  user's real `HOME`, shown as `<HOME>`); `standin/calls.tsv` is empty.
- `probe/probe.mjs`, `probe/probe-frames.mjs`: log each child a test worker starts: whether it
  was given `env`, and whether `process.env` was then a replacement (from Node v26.11.0 such a
  child gets the real environment). `probe/analyze.py <name>` and `probe/tmux-calls.py <log>`
  read those logs.
- `run-e.sh`, `list-e.txt`, `summary-e.txt`: the loop of 43 files at `634a333a` in `sbx.sh`.
- `summary-b.txt`: the earlier loop of the suite at `803e95e9`.

## #910 (merged as #1070): unasserted warnings

- `probe/stderr-probe.mjs`, `sbx-warn.sh`, `warn/run.sh`, `warn/analyze.py`, `warn/list.txt`,
  `warn/summary.txt`: every `oats: warning:` line a test file's processes wrote, and from where,
  before the change.
- `fb/`, `fb2/` (`run.sh`, `summary.txt`): runs with each expectation's end logged.
- `fin/` (`run.sh`, `summary.txt`): the final head, no debug line.
- `r2/` … `r9/` (`summary.txt`): the runs of the review rounds.
