// Spec 02: a team card lists its members wherever they run (/api/team-members), by machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createComputerTeams, computerTeamsCSS, memberGroups, memberSummary, memberState, openBlocked } from '../renderer/computer-teams.mjs';

const TEAM = 'aweb:juan.aweb.ai';
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const doc = { schemaVersion: 1, defaultTeam: 'juan', teams: [{ label: 'juan', team: TEAM, from: 'local', default: true }], souls: { teams: {}, default: {} }, problems: [] };
const m = (instance, extra = {}) => ({ workspace: '/w', server: null, serverLabel: null, instance, agent: 'dev', agentsRoot: '/w/agents',
  home: `/w/agents/dev/instances/${instance}`, team: TEAM, running: true, addressable: true, missingRemotely: false, reason: null, createdAt: null, ...extra });
const far = (instance, server, extra = {}) => m(instance, { workspace: `remote:${server}:1`, server, serverLabel: `${server[0].toUpperCase()}${server.slice(1)} box`,
  agentsRoot: '/srv/agents', home: `/srv/agents/dev/instances/${instance}`, ...extra });
const server = (name, extra = {}) => ({ server: name, label: `${name[0].toUpperCase()}${name.slice(1)} box`, group: `${name}:1`, reached: true, error: null, registered: true, souls: ['dev'], ...extra });

async function mount(t, answer, { onMember = () => {} } = {}) {
  const dom = new JSDOM('<!doctype html><body><main class="oats-view"></main></body>', { pretendToBeVisual: true }), d = dom.window.document;
  const style = d.createElement('style'); style.textContent = computerTeamsCSS; d.head.append(style);
  let current = answer;
  const card = createComputerTeams(d, { request: async () => structuredClone(doc), readMembers: async () => structuredClone(current), onMember });
  d.querySelector('main').append(card.element);
  t.after(() => { card.dispose(); dom.window.close(); });
  await tick();
  return { dom, doc: d, card, set: next => { current = next; }, q: s => card.element.querySelector(s), all: s => [...card.element.querySelectorAll(s)] };
}

test('memberGroups: this computer first, then servers by label in code points (id breaks ties); members by name, then home', () => {
  const groups = memberGroups([
    far('b', 'zeta'), m('b'), far('a', 'alpha'), m('a', { home: '/w/agents/qa/instances/a' }), m('a'),
    far('c', 'beta', { serverLabel: 'Same' }), far('d', 'alpha2', { serverLabel: 'Same' }), far('e', 'Bravo', { serverLabel: 'Bravo box' }),
  ], []);
  assert.deepEqual(groups.map(g => g.label), ['This computer', 'Alpha box', 'Bravo box', 'Same', 'Same', 'Zeta box'], 'code points: uppercase before lowercase, no locale folding');
  assert.deepEqual(groups.filter(g => g.label === 'Same').map(g => g.server), ['alpha2', 'beta'], 'the server id breaks a label tie');
  assert.deepEqual(groups[0].members.map(x => x.home), ['/w/agents/dev/instances/a', '/w/agents/qa/instances/a', '/w/agents/dev/instances/b']);
});

test('memberGroups: a group whose roster read failed is not reached, with the server\'s error', () => {
  const [group] = memberGroups([far('a', 'down', { running: null })], [server('down', { reached: false, error: 'ssh failed: timeout' })]);
  assert.equal(group.reached, false); assert.equal(group.error, 'ssh failed: timeout');
});

test('memberSummary: "N members", "· M on other machines" when some run elsewhere, and nothing for none', () => {
  assert.equal(memberSummary([]), null);
  assert.equal(memberSummary([m('a')]), '1 member');
  assert.equal(memberSummary([m('a'), m('b'), far('c', 'build')]), '3 members · 1 on other machines');
});

test('memberState and openBlocked: the state in words; Open only for a running, addressable member, else the roster\'s reason', () => {
  assert.deepEqual([m('a'), m('a', { running: false }), m('a', { running: null }), far('a', 'build', { missingRemotely: true, running: null })].map(memberState),
    ['running', 'stopped', 'unknown', 'gone']);
  assert.equal(openBlocked(m('a')), null);
  assert.equal(openBlocked(far('a', 'build')), null);
  assert.equal(openBlocked(far('a', 'build', { addressable: false, reason: 'Build box did not report this instance as reachable.' })), 'Build box did not report this instance as reachable.');
  assert.equal(openBlocked(m('a', { running: false })), 'a is not running.');
  assert.equal(openBlocked(m('a', { running: null, reason: 'a: status unknown' })), 'a: status unknown');
});

