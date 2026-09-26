// Desktop facts (feature desktop-facts, kernel #217) reach the renderer: the server's
// projections keep them, bounded, when the kernel reports them, and add nothing when it
// does not. Kernel captures: test/fixtures/workspace-v2/desktop-facts (main a0dfe761,
// scratch Northwind; campaign-writer disabled in oats-local.yaml; release-manager spawned
// --model fixture-model --no-launch). Local repositories, so every url is null.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as remote from '../server/remote-roster.mjs';
import { normalizeSoulColor } from '../renderer/soul-colors.mjs';
import { soulsData, capabilitiesData, workspaceStatusData, deploymentStatusData } from '../deployment-data.mjs';

const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/desktop-facts/${name}.json`, import.meta.url), 'utf8'));
const old = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/${name}.json`, import.meta.url), 'utf8'));
const DEPLOYMENT = '/fixture/base/northwind-workspace';
const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');

test('the capture is a desktop-facts kernel', () => {
  assert.ok(fx('version').features.includes('desktop-facts'));
});

test('souls: spawn default (the kernel\'s), spawnable + problem, and the soul file', () => {
  const souls = Object.fromEntries(soulsData(fx('souls')).souls.map(s => [s.name, s]));
  assert.deepEqual([souls['campaign-writer'].spawnable, souls['campaign-writer'].problem.code], [false, 'E_SOUL_DISABLED']);
  assert.match(souls['campaign-writer'].problem.message, /souls\.disabled/);
  const rm = souls['release-manager'];
  assert.deepEqual([rm.spawnable, rm.problem, rm.harness, rm.model, rm.harnessFrom], [true, null, 'pi', null, 'kernel-default']);
  assert.deepEqual(rm.file, { path: 'souls/release-manager/soul.yaml', url: null });
  const before = soulsData(fx('souls-before-disable')).souls.find(s => s.name === 'campaign-writer');
  assert.deepEqual([before.spawnable, before.problem], [true, null], 'the same soul, before this machine disabled it');
});

test('capabilities: description, what it provides, the manifest file and the member fingerprint', () => {
  const caps = Object.fromEntries(capabilitiesData(fx('capabilities')).capabilities.map(c => [c.name, c]));
  const member = caps['nw-release-tooling'], pkg = caps['nw-deploy'];
  assert.match(member.description, /release checklist/);
  assert.deepEqual([member.skills, member.commands, member.hooks], [['cut-release'], ['cut', 'verify'], []]);
  assert.deepEqual(member.file, { path: 'capabilities/nw-release-tooling/oats.json', url: null });
  assert.match(member.tree, /^[0-9a-f]{40}$/);
  assert.equal(pkg.kind, 'package'); assert.equal(pkg.tree, null, 'a package\'s fingerprint is its lock integrity');
  assert.deepEqual(pkg.commands, ['apply', 'plan']);
});

test('workspace status: the workspace file, member links, latest, defaults, clones, disabled souls and the lock', () => {
  const w = workspaceStatusData(fx('workspace-status'), DEPLOYMENT);
  assert.deepEqual(w.workspace.file, { path: 'oats-workspace.yaml', url: null });
  assert.deepEqual([w.members[0].url, w.members[0].membershipFile], [null, { path: 'oats-membership.yaml', url: null }]);
  assert.equal(w.packages[0].latest, null, 'a git: package has no catalog latest');
  assert.deepEqual(w.defaults.slots, { knowledge: { name: 'oats.okf', from: 'package' }, messaging: 'none', tasks: 'none' });
  assert.ok(w.defaults.capabilities.some(c => c.name === 'nw-house-style' && c.off === false));
  assert.ok(Array.isArray(w.defaults.byTeam.engineering.capabilities));
  assert.deepEqual(w.clones[0], { key: w.clones[0].key, name: 'agents', path: `${DEPLOYMENT}/agents-repo`, rule: 'convention' });
  assert.deepEqual(w.disabledSouls, ['campaign-writer']);
  assert.deepEqual(w.lock, { path: `${DEPLOYMENT}/oats-lock.json`, lockfileVersion: 3 });
  // An older kernel's status carries none of them: nothing is invented.
  const before = workspaceStatusData(old('f2/workspace-status'), '/fixture/base/northwind-workspace');
  for (const key of ['defaults', 'clones', 'disabledSouls', 'lock']) assert.equal(Object.hasOwn(before, key), false, key);
  assert.equal(Object.hasOwn(before.workspace, 'file'), false);
});

