import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderSoulDeclarations } from '../renderer/soul-declarations.mjs';
import { createSoulInspector, inspectorCSS } from '../renderer/soul-inspector.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';

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
test('hostile declarations/provenance remain literal text, not markup, links or filesystem authority', t => {
  const u = domFixture(t), hostile = `'"><img src=x onerror=evil()><script>evil()</script>[a='b']`, soul = declared();
  soul.declarations.resources = { files: ['../../private', hostile] }; soul.provenance = provenance('javascript:evil()');
  soul.declarationProblems = [{ code: hostile, message: hostile }]; soul.readiness.requirements[0].capability = hostile;
  renderSoulDeclarations(u.aside, soul);
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
function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const c = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
for (const theme of ['light', 'solarized', 'dark']) test(`${theme}: real declaration/source nodes use computed-token AA pairs`, async t => {
  const u = inspectorFixture(t); await u.show();
  const style = u.doc.createElement('style'); style.textContent = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8') + inspectorCSS;
  u.doc.head.append(style); u.doc.documentElement.dataset.theme = theme;
  const problem = u.doc.createElement('p'); problem.className = 'declaration-problem'; problem.textContent = 'Read problem'; u.aside.querySelector('.soul-declarations').append(problem);
  const root = u.dom.window.getComputedStyle(u.doc.documentElement);
  for (const [selector, paintedSelector, foreground, background] of [
    ['.soul-declarations pre', '.soul-declarations pre', 'fg', 'surface-2'],
    ['.declaration-note', '.soul-inspector', 'muted', 'surface'], ['.declaration-problem', '.soul-inspector', 'danger', 'surface'],
  ]) {
    const el = u.doc.querySelector(selector); assert.ok(el); assert.equal(u.dom.window.getComputedStyle(el).color, `var(--${foreground})`);
    assert.equal(u.dom.window.getComputedStyle(u.doc.querySelector(paintedSelector)).background, `var(--${background})`);
    const a = luminance(root.getPropertyValue(`--${foreground}`).trim()), b = luminance(root.getPropertyValue(`--${background}`).trim());
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, selector);
    for (let p = el; p; p = p.parentElement) assert.equal(u.dom.window.getComputedStyle(p).opacity, '1');
  }
});
