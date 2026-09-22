/** K7 — typed lifecycle events per instance, append-only, producer-attributed.
 *
 * Every event is a fact a kernel action just made true (spawned, launched,
 * stopped, restarted, retired…), written by the code that did it, with the
 * receipt it produced. Nothing here is inferred from transcripts, task files or
 * prose; "waiting on you" is reported only when a producer says so — today no
 * producer does, and the view says `null`, not a guess. Retirement's event
 * outlives the home in the workspace-level log. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const EVENTS_API = 1;
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

/** Append one typed event. Never throws into the caller's action: an event is
 *  evidence, not authority — a failed write is reported in the return value. */
export function appendEvent(home, event, { workspaceOnly = false } = {}) {
  if (!EVENT_KINDS.includes(event.kind)) return { ok: false, reason: `unknown event kind ${event.kind}` };
  const row = { eventsApi: EVENTS_API, at: new Date().toISOString(), instance: basename(home), home, producer: event.producer || "kernel", kind: event.kind, ...(event.data !== undefined ? { data: event.data } : {}) };
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

function readLog(path) {
  if (!existsSync(path)) return { rows: [], truncated: false, bytes: 0 };
  const size = statSync(path).size;
  const text = readFileSync(path, "utf8");
  const rows = [];
  for (const line of text.split("\n")) { if (!line.trim()) continue; try { const r = JSON.parse(line); if (r && r.eventsApi === EVENTS_API && typeof r.kind === "string") rows.push(r); } catch { /* a torn line is skipped, counted */ rows.push({ eventsApi: EVENTS_API, kind: "unreadable", at: null, producer: "kernel", data: { reason: "torn or invalid line" } }); } }
  return { rows, truncated: size > MAX_BYTES, bytes: size };
}

/** Events for one instance, newest last, from both logs (deduplicated by
 *  at+kind), with a bounded window. `waitingOnYou` is a producer claim or null. */
export function readEvents(home, { limit = 200, since = null } = {}) {
  const a = readLog(join(home, HOME_LOG)), b = readLog(workspaceLogPath(home));
  const seen = new Set(); const rows = [];
  for (const r of [...a.rows, ...b.rows]) { const k = `${r.at}|${r.kind}|${JSON.stringify(r.data ?? null)}`; if (seen.has(k)) continue; seen.add(k); rows.push(r); }
  rows.sort((x, y) => String(x.at ?? "").localeCompare(String(y.at ?? "")));
  const filtered = since ? rows.filter((r) => r.at && r.at > since) : rows;
  const window = filtered.slice(-limit);
  const last = window.at(-1) ?? null;
  const waiting = window.filter((r) => r.data && r.data.waitingOnYou === true).at(-1) ?? null;
  return {
    eventsApi: EVENTS_API, instance: basename(home), home, count: filtered.length, returned: window.length, truncated: filtered.length > window.length || a.truncated || b.truncated,
    events: window, lastEvent: last ? { kind: last.kind, at: last.at, producer: last.producer } : null,
    waitingOnYou: waiting ? { since: waiting.at, producer: waiting.producer, reason: waiting.data.reason ?? null } : null,
    notes: [
      "events are producer-attributed facts written by the kernel action that made them true; nothing is inferred from transcripts or task files",
      "waitingOnYou is null unless a producer reported it — null means unknown, not 'not waiting'",
    ],
  };
}
