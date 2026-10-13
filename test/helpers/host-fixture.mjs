// Host-independent executables and shells for real, temporary process fixtures.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir, userInfo } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";

const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The host's own executable of that name: its absolute path on the PATH this process started with. */
export function systemExecutable(name) { return executable(name); }
function executable(name) {
  if (name === "node") return process.execPath;
  for (const dir of (process.env.PATH || "").split(delimiter).filter(isAbsolute)) {
    const candidate = join(dir, name);
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* next */ }
  }
  throw new Error(`test fixture requires ${name} on PATH`);
}

// Link individual tools, never their parent directories: node's bin directory
// can also contain a globally installed pi/claude/ssh.
export function linkExecutables(bin, names) {
  mkdirSync(bin, { recursive: true });
  for (const name of names) symlinkSync(executable(name), join(bin, name));
}

// ---- the fixture base, its names, its environment and its leftovers (awebai/oats#816) -----------
// A fixture assumes nothing of the host it runs on: not a short temporary directory, not a bare
// environment, not an idle service manager. A kernel suite is green on Linux CI and on a Mac with a
// loaded schedule unit, a live operator tmux server and Apple git (docs/implementation.md).

/** A tmpdir() longer than this (macOS: /private/var/folders/…/T/, about 49 characters) leaves too
 *  little of a socket path's ~104 bytes, and of NAME_MAX/PATH_MAX for long names: the base goes
 *  under /tmp instead. */
const SHORT_TMPDIR = 20;
/** A new fixture base: a fresh directory under tmpdir(), or under /tmp when tmpdir() is long, as its
 *  realpath (taken once: /private/tmp and /private/var on macOS). */
export function fixtureBase(prefix = "oats-") {
  const parent = tmpdir().length > SHORT_TMPDIR ? "/tmp" : tmpdir();
  return realpathSync(mkdtempSync(join(parent, prefix)));
}

/** NAME_MAX and PATH_MAX of the platform's usual filesystems, from a table, not a native call. */
export const FS_LIMITS = process.platform === "darwin" ? { name: 255, path: 1024 } : { name: 255, path: 4096 };
/** Room every name and path leaves for what git and the kernel append (`.lock`, a temporary suffix). */
const MARGIN = 16;
/** A name (a file name or a branch segment) of `n` characters, capped below NAME_MAX and below
 *  what `base` leaves of PATH_MAX: a "too long" test then exercises the kernel's own bound,
 *  never the filesystem's. */
export function nameOfLength(base, n, char = "n") {
  return char.repeat(Math.max(1, Math.min(n, FS_LIMITS.name - MARGIN, FS_LIMITS.path - base.length - 1 - MARGIN)));
}
/** An absolute path under `base` of `n` characters in all, capped below PATH_MAX, built from
 *  segments each within NAME_MAX. Measured from the actual base, so it is the same length on
 *  every host. */
export function pathOfLength(base, n, char = "p") {
  const total = Math.min(n, FS_LIMITS.path - MARGIN);
  if (total <= base.length + 1) throw new Error(`a path of ${n} characters is not longer than the base ${base}`);
  const segment = FS_LIMITS.name - 2 * MARGIN;
  let path = base;
  while (path.length < total) {
    const left = total - path.length - 1;
    // Never leave a remainder too short for a segment of its own.
    const take = left > segment ? (left - segment < 2 ? segment - 2 : segment) : left;
    path += sep + char.repeat(take);
  }
  return path;
}

/** The fixture's `launchctl` and `systemctl`: the host's service manager is never asked, and they
 *  answer as one with nothing loaded (awebai/oats#799). A test that needs another answer puts its
 *  own ahead of these on PATH. */
