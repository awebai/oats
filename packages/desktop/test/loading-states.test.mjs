// The shared loading-state primitive (desktop/loading-states): one state model
// for every data region — pending (skeleton after 150ms, never a false empty),
// ready, refreshing (content kept, "Refreshing…" after 400ms), stale (content
// kept, attention line with the observed age and Retry), empty, failed (cause,
// Details, Retry where the skeleton stood). Fixed wording; aria-busy only while
// pending; a focused Refresh/Retry is never `disabled`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createDataState, skeleton, skeletonBlock, statusLine, captureFocusState, observedAgeText, observedText, isOldObservation,
  wording, PENDING_DELAY_MS, REFRESHING_DELAY_MS, OLD_AFTER_MS, AGE_TICK_MS } from '../renderer/loading.mjs';

/** A fake clock: timers fire in order when advanced; `now()` follows. */
function clock() {
  let now = 1_000_000, seq = 0; const timers = new Map();
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
    pending: () => timers.size,
  };
}
function setup(t, options = {}) {
  const dom = new JSDOM('<body><div class="head"><button class="refresh">Refresh</button></div><p class="status" role="status"></p><div class="region"></div><button id="other">Other</button></body>', { pretendToBeVisual: true });
  const doc = dom.window.document, c = clock(), retries = [];
  t.after(() => dom.window.close());
  const region = doc.querySelector('.region'), head = doc.querySelector('.head'), status = doc.querySelector('.status');
  const ds = createDataState({ doc, noun: 'instances', region, status, indicatorHost: head, skeleton: () => skeletonBlock(doc, 'roster-row', { count: 5 }),
    onRetry: () => retries.push(ds.state), now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, ...options });
  return { dom, doc, c, ds, region, head, status, retries, one: s => doc.querySelector(s), all: s => [...doc.querySelectorAll(s)] };
}

test('the wording is fixed', () => {
  assert.equal(wording.loading('roster'), 'Loading roster…'); assert.equal(wording.refreshing, 'Refreshing…');
  assert.equal(wording.couldNotRefresh('instances'), "Couldn't refresh instances"); assert.equal(wording.retry, 'Retry');
  assert.equal(wording.updated('readiness'), 'Readiness updated'); assert.equal(wording.observed('3 min ago'), 'Observed 3 min ago');
  assert.equal(PENDING_DELAY_MS, 150); assert.equal(REFRESHING_DELAY_MS, 400); assert.equal(OLD_AFTER_MS, 120_000);
});

test('ages: observed just now / 45s ago / 3 min ago / at HH:MM; absent or unparseable is no age', () => {
  const now = Date.parse('2026-09-29T14:05:30.000Z');
  const at = ms => new Date(now - ms).toISOString();
  assert.equal(observedText(at(0), now), 'observed just now'); assert.equal(observedText(at(9_000), now), 'observed just now');
  assert.equal(observedText(at(45_000), now), 'observed 45s ago'); assert.equal(observedText(at(3 * 60_000), now), 'observed 3 min ago');
  const hour = observedAgeText(at(65 * 60_000), now); assert.match(hour, /^at \d\d:\d\d$/);
  const local = new Date(now - 65 * 60_000); assert.equal(hour, `at ${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`);
  for (const bad of [undefined, null, '', 'yesterday', 42]) { assert.equal(observedText(bad, now), null); assert.equal(isOldObservation(bad, now), false); }
  assert.equal(isOldObservation(at(OLD_AFTER_MS), now), false); assert.equal(isOldObservation(at(OLD_AFTER_MS + 1), now), true);
});

