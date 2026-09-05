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
  ftruncateSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";

import { finishTurn, sha256Hex, verifyTurnId } from "./canonical.mjs";
import { jsonlLines } from "./formats.mjs";

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

// Repair a torn journal tail without reading the whole file: our writer
// appends complete lines in one write, so the only crash artifact is a
// final line without its newline. Truncate back to the last newline,
// scanning backward in bounded chunks.
export function repairTail(path) {
  if (!existsSync(path)) return;
  const size = statSync(path).size;
  if (size === 0) return;
  const fd = openSync(path, "r+");
  try {
    const one = Buffer.alloc(1);
    readSync(fd, one, 0, 1, size - 1);
    if (one[0] === 10) return; // ends with \n: intact
    const CHUNK = 65536;
    let pos = size - 1; // last byte is already known not to be \n
    while (pos > 0) {
      const start = Math.max(0, pos - CHUNK);
      const buf = Buffer.alloc(pos - start);
      readSync(fd, buf, 0, buf.length, start);
      const nl = buf.lastIndexOf(10);
      if (nl !== -1) {
        ftruncateSync(fd, start + nl + 1);
        return;
      }
      pos = start;
    }
    ftruncateSync(fd, 0); // the whole file was one torn line
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
export function parseJournal(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  const turns = [];
  let validEnd = 0;
  let offset = 0;
  while (offset < bytes.length) {
    let nl = bytes.indexOf(10, offset);
    const isFinal = nl === -1;
    if (isFinal) nl = bytes.length;
    let text = null;
    try {
      text = bytes.toString("utf8", offset, nl);
    } catch {
      // single line beyond the string limit: treat as torn if final,
      // corrupt if interior (same rule as unparseable JSON below)
    }
    if (text !== null && text.trim() === "") {
      if (isFinal) break;
      validEnd = nl + 1;
      offset = nl + 1;
      continue;
    }
    let turn = null;
    if (text !== null) {
      try {
        turn = JSON.parse(text);
      } catch {
        turn = null;
      }
    }
    if (turn === null) {
      if (isFinal) break; // torn tail: ignored, repaired on next append
      throw new StoreError(`corrupt interior journal line at byte ${offset}`);
    }
    if (isFinal) break; // valid JSON but no newline: still a torn tail
    turns.push(turn);
    validEnd = nl + 1;
    offset = nl + 1;
  }
  return { turns, validEnd, torn: validEnd < bytes.length };
}

// ----------------------------------------------------------- stream lock
//
// The per-stream lock is an exclusive-create lockfile carrying an OWNER
// TOKEN: the creating process's pid, its hostname, and a random nonce.
// Two properties follow from the token that a bare lockfile cannot give:
//
//   - staleness is judged against the HOLDER'S LIVENESS, not the lock's
//     age, so a contender that arrives late against a still-running holder
//     waits (or times out) instead of stealing a live lock; and
//   - release unlinks the lock only while it still carries the releaser's
//     nonce, so a holder whose lock was reclaimed cannot delete the
//     replacement lock out from under its new owner.
//
// Crash recovery is preserved: a lock whose pid is gone from this host is
// provably stale and is reclaimed at once, without waiting out any age.
//
// Age remains the fallback for the two cases where liveness is not
// knowable here: a lock created on another host (file sync can copy one
// in) and a lock with no readable token (written by an older version, or
// by hand).

function newLockToken() {
  return {
    pid: process.pid,
    host: hostname(),
    nonce: randomBytes(12).toString("hex"),
    acquiredAt: new Date().toISOString(),
  };
}

// Create the lock, or report that someone else holds it. The payload is
// written to a temp file and hard-linked into place, so the lock never
// exists with partial or empty content: a contender that can see the file
// can always read the whole token.
function createLock(lockPath, dir, token) {
  const tmp = join(dir, `.lock.tmp-${token.pid}-${token.nonce}`);
  try {
    writeFileSync(tmp, JSON.stringify(token) + "\n");
    try {
      linkSync(tmp, lockPath);
      return true;
    } catch (err) {
      if (err.code === "EEXIST") return false;
      throw err;
    }
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* never created, or already gone */
    }
  }
}

// Read the lock as { token, ino, mtimeMs }; token is null when the file
// holds no readable owner token. Returns null when the lock has vanished.
function readLock(lockPath) {
  let st;
  let raw;
  try {
    st = statSync(lockPath);
    raw = readFileSync(lockPath, "utf8");
  } catch {
    return null;
  }
  let token = null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.pid === "number" &&
      typeof parsed.host === "string" &&
      typeof parsed.nonce === "string"
    ) {
      token = parsed;
    }
  } catch {
    /* no token: an older or hand-written lock, judged by age below */
  }
  return { token, ino: st.ino, mtimeMs: st.mtimeMs };
}

