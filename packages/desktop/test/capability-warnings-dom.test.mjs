// Capability warnings (OATS 0.49.0, hook-event-unsupported) on screen: the one list (capability-warnings.mjs),
// the capability page's Contents section (`capabilities show`) and Workspace › Setup (id: sources, `workspace
// status`). jsdom with fixture answers; no CLI, server or GUI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createWarningsList, WARNINGS_COPY } from '../renderer/capability-warnings.mjs';
import { warningsOf } from '../renderer/capability-warnings-contract.mjs';
import { createCapabilityContents, capabilityContentsCSS } from '../renderer/capability-contents.mjs';
import { capabilityWarningsCSS } from '../renderer/capability-warnings.mjs';
import { discoveryCSS, setupAttention } from '../renderer/workspace-discovery.mjs';
import * as spawn from '../renderer/views/spawn.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { refreshCli } from '../renderer/views/cli-status.mjs';
import { workspaceStatusData, deploymentStatusData } from '../deployment-data.mjs';

const KERNEL = { code: 'hook-event-unsupported', capability: 'acme.tool', path: 'github.com/acme/agents:capabilities/acme-tool/oats.json#/hooks/on-merge',
  message: 'capability acme.tool declares hook "on-merge", which this kernel does not run; it is ignored (this kernel runs soul-scaffold, spawn, retire, launch)' };
const flush = () => new Promise(r => setTimeout(r, 0));

/* ── the list ──────────────────────────────────────────────────────────── */
test('createWarningsList: the word Warning, the message as text, Details with code and path, the accessible name', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  assert.equal(createWarningsList(doc, []), null, 'none: no section');
  assert.equal(createWarningsList(doc, undefined), null);
  const el = createWarningsList(doc, warningsOf([{ ...KERNEL, message: 'declares <b>x</b>' }]), { focusKey: 'k' });
  const list = el.querySelector('ul.cap-warnings');
  assert.equal(list.getAttribute('aria-label'), WARNINGS_COPY.title);
  const item = el.querySelector('.cap-warning');
  assert.equal(item.querySelector('.cap-warning-label').textContent, 'Warning');
  assert.ok(item.querySelector('.cap-warning-head .shell-icon'), 'an icon beside the word (never colour alone)');
  const message = item.querySelector('.cap-warning-message');
  assert.equal(message.textContent, 'declares <b>x</b>', 'set as text, never markup');
  assert.equal(message.querySelector('b'), null);
  const summary = item.querySelector('details.cap-warning-details > summary');
  assert.equal(summary.textContent, 'Details'); assert.equal(summary.dataset.focusKey, 'k:0:details');
  assert.deepEqual([...item.querySelectorAll('dt, dd')].map(n => n.textContent), ['Code', KERNEL.code, 'Path', KERNEL.path]);
  assert.equal(item.querySelector('.cap-warning-capability'), null, 'no name unless asked');
  assert.equal(item.querySelector('button'), null, 'no Open capability without canOpen');
});

test('createWarningsList: Open capability only when canOpen, named for its capability; "and N more" past 32', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const opened = [];
  const warnings = warningsOf([KERNEL, { ...KERNEL, capability: 'other.cap' }, ...Array.from({ length: 38 }, (_, i) => ({ ...KERNEL, message: `m${i}` }))]);
  const el = createWarningsList(doc, warnings, { showCapability: true, canOpen: name => name === 'other.cap', open: name => opened.push(name), focusKey: 'w' });
  const items = [...el.querySelectorAll('.cap-warning')];
  assert.equal(items.length, 32);
  assert.equal(items[0].querySelector('button'), null, 'acme.tool cannot be opened here');
  assert.equal(items[0].querySelector('.cap-warning-capability').textContent, 'acme.tool');
  const open = items[1].querySelector('button.cap-warning-open');
  assert.equal(open.textContent, 'Open capability');
  assert.equal(open.getAttribute('aria-label'), 'Open capability other.cap');
  assert.equal(open.type, 'button');
  open.click(); assert.deepEqual(opened, ['other.cap']);
  assert.equal(el.querySelector('.cap-warnings-more').textContent, 'and 8 more');
  // canOpen without open: still no button.
  assert.equal(createWarningsList(doc, warnings.slice(1, 2), { canOpen: () => true }).querySelector('button'), null);
});

