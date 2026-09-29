// desktop/loading-states, Phase A item 3: the soul inspector (the soul page and the instance
// sidebar) on the shared data-state model — header and actions at once, detail skeletons after
// 150ms (never for a fast reply, never a false empty), "Loading soul…" / "Loading instance…";
// a Refresh of the same subject keeps the frame, the content and the focused control, shows
// "Refreshing…" after 400ms and says "Soul updated"; an unchanged inspection is not repainted;
// a failed refresh goes stale (age + Retry, content kept); a failed first read is the failed
// block (cause, Details, Retry). On the soul page "Teams here" reads in parallel with inspect
// and has its own skeleton and failed block. Kernel captures: fixtures/workspace-v2/f7 (0.29.3)
// and fixtures/team-model-v2 (0.30 K1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSoulInspector, inspectorCSS } from '../renderer/soul-inspector.mjs';
import { setWorkspace, currentWorkspace } from '../renderer/views/common.mjs';
import { refreshCli, resetCliStateForTests } from '../renderer/views/cli-status.mjs';
import { soulTeamsData } from '../deployment-data.mjs';
import { PENDING_DELAY_MS, REFRESHING_DELAY_MS } from '../renderer/loading.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f7/${name}.json`, import.meta.url), 'utf8'));
const soul = fixture('inspect-soul').result, home = fixture('inspect-home').result, teamsRun = fixture('teams-initial').result;
const conflict = fixture('inspect-soul-conflict').error;
const soulTeamsDoc = soulTeamsData(JSON.parse(readFileSync(new URL('./fixtures/team-model-v2/soul-teams-show.json', import.meta.url), 'utf8')));
const agentsRoot = '/fixture/base/northwind-workspace/agents';
const soulSelection = { agent: { name: 'release-manager', agentsRoot, description: 'Ships the releases.' }, selector: { soul: 'release-manager', agentsRoot } };
const keyedSelection = { ...soulSelection, agent: { ...soulSelection.agent, key: 'release-manager' } };
const homeSelection = { instance: { instance: home.subject.instance, agentsRoot, home: home.subject.home }, selector: { home: home.subject.home } };
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const button = (root, text) => [...root.querySelectorAll('button')].find(b => b.textContent === text) ?? null;

/** A fake clock: timers fire in order when advanced; now() follows. */
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
  };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject, done: false }; };

/** The inspector with a controllable API: every request is a deferred, settled by the test in any order. */
function mount(t, { layout = 'sidebar', ...options } = {}) {
  const previous = currentWorkspace(); setWorkspace('/team');
  const dom = new JSDOM('<!doctype html><body><main class="oats-view"><aside hidden></aside><button id="outside">Outside</button></main></body>', { pretendToBeVisual: true });
  const doc = dom.window.document, el = doc.querySelector('aside'), c = clock(), calls = [], pending = [];
  const style = doc.createElement('style'); style.textContent = inspectorCSS; doc.head.append(style);
  const inspector = createSoulInspector(el, { layout, clock: c, ...options, ctx: { api: async (url, opts) => {
    const body = JSON.parse(opts.body), path = url.replace(/\?.*$/, ''); calls.push({ path, body });
    const request = deferred(); request.path = path; request.body = body; pending.push(request); return request.promise;
  } } });
  t.after(() => { inspector.dispose(); dom.window.close(); setWorkspace(previous); });
  const inspect = r => r.path === '/api/capabilities' && r.body.action === 'inspect';
  const teamsHere = r => r.path === '/api/workspace-soul-teams';
  const take = match => { const r = pending.find(x => !x.done && match(x)); assert.ok(r, 'a pending request to settle'); r.done = true; return r; };
  return {
    el, doc, c, calls, inspector, inspect, teamsHere,
    q: s => el.querySelector(s), all: s => [...el.querySelectorAll(s)],
    status: () => el.querySelector('.inspector-status'), content: () => el.querySelector('.inspector-content.inspector-main'),
    refresh: () => layout === 'page' ? el.querySelector('.page-bar-actions button[title="Inspect again"]') : button(el, 'Refresh'),
    open: (match = inspect) => pending.filter(r => !r.done && match(r)),
    resolve: async (value, match = inspect) => { take(match).resolve(structuredClone(value)); await tick(); },
    reject: async (error, match = inspect) => { take(match).reject(error); await tick(); },
  };
}
const refusal = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

