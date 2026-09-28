// Soul launch preferences (feature launch-preference, OATS 0.30; docs/desktop-cli-api.md "Soul
// launch preferences", oats feat/030-launch-preference @88eeb102). Consumer-first: the kernel does
// not emit `launch` yet, so each case is a DERIVED scenario (marked): the contract's Launch example
// added to a REAL 0.30 capture (fixtures/team-model-v2). Recapture from the real kernel when it lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { launchOf, REPORT_FROM, PREVIEW_FROM, RECORD_FROM } from '../renderer/launch-contract.mjs';
import { soulsData, deploymentStatusData } from '../deployment-data.mjs';
import { previewData } from '../renderer/spawn-preview-contract.mjs';
import { inspectData } from '../renderer/inspect-contract.mjs';
import * as remote from '../server/remote-roster.mjs';
import { normalizeSoulColor } from '../renderer/soul-colors.mjs';
import { target } from './helpers/spawn-preview-fixture.mjs';

const v2 = name => JSON.parse(readFileSync(new URL(`./fixtures/team-model-v2/${name}.json`, import.meta.url), 'utf8'));
const DEPLOYMENT = '/fixture/base/northwind-workspace';
// The contract's example (a machine override of a package soul's declared preference).
const LAUNCH = () => ({ declared: { harness: 'claude', model: 'claude-opus-5-5' }, effective: { harness: 'codex', model: 'gpt-codex-astra', launchConfig: null },
  from: 'local', at: 'oats-local.yaml#/souls/launch/oats.engineering~1code-reviewer', problem: null });

test('the Launch object: closed at every level; from per document; problem is {code, message, fix}', () => {
  assert.deepEqual(launchOf(LAUNCH()), LAUNCH());
  assert.deepEqual(launchOf({ ...LAUNCH(), declared: null, from: 'host', at: null }).declared, null, 'no declared preference');
  const unavailable = { ...LAUNCH(), from: 'soul', problem: { code: 'E_HARNESS_UNAVAILABLE', message: 'harness codex is not installed on this machine', fix: 'install codex, or override it on this machine in oats-local.yaml souls.launch' } };
  assert.equal(launchOf(unavailable).problem.code, 'E_HARNESS_UNAVAILABLE', 'a report carries the refusal it would hit');
  assert.equal(launchOf({ ...LAUNCH(), from: 'flag' }, REPORT_FROM), undefined, 'a report never says flag');
  assert.ok(launchOf({ ...LAUNCH(), from: 'flag' }, PREVIEW_FROM));
  assert.equal(launchOf({ ...LAUNCH(), from: 'recorded' }, PREVIEW_FROM), undefined, 'only a home record says recorded');
  assert.ok(launchOf({ ...LAUNCH(), from: 'recorded' }, RECORD_FROM));
  for (const [what, change] of [['extra key', l => { l.extra = 1; }], ['missing problem', l => { delete l.problem; }], ['declared extra', l => { l.declared.args = []; }],
    ['declared harness', l => { l.declared.harness = 'vim'; }], ['declared model type', l => { l.declared.model = 7; }], ['effective missing launchConfig', l => { delete l.effective.launchConfig; }],
    ['effective harness', l => { l.effective.harness = 'Codex'; }], ['launchConfig shape', l => { l.effective.launchConfig = '-x'; }], ['from', l => { l.from = 'guess'; }],
    ['at type', l => { l.at = 3; }], ['at control', l => { l.at = 'a\nb'; }], ['problem shape', l => { l.problem = { code: 'E_X', message: 'm' }; }],
    ['problem code', l => { l.problem = { code: 'nope', message: 'm', fix: 'f' }; }], ['model oversized', l => { l.effective.model = 'm'.repeat(257); }]]) {
    const l = LAUNCH(); change(l); assert.equal(launchOf(l, RECORD_FROM), undefined, what);
  }
});

