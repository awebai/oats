# Capture algorithms and recovery

The record package owns source cursors, journal validation, indexing and capture
status. This version changes those algorithms; it does not install a bounded
runner or change service scheduling, hooks, root registration or doctor.

## Input contract

Input logs are append-only: capture reads added content, rereads on replacement,
shrink or checkpoint mismatch, cannot see arbitrary edits to an already-read
prefix that leave those checks intact, and `capture --reset-cursors` is the
remedy. This assumption applies to aweb logs and cc/pi/codex transcripts. It
relies on the native writers appending to existing transcript files.

The background cursor qualifies file identity, size, modification/change times
and a SHA-256 witness of at most 4 KiB before its byte boundary. An unchanged
version needs no historical content scan. Growth with the same identity and
witness resumes from the boundary. The witness does **not** prove that the
unobserved prefix is untouched. Explicit `captureCommLog` and
`captureInteractionLog` library calls retain their full-reprojection default.

A complete aweb entry refused by projection is counted when encountered and
consumed; later unchanged passes do not retry it. Use
`capture --reset-cursors --source aw` to request another projection attempt.
Malformed complete lines are similarly skipped once per scan. Unfinished final
lines keep their boundary for later growth; source read errors and failed durable
appends do not become successful consumed checkpoints.

Detected changes have two outcomes:

- Aweb logs reproject from the beginning. Persistent journal IDs suppress
  already captured turns; changed projected content adds a different turn once.
  Replay does not retract an earlier turn.
- Native transcripts compare their captured positional prefix against a private
  staged snapshot before any append from that input. Equal content, including
  under a new file identity, resumes at the captured boundary. A conflict sets
  the input aside with source, path, line, byte offset and reason. Other inputs
  can continue. This preserves rollback: older writers recover their offsets
  from the physical last transcript turn, so appending a revised earlier line
  would make those writers duplicate the remaining history.

## Operator recovery

`turn-record capture --reset-cursors [--source aw|cc|pi|codex]` uses the selected
`--root` and `--owner` (or their existing environment defaults). Omit `--source`
to select all four. It takes the capture lock nonblockingly, atomically commits
source reset generations, then exits **without a capture pass**. The next pass
reprocesses those sources, including when a source cursor was lost. Sources,
journals, journal-ID lookup, journal-validation checkpoints, the search index,
ignore rules, tombstones and active set-aside entries are preserved. Held or
unknown locks, invalid arguments and failed writes refuse success.

For a conflicting native prefix, either:

1. Restore the captured prefix and run `turn-record capture --retry-set-aside`.
   Retry rechecks the prefix; it never authorizes a changed one.
2. Add the source path or session ID to `<root>/ignore`. **Later turns from that
   session will not be captured.** Reconciliation applies ignore before opening
   the source, including missing or unreadable sources, and removes the ignored
   input from active set-aside entries. Removing the ignore rule later does not
   authorize the conflict.

Retry takes the same nonblocking capture lock, marks all current entries eligible
for revalidation, then performs one ordinary reconciliation while retaining the
lock. An interruption after marking leaves the warning active. It is not yet a
policy-bounded pass. Resetting cursors does not replace retry or clear a refusal.

`capture --status` keeps its existing store summary. `capture --health [--json]`
reads current active set-aside rows from `index/capture.db`, without capturing,
rebuilding, creating an absent root/database, or contacting a service manager.
The shared `capture-status.json` is the atomic **last command snapshot**: direct
synchronous library calls update active issues but do not rewrite that snapshot
or acquire an implicit root capture lock. Health gets historical run fields from
the snapshot and never advances them from current issues. A database with no
snapshot still exposes its active issues.

Both command snapshots and health use the same transactional count/sample
projection: at most 100 deterministic entries, total count and `truncated`.
Text output has the same bound and explains both remedies. Absent state on a
never-installed root is not a warning or a reason to create files. A missing
current database cannot erase a known nonempty command snapshot. Malformed or
unreadable status is reported as `capture-status-invalid`; an unavailable current
issue reader fails the command rather than returning successful stale/empty
health JSON.

Reading an existing database requires Node's read-only SQLite support: 22.12+
on the 22.x line (22.13+ avoids needing `--experimental-sqlite`), 23.2+ on 23.x,
or a newer major. Normal capture retains its declared runtime floor. Missing
SQLite support, unsupported schemas, lock/recovery errors, and WAL databases
fail health without migration or repair. Supported `capture.db` writers retain
rollback journaling. The health reader rejects WAL from its fixed header before
opening SQLite; it never creates WAL sidecars, switches mode, recovers a hot
journal or uses immutable/no-lock shortcuts. This does not protect against an
external actor racing a mode change or file replacement.

Header validation and the read-only transaction run in one private child using
the current Node executable, only the explicit SQLite runtime flag, and a clean
environment. It has a ten-second deadline, a 1 MiB output cap and no retries.
This costs one short process per health read and keeps a raw descriptor close
from releasing POSIX locks belonging to another SQLite connection in the caller.
Command snapshots reuse their owned connection for the shared projection.

The shared schema is [capture-status.schema.json](capture-status.schema.json).
In this algorithm-only phase `policy`, `lastRun`, `lastSuccess`, `lastFailure`
and `lastProgressAt` are null: evidence has not been supplied. They never mean
that a bounded pass, service installation or successful sweep occurred. Health
`status: "ok"` with empty rows means no reported set-aside fault, not service
liveness. Service supervision will extend this same mechanism with actual policy
and run evidence. Status replacement is atomic with private file permissions;
persistence failure is an operation failure, not a fabricated success.

## Resource model

