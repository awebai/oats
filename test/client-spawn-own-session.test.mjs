// A spawn apply runs in a session of its own (packages/client/spawn-apply-cli.mjs `cliSpawnApply`, #855 B),
// as a lifecycle apply and a start do (client-own-session.test.mjs): a Ctrl-C in the terminal that started a
// client, or a hang-up when it closes, goes to every process of the client's group, and a spawn that receives
// it while its worktree hooks run is interrupted. Unlike those, a spawn keeps its deadline: the confirmed
// preview implies it (spawnApplyDeadlineMs), and its SIGTERM still reaches the child, which alone it signals.
// Real processes: a caller, in a process group of its own, starts a fixture CLI through cliSpawnApply with its
// own default exec; the test then sends a SIGINT, or a SIGHUP, to the caller's live group. The fixture records
// any signal it receives, then exits.
//
// A child in its own session is outside every group a test reaper kills, so each fixture is reaped here by
// its exact pid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliSpawnApply } from '../packages/client/spawn-apply-cli.mjs';
import { cli as capturedCli, kernel } from '../packages/desktop/test/helpers/spawn-preview-fixture.mjs';

const CLIENT = new URL('../packages/client/', import.meta.url).href;

/** A pid that is running: signal 0 reaches it and (on Linux) it is not a zombie awaiting its reaper. */
function alive(pid) {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return true; }
}
async function until(probe, ms) {
  for (const end = Date.now() + ms; ;) {
    if (probe()) return true;
    if (Date.now() > end) return false;
    await new Promise(ok => setTimeout(ok, 20));
  }
}

/** The fixture CLI, a confirmed apply of it, and the caller, in a directory removed after the test, with every pid reaped. */
function setup(t, { worktreeEvent = false, answerTerm = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'oats-spawn-own-session-'));
  const pids = new Set();
  t.after(() => {
    for (const pid of pids) if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    rmSync(dir, { recursive: true, force: true });
  });
  const bin = join(dir, 'oats'), at = name => join(dir, `apply.${name}`);
  // The signal handlers come first, so a deadline never meets a fixture without them. It records its pid and
  // process group, and any signal it receives; then it exits with no envelope, as an interrupted command can,
  // or, given `answerTerm`, prints that envelope and exits 0.
  const answer = answerTerm ? `process.stdout.write(${JSON.stringify(JSON.stringify(answerTerm))}, () => process.exit(0))` : 'process.exit(1)';
  writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs');
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { fs.appendFileSync(${JSON.stringify(at('signals'))}, signal + '\\n'); ${answer}; });
const pgid = Number(require('node:child_process').execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim());
fs.writeFileSync(${JSON.stringify(at('json'))}, JSON.stringify({ pid: process.pid, pgid }));
setInterval(() => {}, 1000);
`);
  chmodSync(bin, 0o755);
  const cli = { ...structuredClone(capturedCli), bin, features: [...capturedCli.features.filter(f => f !== 'worktree-event'), ...(worktreeEvent ? ['worktree-event'] : [])] };
  // The decision the captured apply bound, for a soul of this directory.
  const options = { target: { workspace: 'northwind', context: dir, selector: { soul: 'release-manager', agentsRoot: join(dir, 'agents') } },
    choices: {}, task: 'a task', decision: kernel('preview-worktree-purpose').result.decision, key: 'a'.repeat(64) };
  const caller = join(dir, 'caller.mjs');
  writeFileSync(caller, `
