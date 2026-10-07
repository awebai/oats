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
import { fakeBin } from "./helpers/fake-ssh.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { dirname, join, resolve } from "node:path";

import { FAILED_SPAWN_BRANCH_LEFT, spawnInstanceAsync } from "../lib/core.mjs";
import { attachArgv, checkRemoteSupport, resolveRoute, routeCommand, runRemote, compareSemver, remoteQuote, snapshotPath, sshArgv, validateServer } from "../lib/servers.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);

// In-process routes prepare the ssh control directory under OATS_HOME_DIR:
// never the operator's own ~/.oats. Tests that need their own set and restore it.
const isolatedHomeDir = mkdtempSync("/tmp/oats-servers-oh-");
const outerHomeDir = process.env.OATS_HOME_DIR;
process.env.OATS_HOME_DIR = isolatedHomeDir;
test.after(() => {
  if (outerHomeDir === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = outerHomeDir;
  rmSync(isolatedHomeDir, { recursive: true, force: true });
});

function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }

/** The registered "remote" workspace: a workspace deployment (oats-local.yaml
 *  over a one-repo workspace) whose soul dev works in a checkout of the member
 *  clone. `base` owns it: removed with the test's temp directory. */
const deployments = [];
function remoteDeployment(souls = {}) {
  const fx = v2Deployment({ souls: { dev: { soul: { work: "checkout" }, agents: "You are dev.\n" }, ...souls } });
  deployments.push(fx);
  return fx;
}
function remoteWorkspace() { return remoteDeployment().dep; }
test.after(() => { for (const fx of deployments) fx.cleanup(); });

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
  const end = argv.indexOf("--");
  assert.equal(argv[end + 1], "h"); assert.equal(argv.length, end + 3);
  // Run the produced command word through a real sh, with `oats` replaced by an argv echo.
  const cmd = argv[end + 2].replace(/^oats /, "");
  const out = execFileSync("sh", ["-c", `node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- ${cmd}`], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), args);
  assert.equal(existsSync("NEVER_RUN"), false);
  assert.equal(remoteQuote("safe.path/x=1"), "safe.path/x=1");
  assert.equal(remoteQuote(""), "''");
  // A ~/ path prefix expands on the REMOTE shell; a spaced one stays quoted; $PATH is the remote's.
  // A cwd prefix is quoted like any argument and precedes the PATH prefix.
  const withCwd = sshArgv({ sshHost: "h", workspace: "/w", oatsPath: "oats" }, ["okf", "harvest"], { cwd: "/w/it's here/$(touch NEVER_RUN)" });
  assert.equal(withCwd.at(-1), `cd '/w/it'\\''s here/$(touch NEVER_RUN)' && oats okf harvest`);
  const cwdSeen = execFileSync("/bin/sh", ["-c", withCwd.at(-1).replace(/ && oats okf harvest$/, " 2>/dev/null || printf %s \"$1\"") , "--", "cd-failed-as-expected"], { encoding: "utf8" });
  assert.equal(cwdSeen, "cd-failed-as-expected"); assert.equal(existsSync("NEVER_RUN"), false);
  const withPath = sshArgv({ sshHost: "h", workspace: "/w", oatsPath: "oats", path: "~/.local/bin:/opt/my tools/bin" }, ["version"]);
  assert.equal(withPath.at(-1), `PATH="$HOME"/.local/bin:'/opt/my tools/bin':"$PATH" oats version`);
  const seen = execFileSync("/bin/sh", ["-c", withPath.at(-1).replace(/ oats version$/, "; printf %s \"$PATH\"")], { encoding: "utf8", env: { HOME: "/home/remote", PATH: "/usr/bin:/bin" } });
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
  // With no saved route, the name resolves through the host's roster first.
  const roster = JSON.stringify({ root: "/srv/agents", agents: [{ name: "dev", instances: [{ instance: "dev-x", home: "/srv/agents/dev/instances/dev-x" }] }] });
  const routed = routeCommand("build", "retire", ["dev-x"], { server: { id: "build", sshHost: "h", workspace: "/w", oatsPath: "oats" }, execFileSync: (bin, argv) => (String(argv.at(-1)).includes("version --json") ? JSON.stringify({ schemaVersion: 1, name: "@awebai/oats", version: "0.22.2", desktopApi: 1 }) : String(argv.at(-1)).includes("status --json") ? roster : exec()) });
  assert.equal(routed.envelope.ok, false);
  assert.equal(routed.envelope.result.server, "build");
  assert.equal(routed.envelope.result.target.sshHost, "h");
  const clean = () => JSON.stringify({ retired: "dev-x", agent: "dev", removedDir: true });
  assert.equal(runRemote({ sshHost: "h", workspace: "/w", oatsPath: "oats" }, ["retire", "dev-x", "--json"], { execFileSync: clean }).envelope.ok, true);
});