test('a new soul: header, actions and Refresh at once; "Loading soul…", aria-busy, the skeleton at 150ms only; no false empty', async t => {
  const u = mount(t);
  void u.inspector.show(soulSelection);
  assert.equal(u.el.hidden, false); assert.equal(u.q('h2').textContent, 'release-manager');
  assert.ok(u.refresh(), 'Refresh is there before the reply'); assert.ok(u.q('.spawn-act'), 'the actions are there before the reply');
  assert.equal(u.q('.inspector-lede').textContent, 'Ships the releases.', 'roster-owned identity paints at once');
  assert.equal(u.status().textContent, 'Loading soul…'); assert.equal(u.status().getAttribute('role'), 'status');
  assert.doesNotMatch(u.el.textContent, /Loading…/, "the bare 'Loading…' is retired");
  assert.equal(u.content().getAttribute('aria-busy'), 'true'); assert.equal(u.content().childElementCount, 0, 'nothing changes before 150ms');
  assert.doesNotMatch(u.el.textContent, /did not report|No capabilities|Default team only|No default harness/, 'no empty copy while pending');
  u.c.advance(PENDING_DELAY_MS - 1); assert.equal(u.content().childElementCount, 0);
  u.c.advance(1);
  const block = u.content().querySelector('.skeleton-detail-sections');
  assert.ok(block); assert.equal(block.getAttribute('aria-hidden'), 'true');
  assert.equal(block.querySelectorAll('.skeleton-detail-section').length, 3, 'three sections, like Teams / Harness / Core capabilities');
  assert.equal(u.status().textContent, 'Loading soul…', 'said once');
  await u.resolve(soul);
  assert.equal(u.all('.skeleton').length, 0); assert.equal(u.content().hasAttribute('aria-busy'), false);
  assert.equal(u.status().textContent, '', 'a first load announces nothing on success');
  assert.deepEqual(u.all('h3.inspector-section').map(h => h.textContent).slice(0, 2), ['Teams', 'Harness']);
  assert.deepEqual(u.calls.at(-1).body, { action: 'inspect', selector: soulSelection.selector }, 'a first read is not a refresh');
});

test('a fast reply never flashes a skeleton; the status line keeps its reserved line', async t => {
  const u = mount(t);
  void u.inspector.show(soulSelection);
  u.c.advance(PENDING_DELAY_MS - 50);
  await u.resolve(soul);
  u.c.advance(10_000);
  assert.equal(u.all('.skeleton').length, 0); assert.equal(u.content().hasAttribute('aria-busy'), false);
  const style = u.doc.defaultView.getComputedStyle(u.status());
  assert.equal(u.status().textContent, ''); assert.equal(style.minHeight, '1.5em', 'empty, it still reserves its line: the content does not move when the data lands');
  assert.doesNotMatch(inspectorCSS, /\.inspector-status:empty/, 'no :empty collapse of the inspector status line');
});

test('an instance: "Loading instance…", the readiness host stays across a refresh, "Instance updated" after a user Refresh', async t => {
  const u = mount(t);
  void u.inspector.show(homeSelection);
  assert.equal(u.status().textContent, 'Loading instance…');
  const readiness = u.q('.inspector-readiness'); assert.ok(readiness);
  await u.resolve(home);
  assert.equal(u.all('h3.inspector-section')[0].textContent, 'Teams');
  const head = u.q('.inspector-head'), content = u.content();
  u.refresh().click();
  assert.equal(u.refresh().getAttribute('aria-disabled'), 'true'); assert.equal(u.refresh().disabled, false, 'aria-disabled, never disabled');
  assert.equal(u.q('.inspector-head'), head); assert.equal(u.q('.inspector-readiness'), readiness); assert.equal(u.content(), content, 'frame() did not run');
  assert.equal(u.calls.at(-1).body.refresh, true, 'a user Refresh asks for a fresh read');
  await u.resolve({ ...home, instance: { ...home.instance, createdAt: '2026-01-01T00:00:00.000Z' } });
  assert.equal(u.status().textContent, 'Instance updated'); assert.equal(u.refresh().hasAttribute('aria-disabled'), false);
});

