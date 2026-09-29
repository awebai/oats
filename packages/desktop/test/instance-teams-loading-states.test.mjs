// desktop/loading-states item 8: the context panel's Messaging (Teams) section — the header stays and the
// body carries the state: compact team-row skeletons after 150ms, a visible failed block with Retry
// (reads live), the card when the inspection lands, and a re-read when the instance's status identity
// changes. Timers run on a fake window clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createInstanceTeamsSection } from '../renderer/instance-teams.mjs';
import { instanceStatusIdentity } from '../renderer/instance-status-identity.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/teams/${name}.json`, import.meta.url), 'utf8'));
const HOME = fx('inspect-home').result.subject.home;
const instance = (extra = {}) => ({ instance: HOME.split('/').pop(), home: HOME, ...extra });
function clock(win) {
  let now = 1_000_000, seq = 0; const timers = new Map();
  win.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; };
  win.clearTimeout = id => { timers.delete(id); };
  return { advance(ms) { const until = now + ms; for (;;) { const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].fn(); } now = until; } };
}
function section(t, request) {
  const dom = new JSDOM('<body><section><div class="context-panel-section-head">Messaging</div></section></body>');
  const host = dom.window.document.querySelector('section'), calls = [], presence = [], timers = clock(dom.window);
  const s = createInstanceTeamsSection(host, { cli: () => ({ ok: true, operationsApi: 2 }), onPresence: p => presence.push(p),
    request: async (workspace, body) => { calls.push({ workspace, ...body }); return request(workspace, body); } });
  t.after(() => { s.dispose(); dom.window.close(); });
  return { host, s, calls, presence, timers, body: () => host.querySelector('.instance-teams-body'), status: () => host.querySelector('.instance-teams-status') };
}
const answer = (_ws, body) => body.action === 'inspect' ? fx('inspect-home').result : fx('teams-initial').result;

test('pending: the header stays (nothing prepended), the body is busy and says "Loading teams…", compact team rows as a skeleton after 150ms; the card replaces them', async t => {
  let release; const gate = new Promise(r => { release = r; });
  const u = section(t, async (ws, body) => { if (body.action === 'inspect') await gate; return answer(ws, body); });
  u.s.update({ active: true, workspace: 'A', instance: instance() }); await tick();
  assert.equal(u.host.firstElementChild.className, 'context-panel-section-head', 'the header keeps its place');
  assert.equal(u.presence.at(-1), true, 'the section shows while the read runs'); assert.equal(u.body().getAttribute('aria-busy'), 'true'); assert.equal(u.status().textContent, 'Loading teams…');
  assert.equal(u.body().querySelector('[data-skeleton]'), null); u.timers.advance(150);
  const sk = u.body().querySelector('[data-skeleton="team-rows"]'); assert.ok(sk); assert.equal(sk.textContent, ''); assert.equal(sk.getAttribute('aria-hidden'), 'true');
  assert.equal(sk.querySelectorAll('.teams-panel.is-compact .team-row').length, 3, 'rows wearing the card classes');
  release(); await tick(); await tick(); await tick();
  assert.equal(u.body().querySelector('[data-skeleton]'), null); assert.equal(u.body().getAttribute('aria-busy'), null);
  assert.ok(u.body().querySelector('.teams-panel [data-team-row="default"]'), 'the card in the body');
});

test('a failed inspection is visible: the cause, the code behind Details, Retry (reads live) — never a silent absence; no provider hides the section without a failure', async t => {
  let fail = true;
  const u = section(t, (ws, body) => { if (body.action === 'inspect' && fail) throw Object.assign(new Error('bridge down'), { code: 'E_BRIDGE' }); return answer(ws, body); });
  u.s.update({ active: true, workspace: 'A', instance: instance() }); await tick(); await tick();
  const failed = u.body().querySelector('.loading-failed'); assert.ok(failed); assert.equal(u.presence.at(-1), true);
  assert.equal(failed.querySelector('.loading-failed-message').textContent, 'bridge down'); assert.equal(failed.querySelector('.loading-failed-code').textContent, 'E_BRIDGE');
  assert.equal(u.status().textContent, "Couldn't refresh teams. bridge down");
  const retry = failed.querySelector('.loading-retry'); retry.focus(); fail = false; retry.click(); await tick(); await tick(); await tick();
  assert.equal(u.calls.filter(c => c.action === 'inspect').length, 2); assert.equal(u.calls.filter(c => c.action === 'inspect').at(-1).refresh, true, 'Retry reads live');
  assert.equal(u.body().querySelector('.loading-failed'), null); assert.ok(u.body().querySelector('.teams-panel [data-team-row="default"]')); assert.equal(u.status().textContent, 'Teams updated');
  const none = fx('inspect-home').result; for (const c of none.capabilities) if (c.layer === 'messaging') c.layer = null;
  const v = section(t, () => none); v.s.update({ active: true, workspace: 'A', instance: instance() }); await tick(); await tick();
  assert.equal(v.presence.at(-1), false); assert.equal(v.body().querySelector('.loading-failed'), null); assert.equal(v.body().getAttribute('aria-busy'), null);
});

test('the status identity: a restart or drift re-reads the same selection — the card refreshes its list; without a card the inspection runs again; renders that change nothing read nothing', async t => {
  const u = section(t, answer);
  const row = instance({ startedAt: '2026-09-29T10:00:00Z', running: true });
  u.s.update({ active: true, workspace: 'A', instance: row }); await tick(); await tick(); await tick();
  const reads = () => u.calls.filter(c => c.operation === 'messaging:teams').length, inspects = () => u.calls.filter(c => c.action === 'inspect').length;
  assert.equal(inspects(), 1); assert.equal(reads(), 1);
  for (let i = 0; i < 4; i++) u.s.update({ active: true, workspace: 'A', instance: { ...row } });
  await tick(); assert.equal(inspects(), 1); assert.equal(reads(), 1, 'an identical row reads nothing');
  const card = u.body().querySelector('.teams-panel');
  u.s.update({ active: true, workspace: 'A', instance: { ...row, startedAt: '2026-09-29T11:00:00Z' } }); await tick(); await tick(); await tick();
  assert.equal(inspects(), 1, 'the card is kept'); assert.equal(reads(), 2, 'its list is re-read'); assert.equal(u.body().querySelector('.teams-panel'), card);
  u.s.update({ active: true, workspace: 'A', instance: { ...row, startedAt: '2026-09-29T11:00:00Z', modules: [{ name: 'oats.aweb', status: 'moved' }] } }); await tick(); await tick(); await tick();
  assert.equal(reads(), 3, 'drift is a status change too');
  assert.notEqual(instanceStatusIdentity(row), instanceStatusIdentity({ ...row, soul: { commit: 'abc' } }), 'the soul source counts');
  assert.equal(instanceStatusIdentity(null), null);
});
