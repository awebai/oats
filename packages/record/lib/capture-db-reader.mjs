import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readIssueBacklog, supportsReadOnlySqlite } from "./capture-issues.mjs";
const require = createRequire(import.meta.url);

// Supported capture writers use rollback journaling. SQLite may create WAL
// sidecars even for a readOnly connection; refuse that mode before SQLite opens
// it. This is not protection against an external actor racing a journal-mode
// change or file replacement. No supported writer performs either operation.
export function readCaptureDatabase(path) {
  if (!supportsReadOnlySqlite(process.versions.node)) throw new Error("read-only capture health requires newer Node with read-only SQLite (22.13+ on 22.x, 23.2+ on 23.x, or newer major)");
  let fd;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK); }
  catch (err) { if (err.code === "ENOENT") return null; throw err; }
  try {
    if (!fstatSync(fd).isFile()) throw new Error("capture.db is not a regular file");
    const header = Buffer.alloc(100);
    if (readSync(fd, header, 0, header.length, 0) !== header.length ||
        header.subarray(0, 16).toString() !== "SQLite format 3\0") throw new Error("invalid capture.db header");
    if (header[18] === 2 || header[19] === 2) throw new Error("WAL capture.db is unsupported by the read-only health reader; use a supported rollback-journal database");
    if (header[18] !== 1 || header[19] !== 1) throw new Error("unsupported capture.db journal format");
  } finally { closeSync(fd); }

  let DatabaseSync;
  try { ({ DatabaseSync } = require("node:sqlite")); }
  catch (err) { throw new Error(`read-only SQLite is unavailable; rerun health with Node 22.13+ on 22.x, 23.2+ on 23.x, or newer major: ${err.message}`); }
  const db = new DatabaseSync(path, { open: false, readOnly: true });
  db.open();
  try {
    db.exec("PRAGMA busy_timeout = 250; PRAGMA query_only = ON; PRAGMA cache_size = -2048; PRAGMA temp_store = FILE");
    return readIssueBacklog(db, { validate: true });
  } finally { db.close(); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { console.log(JSON.stringify({ backlog: readCaptureDatabase(process.argv[2]) })); }
  catch (err) { console.log(JSON.stringify({ error: err.message })); process.exitCode = 1; }
}
