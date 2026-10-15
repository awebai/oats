// The effects of the TUI: finding the deployment, the kernel's record, one exec for every kernel
// call, the observer of every served deployment, the roster of other machines, the refresh loop,
// the liveness collector, and the two looks at the file system the switcher needs.
// Every child of this module is a read, except the changes (a stop or retire apply, a start or a
// restart) that the shared callers start through `changeExec`: those are never ended by the TUI,
// and their output goes to two files of the run's own private directory, the only files this
// module writes. (Opening an agent's terminal starts the kernel's viewer, which is not a read and
// is not started here: it runs in a pane of the panel's private tmux server, lib/panel.mjs.)
// No function of this module decodes a kernel answer. Each one passes values between the shared
// functions (client.mjs), which decide what a roster, a row and a failed read are, once, for both
// clients: the TUI never writes "stopped" for a row and never builds the collector's input by hand.
import { execFile as nodeExecFile, spawn as nodeSpawn } from "node:child_process";
import { closeSync, fstatSync, lstatSync, mkdtempSync, openSync, opendirSync, readSync, realpathSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COLLECTOR, INSTANCE_VARIABLES, MAX_DEPLOYMENT_OBSERVATIONS, acceptProbe, cliDeploymentRead, cliReadsRemotes, cliRecord, cliRemoteRoster, createDeploymentObserver, createRefreshLoop, deploymentsInside, failedEntry, livenessAnswers, livenessInput, mapBounded, observeIdentities, observedEntry, panelInstances, parseProbeStdout, remoteRosterState, rosterRows, validateWorkspace } from "./client.mjs";

/** A path made canonical: what the shared start rule checks a local home with (session-start.mjs
 *  verifiedLocalHome). Throws for a path that cannot be resolved; the rule answers that as no home. */
export const realpath = (path) => realpathSync(path);

/** Whether a line may be written to `stream` on the way out: only when it is a terminal (a
 *  character device the stream says is one) or a file, by fstat of its descriptor. A closed
 *  descriptor, a pipe, a socket or anything else gets nothing. Never throws. */
export function tellable(stream) {
  try {
    const fd = stream?.fd;
    if (!Number.isInteger(fd) || fd < 0) return false;
    const stat = fstatSync(fd);
    return stat.isFile() || (stat.isCharacterDevice() && stream.isTTY === true);
  } catch { return false; }
}

/** The kernel this TUI shipped with: the absolute path of the install's own bin/oats.mjs, found by
 *  URL from this file. Every kernel call is `node <this path> …`, so the TUI depends on no shebang,
 *  no execute bit and no `PATH`, and never talks to another install's kernel. */
export const KERNEL_BIN = fileURLToPath(new URL("../../../bin/oats.mjs", import.meta.url));

/** How long the probe waits for `version --json`. */
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_MAX_BUFFER = 1024 * 1024;
/** The collector's limits: the Desktop's own for the same program. */
const COLLECTOR_TIMEOUT_MS = 30_000;
const COLLECTOR_MAX_BUFFER = 16 * 1024 * 1024;
/** The oldest remote observation the kernel may reuse for a cycle nobody asked for, in seconds. A
 *  cycle somebody asked for (the refresh key, the return from a suspend) is live: 0. */
const BACKGROUND_MAX_AGE = 60;

/** Delete each name of INSTANCE_VARIABLES from `env` itself: the process environment, in place.
 *  A TUI started in an agent's pane inherits that instance's variables, and a kernel command that
 *  runs with them answers for the instance instead of the directory it was asked about. The shared
 *  withoutInstanceVariables returns a copy and is not enough: every child of the TUI, the collector
 *  included, inherits the process environment. Nothing else is touched; `env` is returned. */
export function leaveInstance(env) {
  for (const name of INSTANCE_VARIABLES) delete env[name];
  return env;
}

/** A step that must not stop the ones after it: a child, a stream or a directory that is already gone. */
const quietly = (act) => { try { return act(); } catch { return undefined; } };

/** The filesystem the three functions below read when they are given none. findDeployment: one
 *  realpath and one stat of the start, then one lstat per directory. A symbolic link named
 *  oats-local.yaml is not a deployment's file (lstat does not follow it).
 *  `list(dir, limit)` is the look inside a folder the shared deploymentsInside asks for:
 *  -> { entries: [{ name, isDirectory }], limited }. It reads at most `limit` entries, and one more
 *  only to say whether the folder holds more (`limited`), so a folder of any size costs a bounded
 *  read. `isDirectory` is the entry's own type: a link to a directory is not a directory, and
 *  nothing is followed. It throws for a folder that cannot be opened; the shared function answers
 *  that as a folder that holds nothing. */
