// Recovery proof for positional transcript journals. The temporary lookup is
// disk-backed: comparing a long prefix retains one native record at a time.
import { digest } from "./session-snapshot.mjs";
import { randomUUID } from "node:crypto";
import { captureContext } from "./capture-context.mjs";
import { fileVersion, sameVersion } from "./derived-state.mjs";

export function compareTranscriptPrefix(store, stream, state, lines) {
  const db = state.db;
  db.exec("DROP TABLE IF EXISTS temp.transcript_prefix; CREATE TEMP TABLE transcript_prefix (line INTEGER PRIMARY KEY, hash TEXT NOT NULL)");
  const put = db.prepare("INSERT OR IGNORE INTO transcript_prefix VALUES (?, ?)");
  const get = db.prepare("SELECT hash FROM transcript_prefix WHERE line = ?");
  let lastLine = 0, lastTs = "", batch = [];
  const flush = () => state.transaction(() => {
    for (const turn of batch) {
      const line = turn.provenance?.origin?.line;
      if (!Number.isSafeInteger(line) || line < 1 || typeof turn.body?.line !== "string") throw new Error(`invalid positional transcript journal: ${stream}`);
      const hash = digest(Buffer.from(turn.body.line));
      const old = get.get(line);
      if (old?.hash != null && old.hash !== hash) throw new Error(`conflicting positional transcript journal: ${stream}, line ${line}`);
      put.run(line, hash);
      if (line >= lastLine) { lastLine = line; lastTs = turn.ts; }
    }
    batch = [];
  });
  let bytes = 0;
  for (const turn of store.iterateStream(stream)) {
    if (turn.kind !== "session") continue;
    batch.push(turn); bytes += Buffer.byteLength(turn.body?.line ?? "");
    if (batch.length >= 2000 || bytes >= 8 * 1024 * 1024) { flush(); bytes = 0; }
  }
  flush();
  let line = 0, offset = 0;
  if (lastLine) for (const record of lines) {
    line++;
    const expected = get.get(line);
    if (expected?.hash != null && expected.hash !== digest(Buffer.from(record.text))) return { conflict: { line, offset, reason: "captured-prefix-changed" } };
    offset += record.bytes;
    if (line === lastLine) break;
  }
  if (line < lastLine) return { conflict: { line: line + 1, offset, reason: "captured-prefix-missing" } };
  return { bytes: offset, line, lastTs };
}

