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
 *  (what follows `ESC [`): a position, the two erases, an SGR of the allowed parameters, and the
 *  four private modes. docs/tui.md states the same list for operators. */
const SGR_ALLOWED = new Set([0, 1, 2, 4, 7, ...Array.from({ length: 8 }, (_, i) => 30 + i), ...Array.from({ length: 8 }, (_, i) => 90 + i)]);
export const OWN_MODES = Object.freeze([1049, 25, 7, 2004]);
function ownSequence(body) {
  if (/^[1-9]\d*;[1-9]\d*H$/.test(body)) return "position";
  if (body === "K" || body === "2J") return "erase";
  const sgr = /^(\d+(?:;\d+)*)m$/.exec(body);
  if (sgr) return sgr[1].split(";").every((p) => SGR_ALLOWED.has(Number(p))) ? "sgr" : null;
  const mode = /^\?(\d+)([hl])$/.exec(body);
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
