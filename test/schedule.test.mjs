import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
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
  assert.ok(S.jobLockInfo(ws, "nudge"), "a wake that started a runtime holds the job lock (a launch slot) until that home ends");
  assert.deepEqual(S.describe(ws, "nudge", io).pendingWake, { scheduledFor: "2026-09-07T09:15:00.000Z" }, "the started wake keeps ONE pending delivery");
  // Still stopped on the next (non-due) tick: no restart between due minutes, still pending.
  c = S.tickWorkspace(ws, { now: at("2026-09-07T09:16:00Z"), io, reg });
  assert.equal(c[0].action, "skipped"); assert.equal(c[0].pending, true); assert.equal(inputs.length, 0); assert.equal(started.length, 1);
  // Active on a later non-due tick: the pending message is delivered once, independent of the cron.
  state = { present: true, state: "unknown" };
  c = S.tickWorkspace(ws, { now: at("2026-09-07T09:17:00Z"), io, reg });
  assert.equal(c[0].action, "delivered"); assert.deepEqual(inputs, [[h, "Check your inbox and pending chats."]]);
  assert.equal(S.describe(ws, "nudge", io).pendingWake, undefined);
  assert.deepEqual(S.tickWorkspace(ws, { now: at("2026-09-07T09:18:00Z"), io, reg }), [], "nothing pending, nothing due");
  c = S.tickWorkspace(ws, { now: at("2026-09-07T09:30:00Z"), io, reg });
  assert.equal(c[0].action, "delivered"); assert.equal(inputs.length, 2);
  assert.deepEqual(S.tickWorkspace(ws, { now: at("2026-09-07T09:30:40Z"), io, reg }), [], "never twice in one minute");
  // A due minute while a delivery is pending adds nothing: one pending, one delivery.
  state = { present: false, state: "shell" };
  c = S.tickWorkspace(ws, { now: at("2026-09-07T09:45:00Z"), io, reg }); assert.equal(c[0].action, "started"); assert.equal(started.length, 2);
  c = S.tickWorkspace(ws, { now: at("2026-09-07T09:50:00Z"), io, reg }); assert.equal(c[0].action, "skipped"); assert.equal(started.length, 2, "no restart between due minutes");
  c = S.tickWorkspace(ws, { now: at("2026-09-07T10:00:00Z"), io, reg }); assert.equal(c[0].action, "started"); assert.equal(started.length, 3, "started again only at the due minute");
  state = { present: true, state: "unknown" };
  c = S.tickWorkspace(ws, { now: at("2026-09-07T10:01:00Z"), io, reg }); assert.equal(c[0].action, "delivered"); assert.equal(inputs.length, 3);
  assert.deepEqual(S.tickWorkspace(ws, { now: at("2026-09-07T10:02:00Z"), io, reg }), []);
  state = new Error("socket unavailable");
  c = S.tickWorkspace(ws, { now: at("2026-09-07T10:15:00Z"), io, reg });
  assert.equal(c[0].action, "skipped"); assert.match(c[0].reason, /cannot observe/); assert.equal(c[0].pending, true);
  rmSync(h, { recursive: true, force: true });
  c = S.tickWorkspace(ws, { now: at("2026-09-07T10:16:00Z"), io, reg });
  assert.deepEqual(c, [], "the observation pass handles a gone home: nothing pending, nothing due");
  assert.equal(S.describe(ws, "nudge", io).pendingWake, undefined, "a gone home drops the pending delivery");
  assert.equal(S.jobLockInfo(ws, "nudge"), null, "the slot is released when the started home is gone");
  c = S.tickWorkspace(ws, { now: at("2026-09-07T10:30:00Z"), io, reg });
  assert.equal(c[0].action, "skipped"); assert.match(c[0].reason, /gone/);
  assert.equal(inputs.length, 3);
});

