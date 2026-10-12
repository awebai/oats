// The effects of the Instances view (lib/read.mjs), with real child processes wherever the
// behaviour is about processes. The kernel and the collector are FAKES (fixtures/fake.mjs), copied
// into a temp directory: no test runs a real `oats` against a deployment, and none starts tmux.
// A test signals only a pid a fake wrote down, and only after it has seen that the pid is its fake.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile as nodeExecFile, execFileSync, spawn as nodeSpawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLLECTOR, INSTANCE_VARIABLES, acceptProbe, cliRecord, failedEntry, livenessInput } from "../lib/client.mjs";
import { KERNEL_BIN, createReader, findDeployment, leaveInstance, probeKernel } from "../lib/read.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake.mjs", import.meta.url));
const LEAVE = fileURLToPath(new URL("./fixtures/leave.mjs", import.meta.url));
const REPOSITORY = fileURLToPath(new URL("../../../", import.meta.url));
/** The version this checkout's kernel reports: the accepted band always admits its own release. */
const VERSION = JSON.parse(readFileSync(path.join(REPOSITORY, "package.json"), "utf8")).version;
/** What the shared observer requires of a kernel, and the feature that puts --max-age on a read. */
const FEATURES = ["workspace-v2", "instance-modules", "served-identity", "packages-no-approval", "observe-max-age"];
const EIGHT = ["PI_AGENTS_ROOT", "PI_AGENT_HOME", "PI_AGENT_INSTANCE", "OATS_HOME", "OATS_INSTANCE_HOME", "OATS_INSTANCE", "OATS_DEPLOYMENT", "OATS_RESOLUTION"];

const ROOT = realpathSync(mkdtempSync(path.join(os.tmpdir(), "oats-tui-read-")));
/** This suite may itself run inside an instance: the fakes get an environment that has left it. */
const CLEAN_ENV = leaveInstance({ ...process.env });
const worlds = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quietly = (act) => { try { return act(); } catch { return undefined; } };
/** Poll until `check()` answers something; it is asked once more after the time is up. */
async function waitFor(what, check, ms = 20_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(15);
  }
}
/** Whether `promise` settles within `ms`. The timer keeps the event loop alive meanwhile: an ended child is unref'd. */
async function settled(promise, ms = 20_000) {
  let timer;
  const answer = await Promise.race([promise.then(() => true), new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); })]);
  clearTimeout(timer);
  return answer;
}
/** Stop this process's event loop for `ms`: it reads no pipe and runs no timer, as a stopped process does not. */
const freeze = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/** A process's fields after its name in /proc (state, parent, group, session); without a /proc, ONE field: what `ps` says of its state. */
function stateOf(pid) {
  if (existsSync("/proc/self/stat")) {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  }
  return [execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim().slice(0, 1)];
}
/** Signal 0 only: whether the pid names a process at all. False once it ended AND was reaped. */
function exists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}
/** Whether the process still runs. One that ended and was not reaped yet (a zombie) does not. */
function alive(pid) {
  if (!exists(pid)) return false;
  try { return stateOf(pid)[0] !== "Z"; } catch { return false; }
}
/** Whether the pid is one of this suite's fakes NOW: its command line names the temp directory. */
function ours(pid) {
  try {
    const command = existsSync("/proc/self/stat") ? readFileSync(`/proc/${pid}/cmdline`, "utf8") : execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
    return command.includes(ROOT);
  } catch { return false; }
}
const gone = (pids, ms = 2000) => waitFor(`pid ${pids.join(", ")} to be gone`, () => pids.every((pid) => !alive(pid)), ms);
/** The process group a process is in: /proc's field where there is a /proc, else what `ps` says (macOS has no /proc). Null unless that is a number. */
function groupOf(pid) {
  const text = quietly(() => (existsSync("/proc/self/stat") ? stateOf(pid)[2] : execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim()));
  return /^[0-9]+$/.test(text ?? "") ? Number(text) : null;
}
/** This process's own group. Null where neither source names it: there the tests below compare no child's group with it. */
const OWN_GROUP = groupOf(process.pid);

test.after(() => {
  // Nothing is left behind: whatever a fake wrote down and still runs as that fake is killed.
  for (const world of worlds) for (const { pid } of world.calls()) if (alive(pid) && ours(pid)) quietly(() => process.kill(pid, "SIGKILL"));
  rmSync(ROOT, { recursive: true, force: true });
});

/** A temp directory with a deployment directory, the three fakes and their plan. */
function makeWorld(plan = {}) {
  const dir = path.join(ROOT, `world-${worlds.length + 1}`), deployment = path.join(dir, "deployment"), log = path.join(dir, "calls.jsonl");
  mkdirSync(deployment, { recursive: true });
  for (const name of ["oats", "collector", "sleeper"]) copyFileSync(FAKE, path.join(dir, `${name}.mjs`));
  const world = {
    dir, deployment, bin: path.join(dir, "oats.mjs"), collector: path.join(dir, "collector.mjs"),
    plan(next) { writeFileSync(path.join(dir, "plan.json"), JSON.stringify(next)); },
    /** What the fakes wrote down, in order; `calls("status", "start")` narrows it. */
    calls(action, event) {
      const all = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
      return all.filter((call) => (action === undefined || call.action === action) && (event === undefined || call.event === event));
    },
  };
  world.cli = cliRecord({ version: VERSION, workspaceApi: 2, features: FEATURES }, { bin: world.bin, source: "tui" });
  world.plan(plan);
  worlds.push(world);
  return world;
}
/** One instance as the kernel reports it. */
const kernelRow = (name, more = {}) => ({ instance: name, running: true, runtimeState: "running", tmux: { session: "oats", window: name, socket: null }, ...more });
/** The smallest `status --json` the shared reader accepts for `deployment`, with these instances under one soul. */
function statusDocument(deployment, rows = [], souls = []) {
  const dir = path.join(deployment, "agents", "dev");
  return { root: path.join(deployment, "agents"), agents: [
    { name: "dev", description: "The developer", dir, instances: rows.map((row) => ({ ...row, home: path.join(dir, "instances", row.instance) })) },
    ...souls.map((soul) => ({ ...soul, dir: path.join(deployment, "agents", soul.name), instances: [] })),
  ] };
}
/** The smallest `workspace status --json` the shared reader accepts for `deployment`. */
const workspaceDocument = (deployment) => ({ schemaVersion: 1, ok: true, result: { workspaceStatusApi: 1,
  workspace: { name: "fake-workspace", key: "local//fake", local: path.join(deployment, "oats-local.yaml") },
  members: [], packages: [], declaredPackages: [], unsynced: [], stale: [], external: [], problems: [] } });
