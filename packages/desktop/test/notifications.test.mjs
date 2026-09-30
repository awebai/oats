import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { createNotificationCenter, notificationCSS } from '../renderer/notifications.mjs';
import { createSelectionOwnership } from '../renderer/selection-ownership.mjs';
import { revealInScrollport } from '../renderer/reveal-in-scrollport.mjs';
import { iconElement } from '../renderer/shell-icons.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(t, create = createNotificationCenter) {
  const dom = new JSDOM('<!doctype html><body><input id="terminal"><div id="roster"></div><button id="fallback">Focus mode</button></body>');
  const doc = dom.window.document; let gen = 0, listener, unsubscribed = false, projecting = false;
  const intents = [], projections = [];
  const center = create({ document: doc, generation: () => gen, subscribe: fn => { listener = fn; return () => { unsubscribed = true; }; },
    onIntent: e => { assert.equal(projecting, false); intents.push(e.type); },
    applyFocus: fn => { projecting = true; projections.push(true); try { fn(); } finally { projecting = false; } }, fallbackFocus: () => doc.querySelector('#fallback') });
  t.after(() => { center.dispose(); dom.window.close(); });
  return { dom, doc, center, intents, projections, cards: () => [...doc.querySelectorAll('.app-toast')], texts: () => [...doc.querySelectorAll('.app-toast-text')].map(el => el.textContent),
    visit: () => { gen++; listener(); }, bump: () => gen++, unsubscribed: () => unsubscribed };
}

test('existing messages are literal, persistent, bounded and independent of roster DOM, with no fabricated severity or actions', async t => {
  const u = setup(t), input = u.doc.querySelector('#terminal'); input.focus();
  const hostile = '<img src=x onerror=evil()>\n<script>fake severity: success</script>';
  const posted = u.center.notify(hostile); assert.equal(typeof posted, 'object'); assert.equal(posted.shown, true); assert.deepEqual(u.texts(), [hostile]);
  assert.equal(u.doc.activeElement, input); assert.equal(u.intents.length, 0);
  u.doc.querySelector('#roster').replaceChildren(); await tick();
  assert.deepEqual(u.texts(), [hostile], 'no repaint or expiry dismissal');
  assert.equal(u.doc.querySelector('img,script,a'), null);
  assert.equal(u.cards()[0].querySelector('button').getAttribute('aria-label'), 'Dismiss notification');
  assert.equal(u.doc.querySelector('ol').getAttribute('aria-live'), 'polite');
  for (let n = 0; n < 8; n++) u.center.notify(`message ${n}`);
  assert.deepEqual(u.texts(), ['message 5', 'message 6', 'message 7']);
  assert.equal(u.doc.querySelectorAll('.app-toast button').length, 3, 'dismiss only, no inferred Open/View/Logs');
  for (const invalid of [null, {}, '', '   ']) assert.equal(u.center.notify(invalid), false);
});

test('capacity eviction never removes the focused message, changes its node, steals focus or mints intent', t => {
  const u = setup(t); u.center.notify('pinned'); u.center.notify('two'); u.center.notify('three');
  const pinned = u.cards()[0], field = pinned.querySelector('.app-toast-text'), removed = u.cards()[1].querySelector('button');
  field.focus(); const count = u.intents.length;
  for (let n = 0; n < 8; n++) u.center.notify(`new ${n}`);
  assert.equal(u.cards()[0], pinned); assert.equal(u.doc.activeElement, field); assert.equal(u.intents.length, count);
  assert.deepEqual(u.texts(), ['pinned', 'new 6', 'new 7']);
  removed.dispatchEvent(new u.dom.window.Event('click')); assert.deepEqual(u.texts(), ['pinned', 'new 6', 'new 7']);
});

test('explicit keyboard dismissal uses current next control then a visible owned return target; projected focus is not intent', t => {
  const u = setup(t), input = u.doc.querySelector('#terminal'); input.focus();
  u.center.notify('one'); u.center.notify('two');
  u.cards()[0].querySelector('button').focus(); const count = u.intents.length;
  u.cards()[0].querySelector('button').click(); assert.equal(u.doc.activeElement, u.cards()[0].querySelector('button'));
  u.cards()[0].querySelector('button').click(); assert.equal(u.doc.activeElement, input);
  assert.equal(u.intents.length, count); assert.equal(u.projections.length, 2);
});

