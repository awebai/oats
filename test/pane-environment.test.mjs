// The checks of a launch read the environment its pane will have (awebai/oats#993): the folder-trust
// check, the harness-package gate and the remedy it prints, the `harness-trust` readiness item and
// `oats harness trust` read HOME and the three selectors (CLAUDE_CONFIG_DIR, CODEX_HOME,
// PI_CODING_AGENT_DIR) where the harness lookup reads PATH (#616, test/pane-path.test.mjs), never
// from the process that runs the command. docs/execution-targets.md owns the rule.
//
// What a check read is seen in what it says (the file its warning names, the account its probe was
// run with); what the pane had, in the environment the harness recorded when it started.
//
// Real tmux, never the operator's: the fixture owns a private TMUX_TMPDIR, so `-L oats` is the
// fixture's own server, and it is killed by socket.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolateSessionEnvironment, oatsSocket, systemExecutable, waitUntil } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { launchEffectiveEnv, launchEnvironment } from "../lib/core.mjs";

// Found on the caller's PATH: the isolated PATH links only the fixture's own tools.
const MV = systemExecutable("mv"), LS = systemExecutable("ls");
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-pane-env-")));
const restoreEnvironment = isolateSessionEnvironment(base);
const OATS = oatsSocket();
const SYSTEM = join(base, "system-bin"); // the fixture's tools, its tmux wrapper among them
const TMUX = join(SYSTEM, "tmux");
const ENV = systemExecutable("env"), SLEEP = systemExecutable("sleep"), CAT = systemExecutable("cat");
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const lines = (text) => text.split("\n").filter(Boolean);
const envOf = (text) => Object.fromEntries(lines(text).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

const bin = (name, files) => {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) { writeFileSync(join(dir, file), body); chmodSync(join(dir, file), 0o755); }
  return dir;
};
// The harness. Started in a pane, it records the environment it started with, then idles (its pid
// file appears whole). Asked for its plugins (the package probe), it records the environment it was
// probed with, counts the probe, and answers with the plugins of the account that environment
// selects: $CLAUDE_CONFIG_DIR/plugins.json, else $HOME/plugins.json.
const HARNESS = `#!/bin/sh
if [ "$1" = plugin ]; then
  ${ENV} > "$FIXTURE_PROBE_LOG"
  echo probe >> "$FIXTURE_PROBE_LOG.count"
  exec ${CAT} "\${CLAUDE_CONFIG_DIR:-$HOME}/plugins.json"
fi
${ENV} > "$OATS_INSTANCE_HOME/pane-env.txt"
echo $$ > "$OATS_INSTANCE_HOME/harness-ready.tmp"
${MV} "$OATS_INSTANCE_HOME/harness-ready.tmp" "$OATS_INSTANCE_HOME/harness-ready"
exec ${SLEEP} 600
`;
const probeBin = bin("probe-bin", { claude: HARNESS, codex: HARNESS });
const SERVER_PATH = `${probeBin}:${SYSTEM}`;
// A tmux in front of the fixture's: it logs every show-environment (the reads of a pane's
// environment), and fails them when FIXTURE_FAIL_SHOW_ENVIRONMENT is set.
const SHOWN = join(base, "show-environment.log");
const front = bin("front-bin", { tmux: `#!/bin/sh
case " $* " in *" show-environment "*)
  echo "$*" >> ${shq(SHOWN)}
  [ -n "$FIXTURE_FAIL_SHOW_ENVIRONMENT" ] && exit 1 ;;
esac
exec ${shq(TMUX)} "$@"
` });
const shown = () => { try { return lines(readFileSync(SHOWN, "utf8")); } catch { return []; } };
// A tmux that cannot ask the server whether it runs: its list-sessions is refused, or cut off
// (FIXTURE_LIST_SESSIONS=cut). Everything else is the fixture's tmux.
const unasked = bin("unasked-bin", { tmux: `#!/bin/sh
case " $* " in *" list-sessions "*)
  [ "$FIXTURE_LIST_SESSIONS" = cut ] && kill -TERM $$
  echo 'permission denied' >&2
  exit 1 ;;
esac
exec ${shq(TMUX)} "$@"
` });
// `ls`, which the trust writer reads a file's security context with: the isolated PATH has none.
const lsBin = join(base, "ls-bin");
mkdirSync(lsBin);
symlinkSync(LS, join(lsBin, "ls"));

// Harness accounts: a folder with Claude's and Codex's configuration files and a plugin list. Each
// starts untrusted and with no plugin.
const PLUGIN = "chan@market";
const DEP = { path: null };
function account(dir) {
  mkdirSync(join(dir, ".codex"), { recursive: true });
  const at = { dir, claude: join(dir, ".claude.json"), codex: join(dir, ".codex", "config.toml") };
  at.trust = (trusted) => {
    writeFileSync(at.claude, JSON.stringify(trusted ? { projects: { [DEP.path]: { hasTrustDialogAccepted: true } } } : {}));
    writeFileSync(at.codex, trusted ? `[projects.${JSON.stringify(DEP.path)}]\ntrust_level = "trusted"\n` : "");
    return at;
  };
  at.plugin = (installed) => { writeFileSync(join(dir, "plugins.json"), JSON.stringify(installed ? [{ id: PLUGIN, scope: "user", enabled: true }] : [])); return at; };
  return at;
}
const ACCOUNTS = join(base, "accounts");
const spawnerAccount = account(join(ACCOUNTS, "spawner")), serverAccount = account(join(ACCOUNTS, "server")), sessionAccount = account(join(ACCOUNTS, "session")),
  configAccount = account(join(ACCOUNTS, "config")), loginAccount = account(join(ACCOUNTS, "login")), winnerAccount = account(join(ACCOUNTS, "winner"));

const fx = v2Deployment({
  souls: {
    dev: {},
    gated: { soul: { capabilities: { "test.chan": { from: "here" } } } },
    racer: { soul: { capabilities: { "test.chan": { from: "here" }, "test.racer": { from: "here" } } } },
  },
  capabilities: {
    // A capability that needs a Claude plugin: the package gate probes for it.
    "test.chan": { manifest: { layer: "tasks", requires: [{ harness: "claude", package: PLUGIN }] } },
    // A spawn hook that creates the spawn's session first, with its own account: another creator
    // that wins the race between the spawn's plan and its creation.
    "test.racer": { manifest: { layer: "knowledge", hooks: { spawn: "spawn.mjs" } }, files: { "spawn.mjs": `import { execFileSync } from "node:child_process";
if (process.env.RACE_SESSION) execFileSync(${JSON.stringify(TMUX)}, ["-L", "oats", "new-session", "-d", "-s", process.env.RACE_SESSION, "-n", "hq"], { env: { HOME: process.env.RACE_HOME, TMUX_TMPDIR: process.env.TMUX_TMPDIR, PATH: process.env.RACE_PATH, SHELL: "/bin/sh", LANG: "C.UTF-8", CLAUDE_CONFIG_DIR: process.env.RACE_ACCOUNT }, stdio: "ignore", timeout: 10000 });
process.stdout.write("{}\\n");
` } },
  },
  local: {
    // A readiness read of the soul reports claude's trust.
    souls: { launch: { dev: { harness: "claude" } } },
    "launch-configs": {
      own: { harness: "claude", env: { CLAUDE_CONFIG_DIR: configAccount.dir } },
      both: { harness: "claude", env: { PATH: SERVER_PATH, CLAUDE_CONFIG_DIR: configAccount.dir } },
      withpath: { harness: "claude", env: { PATH: SERVER_PATH } },
      referenced: { harness: "claude", env: { CLAUDE_CONFIG_DIR: { fromEnv: "FIXTURE_ACCOUNT" } } },
      absolute: { harness: "claude", executable: join(probeBin, "claude") },
    },
  },
});
DEP.path = realpathSync(fx.dep);
// The two homes: the spawning process's (the fixture's) and the server's (this worker's). They differ.
const spawnerHome = account(fx.env.HOME), serverHome = account(process.env.HOME);
const everyAccount = [spawnerAccount, serverAccount, sessionAccount, configAccount, loginAccount, winnerAccount, spawnerHome, serverHome];
const reset = () => { for (const a of everyAccount) a.trust(false).plugin(false); rmSync(SHOWN, { force: true }); rmSync(PROBE_LOG, { force: true }); rmSync(`${PROBE_LOG}.count`, { force: true }); };
const PROBE_LOG = join(base, "probe-env.txt");
process.env.FIXTURE_PROBE_LOG = PROBE_LOG; // an in-process spawn's probe records there too
const probed = () => envOf(readFileSync(PROBE_LOG, "utf8"));
const probes = () => { try { return lines(readFileSync(`${PROBE_LOG}.count`, "utf8")).length; } catch { return 0; } };

