import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { JSDOM } from "jsdom";
import { cliSchedule, cliSpawn } from "../cli-adapter.mjs";
import { scheduleRequest } from "../server/schedules.mjs";
import { createSchedulesView, scheduleOutcome } from "../renderer/views/schedules.mjs";
import { wakeScheduleFields } from "../renderer/wake-schedule-fields.mjs";
import { setWorkspace } from "../renderer/views/common.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const cli = { ok: true, bin: "/installed/oats", scheduleApi: 1, features: ["schedule"], remote: ["schedule"] };
const workspace = { id: "/team", scope: "/team" };
const home = "/team/agents/reviewer/instances/reviewer-seat";
const spec = { kind: "wake", enabled: true, cron: "*/15 * * * *", tz: "America/Toronto", home, message: "Check pending work.\nKeep existing work safe." };
const job = { ...spec, id: "review", nextRun: "2026-09-07T12:00:00Z", lastRun: { outcome: "delivered", startedAt: "2026-09-07T11:45:00Z" } };

test("schedule adapter passes private JSON and routes on the saved server without a shell", async () => {
  let file, call;
  const result = await cliSchedule(cli.bin, { operation: "add", id: "review", spec, workspaceDir: "/local", server: "hetzner" }, { exec(bin, argv, opts, cb) {
    file = argv[argv.indexOf("--file") + 1]; call = { bin, argv, opts };
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { ...spec, id: "review" });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    cb(null, JSON.stringify({ schemaVersion: 1, ok: true, result: { schedule: job } }));
  } });
  assert.equal(result.ok, true); assert.equal(existsSync(file), false);
  assert.equal(call.opts.shell, false); assert.equal(call.opts.cwd, "/local");
  assert.deepEqual(call.argv.slice(0, 3), ["schedule", "add", "review"]);
  assert.equal(call.argv.includes("--dir"), false);
  assert.deepEqual(call.argv.slice(-3), ["--server", "hetzner", "--json"]);
  for (const bad of [{ operation: "tick" }, { operation: "remove", id: "--force" }, { operation: "list", server: "--force" }]) {
    assert.equal((await cliSchedule(cli.bin, { workspaceDir: "/local", ...bad }, { exec: () => assert.fail("invalid operation executed") })).ok, false);
  }
});

test("spawn wake file preserves literal message and a partial schedule failure keeps the instance receipt", async () => {
  let taskFile, wakeFile;
  const wake = { cron: spec.cron, tz: spec.tz, message: "$(nothing) `literal`\nsecond line", enabled: true };
  const result = await cliSpawn(cli.bin, { agent: "reviewer", workspaceDir: "/team", task: "Review code", wake }, { exec(bin, argv, opts, cb) {
    taskFile = argv[argv.indexOf("--task-file") + 1]; wakeFile = argv[argv.indexOf("--wake-file") + 1];
    assert.deepEqual(JSON.parse(readFileSync(wakeFile, "utf8")), wake);
    assert.equal(statSync(wakeFile).mode & 0o777, 0o600); assert.equal(opts.shell, false);
    cb(null, JSON.stringify({ schemaVersion: 1, ok: true, result: { instance: "reviewer-seat", home, launched: true, wakeScheduleError: { code: "E_DISK", message: "Disk full" } } }));
  } });
  assert.equal(result.ok, true); assert.equal(result.result.home, home); assert.equal(result.result.wakeScheduleError.message, "Disk full");
  assert.equal(existsSync(taskFile), false); assert.equal(existsSync(wakeFile), false);
  assert.equal((await cliSpawn(cli.bin, { agent: "reviewer", workspaceDir: "/team", wake: { message: "" } }, { exec: () => assert.fail("invalid wake executed") })).ok, false);
});

test("schedule boundary resolves homes in the selected workspace and refuses unsupported CLIs", async () => {
  const calls = [];
  const context = { workspace, cli, localCwd: "/local", instances: [{ home }], invoke: async (bin, args) => { calls.push(args); return { ok: true, result: { schedule: job } }; } };
  await scheduleRequest({ operation: "add", id: "review", spec }, context);
  assert.equal(calls[0].spec.home, home); assert.equal(calls[0].workspaceDir, "/team");
  await assert.rejects(scheduleRequest({ operation: "add", id: "review", spec: { ...spec, home: "/other/home" } }, context), /existing agent home/);
  await assert.rejects(scheduleRequest({ operation: "list" }, { ...context, workspace: undefined }), /known workspace/);
  await assert.rejects(scheduleRequest({ operation: "list" }, { ...context, cli: { ...cli, scheduleApi: undefined } }), /Update/);
  await scheduleRequest({ operation: "add", id: "harvest", spec: { ...spec, kind: "harvest" } }, context);
  assert.deepEqual(calls.at(-1).spec.argv, ["oats", "okf", "harvest", "--json"]);
  assert.equal(calls.at(-1).spec.cwd, home);
  await scheduleRequest({ operation: "list" }, { ...context, workspace: { ...workspace, server: "hetzner", registrationPresent: true } });
  assert.equal(calls.at(-1).server, "hetzner"); assert.equal(calls.at(-1).workspaceDir, "/local");
});

