import { statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
// Feature landed separately on the two release lines; 23.0/23.1 lack it.
export function supportsReadOnlySqlite(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const major = Number(match[1]), minor = Number(match[2]);
  return major > 23 || major === 23 && minor >= 2 || major === 22 && minor >= 12;
}

// The command snapshot and live health diagnosis use the same bounded
// projection. This function owns one read transaction, not the capture lock.
export function readIssueBacklog(db, { pending = false, validate = false } = {}) {
  db.exec("BEGIN");
  try {
    if (validate) {
      if (db.prepare("PRAGMA user_version").get().user_version !== 0) throw new Error("unsupported capture database version");
      const columns = db.prepare("PRAGMA table_info(state)").all();
      if (columns.length !== 3 || columns.some((column, i) =>
        column.name !== ["kind", "key", "value"][i] || column.type !== "TEXT" || column.pk !== [1, 2, 0][i] ||
        column.notnull !== [0, 0, 1][i])) throw new Error("unsupported capture issue-table schema");
    }
    const count = Number(db.prepare("SELECT count(*) AS n FROM state WHERE kind = 'set-aside'").get().n);
    const sample = db.prepare(`SELECT value FROM state WHERE kind = 'set-aside'
      ORDER BY json_extract(value, '$.source'), json_extract(value, '$.path'), key LIMIT 100`).all();
    const setAside = sample.map(({ value }) => {
      const { source, path, offset, reason, line } = JSON.parse(value);
      if (!["aw", "cc", "pi", "codex"].includes(source) || typeof path !== "string" || typeof reason !== "string" ||
          !Number.isSafeInteger(offset) || offset < 0 || (line !== undefined && (!Number.isSafeInteger(line) || line <= 0))) {
        throw new Error("malformed capture issue row");
      }
      return { source, path, offset, reason, ...(line === undefined ? {} : { line }) };
    });
    db.exec("COMMIT");
    return { pending: pending || count > 0, setAsideCount: count, setAside, truncated: count > sample.length };
  } catch (err) { db.exec("ROLLBACK"); throw err; }
}

// A separate process prevents a raw header descriptor close from releasing
// process-owned POSIX locks held by another SQLite connection in this caller.
// It loads no capture writers, retains SQLite locking, and inherits no hooks.
export function readCurrentIssueBacklog(root) {
  const path = join(root, "index", "capture.db");
  try { if (!statSync(path).isFile()) throw new Error("capture.db is not a regular file"); }
  catch (err) { if (err.code === "ENOENT") return null; throw err; }
  if (!supportsReadOnlySqlite(process.versions.node)) throw new Error("read-only capture health needs newer Node with read-only SQLite: use Node 22.13+ on 22.x, 23.2+ on 23.x, or a newer major version");
  const env = Object.fromEntries(["HOME", "TMPDIR", "XDG_CACHE_HOME"].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const result = spawnSync(process.execPath, [
    ...process.execArgv.filter(arg => arg === "--experimental-sqlite"),
    fileURLToPath(new URL("./capture-db-reader.mjs", import.meta.url)), path,
  ], { env, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 10000, killSignal: "SIGKILL" });
  if (result.error) throw result.error;
  let response;
  try { response = JSON.parse(result.stdout); }
  catch { throw new Error(`capture database reader failed (${result.signal ?? result.status}): ${result.stderr?.trim() || "no valid response"}`); }
  if (result.status !== 0 || response.error) throw new Error(response.error ?? "capture database reader failed");
  const b = response.backlog;
  if (!b || typeof b.pending !== "boolean" || !Number.isSafeInteger(b.setAsideCount) || b.setAsideCount < 0 ||
      !Array.isArray(b.setAside) || b.setAside.length !== Math.min(b.setAsideCount, 100) ||
      b.truncated !== (b.setAsideCount > 100)) throw new Error("malformed capture database reader output");
  return b;
}
