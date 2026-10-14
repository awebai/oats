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
node --no-warnings scripts/benchmark-record-reset.mjs --ack-disposable-scratch /absolute/path/to/disposable-backup.db original
```

After disposing of that copy and obtaining a new consistent backup:

```sh
node --no-warnings scripts/benchmark-record-reset.mjs --ack-disposable-scratch /absolute/path/to/disposable-backup.db optimized
```

The modes reproduce `RecordIndex.reset()` from `aaf23012` and the atomic FTS
recreation at the script's commit, respectively. Both use deferred `BEGIN` and
normal `COMMIT`. Ordinary tables retain SQLite's truncate clear; optimized mode
drops/recreates the content-storing FTS table with the owning schema and restores
version 1 in that same transaction. Neither mode clears `meta`. A test compares
the complete schema and optimized statement sequence with production. No other
unfinished service code is imported or executed by the benchmark.

Only the supported complete version-1 schema is accepted, including `index_bytes`.
Missing/extra tables, indexes or triggers, nonregular/symlink input, invalid
headers and preexisting sidecars refuse. A failure emits fixed diagnostics and
safe codes, never a path, captured content, stored SQL, raw SQLite exception or
stack. The database remains the operator's responsibility after success or
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
