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
projection. Source set-asides have `setAsideCount`, at most 100 deterministic
`setAside` entries and `truncated`. Operational failures independently have
`failedCount`, at most 100 `failed` entries and `failedTruncated`; neither category
borrows the other's sample allowance. Text output has the same bounds (at most
200 combined entries) and explains both source remedies. Absent state on a
never-installed root is not a warning or a reason to create files. A missing
current database cannot erase a known nonempty command snapshot. Malformed or
unreadable status is reported as `capture-status-invalid`; an unavailable current
issue reader fails the command rather than returning successful stale/empty
health JSON.

An operational failure entry contains `stream`, `offset`, `reason`, `attempts`
and `nextRetryAt`. The offset is the journal byte offset where the durably
admitted failed **single-stream unit starts**, never an exact inner-frame claim.
Text says "unit starting at byte X" and "failing frame unknown". An interrupted
multi-stream group supplies run failure evidence, not guessed rows for every
member. Private journal generation and admission evidence stay out of this
projection. Active entries produce `capture-pass-failed`, including during
backoff; they do not become source set-asides or advance a processing cursor.

The fixed retry schedule is 2, 4, 8, then 16 capture intervals (30, 60, 120, then
240 minutes, capped there). Only an actual failed attempt increments `attempts`
and sets a new date. Skipping a deferred unit does neither. Time passing, source
growth, cursor reset and `--retry-set-aside` do not resolve these failures or
override their schedule. Resolution requires committed progress past the failed
unit or validated reconciliation that it no longer needs work. A cooperative
stop that makes durable progress is ordinary partial work, not automatically a
failure. Old snapshots without these fields contain no recorded operational
failure evidence; their absence does not establish a successful pass.

An interrupted multi-stream group defers its members without assigning each a
failure. On the next due attempt, its members enter the normal queue singly,
after healthy work. A member's own failed admission then supplies its failure
row; successful members advance. There is no in-pass group retry or diagnostic
execution mode. Unknown attribution remains a run failure, with deferred work
keeping the backlog pending even when no member has an attributable failure row.

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
`status: "ok"` with empty rows means no reported capture fault, not service
liveness. Service supervision will extend this same mechanism with actual policy
and run evidence. Status replacement is atomic with private file permissions;
persistence failure is an operation failure, not a fabricated success.

## Resource model

Source and journal reads use 64 KiB chunks. Batches commit at 2,000 records or
8 MiB of accumulated raw bytes. Admission flushes the prior batch before adding
a record that would exceed that byte target. Its checkpoint excludes the next
record's bytes and timestamp, even when the parser has already scanned that
line. A single larger record remains supported by public library calls and can
exceed the batch target. SQLite connections use a 2 MiB page-cache target
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

Search-index reset remains one atomic transaction. Ordinary tables use SQLite's
truncate clear; the content-storing FTS table is dropped and recreated using the
owning schema instead of deleting text rows individually. Readers retain the
existing old-union/empty-union semantics, including already-open connections.
An interrupted transaction rolls back the entire reset. Successful timing alone
does not establish remaining deadline budget; the operator-only
[reset benchmark](../../../scripts/benchmark-record-reset.md) measures the full
commit separately from sampled reader blocking on a disposable SQLite backup.