test('a hidden/disconnected return target is never revived and a background dismissal never steals focus', t => {
  const u = setup(t), input = u.doc.querySelector('#terminal'); input.focus(); u.center.notify('one');
  u.cards()[0].querySelector('button').focus(); input.hidden = true;
  u.cards()[0].querySelector('button').click(); assert.equal(u.doc.activeElement, u.doc.querySelector('#fallback'));
  input.hidden = false; input.focus(); u.center.notify('two');
  const count = u.projections.length; u.cards()[0].querySelector('button').click();
  assert.equal(u.doc.activeElement, input); assert.equal(u.projections.length, count);
});

test('workspace A→B→A and disposal revoke messages/controls without old focus or lifetime resurrection', t => {
  const u = setup(t); u.center.notify('A'); const old = u.cards()[0].querySelector('button');
  u.visit(); assert.deepEqual(u.texts(), []); u.center.notify('B'); u.visit(); u.center.notify('new A');
  old.dispatchEvent(new u.dom.window.Event('click')); assert.deepEqual(u.texts(), ['new A']);
  const retained = u.cards()[0].querySelector('button'); u.center.dispose();
  assert.equal(u.unsubscribed(), true); assert.equal(u.center.notify('late'), false); retained.click();
  assert.equal(u.doc.querySelector('.app-notifications'), null);
});

for (const weakened of [false, true]) test(`global generation independently blocks stale dismissal${weakened ? ' (mutation detected)' : ''}`, t => {
  let create = createNotificationCenter;
  if (weakened) {
    const source = create.toString(), guard = 'scope !== generation() || !visible(entry.element)';
    assert.equal(source.split(guard).length, 2);
    create = runInNewContext(`(${source.replace(guard, '!visible(entry.element)')})`, { centers: 0, revealInScrollport, iconElement });
  }
  const u = setup(t, create); u.center.notify('old'); const button = u.cards()[0].querySelector('button');
  u.bump(); u.bump(); button.dispatchEvent(new u.dom.window.Event('click'));
  const unchanged = () => assert.deepEqual(u.texts(), ['old']);
  if (weakened) assert.throws(unchanged); else unchanged();
});

test('a short-window stack reveals its focused content only inside its own scrollport, without changing focus on arrival', t => {
  const u = setup(t); u.center.notify('pinned'); u.center.notify('other');
  const root = u.doc.querySelector('.app-notifications'), field = u.cards()[0].querySelector('.app-toast-text');
  Object.defineProperty(root, 'clientHeight', { value: 80 }); root.getBoundingClientRect = () => ({ top: 100 });
  field.getBoundingClientRect = () => ({ top: 230 - root.scrollTop, bottom: 250 - root.scrollTop });
  field.focus(); const count = u.intents.length; u.doc.documentElement.scrollTop = 17;
  u.center.notify('third');
  assert.equal(root.scrollTop, 70); assert.equal(u.doc.activeElement, field); assert.equal(u.intents.length, count);
  assert.equal(u.projections.length, 0); assert.equal(u.doc.documentElement.scrollTop, 17);
});

test('shipped shell uses the actual center, clears scope, and treats real notification entry as selection intent', t => {
  const dom = new JSDOM('<body><input id="terminal"></body>'); t.after(() => dom.window.close());
  const doc = dom.window.document; let gen = 0, changed;
  const c = { document: doc, window: dom.window, createNotificationCenter, workspaceGeneration: () => gen,
    onWorkspaceChange: fn => { changed = fn; return () => {}; }, currentWorkspace: () => 'workspace',
    connectionGeneration: 0, subscribeConnections: () => () => {} };
  c.tabOpenIntents = createSelectionOwnership({ currentWorkspace: () => 'workspace', workspaceGeneration: () => gen });
  const source = readFileSync(new URL('../renderer/shell.mjs', import.meta.url), 'utf8');
  const first = source.indexOf('const notifications = createNotificationCenter'), last = source.indexOf('// ── ctx', first);
  const center = runInNewContext(`${source.slice(first, last)}\nnotifications`, c); t.after(() => center.dispose());
  // Exercise the one-line shipped ctx binding, not a second notification path.
  const binding = source.match(/^  notify: ([^,\n]+),$/m); assert.ok(binding);
  const notify = new Function('notifications', `return ${binding[1]};`)(center);
  const current = c.tabOpenIntents.begin(); notify('literal'); assert.equal(current(), true);
  doc.querySelector('.app-toast-dismiss').focus(); assert.equal(current(), false);
  gen++; changed(); assert.equal(doc.querySelector('.app-toast'), null);
});