const kernelError = (code, message, details) => ({ stdout: JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message, ...(details ? { details } : {}) } }), exit: 1 });
/** A plan in which the kernel answers `rows` and the collector answers `answers` (as they are, when a string). */
function answering(world, rows = [], answers = [], more = {}) {
  return { status: { stdout: JSON.stringify(statusDocument(world.deployment, rows)) }, workspace: { stdout: JSON.stringify(workspaceDocument(world.deployment)) },
    collector: { stdout: typeof answers === "string" ? answers : JSON.stringify(answers) }, ...more };
}
/** The `at` of the n-th cycle of a reader made by `reading`. */
const at = (n) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
/** A reader over a world, with the caller's side of it: a store of one entry, what was emitted, every process started. */
function reading(t, world, options = {}) {
  const entries = [], spawned = [], store = { entry: null };
  let cycles = 0;
  const reader = createReader({
    deployment: world.deployment, cli: world.cli, env: CLEAN_ENV, collector: world.collector,
    getEntry: () => store.entry,
    onEntry: (emitted) => { entries.push(emitted); store.entry = emitted.entry; },
    clock: () => at(++cycles),
    spawn: (file, args, opts) => { spawned.push({ file, args, options: opts }); return nodeSpawn(file, args, opts); },
    ...options,
  });
  t.after(() => reader.stop());
  return { reader, entries, spawned, store, begun: () => cycles };
}
/** Timers that fire when the test says so, with node's own names. */
function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeout(fn, ms) { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    delays: () => [...pending.values()].map((timer) => timer.ms).sort((a, b) => a - b),
    idOf: (ms) => [...pending].find(([, timer]) => timer.ms === ms)?.[0] ?? null,
    /** Fire the pending timers `match` picks: exactly `count` of them. */
    fire(match, count = 1) {
      const found = [...pending].filter(([, timer]) => match(timer.ms));
      assert.equal(found.length, count, `${count} to fire among ${[...pending.values()].map((timer) => timer.ms).join(", ")}`);
      for (const [id, timer] of found) { pending.delete(id); timer.fn(); }
    },
  };
}
const shown = (entry) => entry.instances.map((row) => [row.instance, row.running, row.runtimeState]);

// ── leaveInstance ─────────────────────────────────────────────────────────────

test("leaveInstance deletes the eight instance variables from the object it is given, and nothing else", () => {
  assert.deepEqual([...INSTANCE_VARIABLES].sort(), [...EIGHT].sort());
  const env = { PATH: "/usr/bin", HOME: "/home/someone", OATS_OTHER: "kept", PI_AGENT: "kept", ...Object.fromEntries(EIGHT.map((name) => [name, "set"])) };
  assert.equal(leaveInstance(env), env, "in place: the same object");
  assert.deepEqual(env, { PATH: "/usr/bin", HOME: "/home/someone", OATS_OTHER: "kept", PI_AGENT: "kept" });
  assert.deepEqual(leaveInstance({}), {});
});

// ── findDeployment ────────────────────────────────────────────────────────────

test("findDeployment walks up from the canonical start, the root included, and reads only whether each directory is a deployment", () => {
  const asked = [];
  const io = (isDeployment, realpath = (p) => p) => ({ realpath, isDirectory: () => true, isDeployment: (dir) => { asked.push(dir); return isDeployment(dir); } });
  assert.deepEqual(findDeployment("/a/b/c", io(() => false)), { ok: false, dir: "/a/b/c" });
  assert.deepEqual(asked.splice(0), ["/a/b/c", "/a/b", "/a", "/"]);
  assert.deepEqual(findDeployment("/given/link", io((dir) => dir === "/real", () => "/real/x/y")), { ok: true, deployment: "/real" });
  assert.deepEqual(asked.splice(0), ["/real/x/y", "/real/x", "/real"], "from the canonical path, and no further than the first that answers");
  assert.deepEqual(findDeployment("/a/b", io((dir) => dir === "/")), { ok: true, deployment: "/" }, "the root is asked too");
  assert.deepEqual(findDeployment("/a/b", io((dir) => dir === "/a/b" || dir === "/a")), { ok: true, deployment: "/a/b" }, "the nearest one");
  assert.deepEqual(findDeployment("/a/b", io((dir) => { if (dir === "/a/b") throw new Error("EACCES"); return dir === "/a"; })), { ok: true, deployment: "/a" }, "a directory that cannot be asked is not one");
  asked.length = 0;
  assert.deepEqual(findDeployment("/a/b", { realpath: () => { throw new Error("ENOENT"); }, isDirectory: () => true, isDeployment: () => true }), { ok: false, dir: "/a/b" });
  assert.deepEqual(findDeployment("/a/file", { ...io(() => true), isDirectory: () => false }), { ok: false, dir: "/a/file" });
  assert.deepEqual(asked, [], "a start that is not a directory is not walked from");
});

test("findDeployment on a real tree: the deployment, deep inside it, a file, a missing path, outside, a linked oats-local.yaml, a linked start", (t) => {
  const base = path.join(ROOT, "find"), deployment = path.join(base, "deployment"), deep = path.join(deployment, "agents", "dev", "instances", "dev-one");
  const inner = path.join(deployment, "nested"), outside = path.join(base, "outside", "somewhere"), linked = path.join(base, "linked"), folder = path.join(base, "folder");
  for (const dir of [deep, path.join(inner, "below"), outside, linked, path.join(folder, "oats-local.yaml")]) mkdirSync(dir, { recursive: true });
  for (const dir of [deployment, inner]) writeFileSync(path.join(dir, "oats-local.yaml"), "");
  writeFileSync(path.join(deep, "TASK.md"), "a file");
  symlinkSync(path.join(deployment, "oats-local.yaml"), path.join(linked, "oats-local.yaml"));
  symlinkSync(deep, path.join(base, "to-deep"));
  symlinkSync(outside, path.join(base, "to-outside"));
  // Where the machine's own temp directory is inside a deployment, "outside" still finds that one.
  const above = findDeployment(ROOT);
  if (above.ok) t.diagnostic(`the temp directory is itself inside a deployment (${above.deployment})`);
  const none = (dir) => (above.ok ? above : { ok: false, dir });

  assert.deepEqual(findDeployment(deployment), { ok: true, deployment });
  assert.deepEqual(findDeployment(deep), { ok: true, deployment });
  assert.deepEqual(findDeployment(`${deep}${path.sep}`), { ok: true, deployment }, "a trailing separator");
  assert.deepEqual(findDeployment(path.join(inner, "below")), { ok: true, deployment: inner }, "the nearest deployment");
  assert.deepEqual(findDeployment(path.join(deep, "TASK.md")), { ok: false, dir: path.join(deep, "TASK.md") }, "a file, even inside one");
  assert.deepEqual(findDeployment(path.join(deep, "missing")), { ok: false, dir: path.join(deep, "missing") }, "a missing path, even inside one");
  assert.deepEqual(findDeployment(outside), none(outside));
  assert.deepEqual(findDeployment(linked), none(linked), "oats-local.yaml as a symbolic link is not a deployment's file");
  assert.deepEqual(findDeployment(folder), none(folder), "nor is a directory of that name");
  assert.deepEqual(findDeployment(path.join(base, "to-deep")), { ok: true, deployment }, "a start given through a link");
  assert.deepEqual(findDeployment(path.join(base, "to-outside")), none(outside), "and outside, the canonical directory is the one named");
});

