/** Interactive host-local viewers. Closing a viewer leaves its agent alive. */
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { inspectSessionTarget } from "./session-input.mjs";

/** The kernel feature of `session attach --detach-key` (docs/execution-targets.md, "Inspect,
 *  input and attach"): a routed attach sends the flag only to a host that advertises it. */
export const DETACH_KEY_FEATURE = "session-attach-detach-key";
/** The status of an attach its detach key ended. Answered only when the key's own binding ran. */
export const SESSION_DETACHED_EXIT = 20;
/** The closed grammar of a detach key: Control with a letter other than h, i and m, or one of
 *  \ ] ^ _, Meta with a lowercase letter or a digit, or F1 to F12 with at most one modifier.
 *  Outside it: C-i and C-m (Tab and Enter), C-h (the byte many terminals send for
 *  Ctrl+Backspace, and some for Backspace: not one key everywhere), Escape (C-[), the ESC + C1
 *  introducers (M-[, M-], M-\, M-O: a terminal's reply can arrive as one), `Any` and the mouse
 *  key names. A closed grammar can be widened later and never narrowed. */
const DETACH_KEY = /^(?:C-[a-gj-ln-z\\\]^_]|M-[a-z0-9]|(?:[CMS]-)?F(?:[1-9]|1[0-2]))$/;
/** Whether a value is one detach key: the local and the routed attach both ask here. */
export function isDetachKey(value) { return typeof value === "string" && DETACH_KEY.test(value); }
/** The key, or E_BAD_ARGS: called before any tmux or ssh call. */
export function requireDetachKey(value) {
  if (isDetachKey(value)) return value;
  throw Object.assign(new Error(`--detach-key must be one key: C-<a letter except h, i and m, or one of \\ ] ^ _>, M-<a lowercase letter or digit>, or F1 to F12 with at most one of C-, M-, S- (got ${JSON.stringify(value)})`), { code: "E_BAD_ARGS" });
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
 *  run the rest at once): mark the viewer session, keep it past its last client (destroy-unattached
 *  would remove it, and the mark with it, before the attach reads the mark), then detach the client
 *  that pressed the key. The attach's cleanup removes the session; the next attach's sweep does,
 *  if the attach died first. A constant: no caller text is ever part of a tmux command string. */
const DETACH_BINDING = "set-option @oats-detached 1 ; set-option destroy-unattached off ; detach-client";
/** A viewer session's name, which its key table shares: `oatsview-<pid of the attach>-<8 hex>`. */
const VIEWER_NAME = /^oatsview-(\d+)-[0-9a-f]{8}$/;
/** The index of the one global hook entry the kernel owns on the agents' server,
 *  `session-closed[900]` (docs/execution-targets.md, "Inspect, input and attach"). */
export const VIEWER_CLOSED_HOOK_INDEX = 900;
/** What that entry runs when a session closes: when the session's name is a viewer's, unbind the
 *  key table of that name. A key table belongs to the server and outlives its session, and only a
 *  global session-closed hook runs for every way a session ends on every tmux: a session's own
 *  hooks are gone with it, and tmux before 3.8 destroys an unattached session before its
 *  client-detached hook would run. The name is matched before it reaches a command (a format inside
 *  `#{...}` cannot hold `}`, so the 8 hex digits are spelled out). `run-shell -C` expands the name;
 *  tmux before 3.2 has no -C, the entry does nothing there, and the next attach's sweep removes the
 *  table. A constant: setting it again leaves the server as it was. */
const VIEWER_CLOSED_HOOK = `if-shell -F '#{m/r:^oatsview-[0-9]+-${"[0-9a-f]".repeat(8)}$,#{hook_session_name}}' "run-shell -C 'unbind-key -a -q -T #{hook_session_name}'"`;
/** Whether a process exists: kill(pid, 0), and EPERM (another user's) exists too. */
function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

