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
 *    clears, and it is computed over the full admitted read, before windowing;
 *  - a claim is LIVE only after the incarnation's latest kernel session
 *    boundary (`launched` | `restarted` | `stopped`): a claim written before
 *    the boundary belongs to a session that has ended (WAITING_BOUNDARY_KINDS).
 *
 * Producers write claims as `waiting` rows through `setWaiting` (the CLI's
 * `oats instance waiting` and `oats instance attention`): data
 * `{waitingOnYou, reason?, message?}`, appended only on a change. A claim is
 * evidence for display, never authority: nothing in the kernel acts on it. */
import { appendFileSync, closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const EVENTS_API = 2;
const HOME_LOG = ".oats-events.jsonl";
const MAX_BYTES = 4 * 1024 * 1024;

export const EVENT_KINDS = ["spawned", "launched", "restarted", "stopped", "stop-refused", "retire-planned", "retired", "worktree-retained", "worktree-removed", "branch-deleted", "child-spawn-refused", "launch-warning", "recomposed", "waiting"];

/** Kernel rows that end or begin a session: a waiting claim older than the
 *  incarnation's latest one is not live. */
export const WAITING_BOUNDARY_KINDS = ["launched", "restarted", "stopped"];
/** The closed set of reasons a positive claim carries. */
export const WAITING_REASONS = ["permission", "question", "attention"];
/** A producer id: what `--producer` accepts (`kernel` is reserved). */
export const WAITING_PRODUCER_RE = /^[a-z0-9][a-z0-9._/-]{0,63}$/;
export const WAITING_MESSAGE_MAX = 200;
/** A claim's message: a non-empty string of at most 200 characters on one
 *  line, with no control character (C0, DEL, C1) and no Unicode line or
 *  paragraph separator. The writer refuses anything else; the reader turns a
 *  stored message that fails it (a hand-edited log) into null. */
export function validWaitingMessage(m) {
  return typeof m === "string" && m.length > 0 && [...m].length <= WAITING_MESSAGE_MAX && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(m);
}
// A reason read back from a log is shown as given only when it passes the
// message rule (it is printed on a terminal line); anything else reads as
// null, and the claim still counts.
const readReason = (r) => (validWaitingMessage(r) ? r : null);

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
export function appendEvent(home, event, { workspaceOnly = false, incarnation, at } = {}) {
  if (!EVENT_KINDS.includes(event.kind)) return { ok: false, reason: `unknown event kind ${event.kind}` };
  // `at`: the time the fact became true, when it is recorded later (a start
  // boundary reconciled from its receipt); readers order rows by it.
  if (at !== undefined && (typeof at !== "string" || !Number.isFinite(Date.parse(at)))) return { ok: false, reason: `invalid event time ${at}` };
  const row = { eventsApi: EVENTS_API, at: at ?? new Date().toISOString(), instance: basename(home), home, incarnation: incarnation === undefined ? incarnationOf(home) : incarnation, producer: event.producer || "kernel", kind: event.kind, ...(event.data !== undefined ? { data: event.data } : {}) };
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
  let fd;
  try {
    // Close the lstat→open swap: open WITHOUT following a symlink and without
    // blocking on a FIFO, then verify by descriptor that what was opened is the
    // regular file lstat saw (same device+inode). Anything else is refused.
    fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
    const fst = fstatSync(fd);
    if (!fst.isFile() || fst.dev !== st.dev || fst.ino !== st.ino) throw new Error("swapped");
    st = fst; // the size of what is actually open
  } catch { if (fd !== undefined) try { closeSync(fd); } catch { /* nothing to recover */ } return { rows: [], unreadable: 0, source: { path: label, status: "refused", bytes: 0 } }; }
  const tail = st.size > MAX_BYTES;
  const length = tail ? MAX_BYTES : st.size;
  const buf = Buffer.alloc(length);
  try {
    let got = 0; while (got < length) { const n = readSync(fd, buf, got, length - got, (tail ? st.size - MAX_BYTES : 0) + got); if (n <= 0) break; got += n; }
  } catch { return { rows: [], unreadable: 0, source: { path: label, status: "refused", bytes: st.size } }; }
  finally { try { closeSync(fd); } catch { /* nothing to recover */ } }
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

/** The ADDRESS's rows from the given log reads: foreign rows dropped and
 *  counted, oldest first. The logs are merged as a multiset union: a row in
 *  both logs (the same fact, written to each) is kept once, but rows that
 *  genuinely repeat within one log (a set, a clear and the same set again in
 *  one millisecond) are all kept, as many times as the log holding the most
 *  copies has them. */
function admit(home, reads) {
  const instance = basename(home);
  const admitted = new Map(); const rows = []; let foreign = 0;
  for (const read of reads) {
    const inThisLog = new Map();
    for (const r of read.rows) {
      if (r.instance !== instance || r.home !== home) { foreign++; continue; } // another address's row in this log: history of THIS address only
      const k = `${r.producer ?? "kernel"}|${r.at}|${r.kind}|${r.incarnation ?? ""}|${JSON.stringify(r.data ?? null)}`; // same facts from two producers are two rows
      const n = (inThisLog.get(k) ?? 0) + 1; inThisLog.set(k, n);
      if (n <= (admitted.get(k) ?? 0)) continue; // this copy is already in from another log
      admitted.set(k, n); rows.push({ ...r, incarnation: r.incarnation ?? null });
    }
  }
  rows.sort((x, y) => x.at.localeCompare(y.at));
  return { rows, foreign };
}

/** Waiting: a producer STATE for the CURRENT incarnation, decided by that
 *  producer's latest row that carries the field, over the FULL admitted read.
 *  An UNKNOWN current incarnation (unreadable instance.json) admits NO claim:
 *  unknown stays unknown, it never resurrects an earlier incarnation's
 *  positive. A row older than the incarnation's latest kernel session
 *  boundary belongs to an ended session and is not a claim at all. */
function claimsOf(rows, incarnation) {
  const claims = new Map();
  if (incarnation === null) return claims;
  const current = rows.filter((r) => r.incarnation === incarnation);
  // Positional: rows are time-sorted with a stable sort, so rows of the same
  // millisecond keep their append order, and a claim appended before the
  // boundary in that millisecond is still before it.
  const boundary = current.findLastIndex((r) => (r.producer ?? "kernel") === "kernel" && WAITING_BOUNDARY_KINDS.includes(r.kind));
  for (const r of current.slice(boundary + 1)) {
    if (!r.data || typeof r.data.waitingOnYou !== "boolean") continue;
    const p = r.producer ?? "kernel";
    claims.set(p, r.data.waitingOnYou
      ? { producer: p, waiting: true, since: r.at, reason: readReason(r.data.reason), message: validWaitingMessage(r.data.message) ? r.data.message : null }
      : { producer: p, waiting: false, since: r.at, reason: null, message: null });
  }
  return claims;
}
const positiveOf = (claims) => [...claims.values()].filter((c) => c.waiting).sort((x, y) => x.since.localeCompare(y.since)).at(-1) ?? null;
const waitingShape = (c) => (c ? { since: c.since, producer: c.producer, reason: c.reason, message: c.message } : null);

/** Events for one instance ADDRESS, newest last, from both logs, with a bounded
 *  window; integrity is reported independently of the selected rows. */
export function readEvents(home, { limit = 200, since = null } = {}) {
  const instance = basename(home);
  const incarnation = incarnationOf(home);
  const a = readLog(join(home, HOME_LOG), "home"), b = readLog(workspaceLogPath(home), "workspace");
  const { rows, foreign } = admit(home, [a, b]);
  const claims = claimsOf(rows, incarnation);
  const waitingClaims = [...claims.values()];
  const positive = positiveOf(claims);
  const filtered = since ? rows.filter((r) => r.at > since) : rows;
  const window = filtered.slice(-limit);
  const last = window.at(-1) ?? null;
  return {
    eventsApi: EVENTS_API, instance, home, incarnation, count: filtered.length, returned: window.length,
    truncated: filtered.length > window.length || a.source.status === "tail" || b.source.status === "tail",
    integrity: { unreadableRows: a.unreadable + b.unreadable, foreignRows: foreign, sources: [a.source, b.source] },
    events: window, lastEvent: last ? { kind: last.kind, at: last.at, producer: last.producer ?? "kernel", incarnation: last.incarnation } : null,
    waitingOnYou: waitingShape(positive),
    waitingClaims,
    notes: [
      "events are producer-attributed facts written by the kernel action that made them true; nothing is inferred from transcripts or task files",
      "this is the ADDRESS's history: rows tagged with an earlier incarnation belong to a previous instance at this address",
      "waitingOnYou is null unless a producer reported it for the current incarnation — null means unknown, not 'not waiting'; an explicit false clears that producer's claim; an unknown current incarnation (null) admits no claim at all",
      "a claim older than the incarnation's latest kernel launched, restarted or stopped row belongs to an ended session and is not counted",
      "integrity counts torn and foreign rows and names each source's status; truncated is true when the window cut rows or a source was read as a tail",
    ],
  };
}

/** The instance's live waiting state, `{since, producer, reason, message}` or
 *  null: what `oats status` rows and `oats session inspect` carry. The same
 *  bounded read and the same claim rule as readEvents, over the home log only
 *  (the workspace log only when the home log is absent): every row a producer
 *  or a session boundary writes goes to both. */
export function liveWaiting(home) {
  const incarnation = incarnationOf(home);
  if (incarnation === null) return null;
  let log = readLog(join(home, HOME_LOG), "home");
  if (log.source.status === "absent") log = readLog(workspaceLogPath(home), "workspace");
  return waitingShape(positiveOf(claimsOf(admit(home, [log]).rows, incarnation)));
}

const waitingError = (code, message) => Object.assign(new Error(message), { code });

/** Set or clear one producer's waiting claim on an instance home; appends a
 *  `waiting` row only when the producer's LIVE claim changes (a positive set
 *  whose reason or message differs is a change; a clear of a claim that is
 *  not positive is not). Each log is judged on its own, so a row that reached
 *  only one log earlier is repaired by the next call rather than hidden by the
 *  other log; success means both logs took the row. Validates its input
 *  (E_BAD_ARGS); a home without a readable instance.json is
 *  E_SESSION_UNKNOWN; a write either log refused is E_EVENTS_FAILED (a retry
 *  repairs it). Evidence, not authority: nothing else is touched. */
export function setWaiting(home, { producer, waiting, reason, message } = {}) {
  if (typeof producer !== "string" || !WAITING_PRODUCER_RE.test(producer)) throw waitingError("E_BAD_ARGS", `--producer must match ${WAITING_PRODUCER_RE.source}`);
  if (producer === "kernel") throw waitingError("E_BAD_ARGS", "--producer kernel is reserved for the kernel's own events");
  if (typeof waiting !== "boolean") throw waitingError("E_BAD_ARGS", "waiting must be set or clear");
  if (waiting) {
    if (!WAITING_REASONS.includes(reason)) throw waitingError("E_BAD_ARGS", `--reason must be one of ${WAITING_REASONS.join(", ")}`);
    if (message !== undefined && !validWaitingMessage(message)) throw waitingError("E_BAD_ARGS", `--message must be one line of 1 to ${WAITING_MESSAGE_MAX} characters with no control characters`);
  } else {
    if (reason !== undefined) throw waitingError("E_BAD_ARGS", "--reason is for set, not clear");
    if (message !== undefined) throw waitingError("E_BAD_ARGS", "--message is for set, not clear");
  }
  const incarnation = incarnationOf(home);
  if (incarnation === null) throw waitingError("E_SESSION_UNKNOWN", `${home} is not an instance home (no readable instance.json)`);
  const live = [readLog(join(home, HOME_LOG), "home"), readLog(workspaceLogPath(home), "workspace")]
    .map((log) => { const c = claimsOf(admit(home, [log]).rows, incarnation).get(producer); return c?.waiting ? c : null; });
  const agrees = (c) => (waiting ? !!c && c.reason === reason && c.message === (message ?? null) : !c);
  const answer = (changed, claim) => ({ eventsApi: EVENTS_API, instance: basename(home), home, producer, changed, waitingOnYou: waitingShape(claim) });
  if (live.every(agrees)) return answer(false, waiting ? live[0] : null);
  const data = waiting ? { waitingOnYou: true, reason, ...(message !== undefined ? { message } : {}) } : { waitingOnYou: false };
  const res = appendEvent(home, { producer, kind: "waiting", data }, { incarnation });
  const failed = (res.results || []).filter((r) => !r.ok);
  if (!res.ok || failed.length) throw waitingError("E_EVENTS_FAILED", `could not record the waiting claim in ${failed.map((r) => `${r.path} (${r.reason})`).join(", ") || res.reason}; retry to complete it`);
  return answer(true, waiting ? { producer, since: res.row.at, reason, message: message ?? null } : null);
}

/** The kernel session boundary of one start receipt: a `launched` row tagged
 *  `startId`, dated at the receipt's `startedAt`, written once to each log. A
 *  start records it as soon as its session exists; recovering an interrupted
 *  start (its receipt adopted later) completes it: a log that already has the
 *  row is left alone, a log missing it gets a copy of the same row (same time,
 *  same data), and only when neither has it is the row made, still at the
 *  launch time, so a claim the new session made since is kept. `ok` is true
 *  only when every log holds the row; evidence, never authority. */
export function recordStartBoundary(home, { startId, startedAt, ...data }) {
  const paths = [join(home, HOME_LOG), workspaceLogPath(home)];
  const instance = basename(home);
  const isIt = (r) => r.instance === instance && r.home === home && (r.producer ?? "kernel") === "kernel" && r.kind === "launched" && r.data?.startId === startId;
  const found = paths.map((path) => readLog(path, "log").rows.find(isIt) ?? null);
  if (found.every(Boolean)) return { ok: true, existed: true };
  const existing = found.find(Boolean);
  if (!existing) {
    const res = appendEvent(home, { kind: "launched", data: { ...data, startId } }, { at: startedAt });
    return { ...res, ok: res.ok && (res.results || []).every((r) => r.ok) };
  }
  // The row exactly as the other log holds it: same time, incarnation and data.
  const line = JSON.stringify(existing) + "\n";
  const results = paths.filter((_, i) => !found[i]).map((path) => {
    try {
      if (path.startsWith(home) && !existsSync(home)) return { path, ok: false, reason: "home absent" };
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, line);
      return { path, ok: true };
    } catch (e) { return { path, ok: false, reason: e.message }; }
  });
  return { ok: results.every((r) => r.ok), repaired: true, row: existing, results };
}
