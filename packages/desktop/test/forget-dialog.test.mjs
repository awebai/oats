// #1131: the Forget confirmation (renderer/forget-dialog.mjs). Offered only on a `missing` row; opening, Cancel
// and Escape send nothing; Forget sends exactly one request with the row's own identity, from any entry point;
// busy keeps focus on the status line; every answer says its sentence and the roster is never edited here (the server re-reads it); an answer
// that lands after the dialog stopped owning it moves and says nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createForgetDialog, forgettable, forgetWords, shownInstance, forgetSuccessor } from '../renderer/forget-dialog.mjs';
import { registerAction, handleKeydown } from '../renderer/keybindings.mjs';
import { kernelLines } from '../../client/kernel-lines.mjs';
import { DESKTOP_TERMS } from '../renderer/desktop-terms.mjs';
import { deferred, tick } from './helpers/lifecycle-fixture.mjs';

const GONE = Object.freeze({ instance: 'dev-a', agent: 'dev', home: '/srv/team/agents/dev/instances/dev-a', server: 'build', repoName: 'Build box',
  running: null, addressable: false, savedRoute: true, missingRemotely: true });

function fixture({ answer, row = GONE } = {}) {
  const dom = new JSDOM('<!doctype html><button id="opener">Actions</button><input id="filter"><div id="roster" tabindex="-1"><button id="next">dev-b</button></div>', { pretendToBeVisual: true });
  const doc = dom.window.document, sent = [], said = [], pending = [];
  let generation = 0, workspaceChange;
  const dialog = createForgetDialog({ doc, generation: () => generation,
    subscribeWorkspace: fn => { workspaceChange = fn; return () => {}; },
    request: body => { sent.push(body); if (answer === 'hold') { const d = deferred(); pending.push(d); return d.promise; }
      return typeof answer === 'function' ? answer(body) : answer ?? { status: 'forgotten', server: body.server, instance: body.instance }; },
    notify: text => { said.push(text); },
    nextFocus: () => doc.getElementById('next') });
  const q = sel => doc.querySelector(sel);
  return { dom, doc, dialog, sent, said, pending, q,
    open(r = row) { doc.getElementById('opener').focus(); return dialog.open(r); },
    shown: () => !!q('.lifecycle-dialog'),
    key(value, opts = {}) { doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...opts })); },
    confirm: () => q('.lifecycle-confirm'), cancel: () => q('.lifecycle-close'), status: () => q('.lifecycle-dialog [role=status]'),
    switchWorkspace() { generation++; workspaceChange(); },
    close() { dialog.dispose(); dom.window.close(); } };
}

test('offered only on a row whose reason is missing: strictly missingRemotely === true, on a reached server', () => {
  assert.equal(forgettable(GONE), true);
  for (const [why, row] of [['false', { ...GONE, missingRemotely: false }], ['absent', (({ missingRemotely, ...r }) => r)(GONE)], ['null', { ...GONE, missingRemotely: null }],
    ['a truthy non-true', { ...GONE, missingRemotely: 'true' }], ['1', { ...GONE, missingRemotely: 1 }],
    ['an unreached server', { ...GONE, serverUnreached: true }], ['addressable', { ...GONE, addressable: true, missingRemotely: false, running: true }],
    ['a local row', { ...GONE, server: undefined }], ['no instance name', { ...GONE, instance: '' }], ['nothing', null]]) {
    assert.equal(forgettable(row), false, why);
    const f = fixture();
    assert.equal(f.open(row), false, `${why}: nothing opens`); assert.equal(f.shown(), false); f.close();
  }
});

