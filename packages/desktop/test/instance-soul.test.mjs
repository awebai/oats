import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createInstanceSoulSection } from '../renderer/instance-soul.mjs';

// Workspace v4 (W6): the context panel's Soul tab — the soul as this instance was
// spawned from it, from one `oats inspect --home` read per selection.
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const fx = () => JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/teams/inspect-home.json', import.meta.url), 'utf8'));
const HOME = fx().result.subject.home;
const instance = (home = HOME) => ({ instance: home.split('/').pop(), home, agentsRoot: '/r/agents' });
function clock(win) {
  let now = 1_000_000, seq = 0; const timers = new Map();
  win.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; };
  win.clearTimeout = id => { timers.delete(id); };
  return { advance(ms) { const until = now + ms; for (;;) { const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].fn(); } now = until; } };
}
function section(t, request, cli = () => ({ ok: true, operationsApi: 2, features: [] })) {
  // The host is the section's body under the roster header, as context-panel.mjs mounts it (the header is not the section's).
  const dom = new JSDOM('<body><div class="context-panel-identity"><span class="context-panel-identity-name">release-manager-teams</span></div><section></section></body>');
  const host = dom.window.document.querySelector('section'), calls = [], presence = [], timers = clock(dom.window);
  const s = createInstanceSoulSection(host, { cli, onPresence: p => presence.push(p),
    request: async (workspace, body) => { calls.push({ workspace, ...body }); return request(workspace, body); } });
  t.after(() => { s.dispose(); dom.window.close(); });
  return { host, s, calls, presence, timers, doc: dom.window.document, status: () => host.querySelector('.soul-tab-status') };
}

test('one read per selection renders the meta line, the three core slots and the other capabilities with why each is here — under the roster header, which stays', async t => {
  const u = section(t, () => fx().result);
  u.s.update({ active: true, workspace: 'A', instance: instance() }); await tick(); await tick();
  assert.deepEqual(u.calls.map(c => [c.workspace, c.action, c.selector]), [['A', 'inspect', { home: HOME }]]);
  assert.equal(u.presence.at(-1), true);
  assert.equal(u.host.querySelector('.soul-tab-head'), null, 'no header of its own: the roster-derived one above stays put');
  assert.equal(u.doc.querySelector('.context-panel-identity').hidden, false);
  assert.equal(u.host.firstElementChild.className, 'loading-status loading-sr soul-tab-status', 'nothing is prepended above the body');
  assert.match(u.host.querySelector('.soul-tab-meta').textContent, /agents/);
  const core = [...u.host.querySelectorAll('.soul-tab-core-row')];
  assert.deepEqual(core.map(r => r.dataset.layer), ['knowledge', 'messaging', 'tasks']);
  assert.match(core[0].textContent, /oats\.okf/); assert.match(core[1].textContent, /oats\.aweb/);
  assert.match(core[2].textContent, /None/, 'an empty slot says so');
  const caps = Object.fromEntries([...u.host.querySelectorAll('.soul-tab-cap')].map(r => [r.dataset.capability, r.querySelector('.soul-tab-tag')?.textContent]));
  assert.equal(caps['nw-release-tooling'], 'soul', 'declared by the soul');
  assert.equal(caps['nw-deploy'], 'soul');
  assert.equal(caps['nw-house-style'], 'default', 'not declared: a default the kernel resolved');
  assert.equal(caps['oats.okf'], undefined, 'core providers are not listed twice');
  for (let i = 0; i < 3; i++) u.s.update({ active: true, workspace: 'A', instance: instance() });
  await tick(); assert.equal(u.calls.length, 1, 'renders are frequent: one inspection per selection');
});

test('an inactive tab or a remote instance: no read; a failed first read is visible — the cause, its code behind Details, Retry (which reads live)', async t => {
  const a = section(t, () => fx().result);
  a.s.update({ active: false, workspace: 'A', instance: instance() }); await tick();
  a.s.update({ active: true, workspace: 'A', instance: { ...instance(), server: 'remote' } }); await tick();
  assert.equal(a.calls.length, 0); assert.equal(a.host.getAttribute('aria-busy'), null);
  let fail = true;
  const b = section(t, () => { if (fail) throw Object.assign(new Error('bridge down'), { code: 'E_BRIDGE' }); return fx().result; });
  b.s.update({ active: true, workspace: 'A', instance: instance() }); await tick(); await tick();
  assert.equal(b.host.querySelector('.soul-tab'), null);
  const failed = b.host.querySelector('.loading-failed'); assert.ok(failed, 'failure is visible');
  assert.equal(failed.querySelector('.loading-failed-message').textContent, 'bridge down'); assert.equal(failed.querySelector('.loading-failed-code').textContent, 'E_BRIDGE');
  assert.equal(b.status().textContent, "Couldn't refresh soul. bridge down"); assert.equal(b.presence.at(-1), true, 'the body shows something');
  const retry = failed.querySelector('.loading-retry'); retry.focus(); fail = false; retry.click(); await tick(); await tick();
  assert.deepEqual(b.calls.at(-1).refresh, true, 'Retry reads live'); assert.equal(b.calls.length, 2);
  assert.ok(b.host.querySelector('.soul-tab')); assert.equal(b.host.querySelector('.loading-failed'), null); assert.equal(b.status().textContent, 'Soul updated');
});

