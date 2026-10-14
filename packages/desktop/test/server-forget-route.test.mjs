// #1131: POST /api/server-forget through the shipped handler (oats-web.mjs), server/server-forget.mjs and the
// real CLI adapter (cli-adapter.mjs cliServerForget) over a fake process runner: the transport boundary is the
// argv the runner receives. Exactly one command per valid request, composed from the row's two values; a
// refused request runs nothing; the kernel's home and target never reach the answer; every command that ran is
// followed by one remote roster read, whatever it answered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerForget, forgetOutcome, forgetNotRun } from '../server/server-forget.mjs';
import { cliServerForget, cliRemoteRoster } from '../../client/cli-adapter.mjs';
import { createRefreshLoop } from '../../client/refresh-loop.mjs';
import { classifyApiRoute } from '../api-url.mjs';
import { loadServer, juanState, CLI } from './helpers/workspace-views-fixture.mjs';
import { shippedMainApi } from './helpers/shipped-main-api.mjs';

const ROUTE = '/api/server-forget';
const OK = { schemaVersion: 1, ok: true, result: { server: 'build', instance: 'dev-a', home: '/srv/team/agents/dev/instances/dev-a',
  target: { sshHost: 'build-host', workspace: '/srv/team', oatsPath: 'oats' }, forgotten: true } };
const FAIL = (code, message) => ({ schemaVersion: 1, ok: false, error: { code, message } });
const exited = code => Object.assign(new Error(`Command failed: exit ${code}`), { code });

/** A runner that answers each command with `answer(argv, n)` ({ stdout, err }; n counts from 0), or holds it ('hold') until the test settles it. */
function runner(answer = () => ({ stdout: JSON.stringify(OK) })) {
  const calls = [], held = [];
  const exec = (bin, argv, opts, done) => {
    calls.push({ bin, argv, opts });
    const reply = answer(argv, calls.length - 1);
    if (reply === 'hold') { held.push(({ stdout = '', err = null }) => done(err, stdout)); return; }
    queueMicrotask(() => done(reply.err ?? null, reply.stdout ?? ''));
  };
  return { exec, calls, held };
}
/** The shipped handler over the real forget module and adapter. `remoteLoop` is the server's refresh loop (a stub
 * counting `request()`s by default; `rereads` holds one entry per request). */
async function serve({ answer, cli = CLI, adapter, remoteLoop } = {}) {
  const run = runner(answer);
  const rereads = [];
  const serverForget = createServerForget({ cli: () => cli,
    adapter: adapter ?? { cliServerForget: (bin, args) => cliServerForget(bin, args, { exec: run.exec }) } });
  const loop = remoteLoop ?? { request: () => { rereads.push(1); return Promise.resolve(); } };
  const { request } = await loadServer(juanState().state, { serverForget, forgetNotRun, remoteLoop: loop });
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
    // A nonzero exit with no envelope (a crash after the route file went) and one with a success envelope: E_CLI_FAILED
    // (cli-adapter.mjs runJson strictExit); a clean exit that printed no envelope: E_CLI_PROTOCOL.
    [() => ({ stdout: 'TypeError: Cannot read properties of null', err: exited(1) }), 'E_CLI_FAILED'],
    [() => ({ stdout: JSON.stringify(OK), err: exited(1) }), 'E_CLI_FAILED'],
    [() => ({ stdout: 'not an envelope' }), 'E_CLI_PROTOCOL'],
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
  // Only the first command is held; every later one answers at once.
  const s = await serve({ answer: (argv, n) => (n === 0 ? 'hold' : { stdout: JSON.stringify({ ...OK, result: { ...OK.result, instance: argv[4] } }) }) });
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

test('the adapter refuses option-shaped values itself', async () => {
  const run = runner();
  for (const args of [{ server: '--x', instance: 'a' }, { server: 'b', instance: '-a' }, { server: 'b' }, undefined]) {
    assert.equal((await cliServerForget('/oats', args, { exec: run.exec })).error.code, 'E_BAD_ARGS');
  }
  assert.equal(run.calls.length, 0);
});

test('the answer waits for the roster read after the command: the panel then serves the roster as it stands after it', async () => {
  let settle; const read = new Promise(resolve => { settle = resolve; });
  const order = [];
  const s = await serve({ answer: () => { order.push('command'); return { stdout: JSON.stringify(OK) }; },
    remoteLoop: { request: () => { order.push('read requested'); return read; } } });
  let answered = false;
  const pending = s.post({ server: 'build', instance: 'dev-a' }).then(answer => { answered = true; return answer; });
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['command', 'read requested'], 'the read is requested after the command');
  assert.equal(answered, false, 'not answered before the read lands');
  settle();
  assert.equal((await pending).body.status, 'forgotten');
  // A read that fails still answers the outcome.
  const failing = await serve({ remoteLoop: { request: () => Promise.reject(new Error('roster')) } });
  assert.equal((await failing.post({ server: 'build', instance: 'dev-a' })).body.status, 'forgotten');
});

