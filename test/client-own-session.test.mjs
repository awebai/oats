// A change runs in a session of its own (packages/client/lifecycle-cli.mjs `cliLifecycle` for an apply,
// cli-adapter.mjs `cliStart`): a Ctrl-C in the terminal that started a client, or a hang-up when it
// closes, goes to every process of the client's group, and a stop apply that receives it can strand the
// instance (#889; a kernel before 0.52.0). Real processes: a caller, in a process group of its own,
// starts a fixture CLI through each of the two callers; the test then sends a SIGINT and a SIGHUP to the
// caller's group. The fixture records any signal it receives, then exits.
//
// A child in its own session is outside every group a test reaper kills, so each fixture is reaped
// here by its exact pid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/** The fixture CLI and the caller, in a directory removed after the test, with every pid reaped. */
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'oats-own-session-'));
  const pids = new Set();
  t.after(() => {
    for (const pid of pids) if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    rmSync(dir, { recursive: true, force: true });
  });
  const cli = join(dir, 'oats');
  // Which call ran it: a plan read, a stop apply or a start. It records its pid and process group, and any
  // signal it receives (then it exits, as a command that is interrupted does).
  writeFileSync(cli, `#!${process.execPath}
const fs = require('node:fs'), { execFileSync } = require('node:child_process');
const argv = process.argv.slice(2), kind = argv.includes('--plan') ? 'plan' : argv[0] === 'session' ? 'start' : 'apply';
const at = name => ${JSON.stringify(dir)} + '/' + kind + '.' + name;
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { fs.appendFileSync(at('signals'), signal + '\\n'); process.exit(1); });
const pgid = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim());
fs.writeFileSync(at('json'), JSON.stringify({ pid: process.pid, pgid }));
setInterval(() => {}, 1000);
`);
  chmodSync(cli, 0o755);
  const caller = join(dir, 'caller.mjs');
  writeFileSync(caller, `
import { execFile } from 'node:child_process';
import { cliLifecycle } from ${JSON.stringify(`${CLIENT}lifecycle-cli.mjs`)};
import { cliStart } from ${JSON.stringify(`${CLIENT}cli-adapter.mjs`)};
const [mode, cli, dir] = process.argv.slice(2);
const stop = { operation: 'stop', instance: 'dev-1', home: '/team/agents/dev/instances/dev-1', context: dir, choices: { recursive: true } };
// A client's own exec that drops the option: what the exec hook's rule forbids.
const dropped = (bin, argv, { detached, ...options }, done) => execFile(bin, argv, options, done);
if (mode === 'plan') cliLifecycle(cli, { ...stop, phase: 'plan' }, { timeout: 500 }).then(r => { process.stdout.write(JSON.stringify(r)); });
else {
  const exec = mode === 'dropped' ? dropped : undefined;
  cliLifecycle(cli, { ...stop, phase: 'apply', revision: 'a'.repeat(24), key: 'k1' }, { exec });
  cliStart(cli, { home: '/team/agents/dev/instances/dev-1', workspaceDir: dir }, { exec });
  setInterval(() => {}, 1000);
}
`);
  const record = kind => existsSync(join(dir, `${kind}.json`)) ? JSON.parse(readFileSync(join(dir, `${kind}.json`), 'utf8')) : null;
  const signals = kind => existsSync(join(dir, `${kind}.signals`)) ? readFileSync(join(dir, `${kind}.signals`), 'utf8').trim().split('\n') : [];
  /** The caller, as the leader of a process group of its own: the group a terminal signals. */
  function start(mode) {
    const child = spawn(process.execPath, [caller, mode, cli, dir], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
    pids.add(child.pid);
    let out = ''; child.stdout.on('data', d => { out += d; });
    const exited = new Promise(ok => child.on('exit', () => ok(out)));
    return { pid: child.pid, exited };
  }
  async function running(kinds) {
    assert.ok(await until(() => kinds.every(k => record(k)), 10_000), `premise: the fixture ran for ${kinds.join(' and ')}`);
    for (const k of kinds) pids.add(record(k).pid);
    return Object.fromEntries(kinds.map(k => [k, record(k)]));
  }
  return { start, running, signals };
}
/** A Ctrl-C, then a hang-up, to the caller's whole process group, as a terminal sends them. */
async function interrupt(caller) {
  for (const signal of ['SIGINT', 'SIGHUP']) {
    try { process.kill(-caller.pid, signal); } catch { /* the group is already empty */ }
    await new Promise(ok => setTimeout(ok, 150));
  }
  await caller.exited;
}

test('a stop apply and a start run in a session of their own: a SIGINT and a SIGHUP to the client\'s group reach neither', { skip: process.platform === 'win32' }, async t => {
  const s = setup(t), caller = s.start('session');
  const children = await s.running(['apply', 'start']);
  for (const [kind, { pid, pgid }] of Object.entries(children)) {
    assert.equal(pgid, pid, `${kind}: the leader of its own group`); assert.notEqual(pgid, caller.pid, `${kind}: not in the caller's group`);
  }
  await interrupt(caller);
  await new Promise(ok => setTimeout(ok, 300));
  for (const [kind, { pid }] of Object.entries(children)) {
    assert.deepEqual(s.signals(kind), [], `${kind}: no signal reached it`);
    assert.equal(alive(pid), true, `${kind}: alive by exact pid after its client has gone`);
  }
});

test('a client exec that drops `detached` leaves the child in the client\'s group, and the signal reaches it', { skip: process.platform === 'win32' }, async t => {
  const s = setup(t), caller = s.start('dropped');
  const children = await s.running(['apply', 'start']);
  for (const [kind, { pgid }] of Object.entries(children)) assert.equal(pgid, caller.pid, `${kind}: in the caller's group`);
  await interrupt(caller);
  for (const kind of Object.keys(children)) {
    assert.ok(await until(() => s.signals(kind).length > 0, 5000), `${kind}: the group's signal reached it`);
    assert.equal(s.signals(kind)[0], 'SIGINT', kind);
  }
});

test('a plan read is not changed: it runs in the caller\'s group and its deadline ends it', { skip: process.platform === 'win32' }, async t => {
  const s = setup(t), caller = s.start('plan');
  const { plan } = await s.running(['plan']);
  assert.equal(plan.pgid, caller.pid, 'in the caller\'s group');
  const answer = JSON.parse(await caller.exited);
  assert.equal(answer.error.code, 'E_CLI_TIMEOUT');
  assert.deepEqual(s.signals('plan'), ['SIGTERM'], 'ended by its deadline');
});
