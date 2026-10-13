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
// losing it requires comparison against the journal's positional prefix
// before resuming, never blind re-appending). Reconciliation is the capture: hooks and watchers
// only decide when to run it.
//
// Files matching the record's ignore list (`<root>/ignore`, see
// ignore.mjs) are skipped before being opened: no turn, no offset entry —
// un-ignoring a file later makes the next pass capture it normally.

import { isUtf8 } from "node:buffer";
import { closeSync, constants, fstatSync, openSync } from "node:fs";
import { basename } from "node:path";

import { finishTurn } from "./canonical.mjs";
import { jsonlLines, SESSION_FORMATS } from "./formats.mjs";
import { loadIgnore } from "./ignore.mjs";
import { assertIdentity, assertProtectedDescriptor, digest, identity, sourceChunks, stageSnapshot, verifySnapshot } from "./session-snapshot.mjs";
import { guardCapturedPath } from "./native-history.mjs";
import { bufferLines } from "./file-lines.mjs";
import { DerivedState, fileVersion, sameVersion, statVersion } from "./derived-state.mjs";
import { compareTranscriptPrefix } from "./transcript-prefix.mjs";
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

// Source bytes of turns held before they are appended: what a pass keeps of a
// transcript at once, whatever its size.
const FLUSH_BYTES = 8 * 1024 * 1024;

// The COMPLETE lines of `chunks`, one at a time, with their stamps:
// { text, ts, bytes }. `walk` records where the walk ended (`scanned`, bytes)
// and why it stopped early (`reason`): a torn tail, invalid UTF-8 (decoding
// replacement characters would change both the verbatim line and its byte
// offset, possibly treating a later fragment as a record) or a line beyond
// V8's string limit.
function* completeLines(chunks, walk) {
  let scanned = 0;
  walk.scanned = 0;
  for (const line of bufferLines(chunks)) {
    if (line[line.length - 1] !== 10) { walk.reason = "torn-tail"; return; }
    const bytes = line.subarray(0, -1);
    if (!isUtf8(bytes)) { walk.reason = "invalid-utf8"; return; }
    let text;
    try { text = bytes.toString("utf8"); }
    catch (err) {
      if (err.code !== "ERR_STRING_TOO_LONG") throw err;
      walk.reason = "oversized-line";
      return;
    }
    const lineBytes = line.length;
    let ts = "";
    if (text.trim() !== "") {
      try {
        const d = JSON.parse(text);
        if (typeof d?.timestamp === "string") ts = d.timestamp;
      } catch {
        /* unparseable native line: captured verbatim */
      }
    }
    scanned += lineBytes;
    walk.scanned = scanned;
    yield { text, ts, bytes: lineBytes };
  }
}