test("checkRemoteSupport: a request is held to what the remote kernel advertises, soul defaults included", () => {
  const legacy = { version: "0.22.1", harnesses: ["pi", "claude"], sessionBackends: [], launchOptions: [], features: [], advertised: false };
  const modern = { version: "0.22.2", harnesses: ["pi", "claude", "codex"], sessionBackends: ["tmux"], launchOptions: ["yolo"], features: [], advertised: true };
  const current = { ...modern, version: "0.27.0", features: ["harness"] };
  const target = { sshHost: "h" };
  const roster = { agents: [{ name: "dev", harness: "codex" }, { name: "rev", harness: "claude" }] };
  assert.deepEqual(checkRemoteSupport(legacy, target, ["rev", "--purpose", "x"], roster), { harness: "claude", backend: undefined, yolo: false });
  // --harness or --runtime (its pre-0.27 name) is the choice on a host of any version: the
  // forwarded flag is spelled in the host's names (hostHarnessArgs). A 0.26.x roster says `runtime`.
  assert.deepEqual(checkRemoteSupport(legacy, target, ["rev", "--harness", "claude"], roster), { harness: "claude", backend: undefined, yolo: false });
  assert.deepEqual(checkRemoteSupport(modern, target, ["x"], { agents: [{ name: "x", runtime: "codex" }] }), { harness: "codex", backend: undefined, yolo: false });
  assert.throws(() => checkRemoteSupport(legacy, target, ["rev", "--runtime", "codex"], roster), /harness codex was not established/);
  assert.deepEqual(checkRemoteSupport(legacy, target, ["rev", "--runtime", "pi"], roster), { harness: "pi", backend: undefined, yolo: false });
  assert.deepEqual(checkRemoteSupport(current, target, ["rev", "--harness", "codex"], roster), { harness: "codex", backend: undefined, yolo: false });
  assert.throws(() => checkRemoteSupport(legacy, target, ["rev", "--yolo"], roster), /yolo launch option/);
  assert.throws(() => checkRemoteSupport(legacy, target, ["rev", "--backend", "tmux"], roster), /session backend tmux/);
  assert.deepEqual(checkRemoteSupport(modern, target, ["dev", "--backend", "tmux", "--yolo"], roster), { harness: "codex", backend: "tmux", yolo: true });
  assert.throws(() => checkRemoteSupport(modern, target, ["dev", "--backend", "screen"], roster), /session backend screen/);
});

