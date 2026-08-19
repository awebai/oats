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
// is new, batched with a single fsync per pass.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

function readEntries(path) {
  const entries = [];
  let skipped = 0;
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A torn final line is expected while the client is writing; an
      // interior bad line is skipped and counted, never fatal to capture.
      if (i < lines.length - 1) skipped++;
    }
  }
  return { entries, skipped };
}

function projectFile(entries, project) {
  const turns = [];
  let failed = 0;
  for (const entry of entries) {
    try {
      turns.push(project(entry));
    } catch {
      // One unprojectable entry must not abort the pass, but it fails
      // visibly: counted here and reported by the caller.
      failed++;
    }
  }
  return { turns, failed };
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
  const ids = knownIds ?? new Set(store.readStream(streamId).map((t) => t.id));
  const { entries, skipped } = readEntries(path);
  const { turns, failed } = projectFile(entries, (e) =>
    projectCommLogEntry(e, { selfName: account }),
  );
  const fresh = [];
  for (const turn of turns) {
    if (ids.has(turn.id)) continue;
    ids.add(turn.id);
    fresh.push(turn);
  }
  store.appendBatch(streamId, fresh);
  return {
    account,
    stream: streamId,
    entries: entries.length,
    appended: fresh.length,
    skipped,
    failed,
  };
}

// Capture one workspace interaction log into `<owner>~aw`. Like
// captureCommLog, this deliberately bypasses the ignore list: it is an
// explicit per-file command; pass-level entry points enforce the policy.
export function captureInteractionLog(store, { owner, path, selfName, workspace, knownIds = null }) {
  const streamId = awStream(owner);
  const ids = knownIds ?? new Set(store.readStream(streamId).map((t) => t.id));
  const { entries, skipped } = readEntries(path);
  const { turns, failed } = projectFile(entries, (e) =>
    projectInteractionLogEntry(e, { selfName, workspace }),
  );
  const fresh = [];
  for (const turn of turns) {
    if (ids.has(turn.id)) continue;
    ids.add(turn.id);
    fresh.push(turn);
  }
  store.appendBatch(streamId, fresh);
  return { stream: streamId, entries: entries.length, appended: fresh.length, skipped, failed };
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

// One reconciliation pass over every default comm log. The stream's known
// ids are read once and shared across files; unchanged files are skipped.
//
// Files matching the record's ignore list (`<root>/ignore`, see ignore.mjs)
// are skipped before being opened — no turns, no seen-cache entry — and
// reported as `{ account, path, ignored: true }` so a pass stays visible
// about what it refused to read.
export function captureAwLogs(store, { owner, commLogDir, ignore = null } = {}) {
  const streamId = awStream(owner);
  const ign = ignore ?? loadIgnore(store.root);
  let knownIds = null; // lazy: only read the journal if some file changed
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
    if (!knownIds) knownIds = new Set(store.readStream(streamId).map((t) => t.id));
    results.push(captureCommLog(store, { owner, path, knownIds }));
    seen[path] = { size: stat.size, mtimeMs: stat.mtimeMs };
  }
  saveSeenCache(store, seen);
  return results;
}
