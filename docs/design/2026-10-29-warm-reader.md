# The warm reader: an app-owned child that answers the poll's reads (#1630)

Status: decided 2026-10-29 (option C of #1630, with the conditions agreed on
that issue). The contract is
[The warm reader](../desktop-cli-api.md#the-warm-reader) in the Desktop CLI
API; when this record and that page disagree, the page wins.

## Context

The Desktop and the TUI poll each served local deployment every few seconds.
Each tick runs two CLI processes, `oats status --dir <D> --max-age 60 --json`
and `oats workspace status --dir <D> --max-age 60 --json`, plus a liveness
collector child: every read is a new process that starts Node and loads the
kernel's code again. The clients must not import kernel code (the
minimal process boundary), and every answer they read is the CLI's public
JSON, validated once.

The kernel answers those two reads from a process the app starts once and
keeps: the same install, the same code, loaded once, answering many times.

## Decisions

### D1. A kernel command, a process, the public JSON

`oats reader --stdio` is a kernel command. It keeps the minimal process
boundary: a client talks to a process in the CLI's own JSON and never imports
kernel code.

Rejected:
- A socket or a service: the reader is owned by the app that starts it, over
  stdin and stdout, and dies with it; nothing to install, register or accept.
- An importable kernel API for clients: it breaks the process boundary.

### D2. One implementation: both reads lifted into `lib/`

The document assembly of `status --json` and `workspace status --json` lives
in `lib/` leaves (`lib/roster-read.mjs`, `lib/workspace-read.mjs`), in two
layers: a data function the CLI's text mode renders from, and an answer
function, `{exit, answer, stderr}`, over it. The answer takes an explicit
context (the absolute `dir`, `maxAge`, the caller's read session, the budget,
the cache, the deployments observer) where there were module-level globals.
The read part of the dispatch is lifted beside them (`lib/read-call.mjs`),
because it is part of the answer: the `--max-age` parse and validation, the
refusal of an inherited `OATS_RESOLUTION` or `OATS_DEPLOYMENT`, and `--team`.
`KERNEL_FEATURES` is a `lib/` leaf imported by `version`, `status` and the
reader. The new modules are leaves (never `core.mjs`, `bin`, or a module they
were split from), every import specifier is one literal, and each piece of
mutable state has one owning module. Every CLI answer is byte-for-byte
unchanged.

Rejected:
- Re-entering `bin`'s dispatch per request: module-level argv globals and
  `process.exit` everywhere.
- Re-evaluating `bin` per request by URL: it leaks module records.
- A second, reader-only assembly: a duplicate of the reads, the option #1630
  rejected.

### D3. Warm code, not warm data: per-request state is enumerated and reset

In a one-shot CLI, process exit is the read path's cache invalidation. The
reader keeps only loaded code and install-derived constants; every request
reads the deployment afresh, and `--max-age` reuse is the CLI's own on-disk
observation reuse, nothing more.

- Every piece of module-level state the reads can reach has a row in
  `READ_STATE` (`lib/read-call.mjs`), with its disposition: reset or scoped
  per call (the local inputs, the resolved-deployment observer, settled at the
  end of each request, the deprecation sources, the remote layer's ssh
  command, git version and protocol pin caches), or safe, with the reason (an
  in-process mutex that cleans itself, WeakMaps keyed on per-request objects,
  install data the stamp of D7 covers, the boot id, pure constant caches). A
  test scans the reads' real import closure, `bin`'s lazy imports included,
  and fails on a binding with no row.
- `lib/session-viewer.mjs` `probed` is safe rather than reset: only an
  attach reads it, and `readSessionViewer` asks `tmux -V` on every call, so
  "afresh at every run" holds without a reset.
- The registry of live git process groups is not state to reset: it is empty
  when a request ends, after its session closed.
- The read session is created when a request starts (its budget deadline is
  fixed then) and closed when it ends. The lifted code takes its session from
  the caller and registers no process listener; the CLI keeps its own
  command session.