test('Refresh keeps the head, the content nodes and the focused control; "Refreshing…" beside Refresh after 400ms; then "Soul updated" with focus restored', async t => {
  const u = mount(t);
  void u.inspector.show(soulSelection); await u.resolve(soul);
  const head = u.q('.inspector-head'), actions = u.q('.inspector-actions'), content = u.content(), first = content.firstElementChild;
  const summaries = content.querySelectorAll('summary'); assert.ok(summaries.length > 1);
  const focused = summaries[1]; focused.focus(); assert.equal(u.doc.activeElement, focused);
  u.refresh().click();
  assert.equal(u.calls.filter(u.inspect).length, 2); assert.equal(u.calls.at(-1).body.refresh, true);
  assert.equal(u.q('.inspector-head'), head); assert.equal(u.q('.inspector-actions'), actions); assert.equal(u.content(), content);
  assert.equal(content.firstElementChild, first, 'the content stays until the new data lands');
  assert.equal(u.doc.activeElement, focused, 'the focused control is untouched');
  assert.equal(u.status().textContent, '', 'no "Loading" while data is shown'); assert.equal(content.hasAttribute('aria-busy'), false);
  u.c.advance(PENDING_DELAY_MS); assert.equal(u.all('.skeleton').length, 0, 'no skeleton over content');
  assert.equal(u.q('.loading-refreshing'), null, 'nothing before 400ms');
  u.c.advance(REFRESHING_DELAY_MS - PENDING_DELAY_MS);
  const indicator = head.querySelector('.loading-refreshing');
  assert.equal(indicator.textContent, 'Refreshing…'); assert.equal(indicator.parentElement.nextElementSibling, u.refresh(), 'right before the Refresh control');
  u.refresh().click(); assert.equal(u.calls.filter(u.inspect).length, 2, 'a repeat activation while busy is ignored');
  const changed = structuredClone(soul); changed.souls[0].harness = 'claude';
  await u.resolve(changed);
  assert.equal(u.content(), content, 'the same content element'); assert.notEqual(content.firstElementChild, first, 'repainted from the new data');
  assert.equal(u.q('.loading-refreshing'), null); assert.equal(u.status().textContent, 'Soul updated');
  const again = content.querySelectorAll('summary')[1];
  assert.equal(u.doc.activeElement, again, 'focus lands on the same control of the repaint'); assert.notEqual(again, focused);
  assert.match([...content.querySelectorAll('dd')].map(d => d.textContent).join(' '), /Claude Code/);
});

test('an unchanged inspection is not repainted (a same-subject show is a refresh, not a new frame)', async t => {
  const u = mount(t);
  void u.inspector.show(soulSelection); await u.resolve(soul);
  const head = u.q('.inspector-head'), content = u.content(), children = [...content.children];
  void u.inspector.show({ ...soulSelection, agent: { ...soulSelection.agent } });
  assert.equal(u.q('.inspector-head'), head, 'the same subject keeps its frame');
  assert.equal(u.calls.at(-1).body.refresh, undefined, 'a background re-read is not a user refresh');
  await u.resolve({ ...soul, observedAt: new Date(u.c.now()).toISOString(), refreshing: false });
  assert.deepEqual([...content.children], children, 'identical data (a newer observedAt is not data): the DOM is untouched');
  assert.equal(u.status().textContent, '', 'a background success says nothing');
  void u.inspector.show({ agent: { name: 'other', agentsRoot }, selector: { soul: 'other', agentsRoot } });
  assert.notEqual(u.q('.inspector-head'), head, 'a different soul is a new frame'); assert.equal(u.status().textContent, 'Loading soul…');
});

