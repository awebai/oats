/** Host-local terminal transport. Delivery policy belongs to the caller. */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const shells = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "login"]);
function tmux(target, args, { exec = execFileSync, input, timeout = 10000, killSignal } = {}) {
  // launchd does not supply a UTF-8 locale. In that environment tmux replaces
  // the tab delimiters in list-panes output with underscores unless forced.
  return exec("tmux", ["-u", "-S", target.socket, ...args], {
    encoding: "utf8", input, timeout, ...(killSignal ? { killSignal } : {}), maxBuffer: 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
export function inspectSessionTarget(target, io) {
  let rows;
  try {
    rows = tmux(target, ["list-panes", "-t", `=${target.session}:=${target.window}`, "-F", "#{pane_id}\t#{pane_dead}\t#{pane_current_command}\t#{pane_pid}"], io).trim().split("\n").filter(Boolean);
  } catch (e) {
    // A missing window on a reachable server is absence. A lost socket is not.
    if (/can't find (window|session)/i.test(String(e.stderr || ""))) return { backend: "tmux", present: false, state: "stopped" };
    throw e;
  }
  if (!rows.length) return { backend: "tmux", present: false, state: "stopped" };
  if (rows.length !== 1) throw new Error("session window has multiple panes; choose an unsplit agent window");
  const [paneId, dead, command, panePid] = rows[0].split("\t");
  if (!/^%\d+$/.test(paneId) || !["0", "1"].includes(dead)) throw new Error("invalid tmux pane response");
  let state = dead === "1" ? "stopped" : "unknown";
  if (dead === "0" && shells.has(command)) {
    // macOS tmux can report the wrapper shell while the harness is its child.
    // Only a shell with no non-shell descendants is a fallback prompt.
    if (!/^\d+$/.test(panePid)) throw new Error("tmux returned no pane process id");
    const output = (io?.exec || execFileSync)("ps", ["-axo", "pid=,ppid=,comm="], {
      encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
    const processes = output.split("\n").map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
    const descendants = new Set([panePid]);
    let active = false;
    for (let changed = true; changed;) {
      changed = false;
      for (const [, pid, parent, name] of processes) {
        if (descendants.has(parent) && !descendants.has(pid)) {
          descendants.add(pid); changed = true;
          if (!shells.has(basename(name).replace(/^-/, ""))) active = true;
        }
      }
    }
    state = active ? "unknown" : "shell";
  }
  return { backend: "tmux", present: dead === "0", state, paneId };
}
// Settling gives a large bracketed paste time before the single Enter. Screen
// bytes are observations only: neither change nor silence proves acceptance
// or authorizes another key. Each phase has one monotonic observation budget.
const SETTLE_FLOOR_MS = 200, SETTLE_MS_PER_KIB = 3, SETTLE_CAP_MS = 2000, SETTLE_POLL_MS = 100;
const OBSERVE_CAP_MS = 1000, OBSERVE_WAITS_MS = [300, 600];
const REGION_LINES = 15, HISTORY_LINES = 200;
const GEOMETRY = "#{pane_width}x#{pane_height}";
const realSleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** One look at the pane, or null when it cannot be read: `region`, the bottom
 *  15 lines of the visible pane (trailing blank rows dropped, and each line's
 *  trailing spaces, which a redraw pads differently); `all`, the
 *  visible pane with up to 200 lines of history above it; and `size`, the
 *  pane's geometry, read before and after the capture in the same tmux call
 *  (null when it moved in between). */
function capturePane(target, paneId, io, deadline, now) {
  const timeout = Math.floor(deadline - now());
  if (timeout <= 0) return null;
  try {
    const lines = tmux(target, ["display-message", "-p", "-t", paneId, GEOMETRY, ";",
      "capture-pane", "-p", "-J", "-t", paneId, "-S", `-${HISTORY_LINES}`, ";",
      // A read-only probe must not outlive its timeout by ignoring TERM.
      "display-message", "-p", "-t", paneId, GEOMETRY], { ...io, timeout, killSignal: "SIGKILL" }).split("\n");
    if (now() >= deadline) return null;
    if (lines.at(-1) === "") lines.pop();
    const first = lines.shift(), last = lines.pop();
    if (!/^\d+x\d+$/.test(first) || !/^\d+x\d+$/.test(last)) return null;
    for (let i = 0; i < lines.length; i++) lines[i] = lines[i].trimEnd();
    while (lines.length && !lines.at(-1)) lines.pop();
    const look = { size: first === last ? first : null, region: lines.slice(-REGION_LINES).join("\n"), all: lines.join("\n") };
    return now() < deadline ? look : null;
  } catch { return null; }
}
const sameLook = (a, b) => a.size === b.size && a.region === b.region;
/** Width-independent text: each run of one box-drawing character kept as one,
 *  so a rule of any length reads the same, then whitespace dropped. Runs are
 *  collapsed first, so a glyph is never merged with a rule on the next line. */
const flat = (text) => text.replace(/([\u2500-\u257f])\1+/g, "$1").replace(/\s+/g, "");
/** Whether the pane after Enter shows what it showed before. On a pane of the
 *  same size this is exact bytes. Only when its size was seen to change (a
 *  resize, a second client attaching) is a reflow allowed for: then the two
 *  bottom regions must agree at the bottom, and each must already be present,
 *  width aside, in the other's capture with history, so content that appeared
 *  or disappeared still reads as a change. */
function unchanged(a, b) {
  if (a.size !== null && a.size === b.size) return a.region === b.region;
  const x = flat(a.region), y = flat(b.region);
  if (!x || !y) return x === y;
  return (x.endsWith(y) || y.endsWith(x)) && flat(b.all).includes(x) && flat(a.all).includes(y);
}
/** One literal paste and one Enter. `submitted` means terminal commands
 * succeeded; `verified` means only that a bounded look changed afterward.
 * Neither is model acceptance. Terminal failures throw; observation failures
 * yield unverified, never a refusal or permission to retransmit. */
export function inputSessionTarget(target, text, io) {
  const state = inspectSessionTarget(target, io);
  if (!state.present || state.state === "shell") throw new Error(`cannot submit input: session is ${state.state}`);
  const sleep = io?.sleep || realSleep, now = io?.now || (() => performance.now());
  const wait = (ms, deadline) => { const remaining = deadline - now(); if (remaining > 0) sleep(Math.min(ms, remaining)); };
  // Bracketed paste preserves multiline input as one user message. No text
  // is evaluated by a shell or interpreted as tmux key names.
  const buffer = `oats-${randomUUID()}`;
  let settleDeadline;
  try {
    tmux(target, ["load-buffer", "-b", buffer, "-"], { ...io, input: text });
    tmux(target, ["paste-buffer", "-p", "-b", buffer, "-t", state.paneId], io);
    settleDeadline = now() + SETTLE_CAP_MS;
  } finally {
    try { tmux(target, ["delete-buffer", "-b", buffer], io); } catch { /* already consumed or disconnected */ }
  }
  // The budget starts at paste completion, before cleanup. Cleanup/Enter keep
  // their original command timeouts; only observation probes/sleeps are clipped.
  wait(SETTLE_FLOOR_MS + Math.ceil(Buffer.byteLength(text) / 1024) * SETTLE_MS_PER_KIB, settleDeadline);
  let before = capturePane(target, state.paneId, io, settleDeadline, now);
  while (before !== null && now() < settleDeadline) {
    wait(SETTLE_POLL_MS, settleDeadline);
    const next = capturePane(target, state.paneId, io, settleDeadline, now);
    const settled = next !== null && sameLook(next, before);
    before = next;
    if (settled) break;
  }
  if (now() >= settleDeadline) before = null;
  tmux(target, ["send-keys", "-t", state.paneId, "Enter"], io);
  const observeDeadline = now() + OBSERVE_CAP_MS;
  if (before !== null) {
    for (const delay of OBSERVE_WAITS_MS) {
      wait(delay, observeDeadline);
      const after = capturePane(target, state.paneId, io, observeDeadline, now);
      if (after === null) break;
      const changed = !unchanged(before, after);
      if (now() >= observeDeadline) break;
      if (changed) return { ...state, submitted: true, verified: true };
    }
  }
  return { ...state, submitted: true, verified: false };
}
