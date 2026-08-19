// Capture of Claude Code session transcripts into the record.
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

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

import { finishTurn } from "./canonical.mjs";

export const SESSION_STREAM_SOURCE = "cc";

// Default transcript roots: every ~/.claude*/projects directory.
export function defaultSessionRoots(home = homedir()) {
  const roots = [];
  for (const name of readdirSync(home).sort()) {
    if (!name.startsWith(".claude")) continue;
    const projects = join(home, name, "projects");
    if (existsSync(projects)) roots.push(projects);
  }
  return roots;
}

export function listSessionFiles(roots) {
  const files = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const project of readdirSync(root).sort()) {
      const dir = join(root, project);
      let names;
      try {
        names = readdirSync(dir);
      } catch {
        continue; // not a directory
      }
      for (const name of names.sort()) {
        if (name.endsWith(".jsonl")) files.push(join(dir, name));
      }
    }
  }
  return files;
}

// Extract the last event timestamp and the event count from transcript
// bytes. Unparseable lines still count as events (they are in the blob).
export function scanTranscript(bytes) {
  let ts = null;
  let events = 0;
  for (const line of bytes.toString("utf8").split("\n")) {
    if (line.trim() === "") continue;
    events++;
    try {
      const d = JSON.parse(line);
      if (typeof d.timestamp === "string") ts = d.timestamp;
    } catch {
      // preserved verbatim in the blob; nothing to extract
    }
  }
  return { ts, events };
}

// Build the session turn core for one transcript snapshot.
export function sessionTurnCore({ owner, sessionId, blobRef, bytes, ts, events }) {
  const core = {
    v: 1,
    ts,
    from: owner,
    thread: `cc:session:${sessionId}`,
    kind: "session",
    body: {
      ref: blobRef,
      media_type: "application/jsonl",
      bytes,
      events,
    },
    provenance: {
      source: SESSION_STREAM_SOURCE,
      fidelity: "verbatim",
      origin: { session_id: sessionId },
    },
  };
  return core;
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

// One reconciliation pass: snapshot every session file under `roots` into
// `store`, appending to stream `<owner>~cc`. Idempotent; unchanged files
// (same size + mtime as the last pass) are skipped without reading.
// Appends are batched with one fsync per pass. Returns counters.
export function captureSessions(store, { owner, roots }) {
  const streamId = `${owner}~${SESSION_STREAM_SOURCE}`;
  const knownIds = new Set(store.readStream(streamId).map((t) => t.id));
  const seen = loadSeenCache(store);
  let sessions = 0;
  let appended = 0;
  let skippedNoTs = 0;
  let unchanged = 0;
  const fresh = [];
  for (const path of listSessionFiles(roots)) {
    sessions++;
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
      sessionId: basename(path, ".jsonl"),
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
  return { sessions, appended, skippedNoTs, unchanged, stream: streamId };
}