test('the card lists its members by machine: labelled groups, the state in words, two named buttons; Open disabled with the reason', async t => {
  const calls = [];
  const u = await mount(t, { members: [m('dev-a'), far('far-b', 'build', { running: false }), far('far-c', 'down', { running: null, reason: 'ssh failed: timeout' })],
    servers: [server('build'), server('down', { reached: false, error: 'ssh failed: timeout' })], notReached: [] }, { onMember: (action, x) => calls.push([action, x.instance, x.server]) });
  const groups = u.all('.ct-members > .ct-group');
  assert.deepEqual(groups.map(g => g.querySelector('.ct-group-head').textContent), ['This computer', 'Build box', 'Down box · not reached']);
  for (const g of groups) { assert.equal(g.getAttribute('role'), 'group'); assert.equal(u.doc.getElementById(g.getAttribute('aria-labelledby')), g.querySelector('.ct-group-head')); }
  assert.equal(groups[2].querySelector('.ct-group-head').title, 'ssh failed: timeout');
  const rows = u.all('.ct-member');
  assert.deepEqual(rows.map(r => [r.querySelector('.ct-member-name').textContent, r.querySelector('.ct-member-state').textContent, r.querySelector('.ct-dot').dataset.state]),
    [['dev-a', 'running', 'running'], ['far-b', 'stopped', 'stopped'], ['far-c', 'unknown', 'unknown']]);
  const [open, show] = rows[0].querySelectorAll('button');
  assert.equal(open.getAttribute('aria-label'), 'Open dev-a terminal on this computer'); assert.equal(open.disabled, false);
  assert.equal(show.getAttribute('aria-label'), 'Show dev-a in the roster');
  const [openB, showB] = rows[1].querySelectorAll('button');
  assert.equal(openB.getAttribute('aria-label'), 'Open far-b terminal on Build box');
  assert.equal(openB.disabled, true); assert.equal(openB.title, 'far-b is not running.'); assert.equal(openB.getAttribute('aria-description'), 'far-b is not running.');
  assert.equal(showB.disabled, false, 'Show in roster is always enabled');
  assert.equal(rows[2].querySelector('button').title, 'ssh failed: timeout');
  open.click(); showB.click();
  assert.deepEqual(calls, [['open', 'dev-a', null], ['show', 'far-b', 'build']]);
  assert.equal(u.q('.ct-side .ct-count').textContent, '3 members · 2 on other machines');
});

test('not reached: a status line under the head names every server we hold no rows for, and follows each answer even with focus inside', async t => {
  const u = await mount(t, { members: [m('dev-a')], servers: [server('far', { reached: false, error: 'ssh failed' })], notReached: [{ server: 'far', label: 'Far box' }, { server: 'nohost', label: 'nohost' }] });
  const reach = u.q('.ct-reach');
  assert.equal(reach.getAttribute('role'), 'status');
  assert.equal(reach.textContent, "Not reached: Far box, nohost. Their members aren't shown until they answer.");
  assert.equal(reach.previousElementSibling, u.q('.ct-page-head'), 'under the page head');
  u.q('.ct-member button').focus();
  u.set({ members: [m('dev-a')], servers: [server('far')], notReached: [{ server: 'nohost', label: 'nohost' }] }); u.card.syncRoster(); await tick();
  assert.equal(reach.textContent, "Not reached: nohost. Their members aren't shown until they answer.");
  u.set({ members: [m('dev-a')], servers: [], notReached: [] }); u.card.syncRoster(); await tick();
  assert.equal(reach.textContent, '');
});

test('the repaint barrier holds with focus inside a member row: a changed roster waits until focus leaves', async t => {
  const u = await mount(t, { members: [m('dev-a')], servers: [], notReached: [] });
  const button = u.q('.ct-member button'); button.focus();
  u.set({ members: [m('dev-a', { running: false }), m('dev-b')], servers: [], notReached: [] }); u.card.syncRoster(); await tick();
  assert.equal(u.q('.ct-member button'), button, 'not rebuilt under the keyboard'); assert.equal(u.doc.activeElement, button);
  assert.equal(u.all('.ct-member').length, 1);
  button.blur(); u.card.syncRoster(); await tick();
  assert.equal(u.all('.ct-member').length, 2, 'redrawn once focus left');
});

test('hostile instance, home and server label strings are text, never markup', async t => {
  const hostile = '"><img src=x onerror=alert(1)><b>';
  const u = await mount(t, { members: [far(`x${hostile}`, 'build', { serverLabel: hostile, home: `/srv/${hostile}`, reason: hostile, running: false })],
    servers: [server('build', { label: hostile })], notReached: [{ server: 'n', label: hostile }] });
  assert.equal(u.card.element.querySelector('img, [onerror]'), null);
  assert.ok(u.q('.ct-group-head').textContent.includes(hostile)); assert.ok(u.q('.ct-reach').textContent.includes(hostile));
  assert.equal(u.q('.ct-member button').title, hostile);
});

test('a route answer that does not validate leaves the cards saying nothing about members', async t => {
  const u = await mount(t, { members: 'nope' });
  assert.equal(u.q('.ct-members'), null); assert.equal(u.q('.ct-side .ct-count'), null); assert.equal(u.q('.ct-reach').textContent, '');
});
