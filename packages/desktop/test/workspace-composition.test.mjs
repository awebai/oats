// Source/DOM/CSSOM checks against the geometry in Redesign.dc.html screens 03/04.
// jsdom has no layout engine: these are composition constraints, NOT screenshots,
// measured browser positions, or Electron/terminal verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as spawn from '../renderer/views/spawn.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { refreshCli, resetCliStateForTests } from '../renderer/views/cli-status.mjs';
import { inspectorCSS } from '../renderer/soul-inspector.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const CLI = { ok: true, operationsApi: 1, features: ['operations'], relations: true };
const soul = { name: 'dev', agentsRoot: '/fixture/agents', repoName: 'fixture', runtime: 'pi', work: 'worktree', description: 'Build and review' };
const inspection = { operationsApi: 1, selected: { source: 'config' }, scope: { context: '/fixture' },
  souls: [{ ...soul, editable: { fields: ['model'], instructions: true }, instructions: { text: 'Saved instructions' } }], layers: {},
  capabilities: [{ id: 'fixture.notes', version: '1.0', source: 'local', origin: 'installed',
    health: { installed: true, trusted: true, status: 'ok' }, activation: { enabled: true, target: 'global', provenance: ['workspace'] } }] };
async function fixture(t, { cli = CLI, inspect = () => inspection, agents = [soul] } = {}) {
  const dom = new JSDOM('<body><div id="host"></div></body>', { url: 'http://localhost' });
  const doc = dom.window.document;
  const saved = { document: globalThis.document, window: globalThis.window, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  const theme = doc.createElement('style'); theme.textContent = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8'); doc.head.append(theme);
  globalThis.document = doc; globalThis.window = dom.window; globalThis.setInterval = () => 0;
  setWorkspace('/fixture');
  if (cli === null) resetCliStateForTests(); else await refreshCli({ api: async () => cli });
  const calls = [], files = [], views = [];
  let currentCli = cli;
  const ctx = { hasWorkspaceSwitcher: true, openBrain: name => files.push(name), openView: name => views.push(name),
    api: async (path, opts = {}) => {
      const body = opts.body && JSON.parse(opts.body); calls.push({ path, body });
      if (path === '/api/cli') { if (currentCli === null) throw new Error('Synthetic transport pending'); return currentCli; }
      if (path.startsWith('/api/agents')) return { agents };
      if (path.startsWith('/api/panel')) return { instances: [], workspace: { id: currentWorkspace() }, workspaces: [{ id: '/fixture', name: 'Fixture' }, { id: '/other', name: 'Other' }] };
      if (path.startsWith('/api/capabilities')) return inspect(body);
      if (path === '/api/servers') return { servers: [] };
      throw new Error(`Unexpected fixture request: ${path}`);
    } };
  t.after(() => { spawn.unmount(); setWorkspace(saved.ws); globalThis.document = saved.document; globalThis.window = saved.window; globalThis.setInterval = saved.setInterval; dom.window.close(); });
  spawn.mount(doc.querySelector('#host'), ctx); await tick();
  return { doc, dom, ctx, calls, files, views, get: selector => doc.querySelector(selector),
    css: selector => dom.window.getComputedStyle(doc.querySelector(selector)),
    click: text => { const control = [...doc.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(control, text); control.click(); },
    setCli: async next => { currentCli = next; await refreshCli({ api: async () => next }); } };
}

test('03: inspector shares the main-area top, header precedes canvas directly, and narrow stacking keeps real DOM order', async t => {
  const u = await fixture(t);
  assert.equal(u.get('.soul-inspector').hidden, true, 'mount never chooses a soul automatically');
  assert.equal(u.get('.spawn-act'), null, 'Launch is owned by an explicitly selected soul, not an arbitrary default');
  u.get('.soul-card').click(); await tick();
  const main = u.get('.workspace-main'), aside = u.get('.soul-inspector'), header = u.get('.workspace-header');
  assert.deepEqual([...u.get('.souls-body').children], [main, aside]);
  assert.equal(aside.tagName, 'ASIDE');
  assert.equal(main.firstElementChild, header);
  assert.equal(header.nextElementSibling, u.get('.workspace-recovery'));
  assert.equal(u.get('.workspace-recovery').hidden, true, 'compatible CLI adds no visible row before the cards');
  assert.equal(u.get('.workspace-recovery').nextElementSibling, u.get('.souls-grid'), 'no toolbar or repo-heading row before the cards');
  assert.equal(u.get('.repo-head'), null);
  assert.equal(u.css('.souls-body').display, 'grid');
  assert.equal(u.css('.souls-body').gridTemplateColumns, 'minmax(0,1fr) 340px');
  assert.equal(u.css('.soul-inspector').width, '340px');
  for (const selector of ['.workspace-header', '.soul-inspector .inspector-head']) {
    assert.equal(u.css(selector).minHeight, '48px');
    assert.equal(u.css(selector).boxSizing, 'border-box');
    assert.equal(u.css(selector).paddingTop, '0px');
    assert.equal(u.css(selector).paddingBottom, '0px', 'no 32px control + 16px padding + 1px border = 49px conflict');
  }
  assert.equal(u.css('.workspace-header').flexWrap, 'nowrap', 'ordinary header controls shrink/scroll rather than breaking the 48px baseline');
  assert.equal(u.css('.workspace-tabs').flexWrap, 'nowrap');
  assert.equal(u.css('.workspace-tabs button').flexShrink, '0');
  assert.equal(u.css('.filter').height, '28px'); assert.equal(u.css('.filter').minHeight, '28px', 'generic 36px field floor is explicitly overridden');
  assert.equal(u.css('.souls-grid').padding, '18px 20px');
  assert.equal(u.css('.souls-grid').gap, '12px');
  assert.equal(u.get('.souls-bar').parentElement, header);
  assert.equal(u.get('.wssel').parentElement, header);
  assert.equal(u.get('.wssel').style.display, 'none', 'shell still owns its selector');
  assert.equal(u.css('.souls-bar').minHeight, 'auto', 'no second bar floor');
  const rules = [...u.doc.styleSheets].flatMap(sheet => [...sheet.cssRules]);
  const responsive = rules.find(rule => rule.cssText.startsWith('@container (max-width:700px)') || rule.cssText.startsWith('@container (max-width: 700px)'));
  assert.ok(responsive, 'shipped container-width stacking rule');
  assert.match(responsive.cssText, /display:\s*block/, 'narrow intrinsic-height flow cannot shrink grid tracks under overflowing cards');
  assert.match(responsive.cssText, /overflow:\s*visible/);
  assert.doesNotMatch(inspectorCSS, /display:\s*contents|order:\s*-1|position:\s*absolute/);
});

test('03: cards have one semantic Details entry with compact identity, runtime, description and activity', async t => {
  const u = await fixture(t);
  const card = u.get('.soul-card');
  assert.equal(card.tagName, 'BUTTON'); assert.equal(card.type, 'button');
  assert.equal(card.getAttribute('aria-label'), 'Inspect dev');
  assert.equal(u.doc.getElementById(card.getAttribute('aria-controls')), u.get('.soul-inspector'));
  assert.deepEqual([...card.children].map(el => el.className), ['sname', 'sdesc', 'sactivity']);
  assert.equal(card.querySelector('button, .schips, .sactions'), null);
  assert.equal(u.css('.soul-card').padding, '16px'); assert.equal(u.css('.soul-card').gap, '10px');
  assert.equal(u.css('.sdesc').fontSize, '12px');
  assert.equal(u.css('.glyph').width, '36px'); assert.equal(u.css('.glyph').height, '36px'); assert.equal(u.css('.glyph').borderRadius, '9px');
  assert.equal(u.get('.scontext').textContent, 'fixture'); assert.equal(u.get('.sruntime').getAttribute('aria-label'), 'Reported runtime: Pi');
  assert.equal(u.css('.sruntime').width, '18px'); assert.equal(u.css('.sruntime').height, '18px'); assert.equal(u.css('.sruntime').borderRadius, '5px');
  card.focus(); card.dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick();
  for (const text of ['Launch…', 'Files', 'Schedule…', 'Edit defaults', 'Edit instructions']) assert.ok([...u.get('.soul-inspector').querySelectorAll('button')].find(b => b.textContent === text), text);
  assert.equal(u.get('.spawn-dialog'), null, 'keyboard inspection does not launch');
  u.click('Schedule…'); assert.deepEqual(u.views, ['schedules']);
  u.get('[aria-label="Close inspector"]').click();
  assert.equal(u.doc.activeElement, u.get('.soul-card'), 'close returns to the roving card');
  assert.equal(u.css('.souls-body').gridTemplateColumns, 'minmax(0,1fr)');
});

test('04: ordinary capability state uses wrapping badges, 56px table rows and compact vertical padding', async t => {
  const u = await fixture(t);
  u.get('#workspace-tab-capabilities').click(); await tick();
  const tools = u.get('.discovery-tools');
  assert.equal(tools.parentElement, u.get('.workspace-header')); assert.equal(tools.hidden, false); assert.equal(tools.open, false);
  tools.open = true;
  for (const selector of ['.discovery-filter', '.discovery-scope']) assert.ok(tools.querySelector(selector));
  assert.equal(u.get('.discovery-filter').labels.length, 1); assert.equal(u.get('.discovery-scope').labels.length, 1);
  tools.open = false;
  const badges = [...u.doc.querySelectorAll('.capability-state > .capability-fact')];
  assert.deepEqual(badges.map(el => el.textContent), ['Installation: Installed', 'Health: ok', 'Trust: Trusted', 'Activation: Enabled', 'Target: global', 'Binding: ["workspace"]']);
  assert.equal(u.css('.capability-state').display, 'flex'); assert.equal(u.css('.capability-state').flexWrap, 'wrap');
  assert.equal(u.get('.capability-state').querySelector('p'), null, 'no permanent paragraph for each health fact');
  assert.equal(u.css('.capability-fact').lineHeight, '14px');
  assert.equal(u.css('.discovery-table td').padding, '8px 16px');
  assert.equal(u.css('.discovery-table thead tr').height, '36px');
  assert.equal(u.css('.discovery-table th').padding, '0px 16px');
  assert.equal(u.css('.discovery-table tbody tr').height, '56px', 'table-row height is a minimum; real wrapping can grow it');
  assert.equal(u.css('.discovery-table td').verticalAlign, 'middle');
  assert.equal(u.css('.discovery-table td > p').margin, '0px', 'ordinary two-line provenance fits the row rather than adding paragraph margins');
  assert.equal(u.get('.discovery-table caption').textContent, 'Reported capabilities');
  assert.equal(u.css('.discovery-table caption').position, 'absolute', 'semantic caption does not add a pre-table row');
  assert.equal(u.css('.discovery-status').display, 'none');
  assert.equal(u.get('.workspace-discovery').lastElementChild, u.get('.discovery-note'), 'explanatory provenance follows the data, not the reference canvas origin');
  u.click('Scope details…'); await tick();
  assert.equal(u.get('.inspector-head h2').textContent, 'Reported capabilities');
  assert.doesNotMatch(u.get('.soul-inspector').textContent, /Installed capabilities|No capabilities installed/);
  u.get('#workspace-tab-sources').click(); await tick();
  assert.equal(u.get('.discovery-table').querySelector('button, a, input'), null, 'source provenance is read-only');
  assert.equal(u.get('.discovery-table caption').textContent, 'Reported source provenance');
  assert.ok(u.calls.filter(c => c.body).every(c => c.body.action === 'inspect'), 'no fabricated membership/installation actions');
});

for (const state of ['no operations', 'wrong API', 'rejection', 'pending', 'soul omitted']) test(`${state}: inspection never blocks otherwise compatible legacy Launch/Files`, async t => {
  const request = deferred();
  const u = await fixture(t, {
    cli: state === 'no operations' ? { ok: true, features: [] } : CLI,
    inspect: () => state === 'wrong API' ? { operationsApi: 0 } : state === 'soul omitted' ? { ...inspection, souls: [] }
      : state === 'rejection' ? Promise.reject(new Error('Reported inspection failure')) : request.promise,
  });
  u.get('.soul-card').click();
  const launch = u.get('.soul-inspector .spawn-act');
  assert.equal(launch.disabled, false, 'Launch is ready before any inspection await');
  u.click('Files'); assert.deepEqual(u.files, ['dev']);
  launch.click(); const modal = u.get('.spawn-dialog'); assert.ok(modal);
  modal.querySelector('.ftask').value = 'Retain my task';
  await tick();
  if (state === 'pending') { request.resolve(inspection); await tick(); }
  const diagnostic = u.get('.inspector-status').textContent;
  if (state === 'no operations') assert.match(diagnostic, /operations support/);
  if (state === 'wrong API') assert.match(diagnostic, /does not support/);
  if (state === 'rejection') assert.match(diagnostic, /Reported inspection failure/);
  if (state === 'soul omitted') assert.match(u.get('.soul-inspector').textContent, /selected soul was not reported/);
  assert.equal(u.get('.spawn-dialog'), modal); assert.equal(modal.querySelector('.ftask').value, 'Retain my task');
  assert.equal(u.get('.soul-inspector .spawn-act'), launch, 'inspection does not replace the action opener');
  modal.querySelector('.fcancel').click(); assert.equal(u.doc.activeElement, launch);
  assert.equal(u.calls.some(c => c.path === '/api/spawn'), false, 'selection or opening Launch does not submit it');
  if (state === 'no operations') assert.equal(u.calls.some(c => c.path.startsWith('/api/capabilities')), false);
});

for (const cli of [null, { ok: false }]) test(`CLI ${JSON.stringify(cli)}: launch fails closed while roster Files and inspection diagnostics remain`, async t => {
  const u = await fixture(t, { cli });
  u.get('.soul-card').click();
  assert.equal(u.get('.spawn-act').disabled, true);
  assert.match(u.get('.spawn-act').title, cli === null ? /Checking/ : /compatible installed/);
  u.get('.spawn-act').dispatchEvent(new u.dom.window.Event('click')); assert.equal(u.get('.spawn-dialog'), null);
  u.click('Files'); assert.deepEqual(u.files, ['dev']);
  assert.match(u.get('.inspector-status').textContent, /compatible OATS CLI/);
  await u.setCli({ ok: true, features: [] });
  assert.equal(u.get('.spawn-act').disabled, false, 'CLI recovery enables legacy Launch without an operations request');
  u.get('.spawn-act').click(); assert.ok(u.get('.spawn-dialog'));
  await u.setCli({ ok: false });
  assert.equal(u.get('.spawn-dialog'), null); assert.equal(u.get('.spawn-act').disabled, true);
});

test('empty reported capabilities use factual empty copy, and empty rosters never select or launch', async t => {
  const u = await fixture(t, { agents: [], inspect: () => ({ ...inspection, capabilities: [] }) });
  assert.equal(u.get('.soul-card, .spawn-act'), null); assert.equal(u.get('.soul-inspector').hidden, true);
  u.get('#workspace-tab-capabilities').click(); await tick(); u.click('Scope details…'); await tick();
  assert.match(u.get('.soul-inspector').textContent, /Reported capabilities.*No capabilities reported at this scope/s);
  assert.doesNotMatch(u.get('.soul-inspector').textContent, /Installed capabilities|No capabilities installed/);
});
