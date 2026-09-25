// Team controls on a live instance (teams contract 2026-09-25, e60b4f7c): the
// messaging provider's declared home operations messaging:teams|join|leave,
// through the real kernel's `oats operation run`. Kernel captures:
// test/fixtures/workspace-v2/teams (Northwind + the stand-in nw.teams provider;
// provenance.json `standIn`). Recaptured from oats.aweb 1.14.0 when it lands.
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
// A stateful answer from the captured documents (the stand-in's own join/leave sequence).
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
  assert.deepEqual(ops, { provider: 'nw.teams', supported: true, teams: { address: 'messaging:teams', available: true, reason: null },
    join: { address: 'messaging:join', available: true, reason: null, arg: 'labels' }, leave: { address: 'messaging:leave', available: true, reason: null, arg: 'labels' } });
  const without = inspection(); without.capabilities.find(c => c.layer === 'messaging').operations = [];
  assert.deepEqual(teamsOperations(without), { provider: 'nw.teams', supported: false });
  const none = inspection(); for (const c of none.capabilities) if (c.layer === 'messaging') c.layer = null;
  assert.equal(teamsOperations(none), null, 'no messaging provider: no Teams section');
  const twoArgs = inspection(); twoArgs.capabilities.find(c => c.layer === 'messaging').operations.find(o => o.name === 'join').args.push({ name: 'team', flag: '--team', required: true });
  assert.equal(teamsOperations(twoArgs).join.arg, null, 'an argument shape the Desktop cannot fill is not guessed');
  const soul = fx('inspect-soul').result, onSoul = teamsOperations(soul);
  assert.equal(onSoul.teams.available, false); assert.match(onSoul.teams.reason, /needs a running home/);
});

