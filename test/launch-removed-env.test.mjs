// A launch gets exactly its providers' declared environment (awebai/oats#1123): a name a provider
// declares in its manifest `environment` and leaves out of its payload is removed from the launch,
// never inherited from the pane's ambient environment (the tmux server's or session's, a login
// shell's, the Desktop's). docs/capabilities.md owns the rule.
//
// The incident: a Claude Code instance on the channel path started with AWEB_DELIVERY=session
// inherited from the agents' tmux session, so it was never woken. The fixture capability here is
// that shape: vendor aweb, declaring AWEB_DELIVERY, whose hooks set it for a broker-path instance
// and leave it out for a channel-path one.
//
// Real tmux, never the operator's: the fixture owns a private TMUX_TMPDIR, so `-L oats` is the
// fixture's own server, and it is killed by socket.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { declaredLaunchEnv, launchEffectiveEnv, launchEnvironment, launchFolderTrust, removedLaunchEnv } from "../lib/core.mjs";
import { isolateSessionEnvironment, oatsSocket, systemExecutable, waitUntil } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const MV = systemExecutable("mv");
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-removed-env-")));
const restoreEnvironment = isolateSessionEnvironment(base);
const OATS = oatsSocket();
const SYSTEM = join(base, "system-bin");
const TMUX = join(SYSTEM, "tmux");
const ENV = systemExecutable("env"), SLEEP = systemExecutable("sleep");
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const lines = (text) => text.split("\n").filter(Boolean);
const envOf = (text) => Object.fromEntries(lines(text).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

// The harness: records the environment it started with, then idles; its pid file appears whole.
const probeBin = join(base, "probe-bin");
mkdirSync(probeBin);
writeFileSync(join(probeBin, "claude"), `#!/bin/sh\n${ENV} > "$OATS_INSTANCE_HOME/pane-env.txt"\necho $$ > "$OATS_INSTANCE_HOME/harness-ready.tmp"\n${MV} "$OATS_INSTANCE_HOME/harness-ready.tmp" "$OATS_INSTANCE_HOME/harness-ready"\nexec ${SLEEP} 600\n`);
chmodSync(join(probeBin, "claude"), 0o755);
const SERVER_PATH = `${probeBin}:${SYSTEM}`;

// The provider: a broker-path instance (its name ends in -broker) gets AWEB_DELIVERY=session from its
// spawn and launch hooks; a channel-path one gets an empty payload.
const HOOK = `const broker = (process.env.OATS_INSTANCE || "").endsWith("-broker");
process.stdout.write(JSON.stringify(broker ? { env: { AWEB_DELIVERY: "session" } } : {}) + "\\n");
`;
const fx = v2Deployment({
  souls: { dev: { soul: { capabilities: { "aweb.fixture": { from: "here" } } } } },
  capabilities: { "aweb.fixture": { manifest: { layer: "messaging", hooks: { spawn: "hook.mjs", launch: "hook.mjs" }, environment: ["AWEB_DELIVERY"], settings: {} }, files: { "hook.mjs": HOOK } } },
});

const tmuxOn = (...args) => execFileSync(TMUX, ["-u", "-S", OATS, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
async function killServer() {
  let pid;
  try { pid = Number(tmuxOn("display-message", "-p", "#{pid}")); } catch { return; }
  tmuxOn("kill-server");
  await waitUntil(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, "the fixture's oats server has exited");
}
/** A fake login shell (OATS_TEST_LOGIN_SHELL, named bash; never the operator's): the fixture's HOME,
 *  a plain shell, the server's PATH and `extra`, then the kernel's emitter. */
let shells = 0;
function loginShell(extra = {}) {
  const dir = join(base, `login-shell-${++shells}`);
  mkdirSync(dir, { recursive: true });
  const exports = Object.entries({ HOME: process.env.HOME, SHELL: "/bin/sh", PATH: SERVER_PATH, ...extra }).map(([k, v]) => `${k}=${shq(v)}`).join(" ");
  writeFileSync(join(dir, "bash"), `#!/bin/sh\nexport ${exports}\nexec /bin/sh -c "$4"\n`);
  chmodSync(join(dir, "bash"), 0o755);
  return join(dir, "bash");
}
const cliEnv = (session, extra = {}) => ({ OATS_TMUX_SESSION: session, PI_AGENTS_TMUX_SESSION: session, LANG: "C.UTF-8", PATH: SERVER_PATH, ...extra });
const spawned = (r) => { assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result; };
const unlaunched = (name, session) => spawned(fx.cli(["spawn", "dev", "--name", name, "--launch-config", "none", "--harness", "claude", "--no-launch", "--json"], { env: cliEnv(session) }));
const started = (r) => assert.equal(r.status, 0, r.stdout + r.stderr);
const ready = (home) => waitUntil(() => existsSync(join(home, "harness-ready")), `${home} harness started`);
const paneEnv = (home) => envOf(readFileSync(join(home, "pane-env.txt"), "utf8"));
/** The session's own entries and the server's global ones, as tmux holds them. */
const sessionEnv = (session) => tmuxOn("show-environment", "-t", `=${session}`);
const globalEnv = () => tmuxOn("show-environment", "-g");

test.after(async () => {
  await killServer();
  restoreEnvironment();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  fx.cleanup();
});

test("removedLaunchEnv: the declared names that neither the payload nor the launch configuration sets, sorted; never a name a manifest could not declare", () => {
  const declared = declaredLaunchEnv([{ environment: ["AWEB_URL", "AWEB_DELIVERY"] }, { environment: ["AWEB_DELIVERY", "TEST_SET_BY_CONFIG"] }, { environment: ["PATH", "OATS_X", "NODE_OPTIONS", "bad name"] }, {}]);
  assert.deepEqual(declared, ["AWEB_DELIVERY", "AWEB_URL", "TEST_SET_BY_CONFIG"], "united across capabilities (a name two declare is one), reserved and invalid names left out");
  assert.deepEqual(removedLaunchEnv({ declared, hooksEnv: { AWEB_URL: "https://x.invalid" }, configEnv: { TEST_SET_BY_CONFIG: { fromEnv: "SRC" } } }), ["AWEB_DELIVERY"]);
  assert.deepEqual(removedLaunchEnv({ declared: ["HOME", "OATS_INSTANCE", "AWEB_DELIVERY"] }), ["AWEB_DELIVERY"], "a recorded list is read through the same rule");
  assert.deepEqual(removedLaunchEnv({}), []);
});

test("launchEffectiveEnv: a declared name absent from the payload is removed from the base; set by the payload or by the launch configuration, it is kept", () => {
  const pane = { of: (name) => ({ PATH: { value: "/usr/bin:/bin", source: "the pane" }, HOME: { value: "/fixture/home", source: "the pane" } })[name] ?? { absent: true, source: "the pane" } };
  const hooksEnv = { AWEB_URL: "https://payload.invalid" };
  const configEnv = { AWEB_TEAM: "from-config" };
  const removed = removedLaunchEnv({ declared: ["AWEB_DELIVERY", "AWEB_TEAM", "AWEB_URL"], hooksEnv, configEnv });
  assert.deepEqual(removed, ["AWEB_DELIVERY"]);
  const launch = launchEnvironment({ configEnv, configName: "c", removed, env: {}, pane });
  const out = launchEffectiveEnv({ base: { AWEB_DELIVERY: "session", AWEB_URL: "ambient", AWEB_TEAM: "ambient", UNDECLARED: "kept" }, hooksEnv, configEnv, launch, harness: "claude" });
  assert.equal(Object.hasOwn(out, "AWEB_DELIVERY"), false, "removed");
  assert.equal(out.AWEB_URL, "https://payload.invalid", "the payload's");
  assert.equal(out.AWEB_TEAM, "from-config", "the configuration's");
  assert.equal(out.UNDECLARED, "kept", "a name no provider declares stays this process's");
});

test("a harness folder selector a provider declares and does not set (a manifest may, under a namespace it names): the checks read it as removed, never the pane's", () => {
  const home = join(base, "selector-home"), account = join(base, "selector-account");
  mkdirSync(home, { recursive: true }); mkdirSync(account, { recursive: true });
  const pane = { of: (name) => ({ PATH: { value: "/usr/bin:/bin", source: "the pane" }, HOME: { value: account, source: "the pane" }, CLAUDE_CONFIG_DIR: { value: join(base, "elsewhere"), source: "the pane" } })[name] ?? { absent: true, source: "the pane" } };
  const removed = removedLaunchEnv({ declared: ["CLAUDE_CONFIG_DIR", "TEST_GRANT"], hooksEnv: { TEST_GRANT: "g" } });
  const launch = launchEnvironment({ removed, env: {}, pane, cwd: home });
  const answer = launch.of("CLAUDE_CONFIG_DIR");
  assert.equal(answer.absent, true);
  assert.match(answer.source, /^this launch, which removes CLAUDE_CONFIG_DIR/);
  assert.equal(Object.hasOwn(launchEffectiveEnv({ base: { CLAUDE_CONFIG_DIR: "/ambient" }, launch, harness: "claude" }), "CLAUDE_CONFIG_DIR"), false, "the probe runs without it");
  const trust = launchFolderTrust({ harness: "claude", home, meta: { workspace: { deployment: base } }, launch });
  assert.equal(trust.file, join(account, ".claude.json"), "folder trust reads the file under HOME, not the pane's selector's");
});

test("a channel-path launch in a session a broker-path start created gets no AWEB_DELIVERY, whatever the session and the server hold; the broker-path launch gets its own; the start leaves no instance value in the tmux environment", async () => {
  await killServer();
  const broker = unlaunched("mixed-broker", "mixed");
  const channel = unlaunched("mixed-channel", "mixed");
  // The broker-path start creates the server and the session.
  started(fx.cli(["session", "start", "--home", broker.home, "--json"], { env: cliEnv("mixed", { OATS_TEST_LOGIN_SHELL: loginShell() }) }));
  await ready(broker.home);
  assert.equal(paneEnv(broker.home).AWEB_DELIVERY, "session", "the broker path gets its provider's value");
  // Item 2: the value went on the window's own command, not into the session or the server.
  assert.doesNotMatch(sessionEnv("mixed"), /AWEB_DELIVERY/, "the session holds no value of the broker's provider env");
  assert.doesNotMatch(globalEnv(), /AWEB_DELIVERY/, "nor does the server");
  // The ambient source, made real: the session's and the server's environment both hold the broker value.
  tmuxOn("set-environment", "-g", "AWEB_DELIVERY", "session");
  tmuxOn("set-environment", "-t", "=mixed", "AWEB_DELIVERY", "session");
  started(fx.cli(["session", "start", "--home", channel.home, "--json"], { env: cliEnv("mixed", { AWEB_DELIVERY: "session" }) }));
  await ready(channel.home);
  assert.equal(Object.hasOwn(paneEnv(channel.home), "AWEB_DELIVERY"), false, "the channel path has no AWEB_DELIVERY");
  assert.ok(paneEnv(channel.home).OATS_INSTANCE === "mixed-channel" && paneEnv(channel.home).PATH, "the rest of its environment is there");
  // The persisted launch command is the launch alone: the removal is the window's.
  const meta = readJson(join(channel.home, "instance.json"));
  assert.doesNotMatch(meta.command, /AWEB_DELIVERY|unset/);
  assert.deepEqual(lines(tmuxOn("list-windows", "-t", "=mixed", "-F", "#{window_name}")).filter((w) => w !== "hq").sort(), ["mixed-broker", "mixed-channel"]);
});

test("a spawn's window and a start in place (respawn-pane) remove a declared name their payload leaves out, on a server created with it ambient", async () => {
  await killServer();
  // The server starts from an environment that carries the value, as one started from a broker-path pane would.
  const child = spawned(fx.cli(["spawn", "dev", "--name", "ambient-channel", "--launch-config", "none", "--harness", "claude", "--json"], { env: cliEnv("ambient", { AWEB_DELIVERY: "session", OATS_TEST_LOGIN_SHELL: loginShell({ AWEB_DELIVERY: "session" }) }) }));
  await ready(child.home);
  assert.match(globalEnv(), /^AWEB_DELIVERY=session$/m, "the server holds the ambient value");
  assert.equal(Object.hasOwn(paneEnv(child.home), "AWEB_DELIVERY"), false, "the spawn's window has none");
  // The harness exits; its pane is left as a shell, which a start reuses in place.
  const pid = Number(readFileSync(join(child.home, "harness-ready"), "utf8").trim());
  rmSync(join(child.home, "harness-ready"));
  process.kill(pid, "SIGTERM");
  await waitUntil(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, "the harness has exited");
  const r = fx.cli(["session", "start", "--home", child.home, "--json"], { env: cliEnv("ambient", { AWEB_DELIVERY: "session" }) });
  started(r);
  assert.equal(r.json().result.reused, "pane", "started in place");
  await ready(child.home);
  assert.equal(Object.hasOwn(paneEnv(child.home), "AWEB_DELIVERY"), false, "the respawned pane has none");
});
