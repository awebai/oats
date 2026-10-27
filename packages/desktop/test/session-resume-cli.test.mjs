// The sweep's runner (packages/client/session-resume-cli.mjs): the gate (a compatible CLI and the
// `session-resume` feature, or nothing runs), the one call it makes (argv, cwd '/', the environment cleaned,
// no timeout), and every answer it resolves: the kernel's envelope, the kernel's refusal at any exit, or a code
// of its own with no stderr and no thrown text. The default exec (files, detached) runs a stand-in kernel once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runResumeSweep, resumeSupported, SESSION_RESUME_FEATURE, SESSION_RESUME_MAX_BUFFER } from '../../client/session-resume-cli.mjs';
import { INSTANCE_VARIABLES } from '../../client/kernel-environment.mjs';
import { madeByKernel } from '../../client/kernel-made.mjs';

const cli = { ok: true, bin: '/opt/oats/bin/oats', features: ['deployments-list', SESSION_RESUME_FEATURE] };
const SWEPT = { schemaVersion: 1, ok: true, result: { schemaVersion: 1, plan: false, deployments: [{ deployment: '/d/acme', state: 'ok', swept: true }], rows: [] } };
const BUSY = { schemaVersion: 1, ok: false, error: { code: 'E_RESUME_BUSY', message: 'Another sweep is running.' } };
const SECRET = 'stderr-or-thrown-SECRET';

/** An exec that answers `(error, stdout, stderr)` and records each call. */
function answering(error, stdout, stderr = SECRET) {
  const calls = [];
  const exec = (bin, argv, options, callback) => { calls.push({ bin, argv, options }); setImmediate(() => callback(error, stdout, stderr)); return {}; };
  return { exec, calls };
}
const exitWith = (code, signal = null) => Object.assign(new Error(`Command failed\n${SECRET}`), { code, signal, killed: false });
const own = (code) => ({ schemaVersion: 1, ok: false, error: { code } });

test('resumeSupported: a compatible CLI (ok, absolute bin) that declares the feature', () => {
  assert.equal(SESSION_RESUME_FEATURE, 'session-resume');
  assert.equal(SESSION_RESUME_MAX_BUFFER, 4 * 1024 * 1024);
  assert.equal(resumeSupported(cli), true);
  for (const probe of [null, undefined, {}, { ...cli, ok: false }, { ...cli, ok: 'true' }, { ...cli, bin: 'oats' }, { ...cli, bin: undefined },
    { ...cli, features: [] }, { ...cli, features: undefined }, { ...cli, features: SESSION_RESUME_FEATURE }, { ...cli, features: [`${SESSION_RESUME_FEATURE}-plan`] }]) {
    assert.equal(resumeSupported(probe), false, JSON.stringify(probe));
  }
});

test('without a compatible CLI, or without the feature, nothing runs and nothing falls back', async () => {
  for (const probe of [null, undefined, {}, { ...cli, ok: false }, { ...cli, bin: 'relative/oats' }, { ...cli, bin: 7 }]) {
    const { exec, calls } = answering(null, JSON.stringify(SWEPT));
    assert.deepEqual(await runResumeSweep(probe, { exec }), own('E_CLI_UNAVAILABLE'));
    assert.equal(calls.length, 0);
  }
  for (const features of [undefined, [], ['deployments-list'], SESSION_RESUME_FEATURE]) {
    const { exec, calls } = answering(null, JSON.stringify(SWEPT));
    assert.deepEqual(await runResumeSweep({ ...cli, features }, { exec }), own('E_RESUME_FEATURE'));
    assert.equal(calls.length, 0);
  }
});

