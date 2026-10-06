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
function section(t, request, cli = () => ({ ok: true, operationsApi: 2 })) {
  const dom = new JSDOM('<body><section><div class="context-panel-section-head">Messaging</div></section></body>');
  const host = dom.window.document.querySelector('section'), calls = [], presence = [], timers = clock(dom.window);
  const s = createInstanceTeamsSection(host, { cli, onPresence: p => presence.push(p),
    request: async (workspace, body) => { calls.push({ workspace, ...body }); return request(workspace, body); } });
  t.after(() => { s.dispose(); dom.window.close(); });
  return { host, s, calls, presence, timers, doc: dom.window.document, body: () => host.querySelector('.instance-teams-body'), status: () => host.querySelector('.instance-teams-status') };
}
const answer = (_ws, body) => body.action === 'inspect' ? fx('inspect-home').result : fx('teams-initial').result;

test('pending: the header stays (nothing prepended), the body is busy and says "Loading teams…", compact team rows as a skeleton after 150ms; the card replaces them', async t => {
  let release; const gate = new Promise(r => { release = r; });
  const u = section(t, async (ws, body) => { if (body.action === 'inspect') await gate; return answer(ws, body); });
  // The roster row reports a messaging address: the section may claim its place while the inspection runs.
  u.s.update({ active: true, workspace: 'A', instance: instance({ identityAddress: 'release-manager@oats.aweb.ai' }) }); await tick();
  assert.equal(u.host.firstElementChild.className, 'context-panel-section-head', 'the header keeps its place');
  assert.equal(u.presence.at(-1), true, 'the section shows while the read runs'); assert.equal(u.body().getAttribute('aria-busy'), 'true'); assert.equal(u.status().textContent, 'Loading teams…');
  assert.equal(u.body().querySelector('[data-skeleton]'), null); u.timers.advance(150);
  const sk = u.body().querySelector('[data-skeleton="team-rows"]'); assert.ok(sk); assert.equal(sk.textContent, ''); assert.equal(sk.getAttribute('aria-hidden'), 'true');
  assert.equal(sk.querySelectorAll('.teams-panel.is-compact .team-row').length, 3, 'rows wearing the card classes');
  release(); await tick(); await tick(); await tick();
  assert.equal(u.body().querySelector('[data-skeleton]'), null); assert.equal(u.body().getAttribute('aria-busy'), null);
  assert.ok(u.body().querySelector('.teams-panel [data-team-row="default"]'), 'the card in the body');
});