test('the teams document is decoded strictly: exactly the contract fields, bounded, for exactly the operation run', () => {
  assert.deepEqual(teamsDocument(run('teams-initial'), 'messaging:teams'), run('teams-initial').result);
  const joined = teamsDocument(run('join-reviewers'), 'messaging:join');
  assert.deepEqual(joined.joined.map(j => [j.label, j.receive]), [['dev', 'poll'], ['reviewers', 'native']]);
  assert.ok(joined.joined.every(j => j.identityHome === `${HOME}/.aweb-identity-${j.label}`));
  assert.equal(teamsDocument(run('teams-initial'), 'messaging:join'), null, 'another operation');
  const doc = () => structuredClone(run('join-reviewers'));
  for (const [label, mutate] of [['operationsApi 1', v => { v.operationsApi = 1; }], ['extra key', v => { v.result.extra = 1; }], ['missing at', v => { delete v.result.at; }],
    ['personal extra', v => { v.result.personal.alias = 'x'; }], ['eligible extra', v => { v.result.eligible[0].mapped = true; }],
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

test('an instance shows its teams: personal always on (no Leave), eligible with Join, unmapped unavailable; one control per verb', async t => {
  const u = await mount(t, captured());
  assert.deepEqual(u.runs(), [{ action: 'run', selector: { home: HOME }, operation: 'messaging:teams' }]);
  assert.equal(u.panel().querySelector('h3').textContent, 'Teams');
  const personal = u.row('personal');
  assert.match(personal.textContent, /Personal team.*personal:northwind:alice.*Always on/s); assert.equal(personal.querySelector('.team-badge').title, "The personal team can't be left.");
  assert.equal(personal.querySelector('button'), null, 'the personal team has no Leave');
  assert.equal(u.row('dev').querySelector('.team-name').textContent, 'dev · primary');
  assert.equal(u.row('dev').querySelector('[data-team-action]').textContent, 'Join');
  assert.equal(u.row('reviewers').querySelector('[data-team-action]').textContent, 'Join');
  assert.match(u.row('marketing').textContent, /Not mapped by this workspace.*Unavailable/); assert.equal(u.row('marketing').querySelector('button'), null);
  // The generic Provider operations list leaves the three team verbs to the panel.
  assert.equal([...u.el.querySelectorAll('[data-operation]')].some(b => b.dataset.operation.startsWith('messaging:')), false);
  assert.doesNotMatch([...u.el.querySelectorAll('.inspector-cap h4')].map(h => h.textContent).join('|'), /messaging: (teams|join|leave)/);
});

test('Join and Leave run the declared operation with the declared argument; poll teams never read as live delivery', async t => {
  const u = await mount(t, captured());
  await u.press('join', 'dev');
  assert.deepEqual(u.runs().at(-1), { action: 'run', selector: { home: HOME }, operation: 'messaging:join', args: { labels: 'dev' } });
  assert.match(u.row('dev').textContent, /Joined 2026-09-25 10:00 UTC/); assert.equal(u.row('dev').querySelector('.team-meta[title]').title, '2026-09-25T10:00:00.000Z');
  assert.match(u.row('dev').textContent, /Checks this team's mail between tasks/);
  assert.doesNotMatch(u.row('dev').textContent, /as it arrives|live/);
  assert.equal(u.row('dev').querySelector('details pre').textContent, `${HOME}/.aweb-identity-dev`);
  await u.press('join', 'reviewers');
  assert.match(u.row('reviewers').textContent, /Receives this team's mail as it arrives/);
  await u.press('leave', 'reviewers');
  assert.deepEqual(u.runs().at(-1).args, { labels: 'reviewers' }); assert.equal(u.runs().at(-1).operation, 'messaging:leave');
  assert.match(u.row('reviewers').textContent, /northwind:review · Not joined/);
  assert.equal(u.runs().filter(r => r.operation === 'messaging:teams').length, 1, 'join/leave answer the document: no second read');
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
  assert.match(u.row('marketing').textContent, /Not mapped by this workspace/);
  const gone = u.panel().querySelector('[data-team-refusal="marketing"]');
  assert.ok(gone, 'the refusal survives the re-read that removed its row');
  assert.equal(gone.querySelector('.teams-problem p').textContent, 'messaging:join: not eligible: marketing (eligible: dev, reviewers)');
  assert.equal(gone.querySelector('details summary').textContent, 'Details'); assert.equal(gone.querySelector('details pre').textContent, 'E_TEAM_NOT_ELIGIBLE');
  assert.match(gone.textContent, /marketing is no longer offered to this instance\./);
  assert.equal(u.panel().querySelector('.teams-card').firstElementChild, gone, 'said first, above the rows');
  // Cleared by an explicit Refresh …
  u.panel().querySelector('.teams-refresh').click(); await tick(); await tick();
  assert.equal(reads, 3); assert.equal(u.panel().querySelector('[data-team-refusal]'), null, 'Refresh clears it');
  // The captured personal refusal, on a Leave the provider refuses, reads the same way.
  const v = await mount(t, body => body.operation === 'messaging:teams' ? { ...run('join-dev'), operation: 'messaging:teams' } : refusal('leave-personal'));
  await v.press('leave', 'dev');
  const box = v.row('dev').querySelector('.teams-problem');
  assert.equal(box.querySelector('p').textContent, 'messaging:leave: the personal team cannot be left');
  assert.equal(box.querySelector('details summary').textContent, 'Details'); assert.equal(box.querySelector('details pre').textContent, 'E_TEAM_PERSONAL');
  assert.match(v.row('dev').textContent, /Joined 2026/, 'the last good state stays');
});

test('the not-eligible refusal names the eligible labels (captured) and is shown as relayed', async t => {
  const u = await mount(t, body => body.operation === 'messaging:teams' ? run('teams-initial') : refusal('join-not-eligible'));
  await u.press('join', 'reviewers');
  assert.equal(u.row('reviewers').querySelector('.teams-problem p').textContent, 'messaging:join: not eligible: marketing (eligible: dev, reviewers)');
});

test('states: not supported, unavailable, eligible none, unreadable and a failed read with Retry', async t => {
  const without = inspection(); without.capabilities.find(c => c.layer === 'messaging').operations = [];
  const a = await mount(t, () => assert.fail('no run'), { inspect: without });
  assert.equal(a.panel().textContent, 'TeamsNot supported by this messaging provider.'); assert.equal(a.runs().length, 0);
  const none = inspection(); for (const c of none.capabilities) if (c.layer === 'messaging') c.layer = null;
  const b = await mount(t, () => assert.fail('no run'), { inspect: none });
  assert.equal(b.panel(), null, 'no messaging provider: no Teams section');
  const off = inspection(); Object.assign(off.capabilities.find(c => c.layer === 'messaging').operations.find(o => o.name === 'teams'), { available: false, reason: 'the provider is not configured' });
  const c = await mount(t, () => assert.fail('no run'), { inspect: off });
  assert.match(c.panel().textContent, /the provider is not configured/);
  for (const [unmapped, sentence] of [[[], 'Personal team only: the soul names no wider team.'], [['marketing'], "None of this soul's teams is mapped by this workspace."]]) {
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