/** Remove what attaches that died without detaching left on the server, and answer how many of
 *  each went. A viewer session goes when no client is attached and the attach named in it is gone;
 *  an attach that is alive may not have attached its client yet, or may be between a leave by its
 *  key and its own cleanup. A key table goes when no session has its name. Keys are listed before
 *  sessions: a viewer makes its session before its table, so a table listed belongs to a session
 *  that the later list shows, unless that session has ended. Nothing whose name is not a viewer's
 *  is touched, the shared locked table included. A failed call removes nothing and counts nothing:
 *  the attach goes on, and the next one sweeps again. */
function sweepViewers(run) {
  const swept = { sessions: 0, tables: 0 };
  let tables, sessions;
  try {
    tables = new Set(run(["list-keys"]).split("\n").map((line) => /^bind-key\s+(?:-r\s+)?-T\s+(\S+)\s/.exec(line)?.[1]).filter((t) => VIEWER_NAME.test(t ?? "")));
    sessions = run(["list-sessions", "-F", "#{session_name}\t#{session_attached}"]).split("\n").map((line) => line.split("\t"));
  } catch { return swept; }
  const kept = new Set();
  for (const [name, attached] of sessions) {
    const viewer = VIEWER_NAME.exec(name);
    if (!viewer || attached !== "0" || processAlive(Number(viewer[1]))) { kept.add(name); continue; }
    try { run(["kill-session", "-t", `=${name}`]); swept.sessions++; } catch { kept.add(name); }
  }
  for (const table of tables) {
    if (kept.has(table)) continue;
    try { run(["unbind-key", "-a", "-q", "-T", table]); swept.tables++; } catch { /* the next attach sweeps again */ }
  }
  return swept;
}

/** Whether a `tmux -V` answer names a release with the client's `-T <features>` flag (tmux 3.2):
 *  `tmux X.Y` with an optional letter suffix only. A development build (`tmux next-3.6`,
 *  `tmux master`), another vendor's spelling or no answer is not one. */
export function tmuxHasClientFeatures(versionText) {
  const m = /^tmux (\d+)\.(\d+)[a-z]*$/.exec(String(versionText ?? "").trim());
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > 3 || (major === 3 && minor >= 2);
}
/** The probe's answer per `exec`: one `tmux -V` per process for the real one, and a fresh probe
 *  for each fake a test injects. */
const clientFeatures = new WeakMap();

