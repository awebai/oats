# @awebai/turn-record

The turn record: an append-only, content-addressed, replicated record of
turns, with the core tools over it — `capture` and `recall`. The normative
contract is [`docs/turn-record-sot.md`](docs/turn-record-sot.md) in this
package; the conformance vectors under `test/vectors/` pin the format
(`node test/vectors/validate.mjs`, dependency-free).

Turns in this append-only record are content-addressed. Native session turns
are not signed. Projected aweb mail and chat keep their original message
signatures verbatim.

After `turn-record setup` runs on a machine, this package gathers Claude Code,
Pi, and Codex transcripts plus aw client logs. It skips sources matched by the
local record's ignore list. The package keeps captured conversations durably
and finds them again. The experimental tools that select and synthesize over
the record (dress, spawn, segments, mind) live in `packages/experimental` of
the oats repo and run as `oats experimental <cmd>`. They are deliberately not
part of this package.

- **`lib/canonical.mjs`** — canonical JSON (integers only in the core),
  `t1:` content ids, did:key Ed25519 verification. Byte-compatible with awid
  message signing.
- **`lib/store.mjs`** — the store: `streams/<owner>~<source>/journal.jsonl`
  (owner-only append, torn-tail tolerant), `objects/sha256/` (immutable
  blobs), `index/` (derived, never replicated). Merge is prefix extension
  per stream + set union by id; non-prefix copies are quarantined, never
  silently merged. Tombstones hide, v1 authority = author or record owner.
- **`lib/project-aweb.mjs`** — projections of aweb messages (signed rows,
  legacy rows, client comm logs, interaction logs) into turns. Pure
  functions of the source: the same message projected on two machines gets
  the same id, so replicas dedupe by union.
- **`lib/capture-cc.mjs`** — session capture (Claude Code, pi, Codex via
  the format registry in `formats.mjs`). Every native transcript record
  becomes ONE turn holding the verbatim line (`body.line`), in a
  per-session stream `<owner>~<source>.<session-id>`; capture is
  incremental by source byte offset, so a growing session appends only its
  new events — storage is linear in conversation size by construction, and
  the original transcript is reconstructible by concatenating `body.line`.
  Reconciliation is the capture (hooks/watchers only decide when to run
  it).
- **`lib/capture-aw.mjs`** — aw client log capture into `<owner>~aw`.
- **`lib/index-db.mjs`** — derived SQLite FTS5 index (`node:sqlite`, no
  dependencies). `update()` is incremental; `rebuild()` is reset + update
  from zero (same code path). Session text is extracted per event with
  exact line provenance; tombstoned turns disappear.
- **`lib/segments.mjs`, `lib/tags.mjs`** — parsers for the note
  conventions (segments, spawn notes, tags, outfits) that experimental
  tools write into the record. They live here because the index reads
  every note in the record; the machinery that writes and uses these
  notes is experimental.

## Install and run

One shipped bin, `turn-record`, with three subcommands. From a checkout use
`node bin/turn-record.mjs ...`; from an npm install (the package has zero
dependencies and packs clean — `test/packaging.test.mjs` proves the tarball
runs standalone) just `turn-record ...`. Inside an oats install the same
commands are `oats capture|recall|setup`.

```bash
turn-record setup        # install Stop/SessionEnd hooks into every
                         # ~/.claude*/settings.json, install the background
                         # watcher (launchd on macOS, systemd user unit on
                         # Linux), then run the first capture pass.
                         # Idempotent; --dry-run previews; --owner overrides
                         # the machine name.

turn-record capture                  # one reconciliation pass, then index update
turn-record capture --watch          # pass now, on filesystem change, every 15 min
turn-record capture --status         # stream summary

turn-record recall "sqlite fts"                 # search mail + chat + sessions together
turn-record recall --kind mail --from acme/x q  # filters
turn-record recall --thread aweb:conv:<id>      # list a thread chronologically
turn-record recall --show t1:<hex>              # print one turn
turn-record recall --reindex                    # full rebuild of the derived index
```

Store root: `--root`, else `$TURN_RECORD_ROOT`, else `~/.turn-record`.
Stream owner: `--owner`, else `$TURN_RECORD_OWNER`, else the short hostname.

## Ignoring sessions and paths (privacy)

`<root>/ignore` is a plain text file of glob patterns, one per line (blank
lines and `#` comments skipped). Any capture source file that matches is
**never captured at all** — it is skipped before being opened, so no turn
is appended and the offset cache never learns about it.
This is a capture-time control, stronger than not indexing: the bytes never
enter the record.

```
# never capture this session (any format), by session id
7fe2a1b4-9c3d-4e21-b0aa-1f2e3d4c5b6a

# never capture anything from this project's transcripts
**/-Users-juanre-private-project/**

# never capture one aw account's comm log
acme-secret
```

Matching rules (deliberately minimal; no negation, no escapes):

- a pattern containing `/` matches against the source file's absolute path;
- a pattern without `/` matches against the file's basename and against its
  session id (transcripts) or account name (aw comm logs);
- `*` matches within a path segment, `**` across segments, `?` one
  character; the whole candidate must match.

