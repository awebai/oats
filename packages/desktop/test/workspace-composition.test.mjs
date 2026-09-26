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
import { soulInspection } from './helpers/inspect-fixture.mjs';
import { workspaceStatusData } from '../deployment-data.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const CLI = { ok: true, operationsApi: 2, features: ['operations'], relations: true };
const f2 = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f2/${name}.json`, import.meta.url), 'utf8'));
const V2_CLI = { ...CLI, bin: '/fixture/bin/oats', workspaceApi: 2, features: ['operations', 'workspace-v2'] };
const observedStatus = workspaceStatusData(f2('workspace-status'), '/fixture/base/northwind-workspace');
const catalogReply = (capabilities = f2('capabilities').result.capabilities) => ({ workspaceSyncApi: 1, status: 'ok',
  capabilities: { capabilitiesApi: 1, ...f2('capabilities').result, capabilities } });
const soul = { name: 'dev', agentsRoot: '/fixture/agents', repoName: 'fixture', runtime: 'pi', work: 'worktree', description: 'Build and review' };
// operationsApi 2 soul inspection from the kernel capture.
const inspection = soulInspection('dev', { instructions: { file: '/fixture/AGENTS.md', text: 'Saved instructions', truncated: false } });
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

test('03 (F7): a soul opens as a page in the main area — it replaces the grid, adds no side column; header precedes canvas directly', async t => {
  const u = await fixture(t);
  assert.equal(u.get('.soul-inspector').hidden, true, 'mount never chooses a soul automatically');
  assert.equal(u.get('.workspace-soul-page').hidden, true);
  assert.equal(u.get('.spawn-act'), null, 'Launch is owned by an explicitly selected soul, not an arbitrary default');
  u.get('.soul-card').click(); await tick();
  const main = u.get('.workspace-main'), aside = u.get('.soul-inspector'), header = u.get('.workspace-header'), page = u.get('.workspace-soul-page');
  assert.deepEqual([...u.get('.souls-body').children], [main, aside]);
  assert.equal(aside.tagName, 'ASIDE'); assert.equal(aside.hidden, true, 'the sidebar is for instances');
  assert.equal(page.parentElement, main); assert.equal(page.hidden, false);
  assert.equal(u.get('.souls-grid').hidden, true, 'the page replaces the grid'); assert.equal(u.get('.souls-bar').hidden, true, 'and its filter');
  assert.equal(u.css('.workspace-soul-page').padding, '0px', 'Workspace v4 (W4): the page bar is flush; its body pads itself');
  assert.equal(header.hidden, true, 'the page bar replaces the Workspace header while the page is open');
  assert.ok(page.querySelector('.page-bar .inspector-back'), 'the back control lives in the page bar');
  assert.equal(main.firstElementChild, header);
  assert.equal(header.nextElementSibling, u.get('.workspace-recovery'));
  assert.equal(u.get('.workspace-recovery').hidden, true, 'compatible CLI adds no visible row before the cards');
  // Workspace v4 (human decision 2026-09-26; replaces the header-placed filter): the
  // search and Team/Repo control are the view's own toolbar, directly above the cards.
  assert.equal(u.get('.workspace-recovery').nextElementSibling, u.get('.souls-bar'), 'the Souls toolbar sits in the view, before the cards');
  assert.equal(u.get('.souls-bar').nextElementSibling, u.get('.souls-grid'), 'no repo-heading row before the cards');
  assert.equal(u.get('.repo-head'), null);
  assert.equal(u.css('.souls-body').display, 'grid');
  assert.equal(u.css('.souls-body').gridTemplateColumns, 'minmax(0,1fr)', 'no side column for a soul');
  assert.equal(u.css('.soul-inspector').width, '340px', 'the instance sidebar keeps its width');
  for (const selector of ['.workspace-header']) {
    assert.equal(u.css(selector).minHeight, '48px');
    assert.equal(u.css(selector).boxSizing, 'border-box');
    assert.equal(u.css(selector).paddingTop, '0px');
    assert.equal(u.css(selector).paddingBottom, '0px', 'no 32px control + 16px padding + 1px border = 49px conflict');
  }
  assert.equal(u.css('.workspace-header').flexWrap, 'nowrap', 'ordinary header controls shrink/scroll rather than breaking the 48px baseline');
  assert.equal(u.css('.workspace-tabs').flexWrap, 'nowrap');
  assert.equal(u.css('.workspace-tabs button').flexShrink, '0');
  assert.equal(u.css('.souls-bar .filter').height, '28px'); assert.equal(u.css('.souls-bar .filter').minHeight, '28px', 'generic 36px field floor is explicitly overridden');
  page.querySelector('.inspector-back').click(); await tick();
  assert.equal(u.get('.souls-grid').hidden, false); assert.equal(header.hidden, false, 'back restores the Workspace header');
  assert.equal(u.css('.souls-grid').padding, '0px 20px 16px', 'Workspace v4: groups start under the view toolbar');
  assert.equal(u.get('.souls-bar-lead .souls-group-title')?.textContent.length > 0, true, 'the first group heading shares the toolbar row');
  assert.equal(u.css('.souls-group-cards').gap, '12px');
  assert.equal(u.get('.souls-bar').parentElement, main, 'the toolbar belongs to the view, not the header');
  assert.equal(header.querySelector('.souls-bar, input'), null, 'the header keeps only the tabs');
  assert.equal(u.get('.wssel').parentElement, header);
  assert.equal(u.get('.wssel').style.display, 'none', 'shell still owns its selector');
  assert.equal(u.css('.souls-bar').minHeight, '28px', 'one control row: no 48px bar floor');
  const rules = [...u.doc.styleSheets].flatMap(sheet => [...sheet.cssRules]);
  const responsive = rules.find(rule => rule.cssText.startsWith('@container (max-width:700px)') || rule.cssText.startsWith('@container (max-width: 700px)'));
  assert.ok(responsive, 'shipped container-width stacking rule');
  assert.match(responsive.cssText, /display:\s*block/, 'narrow intrinsic-height flow cannot shrink grid tracks under overflowing cards');
  assert.match(responsive.cssText, /overflow:\s*visible/);
  assert.doesNotMatch(inspectorCSS, /display:\s*contents|order:\s*-1|position:\s*absolute/);
});

test('03: cards have one semantic Details entry with compact identity, description, teams and a foot (the harness only as reported)', async t => {
  const u = await fixture(t);
  const card = u.get('.soul-card');
  assert.equal(card.tagName, 'BUTTON'); assert.equal(card.type, 'button');
  assert.equal(card.getAttribute('aria-label'), 'Inspect dev');
  assert.equal(u.doc.getElementById(card.getAttribute('aria-controls')), u.get('.workspace-soul-page'), 'a card opens its soul\'s page');
  // Workspace v4 (W3): head (mark, name, repository), then description, team chips and a foot.
  assert.deepEqual([...card.children].map(el => el.className), ['sname', 'sbody']);
  assert.deepEqual([...card.querySelector('.sbody').children].map(el => el.className), ['sdesc', 'sfoot'], 'no team reported: no team chips invented');
  assert.equal(card.querySelector('button, .schips, .sactions'), null);
  assert.equal(u.css('.soul-card').padding, '0px');
  assert.equal(u.css('.sdesc').fontSize, '12px');
  assert.equal(u.css('.glyph').width, '30px'); assert.equal(u.css('.glyph').height, '30px'); assert.equal(u.css('.glyph').borderRadius, '8px');
  assert.equal(u.get('.scontext').textContent, 'fixture');
  // The default harness appears only as the roster reports it on the soul row (this fixture: pi).
  assert.equal(u.get('.soul-card .runtime-badge').getAttribute('aria-label'), 'Harness: Pi');
  assert.equal(u.get('.soul-card .smode').textContent, 'worktree · Pi');

  card.focus(); card.dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick();
  for (const text of ['Preview spawn', 'Files', 'Schedule…']) assert.ok([...u.get('.workspace-soul-page').querySelectorAll('button')].find(b => b.textContent === text), text);
  for (const text of ['Edit defaults', 'Edit instructions']) assert.equal([...u.get('.workspace-soul-page').querySelectorAll('button')].some(b => b.textContent === text), false, `${text}: a v2 soul is edited in its repository`);
  assert.equal(u.get('.inspector-repository'), null, 'no "Edit this soul" block (human, F7)');
  assert.equal(u.get('.spawn-dialog'), null, 'keyboard inspection does not launch');
  u.click('Schedule…'); assert.deepEqual(u.views, ['schedules']);
  u.get('.workspace-soul-page .inspector-back').click();
  assert.equal(u.doc.activeElement, u.get('.soul-card'), 'back returns to the roving card');
  assert.equal(u.css('.souls-body').gridTemplateColumns, 'minmax(0,1fr)');
});

// Workspace v4 (W5) replaces the frame-04 grid (36px uppercase head, 56px rows, 32px marks, status chips, pills).
test('W5: the capability table follows the v4 grid — 32px head, 48px rows, mono names, source chips, 20px used-by marks', async t => {
  const u = await fixture(t, { cli: V2_CLI, sync: () => catalogReply() });
  u.get('#workspace-tab-capabilities').click(); await tick(); await tick();
  assert.equal(u.get('.discovery-tools'), null, 'no classic "Filter & scope" selector remains');
  assert.equal(u.get('.readiness-view, .deployment-inventory, .workspace-readiness-entry'), null, 'the 0.24 readiness/inventory blocks are gone');
  const header = u.get('.workspace-header');
  assert.equal(u.get('.ws-sync').closest('.workspace-header'), header, 'sync lives in the Workspace header (Setup tools)');
  assert.equal(u.css('.catalog-row.head').minHeight, '32px'); assert.equal(u.css('.catalog-row.head').textTransform, 'none');
  assert.equal(u.css('.catalog-row.head').fontSize, '11.5px');
  assert.equal(u.css('.catalog-row:not(.head)').minHeight, '48px', 'a minimum: real wrapping can grow a row');
  assert.equal(u.css('.catalog-row:not(.head)').padding, '0px 16px');
  assert.equal(u.css('.catalog-row').gridTemplateColumns, 'minmax(0,1.7fr) minmax(0,1fr) 150px');
  assert.match(u.css('.catalog-name').font, /600 13px var\(--mono/, 'mono 13px names');
  const shipped = [...u.doc.querySelectorAll('style')].map(style => style.textContent).join('\n');
  assert.match(shipped, /\.catalog-used-marks \.identity-mark \{ width:20px; height:20px; margin-left:-5px; border-radius:6px;/, '20px used-by marks');
  assert.equal(u.get('.catalog-cap .identity-mark'), null, 'no capability monogram in the table');
  assert.equal(u.css('.capability-nav button').borderRadius, '999px');
  assert.equal(u.get('.workspace-discovery').querySelectorAll('.catalog-select').length, 2, 'Team and Repo dropdowns');
  assert.equal(u.css('.workspace-discovery[data-tab=capabilities] > *').maxWidth, '1000px', 'one centred column');
  u.get('#workspace-tab-sources').click(); await tick();
  assert.equal(u.get('.workspace-discovery').querySelector('.catalog-table button, .catalog-table a, .catalog-table input'), null, 'Sources are read-only');
  for (const { path, body } of u.calls.filter(c => c.body && c.path.startsWith('/api/workspace-sync'))) assert.equal(body.action, 'read', `no mutation from ${path}`);
});

for (const state of ['no operations', 'wrong API', 'rejection', 'pending', 'soul omitted']) test(`${state}: inspection never blocks otherwise compatible legacy Launch/Files`, async t => {
  const request = deferred();
  const u = await fixture(t, {
    cli: state === 'no operations' ? { ok: true, features: [] } : CLI,
    inspect: () => state === 'wrong API' ? { operationsApi: 0 } : state === 'soul omitted' ? { ...structuredClone(inspection), souls: [] }
      : state === 'rejection' ? Promise.reject(new Error('Reported inspection failure')) : request.promise,
  });
  u.get('.soul-card').click();
  const launch = u.get('.workspace-soul-page .spawn-act');
  assert.equal(launch.disabled, false, 'Launch is ready before any inspection await');
  u.click('Files'); assert.deepEqual(u.files, ['dev']);
  launch.click(); const modal = u.get('.spawn-dialog'); assert.ok(modal);
  modal.querySelector('.ftask').value = 'Retain my task';
  await tick();
  if (state === 'pending') { request.resolve(inspection); await tick(); }
  const diagnostic = u.get('.inspector-status').textContent;
  if (state === 'no operations') assert.match(diagnostic, /operations API 2/);
  if (state === 'wrong API') assert.match(diagnostic, /cannot read/);
  if (state === 'rejection') assert.match(diagnostic, /Reported inspection failure/);
  if (state === 'soul omitted') assert.match(u.get('.workspace-soul-page').textContent, /did not report this soul/);
  assert.equal(u.get('.spawn-dialog'), modal); assert.equal(modal.querySelector('.ftask').value, 'Retain my task');
  assert.equal(u.get('.workspace-soul-page .spawn-act'), launch, 'inspection does not replace the action opener');
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
  assert.match(u.get('.inspector-status').textContent, /operations API 2/);
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

// F7: soul and capability PAGES in the Workspace view (instances keep the sidebar).
import { capabilityRow } from '../renderer/workspace-catalog.mjs';
const key = (u, el, name) => el.dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

test('F7: a Capabilities row opens its page (click or Enter) — "← Capabilities", the catalog facts, back or Esc returns to the focused row', async t => {
  const u = await fixture(t, { cli: V2_CLI, sync: () => catalogReply() });
  u.get('#workspace-tab-capabilities').click(); await tick(); await tick();
  const row = u.get('.workspace-discovery .catalog-row[data-capability="oats.okf"]');
  assert.ok(row.classList.contains('openable')); assert.equal(row.tabIndex, 0);
  row.click();
  const page = u.get('.workspace-cap-page');
  assert.equal(page.hidden, false); assert.equal(u.get('.workspace-discovery').hidden, true, 'the page replaces the table');
  assert.equal(page.querySelector('.page-back').textContent, 'Capabilities');
  assert.equal(u.doc.activeElement, page.querySelector('.page-back'), 'focus moves into the page');
  // Workspace v4 (W5b): the page bar (back, breadcrumb), identity, then "Comes from" beside.
  assert.equal(page.querySelector('h2.page-title > span').textContent, 'oats.okf');
  assert.equal(page.querySelector('.page-crumb-current').textContent, 'oats.okf');
  assert.equal(page.querySelector('.page-crumb-current').getAttribute('aria-current'), 'page');
  const source = [...page.querySelectorAll('.page-card')].find(c => c.dataset.card === 'Comes from');
  const facts = Object.fromEntries([...source.querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling]));
  const catalogRow = f2('capabilities').result.capabilities.find(r => r.name === 'oats.okf');
  assert.equal(facts.Package.textContent, catalogRow.package); assert.match(facts.Pinned.textContent, new RegExp(`^${catalogRow.version.replace(/\./g, '\\.')}`));
  assert.equal(facts.Commit.textContent, catalogRow.commit.slice(0, 7)); assert.equal(facts.Commit.title, catalogRow.commit, 'the full commit stays reachable');
  assert.equal(Object.hasOwn(facts, 'Team'), false, 'the design has no team fact');
  assert.equal([...page.querySelectorAll('.page-card')].some(c => /resolves it/.test(c.dataset.card)), false, 'no soul context from the catalog');
  page.querySelector('.page-back').click();
  assert.equal(page.hidden, true); assert.equal(page.childElementCount, 0); assert.equal(u.get('.workspace-discovery').hidden, false);
  assert.equal(u.doc.activeElement.dataset.capability, 'oats.okf', 'back returns to its row');
  key(u, u.doc.activeElement, 'Enter');
  assert.equal(page.hidden, false, 'Enter opens it too');
  key(u, u.doc.activeElement, 'Escape');
  assert.equal(page.hidden, true, 'Esc goes back'); assert.equal(u.doc.activeElement.dataset.capability, 'oats.okf');
  // a tab change closes an open capability page
  u.get('.workspace-discovery .catalog-row[data-capability="oats.okf"]').click();
  u.get('#workspace-tab-souls').click(); await tick();
  assert.equal(page.hidden, true); assert.equal(page.childElementCount, 0); assert.equal(u.get('.souls-grid').hidden, false);
});

// Replaces the F7 test that pinned the Capabilities view's table on the soul
// page: Workspace v4 (W4) shows core capabilities as cards and the rest as a
// composition table (Capability | Source | Why it's here).
test('W4: a soul page shows its core capabilities as cards and the rest with why each is there; a row opens the capability as the soul resolves it, back returns to the soul', async t => {
  const u = await fixture(t, { cli: V2_CLI, sync: () => catalogReply() });
  u.get('.soul-card').click(); await tick(); await tick();
  const soulPage = u.get('.workspace-soul-page');
  assert.deepEqual([...soulPage.querySelectorAll('.core-card')].map(c => c.dataset.layer), ['knowledge', 'messaging', 'tasks'], 'one card per core slot');
  const coreIds = new Set(Object.values(inspection.layers).map(l => l?.id).filter(Boolean));
  const table = soulPage.querySelector('.inspector-capability-table .soul-caps');
  assert.ok(table, 'the composition table');
  assert.deepEqual([...table.querySelectorAll('.soul-cap-row.head span')].map(s => s.textContent), ['Capability', 'Source', "Why it's here"]);
  const others = inspection.capabilities.filter(c => !coreIds.has(c.id)).map(c => c.id);
  assert.deepEqual([...table.querySelectorAll('.soul-cap-row:not(.head)')].map(r => r.dataset.capability).sort(), [...others].sort(), 'every non-core capability, once');
  assert.equal(soulPage.querySelector('.catalog-table, .inspector-cap-row'), null, 'neither the catalog table nor the old per-soul list');
  for (const row of table.querySelectorAll('.soul-cap-row:not(.head)')) assert.ok(row.querySelector('.why-tag, .why-note'), `${row.dataset.capability} says why it is here`);
  const first = others[0];
  table.querySelector(`.soul-cap-row[data-capability="${first}"]`).click();
  const cap = u.get('.workspace-cap-page');
  assert.equal(cap.hidden, false); assert.equal(soulPage.hidden, true);
  assert.equal(cap.querySelector('.page-back').textContent, 'dev');
  assert.deepEqual([...cap.querySelectorAll('.page-crumbs > span:not(.page-crumb-sep)')].map(s => s.textContent), ['Workspace', 'Souls', 'dev', first]);
  const resolved = [...cap.querySelectorAll('.page-card')].find(c => c.dataset.card === 'As dev resolves it');
  assert.ok(resolved, 'what the soul resolves');
  assert.match(resolved.textContent, /Missing/);
  key(u, u.doc.activeElement, 'Escape');
  assert.equal(cap.hidden, true); assert.equal(soulPage.hidden, false, 'back to the soul\'s page');
  assert.equal(u.doc.activeElement.dataset.capability, first);
});

test('F7: capabilityRow maps an inspected capability onto the catalog row shape (reported facts only)', () => {
  const pkg = inspection.capabilities.find(c => c.from?.kind === 'package');
  const row = capabilityRow(pkg);
  assert.equal(row.name, pkg.id); assert.equal(row.kind, 'package'); assert.equal(row.package, pkg.from.package); assert.equal(row.commit, pkg.from.commit);
  assert.equal(Object.hasOwn(row, 'team'), false, 'inspect reports no team');
  assert.equal(row.resolved, pkg);
  const member = inspection.capabilities.find(c => c.from?.kind === 'member');
  if (member) { const m = capabilityRow(member); assert.equal(m.kind, 'member'); assert.equal(m.repoKey, member.from.repoKey); }
  assert.equal(capabilityRow({ id: 'x', from: { kind: 'weird' } }).kind, 'external');
});
