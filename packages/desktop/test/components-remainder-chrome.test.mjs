import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createContextPanel, contextPanelCSS } from '../renderer/context-panel.mjs';
import { createInstanceGitPanel } from '../renderer/instance-git.mjs';
import { createNotificationCenter } from '../renderer/notifications.mjs';
import { createWorkspaceSwitcher } from '../renderer/workspace-switcher.mjs';
import { instanceActionTarget } from '../renderer/instance-action-target.mjs';
import { instance, target, state, deferred, tick } from './helpers/forge-fixture.mjs';
const birth = '2026-09-23T00:00:00.000Z';
const selected = () => ({ ...instance, createdAt: birth });
const git = () => { const data = state(); data.summary.changed = 1; data.files = [{ id: 'c'.repeat(24), kind: 'changed', xy: '.M', path: 'file', origPath: null, submodule: false }]; return { instanceGitApi: 1, minimumVersion: '0.24.7', status: 'available', target, data, observationKey: 'e'.repeat(64), reason: null }; };
function instancePanel(t, request = async () => git()) {
  const dom = new JSDOM('<body><div id="app"><input id="outside"><aside id="context-panel"></aside></div></body>', { pretendToBeVisual: true });
  const doc = dom.window.document, style = doc.createElement('style'); style.textContent = contextPanelCSS; doc.head.append(style);
  let connection = 0; const listeners = new Set(), calls = [];
  const subscribeConnections = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  const panel = createContextPanel({ document: doc, connectionGeneration: () => connection, subscribeConnections,
    createGitPanel: (root, options) => createInstanceGitPanel(root, { ...options, connectionGeneration: () => connection, subscribeConnections,
      request: (...args) => { calls.push(args); return request(...args); } }) });
  panel.setContext({ workspace: 'team', key: 'target', instance: selected() });
  t.after(() => { panel.dispose(); dom.window.close(); });
  return { dom, doc, panel, calls, q: s => doc.querySelector(s), connect() { connection++; for (const fn of listeners) fn(); } };
}
// Spec B: a closed panel leaves no rail. The Developer page's change mark lives on in the panel's state
// (the shell's Show instance panel carries it), owned by the exact instance and connection it was read for.
test('a closed panel takes no width and keeps no rail; closing never reads, and the accepted Git change mark survives only its owner', async t => {
  const u = instancePanel(t);
  u.q('[data-context-tab=git]').click(); await tick(); assert.equal(u.calls.length, 1); assert.equal(u.q('[data-context-tab=git]').getAttribute('aria-selected'), 'true');
  u.panel.setCollapsed(true);
  assert.equal(u.q('#context-panel').hidden, true); assert.equal(u.dom.window.getComputedStyle(u.q('#context-panel')).display, 'none', 'no width at all');
  assert.equal(u.doc.querySelector('[data-context-rail], .context-panel-rail, .context-panel-expand, .context-panel-dot'), null, 'no rail, expand or dot inside');
  assert.equal(u.calls.length, 1); assert.equal(u.panel.state().changes, true, 'the change mark the Developer page would show');
  for (let i = 0; i < 4; i++) u.panel.setContext({ workspace: 'team', key: 'target', instance: selected() });
  assert.equal(u.calls.length, 1); assert.equal(u.panel.state().changes, true);
  u.connect(); assert.equal(u.panel.state().changes, false); assert.equal(u.calls.length, 1);
  u.panel.setContext({ workspace: 'team', key: 'target', instance: { ...selected(), createdAt: '2026-09-24T00:00:00.000Z' } }); assert.equal(u.panel.state().changes, false);
});
for (const reject of [false, true]) for (const change of ['connection', 'birth', 'workspace', 'collapse', 'dispose']) test(`the change mark ignores late Git ${reject ? 'rejection' : 'success'} after ${change}`, async t => {
  const g = deferred(), newer = deferred(); let calls = 0;
  const u = instancePanel(t, () => calls++ ? newer.promise : g.promise); u.q('[data-context-tab=git]').click();
  if (change === 'connection') u.connect();
  if (change === 'birth') u.panel.setContext({ workspace: 'team', key: 'target', instance: { ...selected(), createdAt: '2026-09-24T00:00:00.000Z' } });
  if (change === 'workspace') u.panel.setContext({ workspace: 'other' });
  if (change === 'collapse') u.panel.setCollapsed(true);
  if (change === 'dispose') u.panel.dispose();
  if (reject) g.reject(Error('PRIVATE')); else g.resolve(git()); await tick();
  assert.equal(u.panel.state().changes, false); assert.doesNotMatch(u.doc.body.textContent, /PRIVATE/);
  newer.resolve(git()); await tick();
});
for (const change of ['identity', 'connection']) test(`a retained accepted change mark independently refuses unsignaled ${change} drift`, t => {
  const dom = new JSDOM('<body><aside id="context-panel"></aside></body>'), doc = dom.window.document; let publish, connection = 0;
  const row = selected(), identity = JSON.stringify(['team', 'target', row.home, row.agent, row.agentsRoot, null, row.createdAt]);
  const seen = [];
  const panel = createContextPanel({ document: doc, connectionGeneration: () => connection, onChange: state => seen.push(state.changes),
    createGitPanel: (_p, opts) => { publish = opts.onObservation; return { update() {}, dispose() {} }; } });
  t.after(() => { panel.dispose(); dom.window.close(); }); panel.setContext({ workspace: 'team', key: 'target', instance: row }); panel.setCollapsed(true);
  publish({ identity, connection: 0, changed: true }); assert.equal(panel.state().changes, true); assert.equal(seen.at(-1), true, 'the shell hears it at once');
  if (change === 'identity') row.createdAt = '2026-09-24T00:00:00.000Z'; else connection++;
  panel.setCollapsed(true); assert.equal(panel.state().changes, false); assert.equal(seen.at(-1), false);
});
test('a closed stage inspector never exposes generic instance pages or discards its draft; hidden tabs cannot act', t => {
  const u = instancePanel(t), old = u.q('[data-context-tab=git]'), owner = {}, form = u.doc.createElement('textarea'); form.value = 'Keep me';
  u.panel.setContext({ workspace: 'team', owner }); const lease = u.panel.attach(owner, form); u.panel.setCollapsed(true);
  assert.equal(u.q('#context-panel').hidden, true); old.click(); assert.equal(lease.isVisible(), false); assert.equal(u.calls.length, 0);
  assert.deepEqual(u.panel.state(), { present: true, open: false, changes: false }, 'Show instance panel has something to show');
  u.panel.toggle(); assert.equal(lease.isVisible(), true); assert.equal(form.value, 'Keep me');
  u.panel.setFocusMode(true); old.click(); assert.equal(u.calls.length, 0); assert.equal(form.isConnected, true);
});
function notices(t) {
  const dom = new JSDOM('<body><input id="typing"></body>', { pretendToBeVisual: true }), doc = dom.window.document;
  let generation = 0, connection = 0, workspace = 'team'; const listeners = new Set(), connected = new Set();
  const center = createNotificationCenter({ document: doc, generation: () => generation, workspace: () => workspace, connectionGeneration: () => connection,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, subscribeConnections: fn => { connected.add(fn); return () => connected.delete(fn); } });
  const descriptor = () => ({ kind: 'open-instance', target: instanceActionTarget('team', selected(), { requireBirth: true }), connectionEpoch: connection });
  t.after(() => { center.dispose(); dom.window.close(); });
  return { dom, doc, center, descriptor, button: () => doc.querySelector('.app-toast-open'), change(kind) {
    if (kind === 'workspace') { generation++; workspace = 'other'; for (const fn of listeners) fn(); }
    if (kind === 'connection') { connection++; for (const fn of connected) fn(); }
    if (kind === 'unsignaled-connection') connection++;
    if (kind === 'dispose') center.dispose();
    if (kind === 'hidden') doc.querySelector('.app-notifications').hidden = true;
    if (kind === 'dismiss') doc.querySelector('.app-toast-dismiss').click();
  } };
}
test('toast Open gets only copied inert identity and a current callback; duplicate clicks cannot cancel the active owner', async t => {
  const u = notices(t), g = deferred(); let calls = 0, owner;
  const d = u.descriptor(); u.center.notify('Spawned', { descriptor: d, activate: async (copy, owns) => { calls++; assert.deepEqual(copy, d); assert.notEqual(copy.target, d.target); owner = owns; await g.promise; } });
  u.doc.querySelector('#typing').focus(); const button = u.button(); button.click(); button.dispatchEvent(new u.dom.window.Event('click'));
  assert.equal(calls, 1); assert.equal(owner(), true); assert.equal(button.disabled, true); g.resolve(); await tick(); assert.equal(button.disabled, false);
});
for (const reject of [false, true]) for (const change of ['workspace', 'connection', 'unsignaled-connection', 'hidden', 'dismiss', 'dispose']) test(`toast ${change} revokes callback and late ${reject ? 'error' : 'success'} effects`, async t => {
  const u = notices(t), g = deferred(); let owner;
  u.center.notify('Spawned', { descriptor: u.descriptor(), activate: async (_data, owns) => { owner = owns; await g.promise; } });
  const button = u.button(); button.click(); u.change(change); assert.equal(owner(), false);
  if (reject) g.reject(Error('PRIVATE')); else g.resolve(); await tick();
  assert.equal(button.disabled, true); assert.doesNotMatch(u.doc.body.textContent, /PRIVATE|Could not open/);
});
test('dismissed, stale, wrong-workspace, unknown-incarnation and command-bearing toast descriptors never dispatch', async t => {
  const u = notices(t); let calls = 0;
  for (const descriptor of [{ ...u.descriptor(), command: 'run' }, { ...u.descriptor(), ipc: 'term:open' }, { ...u.descriptor(), connectionEpoch: 99 },
    { ...u.descriptor(), target: { ...u.descriptor().target, workspace: 'other' } }, { ...u.descriptor(), target: { ...u.descriptor().target, incarnation: null } }]) {
    u.center.clear(); u.center.notify('Plain message', { descriptor, activate: () => { calls++; } }); assert.equal(u.button(), null);
  }
  u.center.clear(); u.center.notify('Current', { descriptor: u.descriptor(), activate: () => { calls++; } }); const old = u.button(); u.change('dismiss'); old.click(); await tick(); assert.equal(calls, 0);
});
test('removed toast action stays revoked even if an old DOM node is reinserted', async t => {
  const u = notices(t); let calls = 0;
  u.center.notify('Old', { descriptor: u.descriptor(), activate: () => { calls++; } }); const element = u.doc.querySelector('.app-toast'), button = u.button();
  u.change('dismiss'); u.doc.querySelector('.app-notifications ol').append(element); button.click(); await tick(); assert.equal(calls, 0);
});
test('shipped shell mints only inert spawn Open descriptors from complete current roster identity and forwards ownership to the existing open path', async () => {
  const source = readFileSync(new URL('../renderer/shell.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  notifySpawn:'), end = source.indexOf('\n  openFile:', start); assert.ok(start >= 0 && end > start);
  const notices = [], opens = [];
  const notify = new Function('instanceActionTarget', 'currentWorkspace', 'connectionGeneration', 'notifications', 'openTerminalTab', `return ({ ${source.slice(start, end)} }).notifySpawn;`)(
    instanceActionTarget, () => 'team', 4, { notify: (...args) => notices.push(args) }, (...args) => opens.push(args));
  notify(selected(), 'other', 4); notify(selected(), 'team', 3); notify({ ...selected(), createdAt: null }, 'team', 4); assert.equal(notices.length, 0);
  notify(selected(), 'team', 4); assert.equal(notices.length, 1); assert.deepEqual(Object.keys(notices[0][1].descriptor), ['kind', 'target', 'connectionEpoch']);
  const action = notices[0][1], owns = () => true; await action.activate(action.descriptor, owns);
  assert.equal(opens.length, 1); assert.deepEqual(opens[0][0], action.descriptor.target); assert.equal(opens[0][1].valid, owns); assert.deepEqual(opens[0][1].expected, action.descriptor.target);
  assert.equal(opens[0][0].home, instance.home); assert.equal(opens[0][0].incarnation, birth);
});
test('workspace rows are the name alone, from reported words only; Add local, no Join/Manage/count/health invention', t => {
  const html = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8'), dom = new JSDOM(html), doc = dom.window.document; t.after(() => dom.window.close());
  const chosen = [], switcher = createWorkspaceSwitcher({ document: doc, selectWorkspace: v => chosen.push(v), discoverSuggestions: async () => [], addWorkspace: async () => ({}), pickWorkspace: async () => ({}) });
  const choices = [{ id: '/a/team', name: 'same', team: { name: 'Org' }, instances: 99 }, { id: '/b/team', name: 'same', server: 'peer', machines: ['peer'] }];
  t.after(() => switcher.dispose());
  switcher.begin()(choices[0], choices); // the list is always shown: no menu to open
  const first = doc.querySelector('.ws-option');
  // No workspace mark and no machine line (pr3-simplify): one line, the name, its twin told apart by the label alone.
  assert.equal(doc.querySelector('#ws-options .workspace-avatar, #ws-options .ws-option-meta'), null);
  assert.deepEqual([...doc.querySelectorAll('.ws-option')].map(b => [...b.children].map(c => c.className)), [['ws-option-name'], ['ws-option-name']]);
  assert.match(first.textContent, /Org/); assert.doesNotMatch(doc.querySelectorAll('.ws-option')[1].textContent, /peer/, 'never its machine, nor a Server: line (#482)');
  assert.doesNotMatch(doc.querySelector('#ws-options').textContent, /Server:|\/a\/team|\/b\/team/);
  // Add local workspace… is the head's icon button, named in words; the list invents nothing.
  assert.equal(doc.querySelector('#ws-add-open').getAttribute('aria-label'), 'Add local workspace…'); assert.equal(doc.querySelector('#ws-add-open').title, 'Add local workspace…');
  assert.doesNotMatch(`${doc.querySelector('.ws-head').textContent} ${doc.querySelector('#ws-list').textContent}`, /Join|Manage workspaces|99|offline|online/);
  const named = first.textContent;
  switcher.begin()(choices[0], [...choices].reverse()); assert.equal([...doc.querySelectorAll('.ws-option')].find(b => b.dataset.workspaceId === choices[0].id).textContent, named, 'a reorder keeps the row\'s name');
  // A row from an earlier paint opens nothing; the current row is already shown; the other one is chosen.
  first.click(); assert.deepEqual(chosen, []);
  const row = id => [...doc.querySelectorAll('.ws-option')].find(b => b.dataset.workspaceId === id);
  row('/a/team').click(); assert.deepEqual(chosen, []);
  row('/b/team').click(); assert.deepEqual(chosen, ['/b/team']);
});
