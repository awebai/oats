// The effects of the Instances view: finding the deployment, the kernel's record, one exec for
// every kernel call, the observer, the refresh loop and the liveness collector.
// This version of the TUI ONLY READS: nothing here changes a deployment.
// No function of this module decodes a kernel answer. Each one passes values between the shared
// functions (client.mjs), which decide what a roster, a row and a failed read are, once, for both
// clients: the TUI never writes "stopped" for a row and never builds the collector's input by hand.
import { execFile as nodeExecFile, spawn as nodeSpawn } from "node:child_process";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COLLECTOR, INSTANCE_VARIABLES, acceptProbe, cliDeploymentRead, cliRecord, createDeploymentObserver, createRefreshLoop, failedEntry, livenessAnswers, livenessInput, observedEntry, panelInstances, parseProbeStdout, rosterRows, validateWorkspace } from "./client.mjs";

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

/** The filesystem findDeployment reads when it is given none: one realpath and one stat of the
 *  start, then one lstat per directory. A symbolic link named oats-local.yaml is not a deployment's
 *  file (lstat does not follow it). */
const DEPLOYMENT_IO = Object.freeze({
  realpath: (path) => realpathSync(path),
  isDirectory: (path) => statSync(path).isDirectory(),
  isDeployment: (dir) => lstatSync(join(dir, "oats-local.yaml")).isFile(),
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

/** A step that must not stop the ones after it: a child or a stream that is already gone. */
const quietly = (act) => { try { return act(); } catch { return undefined; } };
/** A child that did not end well, as execFile reports one: the facts on an Error, and no text of the child's. */
const failure = (facts) => Object.assign(new Error("the child did not end with an answer"), facts);
/** A child the reader ended itself: its time limit, or the reader giving it up. As execFile's timeout. */
const ended = () => failure({ code: null, signal: "SIGTERM", killed: true });

/** The reader of one deployment: its cycles, their children, and the way out.
 *  -> { start(), request({ live }), touch(), voidInFlight(), stop(), children() }
 *
 *  `cli` is probeKernel's record (`cli.bin` the absolute path of bin/oats.mjs). `getEntry()` answers
 *  the entry the caller's store holds now, and `onEntry({ entry, number })` receives each cycle's:
 *  the reader keeps no entry of its own and decides nothing about a failed read (the shared
 *  failedEntry does). `number` grows by one per cycle and is never reused, so a store can refuse an
 *  answer that arrives out of order; a cycle that emits nothing leaves a gap.
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
 *  ENDING A CHILD holds because this version only reads. A KERNEL CALL THAT CHANGES SOMETHING MUST
 *  NEVER BE KILLED BY THE TUI: a killed stop or start leaves a marker that refuses every later one.
 *  So every child is remembered with its kind, only kind "read" is ever signalled, and a later
 *  version's writing calls get a kind of their own.
 *
 *  `timers` are the loop's, the idle timer's and the children's time limits (for tests). */
export function createReader({ deployment, cli, getEntry, onEntry, env = process.env, clock = () => new Date().toISOString(), spawn = nodeSpawn, timers = { setTimeout, clearTimeout }, collector = COLLECTOR, idleMs = 600_000, focusedMs = 5000, blurredMs = 30_000 }) {
  /** child -> { kind, exited, giveUp }: every child that has not ended and was not ended. */
  const remembered = new Map();
  let started = false, stopped = false, idleTimer = null;
  /** `counter` numbers the cycles. `epoch` moves when the cycles in flight are made void; `flight`
   *  is the epoch the cycle now running began in (the loop runs one at a time). */
  let counter = 0, epoch = 0, flight = 0;

  /** execFile for a child in a session of its own: start `node <args…>` detached, remember it, and
   *  call back once with `(error, stdout, stderr)` as execFile does. `error` is null after exit 0
   *  with no signal; else it carries `code` (the exit status, or the spawn error's code), `signal`
   *  and `killed`: `killed: true` when the time limit ended it, and
   *  `code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"` when it printed more than `maxBuffer` bytes. The
   *  other options go to spawn as they are, with `detached: true` added. Returns the child.
   *  The child is forgotten when it ends: `close`, `error` for one that did not start, or the
   *  moment the reader ends it. */
  function run(kind, args, { timeout = 0, maxBuffer = Infinity, encoding = "utf8", ...rest }, callback) {
    const child = spawn(process.execPath, args, { ...rest, detached: true });
    const printed = { stdout: "", stderr: "" }, record = { kind, exited: false, giveUp };
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
  function endReads() {
    for (const record of [...remembered.values()]) if (record.kind === "read") record.giveUp(ended());
  }

  /** The exec handed to the shared reader: execFile's signature, for `node <bin> <argv…>` (see
   *  `run`). It throws where nothing may be started (after stop(), or for a cycle made void before
   *  its reads began); the shared reader answers that as a failed read, which such a cycle never
   *  emits. */
  function exec(bin, argv, options, callback) {
    if (stopped || flight !== epoch) throw new Error("this read was given up before it started");
    return run("read", [bin, ...argv], options, callback);
  }
  const observer = createDeploymentObserver({
    getContext: (id) => (id === deployment ? { deployment, cli, revision: 0 } : null),
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

  /** One cycle. It emits exactly once, unless the reader was stopped or the cycle made void
   *  meanwhile: then it emits nothing and starts nothing more. */
  async function cycle({ live }) {
    if (stopped) return;
    flight = epoch;
    const mine = epoch, number = ++counter, at = clock();
    const over = () => stopped || mine !== epoch;
    const answer = await observer.observe(deployment, { maxAge: live ? 0 : BACKGROUND_MAX_AGE });
    if (over()) return;
    if (!answer.ok) return void onEntry({ entry: failedEntry(getEntry(), answer.reason, at), number });
    const rows = rosterRows(answer.roster, cli);
    // No rows, no collector: livenessAnswers([], null) is [].
    const printed = rows.length ? await collect(JSON.stringify(livenessInput(rows))) : null;
    if (over()) return;
    const instances = panelInstances(rows, livenessAnswers(rows, printed));
    onEntry({ entry: observedEntry({ roster: answer.roster, workspaceStatus: answer.workspaceStatus, observedAt: answer.observedAt }, instances, at), number });
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
     *  cycle is over. `{ live: true }` (the refresh key, the return from a suspend) asks the kernel
     *  for nothing reused. After stop() it starts nothing. */
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
     *  Synchronous and idempotent; safe before start() and after stop(). */
    voidInFlight() {
      epoch++;
      endReads();
    },
    /** Leave: synchronous and idempotent, safe before start(). The loop and the idle timer are
     *  stopped, the observer disposed and every reading child ended (see `sever`). A cycle in
     *  flight ends without emitting and without starting anything; the follow-up the shared loop
     *  still runs after a stop does nothing. */
    stop() {
      stopped = true;
      loop.stop();
      observer.dispose();
      clearIdle();
      endReads();
    },
    /** The pids of the children remembered now (for tests). */
    children() { return [...remembered.keys()].map((child) => child.pid).filter((pid) => Number.isInteger(pid)); },
  };
}