function schedulerStubs(base) {
  const bin = join(base, "fixture-bin");
  mkdirSync(bin, { recursive: true });
  for (const name of ["launchctl", "systemctl"]) {
    if (existsSync(join(bin, name))) continue; // never rewritten under a child that may be running it
    writeFileSync(join(bin, name), "#!/bin/sh\necho inactive\nexit 3\n");
    chmodSync(join(bin, name), 0o755);
  }
  return bin;
}
// ---- what a fixture never inherits (awebai/oats#972) --------------------------------------------
// ONE place decides what a fixture takes from the process that runs the suite. Every helper that
// builds an environment, for a child or for an in-process kernel call, starts from inheritedEnv()
// or removes with dropInherited(): none keeps a list of names of its own. A suite run from an
// agent's session (a developer agent, from its work tree) otherwise answers for that session's
// harness account, display, tmux pane and instance, and differs from CI.

/** This worker's environment as it started. This module is evaluated before any code of the test
 *  file that imports it, so nothing in it was put there by a test. */
const INHERITED = Object.freeze({ ...process.env });
/** The variables of the session that runs the suite, which a fixture never inherits: what selects
 *  a harness's configuration (the kernel's HARNESS_CONFIG_SELECTORS), the display, the tmux client's
 *  server and pane, and every variable OATS or aweb gives an instance.
 *  scripts/test-session-inheritance.mjs sets each of `names`, and names under each of `prefixes`,
 *  to a value that cannot work and runs the suites that have followed one; pull-request CI runs
 *  it. `legacyPrefixes` are the names OATS_ had before: no session has them now, the kernel still
 *  reads some, and a fixture drops them the same way. */
export const SESSION_VARIABLES = Object.freeze({
  names: Object.freeze(["CLAUDE_CONFIG_DIR", "CODEX_HOME", "PI_CODING_AGENT_DIR", "DISPLAY", "TMUX", "TMUX_PANE"]),
  prefixes: Object.freeze(["OATS_", "AWEB_"]),
  legacyPrefixes: Object.freeze(["PI_AGENT"]),
});
/** Whether `key` names a variable of the session (SESSION_VARIABLES). */
export function isSessionVariable(key) {
  return SESSION_VARIABLES.names.includes(key) || [...SESSION_VARIABLES.prefixes, ...SESSION_VARIABLES.legacyPrefixes].some((prefix) => key.startsWith(prefix));
}
/** Names a fixture never inherits whoever set them: proxies (a fetch to a fixture's local server
 *  must not go through the host's), the harness session marker, and git configuration passed
 *  through the environment (a credential helper, an askpass). */
const neverKept = (key) => /_proxy$/i.test(key) || key === "CLAUDECODE" || /^GIT_CONFIG_(PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)$/.test(key) || key === "GIT_ASKPASS";
/** Whether a fixture leaves `key`, held as `value`, out of an environment. A session variable is
 *  left out only while it still has the value this worker started with: a test that needs one sets
 *  it itself (in process.env before the fixture call, or as `extra`), and that value is the test's,
 *  as are the fixture's own (OATS_HOME_DIR, OATS_TEST_CGROUP, …). */
export function neverInherited(key, value) {
  return neverKept(key) || (isSessionVariable(key) && value === INHERITED[key]);
}
/** Remove from `env`, in place, what a fixture never inherits → `env`. */
export function dropInherited(env) {
  for (const key of Object.keys(env)) if (neverInherited(key, env[key])) delete env[key];
  return env;
}
/** A copy of this process's environment as it is now, less what a fixture never inherits: where
 *  every environment a helper builds starts. */
export function inheritedEnv() { return dropInherited({ ...process.env }); }
/** HOME and the XDG base directories under `home`, and git that reads no host configuration file
 *  and never prompts. */
