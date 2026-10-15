// What the TUI's unit tests share: fake streams and a fake process for the guard, a reader of
// what was written to a terminal, and a reader of a view's rows. No test here needs a terminal.
import { EventEmitter } from "node:events";
import { textOf } from "../lib/term/text.mjs";

/** A terminal's output side. `log` (shared with the input side) records the order of acts. */
export function fakeStdout({ columns = 80, rows = 24, isTTY = true, log = [] } = {}) {
  const stream = new EventEmitter();
  Object.assign(stream, {
    isTTY, columns, rows, log, written: [], accepts: true, gone: false,
    write(bytes) {
      if (stream.gone) throw Object.assign(new Error("write EIO"), { code: "EIO" });
      stream.written.push(bytes);
      log.push(["write", bytes]);
      return stream.accepts;
    },
    /** Everything written so far, and forget it. */
    take() { return stream.written.splice(0).join(""); },
    resize(columns, rows) { Object.assign(stream, { columns, rows }); stream.emit("resize"); },
  });
  return stream;
}
/** A terminal's input side. */
export function fakeStdin({ isTTY = true, log = [] } = {}) {
  const stream = new EventEmitter();
  Object.assign(stream, {
    isTTY, log, raw: false, paused: true, gone: false,
    setRawMode(on) {
      if (stream.gone) throw Object.assign(new Error("setRawMode EIO"), { code: "EIO" });
      stream.raw = on;
      log.push(["raw", on]);
      return stream;
    },
    resume() { stream.paused = false; return stream; },
    pause() { stream.paused = true; return stream; },
    type(text) { stream.emit("data", Buffer.from(text, "latin1")); },
  });
  return stream;
}
/** The process: signals arrive as events; kill() is recorded, never performed. */
export function fakeProcess() {
  const proc = new EventEmitter();
  proc.pid = 4242;
  proc.kills = [];
  proc.kill = (pid, signal) => { proc.kills.push([pid, signal]); return true; };
  return proc;
}
/** Timers that fire when the test says so. */
export function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimer(fn, ms) { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimer(id) { pending.delete(id); },
    get count() { return pending.size; },
    delays() { return [...pending.values()].map((t) => t.ms); },
    fire() { const all = [...pending.entries()]; pending.clear(); for (const [, t] of all) t.fn(); },
  };
}

/** The sequences the TUI itself may write, each a full match of one CSI sequence's body
 *  (what follows `ESC [`): a position, the two erases, an SGR of the allowed parameters, the four
 *  private modes, and the synchronized update (DEC 2026) set and reset around every frame, a kind
 *  of its own. docs/tui.md states the same list for operators. An agent's own styles, drawn only in
 *  the terminal panel, are no SGR of this list: a test of the panel reads them on their own. */
const SGR_ALLOWED = new Set([0, 1, 2, 4, 7, ...Array.from({ length: 8 }, (_, i) => 30 + i), ...Array.from({ length: 8 }, (_, i) => 90 + i)]);
export const OWN_MODES = Object.freeze([1049, 25, 7, 2004]);
function ownSequence(body) {
  if (/^[1-9]\d*;[1-9]\d*H$/.test(body)) return "position";
  if (body === "K" || body === "2J") return "erase";
  const sgr = /^(\d+(?:;\d+)*)m$/.exec(body);
  if (sgr) return sgr[1].split(";").every((p) => SGR_ALLOWED.has(Number(p))) ? "sgr" : null;
  const mode = /^\?(\d+)([hl])$/.exec(body);
  if (mode && mode[1] === "2026") return "sync";
  if (mode) return OWN_MODES.includes(Number(mode[1])) ? "mode" : null;
  return null;
}
/** Read what was written to a terminal: `{ sequences, text, foreign }`. `sequences` are the CSI
 *  sequences in order (`{ kind, body }`), `text` everything else, and `foreign` every ESC that
 *  does not begin a sequence of the TUI's own list, with the bytes after it. */
