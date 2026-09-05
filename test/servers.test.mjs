// Server registry and remote routing (lib/servers.mjs, `oats server`,
// `--server`). The SSH contract is exercised locally: a fake `ssh` on PATH
// records how it was called and runs the remote command through `sh -c`
// exactly as a login shell would, against the REAL kernel in a temp
// workspace. What is proven here is the routing, the quoting, the envelope
// handling and the snapshot lifecycle — not that any real host works.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { attachArgv, checkRemoteSupport, resolveRoute, routeCommand, runRemote, compareSemver, remoteQuote, snapshotPath, sshArgv, validateServer } from "../lib/servers.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

/** A PATH dir with: a fake ssh that logs its argv and runs the command
 *  locally through sh -c; fake pi/claude/tmux so spawn preflight passes. */
function fakeBin(base) {
  const bin = join(base, "bin"); mkdirSync(bin, { recursive: true });
  const log = join(base, "ssh.log");
  write(join(bin, "ssh"), `#!/bin/sh
printf '%s\\n' "$@" >> ${JSON.stringify(log)}
printf -- '--\\n' >> ${JSON.stringify(log)}
# drop options up to and including "--", then the host, then run the command word
while [ "$1" != "--" ]; do shift; done
shift; shift
exec sh -c "$1"
`);
  // Runtimes live OFF the PATH the fake ssh inherits, like ~/.local/bin on a
  // real host: only a registration --path makes the remote preflight find them.
  const tools = join(base, "remote-tools"); mkdirSync(tools, { recursive: true });
  for (const rt of ["pi", "claude"]) write(join(tools, rt), "#!/bin/sh\nexit 0\n");
  write(join(bin, "tmux"), "#!/bin/sh\ncase \"$1\" in -V) echo 'tmux 3.4';; esac\nexit 0\n");
  for (const f of ["ssh", "tmux"]) chmodSync(join(bin, f), 0o755);
  for (const f of ["pi", "claude"]) chmodSync(join(tools, f), 0o755);
  return { bin, log, tools };
}

function remoteWorkspace(base) {
  const repo = join(base, "remote-ws"); mkdirSync(repo, { recursive: true });
  write(join(repo, "oats-config.yaml"), "capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n");
  write(join(repo, "agents", "dev", "soul", "soul.yaml"), "name: dev\nrepo: .\nwork: checkout\nruntime: pi\n");
  write(join(repo, "agents", "dev", "soul", "AGENTS.md"), "You are dev.\n");
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "add", "-A"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "init"]);
  return repo;
}

function oats(env, args, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env, cwd: opts.cwd || env.HOME });
  if (r.error) throw r.error;
  return { ...r, json: () => { try { return JSON.parse(r.stdout.trim()); } catch { throw new Error(`no JSON on stdout: ${r.stdout}\n${r.stderr}`); } } };
}

test("remoteQuote/sshArgv: every argument survives the remote login shell byte for byte", () => {
  const args = ["plain", "with space", "it's", '"dq"', "$(touch NEVER_RUN)", "`id`", "a\nb", "", "--flag=v", "~/x", "*", "%s"];
  const target = { sshHost: "h", workspace: "/w", oatsPath: "oats" };
  const argv = sshArgv(target, args);
  assert.deepEqual(argv.slice(0, 5), ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15"]);
  assert.equal(argv[5], "--"); assert.equal(argv[6], "h");
  // Run the produced command word through a real sh, with `oats` replaced by an argv echo.
  const cmd = argv[7].replace(/^oats /, "");
  const out = execFileSync("sh", ["-c", `node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- ${cmd}`], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), args);
  assert.equal(existsSync("NEVER_RUN"), false);
  assert.equal(remoteQuote("safe.path/x=1"), "safe.path/x=1");
  assert.equal(remoteQuote(""), "''");
  // A ~/ path prefix expands on the REMOTE shell; a spaced one stays quoted; $PATH is the remote's.
  // A cwd prefix is quoted like any argument and precedes the PATH prefix.
  const withCwd = sshArgv({ sshHost: "h", workspace: "/w", oatsPath: "oats" }, ["okf", "harvest"], { cwd: "/w/it's here/$(touch NEVER_RUN)" });
  assert.equal(withCwd[7], `cd '/w/it'\\''s here/$(touch NEVER_RUN)' && oats okf harvest`);
  const cwdSeen = execFileSync("/bin/sh", ["-c", withCwd[7].replace(/ && oats okf harvest$/, " 2>/dev/null || printf %s \"$1\"") , "--", "cd-failed-as-expected"], { encoding: "utf8" });
  assert.equal(cwdSeen, "cd-failed-as-expected"); assert.equal(existsSync("NEVER_RUN"), false);
  const withPath = sshArgv({ sshHost: "h", workspace: "/w", oatsPath: "oats", path: "~/.local/bin:/opt/my tools/bin" }, ["version"]);
  assert.equal(withPath[7], `PATH="$HOME"/.local/bin:'/opt/my tools/bin':"$PATH" oats version`);
  const seen = execFileSync("/bin/sh", ["-c", withPath[7].replace(/ oats version$/, "; printf %s \"$PATH\"")], { encoding: "utf8", env: { HOME: "/home/remote", PATH: "/usr/bin:/bin" } });
  assert.equal(seen, "/home/remote/.local/bin:/opt/my tools/bin:/usr/bin:/bin");
});

