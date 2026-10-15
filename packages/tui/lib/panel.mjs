// An agent's terminal in a panel beside the list. The kernel's viewer (`oats session attach`, a
// node process that runs a tmux client attached to the agent's own tmux server) runs in a pane of
// a PRIVATE tmux server that this TUI run owns; the TUI keeps ONE control-mode client of that
// server for the run, captures the pane when tmux says it changed, and sends the keys to it.
// This is the only module of the TUI that runs tmux. It knows nothing of rows, keys or views: the
// caller hands it the viewer's argv, a size and the bytes to type, and it hands back screens (built
// by the caller's own cell builder) and the end of each viewer.
//
// THE SERVER. Its socket is `<run dir>/tmux`, in the run's private directory (0700, made by the
// caller's `dir()`, shared with the reader). Every call is `tmux -u -f /dev/null -S <socket> …`
// with TMUX and TMUX_PANE removed from the environment it gets, so it reads neither the user's
// configuration nor their default server, and never mistakes itself for a client nested in the
// pane the TUI runs in. `-f` matters only to the call that starts the server, and is on every call
// so that no call can ever start one that reads a configuration. The first open writes
// `<run dir>/owner.json` ({ tool, pid, started }), which is what lets a later run's sweep (below)
// tell a directory left by a crashed run from anything else.
//
// ONE SESSION, A KEEPER AND ONE WINDOW PER VIEWER. A control client hears `%output` only for the
// panes of the session it is attached to, and a session ends with its last window: so the session
// is made with a keeper window (never typed to; see THE KEEPER), and each viewer is a window of it, sized by
// `default-size` before it is made (the viewer starts at its size) and by `resize-window` after,
// which sets that window's own `window-size` to manual. The control client never sizes a window
// (it never says its size: tmux ignores the size of a control client that has not sent
// `refresh-client -C`). The GLOBAL `window-size` is left alone: set to manual, tmux 3.3a to 3.5a
// crash in the next `new-window` (resize.c clients_calculate_size reads the window's manual size
// before the window exists), as CI's tmux 3.4 did.
//
// THE START, ONE PROCESS. The control client starts the server itself: `tmux -C new-session …`,
// with `set-option -s exit-unattached on` and the other options in the SAME command list. The
// order matters. `exit-unattached` set before any client is attached ends the server at once (the
// spike's trap), so it must come after the attach; but a server started on its own (`new-session
// -d`) and attached afterwards lives, keeper and all, with nothing to end it, if the TUI is killed
// between the two (round 1 of the review). Here the client that starts the server is attached by
// that very `new-session`, the list then turns `exit-unattached` on, and that client is a process of
// its own (its own process group): a TUI killed at any moment of the start closes the client's
// stdin, the client ends, and the server ends with its last client. Verified with tmux 3.7c: the
// starter's stdin closed 0, 5 and 30 ms after the spawn left no server. The first blocks the
// client prints are the answers to that list, one per command.
//
// THE KEEPER WATCHES THE TUI. The stdin EOF is not enough on its own. Found with tmux 3.7c: a
// control client whose reader has gone while the server still has output queued for it is never
// ended. tmux keeps the client until its output has drained, which it no longer can, and so never
// acts on the EOF; the client stays attached, `exit-unattached` never fires, and the server lives
// on, viewers and all. A TUI killed during the start (the server is writing the start's blocks)
// always hits it, and one killed while an agent prints often does. So the keeper window watches
// the TUI itself: the run's FIFO `<run dir>/alive`, whose write end the TUI holds for the run
// (O_CLOEXEC, in no child's stdio). The keeper (KEEPER_SCRIPT) opens the FIFO, reads it until no
// writer is left, and then kills the server (SIGKILL: a server ends only when its clients are gone,
// and the stuck one never is). THE ORDER: the TUI makes the FIFO and
// holds its write end BEFORE it starts the server, so a keeper that finds no writer always means
// "the TUI is gone", never "not yet". A TUI that is stopped (Ctrl+Z) still holds it: nothing is
// killed. A normal end sends `kill-server` itself first, which ends the keeper with its pane
// before the TUI lets go of the FIFO; a keeper that still woke would find its server gone, and do
// nothing.
//
// WHAT STARTS A PROCESS: the FIFO's `mkfifo` (once a run), the start of the server (the control
// client, spawned) and the making of a window (execFile), each with argv and no shell, and nothing
// else. A frame never does: every capture, key, resize and close goes through the control client,
// as a command of constant text and tmux's own ids.
//
// THE ARGV OF A COMMAND IS NOT TEXT TO TMUX, BUT FOR ONE RULE. Verified with tmux 3.7c: new-window
// passes its command's arguments to the program as they are (no format is expanded in them or in
// an `-e` value, nothing is re-parsed: `#{pane_id}`, `'`, `$HOME`, `$(…)`, spaces, a newline, `{`,
// a leading `-` all arrive intact), EXCEPT that tmux reads an argument that ENDS in `;` as the end
// of a command, so `x;` followed by `kill-server` would be a second command. `tmuxArgument` writes
// such an argument as `x\;`, which tmux reads back as `x;` (cmd-parse.y, the same since 3.0).
// Every argument that is not a constant of this file goes through it.
//
// THE END OF A RUN. A normal end calls end(): `kill-server`, then the socket, owner.json, the FIFO
// and the view files are removed (the run directory is the loop's to remove, after this). On a
// crash or a `kill -9` of the TUI nothing here runs, and nothing needs to: the FIFO loses its
// writer, the keeper kills the server (THE KEEPER), and the control client, whose server is gone,
// exits; the viewers' panes hang up, so each viewer gets SIGHUP and runs its own clean-up. What is
// left is the run directory with its socket, owner.json and FIFO, which the next run's sweep
// removes.
import { execFile as nodeExecFile, execFileSync as nodeExecFileSync, spawn as nodeSpawn } from "node:child_process";
import { closeSync, constants as FS, fstatSync, lstatSync, openSync, readSync, readdirSync, rmdirSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";

/** How many terminals a run may hold open at once in the next version. This version opens one at
 *  a time: `open` refuses while one is open (E_PANEL_BUSY). */
export const MAX_TERMINALS = 4;
/** The most of a viewer's stderr that is kept, in bytes: the last ones. */
export const STDERR_KEPT = 4096;
/** The frame tick, in milliseconds: a capture follows the output that asked for it by one tick, so
 *  a burst of output is drawn once, and there are at most 60 captures a second. */
export const FRAME_MS = 16;
/** The pane's command around the viewer, a CONSTANT: run the viewer (`"$0" "$@"`: its argv, which
 *  follows this script as arguments and is never part of it), its stderr to the file named by E,
 *  then its exit status to the file named by S. A viewer ended by a signal (a killed pane hangs up
 *  its terminal) ends this shell with it, and S stays empty. */
export const VIEW_SCRIPT = '"$0" "$@" 2>"$E"; echo $? >"$S"';
/** The one session of the private server, and its keeper window's command. */
export const SESSION = "oats-tui";
/** The keeper's command (see THE KEEPER), a constant run as `sh -c KEEPER_SCRIPT oats-tui-keeper
 *  <fifo>`: the FIFO's path is argv, never text of the script. `3<>` opens the FIFO read-write,
 *  which never waits for a writer; `4<` then opens it for reading, at once since fd 3 is a writer;
 *  closing 3 leaves the TUI's as the only writer. `cat` returns when no writer is left (at once if
 *  the TUI is already gone). Then the keeper SIGKILLs its parent, the server: `kill-server` or
 *  SIGTERM would not do, since a server ends only once its clients are gone, and the client tmux
 *  cannot drain is never gone. The kernel then closes every pane's terminal, so each viewer gets
 *  SIGHUP and cleans up, and the control client, its server gone, exits. The parent is killed only
 *  while it is still the keeper's parent: a keeper whose server has ended is reparented, and its
 *  `$PPID` may name another process by then. The parent now is read from `/proc/$$/stat` where
 *  there is one (field 4, after the `) ` that ends the command name, which may itself hold one),
 *  else from `ps -o ppid= -p $$` (macOS). FAIL SAFE: when neither names it (no /proc, and no ps or
 *  one that refuses `-p`, as BusyBox's does), nothing is killed, and the server is left to the
 *  stdin EOF alone (docs/tui.md says what that can leave). `read` and `kill` are the shell's own:
 *  a PATH without them does not matter. All of it quietly. */
export const KEEPER_SCRIPT = 'exec 3<>"$1" 4<"$1" 3>&-; cat <&4 >/dev/null; exec >/dev/null 2>&1; p=; if [ -r /proc/$$/stat ]; then read -r s </proc/$$/stat; set -- ${s##*) }; p=$2; else set -- $(ps -o ppid= -p $$); p=$1; fi; [ -n "$p" ] && [ "$p" -eq "$PPID" ] && kill -KILL "$PPID"';
/** The command list the control client starts the server with (see THE START above): the session
 *  with its keeper, attached; `exit-unattached` at once after it; then every option. `unbind-key
 *  -a` empties the prefix table only: the root table (mouse bindings by default) and the
 *  copy-mode tables are emptied by name. No key typed into a pane is read through a table anyway
 *  (send-keys without -K writes to the pane), and no pane ever enters a mode: this leaves the
 *  server nothing to do with a key but type it. -> [[command…]…] */
export const startCommands = ({ alive }) => [
  ["new-session", "-s", SESSION, "-x", "80", "-y", "24", "/bin/sh", "-c", KEEPER_SCRIPT, "oats-tui-keeper", tmuxArgument(alive)],
  ["set-option", "-s", "exit-unattached", "on"],
  ["set-option", "-s", "escape-time", "0"],
  ["set-option", "-g", "status", "off"],
  ["set-option", "-g", "prefix", "None"],
  ["set-option", "-g", "prefix2", "None"],
  ["set-option", "-gw", "remain-on-exit", "off"],
  ["unbind-key", "-a"],
  ["unbind-key", "-a", "-T", "root"],
  ["unbind-key", "-a", "-T", "copy-mode"],
  ["unbind-key", "-a", "-T", "copy-mode-vi"],
];
/** The most of what a control client that did not start printed on stderr that is kept. */
const DETAIL_KEPT = 400;
/** The names this module makes in the run directory, and the pattern of a view file. */
const SOCKET_NAME = "tmux", OWNER_NAME = "owner.json", OWNER_TOOL = "oats-tui", ALIVE_NAME = "alive";
const VIEW_FILE = /^[1-9][0-9]*\.view\.(err|status)$/;
/** The oldest tmux this module knows to have every command it uses (`refresh-client -f`). */
const MIN_TMUX = Object.freeze([3, 2]);
/** The limits of a call that starts or opens something; of the `kill-server` on the way out (which
 *  runs in the exit path, synchronously); of the sweep's one look at a socket. */
const CALL_TIMEOUT_MS = 5000, END_TIMEOUT_MS = 1000, SWEEP_TIMEOUT_MS = 1000;
const CALL_MAX_BUFFER = 64 * 1024;
/** The most bytes of keys one `send-keys` carries. */
const INPUT_CHUNK = 256;
/** The sweep looks at no more run directories than this in one run. */
const SWEEP_MAX = 32;
/** Bracketed paste's two marks, as bytes (CSI 200 ~ and CSI 201 ~). Only term/screen.mjs and
 *  term/tty.mjs write an escape byte in a string; here the marks are numbers sent as hex. */
const PASTE_START = Buffer.from([0x1b, 0x5b, 0x32, 0x30, 0x30, 0x7e]);
const PASTE_END = Buffer.from([0x1b, 0x5b, 0x32, 0x30, 0x31, 0x7e]);

/** A step that must not stop the ones after it: a child, a stream or a file that is already gone. */
const quietly = (act) => { try { return act(); } catch { return undefined; } };
/** A refusal the caller can tell from another by its `code`. */
const refusal = (code, message, facts = {}) => Object.assign(new Error(message), { code, ...facts });
/** An argument tmux will hand on as it is (see the head of this file): a trailing `;` escaped. */
export const tmuxArgument = (text) => (text.endsWith(";") ? `${text.slice(0, -1)}\\;` : text);
/** The environment of every tmux call: the one given, without TMUX and TMUX_PANE. */
function tmuxEnvironment(env) {
  const { TMUX: _client, TMUX_PANE: _pane, ...rest } = env ?? {};
  return rest;
}
/** A size tmux is told: a whole number of cells, at least 1; anything else is `fallback`. */
const cells = (n, fallback) => (Number.isInteger(n) && n > 0 ? Math.min(n, 10_000) : fallback);
/** Bytes as tmux's `send-keys -H` takes them: two hex digits each, separated by spaces. */
const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
/** Whether a `tmux -V` answer names a version older than MIN_TMUX. A name without a version
 *  (a build from the repository says `master` or `next-…`) is taken as new enough. */
function tooOld(answer) {
  const found = /(\d+)\.(\d+)/.exec(String(answer));
  if (!found) return false;
  const [major, minor] = [Number(found[1]), Number(found[2])];
  return major < MIN_TMUX[0] || (major === MIN_TMUX[0] && minor < MIN_TMUX[1]);
}

/** What this module does to the file system, each replaceable by a test.
 *  `make(path)` makes an empty file for one writer (0600, refused if it is there); `write(path,
 *  text)` makes one and writes `text`; `head(path, max)` and `tail(path, max)` read at most `max`
 *  bytes from its start or its end, as text (a tail that begins inside a UTF-8 character drops the
 *  bytes of that character); `lstat`, `list` (names in a directory), `unlink`, `rmdir`. */
export const PANEL_FS = Object.freeze({
  make: (path) => closeSync(openSync(path, "wx", 0o600)),
  write: (path, text) => {
    const fd = openSync(path, "wx", 0o600);
    try { writeSync(fd, text); } finally { quietly(() => closeSync(fd)); }
  },
  /** The write end of the FIFO at `path` (see THE KEEPER): opened through a reader of its own, so
   *  it never waits, and only once fstat says it is a FIFO. -> fd. Node opens every fd O_CLOEXEC. */
  hold: (path) => {
    const reader = openSync(path, FS.O_RDONLY | FS.O_NONBLOCK);
    try {
      if (!fstatSync(reader).isFIFO()) throw refusal("E_PANEL_START", "the panel's liveness mark is not a FIFO");
      return openSync(path, FS.O_WRONLY);
    } finally { quietly(() => closeSync(reader)); }
  },
  release: (fd) => closeSync(fd),
  head: (path, max) => readPart(path, max, false),
  tail: (path, max) => readPart(path, max, true),
  lstat: (path) => lstatSync(path),
  list: (path) => readdirSync(path),
  unlink: (path) => unlinkSync(path),
  rmdir: (path) => rmdirSync(path),
});
function readPart(file, max, fromEnd) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size, start = fromEnd ? Math.max(0, size - max) : 0, room = Math.min(size - start, max);
    const buffer = Buffer.alloc(room);
    let got = 0;
    while (got < room) { const n = readSync(fd, buffer, got, room - got, start + got); if (n === 0) break; got += n; }
    let from = 0;
    if (start > 0) while (from < Math.min(3, got) && (buffer[from] & 0xc0) === 0x80) from++;
    return buffer.subarray(from, got).toString("utf8");
  } finally { quietly(() => closeSync(fd)); }
}

