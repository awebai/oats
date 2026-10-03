import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scheduleUrl = new URL("../lib/schedule.mjs", import.meta.url).href;
const timeoutMs = 400, graceMs = 100, watchdogMs = 4000;

// A detached test runner gives the watchdog a process group it can safely kill
// even against the regression: spawnSync's timeout waits forever for a child
// which ignores SIGTERM. The scheduled child may own a separate group after
// the fix, so record its descendants and clean those up explicitly as well.
function kill(pid, group = false) {
  try { process.kill(group ? -pid : pid, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
}
function running(pid) {
  try { process.kill(pid, 0); } catch (e) { if (e.code === "ESRCH") return false; throw e; }
  // An orphan can await reaping in a container; zombies cannot execute work.
  try { return !/^Z/.test(execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim()); }
  catch { return false; }
}
function recordedPid(dir, name) {
  const file = join(dir, `${name}.pid`);
  return existsSync(file) ? Number(readFileSync(file, "utf8")) : null;
}

async function scenario(kind) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-schedule-timeout-")));
  const childFile = join(dir, "child.mjs"), runnerFile = join(dir, "runner.mjs");
  writeFileSync(childFile, `
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
const dir = ${JSON.stringify(dir)};
const name = process.argv.includes('--grandchild') ? 'grandchild' : 'child';
process.on('SIGTERM', () => appendFileSync(dir + '/' + name + '.term', 'TERM\\n'));
writeFileSync(dir + '/' + name + '.pid', String(process.pid));
if (name === 'child') spawn(process.execPath, [${JSON.stringify(childFile)}, '--grandchild'], { stdio: 'inherit' });
setInterval(() => {}, 1000);
`);
  writeFileSync(runnerFile, `
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
process.env.OATS_HOME_DIR = ${JSON.stringify(join(dir, "oats-home"))};
delete process.env.OATS_INSTANCE; delete process.env.OATS_INSTANCE_HOME; delete process.env.PI_AGENTS_ROOT;
const S = await import(${JSON.stringify(scheduleUrl)});
const ws = ${JSON.stringify(join(dir, "workspace"))};
const home = join(ws, 'agents', 'dev', 'instances', 'dev-source');
mkdirSync(home, { recursive: true });
mkdirSync(join(ws, 'agents', 'dev', 'soul'), { recursive: true });
writeFileSync(join(ws, 'agents', 'dev', 'soul', 'soul.yaml'), 'name: dev\\nwork: worktree\\nharness: codex\\n');
writeFileSync(join(ws, 'agents', 'dev', 'soul', 'AGENTS.md'), '# Test soul\\n');
writeFileSync(join(home, 'instance.json'), JSON.stringify({ instance: 'dev-source', home, agent: 'dev' }));
writeFileSync(join(ws, 'oats-local.yaml'), 'schemaVersion: 2\\nworkspace: example.invalid/acme/workspace\\n');
const kind = ${JSON.stringify(kind)};
const definition = kind === 'command' ? { kind, cwd: home, argv: ['oats', 'status'] }
  : kind === 'operation' ? { kind, home, operation: 'knowledge:harvest' }
  : { kind: 'spawn', agent: 'dev', task: 'A local test, never a real launch.' };
S.addSchedule(ws, { id: 'blocked', cron: '* * * * *', tz: 'UTC', ...definition });
S.addSchedule(ws, { id: 'next', cron: '* * * * *', tz: 'UTC', kind: 'command', cwd: home, argv: ['oats', 'status'] });
S.writeRegistry({ ...S.readRegistry(), maxConcurrent: 1 });
const io = { oatsBin: ${JSON.stringify(childFile)}, commandTimeoutMs: ${timeoutMs}, commandGraceMs: ${graceMs} };
const now = new Date('2026-10-03T10:00:00Z');
const started = Date.now();
if (kind === 'preview') {
  const result = S.testSchedule(ws, 'blocked', io, { now });
  assert.equal(result.ok, false);
  assert.equal(result.soul.resolves, false);
  assert.equal(result.spawned, false);
  assert.equal(S.readState(ws).jobs.blocked?.attempt, undefined);
  assert.equal(S.jobLockInfo(ws, 'blocked'), null);
} else {
  const result = S.runNow(ws, 'blocked', { now, io });
  assert.equal(result.run.outcome, 'unknown');
  assert.match(result.run.error, /timed out/);
  const attempt = S.readState(ws).jobs.blocked.attempt;
  assert.ok(attempt, 'uncertain effects still need reconcile');
  assert.match(attempt.error, /timed out/);
  if (kind === 'spawn') {
    assert.ok(S.jobLockInfo(ws, 'blocked'), 'spawn effects keep their host slot');
    assert.notEqual(attempt.exited, true, 'spawn semantics do not gain command exit evidence');
    assert.throws(() => S.runNow(ws, 'next', { now, io }), { code: 'E_SCHEDULER_BUSY' });
  } else {
    assert.equal(attempt.exited, true, 'release requires observed direct-child exit');
    assert.equal(attempt.exitStatus, null);
    assert.equal(attempt.exitSignal, 'SIGKILL');
    assert.equal(S.jobLockInfo(ws, 'blocked'), null);
    let calls = 0;
    const next = S.runNow(ws, 'next', { now, io: { command: () => { calls++; return { ok: true, result: {} }; } } });
    assert.equal(next.run.outcome, 'launched');
    assert.equal(calls, 1, 'another job can use the freed slot');
  }
  assert.throws(() => S.runNow(ws, 'blocked', { now, io }), { code: 'E_SCHEDULE_UNRESOLVED' });
  const nextMinute = S.tickWorkspace(ws, { now: new Date('2026-10-03T10:01:00Z'), io, reg: S.readRegistry(), candidates: ['blocked'] });
  assert.equal(nextMinute[0].action, 'skipped');
  assert.match(nextMinute[0].reason, /reconcile/);
  assert.match(S.readState(ws).jobs.blocked.attempt.error, /timed out/, 'original timeout survives later ticks');
}
assert.equal(S.withHostLock(() => true), true, 'the host lock is released for the next scheduler/lifecycle command');
process.stdout.write(JSON.stringify({ elapsedMs: Date.now() - started }));
`);
  const runner = spawn(process.execPath, [runnerFile], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", expired = false;
  runner.stdout.on("data", (data) => { stdout += data; });
  runner.stderr.on("data", (data) => { stderr += data; });
  const timer = setTimeout(() => { expired = true; kill(runner.pid, true); }, watchdogMs);
  try {
    const code = await new Promise((resolve, reject) => { runner.once("error", reject); runner.once("close", resolve); });
    assert.equal(expired, false, `${kind}: scheduler exceeded ${watchdogMs}ms watchdog despite ${timeoutMs}ms timeout + ${graceMs}ms grace`);
    assert.equal(code, 0, `${kind}: ${stderr}`);
    assert.ok(JSON.parse(stdout).elapsedMs < 2500, 'deadline and short grace bound synchronous scheduler return');
    for (const name of ["child", "grandchild"]) {
      const pid = recordedPid(dir, name);
      assert.ok(pid, `${name} started before the deadline`);
      assert.equal(running(pid), false, `${name} must not continue after timeout returns`);
      assert.match(readFileSync(join(dir, `${name}.term`), "utf8"), /TERM/, `${name} received graceful termination before escalation`);
    }
  } finally {
    clearTimeout(timer);
    kill(runner.pid, true);
    for (const name of ["child", "grandchild"]) {
      const pid = recordedPid(dir, name);
      if (pid) { kill(pid, true); kill(pid); }
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const kind of ["command", "operation", "spawn", "preview"]) {
  test(`${kind} scheduler child ignoring SIGTERM is bounded and its descendants stop`, { skip: process.platform === "win32" }, () => scenario(kind));
}
