// The sidebar roster's loading states (desktop/loading-states, Phase A #1):
// a workspace switch and the first read never show "No instances" / "0 running"
// — the count is a skeleton pill and, after 150ms, five roster-row skeletons
// wait in the list; a failure with data keeps the list, disables Start… and the
// row actions and paints "Couldn't refresh instances · observed <age>" + Retry;
// an unchanged 4s poll rebuilds nothing; the empty copy only follows a
// successful zero read. The shipped shell functions run in a vm context with
// the real primitive, instance tree and instance actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import * as tree from '../renderer/instance-tree.mjs';
import { PENDING_DELAY_MS, REFRESHING_DELAY_MS, AGE_TICK_MS } from '../renderer/loading.mjs';
import { instanceActions, captureInstanceActionMenu } from '../renderer/instance-actions.mjs';
import { instanceActionTarget, sameInstanceActionTarget } from '../renderer/instance-action-target.mjs';
import { instanceSplitPlan } from '../renderer/instance-split.mjs';
import { runtimeState } from '../renderer/instance-presentation.mjs';
import { createRuntimeBadge } from '../renderer/identity-marks.mjs';
import { iconElement, mountShellIcons } from '../renderer/shell-icons.mjs';
import { rosterTipFacts } from '../renderer/roster-tip.mjs';
import { prChip, prText } from '../renderer/roster-pr.mjs';
import { deploymentUnavailableText } from '../renderer/deployment-header.mjs';
import { staleWorkspaceSelection } from '../renderer/views/common.mjs';
import { createWorkspaceTabMemory } from '../renderer/workspace-tab-memory.mjs';

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), 'utf8');
const source = read('shell.mjs');
const fn = name => {
  const found = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
  assert.ok(found, `exercise shipped ${name}`); return found[0];
};
const tick = () => new Promise(resolve => setImmediate(resolve));

/** A fake clock: timers fire in order when advanced; `now()` follows. */
function clock() {
  let now = Date.parse('2026-09-29T14:05:00.000Z'), seq = 0; const timers = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: id => { timers.delete(id); },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      now = until;
    },
  };
}
const row = (name, extra = {}) => ({ instance: name, home: `/synthetic/${name}`, agentsRoot: '/synthetic/agents', repoName: 'oats', branch: `b/${name}`, running: true, ...extra });
const roster = [row('alpha'), row('beta', { running: false }), row('gamma', { parentInstance: 'alpha' })];
const panelOf = (ws, instances, extra = {}) => ({ workspace: { id: ws, name: ws }, workspaces: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }], deployment: { status: 'observed' }, instances, ...extra });

/* ── the helpers in instance-tree.mjs ─────────────────────────────────────── */
function rosterDom(t, html = read('index.html')) {
  const dom = new JSDOM(html, { pretendToBeVisual: true }); t.after(() => dom.window.close());
  return { dom, doc: dom.window.document, rosterEl: dom.window.document.getElementById('instance-roster') };
}