/** The panel of a run: the private server, its control client and the viewer open in it.
 *  -> { open, close, resize, input, paste, setVisible, refresh, pause, resume, end, get current }
 *
 *  Options:
 *    dir()        the run's private directory: called at the first open, and expected to answer
 *                 the same path every time (the caller makes it once and remembers it). This
 *                 module never makes it and never removes it.
 *    capture(text, { cols, rows })  REQUIRED: the caller's cell builder, handed what
 *                 `capture-pane -p -e -N` printed (its lines joined by "\n") and the pane's size;
 *                 what it answers is handed on as `screen`.
 *    onScreen({ id, screen, cursor: { x, y, visible } })  a capture of the open viewer.
 *    onClosed({ id, status, stderr, asked })  a viewer ended: `status` the integer its status
 *                 file holds (null when it holds none: a signal ended the viewer, or its server
 *                 went away), `stderr` the last STDERR_KEPT bytes it wrote there, as text, `asked`
 *                 true when close() ended it. Called once per viewer, never for one still open
 *                 at end(), and never before its open() has resolved.
 *    env          the environment tmux is given (TMUX and TMUX_PANE removed); default process.env.
 *    tmux         the program; default "tmux" on PATH.
 *    spawn, execFile, execFileSync, fs (see PANEL_FS), timers ({ setTimeout, clearTimeout }: the
 *                 frame tick, the only timer of this module), clock (an ISO time, for
 *                 owner.json), pid (the TUI's, for owner.json): for tests.
 *  A callback that throws does not break the panel: what it threw is thrown again in a microtask,
 *  where the run hears it as any uncaught error.
 *
 *  open({ argv, cols, rows }) -> Promise<{ id }>: start the viewer `argv` ([node, bin, ...args],
 *    the kernel's `oats session attach …`) in a new window of cols x rows. `id` is tmux's window id.
 *    The first open starts the server; so does the first after the server went away. Rejected with
 *    a coded Error: E_PANEL_BUSY (a viewer is open, or an open is under way: the caller closes it
 *    first, and may open the next as soon as close() has returned),
 *    E_PANEL_TMUX (no tmux, or one older than 3.2), E_PANEL_START (the server or its control
 *    client did not start; `detail` holds what tmux said, untrusted text), E_PANEL_OPEN (the
 *    window was not made; `detail` likewise, or a bad argv), E_PANEL_ENDED (after end()).
 *  close(): end the open viewer (`kill-pane`: its terminal hangs up, the viewer gets SIGHUP and
 *    cleans up after itself). THE SLOT IS FREE WHEN IT RETURNS: the next open may follow at once,
 *    and the closed viewer is reported by onClosed with `asked: true` when its window has ended.
 *    Asked while an open is under way, that open still answers its `{ id }`, and its window is
 *    killed as soon as it exists (reported likewise). With no viewer and no open, nothing.
 *  resize(cols, rows): the window's new size, then a fresh capture.
 *  input(bytes): bytes (a Buffer, or a string as UTF-8) typed into the viewer, in order. With no
 *    viewer window yet (an open under way) or none at all, they are dropped.
 *  paste(text): `text` as a bracketed paste (any end mark inside it removed); the agent's own
 *    server decides whether its program sees the marks (the viewer is a tmux client).
 *  setVisible(on): hidden, no capture runs and output only marks the screen stale; shown again,
 *    one fresh capture. refresh(): one fresh capture now (after `fg`, Ctrl+L).
 *  pause() / resume(): around a suspend of the TUI: tmux stops sending the pane's output (a
 *    stopped TUI does not read its pipe), then sends it again, and a fresh capture follows.
 *  end(): leave, synchronously: kill the server, end the control client, remove the socket,
 *    owner.json and the view files. Idempotent.
 *  current: the id of the open viewer, or null.
 *  No method but open() throws or rejects: a server that went away makes each of them do nothing. */
