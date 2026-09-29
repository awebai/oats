/* Hierarchy (Active overview) loading states (desktop/loading-states, Phase A
   item 2): the shared controller drives the summary pill, aria-busy, the
   "Refreshing…" indicator and the status line; the view's own notice keeps the
   stale / failed copy. The controller's timers run on the view's window, so
   the tests install a fake clock on the JSDOM window and advance it: the
   150ms / 400ms delays are exact, never a race against a loaded machine. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as hierarchy from '../renderer/views/hierarchy.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
/** A fake clock on the JSDOM window: timers fire in order when advanced. */
function clock(win) {
  let now = 1_000_000, seq = 0; const timers = new Map();
  win.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; };
  win.clearTimeout = id => { timers.delete(id); };
  return { advance(ms) {
    const until = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = until;
  } };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const instance = (name = 'dev', fields = {}) => ({ instance: name, agent: 'soul', agentsRoot: '/team/agents', home: `/team/agents/soul/instances/${name}`, running: true, repoName: 'reported-repo', runtime: 'pi', branch: 'reported-branch', ...fields });
const panel = (instances = [instance()], id = currentWorkspace(), extra = {}) => ({ instances, workspace: { id }, workspaces: [{ id: '/team', name: 'Team' }, { id: '/other', name: 'Other' }], generatedAt: 'observation-time', ...extra });

async function setup(t, { api, instances } = {}) {
  const dom = new JSDOM('<body><main id="host"></main></body>', { url: 'http://localhost' });
  const doc = dom.window.document, host = doc.querySelector('main');
  const old = { window: globalThis.window, document: globalThis.document, setInterval: globalThis.setInterval, ws: currentWorkspace() };
  const polls = []; globalThis.window = dom.window; globalThis.document = doc; globalThis.setInterval = fn => { polls.push(fn); return 0; };
  const c = clock(dom.window);
  setWorkspace('/team');
  let read = api || (() => panel(instances));
  const ctx = { hasWorkspaceSwitcher: true, api: path => read(path), openTerminal() {}, startInstance() {}, restartInstance() {}, openView() {} };
  // Every skeleton that ever enters the summary is recorded, so "never" is provable for fast replies.
  const skeletons = [];
  const observer = new dom.window.MutationObserver(records => { for (const r of records) for (const n of r.addedNodes) if (n.dataset?.skeleton) skeletons.push(n); });
  const dispose = hierarchy.mount(host, ctx);
  observer.observe(host.querySelector('.hier-sum'), { childList: true });
  t.after(() => { observer.disconnect(); dispose(); setWorkspace(old.ws); globalThis.window = old.window; globalThis.document = old.document; globalThis.setInterval = old.setInterval; dom.window.close(); });
  const canvas = host.querySelector('.hier-canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 800 });
  const mouse = (target, type, fields = {}) => target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, button: 0, ...fields }));
  return { dom, doc, host, canvas, dispose, mouse, skeletons, c, wait: async ms => { c.advance(ms); await tick(); },
    one: selector => host.querySelector(selector), all: selector => [...host.querySelectorAll(selector)],
    nodes: () => [...host.querySelectorAll('.hnode')], root: () => host.querySelector('.hier'),
    sum: () => host.querySelector('.hier-sum'), pill: () => host.querySelector('.hier-sum .skeleton-pill[data-skeleton="pill"]'),
    status: () => host.querySelector('.hier-status').textContent, indicator: () => host.querySelector('.hier-refreshing .loading-refreshing'),
    notice: () => (host.querySelector('.hier-notice').hidden ? '' : host.querySelector('.hier-notice-message').textContent),
    setRead: value => { read = value; }, poll: () => polls[0](), retry: () => host.querySelector('.hier-retry').click() };
}

