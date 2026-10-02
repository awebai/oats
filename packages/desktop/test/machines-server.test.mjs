// #517: a workspace's own machines on the server side — filtering by the window's key, the one-time
// backfill of unknown keys, and the check/remove/connect admissions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMachines } from '../server/machines.mjs';

const KEY = 'github.com/awebai/ac', OTHER = 'github.com/GreaterSkies/tsm';
const CLI = { ok: true, bin: '/oats', features: ['workspace-identity', 'servers-per-workspace', 'server-connect', 'capability-route'] };
const SCOPE = { key: KEY, deployment: '/Users/j/Agents/aweb', messaging: 'oats.aweb' };
const reg = (id, workspaceKey, extra = {}) => ({ id, sshHost: id.split('-')[0], workspace: `/srv/${id}`, label: id.split('-')[0], workspaceKey, ...extra });
const ok = result => ({ schemaVersion: 1, ok: true, result });
const fail = (code, message, details) => ({ schemaVersion: 1, ok: false, error: { code, message, ...(details ? { details } : {}) } });

function fakeAdapter(rows) {
  const calls = [];
  let release = null;
  const adapter = {
    calls, rows,
    hold() { let open; const gate = new Promise(r => { open = r; }); release = gate; return open; },
    cliServers: async (bin, io) => { calls.push(['list', io?.cwd]); return ok({ file: '/h/.oats/servers.json', servers: adapter.rows }); },
    cliServerCheck: async (bin, id, io) => {
      calls.push(['check', id]); if (release) await release;
      const row = adapter.rows.find(r => r.id === id);
      if (id.startsWith('down')) return fail('E_SSH', `ssh to ${row.sshHost} failed: timeout`);
      if (row && row.workspaceKey === null) row.workspaceKey = row.reports ?? KEY;
      return ok({ id, target: {}, remote: { version: '0.39.0' }, workspaceReachable: true, agents: 2 });
    },
    cliServerRemove: async (bin, id) => { calls.push(['remove', id]); adapter.rows = adapter.rows.filter(r => r.id !== id); return ok({ removed: id, remoteInstancesStillTracked: [] }); },
    cliServerConnect: async (bin, args) => { calls.push(['connect', args]); return ok({ id: args.id, ready: true, steps: [{ step: 'register', status: 'done' }] }); },
    cliAwebConnect: async (bin, args) => { calls.push(['aweb', args]); return ok({ server: args.id, ready: true, steps: [{ step: 'aw', status: 'ok' }] }); },
  };
  return adapter;
}
const settle = () => new Promise(r => setImmediate(r));

test('Where to run lists only the registrations whose key is the window\'s: another workspace and an unknown key are not offered', async () => {
  const adapter = fakeAdapter([reg('altair-aweb', KEY), reg('altair-tsm', OTHER), reg('vega-x', null)]);
  const machines = createMachines({ adapter, cli: () => CLI });
  const listed = await machines.forScope(SCOPE);
  assert.deepEqual(listed.servers.map(s => s.id), ['altair-aweb']);
  assert.deepEqual(listed.servers[0], { id: 'altair-aweb', label: 'altair', sshHost: 'altair', workspace: '/srv/altair-aweb', workspaceKey: KEY, check: null });
  assert.equal(listed.key, KEY); assert.equal(listed.filtered, true);
  assert.equal(listed.deployment, SCOPE.deployment); assert.equal(listed.aweb, true, 'oats.aweb messaging and capability-route');
  assert.equal((await machines.forScope({ ...SCOPE, messaging: 'other.mail' })).aweb, false);
  assert.equal(adapter.calls[0][1], SCOPE.deployment, 'read in the deployment\'s scope');
});

test('without a key the window offers no remote machine, and says why', async () => {
  const adapter = fakeAdapter([reg('altair-aweb', KEY)]);
  const machines = createMachines({ adapter, cli: () => CLI });
  const listed = await machines.forScope({ key: null, deployment: '/w', reason: 'no-key' });
  assert.deepEqual(listed.servers, []); assert.equal(listed.deployment, null); assert.equal(listed.aweb, false);
  assert.equal(listed.reason, 'This deployment reports no workspace key, so no other machine can be matched to it.');
  const remoteOnly = await machines.forScope({ key: null, deployment: null, reason: 'no-local' });
  assert.equal(remoteOnly.reason, 'This workspace has no deployment on this computer, so machines are added from one that does.');
});