test('renderRosterCount: pending is a skeleton pill kept in place, never "0 running"; stale is titled as the last observation', t => {
  const { doc, rosterEl } = rosterDom(t);
  const count = rosterEl.querySelector('.ctx-count');
  tree.renderRosterCount(count, [], { pending: true });
  const pill = count.querySelector('.skeleton-pill');
  assert.ok(pill); assert.equal(pill.getAttribute('aria-hidden'), 'true'); assert.equal(count.textContent, '');
  assert.equal(count.hasAttribute('title'), false, 'no breakdown to tell yet');
  tree.renderRosterCount(count, [], { pending: true });
  assert.equal(count.querySelector('.skeleton-pill'), pill, 'a repeated pending paint keeps the same pill');
  tree.renderRosterCount(count, roster);
  assert.equal(count.textContent, '2 running'); assert.equal(count.title, '2 running · 1 stopped'); assert.equal(count.dataset.stale, undefined);
  tree.renderRosterCount(count, roster, { stale: true });
  assert.equal(count.textContent, 'Last observation: 2 running', 'AT hears that it is the last observation'); assert.ok(count.querySelector('.ctx-count-stale.loading-sr'), 'visually hidden: the visible number is what was last observed');
  assert.equal(count.title, 'Last observation — 2 running · 1 stopped'); assert.equal(count.dataset.stale, '1');
  assert.match(readFileSync(new URL('../renderer/shell.css', import.meta.url), 'utf8'), /\.ctx-count\[data-stale\] \{ color: var\(--muted\)/, 'and it looks muted, not current');
  tree.renderRosterCount(count, roster);
  assert.equal(count.dataset.stale, undefined);
  assert.equal(doc.querySelectorAll('.skeleton-pill').length, 0);
});

test('createRosterLoading wires the shipped chrome: list region, head indicator, a .ctx-status host before the list, a hidden status line', t => {
  const { doc, rosterEl } = rosterDom(t);
  const c = clock();
  const state = tree.createRosterLoading(doc, rosterEl, { now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  const list = rosterEl.querySelector('.ctx-list'), status = rosterEl.querySelector('.ctx-status');
  assert.ok(status, 'the stale-line host exists'); assert.equal(status.nextElementSibling, list, 'right before the list');
  assert.equal(status.previousElementSibling.className, 'ctx-filter-field', 'right after the filter field');
  const live = rosterEl.querySelector('[role="status"]');
  assert.ok(live.classList.contains('loading-sr'), 'the sidebar has no visible status line: it only speaks');
  state.begin();
  assert.equal(list.getAttribute('aria-busy'), 'true'); assert.equal(live.textContent, 'Loading instances…');
  assert.equal(list.querySelector('[data-skeleton]'), null, 'nothing before the delay');
  c.advance(PENDING_DELAY_MS);
  const block = list.querySelector('.skeleton-roster-rows');
  assert.equal(block.querySelectorAll('.skeleton-roster-row').length, tree.ROSTER_SKELETON_ROWS);
  state.succeed({ observedAt: new Date(c.now()).toISOString() });
  assert.equal(list.getAttribute('aria-busy'), null); assert.equal(list.querySelector('[data-skeleton]'), null);
  state.begin(); c.advance(REFRESHING_DELAY_MS);
  const indicator = rosterEl.querySelector('.ctx-head .loading-refreshing');
  assert.equal(indicator.textContent, 'Refreshing…'); assert.equal(indicator.previousElementSibling.className, 'ctx-count', 'after the count');
  c.advance(30_000); state.fail(new Error('boom'));
  assert.equal(status.querySelector('.loading-notice-text').textContent, "Couldn't refresh instances · observed 30s ago");
  assert.equal(status.querySelector('.loading-retry').textContent, 'Retry');
  // A focused Retry that vanishes on success hands focus to the filter.
  status.querySelector('.loading-retry').focus(); state.begin(); state.succeed({ observedAt: new Date(c.now()).toISOString() });
  assert.equal(doc.activeElement, rosterEl.querySelector('.ctx-filter'));
  assert.equal(status.children.length, 0);
});

test('createRosterLoading survives a test DOM without head or filter field: the status host still precedes the list', t => {
  const { doc, rosterEl } = rosterDom(t, '<div id="instance-roster"><input class="ctx-filter"><span class="ctx-count"></span><div class="ctx-list"></div></div>');
  const state = tree.createRosterLoading(doc, rosterEl);
  assert.equal(rosterEl.querySelector('.ctx-status').nextElementSibling, rosterEl.querySelector('.ctx-list'));
  state.begin(); state.succeed(); state.begin();
  assert.equal(rosterEl.querySelector('.loading-refreshing'), null, 'no head, no indicator host');
  state.dispose();
});

test('rosterSignature: identical instances and facts agree; any painted fact changes it', () => {
  const facts = { workspace: 'A', error: null, deploymentNote: null, activeKey: null, connection: 0 };
  assert.equal(tree.rosterSignature(roster, facts), tree.rosterSignature(roster.map(r => ({ ...r })), { ...facts }));
  assert.notEqual(tree.rosterSignature(roster, facts), tree.rosterSignature(roster.slice(1), facts));
  for (const change of [{ workspace: 'B' }, { error: 'Server is unreachable' }, { deploymentNote: 'x' }, { activeKey: 'A:alpha' }, { connection: 1 }]) {
    assert.notEqual(tree.rosterSignature(roster, facts), tree.rosterSignature(roster, { ...facts, ...change }));
  }
  assert.notEqual(tree.rosterSignature([row('a')], facts), tree.rosterSignature([row('a', { running: false })], facts), 'a state change repaints');
});

/* ── the shipped shell: initContextRoster + refreshContextRoster + renderContextRoster (+ restoreWorkspaceTabs) ── */
function shell(t) {
  const { dom, doc, rosterEl } = rosterDom(t);
  mountShellIcons(doc);
  const c = clock(), requests = [], listeners = [];
  const context = {
    ...tree, document: doc, console,
    // The controller is built by the shipped initContextRoster; the clock is the test's.
    createRosterLoading: (d, el, options) => tree.createRosterLoading(d, el, { ...options, now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout }),
    instanceActions, captureInstanceActionMenu, runtimeState, createRuntimeBadge, instanceActionTarget, instanceSplitPlan, iconElement, prChip, prText,
    rosterTipFacts, deploymentUnavailableText, staleWorkspaceSelection,
    rosterTip: { bind() {}, hide() {}, sync() {} }, rosterPrs: { get: () => null, refresh() {} }, ctx: {},
    connectionGeneration: 0, menuState() {}, runAction: assert.fail, getBinding: () => null, formatChord: x => x, isMac: true,
    contextRosterEl: null, contextRosterGen: 0, contextFilter: '', contextWorkspace: 'A', contextInstances: [], tabWorkspace: 'A',
    rosterState: null, rosterStale: false, contextDeploymentNote: null, rosterSignaturePainted: null,
    workspace: 'A', generation: 0, tabs: new Map(), activeTab: null, split: null, sidebarMode: 'instances', tabLayerVisible: false,
    stage: { name: 'hierarchy' }, collapsedInstances: new Set(),
    workspaceGeneration: () => context.generation, currentWorkspace: () => context.workspace,
    adoptWorkspace: ws => { context.workspace = ws; },
    workspaceLabel: { begin: () => () => false, reset() {} },
    tabOpenIntents: { applyFocus: f => f(), invalidate() {}, isApplyingFocus: () => false },
    brainIntents: { invalidate() {} }, workspaceTabMemory: createWorkspaceTabMemory(),
    showTabLayer() {}, renderSplit() {}, setSidebarMode() {}, activateTab() {}, stageSidebarMode: () => 'overview', setNavActive() {}, updateContextTabs() {},
    refreshPanelInstance() {}, openTerminalTab: assert.fail, openInstanceStart: assert.fail, onRosterRowKey: assert.fail,
    api(path) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); requests.push({ path, resolve, reject }); return promise; },
    showStage: assert.fail, updateActiveContexts() {}, applyChordTitles() {},
  };
  context.splitOpenState = () => ({ split: null, activeId: context.activeTab, tabs: context.tabs, workspace: context.workspace, visible: false });
  context.ownsInstanceTarget = target => context.contextInstances.filter(r => sameInstanceActionTarget(target, r, context.workspace)).length === 1;
  const s = runInNewContext(`${['initContextRoster', 'refreshContextRoster', 'renderContextRoster', 'renderWorkspaceContext', 'restoreWorkspaceTabs'].map(fn).join('\n')}
    ({ initContextRoster, refreshContextRoster, renderContextRoster, restoreWorkspaceTabs });`, context);
  // #sidebar is not in index.html's roster section alone; initContextRoster listens on it.
  if (!doc.getElementById('sidebar')) { const aside = doc.createElement('aside'); aside.id = 'sidebar'; aside.append(rosterEl); doc.body.append(aside); }
  s.initContextRoster();
  const list = () => rosterEl.querySelector('.ctx-list');
  return {
    ...s, c, context, doc, dom, rosterEl, requests, list,
    count: () => rosterEl.querySelector('.ctx-count'), status: () => rosterEl.querySelector('.ctx-status'), live: () => rosterEl.querySelector('[role="status"].loading-sr'),
    rows: () => [...list().querySelectorAll('.ctx-tree-row:not(.skeleton-roster-row)')], /* the skeleton wears the row class too */ names: () => [...list().querySelectorAll('.ctx-name')].map(n => n.textContent),
    text: () => list().textContent,
    async reply(index, panel) { requests[index].resolve(panel); await tick(); },
    async fail(index, error) { requests[index].reject(error); await tick(); },
    switchTo(ws) { context.workspace = ws; context.generation++; s.restoreWorkspaceTabs(); },
  };
}

test('first read: no false empty; the count is a pill; the skeleton waits 150ms and never shows for a fast reply', async t => {
  const s = shell(t);
  assert.equal(s.requests.length, 1, 'initContextRoster starts the first read');
  assert.equal(s.list().getAttribute('aria-busy'), 'true'); assert.equal(s.live().textContent, 'Loading instances…');
  assert.ok(s.count().querySelector('.skeleton-pill')); assert.doesNotMatch(s.count().textContent, /running/);
  assert.doesNotMatch(s.text(), /No instances|Nothing matches|Roster unavailable/);
  s.c.advance(PENDING_DELAY_MS - 1); assert.equal(s.list().querySelector('[data-skeleton]'), null, 'nothing before 150ms');
  await s.reply(0, panelOf('A', roster));
  assert.equal(s.list().querySelector('[data-skeleton]'), null, 'a fast reply never flashed a skeleton');
  s.c.advance(PENDING_DELAY_MS); assert.equal(s.list().querySelector('[data-skeleton]'), null, 'and the cancelled timer paints none later');
  assert.deepEqual(s.names(), ['alpha', 'gamma', 'beta']); assert.equal(s.count().textContent, '2 running');
  assert.equal(s.list().getAttribute('aria-busy'), null); assert.equal(s.live().textContent, '', 'a background read announces nothing on success');
  assert.equal(s.context.rosterState.state, 'ready');
});

test('a slow first read shows five roster-row skeletons in the list, then the rows replace them; the filter field stays interactive', async t => {
  const s = shell(t);
  s.c.advance(PENDING_DELAY_MS);
  const block = s.list().querySelector('.skeleton-roster-rows');
  assert.equal(block.querySelectorAll('.skeleton-roster-row').length, 5); assert.equal(block.getAttribute('aria-hidden'), 'true');
  assert.equal(s.rows().length, 0); assert.doesNotMatch(s.text(), /No instances/);
  // Typing in the filter while pending re-renders: still no empty copy and the skeleton stays.
  const filter = s.rosterEl.querySelector('.ctx-filter'); filter.value = 'zzz'; filter.dispatchEvent(new s.dom.window.Event('input', { bubbles: true }));
  assert.ok(s.list().querySelector('.skeleton-roster-rows')); assert.doesNotMatch(s.text(), /Nothing matches|No instances/);
  filter.value = ''; filter.dispatchEvent(new s.dom.window.Event('input', { bubbles: true }));
  await s.reply(0, panelOf('A', roster));
  assert.equal(s.list().querySelector('[data-skeleton]'), null); assert.equal(s.rows().length, 3);
});

test('a successful zero read paints the empty copy; a filter with no match paints "Nothing matches." only once data is present', async t => {
  const s = shell(t);
  await s.reply(0, panelOf('A', []));
  assert.equal(s.text(), 'No instances.'); assert.equal(s.count().textContent, '0 running');
  assert.equal(s.context.rosterState.state, 'empty'); assert.equal(s.list().getAttribute('aria-busy'), null);
  s.refreshContextRoster(); await s.reply(1, panelOf('A', roster));
  const filter = s.rosterEl.querySelector('.ctx-filter'); filter.value = 'nope'; filter.dispatchEvent(new s.dom.window.Event('input', { bubbles: true }));
  assert.equal(s.text(), 'Nothing matches.');
});

test('a failed first read paints the failed block (cause, Details, Retry) where the skeleton stood, never "Roster unavailable"; Retry re-reads as a user read', async t => {
  const s = shell(t);
  s.c.advance(PENDING_DELAY_MS);
  const error = new Error('bridge down'); error.code = 'E_BRIDGE';
  await s.fail(0, error);
  assert.equal(s.list().querySelector('[data-skeleton]'), null);
  const failed = s.list().querySelector('.loading-failed');
  assert.equal(failed.querySelector('.loading-failed-message').textContent, 'bridge down');
  assert.equal(failed.querySelector('.loading-failed-code').textContent, 'E_BRIDGE');
  assert.doesNotMatch(s.text(), /Roster unavailable|No instances/);
  assert.equal(s.list().getAttribute('aria-busy'), null, 'failed is not busy');
  assert.equal(s.live().textContent, "Couldn't refresh instances. bridge down");
  assert.ok(s.count().querySelector('.skeleton-pill'), 'still no count to tell');
  const retry = failed.querySelector('.loading-retry'); retry.focus(); retry.click();
  assert.equal(s.requests.length, 2, 'Retry re-reads'); assert.equal(retry.getAttribute('aria-disabled'), 'true'); assert.equal(s.doc.activeElement, retry, 'never `disabled`: focus survives');
  retry.click(); assert.equal(s.requests.length, 2, 'a repeat activation while busy is ignored');
  assert.equal(s.list().getAttribute('aria-busy'), 'true'); assert.equal(s.live().textContent, 'Loading instances…');
  await s.reply(1, panelOf('A', roster));
  assert.equal(s.list().querySelector('.loading-failed'), null); assert.equal(s.rows().length, 3);
  assert.equal(s.live().textContent, 'Instances updated', 'a user-invoked read is announced');
  assert.equal(s.doc.activeElement, s.rosterEl.querySelector('.ctx-filter'), 'the focused Retry went; focus lands on the filter');
});

test('refreshing keeps rows and focus; "Refreshing…" appears in the head only after 400ms; an unchanged poll rebuilds nothing', async t => {
  const s = shell(t);
  await s.reply(0, panelOf('A', roster));
  const before = s.rows();
  const focused = before[1].querySelector('.ctx-inst'); focused.focus(); assert.equal(s.doc.activeElement, focused);
  s.refreshContextRoster();
  assert.equal(s.list().getAttribute('aria-busy'), null, 'refreshing is not busy'); assert.equal(s.context.rosterState.state, 'refreshing');
  assert.deepEqual(s.rows(), before, 'content stays'); assert.equal(s.doc.activeElement, focused);
  s.c.advance(REFRESHING_DELAY_MS - 1); assert.equal(s.rosterEl.querySelector('.loading-refreshing'), null);
  s.c.advance(1);
  const indicator = s.rosterEl.querySelector('.ctx-head > .loading-refreshing');
  assert.equal(indicator.textContent, 'Refreshing…'); assert.equal(indicator.previousElementSibling, s.count());
  await s.reply(1, panelOf('A', roster.map(r => ({ ...r }))));
  assert.equal(s.rosterEl.querySelector('.loading-refreshing'), null);
  assert.deepEqual(s.rows(), before, 'identical data: the very same nodes'); assert.equal(s.doc.activeElement, focused);
  // Changed data repaints and restores the logical focus.
  s.refreshContextRoster(); await s.reply(2, panelOf('A', [...roster, row('delta')]));
  assert.notEqual(s.rows()[1], before[1]); assert.deepEqual(s.names(), ['alpha', 'gamma', 'delta', 'beta'], 'clusters first, then the independent rows');
  assert.equal(s.doc.activeElement.dataset.treeInstance, focused.dataset.treeInstance);
});

test('a fast refresh never shows "Refreshing…"; the active terminal changing repaints even with the same instances', async t => {
  const s = shell(t);
  await s.reply(0, panelOf('A', roster));
  s.refreshContextRoster(); await s.reply(1, panelOf('A', roster));
  s.c.advance(REFRESHING_DELAY_MS * 2);
  assert.equal(s.rosterEl.querySelector('.loading-refreshing'), null);
  const before = s.rows();
  s.context.tabs.set(1, { key: tree.terminalKey('A', roster[0]) }); s.context.activeTab = 1;
  s.refreshContextRoster(); await s.reply(2, panelOf('A', roster));
  assert.notEqual(s.rows()[0], before[0], 'the active highlight is part of the paint');
  assert.ok(s.rows()[0].classList.contains('active'));
});

test('failure with data: rows kept, stale line with the observed age and Retry, Start… and the actions menu disabled, the terminal row enabled', async t => {
  const s = shell(t);
  await s.reply(0, panelOf('A', roster, { observedAt: new Date(s.c.now()).toISOString() }));
  const alpha = s.rows()[0].querySelector('.ctx-inst'); alpha.focus();
  s.c.advance(45_000);
  s.refreshContextRoster(); await s.fail(1, new Error('bridge down'));
  assert.equal(s.context.rosterState.state, 'stale'); assert.equal(s.rows().length, 3, 'the list is kept');
  assert.equal(s.list().getAttribute('aria-busy'), null); assert.equal(s.list().querySelector('[data-skeleton], .loading-failed'), null);
  const notice = s.status().querySelector('.loading-notice[data-kind="stale"]');
  assert.equal(notice.querySelector('.loading-notice-text').textContent, "Couldn't refresh instances · observed 45s ago");
  assert.equal(notice.title, 'bridge down');
  const retry = notice.querySelector('.loading-retry'); assert.equal(retry.textContent, 'Retry'); assert.equal(retry.getAttribute('aria-disabled'), null);
  assert.equal(s.live().textContent, "Couldn't refresh instances.");
  assert.equal(s.count().title, 'Last observation — 2 running · 1 stopped'); assert.equal(s.count().textContent, 'Last observation: 2 running');
  const start = s.list().querySelector('.ctx-start');
  assert.equal(start.disabled, true); assert.equal(start.title, tree.ROSTER_STALE_TITLE); assert.equal(start.getAttribute('aria-description'), 'Unavailable: roster is not current', 'an accessible reason, not just a greyed look');
  for (const trigger of s.list().querySelectorAll('.ctx-instance-actions')) { assert.equal(trigger.disabled, true); assert.equal(trigger.title, tree.ROSTER_STALE_TITLE); assert.equal(trigger.getAttribute('aria-description'), tree.ROSTER_STALE_TITLE); }
  assert.equal(s.rows()[0].querySelector('.ctx-inst').disabled, false, 'opening the existing terminal stays possible');
  assert.equal(s.doc.activeElement.dataset.treeInstance, alpha.dataset.treeInstance, 'the focused row survives the stale repaint');
  // The age line keeps itself current.
  s.c.advance(AGE_TICK_MS);
  assert.equal(notice.querySelector('.loading-notice-text').textContent, "Couldn't refresh instances · observed 1 min ago");
  // A repeat failure keeps the rows (already stale) and updates the line in place.
  const staleRows = s.rows();
  s.refreshContextRoster(); await s.fail(2, new Error('still down'));
  assert.deepEqual(s.rows(), staleRows); assert.equal(s.status().querySelector('.loading-notice'), notice); assert.equal(notice.title, 'still down');
  // Retry: a user read; while it is in flight the Retry is aria-disabled and keeps focus; success clears the line and re-enables actions.
  retry.focus(); retry.click();
  assert.equal(s.requests.length, 4); assert.equal(retry.getAttribute('aria-disabled'), 'true'); assert.equal(s.doc.activeElement, retry);
  assert.equal(s.rows().length, 3, 'still kept while retrying');
  await s.reply(3, panelOf('A', roster, { observedAt: new Date(s.c.now()).toISOString() }));
  assert.equal(s.status().children.length, 0); assert.equal(s.context.rosterState.state, 'ready');
  assert.equal(s.list().querySelector('.ctx-start').disabled, false); assert.equal(s.list().querySelector('.ctx-start').title, '');
  for (const trigger of s.list().querySelectorAll('.ctx-instance-actions')) assert.equal(trigger.disabled, false);
  assert.equal(s.count().dataset.stale, undefined);
  assert.equal(s.live().textContent, 'Instances updated');
  assert.equal(s.doc.activeElement, s.rosterEl.querySelector('.ctx-filter'), 'the vanished Retry hands focus to the filter, not to nothing');
});

test('a reported panel error beside instances is the last observation: stale line, actions disabled, no ctx-empty error; repeats update in place', async t => {
  const s = shell(t);
  await s.reply(0, panelOf('A', roster, { error: 'Server is unreachable' }));
  assert.equal(s.rows().length, 3); assert.equal(s.list().querySelector('.ctx-empty'), null, 'the error is no longer a list row');
  assert.equal(s.context.rosterState.state, 'stale');
  const notice = s.status().querySelector('.loading-notice[data-kind="stale"]');
  assert.equal(notice.title, 'Server is unreachable'); assert.match(notice.textContent, /^Couldn't refresh instances/);
  assert.equal(s.list().querySelector('.ctx-start').disabled, true);
  assert.equal(s.live().textContent, "Couldn't refresh instances.");
  const rows = s.rows();
  s.refreshContextRoster(); await s.reply(1, panelOf('A', roster, { error: 'Server is unreachable' }));
  assert.deepEqual(s.rows(), rows, 'the same failing observation repaints nothing');
  assert.equal(s.status().querySelector('.loading-notice'), notice, 'the stale line is updated in place');
  assert.equal(s.live().textContent, "Couldn't refresh instances.", 'and not announced anew');
  s.refreshContextRoster(); await s.reply(2, panelOf('A', roster));
  assert.equal(s.status().children.length, 0); assert.equal(s.list().querySelector('.ctx-start').disabled, false);
  assert.equal(s.context.rosterState.state, 'ready');
});

test('a deployment the kernel could not observe keeps its own note above the rows (no skeleton), and the note is part of the signature', async t => {
  const s = shell(t);
  await s.reply(0, panelOf('A', roster, { deployment: { status: 'unavailable', reason: { code: 'E_X', message: 'refused' } } }));
  const note = s.list().querySelector('.ctx-empty');
  assert.equal(note.textContent, 'E_X: refused'); assert.equal(note.getAttribute('role'), 'status'); assert.equal(note, s.list().firstElementChild);
  assert.equal(s.rows().length, 3);
  s.refreshContextRoster(); await s.reply(1, panelOf('A', roster, { deployment: { status: 'unavailable', reason: { code: 'E_X', message: 'refused' } } }));
  assert.equal(s.list().querySelector('.ctx-empty'), note, 'unchanged: kept');
  s.refreshContextRoster(); await s.reply(2, panelOf('A', roster));
  assert.equal(s.list().querySelector('.ctx-empty'), null, 'observed: the note goes');
});

test('a workspace switch clears the rows into pending (pill, then skeletons), never "No instances" / "0 running"; a late reply for the old workspace is dropped', async t => {
  const s = shell(t);
  await s.reply(0, panelOf('A', roster));
  assert.equal(s.rows().length, 3);
  s.refreshContextRoster(); // a poll for A in flight
  s.switchTo('B');
  assert.equal(s.rows().length, 0, 'the old rows go at once'); assert.doesNotMatch(s.text(), /No instances/);
  assert.ok(s.count().querySelector('.skeleton-pill')); assert.doesNotMatch(s.count().textContent, /running/);
  assert.equal(s.list().getAttribute('aria-busy'), 'true'); assert.equal(s.context.rosterState.state, 'pending');
  assert.equal(s.requests.length, 3); assert.equal(s.requests[2].path, '/api/panel?ws=B');
  await s.reply(1, panelOf('A', [row('late')]));
  assert.equal(s.rows().length, 0, 'the superseded read paints nothing'); assert.equal(s.context.rosterState.state, 'pending', 'and does not settle the new subject');
  s.c.advance(PENDING_DELAY_MS);
  assert.equal(s.list().querySelectorAll('.skeleton-roster-row').length, 5);
  await s.reply(2, panelOf('B', [row('b-one')]));
  assert.deepEqual(s.names(), ['b-one']); assert.equal(s.count().textContent, '1 running'); assert.equal(s.list().querySelector('[data-skeleton]'), null);
});

test('a switch away from a stale roster forgets the stale mark and the stale line; a superseded failure paints nothing', async t => {
  const s = shell(t);
  await s.reply(0, panelOf('A', roster));
  s.refreshContextRoster(); await s.fail(1, new Error('down'));
  assert.ok(s.status().querySelector('.loading-notice')); assert.equal(s.context.rosterStale, true);
  s.refreshContextRoster(); // in flight
  s.switchTo('B');
  assert.equal(s.status().children.length, 0); assert.equal(s.context.rosterStale, false); assert.equal(s.context.rosterSignaturePainted, null);
  await s.fail(2, new Error('late'));
  assert.equal(s.list().querySelector('.loading-failed'), null, 'a superseded failure is not this subject\'s failure');
  assert.equal(s.context.rosterState.state, 'pending');
  await s.reply(3, panelOf('B', [row('b-one', { running: false })]));
  assert.equal(s.list().querySelector('.ctx-start').disabled, false, 'B starts unmarked');
});

test('the retired wording is gone from the roster and the fixed wording is the primitive\'s', () => {
  const roster = source.slice(source.indexOf('function initContextRoster'), source.indexOf('function onRosterRowKey'));
  assert.doesNotMatch(roster, /Roster unavailable|Loading agents|Loading reported roster|Reading /);
  assert.match(source, /rosterState\?\.reset\(\);[\s\S]*renderContextRoster\(\[\]\);/, 'a switch resets the subject before the list is cleared');
  assert.match(source, /setInterval\(\(\) => refreshContextRoster\(\), 4000\)/, 'the 4s poll stays');
});

test('a deployment the server has not observed yet (status pending, no instances) keeps its own note: no "No instances", the count stays a pill, no skeleton; the observation then paints the rows', async t => {
  const u = shell(t);
  await u.reply(0, panelOf('A', [], { deployment: { status: 'pending' } }));
  assert.equal(u.text(), 'Reading the deployment through the installed OATS CLI…', 'the existing copy, alone');
  assert.doesNotMatch(u.text(), /No instances/); assert.ok(u.count().querySelector('.skeleton-pill'), 'never "0 running"');
  assert.equal(u.list().getAttribute('aria-busy'), 'true', 'still loading, truthfully'); u.c.advance(PENDING_DELAY_MS + 10); assert.equal(u.list().querySelector('.skeleton'), null, 'a deployment state is not a skeleton');
  assert.equal(u.live().textContent, 'Loading instances…', 'announced once');
  // The next polls repeat the same panel: no repaint (the note stays the same node).
  const note = u.list().querySelector('.ctx-empty');
  void u.refreshContextRoster(); await u.reply(1, panelOf('A', [], { deployment: { status: 'pending' } }));
  assert.equal(u.list().querySelector('.ctx-empty'), note);
  void u.refreshContextRoster(); await u.reply(2, panelOf('A', roster));
  assert.deepEqual(u.names(), ['alpha', 'gamma', 'beta']); assert.equal(u.count().textContent, '2 running'); assert.equal(u.list().querySelector('.ctx-empty'), null);
});

test('a panel that reports an error with no instances is a failed read, never "No instances.": failed block without data, stale rows kept with data', async t => {
  const u = shell(t);
  await u.reply(0, panelOf('A', [], { error: 'Server is unreachable' }));
  assert.doesNotMatch(u.text(), /No instances/); assert.equal(u.context.rosterState.state, 'failed');
  assert.equal(u.list().querySelector('.loading-failed-message').textContent, 'Server is unreachable'); assert.ok(u.list().querySelector('.loading-retry'));
  assert.ok(u.count().querySelector('.skeleton-pill'), 'the count stays a pill'); assert.equal(u.live().textContent, "Couldn't refresh instances. Server is unreachable");
  // Data lands, then the same failed reply: rows kept and stale, the error on the stale line.
  void u.refreshContextRoster(); await u.reply(1, panelOf('A', roster));
  assert.deepEqual(u.names(), ['alpha', 'gamma', 'beta']); assert.equal(u.context.rosterState.state, 'ready');
  void u.refreshContextRoster(); await u.reply(2, panelOf('A', [], { error: 'Server is unreachable' }));
  assert.deepEqual(u.names(), ['alpha', 'gamma', 'beta'], 'the last observation stays'); assert.equal(u.context.rosterState.state, 'stale');
  assert.match(u.status().textContent, /Couldn't refresh instances/); assert.equal(u.status().querySelector('.loading-notice').title, 'Server is unreachable');
  assert.ok(u.rows().every(r => !r.querySelector('.ctx-start') || r.querySelector('.ctx-start').disabled), 'stale: Start… disabled');
  assert.equal(u.count().dataset.stale, '1'); assert.equal(u.list().querySelector('.loading-failed'), null, 'no failed block over data');
});

test('the deployment note survives every other roster paint (filter, collapse, PR change) and an unchanged poll, while pending and with rows', async t => {
  const u = shell(t);
  const filter = u.rosterEl.querySelector('.ctx-filter'), type = v => { filter.value = v; filter.dispatchEvent(new u.dom.window.Event('input', { bubbles: true })); };
  // pending deployment: the note is the whole content; a filter edit keeps it.
  await u.reply(0, panelOf('A', [], { deployment: { status: 'pending' } }));
  type('zzz'); type('');
  assert.equal(u.text(), 'Reading the deployment through the installed OATS CLI…'); assert.equal(u.list().getAttribute('aria-busy'), 'true');
  void u.refreshContextRoster(); await u.reply(1, panelOf('A', [], { deployment: { status: 'pending' } }));
  assert.equal(u.text(), 'Reading the deployment through the installed OATS CLI…', 'an unchanged poll keeps it');
  // unavailable deployment with rows: the note stays above the rows through a filter edit, a collapse-free repaint and an unchanged poll.
  const unavailable = { status: 'unavailable', reason: { code: 'E_X', message: 'no kernel' } };
  void u.refreshContextRoster(); await u.reply(2, panelOf('A', roster, { deployment: unavailable }));
  const noteText = () => u.list().querySelector('.ctx-deployment-note')?.textContent;
  assert.equal(noteText(), 'E_X: no kernel'); assert.equal(u.list().firstElementChild.className, 'ctx-empty ctx-deployment-note');
  type('alp'); assert.equal(noteText(), 'E_X: no kernel'); assert.deepEqual(u.names(), ['alpha']);
  type(''); assert.equal(noteText(), 'E_X: no kernel'); assert.deepEqual(u.names(), ['alpha', 'gamma', 'beta']);
  u.renderContextRoster(u.context.contextInstances); assert.equal(noteText(), 'E_X: no kernel', 'the PR-change path repaints it too');
  void u.refreshContextRoster(); await u.reply(3, panelOf('A', roster, { deployment: unavailable }));
  assert.equal(noteText(), 'E_X: no kernel'); assert.equal(u.list().querySelectorAll('.ctx-deployment-note').length, 1, 'never doubled');
  // an observed deployment drops it.
  void u.refreshContextRoster(); await u.reply(4, panelOf('A', roster)); assert.equal(u.list().querySelector('.ctx-deployment-note'), null);
});
