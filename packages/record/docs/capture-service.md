# Capture algorithms and recovery

The record package owns source cursors, journal validation, indexing and capture
status. This version changes those algorithms; it does not install a bounded
runner or change service scheduling, hooks, root registration or doctor.

The private service foundations described below are not yet joined to the
ordinary command or installed manager path. OATS 0.56.0, 0.57.0 and 0.58.0
shipped without the bounded periodic service. See
[capture service release order](../../../docs/upgrading.md#capture-service-release-order)
for the distinction between upgrading those releases and a future setup
conversion after installing a release that ships service A.

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

Command prefix-conflict diagnostics name the refused input, conflicting stream
and native line/source byte position. They say "establishing source path
unavailable": the journal records native session and line, not that path.
Current discovery and derived cursors cannot supply missing provenance, and a
prefix mismatch does not itself prove that a second source exists. Native stream
identity and traversal precedence remain unchanged.

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
Existing algorithm-phase snapshots retain null `policy`, `lastRun`,
`lastSuccess`, `lastFailure` and `lastProgressAt`: evidence has not been supplied.
They never mean a completed pass or prove service activation. The same version-1
schema accepts the fixed service policy and evidenced worker run/history fields;
no second status file is used. Run identities name their trigger, worker PID and
start; a running receipt has no finish/reason. Complete, partial and failed
receipts have a finish, and failure has an explicit reason. Success/failure
summaries retain run identity, finish, per-run counts and sampled peak RSS;
failure additionally has a safe message and optional path/offset. Future-dated,
malformed or unsupported evidence is invalid, not a freshness conclusion.

Failed/interrupted-run counters report only durably confirmed unit-accounting
results, not an exhaustive count of physical journal writes during that run.
A zero `turnsAppended` does not prove that no append reached disk: journal fsync
can precede a lost derived checkpoint/accounting commit. The failure message
states this qualification. Confirmed healthy-unit counts within the same failed
pass remain visible, without erasing the earlier interruption. Recovery dedupes
against journal truth; it neither attributes later journal growth retroactively
to the failed run nor counts recovered existing turns as newly appended.
Explicit `--file`/`--home` receipt semantics are unchanged.

`capture-status.mjs` validates this shared format and atomically replaces a
private same-directory temporary file after its fsync. Publication failure is
reported; the prior snapshot is not replaced by an invented success. Exact
receipt commands refresh backlog while preserving all prior service history,
without claiming their own unbounded operation was a bounded pass. Snapshot
format support alone does not produce run evidence: the admitted command worker
must supply committed facts.

The private `CaptureRun` helper publishes a running identity before initializing
its derived counter row. Counter changes join the processing transaction after
journal fsync or index commit; rolled-back work cannot publish progress. A
continuing worker combines those committed counters with the published sampled
RSS peak. Sampling alone never advances `lastProgressAt`. An unfinished run
whose counter cache is lost retains interruption evidence rather than becoming
a successful empty pass. A finished file receipt takes precedence over a stale
running counter row, and finalization needs one atomic file publication, not a
second derived-state commit. Supervisor failure evidence is bound explicitly to
the current run ID, including a child lost before any running receipt exists.
It is distinct from failure of an older abandoned run: only failure in the
current pass prevents that pass from succeeding after healthy work. Partial
work preserves previous success and failure history. These are private
accounting mechanics, not evidence that command integration has run a pass.

Source-stage fixtures use the private retained recovery cleanup unit described
below. A due retry may need it even for a tiny source after an interrupted
append. Cleanup failure is a failure in the current pass and preserves
confirmed work; it cannot be ignored to make a later receipt successful.
These fixtures do not qualify the unfinished production scheduler's cleanup
routing.

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
traversal. Aweb account discovery retains code-unit sorted basenames. Public synchronous
`captureAwLogs` keeps sorted whole-file traversal. Cross-account append order
in `owner~aw` under the service is unspecified; per-account order is preserved.
Bounded command work may rotate between account files, serially under the same
stream lock. IDs, projection, dedupe and journal-generation checks are unchanged.
[`recall --thread --json`](../README.md) exposes the resulting durable sequence,
including mixed-account ID windows; it does not regroup or sort journal history.
Discovery metadata memory grows with file/profile counts, separately from streamed
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

`capture-cleanup-work.mjs` supplies that lifecycle as a private work unit.
`captureCleanupPage` reads at most 128 allocation references by key, including
active jobs, and returns only deleting jobs. It never scans indefinitely to
find a match. The caller saves its returned key and resumes another page;
reaching the end of a page sequence is enumeration evidence, not a completed
capture pass. Selection does not depend on a source remaining ready, so a
finished or refused source's deleting reference is still discoverable after
a worker dies. Active allocations are not selected for deletion.

`cleanupCaptureRecovery` binds a selected job to its allocation nonce and
stream, commits verified adoption, removes the allocation outside a database
transaction, then divides one bounded hash-row allowance between recovery
chunks and transcript prefix rows under the stream lock. Both tables must be
finished before it removes the allocation and staging references. A partial
unit, cooperative stop after removal, or failed final metadata commit retains
the deleting reference; the next registered worker revalidates it and resumes.
The source's committed cursor and journal bytes are not rewritten or recounted.
The caller still owns fair selection, operational failure handling, budgeting
and final receipt publication; this unit adds no separate retry policy.

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

Small command recovery snapshots have a private optimization when their **total
fixed end** is at most 8 MiB. Each worker streams a new private copy and full
SHA-256 in 64 KiB chunks before trusting saved comparison progress. Complete
digest plus size identifies the proven bytes; source identity/observation,
reset/retry generation and exact journal generation must also qualify. The
comparison consumes that worker's verified snapshot, never a later source-path
reopen. Same-content replacement takes the normal validation path. Matching
snapshots preserve comparison progress; a changed digest or other qualification
restarts proof before append. Ordinary unchanged/growth capture does not use
this recovery optimization.

These small copies are disposable per-call allocations, with no payload or
ownership-handoff fsync. Their loss never loses a proven source checkpoint:
the next worker must copy/hash again. Repeated source/stage bytes are recovery
work and are counted separately from probes and ordinary incremental work.
If restaging exhausts the unit before required work can advance, the processing
commit selects retained resumable copying for subsequent admissions. A killed
unit cannot publish an in-memory fallback decision; its durable failed-admission
retry selects the retained path. The fixed source end is preserved by committed
observation metadata, which alone never authorizes prefix proof. SQLite commits,
journal syncs, root-lock publication and retained fallback syncs remain separate
costs; avoiding disposable-copy fsync is not a claim that first-upgrade storage
cost or the complete service has been qualified.

Staging consumes source-sized private space plus bounded-per-chunk hash metadata.
Revalidating staged bytes after interruption is recovery work, reported separately
from mutable-source reads and boundary probes. Completed or invalidated jobs
reclaim hashes in bounded units; a hash-cache entry never authorizes deletion of
a filesystem path. These are private worker primitives; their tests do not by
themselves qualify the complete command scheduler, run receipts or service limits.

The private `NativeCaptureDiscovery` walker checkpoints only its active
per-directory stack, directory identities and exact last basenames. A resumed
walker loads that stack directly rather than revisiting completed sibling
subtrees. Within a worker it retains only the sorted arrays for active
ancestors; completion, close and errors release those arrays. Selection and
stable `localeCompare` ordering match the public cc/pi/codex inventories,
including Claude's restricted subagent layout and existing link distinctions.
A replaced active directory invalidates its position. An absent fresh default
can be empty; disappearance of an already selected directory is an error.

Each discovery unit accounts for visited metadata entries, including irrelevant
ones, and returns a bounded file page plus the next checkpoint. The scheduling
caller must commit that page and checkpoint together. Directory reads/sorts
can recur on restart and their arrays still grow with directory size; this is
not a constant-memory metadata claim or new-byte-only work. Newly inserted
names before the saved position belong to a later sweep. A missing anchor
conservatively replays its collation equivalence class, requiring idempotent
inventory insertion. This walker does not itself select roots, schedule
capture/index work or certify that a complete command sweep occurred.

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
processing. That position is queue progress, not a processing cursor. The same
intent transaction also retains each stage's last position independently;
intervening index work cannot reset source rotation. This adds one state-row
write per admission, not another transaction or a per-record sync. Completed
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

`advanceTranscriptPrefix` is the internal resumable comparison for a verified
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
It performs bounded journal validation before any append, resumes verified
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
the entire root complete. It defaults to returning `resetRequired` without
mutating index rows when reset is needed. The scheduler must reserve a fresh
full worker allowance for that atomic operation; the detection unit and the
finalization reserve cannot implicitly start it. Explicit reset permission is
an internal seam, not a public policy override. A no-op group performs no index write transaction;
its capture-state transaction remains separate from the index commit. A failure
between the two commits is recovered through journal version/epoch validation,
not by assuming a cross-database atomic transaction.

`capture-index-work.mjs` joins a selected index group to durable admission,
per-stage scheduling position and run accounting. Its caller supplies a finite,
fairly ordered union of live and indexed streams; this bridge neither builds
that inventory nor certifies sweep completion. Failure attribution starts at
the saved validation boundary when recovery is unfinished, otherwise at the
qualified index cursor. Changed journal generations start validation at zero.
Only the locked group validates and consumes those cursors.

Index rows commit before their confirmed `turnsIndexed` count joins the
capture-state commit. If that later transaction fails, the durable admission
remains for reconciliation while the index rows can survive. Resuming an
already indexed unit does not reconstruct its lost run count. Validation or
indexed-byte advancement can update progress; a no-op visit does not. Due
index retries are single-stream admissions; only completion of the current
validated journal resolves them. Partial validation/indexing and reset requests
retain failure evidence, and other-stage retries return to the scheduler.
Reset detection always defers: the owning scheduler must reserve a fresh full
worker allowance for reset and restart the union sweep afterward. Source,
discovery, cleanup and final receipt routing remain separate responsibilities.

The private `CaptureIndexInventory` builds the union of indexed stream names
and live journal stream names in `capture.db`. Indexed names are enumerated
first, including names whose journal disappeared; they remain in the inventory
so locked index validation can detect changes to cross-stream tombstone
authority. Each discovery call inspects at most 128 index rows or directory
entries, including irrelevant names. Inserting that page and advancing its
checkpoint share one transaction. Names shared by both sources occur once.
The inventory never reads journal content, changes index rows or grants reset
permission.

A scheduler-owned sweep identity resumes discovery across connection/worker
restarts. Live discovery retains a sorted directory-name array only within the
worker and resumes by a binary name key when reopened, even if that anchor was
removed. The selected streams directory's identity must remain unchanged.
Directory listing/sorting is still metadata work proportional to directory
size, and can recur after restart; it is not a bounded-memory metadata claim.
New names before the saved position belong to a later sweep. A fresh absent
directory can be empty; disappearance/replacement after selection is an error.

Ordered reads use bounded database pages and rotate after the durable index
admission position, visiting the discovered union once per iterator. Inventory
rows are not removed on an apparent index completion: membership is not cursor
or generation proof. The `complete` flag only means enumeration finished, never
that indexing or a pass succeeded. The scheduler still owns index outcomes,
new streams created by interleaved capture, reset admission and a fresh union
sweep after reset. Replacing a sweep retires its exact scope; indexed cleanup
deletes at most 128 obsolete rows per unit and refuses the active scope. Losing
this private table restarts enumeration without clearing retries, journal
checkpoints or the index. These primitives are not yet the full command runner.

`CaptureIndexOutcomes` records processing phases separately from membership in
that private inventory. The index-work bridge publishes outcomes inside the
admitted stream group's capture-state transaction, after the index commit and
run accounting. A failure in outcome publication rolls back its marks and run
counters together, leaving the admission for reconciliation even when index
rows survived. A later no-op can qualify those existing rows without guessing
the lost earlier run count.

A stored complete phase is only cached evidence. Before skipping that stream,
the outcome reader compares the current journal file version, completed
validation epoch/byte/count checkpoint and index count/byte/epoch cursors with
the recorded evidence. Growth, replacement, validation loss, outgoing count
writes or an index reset revoke mismatching evidence. This is metadata
requalification, not a historical content scan or new integrity mechanism;
locked validation/index work still owns processing authority. Outstanding
retries keep the stream pending. Ordinary inventory enumeration retains all
names, while outcome-aware selection skips only still-qualified completions.

The source-work bridge can join an active index inventory to its processing
commit. It inserts every processed stream, including replay with no new append,
so streams created after directory discovery are not omitted. Duplicate
membership does not alter a prior outcome; subsequent outcome reads requalify
that evidence against the changed journal. A failed source transaction rolls
back membership with its source checkpoint and counters, while the durable
admission remains available to reconcile surviving journal bytes.

Reset-required outcomes remain durable and block further outcome-aware index
work in that sweep. Neither detection nor the outcome scheduler executes reset.
The owning scheduler must admit the separate atomic operation and replace the
inventory sweep afterward. Outcome audit pages inspect at most 128 names and
report how many still need work; their end-of-page `complete` flag is only audit
enumeration completion. The caller must also account for unfinished discovery,
new captures, retries, reset and other stages, and recheck after writes before
finalizing a pass. These outcome/source connections do not yet implement that
final mixed-stage decision or the ordinary command/service entry.

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


## Private source inventory

`capture-source-queue.mjs` stores command discovery pages in the derived
`capture_sources` table. At most 128 input descriptors and the walk checkpoint
join one transaction. Replayed discovery preserves original ordinal positions
and completed outcomes. A new selection or a finished visit sweep creates a
new private scope; superseded scope rows are deleted by indexed 128-row units,
without scanning or resetting another owner's current inventory. Losing the
inventory table invalidates its discovery checkpoints and re-enumerates; it
never changes journals, source cursors, IDs or prefix-proof authority.

Ready-input reads use bounded database pages. Admission advances the persisted
source position before processing; source outcome changes commit alongside the
owning capture helper's source checkpoint. Rollback therefore retains the old
processing state while allowing another independent ready input its turn.
Native paths sharing a stream retain discovery precedence until the earlier
input reaches its fixed end, pending state or refusal. AW files may rotate
between bounded units in their shared stream; the existing retry selector still
applies stream-scoped backoff and admits no concurrent writer. The queue does
not clear failure rows or treat a finished inventory containing pending,
set-aside or failed inputs as a successful pass. Directory metadata work and
queue metadata work remain separate from source/journal content work.

`capture-source-work.mjs` joins one selected source group to those queue
checkpoints and `CaptureRun` accounting. Locks precede the admission commit and
processing transaction. Each input/category contributes to its run's counters
once even when recovery spans workers; the visit flags live in derived database
rows, not a process-wide file map. No-op visits do not count as processing
progress. One AW account per shared-stream admission preserves serialized
appends while the queue position allows other accounts their turn. A due retry
is a single-stream admission, and an incomplete proof cannot clear its failure.
Other-stage retry work returns to the scheduler rather than being mistaken for
capture work. Allocation cleanup remains a separate committed-lifecycle step.

These private primitives do not themselves hold a root lock or implement the
complete command runner. Their caller must own that lock, enforce the common
budget, reconcile unfinished admissions, and publish the actual run outcome.