test("scheduled spawn keeps same-named souls in different repositories distinct", async () => {
  const agents = ["first", "second"].map(name => ({ name: "reviewer", agentsRoot: `/team/${name}/agents`, repo: ".", work: "worktree" }));
  let saved;
  const context = { workspace, cli, agents, invoke: async (bin, args) => { saved = args.spec; return { ok: true, result: {} }; } };
  const spawn = { ...spec, kind: "spawn", agent: "reviewer", agentsRoot: "/team/second/agents", repo: ".", task: "Review this repository" };
  await scheduleRequest({ operation: "add", id: "review", spec: spawn }, context);
  assert.equal(saved.agentsRoot, "/team/second/agents");
  await assert.rejects(scheduleRequest({ operation: "add", id: "review", spec: { ...spawn, agentsRoot: "/other/agents" } }, context), /standalone soul/);
});

function setup({ mutate, read, host = { installed: true, active: true, registered: true, lastTick: "2026-09-07T11:59:00Z", maxConcurrent: 1 } } = {}) {
  const dom = new JSDOM("<body><main></main></body>"); const el = dom.window.document.querySelector("main");
  const calls = []; setWorkspace("/team");
  const ctx = { api: async (path, opts) => {
    calls.push({ path, opts });
    if (opts?.method === "POST") return mutate ? mutate(path, JSON.parse(opts.body)) : { schedule: job };
    if (path.startsWith("/api/schedules")) return read ? read(path) : { schedules: [job], scheduler: host };
    if (path.startsWith("/api/agents")) return { agents: [{ name: "reviewer", repo: "src", repoName: "src", agentsRoot: "/team/src/agents", work: "worktree" }] };
    if (path.startsWith("/api/panel")) return { instances: [{ home, instance: "reviewer-seat" }] };
    assert.fail(path);
  } };
  const view = createSchedulesView(el, ctx, { pollMs: 0 });
  return { dom, el, calls, view, cleanup() { view.dispose(); dom.window.close(); } };
}

test("wake form saves exact home/message and polling preserves unsaved input", async () => {
  const s = setup();
  try {
    await tick(); s.el.querySelector(".schedule-new").click(); const form = s.el.querySelector("form");
    form.elements.id.value = "check-work"; form.elements.task.value = "Check work <literally>";
    await s.view.refresh(); assert.equal(form.elements.task.value, "Check work <literally>");
    form.dispatchEvent(new s.dom.window.Event("submit", { cancelable: true })); await tick();
    const request = s.calls.find(c => c.opts?.method === "POST");
    assert.equal(new URL(request.path, "http://local").searchParams.get("ws"), "/team");
    const body = JSON.parse(request.opts.body); assert.equal(body.operation, "add");
    assert.equal(body.spec.home, home); assert.equal(body.spec.message, "Check work <literally>");
    assert.equal(form.hidden, true);
    assert.match(s.el.textContent, /Wake message delivered/);
  } finally { s.cleanup(); }
});

test("editing only a spawn cron preserves its purpose and recurring wake through the server boundary", async () => {
  const wake = { cron: "*/10 * * * *", tz: "UTC", message: "Check pending work" };
  const original = { id: "review", kind: "spawn", enabled: true, cron: "0 3 * * *", tz: "UTC", agent: "reviewer", agentsRoot: "/team/src/agents", repo: "src", task: "Review work", purpose: "sweep", wake };
  let saved;
  const s = setup({ read: async () => ({ schedules: [original], scheduler: { installed: true, active: true, registered: true } }), mutate: async (path, body) => {
    return scheduleRequest(body, { workspace, cli, agents: [{ name: "reviewer", agentsRoot: "/team/src/agents", repo: "src", work: "worktree" }], invoke: async (bin, args) => {
      saved = args.spec; return { ok: true, result: { schedule: { ...args.spec, id: "review" } } };
    } });
  } });
  try {
    await tick(); [...s.el.querySelectorAll(".schedule-card button")].find(b => b.textContent === "Edit").click();
    const form = s.el.querySelector("form"); form.elements.cron.value = "0 4 * * *";
    form.dispatchEvent(new s.dom.window.Event("submit", { cancelable: true })); await tick();
    assert.equal(saved.cron, "0 4 * * *"); assert.equal(saved.purpose, "sweep"); assert.deepEqual(saved.wake, wake);
    assert.equal(saved.agentsRoot, original.agentsRoot);
  } finally { s.cleanup(); }
});

