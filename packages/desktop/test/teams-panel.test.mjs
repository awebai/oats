// Team controls on a live instance (teams contract 2026-09-25, 089cff5c): the
// messaging provider's declared home operations messaging:teams|join|leave,
// through the real kernel's `oats operation run`. Kernel captures:
// test/fixtures/workspace-v2/teams: Northwind + the REAL oats.aweb 1.16.0 (the 0.29.3
// pin), with a fake `aw` answering for the aweb server (provenance.json `provider`, `fakeAw`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSoulInspector } from '../renderer/soul-inspector.mjs';
import { teamsOperations, teamsDocument, receiveText, whenText } from '../renderer/teams-panel.mjs';
import { setWorkspace, currentWorkspace } from '../renderer/views/common.mjs';
import { cliCapability, operationArgs } from '../cli-adapter.mjs';
import { capabilityRequest } from '../server/capabilities.mjs';

const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/teams/${name}.json`, import.meta.url), 'utf8'));
const inspection = () => fx('inspect-home').result;
const HOME = inspection().subject.home;
const selection = (home = HOME) => ({ instance: { instance: home.split('/').pop(), home }, selector: { home } });
const run = name => fx(name).result;
/** The captured home inspection, as the kernel would report another home of the same soul. */
const inspectionFor = home => { const v = inspection(); if (home === HOME) return v;
  const instance = home.split('/').pop(); Object.assign(v.subject, { home, instance }); Object.assign(v.instance, { home, instance }); return v; };
const refusal = name => { const e = fx(name).error; return Object.assign(new Error(e.message), { code: e.code }); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

async function mount(t, answer, { inspect = inspection, available = () => true } = {}) {
  const previous = currentWorkspace(); setWorkspace('/team'); const calls = [];
  const dom = new JSDOM('<body><main><aside hidden></aside></main></body>'), el = dom.window.document.querySelector('aside');
  const inspector = createSoulInspector(el, { available, ctx: { api: async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push(body);
    if (body.action === 'inspect') return typeof inspect === 'function' ? inspect(body) : inspect;
    const out = await answer(body, calls); if (out instanceof Error) throw out; return out;
  } } });
  t.after(() => { inspector.dispose(); dom.window.close(); setWorkspace(previous); });
  await inspector.show(selection()); await tick();
  const panel = () => el.querySelector('.teams-panel');
  const row = label => panel().querySelector(`[data-team-row="${label}"]`);
  const press = async (verb, label) => { panel().querySelector(`[data-team-action="${verb}"][data-team="${label}"]`).click(); await tick(); };
  return { el, calls, inspector, panel, row, press, runs: () => calls.filter(c => c.action === 'run') };
}
// A stateful answer from the captured documents (the real provider's own join/leave sequence).
function captured() {
  let state = 'teams-initial';
  return body => {
    if (body.operation === 'messaging:teams') return run(state === 'teams-initial' ? 'teams-initial' : state);
    const label = body.args?.labels;
    if (body.operation === 'messaging:join' && label === 'dev') { state = 'join-dev'; return run('join-dev'); }
    if (body.operation === 'messaging:join' && label === 'reviewers') { state = 'join-reviewers'; return run('join-reviewers'); }
    if (body.operation === 'messaging:leave' && label === 'reviewers') { state = 'leave-reviewers'; return run('leave-reviewers'); }
    return refusal('join-not-eligible');
  };
}

test('the gate is what the provider declares: messaging:teams (+ join/leave and their one required argument), never a name or version', () => {
  const ops = teamsOperations(inspection());
  assert.deepEqual(ops, { provider: 'oats.aweb', supported: true, teams: { address: 'messaging:teams', available: true, reason: null },
    join: { address: 'messaging:join', available: true, reason: null, arg: 'labels' }, leave: { address: 'messaging:leave', available: true, reason: null, arg: 'labels' } });
  const without = inspection(); without.capabilities.find(c => c.layer === 'messaging').operations = [];
  assert.deepEqual(teamsOperations(without), { provider: 'oats.aweb', supported: false });
  const none = inspection(); for (const c of none.capabilities) if (c.layer === 'messaging') c.layer = null;
  assert.equal(teamsOperations(none), null, 'no messaging provider: no Teams section');
  const twoArgs = inspection(); twoArgs.capabilities.find(c => c.layer === 'messaging').operations.find(o => o.name === 'join').args.push({ name: 'team', flag: '--team', required: true });
  assert.equal(teamsOperations(twoArgs).join.arg, null, 'an argument shape the Desktop cannot fill is not guessed');
  const soul = fx('inspect-soul').result, onSoul = teamsOperations(soul);
  assert.equal(onSoul.teams.available, false); assert.match(onSoul.teams.reason, /needs a running home/);
});

test('the teams document is decoded strictly: exactly the contract fields, bounded, for exactly the operation run', () => {
  assert.deepEqual(teamsDocument(run('teams-initial'), 'messaging:teams'), run('teams-initial').result);
  const joined = teamsDocument(run('join-reviewers'), 'messaging:join', { actions: true });
  assert.deepEqual(joined.joined.map(j => [j.label, j.receive]), [['dev', 'native'], ['reviewers', 'native']], 'session delivery: both native');
  assert.deepEqual(joined.actions, [{ action: 'join', label: 'reviewers' }], 'the real answer says what it did');
  assert.equal(teamsDocument(run('join-reviewers'), 'messaging:join'), null, 'actions are accepted on join/leave answers only');
  assert.equal(teamsDocument({ ...run('teams-initial'), result: { ...run('teams-initial').result, actions: [] } }, 'messaging:teams', { actions: false }), null, 'never on a read');
  const left = teamsDocument(run('leave-reviewers'), 'messaging:leave', { actions: true });
  assert.deepEqual(left.actions.map(a => [a.action, a.label, a.released]), [['leave', 'reviewers', 'released']]);
  assert.equal(left.actions[0].receipt.alias_released, true, 'the receipt is kept as sent (opaque; never shown)');
  // oats.aweb's join/leave rows may carry a non-fatal warning (provider bin/oats-aweb.mjs actions rows);
  // derived scenario on the real leave answer until the 1.17 capture exists.
  const warned = structuredClone(run('leave-reviewers')); warned.result.actions[0].warning = 'oats-aweb: team reviewers left, but its alias was not released; rerun `oats operation run messaging:leave`';
  assert.equal(teamsDocument(warned, 'messaging:leave', { actions: true }).actions[0].warning, warned.result.actions[0].warning, 'a warning is kept as worded');
  const acted = () => structuredClone(run('leave-reviewers'));
  for (const [what, mutate] of [['action verb', v => { v.result.actions[0].action = 'rejoin'; }], ['action label shape', v => { v.result.actions[0].label = 'a b'; }],
    ['action label not a row', v => { v.result.actions[0].label = 'marketing'; }], ['action extra key', v => { v.result.actions[0].note = 'x'; }],
    ['released not text', v => { v.result.actions[0].released = true; }], ['receipt not a record', v => { v.result.actions[0].receipt = 'ok'; }],
    ['receipt oversized', v => { v.result.actions[0].receipt = { blob: 'x'.repeat(5000) }; }], ['actions not a list', v => { v.result.actions = {}; }],
    ['warning not text', v => { v.result.actions[0].warning = { x: 1 }; }], ['warning control char', v => { v.result.actions[0].warning = 'a\nb'; }],
    ['warning empty', v => { v.result.actions[0].warning = ''; }], ['warning oversized', v => { v.result.actions[0].warning = 'w'.repeat(1025); }],
    ['too many actions', v => { v.result.actions = Array.from({ length: 65 }, () => ({ action: 'leave', label: 'reviewers' })); }]]) {
    const v = acted(); mutate(v); assert.equal(teamsDocument(v, 'messaging:leave', { actions: true }), null, what);
  }
  assert.ok(joined.joined.every(j => j.identityHome === `${HOME}/.aweb-identity-${j.label}`));
  assert.equal(teamsDocument(run('teams-initial'), 'messaging:join'), null, 'another operation');
  const doc = () => structuredClone(run('join-reviewers'));
  for (const [label, mutate] of [['operationsApi 1', v => { v.operationsApi = 1; }], ['extra key', v => { v.result.extra = 1; }], ['missing at', v => { delete v.result.at; }],
    ['defaultTeam extra', v => { v.result.defaultTeam.alias = 'x'; }], ['defaultTeam without team', v => { delete v.result.defaultTeam.team; }],
    ['defaultTeam without source', v => { delete v.result.defaultTeam.source; }], ['source outside the set', v => { v.result.defaultTeam.source = 'personal'; }],
    ['source not text', v => { v.result.defaultTeam.source = 1; }], ['source from the prototype', v => { v.result.defaultTeam.source = 'toString'; }],
    ['1.15 personal', v => { v.result.personal = v.result.defaultTeam; delete v.result.defaultTeam; }], ['eligible extra', v => { v.result.eligible[0].mapped = true; }],
    ['joined without receive', v => { delete v.result.joined[0].receive; }], ['joined without identityHome', v => { delete v.result.joined[0].identityHome; }],
    ['relative identityHome', v => { v.result.joined[0].identityHome = 'home/.aweb-identity-dev'; }], ['control character', v => { v.result.joined[0].since = 'a\nb'; }],
    ['label shape', v => { v.result.unmapped = ['-x']; }], ['duplicate eligible', v => { v.result.eligible.push(v.result.eligible[0]); }],
    ['oversized', v => { v.result.unmapped = Array.from({ length: 65 }, (_, i) => `l${i}`); }], ['joined not boolean', v => { v.result.eligible[0].joined = 'yes'; }],
    ['primary shape', v => { v.result.primary = 'a b'; }]]) {
    const v = doc(); mutate(v); assert.equal(teamsDocument(v, 'messaging:join'), null, label);
  }
  assert.equal(receiveText('poll'), "checks this team's mail between tasks");
  assert.equal(receiveText('native'), "receives this team's mail as it arrives");
  assert.equal(receiveText('push-later'), 'receive: push-later', 'an unrecognised receive is shown as sent, never as live');
  assert.equal(whenText('2026-09-25T10:01:00.000Z'), '2026-09-25 10:01 UTC'); assert.equal(whenText('yesterday'), 'yesterday', 'not a timestamp: as sent');
});

test('the default team says where it comes from: "setting" (settings.oats.aweb.team named it) in words', async t => {
  const set = structuredClone(run('teams-initial')); set.result.defaultTeam.source = 'setting';
  assert.deepEqual(teamsDocument(set, 'messaging:teams').defaultTeam, { team: 'default:northwind:alice', source: 'setting' });
  const u = await mount(t, () => set);
  assert.equal(u.row('default').querySelector('.team-meta').textContent, 'default:northwind:alice · set by the workspace or host setting');
});

test('an instance shows its teams: the workspace\'s default team always on (no Leave), the teams its soul has access to with Join, unmapped not shown; one control per verb', async t => {
  const u = await mount(t, captured());
  assert.deepEqual(u.runs(), [{ action: 'run', selector: { home: HOME }, operation: 'messaging:teams' }]);
  assert.equal(u.panel().previousElementSibling.textContent, 'Teams', 'the inspector labels the section'); assert.equal(u.panel().querySelector('h3'), null);
  const home = u.row('default');
  assert.equal(home.querySelector('.team-meta').textContent, "default:northwind:alice · the messaging root's active team", 'source "root", in words');
  assert.match(home.textContent, /Default team.*default:northwind:alice.*Always on/s); assert.equal(home.querySelector('.team-badge').title, "The default team can't be left.");
  assert.equal(home.querySelector('button'), null, 'the default team has no Leave');
  assert.equal(u.row('dev').querySelector('.team-name').textContent, 'dev', 'no "primary" marker (team model v2: there is no primary)');
  assert.equal(u.row('dev').querySelector('[data-team-action]').textContent, 'Join');
  assert.equal(u.row('reviewers').querySelector('[data-team-action]').textContent, 'Join');
  assert.equal(u.row('marketing'), null, 'an unmapped label is not shown');
  assert.equal(u.panel().querySelector('.teams-intro').textContent, "Always in the workspace's default team. It can join the teams its soul has access to.");
  // The generic Provider operations list leaves the three team verbs to the panel.
  assert.equal([...u.el.querySelectorAll('[data-operation]')].some(b => b.dataset.operation.startsWith('messaging:')), false);
  assert.doesNotMatch([...u.el.querySelectorAll('.inspector-cap h4')].map(h => h.textContent).join('|'), /messaging: (teams|join|leave)/);
});

test('Join and Leave run the declared operation with the declared argument and repaint from the real answer (with its actions); poll teams never read as live delivery', async t => {
  const u = await mount(t, captured());
  await u.press('join', 'dev');
  assert.deepEqual(u.runs().at(-1), { action: 'run', selector: { home: HOME }, operation: 'messaging:join', args: { labels: 'dev' } });
  const since = run('join-dev').result.joined[0].since;
  assert.match(u.row('dev').textContent, new RegExp(`Joined ${whenText(since)}`)); assert.equal(u.row('dev').querySelector('.team-meta[title]').title, since);
  assert.equal(u.panel().querySelector('.teams-status').textContent, '', 'a successful join is not "unreadable"');
  assert.match(u.row('dev').textContent, /Receives this team's mail as it arrives/);
  assert.equal(u.row('dev').querySelector('details pre').textContent, `${HOME}/.aweb-identity-dev`);
  await u.press('join', 'reviewers');
  assert.match(u.row('reviewers').textContent, /Receives this team's mail as it arrives/);
  await u.press('leave', 'reviewers');
  assert.deepEqual(u.runs().at(-1).args, { labels: 'reviewers' }); assert.equal(u.runs().at(-1).operation, 'messaging:leave');
  assert.match(u.row('reviewers').textContent, /northwind:review · Not joined/);
  assert.equal(u.runs().filter(r => r.operation === 'messaging:teams').length, 1, 'join/leave answer the document: no second read');  // The rule for a poll team, on the captured answer with only its receive changed (session delivery reports native).
  const poll = structuredClone(run('join-dev')); poll.result.joined[0].receive = 'poll';
  const p = await mount(t, body => body.operation === 'messaging:teams' ? run('teams-initial') : poll);
  await p.press('join', 'dev');
  assert.match(p.row('dev').textContent, /Checks this team's mail between tasks/); assert.doesNotMatch(p.row('dev').textContent, /as it arrives|live/);
});

// oats.aweb's join/leave rows may carry a non-fatal `warning` (#281: kept by the decoder, the
// provider's own words). On the captured leave answer with only a warning added, until the real
// 1.17 capture pins one: shown under its team's row, verbatim, as a warning; the next read clears it.
test('a join/leave warning is shown under its row, verbatim, as a warning (not a refusal); the next read clears it', async t => {
  const words = 'oats-aweb: team reviewers left, but its alias was not released; rerun `oats operation run messaging:leave` <b>now</b>';
  const answer = captured();
  const u = await mount(t, body => { const out = answer(body); if (body.operation !== 'messaging:leave') return out;
    const warned = structuredClone(out); warned.result.actions[0].warning = words; return warned; });
  await u.press('join', 'reviewers');
  assert.equal(u.panel().querySelector('.teams-warning'), null, 'no warning, nothing said');
  await u.press('leave', 'reviewers');
  const box = u.row('reviewers').querySelector('.teams-warning');
  assert.ok(box, 'said on the row the action names');
  assert.equal(box.getAttribute('role'), 'status', 'announced politely: the leave happened');
  assert.equal(box.dataset.teamWarningFor, 'reviewers');
  assert.equal(box.querySelector('.teams-warning-head').textContent, 'Left, with a warning from the messaging provider:');
  assert.equal(box.querySelector('.teams-warning-text').textContent, words, 'verbatim');
  assert.equal(box.querySelector('b'), null, 'as text, never markup');
  assert.match(u.row('reviewers').textContent, /northwind:review · Not joined/, 'the leave itself is shown as done');
  assert.equal(u.panel().querySelectorAll('.teams-warning').length, 1, 'only on its own row');
  assert.equal(u.panel().querySelector('.teams-status').textContent, '', 'not an error');
  u.panel().querySelector('.teams-refresh').click(); await tick(); await tick();
  assert.equal(u.panel().querySelector('.teams-warning'), null, 'a read has no actions: Refresh clears it');
  // A join warning reads "Joined".
  const joined = structuredClone(run('join-dev')); joined.result.actions[0].warning = 'joined without live delivery';
  const j = await mount(t, body => body.operation === 'messaging:teams' ? run('teams-initial') : joined);
  await j.press('join', 'dev');
  assert.equal(j.row('dev').querySelector('.teams-warning-head').textContent, 'Joined, with a warning from the messaging provider:');
  assert.equal(j.row('dev').querySelector('.teams-warning').lastElementChild.textContent, 'joined without live delivery');
});

// oats.aweb 1.17's teams document (#284): eligible rows' `from` (shared|local) and top-level
// `warnings[]`. A STAND-IN on the real 1.16 capture (as team-model-v2-tolerance does) until the
// 1.17 capture exists: `from` reads in Workspace › Teams' words; warnings show verbatim, above the rows.
test("1.17: an eligible team says whether it is shared or local; the provider's warnings show verbatim above the rows; absent says nothing", async t => {
  const v117 = structuredClone(run('teams-initial'));
  v117.result.eligible = v117.result.eligible.map((e, i) => ({ ...e, from: i === 0 ? 'local' : 'shared' }));
  v117.result.warnings = ['oats-aweb: team reviewers has no provider id yet', 'oats-aweb: <i>second</i> warning'];
  const u = await mount(t, () => v117);
  assert.match(u.row('dev').textContent, /northwind:eng · local · Not joined/);
  assert.match(u.row('reviewers').textContent, /northwind:review · shared · Not joined/);
  const box = u.panel().querySelector('.teams-warnings .teams-warning');
  assert.equal(box.getAttribute('role'), 'status');
  assert.equal(box.querySelector('.teams-warning-head').textContent, 'Warnings from the messaging provider:');
  assert.deepEqual([...box.querySelectorAll('.teams-warning-text')].map(p => p.textContent), v117.result.warnings, 'verbatim, in order');
  assert.equal(box.querySelector('i'), null, 'as text, never markup');
  assert.equal(u.panel().querySelector('.teams-card').firstElementChild, box.parentElement, 'said first, above the default team');
  assert.equal(u.panel().querySelector('.teams-status').textContent, '', 'not an error');
  // One warning reads in the singular; a joined row keeps its from too.
  const joined = structuredClone(run('join-dev')); joined.result.eligible = joined.result.eligible.map(e => ({ ...e, from: 'shared' })); joined.result.warnings = ['only one'];
  const j = await mount(t, body => body.operation === 'messaging:teams' ? v117 : joined);
  await j.press('join', 'dev');
  assert.match(j.row('dev').textContent, /northwind:eng · shared · Joined 2026/);
  assert.equal(j.panel().querySelector('.teams-warning-head').textContent, 'A warning from the messaging provider:');
  // The 1.16 capture has neither: no from word, no warnings.
  const old = await mount(t, () => run('teams-initial'));
  assert.match(old.row('dev').textContent, /northwind:eng · Not joined/);
  assert.equal(old.panel().querySelector('.teams-warnings'), null);
});

test('while a team action runs, it reads Joining… and every team control is locked', async t => {
  const gate = deferred(), answer = captured();
  const u = await mount(t, body => body.operation === 'messaging:join' ? gate.promise.then(() => answer(body)) : answer(body));
  await u.press('join', 'dev');
  assert.equal(u.row('dev').querySelector('[data-team-action]').textContent, 'Joining…');
  assert.ok([...u.panel().querySelectorAll('button')].every(b => b.disabled), 'all team controls and Refresh are locked');
  gate.resolve(); await tick(); await tick();
  assert.equal(u.row('dev').querySelector('[data-team-action]').textContent, 'Leave');
  assert.ok([...u.panel().querySelectorAll('button')].every(b => !b.disabled));
});

test('a refusal is shown verbatim under its row, the code behind Details; the panel keeps its state and re-reads', async t => {
  const stale = structuredClone(run('teams-initial')); stale.result.eligible.push({ label: 'marketing', team: 'northwind:marketing', joined: false }); stale.result.unmapped = [];
  let reads = 0;
  const u = await mount(t, body => body.operation === 'messaging:teams' ? (reads++ === 0 ? stale : run('teams-initial')) : refusal('join-not-eligible'));
  await u.press('join', 'marketing'); await tick();
  assert.equal(reads, 2, 'refused → the provider is asked again');
  // The re-read no longer offers marketing (unmapped now): the refusal is said at panel level, not dropped.
  assert.equal(u.row('marketing'), null, 'unmapped: not shown');
  const gone = u.panel().querySelector('[data-team-refusal="marketing"]');
  assert.ok(gone, 'the refusal survives the re-read that removed its row');
  assert.equal(gone.querySelector('.teams-problem p').textContent, 'messaging:join: E_TEAM_NOT_ELIGIBLE: marketing is not an eligible team label for this instance (eligible: dev, reviewers)');
  assert.equal(gone.querySelector('details summary').textContent, 'Details'); assert.equal(gone.querySelector('details pre').textContent, 'E_TEAM_NOT_ELIGIBLE');
  assert.match(gone.textContent, /marketing is no longer offered to this instance\./);
  assert.equal(u.panel().querySelector('.teams-card').firstElementChild, gone, 'said first, above the rows');
  // Cleared by an explicit Refresh …
  u.panel().querySelector('.teams-refresh').click(); await tick(); await tick();
  assert.equal(reads, 3); assert.equal(u.panel().querySelector('[data-team-refusal]'), null, 'Refresh clears it');
  // The captured default-team refusal, on a Leave the provider refuses, reads the same way.
  const v = await mount(t, body => body.operation === 'messaging:teams' ? { ...run('join-dev'), operation: 'messaging:teams', result: (({ actions, ...doc }) => doc)(run('join-dev').result) } : refusal('leave-default'));
  await v.press('leave', 'dev');
  const box = v.row('dev').querySelector('.teams-problem');
  assert.equal(box.querySelector('p').textContent, "messaging:leave: E_TEAM_DEFAULT: default is the workspace's default team and cannot be left");
  assert.equal(box.querySelector('details summary').textContent, 'Details'); assert.equal(box.querySelector('details pre').textContent, 'E_TEAM_DEFAULT');
  assert.match(v.row('dev').textContent, /Joined 2026/, 'the last good state stays');
});

test('the not-eligible refusal names the eligible labels (captured) and is shown as relayed', async t => {
  const u = await mount(t, body => body.operation === 'messaging:teams' ? run('teams-initial') : refusal('join-not-eligible'));
  await u.press('join', 'reviewers');
  assert.equal(u.row('reviewers').querySelector('.teams-problem p').textContent, 'messaging:join: E_TEAM_NOT_ELIGIBLE: marketing is not an eligible team label for this instance (eligible: dev, reviewers)');
});

test('states: not supported, unavailable, eligible none, unreadable and a failed read with Retry', async t => {
  const without = inspection(); without.capabilities.find(c => c.layer === 'messaging').operations = [];
  const a = await mount(t, () => assert.fail('no run'), { inspect: without });
  assert.equal(a.panel().textContent, 'Not supported by this messaging provider.'); assert.equal(a.runs().length, 0);
  const none = inspection(); for (const c of none.capabilities) if (c.layer === 'messaging') c.layer = null;
  const b = await mount(t, () => assert.fail('no run'), { inspect: none });
  assert.equal(b.panel(), null, 'no messaging provider: no Teams section');
  const off = inspection(); Object.assign(off.capabilities.find(c => c.layer === 'messaging').operations.find(o => o.name === 'teams'), { available: false, reason: 'the provider is not configured' });
  const c = await mount(t, () => assert.fail('no run'), { inspect: off });
  assert.match(c.panel().textContent, /the provider is not configured/);
  for (const [unmapped, sentence] of [[[], 'Its soul has access to no other team.'], [['marketing'], 'Its soul has access to no other team.']]) {
    const empty = structuredClone(run('teams-initial')); empty.result.eligible = []; empty.result.primary = null; empty.result.unmapped = unmapped;
    const d = await mount(t, () => empty); assert.match(d.panel().textContent, new RegExp(sentence.replace(/[.']/g, '.')));
  }
  const classic = await mount(t, () => ({ ...run('teams-initial'), operationsApi: 1 }));
  assert.match(classic.panel().querySelector('.teams-status').textContent, /classic layout/);
  const bad = await mount(t, () => ({ ...run('teams-initial'), operation: 'messaging:join' }));
  assert.match(bad.panel().querySelector('.teams-status').textContent, /cannot read/);
  let first = true;
  const e = await mount(t, () => { if (first) { first = false; return Object.assign(new Error('aw is not signed in'), { code: 'E_OPERATION_FAILED' }); } return run('teams-initial'); });
  assert.equal(e.panel().querySelector('.teams-problem p').textContent, 'aw is not signed in');
  e.panel().querySelector('.teams-card button').click(); await tick(); await tick();
  assert.equal(e.panel().querySelector('.teams-problem'), null); assert.ok(e.row('dev'));
});

test('a soul shows no Teams section (home operations), and without a compatible CLI team actions are disabled', async t => {
  const u = await mount(t, () => assert.fail('no run'), { inspect: fx('inspect-soul').result });
  await u.inspector.show({ agent: { name: 'release-manager', agentsRoot: '/fixture/base/northwind-workspace/agents' }, selector: { soul: 'release-manager', agentsRoot: '/fixture/base/northwind-workspace/agents' } }); await tick();
  assert.equal(u.panel(), null);
  let cli = true; const v = await mount(t, captured(), { available: () => cli });
  assert.ok([...v.panel().querySelectorAll('[data-team-action]')].every(b => !b.disabled));
  cli = false; v.inspector.syncAvailability();
  assert.ok([...v.panel().querySelectorAll('button')].every(b => b.disabled), 'the CLI went away: team actions and Refresh are disabled');
  await v.press('join', 'dev'); assert.equal(v.runs().some(r => r.operation === 'messaging:join'), false, 'a disabled control runs nothing');
});

for (const outcome of ['resolve', 'reject']) test(`a stale teams read or team action (${outcome}) never paints over the newer selection`, async t => {
  const reads = [], joins = [], answer = captured();
  const u = await mount(t, body => {
    if (body.operation === 'messaging:teams' && reads.length === 0) { const d = deferred(); reads.push(d); return d.promise; }
    if (body.operation === 'messaging:join') { const d = deferred(); joins.push(d); return d.promise; }
    return answer(body);
  }, { inspect: body => inspectionFor(body.selector.home) });
  // Pending first read, then the user selects another instance: the obsolete
  // section is neither painted nor re-armed (ownership on success AND rejection).
  const first = u.panel(), firstText = first.textContent;
  await u.inspector.show(selection(`${HOME}-2`)); await tick();
  outcome === 'resolve' ? reads[0].resolve({ ...run('join-reviewers'), operation: 'messaging:teams' }) : reads[0].reject(Object.assign(new Error('obsolete'), { code: 'E_OLD' })); await tick();
  assert.equal(first.textContent, firstText, 'the obsolete section is not painted');
  assert.doesNotMatch(u.panel().textContent, /Joined|obsolete/);
  // A pending join, then the inspector is shown again: its answer is ignored.
  await u.press('join', 'dev'); assert.equal(joins.length, 1);
  const second = u.panel(), secondText = second.textContent;
  await u.inspector.show(selection()); await tick();
  const before = u.runs().length;
  outcome === 'resolve' ? joins[0].resolve(run('join-dev')) : joins[0].reject(refusal('join-not-eligible')); await tick(); await tick();
  assert.equal(second.textContent, secondText, 'the obsolete section keeps its pending state');
  assert.equal(u.runs().length, before, 'an obsolete refusal does not re-read');
  assert.doesNotMatch(u.panel().textContent, /Joined|not eligible/);
  assert.equal(u.row('dev').querySelector('[data-team-action]').textContent, 'Join');
});

test('operation arguments: only a bounded record travels, as --arg name=value, and only with a run', async () => {
  assert.deepEqual(operationArgs({ labels: 'dev,reviewers' }), ['--arg', 'labels=dev,reviewers']);
  for (const bad of [null, [], 'labels=dev', { Labels: 'dev' }, { labels: '' }, { labels: 'a\nb' }, { labels: 1 }, Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`a${i}`, 'x']))])
    assert.equal(operationArgs(bad), null, JSON.stringify(bad));
  const seen = [];
  await cliCapability('/fixture/oats', { action: 'run', home: HOME, operation: 'messaging:join', args: { labels: 'dev' } },
    { exec: (bin, argv, _opts, cb) => { seen.push(argv); cb(null, JSON.stringify({ schemaVersion: 1, ok: true, result: run('join-dev') })); } });
  assert.deepEqual(seen[0], ['operation', 'run', 'messaging:join', '--arg', 'labels=dev', '--home', HOME, '--json']);
  await assert.rejects(cliCapability('/fixture/oats', { action: 'inspect', home: HOME, args: { labels: 'dev' } }, { exec: assert.fail }), { code: 'E_BAD_ARGS' });
  await assert.rejects(cliCapability('/fixture/oats', { action: 'run', home: HOME, operation: 'messaging:join', args: { labels: 'a\nb' } }, { exec: assert.fail }), { code: 'E_BAD_ARGS' });
  const invoked = [];
  const options = { workspace: { id: '/team', scope: '/team' }, cli: { ok: true, bin: '/fixture/oats', operationsApi: 2 }, instances: [{ home: HOME }],
    invoke: async (bin, o) => { invoked.push(o); return { ok: true, result: run('join-dev') }; } };
  await capabilityRequest({ action: 'run', selector: { home: HOME }, operation: 'messaging:join', args: { labels: 'dev' } }, options);
  assert.deepEqual(invoked[0].args, { labels: 'dev' }); assert.equal(invoked[0].operation, 'messaging:join');
  await capabilityRequest({ action: 'run', selector: { home: HOME }, operation: 'messaging:teams' }, options);
  assert.equal(Object.hasOwn(invoked[1], 'args'), false, 'no args: none sent');
  await assert.rejects(capabilityRequest({ action: 'inspect', selector: { home: HOME }, args: { labels: 'dev' } }, options), /Invalid operation arguments/);
  await assert.rejects(capabilityRequest({ action: 'run', selector: { home: HOME }, operation: 'messaging:join', args: { labels: ['dev'] } }, options), /Invalid operation arguments/);
});

test('a refusal whose row disappears is cleared by the next team action, not by the automatic re-read', async t => {
  const stale = structuredClone(run('teams-initial')); stale.result.eligible.push({ label: 'marketing', team: 'northwind:marketing', joined: false }); stale.result.unmapped = [];
  let reads = 0; const answer = captured();
  const u = await mount(t, body => body.operation === 'messaging:teams' ? (reads++ === 0 ? stale : run('teams-initial'))
    : body.args?.labels === 'marketing' ? refusal('join-not-eligible') : answer(body));
  await u.press('join', 'marketing'); await tick();
  assert.ok(u.panel().querySelector('[data-team-refusal="marketing"]'), 'kept across the automatic re-read');
  await u.press('join', 'dev'); await tick();
  assert.equal(u.panel().querySelector('[data-team-refusal]'), null, 'the next action clears it');
  assert.match(u.row('dev').textContent, /Joined 2026/);
});

// Team model v2 (0.30, D2): the teams this instance LEFT on a live read (left[], oats.aweb 1.17;
// K1's shapes doc, feat/030-team-model 8dd82158), on the real captured document plus left[]
// until the 1.17 capture exists. Newest first, with the time and the reason in words.
test('left entries: "Recently left", newest first, each with its team, when, and why; no action on them', async t => {
  const withLeft = structuredClone(run('teams-initial'));
  withLeft.result.left = [{ label: 'reviewers', team: 'northwind:review', at: '2026-09-27T09:00:00.000Z', reason: 'no-longer-eligible' },
    { label: 'ops', team: 'northwind:ops', at: '2026-09-27T11:30:00.000Z', reason: 'no-longer-eligible' },
    { label: 'legacy', team: 'northwind:legacy', at: '2026-09-26T08:00:00.000Z', reason: 'provider-moved' }];
  const u = await mount(t, () => withLeft);
  const head = u.panel().querySelector('.teams-subhead');
  assert.equal(head.textContent, 'Recently left');
  const left = [...u.panel().querySelectorAll('[data-team-left]')];
  assert.deepEqual(left.map(r => r.dataset.teamLeft), ['ops', 'reviewers', 'legacy'], 'newest first');
  assert.deepEqual([...left[0].querySelectorAll('.team-meta')].map(m => m.textContent), ['northwind:ops · Left 2026-09-27 11:30 UTC', 'The soul no longer belongs to it.']);
  assert.equal(left[0].querySelector('.team-meta').title, '2026-09-27T11:30:00.000Z', 'the exact time on hover');
  assert.equal(left[2].querySelectorAll('.team-meta')[1].textContent, 'reason: provider-moved', 'an unknown reason is shown as sent');
  assert.ok(left.every(r => !r.querySelector('button')), 'nothing to do on a left team');
  assert.equal(head.previousElementSibling.dataset.teamRow, 'reviewers', 'after the current teams');
  const none = await mount(t, captured());
  assert.equal(none.panel().querySelector('.teams-subhead'), null, 'no left[]: no section');
});

test('receive "live" (oats.aweb 1.17) reads as live delivery; "poll" never does', () => {
  assert.equal(receiveText('live'), "receives this team's mail as it arrives");
  assert.equal(receiveText('poll'), "checks this team's mail between tasks");
});

test("v2 default row: the kernel's DefaultTeam by label, with its id and where it was set; unmapped is a blocking problem; none configured says what to do", async t => {
  const v2 = defaultTeam => { const d = structuredClone(run('teams-initial')); delete d.result.primary; delete d.result.unmapped; d.result.defaultTeam = defaultTeam; return d; };
  const deployment = await mount(t, () => v2({ label: 'antares-oats', team: 'antares-oats:juan.aweb.ai', from: 'deployment' }));
  const row = deployment.row('default');
  assert.equal(row.querySelector('.team-name').textContent, 'Default team · antares-oats');
  assert.equal(row.querySelector('.team-meta').textContent, "antares-oats:juan.aweb.ai · this workspace's default on this computer");
  assert.equal(row.querySelector('.team-badge').title, "The default team can't be left.");
  // Unmapped (K1 addendum 4 + the lead's ruling): a blocking problem, not a membership: no "Always on".
  const unmapped = await mount(t, () => v2({ label: 'oats', team: null, from: 'soul' }));
  const blocked = unmapped.row('default');
  assert.equal(blocked.querySelector('.team-meta').textContent, "this soul's own default on this computer");
  assert.equal(blocked.querySelector('.team-badge'), null, 'no "Always on" for a team nothing can be in yet');
  assert.equal(blocked.querySelector('.teams-blocking').getAttribute('role'), 'alert');
  assert.deepEqual([...blocked.querySelectorAll('.teams-blocking p')].map(p => p.textContent), ['The default team oats has no provider id yet.',
    'Its owner runs oats aweb setup, then commits the id; or choose another default in Workspace › Teams (oats teams default).']);
  assert.equal(blocked.querySelector('button'), null, 'nothing to join or leave');
  const none = await mount(t, () => v2(null));
  assert.equal(none.row('default').querySelector('.team-meta').textContent, 'None configured on this computer: run oats aweb setup.');
  assert.equal(none.row('default').querySelector('.team-badge'), null, 'nothing to be always on');
  for (const u of [deployment, unmapped, none]) assert.doesNotMatch(u.panel().textContent, /primary|personal/i);
});
