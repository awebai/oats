// F7 side panels (human direction; Phase F boundary doc F7): the terminal-side
// context panel shows only what the instance reported, in the spawn modal's
// design language; Instance · Soul · Git & GitHub (Git last); Teams folded into
// the Instance tab (injected, like Git: the host performs no IO); the Soul tab
// hands off to the Workspace view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createContextPanel, contextPanelCSS } from '../renderer/context-panel.mjs';
import { ageText } from '../renderer/age-text.mjs';
import { createInstanceTeamsSection } from '../renderer/instance-teams.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(t, { teams, openSoul } = {}) {
  const dom = new JSDOM(`<!doctype html><body><div id="app"><aside id="sidebar"></aside><main id="main"></main><aside id="context-panel"></aside>
    <footer><button id="panel-toggle">Panel</button><button id="focus-mode-toggle">Focus mode</button></footer></div></body>`);
  const document = dom.window.document, style = document.createElement('style'); style.textContent = contextPanelCSS; document.head.append(style);
  const updates = [], opened = [], hosts = [];
  const panel = createContextPanel({ document, root: document.getElementById('context-panel'),
    createTeamsSection: teams ?? ((host, { onPresence }) => { hosts.push({ host, onPresence }); return { update: u => updates.push(u), dispose() {} }; }),
    openSoul: openSoul ?? (ref => opened.push(ref)) });
  t.after(() => { panel.dispose(); dom.window.close(); });
  const q = s => document.querySelector(s);
  const row = id => q(`#context-panel [data-row="${id}"]`);
  return { dom, document, panel, q, row, updates, opened, hosts,
    select: (instance, workspace = 'A') => panel.setContext({ workspace, instance, key: instance?.home }),
    tab: id => q(`[data-context-tab="${id}"]`), field: id => q(`[data-context-field="${id}"]`) };
}
const HOME = '/Users/me/work/northwind/agents/web-developer/instances/web-developer-1';
const instance = (extra = {}) => ({ instance: 'web-developer-1', agent: 'web-developer', agentsRoot: '/Users/me/work/northwind/agents', home: HOME,
  repo: '/Users/me/work/northwind', branch: 'feat/checkout', harness: 'claude', work: 'directory', running: true, ...extra });

test('only reported facts: an unreported fact hides its row (its field still says so), and an empty section hides', t => {
  const u = fixture(t); u.select(instance());
  // Workspace v4 (W6): harness and model sit in the Session card; an unreported model is not shown.
  assert.equal(u.field('model').textContent, 'Not reported'); assert.equal(u.field('model').hidden, true, 'no "Not reported" is shown');
  assert.equal(u.field('harness').closest('.context-panel-section').hidden, false); assert.equal(u.row('work').hidden, false);
  const lineage = u.row('parentInstance').closest('.context-panel-section');
  assert.equal(lineage.hidden, true, 'no parent or sibling reported: no Lineage section');
  u.select(instance({ parentInstance: 'lead-1' }));
  assert.equal(lineage.hidden, false); assert.equal(u.row('parentInstance').hidden, false); assert.equal(u.row('siblingInstance').hidden, true);
  // Less-used facts sit behind Details (collapsed), still only when reported.
  const details = u.q('[data-context-page="instance"] > .context-panel-details');
  assert.equal(details.open, false); assert.equal(details.hidden, false, 'the home is reported');
  assert.equal(u.row('soulSource').hidden, true); assert.equal(u.field('identity').hidden, true);
  u.select(instance({ home: undefined }));
  assert.equal(details.hidden, true, 'nothing reported for Details: hidden');
  assert.doesNotMatch([...u.document.querySelectorAll('#context-panel [data-row]:not([hidden])')].map(r => r.textContent).join('|'), /Not reported/);
});