function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const c = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
for (const theme of ['light', 'solarized', 'dark']) test(`${theme}: toast text/control AA uses the actual opaque primary pair`, t => {
  const u = setup(t); const style = u.doc.createElement('style'); style.textContent = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8') + notificationCSS;
  u.doc.head.append(style); u.doc.documentElement.dataset.theme = theme; u.center.notify('Notification');
  const root = u.dom.window.getComputedStyle(u.doc.documentElement);
  const stack = u.dom.window.getComputedStyle(u.doc.querySelector('.app-notifications'));
  assert.equal(stack.maxHeight, 'calc(100vh - 58px)'); assert.equal(stack.overflowY, 'auto');
  for (const selector of ['.app-toast-text', '.app-toast-dismiss']) {
    const el = u.doc.querySelector(selector); assert.equal(u.dom.window.getComputedStyle(el).color, 'var(--primary-fg)');
    assert.equal(u.dom.window.getComputedStyle(u.cards()[0]).background, 'var(--primary-bg)');
    const a = luminance(root.getPropertyValue('--primary-fg').trim()), b = luminance(root.getPropertyValue('--primary-bg').trim());
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5);
    for (let p = el; p; p = p.parentElement) assert.equal(u.dom.window.getComputedStyle(p).opacity, '1');
  }
});

// Spec C (instant spawn): owned action buttons, a Details disclosure, sticky entries, operator-only onDismiss,
// the posting handle, and grouping of more than three sticky entries of one group.
const click = (u, el) => el.dispatchEvent(new u.dom.window.Event('click'));
test('owned action buttons run their callback once per click, disable while running, and refuse after dismissal or a scope change', async t => {
  const u = setup(t); let calls = 0, owner = null, release;
  u.center.notify('release-manager-3 was not created.', { buttons: [{ label: 'Reopen spawn', ariaLabel: 'Reopen spawn for release-manager-3',
    activate: async owns => { calls++; owner = owns; await new Promise(r => { release = r; }); } }] });
  const b = u.doc.querySelector('.app-toast-action');
  assert.equal(b.textContent, 'Reopen spawn'); assert.equal(b.getAttribute('aria-label'), 'Reopen spawn for release-manager-3'); assert.equal(b.type, 'button');
  assert.equal(u.doc.querySelector('.app-toast-open'), null, 'no Open action without a descriptor');
  b.click(); assert.equal(calls, 1); assert.equal(b.disabled, true); b.click(); assert.equal(calls, 1, 'no second run while the first is in the air');
  assert.equal(owner(), true); release(); await tick(); assert.equal(b.disabled, false);
  u.bump(); click(u, b); await tick(); assert.equal(calls, 1, 'a stale scope ignores the click'); assert.equal(owner(), false);
  const v = setup(t); let later = 0;
  v.center.notify('x', { buttons: [{ label: 'Check result', activate: () => { later++; } }] });
  const vb = v.doc.querySelector('.app-toast-action'); v.cards()[0].querySelector('.app-toast-dismiss').click();
  click(v, vb); await tick(); assert.equal(later, 0, 'a dismissed entry\'s button does nothing');
  // A thrown callback says so on the card, in its own status line; the button comes back.
  const w = setup(t);
  w.center.notify('y', { buttons: [{ label: 'Check result', activate: async () => { throw new Error('boom'); } }] });
  const wb = w.doc.querySelector('.app-toast-action'); wb.click(); await tick(); await tick();
  assert.equal(w.doc.querySelector('.app-toast-action-status').getAttribute('role'), 'status');
  assert.match(w.doc.querySelector('.app-toast-action-status').textContent, /Check result did not complete/); assert.equal(wb.disabled, false);
});

test('buttons coexist with the Open action; the Open action is unchanged', t => {
  const u = setup(t);
  u.center.notify('plain', { buttons: [{ label: 'View schedules', activate: () => {} }], descriptor: null, activate: null });
  assert.deepEqual([...u.doc.querySelectorAll('.app-toast button')].map(b => b.textContent || b.getAttribute('aria-label')), ['Dismiss notification', 'View schedules']);
  for (const bad of [[{ label: '', activate: () => {} }], [{ label: 'x' }], 'nope', [null]]) { u.center.clear(); u.center.notify('m', { buttons: bad }); assert.equal(u.doc.querySelector('.app-toast-action'), null, JSON.stringify(bad)); }
});

