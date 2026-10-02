// Capture of aw client logs into the record.
//
// Sources:
//   ~/.config/aw/logs/<account>.jsonl   signed-client comm log (mail + chat)
//   <workspace>/.aw/interaction-log.jsonl
//
// All aw-log turns from one machine land in one stream, `<owner>~aw` —
// the stream is the writer (this machine's capture process), not the
// account; account and file identity live in each turn's provenance.
// Projection is deterministic, so the same entry captured on two machines
// dedupes by id. Reconciliation is the capture: scan, project, append what
// is new, in bounded batches.
//
// Memory is bounded by one changed log's ids, never by the record or a log's
// bytes (awebai/oats#456): a log is read in chunks, and what the stream
// already holds is looked up for that log's ids alone, in one streamed read
// of the journal, never as the whole stream's id set.

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

import {
  projectCommLogEntry,
  projectInteractionLogEntry,
} from "./project-aweb.mjs";
import { loadIgnore } from "./ignore.mjs";

export function defaultCommLogDir(home = homedir()) {
  return join(home, ".config", "aw", "logs");
}

export function awStream(owner) {
  return `${owner}~aw`;
}

export function listCommLogs(dir = defaultCommLogDir()) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => join(dir, name));
}

// The entries of the first `end` bytes of a JSONL log, one at a time, read
// in chunks from `fd` (a comm log can exceed V8's maximum string length).
// A final line without its newline is still an entry when it parses; when it
// does not, it is a torn tail the client is still writing, never counted. An
// interior bad line is skipped and counted (`onSkipped`), never fatal.
function* logEntries(fd, end, onSkipped) {
  let pieces = [], size = 0, position = 0;
  const entryOf = (bytes, final) => {
    const text = bytes.toString("utf8");
    if (text.trim() === "") return undefined;
    try { return JSON.parse(text); }
    catch { if (!final) onSkipped(); return undefined; }
  };
  while (position < end) {
    const chunk = Buffer.allocUnsafe(Math.min(1 << 20, end - position));
    const n = readSync(fd, chunk, 0, chunk.length, position);
    if (n === 0) break;
    position += n;
    let from = 0;
    for (let nl = chunk.indexOf(10, from); nl >= 0 && nl < n; nl = chunk.indexOf(10, from)) {
      pieces.push(chunk.subarray(from, nl));
      size += nl - from;
      const entry = entryOf(pieces.length === 1 ? pieces[0] : Buffer.concat(pieces, size), false);
      pieces = []; size = 0; from = nl + 1;
      if (entry !== undefined) yield entry;
    }
    if (from < n) { pieces.push(chunk.subarray(from, n)); size += n - from; }
  }
  if (size > 0) {
    const entry = entryOf(Buffer.concat(pieces, size), true);
    if (entry !== undefined) yield entry;
  }
}

const APPEND_BATCH = 2000;

// One log file into `streamId`: project every entry, append the turns the
// stream lacks. With `knownIds` (a caller's own set, kept up to date), that
// set decides; without, the log is read twice over the same prefix (its size
// when opened: the client may be appending): once for its turn ids, which one
// streamed read of the journal narrows to those already there, and once to
// append the rest in batches.
function captureLogFile(store, { streamId, path, project, knownIds }) {
  const fd = openSync(path, "r");
  try {
    const end = fstatSync(fd).size;
    let entries = 0, skipped = 0, failed = 0;
    function* turns() {
      entries = 0; skipped = 0; failed = 0;
      for (const entry of logEntries(fd, end, () => skipped++)) {
        entries++;
        let turn;
        try { turn = project(entry); }
        catch {
          // One unprojectable entry must not abort the pass, but it fails
          // visibly: counted here and reported by the caller.
          failed++;
          continue;
        }
        yield turn;
      }
    }
    let known = knownIds;
    if (!known) {
      const candidates = new Set();
      for (const turn of turns()) candidates.add(turn.id);
      known = store.idsAmong(streamId, candidates);
    }
    let appended = 0, batch = [];
    const flush = () => { store.appendBatch(streamId, batch); appended += batch.length; batch = []; };
    for (const turn of turns()) {
      if (known.has(turn.id)) continue;
      known.add(turn.id);
      batch.push(turn);
      if (batch.length >= APPEND_BATCH) flush();
    }
    if (batch.length) flush();
    return { entries, appended, skipped, failed };
  } finally { closeSync(fd); }
}

// Capture one comm-log file into `<owner>~aw`. The account name is the
// filename stem. `knownIds` carries the stream's ids across files in a pass.
//
// Deliberately does NOT consult the ignore list: this is an explicit
// "capture this file" command, and the caller has named the file. The
// `<root>/ignore` policy is enforced at the pass level (captureAwLogs),
// which is the only entry point the capture bin uses.
export function captureCommLog(store, { owner, path, knownIds = null }) {
  const account = basename(path, ".jsonl");
  const streamId = awStream(owner);
  const r = captureLogFile(store, { streamId, path, knownIds, project: (e) => projectCommLogEntry(e, { selfName: account }) });
  return { account, stream: streamId, ...r };
}

// Capture one workspace interaction log into `<owner>~aw`. Like
// captureCommLog, this deliberately bypasses the ignore list: it is an
// explicit per-file command; pass-level entry points enforce the policy.
export function captureInteractionLog(store, { owner, path, selfName, workspace, knownIds = null }) {
  const streamId = awStream(owner);
  const r = captureLogFile(store, { streamId, path, knownIds, project: (e) => projectInteractionLogEntry(e, { selfName, workspace }) });
  return { stream: streamId, ...r };
}

// Derived seen-files cache (same pattern as capture-cc): skip a log file
// whose size+mtime match the last pass without reading or re-projecting it.
function seenCachePath(store) {
  return join(store.root, "index", "capture-aw-seen.json");
}

function loadSeenCache(store) {
  try {
    return JSON.parse(readFileSync(seenCachePath(store), "utf8"));
  } catch {
    return {};
  }
}

function saveSeenCache(store, cache) {
  const path = seenCachePath(store);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache));
}

// One reconciliation pass over every default comm log. Unchanged files are
// skipped; each changed one looks up its own ids in the stream.
//
// Files matching the record's ignore list (`<root>/ignore`, see ignore.mjs)
// are skipped before being opened — no turns, no seen-cache entry — and
// reported as `{ account, path, ignored: true }` so a pass stays visible
// about what it refused to read.
export function captureAwLogs(store, { owner, commLogDir, ignore = null } = {}) {
  const ign = ignore ?? loadIgnore(store.root);
  const seen = loadSeenCache(store);
  const results = [];
  for (const path of listCommLogs(commLogDir ?? defaultCommLogDir())) {
    const account = basename(path, ".jsonl");
    if (ign.ignores(path, [basename(path), account])) {
      results.push({ account, path, ignored: true });
      continue; // never opened: nothing stored, nothing remembered
    }
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    const prev = seen[path];
    if (prev && prev.size === stat.size && prev.mtimeMs === stat.mtimeMs) continue;
    results.push(captureCommLog(store, { owner, path }));
    seen[path] = { size: stat.size, mtimeMs: stat.mtimeMs };
  }
  saveSeenCache(store, seen);
  return results;
}
