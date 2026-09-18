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

import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { isUtf8 } from "node:buffer";

import { SESSION_FORMATS } from "./formats.mjs";
import { hashPrefix, identity, sameVersion, verifySnapshot } from "./session-snapshot.mjs";
import { sourceSessionEnvironment } from "./session-roots.mjs";
import { guardCapturedPath, historicalSessionRoots } from "./native-history.mjs";

// A session's first lines can be large (Claude Code queue operations and
// file-history snapshots run to 100 KB and more) and the first cwd-bearing
// line can sit past 100 KB of bookkeeping lines, so the scan is incremental:
// whole lines only, chunk by chunk, until the first cwd or the byte bound.
// A file whose bound is exhausted without a cwd is reported as unattributable
// through the optional `onUnattributed` hook, never silently dropped.
const CHUNK_BYTES = 64 * 1024;
export const CWD_SCAN_BOUND_BYTES = 8 * 1024 * 1024;

function* wholeLines(fd, bound, path, capturedPi) {
  const buf = Buffer.alloc(CHUNK_BYTES);
  let pieces = [], size = 0; // keep raw bytes across UTF-8/chunk boundaries
  let offset = 0;
  while (offset < bound) {
    if (capturedPi) guardCapturedPath(path, capturedPi);
    const n = readSync(fd, buf, 0, Math.min(CHUNK_BYTES, bound - offset), offset);
    if (n === 0) break;
    offset += n;
    let from = 0;
    for (let nl = buf.indexOf(10, from); nl >= 0 && nl < n; nl = buf.indexOf(10, from)) {
      const tail = buf.subarray(from, nl);
      const bytes = pieces.length ? Buffer.concat([...pieces, tail], size + tail.length) : tail;
      // Replacement decoding could fabricate a cwd. Leave corrupt lines
      // unattributed; capture will report incomplete bytes if a later
      // valid line supplies the attribution.
      yield isUtf8(bytes) ? bytes.toString("utf8") : null;
      pieces = []; size = 0; from = nl + 1;
    }
    if (from < n) {
      const piece = Buffer.from(buf.subarray(from, n)); // buf is reused
      pieces.push(piece); size += piece.length;
    }
  }
  // A JSON-shaped EOF fragment is still an uncommitted native record.
  // Never attribute a source using a line its writer has not terminated.
}

function cwdOfLine(source, line) {
  if (line === null || !line.trim()) return undefined;
  let d;
  try {
    d = JSON.parse(line);
  } catch {
    return undefined; // a non-JSON native line
  }
  if (source === "cc" && typeof d?.cwd === "string") return d.cwd;
  if (source === "pi" && d?.type === "session" && typeof d?.cwd === "string") return d.cwd;
  if (source === "codex" && d?.type === "session_meta" && typeof d.payload?.cwd === "string") return d.payload.cwd;
  return undefined;
}

/** Descriptor-derived attribution and (for accepted cwd) content witness.
 *  No cwd within `bound` means unknown format, torn input or no attribution. */
export function sessionAttribution(source, path, { bound = CWD_SCAN_BOUND_BYTES, acceptCwd = () => true, capturedPi } = {}) {
  if (capturedPi && source !== "pi") throw new Error("protected Pi proof cannot qualify another format");
  guardCapturedPath(path, capturedPi);
  const fd = openSync(path, capturedPi ? constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK : "r");
  try {
    const snapshot = { ...identity(fstatSync(fd)), ...(capturedPi ? { capturedPi } : {}) };
    let cwd;
    for (const line of wholeLines(fd, Math.min(bound, snapshot.size), path, capturedPi)) {
      cwd = cwdOfLine(source, line);
      if (cwd) break;
    }
    // Never hash/read the body of an unrelated or unattributable session.
    if (cwd && acceptCwd(cwd)) snapshot.hash = hashPrefix(fd, snapshot.size, path, capturedPi);
    // Never combine attribution read from an old prefix with a new witness.
    // Discovery requires a stable read; append growth between discovery and
    // capture is supported by the witness's prefix hash.
    const after = identity(fstatSync(fd));
    if (!sameVersion(after, snapshot)) {
      throw new Error(`session source changed during attribution: ${path}`);
    }
    verifySnapshot(fd, path, snapshot);
    return { cwd, snapshot };
  } finally { closeSync(fd); }
}

