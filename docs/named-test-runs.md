# Named test runs on macOS and Linux

Pull-request CI runs the tests on Linux, in its own way: sharded, and with no
working `systemctl --user`. One exception: a pull request that touches the TUI
runs the TUI's tests on macOS as well ([The TUI's tests on
macOS](implementation.md#the-tuis-tests-on-macos)). Some tests need something
CI does not give them, and two workflows run them by hand:

- **macOS.** Some tests rest on what only macOS does: a file system that
  ignores case, `/var` and `/tmp` as links, long temporary paths, the BSD
  tools. [`macos-tests.yml`](../.github/workflows/macos-tests.yml) runs named
  test files of a named ref on a macOS runner.
- **Linux, with a user manager.** Some tests drive the runner user's own
  systemd manager, a real `.timer` and `.service` under `systemctl --user`.
  [`linux-tests.yml`](../.github/workflows/linux-tests.yml) runs named test
  files of a named ref on a Linux runner. Before the run, the workflow enables
  lingering for the runner user and waits for that user's manager to answer.

A person starts either one by hand; no push and no pull request ever does. The
link of a run goes on a pull request as that pull request's macOS or Linux
evidence.

Neither is a second CI. A run runs the files you name, each alone, and nothing
else: not `npm test`, not a shard.

Both workflows run one implementation,
[`scripts/named-test-run.mjs`](../scripts/named-test-run.mjs). Each runner's
own part is a small script beside it:
[`scripts/macos-tests.mjs`](../scripts/macos-tests.mjs) and
[`scripts/linux-tests.mjs`](../scripts/linux-tests.mjs). Everything this page
says of "a run" holds for both, unless a section names one runner.

## Starting a run

You need write access to the repository. From a checkout:

```bash
gh workflow run macos-tests.yml --ref main \
  -f ref=my-branch \
  -f files='test/tui-terminal.test.mjs test/fixture-isolation.test.mjs' \
  -f tmux=true
gh run list --workflow=macos-tests.yml --limit 1

gh workflow run linux-tests.yml --ref main \
  -f ref=my-branch \
  -f files='test/some-real-manager.test.mjs'
gh run list --workflow=linux-tests.yml --limit 1
```

Or use the repository's Actions page. Choose **macOS tests** or **Linux
tests**, then **Run workflow**. Leave the workflow's own branch at `main` (see
[What counts as evidence](#what-counts-as-evidence)).

| input | workflow | what it is |
|---|---|---|
| `ref` | both | The commit to test: a branch name, a tag name or a full commit id (40 characters) of this repository. |
| `files` | both | The test files, separated by spaces, commas or newlines. |
| `tmux` | macOS | `true` installs tmux first (`brew install tmux`). Off by default. Tests that need tmux skip without it. |

The Linux workflow has no `tmux` input. Whether tmux is on the runner's `PATH`
is printed in its header like any other fact of the runner.

## What a run accepts

The runner's script checks the whole request before anything of the ref is
checked out, installed or run. A refusal names every entry it refuses and why,
and the run fails having run nothing.

**The ref** must be a commit of this repository: one reachable from a branch
or a tag of `origin`.

- A name is made of `A-Z a-z 0-9 . _ / -`, does not start with `-` and has no
  `..`. A branch whose name has another character is given by its full commit
  id. The text is taken as typed: a space before or after it is refused too.
- A shortened commit id is refused: give all 40 characters.
- **A pull request's number is not accepted.** A pull request from a fork has
  a head that is not this repository's commit, and nothing is ever fetched by
  what you typed. Name the branch, or give the commit id, of a pull request
  whose branch is in this repository.
- A name that is both a branch and a tag is accepted when both are the same
  commit. Otherwise give the commit id of the one you mean.

**Each file** must match `test/**/*.test.mjs` or
`packages/<name>/test/**/*.test.mjs`, with path segments made of
`A-Z a-z 0-9 . _ -`, none starting with a dot. It must be a regular file at
that commit, not a symbolic link. A file named twice runs once.

## What a run does and prints

The job checks out two trees. `runner/` is the workflow's own commit, and the
script runs from it. `tested/` is the ref. Two trees are for two things: a
ref older than the workflow can be tested, and an honest branch cannot change
the runner by accident. They are not a defence against a commit that sets out
to forge its result (see [What a run does not protect](#what-a-run-does-not-protect)).

On Linux, two steps come before the validation, so that its header can report
their effect:

1. `sudo loginctl enable-linger "$USER"` starts the runner user's systemd
   manager without a login session. It is the only privileged step, and
   nothing is installed system-wide.
2. `XDG_RUNTIME_DIR=/run/user/<uid>` is set for the later steps, through
   `$GITHUB_ENV`, so that `systemctl --user` finds the manager.

After the validation, the job installs as pull-request CI does: `npm ci` at
the root, then in `packages/desktop` without the Electron binary. Then it runs
each file alone, one after another, as a developer does: `node --test <file>`
from the root of the ref's tree.

The step **Validate the request and check out its commit** prints a header,
before any code of the ref has run. The header gives:

- the commit under test (full id) and the ref that was asked for;
- the workflow's own ref and commit, as the script reads them. Where a run
  really ran from is GitHub's record of it, not this line: see
  [What counts as evidence](#what-counts-as-evidence);
- on macOS, the macOS version; on Linux, the distribution and the kernel;
- the runner image and the architecture;
- on Linux:
  - `XDG_RUNTIME_DIR`;
  - whether lingering is on for the runner user (`loginctl show-user`);
  - **whether the user manager answered**, with which state, how many
    times it was asked and how long that took. Lingering only queues the
    manager's start, so the step waits for it, at most 60 seconds in all.
    Until the manager's bus is there, `systemctl --user` answers at once
    (`offline` or `unknown`), so the step asks again every half second.
    Once the bus is there, `systemctl --user is-system-running --wait` waits
    for the manager to finish starting. `running` and `degraded` count as an
    answer. `degraded` is a running manager with a failed unit, which the
    image may have of its own;
- the Node version;
- whether the file system is case-sensitive, measured there (a file is made,
  then looked for by another case);
- whether `tmux` is on `PATH`, and its version;
- whether a socket is at tmux's default place for the server named `oats`.

Its last line says so: `Everything above this line was printed before any code
of the ref ran.` On Linux, a user manager that did not answer ends the step
there instead. The header says what was answered, then `Refused: nothing was
installed or run.`, and the run fails before anything is installed.

The step **Run each file alone** prints the header again before the first
file. It is read after the installs, and the step says that it is the second
reading. On Linux the user manager is asked again, without waiting. If it does
not answer, no file runs and the run fails.

For each file the log has its output, then its counts (tests, passed, failed,
skipped, cancelled, todo), its exit status and its duration. One table of all
files ends the log, and the job's summary page repeats it.

**What fails a run:**

- A file fails when its exit status is not 0. A file that ends with status 0
  and prints no summary, or whose summary counts a failed test, fails too. The
  files after a failing one still run.
- A file that has not ended after its time is killed with its whole process
  group and reported as timed out. The run goes on.
- **A tmux server left on the default socket.** A fixture that fails to
  isolate its tmux server starts one at tmux's default place
  (`<dir>/tmux-<uid>/oats`, where `<dir>` is `TMUX_TMPDIR`, else `/tmp`). On a
  clean runner nothing fails because of it. So the script looks at that place
  before the first file and after each file. The file after which a socket
  first exists is marked in the table, and the run fails. Nothing is killed or
  removed. If a socket is there before the first file, the header says so and
  the check is skipped for that run.
- **On Linux, a user manager that does not answer**, at either step (above).

A file in which no test passed (every test skipped, for example without tmux,
or outside the workflow its guard names) is marked `no test passed`. It does
not fail the run.

## Guard contract

A test that only means something on one of these runners guards on facts the
runner gives it. Each workflow's `name:` is part of that guard, and it is a
contract: the workflow tests pin it (`test/macos-tests-workflow.test.mjs`,
`test/linux-tests-workflow.test.mjs`). Renaming a workflow turns every test
that guards on it into a skip.

| runner | the test runs only when |
|---|---|
| macOS | `GITHUB_WORKFLOW` is `macOS tests`, `GITHUB_EVENT_NAME` is `workflow_dispatch`, and `process.platform` is `darwin` |
| Linux | `GITHUB_WORKFLOW` is `Linux tests`, `GITHUB_EVENT_NAME` is `workflow_dispatch`, and `process.platform` is `linux` |

The run passes its environment to each file as a developer's shell would. It
leaves out the request's two variables, the runner's command files
(`GITHUB_ENV`, `GITHUB_OUTPUT`, `GITHUB_PATH`, `GITHUB_STATE`,
`GITHUB_STEP_SUMMARY`) and node's nested-run marker. So `GITHUB_WORKFLOW` and
`GITHUB_EVENT_NAME` reach the test, and on Linux so does `XDG_RUNTIME_DIR`.

A guard is a switch, not a proof. Anyone can set these variables on their own
machine, and a guarded test that runs there drives that machine's real
manager. A guarded test outside its runner skips, and a run of only skips is
not evidence (below).

## What counts as evidence

**A run is evidence for a commit whose diff has been reviewed.** A run of a
commit that nobody has read proves nothing about it: from its first install
step on, the commit's own code runs on the runner and can change what the run
prints (see [What a run does not protect](#what-a-run-does-not-protect)).

The pull request gives **the run's link**. From it, a run is evidence when all
of this holds. The first condition comes first because the others rest on it.

1. **The workflow ran from `main`, by GitHub's own record of the run.** Not
   by the log. A run started from another branch uses that branch's workflow
   file and that branch's script, so every line of its log, the header
   included, is text that branch wrote. Ask GitHub about the run instead:

   ```bash
   gh run view <run id> --json event,headSha,workflowName
   git fetch origin
   git merge-base --is-ancestor <headSha> origin/main; echo $?
   ```

   `event` must be `workflow_dispatch`. `workflowName` must be `macOS tests`
   for macOS evidence, or `Linux tests` for Linux evidence. The last command
   must print `0`: the workflow's commit is a commit of `main`. Anything else
   is not a pass: `1` means the commit is not on `main`, and an error means
   your clone does not have it. Check the commit, not the run's branch name: a
   tag can carry a branch's name.
2. The `commit under test` in the validation step's header **equals the head
   under review**. A run of an earlier head is evidence for that head only.
3. The run passed, and no file the pull request relies on is marked `no test
   passed`. **A run of only skips is not evidence.**

The header also prints a `workflow ref` line. It is a convenience for
reading a run, and it is not proof of where the workflow ran from: the
workflow prints it.

With the first condition met, the log is the evidence. The job's summary page
is a convenience.

## Bounds

These are constants of the scripts, not inputs:

| bound | macOS | Linux |
|---|---|---|
| files in one run | at most 10 files | at most 10 files |
| time for one file, then its process group is killed | 5 minutes | 20 minutes |
| time for the job | 60 minutes | 240 minutes |
| wait for the user manager | none | 60 seconds at the validation step |
| runner | `macos-14` (arm64), Node 22 | `ubuntu-24.04` (x64), Node 22 |

A Linux file gets 20 minutes because the files that qualify the record
capture at scale ([#1108](https://github.com/awebai/oats/issues/1108)) run
capture passes of up to 300 seconds, and a first upgrade may need several.
The Linux job's 240 minutes hold ten such files and the installs, under
GitHub's 6-hour limit for a job.

The workflows' steps upload no artifact and save or restore no cache: the log
and the summary are all they leave. The token can read the repository's
contents and do nothing more, and the workflows name no secret. The code a
run executes can reach more than the workflow's own steps do: see
[What a run does not protect](#what-a-run-does-not-protect).

## What a run does not show

- **A clean machine, not yours.** The runner is a fresh image for each run.
  It has no person's `PATH`, shell profile or login environment, and nothing
  of an earlier run.
- **No real terminal.** No terminal emulator is attached to the tests.
- **One version and one architecture**: the image's, printed in the header.
- **A killed file's leftovers.** The script kills the process group of a file
  that timed out. A tmux server has left that group by design, so a tmux
  server of a killed file stays, and it is that test's to explain. On Linux,
  a unit a test started under the user manager is not in the file's process
  group either: it is the test's to stop.
- **Nothing about `main`.** A run started from `main` is listed among the
  runs of main's head commit (`gh run list --commit <sha>`). It is also among
  that commit's check runs, as `Named test files on macOS` or
  `Named test files on Linux`. Its result is about the ref under test. It
  says nothing about `main`, a failed run included. The commit's status
  rollup does not hold these runs. A hand-started run can be the newest run
  on `main`. So whoever checks `main` after a merge lists the runs by
  workflow (`gh run list --workflow CI --branch main`) or reads the commit's
  status rollup.

**What a Linux run does not show: a person's machine.** The user manager is
real systemd, but it runs on a hosted VM, not on a person's computer:

- The runner user has no login session. No PAM session was opened, no
  graphical session exists, and no seat is assigned. Lingering, which the
  workflow switched on, is what starts the manager. On a person's machine,
  logging in starts it, and lingering is usually off: there, a user's timers
  stop when the person logs out.
- The manager has none of a person's own units, environment
  (`systemctl --user show-environment`) or `~/.config/systemd/user`. It has
  only what the image and the test put there.
- It is one distribution, one systemd version and one image: Ubuntu 24.04,
  as printed in the header. Another distribution's systemd or defaults are
  not covered.
- Time is the VM's. A run shows what a timer does within the file's 20
  minutes. It does not show a timer's behaviour across a suspend, a reboot or
  days.

So a Linux run is evidence that the code drives `systemctl --user` correctly
on a working user manager. It is not evidence of how the code behaves on a
person's machine, which still needs a person's run there.

A pull request that asks for a person's run on a Mac still gets one.

## What a run does not protect

After the validation, the ref's own code runs on the runner as the runner's
user: its install scripts, then its tests. Pull-request CI does the same for
every branch.

**Protected, in a run whose workflow commit is `main`'s: the validation and
the header.** They are printed from the workflow's own commit, before any
code of the ref has run. A commit under test cannot change which commit the
header names, or get a refused request past it. In a run started from another
branch nothing is protected: the workflow and the script are that branch's
(see [What counts as evidence](#what-counts-as-evidence)).

**Not protected: everything after the first install step**, the per-file
results and the table included. From there on, the ref's code can change
anything the runner's user can, and so what the later steps print. The result
is as honest as the commit. On Linux that includes the user manager: the
ref's code can start, stop or change its units.

**Where the check is.** A forgery has to be in the commit's own tree, its lock
file included. The evidence names that exact commit, and the reviewer of the
pull request reads its diff. Pull-request CI has the same property.

**The cache scope of the default branch.** A run started from the default
branch belongs to it, and executes another branch's code. Such code can reach
that run's Actions cache scope, which every branch reads. Only somebody with
write access can do it, by pushing the branch and starting the run. In the
maintainers' words: a run of this workflow can write the default branch's
cache scope; nothing reads it; a workflow that starts to restore a cache
reopens this. No workflow of this repository restores an Actions cache, and
the repository's tests keep it so.

**The job's token.** It is within reach of the code a run executes. It can
read this repository's contents and nothing else, and that is why neither
workflow's `permissions` ever grows.

**Root on the Linux runner.** The hosted Linux runner's user can use `sudo`
without a password: that is how the workflow enables lingering. The ref's
code can use it too. The VM is discarded after the run, and the token's
reach does not grow with root.

## What the first Linux run from `main` proves

The Linux workflow can only be proven by a run of it from `main`. Its first
run, of an existing test file and a short check that `systemctl --user`
works, shows three things:

- the workflow starts and validates as the macOS one does;
- lingering and `XDG_RUNTIME_DIR` give that image a user manager that answers
  within the bound. The header states the answer, how many times the manager
  was asked and how long it took: an answer at the first ask, well under the
  bound, shows that image did not need the wait;
- the installs and a per-file run work on that image.

It does not show what a guarded test sees, or does. The run's environment has
the facts the [Guard contract](#guard-contract) names, but no test file of
this repository guards on them yet. A guarded file's behaviour is shown when
such a file is dispatched, by its own run. The first run also does not show
that a later image still answers: every run's header says so again.

## The terms

The maintainers agreed these terms, the same for both workflows.
`test/macos-tests-workflow.test.mjs` and `test/linux-tests-workflow.test.mjs`
read the workflow files and pin each one, through the checks they share in
`test/helpers/named-tests-workflow.mjs`:

- `workflow_dispatch` is the only trigger;
- `permissions` is exactly `contents: read`; no secret is named; no artifact
  is uploaded; no step saves or restores a cache;
- no input is written into a shell line: the ref and the file list reach the
  script as environment variables;
- the checkout is the workflow's own commit, without its token left in the
  checkout's configuration;
- the job has a timeout, and its concurrency group is its own and one per
  run, so no later run cancels an earlier one;
- each workflow's `name:` is the one in [Guard contract](#guard-contract).

Change a bound or a term with the maintainers' decision, and change this page
and those tests in the same commit.
