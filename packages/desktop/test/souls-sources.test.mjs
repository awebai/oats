import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderSoulDeclarations, portableSources, renderPortableSources } from '../renderer/soul-declarations.mjs';
import { createSoulInspector, inspectorCSS } from '../renderer/soul-inspector.mjs';
import { createWorkspaceDiscovery, discoveryCSS } from '../renderer/workspace-discovery.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { refreshCli } from '../renderer/views/cli-status.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const CLI = { ok: true, bin: '/fixture/oats', version: '0.24.7', operationsApi: 1, features: ['operations'], remote: ['operations'] };
const agent = (root = '/team/agents', server) => ({ name: 'dev', agentsRoot: root, server, runtime: 'pi', work: 'worktree' });
const provenance = (source = 'git:https://example.invalid/editions.git') => ({ kind: 'exported-edition-copy', source, revision: 'commit-one', path: 'souls/dev', workspaceRevision: 'workspace-commit' });
const declared = (root = '/team/agents') => ({ ...agent(root), soulsApi: 1,
  declarations: { requires: { capabilities: { 'test.tools': { source: 'git:declared@pin#package' } } }, defaults: { knowledge: 'none' }, knowledge: { include: ['guides/node'] }, teams: null, resources: { skills: ['review'] } },
  provenance: provenance(), declarationProblems: [],
  readiness: { source: 'recorded', status: 'sources-installed', requirements: [{ capability: 'test.tools', source: 'git:declared@pin#package', installed: true, approved: false, active: false, version: '1.2.3' }] },
  editable: { fields: ['model'], instructions: true }, instructions: { text: '# Instructions' }, model: 'reported-model',
});
const sources = () => ({ soulsApi: 1, kind: 'recorded-provenance', note: null, items: [{ ...provenance(), souls: ['dev'] }] });
const inspection = (soul = declared()) => ({ operationsApi: 1, scope: { context: '/team' }, selected: { source: 'config', soul: soul.name, agentsRoot: soul.agentsRoot },
  souls: [soul], sources: sources(), capabilities: [], layers: {}, problems: [] });
function domFixture(t) {
  const dom = new JSDOM('<!doctype html><body><main class="oats-view"><aside class="soul-inspector"></aside><header></header><section id="discovery"></section><section id="souls"></section></main></body>');
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  return { dom, doc, aside: doc.querySelector('aside'), host: doc.querySelector('main'), sources: doc.querySelector('#discovery') };
}
function inspectorFixture(t, api = () => inspection(), create = createSoulInspector) {
  const u = domFixture(t), previous = currentWorkspace(), calls = [];
  setWorkspace('/team');
  const controller = create(u.aside, { ctx: { api: (path, opts) => { const body = JSON.parse(opts.body); calls.push({ path, body }); return api(body); } } });
  t.after(() => { controller.dispose(); setWorkspace(previous); });
  return { ...u, controller, calls, show: (a = agent()) => controller.show({ agent: a, selector: { soul: a.name, agentsRoot: a.agentsRoot } }),
    click: label => { const b = [...u.aside.querySelectorAll('button')].find(b => b.textContent === label); assert.ok(b, label); b.click(); } };
}
async function discoveryFixture(t, api = () => inspection()) {
  const u = domFixture(t), previous = currentWorkspace(), calls = [];
  setWorkspace('/team'); await refreshCli({ api: async () => CLI });
  const ctx = { api: (path, opts) => {
    if (path === '/api/cli') return CLI;
    const body = JSON.parse(opts.body); calls.push({ path, body }); return api(body);
  } };
  const controller = createWorkspaceDiscovery(u.doc.querySelector('header'), u.sources, { ctx, soulsPanel: u.doc.querySelector('#souls') });
  t.after(() => { controller.dispose(); setWorkspace(previous); });
  const roster = () => controller.updateRoster([agent(), agent('/other/agents')], { workspace: { id: '/team', scope: '/team' } });
  roster(); controller.setTab('sources'); await tick();
  return { ...u, controller, calls, roster, change: (selector, value, type = 'change') => {
    const el = u.doc.querySelector(selector); el.value = value; el.dispatchEvent(new u.dom.window.Event(type));
  }, retry: () => [...u.doc.querySelectorAll('button')].find(b => b.textContent === 'Refresh inspection').click() };
}

