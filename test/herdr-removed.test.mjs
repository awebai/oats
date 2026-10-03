// Herdr was removed in 0.31.0: tmux is the only session backend. Every place that meets Herdr (a
// flag, a schedule or trigger file, a server registration, a home a Herdr-era kernel recorded)
// refuses with E_HERDR_REMOVED and says what to do, and never falls back to tmux silently. A
// recorded Herdr home still retires, on the host process scan.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn as spawnProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { attachInstanceSession, inputInstanceSession, inspectInstanceSession, restartInstanceSession, retireInstance, startInstanceSession, stopInstanceSession } from "../lib/core.mjs";
import { definitionsPath, validateDefinition, validateWorkspaceSchedule, tickWorkspace } from "../lib/schedule.mjs";
import { addTrigger, triggerKind } from "../lib/triggers.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const STEM = "Herdr is no longer supported by OATS (removed in 0.31.0); tmux is the only session backend.";
const setting = (what) => `${STEM} ${what}. Remove it (or use tmux).`;
const instance = (name) => `${STEM} ${name} was opened in Herdr. Retire it (\`oats retire ${name}\`) and spawn a new instance; it opens in tmux.`;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const fx = v2Deployment();
test.after(() => fx.cleanup());

// ---- flags -----------------------------------------------------------------------------