test("validateServer: a registration is where and how, never credentials or ssh options", () => {
  assert.ok(validateServer("build", { sshHost: "build-host", workspace: "/srv/team" }));
  assert.throws(() => validateServer("Build", { sshHost: "h", workspace: "/w" }), /lowercase/);
  assert.throws(() => validateServer("b", { sshHost: "root@h", workspace: "/w" }), /no user@/);
  assert.throws(() => validateServer("b", { sshHost: "-oProxyCommand=x", workspace: "/w" }), /host alias/);
  assert.throws(() => validateServer("b", { sshHost: "h", workspace: "relative" }), /absolute/);
  assert.throws(() => validateServer("b", { sshHost: "h", workspace: "/w", password: "x" }), /never keys or passwords/);
  assert.throws(() => validateServer("b", { sshHost: "h", workspace: "/w", privateKey: "x" }), /unknown field/);
  assert.equal(compareSemver("0.22.2", "0.22.1") > 0, true);
  assert.equal(compareSemver("0.22.1", "0.22.1"), 0);
  assert.equal(compareSemver("1.0.0", "0.99.9") > 0, true);
  assert.throws(() => snapshotPath("build", "../etc"), /bad instance name/);
});

test("runRemote: a bare retire answer with cleanup still owed is not ok, so a routed retire cannot report success (D2)", () => {
  const bare = JSON.stringify({ retired: "dev-x", agent: "dev", removedDir: false, rollbackIncomplete: ["retire hook acme.chan: reported incomplete cleanup"], retainedHome: "/srv/agents/dev/instances/dev-x" });
  const exec = () => { const e = new Error("exit 1"); e.status = 1; e.stdout = bare; e.stderr = ""; throw e; };
  const { envelope, status } = runRemote({ sshHost: "h", workspace: "/w", oatsPath: "oats" }, ["retire", "dev-x", "--json"], { execFileSync: exec });
  assert.equal(status, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "E_RETIRE_INCOMPLETE");
  assert.match(envelope.error.message, /retained there: retire hook acme.chan/);
  assert.equal(envelope.result.retired, "dev-x", "the remote's own result stays visible");
  // Through the route, the failed envelope still names the server and target (R2).
  const routed = routeCommand("build", "retire", ["dev-x"], { server: { id: "build", sshHost: "h", workspace: "/w", oatsPath: "oats" }, execFileSync: (bin, argv) => (String(argv.at(-1)).includes("version --json") ? JSON.stringify({ schemaVersion: 1, name: "@awebai/oats", version: "0.22.2", desktopApi: 1 }) : exec()) });
  assert.equal(routed.envelope.ok, false);
  assert.equal(routed.envelope.result.server, "build");
  assert.equal(routed.envelope.result.target.sshHost, "h");
  const clean = () => JSON.stringify({ retired: "dev-x", agent: "dev", removedDir: true });
  assert.equal(runRemote({ sshHost: "h", workspace: "/w", oatsPath: "oats" }, ["retire", "dev-x", "--json"], { execFileSync: clean }).envelope.ok, true);
});

test("checkRemoteSupport: a request is held to what the remote kernel advertises, soul defaults included", () => {
  const legacy = { version: "0.22.1", runtimes: ["pi", "claude"], sessionBackends: [], launchOptions: [], advertised: false };
  const modern = { version: "0.22.2", runtimes: ["pi", "claude", "codex"], sessionBackends: ["tmux", "herdr"], launchOptions: ["yolo"], advertised: true };
  const target = { sshHost: "h" };
  const roster = { agents: [{ name: "dev", runtime: "codex" }, { name: "rev", runtime: "claude" }] };
  assert.deepEqual(checkRemoteSupport(legacy, target, ["rev", "--purpose", "x"], roster), { runtime: "claude", backend: undefined, yolo: false });
  assert.throws(() => checkRemoteSupport(legacy, target, ["rev", "--runtime", "codex"], roster), /runtime codex was not established/);
  assert.throws(() => checkRemoteSupport(legacy, target, ["rev", "--yolo"], roster), /yolo launch option/);
  assert.throws(() => checkRemoteSupport(legacy, target, ["rev", "--backend", "herdr"], roster), /session backend herdr/);
  assert.deepEqual(checkRemoteSupport(modern, target, ["dev", "--backend", "herdr", "--yolo"], roster), { runtime: "codex", backend: "herdr", yolo: true });
  assert.throws(() => checkRemoteSupport(modern, target, ["dev", "--backend", "screen"], roster), /session backend screen/);
});

