// Spec A (Teams says whose default it is): teamAudience reads, from the committed souls: map alone, whose
// default a team is and who else may join it (docs/design/2026-10-02-team-model-3.md: a soul's teams come from
// its most specific key, its default from the most specific key that sets one), and each card says so in two
// labelled rows. The documents are the rigs' shapes (lfx: three member repos, local teams closed; solo: one repo,
// local teams open) as `oats teams --json` (teamsApi 2) answers them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createComputerTeams, computerTeamsCSS, teamAudience, whoMayJoin } from '../renderer/computer-teams.mjs';

const shared = (label, extra = {}) => ({ label, team: `${label}:acme.aweb.ai`, description: null, from: 'shared', default: false, at: 'x', ...extra });
const local = (label, extra = {}) => ({ ...shared(label, extra), from: 'local' });
const v3 = ({ teams, souls, defaultTeam = null, localTeams = false, problems = [] }) => ({ teamsApi: 2, deployment: '/d', localTeams, defaultTeam,
  teams: teams.map(t => ({ ...t, default: t.label === defaultTeam?.label })), souls, problems });
const lfx = () => v3({
  teams: [shared('lfx-ai-team', { description: 'The AI engineering agents and their reviewers.' }), shared('lfx-all'), shared('lfx-platform-team')],
  defaultTeam: { label: 'lfx-all', team: 'lfx-all:acme.aweb.ai', from: 'workspace' },
  souls: { '*': { teams: [] }, 'lfx-ai-engineering/*': { default: 'lfx-ai-team', teams: ['lfx-all'] },
    'lfx-ai-engineering/ai-reviewer': { default: 'lfx-ai-team', teams: ['lfx-all', 'lfx-platform-team'] },
    'lfx-platform/*': { default: 'lfx-platform-team', teams: ['lfx-all'] }, 'lfx-agents/*': { teams: 'any' } } });
const solo = () => v3({
  teams: [shared('engineering'), shared('docs', { team: null }), local('mine'), local('pairing')], localTeams: true,
  defaultTeam: { label: 'mine', team: 'mine:acme.aweb.ai', from: 'deployment' },
  souls: { '*': { teams: ['engineering'] }, 'acme-agents/writer': { default: 'docs', teams: ['engineering'] } },
  problems: [{ code: 'team-unmapped', severity: 'warning', label: 'docs', message: 'shared team docs has no provider id yet', fix: 'its owner runs `oats aweb setup`, then commits the id' }] });
const repo = (r) => ({ kind: 'repo', key: `${r}/*`, repo: r });
const soul = (r, s) => ({ kind: 'soul', key: `${r}/${s}`, repo: r, soul: s });

test('lfx: each team is the default of one repo\'s souls; who else may join, without repeating an implied entry', () => {
  const doc = lfx();
  assert.deepEqual(teamAudience(doc, 'lfx-ai-team'), { defaultFor: [repo('lfx-ai-engineering')], mayJoin: [repo('lfx-agents')] },
    'ai-reviewer\'s own default is implied by lfx-ai-engineering/*');
  assert.deepEqual(teamAudience(doc, 'lfx-platform-team'), { defaultFor: [repo('lfx-platform')], mayJoin: [repo('lfx-agents'), soul('lfx-ai-engineering', 'ai-reviewer')] });
  assert.deepEqual(teamAudience(doc, 'lfx-all'), { defaultFor: [{ kind: 'fallback', from: 'workspace' }],
    mayJoin: [repo('lfx-agents'), repo('lfx-ai-engineering'), repo('lfx-platform')] }, 'any: every shared team; ai-reviewer implied by lfx-ai-engineering/*');
});

test('solo: this deployment\'s default replaces the workspace\'s; a single soul\'s default; local teams for every soul', () => {
  const doc = solo();
  assert.deepEqual(teamAudience(doc, 'engineering'), { defaultFor: [], mayJoin: [{ kind: 'every', key: '*' }] }, 'no fallback: mine replaces it; writer implied by "*"');
  assert.deepEqual(teamAudience(doc, 'docs'), { defaultFor: [soul('acme-agents', 'writer')], mayJoin: [] });
  assert.deepEqual(teamAudience(doc, 'mine'), { defaultFor: [{ kind: 'fallback', from: 'deployment' }], mayJoin: [{ kind: 'local' }] });
  assert.deepEqual(teamAudience(doc, 'pairing'), { defaultFor: [], mayJoin: [{ kind: 'local' }] });
  // Closed: a local team still in oats-local.yaml gives no one anything; the standalone view (null) opens them.
  assert.deepEqual(teamAudience({ ...doc, localTeams: false }, 'pairing'), { defaultFor: [], mayJoin: [] });
  assert.deepEqual(teamAudience({ ...doc, localTeams: null, souls: {} }, 'pairing'), { defaultFor: [], mayJoin: [{ kind: 'local' }] });
});