test('skeletons: the four shapes plus pill, every node aria-hidden, no text, sized by class', t => {
  const doc = new JSDOM('').window.document; t.after(() => doc.defaultView.close());
  for (const shape of ['roster-row', 'soul-card', 'table-row', 'detail-section']) {
    const el = skeleton(doc, shape);
    assert.equal(el.getAttribute('aria-hidden'), 'true'); assert.equal(el.dataset.skeleton, shape); assert.equal(el.textContent, '');
    assert.ok(el.classList.contains(`skeleton-${shape}`)); assert.ok(el.querySelectorAll('.skeleton').length >= 1);
    for (const bone of el.querySelectorAll('.skeleton')) assert.equal(bone.getAttribute('aria-hidden'), 'true');
  }
  assert.equal(skeleton(doc, 'table-row', { columns: 6 }).querySelectorAll('.skeleton-cell').length, 6);
  const pill = skeleton(doc, 'pill'); assert.ok(pill.classList.contains('skeleton-pill')); assert.equal(pill.getAttribute('aria-hidden'), 'true');
  const block = skeletonBlock(doc, 'roster-row', { count: 5 });
  assert.equal(block.children.length, 5); assert.equal(block.getAttribute('aria-hidden'), 'true');
  assert.throws(() => skeleton(doc, 'blob'), /unknown skeleton shape/);
  const sr = statusLine(doc, { visuallyHidden: true });
  assert.equal(sr.getAttribute('role'), 'status'); assert.ok(sr.classList.contains('loading-sr'));
  assert.equal(statusLine(doc).classList.contains('loading-sr'), false);
});

test('pending: nothing before 150ms, a skeleton after, aria-busy and "Loading instances…" once; a fast reply never flashes', t => {
  const u = setup(t);
  u.ds.begin();
  assert.equal(u.ds.state, 'pending'); assert.equal(u.region.getAttribute('aria-busy'), 'true');
  assert.equal(u.status.textContent, 'Loading instances…'); assert.equal(u.region.childElementCount, 0, 'nothing changes before the delay');
  u.c.advance(PENDING_DELAY_MS - 1); assert.equal(u.region.childElementCount, 0);
  u.c.advance(1); assert.equal(u.all('.skeleton-roster-row').length, 5, 'five roster rows at 150ms');
  assert.equal(u.region.querySelector('.skeleton-block-list').getAttribute('aria-hidden'), 'true');
  u.ds.begin(); assert.equal(u.all('.skeleton-block-list').length, 1, 'a repeated begin while pending adds nothing');
  u.ds.succeed();
  assert.equal(u.ds.state, 'ready'); assert.equal(u.region.hasAttribute('aria-busy'), false); assert.equal(u.all('.skeleton').length, 0);
  assert.equal(u.status.textContent, '', 'a background load announces nothing on success');
  // fast: begin → succeed inside the delay leaves no trace, and the timer is gone.
  const v = setup(t); v.ds.begin(); v.c.advance(PENDING_DELAY_MS - 50); v.ds.succeed(); v.c.advance(1000);
  assert.equal(v.all('.skeleton').length, 0); assert.equal(v.c.pending(), 0); assert.equal(v.region.hasAttribute('aria-busy'), false);
});

test('refreshing: content and aria-busy untouched; "Refreshing…" with a static dot only after 400ms; a user refresh announces "Instances updated"', t => {
  const u = setup(t); u.ds.begin(); u.ds.succeed();
  u.region.innerHTML = '<button class="row">a</button>'; u.one('.row').focus();
  u.ds.begin();
  assert.equal(u.ds.state, 'refreshing'); assert.equal(u.region.hasAttribute('aria-busy'), false); assert.equal(u.one('.loading-refreshing'), null);
  u.c.advance(REFRESHING_DELAY_MS - 1); assert.equal(u.one('.loading-refreshing'), null);
  u.c.advance(1);
  const indicator = u.head.querySelector('.loading-refreshing');
  assert.equal(indicator.textContent, 'Refreshing…'); assert.ok(indicator.querySelector('.loading-dot'));
  assert.equal(u.status.textContent, '', 'a background poll announces nothing');
  u.ds.succeed(); assert.equal(u.one('.loading-refreshing'), null); assert.equal(u.doc.activeElement, u.one('.row'), 'the region was never touched');
  // fast poll: no indicator.
  u.ds.begin(); u.c.advance(100); u.ds.succeed(); u.c.advance(1000); assert.equal(u.one('.loading-refreshing'), null);
  // user-invoked.
  u.ds.begin({ user: true }); u.ds.succeed(); assert.equal(u.status.textContent, 'Instances updated');
  u.ds.begin(); u.ds.succeed(); assert.equal(u.status.textContent, '', 'the next background success clears it');
});