test('oats souls rows (derived on the real 0.30 capture): launch passes through to /api/agents; a flag launch refuses; absent unchanged', () => {
  const doc = v2('souls'); const row = doc.result.souls.find(s => s.name === 'release-manager');
  row.launch = { ...LAUNCH(), effective: { harness: 'claude', model: 'claude-opus-5-5', launchConfig: null }, from: 'soul', at: 'local//fixture/base/fx/remotes/agents.git:souls/release-manager/soul.yaml#/launch' };
  const souls = soulsData(doc).souls, rm = souls.find(s => s.name === 'release-manager');
  assert.deepEqual([rm.launch.effective.harness, rm.launch.effective.model, rm.launch.from], ['claude', 'claude-opus-5-5', 'soul']);
  assert.equal(soulsData(v2('souls')).souls.some(s => Object.hasOwn(s, 'launch')), false, 'the real capture (no feature yet): no launch invented');
  const bad = v2('souls'); bad.result.souls[0].launch = { ...LAUNCH(), from: 'flag' }; assert.throws(() => soulsData(bad), { code: 'E_CLI_PROTOCOL' });
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function agentsData('), end = source.indexOf('/* ── Model catalog', start);
  const agentsData = new Function('workspaceById', 'workspaces', 'snapshot', 'remote', 'dirname', 'resolve', 'normalizeSoulColor', `${source.slice(start, end)}; return agentsData;`);
  const roster = deploymentStatusData(v2('status'), DEPLOYMENT), ws = { id: DEPLOYMENT, name: 'northwind', roots: [roster.root] };
  const snapshot = { byWs: new Map([[DEPLOYMENT, { deployment: { status: 'observed', root: roster.root, souls: roster.agents.map(({ instances: _i, ...s }) => s), catalog: { souls, ambiguous: [], reason: null } } }]]) };
  const agents = agentsData(() => ws, () => [ws], snapshot, remote, dirname, resolve, normalizeSoulColor)().agents;
  assert.deepEqual(agents.find(a => a.name === 'release-manager').launch, rm.launch);
  assert.equal(agents.filter(a => a.name !== 'release-manager').some(a => Object.hasOwn(a, 'launch')), false);
});

test('spawn --preview (derived on the real 0.30 preview): launch with flags; its effective must BE the preview\'s; absent unchanged', () => {
  const real = v2('preview').result;
  const withLaunch = from => ({ ...structuredClone(real), launch: { declared: null, effective: { harness: real.harness, model: real.model, launchConfig: real.launchConfig }, from, at: null, problem: null } });
  assert.deepEqual(previewData(withLaunch('flag'), target).launch.from, 'flag');
  assert.equal(previewData(withLaunch('host'), target).launch.effective.harness, real.harness);
  assert.equal(Object.hasOwn(previewData(structuredClone(real), target), 'launch'), false, 'no feature: no launch');
  const other = withLaunch('local'); other.launch.effective.harness = real.harness === 'claude' ? 'codex' : 'claude';
  assert.equal(previewData(other, target), null, 'a launch that disagrees with the preview refuses it');
  const model = withLaunch('local'); model.launch.effective.model = 'another-model'; assert.equal(previewData(model, target), null);
  assert.equal(previewData(withLaunch('recorded'), target), null, 'a preview is never a record');
});

test('inspect --soul / --home (derived on the real 0.30 captures): launch, launchCurrent; recorded only on a home', () => {
  const soul = v2('inspect-soul').result, selectSoul = { agent: { name: soul.subject.soul } };
  assert.ok(inspectData({ ...structuredClone(soul), launch: { ...LAUNCH(), from: 'local-default', at: 'oats-local.yaml#/souls/launch/*' } }, selectSoul));
  assert.equal(inspectData({ ...structuredClone(soul), launch: { ...LAUNCH(), from: 'recorded' } }, selectSoul), null, 'a soul is never a record');
  assert.equal(inspectData({ ...structuredClone(soul), launchCurrent: null }, selectSoul), null, 'launchCurrent is a home\'s');
  const rows = structuredClone(soul); rows.souls[0].launch = { ...LAUNCH(), from: 'flag' }; assert.equal(inspectData(rows, selectSoul), null, 'soul rows are reports');
  assert.ok(inspectData(structuredClone(soul), selectSoul), 'the real capture (no feature yet) still reads');
  const home = v2('inspect-home').result, selectHome = { instance: {}, selector: { home: home.subject.home } };
  assert.ok(inspectData({ ...structuredClone(home), launch: { ...LAUNCH(), declared: null, from: 'recorded', at: null }, launchCurrent: LAUNCH() }, selectHome));
  assert.ok(inspectData({ ...structuredClone(home), launch: LAUNCH(), launchCurrent: null }, selectHome), 'a soul that no longer resolves');
  assert.equal(inspectData({ ...structuredClone(home), launch: LAUNCH(), launchCurrent: { ...LAUNCH(), from: 'recorded' } }, selectHome), null, 'launchCurrent is what reselect WOULD choose');
  assert.equal(inspectData({ ...structuredClone(home), launch: { ...LAUNCH(), extra: 1 } }, selectHome), null);
});