export function createPanel({ dir, capture, onScreen = () => {}, onClosed = () => {}, env = process.env, tmux = "tmux",
  spawn = nodeSpawn, execFile = nodeExecFile, execFileSync = nodeExecFileSync, fs: givenFs = {}, timers = { setTimeout, clearTimeout },
  clock = () => new Date().toISOString(), pid = process.pid } = {}) {
  if (typeof dir !== "function") throw new TypeError("createPanel needs dir(): the run's private directory");
  if (typeof capture !== "function") throw new TypeError("createPanel needs capture(text, { cols, rows }): the cell builder");
  const fs = { ...PANEL_FS, ...givenFs };

  /** The run directory and the socket in it, once known; whether owner.json was written, tmux's
   *  version checked, and a server ever started in this run. */
  let runDir = null, socket = null, ownerWritten = false, checked = false, everStarted = false;
  /** The write end of `<run dir>/alive`, held for the run once made (see THE KEEPER), or null. */
  let aliveFd = null;
  /** The server now: { child, replies (the FIFO of commands waiting for their block), block (the
   *  block being read), startLeft (the blocks of the start list still to come), attached, gone,
   *  onAttach, stderr }, or null. A start under way is `starting` (its promise). */
  let server = null, starting = null;
  /** THE SLOT: the viewer open now ({ id, pane, cols, rows, files, asked, over }), or the open
   *  under way that will be it (`opening`: { closeAsked, files }), or neither. close() frees it at
   *  once: the viewer it closed waits in `closing` (window id -> viewer) for its window's end, and
   *  an open it gave up goes on to kill its window as soon as it exists. Every open under way, the
   *  given-up ones included, is in `openings`.
   *  `closedSeen`: the window ids whose end was heard while an open was under way. A viewer that
   *  exits at once can end before new-window has answered with its id; ids are never reused by a
   *  server, and the set is emptied when no open is under way, and at every new server. */
  let viewer = null, opening = null;
  const closing = new Map(), openings = new Set(), closedSeen = new Set();
  /** The frames: the screen is stale (`dirty`), a tick is armed (`tick`), a capture is in flight. */
  let dirty = false, tick = null, capturing = false, visible = true, paused = false;
  let ended = false, files = 0;

  /** A callback of the caller's, called so that what it throws cannot break the panel. */
  function tell(act) {
    try { act(); } catch (error) { queueMicrotask(() => { throw error; }); }
  }
  /** The flags every call starts with. */
  const base = () => ["-u", "-f", "/dev/null", "-S", socket];

  /** One tmux call that starts or opens something: argv, no shell, a time limit.
   *  -> Promise<{ stdout }>, rejected with execFile's error (its `stderr` added). */
  function call(args) {
    return new Promise((resolve, reject) => {
      try {
        execFile(tmux, [...base(), ...args], { env: tmuxEnvironment(env), timeout: CALL_TIMEOUT_MS, maxBuffer: CALL_MAX_BUFFER, encoding: "utf8", shell: false, windowsHide: true },
          (error, stdout, stderr) => (error ? reject(Object.assign(error, { stderr: String(stderr ?? "") })) : resolve({ stdout: String(stdout ?? "") })));
      } catch (error) { reject(error); }
    });
  }
  /** What tmux said, kept for the caller to show (through its own display filter): untrusted text. */
  const detail = (error) => String(error?.stderr || error?.message || "").slice(0, 400);

  // THE CONTROL CLIENT ---------------------------------------------------------------------------

  /** Ask the server one command through the control client: -> Promise<{ ok, lines }>, never
   *  rejected. `ok` is false for an `%error` block, and for every command still waiting when the
   *  server goes away. `command` is constant text with tmux's ids and numbers in it: never a
   *  newline, never the caller's text. */
  function ask(command) {
    const s = server;
    if (s === null || s.gone) return Promise.resolve({ ok: false, lines: [] });
    return new Promise((resolve) => {
      s.replies.push(resolve);
      try { s.child.stdin.write(`${command}\n`); } catch { lost(s); }
    });
  }

  /** One line the control client printed. Inside a block every line is the block's, until the
   *  `%end` or `%error` line that repeats its `%begin`'s time, number and flags EXACTLY: a pane's
   *  text is printed as it is inside a capture's block, and a line of it that looks like an end
   *  must not end the block (tmux prints the same time and number on both lines of a block; a
   *  pane would have to guess the second and the server's command number). Outside a block a line is
   *  a notification (tmux never prints one inside a block). The FIRST blocks, one per command of
   *  the start list, answer the start itself; every later one answers the oldest command waiting. */
  function heard(s, line) {
    if (s.block) {
      if (line === `%end ${s.block.head}` || line === `%error ${s.block.head}`) {
        const { lines, start } = s.block, ok = line.startsWith("%end ");
        s.block = null;
        // A command of the list that fails ends the list there: tmux runs none after it, so the
        // start is answered at once.
        if (start && !ok) s.startError = lines.join("\n").slice(0, DETAIL_KEPT);
        if (start) return ok && s.startLeft > 0 ? undefined : attached(s, ok);
        return void s.replies.shift()?.({ ok, lines });
      }
      return void s.block.lines.push(line);
    }
    if (line.startsWith("%begin ")) {
      s.block = { head: line.slice("%begin ".length), lines: [], start: s.startLeft > 0 };
      if (s.startLeft > 0) s.startLeft -= 1;
      return;
    }
    const [kind, first] = line.split(" ", 2);
    if (kind === "%output" || kind === "%extended-output") { if (viewer && first === viewer.pane) stale(); }
    else if (kind === "%layout-change") { if (viewer && first === viewer.id) stale(); }
    else if (kind === "%window-close" || kind === "%unlinked-window-close") windowClosed(first);
    else if (kind === "%exit") lost(s);
  }

  /** The start's blocks are over, or one failed: the start waits for this (see `ensureServer`). */
  function attached(s, ok) {
    const waiting = s.onAttach;
    s.onAttach = null;
    if (ok) s.attached = true;
    waiting?.(ok);
  }

  /** The control client is gone (`%exit`, its pipe closed, it did not start): the server with it,
   *  as far as this run is concerned. Every command waiting is answered as failed, the open viewer
   *  is closed with no status, and the next open starts a new server. */
  function lost(s) {
    if (s.gone) return;
    s.gone = true;
    if (server === s) server = null;
    for (const resolve of s.replies.splice(0)) resolve({ ok: false, lines: [] });
    if (s.onAttach) attached(s, false);
    // stderr is left to end with the process: a start that failed reads what tmux said on it.
    for (const stream of [s.child.stdin, s.child.stdout]) quietly(() => stream?.destroy());
    quietly(() => s.child.kill("SIGTERM"));
    quietly(() => s.child.unref());
    stopFrames();
    if (viewer) finish(viewer, { lost: true });
    for (const v of [...closing.values()]) finish(v, { lost: true });
  }

  /** Start the server through the control client, with startCommands as its list, and wait for
   *  the list's blocks (see THE START). -> { s, started: Promise<boolean> }: false when it did not
   *  start; what tmux said is in `s.startError` (the failed block's lines) or `s.stderr` (the
   *  client's own, when it ended without a block). */
  function connect() {
    const commands = startCommands({ alive: join(runDir, ALIVE_NAME) });
    const list = commands.flatMap((command, i) => (i === 0 ? command : [";", ...command]));
    const child = spawn(tmux, [...base(), "-C", ...list], { env: tmuxEnvironment(env), stdio: ["pipe", "pipe", "pipe"], detached: true, windowsHide: true });
    // `detached`: a process group of its own. The TUI's Ctrl+Z sends SIGTSTP to the TUI's group,
    // and a stopped control client would stop the panel with it.
    const s = { child, replies: [], block: null, startLeft: commands.length, attached: false, gone: false, onAttach: null, startError: "", stderr: "", closed: null };
    s.closed = new Promise((resolve) => child.once("close", resolve));
    let pending = Buffer.alloc(0);
    child.stdin?.on("error", () => lost(s));
    child.stdout?.on("error", () => lost(s));
    child.stderr?.on("error", () => {});
    child.stderr?.on("data", (chunk) => { if (s.stderr.length < DETAIL_KEPT) s.stderr = (s.stderr + chunk.toString("utf8")).slice(0, DETAIL_KEPT); });
    // Bytes, split on "\n"; each line decoded as UTF-8 by itself, so a character is never cut.
    child.stdout?.on("data", (chunk) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let at;
      while (!s.gone && (at = pending.indexOf(0x0a)) >= 0) {
        const line = pending.subarray(0, at).toString("utf8");
        pending = pending.subarray(at + 1);
        heard(s, line);
      }
    });
    child.once("close", () => lost(s));
    child.on("error", () => lost(s));
    server = s;
    const started = new Promise((resolve) => {
      s.onAttach = (ok) => resolve(ok);
      if (s.gone) attached(s, false);
    });
    return { s, started };
  }

  /** The server, started if there is none: -> Promise<server>, rejected with a coded Error.
   *  In order: the run directory and owner.json (once a run), tmux's version (once a run), a
   *  server left from an earlier start of this run killed (its control client ended without it),
   *  the FIFO the keeper watches made and its write end held (once a run, and always before any
   *  server: see THE KEEPER), and the server started by the control client with every option in
   *  its ONE command list (see THE START: why `exit-unattached` comes right after the session). */
  function ensureServer() {
    if (server && !server.gone && server.attached) return Promise.resolve(server);
    if (starting) return starting;
    starting = (async () => {
      try {
        if (runDir === null) {
          try { runDir = dir(); } catch (error) { throw refusal("E_PANEL_START", "the panel has no private directory", { detail: detail(error) }); }
          socket = join(runDir, SOCKET_NAME);
        }
        if (!ownerWritten) {
          try { fs.write(join(runDir, OWNER_NAME), `${JSON.stringify({ tool: OWNER_TOOL, pid, started: clock() })}\n`); } catch (error) { throw refusal("E_PANEL_START", "the panel could not mark its directory", { detail: detail(error) }); }
          ownerWritten = true;
        }
        if (!checked) {
          let answer;
          try { answer = await call(["-V"]); } catch (error) {
            throw error?.code === "ENOENT" ? refusal("E_PANEL_TMUX", "tmux is not installed") : refusal("E_PANEL_TMUX", "tmux did not say its version", { detail: detail(error) });
          }
          if (tooOld(answer.stdout)) throw refusal("E_PANEL_TMUX", "the panel needs tmux 3.2 or later", { detail: answer.stdout.trim().slice(0, 80) });
          checked = true;
        }
        if (ended) throw refusal("E_PANEL_ENDED", "the panel has ended");
        if (everStarted) await call(["kill-server"]).catch(() => {});
        if (aliveFd === null) {
          const alive = join(runDir, ALIVE_NAME);
          try {
            await new Promise((resolve, reject) => execFile("mkfifo", ["-m", "600", alive], { timeout: CALL_TIMEOUT_MS, shell: false, windowsHide: true }, (error) => (error ? reject(error) : resolve())));
            aliveFd = fs.hold(alive);
          } catch (error) {
            quietly(() => fs.unlink(alive));
            throw refusal("E_PANEL_START", "the panel could not make the mark its server watches", { detail: detail(error) });
          }
          if (ended) { quietly(() => fs.release(aliveFd)); aliveFd = null; quietly(() => fs.unlink(alive)); throw refusal("E_PANEL_ENDED", "the panel has ended"); }
        }
        everStarted = true;
        closedSeen.clear();
        // A start that fails part way (a command of the list answered with an error, the client
        // gone) may leave a server whose options are not all set: its client is ended and the
        // server killed, not left to linger.
        let s = null, ok = false;
        try {
          const start = connect();
          s = start.s;
          ok = await start.started;
        } catch { ok = false; }
        if (!ok) {
          if (s) {
            lost(s);
            // What tmux said comes on stderr, which may still be on its way when stdout said
            // `%exit`: the process's end is waited for (it was sent SIGTERM), bounded.
            await Promise.race([s.closed, new Promise((resolve) => setTimeout(resolve, END_TIMEOUT_MS).unref?.())]);
          }
          const said = (s?.startError.trim() || s?.stderr.trim()) ?? "";
          if (ended) throw refusal("E_PANEL_ENDED", "the panel has ended");
          await call(["kill-server"]).catch(() => {});
          throw refusal("E_PANEL_START", "the panel's tmux server did not start", said ? { detail: said } : {});
        }
        if (ended) throw refusal("E_PANEL_ENDED", "the panel has ended");
        return s;
      } finally { starting = null; }
    })();
    return starting;
  }

  // FRAMES ---------------------------------------------------------------------------------------

  /** Whether a capture may run now. */
  const showing = () => viewer !== null && !viewer.over && visible && !paused && !ended;
  /** Arm the tick, unless one is armed or a capture is in flight (it arms one when it is over). */
  function arm() {
    if (!showing() || tick !== null || capturing) return;
    tick = timers.setTimeout(() => { tick = null; startCapture(); }, FRAME_MS);
  }
  function stopFrames() {
    if (tick !== null) { quietly(() => timers.clearTimeout(tick)); tick = null; }
  }
  /** A notification said the screen changed: stale, and a capture one tick later. NO TIMER RUNS
   *  BUT THIS ONE: nothing is ever captured unless tmux said something changed, or the caller asked. */
  function stale() { dirty = true; arm(); }
  /** A capture now (or right after the one in flight), whatever the tick. */
  function fresh() {
    dirty = true;
    if (!showing() || capturing) return;
    stopFrames();
    startCapture();
  }
  /** A capture whose promise nobody awaits: it never rejects. */
  const startCapture = () => { captureNow().catch(() => { capturing = false; }); };
  /** One capture: the pane's cells and its cursor, asked through the control client in one go.
   *  At most one in flight; what was marked stale meanwhile arms the next tick after it. */
  async function captureNow() {
    const v = viewer;
    if (!showing() || capturing) return;
    capturing = true;
    dirty = false;
    const [screen, cursor] = await Promise.all([ask(`capture-pane -p -e -N -t ${v.pane}`), ask(`display -p -t ${v.pane} '#{cursor_x} #{cursor_y} #{cursor_flag}'`)]);
    capturing = false;
    if (ended || viewer !== v || v.over) return;
    // Hidden or paused while it was in flight: not drawn; the capture that showing again asks for is.
    if (!showing()) { dirty = true; return; }
    if (screen.ok && cursor.ok) {
      const at = /^(\d+) (\d+) ([01])$/.exec(cursor.lines[0] ?? "");
      const where = at ? { x: Number(at[1]), y: Number(at[2]), visible: at[3] === "1" } : { x: 0, y: 0, visible: false };
      tell(() => onScreen({ id: v.id, screen: capture(screen.lines.join("\n"), { cols: v.cols, rows: v.rows }), cursor: where }));
    }
    if (dirty) arm();
  }

  // VIEWERS --------------------------------------------------------------------------------------

  /** A window ended: the open viewer's, one closing, or (an open under way) one to remember. */
  function windowClosed(id) {
    if (viewer && viewer.id === id) return finish(viewer, {});
    if (closing.has(id)) return finish(closing.get(id), {});
    if (openings.size > 0) closedSeen.add(id);
  }
  /** A viewer is over: read what it left, remove its files, and say so. `lost`: its server went
   *  away, and whatever the status file holds says nothing of how it ended. */
  function finish(v, { lost: gone = false }) {
    if (v.over) return;
    v.over = true;
    closing.delete(v.id);
    if (viewer === v) free();
    const held = gone ? "" : quietly(() => fs.head(v.files.status, 32)) ?? "";
    const number = /^\s*(\d{1,3})\s*$/.exec(held);
    const stderr = quietly(() => fs.tail(v.files.err, STDERR_KEPT)) ?? "";
    forget(v.files);
    if (!ended) tell(() => onClosed({ id: v.id, status: number ? Number(number[1]) : null, stderr, asked: v.asked }));
  }
  /** The slot is free: no viewer, no frame to come. */
  function free() { viewer = null; stopFrames(); dirty = false; }
  const forget = (made) => { for (const path of [made?.err, made?.status]) if (path) quietly(() => fs.unlink(path)); };
  /** End a viewer the caller closed (or gave up while it opened): its pane killed through the
   *  control client, and its end awaited in `closing`. With no server, it is over now. */
  function kill(v) {
    v.asked = true;
    closing.set(v.id, v);
    if (!server || server.gone) return finish(v, { lost: true });
    ask(`kill-pane -t ${v.pane}`);
  }

  /** See createPanel. */
  function open({ argv, cols, rows } = {}) {
    if (ended) return Promise.reject(refusal("E_PANEL_ENDED", "the panel has ended"));
    if (viewer || opening) return Promise.reject(refusal("E_PANEL_BUSY", "a terminal is open in the panel"));
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((arg) => typeof arg === "string" && !arg.includes("\0"))) return Promise.reject(refusal("E_PANEL_OPEN", "the viewer's argv is not a list of strings"));
    const size = { cols: cells(cols, 80), rows: cells(rows, 24) };
    const mine = opening = { closeAsked: false, files: null };
    openings.add(mine);
    /** This open is no longer under way. */
    const settle = () => {
      openings.delete(mine);
      if (opening === mine) opening = null;
      if (openings.size === 0) closedSeen.clear();
    };
    return (async () => {
      try {
        const s = await ensureServer();
        if (ended) throw refusal("E_PANEL_ENDED", "the panel has ended");
        // The two files exist, 0600, BEFORE the window: the pane's shell only truncates them.
        const n = ++files, made = { err: join(runDir, `${n}.view.err`), status: join(runDir, `${n}.view.status`) };
        try { fs.make(made.err); mine.files = { err: made.err }; fs.make(made.status); mine.files = made; } catch (error) { throw refusal("E_PANEL_OPEN", "the panel could not make the viewer's files", { detail: detail(error) }); }
        let answer;
        try {
          answer = await call(["set-option", "-t", SESSION, "default-size", `${size.cols}x${size.rows}`,
            ";", "new-window", "-d", "-P", "-F", "#{window_id} #{pane_id}", "-t", `${SESSION}:`,
            "-e", tmuxArgument(`E=${made.err}`), "-e", tmuxArgument(`S=${made.status}`),
            "/bin/sh", "-c", VIEW_SCRIPT, ...argv.map(tmuxArgument)]);
        } catch (error) { throw refusal("E_PANEL_OPEN", "the panel could not open a window", { detail: detail(error) }); }
        const ids = /^(@\d+) (%\d+)\s*$/.exec(answer.stdout);
        if (!ids) throw refusal("E_PANEL_OPEN", "tmux did not name the window it opened");
        if (ended) throw refusal("E_PANEL_ENDED", "the panel has ended");
        const v = { id: ids[1], pane: ids[2], ...size, files: made, asked: false, over: false };
        mine.files = null; // the viewer's now: finish() removes them
        const already = closedSeen.has(v.id), gone = server !== s;
        settle();
        if (already || gone) {
          // Over before its id was known (it exited at once, or the server went away meanwhile):
          // said after open() has answered, so the caller knows the id onClosed names.
          v.asked = mine.closeAsked;
          if (!mine.closeAsked) viewer = v;
          else closing.set(v.id, v);
          setImmediate(() => finish(v, { lost: gone && !already }));
        } else if (mine.closeAsked) kill(v); // given up while it opened: killed at once
        else {
          viewer = v;
          ask(`resize-window -t ${v.id} -x ${v.cols} -y ${v.rows}`);
          fresh();
        }
        return { id: v.id };
      } catch (error) {
        settle();
        forget(mine.files);
        throw error;
      }
    })();
  }

  /** See createPanel. The slot is free when this returns. */
  function close() {
    if (ended) return;
    if (viewer) {
      const v = viewer;
      free();
      return kill(v);
    }
    if (opening) { opening.closeAsked = true; opening = null; }
  }

  function resize(cols, rows) {
    const v = viewer;
    if (ended || !v || v.over) return;
    v.cols = cells(cols, v.cols);
    v.rows = cells(rows, v.rows);
    ask(`resize-window -t ${v.id} -x ${v.cols} -y ${v.rows}`);
    fresh();
  }

  /** Bytes to the open pane, in commands of at most INPUT_CHUNK bytes, in order (one pipe, and
   *  tmux runs a client's commands in the order they came); their answers are consumed. */
  function send(bytes) {
    const v = viewer;
    if (ended || !v || v.over || !server || bytes.length === 0) return;
    for (let at = 0; at < bytes.length; at += INPUT_CHUNK) ask(`send-keys -t ${v.pane} -H ${hex(bytes.subarray(at, at + INPUT_CHUNK))}`);
  }
  function input(bytes) {
    try { send(Buffer.isBuffer(bytes) ? bytes : typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes ?? [])); } catch { /* nothing to type */ }
  }
  /** A bracketed paste. An end mark inside the text would end the paste early and let the rest act
   *  as keys: it is removed, and so is one that a removal makes by joining what was around it. One
   *  pass: the bytes are copied, and whenever what was copied ends in an end mark, it is taken back. */
  function paste(text) {
    try {
      const body = Buffer.from(String(text ?? ""), "utf8"), kept = Buffer.alloc(body.length), mark = PASTE_END.length;
      let n = 0;
      for (const byte of body) {
        kept[n++] = byte;
        if (n >= mark && byte === PASTE_END[mark - 1] && kept.subarray(n - mark, n).equals(PASTE_END)) n -= mark;
      }
      send(Buffer.concat([PASTE_START, kept.subarray(0, n), PASTE_END]));
    } catch { /* nothing to paste */ }
  }

  function setVisible(on) {
    if (ended) return;
    visible = on === true;
    if (!visible) stopFrames();
    else fresh();
  }
  function refresh() { if (!ended) fresh(); }

  /** `refresh-client -f no-output` (tmux 3.2): tmux keeps no pane output for this client while the
   *  TUI is stopped, so the pipe does not fill and tmux does not drop a client that falls behind.
   *  The other notifications (a window's end) still come, and are few. `!no-output` turns it off. */
  function pause() {
    if (ended || paused) return;
    paused = true;
    stopFrames();
    ask("refresh-client -f no-output");
  }
  function resume() {
    if (ended || !paused) return;
    paused = false;
    ask("refresh-client -f '!no-output'");
    fresh();
  }

  /** Kill this run's server, synchronously and bounded: it runs in the exit path. An end() that
   *  comes while the start is under way ends the starting client too (below), and a server it
   *  started ends with it (see THE START): nothing of a start is left to linger. */
  function endServer() {
    if (socket === null || !everStarted) return;
    quietly(() => execFileSync(tmux, [...base(), "kill-server"], { env: tmuxEnvironment(env), timeout: END_TIMEOUT_MS, stdio: "ignore", windowsHide: true }));
  }
  function end() {
    if (ended) return;
    ended = true;
    stopFrames();
    endServer();
    const s = server;
    server = null;
    if (s) {
      s.gone = true;
      for (const resolve of s.replies.splice(0)) resolve({ ok: false, lines: [] });
      if (s.onAttach) attached(s, false);
      quietly(() => s.child.stdin?.end());
      for (const stream of [s.child.stdin, s.child.stdout, s.child.stderr]) quietly(() => stream?.destroy());
      quietly(() => s.child.kill("SIGTERM"));
      quietly(() => s.child.unref());
    }
    // Nothing more is said: the run is leaving. Every viewer's files go, and so do those of an open
    // under way (which then rejects with E_PANEL_ENDED and makes nothing more).
    for (const v of [viewer, ...closing.values()]) if (v) { v.over = true; forget(v.files); }
    viewer = null;
    closing.clear();
    for (const under of openings) forget(under.files);
    if (runDir !== null) {
      quietly(() => fs.unlink(socket));
      if (ownerWritten) quietly(() => fs.unlink(join(runDir, OWNER_NAME)));
      // After kill-server: the keeper this wakes meets no server (see THE KEEPER).
      if (aliveFd !== null) { quietly(() => fs.release(aliveFd)); aliveFd = null; quietly(() => fs.unlink(join(runDir, ALIVE_NAME))); }
    }
  }

  return { open, close, resize, input, paste, setVisible, refresh, pause, resume, end, get current() { return viewer && !viewer.over ? viewer.id : null; } };
}