// ── probeKernel ───────────────────────────────────────────────────────────────

const record = (more = {}) => ({ schemaVersion: 1, name: "@awebai/oats", version: VERSION, desktopApi: 1, workspaceApi: 2, features: FEATURES, harnesses: ["pi", "claude"], ...more });
const STDERR = "SECRET-ON-STDERR first line\nsecond line\n";

test("KERNEL_BIN is this install's own bin/oats.mjs, and its `version --json` is a record the probe accepts", async () => {
  assert.equal(KERNEL_BIN, path.join(REPOSITORY, "bin", "oats.mjs"));
  assert.equal(existsSync(KERNEL_BIN), true);
  // The kernel prints its record and reads no deployment for it.
  const probe = await probeKernel({ env: CLEAN_ENV });
  assert.equal(probe.ok, true, probe.reason);
  assert.deepEqual([probe.cli.bin, probe.cli.version, probe.cli.source, probe.cli.workspaceApi], [KERNEL_BIN, VERSION, "tui", 2]);
  for (const feature of FEATURES) assert.equal(probe.cli.features.includes(feature), true, feature);
});

test("this suite knows its own process group on Linux and on macOS: no test that compares a child's group with it is skipped there", () => {
  if (process.platform !== "linux" && process.platform !== "darwin") return;
  assert.equal(Number.isInteger(OWN_GROUP) && OWN_GROUP > 0, true, `the group of pid ${process.pid} reads ${OWN_GROUP}`);
});

test("probeKernel accepts a kernel that answers its record: one exec of `node <bin> version --json`, not detached, and the shared record", async () => {
  const world = makeWorld({ version: { stdout: JSON.stringify(record()), stderr: STDERR } });
  const seen = [], env = { ...CLEAN_ENV };
  const probe = await probeKernel({ bin: world.bin, env, execFile: (file, args, options, callback) => { seen.push({ file, args, options }); return nodeExecFile(file, args, options, callback); } });
  assert.deepEqual(probe, { ok: true, cli: cliRecord(record(), { bin: world.bin, source: "tui" }) });
  assert.deepEqual([probe.cli.ok, probe.cli.bin, probe.cli.version, probe.cli.source, Array.isArray(probe.cli.features)], [true, world.bin, VERSION, "tui", true]);
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].file, seen[0].args], [process.execPath, [world.bin, "version", "--json"]]);
  assert.deepEqual({ ...seen[0].options, env: null }, { timeout: 10_000, shell: false, encoding: "utf8", maxBuffer: 1024 * 1024, env: null });
  assert.equal(seen[0].options.env, env, "the environment it was given, as it is");
  const [call] = world.calls("version", "start");
  assert.deepEqual(call.argv, ["version", "--json"]);
  if (OWN_GROUP !== null) assert.equal(call.pgid, OWN_GROUP, "in the TUI's own process group: a Ctrl+C before the terminal is taken ends it too");
});

test("probeKernel refuses with acceptProbe's own reason, or with one of its four when there was no answer to judge; never with the error's text", async () => {
  const reasons = [];
  const probe = async (version, options = {}) => {
    const world = makeWorld({ version });
    const answer = await probeKernel({ bin: world.bin, env: CLEAN_ENV, ...options });
    assert.deepEqual(Object.keys(answer), ["ok", "reason"]);
    assert.equal(answer.ok, false);
    reasons.push([answer.reason, world]);
    return answer.reason;
  };
  for (const refused of [record({ name: "other" }), record({ version: "0.1.0" }), record({ desktopApi: 7 }), record({ version: `${VERSION}-rc.1` })]) {
    assert.equal(acceptProbe(refused).ok, false);
    assert.equal(await probe({ stdout: JSON.stringify(refused), stderr: STDERR }), acceptProbe(refused).reason);
  }
  assert.equal(reasons[0][0], "not the oats CLI (name: other)");
  assert.match(reasons[1][0], new RegExp("^version 0\\.1\\.0 outside >="));
  for (const garbage of ["this is not JSON {", "", "null", "42", `${JSON.stringify(record())} and more`]) assert.equal(await probe({ stdout: garbage, stderr: STDERR }), "it answered something that is not a version record", garbage);
  assert.equal(await probe({ stdout: JSON.stringify(record()), stderr: STDERR, exit: 1 }), "it failed", "a valid record and then exit 1");
  assert.equal(await probe({ stdout: "", stderr: STDERR, exit: 3 }), "it failed");
  assert.equal(await probe({ sleep: true, stderr: STDERR }, { timeoutMs: 400 }), "it did not answer within 0.4 seconds");
  const silent = reasons.at(-1)[1];
  // Not detached: execFile's timeout ended the one process it started.
  await gone(silent.calls("version", "start").map((call) => call.pid), 5000);

  const missing = await probeKernel({ bin: path.join(ROOT, "no-such-kernel.mjs"), env: CLEAN_ENV });
  assert.deepEqual(missing, { ok: false, reason: "it failed" }, "node ran and found no such file");
  const never = (file, args, options, callback) => nodeExecFile(path.join(ROOT, "no-such-node"), args, options, callback);
  assert.deepEqual(await probeKernel({ bin: silent.bin, env: CLEAN_ENV, execFile: never }), { ok: false, reason: "it did not start" });
  assert.deepEqual(await probeKernel({ bin: silent.bin, env: CLEAN_ENV, execFile: () => { throw new Error("spawn EAGAIN SECRET"); } }), { ok: false, reason: "it did not start" });
  const late = (file, args, options, callback) => { setImmediate(() => callback(Object.assign(new Error(`Command failed: ${args.join(" ")}\n${STDERR}`), { killed: true, signal: "SIGTERM", code: null }), JSON.stringify(record()), STDERR)); };
  assert.deepEqual(await probeKernel({ bin: silent.bin, env: CLEAN_ENV, execFile: late }), { ok: false, reason: "it did not answer within 10 seconds" }, "the default limit, and a valid record does not undo a timeout");

  for (const [reason, world] of reasons) {
    assert.equal(typeof reason, "string");
    assert.equal(reason.includes("\n") || reason.includes("SECRET") || reason.includes("second line") || reason.includes(world.dir) || reason.includes("Command failed"), false, reason);
  }
});

// ── a cycle ───────────────────────────────────────────────────────────────────

