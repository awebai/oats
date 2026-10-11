// Readiness loading states (desktop/loading-states, Phase A item 4): the first read of a
// subject is pending ("Loading readiness…", a detail-section skeleton after 150ms, never a
// false empty), a Refresh keeps the checks and the focused button (aria-disabled, never
// disabled) and shows "Refreshing…" after 400ms, a failure with a value goes stale (line with
// the observed age and Retry, checks kept), a failure without one paints the failed block
// where the skeleton stood, and a new subject resets. The summary has its own line, so the
// controller's announcements never overwrite it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createReadinessView, readinessCSS } from '../renderer/readiness-view.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { readinessFailure } from '../../client/readiness-contract.mjs';
import { PENDING_DELAY_MS, REFRESHING_DELAY_MS, AGE_TICK_MS } from '../renderer/loading.mjs';
import { createReadinessBoundary } from '../server/readiness.mjs';
import { cli, workspace, selector, target, data, view, envelope, deferred, tick } from './helpers/readiness-fixture.mjs';
import { assertIsolatedDetail, MESSY, MESSY_LINE } from './helpers/detail-line.mjs';

/** A fake clock for the controller's delays: timers fire in order when advanced; `now()` follows. */
function clock() {
  let now = Date.parse('2026-09-29T14:05:30.000Z'), seq = 0; const timers = new Map();
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
function setup(t, { compact = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><button id="other">Other</button><main></main>', { pretendToBeVisual: true }), doc = dom.window.document, host = doc.querySelector('main');
  const previous = currentWorkspace(); setWorkspace('team'); const c = clock(), calls = [], gates = [];
  const component = createReadinessView(host, { compact, clock: c, ctx: { api: (path, opts) => { calls.push(JSON.parse(opts.body)); const gate = deferred(); gates.push(gate); return gate.promise; } } });
  t.after(() => { component.dispose(); setWorkspace(previous); dom.window.close(); });
  return { doc, host, component, c, calls, gates, update: fields => component.update({ active: true, workspace, selector, cli, ...fields }),
    one: s => host.querySelector(s), all: s => [...host.querySelectorAll(s)], text: () => host.textContent,
    section: () => host.querySelector('.readiness-view'), status: () => host.querySelector('.readiness-status'), summary: () => host.querySelector('.readiness-summary') };
}
/** The captured document observed `agoMs` before the fake clock's now. */
const observed = (c, agoMs) => { const d = data(); d.at = new Date(c.now() - agoMs).toISOString(); return d; };
/** Settle a first read: update, resolve, tick. */
async function ready(u, value = view(target, observed(u.c, 5_000))) { void u.update(); u.gates.at(-1).resolve(value); await tick(); return u; }

test('first read: "Loading readiness…", aria-busy, no false empty, no "Reading"; the skeleton only after 150ms, sized like the checks; a fast reply never shows one', async t => {
  const u = setup(t); void u.update();
  assert.equal(u.status().textContent, 'Loading readiness…'); assert.doesNotMatch(u.text(), /Reading/);
  assert.equal(u.section().getAttribute('aria-busy'), 'true'); assert.equal(u.summary().textContent, '', 'no summary before data');
  assert.equal(u.one('.readiness-content').childElementCount, 0); assert.doesNotMatch(u.text(), /not established|No items|Ready —/);
  assert.equal(u.one('[data-skeleton]'), null, 'nothing before the delay');
  u.c.advance(PENDING_DELAY_MS - 1); assert.equal(u.one('[data-skeleton]'), null);
  u.c.advance(1);
  const skeleton = u.one('.readiness-view [data-skeleton="detail-sections"]');
  assert.ok(skeleton, 'a detail-section skeleton in the body at 150ms'); assert.equal(skeleton.getAttribute('aria-hidden'), 'true');
  assert.equal(skeleton.querySelectorAll('.skeleton-detail-section').length, 1); assert.match(skeleton.style.getPropertyValue('--skeleton-block-h'), /^\d+px$/);
  assert.equal(skeleton.parentElement, u.one('.readiness-content').parentElement, 'beside the content, never inside it');
  assert.equal(u.one('.readiness-refresh').getAttribute('aria-disabled'), 'true'); assert.equal(u.one('.readiness-refresh').disabled, false);
  u.gates[0].resolve(view(target, observed(u.c, 5_000))); await tick();
  assert.equal(u.one('[data-skeleton]'), null); assert.equal(u.section().hasAttribute('aria-busy'), false);
  assert.equal(u.status().textContent, '', 'a first load announces nothing on success'); assert.match(u.summary().textContent, /1 failing · 0 unknown · 7 required checks/);
  assert.equal(u.all('.readiness-check').length, 4); assert.equal(u.one('.readiness-refresh').hasAttribute('aria-disabled'), false);
  // fast: the reply lands inside the delay; no skeleton ever, no timer left.
  const v = setup(t); void v.update(); v.c.advance(PENDING_DELAY_MS - 50); v.gates[0].resolve(view(target, observed(v.c, 5_000))); await tick(); v.c.advance(10_000);
  assert.equal(v.one('[data-skeleton]'), null); assert.equal(v.c.pending(), 0); assert.equal(v.section().hasAttribute('aria-busy'), false);
});

test('compact (inspector): status and summary up front, the skeleton behind the disclosure; the failure message stays in the section text', async t => {
  const u = setup(t, { compact: true }); void u.update(); u.c.advance(PENDING_DELAY_MS);
  assert.equal(u.status().textContent, 'Loading readiness…'); assert.ok(u.one('.readiness-more [data-skeleton]'), 'the skeleton in the disclosed body');
  assert.deepEqual([...u.section().children].map(el => el.className), ['readiness-head', 'readiness-status', 'readiness-summary', 'readiness-notice', 'readiness-more', 'readiness-actions']);
  u.gates[0].reject(Object.assign(Error(), { code: 'E_CLI_TIMEOUT' })); await tick();
  assert.match(u.text(), /timed out/); assert.ok(u.one('.readiness-more .loading-failed'));
});

test('refresh keeps the checks and the focused Refresh (aria-disabled, never disabled); "Refreshing…" beside the title after 400ms; success updates in place and announces', async t => {
  const u = await ready(setup(t));
  const checks = u.one('.readiness-checks'), refresh = u.one('.readiness-refresh'); refresh.focus();
  refresh.click();
  assert.equal(u.calls.length, 2); assert.deepEqual(u.calls[1], { action: 'read', selector }, 'the readiness endpoint admits {action, selector} only');
  assert.equal(refresh.getAttribute('aria-disabled'), 'true'); assert.equal(refresh.disabled, false); assert.equal(u.doc.activeElement, refresh, 'focus survives');
  refresh.click(); assert.equal(u.calls.length, 2, 'a repeat activation while busy is ignored');
  assert.equal(u.one('.readiness-checks'), checks, 'content kept'); assert.match(u.summary().textContent, /1 failing/, 'the summary stays');
  assert.equal(u.section().hasAttribute('aria-busy'), false, 'refreshing is not pending'); assert.equal(u.status().textContent, '');
  assert.equal(u.one('.loading-refreshing'), null); assert.equal(u.one('[data-skeleton]'), null, 'no skeleton over data');
  u.c.advance(REFRESHING_DELAY_MS - 1); assert.equal(u.one('.loading-refreshing'), null);
  u.c.advance(1);
  const indicator = u.one('.readiness-head .readiness-indicator .loading-refreshing');
  assert.equal(indicator.textContent, 'Refreshing…'); assert.equal(indicator.previousElementSibling ?? indicator.parentElement.previousElementSibling, u.one('.readiness-view h2'), 'beside the title');
  // Unchanged facts: the reply repaints nothing (the observed note follows the new time).
  const again = view(target, observed(u.c, 1_000)); u.gates[1].resolve(again); await tick();
  assert.equal(u.one('.readiness-checks'), checks, 'identical data does not rebuild the DOM'); assert.match(u.one('.readiness-observed').textContent, new RegExp(`Observed: ${again.data.at}`));
  assert.equal(u.one('.loading-refreshing'), null); assert.equal(refresh.hasAttribute('aria-disabled'), false); assert.equal(u.doc.activeElement, refresh);
  assert.equal(u.status().textContent, 'Readiness updated', 'a user refresh announces its completion'); assert.match(u.summary().textContent, /1 failing/);
  // Changed facts: repaint, keeping the open disclosures and the focus inside the content.
  const policy = u.one('.readiness-policy'); policy.open = true; const item = u.one('.readiness-item'); item.open = true; item.querySelector('summary').focus();
  const changed = observed(u.c, 0); changed.checks.installed.items[0].remedy = 'a new remedy';
  refresh.click(); u.gates[2].resolve(view(target, changed)); await tick();
  assert.notEqual(u.one('.readiness-checks'), checks, 'changed data repaints'); assert.match(u.text(), /a new remedy/);
  assert.equal(u.one('.readiness-policy').open, true); assert.equal(u.one('.readiness-item').open, true);
  assert.equal(u.doc.activeElement, u.one('.readiness-item summary'), 'focus restored by path inside the content');
  // The host's refresh() is a person's ask too.
  void u.component.refresh(); u.gates[3].resolve(view(target, changed)); await tick(); assert.equal(u.status().textContent, 'Readiness updated');
});

test('failure with a value: stale line with the observed age and Retry under the status, checks kept, announced once; Retry recovers and hands focus to Refresh', async t => {
  const u = setup(t); await ready(u, view(target, observed(u.c, 45_000)));
  const checks = u.one('.readiness-checks');
  u.one('.readiness-refresh').click(); u.gates[1].reject(Object.assign(Error(), { code: 'E_CLI_TIMEOUT' })); await tick();
  const notice = u.one('.readiness-notice .loading-notice[data-kind="stale"]');
  assert.ok(notice, 'the stale line'); assert.equal(notice.querySelector('.loading-notice-text').textContent, "Couldn't refresh readiness · observed 45s ago");
  assert.equal(notice.title, `${readinessFailure('E_CLI_TIMEOUT').reason.message} (E_CLI_TIMEOUT)`, 'the cause travels with the line'); assert.equal(notice.querySelector('.loading-notice-cause').textContent, notice.title, 'and is reachable through Details');
  assert.equal(notice.parentElement.previousElementSibling, u.summary(), 'under the status and summary, above the body');
  assert.equal(u.one('.readiness-checks'), checks, 'last data kept'); assert.match(u.summary().textContent, /1 failing/);
  assert.equal(u.status().textContent, "Couldn't refresh readiness."); assert.equal(u.section().hasAttribute('aria-busy'), false);
  assert.equal(u.one('.loading-failed'), null, 'no failed block over data'); assert.equal(u.one('.readiness-refresh').disabled, false);
  const retry = notice.querySelector('button.loading-retry'); assert.equal(retry.textContent, 'Retry'); assert.equal(retry.disabled, false);
  retry.focus(); retry.click();
  assert.equal(u.calls.length, 3); assert.equal(retry.getAttribute('aria-disabled'), 'true'); assert.equal(u.one('.readiness-refresh').getAttribute('aria-disabled'), 'true');
  assert.equal(u.doc.activeElement, retry); retry.click(); assert.equal(u.calls.length, 3, 'repeat ignored while busy');
  // A second failure updates the line in place and does not re-announce.
  u.status().textContent = 'sentinel'; u.gates[2].reject(Object.assign(Error(), { code: 'E_CLI_FAILED' })); await tick();
  assert.equal(u.one('.loading-notice'), notice); assert.equal(u.status().textContent, 'sentinel'); assert.equal(u.doc.activeElement, retry);
  retry.click(); u.gates[3].resolve(view(target, observed(u.c, 0))); await tick();
  assert.equal(u.one('.loading-notice'), null); assert.equal(u.status().textContent, 'Readiness updated');
  assert.equal(u.doc.activeElement, u.one('.readiness-refresh'), 'the vanished Retry hands focus to Refresh');
  assert.equal(u.one('.readiness-checks'), checks, 'same facts, same nodes');
});

test("from the server: a host message with line breaks and a character of the set is one line, alone in its <bdi>, in the failed block and in the stale line's Details; the stale line's title never holds it, before or after an age tick", async t => {
  const u = setup(t); setWorkspace('remote:build:1');
  const remoteWs = { id: 'remote:build:1', name: 'Build box', remote: true, server: 'build' }, home = '/srv/agents/dev/instances/dev-1';
  const remoteSelector = { kind: 'instance', instance: 'dev-1', agent: 'dev', agentsRoot: '/srv/agents', server: 'build' };
  const refused = () => ({ schemaVersion: 1, ok: false, error: { code: 'E_SSH', message: MESSY } });
  let answer = refused;
  const server = createReadinessBoundary({ invoke: async (_bin, options) => answer(options) });
  const context = () => ({ cli: { ...structuredClone(cli), remote: ['readiness'] }, localCwd: '/Users/me/work', agents: [], workspace: { ...remoteWs, scope: '/srv' },
    instances: [{ instance: 'dev-1', agent: 'dev', agentsRoot: '/srv/agents', home, server: 'build', addressable: true, missingRemotely: false, running: true }] });
  /** The server's reply to the view's latest request. */
  const reply = async () => { u.gates.at(-1).resolve(await server(u.calls.at(-1), context)); await tick(); };
  // Nothing read yet: the failed block.
  void u.update({ workspace: remoteWs, selector: remoteSelector }); await reply();
  assert.equal(u.one('.loading-failed-message').textContent, "Couldn't reach Build box.");
  assertIsolatedDetail(u.one('.loading-failed-code'), { before: 'E_SSH: ', detail: MESSY_LINE });
  // A value, then the same refusal: the stale line.
  answer = options => { const d = data(options.target); d.at = new Date(u.c.now() - 45_000).toISOString(); return envelope(d); };
  void u.component.refresh(); await reply();
  assert.equal(u.all('.readiness-check').length, 4); assert.equal(u.one('.loading-failed'), null);
  answer = refused;
  void u.component.refresh(); await reply();
  const notice = u.one('.readiness-notice .loading-notice[data-kind="stale"]'), cause = notice.querySelector('.loading-notice-cause');
  const shown = { before: "Couldn't reach Build box. (E_SSH: ", detail: MESSY_LINE, after: ')' };
  assert.equal(notice.title, "Couldn't reach Build box. (E_SSH)", "the title is Desktop's sentence and the code");
  assert.equal(notice.querySelector('.loading-notice-details').hidden, false); assertIsolatedDetail(cause, shown);
  u.c.advance(AGE_TICK_MS);
  assert.match(notice.querySelector('.loading-notice-text').textContent, /observed 1 min ago$/, 'the age line was repainted');
  assert.equal(notice.title, "Couldn't reach Build box. (E_SSH)"); assertIsolatedDetail(cause, shown);
});

test('failure without a value: the failed block (cause, Details with the code, Retry) where the skeleton stood; the status says the message; Retry recovers', async t => {
  const u = setup(t); void u.update(); u.c.advance(PENDING_DELAY_MS); assert.ok(u.one('[data-skeleton]'));
  u.gates[0].reject(Object.assign(Error(), { code: 'E_CLI_TIMEOUT' })); await tick();
  const { message } = readinessFailure('E_CLI_TIMEOUT').reason, failed = u.one('.readiness-view .loading-failed');
  assert.ok(failed); assert.equal(u.one('[data-skeleton]'), null); assert.equal(u.section().hasAttribute('aria-busy'), false);
  assert.equal(failed.querySelector('.loading-failed-message').textContent, message); assert.equal(failed.querySelector('.loading-failed-code').textContent, 'E_CLI_TIMEOUT');
  assert.equal(failed.querySelector('details summary').textContent, 'Details'); assert.equal(failed.querySelector('.loading-retry').textContent, 'Retry');
  assert.equal(u.status().textContent, `Couldn't refresh readiness. ${message}`); assert.equal(u.summary().textContent, '', 'no summary without data');
  assert.equal(u.one('.readiness-notice .loading-notice'), null, 'no stale line without data'); assert.equal(u.one('.readiness-content').childElementCount, 0);
  const retry = failed.querySelector('.loading-retry'); retry.focus(); retry.click(); assert.equal(u.calls.length, 2);
  assert.equal(u.section().getAttribute('aria-busy'), 'true', 'a retry without data is pending again'); u.c.advance(PENDING_DELAY_MS + 1);
  assert.equal(u.one('.loading-failed'), failed, 'the block stays while its retry runs'); assert.equal(u.one('[data-skeleton]'), null, 'no skeleton beside it');
  assert.equal(u.doc.activeElement, retry);
  u.gates[1].resolve(view()); await tick();
  assert.equal(u.one('.loading-failed'), null); assert.equal(u.all('.readiness-check').length, 4); assert.match(u.summary().textContent, /1 failing/);
  assert.equal(u.status().textContent, 'Readiness updated'); assert.equal(u.doc.activeElement, u.one('.readiness-refresh'));
});

test('a new subject resets: content, summary, lines and announcement go, the next read is pending; a hidden view keeps its state', async t => {
  const u = await ready(setup(t));
  u.one('.readiness-refresh').click(); u.gates[1].reject(Error('x')); await tick(); assert.ok(u.one('.loading-notice'));
  void u.update({ selector: { kind: 'soul', soul: 'other', agentsRoot: '/team/agents' } });
  assert.equal(u.one('.loading-notice'), null); assert.equal(u.one('.readiness-content').childElementCount, 0); assert.equal(u.summary().textContent, '');
  assert.equal(u.status().textContent, 'Loading readiness…'); assert.equal(u.section().getAttribute('aria-busy'), 'true'); assert.equal(u.calls.length, 3);
  u.c.advance(PENDING_DELAY_MS); assert.ok(u.one('[data-skeleton]'));
  await u.update({ selector: { kind: 'soul', soul: 'other', agentsRoot: '/team/agents' }, active: false });
  assert.equal(u.section().hidden, true); u.gates[2].resolve(view()); await tick(); assert.equal(u.one('.readiness-content').childElementCount, 0, 'an abandoned read paints nothing');
});

test('data older than 2 min after a successful read is labelled "Observed <age>" (muted, no Retry); fresh data is not', async t => {
  const u = setup(t); await ready(u, view(target, observed(u.c, 3 * 60_000)));
  const line = u.one('.readiness-notice .loading-notice[data-kind="observed"]');
  assert.equal(line.textContent, 'Observed 3 min ago'); assert.equal(line.querySelector('.loading-retry'), null); assert.match(u.summary().textContent, /1 failing/);
  u.one('.readiness-refresh').click(); u.gates[1].resolve(view(target, observed(u.c, 0))); await tick(); assert.equal(u.one('.loading-notice'), null);
});

test('blocked states keep their copy: no skeleton, no aria-busy, the summary hidden, Refresh disabled since nothing can run', async t => {
  const u = setup(t); await u.update({ cli: null }); u.c.advance(PENDING_DELAY_MS + 1);
  assert.equal(u.status().textContent, readinessFailure('cli-unavailable').reason.message); assert.equal(u.one('[data-skeleton]'), null);
  assert.equal(u.section().hasAttribute('aria-busy'), false); assert.equal(u.summary().hidden, true); assert.equal(u.one('.readiness-refresh').disabled, true);
  assert.equal(u.calls.length, 0);
  // The CLI comes back: the button re-enables and the read is pending.
  void u.update(); assert.equal(u.one('.readiness-refresh').disabled, false); assert.equal(u.summary().hidden, false); assert.equal(u.status().textContent, 'Loading readiness…');
});

test('CSS: the status line keeps 1.5em while it speaks and collapses when silent; the summary reserves its line; muted text from tokens, no raw colours', () => {
  assert.match(readinessCSS, /\.readiness-status, \.readiness-summary \{ min-height:1\.5em; \}/);
  assert.match(readinessCSS, /\.readiness-status:empty \{ min-height:0; \}/);
  assert.match(readinessCSS, /\.readiness-summary[^}]*color:var\(--muted\)/);
  assert.doesNotMatch(readinessCSS, /opacity|color:\s*#|color:\s*rgb/);
});
