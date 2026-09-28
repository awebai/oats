// Package souls (feature package-souls, 0.28) in the roster, and the soul key. The key is the
// KERNEL's (the owner's decision): `oats souls` rows and status agents will carry `key`, exactly the
// name the soul is spawned by. Until they do, a member soul falls back to its bare name, and a package
// or external soul has no key: the Desktop never derives one. Fixtures: team-model-v2/package-souls/, REAL captures (provenance.json) from the
// kernel's own test helpers: member soul dev, package acme.pkg v1.0.0 shipping soul keeper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { soulsData, deploymentStatusData } from '../deployment-data.mjs';
import { cliSoulTeams } from '../cli-adapter.mjs';
import * as remote from '../server/remote-roster.mjs';
import { normalizeSoulColor } from '../renderer/soul-colors.mjs';

const read = name => JSON.parse(readFileSync(new URL(`./fixtures/team-model-v2/package-souls/${name}.json`, import.meta.url), 'utf8'));
const DEPLOYMENT = '/fixture/base/deployment';
const keeper = doc => doc.result.souls.find(s => s.kind === 'package');

// A derived scenario (marked): the real capture with the kernel's decided `key` added to each row.
const withKernelKeys = doc => { for (const s of doc.result.souls) s.key = s.kind === 'package' ? s.qualifiedName : s.name; return doc; };

test('oats souls with a package soul reads (it used to refuse the WHOLE catalog); without a kernel key, only a member soul has one', () => {
  const souls = soulsData(read('souls-after')).souls;
  assert.deepEqual(souls.map(s => [s.kind, s.name, s.key ?? null]), [['member', 'dev', 'dev'], ['package', 'keeper', null]], 'no derived package key');
  const k = souls[1];
  assert.deepEqual([k.package, k.version, k.qualifiedName, k.work], ['acme.pkg', '1.0.0', 'acme.pkg/keeper', 'directory']);
  assert.deepEqual([k.teams.map(t => [t.label, t.default]), k.defaultTeam], [[['global', true]], { label: 'global', team: null, from: 'soul' }]);
  assert.equal(Object.hasOwn(souls[0], 'qualifiedName') || Object.hasOwn(souls[0], 'package'), false, 'a member soul has no package fields');
  const v29 = JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/desktop-facts/souls.json', import.meta.url), 'utf8'));
  for (const s of soulsData(v29).souls) assert.equal(s.key ?? null, s.kind === 'member' ? s.name : null, 'member → name; external → none');
});

test('the kernel\'s key is used when reported (derived scenario), validated; it is what oats soul teams reports', () => {
  const souls = soulsData(withKernelKeys(read('souls-after'))).souls;
  assert.deepEqual(souls.map(s => s.key), ['dev', 'acme.pkg/keeper']);
  assert.equal(souls[1].key, read('soul-teams-package-show').result.key, 'the kernel\'s soul teams key');
  assert.equal(read('soul-teams-bare-show').result.key, souls[1].key, 'the bare name resolves to the same key');
  const member = withKernelKeys(read('souls-after')); member.result.souls[0].key = 'ws/dev';
  assert.equal(soulsData(member).souls[0].key, 'ws/dev', 'an ambiguous member\'s <member>/<soul> key passes through');
  for (const bad of ['*', 'Acme.pkg/keeper', '-x', 'a/b/c', '', 7, 'k'.repeat(257)]) {
    const doc = withKernelKeys(read('souls-after')); doc.result.souls[1].key = bad; assert.throws(() => soulsData(doc), { code: 'E_CLI_PROTOCOL' }, String(bad));
  }
  const st = read('status'); st.agents[0].key = 'acme.pkg/keeper';
  assert.equal(deploymentStatusData(st, DEPLOYMENT).agents[0].key, 'acme.pkg/keeper', 'status agents carry it too');
  const bad = read('status'); bad.agents[0].key = '--x'; assert.throws(() => deploymentStatusData(bad, DEPLOYMENT), { code: 'E_CLI_PROTOCOL' });
  assert.equal(Object.hasOwn(deploymentStatusData(read('status'), DEPLOYMENT).agents[0], 'key'), false, 'not invented');
});