Name-only patterns apply across every capture source: a short or generic
pattern meant for one aw account can also catch a session file's basename
or id in any format. Prefer path patterns for anything short or generic.

Ignored files are counted in each pass (`N ignored` in capture output;
`capture --status` shows the active pattern count), never skipped silently.
The file is per record root and is local policy, not record truth — the
sync guidance below replicates only `streams/` and `objects/`, so each
machine decides what its own capture refuses to read; sync the `ignore`
file yourself if you want one policy everywhere. Two honest limits: an
ignore file that exists but cannot be read fails the pass loudly (a privacy
control must not fail open), and ignoring is **forward-looking only** —
turns already captured stay in the record; hide those with a tombstone.

## Multi-machine

Replicate `streams/` and `objects/` with any dumb file sync (syncthing,
rsync, git); never sync `index/`. Owner-only append means concurrent sync
cannot conflict; identical projections dedupe by id; a machine that sees a
non-prefix copy of a stream quarantines it loudly.

## Durability and concurrency

Appends and merges run under a per-stream lockfile (`streams/<id>/.lock`),
because the torn-tail repair is a read-truncate-write sequence and hooks,
watchers and manual passes can fire concurrently for the same owner.

The lock carries an **owner token** — the holder's pid, its hostname, and a
random nonce — written by hard-linking a fully-written temp file into place,
so a lock that exists is always readable in full. Two guarantees rest on
that token:

- **A live holder is never stolen from, at any age.** Staleness is proven
  from the holder's liveness, not from how long ago the lock was created.
  A contender that finds the holder's pid alive on this host waits, and
  fails with a timeout naming the holder — it does not reclaim. (The
  earlier design judged a lock stale by age while the waiter's timeout
  started when the contender arrived; a contender arriving late therefore
  reclaimed a lock whose holder was still inside its critical section, and
  both ran at once.)
- **A holder releases only its own lock.** Release unlinks `.lock` only
  while it still carries the releaser's nonce, so a holder whose lock was
  reclaimed cannot delete the replacement lock out from under its new
  owner.

**Crash recovery is immediate, not timed**: a lock whose pid is gone from
this host is provably stale and is reclaimed at once, without waiting out
any threshold.

A lock that cannot be read at all (anything but "not there" — a permission
error, a directory in its place) is not retried: acquisition fails at once
with the underlying error code and the lock's path, because retrying cannot
clear such a condition. Everything else that fails to acquire — including a
lock judged stale whose removal keeps failing — is bounded by
`lockTimeoutMs` and reports why on timeout.

`lockStaleMs` (30 s by default) is the fallback for the two cases where
liveness cannot be checked here: a lock created on **another host** (file
sync can copy one in) and a lock with **no readable token** (written by an
older version of this package, or by hand). Those are still reclaimed by
age. `lockTimeoutMs` (10 s) is how long a contender waits; the two
thresholds are independent, and neither ordering of them is required or
assumed.

Honest limits:

- **Pid reuse across a reboot.** A lock left by a process whose pid was
  later reused by an unrelated live process reads as held forever, and
  contenders on that stream time out until it is deleted by hand. The
  timeout message names the lock path and the recorded holder. This is the
  chosen direction of failure: refusing to write is recoverable, writing
  concurrently with a live holder is not.
- **Reclaim is not perfectly atomic.** A contender re-checks the lock's
  identity (inode and mtime) immediately before removing it. That recheck
  **detects** a replacement that landed while the old lock was being proven
  stale — the common cascade, one contender reclaiming from whoever
  reclaimed first — and the contender gives up and retries. It is a
  detection, not an exclusion: a replacement landing in the window between
  the recheck and the unlink is not seen and is removed. Nothing here
  defends against that window.
- **Sync tools may copy a `.lock` file.** That cannot corrupt data, but a
  synced-in lock from another host is judged by age, so it can delay a local
  `mergeStreamCopy` on that stream by up to 30 s — excluding `.lock` from
  sync patterns remains the right configuration.

Journal writes fsync; note that on macOS `fsync(2)` does not guarantee media
durability (that would need `F_FULLFSYNC`, which Node's fs API does not
expose) — the guarantee is OS-crash-level, not power-loss-level.

**One capture pass at a time.** A pass takes the record root's
`.capture.lock` directory, whose `owner.json` records the pid, a nonce, the
start time and the host. A pass that finds the lock held skips (the next
pass catches up). A pass that is killed (a hook or caller timeout) runs no
cleanup, so the next pass reclaims a lock whose recorded owner is dead on
this host:

- Reclaimers are serialized by a guard, `.capture.lock.reclaim`, taken by
  exclusive create. Under it the record is read again and removed only if it
  still belongs to that dead owner.
- A live or unknowable owner, an owner-less (initializing) lock and another
  host's lock are never touched.
- A guard left by a reclaimer that died is never removed. It is named, with
  the exact recovery.
- Records that name no host predate host recording and live under this
  user's home, so they count as this host's: a dead owner's lock is
  reclaimed too. On a home shared across machines (NFS, or a synced
  directory), such a record may belong to another host, whose pid means
  nothing here; check that no capture runs on the other machines before the
  first pass after upgrading.