test('the informed press: the sentences, through the display filter, with no invented age', () => {
  const f = fixture(); f.open();
  try {
    assert.equal(f.q('.lifecycle-dialog h2').textContent, 'Forget dev-a on Build box?');
    const [effect, basis] = [...f.q('.lifecycle-dialog').querySelectorAll(':scope > p')].map(p => p.textContent);
    assert.equal(effect, 'This computer drops its saved route to it and stops listing it. Nothing changes on Build box.');
    assert.equal(basis, 'Build box did not list it at the last read.');
    assert.deepEqual([...f.q('.lifecycle-footer').querySelectorAll('button')].map(b => b.textContent), ['Cancel', 'Forget']);
    const dialog = f.q('.lifecycle-dialog');
    assert.equal(dialog.getAttribute('role'), 'dialog'); assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.equal(f.doc.activeElement, f.cancel(), 'focus starts on Cancel');
  } finally { f.close(); }
  const withheld = forgetWords({ ...GONE, instance: 'dev\u0001a', repoName: 'token=abc123' });
  assert.equal(withheld.question, 'Forget this instance on the server?');
  assert.equal(withheld.effect, 'This computer drops its saved route to it and stops listing it. Nothing changes on the server.');
  assert.equal(withheld.basis, 'The server did not list it at the last read.');
  assert.equal(forgetWords({ ...GONE, repoName: undefined }).question, 'Forget dev-a on build?', 'no label: the server id');
  assert.equal(shownInstance('dev a'), 'dev a', 'a name is one display line');
});

test('opening, Cancel and Escape send nothing, and focus returns to the opener', async () => {
  const f = fixture();
  try {
    f.open(); f.cancel().click(); await tick();
    assert.equal(f.shown(), false); assert.equal(f.doc.activeElement.id, 'opener');
    f.open(); f.key('Escape'); await tick();
    assert.equal(f.shown(), false); assert.equal(f.doc.activeElement.id, 'opener');
    f.open(); f.dialog.close(); await tick(); assert.equal(f.shown(), false);
    assert.deepEqual([f.sent.length, f.said.length], [0, 0]);
  } finally { f.close(); }
});

test('Forget sends exactly one request with the row\'s own identity; busy: focus on the status, Tab and Escape stay, no second send', async () => {
  const f = fixture({ answer: 'hold' });
  try {
    f.open({ ...GONE, home: '/elsewhere', agentsRoot: '/x', extra: '--force' });
    const confirm = f.confirm();
    confirm.click(); confirm.click(); confirm.dispatchEvent(new f.dom.window.MouseEvent('click', { bubbles: true, detail: 2 }));
    assert.deepEqual(f.sent, [{ server: 'build', instance: 'dev-a' }], 'only the two identity values, once');
    const dialog = f.q('.lifecycle-dialog');
    assert.equal(dialog.getAttribute('aria-busy'), 'true');
    assert.equal(f.doc.activeElement, f.status(), 'focus parks on the status line');
    assert.equal(f.status().textContent, 'Forgetting dev-a…');
    assert.deepEqual([f.cancel().disabled, f.confirm().disabled], [true, true]);
    for (const b of [f.cancel(), f.confirm()]) assert.equal(b.getAttribute('aria-describedby'), f.status().id, 'a disabled control names why');
    f.key('Tab'); assert.equal(f.doc.activeElement, f.status(), 'Tab stays inside');
    f.key('Tab', { shiftKey: true }); assert.equal(f.doc.activeElement, f.status());
    f.key('Escape'); assert.equal(f.shown(), true, 'Escape does nothing while busy');
    f.key('Enter'); f.confirm().click(); f.cancel().click(); f.dialog.close();
    assert.equal(f.shown(), true, 'Cancel and close do nothing while busy');
    assert.equal(f.open(), false, 'the menu reopened: the busy dialog stays and nothing is sent');
    assert.equal(f.sent.length, 1);
    f.pending[0].resolve({ status: 'forgotten', server: 'build', instance: 'dev-a' }); await tick();
    assert.equal(f.sent.length, 1); assert.equal(f.shown(), false);
  } finally { f.close(); }
});

test('success: the dialog closes, focus to the next row, and the status line; the answer\'s other fields are not shown', async () => {
  const f = fixture({ answer: { status: 'forgotten', server: 'build', instance: 'dev-a', home: '/srv/team/x', target: { sshHost: 'build-host' } } });
  try {
    f.open(); f.confirm().click(); await tick();
    assert.equal(f.shown(), false);
    assert.equal(f.doc.activeElement.id, 'next');
    assert.deepEqual(f.said, ['Forgot dev-a on Build box.']);
  } finally { f.close(); }
});