test("agentsRoot selects the exact soul among same-named souls in member repositories; repo stays the work repository", () => {
  const ws = workspace();
  const other = join(ws, "member", "agents");
  mkdirSync(join(other, "dev", "soul"), { recursive: true });
  writeFileSync(join(other, "dev", "soul", "soul.yaml"), "name: dev\nwork: worktree\nruntime: pi\n");
  writeFileSync(join(other, "dev", "soul", "AGENTS.md"), "# Member dev\n");
  const base1 = S.resolveScheduledAgent(ws, { agent: "dev" });
  assert.equal(base1.root, join(ws, "agents"));
  const picked = S.resolveScheduledAgent(ws, { agent: "dev", agentsRoot: other, repo: "/some/work/repo" });
  assert.equal(picked.root, other); assert.equal(picked.agent.runtime, "pi");
  assert.throws(() => S.validateDefinition(ws, { id: "x", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "t", agentsRoot: join(base, "outside") }), (e) => e.code === "E_SCHEDULE_INVALID" && e.field === "agentsRoot");
  assert.throws(() => S.validateDefinition(ws, { id: "x", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "t", agentsRoot: join(ws, "member") }), (e) => e.code === "E_SCHEDULE_INVALID" && e.field === "agentsRoot");
  const calls = [];
  const io = { spawn: (root, agent, opts) => { calls.push({ root, agent: agent.name, runtime: agent.runtime, repo: opts.repo }); return { instance: `dev-${opts.purpose}`, home: home(ws, `dev-${opts.purpose}`), launched: true }; }, inspect: () => ({ present: true, state: "unknown" }) };
  S.addSchedule(ws, { id: "member", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "dev", agentsRoot: other, repo: "/some/work/repo", task: "t" });
  S.tickWorkspace(ws, { now: at("2026-09-07T14:00:00Z"), io, reg: S.readRegistry() });
  assert.deepEqual(calls, [{ root: other, agent: "dev", runtime: "pi", repo: "/some/work/repo" }], "launched from the named root with repo passed as the work repository");
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
  assert.match(plist, /<key>PATH<\/key><string>\/usr\/local\/bin:/, "the unit carries an explicit PATH starting with the node's dir");
  const units = H.renderSystemdUnits({ node: "/usr/bin/node", oatsBin: "/opt/oats/bin/oats.mjs" });
  assert.match(units.service, /ExecStart="\/usr\/bin\/node" "\/opt\/oats\/bin\/oats\.mjs" schedule tick --host --json/);
  assert.match(units.service, /Environment="PATH=/);
  assert.equal(H.systemdQuote("/opt/my apps/100%/oats"), '"/opt/my apps/100%%/oats"');
  assert.match(units.timer, /OnUnitActiveSec=60/);
  const exec = (b, argv) => { if (argv[0] === "print" || argv[1] === "is-active") throw Object.assign(new Error("not loaded"), { status: 113 }); return ""; };
  const st = H.hostUnitStatus({ exec, os: "darwin" });
  assert.equal(st.active, false, "a unit file alone is never active");
  const lin = H.hostUnitStatus({ exec, os: "linux" });
  assert.equal(lin.installed, false); assert.equal(lin.active, false);
  assert.equal(H.hostUnitStatus({ os: "win32" }).kind, "unsupported");
  // Idempotent install: an active identical unit is left untouched (no bootout).
  const plistPath = H.hostUnitPaths("darwin").plist;
  const keep = existsSync(plistPath) ? readFileSync(plistPath, "utf8") : null;
  const calls = [];
  const activeExec = (b, argv) => { calls.push(argv.join(" ")); return ""; };
  try {
    mkdirSync(dirname(plistPath), { recursive: true });
    writeFileSync(plistPath, H.renderLaunchdPlist({ intervalSec: 60 }));
    const st2 = H.installHostUnit({ exec: activeExec, os: "darwin", intervalSec: 60 });
    assert.equal(st2.active, true);
    assert.equal(calls.some((c) => c.startsWith("bootout") || c.startsWith("bootstrap")), false, "identical active unit: no bootout, no bootstrap");
  } finally { if (keep === null) rmSync(plistPath, { force: true }); else writeFileSync(plistPath, keep); }
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

test("a cold wake needs a launch slot; a delivery to a running home does not; a started runtime keeps its slot until the home ends", () => {
  const ws = workspace();
  const h1 = home(ws, "dev-one"), h2 = home(ws, "dev-two"), h3 = home(ws, "dev-running");
  const states = { [h1]: { present: false, state: "shell" }, [h2]: { present: false, state: "shell" }, [h3]: { present: true, state: "unknown" } };
  const started = [], inputs = [];
  const io = { inspect: (h) => states[h], start: (h) => { started.push(h); return { instance: "x" }; }, input: (h, t) => { inputs.push([h, t]); return { submitted: true }; }, spawn: fakeSpawn(ws) };
  S.addSchedule(ws, { id: "one", cron: "* * * * *", tz: "UTC", kind: "wake", home: h1, message: "m1" });
  S.addSchedule(ws, { id: "two", cron: "* * * * *", tz: "UTC", kind: "wake", home: h2, message: "m2" });
  S.addSchedule(ws, { id: "run", cron: "* * * * *", tz: "UTC", kind: "wake", home: h3, message: "m3" });
  const reg = S.readRegistry();
  let c = S.tickWorkspace(ws, { now: at("2026-09-07T15:00:00Z"), io, reg });
  const by = Object.fromEntries(c.map((x) => [x.id, x]));
  assert.equal(by.one.action, "started"); assert.equal(by.two.action, "skipped"); assert.match(by.two.reason, /host busy/); assert.equal(by.two.pending, true);
  assert.equal(by.run.action, "delivered", "a running home receives its message without a slot");
  assert.equal(started.length, 1); assert.deepEqual(S.describe(ws, "two", io).pendingWake, { scheduledFor: "2026-09-07T15:00:00.000Z" });
  // one becomes active: its pending message is delivered on the next tick and it still holds the slot.
  states[h1] = { present: true, state: "unknown" };
  c = S.tickWorkspace(ws, { now: at("2026-09-07T15:01:00Z"), io, reg });
  const by2 = Object.fromEntries(c.map((x) => [x.id, x]));
  assert.equal(by2.one.action, "delivered"); assert.equal(by2.two.action, "skipped"); assert.match(by2.two.reason, /host busy/);
  assert.ok(S.jobLockInfo(ws, "one")); assert.equal(started.length, 1);
  // one's home ends: the slot frees; two starts at the next due minute.
  rmSync(h1, { recursive: true, force: true });
  c = S.tickWorkspace(ws, { now: at("2026-09-07T15:02:00Z"), io, reg });
  const by3 = Object.fromEntries(c.map((x) => [x.id, x]));
  assert.equal(by3.two.action, "started"); assert.equal(started.length, 2); assert.equal(S.jobLockInfo(ws, "one"), null);
});

test("a running wake delivers beside a long scheduled spawn that holds the only slot", () => {
  const ws = workspace();
  const h = home(ws, "dev-live");
  const inputs = [];
  const io = { spawn: fakeSpawn(ws), inspect: () => ({ present: true, state: "unknown" }), input: (hh, t) => { inputs.push(t); return { submitted: true }; } };
  S.addSchedule(ws, { id: "long", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "long" });
  S.addSchedule(ws, { id: "ping", cron: "* * * * *", tz: "UTC", kind: "wake", home: h, message: "ping" });
  const reg = S.readRegistry();
  let c = S.tickWorkspace(ws, { now: at("2026-09-07T16:00:00Z"), io, reg });
  assert.deepEqual(c.map((x) => [x.id, x.action]), [["long", "launched"], ["ping", "delivered"]]);
  c = S.tickWorkspace(ws, { now: at("2026-09-07T16:01:00Z"), io, reg });
  assert.deepEqual(c.map((x) => [x.id, x.action]).sort(), [["long", "skipped"], ["ping", "delivered"]]);
  assert.equal(inputs.length, 2);
});

test("a command that creates a home and then times out stays unknown with its slot held until reconcile adopts it", () => {
  const ws = workspace();
  const src = home(ws, "dev-src");
  // A dummy oats binary: creates an instance home like a harvester spawn would, prints nothing, then sleeps past the timeout.
  const dummy = join(base, "dummy-oats.mjs");
  writeFileSync(dummy, `import { mkdirSync, writeFileSync } from "node:fs"; import { join } from "node:path";
const h = join(${JSON.stringify(ws)}, "agents", "dev", "instances", "dev-harvest-late"); mkdirSync(h, { recursive: true }); writeFileSync(join(h, "instance.json"), JSON.stringify({ instance: "dev-harvest-late", home: h }));
await new Promise((r) => setTimeout(r, 5000));\n`);
  const io = { oatsBin: dummy, commandTimeoutMs: 800, inspect: () => ({ present: true, state: "unknown" }) };
  S.addSchedule(ws, { id: "late", cron: "* * * * *", tz: "UTC", kind: "command", cwd: src, argv: ["oats", "okf", "harvest"] });
  const reg = S.readRegistry();
  const c = S.tickWorkspace(ws, { now: at("2026-09-07T17:00:00Z"), io, reg });
  assert.equal(c[0].action, "unknown"); assert.match(c[0].error, /timed out/);
  let d = S.describe(ws, "late", io);
  assert.equal(d.lastRun.outcome, "unknown"); assert.ok(d.attempt, "the attempt is retained"); assert.equal(d.running, true, "the slot is held");
  // The next minute must not launch again.
  const c2 = S.tickWorkspace(ws, { now: at("2026-09-07T17:01:00Z"), io, reg });
  assert.equal(c2[0].action, "skipped"); assert.match(c2[0].reason, /reconcile/);
  assert.throws(() => S.runNow(ws, "late", { io }), (e) => e.code === "E_SCHEDULE_UNRESOLVED");
  // Reconcile finds the one home created after the attempt and adopts it.
  const r = S.reconcile(ws, "late", { io });
  assert.equal(r.reconciled, "adopted"); assert.equal(r.schedule.lastRun.instance, "dev-harvest-late"); assert.equal(r.schedule.lastRun.outcome, "active");
  assert.equal(S.describe(ws, "late", io).attempt, undefined);
});

test("a command whose envelope names a member-repository home is tracked through the complete roster; an unplaceable instance stays unknown", () => {
  const ws = workspace();
  const src = home(ws, "dev-src2");
  const member = join(ws, "member", "agents");
  mkdirSync(join(member, "dev", "soul"), { recursive: true });
  writeFileSync(join(member, "dev", "soul", "soul.yaml"), "name: dev\n"); writeFileSync(join(member, "dev", "soul", "AGENTS.md"), "#\n");
  const memberHome = join(member, "dev", "instances", "memory-harvest-one"); mkdirSync(memberHome, { recursive: true }); writeFileSync(join(memberHome, "instance.json"), "{}");
  const io = { command: () => ({ ok: true, result: { harvest: "spawned", instance: "memory-harvest-one" } }), inspect: () => ({ present: true, state: "unknown" }) };
  S.addSchedule(ws, { id: "member-harvest", cron: "* * * * *", tz: "UTC", kind: "command", cwd: src, argv: ["oats", "okf", "harvest"] });
  const c = S.tickWorkspace(ws, { now: at("2026-09-07T18:00:00Z"), io, reg: S.readRegistry() });
  assert.equal(c[0].action, "launched");
  const d = S.describe(ws, "member-harvest", io);
  assert.equal(d.lastRun.home, memberHome); assert.equal(d.running, true);
  const io2 = { command: () => ({ ok: true, result: { harvest: "spawned", instance: "memory-harvest-nowhere" } }), inspect: io.inspect };
  S.addSchedule(ws, { id: "lost", cron: "* * * * *", tz: "UTC", kind: "command", cwd: src, argv: ["oats", "okf", "harvest"] });
  rmSync(memberHome, { recursive: true, force: true });
  const c2 = S.tickWorkspace(ws, { now: at("2026-09-07T18:01:00Z"), io: io2, reg: S.readRegistry() });
  const lost = c2.find((x) => x.id === "lost");
  assert.equal(lost.action, "unknown"); assert.match(lost.error, /no home for it/);
  assert.ok(S.describe(ws, "lost", io2).attempt, "the attempt is retained, the slot held");
  assert.equal(S.parseEnvelopeText('note\n{"ok":true,"result":{"a":1}}').result.a, 1);
  assert.equal(S.parseEnvelopeText('{\n "ok": true,\n "result": {"b": 2}\n}').result.b, 2);
  assert.equal(S.parseEnvelopeText("garbage"), null);
});

test("the host lock is never reclaimed: an unreadable or dead owner is refused with the directory to remove", () => {
  const dir = join(process.env.OATS_HOME_DIR, "schedules", "host.lock");
  mkdirSync(dir, { recursive: true }); // the pre-owner-publication state of a live acquirer
  assert.throws(() => S.withHostLock(() => "entered"), (e) => e.code === "E_SCHEDULER_BUSY" && e.message.includes(dir) && /not readable/.test(e.message));
  assert.ok(existsSync(dir), "the contender did not delete the other acquirer's lock");
  writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: 999999, at: "x" }));
  assert.throws(() => S.withHostLock(() => "entered"), (e) => e.code === "E_SCHEDULER_BUSY" && /gone/.test(e.message));
  assert.ok(existsSync(dir), "a dead owner is reported, not reclaimed");
  rmSync(dir, { recursive: true, force: true });
  assert.equal(S.withHostLock(() => "entered"), "entered");
  assert.equal(existsSync(dir), false, "own lock removed in finally");
});

