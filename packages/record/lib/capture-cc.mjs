// Capture of session transcripts into the record — Claude Code, pi, and
// Codex (the format registry in formats.mjs says where transcripts live
// and how to name sessions; the storage contract here is format-agnostic).
//
// Verbatim fidelity: the transcript bytes go into the object store
// untouched (unknown or unparseable JSONL records are preserved by
// construction); one `session` turn per (session, snapshot hash)
// references the blob. The turn core is a pure function of the source
// bytes — no capture-time wall clock — so re-capturing an unchanged
// session is a no-op and two captures of the same bytes dedupe by id.
//
// Reconciliation IS the capture: scan everything, append what is new.
// Hooks and watchers only decide when to run it, so a dropped hook or a
// killed watcher is recovered by the next scan.

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { finishTurn } from "./canonical.mjs";
import { jsonlLines, SESSION_FORMATS } from "./formats.mjs";
import { loadIgnore } from "./ignore.mjs";

export const SESSION_STREAM_SOURCE = "cc";

// Default transcript roots for Claude Code (kept for compatibility; the
// per-format defaults live in formats.mjs).
export function defaultSessionRoots(home = undefined) {
  return SESSION_FORMATS.cc.defaultRoots(home);
}

export function listSessionFiles(roots) {
  return SESSION_FORMATS.cc.listFiles(roots);
}

// Extract the last event timestamp and the event count from transcript
// bytes. Every supported format stamps records with a top-level
// `timestamp`; unparseable lines still count as events (they are in the
// blob).
export function scanTranscript(bytes) {
  let ts = null;
  let events = 0;
  for (const { text } of jsonlLines(bytes)) {
    if (text !== null && text.trim() === "") continue;
    events++;
    if (text === null) continue; // over-limit line: an event, nothing to extract
    try {
      const d = JSON.parse(text);
      if (typeof d.timestamp === "string") ts = d.timestamp;
    } catch {
      // preserved verbatim in the blob; nothing to extract
    }
  }
  return { ts, events };
}

// Build the session turn core for one transcript snapshot.
export function sessionTurnCore({ owner, source, sessionId, blobRef, bytes, ts, events }) {
  return {
    v: 1,
    ts,
    from: owner,
    thread: `${source}:session:${sessionId}`,
    kind: "session",
    body: {
      ref: blobRef,
      media_type: "application/jsonl",
      bytes,
      events,
    },
    provenance: {
      source,
      fidelity: "verbatim",
      origin: { session_id: sessionId },
    },
  };
}

// The seen-files cache lives under index/ because it is derived state:
// deleting it costs one full rescan, never data. It maps absolute path ->
// {size, mtimeMs} of the last snapshot taken.
function seenCachePath(store) {
  return join(store.root, "index", "capture-cc-seen.json");
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

// One reconciliation pass for one format: snapshot every session file under
// `roots` into `store`, appending to stream `<owner>~<source>`. Idempotent;
// unchanged files (same size + mtime as the last pass) are skipped without
// reading. Appends are batched with one fsync per pass. Returns counters.
//
// Files matching the record's ignore list (`<root>/ignore`, see ignore.mjs)
// are skipped before being opened: no blob, no turn, no seen-cache entry —
// so un-ignoring a file later makes the next pass capture it normally.
export function captureSessions(store, { owner, roots, format = "cc", ignore = null }) {
  const fmt = SESSION_FORMATS[format];
  if (!fmt) throw new Error(`unknown session format ${format}`);
  const ign = ignore ?? loadIgnore(store.root);
  const streamId = `${owner}~${fmt.source}`;
  const knownIds = new Set(store.readStream(streamId).map((t) => t.id));
  const seen = loadSeenCache(store);
  let sessions = 0;
  let appended = 0;
  let skippedNoTs = 0;
  let unchanged = 0;
  let ignored = 0;
  const fresh = [];
  for (const path of fmt.listFiles(roots)) {
    sessions++;
    if (ign.ignores(path, [basename(path), fmt.sessionId(path)])) {
      ignored++;
      continue; // never opened: nothing stored, nothing remembered
    }
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue; // vanished between listing and stat; next pass catches it
    }
    const prev = seen[path];
    if (prev && prev.size === stat.size && prev.mtimeMs === stat.mtimeMs) {
      unchanged++;
      continue;
    }
    let bytes;
    try {
      bytes = readFileSync(path);
    } catch {
      continue;
    }
    if (bytes.length === 0) continue;
    const { ts, events } = scanTranscript(bytes);
    if (!ts) {
      // No timestamped event yet (brand-new session): skip; the next pass
      // captures it once it has content worth keeping.
      skippedNoTs++;
      continue;
    }
    const blobRef = store.putObject(bytes);
    const core = sessionTurnCore({
      owner,
      source: fmt.source,
      sessionId: fmt.sessionId(path),
      blobRef,
      bytes: bytes.length,
      ts,
      events,
    });
    const finished = finishTurn(core);
    seen[path] = { size: stat.size, mtimeMs: stat.mtimeMs };
    if (knownIds.has(finished.id)) continue;
    knownIds.add(finished.id);
    fresh.push(finished);
  }
  store.appendBatch(streamId, fresh);
  appended = fresh.length;
  saveSeenCache(store, seen);
  return { sessions, appended, skippedNoTs, unchanged, ignored, stream: streamId };
}

// One pass over every known format at its default roots. The ignore list is
// loaded once and shared across formats.
export function captureAllSessions(store, { owner, ignore = null }) {
  const ign = ignore ?? loadIgnore(store.root);
  const results = [];
  for (const format of Object.keys(SESSION_FORMATS)) {
    const roots = SESSION_FORMATS[format].defaultRoots();
    if (roots.length === 0) continue;
    results.push(captureSessions(store, { owner, roots, format, ignore: ign }));
  }
  return results;
}