import { cliSpawnApply } from ${JSON.stringify(`${CLIENT}spawn-apply-cli.mjs`)};
const { cli, options } = JSON.parse(process.argv[2]);
cliSpawnApply(cli, options); // its own default exec, and its 60 s deadline
setInterval(() => {}, 1000);
`);
  const record = () => existsSync(at('json')) ? JSON.parse(readFileSync(at('json'), 'utf8')) : null;
  const signals = () => existsSync(at('signals')) ? readFileSync(at('signals'), 'utf8').trim().split('\n') : [];
  /** The caller, as the leader of a process group of its own: the group a terminal signals. */
  function start() {
    const child = spawn(process.execPath, [caller, JSON.stringify({ cli, options })], { detached: true, stdio: ['ignore', 'ignore', 'inherit'] });
    pids.add(child.pid);
    const exited = new Promise(ok => child.on('exit', ok));
    return { pid: child.pid, exited };
  }
  async function running() {
    assert.ok(await until(() => record(), 10_000), 'premise: the fixture ran');
    pids.add(record().pid);
    return record();
  }
  return { cli, options, start, running, signals, ready: () => record() !== null };
}

for (const signal of ['SIGINT', 'SIGHUP']) test(`a spawn apply runs in a session of its own: a ${signal} to the client's group does not reach it`, { skip: process.platform === 'win32' }, async t => {
  const s = setup(t), caller = s.start();
  const { pid, pgid } = await s.running();
  assert.equal(pgid, pid, 'the leader of its own group'); assert.notEqual(pgid, caller.pid, 'not in the caller\'s group');
  process.kill(-caller.pid, signal); // the caller's group is live: the send must succeed
  await caller.exited;
  await new Promise(ok => setTimeout(ok, 300));
  assert.deepEqual(s.signals(), [], 'no signal reached it');
  assert.equal(alive(pid), true, 'alive by exact pid after its client has gone');
});

test('its deadline still ends it: an older kernel\'s apply by execFileInSession\'s own SIGTERM, E_CLI_TIMEOUT', { skip: process.platform === 'win32' }, async t => {
  const s = setup(t);
  // The exec's own timer, which no test seam gates: long enough for the fixture to set its handlers first.
  const answer = await cliSpawnApply(s.cli, s.options, { timeoutMs: 2000 });
  const { pid, pgid } = await s.running();
  assert.equal(pgid, pid, 'in a session of its own');
  assert.equal(answer.started, true); assert.equal(answer.envelope.error.code, 'E_CLI_TIMEOUT');
  assert.deepEqual(s.signals(), ['SIGTERM'], 'the deadline\'s SIGTERM reached it');
  assert.ok(await until(() => !alive(pid), 5000), 'and it ended');
});

test('an older kernel\'s apply its timeout killed is never a success, even when it then prints one and exits 0: E_CLI_TIMEOUT', { skip: process.platform === 'win32' }, async t => {
  const s = setup(t, { answerTerm: kernel('apply-bound') });
  const answer = await cliSpawnApply(s.cli, s.options, { timeoutMs: 2000 });
  const { pid } = await s.running();
  assert.deepEqual(s.signals(), ['SIGTERM'], 'premise: the timeout\'s SIGTERM reached it, and it answered');
  assert.equal(answer.started, true); assert.equal(answer.envelope.ok, false); assert.equal(answer.envelope.error.code, 'E_CLI_TIMEOUT');
  assert.ok(await until(() => !alive(pid), 5000), 'and it ended');
});

test('its deadline still ends it: a worktree-event kernel\'s apply by the boundary\'s own SIGTERM, E_CLI_TIMEOUT without an envelope', { skip: process.platform === 'win32' }, async t => {
  const s = setup(t, { worktreeEvent: true });
  // The deadline fires only once the fixture has its handlers (it wrote its record): never a race with its start.
  const timer = (fn, ms) => { let stop = false; const tick = () => { if (stop) return; if (s.ready()) setTimeout(() => { if (!stop) fn(); }, ms); else setTimeout(tick, 10); }; tick(); return () => { stop = true; }; };
  const answer = await cliSpawnApply(s.cli, s.options, { timer, timeoutMs: 50, graceMs: 5000 });
  const { pid, pgid } = await s.running();
  assert.equal(pgid, pid, 'in a session of its own');
  assert.equal(answer.started, true); assert.equal(answer.envelope.error.code, 'E_CLI_TIMEOUT');
  assert.deepEqual(s.signals(), ['SIGTERM'], 'the deadline\'s SIGTERM reached it, before any SIGKILL');
  assert.ok(await until(() => !alive(pid), 5000), 'and it ended');
});