test("oats server + --server: registry, check, remote spawn with a hostile task, status, retire from the snapshot after the registration is gone", () => {
  const base = mkdtempSync("/tmp/oats-servers-"); // short: the control socket path must fit in 104 bytes
  try {
    const { bin, log, tools } = fakeBin(base);
    const { dep: repo, key: workspaceKey } = remoteDeployment();
    // Only enumerated tools and fake ssh/tmux, not even node's parent bin
    // directory: it may contain globally installed model harnesses.
    const env = { ...process.env, PATH: bin, OATS_HOME_DIR: join(base, "oats-home"), HOME: join(base, "home") };
    const prevHomeDir = process.env.OATS_HOME_DIR; process.env.OATS_HOME_DIR = env.OATS_HOME_DIR;
    mkdirSync(env.HOME, { recursive: true }); mkdirSync(env.OATS_HOME_DIR, { recursive: true });
    for (const k of Object.keys(env)) if (/^(OATS_INSTANCE|PI_AGENT)/.test(k)) delete env[k];

    // registry
    let r = oats(env, ["server", "list", "--json"]);
    assert.equal(r.status, 0, r.stderr); assert.deepEqual(r.json().result.servers, []);
    r = oats(env, ["server", "add", "build", "--ssh", "build-host", "--workspace", repo, "--oats", CLI, "--label", "Build box", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const reg = JSON.parse(readFileSync(join(env.OATS_HOME_DIR, "servers.json"), "utf8"));
    // The workspace key is the host's own answer (its status --json), learned at add.
    assert.deepEqual(reg.servers.build, { sshHost: "build-host", workspace: repo, oatsPath: CLI, label: "Build box", workspaceKey });
    r = oats(env, ["server", "add", "build", "--ssh", "other", "--workspace", repo, "--json"]);
    assert.notEqual(r.status, 0); assert.equal(r.json().error.code, "E_SERVER_EXISTS");
    r = oats(env, ["server", "add", "bad", "--ssh", "root@x", "--workspace", repo, "--json"]);
    assert.equal(r.json().error.code, "E_SERVER_INVALID");

    // check: version probe and status, no mutation
    r = oats(env, ["server", "check", "build", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const chk = r.json().result;
    assert.equal(chk.remote.desktopApi, 1); assert.equal(typeof chk.remote.version, "string");
    // A workspace deployment lists a soul under agents/ once it has been spawned
    // (its per-commit copy); none has been yet.
    assert.equal(chk.workspaceReachable, true); assert.equal(chk.agents, 0);
    const sshLines = readFileSync(log, "utf8");
    const controlPath = join(env.OATS_HOME_DIR, "ssh", "%C");
    assert.ok(sshLines.startsWith(["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-o", "ControlMaster=auto", "-o", `ControlPath=${controlPath}`, "-o", "ControlPersist=60", "--", "build-host", ""].join("\n")), `non-interactive, kept alive, one control master, options ended with -- before the host:\n${sshLines}`);

    // remote spawn: the task travels as text and lands byte for byte
    const hostile = "Review `this` and $(touch NEVER_RUN) 'quotes' \"dq\"\nsecond line % and * and ~\n";
    const taskFile = join(base, "task.md"); writeFileSync(taskFile, hostile);
    // Without --path the remote preflight cannot find the harness: a typed
    // failure from the remote kernel, relayed as its own envelope.
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "probe", "--task-file", taskFile, "--no-launch", "--json"]);
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.json().error.message, /pi binary not found/);
    assert.equal(existsSync(join(repo, "agents", "dev", "instances", "dev-probe")), false, "missing harness refuses before creating a home");
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
    // and codex on tmux with the yolo option; ask for what it lacks.
    const before = readFileSync(log, "utf8");
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "nope", "--harness", "gemini", "--no-launch", "--json"]);
    assert.equal(r.json().error.code, "E_REMOTE_INCOMPATIBLE");
    assert.match(r.json().error.message, /harness gemini was not established as supported there \(it advertises harnesses pi, claude, codex/, "an advertising remote's list is quoted, nothing more is claimed");
    assert.equal(readFileSync(log, "utf8").includes("spawn dev --purpose nope"), false, "no spawn command was sent");
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "nope", "--backend", "screen", "--no-launch", "--json"]);
    assert.equal(r.json().error.code, "E_REMOTE_INCOMPATIBLE");
    assert.match(r.json().error.message, /session backend screen/);
    // --runtime, the pre-0.27 name, is routed too: the forwarded envelope keeps ONE deprecated-runtime-name
    // warning, this command's note merged with whatever the host said (lead call 6).
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "alias", "--runtime", "pi", "--no-launch", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.json().warnings?.length, 1, r.stdout);
    assert.equal(r.json().warnings[0].code, "deprecated-runtime-name");
    assert.ok(r.json().warnings[0].sources.includes("the --runtime flag (use --harness)"), JSON.stringify(r.json().warnings));
    assert.equal(r.stderr.includes("oats: warning"), false, "delivered in the envelope");
    r = oats(env, ["retire", "dev-alias", "--server", "build", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    // A flag this side reads (a routed preview) is sent in the host's names, and the note joins the envelope.
    r = oats(env, ["launch-config", "preview", "--server", "build", "--instance", "dev-probe", "--runtime", "pi", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(r.json().warnings?.map((w) => [w.code, w.sources]), [["deprecated-runtime-name", ["the --runtime flag (use --harness)"]]], r.stdout);
    assert.match(readFileSync(log, "utf8"), /launch-config preview --harness pi --home /, "the 0.27 host is sent --harness");
    // The viewer route: ssh -t, saved target, remote home from the snapshot; --print shows it.
    const att = attachArgv("build", { instance: "dev-probe" }, { skipVersionCheck: true }); // route resolution only; the version gate is exercised through the CLI above
    assert.deepEqual(att.argv.slice(0, 2), ["ssh", "-t"]);
    assert.equal(att.home, home);
    assert.match(att.argv.at(-1), new RegExp(`session attach --home ${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    r = oats(env, ["session", "attach", "--server", "build", "--instance", "ghost", "--print"]);
    assert.notEqual(r.status, 0); assert.match(r.stderr, /no instance "ghost" on server build: neither a saved route here nor its roster names one/);
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
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^ssh -t -o 'BatchMode=yes' .* -o 'ControlPersist=60' -- build-host /);
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

    // spawn's text answer: the attach line is the routed viewer, never a bare tmux command for the host
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "txt", "--no-launch"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /^  attach: oats session attach --server build --instance dev-txt$/m);
    assert.doesNotMatch(r.stdout, /tmux attach/);
    r = oats(env, ["retire", "dev-txt", "--server", "build", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);

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
    const repo = remoteWorkspace();
    const env = { ...process.env, PATH: bin, OATS_HOME_DIR: join(base, "oats-home"), HOME: join(base, "home") };
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

test("routed retire with same-named twins: exact home on a 0.22.3 remote, refusal on an older one", async () => {
  const base = mkdtempSync(join(tmpdir(), "oats-servers-twins-"));
  try {
    const { bin, tools } = fakeBin(base);
    // A second soul whose name can collide with dev's: dev --purpose foo-1 and
    // dev-foo --purpose 1 both derived dev-foo-1 before 0.26.0. A 0.26 spawn
    // de-duplicates names deployment-wide (it would derive dev-foo-1-2), but
    // homes an earlier kernel created keep sharing the name — the twins below.
    const fx = remoteDeployment({ "dev-foo": { soul: { work: "checkout" }, agents: "You are dev-foo.\n" } });
    const repo = fx.dep;
    const env = { ...process.env, PATH: bin, OATS_HOME_DIR: join(base, "oats-home"), HOME: join(base, "home") };
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
    // The twin: dev-foo's home of the same name, as an earlier kernel left it on
    // the remote (created here by a direct kernel call naming the instance; a
    // 0.26 spawn never derives it). It has no saved route here. That a routed
    // spawn reporting a colliding name never overwrites a saved route
    // (routeConflict) is lib/servers.mjs's own, covered by the routeCommand test.
    const makeTwin = async () => {
      const prevPath = process.env.PATH; process.env.PATH = `${tools}:${bin}`;
      try {
        const { prepared, agent } = await fx.prepare("dev-foo");
        return (await spawnInstanceAsync(fx.root, agent, { prepared, instance: "dev-foo-1", repo: fx.member, launch: false })).home;
      } finally { process.env.PATH = prevPath; }
    };
    const twinHome = await makeTwin();
    assert.notEqual(devHome, twinHome);
    r = oats(env, ["spawn", "dev-foo", "--server", "new", "--purpose", "1", "--no-launch", "--preview", "--json"]); assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.json().result.instance, "dev-foo-1-2", "a 0.26 spawn skips the name the twins share");
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
    // A viewer addresses the HOME: the twin (no saved route) is reachable by
    // its home, the saved instance by name, and a name with the wrong home
    // is refused; the ssh command word carries the home either way.
    for (const [addr, wantHome] of [[["--instance", "dev-foo-1"], devHome], [["--home", twinHome], twinHome]]) {
      const mark = readFileSync(join(base, "ssh.log"), "utf8").length;
      r = oats(env, ["session", "inspect", "--server", "new", ...addr, "--json"]);
      assert.ok(readFileSync(join(base, "ssh.log"), "utf8").slice(mark).includes(`session inspect --home ${remoteQuote(wantHome)}`), `viewer route for ${addr.join(" ")}: ${r.stdout}`);
    }
    r = oats(env, ["session", "inspect", "--server", "new", "--instance", "dev-foo-1", "--home", twinHome, "--json"]);
    assert.equal(r.json().error?.code, "E_HOME_MISMATCH");
    // Old remote, one instance of that name only, but not at the saved home
    // (the route drifted): refused as a stale route, nothing retired.
    const driftSnap = JSON.parse(readFileSync(snapshotPath("old", "dev-foo-1"), "utf8"));
    writeFileSync(snapshotPath("old", "dev-foo-1"), JSON.stringify({ ...driftSnap, home: join(repo, "agents", "dev", "instances", "dev-foo-9") }));
    rmSync(twinHome, { recursive: true, force: true });
    r = oats(env, ["retire", "dev-foo-1", "--server", "old", "--json"]);
    assert.equal(r.json().error?.code, "E_HOME_MISMATCH", r.stdout); assert.match(r.json().error.message, /stale/);
    assert.equal(existsSync(devHome), true);
    writeFileSync(snapshotPath("old", "dev-foo-1"), JSON.stringify(driftSnap));
    assert.equal(await makeTwin(), twinHome, "the earlier-kernel twin is back");
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

test("routed spawn: a success reply without a home never replaces an existing saved route", () => {
  const base = mkdtempSync("/tmp/oats-nohome-");
  const prevHomeDir = process.env.OATS_HOME_DIR; process.env.OATS_HOME_DIR = join(base, "oats-home"); mkdirSync(process.env.OATS_HOME_DIR);
  try {
    const server = { id: "build", sshHost: "h", workspace: "/w", oatsPath: "oats" };
    const target = { sshHost: "h", workspace: "/w", oatsPath: "oats" };
    mkdirSync(dirname(snapshotPath("build", "dev-x")), { recursive: true });
    const prior = { serverId: "build", target, remote: { version: "0.22.3", schemaVersion: 1 }, instance: "dev-x", agent: "dev", home: "/w/agents/dev/instances/dev-x", agentsRoot: "/w/agents", spawnedAt: "2026-09-05T00:00:00.000Z" };
    writeFileSync(snapshotPath("build", "dev-x"), JSON.stringify(prior));
    const probe = { schemaVersion: 1, name: "@awebai/oats", version: "0.22.3", desktopApi: 1, runtimes: ["pi"], sessionBackends: ["tmux"], launchOptions: [], remote: ["spawn", "retire", "status", "session", "roster", "harvest"], features: ["retire-home"] };
    const status = { schemaVersion: 1, ok: true, result: { root: "/w/agents", agents: [{ name: "dev", runtime: "pi", instances: [] }] } };
    let calls = 0;
    const exec = (bin, argv) => {
      calls++;
      const word = String(argv.at(-1));
      if (word.includes("version --json")) return JSON.stringify(probe);
      if (word.includes(" status ")) return JSON.stringify(status);
      if (word.includes(" spawn ")) return JSON.stringify({ schemaVersion: 1, ok: true, result: { instance: "dev-x", agent: "dev", launched: false, warnings: [] } });
      throw new Error(`unexpected remote call: ${word}`);
    };
    const routed = routeCommand("build", "spawn", ["dev", "--purpose", "x", "--no-launch"], { server, execFileSync: exec });
    assert.equal(calls, 3);
    assert.equal(routed.envelope.ok, true);
    assert.equal(routed.envelope.result.snapshot, null, "no route written for a home-less result");
    assert.deepEqual(routed.envelope.result.routeConflict, { instance: "dev-x", existingHome: prior.home });
    assert.deepEqual(JSON.parse(readFileSync(snapshotPath("build", "dev-x"), "utf8")), prior, "the existing route survives byte for byte");
    // The same home in the reply is the same route: replaced, no conflict.
    const same = (bin, argv) => (String(argv.at(-1)).includes(" spawn ") ? JSON.stringify({ schemaVersion: 1, ok: true, result: { instance: "dev-x", agent: "dev", home: prior.home, launched: false, warnings: [] } }) : exec(bin, argv));
    const again = routeCommand("build", "spawn", ["dev", "--purpose", "x", "--no-launch"], { server, execFileSync: same });
    assert.equal(again.envelope.result.routeConflict, undefined); assert.equal(typeof again.envelope.result.snapshot, "string");
  } finally {
    if (prevHomeDir === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = prevHomeDir;
    rmSync(base, { recursive: true, force: true });
  }
});

test("roster: each group relays the host's status `workspace` verbatim (an older host's reachability-only one too), or null from a host that reports none", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-servers-ws-"));
  try {
    const { bin, tools } = fakeBin(base);
    const repo = remoteWorkspace(); // nothing spawned: an empty remote deployment still reports its workspace
    const env = { ...process.env, PATH: bin, OATS_HOME_DIR: join(base, "oats-home"), HOME: join(base, "home") };
    mkdirSync(env.HOME, { recursive: true }); mkdirSync(env.OATS_HOME_DIR, { recursive: true });
    for (const k of Object.keys(env)) if (/^(OATS_INSTANCE|PI_AGENT)/.test(k)) delete env[k];
    // A host whose status answer is rewritten by `edit` (a JS expression over the parsed answer `j`).
    const hostWith = (name, edit) => {
      const file = join(base, name);
      write(file, `#!/bin/sh
if [ "$1" = status ]; then
  ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} "$@" | ${JSON.stringify(process.execPath)} -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const j=JSON.parse(s);${edit};process.stdout.write(JSON.stringify(j))})'
else exec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} "$@"; fi
`);
      chmodSync(file, 0o755);
      return file;
    };
    // A host before workspace-identity answers the reachability-only object; one that reports no
    // workspace at all (as a deployment without oats-local.yaml does) omits it.
    const older = hostWith("older-oats", "j.workspace={reachable:j.workspace.reachable}");
    const none = hostWith("none-oats", "delete j.workspace");
    let r = oats(env, ["server", "add", "current", "--ssh", "current-host", "--workspace", repo, "--oats", CLI, "--path", tools, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    r = oats(env, ["server", "add", "older", "--ssh", "older-host", "--workspace", repo, "--oats", older, "--path", tools, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    r = oats(env, ["server", "add", "none", "--ssh", "none-host", "--workspace", repo, "--oats", none, "--path", tools, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    r = oats(env, ["server", "add", "down", "--ssh", "down-host", "--workspace", join(base, "no-such-ws"), "--oats", CLI, "--json"]);
    assert.equal(r.status, 0, r.stderr);

    r = oats(env, ["server", "roster", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const groups = Object.fromEntries(r.json().result.groups.map((g) => [g.server, g]));
    // What the host itself answers, run where the fake ssh runs it.
    const own = oats(env, ["status", "--json", "--dir", repo]);
    assert.equal(own.status, 0, own.stderr);
    const hostWorkspace = JSON.parse(own.stdout).workspace;
    assert.equal(typeof hostWorkspace.key, "string", "the host reports its workspace identity");
    assert.deepEqual(groups.current.probe, { ok: true });
    assert.deepEqual(groups.current.workspace, hostWorkspace, "relayed verbatim");
    assert.deepEqual(groups.current.instances, []);
    assert.deepEqual(groups.older.probe, { ok: true });
    assert.deepEqual(groups.older.workspace, { reachable: true }, "an older host's reachability-only object is relayed as it is");
    assert.deepEqual(groups.none.probe, { ok: true });
    assert.equal(groups.none.workspace, null, "a host that reports no workspace relays null");
    assert.equal(groups.down.probe.ok, false);
    assert.equal(groups.down.workspace, null, "an unreachable host relays null");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("roster budget: slow targets are bounded, healthy results survive, unreached targets are reported", () => {
  const base = mkdtempSync(join(tmpdir(), "oats-servers-budget-"));
  try {
    const { bin, tools } = fakeBin(base);
    const fx = remoteDeployment();
    const repo = fx.dep;
    // The roster lists a workspace soul once it has been spawned (its per-commit copy under agents/).
    const seeded = fx.cli(["spawn", "dev", "--purpose", "seed", "--no-launch", "--json"]);
    assert.equal(seeded.status, 0, seeded.stdout + seeded.stderr);
    const env = { ...process.env, PATH: bin, OATS_HOME_DIR: join(base, "oats-home"), HOME: join(base, "home") };
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

test("routed retire: the branch a failed spawn's quarantine still owes is named on its own line, from the host's receipt", () => {
  const base = mkdtempSync("/tmp/oats-servers-"); // short: the control socket path must fit in 104 bytes
  try {
    const { bin, tools } = fakeBin(base);
    const repo = remoteWorkspace();
    const env = { ...process.env, PATH: bin, OATS_HOME_DIR: join(base, "oats-home"), HOME: join(base, "home") };
    mkdirSync(env.HOME, { recursive: true }); mkdirSync(env.OATS_HOME_DIR, { recursive: true });
    for (const k of Object.keys(env)) if (/^(OATS_INSTANCE|PI_AGENT)/.test(k)) delete env[k];
    // The host's oats: the real kernel, except that a retire answers with the receipt the test wrote,
    // with its exit status. No retirement runs. Shell builtins only: the fixture's PATH has no cat.
    const receipt = join(base, "receipt.json"), exit = join(base, "receipt-exit");
    const hostOats = join(base, "host-oats");
    writeFileSync(hostOats, `#!/bin/sh
case " $* " in *" retire "*) case " $* " in *" --plan "*) ;; *)
  while IFS= read -r line || [ -n "$line" ]; do printf '%s\\n' "$line"; done < ${JSON.stringify(receipt)}
  read -r code < ${JSON.stringify(exit)}; exit "$code" ;; esac ;; esac
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} "$@"
`);
    chmodSync(hostOats, 0o755);
    let r = oats(env, ["server", "add", "build", "--ssh", "build-host", "--workspace", repo, "--oats", hostOats, "--path", tools, "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    r = oats(env, ["spawn", "dev", "--server", "build", "--purpose", "owes", "--no-launch", "--json"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const home = r.json().result.home;
    const answer = (doc, status) => { writeFileSync(receipt, JSON.stringify(doc)); writeFileSync(exit, String(status)); };
    const itemThenBranch = (stderr, branchLine) => {
      const lines = stderr.split("\n");
      const at = lines.indexOf(`  ${FAILED_SPAWN_BRANCH_LEFT}`);
      assert.ok(at >= 0, stderr);
      assert.equal(lines[at + 1], branchLine, stderr);
    };

    // Incomplete, the worktree step ran: the receipt's recorded branch.
    answer({ retired: "dev-owes", agent: "dev", removedDir: false, branchDeleted: false, retainedHome: home, rollbackIncomplete: [FAILED_SPAWN_BRANCH_LEFT],
      retention: { worktree: "removed", branch: null, recordedBranch: "agents/dev-owes" } }, 1);
    r = oats(env, ["retire", "dev-owes", "--server", "build"]);
    assert.equal(r.status, 1, r.stderr + r.stdout);
    itemThenBranch(r.stderr, "  branch: agents/dev-owes");

    // Incomplete, no worktree step ran: where the retained home records it, on the host.
    answer({ retired: "dev-owes", agent: "dev", removedDir: false, branchDeleted: false, retainedHome: home, rollbackIncomplete: ["retire hook x: reported incomplete cleanup", FAILED_SPAWN_BRANCH_LEFT], retention: null }, 1);
    r = oats(env, ["retire", "dev-owes", "--server", "build"]);
    assert.equal(r.status, 1, r.stderr + r.stdout);
    itemThenBranch(r.stderr, `  branch: the "branch" recorded in ${join(home, "instance.json")} on build-host`);

    // Forced past the debt: the host's own stderr is not relayed on success, so the name comes from the receipt.
    answer({ retired: "dev-owes", agent: "dev", removedDir: true, branchDeleted: false, forcedIncomplete: [FAILED_SPAWN_BRANCH_LEFT],
      retention: { worktree: "removed", branch: null, recordedBranch: "agents/dev-owes" } }, 0);
    r = oats(env, ["retire", "dev-owes", "--server", "build", "--force"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    itemThenBranch(r.stderr, "  branch: agents/dev-owes");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("routed inspect --instructions needs a remote that advertises soul-composed-instructions: refused before anything is sent, else the flag travels", () => {
  const server = { id: "build", sshHost: "h", workspace: "/w", oatsPath: "oats" };
  const probe = (features) => ({ schemaVersion: 1, name: "@awebai/oats", version: "0.46.0", desktopApi: 1, harnesses: ["pi"], sessionBackends: ["tmux"], launchOptions: [], remote: ["spawn", "status"], features, operationsApi: 2 });
  const remote = (features) => {
    const sent = [];
    const exec = (bin, argv) => {
      const word = String(argv.at(-1));
      if (word.includes("version --json")) return JSON.stringify(probe(features));
      sent.push(word);
      if (word.includes(" inspect ")) return JSON.stringify({ schemaVersion: 1, ok: true, result: { souls: [{ name: "dev" }] } });
      throw new Error(`unexpected remote call: ${word}`);
    };
    return { sent, exec };
  };
  // An older host would ignore the flag and answer without the field: refused, nothing sent.
  const old = remote(["operations"]);
  assert.throws(() => routeCommand("build", "inspect", ["--soul", "dev", "--instructions"], { server, execFileSync: old.exec }),
    (e) => e.code === "E_REMOTE_INCOMPATIBLE" && /soul-composed-instructions/.test(e.message) && /nothing was sent/.test(e.message));
  assert.deepEqual(old.sent, [], "no inspect was sent to a host without the feature");
  // Without the flag that host still answers inspect.
  const plain = routeCommand("build", "inspect", ["--soul", "dev"], { server, execFileSync: old.exec });
  assert.equal(plain.envelope.ok, true);
  assert.equal(old.sent.length, 1);
  assert.ok(!old.sent[0].includes("--instructions"));
  // A host that advertises it gets the flag, scoped to the registered workspace.
  const current = remote(["operations", "soul-composed-instructions"]);
  const routed = routeCommand("build", "inspect", ["--soul", "dev", "--instructions"], { server, execFileSync: current.exec });
  assert.equal(routed.envelope.ok, true);
  assert.equal(routed.envelope.result.server, "build");
  assert.equal(current.sent.length, 1);
  assert.match(current.sent[0], /(^| )oats inspect --soul dev --instructions --dir \/w --json$/);
});