test("dry-run touches no lock, state or definition; a retiring home keeps its slot; run-now observes before judging a lock", () => {
  const ws = workspace();
  const io = { spawn: fakeSpawn(ws), inspect: () => ({ present: true, state: "unknown" }) };
  S.addSchedule(ws, { id: "d", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "t" });
  const reg = S.readRegistry();
  const statePath = join(ws, ".agents", "schedules", "state.json");
  const before = existsSync(statePath) ? readFileSync(statePath, "utf8") : null;
  const dry = S.tickWorkspace(ws, { now: at("2026-09-07T19:00:00Z"), io, reg, dryRun: true });
  assert.deepEqual(dry.map((x) => [x.id, x.action]), [["d", "due"]]);
  assert.equal(existsSync(statePath) ? readFileSync(statePath, "utf8") : null, before, "dry-run wrote no state");
  assert.equal(S.jobLockInfo(ws, "d"), null);
  S.tickWorkspace(ws, { now: at("2026-09-07T19:00:00Z"), io, reg });
  const h = S.describe(ws, "d", io).lastRun.home;
  // A pending retirement marker beside the home is not "ended": the runtime may still be alive.
  writeFileSync(join(dirname(h), `.oats-retire-pending-${basename(h)}.json`), "{}");
  const seen = S.observeHome(h, io);
  assert.equal(seen.outcome, "active"); assert.match(seen.note, /retiring/);
  const dry2 = S.tickWorkspace(ws, { now: at("2026-09-07T19:01:00Z"), io, reg, dryRun: true });
  assert.equal(dry2[0].reason, "still running"); assert.ok(S.jobLockInfo(ws, "d"), "dry-run released nothing");
  // The home is gone: run-now observes that under the host lock and runs instead of refusing on a stale lock.
  rmSync(join(dirname(h), `.oats-retire-pending-${basename(h)}.json`), { force: true }); rmSync(h, { recursive: true, force: true });
  const r = S.runNow(ws, "d", { io, now: at("2026-09-07T19:05:30Z") });
  assert.equal(r.run.outcome, "launched");
  assert.equal(readJson(statePath).jobs.d.lastAttemptedMinute, "2026-09-07T19:05", "run-now records the attempted minute so the timer cannot double-fire");
});