/* ── the capability page ───────────────────────────────────────────────── */
const commit = 'c0ffee1'.padEnd(40, '0');
const cli = { ok: true, features: ['capability-show'], capabilityShowApi: 1 };
const row = { name: 'acme.tool', kind: 'member', repoKey: 'github.com/acme/agents', commit };
const showAnswer = (over = {}) => ({ capabilityShowApi: 1, name: 'acme.tool', kind: 'member', repoKey: 'github.com/acme/agents', package: null, version: null, commit,
  path: 'capabilities/acme-tool', inject: { path: 'inject.md', bytes: 4, text: '# Hi', binary: false, truncated: false }, skills: [], problems: [], ...over });
function page(t, answer) {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { pretendToBeVisual: true });
  const doc = dom.window.document, calls = [];
  const contents = createCapabilityContents(doc, { request: body => { calls.push(body); return Promise.resolve(structuredClone(answer.current)); } });
  doc.querySelector('main').append(contents.element);
  t.after(() => { contents.dispose(); dom.window.close(); });
  return { doc, calls, contents, $: s => contents.element.querySelector(s), go: (r = row) => contents.update({ row: r, cli, deployment: '/ws' }) };
}

test('capability page: a Warnings block above the card, no capability name, no Open capability; the CSS is composed', async t => {
  assert.ok(capabilityContentsCSS.includes(capabilityWarningsCSS));
  const answer = { current: showAnswer({ warnings: [KERNEL, { ...KERNEL, path: 'github.com/acme/agents:capabilities/acme-tool/oats.json#/hooks/on-tag', message: 'second' }] }) };
  const u = page(t, answer);
  u.go(); await flush();
  const block = u.$('.cap-contents-warnings');
  assert.equal(block.hidden, false);
  assert.equal(block.nextElementSibling, u.$('.cap-contents'), 'above the two-pane card');
  assert.equal(block.querySelector('h4.page-section-title').textContent, 'Warnings');
  assert.equal(block.querySelectorAll('.cap-warning').length, 2);
  assert.equal(block.querySelector('button'), null, 'no Open capability: every warning is about this page');
  assert.equal(block.querySelector('.cap-warning-capability'), null);
  assert.equal(u.$('.cap-reader-body').textContent.includes('Hi'), true, 'the contents read as before');
});

test('capability page: no Warnings block for [] or an older kernel\'s answer', async t => {
  for (const over of [{ warnings: [] }, {}, { warnings: 'x' }]) {
    const u = page(t, { current: showAnswer(over) });
    u.go(); await flush();
    assert.equal(u.$('.cap-contents-warnings').hidden, true, JSON.stringify(over));
    assert.equal(u.$('.cap-contents-warnings').childElementCount, 0);
    assert.equal(u.$('.cap-contents').hidden, false);
  }
});

test('capability page: an unchanged re-read keeps focus on a Details summary; a changed set repaints; a gate clears', async t => {
  const answer = { current: showAnswer({ warnings: [KERNEL] }) };
  const u = page(t, answer);
  u.go(); await flush();
  const summary = u.$('.cap-contents-warnings summary'); summary.focus();
  assert.equal(u.doc.activeElement, summary);
  u.contents.refresh(); await flush();
  assert.equal(u.calls.filter(c => c.action === 'show').length, 2, 'read again');
  assert.equal(u.$('.cap-contents-warnings summary'), summary, 'the same node: not rebuilt');
  assert.equal(u.doc.activeElement, summary, 'focus stays');
  // A changed set repaints; focus is found again by its key.
  answer.current = showAnswer({ warnings: [{ ...KERNEL, message: 'changed' }] });
  u.contents.refresh(); await flush();
  assert.equal(u.$('.cap-contents-warnings .cap-warning-message').textContent, 'changed');
  assert.notEqual(u.$('.cap-contents-warnings summary'), summary);
  assert.equal(u.doc.activeElement, u.$('.cap-contents-warnings summary'), 'focus restored by data-focus-key');
  // Warnings gone on a re-read: the block hides.
  answer.current = showAnswer({ warnings: [] });
  u.contents.refresh(); await flush();
  assert.equal(u.$('.cap-contents-warnings').hidden, true);
  // Another capability starts afresh; a gate clears the block.
  answer.current = showAnswer({ warnings: [KERNEL] });
  u.contents.refresh(); await flush();
  assert.equal(u.$('.cap-contents-warnings').hidden, false);
  u.contents.update({ row: { name: 'x', kind: 'external' }, cli, deployment: '/ws' });
  assert.equal(u.$('.cap-contents-warnings').hidden, true);
  assert.equal(u.$('.cap-contents-warnings').childElementCount, 0);
});

