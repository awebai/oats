// `oats retire` of a launched instance establishes that the instance's window is gone before it
// copies or removes anything: it kills the window, then lists the session's windows on the socket
// the spawn recorded. A recorded server that is lost has no window, whether it was killed and left
// its socket file, or its socket file or the socket's directory is gone (a reboot clears tmux's
// socket directory) (#620). A server outlives its socket file, so a missing file counts as a lost
// server only when no process works in the instance's home. A window that is still there, or a
// server that cannot be read for another reason, keeps the retirement refused. Real tmux servers on
// private sockets.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { linkExecutables, waitUntil } from "./helpers/host-fixture.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const SESSION = "oats-agents";
const temporaryDirectories = [];
// Every server a test started: { socket, pid }. A server still alive after its test is ended by its own pid.
const servers = [];

function write(path, content, options) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, options);
}
const tmux = (socket, ...args) => execFileSync("tmux", ["-f", "/dev/null", "-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** A workspace deployment whose soul dev works in a worktree of the member clone and declares a
 *  capability with a retire hook, which leaves a file beside the home it retired. */
function fixture() {
  const hook = "import {writeFileSync} from 'node:fs'; import {basename, dirname, join} from 'node:path'; writeFileSync(join(dirname(process.env.OATS_HOME), `retire-hook-ran-${basename(process.env.OATS_HOME)}`), 'ran\\n'); console.log(JSON.stringify({meta:{retired:true}}));\n";
  const fx = v2Deployment({
    souls: { dev: { soul: { work: "worktree", capabilities: { "acme.undo": { from: "here" } } }, agents: "# Dev\n" } },
    capabilities: { "acme.undo": { manifest: { description: "undo", hooks: { retire: "hook.mjs" } }, files: { "hook.mjs": hook } } },
    files: { "tracked.txt": "base\n" },
  });
  temporaryDirectories.push(fx.base);
  execFileSync("git", ["-C", fx.member, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", fx.member, "config", "user.name", "Test"]);
  return { base: fx.base, dep: fx.dep, env: fx.env };
}
function cli(f, args) {
  return spawnSync(process.execPath, [CLI, ...args, "--dir", f.dep], { cwd: f.dep, encoding: "utf8", env: f.env });
}
const hookRan = (home) => existsSync(join(dirname(home), `retire-hook-ran-${basename(home)}`));

/** A spawned home recorded as launched in `SESSION:<instance>` on `socket`, in instance.json and in
 *  the independent session receipt (the spawn's retirement baseline), which is retire's authority. */
function launchedHome(f, purpose, socket) {
  const spawn = cli(f, ["spawn", "dev", "--purpose", purpose, "--no-launch", "--json"]);
  assert.equal(spawn.status, 0, `${spawn.stderr}\n${spawn.stdout}`);
  const { home, instance } = JSON.parse(spawn.stdout).result;
  const endpoint = { session: SESSION, window: instance, socket };
  const metaPath = join(home, "instance.json");
  write(metaPath, JSON.stringify({ ...JSON.parse(readFileSync(metaPath, "utf8")), launched: true, tmux: endpoint }, null, 2) + "\n");
  const baselinePath = join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);
  write(baselinePath, JSON.stringify({ ...JSON.parse(readFileSync(baselinePath, "utf8")), runtime: { launched: true, tmux: endpoint } }, null, 2) + "\n", { mode: 0o600 });
  return { home, instance };
}
/** Start a server on `socket` whose session holds a keeper window and the instance's window, which
 *  runs `command` (a shell command), in `cwd` when one is given. Returns the server's process id. */
function startServer(socket, instance, { cwd, command = "sleep 600" } = {}) {
  mkdirSync(dirname(socket), { recursive: true });
  tmux(socket, "new-session", "-d", "-s", SESSION, "-n", "keeper", "sleep 600");
  const pid = Number(tmux(socket, "display-message", "-p", "#{pid}"));
  servers.push({ socket, pid });
  tmux(socket, "new-window", "-d", "-t", `${SESSION}:`, "-n", instance, ...(cwd ? ["-c", cwd] : []), command);
  assert.ok(windows(socket).includes(instance), "the instance's window runs");
  return pid;
}
const windows = (socket) => tmux(socket, "list-windows", "-t", `=${SESSION}`, "-F", "#{window_name}").split("\n").filter(Boolean);
/** Kill the server on `socket` and wait until its process is gone, so that what a later tmux
 *  client reads is the lost server, never a server that is still exiting. */
async function killServer(socket) {
  const { pid } = servers.find((s) => s.socket === socket);
  tmux(socket, "kill-server");
  await waitUntil(() => !alive(pid), `the tmux server on ${socket} to exit`);
}
function retired(f, { home, instance }) {
  const r = cli(f, ["retire", instance, "--json"]);
  assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`);
  assert.equal(JSON.parse(r.stdout).retired, instance);
  assert.ok(hookRan(home), "the retire hook ran");
  assert.equal(existsSync(home), false, "the home is gone");
}
function refused(f, { home, instance }, message) {
  const r = cli(f, ["retire", instance, "--json"]);
  assert.notEqual(r.status, 0, `retired ${instance}: ${r.stdout}`);
  const error = JSON.parse(r.stdout).error;
  assert.equal(error.code, "E_RUNTIME_QUIESCE_FAILED", r.stdout);
  assert.match(error.message, message);
  assert.equal(hookRan(home), false, "no retire hook ran");
  assert.equal(existsSync(home), true, "the home is kept");
  return error;
}

test.afterEach(() => {
  for (const { socket, pid } of servers.splice(0)) {
    try { tmux(socket, "kill-server"); } catch { /* gone, or its socket is */ }
    if (alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  }
  for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("retire of a launched instance succeeds when its recorded server was killed and the socket file is gone", async (t) => {
  t.diagnostic(execFileSync("tmux", ["-V"], { encoding: "utf8" }).trim());
  const f = fixture();
  const socket = join(f.base, "tmux.sock");
  const launched = launchedHome(f, "socket-file-gone", socket);
  startServer(socket, launched.instance);
  await killServer(socket);
  rmSync(socket, { force: true });
  assert.equal(existsSync(socket), false);
  retired(f, launched);
});

test("retire of a launched instance succeeds when its recorded server was killed and the socket's directory is gone", async () => {
  const f = fixture();
  const socket = join(f.base, "tmux-sockets", "tmux.sock");
  const launched = launchedHome(f, "socket-directory-gone", socket);
  startServer(socket, launched.instance);
  await killServer(socket);
  rmSync(dirname(socket), { recursive: true });
  assert.equal(existsSync(dirname(socket)), false);
  retired(f, launched);
});

test("retire of a launched instance succeeds when its recorded server was killed and the socket file remains", async () => {
  const f = fixture();
  const socket = join(f.base, "tmux.sock");
  const launched = launchedHome(f, "socket-file-remains", socket);
  startServer(socket, launched.instance);
  await killServer(socket);
  assert.equal(existsSync(socket), true, "tmux leaves its socket file behind when the server is killed");
  retired(f, launched);
});

test("retire of a launched instance is refused while a window of its recorded name is still alive after the kill", () => {
  const f = fixture();
  const socket = join(f.base, "tmux.sock");
  const launched = launchedHome(f, "window-alive", socket);
  startServer(socket, launched.instance);
  // A second window of the same name: tmux refuses an exact window target that matches more than
  // one window, so retire's kill-window does not end the instance's window and the listing still
  // names it.
  tmux(socket, "new-window", "-d", "-t", `${SESSION}:`, "-n", launched.instance, "sleep 600");
  refused(f, launched, /is still running/);
  assert.ok(windows(socket).includes(launched.instance), "a window of the recorded name still runs");
});

test("retire of a launched instance is refused when the recorded server cannot be read for a reason that is not a lost server", () => {
  const f = fixture();
  // A socket path under a regular file fails lookup with ENOTDIR: neither a lost server nor a
  // missing session, so whether the window stopped is not established.
  const notADirectory = join(f.base, "not-a-directory");
  writeFileSync(notADirectory, "x");
  const launched = launchedHome(f, "server-unreadable", join(notADirectory, "tmux.sock"));
  refused(f, launched, /could not establish that .* stopped on .*: .*Not a directory/);
});

test("retire of a launched instance is refused when the socket file is gone but its server still runs the instance's window in the home", () => {
  const f = fixture();
  const socket = join(f.base, "tmux.sock");
  const launched = launchedHome(f, "server-outlives-socket", socket);
  // A shell that stays (it has a second command to run) and carries an argument, with its sleep.
  const argument = "fixture-process-argument";
  const server = startServer(socket, launched.instance, { cwd: launched.home, command: `sh -c 'sleep 600; :' ${argument}` });
  // A tmux server keeps running when its socket file is removed: no client reaches it, and tmux
  // answers as it does after a reboot. The processes in the instance's window still work in the home.
  rmSync(socket);
  const error = refused(f, launched, /No such file or directory\); a process still works in this home \(pid \d+ /);
  assert.equal(error.message.includes(argument), false, "the message names a process by its pid and program, never by its arguments");
  assert.ok(alive(server), "the server still runs");
});

test("retire of a launched instance is refused when the socket file is gone and the process scan cannot run", () => {
  const f = fixture();
  const launched = launchedHome(f, "scan-cannot-run", join(f.base, "tmux.sock"));
  // tmux and what retire itself runs, without lsof: whether a process works in the home is unknown, never none.
  const bin = join(f.base, "no-lsof-bin");
  linkExecutables(bin, ["node", "git", "tmux"]);
  f.env = { ...f.env, PATH: bin };
  refused(f, launched, /No such file or directory\); whether a process still works in this home could not be established \(lsof is not on PATH\)/);
});