test("the schedule scope is the team level, else the outermost config level; invalid definitions do not stop the tick; due jobs rotate", () => {
  const team = join(base, "team-scope"); mkdirSync(join(team, "member", "agents", "dev", "soul"), { recursive: true });
  writeFileSync(join(team, "oats-config.yaml"), "team:\n  name: t\n");
  writeFileSync(join(team, "member", "oats-config.yaml"), "capabilities: {}\n");
  assert.equal(S.scheduleScopeOf(join(team, "member", "agents", "dev", "soul")), realpathSync(team));
  const plain = join(base, "plain-scope"); mkdirSync(join(plain, "inner", "agents"), { recursive: true });
  writeFileSync(join(plain, "oats-config.yaml"), "capabilities: {}\n"); writeFileSync(join(plain, "inner", "oats-config.yaml"), "capabilities: {}\n");
  assert.equal(S.scheduleScopeOf(join(plain, "inner", "agents")), realpathSync(plain), "outermost config level wins without a team");
  const ws = workspace();
  const io = { spawn: fakeSpawn(ws), inspect: () => ({ present: true, state: "unknown" }) };
  S.addSchedule(ws, { id: "a", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "a" });
  S.addSchedule(ws, { id: "b", cron: "* * * * *", tz: "UTC", kind: "spawn", agent: "dev", task: "b" });
  const defs = S.readDefinitions(ws); defs.jobs.broken = { ...defs.jobs.a, id: "broken", cron: "99 99 * * *" }; S.writeDefinitions(ws, defs);
  const reg = S.readRegistry();
  let c = S.tickWorkspace(ws, { now: at("2026-09-07T20:00:00Z"), io, reg });
  const by = Object.fromEntries(c.map((x) => [x.id, x.action]));
  assert.equal(by.broken, "invalid"); assert.equal(by.a, "launched"); assert.equal(by.b, "skipped");
  rmSync(S.describe(ws, "a", io).lastRun.home, { recursive: true, force: true });
  c = S.tickWorkspace(ws, { now: at("2026-09-07T20:01:00Z"), io, reg });
  const by2 = Object.fromEntries(c.map((x) => [x.id, x.action]));
  assert.equal(by2.b, "launched", "the job that never ran goes first"); assert.equal(by2.a, "skipped");
});