test('a failed refresh with content goes stale: "Couldn\'t refresh soul · observed <age>" + Retry under the head, content kept, action rules untouched', async t => {
  const u = mount(t);
  void u.inspector.show(soulSelection);
  await u.resolve({ ...soul, observedAt: new Date(u.c.now() - 45_000).toISOString() });
  assert.equal(u.q('.loading-notice'), null, 'a fresh observation shows no age');
  const content = u.content(), children = [...content.children], head = u.q('.inspector-head');
  const disabledBefore = u.all('[data-launch], [data-files]').map(b => b.disabled);
  u.refresh().click();
  await u.reject(refusal('E_TIMEOUT', 'kernel: the inspection timed out'));
  const notice = u.q('.inspector-notice .loading-notice');
  assert.equal(head.nextElementSibling, notice.parentElement, 'right under the head');
  assert.equal(notice.dataset.kind, 'stale'); assert.equal(notice.title, 'kernel: the inspection timed out (E_TIMEOUT)'); assert.equal(notice.querySelector('.loading-notice-cause').textContent, 'kernel: the inspection timed out (E_TIMEOUT)', 'the cause is reachable through Details');
  assert.equal(notice.querySelector('.loading-notice-text').textContent, "Couldn't refresh soul · observed 45s ago");
  const retry = notice.querySelector('.loading-retry'); assert.equal(retry.textContent, 'Retry');
  assert.deepEqual([...content.children], children, 'the content is kept'); assert.equal(content.hasAttribute('aria-busy'), false);
  assert.equal(u.status().textContent, "Couldn't refresh soul."); assert.ok(u.status().classList.contains('error'));
  assert.deepEqual(u.all('[data-launch], [data-files]').map(b => b.disabled), disabledBefore, 'the existing disabling rules, nothing new');
  assert.equal(u.q('.loading-failed'), null, 'no failed block over content');
  retry.focus(); retry.click();
  assert.equal(u.calls.at(-1).body.refresh, true); assert.equal(retry.getAttribute('aria-disabled'), 'true'); assert.equal(retry.disabled, false);
  assert.equal(u.doc.activeElement, retry, 'a busy Retry keeps focus');
  await u.resolve(soul);
  assert.equal(u.q('.loading-notice'), null); assert.equal(u.status().textContent, 'Soul updated');
  assert.equal(u.doc.activeElement, u.refresh(), 'the vanished Retry hands focus to Refresh');
});

test('a failed first read is the failed block where the skeleton stood: the cause, Details with the code, Retry; E_TEAM_CONFLICT lists its labels after it', async t => {
  const u = mount(t);
  void u.inspector.show(soulSelection);
  u.c.advance(PENDING_DELAY_MS); assert.ok(u.q('.skeleton-detail-sections'));
  await u.reject(refusal('E_TEAM_CONFLICT', conflict.message, { labels: ['engineering', 'global'] }));
  assert.equal(u.q('.skeleton'), null); assert.equal(u.content().hasAttribute('aria-busy'), false);
  const failed = u.content().querySelector('.loading-failed'); assert.ok(failed);
  assert.equal(failed.querySelector('.loading-failed-message').textContent, conflict.message);
  assert.equal(failed.querySelector('.loading-failed-details summary').textContent, 'Details');
  assert.equal(failed.querySelector('.loading-failed-code').textContent, 'E_TEAM_CONFLICT');
  assert.equal(failed.nextElementSibling.textContent, 'Team labels in conflict: engineering, global');
  assert.equal(u.status().textContent, `Couldn't refresh soul. ${conflict.message}`); assert.ok(u.status().classList.contains('error'));
  assert.equal(u.q('.loading-notice'), null, 'no stale line without data');
  const retry = failed.querySelector('.loading-retry'); retry.focus(); retry.click();
  assert.equal(u.calls.filter(u.inspect).length, 2); assert.equal(u.calls.at(-1).body.refresh, true);
  u.c.advance(PENDING_DELAY_MS); assert.equal(u.q('.skeleton'), null, 'a retry keeps the block (its Retry is focused), no skeleton beside it');
  assert.equal(u.content().querySelector('.loading-failed'), failed);
  await u.reject(refusal('E_TEAM_CONFLICT', conflict.message, { labels: ['engineering', 'global'] }));
  assert.equal(u.content().querySelector('.loading-failed'), failed, 'updated in place'); assert.equal(u.all('.inspector-conflict-labels').length, 1, 'the labels once');
  assert.equal(u.doc.activeElement, retry);
  retry.click(); await u.resolve(soul);
  assert.equal(u.q('.loading-failed'), null); assert.equal(u.q('.inspector-conflict-labels'), null);
  assert.deepEqual(u.all('h3.inspector-section').map(h => h.textContent).slice(0, 2), ['Teams', 'Harness']);
  assert.equal(u.status().textContent, 'Soul updated'); assert.equal(u.doc.activeElement, u.refresh());
});

test('an unreadable inspection (operationsApi 1) is a failure with the existing sentence, not a skeleton forever', async t => {
  const u = mount(t);
  void u.inspector.show(soulSelection);
  await u.resolve({ operationsApi: 1 });
  assert.match(u.q('.loading-failed-message').textContent, /classic layout/); assert.match(u.status().textContent, /classic layout/);
  assert.equal(u.content().hasAttribute('aria-busy'), false);
});