test('except: the more specific keys under a pattern that set another default, or whose souls may not join', () => {
  const doc = v3({ teams: [shared('a'), shared('b')], souls: {
    'p/*': { default: 'a', teams: ['b'] }, 'p/x': { default: 'b' }, 'p/y': { default: 'a', teams: [] }, 'p/z': { teams: ['a'] } } });
  assert.deepEqual(teamAudience(doc, 'a'), { defaultFor: [{ ...repo('p'), except: [soul('p', 'x')] }], mayJoin: [] },
    'y and z keep a as their default (implied, never repeated in May join)');
  assert.deepEqual(teamAudience(doc, 'b'), { defaultFor: [soul('p', 'x')], mayJoin: [{ ...repo('p'), except: [soul('p', 'x'), soul('p', 'y'), soul('p', 'z')] }] },
    'x has b as its default (said under Default for, so not "without it being their default"); y and z list other teams (most specific key wins outright, no merging)');
  const star = v3({ teams: [shared('a'), shared('b')], souls: { '*': { teams: ['a'] }, 'q/*': { teams: [] }, 'r/*': { teams: ['a'] }, 'r/s': { teams: [] }, 't/u': { teams: ['b'] } } });
  assert.deepEqual(teamAudience(star, 'a').mayJoin, [{ kind: 'every', key: '*', except: [repo('q'), soul('r', 's'), soul('t', 'u')] }],
    'r/* is implied by "*", so its own exception is "*"\'s');
});

test('May join never covers the souls it is already the default of: a pattern\'s default audience is its exception', () => {
  // "*" lists a, but p's souls (p/x included: it inherits p/*'s default) have a as their default.
  const star = v3({ teams: [shared('a')], souls: { '*': { teams: ['a'] }, 'p/*': { default: 'a' }, 'p/x': { teams: [] }, 'p/y': { default: 'b', teams: ['a'] } } });
  assert.deepEqual(teamAudience(star, 'a'), { defaultFor: [{ ...repo('p'), except: [soul('p', 'y')] }],
    mayJoin: [{ kind: 'every', key: '*', except: [repo('p')] }, soul('p', 'y')] }, 'y, under the excepted p, may join again in its own right');
  // A repo that may join, with one soul whose default it is.
  const one = v3({ teams: [shared('a')], souls: { 'p/*': { teams: ['a'] }, 'p/x': { default: 'a' } } });
  assert.deepEqual(teamAudience(one, 'a'), { defaultFor: [soul('p', 'x')], mayJoin: [{ ...repo('p'), except: [soul('p', 'x')] }] });
});

test('implied entries drop at every level; a "*" that sets a default leaves the fallback to no soul', () => {
  const doc = v3({ teams: [shared('a'), shared('b')], defaultTeam: { label: 'b', team: 'b:x', from: 'workspace' },
    souls: { '*': { default: 'a' }, 'p/*': { default: 'a' }, 'p/x': { default: 'a', teams: ['a'] }, 'q/y': { default: 'b' } } });
  assert.deepEqual(teamAudience(doc, 'a'), { defaultFor: [{ kind: 'every', key: '*', except: [soul('q', 'y')] }], mayJoin: [] });
  assert.deepEqual(teamAudience(doc, 'b'), { defaultFor: [{ kind: 'fallback', from: 'workspace', nobody: true }, soul('q', 'y')], mayJoin: [] });
});

test('any is every shared team, never a local one; a package key reads like a repo\'s; souls: {} names no one', () => {
  const doc = v3({ teams: [shared('s'), local('l')], localTeams: false, souls: { 'oats.okf/*': { default: 's', teams: 'any' }, 'oats.okf/curator': { teams: 'any' } } });
  assert.deepEqual(teamAudience(doc, 's'), { defaultFor: [repo('oats.okf')], mayJoin: [] });
  assert.deepEqual(teamAudience(doc, 'l'), { defaultFor: [], mayJoin: [] });
  assert.deepEqual(teamAudience(v3({ teams: [shared('s')], souls: {} }), 's'), { defaultFor: [], mayJoin: [] });
  assert.deepEqual(teamAudience(v3({ teams: [shared('s')], souls: { 'bare': { teams: ['s'] }, 'p/*': 'x' } }), 's'), { defaultFor: [], mayJoin: [] }, 'malformed keys and rules are ignored');
});