The [operator's real-index qualification](https://github.com/awebai/oats/issues/1108#issuecomment-6165193608)
used benchmark commit `16c62e39aaa43c2bb510cc446c7528359a9a4bd2` on two fresh
online backups with identical counts: 4.82 GB, 2,286,985 turns and 1,313 streams.
On macOS ARM/APFS internal SSD, Node 26.11.1/SQLite 3.54.0 with DELETE/FULL,
the original reset took 45,291 ms and atomic drop/recreate took 824 ms, including
COMMIT. Longest sampled reader-busy spans were 44,453 ms and 463 ms; 10 ms
sampling with gaps up to 56 ms does not measure exact reader-exclusion time.
Sampled rollback-journal peaks (2.39 GB and 4.9 MB) are lower bounds. These
results qualify the isolated atomic reset on that storage, not the subsequent
2.3-million-turn reconstruction, full-pass deadline or Linux service performance.

Ordinary scratch directories are private per synchronous caller (0700 directories,
0600 owner/payload files), with a same-host PID and nonce marker. Those per-call
allocations never transfer ownership or open descriptors to a subprocess. A command holding
the capture lock removes recognized allocations only after positively proving
the local allocator dead and rechecking directory and marker identity. Public
synchronous callers still do not acquire an implicit capture lock; their live
allocations are preserved by command cleanup. Live/reused PIDs, unknown or foreign
owners, permission failures, links, special files and incomplete/missing markers
are preserved. A kill before ownership publication can leave an unowned directory.
For such leftovers, stop all capture/library users, establish that no caller is
using the specific allocation, and remove only that confirmed orphan; do not
blanket-delete the scratch area while callers may be active. No age-only cleanup.

Command recovery uses separately recognized `recovery-*` allocations. Ordinary
dead-owner scavenging preserves them: allocator death alone cannot erase a job
that must resume. The registered root-lock worker requires a durable job
reference, stable allocation nonce and exact directory/payload identities before
opening one. Adoption requires positive death proof of the previous local owner
and rechecks the job, marker and registered worker before publication. A
self-identified owner publication names the prior committed marker stamp, so a
crash after publication but before its DB checkpoint can be recovered without
accepting a copied/replaced owner file. No descriptor transfers between workers.
Lost references, unknown owners and unpublished allocations cannot become proof
or cleanup authority by pathname. They retain the conservative orphan procedure
above. A committed deletion mark precedes allocation-specific removal; reference
finalization can be batched after removal, and interruption is repeatable.

`capture-recovery-snapshot.mjs` copies the fixed source end in 64 KiB chunks under
the stream group. Payload fsync precedes committed copy offsets and chunk hashes.
An uncommitted suffix is truncated only inside the adopted allocation, followed
by bounded verification of all committed chunk hashes before continuing. Lost
chunk metadata or mismatched bytes revoke the staged proof. Copying checks the
raw-record limit incrementally, before allocating a whole oversized record.
After copying, consumers read only that staged descriptor and verify its version;
the mutable source remains an observation/custody check, not a replacement data
source. Append growth uses the shared append-only assumption and bounded source
boundary witness; replacement, shrink, same-size edits or witness mismatch revoke
the job. The scheduler's durable reset/retry generation also invalidates a staged
snapshot; it stays fixed across partial workers so retry cannot restart forever.
This source qualification is separate from exact journal-generation
validation. A journal change between workers retires the old fixed-end snapshot
before comparing a possibly longer captured prefix, including after public or
outgoing-release writes. Later source growth alone is work for a later snapshot.
The native command unit may carry a completed proof into its own next journal
generation only after its fsynced append under the same stream lock, committing
the source cursor and staged job's new journal version together. An interrupted
commit instead leaves the old generation and forces revalidation.

Staging consumes source-sized private space plus bounded-per-chunk hash metadata.
Revalidating staged bytes after interruption is recovery work, reported separately
from mutable-source reads and boundary probes. Completed or invalidated jobs
reclaim hashes in bounded units; a hash-cache entry never authorizes deletion of
a filesystem path. These are private worker primitives; their tests do not by
themselves qualify the complete command scheduler, run receipts or service limits.

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

Command groups can supply a bounded admission manifest. After acquiring all
member locks, the helper rechecks each exact journal generation and commits the
manifest plus the next fairness position in a separate transaction, before any
processing. That position is queue progress, not a processing cursor. Completed
checkpoints and removal of the active manifest then share the processing commit.
A crash or thrown error leaves the manifest and fairness position intact, while
only journal bytes already fsynced survive a rolled-back processing transaction.
The scheduler must reconcile an unfinished manifest before admitting another;
the helper refuses to overwrite it or guess per-member failure rows. A normal
changed group therefore adds one intent commit, regardless of its record count.
No-op groups without admission add no intent transaction. These counts describe
explicit SQLite transactions, not filesystem sync calls or storage latency.

`capture-retry.mjs` reconciles an interrupted manifest after the previous worker
has exited. One transaction stores retry membership, run failure evidence and
any attributable single-stream failure, then removes the manifest. A failed
commit leaves the manifest available for retry; completed reconciliation is
idempotent. Neither reconciliation nor admission advances processing cursors.
Deferred membership is separate from public failure rows. Admission itself
requires a due, single-stream retry and rejects a second attempt in the same
run. A separate durable retry position rotates incomplete members across runs;
bounded keyset enumeration avoids retaining all deferred members in memory.
The scheduler supplies a finite, fair healthy sweep before deferred selection.
Enumeration still costs metadata work and is not a new-content-only operation.

Resolution joins the processing checkpoint transaction. An unchanged journal
must be processed through the failed snapshot's end, or the stage must validate
that the unit no longer needs work. A checkpoint inside that snapshot, a changed
generation, expiration of the retry date or a process restart cannot by itself
clear the warning. The stage remains responsible for proving reconciliation;
these private queue helpers do not implement the full source/index scheduler.

Journal recovery exposes an internal work-unit interface: obsolete-ID deletion
has a persisted phase, and validation commits its byte/count cursor after each
bounded batch. A changed exact journal version invalidates that progress. A
partial checkpoint never authorizes append. Source framing accepts an internal
record limit and checks it before joining an oversized line; public callers keep
their unlimited framing default. These primitives require a scheduling caller to
provide budgets and continuation; they do not bound public library operations.

`advanceTranscriptPrefix` is the internal resumable comparison for a retained
immutable source snapshot. Its durable phases clear obsolete hashes, consume
the journal from a byte checkpoint, then compare source lines from a byte/line
checkpoint. Hashes and phase progress share the surrounding stream group's
transaction. A snapshot identity or exact journal generation change revokes
the proof; losing the hash table or its epoch cannot qualify old checkpoints.
Only the ready phase authorizes the caller to append. A late disagreement
reports the conflicting source line/offset without appending any suffix.
Cleanup revokes the proof before deleting bounded batches of hashes. Journal
processing retains the historical-single-record qualification; the raw source
record policy is not a serialized-journal size limit. This comparison helper
does not own snapshot staging, transfer its ownership or read the mutable source.

`capture-native-unit.mjs` combines these private primitives for one native input.
It performs bounded journal validation before any append, resumes retained
snapshot/prefix work when a source cursor is unqualified, and admits one bounded
batch from the verified bytes. Ordinary known growth uses the source cursor and
bounded witness without staging historical content. The fixed end survives
partial units; later growth is a later sweep. A separately checkpointed search
frontier finds the first timestamp across units, then carries it backward while
capturing the unstamped prefix. An unchanged unstamped or torn tail stays pending
without repeatedly scanning it. Explicit retry generations persist separately
from active issue rows, so clearing a resolved issue cannot restart its proof.
Ignore is applied before source/custody access; retry still compares the complete
captured prefix. The scheduler must account for pending/failed work and perform
allocation cleanup after its deletion mark commits. These are unit interfaces,
not a resource promise for public synchronous capture or exact receipts.

`capture-aw-unit.mjs` similarly processes one fixed-end log unit. Every scanned
raw line consumes its work allowance, including blank lines, malformed complete
lines and projection refusals. Cursor publication follows the pending batch's
durable append. A valid final object without its newline retains its starting
offset and keeps the command pending; an unchanged snapshot does not repeatedly
project that fragment. Replacement or explicit source reset reprojects through
persistent journal-ID deduplication. Raw oversized input uses the same set-aside
store and retry/ignore rules as native inputs; a projection refusal itself is
consumed evidence and does not create a second issue mechanism.

Public synchronous library calls do not implicitly enter this context or acquire
a root capture lock. Healthy derived-state opens do not run a schema write
transaction, and identical state values do not produce redundant row updates.

The private supervisor transport admits one child at a time under the root lock. The child
announces its nonce and stays idle until the supervisor durably publishes its
identity in that lock and sends permission to start. A live, reused or unknown
worker PID prevents reclamation after supervisor death. Release occurs only
after the owned child exits; signals target the spawned child handle, never a
PID inferred from an abandoned lock or a process group. Continuation retains the
same root lock: it replaces only the exact previously registered worker identity
after positive death proof. Reused or uncertain PIDs prevent replacement.
Workers check their parent and lock identity between work units. The supervisor never writes status
on behalf of a crashed worker. A shared monotonic deadline includes process
startup and lock publication, with a separate cooperative drain boundary.
Launch arguments fix the heap policy and exclude inherited Node flags and
preloads. This transport requires a reconciliation entry that supplies bounded
units and persists run facts; it does not itself implement a complete pass.

`capture-pass.mjs` supplies serial child continuation under that same absolute
deadline. Startup, publication, checkpoint finalization and reaping consume the
pass budget; child replacement cannot renew it. Normal work has internal drain,
finalization and forced-stop boundaries, and is admitted only with its full
allowance. A reserved start and time allowance let a final worker reconcile an
interrupted predecessor and persist run facts. All starts, including spawn
failures and finalization, count against the fixed internal ceiling. The parent
can report its observed process failure, but only a worker can reconcile durable
admission and attribute it. There is no in-pass diagnostic retry mode. The
reconciliation entry must select independent ready work before deferred failed
work; transport tests alone do not establish that scheduling or recovery rule.

Bounded index groups reuse the already acquired stream group and capture-state
connection. Validation precedes the index write transaction; completed index
rows and byte/count cursors commit together once per group. A cooperative stop
commits completed work, while an exception rolls back that index group. Each
selected stream receives a share of the record/byte budget, so a large journal
does not consume every selected stream's allowance. The scheduler must visit
both live streams and indexed streams whose journals disappeared, and restart
its index sweep after an atomic union reset. The group helper never declares
the entire root complete. A no-op group performs no index write transaction;
its capture-state transaction remains separate from the index commit. A failure
between the two commits is recovered through journal version/epoch validation,
not by assuming a cross-database atomic transaction.

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
