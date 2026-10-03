/** Host-local terminal transport. Delivery policy belongs to the caller. */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";

const shells = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "login"]);
function tmux(target, args, { exec = execFileSync, input } = {}) {
  // launchd does not supply a UTF-8 locale. In that environment tmux replaces
  // the tab delimiters in list-panes output with underscores unless forced.
  return exec("tmux", ["-u", "-S", target.socket, ...args], {
    encoding: "utf8", input, timeout: 10000, maxBuffer: 1024 * 1024,
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
// Submit verification (#562). A harness can swallow an Enter that lands while
// it is still handling a large bracketed paste, leaving the text unsent in its
// input box. So the pane is left to settle before Enter, and Enter is judged by
// whether it changed the bottom of the screen: a byte comparison only, never a
// reading of any harness's UI, and the pane's text is never acted on.
const SETTLE_FLOOR_MS = 200, SETTLE_MS_PER_KIB = 3, SETTLE_CAP_MS = 2000, SETTLE_POLL_MS = 100;
const VERIFY_MS = 300, RESEND_BACKOFF_MS = [300, 600]; // at most 3 Enters in total
const REGION_LINES = 15, HISTORY_LINES = 200;
const GEOMETRY = "#{pane_width}x#{pane_height}";
const realSleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** One look at the pane, or null when it cannot be read: `region`, the bottom
 *  15 lines of the visible pane (trailing blank rows dropped, and each line's
 *  trailing spaces, which a redraw pads differently); `all`, the
 *  visible pane with up to 200 lines of history above it; and `size`, the
 *  pane's geometry, read before and after the capture in the same tmux call
 *  (null when it moved in between). */
function capturePane(target, paneId, io) {
  try {
    const lines = tmux(target, ["display-message", "-p", "-t", paneId, GEOMETRY, ";",
      "capture-pane", "-p", "-J", "-t", paneId, "-S", `-${HISTORY_LINES}`, ";",
      "display-message", "-p", "-t", paneId, GEOMETRY], io).split("\n");
    if (lines.at(-1) === "") lines.pop();
    const first = lines.shift(), last = lines.pop();
    if (!/^\d+x\d+$/.test(first) || !/^\d+x\d+$/.test(last)) return null;
    for (let i = 0; i < lines.length; i++) lines[i] = lines[i].trimEnd();
    while (lines.length && !lines.at(-1)) lines.pop();
    return { size: first === last ? first : null, region: lines.slice(-REGION_LINES).join("\n"), all: lines.join("\n") };
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
/** Paste `text` and submit it with Enter. Answers `submitted` (the Enter was
 *  taken, or sent unjudged) and `verified` (whether the screen comparison
 *  judged it); `reason: "enter-not-taken"` only with `submitted: false`. A
 *  failed paste or key send throws; a failed capture never does. */
export function inputSessionTarget(target, text, io) {
  const state = inspectSessionTarget(target, io);
  if (!state.present || state.state === "shell") throw new Error(`cannot submit input: session is ${state.state}`);
  const sleep = io?.sleep || realSleep, now = io?.now || Date.now;
  // Bracketed paste preserves multiline input as one user message. No text
  // is evaluated by a shell or interpreted as tmux key names.
  const buffer = `oats-${randomUUID()}`;
  try {
    tmux(target, ["load-buffer", "-b", buffer, "-"], { ...io, input: text });
    tmux(target, ["paste-buffer", "-p", "-b", buffer, "-t", state.paneId], io);
  } finally {
    try { tmux(target, ["delete-buffer", "-b", buffer], io); } catch { /* already consumed or disconnected */ }
  }
  const enter = () => tmux(target, ["send-keys", "-t", state.paneId, "Enter"], io);
  // Settle: wait a floor scaled by paste size, then until two consecutive
  // captures are identical, giving up at the cap. The last capture is A.
  const started = now();
  sleep(Math.min(SETTLE_CAP_MS, SETTLE_FLOOR_MS + Math.ceil(Buffer.byteLength(text) / 1024) * SETTLE_MS_PER_KIB));
  let before = capturePane(target, state.paneId, io);
  while (before !== null && now() - started < SETTLE_CAP_MS) {
    sleep(SETTLE_POLL_MS);
    const next = capturePane(target, state.paneId, io);
    const settled = next !== null && sameLook(next, before);
    before = next;
    if (settled) break;
  }
  enter();
  // An unreadable pane gets no further keys: the terminal accepted them, unjudged.
  if (before === null) return { ...state, submitted: true, verified: false };
  // Changed content means the Enter was taken (or the pane moved for an
  // unrelated reason, such as a spinner, a clock or a human typing: read as
  // taken, no worse than not looking). Unchanged content means it was
  // swallowed: any reaction, a dialog included, would have changed it, so a
  // resend is safe. A reflow alone, on a pane seen to change size, is not a
  // change. The screen is looked at again after each backoff, so an Enter
  // taken late is not followed by another. A capture that fails stops the
  // retries: no further Enter is sent.
  for (let enters = 1; ; enters++) {
    for (const wait of [VERIFY_MS, RESEND_BACKOFF_MS[enters - 1]]) {
      if (wait === undefined) break;
      sleep(wait);
      const after = capturePane(target, state.paneId, io);
      if (after === null) return { ...state, submitted: true, verified: false };
      if (!unchanged(before, after)) return { ...state, submitted: true, verified: true };
    }
    if (enters > RESEND_BACKOFF_MS.length) break;
    enter();
  }
  // The text stays in the input box; it is never pasted again.
  return { ...state, submitted: false, verified: true, reason: "enter-not-taken" };
}
