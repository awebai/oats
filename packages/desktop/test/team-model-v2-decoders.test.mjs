// Team model v2 (feature team-model-2, OATS 0.30) decoders (D1b): `oats teams`, `oats soul teams`,
// the souls/preview teams + defaultTeam, and the argv adapters. Fixtures: team-model-v2/ (stand-ins,
// PROVENANCE.md) and the real 0.29 captures with the v2 keys edited in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { teamsData, soulTeamsData, soulsData, deploymentStatusData } from '../deployment-data.mjs';
import { previewData } from '../renderer/spawn-preview-contract.mjs';
import { defaultTeamOf } from '../renderer/team-rows.mjs';
import { cliTeams, cliSoulTeams } from '../cli-adapter.mjs';
import * as remote from '../server/remote-roster.mjs';
import { normalizeSoulColor } from '../renderer/soul-colors.mjs';
import { target } from './helpers/spawn-preview-fixture.mjs';

const read = path => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url), 'utf8'));
const ROWS = [{ label: 'antares-oats', team: 'antares-oats:juan.aweb.ai', default: true, from: 'local' }, { label: 'oats', team: 'oats:oats.aweb.ai', default: false, from: 'shared' },
  { label: 'reviewers', team: null, default: false, from: 'shared' }];
const DEFAULT = { label: 'antares-oats', team: 'antares-oats:juan.aweb.ai', from: 'deployment' };

