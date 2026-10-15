// Private root-lock-owned index inventory. Discovery includes old index rows
// so a deleted journal can still invalidate cross-stream tombstone authority.
// Inventory membership/positions confer no journal or index-cursor authority.
import { readdirSync, statSync } from "node:fs";
import { validStreamId } from "./store.mjs";

const pageSize = 128;
const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const sameIdentity = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino;
const validIdentity = value => value === null || value &&
  typeof value.dev === "string" && typeof value.ino === "string";

export class CaptureIndexInventory {
  // The scheduler persists the sweep identity and replaces it after a finished
  // sweep or union reset. Reopening with the same identity resumes discovery.
  constructor(state, { id }) {
    if (state.depth || typeof id !== "string" || !id) throw new Error("invalid capture index inventory identity");
    this.state = state; this.id = id; this.directory = null;
    const present = state.db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='capture_index_inventory'").get()?.found;
    if (!present) state.transaction(() => {
      state.db.exec(`CREATE TABLE IF NOT EXISTS capture_index_inventory (
        scope TEXT NOT NULL, stream TEXT NOT NULL, PRIMARY KEY(scope,stream)
      )`);
      // A missing derived inventory cannot inherit an enumeration checkpoint.
      state.db.exec("DELETE FROM state WHERE kind IN ('index-inventory','index-inventory-garbage')");
    });
    const prior = state.get("index-inventory", "current");
    if (prior && (typeof prior.id !== "string" || !prior.id || !["index", "live", "complete"].includes(prior.phase) ||
        typeof prior.indexAfter !== "string" || typeof prior.liveAfter !== "string" || !validIdentity(prior.directory)))
      throw new Error("invalid capture index inventory checkpoint");
    if (prior?.id !== id) state.transaction(() => {
      if (state.get("index-inventory-garbage", id) !== null) throw new Error("capture index inventory identity was retired");
      if (prior) state.set("index-inventory-garbage", prior.id, true);
      state.set("index-inventory", "current", { id, phase: "index", indexAfter: "", liveAfter: "", directory: null });
    });
  }

  current() {
    const row = this.state.get("index-inventory", "current");
    if (row?.id !== this.id) throw new Error("capture index inventory changed");
    return row;
  }

  // Sorted directory names retain the accepted metadata-array qualification.
  // Only a worker-local array is cached; restart resumes at a binary name key,
  // without depending on a removed anchor still existing in the directory.
  liveDirectory(store, checkpoint, work) {
    const path = store.streamsDir();
    let before;
    try { before = statSync(path, { bigint: true }); }
    catch (error) {
      if (error.code === "ENOENT" && checkpoint.directory === null) return [];
      throw error;
    }
    if (!before.isDirectory()) throw new Error("capture streams root is not a directory");
    const found = identity(before);
    if (checkpoint.directory && !sameIdentity(checkpoint.directory, found))
      throw new Error("capture index inventory directory changed");
    if (!this.directory) {
      const names = readdirSync(path).sort();
      if (!sameIdentity(found, identity(statSync(path, { bigint: true }))))
        throw new Error("capture index inventory directory changed during enumeration");
      this.directory = { path, identity: found, names };
      if (work) { work.directoriesRead = (work.directoriesRead ?? 0) + 1;
        work.directoryEntriesRead = (work.directoryEntriesRead ?? 0) + names.length; }
    }
    if (this.directory.path !== path || !sameIdentity(this.directory.identity, found))
      throw new Error("capture index inventory directory changed");
    checkpoint.directory = found;
    return this.directory.names;
  }

