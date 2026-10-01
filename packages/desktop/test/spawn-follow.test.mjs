// Spec E, item 5 (and its addenda): after a press the operator is taken to the new instance, unless they
// moved on since the press, are typing (a field, a terminal) or an overlay is open — at arrival and all
// through the asynchronous open. No toast for a success: arriving is the confirmation, otherwise the row
// says New; one polite announcement either way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { createSpawnFollow, typingTarget } from '../renderer/spawn-follow.mjs';
import { createSelectionOwnership } from '../renderer/selection-ownership.mjs';
import { instanceActionTarget, sameInstanceActionTarget } from '../renderer/instance-action-target.mjs';
import { instanceId } from '../renderer/instance-tree.mjs';

const row = { instance: 'dev-x', home: '/d/agents/dev/instances/dev-x', agentsRoot: '/d/agents', agent: 'dev', running: true };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function fixture(t, overrides = {}) {
  const dom = new JSDOM(`<body><input id="text"><input id="box" type="checkbox"><textarea id="area"></textarea>
    <div id="editable" contenteditable="true"></div><button id="plain">x</button><button id="other">y</button>
    <div class="term-wrap" id="own"><div class="xterm"><textarea class="xterm-helper-textarea"></textarea></div></div></body>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  // jsdom has no contentEditable layout: say what a browser says.
  Object.defineProperty(doc.getElementById('editable'), 'isContentEditable', { value: true });
  const state = { workspace: 'A', generation: 0, connection: 0, overlay: false };
  const ownership = createSelectionOwnership({ currentWorkspace: () => state.workspace, workspaceGeneration: () => state.generation });
  const opened = [], marked = [], said = [];
  const follow = createSpawnFollow({
    watch: () => ownership.watch(), overlayOpen: () => state.overlay, activeElement: () => doc.activeElement,
    inTerminal: el => !!el?.closest?.('.xterm, .term-wrap'), ownTerminal: el => !!el?.closest?.('#own'),
    currentWorkspace: () => state.workspace, connection: () => state.connection,
    open: async (r, ws, valid) => { opened.push({ r, ws, valid }); return valid(); }, markNew: (r, ws) => marked.push({ r, ws }), announce: text => said.push(text),
    ...overrides,
  });
  return { doc, state, ownership, follow, opened, marked, said };
}

test('nothing changed since the press: the operator is taken to the instance; no mark, one announcement', async t => {
  const u = fixture(t);
  u.follow.follow('spawn-1');
  u.doc.getElementById('plain').focus(); // e.g. the soul card the dialog returned focus to
  assert.equal(await u.follow.arrived(row, 'A', 0, { id: 'spawn-1' }), 'opened');
  assert.equal(u.opened.length, 1); assert.equal(u.opened[0].ws, 'A'); assert.equal(u.marked.length, 0);
  assert.deepEqual(u.said, ['dev-x spawned']);
  assert.equal(u.follow.size(), 0, 'followed once');
});

test('the press ticket cancels nothing pending, and any explicit action after it ends the follow', async t => {
  const u = fixture(t);
  const pending = u.ownership.begin(); // an open in flight before the press (a Quick Open return, say)
  u.follow.follow('spawn-1');
  assert.equal(pending(), true, 'watch() never supersedes what is pending');
  u.ownership.begin(); // the operator opened or activated another tab or view
  assert.equal(u.follow.following('spawn-1'), false);
  assert.equal(await u.follow.arrived(row, 'A', 0, { id: 'spawn-1' }), 'marked');
  assert.equal(u.opened.length, 0); assert.deepEqual(u.marked, [{ r: row, ws: 'A' }]); assert.deepEqual(u.said, ['dev-x spawned']);
});

for (const [why, move] of [
  ['an invalidating navigation (the sidebar, a stage)', u => u.ownership.invalidate()],
  ['a workspace switch', u => { u.state.generation++; }],
  ['another workspace on screen', u => { u.state.workspace = 'B'; }],
  ['a connection change since the press (delivered with the current epoch, as the store does)', u => { u.state.connection++; }],
  ['focus in a text field', u => u.doc.getElementById('text').focus()],
  ['focus in a textarea', u => u.doc.getElementById('area').focus()],
  ['focus in contentEditable', u => u.doc.getElementById('editable').focus()],
  ['focus in a terminal', u => u.doc.querySelector('.xterm-helper-textarea').focus()],
  ['a modal or overlay open', u => { u.state.overlay = true; }],
]) test(`never a yank: ${why} keeps the operator where they are and marks the row New`, async t => {
  const u = fixture(t);
  u.follow.follow('spawn-1');
  move(u);
  assert.equal(await u.follow.arrived(row, 'A', u.state.connection, { id: 'spawn-1' }), 'marked');
  assert.equal(u.opened.length, 0, 'nothing opened');
  assert.equal(u.marked.length, 1); assert.deepEqual(u.said, ['dev-x spawned']);
});

// The open is asynchronous: the guards hold all through it, not only at arrival.
for (const [why, move] of [
  ['focus moves into a text field', u => u.doc.getElementById('text').focus()],
  ['focus moves to another control', u => u.doc.getElementById('other').focus()],
  ['an overlay opens', u => { u.state.overlay = true; }],
  ['the connection changes', u => { u.state.connection++; }],
  ['the workspace changes', u => { u.state.workspace = 'B'; }],
]) test(`never a yank, during the open: ${why} → the open is refused and the row says New`, async t => {
  const gate = deferred(), checks = [];
  const u = fixture(t, { open: async (r, ws, valid) => { checks.push(valid()); await gate.promise; checks.push(valid()); return valid(); } });
  u.follow.follow('spawn-1'); u.doc.getElementById('plain').focus();
  const arrival = u.follow.arrived(row, 'A', 0, { id: 'spawn-1' });
  await Promise.resolve();
  move(u); gate.resolve();
  assert.equal(await arrival, 'marked');
  assert.deepEqual(checks, [true, false], 'the open saw the change at its next step');
  assert.equal(u.marked.length, 1); assert.deepEqual(u.said, ['dev-x spawned']);
});

test('during the open, focus landing in the opening terminal (or nowhere) is still the operator\'s moment', async t => {
  const gate = deferred();
  const u = fixture(t, { open: async (r, ws, valid) => { await gate.promise; return valid(); } });
  u.follow.follow('spawn-1'); u.doc.getElementById('plain').focus();
  const arrival = u.follow.arrived(row, 'A', 0, { id: 'spawn-1' });
  await Promise.resolve();
  u.doc.querySelector('#own .xterm-helper-textarea').focus(); // the terminal took focus as it became ready
  gate.resolve();
  assert.equal(await arrival, 'opened'); assert.equal(u.marked.length, 0);
  const v = fixture(t, { open: async (r, ws, valid) => { await gate.promise; return valid(); } });
  v.follow.follow('spawn-2'); v.doc.getElementById('plain').focus();
  const second = v.follow.arrived(row, 'A', 0, { id: 'spawn-2' });
  v.doc.getElementById('plain').blur(); // the stage behind was hidden: focus fell to <body>
  assert.equal(await second, 'opened');
});

test('an open that does not land (refused, superseded, failed) leaves the row New', async t => {
  for (const open of [async () => false, async () => { throw new Error('transport'); }, () => undefined]) {
    const u = fixture(t, { open });
    u.follow.follow('spawn-1');
    assert.equal(await u.follow.arrived(row, 'A', 0, { id: 'spawn-1' }), 'marked');
    assert.equal(u.marked.length, 1); assert.deepEqual(u.said, ['dev-x spawned']);
  }
});

test('focus on a checkbox or a button is not typing', async t => {
  const u = fixture(t);
  u.follow.follow('spawn-1'); u.doc.getElementById('box').focus();
  assert.equal(await u.follow.arrived(row, 'A', 0, { id: 'spawn-1' }), 'opened');
  assert.equal(typingTarget(u.doc.getElementById('box')), false); assert.equal(typingTarget(u.doc.getElementById('plain')), false);
  assert.equal(typingTarget(u.doc.getElementById('text')), true); assert.equal(typingTarget(null), false);
});

test('a spawn not pressed in this window (recovered after a reload) is only marked', async t => {
  const u = fixture(t);
  assert.equal(await u.follow.arrived(row, 'A', 0, { id: 'spawn-9' }), 'marked');
  assert.equal(await u.follow.arrived(row, 'A', 0), 'marked');
  assert.equal(u.opened.length, 0);
});

test('a partial spawn is followed the same way, but says nothing here (its own notification already spoke)', async t => {
  const u = fixture(t);
  u.follow.follow('spawn-1');
  assert.equal(await u.follow.arrived(row, 'A', 0, { id: 'spawn-1', complete: false }), 'opened');
  assert.equal(u.said.length, 0);
  u.follow.follow('spawn-2'); u.state.overlay = true;
  assert.equal(await u.follow.arrived(row, 'A', 0, { id: 'spawn-2', complete: false }), 'quiet');
  assert.equal(u.marked.length, 0); assert.equal(u.said.length, 0);
});

test('a guard that throws is a busy operator; prune drops follows of jobs the store no longer holds', async t => {
  const u = fixture(t, { overlayOpen: () => { throw new Error('boom'); } });
  u.follow.follow('spawn-1');
  assert.equal(await u.follow.arrived(row, 'A', 0, { id: 'spawn-1' }), 'marked');
  u.follow.follow('spawn-2'); u.follow.follow('spawn-3');
  u.follow.prune(id => id === 'spawn-3');
  assert.equal(u.follow.size(), 1); assert.equal(u.follow.following('spawn-3'), true);
});

// ── the shipped shell wiring: shell.mjs's spawnFollow composition over the real openTerminalTabFlow ──────────
// Only the roster read, the key wait and the terminal's mount are stubbed; the selection ownership, the
// instance-target checks and the open's own ownership are the shipped ones.
const shellSource = readFileSync(new URL('../renderer/shell.mjs', import.meta.url), 'utf8');
const composition = shellSource.slice(shellSource.indexOf('const spawnFollow = createSpawnFollow('), shellSource.indexOf('// A created instance is awaited'));
const flowSource = shellSource.match(/async function openTerminalTabFlow\(ref, notify, options = \{\}\) \{[\s\S]*?\n\}/)?.[0];

function shell(t) {
  assert.ok(composition.includes('createSpawnFollow') && flowSource, 'the shipped composition and open flow');
  const dom = new JSDOM('<body><button id="card">card</button><input id="search" type="search"><div id="dialog" aria-modal="true"></div><div id="tabhost"></div></body>');
  t.after(() => dom.window.close());
  const document = dom.window.document;
  document.getElementById('dialog').hidden = true;
  const live = { ...row, createdAt: '2026-10-01T10:00:00.000Z', tmux: { session: 'dev-x' } };
  const panels = [], marked = [], said = [];
  const c = {
    createSpawnFollow, instanceActionTarget, sameInstanceActionTarget, instanceId, document,
    currentWorkspace: () => 'A', workspaceGeneration: () => 0, connectionGeneration: 0,
    modalOpen: () => [...document.querySelectorAll('[aria-modal="true"]')].some(d => !d.hidden),
    tabs: new Map(), activeTab: null, pendingTerms: new Set(),
    spawnJobs: { markNew: (ws, r) => marked.push(r.instance) }, contextRosterEl: {}, announceSpawn: text => said.push(text),
    setSidebarMode() {}, setNavActive() {}, refreshContextRoster() {},
    api: () => { const gate = deferred(); panels.push(gate); return gate.promise; },
    resolveTerminalOpen: (instances, ref, ws) => { const inst = instances.find(i => i.home === ref.home); return inst ? { inst, key: `term:${ws}:${inst.home}` } : { error: 'unknown', name: ref.instance }; },
    whenKeyFree: async () => {},
    // The terminal's mount: addTab selects it (and focuses its input) only while the open still owns it.
    openTerminalTabInner: async (inst, ws, key, owns) => {
      if (!owns()) return;
      const paneEl = document.createElement('div'); const input = document.createElement('textarea'); input.className = 'xterm-helper-textarea';
      paneEl.append(input); document.getElementById('tabhost').append(paneEl);
      c.tabs.set(7, { kind: 'terminal', key, instanceRef: inst, paneEl }); c.activeTab = 7; input.focus();
    },
  };
  c.tabOpenIntents = createSelectionOwnership(c);
  const flow = runInNewContext(`(${flowSource})`, c);
  c.openTerminalTab = (ref, options) => flow(ref, () => {}, options);
  const follow = runInNewContext(`${composition}\nspawnFollow`, c);
  const panel = () => ({ instances: [live] });
  return { document, c, follow, live, panels, marked, said, panel, settle: () => new Promise(r => setImmediate(r)) };
}

test('shell: a followed spawn opens its terminal and selects it; no mark, one announcement', async t => {
  const u = shell(t);
  u.document.getElementById('card').focus();
  u.follow.follow('spawn-1');
  const arrival = u.follow.arrived(u.live, 'A', 0, { id: 'spawn-1' });
  await u.settle(); u.panels[0].resolve(u.panel());
  assert.equal(await arrival, 'opened');
  assert.equal(u.c.activeTab, 7); assert.equal(u.document.activeElement.className, 'xterm-helper-textarea');
  assert.deepEqual(u.marked, []); assert.deepEqual(u.said, ['dev-x spawned']);
});

for (const [why, move] of [
  ['typing in the stage\'s search while the roster read is outstanding', u => u.document.getElementById('search').focus()],
  ['a dialog opening', u => { u.document.getElementById('dialog').hidden = false; }],
  ['a navigation (another tab, view or the sidebar)', u => u.c.tabOpenIntents.begin()],
  ['a connection change', u => { u.c.connectionGeneration++; }],
]) test(`shell: ${why} during the open → no terminal is selected, the row says New`, async t => {
  const u = shell(t);
  u.document.getElementById('card').focus();
  u.follow.follow('spawn-1');
  const arrival = u.follow.arrived(u.live, 'A', 0, { id: 'spawn-1' });
  await u.settle();
  move(u);
  u.panels[0].resolve(u.panel());
  assert.equal(await arrival, 'marked');
  assert.equal(u.c.activeTab, null, 'no terminal selected'); assert.notEqual(u.document.activeElement.className, 'xterm-helper-textarea');
  assert.deepEqual(u.marked, ['dev-x']); assert.deepEqual(u.said, ['dev-x spawned']);
});

test('shell: a connection change between the press and the arrival (the store delivers the current epoch) is not followed', async t => {
  const u = shell(t);
  u.follow.follow('spawn-1');
  u.c.connectionGeneration++;
  assert.equal(await u.follow.arrived(u.live, 'A', u.c.connectionGeneration, { id: 'spawn-1' }), 'marked');
  assert.equal(u.panels.length, 0, 'no open was even started'); assert.deepEqual(u.marked, ['dev-x']);
});
