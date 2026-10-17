// Local accelerators only. Journal bytes remain authority; removing this
// database costs bounded rebuild work, never changes a turn or its ID.
import { mkdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { keysetRows } from "./sqlite-rows.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export function invalidateLegacyMaps(root) {
  for (const name of ["capture-offsets.json", "capture-aw-seen.json"]) {
    try { unlinkSync(join(root, "index", name)); }
    catch (err) { if (err.code !== "ENOENT") throw err; }
  }
}
export function statVersion(st) {
  return { dev: String(st.dev), ino: String(st.ino), size: Number(st.size), mtime: String(st.mtimeNs ?? st.mtimeMs), ctime: String(st.ctimeNs ?? st.ctimeMs) };
}
export function fileVersion(path) {
  try {
    const st = statSync(path, { bigint: true });
    if (!st.isFile()) throw new Error(`not a regular file: ${path}`);
    return statVersion(st);
  } catch (err) { if (err.code === "ENOENT") return null; throw err; }
}
export const sameVersion = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class DerivedState {
  constructor(root) {
    const { DatabaseSync } = require("node:sqlite");
    mkdirSync(join(root, "index"), { recursive: true });
    this.db = new DatabaseSync(join(root, "index", "capture.db"));
    try {
      this.db.exec("PRAGMA busy_timeout = 60000; PRAGMA cache_size = -2048; PRAGMA temp_store = FILE");
      // A healthy accelerator needs no schema write transaction on every open.
      // Repair rechecks under the write lock, including a lost ID lookup.
      const present = name => this.db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name=?").get(name)?.found === 1;
      if (!present("state") || !present("journal_ids")) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          const hadIds = this.db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='journal_ids'").get()?.found === 1;
          this.db.exec(`CREATE TABLE IF NOT EXISTS state (kind TEXT, key TEXT, value TEXT NOT NULL, PRIMARY KEY(kind, key));
            CREATE TABLE IF NOT EXISTS journal_ids (stream TEXT, id TEXT, PRIMARY KEY(stream, id));`);
          // Recreating a lost lookup atomically revokes the old validation witness.
          // A crash cannot qualify an empty replacement table with that witness.
          if (!hadIds) this.db.exec("DELETE FROM state WHERE kind = 'journal'");
          this.db.exec("COMMIT");
        } catch (err) { this.db.exec("ROLLBACK"); throw err; }
      }
      this.depth = 0;
      this.read = this.db.prepare("SELECT value FROM state WHERE kind = ? AND key = ?");
      this.write = this.db.prepare("INSERT INTO state VALUES (?, ?, ?) ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value WHERE state.value != excluded.value");
    } catch (err) { this.db.close(); throw err; }
  }
  get(kind, key) { const row = this.read.get(kind, key); return row ? JSON.parse(row.value) : null; }
  set(kind, key, value) { this.write.run(kind, key, JSON.stringify(value)); }
  delete(kind, key) { this.db.prepare("DELETE FROM state WHERE kind = ? AND key = ?").run(kind, key); }
  *entries(kind) {
    for (const row of keysetRows(this.db, "SELECT key, value FROM state WHERE kind = ?", "key", [kind])) {
      yield { key: row.key, value: JSON.parse(row.value) };
    }
  }
  transaction(fn) {
    const nested = this.depth > 0, savepoint = `capture_${this.depth}`;
    this.db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    this.depth++;
    try { const result = fn(); this.db.exec(nested ? `RELEASE ${savepoint}` : "COMMIT"); return result; }
    catch (err) {
      this.db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK");
      throw err;
    } finally { this.depth--; }
  }
  close() { this.db.close(); }
}