test('first load: no counts, no empty copy and no pill before 150ms; then the pill, aria-busy and one "Loading roster…"', async t => {
  const first = deferred(); const u = await setup(t, { api: () => first.promise });
  assert.equal(u.sum().textContent, '', 'the summary is blank, not "0 running"');
  assert.equal(u.one('.spinner'), null, 'the bare spinner is retired');
  assert.equal(u.one('.empty'), null); assert.equal(u.nodes().length, 0);
  assert.equal(u.root().getAttribute('aria-busy'), 'true');
  assert.equal(u.status(), 'Loading roster…');
  const status = u.one('.hier-status'); assert.equal(status.getAttribute('role'), 'status'); assert.ok(status.classList.contains('loading-sr'));
  assert.doesNotMatch(u.host.textContent, /Loading reported roster|Reading/);
  await u.wait(60); assert.equal(u.pill(), null, 'nothing changes before the delay');
  await u.wait(110);
  const pill = u.pill(); assert.ok(pill, 'the pill arrives after ~150ms'); assert.equal(pill.getAttribute('aria-hidden'), 'true');
  assert.equal(u.sum().textContent, '', 'the pill carries no text'); assert.equal(u.one('.empty'), null);
  first.resolve(panel([instance('a'), instance('b', { running: false })])); await tick();
  assert.equal(u.pill(), null); assert.match(u.sum().textContent, /1 running · 1 stopped/);
  assert.equal(u.root().hasAttribute('aria-busy'), false); assert.equal(u.status(), '', 'a background completion announces nothing');
  assert.equal(u.nodes().length, 2); assert.equal(u.notice(), '');
});

test('a fast reply never shows a pill; a successful zero read is the only empty state', async t => {
  const u = await setup(t, { instances: [] }); await tick();
  assert.ok(u.one('.empty'), 'a successful empty read paints the empty copy');
  assert.match(u.sum().textContent, /0 running · 0 stopped · 0 groups/);
  await u.wait(200);
  assert.deepEqual(u.skeletons, [], 'no skeleton ever entered the summary');
  assert.equal(u.root().hasAttribute('aria-busy'), false); assert.equal(u.status(), '');
});

test('a poll with data present refreshes in place: nodes and focus survive, "Refreshing…" only after 400ms, no aria-busy', async t => {
  const u = await setup(t, { instances: [instance('a'), instance('b')] }); await tick();
  const nodes = u.nodes(); u.mouse(nodes[0], 'click'); const pop = u.one('.hier-pop'), button = u.one('.pterm'); button.focus();
  const slow = deferred(); u.setRead(() => slow.promise); u.poll();
  assert.equal(u.indicator(), null); assert.equal(u.root().hasAttribute('aria-busy'), false); assert.equal(u.status(), '');
  assert.deepEqual(u.nodes(), nodes, 'the canvas is untouched while the read is in flight');
  await u.wait(200); assert.equal(u.indicator(), null, 'not yet');
  await u.wait(230);
  const indicator = u.indicator(); assert.ok(indicator, 'the indicator arrives after ~400ms'); assert.equal(indicator.textContent, 'Refreshing…');
  assert.ok(u.one('.hier-bar').contains(indicator), 'beside the summary in the bar');
  assert.equal(u.root().hasAttribute('aria-busy'), false); assert.equal(u.status(), '', 'background polls are silent');
  assert.equal(u.pill(), null); assert.equal(u.doc.activeElement, button);
  slow.resolve({ ...panel([instance('a'), instance('b')]), generatedAt: 'later' }); await tick();
  assert.equal(u.indicator(), null);
  assert.deepEqual(u.nodes(), nodes, 'an unchanged observation does not repaint');
  assert.equal(u.one('.hier-pop'), pop); assert.equal(u.doc.activeElement, button);
  assert.equal(u.status(), '');
});

