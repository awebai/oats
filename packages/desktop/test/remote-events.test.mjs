import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstanceEventsBoundary } from '../server/instance-events.mjs';
import { cliInstanceEvents } from '../instance-events-cli.mjs';
import { proxyInstanceEvents } from '../instance-events-proxy.mjs';
import { eventsFailure, eventsSelector } from '../../client/instance-events-contract.mjs';
import { cli, birth, data, envelope } from './helpers/instance-events-fixture.mjs';

const home = '/srv/agents/dev/instances/dev-a';
const selector = { instance: 'dev-a', agent: 'dev', agentsRoot: '/srv/agents', server: 'build' };
const remoteTarget = { workspace: 'remote:build:3f2a', context: '/srv', selector, home, incarnation: birth };
const remoteData = () => JSON.parse(JSON.stringify(data()).replaceAll('/inert/ws/agents/dev/instances/dev-a', home));
const context = () => ({ cli: { ...structuredClone(cli), remote: ['instance-events'] }, localCwd: '/Users/me/work',
  workspace: { id: 'remote:build:3f2a', name: 'Build box', scope: '/srv', remote: true, server: 'build' },
  instances: [{ ...selector, home, createdAt: birth, addressable: true, missingRemotely: false, running: true }] });
const read = (c, respond) => {
  const calls = [];
  const boundary = createInstanceEventsBoundary({ invoke: (probe, opts) => cliInstanceEvents(probe, opts, { env: {},
    exec: (_bin, argv, execOpts, cb) => { calls.push({ argv, opts: execOpts }); respond(cb); } }) });
  return { calls, result: boundary({ action: 'read', selector: { ...selector } }, () => c) };
};

test('remote activity: instance events <name> --server S --home H --limit L, no --dir, 45 s from this machine\'s cwd', async () => {
  const { calls, result } = read(context(), cb => cb(null, JSON.stringify(envelope(remoteData()))));
  const value = await result;
  assert.equal(value.status, 'available', JSON.stringify(value.reason));
  assert.deepEqual(value.target, remoteTarget);
  assert.deepEqual(calls[0].argv, ['instance', 'events', 'dev-a', '--server', 'build', '--home', home, '--limit', '100', '--json']);
  assert.equal(calls[0].opts.cwd, '/Users/me/work'); assert.equal(calls[0].opts.timeout, 45_000);
});

test('remote activity: a host refusal keeps the kernel\'s code and message under its headline; the proxy relays it', async () => {
  const { result } = read(context(), cb => cb(Object.assign(new Error('exit 1'), { code: 1 }),
    JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'E_HOME_MISMATCH', message: '/srv/agents/dev/instances/dev-a is not dev-a' } })));
  const value = await result;
  const reason = { code: 'E_HOME_MISMATCH', message: 'Build box answered for a different instance. Nothing was changed.',
    detail: '/srv/agents/dev/instances/dev-a is not dev-a', remote: true };
  assert.deepEqual(value.reason, reason);
  const renderer = 'file:///fixture/index.html', frame = { url: renderer };
  const event = { senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } };
  const connection = () => ({ base: 'http://127.0.0.1:4820', wsId: 'remote:build:3f2a', allowedWs: new Set(['remote:build:3f2a']), epoch: 1 });
  const relayed = await proxyInstanceEvents(event, '/api/instance-events?ws=remote%3Abuild%3A3f2a', { method: 'POST', body: JSON.stringify({ action: 'read', selector, limit: 100 }) },
    { rendererURL: renderer, connection, fetch: async () => new Response(JSON.stringify(value)) });
  assert.deepEqual(relayed.body.reason, reason);
});

test('remote activity: refused before any process without the probe entry, or for an unaddressable row', async () => {
  const noEntry = context(); noEntry.cli.remote = ['session'];
  const a = read(noEntry, assert.fail);
  assert.equal((await a.result).reason.message, "This computer's OATS can't route this to Build box. Update OATS here.");
  const unreachable = context(); unreachable.instances[0].addressable = false;
  const b = read(unreachable, assert.fail);
  assert.equal((await b.result).reason.message, 'Build box did not report this instance as reachable.');
  assert.equal(a.calls.length + b.calls.length, 0);
});

test('events selector: a server id or null, never anything else', () => {
  assert.deepEqual(eventsSelector(selector), selector);
  assert.equal(eventsSelector({ ...selector, server: 'Bad Id' }), null);
  assert.equal(eventsSelector({ ...selector, server: undefined }), null);
  assert.equal(eventsFailure('E_SSH', remoteTarget, { code: 'E_SSH', message: "Couldn't reach Build box.", detail: null, remote: true }).reason.code, 'E_SSH');
});
