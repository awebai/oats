import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "bin", "oats.mjs");
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-schedule-")));
process.env.OATS_HOME_DIR = join(base, "oats-home");
delete process.env.OATS_INSTANCE; delete process.env.OATS_INSTANCE_HOME; delete process.env.PI_AGENTS_ROOT;
const S = await import("../lib/schedule.mjs");
const H = await import("../lib/schedule-host.mjs");
const { scheduleRemote } = await import("../lib/servers.mjs");
test.after(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
function workspace() {
  const ws = join(base, `ws-${++n}`);
  mkdirSync(join(ws, "agents", "dev", "soul"), { recursive: true });
  writeFileSync(join(ws, "agents", "dev", "soul", "soul.yaml"), "name: dev\nwork: worktree\nruntime: claude\n");
  writeFileSync(join(ws, "agents", "dev", "soul", "AGENTS.md"), "# Developer\n");
  return ws;
}
function home(ws, name) { const h = join(ws, "agents", "dev", "instances", name); mkdirSync(h, { recursive: true }); writeFileSync(join(h, "instance.json"), JSON.stringify({ instance: name, home: h, agent: "dev" })); return h; }
const at = (iso) => new Date(iso);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// A fake launcher: creates a home like spawn would and records the call.
function fakeSpawn(ws, calls = []) {
  return (root, agent, opts) => { calls.push(opts); const name = `${agent.name}-${opts.purpose}`; const h = home(ws, name); return { instance: name, home: h, launched: true }; };
}

test("definitions are validated field by field, with croner and IANA zones", () => {
  const ws = workspace();
  const bad = (spec, field) => assert.throws(() => S.validateDefinition(ws, spec), (e) => e.code === "E_SCHEDULE_INVALID" && e.field === field, `${field}`);
  bad({ id: "Bad Id", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "t" }, "id");
  bad({ id: "a", cron: "* * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "t" }, "cron");
  bad({ id: "a", cron: "* * * * *", tz: "Mars/Olympus", kind: "spawn", agent: "dev", task: "t" }, "tz");
  bad({ id: "a", cron: "* * * * *", kind: "spawn", agent: "dev", task: "t" }, "tz");
  bad({ id: "a", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "nobody", task: "t" }, "agent");
  bad({ id: "a", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "" }, "task");
  bad({ id: "a", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "t", runtime: "bash" }, "runtime");
  bad({ id: "a", cron: "* * * * *", tz: "UTC", kind: "command", cwd: "/etc", argv: ["oats", "status"] }, "cwd");
  bad({ id: "a", cron: "* * * * *", tz: "UTC", kind: "command", cwd: ws, argv: ["sh", "-c", "x"] }, "argv");
  bad({ id: "a", cron: "* * * * *", tz: "UTC", kind: "wake", home: join(base, "elsewhere"), message: "hi" }, "home");
  bad({ id: "a", cron: "* * * * *", tz: "UTC", kind: "wake", home: home(ws, "dev-x"), message: "" }, "message");
  bad({ id: "a", cron: "* * * * *", tz: "UTC", kind: "other" }, "kind");
  const ok = S.validateDefinition(ws, { id: "nightly", cron: " 0 3 * * * ", tz: "Europe/Madrid", kind: "spawn", agent: "dev", task: "do it", yolo: true, backend: "tmux" });
  assert.deepEqual(ok, { id: "nightly", enabled: true, cron: "0 3 * * *", tz: "Europe/Madrid", kind: "spawn", agent: "dev", task: "do it", yolo: true, backend: "tmux" });
});

test("cron evaluation follows the zone through DST and is due exactly on the minute", () => {
  const def = { cron: "0 3 * * *", tz: "Europe/Madrid" };
  // 2026-03-29: Madrid springs forward at 02:00 -> 03:00 local; 03:00 local is 01:00Z.
  assert.equal(S.nextRunAfter(def, at("2026-03-28T12:00:00Z")), "2026-03-29T01:00:00.000Z");
  assert.equal(S.nextRunAfter(def, at("2026-03-29T12:00:00Z")), "2026-03-30T01:00:00.000Z");
  // 2026-10-25: falls back at 03:00 -> 02:00; 03:00 local is 02:00Z.
  assert.equal(S.nextRunAfter(def, at("2026-10-24T12:00:00Z")), "2026-10-25T02:00:00.000Z");
  assert.equal(S.dueAt(def, at("2026-03-29T01:00:00Z")), true);
  assert.equal(S.dueAt(def, at("2026-03-29T01:01:00Z")), false);
  assert.equal(S.dueAt({ cron: "*/5 * * * *", tz: "UTC" }, at("2026-09-07T10:05:00Z")), true);
  assert.equal(S.dueAt({ cron: "*/5 * * * *", tz: "UTC" }, at("2026-09-07T10:06:00Z")), false);
  assert.equal(S.minuteKey(S.minuteStart(at("2026-09-07T10:05:42Z"))), "2026-09-07T10:05");
});

test("a due spawn job launches once, holds its lock while the instance lives, and skips missed minutes", () => {
  const ws = workspace();
  const calls = [];
  const io = { spawn: fakeSpawn(ws, calls), inspect: () => ({ present: true, state: "unknown" }) };
  S.addSchedule(ws, { id: "five", cron: "*/5 * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "Check the queue." });
  const reg = S.readRegistry();
  let c = S.tickWorkspace(ws, { now: at("2026-09-07T10:05:10Z"), io, reg });
  assert.equal(c[0].action, "launched");
  assert.equal(calls.length, 1);
  assert.match(calls[0].purpose, /^five-202609071005$/);
  assert.match(calls[0].task, /Scheduled run[\s\S]*oats retire --self/);
  const d = S.describe(ws, "five", io);
  assert.equal(d.running, true);
  assert.equal(d.lastRun.outcome, "launched");
  assert.equal(readJson(join(ws, ".agents", "schedules", "state.json")).jobs.five.lastAttemptedMinute, "2026-09-07T10:05");
  // Same minute again: nothing (already attempted). Next due minute: still running.
  assert.deepEqual(S.tickWorkspace(ws, { now: at("2026-09-07T10:05:50Z"), io, reg }), []);
  c = S.tickWorkspace(ws, { now: at("2026-09-07T10:10:00Z"), io, reg });
  assert.equal(c[0].action, "skipped"); assert.equal(c[0].reason, "still running");
  assert.equal(S.describe(ws, "five", io).lastRun.outcome, "active");
  // The instance retires (home gone): ended, lock released; a jump of three hours launches ONCE.
  rmSync(d.lastRun.home, { recursive: true, force: true });
  c = S.tickWorkspace(ws, { now: at("2026-09-07T13:15:00Z"), io, reg });
  assert.equal(c[0].action, "launched");
  assert.equal(calls.length, 2);
  assert.equal(readJson(join(ws, ".agents", "schedules", "state.json")).jobs.five.lastAttemptedMinute, "2026-09-07T13:15");
  const runs = S.describe(ws, "five", io);
  assert.equal(runs.lastRun.scheduledFor, "2026-09-07T13:15:00.000Z");
});

test("host concurrency bounds launches across jobs and run-now shares the same lock", () => {
  const ws = workspace();
  const io = { spawn: fakeSpawn(ws), inspect: () => ({ present: true, state: "unknown" }) };
  S.addSchedule(ws, { id: "a", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "a" });
  S.addSchedule(ws, { id: "b", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "b" });
  const c = S.tickWorkspace(ws, { now: at("2026-09-07T11:00:00Z"), io, reg: S.readRegistry() });
  assert.deepEqual(c.map((x) => [x.id, x.action, x.reason]), [["a", "launched", undefined], ["b", "skipped", "host busy"]]);
  assert.equal(readJson(join(ws, ".agents", "schedules", "state.json")).jobs.b.lastAttemptedMinute, "2026-09-07T11:00", "busy skips still persist the attempted minute");
  assert.throws(() => S.runNow(ws, "b", { io, now: at("2026-09-07T11:00:30Z") }), (e) => e.code === "E_SCHEDULER_BUSY");
  assert.throws(() => S.runNow(ws, "a", { io }), (e) => e.code === "E_SCHEDULE_RUNNING");
  S.setEnabled(ws, "b", false);
  assert.throws(() => S.runNow(ws, "b", { io }), (e) => e.code === "E_SCHEDULE_DISABLED");
  assert.throws(() => S.removeSchedule(ws, "a"), (e) => e.code === "E_SCHEDULE_RUNNING");
  assert.deepEqual(S.removeSchedule(ws, "a", { force: true }), { removed: "a" });
  assert.equal(S.jobLockInfo(ws, "a"), null);
  const r = S.runNow(ws, "b", { io, force: true, now: at("2026-09-07T11:07:00Z") });
  assert.equal(r.run.outcome, "launched");
});

test("an attempt without a recorded result is exposed as unknown and resolved by reconcile", () => {
  const ws = workspace();
  const io = { spawn: fakeSpawn(ws), inspect: () => ({ present: false, state: "shell" }) };
  S.addSchedule(ws, { id: "crashy", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "t" });
  // Simulate a crash between the attempt record and the run record.
  const st = S.readState(ws); st.jobs.crashy = { attempt: { scheduledFor: "2026-09-07T12:00:00.000Z", startedAt: "2026-09-07T12:00:01.000Z" } }; S.writeState(ws, st);
  const c = S.tickWorkspace(ws, { now: at("2026-09-07T12:01:00Z"), io, reg: S.readRegistry() });
  assert.equal(c[0].action, "skipped"); assert.match(c[0].reason, /reconcile/);
  assert.equal(S.describe(ws, "crashy", io).lastRun.outcome, "unknown");
  assert.throws(() => S.runNow(ws, "crashy", { io }), (e) => e.code === "E_SCHEDULE_UNRESOLVED");
  // No instance exists for it: cleared as launch-failed.
  let r = S.reconcile(ws, "crashy", { io });
  assert.equal(r.reconciled, "cleared"); assert.equal(r.schedule.lastRun.outcome, "launch-failed");
  // An instance DOES exist for the attempt: adopted, observed stopped, lock held.
  const st2 = S.readState(ws); st2.jobs.crashy = { attempt: { scheduledFor: "2026-09-07T12:30:00.000Z" } }; S.writeState(ws, st2);
  home(ws, "dev-crashy-202609071230");
  r = S.reconcile(ws, "crashy", { io });
  assert.equal(r.reconciled, "adopted"); assert.equal(r.schedule.lastRun.outcome, "stopped"); assert.equal(r.schedule.running, true);
});

test("a wake job starts a stopped home, delivers once when active, and skips what it cannot observe", () => {
  const ws = workspace();
  const h = home(ws, "dev-standing");
  const started = [], inputs = [];
  let state = { present: false, state: "shell" };
  const io = { inspect: () => { if (state instanceof Error) throw state; return state; }, start: (hh) => { started.push(hh); return { instance: "dev-standing", target: { backend: "tmux" } }; }, input: (hh, text) => { inputs.push([hh, text]); return { submitted: true }; } };
  S.addSchedule(ws, { id: "nudge", cron: "*/15 * * * *", tz: "UTC", kind: "wake", home: h, message: "Check your inbox and pending chats." });
  const reg = S.readRegistry();
  let c = S.tickWorkspace(ws, { now: at("2026-09-07T09:15:00Z"), io, reg });
  assert.equal(c[0].action, "started"); assert.deepEqual(started, [h]); assert.equal(inputs.length, 0);
  assert.equal(S.jobLockInfo(ws, "nudge"), null, "wake holds no lock between minutes");
  state = { present: true, state: "unknown" };
  c = S.tickWorkspace(ws, { now: at("2026-09-07T09:30:00Z"), io, reg });
  assert.equal(c[0].action, "delivered"); assert.deepEqual(inputs, [[h, "Check your inbox and pending chats."]]);
  assert.deepEqual(S.tickWorkspace(ws, { now: at("2026-09-07T09:30:40Z"), io, reg }), [], "never twice in one minute");
  state = new Error("socket unavailable");
  c = S.tickWorkspace(ws, { now: at("2026-09-07T09:45:00Z"), io, reg });
  assert.equal(c[0].action, "skipped"); assert.match(c[0].reason, /cannot observe/);
  rmSync(h, { recursive: true, force: true });
  c = S.tickWorkspace(ws, { now: at("2026-09-07T10:00:00Z"), io, reg });
  assert.equal(c[0].action, "skipped"); assert.match(c[0].reason, /gone/);
  assert.equal(inputs.length, 1);
});

test("a command job runs an oats-only argv in its cwd and tracks the instance the envelope names", () => {
  const ws = workspace();
  const src = home(ws, "dev-source");
  const harvester = home(ws, "dev-harvester-1");
  const cmds = [];
  const io = { command: (c) => { cmds.push(c); return { ok: true, result: { harvest: "spawned", instance: "dev-harvester-1" } }; }, inspect: () => ({ present: true, state: "unknown" }) };
  S.addSchedule(ws, { id: "harvest", cron: "0 * * * *", tz: "UTC", kind: "command", cwd: src, argv: ["oats", "okf", "harvest"] });
  const c = S.tickWorkspace(ws, { now: at("2026-09-07T10:00:00Z"), io, reg: S.readRegistry() });
  assert.equal(c[0].action, "launched"); assert.equal(c[0].instance, "dev-harvester-1");
  assert.deepEqual(cmds[0], { cwd: src, argv: ["okf", "harvest", "--json"] });
  const d = S.describe(ws, "harvest", io);
  assert.equal(d.lastRun.home, harvester, "home resolved from the workspace roster");
  assert.equal(d.running, true, "command return is not completion: the harvester is tracked");
  const io2 = { command: () => ({ ok: false, error: { code: "E_X", message: "nope" } }) };
  S.addSchedule(ws, { id: "broken", cron: "0 * * * *", tz: "UTC", kind: "command", cwd: src, argv: ["oats", "status"] });
  rmSync(harvester, { recursive: true, force: true });
  const c2 = S.tickWorkspace(ws, { now: at("2026-09-07T11:00:00Z"), io: { ...io2, inspect: io.inspect }, reg: S.readRegistry() });
  const broken = c2.find((x) => x.id === "broken");
  assert.equal(broken.action, "launch-failed"); assert.equal(broken.error, "nope");
  assert.equal(S.jobLockInfo(ws, "broken"), null);
});

test("wake-at-spawn helpers: flags translate to one object, save binds to the home, retirement forgets it", () => {
  const ws = workspace();
  const h = home(ws, "dev-worker");
  const w = S.wakeFromFlags({ every: "15", message: "Anything new?" });
  assert.equal(w.cron, "*/15 * * * *"); assert.ok(w.tz); assert.equal(w.enabled, true);
  assert.throws(() => S.wakeFromFlags({ every: "0", message: "x" }), (e) => e.code === "E_SCHEDULE_INVALID");
  assert.throws(() => S.wakeFromFlags({ every: "5", cron: "* * * * *", message: "x" }), (e) => e.code === "E_SCHEDULE_INVALID");
  assert.throws(() => S.wakeFromFlags({ every: "5" }), (e) => e.code === "E_SCHEDULE_INVALID");
  const saved = S.saveWakeForHome(ws, { instance: "dev-worker", home: h, wake: { cron: "*/10 * * * *", tz: "UTC", message: "ping" } });
  assert.equal(saved.id, "wake-dev-worker"); assert.equal(saved.kind, "wake"); assert.equal(saved.home, h);
  assert.throws(() => S.saveWakeForHome(ws, { instance: "dev-worker", home: h, wake: { cron: "*/10 * * * *", tz: "UTC", message: "ping" } }), (e) => e.code === "E_SCHEDULE_EXISTS");
  assert.deepEqual(S.removeWakeForHome(ws, h), ["wake-dev-worker"]);
  assert.equal(S.readDefinitions(ws).jobs["wake-dev-worker"], undefined);
});

test("the CLI answers the envelope for add, list, show, update, enable, disable, tick --dry-run, remove and host status", () => {
  const ws = workspace();
  const env = { ...process.env, OATS_HOME_DIR: process.env.OATS_HOME_DIR };
  const run = (...a) => { const r = execFileSync(process.execPath, [bin, "schedule", ...a, "--dir", ws, "--json"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }); return JSON.parse(r.trim().split("\n").pop()); };
  const spec = join(base, "spec.json");
  writeFileSync(spec, JSON.stringify({ id: "nightly", cron: "0 3 * * *", tz: "Europe/Madrid", kind: "spawn", agent: "dev", task: "Nightly sweep.", runtime: "claude", yolo: true }));
  let out = run("add", "nightly", "--file", spec);
  assert.equal(out.ok, true); assert.equal(out.result.schedule.id, "nightly"); assert.ok(out.result.schedule.nextRun);
  out = run("list");
  assert.deepEqual(Object.keys(out.result), ["schedules", "scheduler"]);
  assert.equal(out.result.schedules[0].id, "nightly");
  for (const k of ["installed", "active", "lastTick", "maxConcurrent"]) assert.ok(k in out.result.scheduler, k);
  assert.equal(out.result.scheduler.installed, false);
  out = run("show", "nightly"); assert.equal(out.result.schedule.task, "Nightly sweep.");
  writeFileSync(spec, JSON.stringify({ cron: "30 3 * * *", tz: "Europe/Madrid", kind: "spawn", agent: "dev", task: "Nightly sweep, later." }));
  out = run("update", "nightly", "--file", spec); assert.equal(out.result.schedule.cron, "30 3 * * *");
  out = run("disable", "nightly"); assert.equal(out.result.schedule.enabled, false); assert.equal(out.result.schedule.nextRun, null);
  out = run("enable", "nightly"); assert.equal(out.result.schedule.enabled, true);
  writeFileSync(spec, JSON.stringify({ id: "every", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "t" }));
  run("add", "every", "--file", spec);
  out = run("tick", "--dry-run");
  assert.deepEqual(out.result.considered.map((c) => [c.id, c.action]), [["every", "due"]], "dry run launches nothing");
  assert.equal(existsSync(join(ws, "agents", "dev", "instances")), false);
  out = run("remove", "every"); assert.deepEqual(out.result, { removed: "every" });
  out = run("host", "status"); assert.equal(typeof out.result.scheduler.active, "boolean");
  let failed;
  try { execFileSync(process.execPath, [bin, "schedule", "show", "nope", "--dir", ws, "--json"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { failed = e; }
  assert.ok(failed, "an unknown id exits non-zero");
  assert.equal(JSON.parse(String(failed.stdout).trim()).error.code, "E_SCHEDULE_UNKNOWN");
  const probe = JSON.parse(execFileSync(process.execPath, [bin, "version", "--json"], { encoding: "utf8" }));
  assert.equal(probe.scheduleApi, 1); assert.ok(probe.features.includes("schedule")); assert.ok(probe.remote.includes("schedule"));
});

test("host units render the single tick and status reports what the OS says", () => {
  const plist = H.renderLaunchdPlist({ node: "/usr/local/bin/node", oatsBin: "/opt/oats/bin/oats.mjs", oatsHomeDir: "/home/x/.oats" });
  assert.match(plist, /<string>ai\.oats\.schedule-tick<\/string>/);
  assert.match(plist, /<string>schedule<\/string>\s*<string>tick<\/string>\s*<string>--host<\/string>\s*<string>--json<\/string>/);
  assert.match(plist, /<integer>60<\/integer>/); assert.match(plist, /OATS_HOME_DIR/);
  const units = H.renderSystemdUnits({ node: "/usr/bin/node", oatsBin: "/opt/oats/bin/oats.mjs" });
  assert.match(units.service, /ExecStart=\/usr\/bin\/node \/opt\/oats\/bin\/oats\.mjs schedule tick --host --json/);
  assert.match(units.timer, /OnUnitActiveSec=60/);
  const exec = (b, argv) => { if (argv[0] === "print" || argv[1] === "is-active") throw Object.assign(new Error("not loaded"), { status: 113 }); return ""; };
  const st = H.hostUnitStatus({ exec, os: "darwin" });
  assert.equal(st.active, false, "a unit file alone is never active");
  const lin = H.hostUnitStatus({ exec, os: "linux" });
  assert.equal(lin.installed, false); assert.equal(lin.active, false);
  assert.equal(H.hostUnitStatus({ os: "win32" }).kind, "unsupported");
});

test("remote schedules route to the server workspace only when the host advertises the feature", () => {
  const oatsHome = process.env.OATS_HOME_DIR; mkdirSync(oatsHome, { recursive: true });
  writeFileSync(join(oatsHome, "servers.json"), JSON.stringify({ servers: { s: { sshHost: "h", workspace: "/w" } } }));
  const calls = [];
  const io = (features) => ({ execFileSync: (b, argv) => { const a = argv.join(" "); calls.push(a); if (a.includes("version --json")) return JSON.stringify({ schemaVersion: 1, ok: true, result: { desktopApi: 1, version: "0.22.10", remote: ["session"], features } }); return JSON.stringify({ schemaVersion: 1, ok: true, result: { schedules: [], scheduler: { installed: false, active: false, lastTick: null, maxConcurrent: 1 } } }); } });
  assert.throws(() => scheduleRemote("s", ["list"], io(["retire-home"])), (e) => e.code === "E_REMOTE_INCOMPATIBLE" && /schedules/.test(e.message));
  assert.equal(calls.filter((c) => c.includes("schedule list")).length, 0, "refused before any remote schedule command");
  const out = scheduleRemote("s", ["add", "x", "--spec-json", "{}"], io(["retire-home", "schedule"]));
  assert.equal(out.envelope.ok, true); assert.equal(out.envelope.result.server, "s");
  assert.match(calls.find((c) => c.includes("schedule add")), /schedule add x --spec-json .*\{\}.* --dir \/w --json/);
});
