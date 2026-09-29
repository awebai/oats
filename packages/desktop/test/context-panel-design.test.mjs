// F7 side panels (human direction; Phase F boundary doc F7): the terminal-side
// context panel shows only what the instance reported, in the spawn modal's
// design language; Instance · Soul · Git & GitHub (Git last); Teams folded into
// the Instance tab (injected, like Git: the host performs no IO); the Soul tab
// hands off to the Workspace view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createContextPanel, contextPanelCSS, driftText } from '../renderer/context-panel.mjs';
import { ageText } from '../renderer/age-text.mjs';
import { createInstanceTeamsSection } from '../renderer/instance-teams.mjs';
import { teamsCSS } from '../renderer/teams-panel.mjs';
import { instanceSoulCSS } from '../renderer/instance-soul.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(t, { teams, openSoul } = {}) {
  const dom = new JSDOM(`<!doctype html><body><div id="app"><aside id="sidebar"></aside><main id="main"></main><aside id="context-panel"></aside>
    <div id="tab-actions"><button id="panel-toggle">Panel</button></div></div></body>`);
  const document = dom.window.document, style = document.createElement('style'); style.textContent = contextPanelCSS; document.head.append(style);
  const updates = [], opened = [], hosts = [];
  const panel = createContextPanel({ document, root: document.getElementById('context-panel'),
    createTeamsSection: teams ?? ((host, { onPresence, tools }) => { hosts.push({ host, onPresence, tools }); return { update: u => updates.push(u), dispose() {} }; }),
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
  // v4.1: no Built from section and no Details disclosure on the Instance tab.
  const page = u.q('[data-context-page="instance"]');
  assert.equal(page.querySelector('.context-panel-details'), null);
  assert.doesNotMatch(page.textContent, /Built from|Team label|Messaging address/);
  const where = u.row('work').closest('.context-panel-section');
  u.select(instance({ home: undefined, repoName: undefined, branch: undefined, work: undefined }));
  assert.equal(where.hidden, true, 'nothing reported for Where it works: hidden');
  assert.doesNotMatch([...u.document.querySelectorAll('#context-panel [data-row]:not([hidden])')].map(r => r.textContent).join('|'), /Not reported/);
});

test('Where it works: one card — the mode band in plain words, then Repo, Branch (Git modes) and Home with an icon Copy', async t => {
  const u = fixture(t); u.select(instance({ work: 'worktree', repoName: 'northwind', branch: 'feat/checkout' }));
  const card = u.q('.context-panel-where'), band = u.row('work');
  assert.equal(band.parentElement, card); assert.equal(band.className, 'context-panel-mode');
  assert.equal(band.querySelector('.context-panel-mode-title').textContent, 'Own worktree');
  assert.equal(band.querySelector('.context-panel-mode-meaning').textContent, "isolated branch in a clone of the soul's repo");
  assert.equal(band.querySelector('.context-panel-mode-tile').getAttribute('aria-hidden'), 'true');
  assert.deepEqual([...card.querySelectorAll('dt')].map(dt => dt.textContent), ['Repo', 'Branch', 'Home'], 'no Mode row, no repo-path row');
  assert.equal(u.row('branch').hidden, false); assert.equal(u.field('branch').textContent, 'feat/checkout');
  assert.equal(u.field('branch').title, 'feat/checkout', 'one line with ellipsis; the full name in the title');
  assert.match(contextPanelCSS, /\.context-panel-branch-value > \[data-context-field\] \{[^}]*text-overflow:ellipsis; white-space:nowrap/);
  const modes = { worktree: ['Own worktree', "isolated branch in a clone of the soul's repo", 'branch'], checkout: ['Shared checkout', "the repo's current branch", 'branch'],
    directory: ['Plain folder', 'no Git', null], workspace: ['Workspace view', 'reads across member repos', null], attached: ['Attached', "works in its parent's tree", 'branch'] };
  for (const [work, [label, meaning, branch]] of Object.entries(modes)) {
    u.select(instance({ work, branch: 'b' }));
    assert.equal(band.querySelector('.context-panel-mode-title').textContent, label, work);
    assert.equal(band.querySelector('.context-panel-mode-meaning').textContent, meaning, work);
    assert.equal(band.querySelector('.context-panel-mode-tile').dataset.work, work);
    assert.ok(band.querySelector('.context-panel-mode-tile svg'), `${work}: an icon tile`);
    assert.equal(u.row('branch').hidden, !branch, `${work}: Branch only for Git modes`);
  }
  // Attached names the owner it works for (an attached instance is always the child of the tree's owner).
  u.select(instance({ work: 'attached', parentInstance: 'lead-1' }));
  assert.equal(band.querySelector('.context-panel-mode-meaning').textContent, "works in lead-1's tree");
  u.select(instance({ work: 'bogus' })); assert.equal(band.hidden, true, 'an unknown mode shows no band');
  // Home: left-truncated, the full path in the field and the title; Copy is icon-only.
  u.select(instance({ work: 'directory' }));
  const home = u.field('home');
  assert.equal(home.textContent, HOME); assert.equal(home.closest('.context-panel-path').dir, 'rtl', 'clipped at the start');
  assert.equal(home.closest('.context-panel-path').title, HOME);
  assert.equal(u.q('[data-copy="repo"]'), null, 'no repo-path row');
  const copy = u.q('[data-copy="home"]');
  assert.equal(copy.getAttribute('aria-label'), 'Copy home path'); assert.equal(copy.textContent, '', 'icon only'); assert.ok(copy.querySelector('svg'));
  const written = [];
  Object.defineProperty(u.dom.window.navigator, 'clipboard', { value: { writeText: async text => { written.push(text); } }, configurable: true });
  copy.click(); await tick();
  assert.deepEqual(written, [HOME]); assert.equal(copy.getAttribute('aria-label'), 'Copied');
  assert.equal(u.document.querySelector('#context-panel').textContent.includes('Copy'), false, 'no text Copy button');
});