test('pending: aria-busy and "Loading soul…" at once, the body skeleton (the sections\' rows, real classes) after 150ms, none for a fast reply', async t => {
  let release; const gate = new Promise(r => { release = r; });
  const u = section(t, async () => { await gate; return fx().result; });
  u.s.update({ active: true, workspace: 'A', instance: instance() }); await tick();
  assert.equal(u.host.getAttribute('aria-busy'), 'true'); assert.equal(u.status().textContent, 'Loading soul…');
  assert.equal(u.host.querySelector('[data-skeleton]'), null); u.timers.advance(150);
  const sk = u.host.querySelector('[data-skeleton="soul-tab"]'); assert.ok(sk); assert.equal(sk.getAttribute('aria-hidden'), 'true'); assert.equal(sk.textContent, '');
  assert.equal(sk.querySelectorAll('.soul-tab-core-row').length, 3); assert.equal(sk.querySelectorAll('.soul-tab-cap').length, 3);
  release(); await tick(); await tick();
  assert.equal(u.host.querySelector('[data-skeleton]'), null); assert.equal(u.host.getAttribute('aria-busy'), null); assert.ok(u.host.querySelector('.soul-tab'));
  const v = section(t, () => fx().result);
  v.s.update({ active: true, workspace: 'A', instance: instance() }); await tick(); await tick();
  assert.equal(v.host.querySelector('[data-skeleton]'), null, 'a fast reply never flashes a skeleton');
});

test('the instance\'s status identity changing (a restart, drift) re-reads the same selection as a refresh: content kept, then replaced; a failed re-read is stale with Retry', async t => {
  let reply = () => fx().result;
  const u = section(t, () => reply());
  const row = instance();
  u.s.update({ active: true, workspace: 'A', instance: { ...row, startedAt: '2026-09-29T10:00:00Z' } }); await tick(); await tick();
  const first = u.host.querySelector('.soul-tab'); assert.ok(first); assert.equal(u.calls.length, 1);
  for (let i = 0; i < 3; i++) u.s.update({ active: true, workspace: 'A', instance: { ...row, startedAt: '2026-09-29T10:00:00Z', running: true } });
  await tick(); assert.equal(u.calls.length, 2, 'running flipping is a status change: one re-read'); assert.equal(u.host.querySelector('.soul-tab'), first, 'an identical inspection keeps its nodes');
  let release; const gate = new Promise(r => { release = r; });
  reply = async () => { await gate; const v = fx().result; v.capabilities = v.capabilities.filter(c => c.id !== 'nw-deploy'); return v; };
  u.s.update({ active: true, workspace: 'A', instance: { ...row, startedAt: '2026-09-29T11:00:00Z', running: true } }); await tick();
  assert.equal(u.calls.length, 3, 'a restart re-reads'); assert.equal(u.calls.at(-1).refresh, undefined, 'not a user refresh: no refresh flag');
  assert.equal(u.host.querySelector('.soul-tab'), first, 'the content stays while the re-read runs'); assert.equal(u.host.getAttribute('aria-busy'), null, 'refreshing is not busy');
  release(); await tick(); await tick();
  assert.notEqual(u.host.querySelector('.soul-tab'), first); assert.equal(u.host.querySelector('.soul-tab-cap[data-capability="nw-deploy"]'), null, 'the new resolution');
  reply = () => { throw Object.assign(new Error('bridge down'), { code: 'E_BRIDGE' }); };
  u.s.update({ active: true, workspace: 'A', instance: { ...row, startedAt: '2026-09-29T12:00:00Z', running: true } }); await tick(); await tick();
  assert.ok(u.host.querySelector('.soul-tab'), 'the content is kept');
  const line = u.host.querySelector('.soul-tab-notice .loading-notice[data-kind=stale]'); assert.ok(line);
  assert.equal(line.querySelector('.loading-notice-text').textContent, "Couldn't refresh soul"); assert.equal(line.querySelector('.loading-notice-cause').textContent, 'bridge down (E_BRIDGE)');
  assert.ok(line.querySelector('.loading-retry')); assert.equal(u.status().textContent, "Couldn't refresh soul."); assert.ok(u.status().classList.contains('loading-quiet'));
});

test('an inspection without the soul: nothing in the body (the roster header above stands), no failure, not busy', async t => {
  const u = section(t, () => { const v = fx().result; v.souls = []; return v; });
  u.s.update({ active: true, workspace: 'A', instance: instance() }); await tick(); await tick();
  assert.equal(u.host.querySelector('.soul-tab'), null); assert.equal(u.host.querySelector('.loading-failed'), null); assert.equal(u.host.getAttribute('aria-busy'), null);
  assert.equal(u.presence.at(-1), false);
});

test('a new selection drops the previous soul before its read lands', async t => {
  let release; const gate = new Promise(r => { release = r; });
  const u = section(t, async (_ws, body) => body.selector.home === HOME ? fx().result : (await gate, fx().result));
  u.s.update({ active: true, workspace: 'A', instance: instance() }); await tick(); await tick();
  assert.ok(u.host.querySelector('.soul-tab'));
  u.s.update({ active: true, workspace: 'A', instance: instance(`${HOME}-2`) });
  assert.equal(u.host.querySelector('.soul-tab'), null, 'no stale soul while the next read is in flight');
  release(); await tick(); await tick();
});
