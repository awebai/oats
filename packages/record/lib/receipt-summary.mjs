// Explicit capture receipts prove visible boundaries without retaining journal
// contents or the IDs of the record in memory. Claims use the same first-seen
// non-session union and tombstone authority as RecordStore.tombstoneClaims().
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RecordStore } from "./store.mjs";

export function withReceiptSummaries(store, fn) {
  const dir = mkdtempSync(join(tmpdir(), "turn-record-receipt-"));
  let db;
  try {
    db = new DatabaseSync(join(dir, "claims.db"));
    db.exec(`PRAGMA cache_size = -2048; PRAGMA temp_store = FILE;
      CREATE TABLE seen (id TEXT PRIMARY KEY);
      CREATE TABLE claims (ref TEXT, author TEXT, PRIMARY KEY(ref, author));`);
    const seen = db.prepare("INSERT OR IGNORE INTO seen VALUES (?)");
    const claim = db.prepare("INSERT OR IGNORE INTO claims VALUES (?, ?)");
    const authorKey = (value) => JSON.stringify(value) ?? "undefined";
    let batch = 0;
    db.exec("BEGIN");
    for (const stream of store.listStreams()) {
      if (RecordStore.isSessionStream(stream)) continue;
      for (const turn of store.iterateStream(stream)) {
        if (typeof turn.id !== "string" || !seen.run(turn.id).changes) continue;
        if (turn.kind === "tombstone") {
          for (const link of turn.links ?? []) {
            if (link.rel === "tombstones" && typeof link.ref === "string") claim.run(link.ref, authorKey(turn.from));
          }
        }
        if (++batch >= 2000) { db.exec("COMMIT; BEGIN"); batch = 0; }
      }
    }
    db.exec("COMMIT");
    const hidden = db.prepare("SELECT 1 FROM claims WHERE ref = ? AND (author = ? OR author = ?) LIMIT 1");
    const summary = (stream) => {
      let count = 0, first = null, last = null;
      for (const turn of store.iterateStream(stream)) {
        if (typeof turn.id === "string" && hidden.get(turn.id, authorKey(turn.from), authorKey(store.owner ?? turn.from))) continue;
        count++;
        first ??= turn;
        last = turn;
      }
      return { count, first, last };
    };
    return fn(summary);
  } finally {
    try { db?.close(); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }
}