test('a superseded read paints nothing: a new subject during a pending read, the old reply is dropped', async t => {
  const u = mount(t);
  void u.inspector.show(soulSelection);
  const old = u.open()[0];
  void u.inspector.show(homeSelection);
  assert.equal(u.status().textContent, 'Loading instance…');
  old.done = true; old.resolve(structuredClone(soul)); await tick();
  assert.equal(u.status().textContent, 'Loading instance…', 'still pending: the soul reply was not this subject\'s');
  assert.equal(u.content().childElementCount, 0);
  await u.resolve(home);
  assert.equal(u.q('h2').textContent, home.subject.instance);
});

// The soul page (layout 'page') with kernel feature team-model-2: "Teams here" is created with the
// frame, so its `oats soul teams` read runs beside `inspect`; it has its own skeleton and failed block.
const withTeamModel2 = async t => {
  t.after(() => resetCliStateForTests());
  await refreshCli({ api: async () => ({ ...fixture('version'), features: [...fixture('version').features, 'team-model-2'], ok: true, bin: '/fixture/bin/oats' }) });
};
test('soul page: the soul teams read is dispatched before inspect answers; main and side skeletons; the card is kept, not recreated', async t => {
  await withTeamModel2(t);
  const u = mount(t, { layout: 'page' });
  void u.inspector.show(keyedSelection);
  assert.deepEqual(u.calls.map(c => [c.path, c.body.action]).sort(), [['/api/capabilities', 'inspect'], ['/api/workspace-soul-teams', 'show']], 'both reads in flight at once');
  assert.deepEqual(u.calls.find(u.teamsHere).body, { soul: 'release-manager', action: 'show' });
  const card = u.q('[data-card="Teams here"]'); assert.ok(card, 'the card is there before either reply');
  assert.equal(card.parentElement, u.q('.soul-page-side')); assert.equal(card.previousElementSibling, null, 'first in the side column');
  assert.equal(u.status().textContent, 'Loading soul…');
  assert.equal(u.q('.page-main > .inspector-notice'), u.status().nextElementSibling, 'the stale line has its place above the content');
  assert.equal(card.querySelector('.sth-body').getAttribute('aria-busy'), 'true');
  assert.doesNotMatch(card.textContent, /Reading the teams/, "'Reading …' is retired");
  u.c.advance(PENDING_DELAY_MS);
  assert.equal(u.content().querySelectorAll('.skeleton-detail-section').length, 2, 'the main column: two sections');
  const sideSkeleton = u.q('.soul-page-side .skeleton-page-card'); assert.ok(sideSkeleton, 'the side column: a card skeleton');
  assert.equal(sideSkeleton.previousElementSibling, card, 'after the Teams here card');
  assert.equal(card.querySelectorAll('.skeleton-lines .skeleton-line').length, 3, "the card's own skeleton");
  await u.resolve({ status: 'ok', soulTeams: soulTeamsDoc }, u.teamsHere);
  assert.equal(card.querySelector('.skeleton'), null); assert.equal(card.querySelector('.sth-body').hasAttribute('aria-busy'), false);
  assert.equal(card.querySelector('.sth-default').textContent, "Default: mine (the workspace's default on this computer)");
  assert.ok(u.q('.skeleton-page-card'), 'inspect still pending: the side skeleton stays');
  await u.resolve(soul);
  assert.equal(u.q('.skeleton'), null); assert.equal(u.q('[data-card="Teams here"]'), card, 'the same card instance');
  assert.equal(u.q('[data-card="Teams"]'), null); assert.equal(u.q('.soul-page-side').firstElementChild, card);
  assert.equal(u.calls.filter(u.teamsHere).length, 1, 'inspect landing does not re-read the teams');
  // A user Refresh refreshes both; the card and its rows stay.
  const rows = card.querySelectorAll('.sth-row').length; assert.ok(rows > 0);
  u.refresh().click();
  // Both re-read; only the capabilities route takes the refresh hint (the soul-teams route admits no extra key).
  assert.deepEqual(u.calls.slice(-2).map(c => [c.path, c.body.refresh]).sort(), [['/api/capabilities', true], ['/api/workspace-soul-teams', undefined]], 'both re-read, as user refreshes');
  assert.equal(u.q('[data-card="Teams here"]'), card); assert.equal(card.querySelectorAll('.sth-row').length, rows, 'the rows are kept');
  assert.ok([...card.querySelectorAll('button.sth-act')].every(b => b.disabled), 'its actions lock meanwhile, as before');
  await u.resolve({ status: 'ok', soulTeams: soulTeamsDoc }, u.teamsHere); await u.resolve(soul);
  assert.equal(card.querySelectorAll('.sth-row').length, rows); assert.ok([...card.querySelectorAll('button.sth-act')].every(b => !b.disabled));
  assert.equal(u.status().textContent, 'Soul updated');
});