test('stale: content kept, attention line with the observed age and Retry, actions announced once; success clears it', t => {
  const u = setup(t); u.ds.bindRefresh(u.one('.refresh'));
  const now = u.c.now();
  u.ds.begin(); u.ds.succeed({ observedAt: new Date(now - 45_000).toISOString() });
  u.region.innerHTML = '<button class="row">a</button>';
  assert.equal(u.one('.loading-notice'), null, 'a fresh observation needs no age');
  u.ds.begin(); u.ds.fail(new Error('kernel: E_TIMEOUT'));
  assert.equal(u.ds.state, 'stale'); assert.equal(u.region.querySelector('.row').textContent, 'a', 'content kept');
  const notice = u.head.querySelector('.loading-notice[data-kind="stale"]');
  assert.equal(notice.querySelector('.loading-notice-text').textContent, "Couldn't refresh instances · observed 45s ago");
  assert.equal(notice.title, 'kernel: E_TIMEOUT');
  // The cause is reachable without a pointer: a Details disclosure under the line (the code joins it when known).
  const more = notice.querySelector('details.loading-notice-details');
  assert.equal(more.hidden, false); assert.equal(more.querySelector('summary').textContent, 'Details'); assert.equal(more.querySelector('.loading-notice-cause').textContent, 'kernel: E_TIMEOUT');
  assert.equal(notice.querySelector('button.loading-retry').textContent, 'Retry');
  assert.equal(u.status.textContent, "Couldn't refresh instances.");
  u.status.textContent = 'sentinel'; u.ds.begin(); u.ds.fail(Object.assign(new Error('again'), { code: 'E_X' }));
  assert.equal(u.status.textContent, 'sentinel', 'announced once, not on every failed poll');
  assert.equal(notice.querySelector('.loading-notice-cause').textContent, 'again (E_X)', 'the disclosure follows the latest failure');
  assert.equal(u.all('.loading-notice').length, 1, 'the line is updated in place');
  // the age line follows the clock (AGE_TICK_MS) and touch().
  u.c.advance(AGE_TICK_MS); assert.equal(notice.querySelector('.loading-notice-text').textContent, "Couldn't refresh instances · observed 1 min ago");
  u.c.advance(2 * 60_000); u.ds.touch(); assert.match(notice.querySelector('.loading-notice-text').textContent, /observed 3 min ago$/);
  // Retry: wired, aria-disabled while busy, never `disabled`, ignores repeats.
  const retry = notice.querySelector('.loading-retry'); retry.focus();
  retry.click(); assert.deepEqual(u.retries, ['stale']);
  u.ds.begin({ user: true });
  assert.equal(retry.getAttribute('aria-disabled'), 'true'); assert.equal(retry.disabled, false); assert.equal(u.doc.activeElement, retry, 'focus survives');
  retry.click(); assert.deepEqual(u.retries, ['stale'], 'a repeat activation while busy is ignored');
  u.ds.succeed();
  assert.equal(u.ds.state, 'ready'); assert.equal(u.one('.loading-notice'), null); assert.equal(u.status.textContent, 'Instances updated');
  assert.equal(u.doc.activeElement, u.one('.refresh'), 'a focused Retry that vanishes hands focus to the bound Refresh control, not to body');
});