/** Scan complete lines for the first native cwd; never attribute EOF fragments. */
export function sessionCwd(source, path, options) {
  return sessionAttribution(source, path, { ...options, acceptCwd: () => false }).cwd;
}

function canonical(p) {
  try {
    return realpathSync(p);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return resolve(p); // a retired home's cwd no longer exists; compare the lexical path
  }
}

function within(child, parent) {
  return child === parent || child.startsWith(parent + sep);
}

/** Session files whose recorded cwd is `home` or below it, oldest first.
 *  By default uses independent managed-launch history, never observer env.
 *  `roots` is an explicit inventory ({ cc, pi, codex }; omitted formats are
 *  excluded). `fallback: "current-env"` explicitly chooses observer-time
 *  recipe/env discovery for standalone or legacy sources. All supplied or
 *  historical roots must be readable; missing roots are not optional.
 *  `onUnattributed(source, path)` is called for a file that carries no cwd
 *  within the scan bound, so a caller can report it instead of losing it.
 *  Read/scan failures throw; they are not unattributed or empty scans.
 *  `ignore` excludes files BEFORE reading, with optional `onIgnored`.
 *  Each entry includes a descriptor-derived `snapshot` witness; pass the
 *  entries intact as captureSessions({ files }) to retain attribution. */
export function sessionsForHome(home, { roots, onUnattributed, bound, ignore, onIgnored, env = process.env, fallback } = {}) {
  const target = canonical(home);
  const out = [];
  // Explicit roots are a caller-owned inventory; unspecified formats are
  // excluded, not filled from an unrelated observer. The opt-in fallback is
  // for standalone/legacy inventories, never proof of historical completeness.
  let context;
  if (!roots && fallback !== "current-env") roots = historicalSessionRoots(home, { withProof: true });
  if (!roots) context = sourceSessionEnvironment(home, env);
  for (const fmt of Object.values(SESSION_FORMATS)) {
    const rs = roots ? (roots[fmt.source] ?? []) : fmt.defaultRoots(context.home, context.env, { cwd: home });
    for (const entry of fmt.listFiles(rs, { strict: true })) {
      const path = typeof entry === "string" ? entry : entry.path;
      const capturedPi = typeof entry === "string" ? undefined : entry.capturedPi;
      const sessionId = fmt.sessionId(path);
      if (ignore?.ignores(path, [basename(path), sessionId, ...(fmt.ignoreKeys?.(path) ?? [])])) {
        onIgnored?.(fmt.source, path);
        continue;
      }
      const { cwd, snapshot } = sessionAttribution(fmt.source, path, { bound, capturedPi, acceptCwd: cwd => within(canonical(cwd), target) });
      if (!cwd) { if (onUnattributed) onUnattributed(fmt.source, path); continue; }
      if (!within(canonical(cwd), target)) continue;
      out.push({
        source: fmt.source,
        sessionId,
        thread: `${fmt.source}:session:${sessionId}`,
        path,
        cwd,
        bytes: snapshot.size,
        mtime: new Date(snapshot.mtimeMs).toISOString(),
        snapshot,
        ...(capturedPi ? { capturedPi } : {}),
      });
    }
  }
  out.sort((a, b) => a.mtime.localeCompare(b.mtime) || a.path.localeCompare(b.path));
  const protectedRoots = (roots?.pi ?? []).filter(r => typeof r === "object" && r?.capturedPi);
  if (protectedRoots.length) {
    // Existing CLI iterates this same inventory again after its capture lock,
    // including when it is empty. Retain root proof without synthetic sessions
    // or a bin/parser change, and revalidate before certifying its boundaries.
    const check = () => { for (const r of protectedRoots) guardCapturedPath(r.path, r.capturedPi); };
    check();
    Object.defineProperty(out, Symbol.iterator, { value: function* () { check(); yield* Array.prototype[Symbol.iterator].call(this); check(); } });
  }
  return out;
}