test("the launchd unit runs the CLI under a minimal environment with only its own PATH", () => {
  const plist = H.renderLaunchdPlist();
  const path = /<key>PATH<\/key><string>([^<]+)<\/string>/.exec(plist)[1];
  const out = execFileSync("/usr/bin/env", ["-i", `PATH=${path}`, "HOME=" + process.env.HOME, "node", bin, "version", "--json"], { encoding: "utf8" });
  assert.equal(JSON.parse(out.trim()).name, "@awebai/oats");
  const which = execFileSync("/usr/bin/env", ["-i", `PATH=${path}`, "sh", "-c", "command -v tmux || true"], { encoding: "utf8" }).trim();
  assert.ok(which.includes("tmux"), `tmux resolvable under the unit PATH (got ${JSON.stringify(which)})`);
});

test("a routed spawn refuses a wake schedule when the host lacks the feature and forwards it inline otherwise", async () => {
  const { routeCommand } = await import("../lib/servers.mjs");
  const oatsHome = process.env.OATS_HOME_DIR; mkdirSync(oatsHome, { recursive: true });
  writeFileSync(join(oatsHome, "servers.json"), JSON.stringify({ servers: { s: { sshHost: "h", workspace: "/w" } } }));
  const calls = [];
  const io = (features) => ({ execFileSync: (b, argv) => { const a = argv.join(" "); calls.push(a);
    if (a.includes("version --json")) return JSON.stringify({ schemaVersion: 1, ok: true, result: { desktopApi: 1, version: "0.22.10", runtimes: ["pi", "claude", "codex"], sessionBackends: ["tmux"], launchOptions: ["yolo"], remote: ["spawn", "session"], features } });
    if (a.includes(" status ")) return JSON.stringify({ schemaVersion: 1, ok: true, result: { root: "/w/agents", agents: [{ name: "dev", runtime: "claude" }] } });
    return JSON.stringify({ schemaVersion: 1, ok: true, result: { instance: "dev-x", home: "/w/agents/dev/instances/dev-x", launched: true } }); } });
  assert.throws(() => routeCommand("s", "spawn", ["dev", "--wake-json", "{\"cron\":\"*/5 * * * *\",\"tz\":\"UTC\",\"message\":\"hi\"}"], io(["retire-home"])), (e) => e.code === "E_REMOTE_INCOMPATIBLE" && /wake schedule/.test(e.message));
  assert.equal(calls.filter((c) => c.includes(" spawn ")).length, 0, "refused before spawning");
  const out = routeCommand("s", "spawn", ["dev", "--wake-json", "{\"cron\":\"*/5 * * * *\",\"tz\":\"UTC\",\"message\":\"hi\"}"], io(["retire-home", "schedule"]));
  assert.equal(out.envelope.ok, true);
  assert.match(calls.find((c) => c.includes(" spawn ")), /--wake-json/);
});