Source and journal reads use 64 KiB chunks. Batches commit at 2,000 records or
8 MiB of accumulated raw bytes; a single larger record is still supported and
can exceed that batch target. SQLite connections use a 2 MiB page-cache target
and disk-backed temporary tables. Metadata query pages hold at most 128 rows;
keyset queries support the declared Node 22.5 SQLite API without rescanning
prior pages. Content-processing memory therefore depends on fixed buffers,
bounded batches/caches and the largest processable individual record, rather
than total source bytes or all historical IDs. These
are algorithm settings, **not** a memory/deadline policy or record-size limit.

Native root and path discovery retain in-memory metadata inventories, sorted by
the existing per-directory `localeCompare` order with stable ties and depth-first
traversal. Aweb account logs retain their code-unit sorted basename order. Their memory grows with file/profile counts, separately from streamed
content processing; metadata enumeration and sorting still run on unchanged
passes. Public list APIs retain their full sorted-array output. Per-input
cursors in `index/capture.db` replace whole-map JSON loads and rewrites. The
background caller requests capture counts without collecting a receipt inventory;
it does not run the explicit full-index count query merely to print progress.
Explicit API and receipt defaults retain complete issue/source/session
inventories, so their metadata memory may grow with the output they must return.
They do not retain whole source contents or journals to compute counts and
first/last visible IDs; receipt summaries use file-backed tombstone claims.

Final/attributed/Pi-custody capture and changed-transcript comparison can require
a complete verified snapshot before mutation. Those paths stream the source to
a private temporary file under `<root>/.capture-tmp`, hash it while reading,
and append from the same pinned bytes. Receipt claims databases use that same
record-root scratch area. Staging costs one source-sized temporary copy and is
removed on ordinary success or failure. These files are colocated on the record
root volume, not the system temp volume; the chosen record volume may itself
be memory-backed. Full receipt verification and recovery may read historical bytes;
this necessary proof work is distinct from unchanged/small-growth accounting.

Journal IDs and validation checkpoints are accelerators, never authority.
A validation checkpoint qualifies an exact device/inode/size/mtime/ctime version
under the stream lock. Unknown replacement, shrink or mutation forces bounded
validation before append. Journal fsync precedes the derived commit, so an
interruption leaves an old checkpoint that triggers validation. Validation
commits bounded progress; search rows and byte/count cursors commit together in
bounded transactions. Ordinary passes seek new journal bytes without parsing
consumed prefixes. Inconsistent identities or cursors invalidate derived state;
recovery can cost a historical scan. No journal format or turn ID changes.

Scratch directories are private per synchronous caller (0700 directories, 0600
owner/payload files), with a same-host PID and nonce marker. No supported path
transfers their ownership or open descriptors to a subprocess. A command holding
the capture lock removes recognized allocations only after positively proving
the local allocator dead and rechecking directory and marker identity. Public
synchronous callers still do not acquire an implicit capture lock; their live
allocations are preserved by command cleanup. Live/reused PIDs, unknown or foreign
owners, permission failures, links, special files and incomplete/missing markers
are preserved. A kill before ownership publication can leave an unowned directory.
For such leftovers, stop all capture/library users, establish that no caller is
using the specific allocation, and remove only that confirmed orphan; do not
blanket-delete the scratch area while callers may be active. No age-only cleanup.

## Internal transaction groups

The package-private `capture-context.mjs` helper can group synchronous work over
at most 128 streams. It acquires every stream lock in canonical order before
starting a shared `capture.db` transaction. Helpers reuse that connection and
use savepoints for nested failure isolation; journal appends still fsync before
the group commits derived offsets/IDs. No additional stream may be acquired
inside the transaction. This preserves public writers' stream-before-database
lock order. Group acquisition accepts an internal stop check and unwinds partial
acquisitions on failure. Callers must select bounded work before entering a group;
the helper alone does not turn a full reconciliation into a bounded pass.
Journal recovery exposes an internal work-unit interface: obsolete-ID deletion
has a persisted phase, and validation commits its byte/count cursor after each
bounded batch. A changed exact journal version invalidates that progress. A
partial checkpoint never authorizes append. Source framing accepts an internal
record limit and checks it before joining an oversized line; public callers keep
their unlimited framing default. These primitives require a scheduling caller to
provide budgets and continuation; they do not bound public library operations.

Public synchronous library calls do not implicitly enter this context or acquire
a root capture lock. Healthy derived-state opens do not run a schema write
transaction, and identical state values do not produce redundant row updates.

## First-upgrade cost

The first capture after upgrade must reconcile existing journals and rebuild the
search index. Per-input capture checkpoints and per-stream index transactions
still incur substantial synchronous commit costs on storage where sync is costly.
Connection/transaction amortization is unresolved by these algorithm changes;
bounded memory and incremental content work do not imply a cheap first pass.
The bounded service must separately qualify first-upgrade and unchanged passes
beside actual v0.53.0 on a Linux runner, including filesystem/runtime details,
connection/transaction/sync counts, resumable prefix proof and deadline progress.

## Downgrade and re-upgrade

The supported path is v0.53.0 → this version → v0.53.0 → this version, including
appends in each phase. Known legacy `index/capture-offsets.json` and
`index/capture-aw-seen.json` maps are invalidated before appends can make them
unsafe; invalidation failure refuses the append. Unknown root files are left
alone. Old capture rebuilds its offsets and IDs from the unchanged journals.
The separate new byte-cursor table leaves the old search-index count schema and
old named-column writes compatible. Old appends invalidate exact journal
versions and mismatched index counts on re-upgrade, requiring derived rebuilds.
Deleting the derived caches has the same recovery cost. No journal-byte migration
or rollback is required. Native-prefix set-aside is essential to that guarantee;
it does not rewrite history or append a sentinel or duplicate terminal turn.
