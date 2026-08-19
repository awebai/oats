// RecordStore — the on-disk turn record per docs/turn-record-sot.md.
//
// Layout:
//   <root>/streams/<stream-id>/journal.jsonl   replicated, append-only, owner-write
//   <root>/objects/sha256/<hh>/<hex>           replicated, immutable
//   <root>/index/                              derived, rebuildable, never replicated
//
// Invariants enforced here:
//   - appends go only to streams owned by this store's configured owner;
//   - a truncated final journal line is ignored by readers and repaired
//     (truncated away) by the owner on its next append;
//   - merge of two copies of one stream requires the prefix relation;
//   - the effective record is the id-deduplicated union across streams,
//     minus turns hidden by valid tombstones.

import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

import { finishTurn, sha256Hex, verifyTurnId } from "./canonical.mjs";

export class StoreError extends Error {}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function syncPath(path) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// A stream id is `<owner>~<source>`; `~` cannot appear in aweb aliases or
// DID identifiers, and neither side may contain path separators.
export function streamOwner(streamId) {
  const i = streamId.indexOf("~");
  if (i <= 0) throw new StoreError(`invalid stream id ${JSON.stringify(streamId)}`);
  return streamId.slice(0, i);
}

export function validStreamId(streamId) {
  return /^[A-Za-z0-9._-]+~[A-Za-z0-9._-]+$/.test(streamId);
}

// Parse journal text into turns. The final line may be a torn write: if it
// does not end in a newline or is not valid JSON, it is ignored and its byte
// offset reported so the owner can repair. Interior blank lines are
// tolerated as no-ops (they cannot hide data and must stay self-healable);
// interior invalid non-blank lines are corruption and throw.
export function parseJournal(text) {
  const turns = [];
  let offset = 0;
  let validEnd = 0;
  while (offset < text.length) {
    const nl = text.indexOf("\n", offset);
    const isFinal = nl === -1;
    const line = isFinal ? text.slice(offset) : text.slice(offset, nl);
    if (line.trim() === "") {
      if (isFinal) break;
      validEnd = nl + 1;
      offset = nl + 1;
      continue;
    }
    let turn;
    try {
      turn = JSON.parse(line);
    } catch (err) {
      if (isFinal) break; // torn tail: ignored, repaired on next append
      throw new StoreError(`corrupt interior journal line at byte ${offset}: ${err.message}`);
    }
    if (isFinal) break; // valid JSON but no newline: still a torn tail
    turns.push(turn);
    validEnd = nl + 1;
    offset = nl + 1;
  }
  return { turns, validEnd, torn: validEnd < text.length };
}

export class RecordStore {
  constructor(root, { owner, lockTimeoutMs = 10000, lockStaleMs = 30000 } = {}) {
    if (!root) throw new StoreError("record root is required");
    // The lock has no liveness refresh: a holder that outlives lockStaleMs
    // can be stolen from mid-critical-section. Keeping the waiter timeout
    // strictly below the stale threshold guarantees a contender errors out
    // loudly before it could ever steal a live holder's lock.
    if (lockTimeoutMs >= lockStaleMs) {
      throw new StoreError("lockTimeoutMs must be < lockStaleMs (stale-steal would race a live holder)");
    }
    this.root = root;
    this.owner = owner ?? null;
    this.lockTimeoutMs = lockTimeoutMs;
    this.lockStaleMs = lockStaleMs;
  }

