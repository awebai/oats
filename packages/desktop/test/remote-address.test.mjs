import test from 'node:test';
import assert from 'node:assert/strict';
import { canAddressRemote, serverLabel, rowReason, remoteHeadline, hostReason, remoteReason, unroutableReason, readingFrom }
  from '../renderer/remote-address.mjs';
import { canAddressRemote as serverCanAddressRemote, admitInstance } from '../server/instance-admission.mjs';

const remote = (extra = {}) => ({ instance: 'dev-a', agent: 'dev', home: '/srv/agents/dev/instances/dev-a', server: 'build',
  repoName: 'Build box', running: true, addressable: true, missingRemotely: false, savedRoute: false, ...extra });

test('canAddressRemote: a local row, or a remote row the kernel reports addressable; never savedRoute', () => {
  assert.equal(canAddressRemote({ instance: 'x', home: '/w/x' }), true);
  assert.equal(canAddressRemote(remote()), true);
  assert.equal(canAddressRemote(remote({ savedRoute: true, addressable: false })), false, 'a saved route does not make a row addressable');
  assert.equal(canAddressRemote(remote({ addressable: undefined })), false, 'absent is not true');
  assert.equal(canAddressRemote(remote({ addressable: 'true' })), false);
  assert.equal(canAddressRemote(null), false);
  assert.equal(serverCanAddressRemote, canAddressRemote, 'the server admits with the same predicate');
});

test('serverLabel: the registration label the roster reports, else the server id', () => {
  assert.equal(serverLabel(remote()), 'Build box');
  assert.equal(serverLabel(remote({ repoName: '' })), 'build');
});

test('rowReason: one function for the meta-line label and the full sentence, keyed by the reason', () => {
  const herdr = rowReason(remote({ running: null, runtimeState: 'unsupported', runtimeError: 'E_HERDR_REMOVED: Herdr is gone.' }));
  assert.deepEqual(herdr, { key: 'herdr', label: 'Herdr no longer supported', sentence: 'E_HERDR_REMOVED: Herdr is gone.' });
  const localHerdr = rowReason({ instance: 'h', home: '/w/h', running: null, sessionTarget: 'x' });
  assert.equal(localHerdr.label, 'Herdr no longer supported', 'a local Herdr row too');
  assert.deepEqual(rowReason(remote({ addressable: false, missingRemotely: true, running: null })), { key: 'missing',
    label: 'gone from Build box',
    sentence: 'dev-a is no longer on Build box. Remove it from this computer with: oats server forget build --instance dev-a' });
  assert.deepEqual(rowReason(remote({ addressable: false })), { key: 'unaddressable', label: 'not reachable on Build box',
    sentence: 'Build box did not report this instance as reachable.' });
  assert.deepEqual(rowReason(remote({ running: null, serverUnreached: true, runtimeError: 'ssh failed: timeout' })),
    { key: 'unreached', label: 'Build box not reached', sentence: 'ssh failed: timeout' });
  assert.deepEqual(rowReason(remote({ running: null })), { key: 'unknown', label: 'state unknown', sentence: 'dev-a: status unknown' });
  assert.equal(rowReason(remote()), null, 'a running addressable row has no reason');
  assert.equal(rowReason(remote({ running: false })), null);
  assert.equal(rowReason({ instance: 'x', home: '/w/x', running: null }).label, 'state unknown');
  // The server not being reached wins over a stale addressable fact from its last good read.
  assert.equal(rowReason(remote({ running: null, serverUnreached: true, addressable: false, missingRemotely: true })).key, 'unreached');
});

test('remoteHeadline: the host-refusal table, with the view\'s own sentence for every other code', () => {
  assert.equal(remoteHeadline('E_REMOTE_INCOMPATIBLE', 'Build box', 'x'), "Build box runs an OATS that can't do this yet.");
  assert.equal(remoteHeadline('E_SNAPSHOT_UNKNOWN', 'Build box', 'x'), "Build box doesn't list this instance any more.");
  for (const code of ['E_HOME_MISMATCH', 'E_AMBIGUOUS']) assert.equal(remoteHeadline(code, 'Build box', 'x'), 'Build box answered for a different instance. Nothing was changed.');
  for (const code of ['E_SSH', 'E_CLI_TIMEOUT']) assert.equal(remoteHeadline(code, 'Build box', 'x'), "Couldn't reach Build box.");
  assert.equal(remoteHeadline('E_REMOTE_ENVELOPE', 'Build box', 'The view says this.'), 'The view says this.', 'a host error, not transport');
  assert.equal(remoteHeadline('E_SESSION_UNKNOWN', 'Build box', 'Gone.'), 'Gone.');
});

