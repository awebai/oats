// Spec E, item 5 (and its addenda): after a press the operator is taken to the new instance, unless they
// moved on since the press, are typing (a field, a terminal) or an overlay is open. No toast for a success:
// arriving is the confirmation, otherwise the row says New; one polite announcement either way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSpawnFollow, typingTarget } from '../renderer/spawn-follow.mjs';
import { createSelectionOwnership } from '../renderer/selection-ownership.mjs';

const row = { instance: 'dev-x', home: '/d/agents/dev/instances/dev-x', agentsRoot: '/d/agents', agent: 'dev', running: true };

function fixture(t, overrides = {}) {
  const dom = new JSDOM(`<body><input id="text"><input id="box" type="checkbox"><textarea id="area"></textarea>
    <div id="editable" contenteditable="true"></div><button id="plain">x</button>
    <div class="term-wrap"><div class="xterm"><textarea class="xterm-helper-textarea"></textarea></div></div></body>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  // jsdom has no contentEditable layout: say what a browser says.
  Object.defineProperty(doc.getElementById('editable'), 'isContentEditable', { value: true });
  const state = { workspace: 'A', generation: 0, connection: 0, overlay: false };
  const ownership = createSelectionOwnership({ currentWorkspace: () => state.workspace, workspaceGeneration: () => state.generation });
  const opened = [], marked = [], said = [];
  const follow = createSpawnFollow({
    watch: () => ownership.watch(), overlayOpen: () => state.overlay, activeElement: () => doc.activeElement,
    inTerminal: el => !!el?.closest?.('.xterm, .term-wrap'), currentWorkspace: () => state.workspace, connection: () => state.connection,
    open: (r, ws) => { opened.push({ r, ws }); return true; }, markNew: (r, ws) => marked.push({ r, ws }), announce: text => said.push(text),
    ...overrides,
  });
  return { doc, state, ownership, follow, opened, marked, said };
}

test('nothing changed since the press: the operator is taken to the instance; no mark, one announcement', t => {
  const u = fixture(t);
  u.follow.follow('spawn-1');
  u.doc.getElementById('plain').focus(); // e.g. the soul card the dialog returned focus to
  assert.equal(u.follow.arrived(row, 'A', 0, { id: 'spawn-1' }), 'opened');
  assert.deepEqual(u.opened, [{ r: row, ws: 'A' }]); assert.equal(u.marked.length, 0);
  assert.deepEqual(u.said, ['dev-x spawned']);
  assert.equal(u.follow.size(), 0, 'followed once');
});

test('the press ticket cancels nothing pending, and any explicit action after it ends the follow', t => {
  const u = fixture(t);
  const pending = u.ownership.begin(); // an open in flight before the press (a Quick Open return, say)
  u.follow.follow('spawn-1');
  assert.equal(pending(), true, 'watch() never supersedes what is pending');
  u.ownership.begin(); // the operator opened or activated another tab or view
  assert.equal(u.follow.following('spawn-1'), false);
  assert.equal(u.follow.arrived(row, 'A', 0, { id: 'spawn-1' }), 'marked');
  assert.equal(u.opened.length, 0); assert.deepEqual(u.marked, [{ r: row, ws: 'A' }]); assert.deepEqual(u.said, ['dev-x spawned']);
});

for (const [why, move] of [
  ['an invalidating navigation (the sidebar, a stage)', u => u.ownership.invalidate()],
  ['a workspace switch', u => { u.state.generation++; }],
  ['another workspace on screen', u => { u.state.workspace = 'B'; }],
  ['a connection change', u => { u.state.connection++; }],
  ['focus in a text field', u => u.doc.getElementById('text').focus()],
  ['focus in a textarea', u => u.doc.getElementById('area').focus()],
  ['focus in contentEditable', u => u.doc.getElementById('editable').focus()],
  ['focus in a terminal', u => u.doc.querySelector('.xterm-helper-textarea').focus()],
  ['a modal or overlay open', u => { u.state.overlay = true; }],
]) test(`never a yank: ${why} keeps the operator where they are and marks the row New`, t => {
  const u = fixture(t);
  u.follow.follow('spawn-1');
  move(u);
  assert.equal(u.follow.arrived(row, 'A', 0, { id: 'spawn-1' }), 'marked');
  assert.equal(u.opened.length, 0, 'nothing opened');
  assert.equal(u.marked.length, 1); assert.deepEqual(u.said, ['dev-x spawned']);
});

test('focus on a checkbox or a button is not typing', t => {
  const u = fixture(t);
  u.follow.follow('spawn-1'); u.doc.getElementById('box').focus();
  assert.equal(u.follow.arrived(row, 'A', 0, { id: 'spawn-1' }), 'opened');
  assert.equal(typingTarget(u.doc.getElementById('box')), false); assert.equal(typingTarget(u.doc.getElementById('plain')), false);
  assert.equal(typingTarget(u.doc.getElementById('text')), true); assert.equal(typingTarget(null), false);
});

test('a spawn not pressed in this window (recovered after a reload) is only marked; an unaddressable row is marked', t => {
  const u = fixture(t);
  assert.equal(u.follow.arrived(row, 'A', 0, { id: 'spawn-9' }), 'marked');
  assert.equal(u.follow.arrived(row, 'A', 0), 'marked');
  const v = fixture(t, { open: () => false });
  v.follow.follow('spawn-1');
  assert.equal(v.follow.arrived(row, 'A', 0, { id: 'spawn-1' }), 'marked', 'no target: marked, never a silent success');
});

test('a partial spawn is followed the same way, but says nothing here (its own notification already spoke)', t => {
  const u = fixture(t);
  u.follow.follow('spawn-1');
  assert.equal(u.follow.arrived(row, 'A', 0, { id: 'spawn-1', complete: false }), 'opened');
  assert.equal(u.said.length, 0);
  u.follow.follow('spawn-2'); u.state.overlay = true;
  assert.equal(u.follow.arrived(row, 'A', 0, { id: 'spawn-2', complete: false }), 'quiet');
  assert.equal(u.marked.length, 0); assert.equal(u.said.length, 0);
});

test('a guard that throws is a busy operator; prune drops follows of jobs the store no longer holds', t => {
  const u = fixture(t, { overlayOpen: () => { throw new Error('boom'); } });
  u.follow.follow('spawn-1');
  assert.equal(u.follow.arrived(row, 'A', 0, { id: 'spawn-1' }), 'marked');
  u.follow.follow('spawn-2'); u.follow.follow('spawn-3');
  u.follow.prune(id => id === 'spawn-3');
  assert.equal(u.follow.size(), 1); assert.equal(u.follow.following('spawn-3'), true);
});