test('Details: a disclosure button (aria-expanded, aria-controls) shows and hides the technical text', t => {
  const u = setup(t);
  u.center.notify('Spawn refused. Nothing was created.', { detail: 'E_DECISION_STALE: decision revision abc changed' });
  const toggle = u.doc.querySelector('.app-toast-details'), panel = u.doc.getElementById(toggle.getAttribute('aria-controls'));
  assert.equal(toggle.textContent, 'Details'); assert.equal(toggle.getAttribute('aria-expanded'), 'false'); assert.equal(panel.hidden, true);
  assert.equal(panel.textContent, 'E_DECISION_STALE: decision revision abc changed');
  toggle.click(); assert.equal(toggle.textContent, 'Hide details'); assert.equal(toggle.getAttribute('aria-expanded'), 'true'); assert.equal(panel.hidden, false);
  toggle.click(); assert.equal(panel.hidden, true);
  u.center.clear(); u.center.notify('no detail', { detail: '   ' }); assert.equal(u.doc.querySelector('.app-toast-details'), null);
});

test('sticky entries are never evicted by capacity; non-sticky ones keep the 3-entry bound', t => {
  const u = setup(t);
  u.center.notify('failed A', { sticky: true }); u.center.notify('failed B', { sticky: true });
  for (let n = 0; n < 6; n++) u.center.notify(`m${n}`);
  assert.deepEqual(u.texts(), ['failed A', 'failed B', 'm3', 'm4', 'm5']);
  u.center.notify('failed C', { sticky: true }); u.center.notify('m6');
  assert.deepEqual(u.texts(), ['failed A', 'failed B', 'm4', 'm5', 'failed C', 'm6']);
});

test('onDismiss runs once, only when the operator dismisses with ×; never on the handle, clear, eviction or dispose', t => {
  const u = setup(t), seen = [];
  const a = u.center.notify('A', { sticky: true, onDismiss: () => seen.push('A') });
  const b = u.center.notify('B', { onDismiss: () => seen.push('B') });
  u.center.notify('C', { onDismiss: () => seen.push('C') }); u.center.notify('D'); u.center.notify('E'); // evicts B and C
  assert.equal(b.shown, false); assert.deepEqual(seen, []);
  u.cards()[0].querySelector('.app-toast-dismiss').click(); assert.deepEqual(seen, ['A']); assert.equal(a.shown, false);
  const thrower = u.center.notify('T', { onDismiss: () => { throw new Error('x'); } });
  u.cards().find(c => c.textContent.startsWith('T')).querySelector('.app-toast-dismiss').click(); assert.equal(thrower.shown, false, 'a throwing callback never keeps the card');
  const h = u.center.notify('H', { sticky: true, onDismiss: () => seen.push('H') }); h.dismiss();
  const k = u.center.notify('K', { sticky: true, onDismiss: () => seen.push('K') }); u.center.clear();
  const d = u.center.notify('Z', { sticky: true, onDismiss: () => seen.push('Z') }); u.center.dispose();
  assert.deepEqual(seen, ['A']); for (const x of [h, k, d]) assert.equal(x.shown, false);
});

test('the handle: shown until the entry goes for any reason; a workspace change clears sticky entries too (the owner re-posts)', t => {
  const u = setup(t);
  const sticky = u.center.notify('failed', { sticky: true }), plain = u.center.notify('plain');
  assert.equal(sticky.shown, true); assert.equal(plain.shown, true);
  u.visit(); assert.equal(sticky.shown, false); assert.equal(plain.shown, false); assert.deepEqual(u.texts(), []);
  const again = u.center.notify('failed', { sticky: true }); assert.equal(again.shown, true);
  again.dismiss(); again.dismiss(); assert.equal(again.shown, false); assert.deepEqual(u.texts(), []);
});