test('K4 soul inspection renders declarations and separate source observations without inferring Ready or changing editable fields', async t => {
  const before = inspection(), u = inspectorFixture(t, () => before); await u.show();
  const section = u.aside.querySelector('.soul-declarations'); assert.ok(section);
  assert.deepEqual([...section.querySelectorAll('pre')].map(el => JSON.parse(el.textContent)), [before.souls[0].declarations.requires, { knowledge: 'none' }, { include: ['guides/node'] }, { skills: ['review'] }]);
  assert.match(section.textContent, /Unrecorded|Recorded/);
  assert.match(section.textContent, /Declared sources installed/);
  assert.match(section.textContent, /InstallationInstalledExecutable approvalNot approvedActivationNot activeVersion1.2.3/);
  assert.doesNotMatch(section.textContent, /\bReady\b|Signed by|Configured:|Enrolled:/);
  assert.match(section.textContent, /do not establish launchability/);
  u.click('Edit defaults'); assert.equal(u.aside.querySelectorAll('.inspector-form input').length, 1);
  assert.equal(u.aside.querySelector('input').name, 'model'); u.aside.querySelector('input').value = 'draft';
  assert.equal(u.calls.length, 1, 'read-only projection adds no commands or mutations');
  assert.deepEqual(u.calls[0].body, { action: 'inspect', selector: { soul: 'dev', agentsRoot: '/team/agents' } });
  u.click('Cancel'); u.click('Edit instructions'); assert.equal(u.aside.querySelector('textarea').value, '# Instructions');
  assert.deepEqual(before, inspection(), 'input DTO is not mutated');
});

for (const marker of [undefined, null, 0, 2, '1']) test(`unnegotiated soulsApi ${marker} retains old inspector behavior`, async t => {
  const soul = declared(); soul.soulsApi = marker;
  const u = inspectorFixture(t, () => inspection(soul)); await u.show();
  assert.equal(u.aside.querySelector('.soul-declarations'), null);
  assert.match(u.aside.textContent, /Future-instance defaults/); assert.match(u.aside.textContent, /AGENTS.md/);
});

test('unrecorded, missing, explicit null declarations, unreadable and malformed facts stay distinct', t => {
  const u = domFixture(t), soul = declared();
  soul.provenance = null; soul.declarations = { requires: null, defaults: {}, knowledge: null, teams: null, resources: null };
  soul.readiness = { source: 'unrecorded', status: 'undeclared', requirements: null };
  renderSoulDeclarations(u.aside, soul);
  assert.match(u.aside.textContent, /Unrecorded/); assert.match(u.aside.textContent, /Not declared/);
  assert.equal(u.aside.querySelector('pre').textContent, '{}');
  assert.match(u.aside.textContent, /Requirements undeclared/); assert.doesNotMatch(u.aside.textContent, /\bLocal\b/);
  u.aside.replaceChildren(); soul.declarationProblems = [{ code: 'soul-declarations-unreadable', message: 'Read failed' }];
  renderSoulDeclarations(u.aside, soul);
  assert.match(u.aside.textContent, /soul-declarations-unreadable: Read failed/);
  assert.doesNotMatch(u.aside.textContent, /Not declared|Requirements undeclared|No capability requirements declared/);
  u.aside.replaceChildren(); delete soul.provenance; delete soul.declarations; delete soul.declarationProblems; delete soul.readiness;
  renderSoulDeclarations(u.aside, soul); assert.match(u.aside.textContent, /Provenance not reported/);
  assert.doesNotMatch(u.aside.textContent, /Unrecorded|Not declared/);
});

test('same-named souls need an exact, unique root; snapshots do not become current declarations', async t => {
  let data = inspection(declared('/other/agents'));
  const u = inspectorFixture(t, () => data); await u.show();
  assert.equal(u.aside.querySelector('.soul-declarations'), null);
  data = inspection(); data.souls.push(declared()); await u.show();
  assert.equal(u.aside.querySelector('.soul-declarations'), null, 'ambiguous exact records are not picked by first match');
  data = inspection(); data.selected.source = 'snapshot'; data.snapshot = { instructions: { text: 'Captured' } };
  await u.controller.show({ instance: { instance: 'dev-one' }, selector: { home: '/home' } });
  assert.equal(u.aside.querySelector('.soul-declarations'), null); assert.match(u.aside.textContent, /Captured/);
});

for (const field of ['installed', 'approved', 'active']) test(`${field} uses strict tri-state observations`, t => {
  const u = domFixture(t), soul = declared(); soul.readiness.requirements[0][field] = 'true';
  renderSoulDeclarations(u.aside, soul);
  const row = u.aside.querySelector('.soul-requirement'), labels = [...row.querySelectorAll('dt')];
  const label = { installed: 'Installation', approved: 'Executable approval', active: 'Activation' }[field];
  assert.equal(labels.find(el => el.textContent === label).nextElementSibling.textContent, 'Not reported');
});