- The lifted code reads no working directory. The programs the reads run by
  name (`tmux`, `git`) are found on `PATH`, and a relative or empty `PATH`
  entry resolves against the process's working directory. The reader
  therefore changes its working directory to the request's `--dir` before the
  read and back to its install root when the request ends, answered or
  failed: it never keeps a deployment directory that may be removed or
  unmounted. A `--dir` it cannot change to is refused
  (`E_READER_UNSUPPORTED`), so the CLI fallback gives the CLI's own failure;
  the reader never makes up an answer for it. The equivalence baseline is the
  CLI run with the same environment and cwd = `--dir`. This depends on
  answering one request at a time: a reader that answers two at once must
  first give each child it runs its own working directory.
- Tests answer many requests in one process (alternating deployments,
  `--max-age` absent, 0 and 60, error paths) and compare each answer with a
  fresh CLI run's; a differential test changes the deployment between
  requests (a spawn and a retire by another process, an edited
  `oats-local.yaml` and lock, a killed session, a program added to `PATH`).

Rejected: keeping parsed deployment state between requests, with
invalidation. A missed invalidation gives a plausible wrong answer, not a
crash.

### D4. Every module is loaded once, before the hello

The reads' full closure, the modules they import lazily included, is loaded
before the reader sends its hello, so a hello means ready and no request waits
on a module load. The reader classifies a request with the kernel's hot-read
forms but does not load through the hot-read table, so a `HotReadUnlisted`
tripwire can never reach a reader answer.

`oats reader --stdio` is itself a hot-read form (`lib/hot-reads.mjs`): `bin`
loads only its dispatch's own leaves for it, never `core.mjs` or the other
modules of the full command set, and `lib/reader.mjs`'s own imports, with
`PRELOAD`, load the reads. Every module the reads use, and nothing the CLI's
other commands need, is loaded before the hello (measured on a real
deployment: the hello in 139 ms instead of 299, and about 30 MiB less resident
memory). `test/cli-hot-reads.test.mjs` pins that no heavy module loads before
it.

Rejected:
- Loading on first use, which puts a module load inside the first request's
  deadline.
- Loading the CLI's full module set first, as every command that is no hot
  read does: it adds `core.mjs` and the rest, which no read uses, to the
  reader's start and its memory for its whole life.

### D5. Two reads, one at a time

The reader answers the hot reads `status` and `workspace status`, in arrival
order, one at a time: the state of D3 and the working directory are
process-wide. The protocol lets answers arrive out of order (matched by `id`)
and lists the reads in the hello, so a later kernel can add a read or a
second lane without a contract change; a second lane cannot keep D3's
per-request change of working directory.

Not answered: any remote route (`--server`, `server roster`), which is bound
to ssh and would block the queue; `session inspect` and `instance events`,
which are not on the poll.

### D6. The TUI uses the same child reader, through `packages/client`

The TUI could call the reads directly; it uses the child instead.
`packages/tui` may not import `lib/` (the client boundary test), the install
rule of D7 needs a process that can be restarted, and one client module gives
both apps one fallback path. The cost is one Node start per TUI session.

Rejected: in-process warm reads in the TUI.

### D7. Install change: the reader notices and exits

The reader takes a stamp of its install before any of the kernel's own
modules load (`lib/install-stamp.mjs`, Node built-ins only, which the CLI's
entry point imports statically and calls first for `oats reader`): a stamp
taken once the kernel had loaded would make a change made while it loaded
the baseline, and the old code would answer with no refusal. The stamp is
the install root directory's device and inode; device, inode, size and mtime
of `package.json`, `bin/oats.mjs`, `package-catalog.json`, every file under
`lib/`, `docs/*.schema.json`, each runtime dependency's `package.json` where
it resolves at each stamp (a dependency newly installed nearer the install
shadows the one loaded) and the real path of the Node binary; the mtime of the
directories under `lib/` and of `docs/` (a file added or removed). It takes
the stamp again when a request starts and again just before that request's
answer is written, so an install that changes while a request runs is not
answered from the old code either. Any difference, or a file gone (an npm
global update replaces the package directory; a half-written install also
reads as changed), refuses that request and every queued one with
`E_READER_STALE`, and the reader exits 0. The stamp is about 130 `stat`
calls, within a 2 ms budget. What loads before the first stamp (the entry
point and three small modules of Node built-ins) is a window of a few
milliseconds that no stamp can close.

Rejected:
- Hashing the files: a replaced install has new inodes, and an edited file a
  new size or mtime, so `stat` is enough.