test('no messaging on the roster row and none in the inspection: the section never claims its place — not during the read, not on a restart (nothing under it shifts)', async t => {
  const none = fx('inspect-home').result; for (const c of none.capabilities) if (c.layer === 'messaging') c.layer = null;
  let release; const gate = new Promise(r => { release = r; });
  const u = section(t, async () => { await gate; return none; });
  const row = instance({ startedAt: '2026-09-29T10:00:00Z', running: true });
  u.s.update({ active: true, workspace: 'A', instance: row }); await tick();
  assert.equal(u.presence.includes(true), false, 'no claim while the inspection runs (the section stays hidden by its host)'); u.timers.advance(150);
  release(); await tick(); await tick(); assert.equal(u.presence.includes(true), false);
  u.s.update({ active: true, workspace: 'A', instance: { ...row, running: false } }); await tick(); await tick(); await tick();
  assert.equal(u.calls.filter(c => c.action === 'inspect').length, 2, 'a status change re-inspects'); assert.equal(u.presence.includes(true), false, 'and never claims the place either');
  // With a roster address but no provider in the inspection: a status-identity re-read does not claim the section again.
  const w = section(t, () => none);
  w.s.update({ active: true, workspace: 'A', instance: { ...row, identityAddress: 'x@oats.aweb.ai' } }); await tick(); await tick();
  assert.deepEqual(w.presence.filter(p => p), [true], 'claimed once, from the roster address, before the first answer');
  w.s.update({ active: true, workspace: 'A', instance: { ...row, identityAddress: 'x@oats.aweb.ai', startedAt: '2026-09-29T12:00:00Z' } }); await tick(); await tick();
  assert.deepEqual(w.presence.filter(p => p), [true], 'a restart after a no-provider answer never re-claims it');
  // A failed re-read of that subject is the failed block with Retry — never a header over an empty body.
  const v = section(t, (() => { let n = 0; return async () => { if (++n === 1) return none; throw Object.assign(new Error('bridge down'), { code: 'E_BRIDGE' }); }; })());
  v.s.update({ active: true, workspace: 'A', instance: row }); await tick(); await tick();
  assert.equal(v.presence.includes(true), false);
  v.s.update({ active: true, workspace: 'A', instance: { ...row, startedAt: '2026-09-29T11:00:00Z' } }); await tick(); await tick();
  assert.equal(v.presence.at(-1), true, 'a failure is shown'); const failed = v.body().querySelector('.loading-failed'); assert.ok(failed, 'the failed block, with Retry');
  assert.equal(failed.querySelector('.loading-failed-message').textContent, 'bridge down'); assert.ok(failed.querySelector('.loading-retry'));
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
  assert.ok(u.doc.activeElement?.classList.contains('context-panel-section-head'), 'the vanished Retry hands focus to the section head (the card\'s Refresh is held by its first read), never to <body>');
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

// #675: an instance on a registered server reads through the same route, by its deployment, server and home.
const REMOTE_CLI = () => ({ ok: true, operationsApi: 2, remote: ['operations'] });
const remoteRow = (extra = {}) => instance({ server: 'build', repoName: 'Build box', addressable: true, missingRemotely: false, savedRoute: false,
  deployment: { id: 'remote:g1' }, identityAddress: 'dev@oats.aweb.ai', ...extra });

test('a local row: identity and request as before (its workspace and { home }); the same home on a server is another subject', async t => {
  const u = section(t, answer);
  u.s.update({ active: true, workspace: 'A', instance: instance() }); await tick(); await tick(); await tick();
  assert.deepEqual(u.calls.filter(c => c.action === 'inspect'), [{ workspace: 'A', action: 'inspect', selector: { home: HOME } }]);
  const v = section(t, answer, REMOTE_CLI);
  v.s.update({ active: true, workspace: 'A', instance: instance() }); await tick(); await tick(); await tick();
  v.s.update({ active: true, workspace: 'A', instance: remoteRow() }); await tick(); await tick(); await tick();
  assert.equal(v.calls.filter(c => c.action === 'inspect').length, 2, 'two identities');
});

test('a remote addressable row with the feature: one inspect by its deployment and { home }, the card renders and its operations go through the same request; the same identity sends nothing more', async t => {
  const u = section(t, answer, REMOTE_CLI);
  u.s.update({ active: true, workspace: 'remote:g1', instance: remoteRow() }); await tick(); await tick(); await tick();
  const inspects = u.calls.filter(c => c.action === 'inspect');
  assert.deepEqual(inspects, [{ workspace: 'remote:g1', action: 'inspect', selector: { home: HOME } }]);
  assert.ok(u.body().querySelector('.teams-panel [data-team-row="default"]'), 'the card renders');
  const runs = u.calls.filter(c => c.action === 'run'); assert.ok(runs.length > 0, 'the card read its list');
  assert.ok(runs.every(c => c.workspace === 'remote:g1' && c.selector?.home === HOME), 'provider operations by the same deployment and home');
  const before = u.calls.length;
  for (let i = 0; i < 3; i++) u.s.update({ active: true, workspace: 'remote:g1', instance: remoteRow() });
  await tick(); await tick(); assert.equal(u.calls.length, before, 'one read per selection: no polling');
});

test('a remote row whose local CLI lacks remote operations: nothing is sent (Retry included); the section claims its place for the unroutable sentence', async t => {
  const u = section(t, answer, () => ({ ok: true, operationsApi: 2, remote: ['roster'] }));
  u.s.update({ active: true, workspace: 'remote:g1', instance: remoteRow({ identityAddress: null }) }); await tick();
  const failed = u.body().querySelector('.loading-failed'); assert.ok(failed);
  assert.equal(failed.querySelector('.loading-failed-message').textContent, "This computer's OATS can't route this to Build box. Update OATS here.");
  assert.equal(u.presence.at(-1), true, 'claimed, as a failure is');
  failed.querySelector('.loading-retry').click(); await tick();
  assert.equal(u.calls.length, 0, 'never sent');
});

test('a host E_REMOTE_INCOMPATIBLE refusal: the teams sentence naming the server and what to update; the code and the kernel message under Details', async t => {
  const reason = { code: 'E_REMOTE_INCOMPATIBLE', message: "Build box runs an OATS that can't do this yet.", detail: 'remote oats 0.30.0 lacks operations', remote: true };
  const u = section(t, () => { throw Object.assign(new Error('remote oats 0.30.0 lacks operations'), { code: 'E_REMOTE_INCOMPATIBLE', reason }); }, REMOTE_CLI);
  u.s.update({ active: true, workspace: 'remote:g1', instance: remoteRow() }); await tick(); await tick();
  const failed = u.body().querySelector('.loading-failed'); assert.ok(failed); assert.equal(u.presence.at(-1), true);
  assert.equal(failed.querySelector('.loading-failed-message').textContent,
    "Build box runs an OATS that can't show this instance's teams here (it needs the operations feature). Update OATS on Build box.");
  const code = failed.querySelector('.loading-failed-code');
  assert.equal(code.textContent, 'E_REMOTE_INCOMPATIBLE: remote oats 0.30.0 lacks operations');
  assert.equal(code.querySelector('bdi').textContent, 'remote oats 0.30.0 lacks operations');
  const ssh = { code: 'E_CLI_TIMEOUT', message: "Couldn't reach Build box.", detail: null, remote: true };
  const v = section(t, () => { throw Object.assign(new Error('timed out'), { code: 'E_CLI_TIMEOUT', reason: ssh }); }, REMOTE_CLI);
  v.s.update({ active: true, workspace: 'remote:g1', instance: remoteRow() }); await tick(); await tick();
  assert.equal(v.body().querySelector('.loading-failed-message').textContent, "Couldn't reach Build box.", 'another refusal: the relayed headline');
  assert.equal(v.body().querySelector('.loading-failed-code').textContent, 'E_CLI_TIMEOUT');
});

test('an unaddressable remote row: nothing is sent; its row sentence claims the place', async t => {
  const u = section(t, answer, REMOTE_CLI);
  u.s.update({ active: true, workspace: 'remote:g1', instance: remoteRow({ addressable: false }) }); await tick();
  assert.equal(u.calls.length, 0); assert.equal(u.presence.at(-1), true);
  assert.equal(u.body().querySelector('.loading-failed-message').textContent, 'Build box did not report this instance as reachable.');
});
