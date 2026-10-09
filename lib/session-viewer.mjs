/** Interactive host-local viewers. Closing a viewer leaves its agent alive. */
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { inspectSessionTarget } from "./session-input.mjs";

/** The kernel feature of `session attach --detach-key` (docs/execution-targets.md, "Inspect,
 *  input and attach"): a routed attach sends the flag only to a host that advertises it. */
export const DETACH_KEY_FEATURE = "session-attach-detach-key";
/** The status of an attach its detach key ended. Answered only when the key's own binding ran. */
export const SESSION_DETACHED_EXIT = 20;
/** The closed grammar of a detach key: Control with a letter other than i and m (Tab and Enter)
 *  or one of \ ] ^ _, Meta with a lowercase letter or a digit, or F1 to F12 with at most one
 *  modifier. Escape (C-[), the ESC + C1 introducers (M-[, M-], M-\, M-O: a terminal's reply can
 *  arrive as one), `Any` and the mouse key names are outside it. */
const DETACH_KEY = /^(?:C-[a-hj-ln-z\\\]^_]|M-[a-z0-9]|(?:[CMS]-)?F(?:[1-9]|1[0-2]))$/;
/** Whether a value is one detach key: the local and the routed attach both ask here. */
export function isDetachKey(value) { return typeof value === "string" && DETACH_KEY.test(value); }
/** The key, or E_BAD_ARGS: called before any tmux or ssh call. */
export function requireDetachKey(value) {
  if (isDetachKey(value)) return value;
  throw Object.assign(new Error(`--detach-key must be one key: C-<a letter except i and m, or one of \\ ] ^ _>, M-<a lowercase letter or digit>, or F1 to F12 with at most one of C-, M-, S- (got ${JSON.stringify(value)})`), { code: "E_BAD_ARGS" });
}

/** The table of a viewer without a detach key: one for the whole tmux server, emptied and bound
 *  again by each such viewer. */
const LOCKED_TABLE = "oatsview-locked";
/** The mouse bindings of a viewer's key table, the locked one or a keyed viewer's own. */
const MOUSE_BINDINGS = [
  ["WheelUpPane", "if-shell", "-F", "#{||:#{pane_in_mode},#{mouse_any_flag}}", "send-keys -M", "copy-mode -e; send-keys -M"],
  ["MouseDrag1Pane", "if-shell", "-F", "#{||:#{pane_in_mode},#{mouse_any_flag}}", "send-keys -M", "copy-mode -M"],
];
/** What a detach key runs, as ONE bind-key argument (a bare `;` argument would end bind-key and
 *  run the rest at once): mark the viewer session, then detach the client that pressed the key.
 *  A constant: no caller text is ever part of a tmux command string. */
const DETACH_BINDING = "set-option @oats-detached 1 ; detach-client";