test('the call: argv session resume --json, cwd /, the instance variables scrubbed, OATS_HOME_DIR kept, no timeout', async () => {
  const env = { PATH: '/usr/bin', HOME: '/home/someone', OATS_HOME_DIR: '/scratch/oats-home', ELECTRON_RUN_AS_NODE: '1', CHROME_DESKTOP: 'x.desktop' };
  for (const name of INSTANCE_VARIABLES) env[name] = `/inside/${name}`;
  const given = structuredClone(env);
  const { exec, calls } = answering(null, JSON.stringify(SWEPT));
  await runResumeSweep(cli, { exec, env });
  assert.equal(calls.length, 1);
  const [{ bin, argv, options }] = calls;
  assert.equal(bin, cli.bin);
  assert.deepEqual(argv, ['session', 'resume', '--json']);
  assert.deepEqual(Object.keys(options).sort(), ['cwd', 'encoding', 'env', 'maxBuffer', 'shell']);
  assert.equal('timeout' in options, false, 'no client-side deadline');
  assert.deepEqual({ ...options, env: undefined }, { cwd: '/', env: undefined, shell: false, encoding: 'utf8', maxBuffer: SESSION_RESUME_MAX_BUFFER });
  assert.deepEqual(options.env, { PATH: '/usr/bin', HOME: '/home/someone', OATS_HOME_DIR: '/scratch/oats-home' });
  assert.deepEqual(env, given, 'the caller\'s environment is not changed');
  // Without io.env, process.env is the one cleaned.
  const before = process.env.OATS_INSTANCE_HOME;
  process.env.OATS_INSTANCE_HOME = '/inside/home';
  try {
    const plain = answering(null, JSON.stringify(SWEPT));
    await runResumeSweep(cli, { exec: plain.exec });
    assert.equal('OATS_INSTANCE_HOME' in plain.calls[0].options.env, false);
    assert.equal(plain.calls[0].options.env.PATH, process.env.PATH);
  } finally { if (before === undefined) delete process.env.OATS_INSTANCE_HOME; else process.env.OATS_INSTANCE_HOME = before; }
});

test('exit 0 with the sweep\'s envelope resolves that envelope', async () => {
  const { exec } = answering(null, JSON.stringify(SWEPT));
  assert.deepEqual(await runResumeSweep(cli, { exec }), SWEPT);
});

test('the kernel\'s refusal resolves as itself at exit 1 (E_RESUME_BUSY) or any exit, as its code and message only', async () => {
  for (const error of [exitWith(1), null, exitWith(2)]) {
    const { exec } = answering(error, JSON.stringify(BUSY));
    const answer = await runResumeSweep(cli, { exec });
    assert.deepEqual(answer, BUSY);
    assert.equal(madeByKernel(answer.error), true, 'the message is the kernel\'s prose, marked so');
  }
  const extra = answering(exitWith(1), JSON.stringify({ ...BUSY, error: { ...BUSY.error, details: { stderr: SECRET }, stack: SECRET }, debug: SECRET }));
  assert.deepEqual(await runResumeSweep(cli, { exec: extra.exec }), BUSY, 'nothing but the code and message passes');
  const noMessage = answering(exitWith(1), JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'E_RESUME_BUSY', message: { text: SECRET } } }));
  assert.deepEqual(await runResumeSweep(cli, { exec: noMessage.exec }), { schemaVersion: 1, ok: false, error: { code: 'E_RESUME_BUSY' } });
  for (const code of ['', 'resume busy', 'E_', 'e_resume_busy', `E_${'A'.repeat(65)}`, 42, null]) {
    const bad = answering(exitWith(1), JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message: SECRET } }));
    const answer = await runResumeSweep(cli, { exec: bad.exec });
    assert.deepEqual(answer, own('E_CLI_PROTOCOL'), `code ${JSON.stringify(code)}`);
    assert.equal(madeByKernel(answer.error), false, 'a failure of the client\'s own is not the kernel\'s');
  }
  const longest = answering(exitWith(1), JSON.stringify({ schemaVersion: 1, ok: false, error: { code: `E_${'A'.repeat(64)}`, message: 'm' } }));
  assert.equal((await runResumeSweep(cli, { exec: longest.exec })).error.code, `E_${'A'.repeat(64)}`);
});