  // Serialize every read-repair-write sequence on one stream across
  // processes: hooks, watchers and manual passes can all fire close
  // together for the same owner, and an unguarded repair can truncate a
  // concurrent writer's already-fsynced turn. Exclusive-create lockfile
  // with stale-steal (a crashed holder's lock older than lockStaleMs is
  // removed).
  withStreamLock(streamId, fn) {
    const dir = join(this.streamsDir(), streamId);
    mkdirSync(dir, { recursive: true });
    const lockPath = join(dir, ".lock");
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      try {
        const fd = openSync(lockPath, "wx");
        try {
          writeSync(fd, String(process.pid));
        } finally {
          closeSync(fd);
        }
        break;
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
        let stale = false;
        try {
          stale = Date.now() - statSync(lockPath).mtimeMs > this.lockStaleMs;
        } catch {
          continue; // lock vanished between open and stat: retry now
        }
        if (stale) {
          try {
            unlinkSync(lockPath);
          } catch {
            /* another process stole it first */
          }
          continue;
        }
        if (Date.now() >= deadline) {
          throw new StoreError(`timed out waiting for lock on stream ${streamId} (${lockPath})`);
        }
        sleepSync(25);
      }
    }
    try {
      return fn();
    } finally {
      try {
        unlinkSync(lockPath);
      } catch {
        /* already stolen as stale; nothing to release */
      }
    }
  }

  streamsDir() {
    return join(this.root, "streams");
  }

  journalPath(streamId) {
    if (!validStreamId(streamId)) {
      throw new StoreError(`invalid stream id ${JSON.stringify(streamId)}`);
    }
    return join(this.streamsDir(), streamId, "journal.jsonl");
  }

  listStreams() {
    const dir = this.streamsDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => validStreamId(name) && existsSync(join(dir, name, "journal.jsonl")))
      .sort();
  }

  readStream(streamId) {
    const path = this.journalPath(streamId);
    if (!existsSync(path)) return [];
    return parseJournal(readFileSync(path, "utf8")).turns;
  }

  // Read every turn in the store, id-deduplicated union across streams.
  // Returns Map id -> { turn, stream }.
  readAll() {
    const byId = new Map();
    for (const streamId of this.listStreams()) {
      for (const turn of this.readStream(streamId)) {
        if (typeof turn.id === "string" && !byId.has(turn.id)) {
          byId.set(turn.id, { turn, stream: streamId });
        }
      }
    }
    return byId;
  }

  // Ids hidden by valid tombstones. v1 authority: the tombstone's `from`
  // must equal the target turn's `from`, or the record owner.
  hiddenIds(byId = this.readAll()) {
    const hidden = new Set();
    for (const { turn } of byId.values()) {
      if (turn.kind !== "tombstone") continue;
      for (const link of turn.links ?? []) {
        if (link.rel !== "tombstones") continue;
        const target = byId.get(link.ref);
        if (!target) continue;
        if (turn.from === target.turn.from || (this.owner && turn.from === this.owner)) {
          hidden.add(target.turn.id);
        }
      }
    }
    return hidden;
  }

  // Append a finished turn (id present and correct) to an owned stream.
  // Repairs a torn tail first. Durability: fsync after append.
  append(streamId, turn) {
    this.appendBatch(streamId, [turn]);
  }

  // Build, finish (compute id), dedupe, and append in one step.
  // Returns { turn, appended } — appended=false when the id already exists.
  appendCore(streamId, core, knownIds = null) {
    const turn = finishTurn(core);
    const ids = knownIds ?? new Set(this.readStream(streamId).map((t) => t.id));
    if (ids.has(turn.id)) return { turn, appended: false };
    this.append(streamId, turn);
    ids.add(turn.id);
    return { turn, appended: true };
  }

  // Append many finished turns with one write and one fsync. Same ownership
  // and id checks as append(); an empty batch is a no-op. The read-repair-
  // append sequence runs under the stream lock.
  appendBatch(streamId, turns) {
    if (turns.length === 0) return;
    if (!this.owner) throw new StoreError("store has no owner; cannot append");
    if (streamOwner(streamId) !== this.owner) {
      throw new StoreError(
        `stream ${streamId} is not owned by ${this.owner}; appends are owner-only`,
      );
    }
    for (const turn of turns) {
      if (!verifyTurnId(turn)) throw new StoreError("turn id missing or does not match content");
    }
    const path = this.journalPath(streamId);
    this.withStreamLock(streamId, () => {
      if (existsSync(path)) {
        const text = readFileSync(path, "utf8");
        const { validEnd, torn } = parseJournal(text);
        if (torn) writeFileSync(path, text.slice(0, validEnd));
      }
      appendFileSync(path, turns.map((t) => JSON.stringify(t)).join("\n") + "\n");
      syncPath(path);
    });
  }

  // ------------------------------------------------------------- objects

  objectPath(hexDigest) {
    if (!/^[0-9a-f]{64}$/.test(hexDigest)) {
      throw new StoreError(`invalid sha256 digest ${JSON.stringify(hexDigest)}`);
    }
    return join(this.root, "objects", "sha256", hexDigest.slice(0, 2), hexDigest);
  }

  putObject(bytes) {
    const digest = sha256Hex(bytes);
    const path = this.objectPath(digest);
    if (!existsSync(path)) {
      mkdirSync(join(this.root, "objects", "sha256", digest.slice(0, 2)), { recursive: true });
      const tmp = path + ".tmp-" + process.pid;
      writeFileSync(tmp, bytes);
      renameSync(tmp, path);
    }
    return "sha256:" + digest;
  }

  hasObject(ref) {
    return existsSync(this.objectPath(refDigest(ref)));
  }

  getObject(ref) {
    return readFileSync(this.objectPath(refDigest(ref)));
  }

  // ---------------------------------------------------------------- merge

  // Merge a foreign copy of a stream into this store. Copies of one stream
  // must be prefix-related; the longer wins. Non-prefix copies are
  // quarantined (written beside the journal), never merged silently.
  mergeStreamCopy(streamId, foreignTurns) {
    for (const turn of foreignTurns) {
      if (!verifyTurnId(turn)) {
        throw new StoreError(`foreign copy of ${streamId} contains a turn with a bad id`);
      }
    }
    const path = this.journalPath(streamId);
    return this.withStreamLock(streamId, () => {
      const local = this.readStream(streamId);
      const [shorter, longer] =
        local.length <= foreignTurns.length ? [local, foreignTurns] : [foreignTurns, local];
      for (let i = 0; i < shorter.length; i++) {
        if (shorter[i].id !== longer[i].id) {
          const qPath = join(this.streamsDir(), streamId, `quarantine-${Date.now()}.jsonl`);
          writeFileSync(qPath, foreignTurns.map((t) => JSON.stringify(t)).join("\n") + "\n");
          throw new StoreError(
            `non-prefix copies of stream ${streamId}: foreign copy quarantined at ${qPath}`,
          );
        }
      }
      if (longer === local) return { extended: 0 };
      if (existsSync(path)) {
        const text = readFileSync(path, "utf8");
        const { validEnd, torn } = parseJournal(text);
        if (torn) writeFileSync(path, text.slice(0, validEnd));
      }
      const suffix = longer.slice(local.length);
      appendFileSync(path, suffix.map((t) => JSON.stringify(t)).join("\n") + "\n");
      syncPath(path);
      return { extended: suffix.length };
    });
  }
}

function refDigest(ref) {
  if (typeof ref !== "string" || !ref.startsWith("sha256:")) {
    throw new StoreError(`invalid object ref ${JSON.stringify(ref)}`);
  }
  return ref.slice("sha256:".length);
}