export function prepareSessionViewer(target, { exec = execFileSync, detachKey } = {}) {
  if (detachKey !== undefined) requireDetachKey(detachKey);
  if (!inspectSessionTarget(target, { exec }).present) throw new Error("session no longer exists");
  // UTF-8 mode (-u) like the shared session helper: a service without a
  // UTF-8 locale (launchd) otherwise mangles tmux output.
  const run = (args) => exec("tmux", ["-u", "-S", target.socket, ...args], {
    encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const viewer = `oatsview-${process.pid}-${randomUUID().slice(0, 8)}`;
  // A keyed viewer reads a table of its own, named as its session: a binding in the locked table
  // would be every viewer's, and the next viewer's unbind would remove it.
  const table = detachKey === undefined ? LOCKED_TABLE : viewer;
  const cleanup = () => {
    try { run(["kill-session", "-t", `=${viewer}`]); } catch { /* already detached/ended */ }
    // A key table belongs to the tmux server and outlives the session; tmux drops it with its
    // last binding.
    if (table !== LOCKED_TABLE) { try { run(["unbind-key", "-a", "-q", "-T", table]); } catch { /* the server is gone */ } }
  };
  try {
    const placeholder = run(["new-session", "-d", "-s", viewer, "-P", "-F", "#{window_id}"]);
    if (!/^@\d+$/.test(placeholder)) throw new Error("tmux returned no viewer window id");
    run(["link-window", "-s", `=${target.session}:=${target.window}`, "-t", `=${viewer}:`]);
    run(["kill-window", "-t", placeholder]);
    // One linked window prevents a stale viewer from selecting a sibling agent
    // when this agent retires. Disable window navigation in the viewer only.
    for (const name of ["prefix", "prefix2"]) run(["set-option", "-t", viewer, name, "None"]);
    run(["set-option", "-t", viewer, "key-table", table]);
    // The viewer shows one agent; its status line only repeats that name.
    // Session-scoped on the temporary viewer: the agents' own session and
    // the operator's tmux settings are untouched.
    run(["set-option", "-t", viewer, "status", "off"]);
    run(["unbind-key", "-a", "-q", "-T", table]);
    for (const binding of MOUSE_BINDINGS) run(["bind-key", "-T", table, ...binding]);
    // The key is its own argv element, after the grammar admitted it.
    if (detachKey !== undefined) run(["bind-key", "-T", table, detachKey, DETACH_BINDING]);
    run(["set-option", "-t", viewer, "mouse", "on"]);
    const env = { ...process.env }; delete env.TMUX;
    /** Whether the detach key's binding ran: it marks the viewer session before it detaches. A
     *  client that left any other way (its window ended, another client detached it) left no
     *  mark, and a session that is gone answers nothing. The target is `=<session>:`:
     *  show-options reads -t as a pane, and under -q answers nothing at all for `=<session>`. */
    const detached = () => {
      if (detachKey === undefined) return false;
      try { return run(["show-options", "-t", `=${viewer}:`, "-qv", "@oats-detached"]) === "1"; } catch { return false; }
    };
    return { binary: "tmux", args: ["-u", "-S", target.socket, "attach-session", "-t", `=${viewer}`], env, cleanup, detached };
  } catch (e) { cleanup(); throw e; }
}

// SIGQUIT under a keyed attach. The key may be C-\, the tty's QUIT character: pressed before the
// tmux client has taken the tty, or again once the client has given it back, it reaches this
// process as SIGQUIT, whose default action ends Node before any `finally` (status 131, the viewer
// session and its table left on the server). One listener, added by the first keyed attach and
// never removed, calls whatever the attach in progress set.
let onQuit = null;
let quitHeld = false;
function holdQuit() {
  if (quitHeld) return;
  quitHeld = true;
  process.on("SIGQUIT", () => onQuit?.());
}

/** Attach this terminal to a viewer of the target and answer the client's status, or
 *  SESSION_DETACHED_EXIT when `detachKey` was given and ended the attach. */
export async function attachSessionTarget(target, { detachKey } = {}) {
  if (detachKey !== undefined) { requireDetachKey(detachKey); holdQuit(); }
  const viewer = prepareSessionViewer(target, { detachKey });
  let child;
  let quit = false;
  const stop = () => { viewer.cleanup(); child?.kill(); };
  const signals = ["SIGHUP", "SIGTERM", "SIGINT"];
  for (const sig of signals) process.on(sig, stop);
  // Until the client has exited, a QUIT stops the attach as the other signals do, with status 1.
  // Unless the key's binding has already run: then the client is on its way out, the QUIT is the
  // key pressed again, and the attach ends as a detach.
  if (detachKey !== undefined) onQuit = () => { if (viewer.detached()) return; quit = true; stop(); };
  try {
    const code = await new Promise((resolve, reject) => {
      child = spawn(viewer.binary, viewer.args, { env: viewer.env, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    if (quit) return 1;
    return viewer.detached() ? SESSION_DETACHED_EXIT : code;
  } finally {
    // The client has exited (or never started): a QUIT from here on changes nothing. One that
    // arrives during the calls below waits for them, so cleanup completes and the status stands.
    onQuit = null;
    for (const sig of signals) process.removeListener(sig, stop);
    viewer.cleanup();
  }
}
