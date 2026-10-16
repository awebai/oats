# macOS test runs

Pull-request CI runs the tests on Linux only. Some tests rest on what only
macOS does: a file system that ignores case, `/var` and `/tmp` as links, long
temporary paths, the BSD tools. The workflow
[`macos-tests.yml`](../.github/workflows/macos-tests.yml) runs named test files
of a named ref on a macOS runner. A person starts it by hand; no push and no
pull request ever does. The link of its run goes on a pull request as that
pull request's macOS evidence.

It is not a second CI. It runs the files you name, each alone, and nothing
else: not `npm test`, not a shard.

## Starting a run

You need write access to the repository. From a checkout:

```bash
gh workflow run macos-tests.yml --ref main \
  -f ref=my-branch \
  -f files='test/tui-terminal.test.mjs test/fixture-isolation.test.mjs' \
  -f tmux=true
gh run list --workflow=macos-tests.yml --limit 1
```

Or on the repository's Actions page: choose **macOS tests**, then **Run
workflow**. Leave the workflow's own branch at `main` (see
[What counts as evidence](#what-counts-as-evidence)).

| input | what it is |
|---|---|
| `ref` | The commit to test: a branch name, a tag name or a full commit id (40 characters) of this repository. |
| `files` | The test files, separated by spaces, commas or newlines. |
| `tmux` | `true` installs tmux first (`brew install tmux`). Off by default. Tests that need tmux skip without it. |

## What a run accepts

The script [`scripts/macos-tests.mjs`](../scripts/macos-tests.mjs) checks the
whole request before anything of the ref is checked out, installed or run. A
refusal names every entry it refuses and why, and the run fails having run
nothing.

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

After the validation the job installs as pull-request CI does (`npm ci` at
the root, then in `packages/desktop` without the Electron binary). Then it
runs each file alone, one after another, as a developer does: `node --test
<file>` from the root of the ref's tree.

The step **Validate the request and check out its commit** prints a header,
before any code of the ref has run:

- the commit under test (full id) and the ref that was asked for;
- the workflow's own ref and commit, as the script reads them (where a run
  really ran from is GitHub's record of it, not this line: see
  [What counts as evidence](#what-counts-as-evidence));
- the macOS version, the runner image and the architecture;
- the Node version;
- whether the file system is case-sensitive, measured there (a file is made,
  then looked for by another case);
- whether `tmux` is on `PATH`, and its version;
- whether a socket is at tmux's default place for the server named `oats`.

Its last line says so: `Everything above this line was printed before any code
of the ref ran.` The step **Run each file alone** prints the header again
before the first file, read after the installs, and says that it is the second
reading.

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

A file in which no test passed (every test skipped, for example without tmux)
is marked `no test passed`. It does not fail the run.

## What counts as evidence

**A run is evidence for a commit whose diff has been reviewed.** A run of a
commit that nobody has read proves nothing about it: from its first install
step on, the commit's own code runs on the runner and can change what the run
prints (see [What a run does not protect](#what-a-run-does-not-protect)).

The pull request gives **the run's link**. From it, a run is macOS evidence
when all of this holds. The first condition comes first because the others
rest on it.

1. **The workflow ran from `main`, by GitHub's own record of the run.** Not
   by the log. A run started from another branch uses that branch's workflow
   file and that branch's script, so every line of its log, the header
   included, is text that branch wrote. Ask GitHub about the run instead:

   ```bash
   gh run view <run id> --json event,headSha,workflowName
   git fetch origin
   git merge-base --is-ancestor <headSha> origin/main; echo $?
   ```

   `event` must be `workflow_dispatch` and `workflowName` must be `macOS
   tests`. The last command must print `0`: the workflow's commit is a commit
   of `main`. Anything else is not a pass: `1` means the commit is not on
   `main`, and an error means your clone does not have it. Check the commit,
   not the run's branch name: a tag can carry a branch's name.
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

These are constants of the script, not inputs:

| bound | value |
|---|---|
| files in one run | at most 10 files |
| time for one file | 5 minutes, then its process group is killed |
| time for the job | 60 minutes |
| runner | `macos-14` (arm64), Node 22 |

The workflow's steps upload no artifact and save or restore no cache: the log
and the summary are all they leave. The token can read the repository's
contents and do nothing more, and the workflow names no secret. The code a run
executes can reach more than the workflow's own steps do: see
[What a run does not protect](#what-a-run-does-not-protect).

## What a run does not show

- **A clean machine, not yours.** The runner is a fresh image for each run.
  It has no person's `PATH`, shell profile or login environment, and nothing
  of an earlier run.
- **No real terminal.** No terminal emulator is attached to the tests.
- **One macOS version and one architecture**: the image's, printed in the
  header.
- **A killed file's leftovers.** The script kills the process group of a file
  that timed out. A tmux server has left that group by design, so a tmux
  server of a killed file stays, and it is that test's to explain.
- **Nothing about `main`.** A run started from `main` is listed among the
  runs of main's head commit (`gh run list --commit <sha>`) and among that
  commit's check runs, as `Named test files on macOS`. Its result is about
  the ref under test. It says nothing about `main`, a failed run included.
  The commit's status rollup does not hold these runs. A macOS run can be the
  newest run on `main`, so whoever checks `main` after a merge lists the runs
  by workflow (`gh run list --workflow CI --branch main`) or reads the
  commit's status rollup.

So a pull request that asks for a person's run on a Mac still gets one.

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
is as honest as the commit.

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
read this repository's contents and nothing else, and that is why this
workflow's `permissions` never grows.

## The terms

The maintainers agreed these terms. `test/macos-tests-workflow.test.mjs`
reads the workflow file and pins each one:

- `workflow_dispatch` is the only trigger;
- `permissions` is exactly `contents: read`; no secret is named; no artifact
  is uploaded; no step saves or restores a cache;
- no input is written into a shell line: the ref and the file list reach the
  script as environment variables;
- the checkout is the workflow's own commit, without its token left in the
  checkout's configuration;
- the job has a timeout, and its concurrency group is its own and one per
  run, so no later run cancels an earlier one.

Change a bound or a term with the maintainers' decision, and change this page
and that test in the same commit.