test('soul page: "Teams here" failing with no document is the failed block (cause, Details, Retry → show again)', async t => {
  await withTeamModel2(t);
  const u = mount(t, { layout: 'page' });
  void u.inspector.show(keyedSelection);
  const card = u.q('[data-card="Teams here"]');
  u.c.advance(PENDING_DELAY_MS); assert.ok(card.querySelector('.skeleton-lines'));
  await u.resolve({ status: 'refused', reason: { code: 'E_SOUL_UNKNOWN', message: 'no soul release-manager here' } }, u.teamsHere);
  assert.equal(card.querySelector('.skeleton'), null);
  const failed = card.querySelector('.loading-failed'); assert.ok(failed);
  assert.equal(failed.querySelector('.loading-failed-message').textContent, 'no soul release-manager here');
  assert.equal(failed.querySelector('.loading-failed-code').textContent, 'E_SOUL_UNKNOWN');
  assert.equal(card.querySelector('.sth-error'), null, 'not the row problem box');
  assert.equal(card.querySelector('.loading-status').textContent, "Couldn't refresh teams. no soul release-manager here");
  failed.querySelector('.loading-retry').click();
  assert.deepEqual(u.calls.at(-1).body, { soul: 'release-manager', action: 'show' }, 'the soul-teams route admits no refresh hint (server/teams.mjs keysOnly)');
  await u.resolve({ status: 'ok', soulTeams: soulTeamsDoc }, u.teamsHere);
  assert.equal(card.querySelector('.loading-failed'), null); assert.ok(card.querySelector('.sth-row'));
  assert.equal(card.querySelector('.loading-status').textContent, 'Teams updated');
  await u.resolve(soul);
  assert.equal(u.q('[data-card="Teams here"]'), card);
});

test('soul page: a failed inspect with content goes stale above the content; the page\'s Teams here card stays', async t => {
  await withTeamModel2(t);
  const u = mount(t, { layout: 'page' });
  void u.inspector.show(keyedSelection);
  await u.resolve({ status: 'ok', soulTeams: soulTeamsDoc }, u.teamsHere);
  await u.resolve({ ...soul, observedAt: new Date(u.c.now() - 3 * 60_000).toISOString() });
  const notice = u.q('.page-main > .inspector-notice .loading-notice');
  assert.ok(notice, 'older than 2 min: the observed age shows'); assert.equal(notice.dataset.kind, 'observed'); assert.equal(notice.textContent, 'Observed 3 min ago');
  const card = u.q('[data-card="Teams here"]'), content = u.content(), children = [...content.children];
  u.refresh().click();
  await u.resolve({ status: 'ok', soulTeams: soulTeamsDoc }, u.teamsHere);
  await u.reject(refusal('E_TIMEOUT', 'timed out'));
  const stale = u.q('.page-main > .inspector-notice .loading-notice');
  assert.equal(stale.dataset.kind, 'stale'); assert.equal(stale.querySelector('.loading-notice-text').textContent, "Couldn't refresh soul · observed 3 min ago");
  assert.deepEqual([...content.children], children); assert.equal(u.q('[data-card="Teams here"]'), card);
  assert.equal(u.status().textContent, "Couldn't refresh soul.");
});

test('CLI and deployment states keep their own copy: no CLI is said on the status line, no skeleton', async t => {
  const u = mount(t, { available: () => false });
  void u.inspector.show(soulSelection);
  u.c.advance(PENDING_DELAY_MS);
  assert.match(u.status().textContent, /operations API 2/); assert.equal(u.q('.skeleton'), null); assert.equal(u.content().hasAttribute('aria-busy'), false);
  assert.deepEqual(u.calls, [], 'nothing asked');
});