  // Exactly one bounded page per call. The index phase must precede live
  // discovery; a reset/deletion must not make an already-enumerated old stream
  // disappear from this sweep's inventory. Caller restarts the sweep on reset.
  discover(index, { limit = pageSize, stopped = () => false, work } = {}) {
    if (this.state.depth || !Number.isSafeInteger(limit) || limit < 1 || limit > pageSize)
      throw new Error("invalid capture index discovery unit");
    const before = this.current(), next = structuredClone(before), streams = [];
    let scanned = 0;
    if (before.phase === "complete" || stopped()) return { scanned, complete: before.phase === "complete" };
    if (before.phase === "index") {
      const rows = index.db.prepare("SELECT stream FROM index_state WHERE stream>? ORDER BY stream LIMIT ?")
        .all(before.indexAfter, limit);
      for (const row of rows) {
        if (stopped()) break;
        if (!validStreamId(row.stream)) throw new Error("invalid indexed stream in capture inventory");
        streams.push(row.stream); next.indexAfter = row.stream; scanned++;
      }
      if (scanned === rows.length && rows.length < limit) next.phase = "live";
    } else {
      const names = this.liveDirectory(index.store, next, work);
      // Binary search avoids rescanning all earlier names in a retained array.
      let low = 0, high = names.length;
      while (low < high) { const middle = Math.floor((low + high) / 2);
        if (names[middle] <= before.liveAfter) low = middle + 1; else high = middle; }
      let position = low;
      while (position < names.length && scanned < limit && !stopped()) {
        const name = names[position++]; scanned++; next.liveAfter = name;
        if (!validStreamId(name)) continue;
        try {
          if (!statSync(index.store.journalPath(name)).isFile()) throw new Error("capture inventory journal is not a regular file");
        } catch (error) { if (error.code === "ENOENT") continue; throw error; }
        streams.push(name);
      }
      if (position === names.length) next.phase = "complete";
      if (next.directory && !sameIdentity(next.directory, identity(statSync(index.store.streamsDir(), { bigint: true }))))
        throw new Error("capture index inventory directory changed during enumeration");
    }
    if (work) work.entriesVisited = (work.entriesVisited ?? 0) + scanned;
    this.state.transaction(() => {
      if (JSON.stringify(this.current()) !== JSON.stringify(before)) throw new Error("capture index inventory checkpoint changed");
      const insert = this.state.db.prepare("INSERT OR IGNORE INTO capture_index_inventory VALUES (?,?)");
      for (const stream of streams) insert.run(this.id, stream);
      this.state.set("index-inventory", "current", next);
    });
    if (next.phase === "complete") this.directory = null;
    return { scanned, complete: next.phase === "complete" };
  }

  // One finite rotation of discovered names; admission owns the durable next
  // position. No row is omitted because a previous unit appeared complete:
  // this inventory alone cannot detect every external index reset or write.
  *ordered({ stopped = () => false, work } = {}) {
    this.current();
    const after = this.state.get("capture-schedule", "position:index")?.after ?? "";
    if (typeof after !== "string") throw new Error("invalid capture index inventory position");
    for (const later of [true, false]) {
      let last = later ? after : "";
      while (!stopped()) {
        this.current();
        const rows = this.state.db.prepare(`SELECT stream FROM capture_index_inventory WHERE scope=? AND stream>?
          ${later ? "" : "AND stream<=?"} ORDER BY stream LIMIT ${pageSize}`)
          .all(...(later ? [this.id, last] : [this.id, last, after]));
        if (work) work.inventoryRows = (work.inventoryRows ?? 0) + rows.length;
        if (!rows.length) break;
        for (const row of rows) {
          if (stopped()) return;
          last = row.stream; yield row.stream;
        }
      }
    }
  }

  cleanup() {
    if (!this.state.depth) throw new Error("capture index inventory cleanup requires a transaction");
    this.current();
    const obsolete = this.state.db.prepare("SELECT key FROM state WHERE kind='index-inventory-garbage' ORDER BY key LIMIT 1").get()?.key;
    if (obsolete == null) return 0;
    if (obsolete === this.id) throw new Error("active capture index inventory cannot be deleted");
    const count = Number(this.state.db.prepare(`DELETE FROM capture_index_inventory WHERE rowid IN (
      SELECT rowid FROM capture_index_inventory WHERE scope=? ORDER BY stream LIMIT ${pageSize})`).run(obsolete).changes);
    if (!this.state.db.prepare("SELECT 1 AS found FROM capture_index_inventory WHERE scope=? LIMIT 1").get(obsolete)?.found)
      this.state.delete("index-inventory-garbage", obsolete);
    return count;
  }

  close() { this.directory = null; }
}