test('oats teams: this deployment\'s teams, souls.teams/default as written, problems; bound to the deployment', () => {
  const t = teamsData(read('team-model-v2/teams'), '/w');
  assert.equal(t.defaultTeam, 'antares-oats');
  assert.deepEqual(t.teams.map(r => [r.label, r.team, r.from, r.default]), [['antares-oats', 'antares-oats:juan.aweb.ai', 'local', true], ['oats', 'oats:oats.aweb.ai', 'shared', false], ['reviewers', null, 'shared', false]]);
  assert.equal(t.teams[1].description, 'The OATS project'); assert.match(t.teams[0].at, /^oats-local\.yaml#/);
  assert.deepEqual(t.souls, { teams: { '*': ['oats'], 'oats-expert': ['reviewers'] }, default: { 'oats-expert': 'oats' } });
  assert.deepEqual(t.problems, [{ code: 'team-unmapped', label: 'reviewers', message: 'shared team reviewers has no provider id yet', fix: 'its owner runs `oats aweb setup`, then commits the id', default: false }]);
  const mutated = structuredClone(read('team-model-v2/teams')); mutated.result.changed = true;
  assert.equal(teamsData(mutated, '/w').changed, true);
  assert.throws(() => teamsData(read('team-model-v2/teams'), '/other'), { code: 'E_DEPLOYMENT_SCOPE' });
  for (const change of [d => { d.result.teams[0].from = 'global'; }, d => { d.result.teams[1].default = true; }, d => { d.result.teams[0].label = '-x'; },
    d => { d.result.souls.teams['*'] = ['oats', 'oats']; }, d => { d.result.teamsApi = 2; }, d => { d.result.changed = 'yes'; }, d => { d.result.problems[0].severity = 'meh'; }]) {
    const bad = structuredClone(read('team-model-v2/teams')); change(bad); assert.throws(() => teamsData(bad, '/w'), { code: 'E_CLI_PROTOCOL' });
  }
});

test('oats soul teams: rows with via (in the kernel\'s order), the default, local and all', () => {
  const s = soulTeamsData(read('team-model-v2/soul-teams'));
  assert.deepEqual([s.soul, s.key, s.defaultTeam], ['oats-expert', 'oats-expert', { label: 'oats', team: 'oats:oats.aweb.ai', from: 'soul' }]);
  assert.deepEqual(s.teams.map(r => [r.label, r.default, r.via]), [['oats', true, ['default', '*']], ['reviewers', false, ['soul']]]);
  assert.equal(s.teams[1].mapped, false, 'an unmapped shared team');
  assert.deepEqual([s.local, s.all], [{ teams: ['reviewers'], default: 'oats' }, ['oats']]);
  const none = structuredClone(read('team-model-v2/soul-teams')); none.result.defaultTeam = null; assert.equal(soulTeamsData(none).defaultTeam, null);
  for (const change of [d => { d.result.teams[0].via = ['*', 'default']; }, d => { d.result.teams[0].via = []; }, d => { d.result.teams[0].via = ['team']; },
    d => { d.result.defaultTeam.from = 'setting'; }, d => { delete d.result.teams[0].default; }, d => { d.result.local.default = 7; }]) {
    const bad = structuredClone(read('team-model-v2/soul-teams')); change(bad); assert.throws(() => soulTeamsData(bad), { code: 'E_CLI_PROTOCOL' });
  }
});

test('souls rows and /api/agents: teams (the default first) and defaultTeam pass through; 0.29 rows unchanged', () => {
  const doc = read('workspace-v2/desktop-facts/souls'), v2 = structuredClone(doc);
  for (const row of v2.result.souls) { delete row.team; delete row.labels; row.teams = structuredClone(ROWS); row.defaultTeam = { ...DEFAULT }; }
  const souls = soulsData(v2).souls;
  assert.deepEqual(souls[0].teams.map(t => [t.label, t.default, t.mapped]), [['antares-oats', true, true], ['oats', false, true], ['reviewers', false, false]]);
  assert.deepEqual(souls[0].defaultTeam, DEFAULT);
  for (const s of soulsData(doc).souls) assert.equal(Object.hasOwn(s, 'teams') || Object.hasOwn(s, 'defaultTeam'), false, '0.29: no v2 keys invented');
  const bad = structuredClone(v2); bad.result.souls[0].teams[0] = { label: 'x', team: 't', mapped: true }; // a 0.29 row in a v2 list
  assert.throws(() => soulsData(bad), { code: 'E_CLI_PROTOCOL' });
  const badDefault = structuredClone(v2); badDefault.result.souls[0].defaultTeam = { team: 't', source: 'root' };
  assert.throws(() => soulsData(badDefault), { code: 'E_CLI_PROTOCOL' });
  // /api/agents carries them.
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function agentsData('), end = source.indexOf('/* ── Model catalog', start);
  const agentsData = new Function('workspaceById', 'workspaces', 'snapshot', 'remote', 'dirname', 'resolve', 'normalizeSoulColor', `${source.slice(start, end)}; return agentsData;`);
  const DEPLOYMENT = '/fixture/base/northwind-workspace', roster = deploymentStatusData(read('workspace-v2/desktop-facts/status'), DEPLOYMENT);
  const snapshot = { byWs: new Map([[DEPLOYMENT, { deployment: { status: 'observed', root: roster.root, souls: roster.agents.map(({ instances: _i, ...s }) => s), catalog: { souls, ambiguous: [], reason: null } } }]]) };
  const ws = { id: DEPLOYMENT, name: 'northwind', roots: [roster.root] };
  const agent = agentsData(() => ws, () => [ws], snapshot, remote, dirname, resolve, normalizeSoulColor)().agents[0];
  assert.deepEqual([agent.teams.length, agent.teams[0].default, agent.defaultTeam.label], [3, true, 'antares-oats']);
});

test('spawn preview: defaultTeam is the kernel\'s DefaultTeam (or null); absent on 0.29; malformed refuses the preview', () => {
  const v29 = read('workspace-v2/f7/preview-teams-default').result;
  assert.equal(Object.hasOwn(previewData(structuredClone(v29), target), 'defaultTeam'), false);
  const v2 = structuredClone(v29); delete v2.team; v2.teams = structuredClone(ROWS); v2.defaultTeam = { ...DEFAULT };
  assert.deepEqual(previewData(v2, target).defaultTeam, DEFAULT);
  const unmapped = structuredClone(v2); unmapped.defaultTeam = { label: 'reviewers', team: null, from: 'soul' };
  assert.deepEqual(previewData(unmapped, target).defaultTeam, { label: 'reviewers', team: null, from: 'soul' });
  const none = structuredClone(v2); none.defaultTeam = null; assert.equal(previewData(none, target).defaultTeam, null);
  const bad = structuredClone(v2); bad.defaultTeam = { label: 'x', team: 't', from: 'root' }; assert.equal(previewData(bad, target), null);
  assert.equal(defaultTeamOf({ label: 'x', team: 't' }), undefined);
});

test('argv: oats teams and oats soul teams, validated before any exec, never option-shaped', async () => {
  const calls = [], exec = (bin, argv, opts, done) => { calls.push(argv); done(null, JSON.stringify({ schemaVersion: 1, ok: true, result: {} })); };
  const ws = '/w';
  await cliTeams('/oats', { workspaceDir: ws }, { exec });
  await cliTeams('/oats', { action: 'add', label: 'antares-oats', team: 'antares-oats:juan.aweb.ai', description: 'Mine', workspaceDir: ws }, { exec });
  await cliTeams('/oats', { action: 'remove', label: 'old', workspaceDir: ws }, { exec });
  await cliTeams('/oats', { action: 'default', label: 'oats', workspaceDir: ws }, { exec });
  await cliSoulTeams('/oats', { soul: 'oats-expert', add: ['oats', 'reviewers'], remove: ['old'], defaultLabel: 'oats', workspaceDir: ws }, { exec });
  await cliSoulTeams('/oats', { soul: 'oats.okf/harvester', clearDefault: true, workspaceDir: ws }, { exec });
  await cliSoulTeams('/oats', { soul: '*', add: ['oats'], workspaceDir: ws }, { exec });
  assert.deepEqual(calls, [
    ['teams', '--dir', ws, '--json'],
    ['teams', 'add', 'antares-oats', '--team=antares-oats:juan.aweb.ai', '--description=Mine', '--dir', ws, '--json'],
    ['teams', 'remove', 'old', '--dir', ws, '--json'], ['teams', 'default', 'oats', '--dir', ws, '--json'],
    ['soul', 'teams', 'oats-expert', '--add=oats,reviewers', '--remove=old', '--default=oats', '--dir', ws, '--json'],
    ['soul', 'teams', 'oats.okf/harvester', '--clear-default', '--dir', ws, '--json'],
    ['soul', 'teams', '*', '--add=oats', '--dir', ws, '--json']]);
  const never = { exec: () => assert.fail('must not execute') };
  for (const bad of [{ action: 'add', label: 'x', team: '-rf', workspaceDir: ws }, { action: 'add', label: 'x', team: '--json', workspaceDir: ws },
    { action: 'default', label: '--default', workspaceDir: ws }, { action: 'add', label: 'x', team: 'no-namespace', workspaceDir: ws },
    { action: 'add', label: 'x', team: 'a b:c.d', workspaceDir: ws }, { action: 'add', label: 'x', team: 't:ns', description: '--json', workspaceDir: ws }, { action: 'add', label: '-x', team: 't:ns', workspaceDir: ws },
    { action: 'add', label: 'x', team: 't:ns', description: 'two\nlines', workspaceDir: ws }, { action: 'join', label: 'x', workspaceDir: ws },
    { action: 'remove', label: 'x', team: 't:ns', workspaceDir: ws }, { workspaceDir: 'relative' }, { label: 'x', workspaceDir: ws }]) {
    assert.equal((await cliTeams('/oats', bad, never)).error.code, 'E_BAD_ARGS', JSON.stringify(bad));
  }
  for (const bad of [{ soul: '*', defaultLabel: 'x', workspaceDir: ws }, { soul: '*', clearDefault: true, workspaceDir: ws }, { soul: 'a', defaultLabel: 'x', clearDefault: true, workspaceDir: ws },
    { soul: '--all', workspaceDir: ws }, { soul: 'a', add: [], workspaceDir: ws }, { soul: 'a', add: ['x', 'x'], workspaceDir: ws }, { soul: 'a/b/c', workspaceDir: ws }, { soul: 'a', add: ['-x'], workspaceDir: ws },
    { soul: 'a', defaultLabel: '--default', workspaceDir: ws }, { soul: 'a', add: Array.from({ length: 65 }, (_, i) => `t${i}`), workspaceDir: ws }]) {
    assert.equal((await cliSoulTeams('/oats', bad, never)).error.code, 'E_BAD_ARGS', JSON.stringify(bad));
  }
});

test('readiness: team items in checks.configured (no fifth check) keep code, label and default', async () => {
  const { readinessData } = await import('../renderer/readiness-contract.mjs');
  const { data, target } = await import('./helpers/readiness-fixture.mjs');
  const base = { producer: 'team model', evidence: null, remedy: 'its owner runs `oats aweb setup`, then commits the id' };
  const v = data();
  v.checks.configured.items.push({ ...base, subject: 'team reviewers', status: 'fail', required: false, code: 'team-unmapped', reason: 'shared team reviewers has no provider id yet', label: 'reviewers', default: false });
  v.checks.configured.items.push({ ...base, subject: 'team oats', status: 'fail', required: true, code: 'team-unmapped', reason: 'the default team oats has no provider id yet', label: 'oats', default: true });
  v.summary.required += 1; v.summary.fail += 1;
  const r = readinessData(v, target);
  assert.ok(r, 'the four checks, the team items among them');
  assert.deepEqual(Object.keys(r.checks), ['installed', 'configured', 'member', 'providers']);
  const items = r.checks.configured.items.slice(-2);
  assert.deepEqual(items.map(i => [i.subject, i.code, i.label, i.default, i.required]), [['team reviewers', 'team-unmapped', 'reviewers', false, false], ['team oats', 'team-unmapped', 'oats', true, true]]);
  for (const change of [i => { i.label = '-x'; }, i => { i.default = 'yes'; }]) {
    const bad = structuredClone(v); change(bad.checks.configured.items.at(-1)); assert.equal(readinessData(bad, target), null);
  }
  const plain = readinessData(data(), target);
  assert.ok(plain.checks.configured.items.every(i => !Object.hasOwn(i, 'label') && !Object.hasOwn(i, 'default')), '0.29 items gain no keys');
});
