## Upgrade

<!-- release order: restate at rebase checkpoint -->
- The bounded periodic capture service follows the already released 0.56.0,
  0.57.0 and 0.58.0; none of those versions ships it. Until a release explicitly
  includes the service, follow the installed version's Upgrade section. For
  the service release, install its compatible Desktop before its CLI, update
  the pi bridge, then run that CLI's setup conversion in each deployment from
  the operator's shell. Do not use these flags/diagnostics as pre-upgrade
  prerequisites on 0.56–0.58. See
  [capture service release order](../upgrading.md#capture-service-release-order).
<!-- end release order -->
- Run `oats setup` (standalone: `turn-record setup`) once per deployment, from
  the operator's shell, with the deployment's owner and root. Installing the CLI
  alone converts nothing: persisted hooks and manager definitions change only
  when setup runs. Owned capture watchers convert to the periodic service there.
  A foreign, disabled or masked definition is refused before any change, with
  two printed commands that keep the owner and root: `--replace-service` to
  replace only the named capture service, or `--no-service` to keep the
  operator's service and skip service files and manager calls. Repair unknown
  or unreadable state before retrying; replacement never waives it.
  `--dry-run` writes nothing and calls no manager. Keep the backups setup
  reports under `<root>/service-backups/`.
- Setup rewrites the owned `Stop`/`SessionEnd` capture hooks in every
  `~/.claude*/settings.json` from `async: true`, `timeout: 120` to
  `--quiet --hook` with `async: false`, `timeout: 10`, even where the command
  already matches. Until setup runs, the persisted hooks keep the old fields.
- Setup applies the service before it writes hooks. A service refusal or
  failure now exits 1, writes no hooks and skips the first capture pass.
  Inspect the reported files and manager state, then run the printed command.
  On Linux, a timer whose first activation failed reads as disabled, so a plain
  rerun is refused with `E_CAPTURE_SERVICE_DISABLED`; choose `--replace-service`.
  Apply has no atomic rollback: a manager failure can leave backups, stopped
  jobs or written definitions in place.
- After conversion, check `oats capture --health` (or
  `turn-record capture --health`) against the intended root, and the capture
  warnings of `oats doctor`, keeping the same `HOME` and `TURN_RECORD_ROOT`.
  Definition files, an `ok` diagnosis or no warnings do not prove the schedule
  is registered and enabled. A missing recent success can reflect sleep or an
  off-host machine; progress or cleared issues alone are not success. Update
  the CLI before relying on complete piped health output.

## Changed

- **Capture runs as bounded supervised passes.** Ordinary capture,
  `--sessions-only`, `--aw-only`, `--no-index` and `--retry-set-aside` run one
  pass through a fixed supervisor and worker under the root lock. A partial
  pass exits 0 with work pending; an operational failure exits nonzero; a
  missing worker receipt is reported as unknown, never as zero counts. Ordinary
  lock overlap exits 0 and keeps the holder's receipt; a recovery that overlaps
  is not performed and exits 1. `index: updated` is printed only for a complete
  pass with indexing enabled. `--no-index` appends without opening the search
  index and never reports a fresh all-stage success. Ordinary `--json` stays a
  usage error and retry JSON keeps `{appended, pending}`. `--reset-cursors`,
  the exact `--home`/`--file` proofs and the public synchronous APIs keep their
  contracts.
- A pass resumes across worker replacement: source discovery, the index
  inventory, index reset (separately admitted, atomic), retained recovery
  cleanup and run accounting all commit in bounded pages. Interrupted work keeps
  its retry evidence and backs off 30, 60, 120, then 240 minutes while healthy
  work continues. Success is recorded only after an all-stage audit of sources,
  index, admissions, retries and cleanup.
- A raw source record over 8 MiB is never allocated whole or captured. The
  complete records before it are captured, and the input is set aside at that
  record's start offset. Records after it stay pending until the operator edits
  the source or adds the whole input to `<root>/ignore`; `--retry-set-aside`
  retries the input, but the oversized record still blocks it, in every case.
  Native recovery (after cache loss, a reset, a retry or a rewritten source)
  that meets an oversized record beyond the captured part captures the records
  before it, then sets the input aside at its start. Known limitations: an
  oversized line before a session's first timestamped line captures nothing
  before it; and, pending a design decision, an oversized record inside the
  already captured part (captured by a release without this limit) makes each
  such recovery set the captured input aside, so its later growth is not
  captured. `--health` names the edit-or-ignore remedy for these entries.
- Foreground `--watch` keeps its two-second debounce and 15-minute fallback,
  runs one pass at a time and coalesces notifications into one pending rerun.
- **Hooks launch capture detached.** `capture --hook` starts the supervisor in
  its own session without the harness's pipes. Exit 0 means **capture
  launched**, not initialization or completion; launch and usage errors exit 1,
  never Claude's Stop-blocking 2. The harness waits only for the launcher;
  no launch latency is measured. Foreign hooks, groups and unrelated fields are
  kept, and `--install-hint` prints the same fields, keeping
  `--sessions-only --no-index`.
- **Setup installs a periodic service.** On macOS,
  `ai.aweb.turn-record-capture` runs at load and every 900 seconds
  (`StartInterval`), with no `KeepAlive`. On Linux, a finite
  `turn-record-capture.service` (`MemoryMax=2G`, `RuntimeMaxSec=300`, no
  restart) is started by `turn-record-capture.timer` one minute after boot and
  every 15 minutes. Each start runs one pass with all sources and indexing.
  Setup reports "periodic capture scheduled (every 15 minutes)" only after
  verifying registration and enablement, never a permanent PID. An unchanged,
  enabled schedule is left running, preserving a pass in flight.
- Setup takes `--root`, `--replace-service`, `--no-service` and `--dry-run`, and
  preflights every named service file, the manager state and the hook edits
  before changing anything. `E_CAPTURE_SERVICE_FOREIGN` refuses definitions or
  registrations it does not own; on macOS that includes a registration of the
  capture label from another plist path, refused naming that path even with
  `--replace-service`. `E_CAPTURE_SERVICE_DISABLED` states the manager state it
  observed, without claiming the operator disabled it. Refusals and failures
  print the user-facing command with the selected `--owner` and `--root`:
  `oats setup …` when the kernel environment handed in a node (`OATS_NODE_BIN`,
  also set in instance shells), otherwise `turn-record setup …`; both record
  the same node.
- Setup's first pass runs through the same supervisor with `setup` attribution,
  all sources and indexing, under the running Node; the hooks and service record
  a stable Node. `--no-service` still runs it and `--dry-run` starts none.
  Partial and overlapping passes exit 0 without claiming completion.
- **`capture --health [--json]`** distinguishes no installation, unknown
  evidence, missing or invalid status, stale or absent success, newer failures,
  unfinished runs and owned capture watchers that need setup. It reads no source
  content or manager state and changes nothing. Reader failures exit nonzero;
  warnings exit 0. Reads are bounded, with a cooperative deadline.
- **`oats doctor`** runs package capture health once, with a finite timeout and
  output bound, and turns its rows into warnings. A failed, timed-out or invalid
  health run is `capture-health-unavailable`. Remedies say `oats` under the
  kernel and `turn-record` standalone. Doctor's exit and output contracts are
  unchanged.
- `recall --thread <thread> --json` lists a thread in capture sequence. For a
  thread spanning aweb accounts the cross-account sequence is unspecified, and
  an ID window may contain turns from more than one account. Text thread
  listings without a query stay timestamp-sorted.
- Real macOS and Linux manager lifecycle, storage and synchronization costs, and
  full hosted service qualification are verified separately from the isolated
  fixtures.

## Fixed

- Capture CLI reporting finishes naturally, so piped stdout and stderr drain
  before exit: health samples, truncation banners, JSON receipts and error
  messages are no longer cut off. Exit codes are unchanged, and health cannot
  fall through to a capture.