test('created reads as a relative age with the exact value in its title; paths show their end with Copy', async t => {
  const u = fixture(t), at = new Date(Date.now() - 3 * 3600e3).toISOString();
  u.select(instance({ createdAt: at }));
  assert.equal(u.field('createdAt').textContent, '3 h ago'); assert.equal(u.field('createdAt').title, at);
  const repo = u.field('repo');
  assert.equal(repo.textContent, '/Users/me/work/northwind', 'the field keeps the full reported path');
  assert.equal(repo.closest('.context-panel-path').title, '/Users/me/work/northwind'); assert.equal(repo.closest('.context-panel-path').dir, 'rtl', 'clipped at the start');
  const written = [];
  Object.defineProperty(u.dom.window.navigator, 'clipboard', { value: { writeText: async text => { written.push(text); } }, configurable: true });
  const copy = u.q('[data-copy="repo"]'); copy.click(); await tick();
  assert.deepEqual(written, ['/Users/me/work/northwind']); assert.equal(copy.textContent, 'Copied');
  assert.equal(copy.getAttribute('aria-label'), 'Copy path');
  assert.equal(ageText('2026-09-25T10:00:00.000Z', Date.parse('2026-09-25T10:00:30.000Z')), 'just now');
  assert.equal(ageText('2026-09-25T10:00:00.000Z', Date.parse('2026-09-25T10:42:00.000Z')), '42 min ago');
  assert.equal(ageText('2026-09-20T10:00:00.000Z', Date.parse('2026-09-25T10:00:00.000Z')), '5 d ago');
  assert.equal(ageText('not a date'), 'not a date');
});

test('Soul tab: the description under the name, Open in Workspace hands the soul identity off; no disclaimer paragraph', t => {
  const u = fixture(t); u.select(instance({ description: 'Builds the storefront', server: null }));
  u.tab('soul').click();
  const page = u.q('[data-context-page="soul"]');
  assert.match(page.textContent, /web-developer.*Builds the storefront/s);
  assert.doesNotMatch(page.textContent, /Metadata reported by this instance/);
  const open = u.q('[data-action="soul.open"]');
  assert.equal(open.textContent, 'Open in Workspace'); assert.equal(open.disabled, false);
  open.click();
  assert.deepEqual(u.opened, [{ workspace: 'A', name: 'web-developer', agentsRoot: '/Users/me/work/northwind/agents', server: undefined }]);
  u.select(instance({ agent: undefined }));
  assert.equal(open.disabled, true, 'no reported soul: nothing to open');
  assert.equal(u.field('description').hidden, true);
});

test('Teams (Messaging) sits in the Instance tab under Session, injected; it is active only while the Instance tab is the visible page', t => {
  const u = fixture(t); u.select(instance());
  const section = u.q('[data-context-section="teams"]');
  assert.equal(u.hosts.length, 1); assert.equal(u.hosts[0].host, section);
  assert.equal(section.previousElementSibling.querySelector('.context-panel-label').textContent, 'Session', 'Workspace v4 (W6) order: Where it works, Session, Messaging');
  assert.equal(section.querySelector('.context-panel-label').firstChild.textContent, 'Messaging');
  assert.equal(section.hidden, true, 'hidden until the section says it has something');
  u.hosts[0].onPresence(true); assert.equal(section.hidden, false);
  assert.equal(u.updates.at(-1).active, true); assert.equal(u.updates.at(-1).instance.home, HOME); assert.equal(u.updates.at(-1).workspace, 'A');
  u.tab('git').click(); assert.equal(u.updates.at(-1).active, false, 'another tab: no reads');
  u.panel.setCollapsed(true); assert.equal(u.updates.at(-1).active, false);
});

