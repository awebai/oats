import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const scheduleUrl = new URL("../lib/schedule.mjs", import.meta.url).href;
const watchdogMs = 6000;
function kill(pid, group = false) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try { process.kill(group ? -pid : pid, "SIGKILL"); }
  catch (e) { if (e.code !== "ESRCH") throw e; }
}
function running(pid) {
  try { process.kill(pid, 0); }
  catch (e) { if (e.code === "ESRCH") return false; throw e; }
  try { return !/^Z/.test(execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim()); }
  catch { return false; }
}
function recordedProcesses(dir) {
  const path = join(dir, "processes.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

async function scenario(kind, interruption) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-supervisor-receipt-")));
  const childFile = join(dir, "child.mjs"), runnerFile = join(dir, "runner.mjs");
  // This is the real oatsBin subprocess boundary. No fabricated command
  // result, status, signal or receipt is supplied to the scheduler.
  writeFileSync(childFile, `
import { appendFileSync, writeFileSync } from "node:fs";
const dir = ${JSON.stringify(dir)};
if (process.argv.includes("--fixture-next")) {
  appendFileSync(dir + "/next.calls", "next\\n");
  console.log(JSON.stringify({ ok: true, result: {} }));
  process.exit(0);
}
writeFileSync(dir + "/processes.json", JSON.stringify({ child: process.pid, supervisor: process.ppid }));
process.on("SIGTERM", () => {
  writeFileSync(dir + "/child.term", "observed TERM\\n");
  process.exit(0);
});
setInterval(() => {}, 1000);
// A complete success envelope must not override a subsequent interruption.
process.stdout.write(JSON.stringify({ ok: true, result: { instance: "dev-receipt", home: dir + "/receipt-home", launched: true } }) + "\\n", () => {
  setTimeout(() => process.kill(process.ppid, ${JSON.stringify(interruption)}), 50);
});
`);
  writeFileSync(runnerFile, `
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
process.env.OATS_HOME_DIR = ${JSON.stringify(join(dir, "oats-home"))};
delete process.env.OATS_INSTANCE; delete process.env.OATS_INSTANCE_HOME; delete process.env.PI_AGENTS_ROOT;
const S = await import(${JSON.stringify(scheduleUrl)});
const ws = ${JSON.stringify(join(dir, "workspace"))};
const home = join(ws, "agents", "dev", "instances", "dev-source");
mkdirSync(home, { recursive: true });
mkdirSync(join(ws, "agents", "dev", "soul"), { recursive: true });
writeFileSync(join(ws, "agents", "dev", "soul", "soul.yaml"), "name: dev\\nwork: worktree\\nharness: codex\\n");
writeFileSync(join(ws, "agents", "dev", "soul", "AGENTS.md"), "# Fixture soul\\n");
writeFileSync(join(home, "instance.json"), JSON.stringify({ instance: "dev-source", home, agent: "dev" }));
writeFileSync(join(ws, "oats-local.yaml"), "schemaVersion: 2\\nworkspace: example.invalid/acme/workspace\\n");
const kind = ${JSON.stringify(kind)}, interruption = ${JSON.stringify(interruption)};
const definition = kind === "command" ? { kind, cwd: home, argv: ["oats", "status"] }
  : kind === "operation" ? { kind, home, operation: "knowledge:harvest" }
  : { kind: "spawn", agent: "dev", task: "Local isolated fixture, never a real launch." };
S.addSchedule(ws, { id: "uncertain", cron: "* * * * *", tz: "UTC", ...definition });
S.addSchedule(ws, { id: "next", cron: "* * * * *", tz: "UTC", kind: "command", cwd: home, argv: ["oats", "status", "--fixture-next"] });
S.writeRegistry({ ...S.readRegistry(), maxConcurrent: 1 });
const io = { oatsBin: ${JSON.stringify(childFile)}, commandTimeoutMs: 3000, commandGraceMs: 100 };
const now = new Date("2026-10-04T10:00:00Z"), started = Date.now();
if (kind === "preview") {
  const result = S.testSchedule(ws, "uncertain", io, { now });
  assert.equal(result.ok, false, "interrupted preview is not successful even after valid stdout");
  assert.equal(result.soul.resolves, false);
  assert.equal(result.spawned, false);
  assert.equal(S.readState(ws).jobs.uncertain?.attempt, undefined);
  assert.equal(S.jobLockInfo(ws, "uncertain"), null);
} else {
const result = S.runNow(ws, "uncertain", { now, io });
assert.equal(result.run.outcome, "unknown", "success stdout is not confirmation after supervisor interruption");
const attempt = S.readState(ws).jobs.uncertain.attempt;
assert.ok(attempt, "uncertain side effects require reconcile");
assert.throws(() => S.runNow(ws, "uncertain", { now, io }), { code: "E_SCHEDULE_UNRESOLVED" });
if (interruption === "SIGKILL" || kind === "spawn") {
  assert.notEqual(attempt.exited, true, "absent receipt and spawn effects cannot gain command exit evidence");
  assert.equal(Object.hasOwn(attempt, "exitStatus"), false);
  assert.equal(Object.hasOwn(attempt, "exitSignal"), false);
  assert.ok(S.jobLockInfo(ws, "uncertain"), "without applicable exit evidence the host slot stays occupied");
  assert.throws(() => S.runNow(ws, "next", { now, io }), { code: "E_SCHEDULER_BUSY" });
  assert.equal(existsSync(${JSON.stringify(join(dir, "next.calls"))}), false);
} else {
  assert.equal(attempt.exited, true, "catchable interruption must return observed direct-child exit evidence");
  assert.equal(attempt.exitStatus, 0, "cooperative cleanup's zero exit is observed but never becomes success");
  assert.equal(attempt.exitSignal, null);
  assert.equal(S.jobLockInfo(ws, "uncertain"), null);
  assert.equal(S.runNow(ws, "next", { now, io }).run.outcome, "launched", "another job can use the freed slot through the real runner");
  assert.equal(readFileSync(${JSON.stringify(join(dir, "next.calls"))}, "utf8"), "next\\n");
}
}
assert.equal(S.withHostLock(() => true), true, "the outer host lock is released");
process.stdout.write(JSON.stringify({ elapsedMs: Date.now() - started }));
`);
  const runner = spawn(process.execPath, [runnerFile], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", expired = false;
  runner.stdout.on("data", (data) => { stdout += data; });
  runner.stderr.on("data", (data) => { stderr += data; });
  const timer = setTimeout(() => { expired = true; kill(runner.pid, true); }, watchdogMs);
  try {
    const code = await new Promise((resolve, reject) => { runner.once("error", reject); runner.once("close", resolve); });
    assert.equal(expired, false, `${kind}/${interruption}: isolated runner exceeded watchdog`);
    assert.equal(code, 0, `${kind}/${interruption}: ${stderr}`);
    assert.ok(JSON.parse(stdout).elapsedMs < 2500, "interruption settles before the unrelated command deadline");
    const recorded = recordedProcesses(dir);
    assert.ok(recorded?.child && recorded?.supervisor, "actual supervised child recorded both owned PIDs");
    assert.equal(running(recorded.supervisor), false, "supervisor has settled");
    if (interruption === "SIGKILL") {
      assert.equal(running(recorded.child), true, "SIGKILL has no JavaScript cleanup guarantee; fixture proves an escaped child can remain");
      assert.equal(existsSync(join(dir, "child.term")), false);
    } else {
      assert.equal(running(recorded.child), false, "catchable interruption must stop the owned child");
      assert.equal(readFileSync(join(dir, "child.term"), "utf8"), "observed TERM\n");
    }
  } finally {
    clearTimeout(timer);
    kill(runner.pid, true);
    const recorded = recordedProcesses(dir);
    if (recorded) {
      // SIGKILL/OOM cannot run supervisor cleanup. This fixture owns and kills
      // that deliberately escaped child itself, including on assertion failure.
      kill(recorded.child, true); kill(recorded.child); kill(recorded.supervisor);
      const deadline = Date.now() + 2000;
      while ((running(recorded.child) || running(recorded.supervisor)) && Date.now() < deadline) await delay(20);
      assert.equal(running(recorded.child), false, "fixture cleanup left no running child");
      assert.equal(running(recorded.supervisor), false, "fixture cleanup left no running supervisor");
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const kind of ["command", "operation"]) {
  test(`${kind} retains its attempt and slot when the actual supervisor dies without a receipt`, { skip: process.platform === "win32" }, () => scenario(kind, "SIGKILL"));
}
for (const kind of ["command", "operation", "spawn", "preview"]) {
  test(`${kind} success envelope stays unknown after catchable supervisor interruption and zero-exit cleanup`, { skip: process.platform === "win32" }, () => scenario(kind, "SIGTERM"));
}
