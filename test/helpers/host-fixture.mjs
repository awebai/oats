// Host-independent executables and shells for real, temporary process fixtures.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, sep } from "node:path";

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
    writeFileSync(join(bin, name), "#!/bin/sh\necho inactive\nexit 3\n");
    chmodSync(join(bin, name), 0o755);
  }
  return bin;
}
/** Names a fixture child never inherits: proxies (a fetch to a fixture's local server must not go
 *  through the host's), the harness session marker, and git configuration passed through the
 *  environment (a credential helper, an askpass). */
const dropped = (key) => /_proxy$/i.test(key) || key === "CLAUDECODE" || /^GIT_CONFIG_(PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)$/.test(key) || key === "GIT_ASKPASS";
/** HOME and the XDG base directories under `home`, and git that reads no host configuration file
 *  and never prompts. */
function isolatedHomeAndGit(home) {
  const xdg = { XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"), XDG_STATE_HOME: join(home, ".local", "state"), XDG_CACHE_HOME: join(home, ".cache") };
  for (const dir of [home, ...Object.values(xdg)]) mkdirSync(dir, { recursive: true });
  return { HOME: home, ...xdg, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
}
/** Apply the fixture's rules to an environment in place: what it never inherits removed, its HOME,
 *  XDG and git set, and its scheduler stubs ahead on PATH (once). */
export function applyFixtureRules(env, base, { home = join(base, "home") } = {}) {
  for (const key of Object.keys(env)) if (dropped(key)) delete env[key];
  Object.assign(env, isolatedHomeAndGit(home));
  const stubs = schedulerStubs(base);
  const path = (env.PATH || "").split(delimiter).filter(Boolean);
  if (!path.includes(stubs)) env.PATH = [stubs, ...path].join(delimiter);
  return env;
}
/** The environment for every child a fixture starts: this process's, with the fixture's rules
 *  applied, then `extra`. tmux isolation is isolateSessionEnvironment's, which suites that start
 *  sessions install first; this composes with it. */
export function fixtureEnv(base, { extra = {} } = {}) {
  return { ...applyFixtureRules({ ...process.env }, base), ...extra };
}

/** The host's lsof, found once when this module loads (on the PATH it loads with, else where macOS
 *  and Debian install it): the leftover check is the harness's, whatever PATH a test gives the kernel
 *  it exercises. */
const LSOF = (() => {
  for (const dir of [...(process.env.PATH || "").split(delimiter).filter(isAbsolute), "/usr/sbin", "/usr/bin"]) {
    try { accessSync(join(dir, "lsof"), constants.X_OK); return join(dir, "lsof"); } catch { /* next */ }
  }
  return null;
})();
/** Fail when a process still works in the fixture base: a hook's or a CLI's grandchild that outlived
 *  the test (awebai/oats#801). Uses the kernel's own scan (processesInHome, over lsof: a prerequisite
 *  of the suite, awebai/oats#783), which leaves out its caller and the caller's direct children. A
 *  grandchild whose parent has exited is reparented, and is found. A test's own forgotten direct
 *  child is that test's own bug: it is not found here. A process still exiting gets `settleMs` to
 *  go; nothing is killed. The failure names each pid and command. */
export function assertNoFixtureProcesses(base, { settleMs = 2000 } = {}) {
  // Loaded here, not imported: the kernel reads some defaults from the environment when it loads,
  // and a helper must not load it earlier, under another environment, than a suite would.
  const { processesInHome } = createRequire(import.meta.url)("../../lib/core.mjs");
  const deadline = Date.now() + settleMs;
  let scan;
  while (true) {
    scan = LSOF ? processesInHome(base, { exec: (cmd, args, opts) => execFileSync(cmd === "lsof" ? LSOF : cmd, args, opts) }) : { ok: false, error: "lsof is not installed" };
    if (!scan.ok) throw new Error(`cannot check for processes left in the fixture ${base}: ${scan.error} (lsof is a prerequisite of the test suite, awebai/oats#783)`);
    if (!scan.processes.length || Date.now() >= deadline) break;
    execFileSync("sleep", ["0.1"]);
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
/** A login shell that cannot be run (see isolateSessionEnvironment): named bash, so it is not refused
 *  for its name, under `dir`, where nothing creates it. */
export function noLoginShell(dir) { return join(dir, "no-login-shell", "bash"); }
/** The private TMUX_TMPDIR of the session environment installed in this process, else null. */
export function isolatedTmuxTmpdir() { return isolatedTmpdir; }
/** Take this test worker out of any OATS instance it runs inside. The kernel treats a process whose
 *  working directory is inside an instance home as that instance (a developer agent runs the suite
 *  from its work tree), and an instance that has to start a tmux server reads the environment of
 *  its own recorded server: a test must not. Moves to `dir`, a directory of the fixture; returns
 *  the function that moves back. The instance's environment names are the caller's to remove. */
export function leaveEnclosingInstance(dir) {
  const cwd = process.cwd(), pwd = process.env.PWD;
  process.chdir(dir);
  process.env.PWD = dir;
  return () => { process.chdir(cwd); if (pwd === undefined) delete process.env.PWD; else process.env.PWD = pwd; };
}

// Applies only to this test worker and its children. The fixture owns a private TMUX_TMPDIR and a
// `tmux` wrapper, the only tmux on PATH, which admits two addresses and refuses every other call:
// `-L oats` (the fixture's own `oats` server, under that TMUX_TMPDIR, whatever the caller's
// environment says) and `-S <socket>` for a socket inside the fixture. Even a server recreated by the
// kernel after kill-server uses the empty config and the fixture's shell; `userConfig: true` drops
// the forced empty config, so a server reads $HOME/.tmux.conf of the fixture's own HOME as a user's
// server does. The worker drops CLAUDECODE, the marker of the harness session it may run in: a
// server it starts would otherwise hold it, and the suite asserts that a pane holds none. Returns
// the function that restores the environment; it also kills the fixture's `oats` server, by socket,
// and removes the TMUX_TMPDIR.
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
  for (const key of Object.keys(process.env)) {
    if (/^(OATS_|PI_AGENT)/.test(key) || ["TMUX", "TMUX_PANE", "ENV", "BASH_ENV", "COLORFGBG", "CLAUDECODE"].includes(key) || dropped(key)) delete process.env[key];
  }
  // The fixture's git and XDG rules (fixtureEnv's), with HOME as this worker's; PATH stays system-bin
  // only, so no host service manager is reachable at all.
  Object.assign(process.env, isolatedHomeAndGit(home), { XDG_CONFIG_HOME: config, ZDOTDIR: home, SHELL: "/bin/sh", PATH: bin, OATS_HOME_DIR: join(base, "oats-home"), TMUX_TMPDIR: tmuxTmpdir, OATS_TEST_LOGIN_SHELL: noLoginShell(base) });
  // Neither the environment (above) nor the working directory makes this worker an OATS instance.
  const comeBack = leaveEnclosingInstance(base);
  isolatedTmpdir = tmuxTmpdir;
  return () => {
    comeBack();
    removeTmuxTmpdir(tmuxTmpdir, tmux);
    isolatedTmpdir = null;
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  };
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
