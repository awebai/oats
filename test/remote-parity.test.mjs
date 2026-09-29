// Remote parity (0.32.0): every routed ssh call shares a per-user control
// master and detects a dead link; the version probe is asked once per process
// per server and target; remote roster rows carry the facts a local row has.
// The ssh contract is exercised with fake transports; the live proof over
// `ssh localhost` is the release's manual run (docs/servers.md).

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { checkRemote, dropRemoteProbes, rosterGroups, runRemote, sshArgv, writeServers } from "../lib/servers.mjs";

// ssh binds the control socket at `<ControlPath>.<16 random>`: a short
// OATS_HOME_DIR keeps it inside the 104-byte socket path limit (macOS).
const base = mkdtempSync("/tmp/oats-rp-");
const prevHomeDir = process.env.OATS_HOME_DIR;
process.env.OATS_HOME_DIR = join(base, "oh");
test.after(() => {
  if (prevHomeDir === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = prevHomeDir;
  rmSync(base, { recursive: true, force: true });
});

const PROBE = { schemaVersion: 1, name: "@awebai/oats", version: "0.32.0", desktopApi: 1, harnesses: ["pi"], sessionBackends: ["tmux"], launchOptions: [], remote: ["session"], features: ["harness"] };
const target = { sshHost: "h", workspace: "/w", oatsPath: "oats" };

/** A transport that answers the version probe and counts it. */
function countingExec(answer = () => JSON.stringify({ root: "/w/agents", agents: [] })) {
  const calls = { probes: 0, argv: [] };
  const exec = (bin, argv) => {
    calls.argv.push(argv);
    if (String(argv.at(-1)).endsWith("version --json")) { calls.probes++; return JSON.stringify(PROBE); }
    return answer(argv);
  };
  return { exec, calls };
}

test("sshArgv: every routed call is non-interactive, keeps the link alive and shares the per-user control master", () => {
  // Sharing is off unless the caller has checked the control directory (controlUsable).
  assert.deepEqual(sshArgv(target, ["version"]).filter((a) => a.startsWith("Control")), ["ControlPath=none"]);
  const argv = sshArgv(target, ["version", "--json"], { control: true });
  const end = argv.indexOf("--");
  assert.deepEqual(argv.slice(0, end), [
    "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
    "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
    "-o", "ControlMaster=auto", "-o", `ControlPath=${join(process.env.OATS_HOME_DIR, "ssh", "%C")}`, "-o", "ControlPersist=60",
  ]);
  assert.deepEqual(argv.slice(end), ["--", "h", "oats version --json"]);
});

test("runRemote: the control socket directory is created private before ssh binds in it; one others can write to is not used", () => {
  const dir = join(process.env.OATS_HOME_DIR, "ssh");
  rmSync(dir, { recursive: true, force: true });
  const warnings = [];
  const { exec, calls } = countingExec();
  const io = { execFileSync: exec, serverId: "perm", warn: (m) => warnings.push(m) };
  runRemote(target, ["status"], io);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.ok(calls.argv.at(-1).includes("ControlMaster=auto"));
  chmodSync(dir, 0o755);
  runRemote(target, ["status"], io);
  assert.ok(calls.argv.at(-1).includes("ControlMaster=auto"), "a directory only its owner can write is used");
  assert.deepEqual(warnings, []);
  chmodSync(dir, 0o775);
  runRemote(target, ["status"], io);
  assert.deepEqual(calls.argv.at(-1).filter((a) => a.startsWith("Control")), ["ControlPath=none"], "a group-writable directory is never handed to ssh");
  assert.equal(warnings.length, 1); assert.match(warnings[0], /writable/);
  chmodSync(dir, 0o700);
});

test("control master: the socket path fits the 104-byte limit at 86 bytes and not at 87; beyond it routing runs without the master, keepalives kept, warned once per server", () => {
  const prev = process.env.OATS_HOME_DIR;
  // ssh binds the master at `<ControlPath>.<16 random chars>`, a NUL-terminated
  // path in a 104-byte sun_path: the ControlPath expands to <dir>/ssh/<40 hex>,
  // so an OATS_HOME_DIR of 41 bytes gives 86 and one of 42 gives 87.
  const warnings = [];
  const { exec, calls } = countingExec();
  const io = (serverId) => ({ execFileSync: exec, serverId, warn: (m) => warnings.push(m) });
  const lastArgv = () => calls.argv.at(-1);
  try {
    process.env.OATS_HOME_DIR = join(base, "l".repeat(41 - base.length - 1));
    assert.equal(join(process.env.OATS_HOME_DIR, "ssh", "x".repeat(40)).length, 86);
    runRemote(target, ["status"], io("fit"));
    assert.ok(lastArgv().includes("ControlMaster=auto"), lastArgv().join(" "));
    assert.deepEqual(warnings, []);
    process.env.OATS_HOME_DIR = join(base, "l".repeat(42 - base.length - 1));
    assert.equal(join(process.env.OATS_HOME_DIR, "ssh", "x".repeat(40)).length, 87);
    runRemote(target, ["status"], io("long"));
    assert.deepEqual(lastArgv().filter((a) => a.startsWith("Control")), ["ControlPath=none"], lastArgv().join(" "));
    assert.ok(lastArgv().includes("ServerAliveInterval=15") && lastArgv().includes("ServerAliveCountMax=3"));
    runRemote(target, ["status"], io("long"));
    assert.equal(warnings.length, 1, "once per process per server id");
    assert.match(warnings[0], /87/); assert.match(warnings[0], /104/); assert.match(warnings[0], /OATS_HOME_DIR/);
    assert.ok(warnings[0].includes(join(process.env.OATS_HOME_DIR, "ssh")), warnings[0]);
    runRemote(target, ["status"], io("other"));
    assert.equal(warnings.length, 2, "another server id is warned on its own");
    process.env.OATS_HOME_DIR = "/" + "x".repeat(120);
    assert.deepEqual(sshArgv(target, ["version"], { control: true }).filter((a) => a.startsWith("Control")), ["ControlPath=none"], "the argv builder alone never names a path ssh cannot bind");
  } finally { process.env.OATS_HOME_DIR = prev; }
});

/** What the real ssh makes of an argv's options, without connecting (ssh -G). */
function sshEffective(argv, config) {
  const opts = argv.slice(1, argv.indexOf("--"));
  const out = execFileSync("ssh", ["-G", "-F", config, ...opts, "localhost"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return Object.fromEntries(out.split("\n").filter(Boolean).map((l) => { const i = l.indexOf(" "); return [l.slice(0, i), l.slice(i + 1)]; }));
}

test("control master, read by the real ssh: the path is exactly the one checked; a directory ssh would read as syntax, and every fallback, disable sharing even over the user's own Control* config", () => {
  const prev = process.env.OATS_HOME_DIR;
  const userConfig = join(base, "ssh_config");
  writeFileSync(userConfig, `Host *\n  ControlMaster auto\n  ControlPersist 60\n  ControlPath ${join(base, "missing")}/%C\n`);
  const warnings = [];
  const { exec, calls } = countingExec();
  try {
    const eff = sshEffective(sshArgv(target, ["version"], { control: true }), "/dev/null");
    assert.equal(eff.controlmaster, "auto"); assert.equal(eff.controlpersist, "60");
    assert.match(eff.controlpath, new RegExp(`^${join(process.env.OATS_HOME_DIR, "ssh").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[0-9a-f]{40}$`));
    assert.equal(Buffer.byteLength(eff.controlpath), Buffer.byteLength(join(process.env.OATS_HOME_DIR, "ssh", "x".repeat(40))), "the length checked is the length ssh binds");
    assert.equal(sshEffective(sshArgv(target, ["version"], { control: true }), userConfig).controlpath, eff.controlpath, "explicit -o wins over the user's ControlPath");
    for (const dir of ["a b", "a%z", "a${HOME}b", "a\"b", "a'b", "a#b"]) {
      process.env.OATS_HOME_DIR = join(base, dir);
      runRemote(target, ["status"], { execFileSync: exec, serverId: `syntax-${dir}`, warn: (m) => warnings.push(m) });
      const argv = calls.argv.at(-1);
      assert.deepEqual(argv.filter((a) => a.startsWith("Control")), ["ControlPath=none"], `${dir}: ${argv.join(" ")}`);
      assert.match(warnings.at(-1), /characters ssh reads as syntax/, dir);
      const fallback = sshEffective(["ssh", ...argv], userConfig);
      assert.equal(fallback.controlpath, undefined, `${dir}: sharing is off even with a configured ControlPath (${fallback.controlpath})`);
    }
  } finally { process.env.OATS_HOME_DIR = prev; }
});

test("checkRemote: one version probe per process per server and target; a replaced registration is probed afresh", () => {
  const { exec, calls } = countingExec();
  const io = { execFileSync: exec, serverId: "b" };
  const first = checkRemote(target, io);
  assert.equal(checkRemote(target, io), first, "the cached answer");
  assert.equal(calls.probes, 1);
  checkRemote(target, { ...io, serverId: "c" });
  assert.equal(calls.probes, 2, "another server id is its own entry");
  const moved = { ...target, sshHost: "h2" };
  checkRemote(moved, io);
  assert.equal(calls.probes, 3, "another target is its own entry");
  checkRemote(moved, io);
  assert.equal(calls.probes, 3);
  dropRemoteProbes("b");
  checkRemote(target, io);
  checkRemote(moved, io);
  assert.equal(calls.probes, 5, "dropping a server id forgets every target it was probed at");
  checkRemote(target, { ...io, serverId: "c" });
  assert.equal(calls.probes, 5, "other server ids keep theirs");
  // A registration written with a changed target forgets the old probes of that id.
  writeServers({ b: { sshHost: "h", workspace: "/w" } });
  checkRemote(target, io);
  assert.equal(calls.probes, 5, "an unchanged registration keeps its probe");
  writeServers({ b: { sshHost: "h3", workspace: "/w" } });
  checkRemote(target, io);
  assert.equal(calls.probes, 6, "server add --replace to another target drops the id's probes");
  // A failed probe is never cached.
  let fail = true;
  const flaky = (bin, argv) => { if (fail) { const e = new Error("ssh"); e.status = 255; e.stderr = "Connection refused"; throw e; } return exec(bin, argv); };
  assert.throws(() => checkRemote(target, { execFileSync: flaky, serverId: "d" }), (e) => e.code === "E_SSH");
  fail = false;
  checkRemote(target, { execFileSync: flaky, serverId: "d" });
  assert.equal(calls.probes, 7);
});

test("server roster: instance rows carry the remote status facts, null where the remote does not supply them", () => {
  writeServers({ build: { sshHost: "build-host", workspace: "/srv/ws" } });
  const snapDir = join(process.env.OATS_HOME_DIR, "remote", "build");
  mkdirSync(snapDir, { recursive: true });
  writeFileSync(join(snapDir, "dev-gone.json"), JSON.stringify({ serverId: "build", instance: "dev-gone", agent: "dev", home: "/srv/ws/agents/dev/instances/dev-gone", agentsRoot: "/srv/ws/agents", target: { sshHost: "build-host", workspace: "/srv/ws", oatsPath: "oats" } }));
  const full = {
    instance: "dev-a", home: "/srv/ws/agents/dev/instances/dev-a", harness: "claude", running: true,
    identity: { alias: "dev-a", address: "acme/dev-a" }, identityAddress: "acme/dev-a", teams: [{ label: "default", team: "acme:t" }],
    startedAt: "2026-09-29T10:00:00.000Z", createdAt: "2026-09-29T09:00:00.000Z", model: "opus", runtimeState: "working",
    parentInstance: "boss", siblingInstance: "dev-b", relation: "child", relativeTo: "boss", spawnOrigin: "instance",
  };
  const bare = { instance: "dev-b", home: "/srv/ws/agents/dev/instances/dev-b", running: false };
  const status = { root: "/srv/ws/agents", agents: [{ name: "dev", harness: "claude", instances: [full, bare] }] };
  const { exec } = countingExec(() => JSON.stringify(status));
  const out = rosterGroups({ io: { execFileSync: exec } });
  const rows = out.groups[0].instances;
  const FIELDS = ["identity", "identityAddress", "teams", "startedAt", "createdAt", "model", "runtimeState", "parentInstance", "siblingInstance", "relation", "relativeTo", "spawnOrigin"];
  const a = rows.find((r) => r.instance === "dev-a");
  for (const k of FIELDS) assert.deepEqual(a[k], full[k], k);
  assert.equal(a.savedRoute, false);
  assert.equal(a.running, true); assert.equal(a.harness, "claude");
  const b = rows.find((r) => r.instance === "dev-b");
  for (const k of FIELDS) assert.equal(b[k], null, `${k} is null when the remote does not supply it`);
  // A saved route the remote no longer lists: same keys, nothing invented.
  const gone = rows.find((r) => r.instance === "dev-gone");
  for (const k of FIELDS) assert.equal(gone[k], null, k);
  assert.equal(gone.missingRemotely, true);
  assert.deepEqual(Object.keys(gone).sort(), Object.keys(b).sort(), "remote rows and saved-route rows share one shape");
  rmSync(snapDir, { recursive: true, force: true });
});

// ---- the CLI over a counting fake ssh and a fake remote oats ----

const CLI = new URL("../bin/oats.mjs", import.meta.url).pathname;

/** A fake ssh that logs each call's argv (one line, NUL-free) and runs the
 *  remote command word through sh -c; a fake remote oats that answers the
 *  probe and whatever `answers` maps a subcommand line to. */
function fakeHost(dir, { probe = PROBE, answers = {} } = {}) {
  const bin = join(dir, "bin"); mkdirSync(bin, { recursive: true });
  const log = join(dir, "ssh.log");
  writeFileSync(join(bin, "ssh"), `#!/bin/sh\nprintf '%s ' "$@" >> ${JSON.stringify(log)}\nprintf '\\n' >> ${JSON.stringify(log)}\nwhile [ "$1" != "--" ]; do shift; done\nshift; shift\nexec sh -c "$1"\n`);
  const cases = Object.entries(answers).map(([pattern, { stdout = "", exit = 0 }]) => `  *${JSON.stringify(pattern)}*) printf '%s' ${JSON.stringify(stdout)}; exit ${exit};;`).join("\n");
  const oatsPath = join(dir, "remote-oats");
  writeFileSync(oatsPath, `#!/bin/sh\ncase "$*" in\n  "version --json") printf '%s' ${JSON.stringify(JSON.stringify(probe))};;\n${cases}\n  *) echo "unexpected: $*" >&2; exit 2;;\nesac\n`);
  chmodSync(join(bin, "ssh"), 0o755); chmodSync(oatsPath, 0o755);
  return { bin, log, oatsPath, calls: () => { try { return readFileSync(log, "utf8").trim().split("\n").filter(Boolean); } catch { return []; } } };
}

function cli(env, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env, cwd: env.HOME });
  return { ...r, json: () => JSON.parse(r.stdout.trim()) };
}

function cliEnv(dir, host) {
  const env = { ...process.env, PATH: `${host.bin}:${dirname(process.execPath)}:/usr/bin:/bin`, OATS_HOME_DIR: join(dir, "oh"), HOME: join(dir, "home") };
  for (const k of Object.keys(env)) if (/^(OATS_INSTANCE|PI_AGENT)/.test(k)) delete env[k];
  mkdirSync(env.HOME, { recursive: true });
  return env;
}

test("session attach --server: one version probe at most, every call through the same control master; a lost link says so", () => {
  const dir = mkdtempSync(join(base, "att-"));
  const home = "/srv/ws/agents/dev/instances/dev-a";
  const host = fakeHost(dir, { answers: { "session attach --home": { stdout: "attached" } } });
  const env = cliEnv(dir, host);
  mkdirSync(env.OATS_HOME_DIR, { recursive: true });
  writeFileSync(join(env.OATS_HOME_DIR, "servers.json"), JSON.stringify({ servers: { build: { sshHost: "build-host", workspace: "/srv/ws", oatsPath: host.oatsPath } } }));
  let r = cli(env, ["session", "attach", "--server", "build", "--home", home]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "attached");
  const calls = host.calls();
  assert.equal(calls.filter((c) => c.endsWith("version --json ")).length, 1, calls.join("\n"));
  const control = `-o ControlMaster=auto -o ControlPath=${join(env.OATS_HOME_DIR, "ssh", "%C")} -o ControlPersist=60 --`;
  assert.ok(calls.every((c) => c.includes(control)), calls.join("\n"));
  assert.ok(calls.at(-1).startsWith("-t "), "the viewer gets a PTY");
  assert.equal(r.stderr, "", "no fallback warning with a private, short control directory");

  // ssh's own failure (exit 255), a lost link or one never made: say what is known.
  const dead = fakeHost(mkdtempSync(join(base, "dead-")), { answers: { "session attach --home": { exit: 255 } } });
  writeFileSync(join(env.OATS_HOME_DIR, "servers.json"), JSON.stringify({ servers: { build: { sshHost: "build-host", workspace: "/srv/ws", oatsPath: dead.oatsPath } } }));
  r = cli({ ...env, PATH: `${dead.bin}:${dirname(process.execPath)}:/usr/bin:/bin` }, ["session", "attach", "--server", "build", "--home", home]);
  assert.equal(r.status, 255);
  assert.match(r.stderr, /ssh to build-host ended with an error \(exit 255\); if the link was lost, the instance keeps running on build\. Reattach with: oats session attach --server build --home \/srv\/ws\/agents\/dev\/instances\/dev-a/);
});

// ---- item 3: foreign instances are first-class ----

const FULL_PROBE = { ...PROBE, remote: ["spawn", "retire", "status", "session", "session-start", "session-restart", "session-upload"], features: ["harness", "retire-home", "session-start", "session-restart", "session-upload", "launch-config"] };
const WS = "/srv/ws";
const homeOf = (agent, name) => `${WS}/agents/${agent}/instances/${name}`;
const ROSTER = { root: `${WS}/agents`, agents: [
  { name: "dev", instances: [{ instance: "dev-a", home: homeOf("dev", "dev-a"), running: true }, { instance: "twin", home: homeOf("dev", "twin"), running: false }] },
  { name: "ops", instances: [{ instance: "twin", home: homeOf("ops", "twin"), running: false }] },
] };
const ok = (result) => ({ stdout: JSON.stringify({ schemaVersion: 1, ok: true, result }) });

function foreignSetup(name, answers = {}) {
  const dir = mkdtempSync(join(base, `${name}-`));
  const host = fakeHost(dir, { probe: FULL_PROBE, answers: { [`status --json --dir ${WS}`]: { stdout: JSON.stringify(ROSTER) }, ...answers } });
  const env = cliEnv(dir, host);
  mkdirSync(env.OATS_HOME_DIR, { recursive: true });
  writeFileSync(join(env.OATS_HOME_DIR, "servers.json"), JSON.stringify({ servers: { build: { sshHost: "build-host", workspace: WS, oatsPath: host.oatsPath } } }));
  return { dir, host, env, sent: (pattern) => host.calls().filter((c) => c.includes(pattern)) };
}

test("foreign instances: every routed session command and retire reach a home with no saved route, by --home or by a name unique on the host", () => {
  const home = homeOf("dev", "dev-a");
  const { env, host, sent, dir } = foreignSetup("foreign", {
    [`session inspect --home ${home} --json`]: ok({ home, present: true, state: "running", backend: "tmux" }),
    [`session start --home ${home} --json`]: ok({ instance: "dev-a", home, backend: "tmux", reused: "pane" }),
    [`session restart --home ${home} --json`]: ok({ instance: "dev-a", home, backend: "tmux", reused: "pane" }),
    [`session attach --home ${home}`]: { stdout: "attached" },
    [`retire dev-a --home ${home} --dir ${WS} --json`]: ok({ retired: "dev-a", agent: "dev", removedDir: true }),
  });
  for (const addr of [["--home", home], ["--instance", "dev-a"]]) {
    let r = cli(env, ["session", "inspect", "--server", "build", ...addr, "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.json().result.home, home); assert.equal(r.json().result.server, "build");
    r = cli(env, ["session", "start", "--server", "build", ...addr, "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(r.json().result.instance, "dev-a");
    r = cli(env, ["session", "restart", "--server", "build", ...addr, "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    r = cli(env, ["session", "attach", "--server", "build", ...addr]);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(r.stdout, "attached");
  }
  // Upload: the bytes go to the host's receiver for that home.
  const file = join(dir, "note.txt"); writeFileSync(file, "hello");
  const sha = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
  writeFileSync(join(env.OATS_HOME_DIR, "servers.json"), JSON.stringify({ servers: { build: { sshHost: "build-host", workspace: WS, oatsPath: fakeHost(mkdtempSync(join(dir, "upload-")), { probe: FULL_PROBE, answers: {
    [`status --json --dir ${WS}`]: { stdout: JSON.stringify(ROSTER) },
    [`session receive --home ${home} --name note.txt --json`]: ok({ path: `${home}/.oats-attachments/note.txt`, bytes: 5, sha256: sha }),
  } }).oatsPath } } }));
  let r = cli(env, ["session", "upload", "--server", "build", "--instance", "dev-a", "--file", file, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(r.json().result.home, home);
  // Retire by name: the name resolves through the host's roster to its exact home.
  writeFileSync(join(env.OATS_HOME_DIR, "servers.json"), JSON.stringify({ servers: { build: { sshHost: "build-host", workspace: WS, oatsPath: host.oatsPath } } }));
  r = cli(env, ["retire", "dev-a", "--server", "build", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(r.json().result.retired, "dev-a");
  assert.equal(sent(`retire dev-a --home ${home} --dir ${WS} --json`).length, 1, host.calls().join("\n"));
  r = cli(env, ["retire", "dev-a", "--server", "build", "--home", home, "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // One status read resolves a name; the probe is asked once per command.
  const before = host.calls().length;
  cli(env, ["session", "inspect", "--server", "build", "--instance", "dev-a", "--json"]);
  const calls = host.calls().slice(before);
  assert.deepEqual(calls.map((c) => (c.includes("version --json") ? "probe" : c.includes("status --json") ? "status" : "inspect")), ["status", "probe", "inspect"]);
});

test("foreign instances: an ambiguous name lists its homes, an unknown one says the host lists none, a mismatched home is refused, the host's own refusal is relayed", () => {
  const bad = "/srv/elsewhere/x";
  const { env, sent } = foreignSetup("foreign-err", {
    [`session start --home ${bad} --json`]: { stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_NOT_INSTANCE_HOME", message: `${bad} is not an instance home` } }), exit: 1 },
  });
  for (const cmd of [["session", "inspect"], ["session", "start"], ["session", "attach"]]) {
    let r = cli(env, [...cmd, "--server", "build", "--instance", "twin", "--json"]);
    assert.notEqual(r.status, 0);
    const err = r.stdout.trim() ? r.json().error : { code: null, message: r.stderr };
    if (err.code) assert.equal(err.code, "E_AMBIGUOUS");
    assert.ok(err.message.includes(homeOf("dev", "twin")) && err.message.includes(homeOf("ops", "twin")), err.message);
    r = cli(env, [...cmd, "--server", "build", "--instance", "ghost", "--json"]);
    assert.notEqual(r.status, 0);
    if (r.stdout.trim()) { assert.equal(r.json().error.code, "E_SNAPSHOT_UNKNOWN"); assert.match(r.json().error.message, /no instance "ghost" on server build: neither a saved route here nor its roster names one/); }
    else assert.match(r.stderr, /no instance "ghost" on server build/);
  }
  let r = cli(env, ["retire", "twin", "--server", "build", "--json"]);
  assert.equal(r.json().error.code, "E_AMBIGUOUS");
  assert.deepEqual(r.json().error.details?.candidates?.map((c) => c.home), [homeOf("dev", "twin"), homeOf("ops", "twin")]);
  assert.equal(sent("retire twin").length, 0, "nothing retired on an ambiguous name");
  r = cli(env, ["retire", "ghost", "--server", "build", "--json"]);
  assert.equal(r.json().error.code, "E_SNAPSHOT_UNKNOWN");
  r = cli(env, ["session", "inspect", "--server", "build", "--instance", "dev-a", "--home", homeOf("dev", "twin"), "--json"]);
  assert.equal(r.json().error.code, "E_HOME_MISMATCH");
  r = cli(env, ["session", "start", "--server", "build", "--home", bad, "--json"]);
  assert.equal(r.status, 1); assert.equal(r.json().error.code, "E_NOT_INSTANCE_HOME", "the host's refusal is relayed as is");
});

test("server roster: every row the host reports is addressable; savedRoute is information only", () => {
  const { env } = foreignSetup("addr");
  const r = cli(env, ["server", "roster", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const rows = r.json().result.groups[0].instances;
  assert.equal(rows.length, 3);
  for (const row of rows) { assert.equal(row.addressable, true); assert.equal(row.savedRoute, false); }
});

test("a remote without the session commands: the fallback hint names the instance's recorded tmux session, else the remote's default", () => {
  const old = { ...FULL_PROBE, version: "0.22.1", remote: ["spawn", "retire", "status"], features: [] };
  const dir = mkdtempSync(join(base, "hint-"));
  const roster = { root: `${WS}/agents`, agents: [{ name: "dev", instances: [
    { instance: "dev-a", home: homeOf("dev", "dev-a"), tmux: { session: "team-x", window: "dev-a" } },
    { instance: "dev-b", home: homeOf("dev", "dev-b") },
  ] }] };
  const host = fakeHost(dir, { probe: old, answers: { [`status --json --dir ${WS}`]: { stdout: JSON.stringify(roster) } } });
  const env = cliEnv(dir, host);
  mkdirSync(env.OATS_HOME_DIR, { recursive: true });
  writeFileSync(join(env.OATS_HOME_DIR, "servers.json"), JSON.stringify({ servers: { build: { sshHost: "build-host", workspace: WS, oatsPath: host.oatsPath } } }));
  let r = cli(env, ["session", "inspect", "--server", "build", "--home", homeOf("dev", "dev-a"), "--json"]);
  assert.equal(r.json().error.code, "E_REMOTE_INCOMPATIBLE");
  assert.match(r.json().error.message, /attach with ssh -t build-host tmux attach -t team-x:dev-a$/);
  r = cli(env, ["session", "inspect", "--server", "build", "--home", homeOf("dev", "dev-b"), "--json"]);
  assert.match(r.json().error.message, /attach with ssh -t build-host tmux attach -t pi-agents$/, "a kernel before 0.22.2 opened its windows in pi-agents");
});
