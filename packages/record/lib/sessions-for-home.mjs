// sessionsForHome — the session transcripts one OATS instance home produced.
//
// Nothing in a captured session turn names the instance that ran it: turns
// carry owner, thread, kind and text. What every harness DOES record is the
// working directory the session started in — Claude Code on each line, pi in
// its session header, Codex in session_meta — and an OATS instance runs with
// its home as that directory. So "the instance's own sessions" is exactly
// "the session files whose recorded cwd is the home or a directory below it".
//
// The match is on canonical paths and is exact-or-descendant, never looser:
// a home is disposable and unique, so anything that ran inside it is the
// instance's own, and nothing outside it — not the parent workspace, not a
// sibling home — is ever swept in.

import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";

import { SESSION_FORMATS } from "./formats.mjs";

// A session's first lines can be large (Claude Code queue operations and
// file-history snapshots run to 100 KB and more) and the first cwd-bearing
// line can sit past 100 KB of bookkeeping lines, so the scan is incremental:
// whole lines only, chunk by chunk, until the first cwd or the byte bound.
// A file whose bound is exhausted without a cwd is reported as unattributable
// through the optional `onUnattributed` hook, never silently dropped.
const CHUNK_BYTES = 64 * 1024;
export const CWD_SCAN_BOUND_BYTES = 8 * 1024 * 1024;

function* wholeLines(path, bound) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(CHUNK_BYTES);
    const decoder = new StringDecoder("utf8"); // a multi-byte character may straddle two chunks
    let carry = "";
    let offset = 0;
    while (offset < bound) {
      const n = readSync(fd, buf, 0, Math.min(CHUNK_BYTES, bound - offset), offset);
      if (n === 0) break;
      offset += n;
      carry += decoder.write(buf.subarray(0, n));
      let nl;
      while ((nl = carry.indexOf("\n")) >= 0) {
        yield carry.slice(0, nl);
        carry = carry.slice(nl + 1);
      }
    }
    // The remainder is a fragment unless the file ended exactly there.
    if (carry && offset < bound) yield carry;
  } finally {
    closeSync(fd);
  }
}

function cwdOfLine(source, line) {
  if (!line.trim()) return undefined;
  let d;
  try {
    d = JSON.parse(line);
  } catch {
    return undefined; // a non-JSON native line
  }
  if (source === "cc" && typeof d.cwd === "string") return d.cwd;
  if (source === "pi" && d.type === "session" && typeof d.cwd === "string") return d.cwd;
  if (source === "codex" && d.type === "session_meta" && typeof d.payload?.cwd === "string") return d.payload.cwd;
  return undefined;
}

/** The working directory a session file records, scanning whole lines from
 *  the start until the first one that carries it, or undefined when none
 *  does within `bound` bytes (unknown format, torn file, no cwd at all). */
export function sessionCwd(source, path, { bound = CWD_SCAN_BOUND_BYTES } = {}) {
  try {
    for (const line of wholeLines(path, bound)) {
      const cwd = cwdOfLine(source, line);
      if (cwd) return cwd;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function canonical(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p); // a retired home's cwd no longer exists; compare the lexical path
  }
}

function within(child, parent) {
  return child === parent || child.startsWith(parent + sep);
}

/** Session files whose recorded cwd is `home` or below it, oldest first.
 *  `roots` may override the per-format search roots ({ cc, pi, codex }),
 *  otherwise each format's default roots under the current HOME are used.
 *  `onUnattributed(source, path)` is called for a file that carries no cwd
 *  within the scan bound, so a caller can report it instead of losing it.
 *  Each entry: { source, sessionId, thread, path, cwd, bytes, mtime }. */
export function sessionsForHome(home, { roots, onUnattributed, bound } = {}) {
  const target = canonical(home);
  const out = [];
  for (const fmt of Object.values(SESSION_FORMATS)) {
    const rs = roots?.[fmt.source] ?? fmt.defaultRoots();
    for (const path of fmt.listFiles(rs)) {
      const cwd = sessionCwd(fmt.source, path, bound ? { bound } : {});
      if (!cwd) { if (onUnattributed) onUnattributed(fmt.source, path); continue; }
      if (!within(canonical(cwd), target)) continue;
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue; // vanished between listing and stat
      }
      const sessionId = fmt.sessionId(path);
      out.push({
        source: fmt.source,
        sessionId,
        thread: `${fmt.source}:session:${sessionId}`,
        path,
        cwd,
        bytes: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }
  }
  return out.sort((a, b) => a.mtime.localeCompare(b.mtime) || a.path.localeCompare(b.path));
}
