// Package souls (feature package-souls, 0.28) in the roster, and the kernel's soul key
// (lib/teams.mjs soulKeyOf): the qualified name `<package>/<soul>` for a package soul, the bare
// name otherwise. Fixtures: team-model-v2/package-souls/, REAL captures (provenance.json) from the
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

test('oats souls with a package soul reads (it used to refuse the WHOLE catalog), and every row carries the kernel\'s key', () => {
  const souls = soulsData(read('souls-after')).souls;
  assert.deepEqual(souls.map(s => [s.kind, s.name, s.key]), [['member', 'dev', 'dev'], ['package', 'keeper', 'acme.pkg/keeper']]);
  const k = souls[1];
  assert.deepEqual([k.package, k.version, k.qualifiedName, k.work], ['acme.pkg', '1.0.0', 'acme.pkg/keeper', 'directory']);
  assert.deepEqual([k.teams.map(t => [t.label, t.default]), k.defaultTeam], [[['global', true]], { label: 'global', team: null, from: 'soul' }]);
  assert.equal(Object.hasOwn(souls[0], 'qualifiedName') || Object.hasOwn(souls[0], 'package'), false, 'a member soul has no package fields');
  // 0.29 rows (no package souls) carry the key too: the bare name.
  const v29 = JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/desktop-facts/souls.json', import.meta.url), 'utf8'));
  for (const s of soulsData(v29).souls) assert.equal(s.key, s.name);
});

test('the roster key is the key the kernel\'s oats soul teams reports, by qualified or bare name', () => {
  const key = soulsData(read('souls-after')).souls.find(s => s.kind === 'package').key;
  assert.equal(read('soul-teams-package-show').result.key, key);
  assert.equal(read('soul-teams-bare-show').result.key, key, 'the bare name resolves to the same key');
  assert.deepEqual(read('soul-teams-package-show').result.teams.map(t => [t.label, t.via]), [['global', ['default', 'soul']]]);
});

test('a malformed package row refuses the document; package fields never appear on another kind', () => {
  for (const change of [s => { s.qualifiedName = 'other.pkg/keeper'; }, s => { delete s.qualifiedName; }, s => { s.package = 'Acme Pkg'; },
    s => { s.version = ''; }, s => { s.kind = 'member'; }, s => { delete s.package; }]) {
    const doc = read('souls-after'); change(keeper(doc)); assert.throws(() => soulsData(doc), { code: 'E_CLI_PROTOCOL' });
  }
  const member = read('souls-after'); member.result.souls[0].qualifiedName = 'x/dev'; assert.throws(() => soulsData(member), { code: 'E_CLI_PROTOCOL' });
});

test('duplicates are judged by the kernel key: a package soul never collides with a member of the same bare name', () => {
  const doc = read('souls-after');
  doc.result.souls.push({ ...structuredClone(doc.result.souls[0]), name: 'keeper', path: 'souls/keeper' }); // a member soul also named keeper
  const r = soulsData(doc);
  assert.deepEqual(r.souls.map(s => s.key).sort(), ['acme.pkg/keeper', 'dev', 'keeper']);
  assert.deepEqual(r.ambiguous, []);
  const twice = read('souls-after'); twice.result.souls.push(structuredClone(twice.result.souls[0]));
  assert.deepEqual(soulsData(twice).ambiguous, ['dev'], 'two rows with one key are still ambiguous');
});

test('/api/agents carries key, package, version, qualifiedName; oats soul teams takes the key as argv', async () => {
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function agentsData('), end = source.indexOf('/* ── Model catalog', start);
  const agentsData = new Function('workspaceById', 'workspaces', 'snapshot', 'remote', 'dirname', 'resolve', 'normalizeSoulColor', `${source.slice(start, end)}; return agentsData;`);
  const souls = soulsData(read('souls-after')).souls, roster = deploymentStatusData(read('status'), DEPLOYMENT);
  const snapshot = { byWs: new Map([[DEPLOYMENT, { deployment: { status: 'observed', root: roster.root, souls: roster.agents.map(({ instances: _i, ...s }) => s), catalog: { souls, ambiguous: [], reason: null } } }]]) };
  const ws = { id: DEPLOYMENT, name: 'acme', roots: [roster.root] };
  const agents = agentsData(() => ws, () => [ws], snapshot, remote, dirname, resolve, normalizeSoulColor)().agents;
  const k = agents.find(a => a.soulKind === 'package'), dev = agents.find(a => a.name === 'dev');
  assert.deepEqual([k.name, k.key, k.package, k.version, k.qualifiedName, k.repoName], ['keeper', 'acme.pkg/keeper', 'acme.pkg', '1.0.0', 'acme.pkg/keeper', 'package acme.pkg']);
  assert.deepEqual([dev.key, Object.hasOwn(dev, 'qualifiedName')], ['dev', false]);
  const calls = [];
  await cliSoulTeams('/oats', { soul: k.key, add: ['global'], workspaceDir: DEPLOYMENT }, { exec: (b, argv, o, done) => { calls.push(argv); done(null, JSON.stringify({ schemaVersion: 1, ok: true, result: {} })); } });
  assert.deepEqual(calls, [['soul', 'teams', 'acme.pkg/keeper', '--add=global', '--dir', DEPLOYMENT, '--json']]);
});