const DEPLOYMENT_IO = Object.freeze({
  realpath: (path) => realpathSync(path),
  isDirectory: (path) => statSync(path).isDirectory(),
  isDeployment: (dir) => lstatSync(join(dir, "oats-local.yaml")).isFile(),
  list: (dir, limit) => {
    const handle = opendirSync(dir), entries = [];
    try {
      for (let entry; entries.length < limit && (entry = handle.readSync());) entries.push({ name: entry.name, isDirectory: entry.isDirectory() });
      return { entries, limited: entries.length >= limit && handle.readSync() !== null };
    } finally { quietly(() => handle.closeSync()); }
  },
});

/** The deployment `start` is in: (start directory, io?) -> { ok: true, deployment } | { ok: false, dir }.
 *  `start` is made canonical (io.realpath), so a path given through a symbolic link names the
 *  directory it leads to. From there it walks up, the root included, asking the shared
 *  validateWorkspace at each directory; the first that answers is the deployment (its `.path`), so
 *  the nearest one wins. Nothing but existence is read from any directory: the content is the
 *  kernel's to read. A start that cannot be resolved, or that is not a directory, answers
 *  { ok: false, dir: start } without walking: the TUI does not guess a parent for a path that was
 *  mistyped. Outside every deployment `dir` is the canonical start. Never throws. */
export function findDeployment(start, io = {}) {
  const { realpath, isDirectory, isDeployment } = { ...DEPLOYMENT_IO, ...io };
  let dir;
  try { dir = realpath(start); if (typeof dir !== "string" || isDirectory(dir) !== true) return { ok: false, dir: start }; } catch { return { ok: false, dir: start }; }
  for (let at = dir; ; at = dirname(at)) {
    const found = validateWorkspace(at, { isDeployment });
    if (found) return { ok: true, deployment: found.path };
    if (dirname(at) === at) return { ok: false, dir };
  }
}

/** The deployments the switcher offers unasked: those directly inside `<home>/Agents` that this run
 *  does not serve. (home, served, io?) -> { offered: [{ path, name }], limited }.
 *  Which folders are deployments, their order and the limit of the look are the shared
 *  deploymentsInside's; this adds only what a run knows. Each path is made canonical (io.realpath)
 *  BEFORE it is compared with `served`, whose ids are canonical: a `~/Agents` reached through a
 *  link would otherwise offer a deployment the run already shows. One that cannot be resolved (it
 *  went away since the look) is left out, and so is a second folder that leads to the same place.
 *  `name` is the folder's name as it was listed, `path` the canonical one to admit. `limited` says
 *  the folder holds more entries than were read. Nothing is read from any deployment: an offered
 *  one is read when it is picked. Never throws: a missing or unreadable `~/Agents` offers nothing. */
export function offeredDeployments(home, served, io = {}) {
  try {
    const { realpath, isDeployment, list } = { ...DEPLOYMENT_IO, ...io };
    const inside = deploymentsInside(join(home, "Agents"), { list, isDeployment });
    const taken = new Set(served), offered = [];
    for (const listed of inside.paths) {
      const path = quietly(() => realpath(listed));
      if (typeof path !== "string" || taken.has(path)) continue;
      taken.add(path);
      offered.push({ path, name: basename(listed) });
    }
    return { offered, limited: inside.limited };
  } catch { return { offered: [], limited: false }; }
}

/** Whether `path` is a deployment NOW: (path, io?) -> { ok: true, deployment } | { ok: false }.
 *  Asked when an offered deployment is picked: the offer is as old as the last look, and the
 *  folder may have stopped being a deployment since. The path is made canonical (io.realpath) and
 *  the shared validateWorkspace is asked about that directory itself. Unlike findDeployment it
 *  walks nowhere: a folder that is no longer a deployment must not open the one above it in its
 *  place. `deployment` is the canonical path, the id a served deployment has. Never throws. */
export function admitDeployment(path, io = {}) {
  try {
    const { realpath, isDeployment } = { ...DEPLOYMENT_IO, ...io };
    const found = validateWorkspace(realpath(path), { isDeployment });
    return found ? { ok: true, deployment: found.path } : { ok: false };
  } catch { return { ok: false }; }
}

/** Run the kernel once with `version --json` and make its record:
 *  -> Promise<{ ok: true, cli } | { ok: false, reason }>, never rejected.
 *  The answer is read with the shared parseProbeStdout and judged by the shared acceptProbe; an
 *  accepted one becomes `cliRecord(payload, { bin, source: "tui" })`, the record every shared gate
 *  reads. `reason` is acceptProbe's own when it refused, and one of the TUI's four when there was
 *  no answer to judge. A nonzero exit or a timeout is a refusal even when stdout looks valid: a
 *  kernel that prints a record and then fails is not one to read with. The exec error's message,
 *  stderr and argv never reach `reason`; acceptProbe's reason quotes the payload's own fields, so
 *  the caller shows it as it shows any kernel text.
 *  NOT detached, unlike every later child: it runs before the terminal is taken, and a Ctrl+C then
 *  must end it with the TUI. `timeoutMs` is for tests. */