test('recorded source context supersedes capability origins, filters locally, and preserves DOM on routine polls', async t => {
  const data = inspection(); data.capabilities = [{ id: 'unrelated.cap', source: 'not-a-soul-source', origin: 'installed' }];
  const u = await discoveryFixture(t, () => data);
  const row = u.sources.querySelector('.portable-source'); assert.ok(row); assert.equal(u.sources.querySelector('.discovery-table'), null);
  assert.equal(u.doc.querySelector('#workspace-tab-sources .workspace-count').textContent, '1 recorded');
  assert.doesNotMatch(u.sources.textContent, /not-a-soul-source|unrelated.cap/);
  assert.match(row.textContent, /commit-one/); assert.match(row.textContent, /workspace-commit/);
  u.roster(); u.roster(); await tick(); assert.equal(u.sources.querySelector('.portable-source'), row); assert.equal(u.calls.length, 1);
  u.change('.discovery-filter', 'absent', 'input'); assert.match(u.sources.textContent, /No recorded sources match/);
  assert.equal(u.doc.querySelector('#workspace-tab-sources .workspace-count').textContent, '1 recorded', 'filter does not change observed total');
  u.change('.discovery-filter', 'commit-one', 'input'); assert.ok(u.sources.querySelector('.portable-source'));
  assert.equal(u.calls.length, 1); assert.deepEqual(u.calls[0].body, { action: 'inspect', selector: {} });
});

test('none-recorded is an observed zero, not evidence of authored/local provenance', async t => {
  const data = inspection(); data.sources = { soulsApi: 1, kind: 'none-recorded', items: [], note: 'authored local souls only' };
  data.souls[0].provenance = { kind: 'packaged-definition', source: null, revision: null, path: null, workspaceRevision: null };
  const u = await discoveryFixture(t, () => data);
  assert.match(u.sources.textContent, /None recorded/); assert.doesNotMatch(u.sources.textContent, /authored local souls only/);
  assert.equal(u.doc.querySelector('#workspace-tab-sources .workspace-count').textContent, '0 recorded');
  renderSoulDeclarations(u.aside, data.souls[0]); assert.match(u.aside.textContent, /packaged-definition/);
  assert.match(u.aside.textContent, /No portable source address is recorded for this origin/);
});

for (const marker of [undefined, 2, '1']) test(`sources marker ${marker} preserves capability-origin fallback`, async t => {
  const data = inspection(); data.sources.soulsApi = marker; data.capabilities = [{ id: 'old.cap', source: 'path:old', origin: 'installed' }];
  const u = await discoveryFixture(t, () => data);
  assert.equal(u.sources.querySelector('.portable-sources'), null); assert.match(u.sources.textContent, /old.cap/);
  assert.match(u.sources.textContent, /Portable soul sources are not reported/);
  assert.equal(u.doc.querySelector('#workspace-tab-sources .workspace-count').textContent, '1 reported');
});

for (const mutate of [s => { delete s.items; }, s => { s.kind = 'other'; }, s => { s.items = []; }, s => { s.kind = 'none-recorded'; },
  s => { s.items[0].source = null; }, s => { s.items[0].souls = 'dev'; }, s => { s.items[0].revision = {}; }]) test('malformed portable source v1 refuses an empty or legacy success claim', async t => {
  const data = inspection(); mutate(data.sources); const u = await discoveryFixture(t, () => data);
  assert.match(u.sources.textContent, /malformed or incomplete/); assert.equal(u.sources.querySelector('.portable-source'), null);
  assert.equal(u.sources.querySelector('.discovery-table'), null); assert.equal(u.doc.querySelector('#workspace-tab-sources .workspace-count').textContent, '');
});

test('hostile declarations/provenance remain literal text, not markup, links or filesystem authority', t => {
  const u = domFixture(t), hostile = `'"><img src=x onerror=evil()><script>evil()</script>[a='b']`, soul = declared();
  soul.declarations.resources = { files: ['../../private', hostile] }; soul.provenance = provenance('javascript:evil()');
  soul.declarationProblems = [{ code: hostile, message: hostile }]; soul.readiness.requirements[0].capability = hostile;
  renderSoulDeclarations(u.aside, soul);
  const data = { sources: sources() }; data.sources.items[0] = { ...provenance('javascript:evil()'), path: hostile, souls: [hostile] };
  renderPortableSources(u.sources, portableSources(data));
  assert.ok(u.host.textContent.includes(hostile)); assert.ok(u.host.textContent.includes('../../private'));
  assert.equal(u.host.querySelector('script,img,a,iframe,form,button'), null);
  assert.equal([...u.host.querySelectorAll('*')].some(el => [...el.attributes].some(a => /^on/i.test(a.name))), false);
});