test("oats server + --server: registry, check, remote spawn with a hostile task, status, retire from the snapshot after the registration is gone", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-servers-"));
  try {
    const { bin, log, tools } = fakeBin(base);
    const repo = remoteWorkspace(base);
    // A minimal PATH, like a non-interactive login shell: the fake ssh, node,
    // git and the system dirs; no locally installed runtime can leak in.
    const env = { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, OATS_HOME_DIR: join(base, "oats-home"), HOME: join(base, "home") };
    const prevHomeDir = process.env.OATS_HOME_DIR; process.env.OATS_HOME_DIR = env.OATS_HOME_DIR;
    mkdirSync(env.HOME, { recursive: true }); mkdirSync(env.OATS_HOME_DIR, { recursive: true });
    for (const k of Object.keys(env)) if (/^(OATS_INSTANCE|PI_AGENT)/.test(k)) delete env[k];

    // registry
    let r = oats(env, ["server", "list", "--json"]);
    assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.json().result.servers, []);
    r = oats(env, ["server", "add", "build", "--ssh", "build-host", "--workspace", repo, "--oats", CLI, "--label", "Build box", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const reg = JSON.parse(readFileSync(join(env.OATS_HOME_DIR, "servers.json"), "utf8"));
    assert.deepEqual(reg.servers.build, { sshHost: "build-host", workspace: repo, oatsPath: CLI, label: "Build box" });
    r = oats(env, ["server", "add", "build", "--ssh", "other", "--workspace", repo, "--json"]);
    assert.notEqual(r.status, 0); assert.equal(r.json().error.code, "E_SERVER_EXISTS");
    r = oats(env, ["server", "add", "bad", "--ssh", "root@x", "--workspace", repo, "--json"]);
    assert.equal(r.json().error.code, "E_SERVER_INVALID");

    // check: version probe and status, no mutation
    r = oats(env, ["server", "check", "build", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const chk = r.json().result;
    assert.equal(chk.remote.desktopApi, 1); assert.equal(typeof chk.remote.version, "string");
    assert.equal(chk.workspaceReachable, true); assert.equal(chk.agents, 1);
    const sshLines = readFileSync(log, "utf8");
    assert.match(sshLines, /^-o\nBatchMode=yes\n-o\nConnectTimeout=15\n--\nbuild-host\n/m, "non-interactive, options ended with -- before the host");

    // remote spawn: the task travels as text and lands byte for byte
    const hostile = "Review `this` and $(touch NEVER_RUN) 'quotes' \"dq\"\nsecond line % and * and ~\n";
    const taskFile = join(base, "task.md"); writeFileSync(taskFile, hostile);
    // Without --path the remote preflight cannot find the runtime: a typed
    // failure from the remote kernel, relayed as its own envelope.
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "probe", "--task-file", taskFile, "--no-launch", "--json"]);
    assert.notEqual(r.status, 0);
    assert.match(r.json().error.message, /pi binary not found/);
    r = oats(env, ["server", "add", "build", "--ssh", "build-host", "--workspace", repo, "--oats", CLI, "--path", tools, "--replace", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "probe", "--task-file", taskFile, "--no-launch", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const sp = r.json();
    assert.equal(sp.ok, true, JSON.stringify(sp));
    assert.equal(sp.result.server, "build");
    assert.equal(sp.result.target.sshHost, "build-host");
    assert.equal(sp.result.instance, "dev-probe");
    const home = join(repo, "agents", "dev", "instances", "dev-probe");
    assert.equal(existsSync(home), true, "the remote kernel created the home in the registered workspace");
    assert.equal(readFileSync(join(home, "TASK.md"), "utf8").includes(hostile.trim()), true, "task text intact through ssh quoting");
    assert.equal(existsSync(join(process.cwd(), "NEVER_RUN")), false);
    const snap = JSON.parse(readFileSync(join(env.OATS_HOME_DIR, "remote", "build", "dev-probe.json"), "utf8"));
    assert.equal(snap.target.workspace, repo); assert.equal(snap.home, home); assert.equal(snap.remote.schemaVersion, 1);
    assert.equal(snap.agentsRoot, join(repo, "agents"), "the agents root comes from the remote roster, not guessed from the workspace");
    // A request beyond what the remote advertises is refused BEFORE any spawn
    // reaches it. This fake remote is this kernel, which advertises pi, claude
    // and codex on tmux and herdr with the yolo option; ask for what it lacks.
    const before = readFileSync(log, "utf8");
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "nope", "--runtime", "gemini", "--no-launch", "--json"]);
    assert.equal(r.json().error.code, "E_REMOTE_INCOMPATIBLE");
    assert.match(r.json().error.message, /runtime gemini was not established as supported there \(it advertises runtimes pi, claude, codex/, "an advertising remote's list is quoted, nothing more is claimed");
    assert.equal(readFileSync(log, "utf8").includes("spawn dev --purpose nope"), false, "no spawn command was sent");
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "nope", "--backend", "screen", "--no-launch", "--json"]);
    assert.equal(r.json().error.code, "E_REMOTE_INCOMPATIBLE");
    assert.match(r.json().error.message, /session backend screen/);
    // The viewer route: ssh -t, saved target, remote home from the snapshot; --print shows it.
    const att = attachArgv("build", { instance: "dev-probe" }, { skipVersionCheck: true }); // route resolution only; the version gate is exercised through the CLI above
    assert.deepEqual(att.argv.slice(0, 2), ["ssh", "-t"]);
    assert.equal(att.home, home);
    assert.match(att.argv.at(-1), new RegExp(`session attach --home ${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    assert.throws(() => attachArgv("build", { instance: "ghost" }, { skipVersionCheck: true }), /no remote instance "ghost"/);
    assert.deepEqual(resolveRoute("build", { instance: "dev-probe" }).target, snap.target, "inspect and attach share the saved route");
    // Session routes need a remote whose probe advertises session; this fake remote is this kernel, which does, so the inspect runs there against the snapshot's home and its envelope is relayed.
    r = oats(env, ["session", "inspect", "--server", "build", "--instance", "dev-probe", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.json().ok, true);
    assert.equal(r.json().result.home, home);
    assert.equal(r.json().result.server, "build");
    assert.match(readFileSync(log, "utf8"), new RegExp(`session inspect --home ${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} --json`), "the inspect ran on the host against the snapshot's home");
    r = oats(env, ["session", "inspect", "--server", "build", "--instance", "ghost", "--json"]);
    assert.equal(r.json().error.code, "E_SNAPSHOT_UNKNOWN");
    r = oats(env, ["session", "attach", "--server", "build", "--instance", "dev-probe", "--print"]);
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^ssh -t -o 'BatchMode=yes' .* -- build-host /);
    // the snapshot store is read with OATS_HOME_DIR in effect for the in-process calls above
    void before;
    assert.equal(snap.target.path, tools, "the PATH prefix is part of the frozen route");
    assert.match(readFileSync(log, "utf8"), new RegExp(`PATH=${tools.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:"\\$PATH" `), "PATH prefix precedes the remote command, $PATH left for the remote shell");
    // --dir and --server do not mix
    r = oats(env, ["spawn", "dev", "--server", "build", "--dir", repo, "--json"]);
    assert.equal(r.json().error.code, "E_BAD_ARGS");

    // status pulled from the remote kernel, with this machine's snapshots
    r = oats(env, ["status", "--server", "build", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const st = r.json().result;
    assert.deepEqual(st.agents.find((a) => a.name === "dev").instances.map((i) => i.instance), ["dev-probe"], "the roster lists homes only, never the .oats-retirement bookkeeping dir (oats-5xl)");
    assert.deepEqual(st.snapshots.map((s) => s.instance), ["dev-probe"]);
    r = oats(env, ["status", "--server", "build"]);
    assert.match(r.stdout, /server build .*build-host/); assert.match(r.stdout, /dev-probe/);

    // the registration disappears; the snapshot still routes the retirement
    r = oats(env, ["server", "remove", "build", "--json"]);
    assert.deepEqual(r.json().result.remoteInstancesStillTracked, ["dev-probe"]);
    r = oats(env, ["retire", "dev-probe", "--server", "build", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.json().result.retired, "dev-probe");
    assert.equal(existsSync(home), false, "the remote kernel removed the home");
    assert.equal(existsSync(join(env.OATS_HOME_DIR, "remote", "build", "dev-probe.json")), false, "snapshot cleared on a completed retirement");

    // an unknown server is a typed failure, and ssh's own failure is E_SSH
    r = oats(env, ["status", "--server", "nope", "--json"]);
    assert.equal(r.json().error.code, "E_SERVER_UNKNOWN");
    r = oats(env, ["server", "add", "down", "--ssh", "down-host", "--workspace", "/nonexistent", "--oats", "/no/such/oats", "--json"]);
    assert.equal(r.status, 0);
    r = oats(env, ["server", "check", "down", "--json"]);
    assert.notEqual(r.status, 0);
    assert.match(r.json().error.code, /^E_(SSH|REMOTE_ENVELOPE)$/);
    if (prevHomeDir === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = prevHomeDir;
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("oats server roster, okf harvest --server, and the changed-registration guard", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-servers-roster-"));
  try {
    const { bin, log, tools } = fakeBin(base);
    const repo = remoteWorkspace(base);
    const env = { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, OATS_HOME_DIR: join(base, "oats-home"), HOME: join(base, "home") };
    mkdirSync(env.HOME, { recursive: true }); mkdirSync(env.OATS_HOME_DIR, { recursive: true });
    for (const k of Object.keys(env)) if (/^(OATS_INSTANCE|PI_AGENT)/.test(k)) delete env[k];

    let r = oats(env, ["server", "roster", "--json"]);
    assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.json().result.groups, []);
    r = oats(env, ["server", "add", "build", "--ssh", "build-host", "--workspace", repo, "--oats", CLI, "--path", tools, "--label", "Build box", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "r1", "--no-launch", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const home = r.json().result.home;

    // The roster: one group per (server, route target), one status pull each,
    // souls from the remote, instances joined with the saved routes.
    r = oats(env, ["server", "roster", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    let out = r.json().result;
    assert.equal(out.groups.length, 1);
    const g = out.groups[0];
    assert.equal(g.server, "build"); assert.equal(g.label, "Build box"); assert.equal(g.registrationPresent, true);
    assert.deepEqual(g.probe, { ok: true });
    assert.equal(typeof g.agentsRoot, "string");
    assert.deepEqual(g.souls.map((s) => s.name), ["dev"]);
    assert.equal(g.souls[0].agentsRoot, g.agentsRoot);
    assert.equal(g.instances.length, 1);
    assert.equal(g.instances[0].instance, "dev-r1"); assert.equal(g.instances[0].agent, "dev");
    assert.equal(g.instances[0].savedRoute, true); assert.equal(g.instances[0].running, false);
    assert.equal(g.instances[0].home, home);
    assert.deepEqual([g.instances[0].retirePending, g.instances[0].rollbackIncomplete, g.instances[0].missingRemotely], [false, false, false]);
    assert.deepEqual(g.retireFailures, []);
    assert.equal(typeof out.bounds.perTargetTimeoutMs, "number");
    assert.match(readFileSync(log, "utf8"), /status --json --dir/, "the roster pulled remote status");
    r = oats(env, ["server", "roster"]);
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /dev-r1\s+idle/);

    // An unreachable target: the group stays, probe carries the error, no
    // instance is invented. (The fake ssh runs the command locally, so a
    // workspace that does not exist stands in for a host that fails.)
    r = oats(env, ["server", "add", "down", "--ssh", "down-host", "--workspace", join(base, "no-such-ws"), "--oats", CLI, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    r = oats(env, ["server", "roster", "--json"]);
    out = r.json().result;
    const down = out.groups.find((x) => x.server === "down");
    assert.equal(down.probe.ok, false); assert.equal(typeof down.probe.error.message, "string");
    assert.deepEqual(down.instances, []); assert.deepEqual(down.souls, []); assert.deepEqual(down.retireFailures, []);
    r = oats(env, ["server", "roster", "--server", "nope", "--json"]);
    assert.equal(r.json().error.code, "E_SERVER_UNKNOWN");
    assert.equal(out.groups.find((x) => x.server === "build").probe.ok, true);
    r = oats(env, ["server", "roster", "--server", "down", "--json"]);
    assert.deepEqual(r.json().result.groups.map((x) => x.server), ["down"]);

    // Harvest routes to the instance's SAVED home on the host: `cd <home> &&`
    // in the remote command word, never a path from the caller. This remote
    // workspace has no knowledge layer, so the package's own refusal is relayed.
    r = oats(env, ["okf", "harvest", "--server", "build", "--instance", "nope", "--json"]);
    assert.notEqual(r.status, 0); assert.equal(r.json().error.code, "E_SNAPSHOT_UNKNOWN");
    r = oats(env, ["okf", "harvest", "--server", "build", "--instance", "dev-r1", "--json"]);
    assert.notEqual(r.status, 0, r.stdout);
    assert.equal(r.json().ok, false);
    const sshLog = readFileSync(log, "utf8");
    assert.ok(sshLog.includes(`cd ${remoteQuote(home)} && `), "harvest ran in the saved home");
    assert.match(sshLog, /okf harvest --json/);
    // Any other okf command with --server is refused, never run locally.
    r = oats(env, ["okf", "status", "--server", "build", "--json"]);
    assert.equal(r.json().error.code, "E_USAGE");
    // The route outlives the registration, like retire: remove it, harvest
    // still reaches the saved home; a saved route the remote no longer lists
    // is flagged, not invented as idle.
    const savedReg = readFileSync(join(env.OATS_HOME_DIR, "servers.json"), "utf8");
    r = oats(env, ["server", "remove", "build", "--json"]); assert.equal(r.status, 0, r.stderr);
    r = oats(env, ["okf", "harvest", "--server", "build", "--instance", "dev-r1", "--json"]);
    assert.notEqual(r.json().error?.code, "E_SERVER_UNKNOWN", r.stdout);
    r = oats(env, ["server", "roster", "--server", "build", "--json"]);
    assert.equal(r.json().result.groups[0].registrationPresent, false);
    assert.equal(r.json().result.groups[0].instances[0].missingRemotely, false);
    writeFileSync(join(env.OATS_HOME_DIR, "servers.json"), savedReg);
    // A --replace that only moves the binary is the same target: no refusal.
    const movedOats = join(base, "oats-moved"); symlinkSync(CLI, movedOats);
    r = oats(env, ["server", "add", "build", "--ssh", "build-host", "--workspace", repo, "--oats", movedOats, "--path", tools, "--replace", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "moved", "--no-launch", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    r = oats(env, ["retire", "dev-moved", "--server", "build", "--json"]); assert.equal(r.status, 0, r.stderr + r.stdout);

    // The guard: a registration edited to another target must not overwrite
    // the saved routes spawned through the old one.
    const repo2 = join(base, "remote-ws-2"); mkdirSync(repo2);
    r = oats(env, ["server", "add", "build", "--ssh", "build-host", "--workspace", repo2, "--oats", CLI, "--path", tools, "--replace", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "r2", "--no-launch", "--json"]);
    assert.notEqual(r.status, 0);
    assert.equal(r.json().error.code, "E_ROUTE_CHANGED");
    assert.match(r.json().error.message, /dev-r1/);
    assert.equal(existsSync(snapshotPath("build", "dev-r2")), false);
    // The roster keeps both: the new target (registration, nothing spawned)
    // and the old one (saved routes only) with its instance.
    r = oats(env, ["server", "roster", "--server", "build", "--json"]);
    out = r.json().result;
    assert.equal(out.groups.length, 2);
    const fresh = out.groups.find((x) => x.registrationPresent), old = out.groups.find((x) => !x.registrationPresent);
    assert.equal(fresh.target.workspace, repo2); assert.deepEqual(fresh.instances, []);
    assert.equal(old.target.workspace, repo); assert.deepEqual(old.instances.map((i) => i.instance), ["dev-r1"]);
    // A saved route whose instance is gone on the host: the roster flags it,
    // the guard still counts it, and only `server forget` drops it.
    rmSync(home, { recursive: true, force: true });
    r = oats(env, ["server", "roster", "--server", "build", "--json"]);
    assert.equal(r.json().result.groups.find((x) => !x.registrationPresent).instances[0].missingRemotely, true);
    r = oats(env, ["server", "roster", "--server", "build"]);
    assert.match(r.stdout, /dev-r1\s+GONE on the host/, "the human roster names a stale route");
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "r3", "--no-launch", "--json"]);
    assert.equal(r.json().error?.code, "E_ROUTE_CHANGED");
    r = oats(env, ["server", "forget", "build", "--instance", "nope", "--json"]);
    assert.equal(r.json().error?.code, "E_SNAPSHOT_UNKNOWN");
    r = oats(env, ["server", "forget", "build", "--instance", "dev-r1", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout); assert.equal(r.json().result.forgotten, true); assert.equal(r.json().result.home, home);
    assert.equal(existsSync(snapshotPath("build", "dev-r1")), false);
    r = oats(env, ["server", "roster", "--server", "build", "--json"]);
    assert.deepEqual(r.json().result.groups.map((x) => x.instances.length), [0]);
    // With no saved route left, the registration may point anywhere again.
    r = oats(env, ["server", "add", "build", "--ssh", "build-host", "--workspace", repo, "--oats", CLI, "--path", tools, "--replace", "--json"]); assert.equal(r.status, 0, r.stderr);
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "r3", "--no-launch", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    r = oats(env, ["retire", "dev-r3", "--server", "build", "--json"]); assert.equal(r.status, 0, r.stderr + r.stdout);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("routed retire with same-named twins: exact home on a 0.22.3 remote, refusal on an older one", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-servers-twins-"));
  try {
    const { bin, tools } = fakeBin(base);
    const repo = remoteWorkspace(base);
    // A second soul whose generated name collides: dev --purpose foo-1 and
    // dev-foo --purpose 1 both yield dev-foo-1.
    write(join(repo, "agents", "dev-foo", "soul", "soul.yaml"), "name: dev-foo\nrepo: .\nwork: checkout\nruntime: pi\n");
    write(join(repo, "agents", "dev-foo", "soul", "AGENTS.md"), "You are dev-foo.\n");
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "add", "-A"]);
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "twin soul"]);
    const env = { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, OATS_HOME_DIR: join(base, "oats-home"), HOME: join(base, "home") };
    mkdirSync(env.HOME, { recursive: true }); mkdirSync(env.OATS_HOME_DIR, { recursive: true });
    for (const k of Object.keys(env)) if (/^(OATS_INSTANCE|PI_AGENT)/.test(k)) delete env[k];
    const prevHomeDir = process.env.OATS_HOME_DIR; process.env.OATS_HOME_DIR = env.OATS_HOME_DIR;
    try {
    // An "old" remote: the real kernel, but its version probe carries no features.
    const oldOats = join(base, "old-oats");
    write(oldOats, `#!/bin/sh\nif [ "$1" = version ] && [ "$2" = --json ]; then ${remoteQuote(process.execPath)} ${remoteQuote(CLI)} version --json | sed 's/,"features":[^}]*//'; exit $?; fi\nexec ${remoteQuote(process.execPath)} ${remoteQuote(CLI)} "$@"\n`);
    chmodSync(oldOats, 0o755);
    let r = oats(env, ["server", "add", "new", "--ssh", "h", "--workspace", repo, "--oats", CLI, "--path", tools, "--json"]); assert.equal(r.status, 0, r.stderr);
    r = oats(env, ["server", "add", "old", "--ssh", "h", "--workspace", repo, "--oats", oldOats, "--path", tools, "--json"]); assert.equal(r.status, 0, r.stderr);
    r = oats(env, ["server", "check", "old", "--json"]); assert.deepEqual(r.json().result.remote.features, [], "the old remote advertises no features");
    // The saved route: dev-foo-1 of agent dev, through "new" and through "old".
    r = oats(env, ["spawn", "dev", "--server", "new", "--purpose", "foo-1", "--no-launch", "--json"]); assert.equal(r.status, 0, r.stderr + r.stdout);
    const devHome = r.json().result.home;
    // The same route saved through the old registration: the snapshot's own
    // target (the old binary) is what the route runs with.
    mkdirSync(dirname(snapshotPath("old", "dev-foo-1")), { recursive: true });
    const snapNew = JSON.parse(readFileSync(snapshotPath("new", "dev-foo-1"), "utf8"));
    writeFileSync(snapshotPath("old", "dev-foo-1"), JSON.stringify({ ...snapNew, serverId: "old", target: { ...snapNew.target, oatsPath: oldOats } }));
    // The twin: a routed spawn whose GENERATED name collides with dev's saved
    // route. The remote spawn succeeds, the existing route is not overwritten,
    // and the result says the new instance has no saved route here.
    r = oats(env, ["spawn", "dev-foo", "--server", "new", "--purpose", "1", "--no-launch", "--json"]); assert.equal(r.status, 0, r.stderr + r.stdout);
    const twinHome = r.json().result.home;
    assert.equal(r.json().result.instance, "dev-foo-1"); assert.notEqual(devHome, twinHome);
    assert.deepEqual(r.json().result.routeConflict, { instance: "dev-foo-1", existingHome: devHome });
    assert.equal(r.json().result.snapshot, null); assert.match(r.json().result.warnings.join("\n"), /--home/);
    assert.equal(JSON.parse(readFileSync(snapshotPath("new", "dev-foo-1"), "utf8")).home, devHome, "the saved route is untouched");
    // The roster gives the saved route to the row with the saved HOME only;
    // the twin under dev-foo is observed, never actionable from here.
    r = oats(env, ["server", "roster", "--server", "new", "--json"]);
    const rows = r.json().result.groups[0].instances.filter((i) => i.instance === "dev-foo-1");
    assert.deepEqual(rows.map((i) => [i.agent, i.savedRoute]).sort(), [["dev", true], ["dev-foo", false]]);
    // An explicit name that already has a saved route here is refused before
    // the remote spawn; a generated collision never overwrites the route.
    r = oats(env, ["spawn", "dev-foo", "--server", "new", "--instance", "dev-foo-1", "--no-launch", "--json"]);
    assert.equal(r.json().error?.code, "E_ROUTE_EXISTS");
    assert.equal(JSON.parse(readFileSync(snapshotPath("new", "dev-foo-1"), "utf8")).home, devHome, "the saved route is untouched");
    // Old remote, twins there: refused before any mutation, with the upgrade named.
    r = oats(env, ["retire", "dev-foo-1", "--server", "old", "--json"]);
    assert.equal(r.json().error?.code, "E_REMOTE_INCOMPATIBLE", r.stdout + r.stderr); assert.match(r.json().error.message, /0\.22\.3/);
    assert.equal(existsSync(devHome), true); assert.equal(existsSync(twinHome), true);
    // Old remote, explicit --home: never sent where it cannot be honoured.
    r = oats(env, ["retire", "dev-foo-1", "--server", "old", "--home", devHome, "--json"]);
    assert.equal(r.json().error?.code, "E_REMOTE_INCOMPATIBLE");
    // Old remote, one instance of that name only, but not at the saved home
    // (the route drifted): refused as a stale route, nothing retired.
    const driftSnap = JSON.parse(readFileSync(snapshotPath("old", "dev-foo-1"), "utf8"));
    writeFileSync(snapshotPath("old", "dev-foo-1"), JSON.stringify({ ...driftSnap, home: join(repo, "agents", "dev", "instances", "dev-foo-9") }));
    rmSync(twinHome, { recursive: true, force: true });
    r = oats(env, ["retire", "dev-foo-1", "--server", "old", "--json"]);
    assert.equal(r.json().error?.code, "E_HOME_MISMATCH", r.stdout); assert.match(r.json().error.message, /stale/);
    assert.equal(existsSync(devHome), true);
    writeFileSync(snapshotPath("old", "dev-foo-1"), JSON.stringify(driftSnap));
    r = oats({ ...env, PATH: `${tools}:${env.PATH}` }, ["spawn", "dev-foo", "--purpose", "1", "--dir", repo, "--no-launch", "--json"], { cwd: repo }); assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.json().result.home, twinHome);
    // New remote, an explicit home that is not the saved route: refused.
    r = oats(env, ["retire", "dev-foo-1", "--server", "new", "--home", twinHome, "--json"]);
    assert.equal(r.json().error?.code, "E_HOME_MISMATCH"); assert.equal(existsSync(twinHome), true);
    // New remote: the saved home travels as --home; the twin survives.
    const logBefore = readFileSync(join(base, "ssh.log"), "utf8").length;
    r = oats(env, ["retire", "dev-foo-1", "--server", "new", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(readFileSync(join(base, "ssh.log"), "utf8").slice(logBefore).includes(`retire dev-foo-1 --home ${remoteQuote(devHome)}`), "the saved home was sent as --home");
    assert.equal(existsSync(devHome), false, "the saved-route instance is retired");
    assert.equal(existsSync(twinHome), true, "the twin under the other agent is untouched");
    assert.equal(existsSync(snapshotPath("new", "dev-foo-1")), false);
    } finally { if (prevHomeDir === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = prevHomeDir; }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("roster budget: slow targets are bounded, healthy results survive, unreached targets are reported", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-servers-budget-"));
  try {
    const { bin, tools } = fakeBin(base);
    const repo = remoteWorkspace(base);
    const env = { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, OATS_HOME_DIR: join(base, "oats-home"), HOME: join(base, "home") };
    mkdirSync(env.HOME, { recursive: true }); mkdirSync(env.OATS_HOME_DIR, { recursive: true });
    for (const k of Object.keys(env)) if (/^(OATS_INSTANCE|PI_AGENT)/.test(k)) delete env[k];
    // A "host" whose oats never answers: the remote command word runs this.
    const slow = join(base, "slow-oats"); write(slow, "#!/bin/sh\nsleep 20\nexit 255\n"); chmodSync(slow, 0o755);
    let r = oats(env, ["server", "add", "good", "--ssh", "good-host", "--workspace", repo, "--oats", CLI, "--path", tools, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    for (const id of ["slow1", "slow2"]) {
      r = oats(env, ["server", "add", id, "--ssh", `${id}-host`, "--workspace", repo, "--oats", slow, "--json"]);
      assert.equal(r.status, 0, r.stderr);
    }
    const t0 = Date.now();
    r = oats(env, ["server", "roster", "--json", "--budget", "9000", "--per-target", "4000"]);
    const elapsed = Date.now() - t0;
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const out = r.json().result;
    assert.ok(elapsed < 14000, `roster took ${elapsed} ms against a 9 s budget`);
    assert.deepEqual(out.groups.map((g) => g.server), ["good", "slow1", "slow2"]);
    assert.deepEqual(out.groups[0].probe, { ok: true });
    assert.deepEqual(out.groups[0].souls.map((s) => s.name), ["dev"]);
    assert.equal(out.groups[1].probe.ok, false); assert.notEqual(out.groups[1].probe.error.code, "E_ROSTER_BUDGET");
    assert.equal(out.groups[2].probe.ok, false);
    assert.equal(out.bounds.budgetMs, 9000); assert.equal(out.bounds.perTargetTimeoutMs, 4000);
    // With a budget only one slow target can consume, the last one is
    // reported as not reached rather than dropped or waited for.
    r = oats(env, ["server", "roster", "--json", "--budget", "5000", "--per-target", "4000"]);
    const out2 = r.json().result;
    assert.deepEqual(out2.groups[0].probe, { ok: true });
    assert.equal(out2.groups[2].probe.error.code, "E_ROSTER_BUDGET");
    assert.equal(out2.bounds.skipped, 1);
    r = oats(env, ["server", "roster", "--json", "--budget", "5"]);
    assert.equal(r.json().error.code, "E_BAD_ARGS");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
