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
import { workspaceStatusData } from '../deployment-data.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const CLI = { ok: true, operationsApi: 1, features: ['operations'], relations: true };
const f2 = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f2/${name}.json`, import.meta.url), 'utf8'));
const V2_CLI = { ...CLI, bin: '/fixture/bin/oats', workspaceApi: 2, features: ['operations', 'workspace-v2'] };
const observedStatus = workspaceStatusData(f2('workspace-status'), '/fixture/base/northwind-workspace');
const catalogReply = (capabilities = f2('capabilities').result.capabilities) => ({ workspaceSyncApi: 1, status: 'ok',
  capabilities: { capabilitiesApi: 1, ...f2('capabilities').result, capabilities } });
const soul = { name: 'dev', agentsRoot: '/fixture/agents', repoName: 'fixture', runtime: 'pi', work: 'worktree', description: 'Build and review' };
const inspection = { operationsApi: 1, selected: { source: 'config' }, scope: { context: '/fixture' },
  souls: [{ ...soul, editable: { fields: ['model'], instructions: true }, instructions: { text: 'Saved instructions' } }], layers: {},
  capabilities: [{ id: 'fixture.notes', version: '1.0', source: 'local', origin: 'installed',
    health: { installed: true, trusted: true, status: 'ok' }, activation: { enabled: true, target: 'global', provenance: ['workspace'] } }] };
async function fixture(t, { cli = CLI, inspect = () => inspection, agents = [soul], sync = null } = {}) {
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
      if (path.startsWith('/api/panel')) return { instances: [], workspace: { id: currentWorkspace() }, workspaces: [{ id: '/fixture', name: 'Fixture' }, { id: '/other', name: 'Other' }],
        ...(sync ? { deployment: { status: 'observed', root: '/fixture/agents', workspace: observedStatus.workspace, workspaceStatus: observedStatus, reachable: { reachable: true }, withheld: [] } } : {}) };
      if (path.startsWith('/api/workspace-sync') && sync) return sync(body);
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

test('03: cards have one semantic Details entry with compact identity, description and activity (no runtime: v2 souls choose it at spawn)', async t => {
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
  assert.equal(u.get('.scontext').textContent, 'fixture');
  // v2 souls are runtime-agnostic (the runtime is chosen at spawn), so a card never claims one.
  assert.equal(u.get('.sruntime'), null);
  card.focus(); card.dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick();
  for (const text of ['Launch…', 'Files', 'Schedule…']) assert.ok([...u.get('.soul-inspector').querySelectorAll('button')].find(b => b.textContent === text), text);
  for (const text of ['Edit defaults', 'Edit instructions']) assert.equal([...u.get('.soul-inspector').querySelectorAll('button')].some(b => b.textContent === text), false, `${text}: a v2 soul is edited in its repository`);
  assert.match(u.get('.inspector-repository').textContent, /^Edit this soul in its repository/);
  assert.equal(u.get('.spawn-dialog'), null, 'keyboard inspection does not launch');
  u.click('Schedule…'); assert.deepEqual(u.views, ['schedules']);
  u.get('[aria-label="Close inspector"]').click();
  assert.equal(u.doc.activeElement, u.get('.soul-card'), 'close returns to the roving card');
  assert.equal(u.css('.souls-body').gridTemplateColumns, 'minmax(0,1fr)');
});

test('04: the capability table follows the design grid — 36px head, 56px rows, 32px marks, 22px chips', async t => {
  const u = await fixture(t, { cli: V2_CLI, sync: () => catalogReply() });
  u.get('#workspace-tab-capabilities').click(); await tick(); await tick();
  assert.equal(u.get('.discovery-tools'), null, 'no classic "Filter & scope" selector remains');
  assert.equal(u.get('.readiness-view, .deployment-inventory, .workspace-readiness-entry'), null, 'the 0.24 readiness/inventory blocks are gone');
  const header = u.get('.workspace-header');
  assert.equal(u.get('.ws-sync').parentElement, header, 'sync lives in the Workspace header');
  assert.equal(u.css('.catalog-row.head').minHeight, '36px'); assert.equal(u.css('.catalog-row.head').textTransform, 'uppercase');
  assert.equal(u.css('.catalog-row.head').fontSize, '10.5px');
  assert.equal(u.css('.catalog-row:not(.head)').minHeight, '56px', 'a minimum: real wrapping can grow a row');
  assert.equal(u.css('.catalog-row:not(.head)').padding, '8px 16px');
  assert.equal(u.css('.catalog-row').gridTemplateColumns, 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr)');
  assert.equal(u.css('.catalog-cap .identity-mark').width, '32px'); assert.equal(u.css('.catalog-cap .identity-mark').borderRadius, '8px');
  assert.equal(u.css('.catalog-chip').minHeight, '22px'); assert.equal(u.css('.catalog-chip').padding, '0px 7px');
  assert.equal(u.css('.catalog-chip').borderRadius, '5px'); assert.equal(u.css('.catalog-chip').fontSize, '10.5px');
  assert.equal(u.css('.catalog-chips').flexWrap, 'wrap');
  assert.equal(u.css('.catalog-pill').borderRadius, '999px');
  assert.equal(u.get('.workspace-discovery').querySelectorAll('.catalog-filter').length, 2, 'Team and Source pill groups');
  u.get('#workspace-tab-sources').click(); await tick();
  assert.equal(u.get('.workspace-discovery').querySelector('.catalog-table button, .catalog-table a, .catalog-table input'), null, 'Sources are read-only');
  for (const { path, body } of u.calls.filter(c => c.body && c.path.startsWith('/api/workspace-sync'))) assert.equal(body.action, 'read', `no mutation from ${path}`);
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
  assert.equal(u.get('.spawn-act').disabled, false, 'CLI recovery enables Spawn without an operations request');
  u.get('.spawn-act').click(); assert.ok(u.get('.spawn-dialog'));
  await u.setCli({ ok: false });
  assert.equal(u.get('.spawn-dialog'), null); assert.equal(u.get('.spawn-act').disabled, true);
});

test('an empty catalog uses factual empty copy, and empty rosters never select or launch', async t => {
  const u = await fixture(t, { agents: [], cli: V2_CLI, sync: () => catalogReply([]) });
  assert.equal(u.get('.soul-card, .spawn-act'), null); assert.equal(u.get('.soul-inspector').hidden, true);
  u.get('#workspace-tab-capabilities').click(); await tick(); await tick();
  assert.match(u.get('.catalog-empty').textContent, /The workspace reports no capabilities/);
  assert.doesNotMatch(u.get('.workspace-discovery').textContent, /Installed capabilities|No capabilities installed/);
});
