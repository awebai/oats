// Host-independent executables and shells for real, temporary process fixtures.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";

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
// server does. Returns the function that restores the environment; it also kills the fixture's
// `oats` server, by socket, and removes the TMUX_TMPDIR.
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
    if (/^(OATS_|PI_AGENT)/.test(key) || ["TMUX", "TMUX_PANE", "ENV", "BASH_ENV", "COLORFGBG"].includes(key)) delete process.env[key];
  }
  Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: config, ZDOTDIR: home, SHELL: "/bin/sh", PATH: bin, OATS_HOME_DIR: join(base, "oats-home"), TMUX_TMPDIR: tmuxTmpdir, OATS_TEST_LOGIN_SHELL: noLoginShell(base) });
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