const tmuxOn = (...args) => execFileSync(TMUX, ["-u", "-S", OATS, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
async function killServer() {
  let pid;
  try { pid = Number(tmuxOn("display-message", "-p", "#{pid}")); } catch { return; }
  tmuxOn("kill-server");
  await waitUntil(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, "the fixture's oats server has exited");
}
/** A fresh OATS server whose global environment is the server's HOME, SERVER_PATH and `env`, with session `session`. */
async function startServer(env = {}, session = "base") {
  await killServer();
  execFileSync(TMUX, ["-L", "oats", "new-session", "-d", "-s", session, "-n", "hq", "-c", base], { env: { HOME: serverHome.dir, TMUX_TMPDIR: process.env.TMUX_TMPDIR, SHELL: "/bin/sh", LANG: "C.UTF-8", PATH: SERVER_PATH, ...env }, stdio: "ignore", timeout: 10000 });
}
const newSession = (session) => tmuxOn("new-session", "-d", "-s", session, "-n", "hq", "-c", base);
/** The CLI as a process whose HOME is the spawner's and whose PATH holds the harness too. */
const cli = (args, { session = "base", env = {}, cwd } = {}) => fx.cli(args, { ...(cwd ? { cwd } : {}), env: { OATS_TMUX_SESSION: session, PI_AGENTS_TMUX_SESSION: session, LANG: "C.UTF-8", PATH: SERVER_PATH, FIXTURE_PROBE_LOG: PROBE_LOG, ...env } });
const spawn = (name, { soul = "dev", config, harness = "claude", extra = [], ...at } = {}) => cli(["spawn", soul, "--name", name, ...(config ? ["--launch-config", config] : ["--launch-config", "none", "--harness", harness]), ...extra, "--json"], at);
const spawned = (r) => { assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result; };
const ready = (home) => waitUntil(() => existsSync(join(home, "harness-ready")), `${home} harness started`);
const paneEnv = (home) => envOf(readFileSync(join(home, "pane-env.txt"), "utf8"));
const homeOf = (name, soul = "dev") => join(fx.root, soul, "instances", name);
/** A refused spawn: nothing left behind, and its message. `code` for the refusals `oats spawn` answers
 *  under their own code (a launch's); the package gate's it answers as a failed spawn, so the gate's
 *  codes are read from the kernel's own error (the in-process test below). */
function refused(r, name, code, soul = "gated") {
  assert.notEqual(r.status, 0, r.stdout);
  const error = r.json().error;
  if (code) assert.equal(error.code, code, error.message);
  assert.equal(existsSync(homeOf(name, soul)), false, "nothing is left of the spawn");
  return error.message;
}
const trustWarning = (file, from, harness = "claude") => `${harness} folder trust is not established in ${file}${from ? ` (${from})` : ""}: oats harness trust --dir ${DEP.path}`;
const trustWarnings = (result) => (result.warnings || []).filter((w) => /folder trust/.test(w));
const serverGlobal = (name) => `the global ${name} of the OATS tmux server (${OATS})`;
/** A fake login shell (OATS_TEST_LOGIN_SHELL, named bash; never the operator's): the server's HOME
 *  and PATH, and the login's own account. */
function loginShell() {
  const dir = join(base, "login-shell");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "bash"), `#!/bin/sh\nexport HOME=${shq(serverHome.dir)} SHELL=/bin/sh PATH=${shq(SERVER_PATH)} CLAUDE_CONFIG_DIR=${shq(loginAccount.dir)}\nexec /bin/sh -c "$4"\n`);
  chmodSync(join(dir, "bash"), 0o755);
  return join(dir, "bash");
}
const harnessTrustItem = (r) => { assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result.checks.configured.items.find((i) => i.code === "harness-trust"); };

test.after(async () => {
  await killServer();
  restoreEnvironment();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  fx.cleanup();
});
test.beforeEach(reset);

test("case A: the server runs without a CLAUDE_CONFIG_DIR and the spawner has its own: the checks read the default file under the server's HOME, as the pane does, whether an operator or an instance spawns", async () => {
  await startServer();
  const parent = spawned(spawn("a-parent"));
  for (const [name, identity] of [["a-operator", {}], ["a-child", { OATS_INSTANCE: "a-parent", OATS_INSTANCE_HOME: parent.home }]]) {
    const env = { ...identity, CLAUDE_CONFIG_DIR: spawnerAccount.dir };
    // Folder trust: the warning names the pane's file, and where its HOME comes from.
    spawnerAccount.trust(true); serverHome.trust(false);
    let child = spawned(spawn(name, { env }));
    assert.deepEqual(trustWarnings(child), [trustWarning(serverHome.claude, `under ${serverGlobal("HOME")}`)], `${name}: the pane's file, not the spawner's trusted one`);
    await ready(child.home);
    assert.equal(paneEnv(child.home).CLAUDE_CONFIG_DIR, undefined, `${name}: the pane has no selector`);
    assert.equal(paneEnv(child.home).HOME, serverHome.dir, `${name}: the pane's HOME is the server's`);
    // Trusted there, untrusted at the spawner's: no warning.
    spawnerAccount.trust(false); serverHome.trust(true);
    assert.deepEqual(trustWarnings(spawned(spawn(`${name}-trusted`, { env }))), []);
    // The gate: the plugin is in the account the pane reads, not in the spawner's.
    serverHome.plugin(true); spawnerAccount.plugin(false);
    child = spawned(spawn(`${name}-gated`, { soul: "gated", env }));
    assert.equal(probed().CLAUDE_CONFIG_DIR, undefined, `${name}: the probe ran with no selector`);
    assert.equal(probed().HOME, serverHome.dir, `${name}: and with the pane's HOME`);
    assert.equal(probed().PATH, SERVER_PATH, `${name}: and the pane's PATH`);
    assert.equal(probed().DISABLE_TELEMETRY, "1", `${name}: and, for the probe's own run, no telemetry flush (#1246)`);
    // The other way round: refused, and the remedy starts with no selector.
    serverHome.plugin(false); spawnerAccount.plugin(true);
    const message = refused(spawn(`${name}-missing`, { soul: "gated", env }), `${name}-missing`);
    assert.match(message, /requires the claude package chan@market, which is not installed/);
    assert.equal(message.includes("CLAUDE_CONFIG_DIR="), false, `the remedy names no selector: ${message}`);
    assert.doesNotMatch(message, /not known to be the launch's/, "the probe read the pane's account, and the refusal says nothing else");
  }
});

test("cases B and C: the server holds a CLAUDE_CONFIG_DIR and the spawner has another, or none: the checks read the server's, and the remedy starts with it", async () => {
  await startServer({ CLAUDE_CONFIG_DIR: serverAccount.dir });
  for (const [name, env] of [["b", { CLAUDE_CONFIG_DIR: spawnerAccount.dir }], ["c", {}]]) {
    spawnerAccount.trust(true); spawnerHome.trust(true);
    const child = spawned(spawn(name, { env }));
    assert.deepEqual(trustWarnings(child), [trustWarning(serverAccount.claude, serverGlobal("CLAUDE_CONFIG_DIR"))], `${name}: the server's file`);
    await ready(child.home);
    assert.equal(paneEnv(child.home).CLAUDE_CONFIG_DIR, serverAccount.dir, `${name}: which is the pane's`);
    spawnerAccount.trust(false); spawnerHome.trust(false); serverAccount.trust(true);
    assert.deepEqual(trustWarnings(spawned(spawn(`${name}-trusted`, { env }))), []);
    serverAccount.trust(false);
    serverAccount.plugin(true); spawnerAccount.plugin(false); spawnerHome.plugin(false);
    spawned(spawn(`${name}-gated`, { soul: "gated", env }));
    assert.equal(probed().CLAUDE_CONFIG_DIR, serverAccount.dir, `${name}: the probe ran with the server's selector`);
    serverAccount.plugin(false); spawnerAccount.plugin(true); spawnerHome.plugin(true);
    const message = refused(spawn(`${name}-missing`, { soul: "gated", env }), `${name}-missing`);
    assert.ok(message.includes(`CLAUDE_CONFIG_DIR=${shq(serverAccount.dir)} `), `the remedy starts with the server's selector: ${message}`);
    assert.equal(message.includes(spawnerAccount.dir), false, "and never names the spawner's");
  }
});

test("case D: a launch configuration's CLAUDE_CONFIG_DIR decides, whatever the spawner and the server hold; with its PATH too, the folder-trust check and the lookup read nothing of tmux, the agent's scope reads the bus once, and the gate's read of HOME is that same one", async () => {
  await startServer({ CLAUDE_CONFIG_DIR: serverAccount.dir });
  const env = { CLAUDE_CONFIG_DIR: spawnerAccount.dir, PATH: `${front}:${SERVER_PATH}` };
  let child = spawned(spawn("d", { config: "own", env }));
  assert.deepEqual(trustWarnings(child), [trustWarning(configAccount.claude, "the CLAUDE_CONFIG_DIR of launch configuration own")]);
  await ready(child.home);
  assert.equal(paneEnv(child.home).CLAUDE_CONFIG_DIR, configAccount.dir);
  // PATH and the selector both from the configuration: neither the folder-trust check nor the lookup
  // needs the pane's environment. The agent's scope does (lib/tmux-server-scope.mjs agentScope): its
  // probe runs with the pane's XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS, which the configuration
  // does not set, so the session the spawn got is read once and the server once, and no more.
  rmSync(SHOWN, { force: true });
  child = spawned(spawn("d-both", { config: "both", env }));
  assert.deepEqual(trustWarnings(child), [trustWarning(configAccount.claude, "the CLAUDE_CONFIG_DIR of launch configuration both")]);
  assert.deepEqual(shown().map((l) => l.replace(/^.* show-environment /, "show-environment ")), ["show-environment -t =base -s", "show-environment -g -s"], "the scope's one read of the pane, session then server");
  // With a requirement the probe needs the pane's HOME: one read of the session and one of the server
  // before anything is created, and the same two on the session the spawn got, which the agent's
  // scope shares: no third read.
  configAccount.plugin(true);
  rmSync(SHOWN, { force: true });
  spawned(spawn("d-gated", { soul: "gated", config: "both", env }));
  assert.equal(probed().CLAUDE_CONFIG_DIR, configAccount.dir, "the probe ran with the configuration's selector");
  assert.equal(probed().HOME, serverHome.dir, "and the pane's HOME");
  assert.equal(shown().length, 4, `two scopes, read once each, twice: ${shown().join(" | ")}`);
  assert.equal(shown().filter((l) => l.includes(" -g ")).length, 2);
  assert.equal(probes(), 1, "the pane the spawn got is the one it expected: nothing is probed again");
});

test("case E: no server runs and the spawner starts it: the checks read the environment the server is created with, the spawner's own when its login environment cannot be read, the login shell's when it can", async () => {
  await killServer();
  spawnerAccount.plugin(true);
  let child = spawned(spawn("e", { soul: "gated", session: "boot", env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir } }));
  assert.deepEqual(trustWarnings(child), [trustWarning(spawnerAccount.claude, serverGlobal("CLAUDE_CONFIG_DIR"))], "read again on the server the spawn created");
  assert.equal(probed().CLAUDE_CONFIG_DIR, spawnerAccount.dir);
  await ready(child.home);
  assert.equal(paneEnv(child.home).CLAUDE_CONFIG_DIR, spawnerAccount.dir, "the pane has the spawner's: the server was created with it");
  // The login environment answers: its account, never the spawner's.
  await killServer();
  loginAccount.plugin(true); spawnerAccount.plugin(false);
  child = spawned(spawn("e-login", { soul: "gated", session: "boot", env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir, OATS_TEST_LOGIN_SHELL: loginShell() } }));
  assert.equal(probed().CLAUDE_CONFIG_DIR, loginAccount.dir, "the gate read what the server is created with");
  assert.equal(trustWarnings(child).length, 1);
  assert.ok(trustWarnings(child)[0].startsWith(`claude folder trust is not established in ${loginAccount.claude} (`), trustWarnings(child)[0]);
  await ready(child.home);
  assert.equal(paneEnv(child.home).CLAUDE_CONFIG_DIR, loginAccount.dir);
  // The same plan with the plugin only in the spawner's account: refused before anything is created.
  await killServer();
  loginAccount.plugin(false); spawnerAccount.plugin(true);
  refused(spawn("e-missing", { soul: "gated", session: "boot", env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir, OATS_TEST_LOGIN_SHELL: loginShell() } }), "e-missing");
  assert.throws(() => tmuxOn("list-sessions"), "no server was started");
});

