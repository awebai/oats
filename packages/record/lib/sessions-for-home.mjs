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

import { SESSION_FORMATS } from "./formats.mjs";

// Claude Code's first lines can be large (file-history snapshots); the
// working directory is on every line, so a generous head finds one.
const HEAD_BYTES = 64 * 1024;

function readHead(path) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** The working directory a session file records, from its first lines, or
 *  undefined when the head carries none (unknown format, torn file). */
export function sessionCwd(source, path) {
  let head;
  try {
    head = readHead(path);
  } catch {
    return undefined;
  }
  for (const line of head.split("\n")) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue; // the head's torn last line, or a non-JSON native line
    }
    if (source === "cc" && typeof d.cwd === "string") return d.cwd;
    if (source === "pi" && d.type === "session" && typeof d.cwd === "string") return d.cwd;
    if (source === "codex" && d.type === "session_meta" && typeof d.payload?.cwd === "string") {
      return d.payload.cwd;
    }
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
 *  Each entry: { source, sessionId, thread, path, cwd, bytes, mtime }. */
export function sessionsForHome(home, { roots } = {}) {
  const target = canonical(home);
  const out = [];
  for (const fmt of Object.values(SESSION_FORMATS)) {
    const rs = roots?.[fmt.source] ?? fmt.defaultRoots();
    for (const path of fmt.listFiles(rs)) {
      const cwd = sessionCwd(fmt.source, path);
      if (!cwd || !within(canonical(cwd), target)) continue;
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
