// Capabilities "Used by" from each soul's composition (kernel feature souls-capabilities, OATS 0.44.2): the
// souls whose `oats souls` row lists the capability by name, kind and origin, not only the souls whose live
// instances recorded it. The parse (deployment-data.mjs soulCapabilitiesOf), the /api/agents projection,
// the join (workspace-catalog.mjs composes/soulsUsing), the list's cells and the capability page's section.
// Fixture: workspace-v2/souls-capabilities, DERIVED from the f7 capture (its provenance.json says how).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { soulsData, soulCapabilitiesOf } from '../deployment-data.mjs';
import * as remote from '../server/remote-roster.mjs';
import { normalizeSoulColor } from '../renderer/soul-colors.mjs';
import { catalogCSS, renderCapabilities, renderCapabilitySections, capabilitySections, composes, soulsUsing, rosterAgentName, soulsComposition, SOULS_CAPABILITIES_FEATURE } from '../renderer/workspace-catalog.mjs';
import { renderCapabilityPage } from '../renderer/capability-page.mjs';
import { SOULS_STALE_TITLE, ROSTER_STALE_TITLE } from '../renderer/loading.mjs';

const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/${name}.json`, import.meta.url), 'utf8'));
const ROOT = '/fixture/base/northwind-workspace/agents';
const R = repo => `local//fixture/base/fx/remotes/${repo}.git`;
const CATALOG = fx('f7/capabilities').result.capabilities;
const cap = name => CATALOG.find(row => row.name === name);
// The souls as /api/agents hands them to the renderer (the server's projection, agentsData below).
const SOULS = soulsData(fx('souls-capabilities/souls')).souls.map(s => ({ name: s.name, key: s.key, soulKind: s.kind, ...(s.kind === 'package' ? { package: s.package } : {}),
  ...(Object.hasOwn(s, 'capabilities') ? { capabilities: s.capabilities } : {}), agentsRoot: ROOT }));
const refused = fn => assert.throws(fn, { code: 'E_CLI_PROTOCOL' });

test('the feature string is souls-capabilities, read from the CLI probe in one place', () => {
  assert.equal(SOULS_CAPABILITIES_FEATURE, 'souls-capabilities');
  assert.equal(soulsComposition({ features: ['workspace-v2', 'souls-capabilities'] }), true);
  assert.equal(soulsComposition({ features: ['workspace-v2'] }), false);
  assert.equal(soulsComposition(null), false);
});

test('soulsData keeps each soul\'s composition in the catalog\'s own keys; null for a soul that did not resolve', () => {
  const souls = Object.fromEntries(soulsData(fx('souls-capabilities/souls')).souls.map(s => [s.key, s]));
  assert.deepEqual(souls['release-manager'].capabilities, [
    { name: 'nw-deploy', kind: 'package', package: 'nw.tools', from: 'soul' },
    { name: 'nw-house-style', kind: 'member', repoKey: R('agents'), from: 'workspace' },
    { name: 'nw-release-tooling', kind: 'member', repoKey: R('agents'), from: 'soul' },
    { name: 'oats.core', kind: 'package', package: 'oats.framework', from: 'workspace' },
    { name: 'oats.okf', kind: 'package', package: 'oats.okf', from: 'workspace' },
  ]);
  assert.equal(souls['data-analyst'].capabilities, null, 'not spawnable: did not resolve');
  assert.deepEqual(souls['platform-reviewer'].capabilities, [], 'composes nothing');
  assert.equal(souls['nw.tools/deployer'].capabilities.length, 5, 'a package soul too');
});

test('a souls document without the feature (no capabilities key) parses unchanged', () => {
  const older = fx('f7/souls');
  assert.ok(older.result.souls.every(s => !Object.hasOwn(s, 'capabilities')), 'the real 0.29 capture');
  const rows = soulsData(older).souls;
  assert.ok(rows.length > 0 && rows.every(s => !Object.hasOwn(s, 'capabilities')), 'no composition invented');
  // The same document with the field: everything else reads identically.
  const stripped = soulsData(fx('souls-capabilities/souls')).souls.filter(s => s.kind !== 'package' && s.name !== 'data-analyst').map(({ capabilities: _c, ...rest }) => rest);
  assert.deepEqual(stripped, rows.filter(s => s.name !== 'data-analyst'));
});