test("double submit dispatches once; late result from prior workspace cannot erase the next draft", async () => {
  let finish; const s = setup({ mutate: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await tick(); s.el.querySelector(".schedule-new").click(); const form = s.el.querySelector("form");
    form.elements.id.value = "check-work"; form.elements.task.value = "Check work";
    const submit = () => form.dispatchEvent(new s.dom.window.Event("submit", { cancelable: true }));
    submit(); submit(); assert.equal(s.calls.filter(c => c.opts?.method === "POST").length, 1);
    setWorkspace("/other"); await tick(); s.el.querySelector(".schedule-new").click(); form.elements.task.value = "New workspace draft";
    finish({ schedule: job }); await tick();
    assert.equal(form.hidden, false); assert.equal(form.elements.task.value, "New workspace draft");
  } finally { s.cleanup(); }
});

test("host installation is explicit and a saved job does not imply a functioning timer", async () => {
  const s = setup({ host: { installed: true, active: true, registered: false } });
  try {
    await tick(); assert.match(s.el.textContent, /not registered/);
    assert.equal(s.calls.some(c => c.opts?.method === "POST"), false);
    s.el.querySelector(".schedule-host-actions button").click(); await tick();
    assert.equal(JSON.parse(s.calls.find(c => c.opts?.method === "POST").opts.body).operation, "host-install");
  } finally { s.cleanup(); }
});

test("read failures disable mutations; schedule failures stay visible with the draft", async () => {
  const s = setup({ mutate: async () => { throw new Error("Invalid cron: month"); } });
  try {
    await tick(); s.el.querySelector(".schedule-new").click(); const form = s.el.querySelector("form");
    form.elements.id.value = "check-work"; form.elements.task.value = "Keep me";
    form.dispatchEvent(new s.dom.window.Event("submit", { cancelable: true })); await tick();
    assert.equal(form.hidden, false); assert.equal(form.elements.task.value, "Keep me");
    assert.match(s.el.querySelector(".schedule-form-error").textContent, /Invalid cron/);
  } finally { s.cleanup(); }
  const failed = setup({ read: async () => { throw new Error("Update oats"); } });
  try { await tick(); assert.equal(failed.el.querySelector(".schedule-new").disabled, true); assert.match(failed.el.textContent, /Update oats/); }
  finally { failed.cleanup(); }
});

test("spawner wake fields are opt-in and preserve the literal message", () => {
  const dom = new JSDOM("<body></body>");
  try {
    const f = wakeScheduleFields(dom.window.document); dom.window.document.body.append(f.el);
    assert.equal(f.read(), undefined); f.el.querySelector(".fwake-enabled").click();
    assert.throws(() => f.read(), /message/);
    f.el.querySelector(".fwake-message").value = "Check pending work.\nNo interruption.";
    assert.equal(f.read().message, "Check pending work.\nNo interruption."); assert.equal(f.read().cron, "*/15 * * * *");
  } finally { dom.window.close(); }
  assert.equal(scheduleOutcome({ outcome: "ended" }), "Run ended");
  assert.doesNotMatch(scheduleOutcome({ outcome: "ended" }), /success/i);
});


test("checking an unknown run preserves the returned remedy across refresh and clears it on workspace change", async () => {
  const unknown = { ...job, lastRun: { outcome: "unknown", error: "Command answered no envelope" } };
  const remedy = "Check the host, then run oats schedule reconcile review --clear";
  const s = setup({ read: async () => ({ schedules: [unknown], scheduler: { installed: true, active: true, registered: true } }), mutate: async () => ({ reconciled: "unknown", remedy }) });
  try {
    await tick(); [...s.el.querySelectorAll(".schedule-card button")].find(b => b.textContent === "Check run state").click(); await tick();
    assert.equal(s.el.querySelector(".schedule-operation-result").textContent, "Run state is still unknown. " + remedy);
    await s.view.refresh(); assert.match(s.el.querySelector(".schedule-operation-result").textContent, /--clear/);
    setWorkspace("/other"); await tick(); assert.equal(s.el.querySelector(".schedule-operation-result").textContent, "");
  } finally { s.cleanup(); }
});
