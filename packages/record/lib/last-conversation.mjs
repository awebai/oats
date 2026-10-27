// lastConversation — the conversation a restarted instance should reopen.
//
// The roots come from the home's own native-record receipts (what each managed
// start of this harness actually recorded), never from an observer's HOME. A
// transcript is the instance's conversation only when it was STARTED in the
// home itself: a session started in <home>/work is a helper's, not the
// instance's. `since` (the home's createdAt) drops an earlier incarnation of a
// reused name: its receipts started, and its transcripts last changed, before
// this home existed.
//
// Unlike capture, this is a best-effort lookup, so it never certifies complete
// history: a home made before the recorder has receipts only for later starts,
// and those are enough. Unexpected I/O failures throw.

import { closeSync, fstatSync, openSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { isUtf8 } from "node:buffer";

import { SESSION_FORMATS } from "./formats.mjs";
import { bufferLines, fileChunks } from "./file-lines.mjs";
import { nativeHistoryPath } from "./native-history.mjs";
import { CWD_SCAN_BOUND_BYTES, cwdOfLine } from "./sessions-for-home.mjs";

const SOURCE = { claude: "cc", pi: "pi", codex: "codex" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECEIPT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;
// What pi's `--session` resolves as an id, not a path (pi treats `/`, `\` and
// a `.jsonl` suffix as a path). The recorder accepts the same bare form.
const PI_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function canonical(p) {
  try { return realpathSync(p); }
  catch (err) { if (err.code !== "ENOENT") throw err; return resolve(p); }
}

function sinceMs(since) {
  const t = since instanceof Date ? since.getTime() : typeof since === "number" ? since : typeof since === "string" ? Date.parse(since) : NaN;
  if (!Number.isFinite(t)) throw new TypeError("lastConversation needs a valid `since` (the home's createdAt)");
  return t;
}

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }

// The locations this harness's started launches (since `since`) recorded.
// null: there is no v1 receipt custody to trust for this harness.
function receiptRoots(home, runtime, since) {
  const dir = nativeHistoryPath(home);
  let names;
  try { names = readdirSync(dir); }
  catch (err) { if (err.code === "ENOENT") return null; throw err; }
  let header;
  try { header = readJson(join(dir, "history.json")); }
  catch (err) { if (err.code === "ENOENT") return null; throw err; }
  if (header?.version !== 1) return null; // a captured (v2) home keeps protected custody
  const roots = [];
  for (const name of names.sort()) {
    if (!RECEIPT.test(name)) continue; // history.json, temp files, strays
    const row = readJson(join(dir, name));
    if (row?.version !== 1 || row.runtime !== runtime || row.state !== "started") continue;
    if (!(Date.parse(row.startedAt) >= since)) continue;
    if (row.id !== basename(name, ".json") || !Array.isArray(row.locations)) throw new Error(`invalid native record receipt: ${name}`);
    for (const path of row.locations) {
      if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0") || resolve(path) !== path) throw new Error(`invalid native record location in ${name}`);
      if (!roots.includes(path)) roots.push(path);
    }
  }
  return roots.length ? roots : null;
}

// The first native header in the file's complete lines (cwd, and pi's id).
// A tolerant read: other instances' transcripts in a shared root may be
// growing while we look, and only their already-terminated prefix is read.
function header(source, path) {
  let fd;
  try { fd = openSync(path, "r"); }
  catch (err) { if (err.code === "ENOENT") return null; throw err; } // removed since listing
  try {
    const end = Math.min(CWD_SCAN_BOUND_BYTES, fstatSync(fd).size);
    for (const bytes of bufferLines(fileChunks(fd, { end, size: 64 * 1024 }))) {
      if (bytes[bytes.length - 1] !== 10) break; // an unterminated fragment is not a record
      const line = isUtf8(bytes) ? bytes.toString("utf8") : null;
      const cwd = cwdOfLine(source, line);
      if (!cwd) continue;
      return { cwd, id: source === "pi" ? JSON.parse(line).id : undefined };
    }
    return null;
  } finally { closeSync(fd); }
}

/** The harness's last conversation started in `home` since `since`.
 *  `harness`: "claude" | "pi" | "codex"; `since`: ISO string, Date or ms.
 *  Returns { sessionId, path } (sessionId is what the harness's resume flag
 *  takes), or { none: "no-receipts" } / { none: "no-conversation" }. */
export function lastConversation(home, { harness, since } = {}) {
  const source = SOURCE[harness];
  if (!source) throw new Error(`unsupported harness for lastConversation: ${harness}`);
  const after = sinceMs(since);
  const roots = receiptRoots(home, harness, after);
  if (!roots) return { none: "no-receipts" };
  const format = SESSION_FORMATS[source], target = canonical(home);
  let best = null;
  // Non-strict: a recorded root nothing has written to yet is simply empty.
  for (const path of new Set(format.listFiles(roots, { strict: false }))) {
    let sessionId = format.sessionId(path);
    // Claude: never a subagent or sidechain transcript; `claude --resume`
    // takes the parent session's UUID, which is its file's name.
    if (source === "cc" && (basename(dirname(path)) === "subagents" || !UUID.test(sessionId))) continue;
    let mtimeMs;
    try { mtimeMs = statSync(path).mtimeMs; }
    catch (err) { if (err.code === "ENOENT") continue; throw err; }
    // Cheap before any read: shared roots hold every other home's transcripts.
    if (mtimeMs < after || (best && (mtimeMs < best.mtimeMs || (mtimeMs === best.mtimeMs && path > best.path)))) continue;
    const found = header(source, path);
    if (!found || canonical(found.cwd) !== target) continue;
    if (source === "pi") {
      // pi's --session matches the header id; the filename carries the same id.
      if (typeof found.id === "string") sessionId = found.id;
      if (!PI_ID.test(sessionId) || sessionId.endsWith(".jsonl")) continue;
    }
    best = { sessionId, path, mtimeMs };
  }
  return best ? { sessionId: best.sessionId, path: best.path } : { none: "no-conversation" };
}
