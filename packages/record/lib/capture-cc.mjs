// Capture of session transcripts into the record — Claude Code, pi, and
// Codex (the format registry in formats.mjs says where transcripts live
// and how to name sessions).
//
// Corrected model (Juan, 2026-08-19): sessions are turns like everything
// else — never file snapshots. Every native transcript record (a cc JSONL
// line, a pi record, a codex record) becomes ONE turn whose body is the
// verbatim native line text. Each session gets its own stream
// (`<owner>~<source>.<session-id>`), so journals stay bounded by their
// conversation, and capture appends each event exactly once as the file
// grows — storage is linear in conversation size by construction. The
// original transcript is reconstructible by concatenating body.line.
//
// Incremental by source byte offset (cache under index/, derived state:
// losing it is recovered from the journal's own last line number, never
// by re-appending). Reconciliation is the capture: hooks and watchers
// only decide when to run it.
//
// Files matching the record's ignore list (`<root>/ignore`, see
// ignore.mjs) are skipped before being opened: no turn, no offset entry —
// un-ignoring a file later makes the next pass capture it normally.

import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
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

// Last event timestamp + event count of transcript bytes (utility).
export function scanTranscript(bytes) {
  let ts = null;
  let events = 0;
  for (const { text } of jsonlLines(bytes)) {
    if (text !== null && text.trim() === "") continue;
    events++;
    if (text === null) continue;
    try {
      const d = JSON.parse(text);
      if (typeof d.timestamp === "string") ts = d.timestamp;
    } catch {
      /* verbatim content; nothing to extract */
    }
  }
  return { ts, events };
}

// The turn core for one native transcript event.
export function eventTurnCore({ owner, source, sessionId, line, lineNo, ts }) {
  return {
    v: 1,
    ts,
    from: owner,
    thread: `${source}:session:${sessionId}`,
    kind: "session",
    body: { line },
    provenance: {
      source,
      fidelity: "verbatim",
      origin: { session_id: sessionId, line: lineNo },
    },
  };
}

// Offset cache: `<stream>:<absolute source path>` -> { bytes consumed,
// lines emitted, last carried timestamp }. Derived state under index/.
function offsetsPath(store) {
  return join(store.root, "index", "capture-offsets.json");
}

function loadOffsets(store) {
  try {
    return JSON.parse(readFileSync(offsetsPath(store), "utf8"));
  } catch {
    return {};
  }
}

function saveOffsets(store, offsets) {
  const path = offsetsPath(store);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(offsets));
}

// Read bytes of `path` in [start, size).
function readFrom(path, start, size) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(size - start);
    let done = 0;
    while (done < buf.length) {
      const n = readSync(fd, buf, done, buf.length - done, start + done);
      if (n === 0) break;
      done += n;
    }
    return buf.subarray(0, done);
  } finally {
    closeSync(fd);
  }
}

// The journal's last captured source line, read from its tail without
// parsing the whole file (backward scan, doubling window). 0 when the
// journal is missing or empty.
function lastJournalLine(store, streamId) {
  const path = store.journalPath(streamId);
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return 0;
  }
  let window = 64 * 1024;
  while (true) {
    const start = Math.max(0, size - window);
    const tail = readFrom(path, start, size);
    // Last complete line: ignore a torn final line (no trailing newline).
    const text = tail.toString("utf8");
    const endsClean = text.endsWith("\n");
    const parts = text.split("\n").filter((l) => l.trim() !== "");
    const candidates = endsClean ? parts : parts.slice(0, -1);
    for (let i = candidates.length - 1; i >= 0; i--) {
      // The first line of the window may be a fragment; only trust a line
      // we know is whole (preceded by a newline inside the window, or the
      // window covers the whole file).
      if (i === 0 && start > 0) break;
      try {
        return JSON.parse(candidates[i]).provenance?.origin?.line ?? 0;
      } catch {
        continue; // fragment or torn line: look further back
      }
    }
    if (start === 0) return 0;
    window *= 2;
  }
}

// Rebuild a lost offset from the journal: its last turn knows the line
// number it came from; walk the source to that line's byte offset.
// Honest limit: an in-place REWRITE of already-captured lines is not
// detected (only growth is; a shrink triggers a rescan via the size
// check in the caller). Transcript writers are append-only in practice.
function offsetFromJournal(store, streamId, sourcePath) {
  const turns = store.readStream(streamId);
  if (turns.length === 0) return { bytes: 0, line: 0, lastTs: "" };
  const last = turns[turns.length - 1];
  const lastLine = last.provenance?.origin?.line ?? 0;
  const bytes = readFileSync(sourcePath);
  let line = 0;
  let offset = 0;
  while (line < lastLine && offset < bytes.length) {
    const nl = bytes.indexOf(10, offset);
    if (nl === -1) break;
    line++;
    offset = nl + 1;
  }
  return { bytes: offset, line, lastTs: last.ts ?? "" };
}