test('every failure is a code of the client\'s own, with no stderr, no thrown text and no message', async () => {
  const cases = [
    ['over the buffer, even with a valid envelope', Object.assign(new RangeError('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), JSON.stringify(SWEPT), 'E_CLI_OUTPUT_LIMIT'],
    ['no envelope at exit 0', null, `not json ${SECRET}`, 'E_CLI_PROTOCOL'],
    ['an empty answer at exit 0', null, '', 'E_CLI_PROTOCOL'],
    ['another schema version', null, JSON.stringify({ ...SWEPT, schemaVersion: 2 }), 'E_CLI_PROTOCOL'],
    ['ok:true with no result', null, JSON.stringify({ schemaVersion: 1, ok: true }), 'E_CLI_PROTOCOL'],
    ['two objects', null, `${JSON.stringify(SWEPT)}\n${JSON.stringify(SWEPT)}`, 'E_CLI_PROTOCOL'],
    ['no envelope at a nonzero exit', exitWith(1), `Error: ${SECRET}`, 'E_CLI_FAILED'],
    ['no output at a signal', exitWith(null, 'SIGKILL'), '', 'E_CLI_FAILED'],
    ['a spawn error', Object.assign(new Error(`spawn ENOENT ${SECRET}`), { code: 'ENOENT' }), '', 'E_CLI_FAILED'],
    ['ok:true at a nonzero exit', exitWith(1), JSON.stringify(SWEPT), 'E_CLI_FAILED'],
    ['ok:true after a signal', exitWith(null, 'SIGTERM'), JSON.stringify(SWEPT), 'E_CLI_FAILED'],
    ['undefined output', null, undefined, 'E_CLI_PROTOCOL'],
  ];
  for (const [name, error, stdout, code] of cases) {
    const { exec } = answering(error, stdout);
    const answer = await runResumeSweep(cli, { exec });
    assert.deepEqual(answer, own(code), name);
    assert.doesNotMatch(JSON.stringify(answer), /SECRET/, name);
  }
  const thrown = await runResumeSweep(cli, { exec: () => { throw new Error(SECRET); } });
  assert.deepEqual(thrown, own('E_CLI_FAILED'), 'a thrown exec resolves, never rejects');
});

test('a callback called twice changes nothing: the first answer stands', async () => {
  const exec = (bin, argv, options, callback) => { callback(null, JSON.stringify(SWEPT), ''); callback(exitWith(1), 'garbage', SECRET); };
  assert.deepEqual(await runResumeSweep(cli, { exec }), SWEPT);
});

test('the default exec (files, detached) runs the stand-in kernel end to end: the sweep, and busy at exit 1', { skip: process.platform === 'win32' }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'session-resume-cli-test-'));
  try {
    const kernel = fileURLToPath(new URL('./fixtures/session-resume/sweep-kernel.mjs', import.meta.url));
    const bin = join(scratch, 'oats');
    writeFileSync(bin, `#!/bin/sh\nexec '${process.execPath}' '${kernel}' "$@"\n`);
    chmodSync(bin, 0o755);
    const stand = { ok: true, bin, features: [SESSION_RESUME_FEATURE] };
    const env = { OATS_HOME_DIR: join(scratch, 'home'), OATS_INSTANCE_HOME: '/inside/an/instance' };
    const swept = await runResumeSweep(stand, { env: { ...env, SWEEP_FIXTURE: 'ok' } });
    assert.equal(swept.ok, true);
    assert.deepEqual(swept.result.seen, { argv: ['session', 'resume', '--json'], cwd: '/', instanceHome: null, homeDir: env.OATS_HOME_DIR });
    const busy = await runResumeSweep(stand, { env: { ...env, SWEEP_FIXTURE: 'busy' } });
    assert.deepEqual(busy, { schemaVersion: 1, ok: false, error: { code: 'E_RESUME_BUSY', message: 'Another sweep is running.' } });
    assert.doesNotMatch(JSON.stringify(busy), /stderr noise/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