test('a failed poll with data goes stale: content kept, the view notice with Retry roster, actions disabled, no controller block or pill', async t => {
  const u = await setup(t, { instances: [instance('a')] }); await tick();
  const nodes = u.nodes(); u.mouse(nodes[0], 'click'); const button = u.one('.pterm');
  u.setRead(() => Promise.reject(new Error('offline'))); u.poll(); await tick();
  assert.deepEqual(u.nodes(), nodes, 'the last observation stays painted');
  assert.match(u.notice(), /^Roster unavailable: offline\. Showing the last observation, not current state; actions disabled\.$/);
  assert.equal(u.one('.hier-retry').hidden, false); assert.equal(u.one('.hier-retry').textContent, 'Retry roster');
  assert.equal(button.disabled, true, 'actions that need current state are disabled');
  assert.equal(u.status(), 'Couldn\'t refresh roster.', 'the failure is announced through the status line');
  assert.equal(u.root().hasAttribute('aria-busy'), false); assert.equal(u.indicator(), null); assert.equal(u.pill(), null);
  assert.equal(u.one('.loading-notice'), null, 'the view notice owns the stale line: no duplicate');
  assert.equal(u.one('.loading-failed'), null);
  assert.match(u.sum().textContent, /1 running/, 'the counts are the last observation, not "Roster unknown"');
  u.setRead(() => panel([instance('a')])); u.retry(); await tick();
  assert.equal(u.notice(), ''); assert.equal(button.disabled, false); assert.deepEqual(u.nodes(), nodes);
  assert.equal(u.status(), 'Roster updated', 'a user-invoked Retry announces its completion');
});

test('a failure without data: "Roster unknown", the view notice, no empty copy, no controller failed block in the summary', async t => {
  const u = await setup(t, { api: () => Promise.reject(new Error('probe down')) }); await tick();
  assert.equal(u.sum().textContent, 'Roster unknown'); assert.equal(u.one('.hier-sum .loading-failed'), null); assert.equal(u.one('.loading-failed'), null);
  assert.equal(u.one('.empty'), null); assert.equal(u.nodes().length, 0);
  assert.equal(u.root().hasAttribute('aria-busy'), false); assert.equal(u.pill(), null);
  assert.equal(u.notice(), 'Roster unavailable: probe down. No current observation.');
  assert.equal(u.status(), 'Couldn\'t refresh roster. probe down');
  await u.wait(200); assert.deepEqual(u.skeletons, [], 'no pill lands after the failure');
  u.setRead(() => panel([instance('back')])); u.retry();
  assert.equal(u.root().getAttribute('aria-busy'), 'true', 'a retry without data is pending again');
  assert.equal(u.sum().textContent, 'Roster unknown', 'the summary keeps its truthful text while the retry runs');
  await tick();
  assert.match(u.sum().textContent, /1 running/); assert.equal(u.nodes().length, 1); assert.equal(u.notice(), '');
  assert.equal(u.status(), 'Roster updated'); assert.equal(u.root().hasAttribute('aria-busy'), false);
});

test('a workspace switch is a new subject: blank summary (never "0 running"), pending again, pill after 150ms, painted on reply', async t => {
  const u = await setup(t, { instances: [instance('team-a')] }); await tick();
  assert.equal(u.nodes().length, 1);
  const next = deferred(); u.setRead(() => next.promise);
  setWorkspace('/other');
  assert.equal(u.nodes().length, 0, 'the old roster is revoked synchronously');
  assert.equal(u.sum().textContent, ''); assert.equal(u.one('.empty'), null);
  assert.equal(u.root().getAttribute('aria-busy'), 'true'); assert.equal(u.status(), 'Loading roster…');
  assert.equal(u.indicator(), null, 'a switch is pending, not refreshing');
  assert.equal(u.pill(), null); await u.wait(170); assert.ok(u.pill());
  next.resolve(panel([instance('other-a'), instance('other-b')], '/other')); await tick();
  assert.equal(u.pill(), null); assert.match(u.sum().textContent, /2 running/); assert.equal(u.nodes().length, 2);
  assert.equal(u.root().hasAttribute('aria-busy'), false); assert.equal(u.status(), '');
});