// One reconciliation pass for one format: one turn per NEW complete line
// of every session file under `roots`. Unstamped leading lines are held
// until the file shows its first timestamp (then they carry it forward),
// so every turn is stamped and ts stays a pure function of the source.
export function captureSessions(store, { owner, roots, format = "cc", ignore = null }) {
  const fmt = SESSION_FORMATS[format];
  if (!fmt) throw new Error(`unknown session format ${format}`);
  const ign = ignore ?? loadIgnore(store.root);
  const offsets = loadOffsets(store);
  let sessions = 0;
  let appended = 0;
  let unchanged = 0;
  let held = 0;
  let ignored = 0;
  const streams = new Set();

  for (const path of fmt.listFiles(roots)) {
    sessions++;
    const sessionId = fmt.sessionId(path);
    if (ign.ignores(path, [basename(path), sessionId])) {
      ignored++;
      continue; // never opened: nothing stored, nothing remembered
    }
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue; // vanished between listing and stat; next pass catches it
    }
    const streamId = `${owner}~${fmt.source}.${sessionId}`;
    // Keyed by stream, not by source path: the same source captured under
    // two owners must not share offset state (owner is part of the stream).
    const offKey = `${streamId}:${path}`;
    let state = offsets[offKey];
    if (state && stat.size < state.bytes) state = null; // source shrank: rescan, no guesswork
    // The offset cache is derived state and can disagree with the journal:
    // behind it when another pass appended meanwhile (re-appending would
    // duplicate lines), ahead of it when a pass raced a stream wipe and
    // saved offsets for appends that landed in an unlinked inode (skipping
    // would lose lines — this happened during the live migration). The
    // journal is the truth; before appending anything, any disagreement
    // rebuilds the offset from it (checked only when the source grew:
    // an unchanged file appends nothing, so its cache cannot mislead).
    if (state && stat.size > state.bytes && state.line !== lastJournalLine(store, streamId)) {
      state = null;
    }
    if (!state) state = offsetFromJournal(store, streamId, path);
    if (stat.size <= state.bytes) {
      unchanged++;
      offsets[offKey] = state;
      continue;
    }

    const chunk = readFrom(path, state.bytes, stat.size);
    // Phase 1: collect the COMPLETE lines of the chunk with their stamps.
    const lines = [];
    let scanned = 0;
    for (const { text } of jsonlLines(chunk)) {
      if (text === null) break; // over-string-limit line: retry later
      const lineBytes = Buffer.byteLength(text, "utf8") + 1;
      if (scanned + lineBytes > chunk.length) break; // no trailing newline yet
      let ts = "";
      if (text.trim() !== "") {
        try {
          const d = JSON.parse(text);
          if (typeof d.timestamp === "string") ts = d.timestamp;
        } catch {
          /* unparseable native line: captured verbatim below */
        }
      }
      lines.push({ text, ts, bytes: lineBytes });
      scanned += lineBytes;
    }
    // Phase 2: every turn needs a stamp. Leading lines before the file's
    // first stamp carry it backward (deterministic: the file's first
    // stamp is invariant however capture is scheduled); if the file has
    // shown no stamp at all yet, hold everything for a later pass.
    let lastTs = state.lastTs ?? "";
    if (!lastTs) {
      const first = lines.find((l) => l.ts);
      if (!first) {
        if (lines.length > 0) held++;
        continue; // do not advance; retry when a stamp exists
      }
      lastTs = first.ts;
    }
    // Turns flush to the journal in bounded batches, so memory stays flat
    // however large the backlog (a first capture of a huge transcript is
    // one file's worth of NEW lines). A crash between flushes cannot
    // duplicate: this file's offset is saved only after its final flush,
    // and a lost offset rebuilds from the journal's own last line number.
    let fresh = [];
    let freshBytes = 0;
    const flush = () => {
      if (fresh.length === 0) return;
      store.appendBatch(streamId, fresh);
      streams.add(streamId);
      appended += fresh.length;
      fresh = [];
      freshBytes = 0;
    };
    let lineNo = state.line;
    let consumed = 0;
    for (const l of lines) {
      if (l.ts) lastTs = l.ts;
      lineNo++;
      consumed += l.bytes;
      // Blank lines are turns too (body.line ""): verbatim-complete means
      // concatenating body.line reconstructs the source byte-exactly.
      fresh.push(
        finishTurn(
          eventTurnCore({ owner, source: fmt.source, sessionId, line: l.text, lineNo, ts: lastTs }),
        ),
      );
      freshBytes += l.bytes;
      if (freshBytes >= 64 * 1024 * 1024) flush();
    }
    const grew = fresh.length > 0 || consumed > 0;
    flush();
    offsets[offKey] = { bytes: state.bytes + consumed, line: lineNo, lastTs };
    // Persist after every file that advanced, not once per pass: a crash
    // later in the pass must not leave THIS file's on-disk offset stale
    // (a stale-but-present offset skips journal recovery, and the rescan
    // re-appends duplicate turn lines — logically deduped by id, but
    // wasted append-only bytes).
    if (grew) saveOffsets(store, offsets);
  }
  saveOffsets(store, offsets);
  return {
    sessions,
    appended,
    unchanged,
    held,
    ignored,
    streams: streams.size,
    stream: `${owner}~${fmt.source}.*`,
  };
}

// One pass over every known format at its default roots. The ignore list
// is loaded once and shared across formats.
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
