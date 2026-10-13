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
reads the shared `capture-status.json` snapshot without capturing, rebuilding,
creating an absent root/database, or contacting a service manager. The diagnosis
contains at most 100 deterministic set-aside entries, the total count and a
`truncated` flag; text output has the same bound. Each diagnosis explains both
remedies. Missing status on a never-installed root is not a warning. Malformed
or unreadable status is reported as `capture-status-invalid`.

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
prior pages. Memory therefore depends on fixed buffers,
bounded batches/caches and the largest processable individual record, rather
than total source bytes, all historical IDs or the full input inventory. These
are algorithm settings, **not** a memory/deadline policy or record-size limit.

Ordinary background capture streams directory enumeration and source records;
metadata enumeration still costs one visit per discovered input. Per-input
cursors in `index/capture.db` replace whole-map JSON loads and rewrites. The
background caller requests capture counts without collecting a receipt inventory;
it does not run the explicit full-index count query merely to print progress.
Explicit API and receipt defaults retain complete issue/source/session
inventories, so their metadata memory may grow with the output they must return.
They do not retain whole source contents or journals to compute counts and
first/last visible IDs; receipt summaries use disk-backed tombstone claims.

Final/attributed/Pi-custody capture and changed-transcript comparison can require
a complete verified snapshot before mutation. Those paths stream the source to
a private temporary file, hash it while reading, and append from the same pinned
bytes. Staging costs one source-sized temporary copy and is removed on success
or failure. Full receipt verification and recovery may read historical bytes;
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
