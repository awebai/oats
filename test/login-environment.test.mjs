// When the kernel creates the OATS tmux server, the server gets the user's login environment, read
// by the login shell over a dedicated pipe and accepted only whole; when it cannot be read, the
// creator's fallback (awebai/oats#616). lib/login-environment.mjs and docs/execution-targets.md.
//
// The login shell is always a fake (OATS_TEST_LOGIN_SHELL, a script named bash), never the
// operator's, and the user session is a fake systemctl/launchctl first on the creator's PATH. Real
// tmux on the fixture's private TMUX_TMPDIR only.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LOGIN_SESSION_ENV, parseSystemdEnvironment } from "../lib/login-environment.mjs";
import { isolateSessionEnvironment, oatsSocket, systemExecutable, waitUntil } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const CORE = pathToFileURL(resolve(new URL("../lib/core.mjs", import.meta.url).pathname)).href;
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-login-env-")));
const restoreEnvironment = isolateSessionEnvironment(base);
const OATS = oatsSocket();
const SYSTEM = join(base, "system-bin");
const TMUX = join(SYSTEM, "tmux");
const HOME = process.env.HOME; // the fixture's
const CAT = systemExecutable("cat"), SLEEP = systemExecutable("sleep");
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const lines = (text) => text.split("\n").filter(Boolean);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const script = (dir, name, body) => { mkdirSync(join(base, dir), { recursive: true }); const p = join(base, dir, name); writeFileSync(p, `#!/bin/sh\n${body}`); chmodSync(p, 0o755); return p; };
/** A fake login shell named bash: `rc` runs first (what a user's start-up files would do), then the
 *  real `-c` command (the kernel's emitter) unless `rc` ends the script itself. */
let shells = 0;
const fakeShell = (rc) => script(`shell-${++shells}`, "bash", `${rc}\nexec /bin/sh -c "$4"\n`);
// What a user's rc sets: the fixture's HOME and a plain shell (so a server's hq pane never starts a
// real one), a marker, and a PATH of its own.
const LOGIN_PATH = `/fixture/login/bin:${SYSTEM}`;
const RC = `export HOME=${shq(HOME)} SHELL=/bin/sh LOGIN_MARKER='from the login shell' PATH=${shq(LOGIN_PATH)}`;
// The user session, as systemd prints it: a plain value, two C-escaped ones (one that decodes, one
// that does not), and names a creator also has.
const SYSTEMD_OUTPUT = join(base, "systemd-output.txt");
writeFileSync(SYSTEMD_OUTPUT, ["WAYLAND_DISPLAY=wayland-fixture", "XDG_RUNTIME_DIR=$'/run/fixture/\\303\\251t\\x41'", "DBUS_SESSION_BUS_ADDRESS=$'bad\\q'", "SSH_AUTH_SOCK=/platform/agent.sock", "DISPLAY=:9", "UNRELATED=x", ""].join("\n"));
const session = (dir, systemctl) => { script(dir, "systemctl", systemctl); script(dir, "launchctl", "exit 0\n"); return join(base, dir); };
const platformBin = session("platform-bin", `exec ${CAT} ${shq(SYSTEMD_OUTPUT)}\n`);
const failingPlatformBin = session("platform-failing-bin", "exit 1\n");
const CREATOR = { PATH: `${platformBin}:${SYSTEM}`, CREATOR_ONLY: "ambient", OATS_FIXTURE_CREATOR: "creator", AWEB_FIXTURE_TOKEN: "s3cret", CLAUDE_FIXTURE_TOKEN: "s3cret", LANG: "C.UTF-8" };