// true / false when the holder's liveness is knowable from this process,
// null when it is not (the lock was created on another host). EPERM means
// the process exists and belongs to another user: alive.
function holderAlive(token) {
  if (token.host !== hostname()) return null;
  try {
    process.kill(token.pid, 0);
    return true;
  } catch (err) {
    return err.code === "ESRCH" ? false : true;
  }
}

function lockIsProvenStale(held, staleMs) {
  if (held.token) {
    const alive = holderAlive(held.token);
    if (alive === true) return false; // live holder: never stealable, at any age
    if (alive === false) return true; // dead holder: crash recovery
  }
  return Date.now() - held.mtimeMs > staleMs;
}

// Remove a lock we have proven stale — and only that lock. The identity
// check makes the remover give up when the file it proved stale has since
// been replaced by a new holder's lock, so a reclaim cannot cascade into
// stealing from whoever reclaimed first.
function removeStaleLock(lockPath, held) {
  try {
    const st = statSync(lockPath);
    if (st.ino !== held.ino || st.mtimeMs !== held.mtimeMs) return;
    unlinkSync(lockPath);
  } catch {
    /* reclaimed by someone else first */
  }
}

// Release: unlink only while the lock still carries our nonce. If it was
// reclaimed (we ran long enough to be judged dead, or a sync overwrote
// it), the file now belongs to another holder and is left alone.
function releaseOwnedLock(lockPath, token) {
  const held = readLock(lockPath);
  if (held === null) return;
  if (!held.token || held.token.nonce !== token.nonce) return;
  try {
    unlinkSync(lockPath);
  } catch {
    /* already gone */
  }
}

function describeHolder(held) {
  if (!held || !held.token) return "holder unknown";
  return `held by pid ${held.token.pid} on ${held.token.host} since ${held.token.acquiredAt}`;
}

export class RecordStore {
  constructor(root, { owner, lockTimeoutMs = 10000, lockStaleMs = 30000 } = {}) {
    if (!root) throw new StoreError("record root is required");
    // lockTimeoutMs is how long a contender waits; lockStaleMs is how old a
    // lock must be before it is reclaimed WHEN ITS HOLDER'S LIVENESS CANNOT
    // BE CHECKED (foreign host, no readable token). There is deliberately no
    // ordering constraint between them: safety against stealing a live
    // holder's lock comes from the owner token, not from the two thresholds
    // being ordered — an ordering that never held, because the waiter's
    // timeout starts when the contender arrives while age is measured from
    // the lock's creation.
    this.root = root;
    this.owner = owner ?? null;
    this.lockTimeoutMs = lockTimeoutMs;
    this.lockStaleMs = lockStaleMs;
    // Streams whose full journal this instance has parsed without error.
    // The write path validates each journal once before its first append
    // (interior corruption must fail loud, never accept appends after the
    // damage); its own appends are trusted afterwards.
    this.validatedStreams = new Set();
  }

  // Serialize every read-repair-write sequence on one stream across
  // processes: hooks, watchers and manual passes can all fire close
  // together for the same owner, and an unguarded repair can truncate a
  // concurrent writer's already-fsynced turn. Exclusive-create lockfile
  // carrying an owner token; see the stream-lock helpers above for how
  // staleness is proven and why release is ownership-checked.
  withStreamLock(streamId, fn) {
    const dir = join(this.streamsDir(), streamId);
    mkdirSync(dir, { recursive: true });
    const lockPath = join(dir, ".lock");
    const token = newLockToken();
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      if (createLock(lockPath, dir, token)) break;
      const held = readLock(lockPath);
      if (held === null) continue; // vanished between link and read: retry now
      if (lockIsProvenStale(held, this.lockStaleMs)) {
        removeStaleLock(lockPath, held);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new StoreError(
          `timed out waiting for lock on stream ${streamId} (${lockPath}, ${describeHolder(held)})`,
        );
      }
      sleepSync(25);
    }
    try {
      return fn();
    } finally {
      releaseOwnedLock(lockPath, token);
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
    return parseJournal(readFileSync(path)).turns;
  }