## Upgrading

The derived index self-heals across schema changes by wiping and
rebuilding (it is cache; there is no in-place migration). After upgrading
this package, restart any long-running `capture --watch` process — a
daemon holding the old database file open would otherwise keep indexing
into an orphaned inode until it restarts.

## Memory

A capture pass runs in bounded memory, whatever the size of the record.
Journals are streamed, never parsed whole: the first append to a stream
validates its journal one line at a time. Comm logs are read in chunks, and
the aw dedupe looks up only the changed log's own turn ids, in one streamed
read of the journal. A session's new lines are walked, never collected, and
appended in 8 MB batches. A lost offset is rebuilt from the journal's tail.

So the heap a pass needs grows with one changed comm log's entry count, not
with the record. A host job can keep a small `--max-old-space-size`;
`packages/record/test/capture-bounded-memory.test.mjs` captures a record four
times its 64 MB heap. One cost is not on the heap: the new bytes of one
session are read as one buffer, so resident memory grows with a single
session's backlog.

## Known costs, accepted for v1

- Deletion via tombstone is eventual: an offline replica retains bytes until
  it reconnects. The SOT says this plainly; so do we.

## Per-home source authority

`capture --home <dir>` defaults to the kernel's independent managed-launch
record-location history, retained beside the home under `.oats-native-record/`.
It does not re-resolve old `fromEnv` references using the capturing process.
Missing history (legacy/standalone), pending launches, and missing historical
roots fail closed instead of certifying empty observer storage. Runtime switches
and resumed starts retain earlier roots. A managed scaffold with no starts has
an empty managed-launch inventory; executing a saved recipe by hand is not a
managed start.

For a deliberately observer-time inventory, explicitly pass `--current-roots`.
The JSON labels this `sourceRoots: "current-env"`, rather than `"launch-history"`;
completion then applies only to the chosen current inventory, not historical
source custody. The library alternative is `sessionsForHome(home, { roots })`:
unspecified formats are excluded, and missing supplied roots fail. Synthetic
standalone tests must choose one of these explicitly, not masquerade as a
managed native launch. Background capture without `--home` is unchanged.

## One session file: `capture --file`

```text
capture --file <path> --format cc|pi|codex --home <instance home> [--owner <name>] [--json]
```

Captures ONE session file, for example an archived session that the
`--home` sweep can no longer find, exactly as `--home` capture of that
instance would capture it. It runs under the capture lock, as a final pass,
with the ignore rules applied. The stream is `<owner>~<source>.<session id>`,
the same identity `--home` capture writes. So the same session captured
either way, or again with `--file`, appends nothing.

- **The owner is explicit.** It is `--owner` or `TURN_RECORD_OWNER`; the
  hostname is never assumed. `--home` must be an OATS instance home (an
  `instance.json` naming an instance). It is recorded in the receipt, not
  checked against the file's recorded cwd.
- **The format is stated, never sniffed.** The file must carry that format's
  session header somewhere in it:
  - `cc`: a record with a `cwd`, and no other format's session header anywhere
    in the file (a cc transcript never holds one);
  - `pi`: the `session` record;
  - `codex`: `session_meta`.
- **The session id comes from the file name**, as for live capture: the cc
  basename, the part of a pi name after its last `_`, or a codex name's
  trailing uuid. A renamed file lands in another stream.
- **One regular file, read once.** It is opened with `O_NOFOLLOW` and
  `O_NONBLOCK` and fstat'ed. A symlink, FIFO, socket, device or directory is
  refused. The bytes read from that descriptor are the ones captured and
  hashed.

`--json` prints the receipt:
`{home, owner, file, format, instance, thread, stream, sessionId, turns,
firstTurnId, lastTurnId, appended, skipped, held, incomplete, failed, ignored,
status, complete, sha256, issues?}`. `sha256` is of the bytes captured;
`issues` (`[{source, path, reason, offset}]`, present when the result is
incomplete or held) says why. As for
`--home`, `complete` is true only with no hold, no incomplete tail and no
failure. A lock skip, a hold (no timestamp yet) and an incomplete tail (torn
or invalid UTF-8) exit 0 with `complete: false`. Without `--json`, the output
is one line.

Anything that binds nothing is an error,
`{status: "failed", complete: false, code, error}`:

| code | exit | when |
|---|---|---|
| `E_USAGE` | 2 | a missing or invalid flag, a non-instance `--home`, no explicit owner, a second `--file`, another mode |
| `E_FILE_UNREADABLE` | 1 | the file cannot be opened or read |
| `E_NOT_REGULAR_FILE` | 1 | a symlink, FIFO, socket, device or directory |
| `E_IGNORED` | 1 | a capture ignore rule excludes the file; nothing was opened, read or written |
| `E_NO_TURNS` | 1 | no records: an empty file, or only blank lines |
| `E_FORMAT` | 1 | records, but no session header of the stated format; the message names the format whose header it does carry |
| `E_CAPTURE_FAILED` | 1 | the pass failed (`appended: null`: part of the file may be in the record) |
