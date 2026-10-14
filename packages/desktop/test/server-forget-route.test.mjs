// #1131: POST /api/server-forget through the shipped handler (oats-web.mjs), server/server-forget.mjs and the
// real CLI adapter (cli-adapter.mjs cliServerForget) over a fake process runner: the transport boundary is the
// argv the runner receives. Exactly one command per valid request, composed from the row's two values; a
// refused request runs nothing; the kernel's home and target never reach the answer; every command that ran is
// followed by one remote roster read, whatever it answered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerForget, forgetOutcome } from '../server/server-forget.mjs';
import { cliServerForget } from '../../client/cli-adapter.mjs';
import { loadServer, juanState, CLI } from './helpers/workspace-views-fixture.mjs';

const ROUTE = '/api/server-forget';
const OK = { schemaVersion: 1, ok: true, result: { server: 'build', instance: 'dev-a', home: '/srv/team/agents/dev/instances/dev-a',
  target: { sshHost: 'build-host', workspace: '/srv/team', oatsPath: 'oats' }, forgotten: true } };
const FAIL = (code, message) => ({ schemaVersion: 1, ok: false, error: { code, message } });
const exited = code => Object.assign(new Error(`Command failed: exit ${code}`), { code });

/** A runner that answers each command with `answer(argv)` ({ stdout, err }), or holds it until the test settles it. */
function runner(answer = () => ({ stdout: JSON.stringify(OK) })) {
  const calls = [], held = [];
  const exec = (bin, argv, opts, done) => {
    calls.push({ bin, argv, opts });
    const reply = answer(argv);
    if (reply === 'hold') { held.push(({ stdout = '', err = null }) => done(err, stdout)); return; }
    queueMicrotask(() => done(reply.err ?? null, reply.stdout ?? ''));
  };
  return { exec, calls, held };
}
async function serve({ answer, cli = CLI, adapter } = {}) {
  const run = runner(answer);
  const rereads = [];
  const serverForget = createServerForget({ cli: () => cli,
    adapter: adapter ?? { cliServerForget: (bin, args) => cliServerForget(bin, args, { exec: run.exec }) } });
  const { request } = await loadServer(juanState().state, { serverForget, remoteLoop: { request: () => { rereads.push(1); return Promise.resolve(); } } });
  const post = (body, extra = {}) => request({ url: ROUTE, method: 'POST', body, ...extra });
  return { post, request, run, rereads };
}

test('a valid request runs exactly one command with the exact argv, answers without home or target, and re-reads once', async () => {
  const s = await serve();
  const answer = await s.post({ server: 'build', instance: 'dev-a' });
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { status: 'forgotten', server: 'build', instance: 'dev-a' });
  assert.equal(JSON.stringify(answer.body).includes('/srv/team'), false, 'no home or target crosses the backend');
  assert.equal(s.run.calls.length, 1);
  assert.deepEqual(s.run.calls[0].argv, ['server', 'forget', 'build', '--instance', 'dev-a', '--json']);
  assert.equal(s.run.calls[0].bin, CLI.bin);
  assert.equal(s.run.calls[0].opts.shell, false);
  assert.equal(s.rereads.length, 1, 'the remote roster is read again');
});

test('the row identity reaches argv as given: each value one entry, nothing added from the body', async () => {
  const s = await serve({ answer: argv => ({ stdout: JSON.stringify({ ...OK, result: { ...OK.result, server: argv[2], instance: argv[4] } }) }) });
  for (const [server, instance] of [['b', 'x'], ['build-2', 'dev-a-b'], ['build', 'name with spaces'], ['build', '名前'], ['build', 'a'.repeat(256)]]) {
    const answer = await s.post({ server, instance });
    assert.equal(answer.body.status, 'forgotten', `${server} ${instance}`);
    assert.deepEqual(s.run.calls.at(-1).argv, ['server', 'forget', server, '--instance', instance, '--json']);
  }
});

