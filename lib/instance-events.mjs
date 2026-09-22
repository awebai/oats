/** K7 — typed lifecycle events per instance, append-only, producer-attributed.
 *
 * Every event is a fact a kernel action just made true (spawned, launched,
 * stopped, restarted, retired…), written by the code that did it, with the
 * receipt it produced. Nothing here is inferred from transcripts, task files or
 * prose; "waiting on you" is reported only when a producer says so — today no
 * producer does, and the view says `null`, not a guess. Retirement's event
 * outlives the home in the workspace-level log.
 *
 * eventsApi 2 (`instance-events-2`) — the read is BOUNDED and ADDRESSED:
 *  - a source is `lstat`ed first and opened only if it is a regular file; the
 *    reader reads at most the last MAX_BYTES by descriptor, never the whole file;
 *  - rows are the ADDRESS's history: a row whose instance/home is not the
 *    admitted address is dropped and counted (`integrity.foreignRows`), a torn
 *    line is counted (`integrity.unreadableRows`) — never sorted or windowed away;
 *  - every row is tagged with the `incarnation` (the home's instance.json
 *    `createdAt`) that wrote it; the result echoes the current one, so a
 *    recreated same-address instance's earlier rows are visible as earlier;
 *  - `waitingOnYou` is a producer STATE per (producer, current incarnation):
 *    that producer's latest row carrying the field decides, an explicit `false`
 *    clears, and it is computed over the full admitted read, before windowing. */
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const EVENTS_API = 2;
const HOME_LOG = ".oats-events.jsonl";
const MAX_BYTES = 4 * 1024 * 1024;

export const EVENT_KINDS = ["spawned", "launched", "restarted", "stopped", "stop-refused", "retire-planned", "retired", "worktree-retained", "worktree-removed", "branch-deleted", "child-spawn-refused", "recomposed"];

function workspaceLogPath(home) {
  // <workspace>/.agents/events/<agent>--<instance>.jsonl — deployment-private
  // state beside installed capabilities and schedules; survives the home's removal.
  const agentDir = dirname(dirname(home)); // <root>/<agent>/instances/<instance>
  const workspace = dirname(dirname(agentDir)); // <workspace>/agents/<agent>
  return join(workspace, ".agents", "events", `${basename(agentDir)}--${basename(home)}.jsonl`);
}

/** The incarnation of the home at `home`: its instance.json `createdAt`, or null. */
export function incarnationOf(home) {
  try { const m = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")); return typeof m?.createdAt === "string" ? m.createdAt : null; } catch { return null; }
}

/** Append one typed event. Never throws into the caller's action: an event is
 *  evidence, not authority — a failed write is reported in the return value. */
export function appendEvent(home, event, { workspaceOnly = false, incarnation } = {}) {
  if (!EVENT_KINDS.includes(event.kind)) return { ok: false, reason: `unknown event kind ${event.kind}` };
  const row = { eventsApi: EVENTS_API, at: new Date().toISOString(), instance: basename(home), home, incarnation: incarnation === undefined ? incarnationOf(home) : incarnation, producer: event.producer || "kernel", kind: event.kind, ...(event.data !== undefined ? { data: event.data } : {}) };
  const line = JSON.stringify(row) + "\n";
  const results = [];
  // Retirement fingerprints the home against its baseline and preserves any
  // changed bytes as "unknown work": events written DURING retirement go only
  // to the workspace log, never into the home being inspected.
  for (const path of [...(workspaceOnly ? [] : [join(home, HOME_LOG)]), workspaceLogPath(home)]) {
    try {
      if (path.startsWith(home) && !existsSync(home)) { results.push({ path, ok: false, reason: "home absent" }); continue; }
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, line);
      results.push({ path, ok: true });
    } catch (e) { results.push({ path, ok: false, reason: e.message }); }
  }
  return { ok: results.some((r) => r.ok), row, results };
}

/** Bounded, descriptor-safe read of one log: lstat → regular file only → read
 *  at most the last MAX_BYTES. Returns rows plus the source's integrity facts. */
