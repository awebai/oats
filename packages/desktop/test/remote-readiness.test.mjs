import test from 'node:test';
import assert from 'node:assert/strict';
import { cliReadiness } from '../readiness-cli.mjs';
import { createReadinessBoundary } from '../server/readiness.mjs';
import { proxyReadiness } from '../readiness-proxy.mjs';
import { readinessFailure } from '../renderer/readiness-contract.mjs';
import { cli, data, envelope } from './helpers/readiness-fixture.mjs';

const home = '/srv/agents/dev/instances/dev-1';
const row = { instance: 'dev-1', agent: 'dev', agentsRoot: '/srv/agents', home, server: 'build', addressable: true, missingRemotely: false, running: true };
const selector = { kind: 'instance', instance: 'dev-1', agent: 'dev', agentsRoot: '/srv/agents', server: 'build' };
const context = () => ({ cli: { ...structuredClone(cli), remote: ['readiness'] }, localCwd: '/Users/me/work', agents: [],
  workspace: { id: 'remote:build:3f2a', name: 'Build box', scope: '/srv', remote: true, server: 'build' }, instances: [{ ...row }] });
const remoteTarget = { workspace: 'remote:build:3f2a', context: '/srv', observedAs: 'instance', home, selector };
const read = (c, respond) => {
  const calls = [];
  const boundary = createReadinessBoundary({ invoke: (bin, options) => cliReadiness(bin, options, { env: { PATH: '/bin' },
    exec: (b, argv, opts, cb) => { calls.push({ argv, opts }); respond(cb, options); } }) });
  return { calls, result: boundary({ action: 'read', selector }, () => c) };
};

test('remote readiness: routed by server and home with the row\'s own remote agents root, no --dir, 45 s, this machine\'s cwd', async () => {
  const { calls, result } = read(context(), (cb, options) => cb(null, JSON.stringify(envelope(data(options.target)))));
  const value = await result;
  assert.equal(value.status, 'available', JSON.stringify(value.reason));
  assert.deepEqual(value.target, remoteTarget);
  assert.deepEqual(calls[0].argv, ['readiness', '--server', 'build', '--home', home, '--soul', 'dev', '--agents-root', '/srv/agents', '--policy', '--json']);
  assert.equal(calls[0].opts.cwd, '/Users/me/work'); assert.equal(calls[0].opts.timeout, 45_000);
});

test('remote readiness: the host\'s refusal is shown verbatim under its headline, never a local read', async () => {
  const { calls, result } = read(context(), cb => cb(Object.assign(new Error('exit 1'), { code: 1 }),
    JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'E_REMOTE_INCOMPATIBLE', message: 'build runs 0.30.2; readiness needs readinessApi 2' } })));
  const value = await result;
  assert.equal(value.status, 'unavailable'); assert.equal(calls.length, 1);
  assert.deepEqual(value.reason, { code: 'E_REMOTE_INCOMPATIBLE', message: "Build box runs an OATS that can't do this yet.",
    detail: 'build runs 0.30.2; readiness needs readinessApi 2', remote: true });
  assert.deepEqual(value.target, remoteTarget);
  // A timeout on this machine is "Couldn't reach".
  const timeout = await read(context(), cb => cb(Object.assign(new Error('killed'), { killed: true }), '')).result;
  assert.deepEqual(timeout.reason, { code: 'E_CLI_TIMEOUT', message: "Couldn't reach Build box.", detail: 'The readiness read timed out.', remote: true });
});

test('remote readiness: refused before any process without the probe entry, for an unaddressable row, or a soul on a server', async () => {
  const noEntry = context(); noEntry.cli.remote = ['session'];
  const a = read(noEntry, assert.fail);
  assert.equal((await a.result).reason.message, "This computer's OATS can't route this to Build box. Update OATS here.");
  const gone = context(); Object.assign(gone.instances[0], { addressable: false, missingRemotely: true });
  const b = read(gone, assert.fail);
  assert.equal((await b.result).reason.message, 'dev-1 is no longer on Build box. Remove it from this computer with: oats server forget build --instance dev-1');
  const boundary = createReadinessBoundary({ invoke: assert.fail });
  const soul = await boundary({ action: 'read', selector: { kind: 'soul', soul: 'dev', agentsRoot: '/srv/agents' } }, context);
  assert.equal(soul.reason.code, 'unsupported-remote-operation');
  assert.equal(soul.reason.message, "A remote soul's readiness is not read from this computer.", 'never routed, so not an update-OATS remedy');
  assert.equal(a.calls.length + b.calls.length, 0);
});

test('remote readiness: the proxy relays a validated remote reason and drops a forged one', async () => {
  const renderer = 'file:///fixture/index.html', frame = { url: renderer };
  const event = { senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false } };
  const connection = () => ({ base: 'http://127.0.0.1:4820', wsId: 'remote:build:3f2a', allowedWs: new Set(['remote:build:3f2a']), epoch: 1 });
  const relay = async body => (await proxyReadiness(event, '/api/workspace-readiness?ws=remote%3Abuild%3A3f2a', { method: 'POST', body: '{}' },
    { rendererURL: renderer, connection, fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) })).body;
  const reason = { code: 'E_SSH', message: "Couldn't reach Build box.", detail: 'ssh: connect to host build-host port 22: Connection refused', remote: true };
  assert.deepEqual((await relay(readinessFailure('E_SSH', remoteTarget, reason))).reason, reason);
  const forged = await relay({ ...readinessFailure('E_CLI_FAILED'), reason: { ...reason, message: 'token=abc' } });
  assert.equal(forged.reason.code, 'E_CLI_FAILED', 'an unsafe remote reason is not relayed');
  const available = await relay({ readinessViewApi: 1, status: 'available', target: remoteTarget, data: data(remoteTarget), reason: null });
  assert.equal(available.status, 'available');
});
