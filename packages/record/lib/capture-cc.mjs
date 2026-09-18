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

import { isUtf8 } from "node:buffer";
import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { finishTurn } from "./canonical.mjs";
import { jsonlLines, SESSION_FORMATS } from "./formats.mjs";
import { loadIgnore } from "./ignore.mjs";
import { assertIdentity, digest, identity, readRange, verifySnapshot } from "./session-snapshot.mjs";
import { guardCapturedPath } from "./native-history.mjs";
import { isDeepStrictEqual } from "node:util";

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
      if (typeof d?.timestamp === "string") ts = d.timestamp;
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
  } catch (err) {
    // This cache is derived, so malformed JSON can be rebuilt. An I/O
    // failure is different: never hide an unreadable cache as missing.
    if (err.code === "ENOENT" || err instanceof SyntaxError) return {};
    throw err;
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
      if (n === 0) throw new Error(`short read of session/journal source: ${path}`);
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
  } catch (err) {
    if (err.code === "ENOENT") return 0;
    throw err;
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
function offsetFromJournal(store, streamId, sourcePath, final, sourceBytes) {
  const turns = store.readStream(streamId);
  if (turns.length === 0) return { bytes: 0, line: 0, lastTs: "" };
  const last = turns[turns.length - 1];
  const lastLine = last.provenance?.origin?.line ?? 0;
  const bytes = sourceBytes ?? readFileSync(sourcePath);
  let line = 0;
  let offset = 0;
  while (line < lastLine && offset < bytes.length) {
    const nl = bytes.indexOf(10, offset);
    if (nl === -1) break;
    line++;
    offset = nl + 1;
  }
  if (final && line < lastLine) throw new Error(`session source is shorter than its captured journal: ${sourcePath}`);
  return { bytes: offset, line, lastTs: last.ts ?? "" };
}

// One reconciliation pass for one format: one turn per NEW complete line
// of every session file under `roots`. Unstamped leading lines are held
// until the file shows its first timestamp (then they carry it forward),
// so every turn is stamped and ts stays a pure function of the source.
// `files` accepts discovery entries (including their attribution snapshot) or
// explicit paths for callers not making home-attribution claims. It pins a set,
// rather than rescanning directories
// and silently losing disappeared sources (or sweeping in other homes).
// `final` also verifies unchanged offsets against journals and checks source
// stability through the pass. The caller must quiesce writers for retirement;
// a performed pass is a snapshot, not a promise about future writes.
export function captureSessions(store, { owner, roots, files, format = "cc", ignore = null, final = false }) {
  const fmt = SESSION_FORMATS[format];
  if (!fmt) throw new Error(`unknown session format ${format}`);
  const ign = ignore ?? loadIgnore(store.root);
  const offsets = loadOffsets(store);
  let sessions = 0;
  let appended = 0;
  let unchanged = 0;
  let held = 0;
  let ignored = 0;
  let incomplete = 0;
  const issues = []; // source metadata only, never native record contents
  const streams = new Set();

  for (const file of files ?? fmt.listFiles(roots)) {
    const path = typeof file === "string" ? file : file.path;
    const expected = typeof file === "string" ? null : file.snapshot;
    const capturedPi = typeof file === "string" ? undefined : file.capturedPi ?? expected?.capturedPi;
    if (capturedPi && (fmt.source !== "pi" || (expected?.capturedPi && !isDeepStrictEqual(capturedPi, expected.capturedPi)))) throw new Error("protected capture proof/format differs from discovery");
    guardCapturedPath(path, capturedPi);
    sessions++;
    const sessionId = fmt.sessionId(path);
    if (ign.ignores(path, [basename(path), sessionId, ...(fmt.ignoreKeys?.(path) ?? [])])) {
      ignored++;
      continue; // never opened: nothing stored, nothing remembered
    }
    const fd = openSync(path, capturedPi ? constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK : "r");
    try {
    const stat = fstatSync(fd);
    const snapshot = { ...identity(stat), ...(capturedPi ? { capturedPi } : {}) };
    if (expected) assertIdentity(stat, expected, path); // BEFORE reading bytes
    // Final home capture stages a descriptor-pinned snapshot. All attribution
    // and stability checks precede the first append, never a post-write alarm.
    const sourceBytes = final || expected || capturedPi ? readRange(fd, 0, stat.size, path, capturedPi) : undefined;
    if (expected && digest(sourceBytes.subarray(0, expected.size)) !== expected.hash) {
      throw new Error(`session source content changed since attribution: ${path}`);
    }
    if (sourceBytes) snapshot.hash = digest(sourceBytes);
    const verifySource = () => {
      guardCapturedPath(path, capturedPi);
      if (sourceBytes) verifySnapshot(fd, path, snapshot);
    };
    verifySource();
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
    // rebuilds the offset from it. Background passes check on growth;
    // final passes also verify unchanged files before confirming capture.
    if (state && (final || stat.size > state.bytes) && state.line !== lastJournalLine(store, streamId)) {
      state = null;
    }
    if (!state) state = offsetFromJournal(store, streamId, path, final, sourceBytes);
    if (stat.size <= state.bytes) {
      unchanged++;
      offsets[offKey] = state;
      verifySource();
      continue;
    }

    const chunk = sourceBytes ? sourceBytes.subarray(state.bytes) : readRange(fd, state.bytes, stat.size, path, capturedPi);
    // Phase 1: collect the COMPLETE lines of the chunk with their stamps.
    const lines = [];
    let scanned = 0;
    let reason;
    while (scanned < chunk.length) {
      const nl = chunk.indexOf(10, scanned);
      if (nl === -1) { reason = "torn-tail"; break; }
      const bytes = chunk.subarray(scanned, nl);
      // Decoding replacement characters would change both the verbatim line
      // and its byte offset, possibly treating a later fragment as a record.
      if (!isUtf8(bytes)) { reason = "invalid-utf8"; break; }
      let text;
      try { text = bytes.toString("utf8"); }
      catch (err) {
        if (err.code !== "ERR_STRING_TOO_LONG") throw err;
        reason = "oversized-line";
        break;
      }
      const lineBytes = nl - scanned + 1;
      let ts = "";
      if (text.trim() !== "") {
        try {
          const d = JSON.parse(text);
          if (typeof d?.timestamp === "string") ts = d.timestamp;
        } catch {
          /* unparseable native line: captured verbatim below */
        }
      }
      lines.push({ text, ts, bytes: lineBytes });
      scanned += lineBytes;
    }
    if (reason) {
      incomplete++;
      issues.push({ source: fmt.source, path, reason, offset: state.bytes + scanned });
    }
    // Phase 2: every turn needs a stamp. Leading lines before the file's
    // first stamp carry it backward (deterministic: the file's first
    // stamp is invariant however capture is scheduled); if the file has
    // shown no stamp at all yet, hold everything for a later pass.
    let lastTs = state.lastTs ?? "";
    if (!lastTs) {
      const first = lines.find((l) => l.ts);
      if (!first) {
        if (lines.length > 0) {
          held++;
          issues.push({ source: fmt.source, path, reason: "unstamped", offset: state.bytes });
        }
        verifySource();
        continue; // do not advance; retry when a stamp exists
      }
      lastTs = first.ts;
    }
    verifySource(); // parsing/recovery may take time; still no journal write yet
    // Turns flush to the journal in bounded batches, so memory stays flat
    // however large the backlog (a first capture of a huge transcript is
    // one file's worth of NEW lines). A crash between flushes cannot
    // duplicate: this file's offset is saved only after its final flush,
    // and a lost offset rebuilds from the journal's own last line number.
    let fresh = [];
    let freshBytes = 0;
    const flush = () => {
      if (fresh.length === 0) return;
      verifySource(); // EVERY batch; earlier committed batches are never rolled back
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
    verifySource();
    } finally { closeSync(fd); }
  }
  saveOffsets(store, offsets);
  return {
    sessions,
    appended,
    unchanged,
    held,
    ignored,
    incomplete,
    complete: held === 0 && incomplete === 0,
    issues,
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