// One reconciliation pass for one format: one turn per NEW complete line
// of every session file under `roots`. Unstamped leading lines are held
// until the file shows its first timestamp (then they carry it backward),
// so every turn is stamped and ts stays a pure function of the source.
// `files` accepts discovery entries (including their attribution snapshot) or
// explicit paths for callers not making home-attribution claims. It pins a set,
// rather than rescanning directories
// and silently losing disappeared sources (or sweeping in other homes).
// `final` also verifies unchanged offsets against journals and checks source
// stability through the pass. The caller must quiesce writers for retirement;
// a performed pass is a snapshot, not a promise about future writes.
//
// A file given as `{ path, pinned }` is PINNED (stageSnapshot or legacy { bytes, stat }): its caller opened it once and read these bytes from
// that descriptor (`capture --file`). It is captured from them as a final pass, never opened again, so the
// turns are exactly those bytes; `path` keys its offsets as for any other file.
export function captureSessions(store, { owner, roots, files, format = "cc", ignore = null, final = false, collectIssues = true }) {
  const fmt = SESSION_FORMATS[format];
  if (!fmt) throw new Error(`unknown session format ${format}`);
  const ign = ignore ?? loadIgnore(store.root);
  const offsets = new DerivedState(store.root);
  try {
  offsets.db.exec("CREATE TEMP TABLE captured_streams (stream TEXT PRIMARY KEY)");
  const markStream = offsets.db.prepare("INSERT OR IGNORE INTO captured_streams VALUES (?)");
  let sessions = 0;
  let appended = 0;
  let unchanged = 0;
  let held = 0;
  let ignored = 0;
  let incomplete = 0;
  const issues = []; // source metadata only, never native record contents
  let streams = 0;
  const issue = (value) => { if (collectIssues) issues.push(value); };

  // Reconcile exclusions even when a blocked input has disappeared from discovery.
  for (const { key, value } of offsets.entries("set-aside")) {
    if (value.owner === owner && value.source === fmt.source && ign.ignores(value.path, [basename(value.path), fmt.sessionId(value.path), ...(fmt.ignoreKeys?.(value.path) ?? [])])) offsets.delete("set-aside", key);
  }
  for (const file of files ?? (fmt.iterateFiles ?? fmt.listFiles)(roots)) {
    const path = typeof file === "string" ? file : file.path;
    const pinned = typeof file === "string" ? null : file.pinned ?? null;
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
    const streamId = `${owner}~${fmt.source}.${sessionId}`;
    const offKey = `${streamId}:${path}`;
    const blocked = offsets.get("set-aside", offKey);
    if (blocked && !blocked.retry) {
      incomplete++;
      issue({ source: fmt.source, path, reason: blocked.reason, offset: blocked.offset, line: blocked.line });
      continue;
    }
    const fd = pinned ? null : openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | (capturedPi ? constants.O_NOFOLLOW : 0));
    let staged;
    try {
    if (capturedPi) assertProtectedDescriptor(fd, path, capturedPi);
    const stat = pinned ? pinned.stat : fstatSync(fd);
    const version = statVersion(pinned ? pinned.stat : fstatSync(fd, { bigint: true }));
    const snapshot = { ...identity(stat), ...(capturedPi ? { capturedPi } : {}) };
    if (expected) assertIdentity(stat, expected, path); // BEFORE reading bytes
    // Final home capture stages a descriptor-pinned snapshot. All attribution
    // and stability checks precede the first append, never a post-write alarm.
    staged = !pinned && (final || expected || capturedPi) ? stageSnapshot(fd, stat, path, capturedPi) : null;
    let source = pinned ?? staged;
    const chunks = (start = 0, end = stat.size) => source
      ? source.bytes ? [source.bytes.subarray(start, end)] : source.chunks(start, end)
      : sourceChunks(fd, start, end, path, capturedPi);
    const witness = (end) => {
      // At most 4 KiB; identity and this boundary are witnesses, not proof of
      // the unobserved prefix. See the append-only input contract.
      const bytes = Buffer.concat([...chunks(Math.max(0, end - 4096), end)]);
      return digest(bytes);
    };
    if (expected && (source.bytes ? digest(source.bytes.subarray(0, expected.size)) : source.prefixHash(expected.size)) !== expected.hash) {
      throw new Error(`session source content changed since attribution: ${path}`);
    }
    if (source) snapshot.hash = source.bytes ? digest(source.bytes) : source.hash;
    const verifySource = () => {
      if (pinned) return; // the bytes are the source: nothing is read from the path again
      guardCapturedPath(path, capturedPi);
      if (source) verifySnapshot(fd, path, snapshot);
    };
    verifySource();
    let state = offsets.get(fmt.source, offKey);
    const generation = offsets.get("reset", `${owner}:${fmt.source}`) ?? "";
    const journalVersion = fileVersion(store.journalPath(streamId));
    if (state && (!Number.isSafeInteger(state.bytes) || state.bytes < 0 || state.bytes > stat.size ||
        !Number.isSafeInteger(state.line) || state.line < 0 || typeof state.lastTs !== "string")) state = null;
    const prior = state?.version;
    const sameInput = prior && sameVersion(prior, version);
    const appendGrowth = prior && prior.dev === version.dev && prior.ino === version.ino && version.size > prior.size &&
      state.bytes <= version.size && witness(state.bytes) === state.witness;
    const recover = !state || state.generation !== generation || !sameVersion(state.journalVersion, journalVersion) ||
      (!sameInput && !appendGrowth) || blocked;
    if (recover) {
      // A complete comparison precedes ANY append from this input. Pin the
      // bytes on disk so a later batch cannot reopen a mutable source.
      if (!source && journalVersion?.size) {
        staged = stageSnapshot(fd, stat, path, capturedPi);
        source = staged; snapshot.hash = staged.hash;
      }
      state = compareTranscriptPrefix(store, streamId, offsets, completeLines(chunks(), {}));
      verifySource();
      if (state.conflict) {
        const row = { owner, source: fmt.source, path, ...state.conflict, retry: false };
        offsets.set("set-aside", offKey, row);
        incomplete++;
        issue({ source: fmt.source, path, ...state.conflict });
        continue;
      }
      offsets.delete("set-aside", offKey);
    }
    const checkpoint = (value) => offsets.set(fmt.source, offKey, {
      ...value, version, witness: witness(value.bytes), generation,
      journalVersion: fileVersion(store.journalPath(streamId)),
    });
    if (stat.size <= state.bytes) {
      unchanged++;
      checkpoint(state);
      verifySource();
      continue;
    }

    // Every turn needs a stamp. Leading lines before the file's first stamp
    // carry it backward (deterministic: the file's first stamp is invariant
    // however capture is scheduled); if the file has shown no stamp at all
    // yet, hold everything for a later pass. The lines are walked, never
    // collected: a first capture of a huge transcript is one file's worth of
    // NEW lines, far more than the heap (awebai/oats#456).
    const stopped = (walk) => {
      if (!walk.reason) return;
      incomplete++;
      issue({ source: fmt.source, path, reason: walk.reason, offset: state.bytes + walk.scanned });
    };
    let lastTs = state.lastTs ?? "";
    if (!lastTs) {
      const scan = {};
      let any = false;
      for (const l of completeLines(chunks(state.bytes), scan)) {
        any = true;
        if (l.ts) { lastTs = l.ts; break; }
      }
      if (!lastTs) {
        stopped(scan);
        if (any) {
          held++;
          issue({ source: fmt.source, path, reason: "unstamped", offset: state.bytes });
        }
        verifySource();
        continue; // do not advance; retry when a stamp exists
      }
    }
    verifySource(); // parsing/recovery may take time; still no journal write yet
    // Turns flush to the journal in bounded batches, so memory stays flat
    // however large the backlog. A crash between flushes cannot
    // duplicate: checkpoints follow each append and the durable ID lookup
    // reconciles a crash between journal fsync and the source checkpoint.
    let fresh = [];
    let freshBytes = 0;
    const flush = () => {
      if (fresh.length === 0) return;
      verifySource(); // EVERY batch; earlier committed batches are never rolled back
      const added = store.appendUniqueBatch(streamId, fresh);
      if (added) streams += Number(markStream.run(streamId).changes);
      appended += added;
      checkpoint({ bytes: state.bytes + consumed, line: lineNo, lastTs });
      fresh = [];
      freshBytes = 0;
    };
    let lineNo = state.line;
    let consumed = 0;
    const walk = {};
    for (const l of completeLines(chunks(state.bytes), walk)) {
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
      if (fresh.length >= 2000 || freshBytes >= FLUSH_BYTES) flush();
    }
    stopped(walk);
    flush();
    checkpoint({ bytes: state.bytes + consumed, line: lineNo, lastTs });
    verifySource();
    } finally { try { staged?.close(); } finally { if (fd !== null) closeSync(fd); } }
  }
  return {
    sessions,
    appended,
    unchanged,
    held,
    ignored,
    incomplete,
    complete: held === 0 && incomplete === 0,
    issues,
    streams,
    stream: `${owner}~${fmt.source}.*`,
  };
  } finally { offsets.close(); }
}

// One pass over every known format at its default roots. The ignore list
// is loaded once and shared across formats.
export function captureAllSessions(store, { owner, ignore = null, collectIssues = true }) {
  const ign = ignore ?? loadIgnore(store.root);
  const results = [];
  for (const format of Object.keys(SESSION_FORMATS)) {
    const roots = SESSION_FORMATS[format].defaultRoots();
    if (roots.length === 0) {
      // Missing defaults must not keep an ignored, previously blocked path
      // active merely because it no longer appears in filesystem discovery.
      captureSessions(store, { owner, roots, format, ignore: ign, collectIssues: false });
      continue;
    }
    results.push(captureSessions(store, { owner, roots, format, ignore: ign, collectIssues }));
  }
  return results;
}