test("a session's selector: its entry decides over the server's; cleared, the launch has none and reads the default file, never the server's", async () => {
  await startServer({ CLAUDE_CONFIG_DIR: serverAccount.dir });
  newSession("own");
  tmuxOn("set-environment", "-t", "=own", "CLAUDE_CONFIG_DIR", sessionAccount.dir);
  let child = spawned(spawn("s-own", { session: "own" }));
  assert.deepEqual(trustWarnings(child), [trustWarning(sessionAccount.claude, "the CLAUDE_CONFIG_DIR of tmux session own")]);
  await ready(child.home);
  assert.equal(paneEnv(child.home).CLAUDE_CONFIG_DIR, sessionAccount.dir);
  newSession("cleared");
  tmuxOn("set-environment", "-t", "=cleared", "-r", "CLAUDE_CONFIG_DIR");
  assert.match(tmuxOn("show-environment", "-t", "=cleared", "-s"), /^unset CLAUDE_CONFIG_DIR;$/m);
  serverAccount.trust(true); serverAccount.plugin(true);
  child = spawned(spawn("s-cleared", { session: "cleared" }));
  assert.deepEqual(trustWarnings(child), [trustWarning(serverHome.claude, `under ${serverGlobal("HOME")}`)], "the default file, not the server's trusted account");
  await ready(child.home);
  assert.equal("CLAUDE_CONFIG_DIR" in paneEnv(child.home), false, "the pane has none");
  // The gate reads the same: the server's account has the plugin, the default one does not.
  const message = refused(spawn("s-cleared-gated", { soul: "gated", session: "cleared" }), "s-cleared-gated");
  assert.equal(message.includes("CLAUDE_CONFIG_DIR="), false, message);
  assert.equal(probed().CLAUDE_CONFIG_DIR, undefined);
});

test("a selector the strict reader leaves out: the gate refuses with E_RUNTIME_ENDPOINT_UNKNOWN, naming the name and where it was read; the folder-trust check warns and says nothing about trust; no value of the spawner or the server takes its place", async () => {
  await startServer({ CLAUDE_CONFIG_DIR: serverAccount.dir });
  newSession("odd");
  tmuxOn("set-environment", "-t", "=odd", "CLAUDE_CONFIG_DIR", `${ACCOUNTS}/$USER/claude`);
  // Every account but the unreadable one has the plugin and is trusted: any substitution would pass.
  for (const a of [serverAccount, spawnerAccount, spawnerHome, serverHome]) a.trust(true).plugin(true);
  const env = { CLAUDE_CONFIG_DIR: spawnerAccount.dir };
  const r = spawn("odd-gated", { soul: "gated", session: "odd", env });
  const message = refused(r, "odd-gated");
  assert.match(message, /^cannot verify the harness packages this claude launch requires: the CLAUDE_CONFIG_DIR of tmux session odd cannot be read as data \(its value holds a \$, a line break or a character tmux prints encoded\)\./);
  assert.match(message, /To make it readable: set CLAUDE_CONFIG_DIR in the launch configuration \(env\), or give tmux session odd a CLAUDE_CONFIG_DIR that OATS can read \(tmux -S \S+ set-environment -t '=odd' CLAUDE_CONFIG_DIR <value>\), or remove the entry \(tmux -S \S+ set-environment -t '=odd' -u CLAUDE_CONFIG_DIR\)/);
  for (const value of [spawnerAccount.dir, serverAccount.dir, "$USER"]) assert.equal((r.stdout + r.stderr).includes(value), false, `no value is printed: ${message}`);
  assert.equal(probes(), 0, "nothing was probed");
  // Without a requirement the spawn goes on, and the check says what it could not establish.
  const child = spawned(spawn("odd-trust", { session: "odd", env }));
  assert.equal(trustWarnings(child).length, 1);
  assert.match(trustWarnings(child)[0], /^claude folder trust: the configuration file this launch will read could not be established \(the CLAUDE_CONFIG_DIR of tmux session odd cannot be read as data .*\); nothing is said about its trust$/);
  // Another harness's selector in that state refuses nothing: it is left out of the probe's environment.
  newSession("other");
  tmuxOn("set-environment", "-t", "=other", "CODEX_HOME", `${ACCOUNTS}/$USER/codex`);
  spawned(spawn("other-gated", { soul: "gated", session: "other", env: { CODEX_HOME: spawnerAccount.dir } }));
  assert.equal(probed().CLAUDE_CONFIG_DIR, serverAccount.dir);
  assert.equal("CODEX_HOME" in probed(), false, "neither the unreadable value nor the spawner's");
});