test('a malformed fact fails the read like any other protocol breach (bounded, never passed raw)', () => {
  const doc = fx('workspace-status');
  for (const change of [d => d.result.clones[0].rule = 'guess', d => d.result.clones[0].path = 'relative', d => d.result.lock.lockfileVersion = '3',
    d => d.result.defaults.slots.knowledge = { name: 1 }, d => d.result.workspace.file = 'oats-workspace.yaml']) {
    const bad = structuredClone(doc); change(bad);
    assert.throws(() => workspaceStatusData(bad, DEPLOYMENT), { code: 'E_CLI_PROTOCOL' });
  }
  const souls = structuredClone(fx('souls')); souls.result.souls[0].spawnable = 'no';
  assert.throws(() => soulsData(souls), { code: 'E_CLI_PROTOCOL' });
});

test('status → /api/panel: startedAt, modelFrom and identityAddress travel with the instance', () => {
  const roster = deploymentStatusData(fx('status'), DEPLOYMENT);
  const row = roster.agents.flatMap(a => a.instances)[0];
  assert.deepEqual([row.startedAt, row.modelFrom, row.identityAddress, row.model], [null, 'spawn', null, 'fixture-model']);
  const m = source.match(/\/\* OATSWEB_PANELPROJ_BEGIN[^*]*\*\/([\s\S]*?)\/\* OATSWEB_PANELPROJ_END \*\//);
  const project = new Function('dirname', m[1] + '\nreturn projectPanelInstance;')(dirname);
  const panel = project({ ...row, agentsRoot: roster.root });
  assert.deepEqual([panel.startedAt, panel.modelFrom, panel.identityAddress], [null, 'spawn', null]);
  const legacy = project({ ...row, agentsRoot: roster.root, startedAt: undefined, modelFrom: undefined, identityAddress: undefined });
  for (const key of ['startedAt', 'modelFrom', 'identityAddress']) assert.equal(Object.hasOwn(legacy, key), false, `${key}: absent, not invented`);
});

test('/api/agents: the kernel\'s spawn default is nested (never the soul\'s own harness/model), spawnable + problem, file', () => {
  const start = source.indexOf('function agentsData('), end = source.indexOf('/* ── Model catalog', start);
  const agentsData = new Function('workspaceById', 'workspaces', 'snapshot', 'remote', 'dirname', 'resolve', 'normalizeSoulColor',
    `${source.slice(start, end)}; return agentsData;`);
  const roster = deploymentStatusData(fx('status'), DEPLOYMENT), catalog = soulsData(fx('souls'));
  const snapshot = { byWs: new Map([[DEPLOYMENT, { deployment: { status: 'observed', root: roster.root, souls: roster.agents.map(({ instances: _i, ...s }) => s),
    catalog: { souls: catalog.souls, ambiguous: [], reason: null } } }]]) };
  const ws = { id: DEPLOYMENT, name: 'northwind', roots: [roster.root] };
  const rows = Object.fromEntries(agentsData(() => ws, () => [ws], snapshot, remote, dirname, resolve, normalizeSoulColor)().agents.map(a => [a.name, a]));
  const rm = rows['release-manager'], cw = rows['campaign-writer'];
  assert.deepEqual(rm.spawnDefault, { harness: 'pi', model: null, harnessFrom: 'kernel-default' });
  assert.equal(Object.hasOwn(rm, 'harness'), false, 'not presented as the soul\'s own default harness');
  assert.equal(Object.hasOwn(rm, 'model'), false);
  assert.deepEqual([rm.spawnable, rm.problem, cw.spawnable, cw.problem.code], [true, null, false, 'E_SOUL_DISABLED']);
  assert.deepEqual(rm.file, { path: 'souls/release-manager/soul.yaml', url: null });
  // An older kernel's catalog rows: no facts, no keys.
  const older = soulsData(old('f3/souls')).souls;
  const snap2 = { byWs: new Map([[DEPLOYMENT, { deployment: { ...snapshot.byWs.get(DEPLOYMENT).deployment, catalog: { souls: older, ambiguous: [], reason: null } } }]]) };
  const legacy = agentsData(() => ws, () => [ws], snap2, remote, dirname, resolve, normalizeSoulColor)().agents[0];
  for (const key of ['spawnDefault', 'spawnable', 'problem', 'file']) assert.equal(Object.hasOwn(legacy, key), false, key);
});