test("a cycle: the kernel's roster goes to the collector as the shared livenessInput, and the entry's rows carry the collector's answers", async (t) => {
  const world = makeWorld();
  const rows = [kernelRow("dev-one"), kernelRow("dev-two")];
  world.plan(answering(world, rows, [{ running: false, runtimeState: "stopped", tmux: null }, { running: true, runtimeState: "running", tmux: { session: "oats", window: "dev-two", socket: null } }]));
  const { reader, entries, spawned, store } = reading(t, world);

  assert.deepEqual(reader.children(), []);
  await reader.request();
  assert.equal(entries.length, 1, "exactly one entry for the cycle");
  const [{ entry, number }] = entries;
  assert.equal(number, 1);
  assert.equal(entry.deployment.status, "observed");
  assert.deepEqual([entry.deployment.root, entry.deployment.workspace.name, entry.generatedAt, typeof entry.observedAt], [path.join(world.deployment, "agents"), "fake-workspace", at(1), "string"]);
  assert.deepEqual(entry.deployment.souls.map((soul) => soul.name), ["dev"]);
  // The kernel said both run; the collector said dev-one stopped. Running first, then by name: the shared order.
  assert.deepEqual(shown(entry), [["dev-two", true, "running"], ["dev-one", false, "stopped"]]);
  assert.deepEqual(entry.instances.map((row) => [row.agent, row.home]), [["dev", path.join(world.deployment, "agents", "dev", "instances", "dev-two")], ["dev", path.join(world.deployment, "agents", "dev", "instances", "dev-one")]]);
  assert.deepEqual(reader.children(), [], "every child is forgotten when it ends");

  // The collector read exactly what the shared function makes of the rows, and nothing built by hand.
  const collected = world.calls("collector", "start");
  assert.equal(collected.length, 1);
  assert.equal(collected[0].stdin, JSON.stringify(livenessInput(rows)));
  assert.deepEqual(JSON.parse(collected[0].stdin).map((row) => [row.instance, row.running]), [["dev-one", true], ["dev-two", true]]);

  // One exec for every kernel call: node, the record's bin, the shared reader's argv and options, and detached.
  assert.equal(spawned.length, 3);
  assert.equal(spawned.every((call) => call.file === process.execPath && call.options.detached === true && call.options.shell === false), true);
  assert.equal(spawned.every((call) => EIGHT.every((name) => !(name in call.options.env))), true);
  const kernel = spawned.filter((call) => call.args[0] === world.bin);
  assert.deepEqual(kernel.map((call) => call.args.slice(1)).sort(), [["status", "--dir", world.deployment, "--max-age", "60", "--json"], ["workspace", "status", "--dir", world.deployment, "--max-age", "60", "--json"]]);
  for (const call of kernel) assert.deepEqual({ ...call.options, env: null }, { cwd: world.deployment, env: null, shell: false, detached: true }, "what the shared reader asked for, and detached");
  assert.deepEqual(world.calls("status", "start").map((call) => [call.argv, call.cwd]), [[["status", "--dir", world.deployment, "--max-age", "60", "--json"], world.deployment]]);
  const [collector] = spawned.filter((call) => call.args[0] === world.collector);
  assert.deepEqual(collector.args, [world.collector]);
  assert.deepEqual({ ...collector.options, env: null }, { env: null, shell: false, detached: true });
  assert.equal(collector.options.env, CLEAN_ENV);

  // The next cycle is the next number; a live one asks the kernel for nothing reused.
  await reader.request({ live: true });
  assert.deepEqual(entries.map((emitted) => emitted.number), [1, 2]);
  assert.equal(entries[1].entry.generatedAt, at(2));
  assert.deepEqual(spawned.slice(3).filter((call) => call.args[0] === world.bin).map((call) => call.args.slice(-3)), [["--max-age", "0", "--json"], ["--max-age", "0", "--json"]]);
  assert.equal(store.entry, entries[1].entry);
  assert.equal(COLLECTOR.endsWith(path.join("client", "liveness-main.mjs")), true, "the default collector is the shared program");
});

test("a deployment with no instance is observed without starting the collector", async (t) => {
  const world = makeWorld();
  world.plan(answering(world, [], "never read"));
  const { reader, entries, spawned } = reading(t, world);
  await reader.request();
  assert.deepEqual([entries.length, entries[0].entry.deployment.status, entries[0].entry.instances.length], [1, "observed", 0]);
  assert.deepEqual([spawned.length, world.calls("collector").length], [2, 0]);
});

test("a collector that fails, prints garbage, answers for another number of rows or does not exist: every row is unknown, and the entry is still observed", async (t) => {
  const rows = [kernelRow("dev-one"), kernelRow("dev-two", { running: false, runtimeState: "stopped" })];
  const good = JSON.stringify([{ running: true, runtimeState: "running" }, { running: true, runtimeState: "running" }]);
  const cases = [
    ["exits 1 after a valid answer", { stdout: good, exit: 1 }],
    ["prints garbage", { stdout: "Segmentation fault" }],
    ["prints nothing", { stdout: "" }],
    ["answers for one row of two", { stdout: JSON.stringify([{ running: true, runtimeState: "running" }]) }],
    ["does not exist", null],
  ];
  for (const [name, collector] of cases) {
    const world = makeWorld();
    world.plan({ ...answering(world, rows), ...(collector ? { collector } : {}) });
    const { reader, entries } = reading(t, world, collector ? {} : { collector: path.join(world.dir, "no-such-collector.mjs") });
    await reader.request();
    assert.equal(entries.length, 1, name);
    assert.equal(entries[0].entry.deployment.status, "observed", name);
    assert.deepEqual(shown(entries[0].entry).sort(), [["dev-one", null, "unreachable"], ["dev-two", null, "unreachable"]], name);
    assert.equal(entries[0].entry.instances.every((row) => row.runtimeError === "Terminal status is unavailable"), true, `${name}: the shared rule's own words`);
    assert.deepEqual(reader.children(), [], name);
  }
});

test("a collector that dies without reading a large input: the EPIPE of the write is heard, and every row is unknown", async (t) => {
  const world = makeWorld();
  const rows = Array.from({ length: 80 }, (_, n) => kernelRow(`dev-${String(n).padStart(2, "0")}`, { running: null, runtimeState: "unreachable", runtimeError: "e".repeat(8000), tmux: null }));
  assert.equal(JSON.stringify(livenessInput(rows)).length > 512 * 1024, true, "more than a pipe holds");
  world.plan(answering(world, rows));
  const { reader, entries } = reading(t, world, { collector: path.join(world.dir, "no-such-collector.mjs") });
  await reader.request();
  await sleep(150); // an error nobody hears would arrive by now, as an uncaught exception
  assert.deepEqual([entries.length, entries[0].entry.deployment.status, entries[0].entry.instances.length], [1, "observed", 80]);
  assert.equal(entries[0].entry.instances.every((row) => row.running === null && row.runtimeState === "unreachable"), true);
});