- Timers and file watchers: the stamp is taken on the request path, where a
  change matters, and nowhere else.

A `PATH` symlink re-pointed at another install of the same version is
invisible to any stamp. The client's binding of its reader to the probe
record it started it for covers that case.

### D8. Lifetime belongs to the app

The reader installs its exit and signal handlers once, at start. It exits on
stdin's end or a read error (its app is gone), on `EPIPE` on stdout, on
`SIGTERM`, `SIGINT` and `SIGHUP` (128 + the signal's number), after
`E_READER_STALE` (0) and after `E_READER_DEFECT` (1: per-request state may be
half reset; the stack goes to its stderr). A request in flight when it ends
is not answered: its read session is closed, killing its `git` children.
That cleanup runs from an `exit` handler, because the deployments-list lock
installs signal handlers that call `process.exit` themselves. A reader killed
with `SIGKILL` leaves its git process groups to their own timeouts, as the
CLI does. It writes protocol lines and nothing else to stdout: other writes
go to stderr, and no child on the read path inherits its stdout.

`oats reader` is exempt from the dispatch's refusal of an inherited
`OATS_RESOLUTION` or `OATS_DEPLOYMENT`, so that it starts; each request then
gets the CLI's own `E_UNSUPPORTED_MODE` answer. The `--flag=value` expansion
is the CLI's own (`lib/argv.mjs`), so a malformed flag such as `--max-age=`
gets the CLI's `E_BAD_ARGS`.

Rejected: an idle timer, or a lifetime of the reader's own. The app's
exclusive hold of the reader's stdin is the lifeline: the app's death closes
it.

### D9. The fallback is the CLI read, unchanged

Whenever the reader is absent, refuses, times out or dies, the client runs
that same read through the CLI, exactly as without a reader. This is not an
adapter for an older kernel: one install, one kernel read code, one
validation, no shape translation. The reader is an accelerator of identical
answers, gated on a feature. The reader path adds no validation of its own;
its stderr is never forwarded, as the CLI path forwards none; refusal and
fallback are silent in the app's interface, and their diagnostics go to the
backend's own status (`reader: {state, code}`), not to the renderer.

Rejected: wrapping the reader as an adapter with a translation of its own
(remove, do not wrap): there is one answer shape, and the CLI's validation
reads it.

### D10. The liveness collector leaves the poll, gated on its own feature

`status` rows already carry each local instance's liveness, computed by the
kernel on every call under the pinned pane rule; the kernel is the stronger
observer (wrapper shells, a missing tmux socket answered as unknown). So the
tick drops the collector child, which costs more than the reader's whole
saving target.

- A kernel declares feature `status-liveness` when status rows'
  `running`/`runtimeState` are the complete local liveness reading under the
  pinned pane rule, and only once an inconclusive descendant scan answers
  `running: null` with a reason, never `false` (#1641). A client drops the
  collector where the probe lists it, whether the read went through the
  reader or the CLI: the CLI's `status` is equally live. It is not gated on
  `warm-reader`, a different fact.
- "stopped" versus `running: false`, and the collector's "running"
  `runtimeState`: no consumer distinguishes them. A home with no `tmux`
  record loses the Desktop's terminal open (the collector filled in
  defaults); every spawn records one. No client-side default is added.
- `agentPane` stays for the Desktop's terminal open, pinned by its test. The
  tests of the kernel-unknown decision are re-pointed at kernel rows, not
  deleted.
- The collector, its entry point, its tmux status reader, its inputs and
  answers, the TUI's collector and the "terminal-probe" origin for local rows
  are deleted when the Desktop's accepted range's minimum reaches the release
  that declares `status-liveness`.

Rejected: keeping the collector beside the reader, which pays a second child
per tick for facts the roster already carries.

## Consequences

- One more command whose stdout is not an envelope (`oats reader --stdio`),
  four refusal codes used only on its wire (`E_READER_BAD_REQUEST`,
  `E_READER_UNSUPPORTED`, `E_READER_STALE`, `E_READER_DEFECT`), and the probe
  gains feature `warm-reader` and `readerApi: 1`.
- A new piece of module-level state on the reads' path needs a row in
  `READ_STATE`, or the closure scan fails.
- The working directory is per process: a second lane changes D3 first.