test('a malformed package row refuses the document; package fields never appear on another kind', () => {
  for (const change of [s => { s.qualifiedName = 'other.pkg/keeper'; }, s => { delete s.qualifiedName; }, s => { s.package = 'Acme Pkg'; },
    s => { s.version = ''; }, s => { s.kind = 'member'; }, s => { delete s.package; }]) {
    const doc = read('souls-after'); change(keeper(doc)); assert.throws(() => soulsData(doc), { code: 'E_CLI_PROTOCOL' });
  }
  const member = read('souls-after'); member.result.souls[0].qualifiedName = 'x/dev'; assert.throws(() => soulsData(member), { code: 'E_CLI_PROTOCOL' });
});

test('duplicates are judged per soul: a package soul never collides with a member of the same bare name', () => {
  const doc = read('souls-after');
  doc.result.souls.push({ ...structuredClone(doc.result.souls[0]), name: 'keeper', path: 'souls/keeper' }); // a member soul also named keeper
  const r = soulsData(doc);
  assert.deepEqual(r.souls.map(s => `${s.kind}:${s.name}`).sort(), ['member:dev', 'member:keeper', 'package:keeper']);
  assert.deepEqual(r.ambiguous, []);
  const twice = read('souls-after'); twice.result.souls.push(structuredClone(twice.result.souls[0]));
  assert.deepEqual(soulsData(twice).ambiguous, ['dev'], 'two rows of one soul are still ambiguous');
  const ext = read('souls-after'); ext.result.souls.push({ ...structuredClone(ext.result.souls[0]), kind: 'external', origin: 'external elsewhere' });
  assert.deepEqual(soulsData(ext).ambiguous, ['dev'], 'a member and an external soul of one bare name: never guess which one spawns');
});

test('/api/agents carries key (the kernel\'s, or a member\'s name), package, version, qualifiedName; oats soul teams takes the key as argv', async () => {
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function agentsData('), end = source.indexOf('/* ── Model catalog', start);
  const agentsData = new Function('workspaceById', 'workspaces', 'snapshot', 'remote', 'dirname', 'resolve', 'normalizeSoulColor', `${source.slice(start, end)}; return agentsData;`);
  const roster = deploymentStatusData(read('status'), DEPLOYMENT), ws = { id: DEPLOYMENT, name: 'acme', roots: [roster.root] };
  const agentsOf = souls => agentsData(() => ws, () => [ws], { byWs: new Map([[DEPLOYMENT, { deployment: { status: 'observed', root: roster.root,
    souls: roster.agents.map(({ instances: _i, ...s }) => s), catalog: { souls, ambiguous: [], reason: null } } }]]) }, remote, dirname, resolve, normalizeSoulColor)().agents;
  const now = agentsOf(soulsData(read('souls-after')).souls), k = now.find(a => a.soulKind === 'package'), dev = now.find(a => a.name === 'dev');
  assert.deepEqual([k.name, Object.hasOwn(k, 'key'), k.package, k.version, k.qualifiedName, k.repoName], ['keeper', false, 'acme.pkg', '1.0.0', 'acme.pkg/keeper', 'package acme.pkg']);
  assert.deepEqual([dev.key, Object.hasOwn(dev, 'qualifiedName')], ['dev', false]);
  const later = agentsOf(soulsData(withKernelKeys(read('souls-after'))).souls).find(a => a.soulKind === 'package');
  assert.equal(later.key, 'acme.pkg/keeper', 'the kernel\'s key reaches the roster');
  const calls = [];
  await cliSoulTeams('/oats', { soul: later.key, add: ['global'], workspaceDir: DEPLOYMENT }, { exec: (b, argv, o, done) => { calls.push(argv); done(null, JSON.stringify({ schemaVersion: 1, ok: true, result: {} })); } });
  assert.deepEqual(calls, [['soul', 'teams', 'acme.pkg/keeper', '--add=global', '--dir', DEPLOYMENT, '--json']]);
});