export function probeKernel({ bin = KERNEL_BIN, env = process.env, execFile = nodeExecFile, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return new Promise((done) => {
    const refuse = (reason) => done({ ok: false, reason });
    try {
      execFile(process.execPath, [bin, "version", "--json"], { timeout: timeoutMs, shell: false, encoding: "utf8", maxBuffer: PROBE_MAX_BUFFER, env }, (error, stdout) => {
        if (error) return refuse(typeof error.syscall === "string" && error.syscall.startsWith("spawn") ? "it did not start" : error.killed === true ? `it did not answer within ${timeoutMs / 1000} seconds` : "it failed");
        const payload = parseProbeStdout(stdout);
        if (!payload) return refuse("it answered something that is not a version record");
        const verdict = acceptProbe(payload);
        return verdict.ok ? done({ ok: true, cli: cliRecord(payload, { bin, source: "tui" }) }) : refuse(verdict.reason);
      });
    } catch { refuse("it did not start"); }
  });
}

/** Where a change's output goes (createReader `files`). `dir()` makes the run's private directory
 *  (mkdtemp: mode 0700, under the OS temp dir); `open` makes one file in it for the child alone
 *  (0600, refused if it is there); `read(path, max)` reads back at most `max` bytes and one more,
 *  only to say whether there was more (`over`). Exported for the tests, which find the directory by it. */
export const CHANGE_FILES = Object.freeze({
  dir: () => mkdtempSync(join(tmpdir(), "oats-tui-")),
  open: (path) => openSync(path, "wx", 0o600),
  close: (fd) => closeSync(fd),
  unlink: (path) => unlinkSync(path),
  remove: (dir) => rmdirSync(dir),
  read: (path, max) => {
    const fd = openSync(path, "r");
    try {
      const size = fstatSync(fd).size, room = Number.isFinite(max) ? Math.min(size, max + 1) : size;
      const buffer = Buffer.alloc(room);
      let got = 0;
      while (got < room) { const n = readSync(fd, buffer, got, room - got, got); if (n === 0) break; got += n; }
      const over = got > max;
      return { text: buffer.subarray(0, over ? max : got).toString("utf8"), over };
    } finally { quietly(() => closeSync(fd)); }
  },
});

/** A child that did not end well, as execFile reports one: the facts on an Error, and no text of the child's. */
const failure = (facts) => Object.assign(new Error("the child did not end with an answer"), facts);
/** A child the reader ended itself: its time limit, or the reader giving it up. As execFile's timeout. */
const ended = () => failure({ code: null, signal: "SIGTERM", killed: true });
/** What was thrown, as the message the shared rule takes for a read that threw. */
const said = (error) => String(error?.message ?? error);

/** The reader of a run: its cycles over every served deployment, the roster of other machines,
 *  their children, and the way out.
 *  -> { start(), request({ live }), touch(), voidInFlight(), exec, stop(), children() }
 *
 *  `cli` is probeKernel's record (`cli.bin` the absolute path of bin/oats.mjs). The reader keeps no
 *  answer of its own: what a run holds is the caller's store, asked for when it is needed.
 *    getServed()  the ids of the deployments this run serves, in order (canonical paths). Read
 *                 once, at the start of each cycle: a deployment that joins while a cycle runs is
 *                 read by the next one, and one that is not in the list is never read.
 *    getEntry(id) the entry the store holds for that deployment now.
 *    onEntry({ id, entry, number })  each deployment's entry of a cycle. The reader decides
 *                 nothing about a failed read (the shared failedEntry does). `number` is the
 *                 cycle's: it grows by one per cycle and is never reused, and every deployment of
 *                 one cycle answers under the same one, so a store can refuse an answer that
 *                 arrives out of order; a cycle that emits nothing leaves a gap.
 *    getRoster()  { remote: { remoteGroups, rosterAnswered, rosterFailure }, memory, notes }: what
 *                 the store holds of the other machines now, and its two Maps of identities.
 *    onRoster(event)  { collecting: true } when a roster read starts, and
 *                 { roster: { remote, memory, notes, at } } for each outcome taken (see `takeRoster`).
 *  `clock()` answers the time of a cycle as an ISO string, once per cycle. `now()` answers
 *  milliseconds and is read only for the roster's 15 seconds.
 *
 *  ONE EXEC FOR EVERY KERNEL CALL. The shared reader and observer run unchanged: they are handed an
 *  `exec` with execFile's signature that runs `node <bin> <argv…>` and remembers the child.
 *
 *  EVERY CHILD RUNS IN A SESSION OF ITS OWN (`detached: true`, and nothing else added). The
 *  terminal guard's suspend sends SIGTSTP to the whole foreground process group, so a child left in
 *  the TUI's group would be stopped with it, and a stopped read holds its timeout and its
 *  kernel-side work until `fg`. In its own session a read goes on while the TUI is stopped. A
 *  terminal's SIGHUP therefore no longer reaches it by itself: it is ended by the TUI on the way out.
 *  This is why the exec stands on `spawn` and not on node's execFile: execFile hands spawn a fixed
 *  list of options, `detached` is not one of them, and a child it starts stays in the TUI's group
 *  whatever it is asked. `run` below is the part of execFile's contract the shared readers use.
 *
 *  ENDING A CHILD: only a read is ever ended. The viewer of an opened agent runs in the panel's
 *  private tmux server (lib/panel.mjs), and is no child of the reader. A KERNEL CALL THAT CHANGES SOMETHING (kind "change", `changeExec`) IS
 *  NEVER SIGNALLED BY THE TUI: a stop killed while it waits leaves a marker that refuses every
 *  later stop, and a killed start leaves its lock (#889, #890). So every child is remembered with
 *  its kind, and only kind "read" is ever signalled.
 *
 *  `timers` are the loop's, the idle timer's and the children's time limits (for tests). `files`
 *  is where a change's output is written (for tests): `files.dir()` makes the run's private
 *  directory. */
export function createReader({ cli, getServed, getEntry, getRoster, onEntry, onRoster, env = process.env, clock = () => new Date().toISOString(), now = Date.now, spawn = nodeSpawn, timers = { setTimeout, clearTimeout }, collector = COLLECTOR, idleMs = 600_000, focusedMs = 5000, blurredMs = 30_000, rosterMs = 15_000, files = CHANGE_FILES }) {
  /** child -> { kind, exited, giveUp, asked } for a read, { kind: "change", label, letGo } for a
   *  change: every child that has not ended and was not ended (a read) or let go (a change).
   *  `asked`: a read the loop asked for itself (the preflight of an open, a plan read), which no
   *  cycle owns. */
  const remembered = new Map();
  /** The changes still running, whether or not this run still waits for them: child -> label. A
   *  change leaves it when it exits, and stays in it after stop() let it go. */
  const running = new Map();
  /** The run's private directory for the output of its changes, made at the first one. */
  let changeDir = null, changeCount = 0;
  let started = false, stopped = false, idleTimer = null;
  /** `counter` numbers the cycles. `epoch` moves when the cycles in flight are made void; `flight`
   *  is the epoch the cycle now running began in (the loop runs one at a time). `served` is what
   *  getServed() answered at the start of that cycle. */
  let counter = 0, epoch = 0, flight = 0, served = [];
  /** The roster of other machines. `rosterFlight` is the read in flight (a token of its own, so an
   *  answer knows whether it is still awaited), or null. `rosterEnded` is now() when the last read
   *  that was not given up ended, or null while none has. `gatedSaid`: a kernel that reads no
   *  other machine was answered for, which happens once in a run. */
  let rosterFlight = null, rosterEnded = null, gatedSaid = false;

  /** execFile for a child in a session of its own: start `node <args…>` detached, remember it, and
   *  call back once with `(error, stdout, stderr)` as execFile does. `error` is null after exit 0
   *  with no signal; else it carries `code` (the exit status, or the spawn error's code), `signal`
   *  and `killed`: `killed: true` when the time limit ended it, and
   *  `code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"` when it printed more than `maxBuffer` bytes. The
   *  other options go to spawn as they are, with `detached: true` added. Returns the child.
   *  The child is forgotten when it ends: `close`, `error` for one that did not start, or the
   *  moment the reader ends it. */
  function run(kind, args, { timeout = 0, maxBuffer = Infinity, encoding = "utf8", ...rest }, callback, { asked = false } = {}) {
    const child = spawn(process.execPath, args, { ...rest, detached: true });
    const printed = { stdout: "", stderr: "" }, record = { kind, exited: false, giveUp, asked };
    let over = false, severed = false, verdict = null, timer = null;
    function finish(error) {
      if (over) return;
      over = true;
      if (timer !== null) { timers.clearTimeout(timer); timer = null; }
      remembered.delete(child);
      callback(error, printed.stdout, printed.stderr);
    }
    /** End the child, once, and never wait for it. A child leads a process group of its own, so
     *  SIGTERM goes to the GROUP: what the kernel started dies with it. Only a child of kind "read"
     *  not yet seen to exit is signalled: after `exit` its pid is free to name another process, and
     *  so is its group's. Then, whatever its kind or state, its pipes are destroyed and it is
     *  unref'd and forgotten: a child that ignores the signal, or a grandchild that holds its pipe,
     *  keeps neither a cycle nor the process leaving. */
    function sever() {
      if (severed) return;
      severed = true;
      if (record.kind === "read" && !record.exited) {
        const group = Number.isInteger(child.pid) && child.pid > 1 && quietly(() => process.kill(-child.pid, "SIGTERM")) === true;
        if (!group) quietly(() => child.kill("SIGTERM"));
      }
      for (const stream of [child.stdout, child.stderr, child.stdin]) quietly(() => stream?.destroy());
      quietly(() => child.unref());
      remembered.delete(child);
    }
    /** The reader's own decision (stop(), voidInFlight()): end the child and answer for it now. */
    function giveUp(error) {
      if (over) return;
      sever();
      finish(error);
    }
    /** The child's own limit, in time or in size: end it now, and answer for it one turn of the
     *  event loop LATER. A process that was stopped past the limit runs its overdue timers before
     *  it hears the signal that it continues: answered at once, such a read would become an entry
     *  before voidInFlight() could be called for it. (node's execFile leaves the same room: it
     *  answers at `close`.) */
    function expire(error) {
      if (over || severed) return;
      verdict = error;
      sever();
      setImmediate(() => finish(error));
    }
    for (const name of ["stdout", "stderr"]) {
      const stream = child[name];
      if (!stream) continue;
      let bytes = 0;
      stream.setEncoding(encoding);
      stream.on("error", () => {});
      stream.on("data", (chunk) => {
        bytes += Buffer.byteLength(chunk, encoding);
        if (bytes > maxBuffer) expire(failure({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }));
        else printed[name] += chunk;
      });
    }
    child.once("exit", () => { record.exited = true; });
    child.once("close", (code, signal) => finish(verdict ?? (code === 0 && signal === null ? null : failure({ code, signal, killed: false }))));
    child.on("error", (error) => { if (!child.pid) finish(error); });
    if (timeout > 0) {
      timer = timers.setTimeout(() => { timer = null; expire(ended()); }, timeout);
      timer?.unref?.();
    }
    remembered.set(child, record);
    return child;
  }
  /** End the reads remembered: every one, or (`cycles`) only those a cycle or the roster started. */
  function endReads({ cycles = false } = {}) {
    for (const record of [...remembered.values()]) if (record.kind === "read" && !(cycles && record.asked)) record.giveUp(ended());
  }

  /** The exec handed to the shared readers: execFile's signature, for `node <bin> <argv…>` (see
   *  `run`). It throws where nothing may be started (after stop(), or for a cycle made void before
   *  its reads began); the shared reader answers that as a failed read, which such a cycle never
   *  emits. Where the options carry no environment the reader's own is put there: the shared
   *  roster read names none, and a child must see what leaveInstance left, whoever started it. */
  function exec(bin, argv, options, callback) {
    if (stopped || flight !== epoch) throw new Error("this read was given up before it started");
    return run("read", [bin, ...argv], options.env === undefined ? { ...options, env } : options, callback);
  }
  /** The exec of a read the loop asks for itself, outside every cycle: the preflight of an agent
   *  on another machine (`oats session inspect`, through the shared prepareRemoteTerm). The same
   *  child as a cycle's (kind "read", a session of its own, the reader's environment where the
   *  options name none, ended on every way out), not made void by voidInFlight(): the loop ends it
   *  through `signal`, which ends the child's whole group as the reader's own giving up does. A
   *  `signal` already aborted starts nothing. It throws after stop(). */
  function askedExec(bin, argv, { signal, ...options }, callback) {
    if (stopped) throw new Error("the reader has stopped");
    if (signal?.aborted) throw new Error("this read was given up before it started");
    const child = run("read", [bin, ...argv], options.env === undefined ? { ...options, env } : options, callback, { asked: true });
    if (signal) {
      const record = remembered.get(child);
      const abandon = () => record?.giveUp(ended());
      signal.addEventListener("abort", abandon, { once: true });
      child.once("close", () => signal.removeEventListener("abort", abandon));
    }
    return child;
  }
  /** THE EXEC OF A CHANGE: a stop or retire apply (the boundary's call with `detached: true`), a
   *  start or a restart (the shared cliStart's). execFile's signature for `node <bin> <argv…>`, in
   *  a session of its own, outside every cycle: it is never made void by voidInFlight() and never
   *  signalled, not by `sever`, not by stop(), not at a time limit (a `timeout` given is not
   *  armed: the shared callers end their wait, never the child). `options.label` is the caller's
   *  `{ verb, name }`, kept for the line after leaving (`changes()`), and is not passed on.
   *  ITS OUTPUT GOES TO FILES, NEVER TO A PIPE. Before the spawn two files are opened in the run's
   *  private directory (made once, mode 0700, under the OS temp dir) and given to the child as its
   *  stdout and stderr; stdin is `ignore`. The TUI's own copies are closed after the spawn. So
   *  whatever the TUI does (quits, is stopped, loses its terminal) the child can always write, and
   *  nothing it writes meets EPIPE or SIGPIPE. When the child closes, both files are read back,
   *  each bounded by `maxBuffer` (over it: ERR_CHILD_PROCESS_STDIO_MAXBUFFER, as a read answers),
   *  deleted, and the callback is called as execFile calls it, with text (UTF-8).
   *  It throws after stop(): nothing new starts on the way out. Returns the child. */
  function changeExec(bin, argv, { label = null, timeout: _never, maxBuffer = Infinity, encoding: _utf8, ...options }, callback) {
    if (stopped) throw new Error("the reader has stopped");
    if (changeDir === null) changeDir = files.dir();
    const number = ++changeCount, paths = { stdout: join(changeDir, `${number}.out`), stderr: join(changeDir, `${number}.err`) };
    const fds = {};
    try {
      for (const name of ["stdout", "stderr"]) fds[name] = files.open(paths[name]);
    } catch (error) {
      for (const name of ["stdout", "stderr"]) if (fds[name] !== undefined) { quietly(() => files.close(fds[name])); quietly(() => files.unlink(paths[name])); }
      throw error;
    }
    let child;
    try {
      child = spawn(process.execPath, [bin, ...argv], { ...(options.env === undefined ? { ...options, env } : options), stdio: ["ignore", fds.stdout, fds.stderr], detached: true });
    } finally {
      for (const name of ["stdout", "stderr"]) quietly(() => files.close(fds[name]));
    }
    const record = { kind: "change", label, letGo: false };
    let over = false;
    const forget = () => { for (const name of ["stdout", "stderr"]) quietly(() => files.unlink(paths[name])); };
    function finish(error) {
      if (over) return;
      over = true;
      remembered.delete(child);
      if (record.letGo) return; // stop() let it go: nobody waits for its answer any more
      const read = {};
      let verdict = error;
      for (const name of ["stdout", "stderr"]) {
        const taken = quietly(() => files.read(paths[name], maxBuffer));
        read[name] = taken?.text ?? "";
        if (taken?.over && verdict == null) verdict = failure({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
      }
      forget();
      callback(verdict ?? null, read.stdout, read.stderr);
    }
    child.once("exit", () => { running.delete(child); });
    child.once("close", (code, signal) => finish(code === 0 && signal === null ? null : failure({ code, signal, killed: false })));
    child.on("error", (error) => { if (!child.pid) { running.delete(child); finish(error); } });
    record.letItGo = () => { record.letGo = true; quietly(() => child.unref()); forget(); remembered.delete(child); };
    remembered.set(child, record);
    if (Number.isInteger(child.pid)) running.set(child, label);
    return child;
  }

  /** The shared observer, with the shared reader over this exec and no reader of the TUI's own: a
   *  failed read has the same reasons here as in the Desktop. It admits a deployment of the cycle
   *  now running and no other. */
  const observer = createDeploymentObserver({
    getContext: (id) => (served.includes(id) ? { deployment: id, cli, revision: 0 } : null),
    read: (kernel, options) => cliDeploymentRead(kernel, options, { exec, env }),
  });

  /** Run the collector with `input` on stdin: what it printed, or null when it exited nonzero, was
   *  ended by a signal, timed out, overflowed or did not start. Never rejected. A collector that
   *  dies before it read answers the write with EPIPE on stdin: heard, so it is not an uncaught
   *  exception. */
  function collect(input) {
    return new Promise((done) => {
      try {
        const child = run("read", [collector], { env, shell: false, timeout: COLLECTOR_TIMEOUT_MS, maxBuffer: COLLECTOR_MAX_BUFFER, encoding: "utf8" },
          (error, stdout) => done(error || typeof stdout !== "string" ? null : stdout));
        child.stdin?.on("error", () => {});
        child.stdin?.end(input);
      } catch { done(null); }
    });
  }

  /** One outcome of the roster read into what the caller holds: the shared rule, called once per
   *  outcome, with the Desktop's two `catch`es (remote-roster.mjs says why a caller has them).
   *  `outcome` is { gated: true }, { envelope } for what the read resolved to, or { thrown } for a
   *  read that was rejected; `at` is the time of the cycle that began the read.
   *  What an answer makes of the groups held is remoteRosterState's; the groups it reports go to
   *  the memory of identities (observeIdentities), which is what keeps a machine in its workspace
   *  while it does not answer. If that step throws, the state just made is taken again as a read
   *  that threw, so its groups are marked not reached instead of shown as read. `changed` is not
   *  used: this client keeps the memory for the run and writes none of it. */
  function takeRoster(outcome, at) {
    const held = getRoster();
    let state = remoteRosterState(held.remote, outcome, at), identities = { memory: held.memory, notes: held.notes };
    if (state.reported !== null) {
      try { identities = observeIdentities(identities, state.reported, at); } catch (error) { state = remoteRosterState(state, { thrown: said(error) }, at); }
    }
    onRoster({ roster: { remote: { remoteGroups: state.remoteGroups, rosterAnswered: state.rosterAnswered, rosterFailure: state.rosterFailure }, memory: identities.memory, notes: identities.notes, at } });
  }

  /** Begin the roster read when this cycle is to begin one. NOT AWAITED BY THE CYCLE: a machine
   *  that answers slowly (the read may take a minute) never holds this machine's rows.
   *  A kernel that reads no other machine (the shared cliReadsRemotes) is never asked: the gated
   *  outcome is taken once, so the store holds what the shared rule makes of it.
   *  ONE READ AT A TIME: while one is in flight nothing starts, not for a live request either.
   *  The local rows of that request are read; the roster's answer is the one already on its way.
   *  NEVER SOONER THAN `rosterMs` AFTER THE END OF THE LAST ONE, unless somebody asked (`live`:
   *  the refresh key, the return from a suspend, a pick in the switcher). From the END, not the
   *  start: a read that took 20 s would otherwise be followed at once by the next, and a slow
   *  machine would be asked without a pause. The loop's own slowing after ten minutes without a
   *  key makes it 30 s.
   *  The read is the shared cliRemoteRoster over this exec: a child of kind "read" in a session of
   *  its own, ended on every way out like any other, with the shared time limit and no working
   *  directory of the TUI's choosing (registrations are the user's, not a deployment's). --max-age
   *  is not a flag of this read. */
  function readRoster(live, at) {
    if (!cliReadsRemotes(cli)) {
      if (!gatedSaid) { gatedSaid = true; takeRoster({ gated: true }, at); }
      return;
    }
    if (rosterFlight !== null) return;
    if (!live && rosterEnded !== null && now() - rosterEnded < rosterMs) return;
    onRoster({ collecting: true });
    const mine = rosterFlight = {};
    let read;
    // The shared read looks up the working directory before it promises anything: where that
    // directory was removed under the TUI it throws, and that is a read that failed like another.
    try { read = cliRemoteRoster(cli.bin, { exec }); } catch (error) { read = Promise.reject(error); }
    read.then((envelope) => ({ envelope }), (error) => ({ thrown: said(error) })).then((outcome) => {
      // Given up (voidInFlight(), stop()): whatever it answered is no evidence, and is dropped.
      if (rosterFlight !== mine) return;
      rosterFlight = null;
      rosterEnded = now();
      takeRoster(outcome, at);
    }).catch(() => {}); // what the caller's onRoster throws must not be a rejection nobody hears, which ends the process with the terminal taken; the loop does the same for a cycle
  }

  /** One deployment of a cycle: its two kernel reads, then the collector over its rows. It emits
   *  exactly once, unless the reader was stopped or the cycle made void meanwhile: then it emits
   *  nothing and starts nothing more. */
  async function readDeployment(id, { live, at, number, over }) {
    const answer = await observer.observe(id, { maxAge: live ? 0 : BACKGROUND_MAX_AGE });
    if (over()) return;
    if (!answer.ok) return void onEntry({ id, entry: failedEntry(getEntry(id), answer.reason, at), number });
    const rows = rosterRows(answer.roster, cli);
    // No rows, no collector: livenessAnswers([], null) is [].
    const printed = rows.length ? await collect(JSON.stringify(livenessInput(rows))) : null;
    if (over()) return;
    const instances = panelInstances(rows, livenessAnswers(rows, printed));
    onEntry({ id, entry: observedEntry({ roster: answer.roster, workspaceStatus: answer.workspaceStatus, observedAt: answer.observedAt }, instances, at), number });
  }

  /** One cycle: the roster read is begun if it is due, then every served deployment is read, at
   *  most MAX_DEPLOYMENT_OBSERVATIONS at a time (the shared observer admits no more: a third
   *  started beside two would be refused as busy and never read). The cycle is over when its
   *  deployments are; with none served it reads nothing local. */
  async function cycle({ live }) {
    if (stopped) return;
    flight = epoch;
    const mine = epoch, number = ++counter, at = clock();
    const over = () => stopped || mine !== epoch;
    readRoster(live, at);
    served = [...getServed()];
    await mapBounded(served, MAX_DEPLOYMENT_OBSERVATIONS, (id) => readDeployment(id, { live, at, number, over }));
  }
  const loop = createRefreshLoop({ run: cycle, focusedMs, blurredMs, timers });

  function clearIdle() { if (idleTimer !== null) { timers.clearTimeout(idleTimer); idleTimer = null; } }
  /** One timer: after `idleMs` with no key the loop reads as often as a window nobody looks at. */
  function armIdle() {
    clearIdle();
    idleTimer = timers.setTimeout(() => { idleTimer = null; loop.setFocused(false); }, idleMs);
    idleTimer?.unref?.(); // it never keeps the process alive
  }

  return {
    /** Read now, then on the loop's cadence. Once: a second call, or one after stop(), does nothing.
     *  Answers the first cycle's promise. */
    start() {
      if (started || stopped) return Promise.resolve();
      started = true;
      armIdle();
      return loop.start();
    },
    /** The loop's request: read now, or right after the cycle in flight, and resolve when that
     *  cycle is over. `{ live: true }` (the refresh key, the return from a suspend, a pick in the
     *  switcher) asks the kernel for nothing reused, and begins a roster read unless one is in
     *  flight. After stop() it starts nothing. */
    request({ live = false } = {}) { return loop.request({ live }); },
    /** Somebody is there: called on every key. The loop reads at the focused cadence again (at once
     *  when it was idle), and the idle timer starts over. Nothing before start() or after stop(). */
    touch() {
      if (!started || stopped) return;
      loop.setFocused(true);
      armIdle();
    },
    /** A CYCLE IN FLIGHT WHEN THE TUI STOPS EMITS NO ENTRY, WHATEVER IT ANSWERS. Called when the TUI
     *  is about to be stopped (Ctrl+Z, before the signal) and again on a return it did not ask for
     *  (stopped from outside, seen at SIGCONT).
     *  Why: the child runs on in its own session, but its stdout is a pipe to the stopped TUI. An
     *  answer larger than the pipe blocks it, and at the return an overdue time limit fires before
     *  the pipe is read, so the read can come back as a timeout or a cut answer even from a child
     *  that exited 0. Such a cycle is no evidence about the deployment, and "unavailable" after
     *  every long suspend would be a false report.
     *  So every cycle now in flight is void: it does not call onEntry, starts no collector and no
     *  read it had not started, and its failure becomes no entry; its number is never emitted. The
     *  children remembered are ended as stop() ends them. The reader stays usable: the loop goes
     *  on, and the next cycle (the caller requests a live one on the return) emits with the next
     *  number. A cycle requested but not begun is not in flight: it runs after the return.
     *  A read the loop asked for itself (the preflight, `exec`) is not a cycle's: it is left as it
     *  is, and the loop gives it up through its signal.
     *  THE SAME HOLDS FOR A ROSTER READ IN FLIGHT, which is not part of a cycle and may outlive
     *  the one that began it: its child is ended, whatever it answers is dropped (no onRoster; the
     *  caller tells its store that nothing is being collected), and it is no longer in flight, so
     *  the live request of the return begins a new one at once. It does not count as a read that
     *  ended: it gave no answer to wait 15 s after.
     *  Synchronous and idempotent; safe before start() and after stop(). */
    voidInFlight() {
      epoch++;
      rosterFlight = null;
      endReads({ cycles: true });
    },
    /** See askedExec. */
    exec: askedExec,
    /** See changeExec. */
    changeExec,
    /** The changes still running, `[{ pid, label }]` (label: what the caller gave), whether or not
     *  this run still waits for them: for the line after leaving. Answers after stop() too. */
    changes() { return [...running].map(([child, label]) => ({ pid: child.pid, label })); },
    /** Leave: synchronous and idempotent, safe before start(). The loop and the idle timer are
     *  stopped, the observer disposed and every reading child ended (see `sever`), the roster's
     *  included. A cycle in flight ends without emitting and without starting anything, and so
     *  does a roster read; the follow-up the shared loop still runs after a stop does nothing. */
    stop() {
      stopped = true;
      rosterFlight = null;
      loop.stop();
      observer.dispose();
      clearIdle();
      endReads();
      // Every change is LET GO, never signalled: its handle no longer holds the process, and its two
      // files are unlinked (the child goes on writing to them, and nothing is left behind). The
      // private directory goes when it is empty.
      for (const record of [...remembered.values()]) if (record.kind === "change") record.letItGo();
      if (changeDir !== null) quietly(() => files.remove(changeDir));
    },
    /** The pids of the children remembered now (for tests). */
    children() { return [...remembered.keys()].map((child) => child.pid).filter((pid) => Number.isInteger(pid)); },
  };
}