test('failed: no data and the read failed → cause, Details with the code, Retry where the skeleton stood; a retry keeps the block and its focus', t => {
  const u = setup(t); u.one('.refresh'); u.ds.bindRefresh(u.one('.refresh'));
  u.ds.begin(); u.c.advance(PENDING_DELAY_MS); assert.equal(u.all('.skeleton-roster-row').length, 5);
  u.ds.fail(Object.assign(new Error('The kernel could not read the roster.'), { code: 'E_CLI_FAILED' }));
  assert.equal(u.ds.state, 'failed'); assert.equal(u.all('.skeleton').length, 0); assert.equal(u.region.hasAttribute('aria-busy'), false);
  const failed = u.region.querySelector('.loading-failed');
  assert.equal(failed.querySelector('.loading-failed-message').textContent, 'The kernel could not read the roster.');
  assert.equal(failed.querySelector('details summary').textContent, 'Details'); assert.equal(failed.querySelector('.loading-failed-code').textContent, 'E_CLI_FAILED');
  assert.equal(u.status.textContent, "Couldn't refresh instances. The kernel could not read the roster.");
  assert.equal(u.one('.loading-notice'), null, 'no stale line without data');
  const retry = failed.querySelector('.loading-retry'); retry.focus(); retry.click(); assert.deepEqual(u.retries, ['failed']);
  u.ds.begin({ user: true }); u.c.advance(PENDING_DELAY_MS + 1);
  assert.equal(u.ds.state, 'pending'); assert.equal(u.region.getAttribute('aria-busy'), 'true');
  assert.equal(u.one('.loading-failed'), failed, 'the block stays while its retry runs'); assert.equal(u.all('.skeleton').length, 0, 'no skeleton beside it');
  assert.equal(retry.getAttribute('aria-disabled'), 'true'); assert.equal(u.doc.activeElement, retry);
  u.ds.fail(new Error('still down'));
  assert.equal(u.one('.loading-failed'), failed, 'updated in place'); assert.equal(failed.querySelector('.loading-failed-message').textContent, 'still down');
  assert.equal(failed.querySelector('.loading-failed-details').hidden, true, 'no code: no Details'); assert.equal(u.doc.activeElement, retry);
  assert.equal(retry.getAttribute('aria-disabled'), null);
  u.ds.begin({ user: true }); u.ds.succeed({ empty: true });
  assert.equal(u.ds.state, 'empty'); assert.equal(u.one('.loading-failed'), null); assert.equal(u.status.textContent, 'Instances updated');
  assert.equal(u.doc.activeElement, u.one('.refresh'));
});

test('old data after a successful read is labelled "Observed <age>" (muted, no Retry); a fresh read removes it; no observedAt, no age', t => {
  const u = setup(t); const now = u.c.now();
  u.ds.begin(); u.ds.succeed({ observedAt: new Date(now - 3 * 60_000).toISOString() });
  const line = u.head.querySelector('.loading-notice[data-kind="observed"]');
  assert.equal(line.textContent, 'Observed 3 min ago'); assert.equal(line.querySelector('.loading-retry'), null);
  assert.equal(u.ds.state, 'ready');
  u.ds.begin(); u.ds.fail(new Error('x'));
  assert.equal(u.one('.loading-notice').dataset.kind, 'stale'); assert.match(u.one('.loading-notice-text').textContent, /observed 3 min ago$/);
  u.ds.begin(); u.ds.succeed({ observedAt: new Date(u.c.now()).toISOString() }); assert.equal(u.one('.loading-notice'), null);
  u.ds.begin(); u.ds.fail(new Error('x')); assert.match(u.one('.loading-notice-text').textContent, /observed just now$/);
  u.ds.begin(); u.ds.succeed(); u.ds.begin(); u.ds.fail(new Error('x'));
  assert.equal(u.one('.loading-notice-text').textContent, "Couldn't refresh instances", 'absent observedAt: no age');
});

test('reset forgets the subject: timers, skeleton, lines and status go; the next begin is pending again', t => {
  const u = setup(t);
  u.ds.begin(); u.ds.succeed(); u.ds.begin(); u.ds.fail(new Error('x'));
  u.ds.begin(); u.ds.reset();
  assert.equal(u.ds.state, 'idle'); assert.equal(u.ds.busy, false); assert.equal(u.ds.hasData, false);
  assert.equal(u.one('.loading-notice'), null); assert.equal(u.status.textContent, ''); assert.equal(u.c.pending(), 0);
  u.ds.begin(); assert.equal(u.ds.state, 'pending'); u.c.advance(PENDING_DELAY_MS); assert.equal(u.all('.skeleton-roster-row').length, 5);
  u.ds.dispose(); assert.equal(u.all('.skeleton').length, 0); u.ds.begin(); assert.equal(u.ds.state, 'idle', 'disposed: inert');
});

test('bindRefresh: aria-disabled while busy, never disabled, repeats ignored, focus kept', t => {
  const u = setup(t); const button = u.one('.refresh'); let runs = 0;
  u.ds.bindRefresh(button, () => { runs++; u.ds.begin({ user: true }); });
  button.focus(); button.click(); assert.equal(runs, 1); assert.equal(button.getAttribute('aria-disabled'), 'true'); assert.equal(button.disabled, false);
  button.click(); assert.equal(runs, 1); assert.equal(u.doc.activeElement, button);
  u.ds.succeed(); assert.equal(button.hasAttribute('aria-disabled'), false); button.click(); assert.equal(runs, 2);
});