test("spawn refuses --backend herdr and --herdr-socket before anything is resolved", () => {
  for (const [args, what] of [
    [["--backend", "herdr"], "--backend herdr was given"],
    [["--backend=herdr"], "--backend herdr was given"],
    [["--herdr-socket", "/tmp/herdr.sock"], "--herdr-socket was given"],
    [["--backend", "tmux", "--herdr-socket=/tmp/herdr.sock"], "--herdr-socket was given"],
  ]) {
    const r = fx.cli(["spawn", "dev", "--name", "never-made", ...args, "--json"]);
    assert.equal(r.status, 1, args.join(" "));
    assert.deepEqual(r.json().error, { code: "E_HERDR_REMOVED", message: setting(what) }, args.join(" "));
  }
  assert.equal(existsSync(join(fx.root, "dev", "instances", "never-made")), false, "nothing was created");
  const text = fx.cli(["spawn", "dev", "--name", "never-made", "--backend", "herdr"]);
  assert.equal(text.status, 1);
  assert.match(text.stderr, new RegExp(setting("--backend herdr was given").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("--backend tmux is still accepted, and tmux is the preview's only backend", () => {
  for (const args of [["--backend", "tmux"], []]) {
    const preview = fx.cli(["spawn", "dev", "--name", "tmux-kept", ...args, "--preview", "--json"]);
    assert.equal(preview.status, 0, preview.stdout + preview.stderr);
    assert.equal(preview.json().result.backend, "tmux");
    assert.equal(preview.json().result.decision.effective.backend, "tmux");
  }
  const r = fx.cli(["spawn", "dev", "--name", "tmux-kept", "--backend", "tmux", "--no-launch", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.json().result.instance, "tmux-kept");
  assert.equal(r.json().result.backend, "tmux", "the spawn result carries the backend too");
});

test("server add refuses --herdr; a registration or saved route that records herdrPath still loads, and the field is ignored", () => {
  const r = fx.cli(["server", "add", "old", "--ssh", "host", "--workspace", "/srv/ws", "--herdr", "/usr/local/bin/herdr", "--json"]);
  assert.equal(r.status, 1);
  assert.deepEqual(r.json().error, { code: "E_HERDR_REMOVED", message: setting("server add --herdr was given") });
  const oatsHome = fx.env.OATS_HOME_DIR;
  mkdirSync(join(oatsHome, "remote", "old"), { recursive: true });
  writeFileSync(join(oatsHome, "servers.json"), JSON.stringify({ servers: { old: { sshHost: "host", workspace: "/srv/ws", herdrPath: "/usr/local/bin/herdr" } } }));
  const target = { sshHost: "host", workspace: "/srv/ws", oatsPath: "oats", herdrPath: "/usr/local/bin/herdr" };
  writeFileSync(join(oatsHome, "remote", "old", "dev-a.json"), JSON.stringify({ serverId: "old", target, remote: { version: "0.30.0", schemaVersion: 1 }, instance: "dev-a", agent: "dev", home: "/srv/ws/agents/dev/instances/dev-a" }));
  const list = fx.cli(["server", "list", "--json"]);
  assert.equal(list.status, 0, list.stdout + list.stderr);
  const [row] = list.json().result.servers;
  assert.deepEqual({ ...row, snapshots: undefined }, { id: "old", sshHost: "host", workspace: "/srv/ws", workspaceKey: null, target: { sshHost: "host", workspace: "/srv/ws", oatsPath: "oats" }, snapshots: undefined });
  assert.equal(row.snapshots, 1);
  assert.equal(fx.cli(["server", "list"]).stdout.includes("herdr"), false, "the text listing never prints it");
  // A re-registration writes the file again: the ignored field is not carried.
  const re = fx.cli(["server", "add", "second", "--ssh", "host2", "--workspace", "/srv/ws2", "--json"]);
  assert.equal(re.status, 0, re.stdout + re.stderr);
  assert.equal(readFileSync(join(oatsHome, "servers.json"), "utf8").includes("herdr"), false);
  const forgot = fx.cli(["server", "forget", "old", "--instance", "dev-a", "--json"]);
  assert.equal(forgot.status, 0, forgot.stdout + forgot.stderr);
  assert.deepEqual(forgot.json().result.target, { sshHost: "host", workspace: "/srv/ws", oatsPath: "oats" });
});

test("a routed spawn with Herdr is refused locally, before ssh, even when the remote advertises herdr", () => {
  const bin = join(fx.base, "routed-bin");
  mkdirSync(bin, { recursive: true });
  const marker = join(fx.base, "ssh-called");
  // A remote that would advertise herdr (an older kernel): it is never asked.
  writeFileSync(join(bin, "ssh"), `#!/bin/sh\ntouch ${JSON.stringify(marker)}\necho '{"schemaVersion":1,"ok":true,"result":{"version":"0.30.0","sessionBackends":["tmux","herdr"]}}'\n`);
  chmodSync(join(bin, "ssh"), 0o755);
  const env = { PATH: `${bin}:${fx.env.PATH}` };
  assert.equal(fx.cli(["server", "add", "routed", "--ssh", "host", "--workspace", "/srv/ws", "--json"], { env }).status, 0);
  rmSync(marker, { force: true }); // server add asks the host for its workspace key; the spawns below must never reach it
  for (const [args, what] of [[["--backend", "herdr"], "--backend herdr was given"], [["--herdr-socket", "/s"], "--herdr-socket was given"]]) {
    const r = fx.cli(["spawn", "dev", "--server", "routed", "--purpose", "x", ...args, "--json"], { env });
    assert.equal(r.status, 1);
    assert.deepEqual(r.json().error, { code: "E_HERDR_REMOVED", message: setting(what) });
  }
  assert.equal(existsSync(marker), false, "ssh was never run");
});

test("version --json advertises tmux as the only session backend", () => {
  const r = fx.cli(["version", "--json"]);
  assert.deepEqual(JSON.parse(r.stdout).sessionBackends, ["tmux"]);
});

// ---- schedules and triggers --------------------------------------------------------------

const spawnJob = { kind: "spawn", cron: "0 9 * * *", tz: "UTC", agent: "dev", task: "t" };

test("a schedule with backend: herdr is refused at validation, naming the file and key", () => {
  assert.throws(() => validateDefinition(fx.dep, { ...spawnJob, id: "nightly", backend: "herdr" }, { checkAgent: false }),
    (e) => e.code === "E_HERDR_REMOVED" && e.message === setting(`${definitionsPath(fx.dep)} sets jobs.nightly.backend: herdr`));
  assert.equal(validateDefinition(fx.dep, { ...spawnJob, id: "nightly", backend: "tmux" }, { checkAgent: false }).backend, "tmux");
  const entry = { name: "nightly", origin: { kind: "workspace", path: "oats-schedules/nightly.yaml" }, source: { definition: { ...spawnJob, backend: "herdr" } } };
  assert.throws(() => validateWorkspaceSchedule(fx.dep, entry),
    (e) => e.code === "E_HERDR_REMOVED" && e.message === setting("oats-schedules/nightly.yaml sets backend: herdr"));
});

test("a stored local schedule with backend: herdr never runs: the tick reports it invalid with the refusal", async () => {
  const ws = fx.dep;
  writeFileSync(definitionsPath(ws), JSON.stringify({ version: 2, jobs: { stored: { ...spawnJob, id: "stored", enabled: true, backend: "herdr" } } }));
  try {
    const considered = await fx.inEnv(() => tickWorkspace(ws, { now: new Date("2026-09-29T09:00:00Z"), only: "stored", dryRun: true, reg: { maxConcurrent: 1 } }));
    const row = considered.find((c) => c.id === "stored");
    assert.equal(row.action, "invalid");
    assert.equal(row.errorCode, "E_HERDR_REMOVED");
    assert.equal(row.error, setting(`${definitionsPath(ws)} sets jobs.stored.backend: herdr`));
    // Every read says so too: list, show and test report the job invalid and not runnable here.
    const refusal = { code: "E_HERDR_REMOVED", message: setting(`${definitionsPath(ws)} sets jobs.stored.backend: herdr`), field: "backend" };
    const list = fx.cli(["schedule", "list", "--json"]);
    assert.equal(list.status, 0, list.stdout + list.stderr);
    for (const shown of [list.json().result.schedules.find((x) => x.id === "stored"), fx.cli(["schedule", "show", "local/stored", "--json"]).json().result.schedule]) {
      assert.deepEqual(shown.invalid, refusal);
      assert.equal(shown.runsHere, false);
    }
    const tested = fx.cli(["schedule", "test", "local/stored", "--json"]).json().result;
    assert.ok(tested.test.problems.includes(`local/stored is invalid: ${refusal.message}`), JSON.stringify(tested.test.problems));
  } finally { writeFileSync(definitionsPath(ws), JSON.stringify({ version: 2, jobs: {} })); }
});

test("a trigger with spawn.backend: herdr is refused at validation, naming the file and key", async () => {
  const def = { id: "reviews", on: { source: "github.pull_request", repo: "github.com/o/r", events: ["ready_for_review"] }, spawn: { soul: "dev", task: "review {url}", backend: "herdr" } };
  assert.throws(() => addTrigger(fx.dep, def), (e) => e.code === "E_HERDR_REMOVED" && e.message === setting(`${definitionsPath(fx.dep)} sets jobs.reviews.spawn.backend: herdr`));
  const entry = { name: "reviews", owner: null, origin: { kind: "workspace", path: "oats-triggers/reviews.yaml" }, source: { definition: { on: def.on, spawn: def.spawn } } };
  await assert.rejects(async () => triggerKind().expand(entry), (e) => e.code === "E_HERDR_REMOVED" && e.message === setting("oats-triggers/reviews.yaml sets spawn.backend: herdr"));
  // A stored local trigger that names herdr reads as invalid, with the same refusal.
  writeFileSync(definitionsPath(fx.dep), JSON.stringify({ version: 2, jobs: { reviews: { ...def, kind: "trigger", enabled: true } } }));
  try {
    const list = fx.cli(["trigger", "list", "--json"]);
    assert.equal(list.status, 0, list.stdout + list.stderr);
    const row = list.json().result.triggers.find((t) => t.id === "local/reviews");
    assert.equal(row.invalid.code, "E_HERDR_REMOVED");
    assert.equal(row.invalid.message, setting(`${definitionsPath(fx.dep)} sets jobs.reviews.spawn.backend: herdr`));
  } finally { writeFileSync(definitionsPath(fx.dep), JSON.stringify({ version: 2, jobs: {} })); }
});

// ---- homes a Herdr-era kernel recorded -----------------------------------------------------

/** A real spawned home rewritten to what a 0.25.8–0.30 Herdr spawn recorded: instance.json
 *  carries `backend: "herdr"` (and, once launched, the session target) and no tmux endpoint; the
 *  independent receipt carries the same target. `receiptOnly` leaves instance.json as spawned. */
async function herdrHome(name, { launched = true, receiptOnly = false } = {}) {
  const { home } = await fx.spawn("dev", { name });
  const target = { backend: "herdr", binary: "/opt/homebrew/bin/herdr", socket: join(fx.base, "herdr", "herdr.sock"), protocol: 22, workspaceId: "w1", paneId: "p1", terminalId: "t1" };
  if (!receiptOnly) {
    const { tmux: _tmux, ...meta } = readJson(join(home, "instance.json"));
    writeFileSync(join(home, "instance.json"), JSON.stringify({ ...meta, backend: "herdr", launched, ...(launched ? { sessionTarget: target } : {}) }, null, 2) + "\n");
  }
  const key = createHash("sha256").update(home).digest("hex");
  const baselinePath = join(dirname(home), ".oats-retirement", "baselines", `${key}.json`);
  const baseline = readJson(baselinePath);
  writeFileSync(baselinePath, JSON.stringify({ ...baseline, runtime: launched || receiptOnly ? { launched: true, sessionTarget: target } : { launched: false } }, null, 2) + "\n", { mode: 0o600 });
  return { home, name, target, baselinePath };
}

test("every session operation on a Herdr home refuses with E_HERDR_REMOVED, never E_RUNTIME_ENDPOINT_UNKNOWN", async () => {
  const homes = [await herdrHome("herdr-launched"), await herdrHome("herdr-never", { launched: false }), await herdrHome("herdr-receipt", { receiptOnly: true })];
  for (const { home, name } of homes) {
    const refused = (e) => e.code === "E_HERDR_REMOVED" && e.message === instance(name);
    await fx.inEnv(async () => {
      assert.throws(() => inspectInstanceSession(home), refused, `${name} inspect`);
      assert.throws(() => inputInstanceSession(home, "hello"), refused, `${name} input`);
      assert.throws(() => startInstanceSession(home), refused, `${name} start`);
      assert.throws(() => restartInstanceSession(home), refused, `${name} restart`);
      assert.throws(() => stopInstanceSession(home), refused, `${name} stop`);
      await assert.rejects(() => attachInstanceSession(home), refused, `${name} attach`);
    });
    const r = fx.cli(["session", "inspect", "--home", home, "--json"]);
    assert.equal(r.status, 1);
    assert.deepEqual(r.json().error, { code: "E_HERDR_REMOVED", message: instance(name) });
  }
});

test("start and restart recognise a Herdr home before reading its receipt: a broken receipt, or no instance.json", async () => {
  const broken = await herdrHome("herdr-broken-receipt", { launched: false });
  writeFileSync(broken.baselinePath, "{broken");
  const receiptOnly = await herdrHome("herdr-no-meta", { receiptOnly: true });
  rmSync(join(receiptOnly.home, "instance.json"));
  for (const { home, name } of [broken, receiptOnly]) {
    const refused = (e) => e.code === "E_HERDR_REMOVED" && e.message === instance(name);
    await fx.inEnv(async () => {
      assert.throws(() => startInstanceSession(home), refused, `${name} start`);
      assert.throws(() => restartInstanceSession(home), refused, `${name} restart`);
      assert.throws(() => inspectInstanceSession(home), refused, `${name} inspect`);
      assert.throws(() => stopInstanceSession(home), refused, `${name} stop`);
    });
  }
});

test("a start never adopts a pending Herdr start receipt", async () => {
  const { home } = await fx.spawn("dev", { name: "herdr-pending" });
  const target = { backend: "herdr", binary: "/opt/homebrew/bin/herdr", socket: "/tmp/h.sock", protocol: 22, workspaceId: "w", paneId: "p", terminalId: "t" };
  writeFileSync(join(home, ".oats-start-pending.json"), JSON.stringify({ id: "a1", target, command: "x", model: null, startedAt: new Date().toISOString() }));
  await fx.inEnv(() => assert.throws(() => startInstanceSession(home), (e) => e.code === "E_HERDR_REMOVED" && e.message === instance("herdr-pending")));
});

test("status lists a Herdr home as unsupported, with the refusal, and still exits 0", async () => {
  const { home, target } = await herdrHome("herdr-status");
  await herdrHome("herdr-status-never", { launched: false });
  const r = fx.cli(["status", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rows = JSON.parse(r.stdout).agents.flatMap((a) => a.instances);
  const row = rows.find((i) => i.instance === "herdr-status");
  assert.equal(row.home, home);
  assert.equal(row.running, null);
  assert.equal(row.runtimeState, "unsupported");
  assert.equal(row.runtimeError, `E_HERDR_REMOVED: ${instance("herdr-status")}`);
  assert.deepEqual(row.sessionTarget, target, "the recorded target is reported as recorded");
  const never = rows.find((i) => i.instance === "herdr-status-never");
  assert.equal(never.running, null);
  assert.equal(never.runtimeState, "unsupported");
});

test("retire of a Herdr home with no process in it proceeds without Herdr and removes the home", async () => {
  for (const opts of [{}, { launched: false }, { receiptOnly: true }]) {
    const { home, name } = await herdrHome(`herdr-retire-${Object.keys(opts)[0] || "launched"}`.toLowerCase(), opts);
    const r = await fx.inEnv(() => retireInstance(fx.root, name));
    assert.equal(r.retired, name);
    assert.equal(existsSync(home), false, `${name} was removed`);
  }
});

test("retire of a Herdr home that a process still works in refuses and names the pid", async () => {
  const { home, name } = await herdrHome("herdr-busy");
  const child = spawnProcess("sleep", ["30"], { cwd: home, stdio: "ignore" });
  try {
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    // Through the CLI: the scan never counts the retiring process's own children, and this sleep is not one.
    const r = fx.cli(["retire", name, "--json"]);
    assert.equal(r.status, 1);
    assert.deepEqual(JSON.parse(r.stdout).error, { code: "E_HERDR_REMOVED",
      message: `${STEM} ${name} was opened in Herdr. A process still works in this home (pid ${child.pid}); stop its Herdr pane (for example \`herdr --session oats server stop\`), then retire.` });
    assert.equal(existsSync(home), true, "nothing was removed");
  } finally { child.kill(); }
  await new Promise((resolve) => child.once("exit", resolve));
  const r = await fx.inEnv(() => retireInstance(fx.root, name));
  assert.equal(r.retired, name);
  assert.equal(existsSync(home), false);
});

test("a self-retire of a Herdr home is deferred, and its completion takes the process scan", async () => {
  const { home, name } = await herdrHome("herdr-self");
  const r = await fx.inEnv(() => retireInstance(fx.root, name, { self: true, keepDir: true, selfKillDelaySec: 0 }));
  assert.equal(r.deferred, true, "a Herdr home is never retired in-process");
  const deadline = Date.now() + 20000;
  while (existsSync(r.pendingMarker) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(existsSync(r.pendingMarker), false, `the deferred retirement completed: ${existsSync(r.resultPath) ? readFileSync(r.resultPath, "utf8") : "no failure recorded"}`);
  assert.equal(existsSync(r.resultPath), false, "no failure was recorded");
  assert.equal(existsSync(home), true, "--keep-dir keeps the home");
});