// Command-only recovery proof. The caller supplies complete native lines from
// an immutable, retained staged snapshot, starting at the requested byte. Its
// id changes whenever that snapshot is replaced. This helper neither opens the
// mutable source nor transfers scratch ownership; those belong to the worker.
// No partial phase authorizes append. Checkpoints and hashes join the caller's
// existing stream-locked processing transaction, with no per-record commits.
export function advanceTranscriptPrefix(store, stream, { key, snapshot, lines, maxRecords = 2000,
  maxBytes = 8 * 1024 * 1024, stopped = () => false, work } = {}) {
  const context = captureContext(store), state = context?.state;
  if (!state?.depth || !context.held.has(stream)) throw new Error("resumable prefix proof requires its stream work group");
  if (typeof key !== "string" || !key || typeof snapshot?.id !== "string" || !snapshot.id ||
      !Number.isSafeInteger(snapshot.size) || snapshot.size < 0 || typeof lines !== "function" ||
      !Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 2000 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) {
    throw new Error("invalid resumable prefix proof");
  }
  const db = state.db;
  if (db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='transcript_prefix'").get()?.found !== 1) {
    db.exec("CREATE TABLE transcript_prefix (job TEXT, line INTEGER, hash TEXT NOT NULL, PRIMARY KEY(job,line))");
    // A recreated hash table must not qualify checkpoints whose rows vanished.
    state.set("prefix-meta", "epoch", randomUUID());
  }
  let epoch = state.get("prefix-meta", "epoch");
  if (epoch === null) { epoch = randomUUID(); state.set("prefix-meta", "epoch", epoch); }
  if (typeof epoch !== "string" || !epoch) throw new Error("invalid transcript prefix cache epoch");
  const journalVersion = fileVersion(store.journalPath(stream));
  let proof = state.get("prefix-proof", key);
  if (!proof || proof.epoch !== epoch || proof.stream !== stream || proof.snapshotId !== snapshot.id ||
      proof.snapshotSize !== snapshot.size || !sameVersion(proof.journalVersion, journalVersion)) {
    proof = { epoch, stream, snapshotId: snapshot.id, snapshotSize: snapshot.size, journalVersion,
      phase: "clear", journalBytes: 0, lastLine: 0, lastTs: "", bytes: 0, line: 0 };
  }
  if (!["clear", "journal", "source", "ready", "conflict"].includes(proof.phase) ||
      !["journalBytes", "lastLine", "bytes", "line"].every(k => Number.isSafeInteger(proof[k]) && proof[k] >= 0) ||
      proof.journalBytes > (journalVersion?.size ?? 0) || proof.bytes > snapshot.size ||
      proof.line > proof.lastLine || typeof proof.lastTs !== "string") throw new Error("invalid transcript prefix checkpoint");
  const publish = () => {
    if (!sameVersion(journalVersion, fileVersion(store.journalPath(stream)))) throw new Error("journal changed during prefix proof");
    state.set("prefix-proof", key, proof);
    return { ...proof, complete: proof.phase === "ready" };
  };
  let records = 0, bytes = 0;
  const stop = () => records >= maxRecords || bytes >= maxBytes || stopped();
  if (proof.phase === "clear") {
    if (stop()) return publish();
    const removed = Number(db.prepare(`DELETE FROM transcript_prefix WHERE rowid IN
      (SELECT rowid FROM transcript_prefix WHERE job=? LIMIT ?)`).run(key, maxRecords).changes);
    records += removed;
    if (work) work.deletedHashes = (work.deletedHashes ?? 0) + removed;
    if (removed < maxRecords) proof.phase = "journal";
  }
  if (proof.phase === "journal" && !stop()) {
    const put = db.prepare("INSERT OR IGNORE INTO transcript_prefix VALUES (?, ?, ?)");
    const get = db.prepare("SELECT hash FROM transcript_prefix WHERE job=? AND line=?");
    const iterator = store.iterateJournal(stream, { start: proof.journalBytes, end: journalVersion?.size ?? 0,
      check: () => { stopped(); } });
    try {
      while (!stop()) {
        const entry = iterator.next();
        if (entry.done) { proof.phase = proof.lastLine ? "source" : "ready"; break; }
        const { turn, end, bytes: used } = entry.value;
        if (turn?.kind === "session") {
          const line = turn.provenance?.origin?.line;
          if (!Number.isSafeInteger(line) || line < 1 || typeof turn.body?.line !== "string") throw new Error(`invalid positional transcript journal: ${stream}`);
          const hash = digest(Buffer.from(turn.body.line)), prior = get.get(key, line);
          if (prior?.hash != null && prior.hash !== hash) throw new Error(`conflicting positional transcript journal: ${stream}, line ${line}`);
          put.run(key, line, hash);
          if (line >= proof.lastLine) { proof.lastLine = line; proof.lastTs = turn.ts; }
        }
        proof.journalBytes = end; records++; bytes += used;
        if (work) { work.journalRecords = (work.journalRecords ?? 0) + 1; work.journalBytes = (work.journalBytes ?? 0) + used; }
      }
    } finally { iterator.return(); }
  }
  if (proof.phase === "source" && !stop()) {
    const get = db.prepare("SELECT hash FROM transcript_prefix WHERE job=? AND line=?");
    const iterator = lines(proof.bytes)[Symbol.iterator]();
    try {
      while (!stop()) {
        const next = iterator.next();
        if (next.done) {
          proof.phase = "conflict";
          proof.conflict = { line: proof.line + 1, offset: proof.bytes, reason: "captured-prefix-missing" };
          break;
        }
        const record = next.value;
        if (typeof record.text !== "string" || !Number.isSafeInteger(record.bytes) || record.bytes < 1 ||
            proof.bytes + record.bytes > snapshot.size) throw new Error("invalid staged prefix line");
        const expected = get.get(key, proof.line + 1);
        records++; bytes += record.bytes;
        if (work) { work.sourceRecords = (work.sourceRecords ?? 0) + 1; work.sourceBytes = (work.sourceBytes ?? 0) + record.bytes; }
        if (expected?.hash != null && expected.hash !== digest(Buffer.from(record.text))) {
          proof.phase = "conflict";
          proof.conflict = { line: proof.line + 1, offset: proof.bytes, reason: "captured-prefix-changed" };
          break;
        }
        proof.bytes += record.bytes; proof.line++;
        if (proof.line === proof.lastLine) { proof.phase = "ready"; break; }
      }
    } finally { iterator.return?.(); }
  }
  return publish();
}

// Reclaim completed/invalidated proof rows in bounded units. Revocation and
// deletion share the processing commit, so interruption cannot leave a ready
// checkpoint qualifying a partially removed hash table.
export function discardTranscriptPrefix(store, stream, key, { maxRecords = 2000 } = {}) {
  const context = captureContext(store), state = context?.state;
  if (!state?.depth || !context.held.has(stream) || !Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 2000) {
    throw new Error("prefix cleanup requires a bounded stream work group");
  }
  const proof = state.get("prefix-proof", key);
  if (proof && proof.stream !== stream) throw new Error("prefix cleanup stream differs");
  state.delete("prefix-proof", key);
  if (state.db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='transcript_prefix'").get()?.found !== 1) return true;
  return Number(state.db.prepare(`DELETE FROM transcript_prefix WHERE rowid IN
    (SELECT rowid FROM transcript_prefix WHERE job=? LIMIT ?)`).run(key, maxRecords).changes) < maxRecords;
}
