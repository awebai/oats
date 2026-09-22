import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { createNotificationCenter, notificationCSS } from '../renderer/notifications.mjs';
import { createSelectionOwnership } from '../renderer/selection-ownership.mjs';
import { revealInScrollport } from '../renderer/reveal-in-scrollport.mjs';
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
  assert.equal(u.center.notify(hostile), true); assert.deepEqual(u.texts(), [hostile]);
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
    create = runInNewContext(`(${source.replace(guard, '!visible(entry.element)')})`, { centers: 0, revealInScrollport });
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
  const dom = new JSDOM('<body><input id="terminal"><button id="focus-mode-toggle">Focus</button></body>'); t.after(() => dom.window.close());
  const doc = dom.window.document; let gen = 0, changed;
  const c = { document: doc, window: dom.window, createNotificationCenter, workspaceGeneration: () => gen,
    onWorkspaceChange: fn => { changed = fn; return () => {}; } };
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