export function prepareSessionViewer(target, { exec = execFileSync, detachKey } = {}) {
  if (detachKey !== undefined) requireDetachKey(detachKey);
  if (!inspectSessionTarget(target, { exec }).present) throw new Error("session no longer exists");
  // UTF-8 mode (-u) like the shared session helper: a service without a
  // UTF-8 locale (launchd) otherwise mangles tmux output.
  // Each call in a session and process group of its own (`detached`): a hang-up, termination or
  // interrupt sent to the attach's group (a pty hang-up once a wrapping shell has died, a C-c)
  // must not kill a call in flight, the cleanup's kill-session first of all (#1243). The client the
  // attach spawns is not one of these: it stays in the terminal's foreground group.
  const run = (args) => exec("tmux", ["-u", "-S", target.socket, ...args], {
    encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"], detached: true,
  }).trim();
  const swept = sweepViewers(run);
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
    // When the agent's window ends (a retire), the viewer has no window left and tmux destroys it.
    // The viewer's client must then leave, not be moved: under an operator's `detach-on-destroy off`
    // tmux would switch it to another session, another agent's terminal (#1237).
    run(["set-option", "-t", viewer, "detach-on-destroy", "on"]);
    run(["unbind-key", "-a", "-q", "-T", table]);
    for (const binding of MOUSE_BINDINGS) run(["bind-key", "-T", table, ...binding]);
    // The key is its own argv element, after the grammar admitted it.
    if (detachKey !== undefined) {
      run(["bind-key", "-T", table, detachKey, DETACH_BINDING]);
      // The table goes when the session does, however the session ended; no other index is touched.
      run(["set-hook", "-g", `session-closed[${VIEWER_CLOSED_HOOK_INDEX}]`, VIEWER_CLOSED_HOOK]);
    }
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
    // Synchronized output (DEC 2026) for this client alone, the tmux client's own option, before the
    // command and after the socket (every viewer call starts `-u -S <socket>`): tmux then wraps each redraw in ESC[?2026h … ESC[?2026l, and a terminal that gets
    // one in two reads does not paint the half-drawn state (#1193). A terminal without the mode
    // ignores it. tmux before 3.2 has no -T, and a probe that fails leaves it out: never the
    // attach's failure.
    if (!clientFeatures.has(exec)) {
      let sync = false;
      try { sync = tmuxHasClientFeatures(run(["-V"])); } catch { /* no answer: today's client */ }
      clientFeatures.set(exec, sync);
    }
    const features = clientFeatures.get(exec) ? ["-T", "sync"] : [];
    // The client sets destroy-unattached itself, after its attach succeeded (a command chained after
    // attach-session runs only then; set earlier, it would destroy the session before the client
    // came): the server then removes the viewer when its last client goes, however the client went,
    // a SIGKILL of the attach and its client included.
    const attach = ["attach-session", "-t", `=${viewer}`, ";", "set-option", "-t", `=${viewer}:`, "destroy-unattached", "on"];
    return { binary: "tmux", args: ["-u", "-S", target.socket, ...features, ...attach], env, cleanup, detached, session: viewer, swept };
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
 *  SESSION_DETACHED_EXIT when `detachKey` was given and ended the attach. `onSwept` is given what
 *  the preparation swept, `{ sessions, tables }`, before the client starts. */
export async function attachSessionTarget(target, { detachKey, onSwept } = {}) {
  if (detachKey !== undefined) { requireDetachKey(detachKey); holdQuit(); }
  // HUP, TERM and INT are held from before the viewer session exists until its cleanup has
  // finished: one that arrives in between, early or late, finds a listener and not the default
  // action, which would end Node with the session left on the agents' server (#1243). Node runs
  // the listener only between synchronous runs, so it may find no viewer yet, or no client.
  let viewer = null;
  let child;
  let stopped = false;
  let quit = false;
  const stop = () => { stopped = true; viewer?.cleanup(); child?.kill(); };
  const signals = ["SIGHUP", "SIGTERM", "SIGINT"];
  for (const sig of signals) process.on(sig, stop);
  // A preparation that fails has already removed what it made.
  try { viewer = prepareSessionViewer(target, { detachKey }); }
  catch (e) { for (const sig of signals) process.removeListener(sig, stop); throw e; }
  // Until the client has exited, a QUIT stops the attach as the other signals do, with status 1.
  // Unless the key's binding has already run: then the client is on its way out, the QUIT is the
  // key pressed again, and the attach ends as a detach.
  if (detachKey !== undefined) onQuit = () => { if (viewer.detached()) return; quit = true; stop(); };
  try {
    // Inside the try: a report that throws (a closed stderr) still has the viewer removed.
    onSwept?.(viewer.swept);
    // A signal received during the synchronous preparation is dispatched only in a poll phase of
    // the event loop. Two setImmediate hops run at least one, wherever this attach was called
    // from, so such a signal stops the attach here, before a client takes the terminal: one loop
    // turn per attach. Stopped by then, the viewer ended without the key, and with no client to
    // set the marker a keyed viewer answers 0 too; a QUIT answers 1, as it does with a client.
    for (let hop = 0; hop < 2; hop++) await new Promise((resolve) => setImmediate(resolve));
    if (stopped) return quit ? 1 : 0;
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
    viewer.cleanup();
    // Only now: a HUP, TERM or INT that arrived during the cleanup was taken by the listener, and
    // its calls, in groups of their own, ran to the end. The status stands.
    for (const sig of signals) process.removeListener(sig, stop);
  }
}