/* ── Workspace › Setup (sources) ───────────────────────────────────────── */
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
const f2 = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f2/${name}.json`, import.meta.url), 'utf8'));
const dir = '/fixture/base/northwind-workspace';
const CLI = { ...f2('version'), ok: true, bin: '/fixture/bin/oats', operationsApi: 1, relations: true };
const roster = deploymentStatusData(f2('status'), dir);
const instances = roster.agents.flatMap(agent => agent.instances.map(i => ({ ...i, agent: i.agent || agent.name, agentsRoot: roster.root })));
const catalogAnswer = () => ({ workspaceSyncApi: 1, status: 'ok', report: null, capabilities: { capabilitiesApi: 1, ...f2('capabilities').result }, reason: null });
const trust = JSON.parse(readFileSync(new URL('./fixtures/automations-trust/partial-workspace-status.json', import.meta.url), 'utf8'));
const HOUSE = { code: 'hook-event-unsupported', capability: 'nw-house-style', path: 'local//fixture/base/fx/remotes/agents.git:capabilities/nw-house-style/oats.json#/hooks/on-merge',
  message: 'capability nw-house-style declares hook "on-merge", which this kernel does not run; it is ignored' };
const MISSING = { ...HOUSE, capability: 'acme.elsewhere', path: 'package:acme:capabilities/x/oats.json#/hooks/on-merge', message: 'capability acme.elsewhere declares hook "on-merge"' };

async function workspace(t, { status, sync = async () => catalogAnswer() } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'http://localhost' });
  const previous = { document: globalThis.document, window: globalThis.window, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  const polls = [];
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.setInterval = fn => { polls.push(fn); return 0; };
  let observedStatus = status;
  const ctx = { hasWorkspaceSwitcher: true, api: async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    if (path === '/api/cli') return CLI;
    if (path.startsWith('/api/agents')) return { agents: roster.agents.map(({ instances: _i, ...soul }) => ({ ...soul, agentsRoot: roster.root })) };
    if (path.startsWith('/api/panel')) return { workspace: { id: currentWorkspace(), scope: currentWorkspace() }, workspaces: [], instances,
      deployment: { status: 'observed', root: roster.root, workspace: observedStatus.workspace, workspaceStatus: observedStatus, reachable: { reachable: true }, withheld: [] } };
    if (path.startsWith('/api/workspace-sync')) return sync(body);
    if (path.startsWith('/api/servers')) return { servers: [] };
    if (path.startsWith('/api/capabilities')) return new Promise(() => {});
    throw new Error(`Unexpected fixture API request: ${path}`);
  } };
  t.after(() => { spawn.unmount(); setWorkspace(previous.ws); globalThis.document = previous.document; globalThis.window = previous.window; globalThis.setInterval = previous.setInterval; dom.window.close(); });
  setWorkspace('/team');
  await refreshCli({ api: async () => CLI });
  spawn.mount(dom.window.document.querySelector('#host'), ctx); await settle();
  const doc = dom.window.document;
  return { doc, tab: async name => { doc.getElementById(`workspace-tab-${name}`).click(); await settle(); },
    warnings: () => [...doc.querySelectorAll('.catalog-notes .cap-warning')],
    poll: async next => { observedStatus = next; for (const fn of polls) fn(); await settle(); } };
}
const statusWith = warnings => {
  const s = workspaceStatusData(f2('workspace-status'), dir);
  return { ...s, warnings: [...workspaceStatusData(trust, '/fixture/base/deployment').warnings, ...warnings] };
};

test('Setup: a hook-event-unsupported warning through the one list; Open capability only for a catalog capability; the remedy muted; the count unchanged', async t => {
  assert.ok(discoveryCSS.includes(capabilityWarningsCSS));
  const status = statusWith([HOUSE, MISSING]);
  status.warnings.push({ code: 'unmapped-team-label', label: 'ghost', message: 'team label ghost is not mapped' });
  const u = await workspace(t, { status });
  await u.tab('sources');
  const items = u.warnings();
  assert.equal(items.length, 4, 'two automation-trust warnings, two capability warnings; the team one stays on Teams');
  assert.equal(u.doc.querySelector('.catalog-notes').textContent.includes('team label ghost'), false);
  assert.ok(items.every(i => i.querySelector('.cap-warning-label').textContent === 'Warning'));
  assert.equal(u.doc.querySelectorAll('.catalog-notes > p.catalog-note.warn').length, 0, 'no second look for warnings');
  // The remedy: a muted line under its message.
  const [untrusted, stale, house, missing] = items;
  assert.equal(untrusted.querySelector('.cap-warning-message').textContent, trust.result.warnings[0].message);
  assert.equal(untrusted.querySelector('.cap-warning-note').textContent, trust.result.warnings[0].remedy);
  assert.equal(stale.querySelector('.cap-warning-note'), null);
  // The capability warnings name their capability; Open capability only where the catalog lists it.
  assert.equal(house.querySelector('.cap-warning-capability').textContent, 'nw-house-style');
  assert.equal(house.querySelector('button.cap-warning-open').getAttribute('aria-label'), 'Open capability nw-house-style');
  assert.equal(missing.querySelector('.cap-warning-capability').textContent, 'acme.elsewhere');
  assert.equal(missing.querySelector('button'), null, 'not in the catalog: nothing to open');
  assert.deepEqual([...house.querySelectorAll('dd')].map(n => n.textContent), [HOUSE.code, HOUSE.path]);
  // The tab's attention count is the same rule as before (setupAttention), team warning excluded.
  const n = setupAttention(status);
  assert.equal(u.doc.querySelector('#workspace-tab-sources .workspace-sr-only').textContent, ` — ${n} items need attention`);
  // Open capability opens its page.
  house.querySelector('button.cap-warning-open').click(); await settle();
  const pageEl = u.doc.querySelector('.capability-page');
  assert.ok(pageEl, 'the capability page opened');
  assert.match(pageEl.textContent, /nw-house-style/);
});

test('Setup: before the catalog lands there is no Open capability; it appears when the catalog does; an unchanged poll keeps focus', async t => {
  let release; const held = new Promise(resolve => { release = resolve; });
  const status = statusWith([HOUSE]);
  const u = await workspace(t, { status, sync: async () => { await held; return catalogAnswer(); } });
  await u.tab('sources');
  const house = () => u.warnings().find(i => i.querySelector('.cap-warning-capability')?.textContent === 'nw-house-style');
  assert.ok(house());
  assert.equal(house().querySelector('button'), null, 'the catalog is not read yet');
  release(); await settle();
  const open = house().querySelector('button.cap-warning-open');
  assert.ok(open, 'the catalog landed: the render key repainted with it');
  open.focus();
  await u.poll({ ...status, workspace: { ...status.workspace, observedAt: '2026-10-08T10:00:00.000Z' } });
  assert.equal(u.doc.activeElement, open, 'an unchanged set is not rebuilt');
  // A changed set repaints; focus is found again by its key.
  await u.poll({ ...status, warnings: [...status.warnings, { ...HOUSE, message: 'another' }] });
  assert.equal(u.warnings().length, status.warnings.length + 1);
  assert.notEqual(house().querySelector('button.cap-warning-open'), open);
  assert.equal(u.doc.activeElement?.dataset.focusKey, open.dataset.focusKey, 'focus restored by data-focus-key');
});