function readLog(path, label) {
  let st;
  try { st = lstatSync(path); } catch (e) { return e.code === "ENOENT" ? { rows: [], unreadable: 0, source: { path: label, status: "absent", bytes: 0 } } : { rows: [], unreadable: 0, source: { path: label, status: "refused", bytes: 0 } }; }
  if (!st.isFile()) return { rows: [], unreadable: 0, source: { path: label, status: "refused", bytes: 0 } }; // symlink, FIFO, device, directory: never opened
  const tail = st.size > MAX_BYTES;
  const length = tail ? MAX_BYTES : st.size;
  const buf = Buffer.alloc(length);
  let fd;
  try {
    fd = openSync(path, "r");
    let got = 0; while (got < length) { const n = readSync(fd, buf, got, length - got, (tail ? st.size - MAX_BYTES : 0) + got); if (n <= 0) break; got += n; }
  } catch { return { rows: [], unreadable: 0, source: { path: label, status: "refused", bytes: st.size } }; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch { /* nothing to recover */ } }
  const text = buf.toString("utf8");
  const lines = text.split("\n");
  if (tail) lines.shift(); // the first line of a tail is (almost surely) partial; it is not counted as torn — the tail itself is reported
  const rows = []; let unreadable = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r && typeof r === "object" && Number.isInteger(r.eventsApi) && r.eventsApi >= 1 && typeof r.kind === "string" && typeof r.at === "string") rows.push(r); else unreadable++; } catch { unreadable++; }
  }
  return { rows, unreadable, source: { path: label, status: tail ? "tail" : "ok", bytes: st.size } };
}

/** Events for one instance ADDRESS, newest last, from both logs, with a bounded
 *  window; integrity is reported independently of the selected rows. */
export function readEvents(home, { limit = 200, since = null } = {}) {
  const instance = basename(home);
  const incarnation = incarnationOf(home);
  const a = readLog(join(home, HOME_LOG), "home"), b = readLog(workspaceLogPath(home), "workspace");
  const seen = new Set(); const rows = []; let foreign = 0;
  for (const r of [...a.rows, ...b.rows]) {
    if (r.instance !== instance || r.home !== home) { foreign++; continue; } // another address's row in this log: history of THIS address only
    const k = `${r.producer ?? "kernel"}|${r.at}|${r.kind}|${r.incarnation ?? ""}|${JSON.stringify(r.data ?? null)}`; // same facts from two producers are two rows
    if (seen.has(k)) continue; seen.add(k); rows.push({ ...r, incarnation: r.incarnation ?? null });
  }
  rows.sort((x, y) => x.at.localeCompare(y.at));
  // Waiting: a producer STATE for the CURRENT incarnation, decided by that
  // producer's latest row that carries the field, over the FULL admitted read.
  const claims = new Map();
  for (const r of rows) {
    if (incarnation !== null && r.incarnation !== incarnation) continue;
    if (!r.data || typeof r.data.waitingOnYou !== "boolean") continue;
    const p = r.producer ?? "kernel";
    claims.set(p, r.data.waitingOnYou ? { producer: p, waiting: true, since: r.at, reason: typeof r.data.reason === "string" ? r.data.reason : null } : { producer: p, waiting: false, since: r.at, reason: null });
  }
  const waitingClaims = [...claims.values()];
  const positive = waitingClaims.filter((c) => c.waiting).sort((x, y) => x.since.localeCompare(y.since)).at(-1) ?? null;
  const filtered = since ? rows.filter((r) => r.at > since) : rows;
  const window = filtered.slice(-limit);
  const last = window.at(-1) ?? null;
  return {
    eventsApi: EVENTS_API, instance, home, incarnation, count: filtered.length, returned: window.length,
    truncated: filtered.length > window.length || a.source.status === "tail" || b.source.status === "tail",
    integrity: { unreadableRows: a.unreadable + b.unreadable, foreignRows: foreign, sources: [a.source, b.source] },
    events: window, lastEvent: last ? { kind: last.kind, at: last.at, producer: last.producer ?? "kernel", incarnation: last.incarnation } : null,
    waitingOnYou: positive ? { since: positive.since, producer: positive.producer, reason: positive.reason } : null,
    waitingClaims,
    notes: [
      "events are producer-attributed facts written by the kernel action that made them true; nothing is inferred from transcripts or task files",
      "this is the ADDRESS's history: rows tagged with an earlier incarnation belong to a previous instance at this address",
      "waitingOnYou is null unless a producer reported it for the current incarnation — null means unknown, not 'not waiting'; an explicit false clears that producer's claim",
      "integrity counts torn and foreign rows and names each source's status; truncated is true when the window cut rows or a source was read as a tail",
    ],
  };
}
