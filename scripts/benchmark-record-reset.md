# Operator-only reset comparison

`scripts/benchmark-record-reset.mjs` is a destructive benchmark of **one disposable
SQLite backup**, never a live record index. The operator creates the consistent
copy using SQLite online `.backup`, reads the script, runs one mode and disposes
of the copy. Create another backup for the other mode. The script does not create
backups, find roots, capture, run services, delete the database, or upload anything.
Do not supply an index that any other process may write or replace.

Run the standalone file from the reviewed full commit with a Node executable
providing `node:sqlite` (22.13+ on 22.x, 23.2+ on 23.x, or newer):

```sh
node --no-warnings scripts/benchmark-record-reset.mjs --ack-disposable-scratch --prepare-outgoing-index /absolute/path/to/disposable-backup.db original
```

After disposing of that copy and obtaining a new consistent backup:

```sh
node --no-warnings scripts/benchmark-record-reset.mjs --ack-disposable-scratch --prepare-outgoing-index /absolute/path/to/disposable-backup.db optimized
```

The modes reproduce `RecordIndex.reset()` from `aaf23012` and the atomic FTS
recreation at the script's commit, respectively. Both use deferred `BEGIN` and
normal `COMMIT`. Ordinary tables retain SQLite's truncate clear; optimized mode
drops/recreates the content-storing FTS table with the owning schema and restores
version 1 in that same transaction. Neither mode clears `meta`. A test compares
the complete schema and optimized statement sequence with production. No other
unfinished service code is imported or executed by the benchmark.

By default only the complete version-1 schema including `index_bytes` is accepted.
`--prepare-outgoing-index` additionally accepts the **exact** published 0.53.0 and
0.54.0 shape without that table. Those releases have identical owning source:
0.54.0 tag `9d1554883d678c60603e8899af76e1e828061ebc` peels to
`201fc63e6eb80f7fd332d0253565b2cf44c5227e`; 0.53.0 tag
`f96a656c2c6f9687fb0e36e7ec017f83952622fd` peels to
`e3de1f0c01f25d6fde1f11231c5ef67a9c590ca6`. Both owning `index-db.mjs` blobs are
`f2e076a408b4660bb27cf45f2a0f07d51248adf3`. The fixture preserves the published
schema. No other layout is admitted merely because `user_version` equals 1.

For that outgoing shape, the explicit option creates only the empty
`index_bytes` table on the disposable copy, just as the current constructor does.
This is identical in both modes and outside reset timing. `input` reports the
original schema variant, table absence, counts and sizes; `preparation` reports
the addition and separate wall time. `beforeCounts` describes the prepared
schema (`index_bytes: 0`); `preparedSchemaPreserved` describes the reset's
postcondition. `schemaPreserved` is false when preparation added the table, so it
does not claim the original input schema was unchanged. Metadata and version stay
unchanged. With an already-current schema the option performs no preparation.
Original mode remains the `aaf23012` production reset after this disclosed normal
constructor setup, **not** an actual outgoing-release full-rebuild/runtime
comparison. Omit the option to require the current complete schema without any
preparation. Never upgrade the live index merely to run the benchmark.
Preparation is its own normal constructor-style autocommit. A later benchmark
failure can therefore leave the empty added table on the scratch copy; obtain
a fresh backup before comparing the other mode.

Unknown/missing/extra tables, indexes or triggers, nonregular/symlink input, invalid
headers and preexisting sidecars refuse before preparation/reset. A failure emits fixed diagnostics and
safe codes, never a path, captured content, stored SQL, raw SQLite exception or
stack. Direct invocation through a symlinked script directory is supported;
canonicalization failure reports a safe nonzero result instead of silent success.
Importing the module does not run the benchmark. The database remains the operator's responsibility after success or
failure. There is no automatic repair, cleanup, retry, journal-mode conversion,
VACUUM or synchronous-durability reduction.

The connection uses production's `busy_timeout=60000`, `cache_size=-2048` and
`temp_store=FILE`. Effective settings, runtime, filesystem type/free space, known
table counts and database/sidecar sizes are reported. Count/schema/metadata
inspection happens **before** timing and warms caches. Post-checks verify empty
reset targets, preserved schema/version/metadata and `quick_check(1)` outside
timing. Sequential backups can differ because the live source can grow: compare
counts, not an assumption of identical snapshots. No row or metadata value/hash
is printed.

`resetWallMs` includes the whole reset through the return from `COMMIT`.
`transactionIntervalMs` runs from the return of deferred `BEGIN` through the
return of `COMMIT`; it is **not** reader-blocking time. The write-transaction
bounds use entry/exit of the first DELETE and COMMIT calls, including uncertainty
inside those calls. SQLite RESERVED locks permit readers; PENDING/EXCLUSIVE can
exclude them. See [transactions](https://www.sqlite.org/lang_transaction.html)
and [rollback locking](https://www.sqlite.org/lockingv3.html).

One separate read-only child samples a short query with zero busy timeout at a
nominal 10 ms interval. Output includes successful/busy samples, first/last busy
positions relative to reset start, longest observed busy-sample span, maximum
sample gap/query duration and sampled sidecar high-water sizes. These observations
cannot establish continuous EXCLUSIVE-lock duration or absence of shorter stalls;
scheduler delays add uncertainty. Probes themselves can delay commit and add
I/O/cache contention. The child stops after the reset or after 600 seconds,
whichever comes first; `coverageEnded: deadline` explicitly means incomplete
coverage of a longer reset. Unexpected probe failure makes the invocation fail.
The parent awaits/reaps only its owned child and suppresses its raw diagnostics.

The supplied copy requires space for a rollback journal and SQLite temporary
work on its volume. Sampled sizes are lower bounds, not guaranteed peaks or a
reservation. No second full copy is made. The parent-provided APFS/macOS scenario
is about 4.8 GB (1,177,204 pages of 4096 bytes); the operator must check current
space independently. This measurement does not establish the budget remaining
after other work in a 300-second service pass, nor replace Linux first-upgrade
and no-op acceptance. Interrupted-transaction recovery is tested separately on
synthetic fixtures; timing a successful reset alone is not recovery evidence.