test('anything but the contract\'s entry shape refuses the document (the parse\'s idiom); null exactly when not spawnable', () => {
  const entry = { name: 'nw-lint', kind: 'package', package: 'nw.tools', from: 'soul' };
  const member = { name: 'nw-house-style', kind: 'member', repoKey: R('agents'), from: 'workspace' };
  assert.deepEqual(soulCapabilitiesOf([entry, member]), [entry, member]);
  assert.deepEqual(soulCapabilitiesOf([{ ...member, extra: 1 }]), [member], 'unknown keys are dropped, not kept');
  for (const bad of [
    undefined, {}, 'oats.core', [null], [{ ...entry, from: 'team' }], [{ ...entry, from: undefined }], [{ ...entry, name: '' }],
    [{ ...entry, kind: 'external', repoKey: R('experts'), package: undefined }], [{ ...member, kind: 'external' }], [{ ...entry, kind: 'team' }],
    [{ ...entry, package: 'Not A Package' }], [{ ...entry, repoKey: R('agents') }], [{ ...member, repoKey: '' }], [{ name: 'x', kind: 'member', from: 'soul' }],
    [{ ...member, package: 'nw.tools' }], Array.from({ length: 1025 }, () => entry),
  ]) assert.equal(soulCapabilitiesOf(bad), undefined, JSON.stringify(bad)?.slice(0, 80));
  const doc = () => fx('souls-capabilities/souls');
  const row = (d, name) => d.result.souls.find(s => s.name === name);
  let d = doc(); row(d, 'release-manager').capabilities = [{ ...member, kind: 'external' }]; refused(() => soulsData(d));
  d = doc(); row(d, 'release-manager').capabilities = null; refused(() => soulsData(d)); // spawnable, yet did not resolve
  d = doc(); row(d, 'data-analyst').capabilities = []; refused(() => soulsData(d)); // not spawnable, yet composed
  d = doc(); delete row(d, 'release-manager').spawnable; row(d, 'release-manager').capabilities = null;
  assert.equal(soulsData(d).souls.find(s => s.name === 'release-manager').capabilities, null, 'no spawnable reported: nothing to agree with');
});