test('captureFocusState: a keyed control is found by its key only, a path never lands on a mutation control, the fallback takes over', t => {
  const dom = new JSDOM('<body><button id="fb">fallback</button><div class="root"><section><button data-focus-key="remove:beta">Remove beta</button><button data-focus-key="remove:gamma">Remove gamma</button></section><section><button>plain</button></section></div></body>', { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document, root = doc.querySelector('.root'), fb = doc.querySelector('#fb');
  // New data inserts a row before the focused one: the key finds "Remove gamma", not the control now at its old position.
  root.querySelector('[data-focus-key="remove:gamma"]').focus(); let restore = captureFocusState(root, { fallback: fb });
  root.innerHTML = '<section><button data-focus-key="remove:alpha">Remove alpha</button><button data-focus-key="remove:beta">Remove beta</button><button data-focus-key="remove:gamma">Remove gamma</button></section><section><button>plain</button></section>';
  assert.equal(restore(), true); assert.equal(doc.activeElement.textContent, 'Remove gamma');
  // The key is gone (the team was removed): no path guess onto another button — the fallback gets focus.
  root.querySelector('[data-focus-key="remove:gamma"]').focus(); restore = captureFocusState(root, { fallback: fb });
  root.innerHTML = '<section><button data-focus-key="remove:alpha">Remove alpha</button><button data-focus-key="remove:beta">Remove beta</button></section>';
  assert.equal(restore(), false); assert.equal(doc.activeElement, fb);
  // An unkeyed button is never re-found by path (the path could now be a different button).
  root.innerHTML = '<section><button>one</button><button>two</button></section>'; root.querySelectorAll('button')[1].focus();
  restore = captureFocusState(root, { fallback: () => fb }); root.innerHTML = '<section><button>zero</button><button>one</button></section>';
  assert.equal(restore(), false); assert.equal(doc.activeElement, fb);
  // A focused control the repaint left in place is not moved, keyed or not.
  root.innerHTML = '<section><button>kept</button><button data-focus-key="k">keyed</button></section>';
  for (const b of root.querySelectorAll('button')) { b.focus(); restore = captureFocusState(root, { fallback: fb }); root.append(doc.createElement('p')); assert.equal(restore(), true); assert.equal(doc.activeElement, b); }
  // Focus outside the root: nothing happens, the fallback is not used.
  fb.focus(); restore = captureFocusState(root, { fallback: doc.body }); root.innerHTML = '<p>x</p>'; assert.equal(restore(), false); assert.equal(doc.activeElement, fb);
});

test('say(): a surface message on the status line keeps the controller\'s announcements in sync', t => {
  const u = setup(t);
  u.ds.begin({ user: true }); u.ds.succeed(); assert.equal(u.status.textContent, 'Instances updated');
  u.ds.say('release-manager is not in this workspace\'s souls.'); assert.equal(u.status.textContent, "release-manager is not in this workspace's souls.");
  u.ds.begin({ user: true }); u.ds.succeed(); assert.equal(u.status.textContent, 'Instances updated', 'the completion is shown (and announced) again');
});

test('captureFocusState restores focus by data-focus-key or by structural path after a rebuild, and the scroll position', t => {
  const dom = new JSDOM('<body><div class="root"><section><button>a</button><button data-focus-key="b">b</button></section><section><details><summary>s</summary></details></section></div></body>', { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document, root = doc.querySelector('.root');
  const rebuild = () => { root.innerHTML = '<section><button>a2</button><button data-focus-key="b">b2</button></section><section><details><summary>s2</summary></details></section>'; };
  root.querySelector('[data-focus-key="b"]').focus(); let restore = captureFocusState(root); rebuild();
  assert.equal(restore(), true); assert.equal(doc.activeElement.textContent, 'b2');
  root.querySelector('summary').focus(); restore = captureFocusState(root); rebuild();
  assert.equal(restore(), true); assert.equal(doc.activeElement.textContent, 's2');
  doc.activeElement.blur(); restore = captureFocusState(root); rebuild(); assert.equal(restore(), false);
  root.querySelector('button').focus(); restore = captureFocusState(root); root.innerHTML = '<p>gone</p>'; assert.equal(restore(), false);
  root.innerHTML = '<section><button>a</button></section>'; root.querySelector('button').focus(); restore = captureFocusState(root); rebuild();
  assert.equal(restore(), false, 'an unkeyed button is not re-found by path');
});

test('loading.css: skeleton fills derive from tokens, the shimmer is slow, reduced motion stops every animation, no opacity over text, no raw text colours', () => {
  const css = readFileSync(new URL('../renderer/loading.css', import.meta.url), 'utf8');
  assert.match(css, /\.skeleton \{[^}]*color-mix\(in srgb, var\(--fg\) \d+%, transparent\)/);
  const shimmer = /animation: oats-shimmer ([\d.]+)s/.exec(css); assert.ok(shimmer); assert.ok(Number(shimmer[1]) >= 1.4, 'a gentle shimmer (≥ 1.4s)');
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(reduced); assert.match(reduced, /\.skeleton::after \{[^}]*animation: none/); assert.match(reduced, /\.spinner[^{]*\{[^}]*animation: none !important/);
  assert.doesNotMatch(css, /opacity/, 'state by colour tokens, never opacity compositing');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /color:\s*#|color:\s*rgb/, 'text colours come from tokens');
  const html = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="loading.css" \/>/);
});

test('cancel: a superseded or abandoned read drops the pending visuals and the busy mark silently, back to the settled state', t => {
  const u = setup(t); u.ds.bindRefresh(u.one('.refresh'));
  u.ds.begin(); u.c.advance(PENDING_DELAY_MS); assert.equal(u.all('.skeleton-roster-row').length, 5);
  u.ds.cancel();
  assert.equal(u.ds.state, 'idle'); assert.equal(u.ds.busy, false); assert.equal(u.all('.skeleton').length, 0);
  assert.equal(u.region.hasAttribute('aria-busy'), false); assert.equal(u.status.textContent, ''); assert.equal(u.c.pending(), 0);
  u.ds.begin(); u.ds.succeed({ empty: true }); u.ds.begin(); u.c.advance(REFRESHING_DELAY_MS); assert.ok(u.one('.loading-refreshing'));
  assert.equal(u.one('.refresh').getAttribute('aria-disabled'), 'true');
  u.ds.cancel();
  assert.equal(u.ds.state, 'empty'); assert.equal(u.one('.loading-refreshing'), null); assert.equal(u.one('.refresh').hasAttribute('aria-disabled'), false);
  u.ds.begin(); u.ds.fail(new Error('x')); u.ds.begin(); u.ds.cancel();
  assert.equal(u.ds.state, 'stale'); assert.ok(u.one('.loading-notice[data-kind="stale"]'), 'the stale line stays');
  u.ds.cancel(); assert.equal(u.ds.state, 'stale', 'idempotent when nothing is in flight');
});

test('failedHost: null keeps the state, aria-busy and the announcement but paints no failed block (a surface with its own failure notice)', t => {
  const u = setup(t, { failedHost: null });
  u.ds.begin(); u.c.advance(PENDING_DELAY_MS); u.ds.fail(Object.assign(new Error('down'), { code: 'E_X' }));
  assert.equal(u.ds.state, 'failed'); assert.equal(u.one('.loading-failed'), null); assert.equal(u.all('.skeleton').length, 0);
  assert.equal(u.status.textContent, "Couldn't refresh instances. down");
  u.ds.begin(); u.c.advance(PENDING_DELAY_MS);
  assert.equal(u.all('.skeleton-roster-row').length, 5, 'without a kept block, the retry shows the skeleton again');
});

test('defer: a read that settled without an observation stays pending without a skeleton; later begins add nothing and re-announce nothing', t => {
  const u = setup(t);
  u.ds.begin(); u.ds.defer();
  assert.equal(u.ds.state, 'pending'); assert.equal(u.ds.busy, false); assert.equal(u.region.getAttribute('aria-busy'), 'true');
  assert.equal(u.status.textContent, 'Loading instances…'); u.c.advance(PENDING_DELAY_MS * 3); assert.equal(u.all('.skeleton').length, 0);
  u.status.textContent = 'sentinel'; u.ds.begin(); u.c.advance(PENDING_DELAY_MS * 3);
  assert.equal(u.all('.skeleton').length, 0, 'no pill beside the surface\'s own copy'); assert.equal(u.status.textContent, 'sentinel', 'not announced again');
  u.ds.succeed({ empty: true }); assert.equal(u.ds.state, 'empty'); assert.equal(u.region.hasAttribute('aria-busy'), false);
  u.ds.begin(); u.ds.defer(); assert.equal(u.ds.state, 'empty', 'with data present defer is a cancel'); assert.equal(u.ds.busy, false);
});

test('the roster-row skeleton wears the real row classes, so shell.css owns its geometry; it is inert', t => {
  const doc = new JSDOM('').window.document; t.after(() => doc.defaultView.close());
  const row = skeleton(doc, 'roster-row');
  assert.ok(row.classList.contains('ctx-tree-row')); assert.equal(row.style.getPropertyValue('--depth'), '0');
  const inst = row.querySelector('.ctx-inst'); assert.ok(inst); assert.equal(inst.tagName, 'SPAN', 'not a button: nothing to focus or click');
  assert.ok(inst.querySelector('.skeleton-dot.ctx-dot')); assert.ok(inst.querySelector('.ctx-copy > .skeleton-name.ctx-name')); assert.ok(inst.querySelector('.ctx-copy > .skeleton-meta.ctx-repo-label'));
  const css = readFileSync(new URL('../renderer/loading.css', import.meta.url), 'utf8');
  const block = css.match(/\.skeleton-roster-row[^{]*\{[^}]*\}/g).join('\n');
  assert.doesNotMatch(block, /min-height|padding|gap/, 'no copied row pixels: the row classes decide');
  assert.match(block, /pointer-events: none/);
});

test('while the stale line or the failed block is visible the status line is announced but quiet (clipped, its box kept); pending and updated stay visible', t => {
  const u = setup(t);
  u.ds.begin(); assert.equal(u.status.classList.contains('loading-quiet'), false, '"Loading…" is shown');
  u.ds.fail(new Error('down')); assert.equal(u.status.textContent, "Couldn't refresh instances. down"); assert.equal(u.status.classList.contains('loading-quiet'), true, 'the failed block is the visible message');
  u.ds.begin({ user: true }); u.ds.succeed(); assert.equal(u.status.textContent, 'Instances updated'); assert.equal(u.status.classList.contains('loading-quiet'), false);
  u.ds.begin(); u.ds.fail(new Error('down')); assert.equal(u.status.classList.contains('loading-quiet'), true, 'the stale line is the visible message');
  u.ds.begin(); u.ds.succeed(); assert.equal(u.status.classList.contains('loading-quiet'), false);
  u.ds.begin(); u.ds.fail(new Error('down')); u.ds.reset(); assert.equal(u.status.classList.contains('loading-quiet'), false);
  // A surface's own message while stale must be seen: say() lifts the quiet mark; the next failure re-quiets.
  u.ds.begin(); u.ds.succeed(); u.ds.begin(); u.ds.fail(new Error('down')); assert.equal(u.status.classList.contains('loading-quiet'), true);
  u.ds.say('Running knowledge:status…'); assert.equal(u.status.textContent, 'Running knowledge:status…'); assert.equal(u.status.classList.contains('loading-quiet'), false, 'visible');
  u.ds.begin(); u.ds.fail(new Error('down again')); assert.equal(u.status.classList.contains('loading-quiet'), true); assert.equal(u.status.textContent, "Couldn't refresh instances.");
  const css = readFileSync(new URL('../renderer/loading.css', import.meta.url), 'utf8');
  assert.match(css, /\.loading-quiet \{ clip-path: inset\(50%\); \}/, 'clipped, not removed: the 1.5em box stays, so nothing shifts');
  assert.doesNotMatch(css, /loading-retry:focus-visible/, 'no per-component focus ring: the global :focus-visible rule covers every button');
});