function isolatedHomeAndGit(home) {
  const xdg = { XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"), XDG_STATE_HOME: join(home, ".local", "state"), XDG_CACHE_HOME: join(home, ".cache") };
  for (const dir of [home, ...Object.values(xdg)]) mkdirSync(dir, { recursive: true });
  return { HOME: home, ...xdg, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
}
/** Where a kernel a fixture starts judges itself to run (lib/tmux-server-scope.mjs, #915): a scope,
 *  never a systemd service, whatever runs the suite. A CI job inside a service would otherwise make
 *  the kernel start the OATS tmux server under the host's own systemd-run. A test of that start
 *  sets its own. */
const FIXTURE_CGROUP = "0::/oats-fixture.scope\n";
/** A fixture's rules, made once: its HOME and XDG directories and its scheduler stubs are created
 *  here, and nowhere else. */
export function fixtureRules(base, { home = join(base, "home") } = {}) {
  return { set: { ...isolatedHomeAndGit(home), OATS_TEST_CGROUP: FIXTURE_CGROUP }, stubs: schedulerStubs(base) };
}
/** Apply a fixture's rules to an environment in place, creating nothing: what it never inherits
 *  removed (dropInherited), its HOME, XDG and git set, and its scheduler stubs ahead on PATH (once). */
export function applyFixtureRules(env, rules) {
  dropInherited(env);
  Object.assign(env, rules.set);
  const path = (env.PATH || "").split(delimiter).filter(Boolean);
  if (!path.includes(rules.stubs)) env.PATH = [rules.stubs, ...path].join(delimiter);
  return env;
}
/** The environment for every child a fixture starts: this process's, with the fixture's rules
 *  applied (so less what a fixture never inherits), then `extra`. tmux isolation is
 *  isolateSessionEnvironment's, which suites that start sessions install first; this composes with it. */
export function fixtureEnv(base, { extra = {}, rules = fixtureRules(base) } = {}) {
  return { ...applyFixtureRules({ ...process.env }, rules), ...extra };
}

/** The host's lsof, found once when this module loads (on the PATH it loads with, else where macOS
 *  and Debian install it): the leftover check is the harness's, whatever PATH a test gives the kernel
 *  it exercises. Used only where the kernel cannot read /proc (awebai/oats#625). */
const LSOF = (() => {
  for (const dir of [...(process.env.PATH || "").split(delimiter).filter(isAbsolute), "/usr/sbin", "/usr/bin"]) {
    try { accessSync(join(dir, "lsof"), constants.X_OK); return join(dir, "lsof"); } catch { /* next */ }
  }
  return null;
})();
/** Fail when a process still works in the fixture base: a hook's or a CLI's grandchild that outlived
 *  the test (awebai/oats#801). Uses the kernel's own scan (processesInHome: /proc on Linux, else lsof,
 *  a prerequisite of the suite there, awebai/oats#783, #625), which leaves out its caller and the
 *  caller's direct children. A
 *  grandchild whose parent has exited is reparented, and is found. A test's own forgotten direct
 *  child is that test's own bug: it is not found here. A process still exiting gets `settleMs` to
 *  go; nothing is killed. The failure names each pid and command. */
export function assertNoFixtureProcesses(base, { settleMs = 2000 } = {}) {
  // Loaded here, not imported: the kernel reads some defaults from the environment when it loads,
  // and a helper must not load it earlier, under another environment, than a suite would.
  const { processesInHome, processScanAvailability } = createRequire(import.meta.url)("../../lib/core.mjs");
  // /proc does not depend on PATH; lsof is the one found when this module loaded.
  const proc = processScanAvailability().mechanism === "proc";
  const deadline = Date.now() + settleMs;
  let scan;
  while (true) {
    scan = proc ? processesInHome(base)
      : LSOF ? processesInHome(base, { exec: (cmd, args, opts) => execFileSync(cmd === "lsof" ? LSOF : cmd, args, opts) })
      : { ok: false, error: "lsof is not installed" };
    if (!scan.ok) throw new Error(`cannot check for processes left in the fixture ${base}: ${scan.error} (where /proc cannot be read, lsof is a prerequisite of the test suite, awebai/oats#783)`);
    if (!scan.processes.length || Date.now() >= deadline) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); // a wait that starts no process: PATH may hold none
  }
  if (scan.processes.length) throw new Error(`processes still work in the fixture ${base} after its test: ${scan.processes.map((p) => `pid ${p.pid} ${p.command}`).join(", ")}`);
}

// ---- tmux isolation --------------------------------------------------------------------------
// OATS creates its sessions on the tmux server named `oats` (`tmux -L oats`), whose socket tmux puts
// at $TMUX_TMPDIR/tmux-<uid>/oats. A fixture therefore owns a private TMUX_TMPDIR: the kernel under
// test then reaches the fixture's own `oats` server and never the operator's.

/** A new private TMUX_TMPDIR. Short on purpose: a socket path is limited to about 104 bytes, and the
 *  platform's temporary directory can be long. */
export function privateTmuxTmpdir() { return realpathSync(mkdtempSync("/tmp/oats-tmux-")); }
/** The socket of the server named `oats` under a TMUX_TMPDIR: tmux's own layout. */
export function oatsSocket(tmuxTmpdir = process.env.TMUX_TMPDIR) { return join(tmuxTmpdir, `tmux-${process.getuid()}`, "oats"); }
/** tmux creates its per-user socket directory when a server is selected by name (-L). A test that
 *  addresses the `oats` socket with -S before that makes the directory itself, as tmux would (0700). */
export function ensureOatsSocketDir(tmuxTmpdir = process.env.TMUX_TMPDIR) {
  mkdirSync(dirname(oatsSocket(tmuxTmpdir)), { recursive: true, mode: 0o700 });
  return oatsSocket(tmuxTmpdir);
}
/** Kill the `oats` server of a private TMUX_TMPDIR, by socket, and remove the directory. */
export function removeTmuxTmpdir(tmuxTmpdir, tmux = "tmux") {
  const socket = oatsSocket(tmuxTmpdir);
  if (existsSync(socket)) { try { execFileSync(tmux, ["-S", socket, "kill-server"], { stdio: "ignore", timeout: 10000 }); } catch { /* not running */ } }
  rmSync(tmuxTmpdir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
let isolatedTmpdir = null;
/** What a shell or a terminal program the worker starts would read from the runner's own shell: the
 *  files sh and bash source when they start, and the terminal's colours. Removed from a worker that
 *  starts shells (isolateSessionEnvironment), beside what no fixture inherits. */
const SHELL_STARTUP = ["ENV", "BASH_ENV", "COLORFGBG"];
/** A login shell that cannot be run (see isolateSessionEnvironment): named bash, so it is not refused
 *  for its name, under `dir`, where nothing creates it. */
export function noLoginShell(dir) { return join(dir, "no-login-shell", "bash"); }
/** The private TMUX_TMPDIR of the session environment installed in this process, else null. */
export function isolatedTmuxTmpdir() { return isolatedTmpdir; }
/** Take this test worker out of any OATS instance it runs inside. The kernel treats a process whose
 *  working directory is inside an instance home as that instance (a developer agent runs the suite
 *  from its work tree), and an instance that has to start a tmux server reads the environment of
 *  its own recorded server: a test must not. Moves to `dir`, a directory of the fixture; returns
 *  the function that moves back. The instance's environment names are the caller's to remove
 *  (dropInherited). */
export function leaveEnclosingInstance(dir) {
  const cwd = process.cwd(), pwd = process.env.PWD;
  process.chdir(dir);
  process.env.PWD = dir;
  return () => { process.chdir(cwd); if (pwd === undefined) delete process.env.PWD; else process.env.PWD = pwd; };
}

// ---- a fixture's expected warning (awebai/oats#910) -------------------------------------------
// Test output is pristine: an expected warning is captured and asserted, never left in the output.
// A fixture's login environment cannot be read, by construction, so when the kernel plans to start
// the fixture's tmux server it says so in one line on this process's stderr. The fixture owns that
// line. It takes the line out of the output only when the whole write is exactly the sentence the
// kernel writes for the fixture's reason and fallback, and only while the fixture's premise holds at
// that moment (loginFallbackReason). A line that differs in any way stays in the output, where the
// root run fails on it (scripts/run-tests.mjs). And every capture asserts something that can fail
// (expectLoginFallback): none only removes a line.
//
// No capture asserts that the warning comes. The kernel writes it where it PLANS a start, in the
// process that plans, and a socket shows neither who planned nor whether a start followed. That the
// warning comes is pinned by test/login-environment.test.mjs, test/schedule-gone-server.test.mjs and
// test/fixture-expected-warning.test.mjs, which start a real server and read the line.

const OWN_ENVIRONMENT = "; the OATS tmux server is started with this process's own environment instead: a fallback, neither a login environment nor a working agent socket is assured\n";
/** The kernel's line (lib/core.mjs oatsSessionEnvironment, lib/login-environment.mjs), whole, for
 *  each reason a fixture can have: its login shell does not exist (`no-shell`: noLoginShell), or
 *  it names no shell at all and its HOME is not the user's (`not-home`). */
export const LOGIN_FALLBACK_WARNING = Object.freeze({
  "no-shell": `oats: warning: could not read your login environment (your login shell could not be started (ENOENT))${OWN_ENVIRONMENT}`,
  "not-home": `oats: warning: could not read your login environment (this process's HOME is not your home directory, so it does not run in your login session)${OWN_ENVIRONMENT}`,
});
/** The reason the kernel has for the fallback in the environment `env`, as a fixture can have it,
 *  else null: a HOME that is the user's own (the kernel runs the user's shell there, never a test's),
 *  or a named shell that exists, gives no warning a fixture expects. */
export function loginFallbackReason(env = process.env) {
  let user;
  try { user = userInfo(); } catch { return null; }
  const same = (a, b) => { try { return realpathSync(a) === realpathSync(b); } catch { return resolve(a) === resolve(b); } };
  if (typeof env.HOME === "string" && env.HOME !== "" && same(env.HOME, user.homedir)) return null;
  if (!env.OATS_TEST_LOGIN_SHELL) return "not-home";
  return existsSync(env.OATS_TEST_LOGIN_SHELL) ? null : "no-shell";
}

/** process.stderr.write as it was when this module was evaluated: before any code of the test file. */
const PRISTINE_STDERR_WRITE = process.stderr.write;
/** The expectations in force, and how many times this process has captured each line so far: every
 *  expectation in force counts a line, whichever is innermost. */
const expecting = [], captured = new Map();
/** In front of process.stderr.write while an expectation is in force. */
function captureWrite(chunk, encoding, callback) {
  const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : null;
  if (text === null || !expecting.some((e) => e.line === text && loginFallbackReason() === e.reason)) return PRISTINE_STDERR_WRITE.apply(this, arguments);
  captured.set(text, (captured.get(text) ?? 0) + 1);
  const done = typeof encoding === "function" ? encoding : callback;
  if (typeof done === "function") process.nextTick(done);
  return true;
}
/** While the capture is in front: process.stderr's own `write` property as it was before (none, as
 *  a rule: the method is the prototype's). */
let before = null;
/** Put the capture in front of process.stderr.write → whether it is in front. Never over a test's
 *  own replacement: the test sees the line first then, and holds it. */
function captureInFront() {
  if (process.stderr.write === captureWrite) { before ??= { own: undefined }; return true; }
  if (process.stderr.write !== PRISTINE_STDERR_WRITE) return false;
  before = { own: Object.getOwnPropertyDescriptor(process.stderr, "write") };
  Object.defineProperty(process.stderr, "write", { value: captureWrite, writable: true, enumerable: true, configurable: true });
  return true;
}
/** Take the capture away, once no expectation is left: process.stderr has the own properties it had.
 *  A replacement a test has left there is the test's to take away. */
function captureAway() {
  if (!before) return;
  if (process.stderr.write === captureWrite) { if (before.own) Object.defineProperty(process.stderr, "write", before.own); else delete process.stderr.write; }
  before = null;
}
/** For the length of a call's expectation, process.stderr.write is an accessor that counts every
 *  assignment: a test that replaces the method inside the call (and puts it back) is seen to have
 *  held it. Calls nest and overlap: the accessor is there from the first to the last of them. */
let watching = 0, watchedWrite, replacements = 0;
function watch() {
  if (watching++ > 0) return;
  watchedWrite = process.stderr.write;
  Object.defineProperty(process.stderr, "write", { configurable: true, enumerable: true, get: () => watchedWrite, set: (value) => { watchedWrite = value; replacements += 1; } });
}
function unwatch() {
  if (--watching > 0) return;
  Object.defineProperty(process.stderr, "write", { value: watchedWrite, writable: true, enumerable: true, configurable: true });
}
/** The `oats` socket under a TMUX_TMPDIR as it is now: which file it is, and when its directory
 *  last gained or lost an entry. */
function socketMark(tmuxTmpdir) {
  if (!tmuxTmpdir) return { socket: null, directory: null };
  const socket = statSync(oatsSocket(tmuxTmpdir), { throwIfNoEntry: false }), directory = statSync(dirname(oatsSocket(tmuxTmpdir)), { throwIfNoEntry: false });
  return { socket: socket ? socket.ino : null, directory: directory ? directory.mtimeMs : null };
}
/**
 * Expect the kernel's fallback warning from now on → `{ end({ assert }) }`; `end` returns how many
 * times the line was captured.
 *
 * While it is in force, a write on stderr that is exactly LOGIN_FALLBACK_WARNING[reason], made while
 * loginFallbackReason() is that reason, is taken out of the output and counted. With `reason` null
 * (the default, when the environment in force gives a fixture no reason) nothing is captured.
 * `end` stops that and, unless `assert` is false, asserts what the expectation can know:
 *
 * - One kernel call (the default; fx.inEnv): a server appeared at the `oats` socket under
 *   `tmuxTmpdir` during the call and the line never came → it fails. Nothing is asserted for a call
 *   in which the test replaced process.stderr.write itself, before it or inside it: the test holds
 *   the line then, and asserts it. A child that plans the start writes its line on its own stderr,
 *   so a test starts such a child outside the call. The reverse is not held: the kernel writes the line where it
 *   plans a start, and a stand-in tmux or a refusal after planning leaves no server.
 * - `lifetime` (a session environment, isolateSessionEnvironment, whose only tmux is the real one):
 *   the line was captured and nothing was ever created under `tmuxTmpdir` → it fails: the kernel
 *   planned a start that went elsewhere, or nowhere. The other direction is NOT held here, and must
 *   not be added: a server that a child of the worker starts writes the line on the child's stderr,
 *   which the test reads, and a socket does not show who planned its server.
 *   test/login-environment.test.mjs starts every server that way and asserts the child's line.
 * - A caller that knows how many starts it planned asserts the count `end` returns (a file-local
 *   wrapper around one kernel call, where no server can be observed at all).
 */
export function expectLoginFallback({ reason = loginFallbackReason(), tmuxTmpdir = process.env.TMUX_TMPDIR, lifetime = false } = {}) {
  const line = reason === null ? null : LOGIN_FALLBACK_WARNING[reason];
  if (line === undefined) throw new Error(`no login-environment fallback warning is known for the reason ${JSON.stringify(reason)}: ${Object.keys(LOGIN_FALLBACK_WARNING).join(", ")}`);
  if (line === null) return { end: () => 0 };
  // Read first: a socket that cannot be read throws here, before anything is put on process.stderr.
  const mark = socketMark(tmuxTmpdir);
  const inFront = captureInFront(), watched = inFront && !lifetime;
  if (watched) watch();
  const expectation = { line, reason }, had = captured.get(line) ?? 0, replaced = replacements;
  expecting.push(expectation);
  let seen = null;
  return {
    end({ assert = true } = {}) {
      if (seen !== null) return seen;
      expecting.splice(expecting.indexOf(expectation), 1);
      seen = (captured.get(line) ?? 0) - had;
      const held = !inFront || replacements !== replaced;
      if (watched) unwatch();
      if (!expecting.length) captureAway();
      // Nothing is read for a call that is not asserted: its own error is the one to give.
      if (!assert) return seen;
      const now = socketMark(tmuxTmpdir);
      const started = now.socket !== null && now.socket !== mark.socket, created = started || now.directory !== mark.directory;
      if (lifetime && seen > 0 && !created) throw new Error(`the kernel wrote this session environment's expected warning ${seen} time${seen === 1 ? "" : "s"} and nothing was ever created under its TMUX_TMPDIR (${tmuxTmpdir}): it planned to start a tmux server that is not the fixture's.\n${line}(test/helpers/host-fixture.mjs expectLoginFallback)`);
      if (!lifetime && !held && started && seen === 0) throw new Error(`a tmux server appeared at ${oatsSocket(tmuxTmpdir)} during this fixture's call, and the warning the fixture expects where its login shell cannot run never came on this process's stderr:\n${line}One of three things is so. The fixture has a login shell that answers: name it in OATS_TEST_LOGIN_SHELL before the call. The test asserts the line itself: it holds process.stderr.write around the kernel call. Or a child of the call planned the start, and its line is on the child's stderr: start that child outside fx.inEnv (a child given fx.env needs no forced environment) and read its stderr there (test/helpers/host-fixture.mjs expectLoginFallback).`);
      return seen;
    },
  };
}

// Applies only to this test worker and its children. The fixture owns a private TMUX_TMPDIR and a
// `tmux` wrapper, the only tmux on PATH, which admits two addresses and refuses every other call:
// `-L oats` (the fixture's own `oats` server, under that TMUX_TMPDIR, whatever the caller's
// environment says) and `-S <socket>` for a socket inside the fixture. Even a server recreated by the
// kernel after kill-server uses the empty config and the fixture's shell; `userConfig: true` drops
// the forced empty config, so a server reads $HOME/.tmux.conf of the fixture's own HOME as a user's
// server does. The worker itself drops what no fixture inherits (dropInherited, above): a server it
// starts, by the kernel or by a test's own tmux call, holds the worker's environment, so it would
// otherwise hold the runner's display, pane and instance, and CLAUDECODE, the marker of the harness
// session it may run in (the suite asserts that a pane holds none). Returns the function that
// restores the environment; it also kills the fixture's `oats` server, by socket, and removes the
// TMUX_TMPDIR.
//
// A server the kernel starts gets the user's login environment, read by running the login shell
// (lib/login-environment.mjs). A test never runs the operator's: the kernel runs it only for a process
// whose HOME is the user's home directory, and the fixture's HOME is not; OATS_TEST_LOGIN_SHELL names
// a shell that does not exist, so the reading fails and the creator's fallback (its own environment,
// or an instance's recorded server) is what the server gets, as before. A test of the reading itself
// sets its own fake shell.
export function isolateSessionEnvironment(base, { userConfig = false } = {}) {
  const original = { ...process.env };
  const tmux = executable("tmux");
  const bin = join(base, "system-bin");
  linkExecutables(bin, ["node", "sh", "bash", "cat", "env", "sleep", "git", "which", "ps"]);
  // The kernel's process scan runs lsof where it cannot read /proc (macOS): the host's, when it has one.
  if (LSOF) symlinkSync(LSOF, join(bin, "lsof"));
  const tmuxTmpdir = privateTmuxTmpdir();
  ensureOatsSocketDir(tmuxTmpdir);
  const wrapper = join(bin, "tmux");
  writeFileSync(wrapper, `#!/bin/sh
socket=
label=
expect=
command=
for arg do
  [ -n "$command" ] && break
  case "$expect" in
    S) socket=$arg; expect=; continue ;;
    L) label=$arg; expect=; continue ;;
    skip) expect=; continue ;;
  esac
  case "$arg" in
    -S) expect=S ;;
    -L) expect=L ;;
    -f|-c|-T) expect=skip ;;
    -*) ;;
    *) command=$arg ;;
  esac
done
admitted=
case "$socket" in
  */../*) ;;
  ${quote(base)}/*|${quote(tmuxTmpdir)}/*) admitted=1 ;;
  '') [ "$label" = oats ] && admitted=1 ;;
esac
if [ -z "$admitted" ]; then
  printf '%s\\n' 'test tmux refused a non-fixture socket' >&2
  exit 1
fi
TMUX_TMPDIR=${quote(tmuxTmpdir)}
export TMUX_TMPDIR
exec ${quote(tmux)}${userConfig ? "" : " -f /dev/null"} "$@"
`);
  chmodSync(wrapper, 0o755);
  const home = join(base, "user-home");
  const config = join(home, ".config");
  mkdirSync(config, { recursive: true });
  dropInherited(process.env);
  for (const key of SHELL_STARTUP) delete process.env[key];
  // The fixture's git and XDG rules (fixtureEnv's), with HOME as this worker's; PATH stays system-bin
  // only, so no host service manager is reachable at all.
  Object.assign(process.env, isolatedHomeAndGit(home), { XDG_CONFIG_HOME: config, ZDOTDIR: home, SHELL: "/bin/sh", PATH: bin, OATS_HOME_DIR: join(base, "oats-home"), TMUX_TMPDIR: tmuxTmpdir, OATS_TEST_LOGIN_SHELL: noLoginShell(base), OATS_TEST_CGROUP: FIXTURE_CGROUP });
  // Neither the environment (above) nor the working directory makes this worker an OATS instance.
  const comeBack = leaveEnclosingInstance(base);
  isolatedTmpdir = tmuxTmpdir;
  // For as long as this environment is installed the worker's own kernel calls start its server
  // with the missing shell above: the expected warning is this environment's (expectLoginFallback).
  const warning = expectLoginFallback({ reason: "no-shell", tmuxTmpdir, lifetime: true });
  return () => {
    try { warning.end(); } finally { restore(); }
  };
  function restore() {
    comeBack();
    removeTmuxTmpdir(tmuxTmpdir, tmux);
    isolatedTmpdir = null;
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
}

// Readiness is a condition, not an assumed delay. A timeout must fail the test,
// including callers that only await this helper without asserting its return.
export async function waitUntil(predicate, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

/** End the process `pid` (SIGKILL) and wait until it is gone: reaped, for a child of this process,
 *  which is a zombie until this event loop has reaped it. For a test that needs the pid itself to
 *  be gone (`kill(pid, 0)` answering ESRCH). A record that names a zombie (a claim, a retire's
 *  pending marker) already names a holder that is gone (awebai/oats#870: zombieSync, below). */
export async function killAndReap(pid, timeoutMs = 10000) {
  try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  await waitUntil(() => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === "ESRCH"; } }, `pid ${pid} to be gone`, timeoutMs);
}

/** The state of the process `pid` as this host reports it, read without the kernel's reader: field 3
 *  of /proc/<pid>/stat where there is procfs, else what `ps -o stat=` prints (`Z`, `Z+` on macOS).
 *  null when it cannot be read (the pid is gone). Synchronous. */
export function hostProcessState(pid) {
  if (existsSync("/proc/self/stat")) {
    try { const stat = readFileSync(`/proc/${pid}/stat`, "utf8"); return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0]; }
    catch { return null; }
  }
  const r = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/** End `pid`, a CHILD OF THIS PROCESS (SIGKILL unless it has exited by itself: `signal: null`), and
 *  wait, synchronously, until the host reports it as a zombie (awebai/oats#870) → that state.
 *  It stays a zombie for as long as the caller stays synchronous: Node reaps its children from its
 *  event loop, so everything that must meet the zombie (a kernel call in this process, a CLI run
 *  with spawnSync) comes before the next `await`. No delay is assumed: the state is observed. */
export function zombieSync(pid, { signal = "SIGKILL", timeoutMs = 10000 } = {}) {
  if (signal) process.kill(pid, signal);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = hostProcessState(pid);
    if (state?.startsWith("Z")) return state;
    assert.ok(state !== null, `pid ${pid} is gone, not a zombie: it is not a child of this process, or it was reaped`);
    assert.ok(Date.now() < deadline, `timed out waiting for pid ${pid} to be a zombie (its state is ${state})`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
}

/** Kill the tmux server on `socket`, when one answers, and wait until its process has exited.
 *  `kill-server` returns before the server is gone, and a lookup on the socket in between reads
 *  "server exited unexpectedly", which the kernel reports as an error, not as no server. */
export async function killTmuxServer(socket, tmux = "tmux", timeoutMs = 5000) {
  const run = (...args) => execFileSync(tmux, ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] });
  let pid;
  try { pid = Number(run("display-message", "-p", "#{pid}").trim()); } catch { return; }
  try { run("kill-server"); } catch { /* it exited meanwhile */ }
  await waitUntil(() => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === "ESRCH"; } }, `the tmux server on ${socket} to exit`, timeoutMs);
}
