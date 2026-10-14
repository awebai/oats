// Internal bounded indexing units. The scheduler must visit the union of live
// streams and index_state streams (including deleted journals), and restart
// its index sweep when reset is returned. This helper alone cannot declare a
// root complete. Public synchronous update/rebuild keep their existing API.
import { closeSync, openSync, readSync } from "node:fs";
import { captureContext } from "./capture-context.mjs";

function cursorValid(store, stream, row, checkpoint) {
  if (!row) return true;
  if (!Number.isSafeInteger(row.bytes) || row.bytes < 0 ||
      !Number.isSafeInteger(row.indexed_count) || row.indexed_count < 0 ||
      row.indexed_count !== row.byte_count || row.epoch !== checkpoint.epoch ||
      row.bytes > checkpoint.bytes || row.indexed_count > checkpoint.count) return false;
  if (row.bytes > 0 && row.bytes < checkpoint.bytes) {
    const fd = openSync(store.journalPath(stream), "r"), byte = Buffer.alloc(1);
    try { return readSync(fd, byte, 0, 1, row.bytes - 1) === 1 && byte[0] === 10; }
    finally { closeSync(fd); }
  }
  return true;
}

export function indexCaptureGroup(index, streams, {
  maxRecords = 2000, maxBytes = 8 * 1024 * 1024, stopped = () => false,
} = {}) {
  const store = index.store, context = captureContext(store);
  if (!context?.state.depth) throw new Error("bounded indexing requires an active capture work group");
  const names = [...new Set(streams)].sort();
  if (!names.length || names.length > 128 || names.some(name => !context.held.has(name)))
    throw new Error("bounded indexing streams must belong to the active capture work group");
  if (!Number.isSafeInteger(maxRecords) || maxRecords < names.length || !Number.isSafeInteger(maxBytes) || maxBytes < names.length)
    throw new Error("bounded indexing must allow at least one work unit per stream");
  const recordsEach = Math.floor(maxRecords / names.length), bytesEach = Math.floor(maxBytes / names.length);
  const get = index.db.prepare(`SELECT s.indexed_count,b.bytes,b.indexed_count AS byte_count,b.epoch
    FROM index_state s LEFT JOIN index_bytes b ON s.stream=b.stream WHERE s.stream=?`);
  const prepared = [], work = { records: 0, bytes: 0, deletedIds: 0 };
  let reset = false;
  // Every group's locks were taken before capture.db's transaction. Validate
  // journals before opening turns.db's transaction; never acquire another
  // stream from inside either database transaction.
  for (const stream of names) {
    if (stopped()) { prepared.push({ stream, phase: "validation" }); continue; }
    const checkpoint = store.validateJournal(stream, context.state, {
      maxRecords: recordsEach, maxBytes: bytesEach, stopped, work,
    });
    const row = get.get(stream);
    if (!cursorValid(store, stream, row?.indexed_count != null ? row : null, checkpoint)) reset = true;
    prepared.push({ stream, checkpoint });
  }
  // Cross-stream tombstones and first-stream attribution make a per-stream
  // row deletion unsound. Keep the reviewed atomic union reset. Publication
  // of its cleared cursor tables is part of that same SQLite transaction.
  if (reset) index.reset();
  const setCount = index.db.prepare("INSERT INTO index_state VALUES (?, ?) ON CONFLICT(stream) DO UPDATE SET indexed_count=excluded.indexed_count");
  const setBytes = index.db.prepare("INSERT INTO index_bytes VALUES (?, ?, ?, ?) ON CONFLICT(stream) DO UPDATE SET bytes=excluded.bytes,indexed_count=excluded.indexed_count,epoch=excluded.epoch");
  let transaction = false, turnsIndexed = 0, bytesIndexed = 0;
  const begin = () => { if (!transaction) { index.db.exec("BEGIN IMMEDIATE"); transaction = true; } };
  try {
    const recordedOwner = index.db.prepare("SELECT value FROM meta WHERE key='owner'").get()?.value ?? null;
    const owner = store.owner ?? recordedOwner;
    if (owner && recordedOwner !== owner) {
      begin(); index.db.prepare("INSERT INTO meta VALUES ('owner',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE meta.value!=excluded.value").run(owner);
    }
    for (const item of prepared) {
      const { stream, checkpoint } = item;
      if (!checkpoint?.complete) { item.phase = "validation"; continue; }
      const row = reset ? undefined : get.get(stream);
      let position = row?.bytes ?? 0, count = row?.indexed_count ?? 0;
      if (position === checkpoint.bytes) { item.phase = "complete"; continue; }
      if (stopped()) { item.phase = "index"; continue; }
      // Fix the validated end for this unit. Later growth is subsequent work.
      const iterator = store.iterateJournal(stream, { start: position, end: checkpoint.bytes });
      let records = 0, bytes = 0;
      try {
        while (records < recordsEach && bytes < bytesEach && !stopped()) {
          const next = iterator.next(); if (next.done) break;
          begin();
          const entry = next.value;
          if (entry.turn !== null) { index.addTurn(entry.turn, stream, owner); count++; turnsIndexed++; }
          position = entry.end; records++; bytes += entry.bytes; bytesIndexed += entry.bytes;
        }
      } finally { iterator.return(); }
      if (records) { setCount.run(stream, count); setBytes.run(stream, position, count, checkpoint.epoch); }
      item.phase = position === checkpoint.bytes ? "complete" : "index";
    }
    if (transaction) index.db.exec("COMMIT");
  } catch (err) { if (transaction) index.db.exec("ROLLBACK"); throw err; }
  return { reset, turnsIndexed, bytesIndexed, validation: work,
    streams: prepared.map(({ stream, phase }) => ({ stream, phase })) };
}
