# @awebai/turn-record

The turn record: an append-only, content-addressed, replicated record of
turns, with the first two tools over it — `capture` and `recall`. Implements
`docs/turn-record-sot.md` from aweb-oss (v1 draft); the vendored conformance
vectors under `test/vectors/` pin the format.

Everything is a signed turn in an append-only record. This package holds:

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
- **`lib/compile-pi.mjs`** — the spawn primitive: compile an outfit (a
  frozen selection of segments) into a native pi session file (v3, per
  pi's documented session format), so a new agent starts life with the
  selected conversation turns already in context. Thinking is folded
  into text (providers reject foreign reasoning), tool call/result
  pairs replay natively when complete, and a spawn note maps the new
  agent to the exact segment versions it wears. Tombstoned events stay
  redacted in the dress.
- **`lib/index-db.mjs`** — derived SQLite FTS5 index (`node:sqlite`, no
  dependencies). `update()` is incremental; `rebuild()` is reset + update
  from zero (same code path). Session text is extracted per event with
  exact line provenance; tombstoned turns disappear.

## Install and run

One shipped bin, `turn-record`, with three subcommands. From a checkout use
`node bin/turn-record.mjs ...`; from an npm install (the package has zero
dependencies and packs clean — `test/packaging.test.mjs` proves the tarball
runs standalone) just `turn-record ...`.

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

turn-record spawn --outfit t1:<hex>             # compile an outfit into a native pi
                                                # session; prints the pi command that
                                                # starts the dressed agent
turn-record spawn --outfit t1:<hex> --dry-run   # compile only, no spawn note

turn-record mind --follow --engine <cmd>        # the consciousness, live: watch this
                                                # owner's session streams and wake the
                                                # followed thread's own jiminy on growth
                                                # (resumes from the last closed
                                                # annotation; --once for cron-style)


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

## The consciousness (jiminy): one per followed life

The reader is not one daemon that judges everything. Every followed life
gets its own jiminy — its own identity, memory, and judgment stream —
because a conscience's value is continuity of attention: only a reader
that has followed THIS agent the whole way can catch the wrong track that
looks fine locally but contradicts a decision from days ago.

- **Naming**: derived from the most durable name the principal has. Today
  every principal is a bare harness session, named
  `jiminy-<session-id-prefix>`; `<name>-jiminy` for aweb-named agents
  (following the agent across runtime sessions) is a designed seam, not
  yet implemented.
- **Memory**: each jiminy keeps its own long-lived pi session, resumed on
  every wake — and since that session lives in pi's normal sessions
  directory, capture records the consciousness's own life like any other
  agent's. The record stays authoritative: segment notes are the
  conclusions; a lost pi session rebuilds working state from them.
- **Streams**: judgments go to `<owner>~mind.<principal>` with
  `from: <jiminy-name>` — one bounded stream per followed life.
- **Lifecycle**: born on first wake — a follow note records the birth (a
  distinct shape from spawn notes, so dressed-agent spawns and jiminy
  births never mix in the index). Death is by staleness: a born jiminy
  whose principal's journal has not grown for `--stale-hours` (default
  24) gets one final wake — the reader sees the remaining tail and is
  told to close what the evidence closes — then a farewell note. Death
  is a point, not a sentence: journal growth after the farewell revives
  the jiminy. A trailing segment the evidence never closed stays
  honestly `ongoing`. Never-followed sessions do not die; backfill is
  explicit. Nothing is deleted.
- **The scheduler is per machine and has no identity**: `mind --follow`
  only notices journal growth and wakes the right jiminy with the delta.

## Multi-machine

Replicate `streams/` and `objects/` with any dumb file sync (syncthing,
rsync, git); never sync `index/`. Owner-only append means concurrent sync
cannot conflict; identical projections dedupe by id; a machine that sees a
non-prefix copy of a stream quarantines it loudly.

## Durability and concurrency

Appends and merges run under a per-stream lockfile
(`streams/<id>/.lock`, exclusive-create, stale after 30 s), because the
torn-tail repair is a read-truncate-write sequence and hooks, watchers and
manual passes can fire concurrently for the same owner. Sync tools may copy
a `.lock` file; that cannot corrupt data, but a synced-in stale lock can
delay a local `mergeStreamCopy` on that stream by up to the stale threshold
(30 s), so excluding `.lock` from sync patterns is the right configuration. Journal writes fsync;
note that on macOS `fsync(2)` does not guarantee media durability (that
would need `F_FULLFSYNC`, which Node's fs API does not expose) — the
guarantee is OS-crash-level, not power-loss-level.

## Upgrading

The derived index self-heals across schema changes by wiping and
rebuilding (it is cache; there is no in-place migration). After upgrading
this package, restart any long-running `capture --watch` process — a
daemon holding the old database file open would otherwise keep indexing
into an orphaned inode until it restarts.

## Known costs, accepted for v1

- Deletion via tombstone is eventual: an offline replica retains bytes until
  it reconnects. The SOT says this plainly; so do we.
