// Team model v2 (0.30) tolerance, consumer-first (D1a): the Desktop's readers accept the 0.30
// shapes additively BEFORE the kernel/provider pins move, and keep reading 0.29 unchanged.
// Documents: the REAL 0.29 captures, with 0.29-only keys removed and the v2 keys added
// (docs/design/2026-09-27-team-model-v2.md, "The kernel ↔ provider contract"). The band stays
// <0.30.0 here; the real 0.30 pass-through (D1b) follows K1's shapes doc.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { teamsDocument, soulTeams, defaultTeamText } from '../renderer/teams-panel.mjs';
import { teamRow } from '../renderer/team-rows.mjs';
import { previewData } from '../renderer/spawn-preview-contract.mjs';
import { workspaceStatusData } from '../deployment-data.mjs';
import { target } from './helpers/spawn-preview-fixture.mjs';

const read = path => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/${path}.json`, import.meta.url), 'utf8'));
const run = name => read(`teams/${name}`).result;
const DEPLOYMENT = '/fixture/base/northwind-workspace';

test('teams document: 0.29 unchanged; v2 drops primary/unmapped, adds left[] and source deployment|soul', () => {
  const r29 = run('teams-initial');
  assert.deepEqual(teamsDocument(r29, 'messaging:teams'), r29.result, '0.29 as captured');
  const v2 = structuredClone(r29); delete v2.result.primary; delete v2.result.unmapped;
  v2.result.defaultTeam = { label: 'antares-oats', team: v2.result.defaultTeam.team, from: 'deployment' }; // the kernel's DefaultTeam (K1 @8dd82158)
  v2.result.left = [{ label: 'reviewers', team: 'northwind:reviewers', at: '2026-09-27T10:00:00Z', reason: 'no-longer-eligible' }];
  const d = teamsDocument(v2, 'messaging:teams');
  assert.ok(d, 'the v2 document is read, not blanked');
  assert.deepEqual([d.primary, d.unmapped, d.left.length, d.defaultTeam.from], [null, [], 1, 'deployment']);
  assert.match(defaultTeamText(d.defaultTeam), /this workspace's default on this computer$/);
  const soul = structuredClone(v2); soul.result.defaultTeam.from = 'soul'; assert.ok(teamsDocument(soul, 'messaging:teams'));
  const unmapped = structuredClone(v2); unmapped.result.defaultTeam.team = null;
  assert.match(defaultTeamText(teamsDocument(unmapped, 'messaging:teams').defaultTeam), /^antares-oats \(no provider id yet\)/, 'an unmapped default names its label');
  const none = structuredClone(v2); none.result.defaultTeam = null; assert.equal(teamsDocument(none, 'messaging:teams').defaultTeam, null, 'none configured');
  assert.match(defaultTeamText(teamsDocument(r29, 'messaging:teams').defaultTeam), / · /, '0.29 words unchanged');
  // Still strict: bounded, well-formed, and an unknown key or source is refused.
  for (const change of [x => { x.result.left = Array.from({ length: 21 }, () => x.result.left[0]); }, x => { x.result.left[0].reason = ''; },
    x => { x.result.left[0].extra = 1; }, x => { x.result.surprise = true; }, x => { x.result.defaultTeam.from = 'guess'; }, x => { delete x.result.joined; },
    x => { x.result.defaultTeam = { team: 't', source: 'deployment' }; }, x => { x.result.defaultTeam.extra = 1; }, x => { x.result.defaultTeam.label = '-bad'; }]) {
    const bad = structuredClone(v2); change(bad); assert.equal(teamsDocument(bad, 'messaging:teams'), null);
  }
});

test('soul team rows: 0.29 {label, team, mapped} and v2 {label, team, default, from}, one reader', () => {
  assert.deepEqual(teamRow({ label: 'eng', team: 'n:eng', mapped: true, payload: {} }), { label: 'eng', team: 'n:eng', mapped: true });
  const v2 = teamRow({ label: 'oats', team: 'oats:oats.aweb.ai', default: false, from: 'shared' });
  assert.deepEqual(v2, { label: 'oats', team: 'oats:oats.aweb.ai', mapped: true, default: false, from: 'shared' });
  assert.deepEqual(teamRow(v2), v2, 'idempotent over its own projection');
  for (const bad of [{ label: 'x', team: 't', default: 'yes', from: 'local' }, { label: 'x', team: 't', default: true, from: '' }, { label: 'x', team: 't', default: true, from: 'local', mapped: false },
    { label: '-x', team: 't', mapped: true }, { label: 'x', team: null, mapped: true }]) assert.equal(teamRow(bad), null, JSON.stringify(bad));
  const inspect = read('teams/inspect-soul').result.teams;
  assert.deepEqual(soulTeams(inspect), inspect.map(t => ({ label: t.label, team: t.team, mapped: t.mapped })), '0.29 inspect rows as before');
  assert.deepEqual(soulTeams([{ label: 'antares-oats', team: 'a:juan.aweb.ai', default: true, from: 'local' }])[0].default, true);
});

test('spawn preview teams: the v2 rows keep the spawn Teams choice (not "unreadable")', () => {
  const v29 = read('f7/preview-teams-default').result;
  const before = previewData(structuredClone(v29), target);
  assert.ok(before && Array.isArray(before.teams));
  const v2 = structuredClone(v29);
  v2.teams = [{ label: 'antares-oats', team: 'a:juan.aweb.ai', default: true, from: 'local' }, { label: 'oats', team: 'oats:oats.aweb.ai', default: false, from: 'shared' }];
  const after = previewData(v2, target);
  assert.ok(after, 'the preview is read'); assert.deepEqual(after.teams.map(t => [t.label, t.default, t.mapped]), [['antares-oats', true, true], ['oats', false, true]]);
});

test('workspace status: defaults.byTeam optional; workspace.teams as strings (0.29) or v2 shared-team rows', () => {
  const doc = read('desktop-facts/workspace-status');
  const w29 = workspaceStatusData(structuredClone(doc), DEPLOYMENT);
  assert.ok(Object.hasOwn(w29.defaults, 'byTeam'), '0.29 keeps byTeam');
  const noByTeam = structuredClone(doc); delete noByTeam.result.defaults.byTeam;
  const w = workspaceStatusData(noByTeam, DEPLOYMENT);
  assert.equal(Object.hasOwn(w.defaults, 'byTeam'), false, 'absent stays absent'); assert.ok(w.members.length > 0, 'the rest of the read survives');
  const rows = structuredClone(doc); rows.result.workspace.teams = [{ label: 'oats', team: 'oats:oats.aweb.ai', description: 'Everyone on OATS' }, { label: 'reviewers', team: null, description: null }];
  const r = workspaceStatusData(rows, DEPLOYMENT);
  assert.deepEqual(r.workspace.teams, ['oats', 'reviewers'], 'Setup keeps listing the labels');
  assert.deepEqual(r.workspace.sharedTeams, rows.result.workspace.teams);
  for (const change of [x => { x.result.workspace.teams = ['oats', { label: 'mixed', team: null, description: null }]; },
    x => { x.result.workspace.teams = [{ label: 'dup', team: null, description: null }, { label: 'dup', team: null, description: null }]; },
    x => { x.result.workspace.teams = [{ label: '-bad', team: null, description: null }]; }, x => { x.result.defaults.byTeam = []; }]) {
    const bad = structuredClone(doc); change(bad); assert.throws(() => workspaceStatusData(bad, DEPLOYMENT), { code: 'E_CLI_PROTOCOL' });
  }
});