/** What the sweep reads and removes, each replaceable by a test (see PANEL_FS). */
const SWEEP_FS = PANEL_FS;

/** The sweep, once at the start of a run, before anything else: remove what a run that crashed
 *  left of its panel in the OS temp dir. -> { removed: [dir…] } (the directories emptied of the
 *  panel's files; each is then rmdir'd, which fails quietly when anything else is left in it, such
 *  as a reader's change output). Synchronous, bounded, never throws.
 *  It looks ONLY at entries of `tmpdir` named `oats-tui-*` that are directories (lstat: a link is
 *  not one), owned by `uid`, of mode exactly 0700, holding an owner.json (a regular file, owned by
 *  `uid`, small) whose `tool` is "oats-tui" and whose `pid` is a whole number. Such a directory is
 *  a dead run's when BOTH:
 *    its pid is not alive (signal 0 answers ESRCH; EPERM, or any other answer, counts as alive:
 *      the pid may have been taken by another process, and then the directory is left), and
 *    its socket refuses (`tmux -S <it> list-sessions` exits nonzero; no socket file counts as
 *      refusing; a socket that answers, a call that times out or cannot run, an entry `tmux` that
 *      is not a socket, all leave the directory alone).
 *  Then it removes the socket, owner.json, the FIFO `alive` (when it is one) and the panel's view
 *  files (`<n>.view.err`, `<n>.view.status`, by that exact pattern only), and rmdirs the directory.
 *  It NEVER sends `kill-server` or a signal (signal 0 only asks), and never looks at a socket
 *  outside such a directory, the user's default server, or the kernel's. At most `max` candidates
 *  (SWEEP_MAX) are looked at in one run, each tmux call with a short time limit.
 *  `kill` is process.kill's signature, `execFileSync` child_process's, `fs` as PANEL_FS: for tests. */
