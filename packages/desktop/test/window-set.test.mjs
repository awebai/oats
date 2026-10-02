// One Desktop window per workspace (#481): the window registry in main. At most one window per
// workspace key; opening a workspace that already has a window restores, shows and focuses it and
// creates nothing; a claim for a key another window holds focuses that window (or, for a view that
// moved under a window, does not) and changes nothing; closing removes a window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWindowSet } from '../window-set.mjs';

function fixture() {
  const log = [], created = [];
  const make = (key) => {
    const win = { key, destroyed: false, minimized: false,
      isDestroyed() { return this.destroyed; }, isMinimized() { return this.minimized; },
      restore() { log.push(['restore', key]); this.minimized = false; }, show() { log.push(['show', key]); }, focus() { log.push(['focus', key]); } };
    created.push(win); return win;
  };
  return { log, created, set: createWindowSet({ create: make }) };
}

test('open creates a window bound to the workspace; opening it again focuses that window and creates nothing', () => {
  const f = fixture();
  const first = f.set.open('/d/a');
  assert.equal(first.opened, true); assert.equal(f.created.length, 1);
  assert.equal(f.set.keyOf(first.win), '/d/a'); assert.equal(f.set.windowOf('/d/a'), first.win);
  first.win.minimized = true;
  const again = f.set.open('/d/a');
  assert.deepEqual({ focused: again.focused, same: again.win === first.win }, { focused: true, same: true });
  assert.equal(f.created.length, 1, 'no duplicate window');
  assert.deepEqual(f.log, [['restore', '/d/a'], ['show', '/d/a'], ['focus', '/d/a']]);
});

test('an unbound window holds no key; it binds by a claim', () => {
  const f = fixture();
  const win = f.set.openUnbound();
  assert.equal(f.set.keyOf(win), null);
  assert.deepEqual(f.set.claim(win, '/d/a'), { ok: true });
  assert.equal(f.set.windowOf('/d/a'), win);
});

test('a claim moves a window to a free key and frees its old one', () => {
  const f = fixture();
  const { win } = f.set.open('/d/a');
  assert.deepEqual(f.set.claim(win, '/d/b'), { ok: true });
  assert.equal(f.set.windowOf('/d/a'), null); assert.equal(f.set.windowOf('/d/b'), win);
  assert.deepEqual(f.set.claim(win, '/d/b'), { ok: true }, 'its own key is always its own');
});

test('a claim for a key another window holds focuses that window and changes nothing', () => {
  const f = fixture();
  const a = f.set.open('/d/a').win, b = f.set.open('/d/b').win;
  f.log.length = 0;
  assert.deepEqual(f.set.claim(a, '/d/b'), { ok: false, code: 'focused-other' });
  assert.equal(f.set.keyOf(a), '/d/a'); assert.equal(f.set.windowOf('/d/b'), b);
  assert.deepEqual(f.log, [['show', '/d/b'], ['focus', '/d/b']]);
});

test('a claim that must not focus (a view that moved under a window) leaves the other window alone', () => {
  const f = fixture();
  const a = f.set.open('/d/a').win; f.set.open('/d/b');
  f.log.length = 0;
  assert.deepEqual(f.set.claim(a, '/d/b', { focus: false }), { ok: false, code: 'open-elsewhere' });
  assert.deepEqual(f.log, []);
  assert.equal(f.set.keyOf(a), '/d/a');
});

test('unbinding frees the key; the window stays registered with none', () => {
  const f = fixture();
  const { win } = f.set.open('/d/a');
  f.set.unbind(win);
  assert.equal(f.set.keyOf(win), null); assert.equal(f.set.windowOf('/d/a'), null);
  assert.equal(f.set.open('/d/a').opened, true, 'the workspace can get a window again');
});

test('closing removes a window from the registry and frees its key', () => {
  const f = fixture();
  const { win } = f.set.open('/d/a');
  f.set.remove(win);
  assert.equal(f.set.windowOf('/d/a'), null); assert.equal(f.set.keyOf(win), undefined);
  assert.deepEqual(f.set.claim(win, '/d/b'), { ok: false, code: 'unknown-window' });
  assert.equal(f.set.open('/d/a').opened, true);
});

test('a destroyed window never holds a key, even before its closed event', () => {
  const f = fixture();
  const old = f.set.open('/d/a').win; old.destroyed = true;
  const next = f.set.open('/d/a');
  assert.equal(next.opened, true); assert.notEqual(next.win, old);
});

test('the most recently focused live window, for a second launch with no workspace', () => {
  const f = fixture();
  const a = f.set.open('/d/a').win, b = f.set.open('/d/b').win;
  assert.equal(f.set.mostRecent(), b, 'with no focus seen, the newest');
  f.set.focused(a); assert.equal(f.set.mostRecent(), a);
  a.destroyed = true; assert.equal(f.set.mostRecent(), b);
  f.set.remove(a); f.set.remove(b); assert.equal(f.set.mostRecent(), null);
});