test('E_SNAPSHOT_UNKNOWN: nothing was changed, focus to the next row', async () => {
  const f = fixture({ answer: { status: 'refused', reason: { code: 'E_SNAPSHOT_UNKNOWN', message: 'no saved route for dev-a through server build' } } });
  try {
    f.open(); f.confirm().click(); await tick();
    assert.deepEqual(f.said, ['This computer had no saved route for dev-a on Build box; nothing was changed.']);
    assert.equal(f.doc.activeElement.id, 'next');
  } finally { f.close(); }
});

test('another refusal: "Couldn\'t forget", the kernel\'s lines under it (a plain, a withheld and a long message), focus to the opener', async () => {
  for (const message of ['/x/remote/build/dev-a.json: Unexpected token', 'password=hunter2 in the route', `${'a very long refusal '.repeat(200)}end`]) {
    const f = fixture({ answer: { status: 'refused', reason: { code: 'E_SNAPSHOT_UNREADABLE', message } } });
    try {
      f.open(); f.confirm().click(); await tick();
      const lines = kernelLines(message, undefined, DESKTOP_TERMS);
      assert.deepEqual(f.said, [["Couldn't forget dev-a.", ...lines].join('\n')]);
      assert.ok(lines.every(line => !line.includes('\n') && line.length <= 2048 + 16), 'each kernel text is one bounded display line');
      if (message.startsWith('password')) assert.deepEqual(lines, ['[Detail withheld]']);
      assert.equal(f.doc.activeElement.id, 'opener');
    } finally { f.close(); }
  }
});

test('an unknown outcome: no answer, a rejected request, an answer for another row, a malformed body; never "Couldn\'t forget"', async () => {
  for (const answer of [() => ({ status: 'unknown', reason: { code: 'E_CLI_TIMEOUT' } }), () => Promise.reject(new Error('proxy timed out')),
    () => ({ status: 'forgotten', server: 'build', instance: 'dev-b' }), () => ({ raw: '<html>' }), () => null]) {
    const f = fixture({ answer });
    try {
      f.open(); f.confirm().click(); await tick();
      assert.deepEqual(f.said, ['It is not known whether dev-a was forgotten.']);
      assert.equal(f.doc.activeElement.id, 'opener'); assert.equal(f.shown(), false);
    } finally { f.close(); }
  }
});

test('nothing ran (busy elsewhere, refused input): "Couldn\'t forget" with the Desktop\'s own reason', async () => {
  const f = fixture({ answer: { status: 'not-run', reason: { code: 'E_BUSY', message: 'A Forget for this instance is already running.' } } });
  try {
    f.open(); f.confirm().click(); await tick();
    assert.deepEqual(f.said, ["Couldn't forget dev-a.\nA Forget for this instance is already running."]);
    assert.equal(f.doc.activeElement.id, 'opener');
  } finally { f.close(); }
});

test('a late success after a workspace change: nothing said or focused; the row cannot be sent again meanwhile', async () => {
  const f = fixture({ answer: 'hold' });
  try {
    f.open(); f.confirm().click();
    f.switchWorkspace(); assert.equal(f.shown(), false, 'the workspace change closes it');
    assert.equal(f.open(), false, 'the same row cannot be forgotten again while its command runs');
    f.doc.getElementById('roster').focus();
    f.pending[0].resolve({ status: 'forgotten', server: 'build', instance: 'dev-a' }); await tick();
    assert.deepEqual([f.sent.length, f.said.length], [1, 0]);
    assert.equal(f.doc.activeElement.id, 'roster', 'focus not moved');
    assert.equal(f.open(), true, 'answered: it can open again');
  } finally { f.close(); }
});

test('a late failure after dispose: nothing said', async () => {
  const f = fixture({ answer: 'hold' });
  f.open(); f.confirm().click();
  f.dialog.dispose();
  f.pending[0].reject(new Error('late'));
  await tick();
  assert.deepEqual([f.sent.length, f.said.length], [1, 0]);
  f.dom.window.close();
});