test('gates off: no answer from this module (the caller keeps today\'s behaviour), and nothing is run', async () => {
  const adapter = fakeAdapter([reg('altair-aweb', KEY)]);
  const machines = createMachines({ adapter, cli: () => ({ ...CLI, features: ['servers-per-workspace'] }) });
  assert.equal(await machines.forScope(SCOPE), null);
  assert.deepEqual(adapter.calls, []);
});

test('backfill: each unknown key is checked once per start, at most two at a time, in the background; the next read sees the keys', async () => {
  const adapter = fakeAdapter([reg('altair-aweb', KEY), reg('b1-x', null), reg('b2-x', null), reg('b3-x', null, { reports: OTHER })]);
  const open = adapter.hold();
  const machines = createMachines({ adapter, cli: () => CLI });
  const first = await machines.forScope(SCOPE);
  assert.deepEqual(first.servers.map(s => s.id), ['altair-aweb'], 'the read does not wait for the backfill');
  await settle();
  assert.deepEqual(adapter.calls.filter(c => c[0] === 'check').map(c => c[1]), ['b1-x', 'b2-x'], 'bounded: two in flight');
  open(); await machines.backfilled();
  assert.deepEqual(adapter.calls.filter(c => c[0] === 'check').map(c => c[1]), ['b1-x', 'b2-x', 'b3-x']);
  const after = await machines.forScope(SCOPE);
  assert.deepEqual(after.servers.map(s => s.id), ['altair-aweb', 'b1-x', 'b2-x'], 'b3 reported another workspace');
  assert.equal(after.servers[1].check.version, '0.39.0', 'a backfill check is a check');
  await machines.forScope(SCOPE); await machines.backfilled();
  assert.equal(adapter.calls.filter(c => c[0] === 'check').length, 3, 'never again this start');
});

test('check: an id of this workspace or of an unknown key; never another workspace\'s; the facts are kept', async () => {
  const adapter = fakeAdapter([reg('altair-aweb', KEY), reg('altair-tsm', OTHER), reg('down-x', KEY), reg('vega-x', null)]);
  const machines = createMachines({ adapter, cli: () => CLI, backfill: false });
  const checked = await machines.check(SCOPE, 'altair-aweb');
  assert.deepEqual(checked, { id: 'altair-aweb', check: { reachable: true, version: '0.39.0', error: null } });
  assert.deepEqual((await machines.check(SCOPE, 'down-x')).check, { reachable: false, version: null, error: 'ssh to down failed: timeout' });
  assert.equal((await machines.check(SCOPE, 'vega-x')).check.reachable, true, 'an unknown key may be checked (the backfill)');
  await assert.rejects(machines.check(SCOPE, 'altair-tsm'), { code: 'E_SERVER_OTHER_WORKSPACE' });
  await assert.rejects(machines.check(SCOPE, 'nosuch'), { code: 'E_SERVER_UNKNOWN' });
  await assert.rejects(machines.check({ key: null, deployment: '/w', reason: 'no-key' }, 'altair-aweb'), { code: 'E_NO_WORKSPACE_KEY' });
  assert.deepEqual(adapter.calls.filter(c => c[0] === 'check').map(c => c[1]), ['altair-aweb', 'down-x', 'vega-x']);
  const listed = await machines.forScope(SCOPE);
  assert.deepEqual(listed.servers.find(s => s.id === 'down-x').check, { reachable: false, version: null, error: 'ssh to down failed: timeout' });
});