test("a read of the pane's environment that fails: one refusal for one read (the PATH lookup's); with PATH from the launch configuration the selector's read fails alone and the gate refuses with its code; the folder-trust check only warns", async () => {
  await startServer({ CLAUDE_CONFIG_DIR: serverAccount.dir });
  for (const a of [serverAccount, spawnerAccount, spawnerHome, serverHome]) a.trust(true).plugin(true);
  const env = { PATH: `${front}:${SERVER_PATH}`, FIXTURE_FAIL_SHOW_ENVIRONMENT: "1", CLAUDE_CONFIG_DIR: spawnerAccount.dir };
  // The lookup needs the pane's PATH: it refuses, and nothing refuses after it.
  let message = refused(spawn("fail-path", { soul: "gated", env }), "fail-path", "E_HARNESS_UNAVAILABLE");
  assert.match(message, /the PATH of tmux session base could not be read/);
  assert.equal(/harness packages/.test(message), false, message);
  // PATH from the configuration: the lookup reads nothing, and the selector's read fails alone.
  message = refused(spawn("fail-selector", { soul: "gated", config: "withpath", env }), "fail-selector");
  assert.match(message, /^cannot verify the harness packages this claude launch requires: the HOME of tmux session base could not be read\. The probe runs with the HOME the launch's pane will have, never with this process's in its place; nothing was probed\./);
  assert.match(message, /To make it readable: set HOME in the launch configuration \(env\), or make `tmux -S \S+ show-environment -t '=base' -s` answer/);
  assert.equal(probes(), 0);
  assert.equal(message.includes(spawnerAccount.dir), false);
  // No requirement: the spawn goes on with a warning that makes no statement about trust.
  const child = spawned(spawn("fail-trust", { config: "withpath", env }));
  assert.equal(trustWarnings(child).length, 1);
  assert.match(trustWarnings(child)[0], /could not be established \(the CLAUDE_CONFIG_DIR of tmux session base could not be read: make `tmux -S \S+ show-environment -t '=base' -s` answer\); nothing is said about its trust$/);
});

test("a declared absolute executable in a session that clears PATH: launched as before when nothing is required; with a requirement the gate refuses, since its probe cannot be given the pane's PATH", async () => {
  await startServer({ CLAUDE_CONFIG_DIR: serverAccount.dir });
  newSession("nopath");
  tmuxOn("set-environment", "-t", "=nopath", "-r", "PATH");
  for (const a of [serverAccount, spawnerAccount]) a.trust(true).plugin(true);
  const at = { config: "absolute", session: "nopath", env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir } };
  // Nothing looks a declared absolute executable up, and with no requirement nothing probes: as before.
  const child = spawned(spawn("abs-plain", at));
  assert.deepEqual(trustWarnings(child), []);
  assert.equal(readJson(join(child.home, "instance.json")).launch.executable, join(probeBin, "claude"));
  // A requirement: the probe runs the same executable, and would run it with a PATH the pane does not have.
  const message = refused(spawn("abs-gated", { soul: "gated", ...at }), "abs-gated");
  assert.match(message, /^cannot verify the harness packages this claude launch requires: tmux session nopath clears PATH \(unset PATH\), so its panes start with no PATH at all\. The probe runs with the PATH the launch's pane will have, never with this process's in its place; nothing was probed\./);
  assert.match(message, /To make it readable: set PATH in the launch configuration \(env\), or give tmux session nopath a PATH that OATS can read \(tmux -S \S+ set-environment -t '=nopath' PATH <value>\)$/);
  assert.equal(probes(), 0);
});

test("the gate's codes, as the kernel raises them: E_HARNESS_RESOURCE_MISSING for a package the launch's account lacks, E_RUNTIME_ENDPOINT_UNKNOWN for a pane whose environment cannot be read", async () => {
  await startServer({ CLAUDE_CONFIG_DIR: serverAccount.dir });
  newSession("odd");
  tmuxOn("set-environment", "-t", "=odd", "CLAUDE_CONFIG_DIR", `${ACCOUNTS}/$USER/claude`);
  spawnerHome.plugin(true);
  const inProcess = (name, tmuxSession) => fx.spawn("gated", { name, harness: "claude", launchConfig: "none", launch: true, tmuxSession });
  await assert.rejects(inProcess("code-missing", "base"), (e) => e.code === "E_HARNESS_RESOURCE_MISSING" && e.message.includes(`CLAUDE_CONFIG_DIR=${shq(serverAccount.dir)} `));
  await assert.rejects(inProcess("code-unknown", "odd"), (e) => e.code === "E_RUNTIME_ENDPOINT_UNKNOWN" && /the CLAUDE_CONFIG_DIR of tmux session odd cannot be read as data/.test(e.message));
  assert.equal(existsSync(homeOf("code-missing", "gated")) || existsSync(homeOf("code-unknown", "gated")), false, "nothing was created");
});

test("a reference whose source is not set in the spawning process is refused as before (E_LAUNCH_ENV_MISSING); set, it is the launch's selector", async () => {
  await startServer({ CLAUDE_CONFIG_DIR: serverAccount.dir });
  refused(spawn("ref-missing", { soul: "dev", config: "referenced" }), "ref-missing", "E_LAUNCH_ENV_MISSING", "dev");
  const child = spawned(spawn("ref-set", { config: "referenced", env: { FIXTURE_ACCOUNT: configAccount.dir } }));
  assert.deepEqual(trustWarnings(child), [trustWarning(configAccount.claude, "the CLAUDE_CONFIG_DIR of launch configuration referenced (from FIXTURE_ACCOUNT)")]);
});