test("a row the kernel answered running: null reaches the collector with running: null", async (t) => {
  const world = makeWorld();
  const rows = [kernelRow("dev-one"), kernelRow("dev-lost", { running: null, runtimeState: "unreachable", runtimeError: "the terminal server could not be read", tmux: null })];
  world.plan(answering(world, rows, [{ running: true, runtimeState: "running" }, { running: null, runtimeState: "unreachable", runtimeError: "the terminal server could not be read" }]));
  const { reader, entries } = reading(t, world);
  await reader.request();
  const [call] = world.calls("collector", "start");
  assert.equal(call.stdin, JSON.stringify(livenessInput(rows)));
  assert.deepEqual(JSON.parse(call.stdin)[1], { instance: "dev-lost", running: null, tmux: null, runtimeState: "unreachable", runtimeError: "the terminal server could not be read" });
  assert.deepEqual(shown(entries[0].entry), [["dev-one", true, "running"], ["dev-lost", null, "unreachable"]]);
});

test("the kernel's error envelope becomes the shared failedEntry over the entry the caller holds, and the collector is not started", async (t) => {
  const world = makeWorld();
  const good = answering(world, [kernelRow("dev-one")], [{ running: true, runtimeState: "running" }]);
  world.plan(good);
  const { reader, entries, spawned, store } = reading(t, world);
  await reader.request();
  const observed = entries[0].entry;
  assert.equal(observed.deployment.status, "observed");
  const collectors = () => [spawned.filter((call) => call.args[0] === world.collector).length, world.calls("collector", "start").length];
  assert.deepEqual(collectors(), [1, 1]);

  // A remote the kernel could not read, over an observed entry: the rows stay, marked with the failure.
  world.plan({ ...good, status: kernelError("E_REMOTE_UNREADABLE", "could not read the workspace remote", { reason: "network", url: "https://git.example.com/team/agents.git", path: "/private/cache" }) });
  await reader.request({ live: true });
  const unreadable = { code: "E_REMOTE_UNREADABLE", message: "could not read the workspace remote", cause: { reason: "network", host: "git.example.com" } };
  assert.deepEqual(entries[1], { entry: failedEntry(observed, unreadable, at(2)), number: 2 });
  assert.deepEqual([entries[1].entry.deployment.status, entries[1].entry.error, entries[1].entry.errorCause], ["observed", unreadable.message, { code: unreadable.code, ...unreadable.cause }]);
  assert.deepEqual(entries[1].entry.instances, observed.instances);
  assert.deepEqual(collectors(), [1, 1], "no collector for a read that failed");

  // Another refusal: unavailable, with the kernel's reason and this cycle's time; never an empty roster.
  world.plan({ ...good, status: kernelError("E_LOCK_HELD", "another oats command holds the lock") });
  const held = store.entry;
  await reader.request();
  const refused = { code: "E_LOCK_HELD", message: "another oats command holds the lock" };
  assert.deepEqual(entries[2], { entry: failedEntry(held, refused, at(3)), number: 3 });
  assert.deepEqual(entries[2].entry, { deployment: { status: "unavailable", reason: refused }, instances: [], generatedAt: at(3) });

  // With no observation to keep, an unreadable remote is unavailable too. And a kernel that prints no envelope.
  world.plan({ ...good, workspace: kernelError("E_REMOTE_UNREADABLE", "could not read the workspace remote") });
  await reader.request();
  assert.deepEqual(entries[3].entry.deployment, { status: "unavailable", reason: { code: "E_REMOTE_UNREADABLE", message: "could not read the workspace remote" } });
  world.plan({ ...good, status: { stdout: "Error: something broke", stderr: STDERR, exit: 1 } });
  await reader.request();
  assert.deepEqual([entries[4].entry.deployment.status, entries[4].entry.deployment.reason.code], ["unavailable", "E_CLI_FAILED"]);
  assert.equal(JSON.stringify(entries[4].entry).includes("SECRET"), false);
  assert.deepEqual(collectors(), [1, 1]);

  world.plan(good);
  await reader.request();
  assert.deepEqual([entries[5].entry.deployment.status, shown(entries[5].entry)], ["observed", [["dev-one", true, "running"]]]);
  assert.deepEqual(entries.map((emitted) => emitted.number), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(collectors(), [2, 2]);
});

test("the cycle numbers grow strictly, a failed cycle and a void one included", async (t) => {
  const world = makeWorld();
  const good = answering(world);
  world.plan(good);
  const { reader, entries, begun } = reading(t, world);
  await reader.request();
  world.plan({ ...good, status: kernelError("E_LOCK_HELD", "held") });
  await reader.request();
  world.plan(good);
  const third = reader.request();
  for (let i = 0; i < 20 && begun() < 3; i++) await Promise.resolve();
  reader.voidInFlight();
  await third;
  await reader.request({ live: true });
  assert.deepEqual(entries.map((emitted) => [emitted.number, emitted.entry.deployment.status]), [[1, "observed"], [2, "unavailable"], [4, "observed"]]);
  for (let i = 1; i < entries.length; i++) assert.equal(entries[i].number > entries[i - 1].number, true);
});

// ── the exec's own limits: what the shared reader is told of a child that did not answer ──

test("a kernel that prints more than the shared reader's size limit is ended there and then, and the read is the shared E_CLI_OUTPUT_LIMIT", async (t) => {
  // It prints too much and then does not exit: only a reader that counts as it reads ends this read.
  const world = makeWorld();
  world.plan({ ...answering(world), status: { stdout: "x".repeat(4 * 1024 * 1024 + 65_536), linger: true } });
  const { reader, entries } = reading(t, world);
  assert.equal(await settled(reader.request(), 20_000), true, "long before the time limit");
  assert.deepEqual([entries.length, entries[0].entry.deployment.status, entries[0].entry.deployment.reason.code], [1, "unavailable", "E_CLI_OUTPUT_LIMIT"]);
  assert.deepEqual(reader.children(), []);
  await gone(world.calls("status", "start").map((call) => call.pid));
});

test("a kernel that does not answer within the shared reader's time limit is ended with its process group, and the read is the shared E_CLI_TIMEOUT", async (t) => {
  const world = makeWorld();
  world.plan({ ...answering(world, [kernelRow("dev-one")]), status: { sleep: true, grandchild: true }, workspace: { sleep: true } });
  const timers = fakeTimers();
  const { reader, entries } = reading(t, world, { timers });
  const first = reader.request();
  const pids = await waitFor("the kernels and the grandchild to start", () => {
    const started = [world.calls("status", "start")[0], world.calls("workspace", "start")[0], world.calls("sleeper", "start")[0]];
    return started.every(Boolean) && started.map((call) => call.pid);
  });
  assert.deepEqual(timers.delays(), [30_000, 30_000], "one limit per read: the shared reader's 30 s");
  timers.fire((ms) => ms === 30_000, 2);
  assert.deepEqual(reader.children(), [], "answered for at once, without waiting for the child");
  await first;
  assert.deepEqual([entries.length, entries[0].entry.deployment.status, entries[0].entry.deployment.reason.code], [1, "unavailable", "E_CLI_TIMEOUT"]);
  assert.equal(world.calls("collector").length, 0);
  assert.deepEqual(timers.delays(), []);
  await gone(pids);
});

test("a time limit that is overdue when a stopped process continues: the read is answered a turn later, so voidInFlight() in that turn comes first", async (t) => {
  const world = makeWorld();
  const good = answering(world);
  world.plan({ ...good, status: { sleep: true }, workspace: { sleep: true } });
  const timers = fakeTimers();
  const { reader, entries } = reading(t, world, { timers });
  const first = reader.request();
  const pids = await waitFor("the kernels to start", () => {
    const started = [world.calls("status", "start")[0], world.calls("workspace", "start")[0]];
    return started.every(Boolean) && started.map((call) => call.pid);
  });
  // What a process stopped past the limit does when it continues: its overdue timers, then every
  // promise they settled, and only then the handler of the signal that continued it.
  timers.fire((ms) => ms === 30_000, 2);
  for (let i = 0; i < 200; i++) await Promise.resolve();
  assert.deepEqual(entries, [], "the timeout is not an entry yet");
  reader.voidInFlight();
  await first;
  assert.deepEqual(entries, [], "and it never is: no 'unavailable' after a long stop");
  await gone(pids);
  world.plan(good);
  await reader.request({ live: true });
  assert.deepEqual(entries.map((emitted) => [emitted.number, emitted.entry.deployment.status]), [[2, "observed"]]);
});

test("a collector that does not answer within 30 s is ended, and every row is unknown", async (t) => {
  const world = makeWorld();
  world.plan({ ...answering(world, [kernelRow("dev-one")]), collector: { sleep: true } });
  const timers = fakeTimers();
  const { reader, entries } = reading(t, world, { timers });
  const first = reader.request();
  const pid = await waitFor("the collector to start", () => world.calls("collector", "start")[0]?.pid);
  assert.deepEqual(timers.delays(), [30_000]);
  timers.fire((ms) => ms === 30_000);
  await first;
  assert.deepEqual([entries.length, entries[0].entry.deployment.status, shown(entries[0].entry)], [1, "observed", [["dev-one", null, "unreachable"]]]);
  assert.deepEqual(reader.children(), []);
  await gone([pid]);
});

test("a kernel or a collector that cannot be started: a failed read, or rows that are unknown; never an exception", async (t) => {
  const world = makeWorld();
  world.plan(answering(world, [kernelRow("dev-one")], [{ running: true, runtimeState: "running" }]));
  const nowhere = path.join(ROOT, "no-such-node");
  const cases = [
    ["no kernel", (file, args, options) => nodeSpawn(nowhere, args, options), ["unavailable", "E_CLI_FAILED"]],
    ["spawn throws", () => { throw new Error("spawn EMFILE"); }, ["unavailable", "E_CLI_FAILED"]],
    ["no collector", (file, args, options) => nodeSpawn(args[0] === world.collector ? nowhere : file, args, options), ["observed", undefined]],
    ["spawn throws for the collector", (file, args, options) => { if (args[0] === world.collector) throw new Error("spawn EMFILE"); return nodeSpawn(file, args, options); }, ["observed", undefined]],
  ];
  for (const [name, spawn, expected] of cases) {
    const { reader, entries } = reading(t, world, { spawn });
    await reader.request();
    assert.deepEqual([entries.length, entries[0].entry.deployment.status, entries[0].entry.deployment.reason?.code], [1, ...expected], name);
    if (expected[0] === "observed") assert.deepEqual(shown(entries[0].entry), [["dev-one", null, "unreachable"]], name);
    assert.deepEqual(reader.children(), [], name);
  }
  assert.equal(world.calls("collector").length, 0);
});

// ── the children: their environment, their session, the way out ───────────────

test("after leaveInstance(env) neither the kernel nor the collector sees an instance variable", async (t) => {
  const world = makeWorld();
  world.plan(answering(world, [kernelRow("dev-one")], [{ running: true, runtimeState: "running" }]));
  const env = { ...CLEAN_ENV, OATS_UNRELATED: "kept", ...Object.fromEntries(EIGHT.map((name) => [name, `/an/instance/${name}`])) };
  const { reader, entries } = reading(t, world, { env });
  const carried = (action) => world.calls(action, "start").map((call) => EIGHT.filter((name) => name in call.env));

  // Before: the shared reader cleans a copy for the kernel, but the collector gets the environment as the TUI has it.
  await reader.request();
  assert.deepEqual([carried("status"), carried("workspace")], [[[]], [[]]]);
  assert.deepEqual(carried("collector"), [EIGHT], "which is why the copy is not enough");

  leaveInstance(env);
  await reader.request();
  assert.equal(entries.length, 2);
  for (const action of ["status", "workspace", "collector"]) {
    assert.deepEqual(carried(action).at(-1), [], action);
    assert.equal(world.calls(action, "start").at(-1).env.OATS_UNRELATED, "kept", `${action}: nothing else was taken`);
  }
});

test("every child runs in a session of its own: it leads its process group, which is not the TUI's", async (t) => {
  const world = makeWorld();
  world.plan(answering(world, [kernelRow("dev-one")], [{ running: true, runtimeState: "running" }]));
  const { reader } = reading(t, world);
  await reader.request();
  const started = ["status", "workspace", "collector"].map((action) => world.calls(action, "start")[0]);
  for (const call of started) {
    assert.equal(call.pgid, call.pid, `${call.action} leads its own process group`);
    if (call.sid !== null) assert.equal(call.sid, call.pid, `${call.action} leads its own session`);
    if (OWN_GROUP !== null) assert.notEqual(call.pgid, OWN_GROUP, `${call.action} is not in this process's group`);
    assert.notEqual(call.pid, process.pid);
  }
  assert.equal(new Set(started.map((call) => call.pgid)).size, 3);
});

/** stop() while `sleeper` (an action of the plan) sleeps: at once, everything gone, nothing emitted, nothing started after. */
async function leaves(t, world, sleeper, { grandchild = false } = {}) {
  const { reader, entries, spawned } = reading(t, world);
  const first = reader.start();
  const pid = await waitFor(`the ${sleeper} fake to start`, () => world.calls(sleeper, "start")[0]?.pid);
  const pids = [pid];
  if (grandchild) {
    const inner = await waitFor("the grandchild to start", () => world.calls("sleeper", "start")[0]);
    assert.equal(inner.pgid, pid, "the grandchild is in the kernel's process group");
    pids.push(inner.pid);
  }
  assert.equal(reader.children().includes(pid), true);
  assert.equal(pids.every(alive), true);

  const before = performance.now();
  assert.equal(reader.stop(), undefined, "synchronous: nothing to wait for");
  const took = performance.now() - before;
  assert.deepEqual(reader.children(), []);
  assert.equal(took < 5000, true, `stop() returned at once (${took} ms)`);
  await gone(pids);
  assert.equal(await settled(first), true, "the cycle in flight ends");
  await sleep(150);
  assert.deepEqual(entries, [], "no entry arrives after stop()");

  const count = spawned.length, logged = world.calls().length;
  await reader.request({ live: true });
  await reader.start();
  reader.touch();
  await sleep(150);
  assert.deepEqual([spawned.length, world.calls().length, entries.length], [count, logged, 0], "a later request starts no process");
  assert.doesNotThrow(() => { reader.stop(); reader.voidInFlight(); reader.stop(); });
}

test("leaving while the kernel sleeps: stop() returns at once, the kernel is gone within two seconds, and nothing is emitted or started afterwards", async (t) => {
  const world = makeWorld();
  world.plan({ ...answering(world, [kernelRow("dev-one")]), status: { sleep: true } });
  await leaves(t, world, "status");
});

test("leaving while the kernel and a grandchild of it sleep: the whole process group is ended", async (t) => {
  const world = makeWorld();
  world.plan({ ...answering(world, [kernelRow("dev-one")]), workspace: { sleep: true, grandchild: true } });
  await leaves(t, world, "workspace", { grandchild: true });
});

test("leaving while the collector sleeps: the same", async (t) => {
  const world = makeWorld();
  world.plan({ ...answering(world, [kernelRow("dev-one")]), collector: { sleep: true } });
  await leaves(t, world, "collector");
  assert.equal(world.calls("collector", "start")[0].stdin.includes("dev-one"), true);
});

test("a child seen to exit is never signalled again, by pid or by group: its pipes are destroyed and it is forgotten", async (t) => {
  // The kernel answers and exits; a grandchild it left behind holds its pipes, so the read has not ended.
  const world = makeWorld();
  world.plan({ ...answering(world, [kernelRow("dev-one")]), status: { stdout: JSON.stringify(statusDocument(world.deployment, [kernelRow("dev-one")])), grandchild: true } });
  const { reader, entries } = reading(t, world);
  const first = reader.request();
  const kernel = await waitFor("the kernel to start", () => world.calls("status", "start")[0]?.pid);
  const inner = await waitFor("the grandchild to start", () => world.calls("sleeper", "start")[0]);
  assert.equal(inner.pgid, kernel, "the grandchild is in the group the kernel led");
  // Reaped: node has seen the kernel exit. Its pid may name any process from now on.
  await waitFor("the kernel to exit and be reaped", () => !exists(kernel));
  await waitFor("the other read to end", () => reader.children().length === 1);
  assert.deepEqual(reader.children(), [kernel], "still remembered: the grandchild holds its pipes open");
  assert.equal(await settled(first, 300), false, "and the read is still waiting for them");

  reader.stop();
  assert.deepEqual(reader.children(), []);
  assert.equal(await settled(first), true, "the pipes were destroyed: nothing waits for the grandchild");
  await sleep(300);
  assert.equal(alive(inner.pid), true, "nothing was sent to the group of a pid that had exited");
  assert.deepEqual(entries, []);
  assert.equal(ours(inner.pid), true);
  process.kill(inner.pid, "SIGKILL"); // the fake wrote this pid down, and it is still that fake
  await gone([inner.pid], 5000);
});

test("a kernel that ignores SIGTERM keeps neither its cycle nor the reader: it is answered for at once, and the next request reads", async (t) => {
  const world = makeWorld();
  const good = answering(world);
  world.plan({ ...good, status: { sleep: true, stubborn: true } });
  const { reader, entries } = reading(t, world);
  const first = reader.request();
  const pid = await waitFor("the kernel to start", () => world.calls("status", "start")[0]?.pid);
  reader.voidInFlight();
  assert.deepEqual(reader.children(), []);
  assert.equal(await settled(first, 5000), true, "the cycle is over without the child");
  world.plan(good);
  await reader.request({ live: true });
  assert.deepEqual(entries.map((emitted) => [emitted.number, emitted.entry.deployment.status]), [[2, "observed"]]);
  assert.equal(alive(pid), true, "it was asked to end, once, and nobody waited for it");
  assert.equal(ours(pid), true);
  process.kill(pid, "SIGKILL"); // the fake wrote this pid down, and it is still that fake
  await gone([pid], 5000);
});

test("a whole process that stops its reader ends by itself: it waits for no pipe a grandchild holds, and for no child that ignores the signal", async () => {
  const cases = [
    ["a kernel that exited and left a grandchild holding its pipes", (world) => ({ stdout: JSON.stringify(statusDocument(world.deployment)), grandchild: true }), "sleeper"],
    ["a kernel that ignores SIGTERM", () => ({ sleep: true, stubborn: true }), "status"],
  ];
  for (const [name, status, wait] of cases) {
    const world = makeWorld();
    world.plan({ ...answering(world), status: status(world) });
    // The process is given 60 s; it needs none of them when nothing holds it.
    const ran = await new Promise((resolve) => { nodeExecFile(process.execPath, [LEAVE, world.dir, JSON.stringify(world.cli), wait], { env: CLEAN_ENV, timeout: 60_000 }, (error, stdout, stderr) => resolve({ error, stdout, stderr })); });
    assert.equal(ran.error, null, `${name}: the process ended by itself, with status 0 (${ran.stderr})`);
    assert.equal(ran.stdout, "stopped\n", name);
    const left = world.calls(wait, "start")[0].pid;
    assert.equal(alive(left), true, `${name}: it still runs, so the process did not wait for it`);
    assert.equal(ours(left), true);
    process.kill(left, "SIGKILL"); // the fake wrote this pid down, and it is still that fake
    await gone([left], 5000);
  }
});

test("stop() before start(), stop() twice and voidInFlight() at any time do not throw; after stop() nothing is armed", async (t) => {
  const world = makeWorld();
  world.plan(answering(world));
  const timers = fakeTimers();
  const { reader, entries, spawned } = reading(t, world, { timers });
  assert.doesNotThrow(() => { reader.voidInFlight(); reader.voidInFlight(); reader.touch(); });
  assert.deepEqual(timers.delays(), [], "touch() before start() arms nothing");
  assert.doesNotThrow(() => { reader.stop(); reader.stop(); reader.voidInFlight(); });
  await reader.start();
  reader.touch();
  await reader.request({ live: true });
  assert.deepEqual([timers.delays(), spawned.length, entries.length, reader.children()], [[], 0, 0, []]);

  const again = reading(t, world, { timers });
  await again.reader.start();
  await again.reader.start();
  assert.deepEqual([again.entries.length, timers.delays()], [1, [5000, 600_000]], "start() twice is one loop, one idle timer");
  again.reader.stop();
  again.reader.stop();
  assert.deepEqual(timers.delays(), []);
});

// ── cadence ───────────────────────────────────────────────────────────────────

test("cadence: touch() re-arms the idle timer; when it fires the loop reads as a blurred window does; the next touch() focuses it again", async (t) => {
  const world = makeWorld();
  world.plan(answering(world));
  const timers = fakeTimers();
  const { reader, entries } = reading(t, world, { timers, idleMs: 777, focusedMs: 5000, blurredMs: 30_000 });

  await reader.start();
  assert.equal(entries.length, 1);
  assert.deepEqual(timers.delays(), [777, 5000], "the idle timer, and the loop's next read at the focused cadence");
  const idle = timers.idOf(777);
  reader.touch();
  assert.deepEqual(timers.delays(), [777, 5000], "one idle timer, not two; no read out of turn");
  assert.notEqual(timers.idOf(777), idle, "and it is a new one: the old was cleared");
  assert.equal(entries.length, 1);

  // Nobody for idleMs: the read that was due in 5 s moves out to the blurred cadence.
  timers.fire((ms) => ms === 777);
  assert.equal(timers.delays().length, 1, "no idle timer until the next key");
  assert.equal(timers.delays()[0] > 5000 && timers.delays()[0] <= 30_000, true, `${timers.delays()[0]} ms: 30 s after the last read, not 5`);
  timers.fire((ms) => ms > 5000);
  await waitFor("the blurred cycle to end", () => entries.length === 2 && timers.delays().length === 1);
  assert.deepEqual(timers.delays(), [30_000], "and the next one is 30 s away");

  // A key: one read at once, the focused cadence after it, the idle timer armed again.
  reader.touch();
  assert.deepEqual(timers.delays(), [777]);
  await waitFor("the cycle a key asks for to end", () => entries.length === 3 && timers.delays().length === 2);
  assert.deepEqual(timers.delays(), [777, 5000]);
  assert.deepEqual(entries.map((emitted) => emitted.number), [1, 2, 3]);

  reader.stop();
  assert.deepEqual(timers.delays(), [], "leaving clears both");
});

// ── voidInFlight ──────────────────────────────────────────────────────────────

test("voidInFlight() while the kernel runs: the kernel is ended, that cycle emits nothing, and the next request emits with the next number", async (t) => {
  const world = makeWorld();
  const good = answering(world, [kernelRow("dev-one")], [{ running: true, runtimeState: "running" }]);
  world.plan({ ...good, status: { sleep: true } });
  const timers = fakeTimers();
  const { reader, entries } = reading(t, world, { timers });
  const first = reader.start();
  const pid = await waitFor("the kernel to start", () => world.calls("status", "start")[0]?.pid);
  assert.equal(reader.children().includes(pid), true);

  assert.equal(reader.voidInFlight(), undefined);
  assert.deepEqual(reader.children(), []);
  assert.doesNotThrow(() => reader.voidInFlight(), "idempotent");
  await gone([pid]);
  assert.equal(await settled(first), true);
  assert.deepEqual(entries, [], "its failure is not an entry");
  assert.equal(world.calls("collector").length, 0);

  world.plan(good);
  await reader.request({ live: true });
  assert.deepEqual(entries.map((emitted) => [emitted.number, emitted.entry.deployment.status, shown(emitted.entry)]), [[2, "observed", [["dev-one", true, "running"]]]]);
  assert.deepEqual(timers.delays(), [5000, 600_000], "the reader stays usable: the loop goes on");
});

test("voidInFlight() with an answer larger than the pipe waiting in it: no entry for that cycle, unavailable or other, and the live request after it is observed", async (t) => {
  // What a stopped TUI leaves behind, without stopping anything: a kernel that has more to say than
  // the pipe holds, and a reader that has not read. Whatever such a cycle would answer is no evidence.
  const world = makeWorld();
  const souls = Array.from({ length: 160 }, (_, n) => ({ name: `soul-${n}`, description: `${n} `.padEnd(8000, "x") }));
  const big = JSON.stringify(statusDocument(world.deployment, [], souls));
  assert.equal(big.length > 1024 * 1024 && big.length < 4 * 1024 * 1024, true, "larger than a pipe, within the shared reader's limit");
  world.plan({ ...answering(world), status: { stdout: big } });
  const { reader, entries, begun } = reading(t, world);

  const first = reader.request();
  for (let i = 0; i < 100 && reader.children().length < 2; i++) await Promise.resolve();
  assert.deepEqual([begun(), reader.children().length], [1, 2], "the cycle began and both reads run");
  // From here to voidInFlight() this process reads nothing: no await, as a stopped process has none.
  const until = Date.now() + 30_000;
  while (world.calls("status", "writing").length === 0 && Date.now() < until) freeze(20);
  freeze(400);
  const [status] = world.calls("status", "start"), [workspace] = world.calls("workspace", "start");
  assert.equal(world.calls("status", "writing").length, 1, "the kernel is answering");
  assert.equal(world.calls("status", "written").length, 0, "and its answer does not fit in the pipe nobody reads");
  assert.equal(alive(status.pid), true);

  reader.voidInFlight();
  assert.deepEqual(reader.children(), []);
  await gone([status.pid, workspace.pid]);
  assert.equal(await settled(first), true);
  await sleep(150);
  assert.deepEqual(entries, [], "no entry at all for the cycle that was in flight");

  await reader.request({ live: true });
  assert.equal(entries.length, 1);
  assert.deepEqual([entries[0].number, entries[0].entry.deployment.status, entries[0].entry.deployment.souls.length], [2, "observed", 161]);
  assert.equal(world.calls("status", "written").length, 1, "read whole this time");
});

test("voidInFlight() during the collector: that cycle is void too, and the collector is ended", async (t) => {
  const world = makeWorld();
  const good = answering(world, [kernelRow("dev-one")], [{ running: false, runtimeState: "stopped", tmux: null }]);
  world.plan({ ...good, collector: { sleep: true } });
  const { reader, entries } = reading(t, world);
  const first = reader.request();
  const pid = await waitFor("the collector to start", () => world.calls("collector", "start")[0]?.pid);
  assert.deepEqual(reader.children(), [pid]);

  reader.voidInFlight();
  assert.deepEqual(reader.children(), []);
  await gone([pid]);
  assert.equal(await settled(first), true);
  assert.deepEqual(entries, [], "not even with every row unknown");

  world.plan(good);
  await reader.request({ live: true });
  assert.deepEqual(entries.map((emitted) => [emitted.number, shown(emitted.entry)]), [[2, [["dev-one", false, "stopped"]]]]);
});

test("voidInFlight() before a cycle's reads began starts none of them; a cycle requested but not begun is not in flight", async (t) => {
  const world = makeWorld();
  world.plan(answering(world));
  const { reader, entries, spawned, begun } = reading(t, world);
  const first = reader.request();
  for (let i = 0; i < 20 && begun() < 1; i++) await Promise.resolve();
  assert.deepEqual([begun(), spawned.length], [1, 0], "the cycle began; its reads have not");
  reader.voidInFlight();
  await first;
  assert.deepEqual([spawned.length, entries.length, world.calls().length], [0, 0, 0]);

  const second = reader.request({ live: true });
  reader.voidInFlight(); // nothing is in flight yet: the cycle begins after this call returns
  await second;
  assert.deepEqual(entries.map((emitted) => [emitted.number, emitted.entry.deployment.status]), [[2, "observed"]]);
  assert.equal(spawned.length, 2);
});