test('more than three sticky entries of one group collapse into one grouped entry that expands; dismissing a member updates it and dissolves it at three', t => {
  const u = setup(t);
  const opts = n => ({ sticky: true, group: 'spawn-failed', groupLabel: count => `${count} spawns failed`, buttons: [{ label: 'Reopen spawn', ariaLabel: `Reopen spawn for p-${n}`, activate: () => {} }] });
  for (let n = 1; n <= 3; n++) u.center.notify(`p-${n} failed`, opts(n));
  u.center.notify('plain');
  assert.equal(u.doc.querySelector('.app-toast-group'), null, 'three stay individual');
  u.center.notify('p-4 failed', opts(4));
  const group = u.doc.querySelector('.app-toast-group'); assert.ok(group);
  assert.deepEqual([...u.doc.querySelector('.app-notifications > ol').children].map(li => li.querySelector(':scope > .app-toast-text').textContent), ['4 spawns failed', 'plain'],
    'the group stands where its first member was');
  const toggle = group.querySelector('.app-toast-group-toggle'), members = u.doc.getElementById(toggle.getAttribute('aria-controls'));
  assert.equal(toggle.getAttribute('aria-expanded'), 'false'); assert.equal(members.hidden, true); assert.equal(toggle.textContent, 'Show');
  assert.equal(members.children.length, 4);
  // Hidden members' controls are inert until expanded.
  toggle.click(); assert.equal(toggle.getAttribute('aria-expanded'), 'true'); assert.equal(members.hidden, false); assert.equal(toggle.textContent, 'Hide');
  const second = members.children[1].querySelector('.app-toast-dismiss'); second.focus(); second.click();
  assert.equal(u.doc.querySelector('.app-toast-group'), null, 'at three it dissolves');
  assert.deepEqual(u.texts(), ['p-1 failed', 'p-3 failed', 'plain', 'p-4 failed'], 'back in arrival order');
  assert.equal(u.doc.activeElement, u.cards()[1].querySelector('.app-toast-dismiss'), 'focus moves to the next card');
  // A focused member hidden by a collapsing regroup hands focus to the group toggle.
  u.cards()[0].querySelector('.app-toast-dismiss').focus();
  u.center.notify('p-5 failed', opts(5));
  const g2 = u.doc.querySelector('.app-toast-group'); assert.ok(g2); assert.equal(g2.querySelector('.app-toast-group-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(u.doc.activeElement, g2.querySelector('.app-toast-group-toggle'));
  // Another group's entries and non-sticky ones never join it.
  u.center.notify('other', { sticky: true, group: 'other-group', groupLabel: n => `${n} others` });
  assert.equal(u.doc.querySelectorAll('.app-toast-group').length, 1);
});

for (const theme of ['light', 'solarized', 'dark']) test(`${theme}: action buttons, Details text and grouped members stay on the opaque primary pair`, t => {
  const u = setup(t); const style = u.doc.createElement('style'); style.textContent = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8') + notificationCSS;
  u.doc.head.append(style); u.doc.documentElement.dataset.theme = theme;
  for (let n = 1; n <= 4; n++) u.center.notify(`p-${n}`, { sticky: true, group: 'g', groupLabel: c => `${c} spawns failed`, detail: 'E_X', buttons: [{ label: 'Reopen spawn', activate: () => {} }] });
  u.doc.querySelector('.app-toast-group-toggle').click(); u.doc.querySelector('.app-toast-details').click();
  const root = u.dom.window.getComputedStyle(u.doc.documentElement);
  const a = luminance(root.getPropertyValue('--primary-fg').trim()), b = luminance(root.getPropertyValue('--primary-bg').trim());
  assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5);
  for (const selector of ['.app-toast-action', '.app-toast-detail', '.app-toast-group-toggle', '.app-toast-group-list .app-toast .app-toast-text']) {
    const el = u.doc.querySelector(selector); assert.ok(el, selector);
    for (let p = el; p; p = p.parentElement) assert.equal(u.dom.window.getComputedStyle(p).opacity, '1', selector);
  }
  assert.equal(u.dom.window.getComputedStyle(u.doc.querySelector('.app-toast-action')).color, 'var(--primary-fg)');
  assert.equal(u.dom.window.getComputedStyle(u.doc.querySelector('.app-toast-action')).background, 'var(--primary-bg)');
  assert.equal(u.dom.window.getComputedStyle(u.doc.querySelector('.app-toast-detail')).color, 'var(--primary-fg)');
  assert.equal(u.dom.window.getComputedStyle(u.doc.querySelector('.app-toast-group-list .app-toast')).background, 'var(--primary-bg)');
  assert.match(notificationCSS, /\.app-toast button:focus-visible \{ background:var\(--primary-fg\); color:var\(--primary-bg\); \}/, 'focus inverts inside the toast (control rule 2)');
});