test('a missing or invalid server or instance is refused with 400 E_BAD_ARGS and runs nothing', async () => {
  const s = await serve();
  const bodies = [{}, { server: 'build' }, { instance: 'dev-a' }, { server: '', instance: 'dev-a' }, { server: 'build', instance: '' },
    { server: '--json', instance: 'dev-a' }, { server: 'build', instance: '--server' }, { server: '-x', instance: 'dev-a' }, { server: 'build', instance: '-i' },
    { server: 'build', instance: 'dev\na' }, { server: 'bu\u0000ild', instance: 'dev-a' }, { server: 'build', instance: 'dev\u007fa' }, { server: 'build\t', instance: 'dev-a' },
    { server: 'build', instance: 'a'.repeat(257) }, { server: 3, instance: 'dev-a' }, { server: 'build', instance: ['dev-a'] }, { server: 'build', instance: null },
    { server: 'build', instance: 'dev-a', argv: ['--force'] }, { server: 'build', instance: 'dev-a', home: '/elsewhere' }, ['build', 'dev-a']];
  for (const body of bodies) {
    const answer = await s.post(body);
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.deepEqual(answer.body.reason.code, 'E_BAD_ARGS');
    assert.equal(answer.body.status, 'not-run');
  }
  for (const raw of ['{', 'null', '"build"', '']) assert.equal((await s.post(raw)).status, 400, `raw ${JSON.stringify(raw)}`);
  assert.equal((await s.request({ url: `${ROUTE}?server=build&instance=dev-a`, method: 'POST', body: { server: 'build', instance: 'dev-a' } })).status, 400, 'no query');
  assert.equal((await s.request({ url: ROUTE, method: 'GET' })).status, 404, 'POST only');
  assert.deepEqual([s.run.calls.length, s.rereads.length], [0, 0]);
});

test('the Host and Origin guards hold: a foreign host or origin is 403 and runs nothing', async () => {
  const s = await serve();
  const body = { server: 'build', instance: 'dev-a' };
  for (const headers of [{ host: 'evil.example:4820', origin: 'http://localhost:4820' }, { host: '127.0.0.1:4820', origin: 'http://evil.example' },
    { host: '127.0.0.1:4820', origin: 'null' }, { host: '127.0.0.1:4820', origin: 'not a url' }]) {
    const answer = await s.post(body, { headers });
    assert.equal(answer.status, 403, JSON.stringify(headers));
  }
  assert.deepEqual([s.run.calls.length, s.rereads.length], [0, 0]);
  assert.equal((await s.post(body, { headers: { host: 'localhost:4820' } })).status, 200, 'no Origin header from a loopback host: allowed');
});

test('E_SNAPSHOT_UNKNOWN and another refusal are the kernel\'s, with its message; each re-reads once', async () => {
  for (const [code, message] of [['E_SNAPSHOT_UNKNOWN', 'no saved route for dev-a through server build (oats server roster --json)'],
    ['E_SNAPSHOT_UNREADABLE', '/x/remote/build/dev-a.json: Unexpected token']]) {
    const s = await serve({ answer: () => ({ stdout: JSON.stringify(FAIL(code, message)), err: exited(1) }) });
    const answer = await s.post({ server: 'build', instance: 'dev-a' });
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body, { status: 'refused', reason: { code, message } });
    assert.deepEqual([s.run.calls.length, s.rereads.length], [1, 1]);
  }
});

