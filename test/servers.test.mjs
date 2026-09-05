// Server registry and remote routing (lib/servers.mjs, `oats server`,
// `--server`). The SSH contract is exercised locally: a fake `ssh` on PATH
// records how it was called and runs the remote command through `sh -c`
// exactly as a login shell would, against the REAL kernel in a temp
// workspace. What is proven here is the routing, the quoting, the envelope
// handling and the snapshot lifecycle — not that any real host works.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { attachArgv, checkRemoteSupport, resolveRoute, compareSemver, remoteQuote, snapshotPath, sshArgv, validateServer } from "../lib/servers.mjs";

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
  const withPath = sshArgv({ sshHost: "h", workspace: "/w", oatsPath: "oats", path: "~/.local/bin:/opt/my tools/bin" }, ["version"]);
  assert.equal(withPath[7], `PATH="$HOME"/.local/bin:'/opt/my tools/bin':"$PATH" oats version`);
  const seen = execFileSync("sh", ["-c", withPath[7].replace(/ oats version$/, "; printf %s \"$PATH\"")], { encoding: "utf8", env: { HOME: "/home/remote", PATH: "/usr/bin" } });
  assert.equal(seen, "/home/remote/.local/bin:/opt/my tools/bin:/usr/bin");
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

test("checkRemoteSupport: a request is held to what the remote kernel advertises, soul defaults included", () => {
  const legacy = { version: "0.22.1", runtimes: ["pi", "claude"], sessionBackends: [], launchOptions: [], advertised: false };
  const modern = { version: "0.22.2", runtimes: ["pi", "claude", "codex"], sessionBackends: ["tmux", "herdr"], launchOptions: ["yolo"], advertised: true };
  const target = { sshHost: "h" };
  const roster = { agents: [{ name: "dev", runtime: "codex" }, { name: "rev", runtime: "claude" }] };
  assert.deepEqual(checkRemoteSupport(legacy, target, ["rev", "--purpose", "x"], roster), { runtime: "claude", backend: undefined, yolo: false });
  assert.throws(() => checkRemoteSupport(legacy, target, ["dev"], roster), /does not support runtime codex \(the default of soul dev\)/);
  assert.throws(() => checkRemoteSupport(legacy, target, ["rev", "--runtime", "codex"], roster), /runtime codex/);
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
    // A request beyond what the remote advertises is refused BEFORE any spawn reaches it.
    const before = readFileSync(log, "utf8");
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "nope", "--runtime", "codex", "--no-launch", "--json"]);
    assert.equal(r.json().error.code, "E_REMOTE_INCOMPATIBLE");
    assert.equal(readFileSync(log, "utf8").includes("spawn dev --purpose nope"), false, "no spawn command was sent");
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "nope", "--yolo", "--no-launch", "--json"]);
    assert.equal(r.json().error.code, "E_REMOTE_INCOMPATIBLE");
    // The viewer route: ssh -t, saved target, remote home from the snapshot; --print shows it.
    const att = attachArgv("build", { instance: "dev-probe" });
    assert.deepEqual(att.argv.slice(0, 2), ["ssh", "-t"]);
    assert.equal(att.home, home);
    assert.match(att.argv.at(-1), new RegExp(`session attach --home ${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    assert.throws(() => attachArgv("build", { instance: "ghost" }), /no remote instance "ghost"/);
    assert.deepEqual(resolveRoute("build", { instance: "dev-probe" }).target, snap.target, "inspect and attach share the saved route");
    // Remote inspect relays the execution host's answer as its envelope; this fake remote (a kernel without session commands) answers no envelope, which is a nonzero typed failure, never a silent ok.
    r = oats(env, ["session", "inspect", "--server", "build", "--instance", "dev-probe", "--json"]);
    assert.notEqual(r.status, 0);
    assert.match(r.json().error.code, /^E_(UNKNOWN_COMMAND|REMOTE_ENVELOPE)$/, "the execution host's own failure envelope is relayed");
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