test('hostReason / remoteReason: the kernel\'s code and message verbatim, bounded and validated at every hop', () => {
  const reason = hostReason({ code: 'E_REMOTE_INCOMPATIBLE', message: 'build runs 0.30.2: needs readinessApi 2' }, 'Build box', 'fallback');
  assert.deepEqual(reason, { code: 'E_REMOTE_INCOMPATIBLE', message: "Build box runs an OATS that can't do this yet.",
    detail: 'build runs 0.30.2: needs readinessApi 2', remote: true });
  assert.deepEqual(remoteReason(reason), reason, 'a relayed reason survives re-validation unchanged');
  assert.deepEqual(hostReason({ code: 'E_CLI_TIMEOUT' }, 'Build box', 'x'), { code: 'E_CLI_TIMEOUT', message: "Couldn't reach Build box.", detail: null, remote: true });
  assert.equal(hostReason({ code: 'lowercase', message: 'm' }, 'Build box', 'x'), null, 'only kernel-shaped codes');
  assert.equal(hostReason({ code: 'E_X', message: 'token=abc123' }, 'Build box', 'x').detail, '[Detail withheld]');
  assert.equal(hostReason({ code: 'E_X', message: 'line\u0007bell' }, 'Build box', 'x').detail, '[Detail withheld]');
  assert.equal(hostReason({ code: 'E_X', message: 'm'.repeat(5000) }, 'Build box', 'x').detail.length, 2048);
  for (const bad of [null, {}, { ...reason, remote: false }, { ...reason, code: 'bad' }, { ...reason, message: '' },
    { ...reason, extra: 1 }, { ...reason, detail: 3 }]) assert.equal(remoteReason(bad), null);
});

test('unroutableReason: this machine cannot route the operation (no remote entry)', () => {
  assert.deepEqual(unroutableReason('Build box'), { code: 'unsupported-remote-operation',
    message: "This computer's OATS can't route this to Build box. Update OATS here.", detail: null, remote: true });
  assert.deepEqual(remoteReason(unroutableReason('Build box')), unroutableReason('Build box'));
});

test('readingFrom: the in-flight text of a remote read', () => {
  assert.equal(readingFrom('Build box'), 'Reading from Build box…');
});

const agentsRoot = '/srv/agents';
const row = (extra = {}) => ({ instance: 'dev-a', agent: 'dev', agentsRoot, home: `${agentsRoot}/dev/instances/dev-a`, server: 'build',
  addressable: true, missingRemotely: false, savedRoute: false, running: true, ...extra });
const remoteWs = { id: 'remote:build:3f2a', name: 'Build box', scope: '/srv', remote: true, server: 'build' };
const probe = { ok: true, bin: '/usr/local/bin/oats', remote: ['readiness', 'instance-events', 'instance-git', 'lifecycle-plans'] };
const sel = (extra = {}) => ({ instance: 'dev-a', agent: 'dev', agentsRoot, server: 'build', ...extra });
const admit = (selector, context = {}) => admitInstance(selector, { workspace: remoteWs, instances: [row()], cli: probe,
  operation: 'readiness', localCwd: '/Users/me/work', ...context });

test('admission: a local row keeps the workspace as its context', () => {
  const ws = { id: '/w', name: 'w', scope: '/w' };
  const local = { instance: 'x', agent: 'dev', agentsRoot: '/w/agents', home: '/w/agents/dev/instances/x' };
  const admitted = admitInstance({ instance: 'x', agent: 'dev', agentsRoot: '/w/agents' }, { workspace: ws, instances: [local], cli: probe });
  assert.deepEqual(admitted, { target: { workspace: '/w', instance: 'x', agent: 'dev', agentsRoot: '/w/agents', home: local.home, server: null },
    context: '/w', bin: probe.bin });
});