test('created reads as a relative age with the exact value in its title', t => {
  const u = fixture(t), at = new Date(Date.now() - 3 * 3600e3).toISOString();
  u.select(instance({ createdAt: at }));
  assert.equal(u.field('createdAt').textContent, '3 h ago'); assert.equal(u.field('createdAt').title, at);
  assert.equal(ageText('2026-09-25T10:00:00.000Z', Date.parse('2026-09-25T10:00:30.000Z')), 'just now');
  assert.equal(ageText('2026-09-25T10:00:00.000Z', Date.parse('2026-09-25T10:42:00.000Z')), '42 min ago');
  assert.equal(ageText('2026-09-20T10:00:00.000Z', Date.parse('2026-09-25T10:00:00.000Z')), '5 d ago');
  assert.equal(ageText('not a date'), 'not a date');
});

test('header: "instance of <soul>" links to the Soul tab; the state reads "Running · 42m" or "Stopped"', t => {
  const u = fixture(t), started = new Date(Date.now() - 42 * 60e3).toISOString();
  u.select(instance({ startedAt: started }));
  const link = u.q('[data-context-soul-link]');
  assert.equal(link.tagName, 'BUTTON'); assert.equal(link.textContent, 'web-developer');
  assert.equal(link.previousElementSibling.textContent, 'instance of'); assert.equal(link.title, 'web-developer: show the Soul tab');
  // The soul name ellipsizes its own text (a button is atomic inside an ellipsized line, so the line is a flex row).
  assert.match(contextPanelCSS, /button\.context-panel-soul-link \{ flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;/);
  // Two-row header grid: tile | name | state, then the soul line (+ chip) spanning name and state.
  const head = u.q('[data-context-page="instance"] > .context-panel-identity');
  assert.ok(head.classList.contains('is-instance'));
  assert.match(contextPanelCSS, /\.context-panel-identity\.is-instance \{ display:grid; grid-template-columns:36px minmax\(0,1fr\) auto;/);
  assert.match(contextPanelCSS, /\.is-instance \.context-panel-identity-sub \{ grid-column:2 \/ 4; grid-row:2;/);
  assert.equal(link.closest('.context-panel-identity-sub').querySelector('[data-context-drift]') !== null, true, 'the chip is inline after the soul line');
  assert.equal(u.field('instance').title, 'web-developer-1');
  const state = u.q('.context-panel-state');
  assert.equal(state.dataset.state, 'running'); assert.equal(state.title, `started ${started}`);
  assert.equal(u.field('running').textContent, 'Running'); assert.equal(state.querySelector('.context-panel-state-age').textContent, '· 42m');
  link.click();
  assert.equal(u.tab('soul').getAttribute('aria-selected'), 'true'); assert.equal(u.document.activeElement, u.tab('soul'));
  u.select(instance({ running: false, startedAt: started }));
  assert.equal(u.field('running').textContent, 'Stopped'); assert.equal(state.querySelector('.context-panel-state-age').hidden, true);
  u.select(instance({ agent: undefined })); assert.equal(link.parentElement.hidden, true, 'no soul reported: no sub-line');
  u.select(instance({ running: undefined })); assert.equal(state.hidden, true, 'an unknown state is not shown');
  u.select(instance()); assert.equal(state.hidden, false);
});

test('drift: one neutral "older build" chip only for moved/missing (soul or capability rows), with a plain-words tooltip', t => {
  const u = fixture(t), chip = () => u.q('[data-context-drift]');
  const current = { soul: { repoKey: 'github.com/nw/agents', commit: 'abcdef1234', status: 'current' }, modules: [{ name: 'oats.okf', status: 'current' }] };
  u.select(instance(current)); assert.equal(chip().hidden, true, 'current: no chip');
  u.select(instance({ modules: { 'oats.okf': {} } })); assert.equal(chip().hidden, true, 'a recorded map is not observed drift');
  u.select(instance()); assert.equal(chip().hidden, true, 'unreported: no chip');
  u.select(instance({ ...current, soul: { ...current.soul, status: 'moved', current: '99999999' } }));
  assert.equal(chip().hidden, false); assert.equal(chip().textContent, 'older build');
  assert.match(chip().title, /soul's repository has moved on/); assert.match(chip().title, /Re-spawning picks up the new state/);
  assert.equal(chip().getAttribute('aria-label'), `older build: ${chip().title}`);
  u.select(instance({ modules: [{ name: 'oats.okf', status: 'moved', from: { version: '2.1.3' }, current: { version: '2.2.0' } }, { name: 'oats.x', status: 'missing', reason: 'package removed' }] }));
  assert.equal(chip().hidden, false);
  assert.match(chip().title, /oats\.okf has changed since \(2\.1\.3 → 2\.2\.0\)/); assert.match(chip().title, /oats\.x is no longer available \(package removed\)/);
  assert.equal(chip().closest('.context-panel-identity') !== null, true, 'in the header');
  assert.equal(driftText({ modules: [], soul: { status: 'current' } }), null);
});

test('Soul tab: the description under the name, Open soul page hands the soul identity off; no disclaimer paragraph', t => {
  const u = fixture(t); u.select(instance({ description: 'Builds the storefront', server: null }));
  u.tab('soul').click();
  const page = u.q('[data-context-page="soul"]');
  assert.match(page.textContent, /web-developer.*Builds the storefront/s);
  assert.doesNotMatch(page.textContent, /Metadata reported by this instance/);
  const open = u.q('[data-action="soul.open"]');
  assert.equal(open.textContent, 'Open soul page', 'Workspace v4 (W6) wording'); assert.equal(open.disabled, false);
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
  // v4.1: the header is the label and a tools slot (the icon Refresh goes there); the address is its own line, not inline.
  const head = section.querySelector('.context-panel-section-head');
  assert.equal(head.querySelector('.context-panel-label').textContent, 'Messaging');
  assert.equal(u.hosts[0].tools, head.querySelector('.context-panel-tools'));
  assert.equal(head.querySelector('[data-context-field]'), null, 'the alias is not inline in the header');
  assert.equal(head.nextElementSibling, u.field('identity')); assert.equal(u.field('identity').className, 'context-panel-address');
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
  assert.deepEqual(u.presence.at(-1), true); assert.ok(u.host.querySelector('.teams-panel [data-team-row="default"]'));
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

// Kernel #217 desktop facts on the instance page (views only): the last start,
// where the model came from and the messaging address, each only when reported.
test('desktop facts: a reported start replaces the spawn age, the model says where it came from, the messaging address sits under Messaging', t => {
  const u = fixture(t);
  const captured = JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/desktop-facts/status.json', import.meta.url), 'utf8')).agents.flatMap(a => a.instances)[0];
  const created = new Date(Date.now() - 26 * 3600e3).toISOString(), started = new Date(Date.now() - 12 * 60e3).toISOString();
  const age = which => u.q(`.context-panel-session-age${which === 'started' ? '[data-age=started]' : ':not([data-age])'}`);
  // The real capture: spawned with --model, never launched (startedAt null), no messaging identity.
  u.select(instance({ createdAt: created, model: captured.model, modelFrom: captured.modelFrom, startedAt: captured.startedAt, identityAddress: captured.identityAddress }));
  assert.equal(captured.modelFrom, 'spawn'); assert.equal(captured.startedAt, null);
  assert.equal(u.field('modelFrom').textContent, 'chosen at spawn'); assert.equal(u.field('modelFrom').hidden, false);
  assert.equal(age('started').hidden, true, 'never launched: no start'); assert.equal(age('created').hidden, false);
  assert.equal(u.field('identity').hidden, true, 'no address reported');
  // A restarted home: the start replaces the age, the spawn time stays in its title.
  u.select(instance({ createdAt: created, model: 'claude-opus-5-5', modelFrom: 'soul', startedAt: started, identityAddress: 'northwind/web-developer-1' }));
  assert.equal(age('started').textContent, 'started 12 min ago'); assert.equal(age('created').hidden, true);
  assert.equal(u.field('startedAt').title, `${started} · created ${created}`);
  assert.equal(u.field('modelFrom').textContent, "the soul's choice");
  assert.equal(u.field('identity').hidden, false); assert.equal(u.field('identity').textContent, 'northwind/web-developer-1');
  assert.equal(u.field('identity').closest('[data-context-section="teams"]') !== null, true);
  // 0.30 launch preferences: an inline override on this computer, for the soul or for every soul.
  for (const [from, words] of [['local', 'set for this soul on this computer'], ['local-default', "this computer's default for every soul"]]) {
    u.select(instance({ createdAt: created, model: 'gpt-codex-astra', modelFrom: from }));
    assert.equal(u.field('modelFrom').textContent, words, from); assert.equal(u.field('modelFrom').hidden, false, from);
  }
  for (const odd of ['later', 'constructor', '__proto__']) {
    u.select(instance({ createdAt: created, model: 'm', modelFrom: odd }));
    assert.equal(u.field('modelFrom').hidden, true, `${odd}: an unknown source says nothing`);
  }
  // An older kernel (none of the keys) or a pre-0.29 home (modelFrom null): as before.
  u.select(instance({ createdAt: created, modelFrom: 'soul' }));
  assert.equal(u.field('modelFrom').hidden, true, 'no model reported: its source alone says nothing');
  for (const extra of [{}, { modelFrom: null }]) {
    u.select(instance({ createdAt: created, model: 'm', ...extra }));
    assert.equal(u.field('modelFrom').hidden, true); assert.equal(age('started').hidden, true);
    assert.equal(age('created').textContent, 'created 1 d ago'); assert.equal(u.field('identity').hidden, true);
  }
});

test('the instance panel CSS leaves keyboard focus to the global rule: no per-component focus rings or outlines', () => {
  for (const [name, source] of [['contextPanelCSS', contextPanelCSS], ['teamsCSS', teamsCSS], ['instanceSoulCSS', instanceSoulCSS]]) {
    assert.doesNotMatch(source, /:focus-visible|:focus\b|outline:/, name);
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|color-mix|opacity/i, `${name}: tokens only`);
  }
  // The tab bar toggle's pressed state is the brand tint (00-common rule 1).
  assert.match(contextPanelCSS, /#tab-actions #panel-toggle\[aria-pressed="true"\] \{ background:var\(--sel\); color:var\(--accent\); \}/);
});