  // Is this a session-content stream (`<owner>~<source>.<session-id>`)?
  // Their journals hold whole conversations and can be large, so bulk
  // reads exclude them unless asked; access them per-thread instead.
  static isSessionStream(streamId) {
    return /~(cc|pi|codex)\./.test(streamId);
  }

  // Streams holding the turns of one session thread, across owners.
  sessionStreamsFor(thread) {
    const m = /^(cc|pi|codex):session:(.+)$/.exec(thread);
    if (!m) return [];
    const suffix = `~${m[1]}.${m[2]}`;
    return this.listStreams().filter((s) => s.endsWith(suffix));
  }

  // Read every turn in the store, id-deduplicated union across streams.
  // Session-content streams are excluded by default (their journals hold
  // whole conversations; read those per-thread via sessionStreamsFor).
  // Returns Map id -> { turn, stream }.
  readAll({ includeSessionContent = false } = {}) {
    const byId = new Map();
    for (const streamId of this.listStreams()) {
      if (!includeSessionContent && RecordStore.isSessionStream(streamId)) continue;
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
    const claims = this.tombstoneClaims(byId);
    const hidden = new Set();
    for (const { turn } of byId.values()) {
      if (this.claimHides(claims, turn)) hidden.add(turn.id);
    }
    return hidden;
  }

  // Tombstone claims by target ref: ref -> Set of tombstoning authors.
  // hiddenIds() resolves claims against the turns present in byId; use
  // claims + claimHides() directly when iterating turns that are NOT in
  // byId — session streams are excluded from readAll() by default, yet a
  // tombstone in any stream must still hide a session event (per-line
  // redaction is a first-class operation in the per-event model).
  tombstoneClaims(byId = this.readAll()) {
    const claims = new Map();
    for (const { turn } of byId.values()) {
      if (turn.kind !== "tombstone") continue;
      for (const link of turn.links ?? []) {
        if (link.rel !== "tombstones" || typeof link.ref !== "string") continue;
        let authors = claims.get(link.ref);
        if (!authors) claims.set(link.ref, (authors = new Set()));
        authors.add(turn.from);
      }
    }
    return claims;
  }

  // v1 authority: a claim hides a turn when its author is the turn's
  // author or the record owner.
  claimHides(claims, turn) {
    const authors = claims.get(turn.id);
    if (!authors) return false;
    return authors.has(turn.from) || (this.owner !== null && authors.has(this.owner));
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

  // Append many finished turns with bounded writes and one fsync. Same
  // ownership and id checks as append(); an empty batch is a no-op. The
  // read-repair-append sequence runs under the stream lock. Writes are
  // chunked by bytes, never one join of the whole batch: a large session
  // captured in one pass is a single batch, and joining it can exceed
  // V8's maximum string length (this crashed the first live recapture).
  appendBatch(streamId, turns, maxChunkBytes = 32 * 1024 * 1024) {
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
      // First append to this stream in this instance: parse the whole
      // journal, so interior corruption throws here instead of silently
      // collecting appends behind the damage. A torn tail is tolerated
      // (parseJournal treats it as final-line-torn) and repaired below.
      if (!this.validatedStreams.has(streamId) && existsSync(path)) {
        parseJournal(readFileSync(path));
      }
      this.validatedStreams.add(streamId);
      repairTail(path);
      let chunk = [];
      let chunkBytes = 0;
      const flush = () => {
        if (chunk.length === 0) return;
        appendFileSync(path, chunk.join("\n") + "\n");
        chunk = [];
        chunkBytes = 0;
      };
      for (const turn of turns) {
        const line = JSON.stringify(turn);
        if (chunkBytes > 0 && chunkBytes + line.length > maxChunkBytes) flush();
        chunk.push(line);
        chunkBytes += line.length + 1;
      }
      flush();
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
      repairTail(path);
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