test('admission: an addressable remote row is admitted by its server and home, run from this machine\'s cwd', () => {
  assert.deepEqual(admit(sel()), { target: { workspace: remoteWs.id, instance: 'dev-a', agent: 'dev', agentsRoot, home: row().home, server: 'build' },
    context: '/Users/me/work', bin: probe.bin, remote: { server: 'build', label: 'Build box' } });
  // Two same-named instances under different souls: each is admitted by its own home.
  const twins = [row(), row({ agent: 'qa', home: `${agentsRoot}/qa/instances/dev-a` })];
  assert.equal(admit(sel({ agent: 'qa' }), { instances: twins }).target.home, `${agentsRoot}/qa/instances/dev-a`);
  assert.equal(admit(sel(), { instances: twins }).target.home, row().home);
  // Opening is disabled for an unknown runtime, but reads and plans still go: the host tells the truth.
  assert.equal(admit(sel(), { instances: [row({ running: null })] }).target.home, row().home);
});

test('admission: a remote row the kernel does not report addressable is refused with its reason', () => {
  const missing = admit(sel(), { instances: [row({ addressable: false, missingRemotely: true })] });
  assert.equal(missing.code, 'E_SNAPSHOT_UNKNOWN');
  assert.equal(missing.reason.message, 'dev-a is no longer on Build box. Remove it from this computer with: oats server forget build --instance dev-a');
  const other = admit(sel(), { instances: [row({ addressable: null })] });
  assert.equal(other.reason.message, 'Build box did not report this instance as reachable.');
  assert.equal(admit(sel(), { instances: [row({ addressable: false, savedRoute: true })] }).code, 'E_SNAPSHOT_UNKNOWN', 'a saved route does not override a 0.31 kernel\'s answer');
});

test('admission: no remote entry on this machine for the operation refuses before anything is sent', () => {
  for (const cli of [{ ...probe, remote: ['session'] }, { ...probe, remote: undefined }]) {
    const refused = admit(sel(), { cli });
    assert.equal(refused.code, 'unsupported-remote-operation');
    assert.equal(refused.reason.message, "This computer's OATS can't route this to Build box. Update OATS here.");
  }
  assert.equal(admit(sel(), { operation: undefined }).code, 'unsupported-remote-operation', 'an operation that never named its entry is not routed');
});

test('admission: a server/home mismatch, another group, or a local/remote crossing never resolves', () => {
  assert.equal(admit(sel({ server: 'other' })).code, 'E_SESSION_UNKNOWN', 'another server id');
  assert.equal(admit(sel({ server: null })).code, 'E_SESSION_UNKNOWN', 'a local selector in a remote workspace');
  assert.equal(admit(sel(), { instances: [row({ home: '/elsewhere/dev-b' })] }).code, 'E_HOME_MISMATCH');
  // The same server id, another group (route target): that group's rows are not this workspace's.
  const otherGroup = { ...remoteWs, id: 'remote:build:9c1d' };
  assert.equal(admit(sel(), { workspace: otherGroup, instances: [] }).code, 'E_SESSION_UNKNOWN');
  // A remote row in a local workspace's panel, and a remote workspace naming another server.
  const localWs = { id: '/w', name: 'w', scope: '/w' };
  assert.equal(admit(sel(), { workspace: localWs }).code, 'E_SESSION_UNKNOWN');
  assert.equal(admit(sel(), { workspace: { ...remoteWs, server: 'other' } }).code, 'E_SESSION_UNKNOWN');
  assert.equal(admit(sel(), { localCwd: 'relative' }).code, 'E_WORKSPACE_UNKNOWN');
});

test('a local OATS before 0.31 reports no addressable fact: a saved-route row keeps working as before, and a row without one says why accurately', () => {
  const older = remote({ addressable: undefined });
  assert.equal(canAddressRemote({ ...older, savedRoute: true }), true, 'spawned from here: routed by its saved route, as before 0.31');
  assert.equal(canAddressRemote({ ...older, savedRoute: false }), false);
  assert.equal(canAddressRemote(remote({ addressable: false, savedRoute: true })), false, 'a 0.31 kernel\'s explicit answer wins over the saved route');
  assert.equal(canAddressRemote(remote({ addressable: null, savedRoute: true })), false, 'only an absent fact falls back');
  assert.equal(rowReason({ ...older, savedRoute: false }).sentence,
    "This computer's OATS does not report whether Build box can reach this instance. Update OATS here.");
});