// The injected section: inspect --home says which operations the provider declares, then the shared Teams card.
const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/teams/${name}.json`, import.meta.url), 'utf8'));
const TEAMS_HOME = fx('inspect-home').result.subject.home;
const teamsInstance = (home = TEAMS_HOME, extra = {}) => ({ instance: home.split('/').pop(), home, ...extra });
function section(t, request, cli = () => ({ ok: true, operationsApi: 2 })) {
  const dom = new JSDOM('<body><section></section></body>'), host = dom.window.document.querySelector('section'), calls = [], presence = [];
  let gen = 0;
  const s = createInstanceTeamsSection(host, { cli, generation: () => gen, onPresence: p => presence.push(p),
    request: async (workspace, body) => { calls.push({ workspace, ...body }); return request(workspace, body); } });
  t.after(() => { s.dispose(); dom.window.close(); });
  return { host, s, calls, presence, bump: () => ++gen };
}
test('the injected Teams section reads once per instance, gates on the declared operations, and mounts the shared card', async t => {
  const u = section(t, (_ws, body) => body.action === 'inspect' ? fx('inspect-home').result : fx('teams-initial').result);
  u.s.update({ active: true, workspace: 'A', instance: teamsInstance() }); await tick(); await tick();
  assert.deepEqual(u.calls.map(c => [c.workspace, c.action, c.operation ?? null]), [['A', 'inspect', null], ['A', 'run', 'messaging:teams']]);
  assert.deepEqual(u.calls[0].selector, { home: TEAMS_HOME });
  assert.deepEqual(u.presence.at(-1), true); assert.ok(u.host.querySelector('.teams-panel [data-team-row="personal"]'));
  assert.equal(u.host.querySelector('.teams-panel > h3'), null, 'the context panel labels the section itself');
  for (let i = 0; i < 5; i++) u.s.update({ active: true, workspace: 'A', instance: teamsInstance() });
  await tick(); assert.equal(u.calls.length, 2, 'renders are frequent: one inspection per selection');
  u.s.update({ active: true, workspace: 'A', instance: teamsInstance(`${TEAMS_HOME}-2`) }); await tick();
  assert.equal(u.calls.filter(c => c.action === 'inspect').length, 2, 'a new selection reads again');
});
test('no messaging provider, no compatible CLI, a remote instance or an inactive tab: no section and no read', async t => {
  const none = fx('inspect-home').result; for (const c of none.capabilities) if (c.layer === 'messaging') c.layer = null;
  const a = section(t, () => none); a.s.update({ active: true, workspace: 'A', instance: teamsInstance() }); await tick();
  assert.equal(a.calls.length, 1); assert.deepEqual(a.presence, [false]); assert.equal(a.host.querySelector('.teams-panel'), null);
  const b = section(t, () => assert.fail('no read'), () => ({ ok: true, operationsApi: 1 }));
  b.s.update({ active: true, workspace: 'A', instance: teamsInstance() });
  const c = section(t, () => assert.fail('no read')); c.s.update({ active: true, workspace: 'A', instance: teamsInstance(TEAMS_HOME, { server: 'host' }) });
  const d = section(t, () => assert.fail('no read')); d.s.update({ active: false, workspace: 'A', instance: teamsInstance() });
  await tick(); assert.equal(b.calls.length + c.calls.length + d.calls.length, 0);
});
test('a stale inspection (the selection or workspace changed while it was in flight) mounts nothing', async t => {
  let release; const gate = new Promise(r => { release = r; });
  const u = section(t, async (_ws, body) => { if (body.action === 'inspect') { await gate; return fx('inspect-home').result; } return fx('teams-initial').result; });
  u.s.update({ active: true, workspace: 'A', instance: teamsInstance() });
  u.s.update({ active: false, workspace: 'A', instance: teamsInstance(`${TEAMS_HOME}-2`) });
  release(); await tick(); await tick();
  assert.equal(u.host.querySelector('.teams-panel'), null); assert.equal(u.calls.some(c => c.action === 'run'), false);
  let release2; const gate2 = new Promise(r => { release2 = r; });
  const v = section(t, async (_ws, body) => { if (body.action === 'inspect') { await gate2; return fx('inspect-home').result; } return fx('teams-initial').result; });
  v.s.update({ active: true, workspace: 'A', instance: teamsInstance() }); v.bump();
  release2(); await tick(); await tick();
  assert.equal(v.host.querySelector('.teams-panel'), null, 'a workspace-generation change revokes it too');
});