test('/api/agents carries each soul\'s composition (a copy; null kept; absent stays absent)', () => {
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function agentsData('), end = source.indexOf('/* ── Model catalog', start);
  const agentsData = new Function('deploymentFor', 'deployments', 'snapshot', 'remote', 'dirname', 'resolve', 'normalizeSoulColor', `${source.slice(start, end)}; return agentsData;`);
  const run = catalogSouls => {
    const snapshot = { byWs: new Map([['/d', { deployment: { status: 'observed', root: ROOT, souls: [], catalog: { souls: catalogSouls, ambiguous: [], reason: null } } }]]) };
    const ws = { id: '/d', name: 'northwind', roots: [ROOT] };
    return Object.fromEntries(agentsData(() => ws, () => [ws], snapshot, remote, dirname, resolve, normalizeSoulColor)().agents.map(a => [a.key, a]));
  };
  const souls = soulsData(fx('souls-capabilities/souls')).souls, agents = run(souls);
  assert.deepEqual(agents['release-manager'].capabilities, souls.find(s => s.name === 'release-manager').capabilities);
  assert.notEqual(agents['release-manager'].capabilities, souls.find(s => s.name === 'release-manager').capabilities, 'a copy');
  assert.equal(agents['data-analyst'].capabilities, null);
  assert.deepEqual([agents['nw.tools/deployer'].soulKind, agents['nw.tools/deployer'].package], ['package', 'nw.tools']);
  assert.equal(Object.hasOwn(run(soulsData(fx('f7/souls')).souls)['release-manager'], 'capabilities'), false, 'an older CLI: no field');
});

test('a soul\'s roster agent name is the kernel\'s (lib/workspace.mjs packageSoulAgentName): <package>--<soul> for a package soul', () => {
  assert.equal(rosterAgentName({ name: 'release-manager', soulKind: 'member' }), 'release-manager');
  assert.equal(rosterAgentName({ name: 'security-reviewer', soulKind: 'external' }), 'security-reviewer');
  assert.equal(rosterAgentName({ name: 'deployer', soulKind: 'package', package: 'nw.tools' }), 'nw-tools--deployer');
  assert.equal(rosterAgentName({ name: 'keeper', soulKind: 'package', package: 'acme.pkg' }), 'acme-pkg--keeper', 'the roster capture\'s name (team-model-v2/package-souls/status.json)');
  assert.equal(rosterAgentName({ name: 'knowledge-maintainer', soulKind: 'package', package: 'oats.okf' }), 'oats-okf--knowledge-maintainer');
  assert.equal(rosterAgentName({ name: 'x', soulKind: 'package', package: 'a_b.c' }), 'a-b-c--x', 'every character outside [a-z0-9-]');
});

test('the join: name, kind and origin (repository or package); private rows the same; null never counted; a mismatch never', () => {
  const who = name => soulsUsing(SOULS, cap(name)).map(s => s.key);
  assert.deepEqual(who('nw-release-tooling'), ['release-manager'], 'member');
  assert.deepEqual(who('nw-deploy'), ['nw.tools/deployer', 'release-manager'], 'package, a package soul included');
  assert.deepEqual(who('nw-platform-runbook'), ['platform-engineer'], 'a repo-owned (private) row');
  assert.deepEqual(who('nw-brand-voice'), ['campaign-writer', 'positioning-analyst'], 'security-reviewer\'s nw-brand-voice comes from another repository');
  assert.deepEqual(who('nw-warehouse-access'), [], 'data-analyst did not resolve: not counted');
  assert.equal(composes({ name: 'nw-lint', kind: 'package', package: 'oats.okf', from: 'soul' }, cap('nw-lint')), false, 'another package');
  assert.equal(composes({ name: 'nw-lint', kind: 'member', repoKey: R('nw-tools'), from: 'soul' }, cap('nw-lint')), false, 'another kind');
  const external = { name: 'nw-review', kind: 'external', repoKey: R('experts') };
  assert.equal(composes({ name: 'nw-review', kind: 'member', repoKey: R('experts'), from: 'soul' }, external), false, 'an external row never matches');
  assert.deepEqual(soulsUsing([{ name: 'a', capabilities: null }, { name: 'b' }], cap('oats.core')), [], 'no composition: not counted');
});

function mount(t) {
  const dom = new JSDOM('<!doctype html><html data-theme="light"><body><main class="oats-view"><div class="caps"></div></main></body></html>');
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const style = doc.createElement('style'); style.textContent = catalogCSS; doc.head.append(style);
  return { doc, $: sel => doc.querySelector(sel), $$: sel => [...doc.querySelectorAll(sel)] };
}
// Instances that recorded modules: only release-manager's live one carries nw-release-tooling.
const INSTANCES = [
  { agent: 'release-manager', agentsRoot: ROOT, modules: [{ name: 'nw-release-tooling' }, { name: 'nw-deploy', status: 'moved' }] },
  { agent: 'release-manager', agentsRoot: ROOT, modules: [{ name: 'nw-deploy' }] },
  { agent: 'nw-tools--deployer', agentsRoot: ROOT, modules: [{ name: 'nw-deploy' }] },
  { agent: 'deployer', agentsRoot: ROOT, modules: [{ name: 'nw-deploy' }] }, // a member soul's name, not the package soul's instance
  { agent: 'release-manager', agentsRoot: '/elsewhere/agents', modules: [{ name: 'nw-deploy' }] }, // another deployment's agents root
];

test('the list\'s "Used by" with the feature: the souls whose composition includes it, marks and count; "Not used" only on a good read', t => {
  const u = mount(t);
  renderCapabilities(u.$('.caps'), { rows: CATALOG, status: null, instances: INSTANCES, souls: SOULS, composition: true, onOpen() {} });
  const count = name => u.$(`.catalog-row[data-capability="${name}"] .catalog-used-count`);
  assert.equal(count('nw-brand-voice').textContent, '2 souls'); assert.equal(count('nw-brand-voice').title, 'Used by campaign-writer, positioning-analyst');
  assert.equal(u.$$('.catalog-row[data-capability="nw-brand-voice"] .catalog-used-marks .identity-mark').length, 2);
  assert.equal(count('nw-deploy').title, 'Used by nw.tools/deployer, release-manager', 'a package soul by its key');
  assert.equal(count('oats.core').textContent, '7 souls');
  assert.equal(u.$$('.catalog-row[data-capability="oats.core"] .catalog-used-marks .identity-mark').length, 3, 'up to 3 marks');
  assert.equal(count('nw-warehouse-access').textContent, 'Not used'); assert.equal(count('nw-warehouse-access').title, 'No soul here includes it');
  assert.equal(count('nw.chat').textContent, 'Not used', 'no live instance needed, none composes it');
});

test('the list keeps "Every soul" for a workspace default, and "—" with the souls-list reason while the read is not settled-good', t => {
  const u = mount(t);
  const status = { defaults: { capabilities: [{ name: 'oats.core', from: 'package', off: false }] } };
  renderCapabilities(u.$('.caps'), { rows: CATALOG, status, instances: [], souls: SOULS, composition: true, rosterState: 'stale', onOpen() {} });
  const count = name => u.$(`.catalog-row[data-capability="${name}"] .catalog-used-count`);
  assert.equal(count('oats.core').textContent, 'Every soul');
  assert.equal(count('nw-brand-voice').textContent, '2 souls', 'what the held list shows stays');
  assert.equal(count('nw-warehouse-access').textContent, '—'); assert.equal(count('nw-warehouse-access').title, SOULS_STALE_TITLE);
  assert.equal(count('nw-warehouse-access').getAttribute('aria-description'), 'Unavailable: the souls list is not current');
  assert.equal(count('nw-warehouse-access').dataset.rosterState, 'stale');
  for (const state of ['pending', 'failed']) {
    renderCapabilities(u.$('.caps'), { rows: CATALOG, status: null, instances: [], souls: SOULS, composition: true, rosterState: state, onOpen() {} });
    assert.equal(count('nw-warehouse-access').textContent, '—', state);
  }
});

test('without the feature: today\'s instance-derived "Used by", even when soul rows carry a composition', t => {
  const u = mount(t);
  renderCapabilities(u.$('.caps'), { rows: CATALOG, status: null, instances: INSTANCES, souls: SOULS, composition: false, onOpen() {} });
  const count = name => u.$(`.catalog-row[data-capability="${name}"] .catalog-used-count`);
  assert.equal(count('nw-brand-voice').textContent, 'Not used'); assert.equal(count('nw-brand-voice').title, 'No instance carries it yet');
  assert.equal(count('nw-release-tooling').textContent, '1 soul');
  renderCapabilities(u.$('.caps'), { rows: CATALOG, status: null, instances: [], souls: SOULS, rosterState: 'failed', onOpen() {} });
  assert.equal(count('nw-brand-voice').title, ROSTER_STALE_TITLE, 'the roster\'s reason');
});

test('every section passes the composition through (Repo owned and Packages too)', t => {
  const u = mount(t);
  renderCapabilitySections(u.$('.caps'), { sections: capabilitySections(CATALOG), shown: capabilitySections(CATALOG).workspace, filterHost: null, privateListed: true, status: null, instances: [], souls: SOULS, composition: true });
  const count = name => u.$(`.catalog-row[data-capability="${name}"] .catalog-used-count`).textContent;
  assert.deepEqual([count('nw-house-style'), count('nw-platform-runbook'), count('nw-lint')], ['6 souls', '1 soul', '2 souls']);
});

const page = (t, opts) => {
  const u = mount(t), opened = [];
  renderCapabilityPage(u.$('.caps'), { status: null, instances: INSTANCES, souls: SOULS, composition: true, root: '/d', onBack() {}, openSoul: soul => opened.push(soul), ...opts });
  const section = u.$('.page-section[data-section="Used by"]');
  return { u, opened, section, rows: () => [...section.querySelectorAll('.used-row:not(.head)')].map(r => [r.querySelector('.used-name').textContent, r.querySelector('.used-meta').textContent]) };
};

test('the page\'s "Used by": one row per soul whose composition includes it, with that soul\'s live instances carrying it', t => {
  const { section, rows, opened } = page(t, { row: cap('nw-deploy') });
  assert.match(section.querySelector('.page-section-title').textContent, /2 souls/);
  // deployer: its instance is nw-tools--deployer (a member-named "deployer" instance is not its own); release-manager:
  // two here (one on an older version), the one under another agents root is not this deployment's.
  assert.deepEqual(rows(), [['deployer', '1'], ['release-manager', '2 · 1 on an older version']]);
  section.querySelector('.used-row:not(.head)').click();
  assert.deepEqual([opened[0].key, opened[0].name, opened[0].agentsRoot], ['nw.tools/deployer', 'deployer', ROOT], 'opens the soul by its key');
  assert.equal(section.querySelector('.used-row:not(.head)').dataset.focusKey, `used:nw.tools/deployer:${ROOT}`);
  assert.equal(section.querySelector('.used-row:not(.head)').title, 'Open nw.tools/deployer', 'the tooltip names the soul by its key');
});

test('the page tells two package souls of one bare name apart by their keys (visible name bare, tooltip and focus key qualified)', t => {
  const twins = ['a.tools', 'b.tools'].map(pkg => ({ name: 'deployer', key: `${pkg}/deployer`, soulKind: 'package', package: pkg, agentsRoot: ROOT,
    capabilities: [{ name: 'oats.core', kind: 'package', package: 'oats.framework', from: 'workspace' }] }));
  const { section } = page(t, { row: cap('oats.core'), souls: twins, instances: [{ agent: 'a-tools--deployer', agentsRoot: ROOT, modules: [{ name: 'oats.core' }] }] });
  const rows = [...section.querySelectorAll('.used-row:not(.head)')];
  assert.deepEqual(rows.map(r => [r.querySelector('.used-name').textContent, r.title, r.dataset.focusKey, r.querySelector('.used-meta').textContent]), [
    ['deployer', 'Open a.tools/deployer', `used:a.tools/deployer:${ROOT}`, '1'], ['deployer', 'Open b.tools/deployer', `used:b.tools/deployer:${ROOT}`, '0']]);
});

test('the page counts "0" instances for a soul that composes it with none running it, says none on a good read, "—" with the reason otherwise', t => {
  assert.deepEqual(page(t, { row: cap('nw-brand-voice') }).rows(), [['campaign-writer', '0'], ['positioning-analyst', '0']]);
  const none = page(t, { row: cap('nw-warehouse-access') });
  assert.equal(none.rows().length, 0); assert.match(none.section.textContent, /No soul here includes it\./); assert.match(none.section.querySelector('.page-section-title').textContent, /0 souls/);
  const stale = page(t, { row: cap('nw-warehouse-access'), rosterState: 'failed' });
  const dash = stale.section.querySelector('.used-unknown');
  assert.equal(dash.textContent, '—'); assert.equal(dash.getAttribute('aria-description'), SOULS_STALE_TITLE); assert.equal(dash.title, SOULS_STALE_TITLE);
  assert.doesNotMatch(stale.section.textContent, /No soul here includes it/);
  // Without the feature: the instance-derived page, unchanged.
  const old = page(t, { row: cap('nw-brand-voice'), composition: false });
  assert.equal(old.rows().length, 0); assert.match(old.section.textContent, /No instance carries it yet\./);
});