test('team model 2 (teamsApi 1): no audience; whoMayJoin keeps its words', () => {
  const v2 = { teams: [shared('engineering')], defaultTeam: 'engineering', souls: { teams: { '*': ['engineering'] }, default: {} }, problems: [] };
  assert.equal(teamAudience(v2, 'engineering'), null);
  assert.equal(whoMayJoin(v2, 'engineering'), 'every soul');
});

const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
async function mount(t, document, readMembers = null) {
  const dom = new JSDOM('<!doctype html><body><main class="oats-view"></main></body>', { pretendToBeVisual: true }), doc = dom.window.document;
  const style = doc.createElement('style'); style.textContent = computerTeamsCSS; doc.head.append(style);
  const page = createComputerTeams(doc, { request: async () => structuredClone(document), readMembers });
  doc.querySelector('main').append(page.element);
  t.after(() => { page.dispose(); dom.window.close(); });
  await tick();
  const row = label => page.element.querySelector(`[data-team="${label}"]`);
  const fact = (label, which) => row(label).querySelector(`[data-audience=${which}] dd`)?.textContent ?? null;
  return { doc, page, row, fact };
}

test('lfx cards: Default for first under the description, then May join, then the address; the default team\'s card leads', async t => {
  const u = await mount(t, lfx());
  assert.deepEqual([...u.page.element.querySelectorAll('[data-section=shared] .ct-card')].map(c => c.dataset.team), ['lfx-all', 'lfx-ai-team', 'lfx-platform-team']);
  assert.equal(u.fact('lfx-ai-team', 'default'), 'all souls of lfx-ai-engineering');
  assert.equal(u.fact('lfx-ai-team', 'join'), 'souls of lfx-agents');
  assert.equal(u.fact('lfx-platform-team', 'default'), 'all souls of lfx-platform');
  assert.equal(u.fact('lfx-platform-team', 'join'), 'souls of lfx-agents · ai-reviewer (lfx-ai-engineering)');
  assert.equal(u.fact('lfx-all', 'default'), 'every soul without its own default');
  assert.equal(u.fact('lfx-all', 'join'), 'souls of lfx-agents, lfx-ai-engineering and lfx-platform');
  assert.equal(u.row('lfx-all').querySelector('.ct-pill').textContent, "Default · the workspace's");
  const main = u.row('lfx-ai-team').querySelector('.ct-main');
  assert.deepEqual([...main.children].map(c => c.className), ['ct-head', 'ct-desc', 'ct-audience', 'ct-address']);
  assert.deepEqual([...main.querySelectorAll('.ct-aud dt')].map(d => d.textContent), ['Default for', 'May join']);
  assert.equal(main.querySelector('.ct-address').textContent, 'lfx-ai-team:acme.aweb.ai');
  // Names are bold, each titled with the souls: key it comes from.
  assert.deepEqual([...u.row('lfx-platform-team').querySelectorAll('b.ct-name')].map(b => [b.textContent, b.title]),
    [['lfx-platform', 'lfx-platform/*'], ['lfx-agents', 'lfx-agents/*'], ['ai-reviewer', 'lfx-ai-engineering/ai-reviewer']]);
  assert.equal(u.page.element.querySelector('.ct-facts'), null, 'no team model 2 facts line');
  // No members and no actions (local teams closed): no right column, and the main one takes its width.
  assert.ok(u.row('lfx-ai-team').classList.contains('no-side')); assert.equal(u.row('lfx-ai-team').querySelector('.ct-side'), null);
  assert.match(computerTeamsCSS, /\.computer-teams \.ct-card\.no-side > \.ct-main \{ grid-column:2 \/ -1; \}/);
});