test('no kernel answer is an unknown outcome, never a refusal: a timeout, no envelope, a crash, a success for another row; each re-reads once', async () => {
  const cases = [
    [() => ({ stdout: '', err: Object.assign(exited(null), { killed: true, signal: 'SIGTERM' }) }), 'E_CLI_TIMEOUT'],
    [() => ({ stdout: 'TypeError: Cannot read properties of null', err: exited(1) }), 'E_CLI_PROTOCOL'],
    [() => ({ stdout: JSON.stringify(OK), err: exited(1) }), 'E_CLI_FAILED'],
    [() => ({ stdout: JSON.stringify({ ...OK, result: { ...OK.result, instance: 'dev-b' } }) }), 'E_OUTCOME_UNKNOWN'],
    [() => ({ stdout: JSON.stringify({ ...OK, result: { ...OK.result, forgotten: false } }) }), 'E_OUTCOME_UNKNOWN'],
  ];
  for (const [answer, code] of cases) {
    const s = await serve({ answer });
    const reply = await s.post({ server: 'build', instance: 'dev-a' });
    assert.deepEqual(reply.body, { status: 'unknown', reason: { code } }, code);
    assert.deepEqual([s.run.calls.length, s.rereads.length], [1, 1]);
  }
  const thrown = await serve({ adapter: { cliServerForget: async () => { throw new Error('spawn EACCES /secret/path'); } } });
  const reply = await thrown.post({ server: 'build', instance: 'dev-a' });
  assert.deepEqual(reply.body, { status: 'unknown', reason: { code: 'E_OUTCOME_UNKNOWN' } }, 'a thrown text never crosses');
  assert.equal(thrown.rereads.length, 1);
});

test('an error the adapter wrote is not the kernel\'s, even with a kernel-looking code', () => {
  assert.deepEqual(forgetOutcome(FAIL('E_SNAPSHOT_UNKNOWN', 'unmarked'), 'build', 'dev-a'), { status: 'unknown', reason: { code: 'E_OUTCOME_UNKNOWN' } });
  assert.deepEqual(forgetOutcome(null, 'build', 'dev-a'), { status: 'unknown', reason: { code: 'E_OUTCOME_UNKNOWN' } });
});

test('one Forget per row at a time: a second request while the first runs is 409 E_BUSY and runs nothing; another row runs', async () => {
  const s = await serve({ answer: argv => (argv[4] === 'dev-a' ? 'hold' : { stdout: JSON.stringify({ ...OK, result: { ...OK.result, instance: argv[4] } }) }) });
  const first = s.post({ server: 'build', instance: 'dev-a' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.run.calls.length, 1);
  const second = await s.post({ server: 'build', instance: 'dev-a' });
  assert.deepEqual([second.status, second.body.status, second.body.reason.code], [409, 'not-run', 'E_BUSY']);
  assert.equal(s.run.calls.length, 1, 'nothing ran for the second');
  const other = await s.post({ server: 'build', instance: 'dev-b' });
  assert.equal(other.body.status, 'forgotten');
  s.run.held[0]({ stdout: JSON.stringify(OK) });
  assert.equal((await first).body.status, 'forgotten', 'the late answer lands');
  assert.equal(s.rereads.length, 2, 'one re-read per command that ran');
  assert.equal((await s.post({ server: 'build', instance: 'dev-a' })).body.status, 'forgotten', 'free again once answered');
});

test('without a CLI that reads the remote roster nothing runs: 409 E_FEATURE', async () => {
  for (const cli of [{ ok: false }, { ...CLI, remote: [] }, { ...CLI, remote: 'roster' }]) {
    const s = await serve({ cli });
    const answer = await s.post({ server: 'build', instance: 'dev-a' });
    assert.deepEqual([answer.status, answer.body.reason.code], [409, 'E_FEATURE']);
    assert.deepEqual([s.run.calls.length, s.rereads.length], [0, 0]);
  }
});

test('the adapter refuses option-shaped values itself, and its deadline stays inside the proxy\'s default 20 s', async () => {
  const run = runner();
  for (const args of [{ server: '--x', instance: 'a' }, { server: 'b', instance: '-a' }, { server: 'b' }, undefined]) {
    assert.equal((await cliServerForget('/oats', args, { exec: run.exec })).error.code, 'E_BAD_ARGS');
  }
  assert.equal(run.calls.length, 0);
  await cliServerForget('/oats', { server: 'b', instance: 'a' }, { exec: run.exec });
  assert.ok(run.calls[0].opts.timeout < 20_000, 'main.mjs proxies an unclassified route for 20 s: the CLI answers first');
});