export function readTerminalOutput(output) {
  const sequences = [], foreign = [];
  let text = "";
  for (let i = 0; i < output.length; i++) {
    if (output[i] !== "\x1b") { text += output[i]; continue; }
    const csi = /^\x1b\[([0-9;?]*[A-Za-z])/.exec(output.slice(i, i + 32));
    const kind = csi ? ownSequence(csi[1]) : null;
    if (!kind) { foreign.push(JSON.stringify(output.slice(i, i + 12))); continue; }
    sequences.push({ kind, body: csi[1] });
    i += csi[0].length - 1;
  }
  return { sequences, text, foreign };
}
/** The private modes a run switched, in order: `["?1049h", "?25l", …]`. */
export const modesOf = (output) => readTerminalOutput(output).sequences.filter((s) => s.kind === "mode").map((s) => s.body);

/** A view's rows as plain strings, each `cols` wide before its trailing spaces are cut. Every
 *  character of the TUI's own text is one cell, so a column is an index. */
export function rowStrings(rows, cols) {
  return rows.map((spans) => {
    const line = Array.from({ length: cols }, () => " ");
    for (const span of spans) [...textOf(span.text)].forEach((ch, i) => { if (span.col + i < cols) line[span.col + i] = ch; });
    return line.join("").trimEnd();
  });
}

// ── The Instances view: a deployment's entry made by the shared functions, and what is drawn for it.
// Everything below goes through the same calls the program makes (lib/client.mjs re-exports them):
// a test that built an entry or a panel by hand would test its own idea of them.
import { failedEntry, observedEntry, panelInstances, pendingEntry, rosterRows } from "../lib/client.mjs";
import { model, roster } from "../lib/model.mjs";
import { initialState, reduce } from "../lib/store.mjs";
import { createScreen } from "../lib/term/screen.mjs";
import { frame, layout } from "../lib/views/frame.mjs";

/** The fixture's deployment and the kernel record the shared gates accept. */
export const DEPLOYMENT = "/srv/deploy";
export const CLI = Object.freeze({ ok: true, bin: "/opt/oats/bin/oats.mjs", source: "tui", version: "0.52.0", workspaceApi: 2, features: Object.freeze(["workspace-v2", "instance-modules", "served-identity", "packages-no-approval", "waiting-on-you", "workspace-identity"]) });
/** The time of every paint in a test that does not say otherwise; run the tests with TZ=UTC in mind:
 *  a clock time on the screen is local, so a test that reads one computes it the same way. */
export const NOW = Date.parse("2026-10-11T10:00:30.000Z");

/** One kernel row (`oats status --json`, an instance), running in tmux unless `extra` says otherwise. */
export function instanceRow(soul, name, extra = {}) {
  return {
    instance: name, agent: soul, home: `${DEPLOYMENT}/agents/${soul}/instances/${name}`, repo: `${DEPLOYMENT}/oats`, work: "worktree", branch: `agents/${name}`,
    harness: "claude", model: "claude-opus-5-5", modelFrom: "soul", createdAt: "2026-10-11T08:00:00.000Z", startedAt: "2026-10-11T09:00:00.000Z",
    running: true, runtimeState: "running", tmux: { session: "oats-agents", window: name }, ...extra,
  };
}
/** A roster as the shared reader hands it on (deployment-data.mjs `deploymentStatusData`), from rows:
 *  one soul per distinct `agent`, in first-seen order. */
export function rosterOf(rows, { withheld = [], team = "eng" } = {}) {
  const souls = new Map();
  for (const row of rows) { if (!souls.has(row.agent)) souls.set(row.agent, []); souls.get(row.agent).push(row); }
  return { root: `${DEPLOYMENT}/agents`, agents: [...souls].map(([name, instances]) => ({ name, description: "", team, dir: `${DEPLOYMENT}/agents/${name}`, instances })), withheld, workspace: { reachable: true } };
}
/** An observed entry for those rows, through the real `rosterRows`, `panelInstances` and
 *  `observedEntry`. `answers(row)` is the collector's answer for a row (default: what the row says). */
export function observed(rows, { withheld, workspace = "acme-platform", observedAt = "2026-10-11T09:59:00.000Z", at = "2026-10-11T10:00:00.000Z", cli = CLI, answers = (row) => ({ running: row.running, runtimeState: row.runtimeState, ...(row.runtimeError ? { runtimeError: row.runtimeError } : {}), tmux: row.tmux }) } = {}) {
  const document = rosterOf(rows, { withheld }), listed = rosterRows(document, cli);
  return observedEntry({ roster: document, workspaceStatus: { workspace: { name: workspace } }, observedAt }, panelInstances(listed, listed.map(answers)), at);
}
/** The same entry after a read that failed with `reason`, through the real `failedEntry`. */
export const failed = (entry, reason, at = "2026-10-11T10:05:00.000Z") => failedEntry(entry, reason, at);
export const pending = (at = "2026-10-11T09:59:59.000Z") => pendingEntry(null, at);

/** The state of a run that took `entry` (pending when none is given). */
export function stateOf(entry = null, options = {}) {
  const first = initialState({ deployment: DEPLOYMENT, cli: CLI, home: "/home/u", entry: pending(), ...options });
  return entry ? took(first, entry, 1) : first;
}
/** A state after the reader gave `entry` for the fixture's deployment, as cycle `number`. */
export const took = (state, entry, number, id = DEPLOYMENT) => reduce(state, { id, entry, number }).state;
/** Draw a state as the main loop does: `{ rows, page, extent, room, terminal, cursor, cols, cells,
 *  lines }`. `cells` is the screen's cell buffer (term/screen.mjs `cells`), `lines` its rows as
 *  strings, one character per cell (the second cell of a wide character is empty), trailing blanks
 *  cut. `screen` is the open terminal's last capture (`{ lines, cursor }`), as the loop hands it on. */
export function draw(state, size = { cols: 80, rows: 24 }, { now = NOW, utf8 = true, screen = null } = {}) {
  const at = new Date(now).toISOString();
  const listing = (state.view === "help" ? state.back : state.view) === "switcher";
  const r = listing ? { notice: null, note: null, observed: true } : roster(state, at);
  const g = layout(r.notice, size, { observed: r.observed, note: r.note, ascii: state.ascii, outcome: listing ? null : state.outcome });
  const made = { ...frame({ ...model(state, { page: g.page, now, at, cols: g.listCols }), screen }, size), cols: g.listCols };
  const cells = createScreen({ utf8, ascii: state.ascii }).cells(made.rows, size);
  return { ...made, cells, lines: cells.map((line) => line.map((cell) => cell.text).join("").trimEnd()) };
}
/** Press keys on a state, each with the geometry of the frame drawn before it, as the loop does.
 *  A key is a key id (`"j"`, `"ctrl+l"`, `"enter"`); a one-grapheme id that is not `space` types itself. */
export function press(state, keys, size = { cols: 80, rows: 24 }) {
  const effects = [];
  for (const key of keys) {
    const { page, extent, room, cols } = draw(state, size);
    const text = key === "space" ? " " : [...new Intl.Segmenter().segment(key)].length === 1 ? key : undefined;
    const next = reduce(state, { key, ...(text ? { text } : {}), page, extent, room, cols });
    state = next.state;
    if (next.effect) effects.push(next.effect);
  }
  return { state, effects };
}

// ── The shared lifecycle's kernel answers (awebai/oats#855, PR 5), in the forms the Desktop's tests
// give them (packages/desktop/test/helpers/lifecycle-fixture.mjs, which a test of this package may
// not import): one instance, its stop plan, and the receipt of its apply.
export const LIFECYCLE_INSTANCE = Object.freeze({ instance: "dev-1", agent: "dev", agentsRoot: "/team/agents", home: "/team/agents/dev/instances/dev-1" });
export const lifecycleTarget = () => ({ ...LIFECYCLE_INSTANCE, workspace: "team", server: null });
/** What a boundary admits the fixture instance against. */
export const lifecycleContext = () => ({ cli: { ok: true, bin: "/installed/oats", version: "0.24.6", lifecycleApi: 1, features: ["lifecycle-plans", "retire-retention", "retire-home"] }, workspace: { id: "team", scope: "/team" }, instances: [{ ...LIFECYCLE_INSTANCE }] });
export const lifecycleSession = () => ({ state: "unknown", present: true, established: true, backend: "tmux" });
export const lifecycleWork = () => ({ observed: true, revision: "a".repeat(40), branch: "feat/work", detached: false, drift: true, changed: 2, untracked: 1,
  upstream: { ref: null, ahead: null, behind: null }, base: { ref: null, ahead: null, behind: null }, remote: { host: "github.com", path: "owner/repo" } });
export const stopPlan = (recursive = true) => ({ lifecycleApi: 1, action: "stop", instance: LIFECYCLE_INSTANCE.instance, home: LIFECYCLE_INSTANCE.home,
  recursive, at: "2026-09-22T00:00:00Z", planRevision: "a".repeat(24), notes: [], skipped: [], ambiguous: [], targets: [{
    ...LIFECYCLE_INSTANCE, depth: 0, session: lifecycleSession(), work: lifecycleWork(), workMode: "worktree", launched: true, retiring: false, stopPending: false, midTask: true }] });
export const envelope = (result) => ({ schemaVersion: 1, ok: true, result });
export const stopReceipt = (args, plan = stopPlan()) => ({ lifecycleApi: 1, action: "stop", instance: plan.instance, home: plan.home,
  planRevision: args.revision, idempotencyKey: args.key, at: "2026-09-22T00:01:00Z", replayed: false, ok: true,
  retained: ["home", "work", "transcript", "launch"], results: plan.targets.map((t) => ({ instance: t.instance, home: t.home, ok: true, stopped: true, alreadyIdle: false, state: "stopped" })) });