test('a switch while a slow first read is pending keeps one pill, and the superseded reply never lands', async t => {
  const requests = []; const u = await setup(t, { api: () => { const d = deferred(); requests.push(d); return d.promise; } });
  await u.wait(170); assert.ok(u.pill());
  setWorkspace('/other');
  assert.equal(u.pill(), null, 'reset drops the old pill'); assert.equal(u.root().getAttribute('aria-busy'), 'true');
  await u.wait(170); assert.equal(u.all('.hier-sum .skeleton-pill').length, 1, 'exactly one pill for the new subject');
  requests[0].resolve(panel([instance('stale')], '/team')); await tick();
  assert.ok(u.pill(), 'a superseded success cannot end the pending state'); assert.equal(u.nodes().length, 0);
  requests[1].resolve(panel([instance('current')], '/other')); await tick();
  assert.equal(u.pill(), null); assert.match(u.host.textContent, /current/); assert.doesNotMatch(u.host.textContent, /stale/);
});

test('observedAt is taken from the reply when present and never invented; it does not force a repaint', async t => {
  const u = await setup(t, { api: () => panel([instance('a')], '/team', { observedAt: new Date().toISOString() }) }); await tick();
  const nodes = u.nodes();
  assert.equal(u.one('.loading-notice'), null, 'fresh data shows no age line');
  u.setRead(() => panel([instance('a')], '/team', { observedAt: new Date(Date.now() + 1000).toISOString() })); u.poll(); await tick();
  assert.deepEqual(u.nodes(), nodes, 'a changed observedAt alone is not a roster change');
  u.setRead(() => panel([instance('a')])); u.poll(); await tick();
  assert.equal(u.one('.loading-notice'), null, 'no age shown when the field is absent');
});

test('a deployment the server has not observed yet (status pending, no instances) is not an empty roster: its copy in the summary, no counts, no empty state, aria-busy; the observation then paints', async t => {
  const u = await setup(t, { api: () => panel([], currentWorkspace(), { deployment: { status: 'pending' } }) }); await tick();
  assert.equal(u.sum().textContent, 'Reading the deployment through the installed OATS CLI…');
  assert.equal(u.one('.empty'), null, 'no "No instances reported"'); assert.equal(u.nodes().length, 0);
  assert.equal(u.root().getAttribute('aria-busy'), 'true'); assert.equal(u.status(), 'Loading roster…'); assert.equal(u.notice(), '');
  await u.wait(200); assert.equal(u.pill(), null, 'the copy stands in for the pill: a deployment state is not a skeleton');
  await u.poll(); await tick(); assert.equal(u.sum().textContent, 'Reading the deployment through the installed OATS CLI…', 'a repeated pending poll changes nothing');
  u.setRead(() => panel([instance('a'), instance('b', { running: false })]));
  await u.poll(); await tick();
  assert.match(u.sum().textContent, /1 running · 1 stopped/); assert.equal(u.nodes().length, 2); assert.equal(u.root().hasAttribute('aria-busy'), false);
  // A deployment the kernel refused is a failed read, with the existing notice.
  u.setRead(() => panel([], currentWorkspace(), { deployment: { status: 'unavailable', reason: { code: 'E_NO_KERNEL', message: 'no kernel here' } } }));
  await u.poll(); await tick();
  assert.match(u.notice(), /Roster unavailable: E_NO_KERNEL: no kernel here/); assert.equal(u.nodes().length, 2, 'the last observation stays');
});

test('a panel that reports an error beside its instances is announced as stale once (the notice is a note, the status line speaks)', async t => {
  const u = await setup(t); await tick();
  assert.equal(u.nodes().length, 1);
  u.setRead(() => panel([instance()], currentWorkspace(), { error: 'remote unreachable' }));
  await u.poll(); await tick();
  assert.match(u.notice(), /^Roster unavailable: remote unreachable\./); assert.equal(u.one('.hier-notice').getAttribute('role'), 'note');
  assert.equal(u.status(), "Couldn't refresh roster."); assert.equal(u.nodes().length, 1, 'the observation is kept');
  const status = u.one('.hier-status'); status.textContent = 'sentinel';
  await u.poll(); await tick(); assert.equal(status.textContent, 'sentinel', 'announced once, not on every poll');
  u.setRead(() => panel([instance()])); await u.poll(); await tick();
  assert.equal(u.notice(), ''); assert.equal(u.status(), '');
});