test("HOME differs between the spawner and the pane: codex's config.toml and Claude's default file are looked for under the pane's, and codex trusts the home by that file", async () => {
  await startServer();
  const command = (home) => readJson(join(home, "instance.json")).command;
  // Trusted under the spawner's HOME only: codex does not trust the home, and the warning names the pane's file.
  spawnerHome.trust(true);
  let child = spawned(spawn("codex-spawner", { harness: "codex" }));
  assert.deepEqual(trustWarnings(child), [trustWarning(serverHome.codex, `under ${serverGlobal("HOME")}`, "codex")]);
  assert.doesNotMatch(command(child.home), /trust_level/);
  // Trusted under the pane's HOME only: trusted, and no warning.
  spawnerHome.trust(false); serverHome.trust(true);
  child = spawned(spawn("codex-pane", { harness: "codex" }));
  assert.deepEqual(trustWarnings(child), []);
  assert.match(command(child.home), /trust_level="trusted"/);
  assert.deepEqual(trustWarnings(spawned(spawn("claude-pane"))), [], "Claude's default file is the one under the pane's HOME");
  // A start plans again from the home, by the same file: the pane's, whatever the caller's says.
  const planned = () => { const r = cli(["launch-config", "preview", "--home", child.home, "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result.argv.some((a) => /trust_level/.test(a)); };
  assert.equal(planned(), true, "trusted under the pane's HOME");
  spawnerHome.trust(true); serverHome.trust(false);
  assert.equal(planned(), false, "trusted under the caller's HOME only: the start does not trust the home");
});

test("codex's own selector: the pane's CODEX_HOME names the config.toml its folder trust is read from, whatever the spawner's names", async () => {
  await startServer({ CODEX_HOME: join(serverAccount.dir, ".codex") });
  const env = { CODEX_HOME: join(spawnerAccount.dir, ".codex") };
  const command = (home) => readJson(join(home, "instance.json")).command;
  // Trusted in the spawner's folder only: not trusted, and the warning names the pane's file.
  spawnerAccount.trust(true);
  let child = spawned(spawn("codex-selector", { harness: "codex", env }));
  assert.deepEqual(trustWarnings(child), [trustWarning(serverAccount.codex, serverGlobal("CODEX_HOME"), "codex")]);
  assert.doesNotMatch(command(child.home), /trust_level/);
  await ready(child.home);
  assert.equal(paneEnv(child.home).CODEX_HOME, join(serverAccount.dir, ".codex"), "the pane has the server's");
  // Trusted in the pane's folder only: trusted, and no warning.
  spawnerAccount.trust(false); serverAccount.trust(true);
  child = spawned(spawn("codex-selector-trusted", { harness: "codex", env }));
  assert.deepEqual(trustWarnings(child), []);
  assert.match(command(child.home), /trust_level="trusted"/);
});

test("each harness's probe runs with its own selector as the one answer gives it: the pane's value, none when the pane has none, the launch configuration's over both; refused when it cannot be read, and another harness's unreadable selector refuses nothing", () => {
  const SELECTOR = { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME", pi: "PI_CODING_AGENT_DIR" };
  const own = { PATH: "/process/bin", HOME: "/process/home", CLAUDE_CONFIG_DIR: "/process/claude", CODEX_HOME: "/process/codex", PI_CODING_AGENT_DIR: "/process/pi", OTHER: "kept" };
  const session = (name) => `the ${name} of tmux session s`;
  const pane = (answers) => ({ of: (name) => answers[name] ?? { absent: true, source: `tmux session s, which sets no ${name}` } });
  const established = { PATH: { value: "/pane/bin", source: session("PATH") }, HOME: { value: "/pane/home", source: session("HOME") } };
  for (const [harness, selector] of Object.entries(SELECTOR)) {
    const probe = (answers, configEnv = {}) => launchEffectiveEnv({ base: own, configEnv, harness,
      launch: launchEnvironment({ configEnv, configName: "c", env: own, pane: pane({ ...established, ...answers }) }) });
    // The pane's values, never this process's; every other name stays this process's.
    let env = probe({ [selector]: { value: "/pane/folder", source: session(selector) } });
    assert.deepEqual([env.PATH, env.HOME, env[selector], env.OTHER], ["/pane/bin", "/pane/home", "/pane/folder", "kept"], harness);
    // The pane has no selector: the probe has none, of any harness.
    env = probe({});
    for (const name of Object.values(SELECTOR)) assert.equal(name in env, false, `${harness}: ${name}`);
    // The launch configuration's decides over the pane's.
    assert.equal(probe({ [selector]: { value: "/pane/folder", source: session(selector) } }, { [selector]: "/config/folder" })[selector], "/config/folder", harness);
    // Its own selector cannot be read: refused, naming the name and the way out, and no value of this process.
    const unreadable = (name) => ({ source: session(name), problem: `${session(name)} cannot be read as data`, remedy: "give it one" });
    assert.throws(() => probe({ [selector]: unreadable(selector) }), (e) => e.code === "E_RUNTIME_ENDPOINT_UNKNOWN"
      && e.message === `cannot verify the harness packages this ${harness} launch requires: ${session(selector)} cannot be read as data. The probe runs with the ${selector} the launch's pane will have, never with this process's in its place; nothing was probed. To make it readable: set ${selector} in the launch configuration (env), or give it one`, harness);
    // Another harness's selector in that state: left out, and nothing is refused.
    for (const other of Object.values(SELECTOR).filter((name) => name !== selector)) {
      env = probe({ [other]: unreadable(other) });
      assert.equal(other in env, false, `${harness}: ${other} is neither an unreadable value nor this process's`);
    }
    // HOME cannot be read: refused for every harness.
    assert.throws(() => probe({ HOME: unreadable("HOME") }), (e) => e.code === "E_RUNTIME_ENDPOINT_UNKNOWN" && e.message.includes(`${session("HOME")} cannot be read as data`), harness);
  }
});

test("a start that reuses its recorded pane reads that pane's session: the gate judges the session's account, before the running harness is stopped", async () => {
  await startServer({ CLAUDE_CONFIG_DIR: serverAccount.dir });
  newSession("kept");
  tmuxOn("set-environment", "-t", "=kept", "CLAUDE_CONFIG_DIR", sessionAccount.dir);
  sessionAccount.plugin(true);
  const running = spawned(spawn("kept-running", { soul: "gated", session: "kept" }));
  await ready(running.home);
  const pid = Number(readFileSync(join(running.home, "harness-ready"), "utf8").trim());
  // Every other account has the plugin; the session's has lost it.
  for (const a of [serverAccount, spawnerAccount, spawnerHome, serverHome]) a.plugin(true);
  sessionAccount.plugin(false);
  const restart = () => cli(["session", "restart", "--home", running.home, "--harness", "claude", "--json"], { env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir } });
  let r = restart();
  assert.notEqual(r.status, 0, r.stdout);
  assert.equal(r.json().error.code, "E_HARNESS_RESOURCE_MISSING", r.json().error.message);
  assert.ok(r.json().error.message.includes(`CLAUDE_CONFIG_DIR=${shq(sessionAccount.dir)} `), r.json().error.message);
  assert.equal(probed().CLAUDE_CONFIG_DIR, sessionAccount.dir);
  assert.doesNotThrow(() => process.kill(pid, 0), "the running harness was not stopped");
  // The session's account has it again, and no other does: the restart goes on.
  for (const a of [serverAccount, spawnerAccount, spawnerHome, serverHome]) a.plugin(false);
  sessionAccount.plugin(true);
  r = restart();
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("a spawn that loses the server's creation to another creator is judged again on the session it got: its gate refuses and the spawn is rolled back when that account lacks the package, and its warning names that account's file", async () => {
  const race = (name, account) => cli(["spawn", "racer", "--name", name, "--launch-config", "none", "--harness", "claude", "--json"], { session: "race", env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir, RACE_SESSION: "race", RACE_PATH: SERVER_PATH, RACE_HOME: serverHome.dir, RACE_ACCOUNT: account.dir } });
  // The plan (no server: the spawner's own environment) finds the plugin; the winner's account has none.
  await killServer();
  spawnerAccount.plugin(true);
  const r = race("race-lost", winnerAccount);
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.json().error.message, /requires the claude package chan@market, which is not installed/);
  assert.match(r.json().error.message, /spawn rolled back/);
  assert.ok(r.json().error.message.includes(`CLAUDE_CONFIG_DIR=${shq(winnerAccount.dir)} `), r.json().error.message);
  assert.equal(probes(), 2, "the gate ran on the plan, then on the session the spawn got");
  assert.equal(existsSync(homeOf("race-lost", "racer")), false, "the home was removed");
  assert.deepEqual(lines(tmuxOn("list-windows", "-t", "=race", "-F", "#{window_name}")), ["hq"], "no window was left");
  // The winner's account has it too: the spawn goes on, and its warning is about the winner's file.
  await killServer();
  rmSync(`${PROBE_LOG}.count`, { force: true });
  winnerAccount.plugin(true);
  const child = spawned(race("race-won", winnerAccount));
  assert.equal(probes(), 2);
  assert.deepEqual(trustWarnings(child), [trustWarning(winnerAccount.claude, serverGlobal("CLAUDE_CONFIG_DIR"))]);
  await ready(child.home);
  assert.equal(paneEnv(child.home).CLAUDE_CONFIG_DIR, winnerAccount.dir);
});

test("oats readiness: the harness-trust item reads the pane's file when a server runs; with none it is unknown and says what it read instead; with an unreadable entry it is unknown and says nothing about trust", async () => {
  const item = (target, at = {}) => harnessTrustItem(cli(["readiness", ...target, "--json"], { env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir }, ...at }));
  await startServer({ CLAUDE_CONFIG_DIR: serverAccount.dir });
  spawnerAccount.trust(true);
  let i = item(["--soul", "dev"]);
  assert.deepEqual([i.status, i.required, i.file], ["fail", false, serverAccount.claude]);
  assert.equal(i.reason, trustWarning(serverAccount.claude, serverGlobal("CLAUDE_CONFIG_DIR")));
  spawnerAccount.trust(false); serverAccount.trust(true);
  i = item(["--soul", "dev"]);
  assert.deepEqual([i.status, i.file, i.reason], ["pass", serverAccount.claude, null]);
  // A home: its recorded pane's session.
  newSession("own");
  tmuxOn("set-environment", "-t", "=own", "CLAUDE_CONFIG_DIR", sessionAccount.dir);
  const child = spawned(spawn("ready-home", { session: "own" }));
  await ready(child.home);
  i = item(["--home", child.home]);
  assert.deepEqual([i.status, i.file], ["fail", sessionAccount.claude]);
  assert.equal(i.reason, trustWarning(sessionAccount.claude, "the CLAUDE_CONFIG_DIR of tmux session own"));
  // An unreadable entry: unknown, no file, no statement about trust.
  newSession("odd");
  tmuxOn("set-environment", "-t", "=odd", "CLAUDE_CONFIG_DIR", `${ACCOUNTS}/$USER/claude`);
  i = item(["--soul", "dev"], { session: "odd" });
  assert.deepEqual([i.status, i.required, i.file], ["unknown", false, null]);
  assert.match(i.reason, /^claude folder trust: the configuration file this launch will read could not be established \(the CLAUDE_CONFIG_DIR of tmux session odd cannot be read as data .*\); nothing is said about its trust$/);
  // No server: unknown, the file this process would read, and the sentence that says so.
  await killServer();
  const unestablished = "the pane's environment is not established until a spawn starts the OATS tmux server (none runs); read instead: this process's CLAUDE_CONFIG_DIR";
  i = item(["--soul", "dev"]);
  assert.deepEqual([i.status, i.required, i.file], ["unknown", false, spawnerAccount.claude]);
  assert.equal(i.reason, trustWarning(spawnerAccount.claude, unestablished));
  spawnerAccount.trust(true);
  i = item(["--soul", "dev"]);
  assert.deepEqual([i.status, i.file], ["unknown", spawnerAccount.claude]);
  assert.equal(i.reason, `claude folder trust is established in ${spawnerAccount.claude}; that file is this process's, not known to be the one a launch will read: ${unestablished}`);
  // The item is optional: its unknown changes neither its check nor the summary.
  const doc = cli(["readiness", "--soul", "dev", "--json"], { env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir } }).json().result;
  const required = doc.checks.configured.items.filter((x) => x.required).map((x) => x.status);
  assert.equal(doc.checks.configured.status, required.includes("fail") ? "fail" : required.includes("unknown") ? "unknown" : required.length ? "pass" : "not-applicable");
  assert.equal(doc.summary.unknown, Object.values(doc.checks).flatMap((c) => c.items).filter((x) => x.required && x.status === "unknown").length);
});

test("oats harness trust: the ambient file is the one a launch with no configuration reads; with no server it says what it read instead; an unreadable entry is refused with E_RUNTIME_ENDPOINT_UNKNOWN and nothing is written; a broken configuration keeps its code", async () => {
  const trust = (extra = [], at = {}) => cli(["harness", "trust", "--harness", "claude", ...extra, "--json"], { env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir, FIXTURE_ACCOUNT: configAccount.dir, PATH: `${SERVER_PATH}:${lsBin}` }, ...at });
  const ambient = (r) => r.json().result.entries.find((e) => e.ambient);
  await startServer({ CLAUDE_CONFIG_DIR: serverAccount.dir });
  let r = trust(["--plan"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(ambient(r).file, serverAccount.claude, "the server's account, not the caller's");
  assert.deepEqual(r.json().result.warnings, [`CLAUDE_CONFIG_DIR selects ${serverAccount.dir} (${serverGlobal("CLAUDE_CONFIG_DIR")}); effective file ${serverAccount.claude}`]);
  // It writes that file, and the launch's check then reads it as trusted.
  r = trust();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readJson(serverAccount.claude).projects[DEP.path].hasTrustDialogAccepted, true);
  assert.deepEqual(readJson(spawnerAccount.claude), {}, "the caller's own file was not written");
  assert.deepEqual(trustWarnings(spawned(spawn("trusted-after", { env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir } }))), []);
  // An unreadable entry: refused, with the plan in the details, and nothing written.
  newSession("odd");
  tmuxOn("set-environment", "-t", "=odd", "CLAUDE_CONFIG_DIR", `${ACCOUNTS}/$USER/claude`);
  r = trust([], { session: "odd" });
  assert.notEqual(r.status, 0, r.stdout);
  let error = r.json().error;
  assert.equal(error.code, "E_RUNTIME_ENDPOINT_UNKNOWN", error.message);
  assert.match(error.message, /^Harness trust targets cannot be established; nothing was written: the file a claude launch with no launch configuration reads could not be established: the CLAUDE_CONFIG_DIR of tmux session odd cannot be read as data/);
  assert.equal(error.details.operation, "harness-trust");
  assert.deepEqual(error.details.entries.filter((e) => e.ambient).map((e) => [e.status, e.file]), [["refused", null]]);
  assert.deepEqual(error.details.entries.filter((e) => !e.ambient).map((e) => e.file), [configAccount.claude], "the plan is still there, with the launch configurations' file");
  assert.deepEqual(readJson(spawnerAccount.claude), {}, "nothing was written, the caller's file least of all");
  assert.equal((r.stdout + r.stderr).includes(spawnerAccount.dir), false);
  // A target refused for its configuration in the same run: the configuration's code.
  const local = join(fx.dep, "oats-local.yaml"), before = readFileSync(local, "utf8");
  writeFileSync(local, before.replace("referenced:", "broken:\n    harness: claude\n    env:\n      CLAUDE_CONFIG_DIR: relative/dir\n  referenced:"));
  try {
    r = trust([], { session: "odd" });
    error = r.json().error;
    assert.equal(error.code, "E_CONFIG_BROKEN", error.message);
    assert.match(error.message, /could not be established: the CLAUDE_CONFIG_DIR of tmux session odd/);
    assert.match(error.message, /launch configuration broken: CLAUDE_CONFIG_DIR "relative\/dir" is not an absolute path/);
  } finally { writeFileSync(local, before); }
  // No server: the caller's file, said.
  await killServer();
  r = trust(["--plan"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(ambient(r).file, spawnerAccount.claude);
  assert.deepEqual(r.json().result.warnings, [
    "claude: the pane's environment is not established until a spawn starts the OATS tmux server (none runs); read instead: this process's CLAUDE_CONFIG_DIR",
    `CLAUDE_CONFIG_DIR selects ${spawnerAccount.dir} (this process's CLAUDE_CONFIG_DIR); effective file ${spawnerAccount.claude}`]);
});

test("a preview makes no prediction with no server running, and says so, for PATH too; it never starts the login shell; with a server it reads the pane's", async () => {
  await killServer();
  const marker = join(base, "login-shell-ran");
  const shell = bin("preview-shell", { bash: `#!/bin/sh\necho ran > ${shq(marker)}\nexit 1\n` });
  const env = { OATS_TEST_LOGIN_SHELL: join(shell, "bash"), CLAUDE_CONFIG_DIR: spawnerAccount.dir };
  spawnerAccount.plugin(true);
  const note = "the pane's environment is not established until a spawn starts the OATS tmux server (none runs); read instead: this process's PATH";
  let r = cli(["spawn", "dev", "--name", "preview-none", "--launch-config", "none", "--harness", "claude", "--preview", "--json"], { env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.json().result.warnings, [`the harness lookup: ${note}`]);
  // The gate does not refuse on that alone: it probes with what it names.
  r = cli(["spawn", "gated", "--name", "preview-gated", "--launch-config", "none", "--harness", "claude", "--preview", "--json"], { env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.json().result.warnings, [`the harness lookup, the harness package check: ${note}, this process's HOME, this process's CLAUDE_CONFIG_DIR`]);
  assert.equal(probed().CLAUDE_CONFIG_DIR, spawnerAccount.dir);
  // A preview of a spawn that launches nothing says nothing: its checks read this process by design.
  r = cli(["spawn", "gated", "--name", "preview-quiet", "--launch-config", "none", "--harness", "claude", "--no-launch", "--preview", "--json"], { env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json().result.warnings, undefined);
  r = cli(["launch-config", "preview", "--soul", "dev", "--harness", "claude", "--json"], { env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json().result.preflight.find((c) => c.check === "executable").detail, `${join(probeBin, "claude")} (PATH); ${note}`);
  assert.equal(existsSync(marker), false, "no preview started the login shell");
  assert.throws(() => tmuxOn("list-sessions"), "and none started a server");
  // A server runs: the preview looks where the pane will, and says nothing more.
  await startServer({ PATH: SYSTEM });
  r = cli(["launch-config", "preview", "--soul", "dev", "--harness", "claude", "--json"], { env });
  const executable = r.json().result.preflight.find((c) => c.check === "executable");
  assert.deepEqual([executable.ok, executable.code], [false, "E_HARNESS_UNAVAILABLE"]);
  assert.match(executable.detail, /claude was not found on the global PATH of the OATS tmux server/);
  await startServer();
  r = cli(["launch-config", "preview", "--soul", "dev", "--harness", "claude", "--json"], { env });
  assert.equal(r.json().result.preflight.find((c) => c.check === "executable").detail, `${join(probeBin, "claude")} (PATH)`);
  r = cli(["spawn", "dev", "--name", "preview-server", "--launch-config", "none", "--harness", "claude", "--preview", "--json"], { env });
  assert.equal(r.json().result.warnings, undefined);
});

test("a spawn that launches nothing says whose values its checks read only where it already says something: nothing when they pass, in the folder-trust warning, in the package gate's refusal", async () => {
  await startServer({ CLAUDE_CONFIG_DIR: serverAccount.dir });
  const at = { extra: ["--no-launch"], env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir } };
  const noLaunch = (name, more = {}) => spawned(spawn(name, { ...at, ...more }));
  const readInstead = (names) => `the pane's environment is not established: this spawn launches nothing (--no-launch), and a start reads its own session's; read instead: ${names.map((n) => `this process's ${n}`).join(", ")}`;
  // Folder trust is not established in the file read: the one warning, which says whose file it is.
  let child = noLaunch("quiet");
  assert.deepEqual(child.warnings, [trustWarning(spawnerAccount.claude, readInstead(["CLAUDE_CONFIG_DIR"]))]);
  // With no selector the file is under HOME, and the warning names both.
  child = spawned(spawn("quiet-home", { extra: ["--no-launch"] }));
  assert.deepEqual(child.warnings, [trustWarning(spawnerHome.claude, `the pane's environment is not established: this spawn launches nothing (--no-launch), and a start reads its own session's; read instead: this process's CLAUDE_CONFIG_DIR (not set), this process's HOME`)]);
  // The checks pass: nothing, with a requirement probed or without.
  spawnerAccount.trust(true);
  assert.deepEqual(noLaunch("quiet-trusted").warnings ?? [], []);
  spawnerAccount.plugin(true);
  assert.deepEqual(noLaunch("quiet-gated", { soul: "gated" }).warnings ?? [], []);
  assert.equal(probed().CLAUDE_CONFIG_DIR, spawnerAccount.dir, "the probe of a spawn that launches nothing reads this process");
  // The package gate refuses: the same refusal, which says whose account the probe read.
  spawnerAccount.plugin(false);
  const message = refused(spawn("quiet-refused", { soul: "gated", ...at }), "quiet-refused");
  assert.match(message, /require harness packages that are not installed/);
  assert.ok(message.includes(`CLAUDE_CONFIG_DIR='${spawnerAccount.dir}' `), message);
  assert.ok(message.endsWith(`\nThe account this probe read is not known to be the launch's: ${readInstead(["PATH", "HOME", "CLAUDE_CONFIG_DIR"])}`), message);
  // A launch configuration that sets the selector: its file is the launch's, and the warning says so.
  child = noLaunch("quiet-config", { config: "own" });
  assert.deepEqual(child.warnings, [trustWarning(configAccount.claude, "the CLAUDE_CONFIG_DIR of launch configuration own")]);
});

test("a tmux that cannot say whether the server runs is a read that failed, not a server that does not run: oats harness trust refuses (E_RUNTIME_ENDPOINT_UNKNOWN) and writes nothing, this process's file least of all; readiness and a preview still answer, and say what they read instead; with no tmux on its PATH no prediction is made, and the command writes this process's file and says so", async () => {
  await startServer({ CLAUDE_CONFIG_DIR: serverAccount.dir });
  const asking = `${unasked}:${SERVER_PATH}:${lsBin}`;
  const audit = () => { try { return readFileSync(join(fx.dep, ".agents", "harness-trust.jsonl"), "utf8"); } catch { return null; } };
  const auditBefore = audit();
  const tail = "\\. What has to answer, as this process: `tmux -L oats list-sessions`\\. A server that could not be asked may run under another account than this process's, so this process's file is not written in its place$";
  for (const [path, more, failure] of [
    [asking, {}, "permission denied"],
    [asking, { FIXTURE_LIST_SESSIONS: "cut" }, "tmux list-sessions did not exit by itself \\(SIGTERM\\)"],
  ]) for (const mode of [["--plan"], []]) {
    const r = cli(["harness", "trust", "--harness", "claude", ...mode, "--json"], { env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir, FIXTURE_ACCOUNT: configAccount.dir, PATH: path, ...more } });
    assert.notEqual(r.status, 0, r.stdout);
    const error = r.json().error;
    assert.equal(error.code, "E_RUNTIME_ENDPOINT_UNKNOWN", error.message);
    assert.match(error.message, new RegExp(`^Harness trust targets cannot be established; nothing was written: the file a claude launch with no launch configuration reads could not be established: could not read the OATS tmux server for session base: ${failure}${tail}`));
    assert.equal(error.details.operation, "harness-trust");
    assert.deepEqual(error.details.entries.filter((e) => e.ambient).map((e) => [e.status, e.file]), [["refused", null]]);
    assert.deepEqual(error.details.entries.filter((e) => !e.ambient).map((e) => e.file), [configAccount.claude], "the plan is still there, with the launch configurations' file");
    for (const a of everyAccount) assert.deepEqual(readJson(a.claude), {}, `nothing was written (${a.dir})`);
    assert.equal((r.stdout + r.stderr).includes(spawnerAccount.dir), false, "this process's file is not named either");
    assert.equal(audit(), auditBefore, "no audit row: nothing was attempted");
  }
  // What only reads keeps answering: this process's file, and whose it is.
  const env = { CLAUDE_CONFIG_DIR: spawnerAccount.dir, PATH: asking };
  const unread = "the pane's environment is not established: this process could not read the OATS tmux server; read instead: this process's";
  const i = harnessTrustItem(cli(["readiness", "--soul", "dev", "--json"], { env }));
  assert.deepEqual([i.status, i.required, i.file], ["unknown", false, spawnerAccount.claude]);
  assert.equal(i.reason, trustWarning(spawnerAccount.claude, `${unread} CLAUDE_CONFIG_DIR`));
  const r = cli(["spawn", "dev", "--name", "preview-unasked", "--launch-config", "none", "--harness", "claude", "--preview", "--json"], { env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.json().result.warnings, [`the harness lookup: ${unread} PATH`]);
  // No tmux on this process's PATH: no read is made, so none failed. No prediction, as with no
  // server: this process's file, said, in the plan and in what is written.
  const noTmux = "claude: the pane's environment is not established: this process has no tmux on its PATH to read the OATS tmux server with; read instead: this process's CLAUDE_CONFIG_DIR";
  for (const mode of [["--plan"], []]) {
    const t = cli(["harness", "trust", "--harness", "claude", ...mode, "--json"], { env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir, FIXTURE_ACCOUNT: configAccount.dir, PATH: `${probeBin}:${lsBin}` } });
    assert.equal(t.status, 0, t.stdout + t.stderr);
    assert.deepEqual(t.json().result.entries.filter((e) => e.ambient).map((e) => e.file), [spawnerAccount.claude]);
    assert.deepEqual(t.json().result.warnings, [noTmux, `CLAUDE_CONFIG_DIR selects ${spawnerAccount.dir} (this process's CLAUDE_CONFIG_DIR); effective file ${spawnerAccount.claude}`]);
  }
  assert.equal(readJson(spawnerAccount.claude).projects[DEP.path].hasTrustDialogAccepted, true);
  assert.deepEqual(readJson(serverAccount.claude), {}, "the running server's account is not this command's to guess");
  // Readiness and a preview say the same of that case: what was established is that this
  // process has no tmux, never that no server runs.
  spawnerAccount.trust(false);
  const gitBin = join(base, "git-bin"); // readiness reads the workspace with git; still no tmux
  mkdirSync(gitBin);
  symlinkSync(systemExecutable("git"), join(gitBin, "git"));
  const bare = { env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir, PATH: `${probeBin}:${gitBin}` } };
  const j = harnessTrustItem(cli(["readiness", "--soul", "dev", "--json"], bare));
  assert.deepEqual([j.status, j.file], ["unknown", spawnerAccount.claude]);
  assert.equal(j.reason, trustWarning(spawnerAccount.claude, noTmux.slice("claude: ".length)));
  const p = cli(["launch-config", "preview", "--soul", "dev", "--harness", "claude", "--json"], bare);
  assert.equal(p.json().result.preflight.find((c) => c.check === "executable").detail, `${join(probeBin, "claude")} (PATH); the pane's environment is not established: this process has no tmux on its PATH to read the OATS tmux server with; read instead: this process's PATH`);
  const s = cli(["spawn", "dev", "--name", "preview-no-tmux", "--launch-config", "none", "--harness", "claude", "--preview", "--json"], bare);
  assert.equal(s.status, 0, s.stdout + s.stderr);
  assert.deepEqual(s.json().result.warnings, [`the harness lookup: ${noTmux.slice("claude: ".length).replace("CLAUDE_CONFIG_DIR", "PATH")}`]);
});

test("oats harness trust writes for a launch configuration that sets HOME and no selector: the default file under that HOME, which its launch's check reads; with a selector in the pane that launch reads the pane's, and the configuration has no file of its own", async () => {
  const ownHome = account(join(ACCOUNTS, "own-home")).trust(false), refHome = account(join(ACCOUNTS, "ref-home")).trust(false);
  const local = join(fx.dep, "oats-local.yaml"), before = readFileSync(local, "utf8");
  writeFileSync(local, before.replace("referenced:", `ownhome:\n    harness: claude\n    env:\n      HOME: ${ownHome.dir}\n  refhome:\n    harness: claude\n    env:\n      HOME:\n        fromEnv: FIXTURE_HOME\n  referenced:`));
  try {
    const trust = (extra = [], env = { FIXTURE_HOME: refHome.dir }) => cli(["harness", "trust", "--harness", "claude", ...extra, "--json"], { env: { FIXTURE_ACCOUNT: configAccount.dir, PATH: `${SERVER_PATH}:${lsBin}`, ...env } });
    const targets = (r) => { assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result.entries.map((e) => [e.file, e.ambient, e.launchConfigs]); };
    const withSelector = [configAccount.claude, false, ["both", "own", "referenced"]];
    // No selector in the pane: each such launch reads the default file under its own HOME.
    await startServer();
    assert.deepEqual(targets(trust(["--plan"])), [[serverHome.claude, true, []], withSelector, [ownHome.claude, false, ["ownhome"]], [refHome.claude, false, ["refhome"]]]);
    const warning = trustWarning(ownHome.claude, "under the HOME of launch configuration ownhome");
    assert.deepEqual(trustWarnings(spawned(spawn("own-home-before", { config: "ownhome" }))), [warning], "the file the launch's check reads");
    assert.equal(targets(trust()).length, 4);
    for (const a of [serverHome, configAccount, ownHome, refHome]) assert.equal(readJson(a.claude).projects[DEP.path].hasTrustDialogAccepted, true, a.dir);
    assert.deepEqual(readJson(spawnerHome.claude), {}, "this process's own file is none of them");
    assert.deepEqual(trustWarnings(spawned(spawn("own-home-after", { config: "ownhome" }))), [], "and the launch's check reads it as trusted");
    // A reference that is not set names no directory: refused as a configuration's problem.
    let r = trust(["--plan"], {});
    assert.notEqual(r.status, 0, r.stdout);
    assert.equal(r.json().error.code, "E_CONFIG_BROKEN", r.json().error.message);
    assert.ok(r.json().error.message.includes("launch configuration refhome: HOME references FIXTURE_HOME, not set on this host"), r.json().error.message);
    // A selector in the pane: every launch that sets none reads that one, whatever its HOME.
    await startServer({ CLAUDE_CONFIG_DIR: serverAccount.dir });
    r = trust(["--plan"], {});
    assert.deepEqual(targets(r), [[serverAccount.claude, true, []], withSelector]);
    assert.deepEqual(trustWarnings(spawned(spawn("own-home-selector", { config: "ownhome" }))), [trustWarning(serverAccount.claude, serverGlobal("CLAUDE_CONFIG_DIR"))]);
  } finally { writeFileSync(local, before); }
});

test("the package probe runs the program the launch's lookup selected, with the pane's PATH as the pane reads it: a relative entry is the pane's directory, never the directory this command runs in", async () => {
  const INSTALLED = JSON.stringify([{ id: PLUGIN, scope: "user", enabled: true }]);
  const ran = join(base, "which-claude-ran");
  const who = () => { try { return lines(readFileSync(ran, "utf8")); } catch { return []; } };
  // The directory the command runs in holds a claude of its own, with its own answer.
  const callerAnswer = join(base, "caller-plugins.json");
  const callerDir = bin("caller-cwd", { claude: `#!/bin/sh\necho caller >> ${shq(ran)}\nexec ${CAT} ${shq(callerAnswer)}\n` });
  const from = { cwd: callerDir, env: { CLAUDE_CONFIG_DIR: spawnerAccount.dir } };
  await startServer({ PATH: `.:${SERVER_PATH}`, CLAUDE_CONFIG_DIR: serverAccount.dir });
  // A spawn: its home is not there yet, so the pane's "." holds no claude and the lookup goes on
  // to the next entry. The caller's claude says the plugin is installed; the selected one does not.
  writeFileSync(callerAnswer, INSTALLED);
  const message = refused(spawn("rel-refused", { soul: "gated", extra: ["--dir", fx.dep], ...from }), "rel-refused");
  assert.match(message, /require harness packages that are not installed/);
  assert.deepEqual(who(), [], "the caller's claude was never run");
  assert.equal(probed().PATH, `${homeOf("rel-refused", "gated")}:${SERVER_PATH}`, "the probe's PATH: the pane's, its relative entry resolved against the pane's directory");
  // The selected one has it: the spawn goes on, and the pane's own PATH is what the server holds.
  serverAccount.plugin(true);
  const child = spawned(spawn("rel-start", { soul: "gated", extra: ["--dir", fx.dep], ...from }));
  await ready(child.home);
  assert.equal(paneEnv(child.home).PATH, `${join(child.home, ".oats", "bin")}:.:${SERVER_PATH}`, "the launch itself does not change: the server's PATH, behind the launch's own directory");
  assert.equal(readJson(join(child.home, "instance.json")).launch.executable, join(probeBin, "claude"));
  assert.deepEqual(who(), []);
  // A start: the home is the pane's directory, and it now holds a claude: the one the pane's "."
  // selects. It lacks the plugin; the caller's and the one further down the PATH have it.
  const pid = Number(readFileSync(join(child.home, "harness-ready"), "utf8").trim());
  const ownAnswer = join(child.home, "own-plugins.json");
  writeFileSync(ownAnswer, "[]");
  writeFileSync(join(child.home, "claude"), `#!/bin/sh\nif [ "$1" = plugin ]; then echo pane >> ${shq(ran)}; exec ${CAT} ${shq(ownAnswer)}; fi\nexec ${SLEEP} 600\n`);
  chmodSync(join(child.home, "claude"), 0o755);
  const restart = () => cli(["session", "restart", "--home", child.home, "--harness", "claude", "--json"], from);
  let r = restart();
  assert.notEqual(r.status, 0, r.stdout);
  assert.equal(r.json().error.code, "E_HARNESS_RESOURCE_MISSING", r.json().error.message);
  assert.deepEqual(who(), ["pane"], "the probe ran the claude the pane's PATH selects");
  assert.doesNotThrow(() => process.kill(pid, 0), "the running harness was not stopped");
  // The other way round: the selected one has it and the caller's does not.
  writeFileSync(ownAnswer, INSTALLED);
  writeFileSync(callerAnswer, "[]");
  r = restart();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json().result.launch?.executable ?? readJson(join(child.home, "instance.json")).launch.executable, join(child.home, "claude"));
  assert.equal(who().includes("caller"), false, "the caller's claude was never run");
});

test("the package probe runs the program the lookup selected, not the one an exec of the harness's name would find on the pane's PATH: in the pane's directory a claude the lookup selects but an exec passes over (its interpreter is missing) is the one probed", async () => {
  await startServer({ PATH: `.:${SERVER_PATH}`, CLAUDE_CONFIG_DIR: serverAccount.dir });
  serverAccount.plugin(true);
  const child = spawned(spawn("sel-start", { soul: "gated", extra: ["--dir", fx.dep] }));
  await ready(child.home);
  const pid = Number(readFileSync(join(child.home, "harness-ready"), "utf8").trim());
  // The pane's "." is the home: its claude is a regular executable file, so the lookup selects it;
  // an exec fails on it (ENOENT: no interpreter) and goes on down the PATH to the fixture's claude,
  // whose account has the plugin.
  writeFileSync(join(child.home, "claude"), `#!${join(base, "no-such-interpreter")}\nexit 0\n`);
  chmodSync(join(child.home, "claude"), 0o755);
  const before = probes();
  const r = cli(["session", "restart", "--home", child.home, "--harness", "claude", "--json"]);
  assert.notEqual(r.status, 0, r.stdout);
  assert.equal(r.json().error.code, "E_HARNESS_RESOURCE_MISSING", r.json().error.message);
  assert.match(r.json().error.message, /not installed/);
  assert.equal(probes(), before, "the claude further down the pane's PATH was never probed: the probe ran the selected one, which answers nothing");
  assert.doesNotThrow(() => process.kill(pid, 0), "the running harness was not stopped");
});