test('with the server\'s refresh loop: a read already in flight is followed by one read after the command, and the answer waits for that one', async () => {
  const reads = [];
  const loop = createRefreshLoop({ run: () => new Promise(resolve => { reads.push(resolve); }), focusedMs: 3_600_000, blurredMs: 3_600_000,
    timers: { setTimeout: () => null, clearTimeout: () => {} } });
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  const commands = [];
  const s = await serve({ remoteLoop: loop, answer: () => { commands.push(reads.length); return { stdout: JSON.stringify(OK) }; } });
  void loop.request(); await flush(); // R0: a background read that began before the Forget
  assert.equal(reads.length, 1);
  let answered = false;
  const pending = s.post({ server: 'build', instance: 'dev-a' }).then(answer => { answered = true; return answer; });
  await flush();
  assert.deepEqual(commands, [1], 'the command ran while R0 was in flight');
  reads[0](); await flush();
  assert.equal(reads.length, 2, 'R1, the read after the command, runs once R0 is done');
  assert.equal(answered, false, 'R0 is not the read after the command: still waiting');
  reads[1](); assert.equal((await pending).body.status, 'forgotten');
  assert.equal(reads.length, 2, 'exactly one read after the command');
  // With no read in flight: one read, after the command.
  void s.post({ server: 'build', instance: 'dev-a' }); await flush();
  assert.equal(reads.length, 3); reads[2](); await flush();
});

test('main\'s proxy waits longer than one forget call and two roster reads, each read from its own call', async () => {
  const limitOf = async call => { let limit; await call((_bin, _argv, opts, done) => { limit = opts.timeout; done(null, '{"schemaVersion":1,"ok":true,"result":{"groups":[]}}'); }); return limit; };
  const forget = await limitOf(exec => cliServerForget('/oats', { server: 'build', instance: 'dev-a' }, { exec }));
  const roster = await limitOf(exec => cliRemoteRoster('/oats', { exec }));
  assert.ok(forget > 0 && roster > 0);
  for (const p of [ROUTE, '/api/./server-forget', '/api/x/../server-forget']) assert.equal(classifyApiRoute(p, 'http://127.0.0.1:4999'), 'server-forget', p);
  assert.notEqual(classifyApiRoute('/api/server-forget/x', 'http://127.0.0.1:4999'), 'server-forget');
  const api = shippedMainApi({ window: '/d/first', advertised: new Set(['/d/first']), served: [{ id: '/d/first' }] });
  const seen = [];
  api.context.AbortSignal = { timeout: ms => { seen.push(ms); return { ms }; } };
  api.context.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: 'forgotten', server: 'build', instance: 'dev-a' }) });
  await api.call(ROUTE, { method: 'POST', body: JSON.stringify({ server: 'build', instance: 'dev-a' }) });
  assert.ok(seen[0] > forget + 2 * roster, `the proxy's ${seen[0]} ms must outlast ${forget} + 2 × ${roster} ms`);
});
