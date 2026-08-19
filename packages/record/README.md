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
- **`lib/capture-cc.mjs`** — Claude Code session capture. Verbatim
  transcript blobs + one `session` turn per snapshot; reconciliation is the
  capture (hooks/watchers only decide when to run it); unchanged files are
  skipped by size+mtime.
- **`lib/capture-aw.mjs`** — aw client log capture into `<owner>~aw`.
- **`lib/index-db.mjs`** — derived SQLite FTS5 index (`node:sqlite`, no
  dependencies). `update()` is incremental; `rebuild()` is reset + update
  from zero (same code path). Session text is indexed per event with exact
  line provenance; only the latest snapshot per session is searchable;
  tombstoned turns disappear.

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

turn-record recall "sqlite fts"                 # search mail + chat + sessions together
turn-record recall --kind mail --from acme/x q  # filters
turn-record recall --thread aweb:conv:<id>      # list a thread chronologically
turn-record recall --show t1:<hex>              # print one turn
turn-record recall --reindex                    # full rebuild of the derived index
```

Store root: `--root`, else `$TURN_RECORD_ROOT`, else `~/.turn-record`.
Stream owner: `--owner`, else `$TURN_RECORD_OWNER`, else the short hostname.

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

## Known costs, accepted for v1

- Each session snapshot stores the full transcript blob (append-only
  transcripts make snapshots prefix-related; delta/chunk storage is a later
  optimization, disk is cheap at dogfood scale).
- Deletion via tombstone is eventual: an offline replica retains bytes until
  it reconnects. The SOT says this plainly; so do we.