export function sweep({ tmpdir = osTmpdir(), uid = process.getuid?.(), pid = process.pid, env = process.env, tmux = "tmux",
  fs: givenFs = {}, execFileSync = nodeExecFileSync, kill = (target, signal) => process.kill(target, signal), max = SWEEP_MAX } = {}) {
  const removed = [];
  try {
    if (!Number.isInteger(uid)) return { removed };
    const fs = { ...SWEEP_FS, ...givenFs };
    const names = fs.list(tmpdir).filter((name) => typeof name === "string" && name.startsWith("oats-tui-")).sort().slice(0, max);
    for (const name of names) {
      const at = join(tmpdir, name);
      if (quietly(() => deadRun(at)) === true) {
        quietly(() => fs.unlink(join(at, SOCKET_NAME)));
        for (const entry of quietly(() => fs.list(at)) ?? []) {
          if (VIEW_FILE.test(entry) && quietly(() => fs.lstat(join(at, entry)).isFile())) quietly(() => fs.unlink(join(at, entry)));
        }
        if (quietly(() => fs.lstat(join(at, ALIVE_NAME)).isFIFO())) quietly(() => fs.unlink(join(at, ALIVE_NAME)));
        quietly(() => fs.unlink(join(at, OWNER_NAME)));
        quietly(() => fs.rmdir(at));
        removed.push(at);
      }
    }
    /** Whether `at` is a directory a dead run of this tool left (see above). Throws for anything
     *  that cannot be read: the caller leaves that directory. */
    function deadRun(at) {
      const stat = fs.lstat(at);
      if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o777) !== 0o700) return false;
      const ownerPath = join(at, OWNER_NAME), owner = fs.lstat(ownerPath);
      if (!owner.isFile() || owner.uid !== uid || owner.size > 4096) return false;
      const record = JSON.parse(fs.head(ownerPath, 4096));
      if (record?.tool !== OWNER_TOOL || !Number.isInteger(record.pid) || record.pid <= 0) return false;
      if (record.pid === pid || alive(record.pid)) return false;
      const sock = quietly(() => fs.lstat(join(at, SOCKET_NAME)));
      if (sock === undefined) return true; // no socket: nothing can answer
      if (!sock.isSocket()) return false;
      try {
        execFileSync(tmux, ["-u", "-f", "/dev/null", "-S", join(at, SOCKET_NAME), "list-sessions"], { env: tmuxEnvironment(env), timeout: SWEEP_TIMEOUT_MS, stdio: "ignore", windowsHide: true });
        return false; // it answers: a server lives there
      } catch (error) {
        return Number.isInteger(error?.status) && error.status !== 0; // it refused; a time limit or a tmux that cannot run says nothing
      }
    }
    function alive(target) {
      try { kill(target, 0); return true; } catch (error) { return error?.code !== "ESRCH"; }
    }
  } catch { /* a temp dir that cannot be listed: nothing to sweep */ }
  return { removed };
}