test('busy holds the window: a shell shortcut (the real keymap, on the window) neither runs nor moves focus, focus that leaves comes back', async () => {
  const f = fixture({ answer: 'hold' });
  const ran = [];
  const off = registerAction({ id: 'test.forget.focusFilter', label: 'Focus the filter', context: 'global', defaultChord: 'Mod+Shift+F9',
    run: () => { ran.push(1); f.doc.getElementById('filter').focus(); } });
  const onKey = event => handleKeydown(event, { isMac: false });
  f.dom.window.addEventListener('keydown', onKey);
  const chord = target => target.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'F9', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  try {
    chord(f.doc.body); assert.equal(ran.length, 1, 'the shortcut runs when nothing is busy');
    f.open(); f.confirm().click();
    chord(f.status()); chord(f.doc.getElementById('filter')); chord(f.doc.body);
    assert.equal(ran.length, 1, 'no shortcut runs while busy, wherever the key lands');
    assert.equal(f.doc.activeElement, f.status());
    f.doc.getElementById('filter').focus();
    assert.equal(f.doc.activeElement, f.status(), 'focus put outside comes back to the status line');
    f.key('Tab'); assert.equal(f.doc.activeElement, f.status());
    f.pending[0].resolve({ status: 'forgotten', server: 'build', instance: 'dev-a' }); await tick();
    chord(f.doc.body); assert.equal(ran.length, 2, 'released once answered');
    f.doc.getElementById('filter').focus(); assert.equal(f.doc.activeElement.id, 'filter');
  } finally { off(); f.dom.window.removeEventListener('keydown', onKey); f.close(); }
});

test('another modal taking focus before the press closes this one, sending nothing; plain focus elsewhere does not; busy, it holds', async () => {
  const f = fixture({ answer: 'hold' });
  const modal = () => { const el = f.doc.createElement('section'); el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    const b = f.doc.createElement('button'); b.textContent = 'Close'; el.append(b); f.doc.body.append(el); return b; };
  try {
    f.open(); f.doc.getElementById('filter').focus(); await tick();
    assert.equal(f.shown(), true, 'focus outside any modal leaves the confirmation open');
    const other = modal(); other.focus(); await tick();
    assert.equal(f.shown(), false, 'Connections, the palette, a lifecycle confirmation: any aria-modal closes it');
    assert.equal(f.doc.activeElement, other, 'focus stays where the other modal put it');
    assert.deepEqual([f.sent.length, f.said.length], [0, 0]);
    other.closest('section').remove();
    assert.equal(f.dialog.open(GONE), true, 'it opens again afterwards');
    f.confirm().click(); const busyOther = modal(); busyOther.focus(); await tick();
    assert.equal(f.shown(), true, 'busy, nothing closes it'); assert.equal(f.doc.activeElement, f.status());
    f.pending[0].resolve({ status: 'forgotten', server: 'build', instance: 'dev-a' }); await tick();
    assert.deepEqual([f.sent.length, f.said.length], [1, 1]);
  } finally { f.close(); }
});

test('the roster is not edited: the row stays until the server\'s read lands, and a second Forget of it says nothing was changed', async () => {
  let n = 0;
  const f = fixture({ answer: body => (n++ === 0 ? { status: 'forgotten', server: body.server, instance: body.instance }
    : { status: 'refused', reason: { code: 'E_SNAPSHOT_UNKNOWN', message: 'no saved route for dev-a through server build' } }) });
  try {
    f.open(); f.confirm().click(); await tick();
    assert.equal(f.shown(), false);
    assert.equal(f.open(), true, 'the row, still listed, can be opened again');
    f.confirm().click(); await tick();
    assert.deepEqual(f.sent, [{ server: 'build', instance: 'dev-a' }, { server: 'build', instance: 'dev-a' }]);
    assert.deepEqual(f.said, ['Forgot dev-a on Build box.', 'This computer had no saved route for dev-a on Build box; nothing was changed.']);
  } finally { f.close(); }
});

test('the next row is the first that followed the forgotten one when the dialog opened and is still shown; none after it: null', () => {
  const row = id => ({ dataset: { treeInstance: id } });
  const [a, b, c] = ['a', 'b', 'c'].map(row);
  assert.equal(forgetSuccessor([b, c], ['a', 'b', 'c'], 0), b, 'the forgotten row already gone: its successor by identity');
  assert.equal(forgetSuccessor([a, c], ['a', 'b', 'c'], 0), c, 'a successor that left is skipped');
  assert.equal(forgetSuccessor([a, b], ['a', 'b'], 1), null, 'the last row: none after it, never one before');
  assert.equal(forgetSuccessor([a, b], ['a', 'b'], -1), null);
});