const tmuxOn = (socket, ...args) => execFileSync(TMUX, ["-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const globalEnv = (socket = OATS) => Object.fromEntries(lines(tmuxOn(socket, "show-environment", "-g")).filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
async function killServer(socket = OATS) {
  let pid;
  try { pid = Number(tmuxOn(socket, "display-message", "-p", "#{pid}")); } catch { return; }
  tmuxOn(socket, "kill-server");
  await waitUntil(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, `the server on ${socket} has exited`);
}
const ensureScript = `import(${JSON.stringify(CORE)}).then((core) => process.stdout.write(core.ensureOatsTmuxSession("login", ${JSON.stringify(base)}))).catch((e) => { process.stdout.write(JSON.stringify({ code: e.code, message: e.message })); process.exit(1); })`;
/** One process that creates the session (and so the server) with `env` over the fixture's, which
 *  holds none of the session variables (the worker's own are not the test's). */
async function ensureIn(env, { cwd = base } = {}) {
  await killServer();
  const fixture = { ...process.env };
  for (const name of LOGIN_SESSION_ENV) delete fixture[name];
  return spawnSync(process.execPath, ["-e", ensureScript], { cwd, env: { ...fixture, PWD: cwd, ...env }, encoding: "utf8", timeout: 30000 });
}
const created = (r) => { assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(r.stdout, OATS, "the server is the fixture's own"); return globalEnv(); };
const warnings = (r) => lines(r.stderr).filter((l) => l.startsWith("oats: "));
const VALUES = /s3cret|ambient|from the login shell|\/fixture\/|wayland-fixture|agent\.sock|run\/fixture/;
/** The fallback of a creator outside every instance: its own environment, and exactly one line that
 *  says why, with no value in it. */
function fellBack(r, why) {
  const server = created(r);
  const said = warnings(r);
  assert.equal(said.length, 1, r.stderr);
  assert.equal(said[0], `oats: warning: could not read your login environment (${why}); the OATS tmux server is started with this process's own environment instead: a fallback, neither a login environment nor a working agent socket is assured`);
  assert.doesNotMatch(r.stderr, VALUES, "no value is printed");
  assert.equal(server.CREATOR_ONLY, "ambient", "the creator's own environment");
  assert.equal(server.LOGIN_MARKER, undefined, "nothing of a rejected answer");
  return server;
}
const groupGone = (pidFile) => waitUntil(() => { const pid = Number(readFileSync(pidFile, "utf8").trim()); try { process.kill(pid, 0); return false; } catch { return true; } }, `the process ${pidFile} names is gone`);

const fx = v2Deployment();
const baselineOf = (home) => join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);
/** An instance home recorded as launched on `socket`. */
async function instanceOn(name, socket) {
  const path = process.env.PATH;
  process.env.PATH = fx.env.PATH;
  let home;
  try { ({ home } = await fx.spawn("dev", { name, harness: "claude" })); } finally { process.env.PATH = path; }
  writeFileSync(join(home, "instance.json"), JSON.stringify({ ...readJson(join(home, "instance.json")), tmux: { session: "login", window: name, socket }, launched: true }, null, 2) + "\n");
  writeFileSync(baselineOf(home), JSON.stringify({ ...readJson(baselineOf(home)), runtime: { launched: true, tmux: { session: "login", window: name, socket } } }, null, 2) + "\n", { mode: 0o600 });
  return home;
}

test.after(async () => {
  await killServer();
  restoreEnvironment();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  fx.cleanup();
});

test("the login shell's answer becomes the server's environment: nothing of the creator's own (no OATS_, AWEB_ or CLAUDE_ name, nothing ambient) but what the seed carries, and the server is reached with the creator's TMUX_TMPDIR", async () => {
  const r = await ensureIn({ ...CREATOR, OATS_TEST_LOGIN_SHELL: fakeShell(RC) });
  const server = created(r);
  assert.deepEqual(warnings(r), [], r.stderr);
  assert.equal(server.LOGIN_MARKER, "from the login shell");
  assert.equal(server.PATH, LOGIN_PATH);
  assert.equal(server.HOME, HOME);
  assert.equal(server.TERM, "dumb", "the seed's");
  assert.equal(server.LANG, "C.UTF-8", "the creator's locale is in the seed");
  assert.equal(server.TMUX_TMPDIR, process.env.TMUX_TMPDIR, "the creator's");
  assert.equal(server.CREATOR_ONLY, undefined);
  assert.deepEqual(Object.keys(server).filter((name) => /^(OATS_|AWEB_|CLAUDE|PI_AGENT)/.test(name)), [], "no creator's OATS_, AWEB_ or CLAUDE_ name");
});

test("a noisy start-up (text on stdout and stderr, some shaped like assignments or JSON) is not the answer: only the data descriptor is", async () => {
  const noise = `echo 'PATH=/evil; export PATH'; echo '{"PATH":"/evil","HOME":"/evil"}'; echo 'HOME=/evil' >&2; printf 'bash: no job control in this shell\\n' >&2`;
  const r = await ensureIn({ ...CREATOR, OATS_TEST_LOGIN_SHELL: fakeShell(`${noise}\n${RC}\n${noise}`) });
  const server = created(r);
  assert.deepEqual(warnings(r), [], r.stderr);
  assert.equal(server.PATH, LOGIN_PATH);
  assert.equal(server.HOME, HOME);
  assert.doesNotMatch(JSON.stringify(server), /\/evil/);
});

test("an answer that is not whole is rejected whole, and the creator falls back to its own environment with one line that holds no value: oversize, partial, not an object, a value that is not text, a bad name, no HOME, no PATH, a non-zero exit, an unsupported shell, a shell that cannot run", async (t) => {
  const node = shq(process.execPath);
  const answer = (json) => `${RC}\nprintf '%s' ${shq(json)} >&3\nexit 0`;
  const cases = [
    ["oversize", `${RC}\nexec ${node} -e 'require("fs").writeSync(3, JSON.stringify({ HOME: "/h", PATH: "/p", BIG: "x".repeat(2 * 1024 * 1024) }))'`, "its answer was larger than 1 MiB"],
    ["partial", answer('{"HOME":"/h","PATH":"/p'), "its answer was not one complete JSON object"],
    ["not an object", answer('["HOME","/h"]'), "its answer was not one complete JSON object"],
    ["two objects", answer('{"HOME":"/h","PATH":"/p"}{"X":"y"}'), "its answer was not one complete JSON object"],
    ["not text", answer('{"HOME":"/h","PATH":"/p","N":1}'), "its answer held a value that is not text"],
    ["bad name", answer('{"HOME":"/h","PATH":"/p","BAD-NAME":"v"}'), "its answer held a name that is not a plain identifier"],
    ["no HOME", answer('{"PATH":"/p"}'), "its answer had no HOME"],
    ["no PATH", answer('{"HOME":"/h"}'), "its answer had no PATH"],
    ["no answer", `${RC}\nexit 0`, "your login shell gave no answer"],
    ["non-zero exit", `${RC}\n/bin/sh -c "$4"\nexit 3`, "your login shell exited with status 3"],
  ];
  for (const [what, rc, why] of cases) {
    const shell = script(`shell-${++shells}`, "bash", `${rc}\n`);
    t.diagnostic(what);
    fellBack(await ensureIn({ ...CREATOR, OATS_TEST_LOGIN_SHELL: shell }), why);
  }
  const sh = script(`shell-${++shells}`, "sh", `${RC}\nexec /bin/sh -c "$4"\n`);
  fellBack(await ensureIn({ ...CREATOR, OATS_TEST_LOGIN_SHELL: sh }), "your login shell (sh) is not bash, zsh or fish");
  fellBack(await ensureIn({ ...CREATOR, OATS_TEST_LOGIN_SHELL: join(base, "nowhere", "zsh") }), "your login shell could not be started (ENOENT)");
});

test("the deadline: a login shell that does not answer, and one that exits while a descendant keeps the data descriptor open, are both ended at 5 s, their process group is killed, and the creator falls back", async () => {
  const hanging = join(base, "hanging.pid"), holding = join(base, "holding.pid");
  let r = await ensureIn({ ...CREATOR, OATS_TEST_LOGIN_SHELL: script(`shell-${++shells}`, "bash", `echo $$ > ${shq(hanging)}\nexec ${SLEEP} 60\n`) });
  fellBack(r, "your login shell did not answer within 5 s");
  await groupGone(hanging);
  const started = Date.now();
  r = await ensureIn({ ...CREATOR, OATS_TEST_LOGIN_SHELL: script(`shell-${++shells}`, "bash", `${RC}\n${SLEEP} 60 &\necho $! > ${shq(holding)}\nprintf '{"HOME":"/h",' >&3\nexit 0\n`) });
  fellBack(r, "your login shell did not answer within 5 s");
  assert.ok(Date.now() - started < 20000, "the read ended at the deadline, not when the descendant would have");
  await groupGone(holding);
});

test("session variables in the seed, per name from the first source that has it: the creator (a present empty value counts), then the user session, where systemd's C-escaped values are decoded and one that cannot be is absent", { skip: process.platform !== "linux" && "systemd's user session is Linux's" }, async () => {
  const r = await ensureIn({ ...CREATOR, SSH_AUTH_SOCK: "/creator/agent.sock", DISPLAY: "", OATS_TEST_LOGIN_SHELL: fakeShell(RC) });
  const server = created(r);
  assert.deepEqual(warnings(r), [], r.stderr);
  assert.equal(server.SSH_AUTH_SOCK, "/creator/agent.sock", "the creator's, before the session's");
  assert.equal(server.DISPLAY, "", "present and empty: the creator's, not the session's");
  assert.equal(server.WAYLAND_DISPLAY, "wayland-fixture", "absent from the creator: the session's");
  assert.equal(server.XDG_RUNTIME_DIR, "/run/fixture/étA", "a $'…' value, decoded");
  assert.equal("DBUS_SESSION_BUS_ADDRESS" in server, false, "a value that cannot be decoded is absent");
  assert.equal("UNRELATED" in server, false, "only the session variables are taken from the session");
  // What the login shell sets wins over the seed.
  const own = await ensureIn({ ...CREATOR, SSH_AUTH_SOCK: "/creator/agent.sock", OATS_TEST_LOGIN_SHELL: fakeShell(`${RC} SSH_AUTH_SOCK=/rc/agent.sock`) });
  assert.equal(created(own).SSH_AUTH_SOCK, "/rc/agent.sock");
});

test("a user session that cannot be read leaves its names absent and is noted without values; the login environment is still used", { skip: process.platform !== "linux" && "systemd's user session is Linux's" }, async () => {
  const r = await ensureIn({ ...CREATOR, PATH: `${failingPlatformBin}:${SYSTEM}`, OATS_TEST_LOGIN_SHELL: fakeShell(RC) });
  const server = created(r);
  assert.deepEqual(warnings(r), ["oats: warning: could not read the user session's environment (systemctl --user show-environment exited with status 1); SSH_AUTH_SOCK, DISPLAY, WAYLAND_DISPLAY, XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS came only from your login shell"]);
  assert.equal(server.LOGIN_MARKER, "from the login shell");
  for (const name of ["SSH_AUTH_SOCK", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) assert.equal(name in server, false, name);
});

test("systemd's show-environment is read as data: plain values as they are, $'…' values decoded as bytes then UTF-8, anything else of that form absent", () => {
  const names = ["A", "B", "C", "D", "E", "F", "G"];
  assert.deepEqual(parseSystemdEnvironment([
    "A=plain value", "B=$'tab\\there\\nnew \\'q\\' \\\\ \\x41\\101'", "C=$'\\303\\251'", "D=$'\\377'", "E=$'unterminated", "F=$'bad\\z'", "G=", "H=not asked", "=noname", "",
  ].join("\n"), names), { A: "plain value", B: "tab\there\nnew 'q' \\ AA", C: "é", G: "" });
});

test("an instance: the session variables come from the server its home records, never its own; when its login environment cannot be read it copies that server, or is refused, never its ambient environment", { skip: process.platform !== "linux" && "the session part reads systemd's user session" }, async () => {
  const other = join(base, "recorded.sock");
  tmuxOn(other, "new-session", "-d", "-s", "elsewhere", "-n", "hq", "-c", base);
  tmuxOn(other, "set-environment", "-g", "SSH_AUTH_SOCK", "/recorded/agent.sock");
  tmuxOn(other, "set-environment", "-g", "RECORDED_MARKER", "from the recorded server");
  tmuxOn(other, "set-environment", "-g", "SHELL", "/bin/sh");
  const home = await instanceOn("login-caller", other);
  const as = { ...CREATOR, SSH_AUTH_SOCK: "/creator/agent.sock", OATS_INSTANCE: "login-caller", OATS_INSTANCE_HOME: home };
  try {
    // Read: the login environment, with the recorded server's session variables and the user
    // session's for the rest.
    let r = await ensureIn({ ...as, OATS_TEST_LOGIN_SHELL: fakeShell(RC) });
    let server = created(r);
    assert.equal(server.LOGIN_MARKER, "from the login shell");
    assert.equal(server.SSH_AUTH_SOCK, "/recorded/agent.sock", "the recorded server's, not the instance's own");
    assert.equal(server.DISPLAY, ":9", "the user session's: an instance's own is never a source");
    assert.equal(server.RECORDED_MARKER, undefined, "the rest of the recorded server is not copied when the login environment is read");
    assert.equal(server.CREATOR_ONLY, undefined);
    assert.equal(server.OATS_INSTANCE_HOME, undefined);
    // Not read: a copy of the recorded server, said in one line.
    r = await ensureIn({ ...as, OATS_TEST_LOGIN_SHELL: script(`shell-${++shells}`, "bash", "exit 1\n") });
    server = created(r);
    assert.deepEqual(warnings(r), ["oats: warning: could not read your login environment (your login shell exited with status 1); the OATS tmux server is started with a copy of the environment of the tmux server this instance's home records instead: a fallback, neither a login environment nor a working agent socket is assured"]);
    assert.equal(server.RECORDED_MARKER, "from the recorded server");
    assert.equal(server.CREATOR_ONLY, undefined, "never the instance's ambient environment");
    assert.equal(server.SSH_AUTH_SOCK, "/recorded/agent.sock");
  } finally { await killServer(other); }
  // Not read, and the recorded server is gone: refused, no server started.
  const r = await ensureIn({ ...as, OATS_TEST_LOGIN_SHELL: script(`shell-${++shells}`, "bash", "exit 1\n") });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const refusal = JSON.parse(r.stdout);
  assert.equal(refusal.code, "E_RUNTIME_ENDPOINT_UNKNOWN");
  assert.match(refusal.message, /the environment of the tmux server that login-caller is recorded on \(.*recorded\.sock\) could not be read/);
  assert.deepEqual(warnings(r), ["oats: warning: could not read your login environment (your login shell exited with status 1); and there is no fallback from inside an instance"]);
  assert.throws(() => tmuxOn(OATS, "list-sessions"), "no server was started");
});

test("--json stdout stays one valid envelope whatever the login shell prints, and the fallback line goes to stderr", async () => {
  const probeBin = join(base, "probe-bin");
  mkdirSync(probeBin, { recursive: true });
  writeFileSync(join(probeBin, "claude"), `#!/bin/sh\nexec ${SLEEP} 600\n`);
  chmodSync(join(probeBin, "claude"), 0o755);
  const noisy = `echo '{"ok":false}'; echo 'not json' >&2`;
  for (const [what, shell, fallback] of [["read", fakeShell(`${noisy}\n${RC} PATH=${shq(`${probeBin}:${SYSTEM}`)}`), false], ["not read", script(`shell-${++shells}`, "bash", `${noisy}\nexit 2\n`), true]]) {
    await killServer();
    const r = fx.cli(["spawn", "dev", "--name", `json-${what.replace(" ", "-")}`, "--harness", "claude", "--json"], { env: { ...CREATOR, PATH: `${probeBin}:${platformBin}:${SYSTEM}`, OATS_TEST_LOGIN_SHELL: shell, OATS_TMUX_SESSION: "json", PI_AGENTS_TMUX_SESSION: "json" } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const envelope = JSON.parse(r.stdout); // the whole of stdout: one envelope
    assert.equal(envelope.ok, true, what);
    assert.deepEqual(warnings(r).map((l) => /could not read your login environment/.test(l)), fallback ? [true] : [], `${what}: ${r.stderr}`);
  }
});