// Mutation-check the actual request guards, not a copied reducer. No generated
// repository file, child process, CLI, GUI or operator backend is involved.
async function inspectorVersion(guard) {
  if (guard === 'real') return createSoulInspector;
  const url = new URL('../renderer/soul-inspector.mjs', import.meta.url);
  let source = readFileSync(url, 'utf8').replace(/from '(\.[^']+)'/g, (_, path) => `from '${new URL(path, url).href}'`);
  const before = 'alive && id === serial && gen === workspaceGeneration()';
  assert.ok(source.includes(before));
  source = source.replace(before, guard === 'local' ? 'alive && gen === workspaceGeneration()' : 'alive && id === serial');
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).createSoulInspector;
}
for (const ownership of ['local', 'global']) for (const outcome of ['success', 'rejection']) for (const weakened of [false, true]) {
  test(`${ownership} inspection ownership rejects stale ${outcome}${weakened ? ' (mutation detected)' : ''}`, async t => {
    const pending = deferred(); let count = 0;
    const u = inspectorFixture(t, () => count++ === 0 ? pending.promise : Promise.reject(new Error('CURRENT refusal')),
      await inspectorVersion(weakened ? ownership : 'real'));
    const first = u.show(agent('/team/agents', 'server-a'));
    if (ownership === 'local') await u.show(agent('/team/agents', 'server-b'));
    else { setWorkspace('/other'); setWorkspace('/team'); }
    const before = u.aside.innerHTML;
    if (outcome === 'success') pending.resolve(inspection()); else pending.reject(new Error('OLD refusal'));
    await first;
    const unchanged = () => assert.equal(u.aside.innerHTML, before);
    if (weakened) assert.throws(unchanged); else unchanged();
  });
}
for (const outcome of ['success', 'rejection']) test(`source scope rejects stale ${outcome} after a newer refusal`, async t => {
  const pending = deferred(); let count = 0;
  const u = await discoveryFixture(t, () => count++ === 0 ? pending.promise : Promise.reject(new Error('CURRENT sources failure')));
  u.change('.discovery-scope', '/other'); await tick();
  if (outcome === 'success') pending.resolve(inspection()); else pending.reject(new Error('OLD sources failure'));
  await tick(); u.change('.discovery-filter', '', 'input');
  assert.match(u.sources.textContent, /CURRENT sources failure/); assert.doesNotMatch(u.sources.textContent, /OLD sources failure|commit-one/);
  assert.equal(u.sources.querySelector('.portable-source'), null);
});

function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const c = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
for (const theme of ['light', 'solarized', 'dark']) test(`${theme}: real declaration/source nodes use computed-token AA pairs`, async t => {
  const u = inspectorFixture(t); await u.show(); renderPortableSources(u.sources, portableSources(inspection()));
  const style = u.doc.createElement('style'); style.textContent = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8') + inspectorCSS + discoveryCSS;
  u.doc.head.append(style); u.doc.documentElement.dataset.theme = theme;
  const problem = u.doc.createElement('p'); problem.className = 'declaration-problem'; problem.textContent = 'Read problem'; u.aside.querySelector('.soul-declarations').append(problem);
  const root = u.dom.window.getComputedStyle(u.doc.documentElement);
  for (const [selector, paintedSelector, foreground, background] of [
    ['.soul-declarations pre', '.soul-declarations pre', 'fg', 'surface-2'],
    ['.declaration-note', '.soul-inspector', 'muted', 'surface'], ['.declaration-problem', '.soul-inspector', 'danger', 'surface'],
    ['.portable-source dt', '.portable-source', 'muted', 'surface'], ['.portable-source h3', '.portable-source', 'fg', 'surface'],
    ['.portable-sources > p', '.oats-view', 'muted', 'bg'],
  ]) {
    const el = u.doc.querySelector(selector); assert.ok(el); assert.equal(u.dom.window.getComputedStyle(el).color, `var(--${foreground})`);
    assert.equal(u.dom.window.getComputedStyle(u.doc.querySelector(paintedSelector)).background, `var(--${background})`);
    const a = luminance(root.getPropertyValue(`--${foreground}`).trim()), b = luminance(root.getPropertyValue(`--${background}`).trim());
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, selector);
    for (let p = el; p; p = p.parentElement) assert.equal(u.dom.window.getComputedStyle(p).opacity, '1');
  }
});