test('solo cards: only the rows with entries; this deployment\'s choice; docs keeps its warning below the address', async t => {
  const u = await mount(t, solo());
  assert.equal(u.fact('engineering', 'default'), null, 'mine replaces the workspace\'s default');
  assert.equal(u.fact('engineering', 'join'), 'every soul');
  assert.equal(u.fact('docs', 'default'), 'writer (acme-agents)');
  assert.equal(u.fact('docs', 'join'), null);
  assert.equal(u.fact('mine', 'default'), "every soul without its own default (this deployment's choice)");
  assert.equal(u.fact('mine', 'join'), 'every soul (local team)');
  assert.equal(u.fact('pairing', 'join'), 'every soul (local team)');
  const docs = u.row('docs').querySelector('.ct-main');
  assert.ok(docs.querySelector('.ct-address.none'), 'no provider id yet: the warn line');
  assert.ok(docs.querySelector('.ct-address').compareDocumentPosition(docs.querySelector('[data-problem=team-unmapped]')) & 4, 'the warning follows the address');
  assert.deepEqual([...u.page.element.querySelectorAll('[data-section=local] .ct-card')].map(c => c.dataset.team), ['mine', 'pairing']);
  // The souls: table's right column, reworded.
  assert.deepEqual([...u.page.element.querySelectorAll('.ct-soul-teams')].map(s => s.textContent), ['may join engineering', 'default docs · may also join engineering']);
});

test('nobody, except, a "*" default and a blocking default team: their words and places', async t => {
  const doc = v3({ teams: [shared('a', { team: null }), shared('b'), shared('c'), shared('idle')], defaultTeam: { label: 'a', team: null, from: 'workspace' },
    souls: { '*': { default: 'b', teams: 'any' }, 'p/*': { default: 'c' }, 'p/x': { default: 'b' }, 'q/*': { teams: [] } },
    problems: [{ code: 'team-unmapped', severity: 'warning', label: 'a', default: true, message: 'shared team a has no provider id yet' }] });
  const u = await mount(t, doc);
  assert.equal(u.fact('b', 'default'), 'every soul except souls of p · x (p)');
  assert.equal(u.fact('c', 'default'), 'all souls of p except x');
  assert.equal(u.fact('a', 'default'), 'fallback; every soul has its own default');
  assert.ok(u.row('a').querySelector('[data-audience=default] dd .ct-quiet'), 'said quietly');
  assert.equal(u.fact('idle', 'join'), 'every soul except souls of p and q');
  const a = u.row('a').querySelector('.ct-main');
  assert.equal(a.children[1].className, 'ct-blocking', 'the blocking problem leads the card');
  // Not every card is someone's: "*" lists any, so all of these may be joined; a team nobody may join says so.
  const lone = await mount(t, v3({ teams: [shared('lone')], souls: { '*': { teams: [] } } }));
  const none = lone.row('lone').querySelector('.ct-join.none');
  assert.equal(none.textContent, 'No soul may join it yet');
  assert.equal(lone.row('lone').querySelector('.ct-audience'), null);
});

test('hostile labels and keys only ever enter as text', async t => {
  const evil = '<img src=x onerror="globalThis.pwned=1">';
  const u = await mount(t, v3({ teams: [shared('h')], souls: { [`${evil}/*`]: { default: 'h' }, [`r/${evil}`]: { teams: ['h'] } } }));
  assert.equal(u.page.element.querySelector('img'), null);
  assert.equal(u.fact('h', 'default'), `all souls of ${evil}`);
  assert.equal(u.fact('h', 'join'), `${evil} (r)`);
});

test('members: a "Members · N" head labels the list; a group\'s rows share its columns', async t => {
  const m = instance => ({ workspace: '/d', server: null, serverLabel: null, instance, agent: 'eng', agentsRoot: '/d/agents', home: `/d/agents/eng/instances/${instance}`,
    team: 'lfx-ai-team:acme.aweb.ai', running: true, addressable: true, missingRemotely: false, reason: null, deployment: { id: '/d', machine: '', path: '/d' } });
  const u = await mount(t, lfx(), async () => ({ members: [m('a'), m('b')], servers: [], notReached: [] }));
  await tick();
  const main = u.row('lfx-ai-team').querySelector('.ct-main'), head = main.querySelector('.ct-members-head'), list = main.querySelector('.ct-members');
  assert.equal(head.textContent, 'Members · 2');
  assert.equal(list.getAttribute('aria-labelledby'), head.id);
  assert.equal(main.lastElementChild, list);
  assert.ok(main.querySelector('.ct-address').compareDocumentPosition(head) & 4, 'below the address');
  assert.match(computerTeamsCSS, /\.computer-teams \.ct-member \{ display:grid; grid-column:1 \/ -1; grid-template-columns:subgrid;/);
});