test('remove: this workspace\'s registrations only; the envelope is relayed', async () => {
  const adapter = fakeAdapter([reg('altair-aweb', KEY), reg('vega-x', null), reg('altair-tsm', OTHER)]);
  const machines = createMachines({ adapter, cli: () => CLI, backfill: false });
  await assert.rejects(machines.remove(SCOPE, 'vega-x'), { code: 'E_SERVER_OTHER_WORKSPACE' });
  await assert.rejects(machines.remove(SCOPE, 'altair-tsm'), { code: 'E_SERVER_OTHER_WORKSPACE' });
  assert.deepEqual(await machines.remove(SCOPE, 'altair-aweb'), ok({ removed: 'altair-aweb', remoteInstancesStillTracked: [] }));
  assert.deepEqual(adapter.calls.filter(c => c[0] === 'remove'), [['remove', 'altair-aweb']]);
});

test('connect: runs in the window\'s deployment with the fields as typed; the aweb phase only for oats.aweb messaging and capability-route', async () => {
  const adapter = fakeAdapter([]);
  const machines = createMachines({ adapter, cli: () => CLI, backfill: false });
  const fields = { id: 'altair-aweb', host: 'altair', folder: '~/Agents/aweb', installOats: true };
  assert.equal((await machines.connect(SCOPE, { phase: 'connect', ...fields })).ok, true);
  assert.deepEqual(adapter.calls.at(-1), ['connect', { ...fields, workspaceDir: SCOPE.deployment }]);
  adapter.rows = [reg('altair-aweb', KEY), reg('vega-x', null)];
  assert.equal((await machines.connect(SCOPE, { phase: 'aweb', id: 'altair-aweb' })).ok, true);
  assert.deepEqual(adapter.calls.at(-1), ['aweb', { id: 'altair-aweb', workspaceDir: SCOPE.deployment }]);
  await assert.rejects(machines.connect({ ...SCOPE, messaging: 'other.mail' }, { phase: 'aweb', id: 'altair-aweb' }), { code: 'E_NOT_AWEB' });
  await assert.rejects(createMachines({ adapter, cli: () => ({ ...CLI, features: ['servers-per-workspace', 'server-connect'] }), backfill: false })
    .connect(SCOPE, { phase: 'aweb', id: 'altair-aweb' }), { code: 'E_NOT_AWEB' });
  await assert.rejects(machines.connect(SCOPE, { phase: 'aweb', id: 'vega-x' }), { code: 'E_SERVER_OTHER_WORKSPACE' }, 'aweb connects a registration of this workspace');
  await assert.rejects(machines.connect(SCOPE, { phase: 'connect', ...fields, host: 'juan@altair' }), { code: 'E_BAD_ARGS' });
  await assert.rejects(machines.connect(SCOPE, { phase: 'other', ...fields }), { code: 'E_BAD_ARGS' });
  await assert.rejects(machines.connect({ key: null, deployment: '/w', reason: 'no-key' }, { phase: 'connect', ...fields }), { code: 'E_NO_WORKSPACE_KEY' });
});

test('connect: one run per machine at a time (a second press while one runs is refused, not queued)', async () => {
  const adapter = fakeAdapter([]);
  let open; const gate = new Promise(r => { open = r; });
  adapter.cliServerConnect = async (bin, args) => { await gate; return ok({ id: args.id, ready: true, steps: [] }); };
  const machines = createMachines({ adapter, cli: () => CLI, backfill: false });
  const fields = { phase: 'connect', id: 'altair-aweb', host: 'altair', folder: '~/Agents/aweb', installOats: true };
  const first = machines.connect(SCOPE, fields);
  await assert.rejects(machines.connect(SCOPE, fields), { code: 'E_BUSY' });
  open(); assert.equal((await first).ok, true);
  assert.equal((await machines.connect(SCOPE, fields)).ok, true, 'free again once it answered');
});

test('gates off: check, remove and connect are refused before anything runs', async () => {
  const adapter = fakeAdapter([reg('altair-aweb', KEY)]);
  const machines = createMachines({ adapter, cli: () => ({ ...CLI, features: [] }) });
  await assert.rejects(machines.check(SCOPE, 'altair-aweb'), { code: 'E_FEATURE' });
  await assert.rejects(machines.remove(SCOPE, 'altair-aweb'), { code: 'E_FEATURE' });
  await assert.rejects(machines.connect(SCOPE, { phase: 'connect', id: 'a', host: 'a', folder: '~/a' }), { code: 'E_FEATURE' });
  assert.deepEqual(adapter.calls, []);
});
