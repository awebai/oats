import test from 'node:test';
import assert from 'node:assert/strict';
import { instanceActionTarget, sameInstanceActionTarget, spawnOpenDescriptor } from '../renderer/instance-action-target.mjs';
import { createInstancePrAction } from '../renderer/instance-pr-action.mjs';
import { instanceSplitPlan, instanceSplitIdentity } from '../renderer/instance-split.mjs';
import { fillEmptyGroup } from '../renderer/split-layout.mjs';
import { pullRequest } from '../renderer/forge-contract.mjs';
import { instance, target as gitTarget, state, pr, deferred, tick } from './helpers/forge-fixture.mjs';
const birth = '2026-09-23T00:00:00.000Z';
const row = () => ({ ...instance, createdAt: birth });
const target = () => instanceActionTarget('team', row());
const observationKey = 'e'.repeat(64);
const gitReply = () => ({ instanceGitApi: 1, minimumVersion: '0.24.7', status: 'available', target: gitTarget, data: state(), observationKey, reason: null });
const forgeReply = () => ({ forgeApi: 1, status: 'available', target: gitTarget, observation: { key: observationKey, revision: state().observation.revision, branch: state().observation.branch },
  host: 'github.com', repository: 'owner/repo', data: pullRequest(pr(), { host: 'github.com', path: 'owner/repo', branch: 'feat/a' }), reason: null });
function reader(read) {
  let generation = 0, connection = 0, intent = 0, selected = row(); const calls = [], reports = [], urls = [];
  const ctrl = createInstancePrAction({ ctx: { api: async (url, opts) => { const body = JSON.parse(opts.body); calls.push({ url, body, method: opts.method }); return read ? read(url, body) : url.startsWith('/api/instance-git') ? gitReply() : forgeReply(); } },
    beginIntent: () => { const token = ++intent; return () => token === intent; }, currentTarget: t => sameInstanceActionTarget(t, selected, 'team'),
    generation: () => generation, connectionGeneration: () => connection, report: m => reports.push(m), openExternal: url => urls.push(url) });
  return { ctrl, calls, reports, urls, bump: kind => { if (kind === 'workspace') generation++; if (kind === 'connection') connection++; if (kind === 'selection') intent++; if (kind === 'birth') selected = { ...selected, createdAt: '2026-09-24T00:00:00.000Z' }; if (kind === 'removed') selected = {}; if (kind === 'dispose') ctrl.dispose(); } };
}
test('inert target and spawn descriptor are copied, birth-required and never contain commands/IPC/path overrides', () => {
  const t = target(); assert.ok(t); assert.equal(sameInstanceActionTarget(t, row(), 'team'), true);
  assert.equal(sameInstanceActionTarget(t, { ...row(), createdAt: '2026-09-24T00:00:00.000Z' }, 'team'), false);
  assert.equal(sameInstanceActionTarget(t, row(), 'other'), false); assert.equal(sameInstanceActionTarget(t, { ...row(), agentsRoot: '/other/agents' }, 'team'), false);
  assert.equal(instanceActionTarget('team', { ...row(), createdAt: undefined }, { requireBirth: true }), null);
  const d = { kind: 'open-instance', target: t, connectionEpoch: 0 }, out = spawnOpenDescriptor(d); assert.deepEqual(out, d); assert.notEqual(out.target, t);
  for (const field of ['command', 'ipc', 'executable', 'argv', 'url', 'path']) assert.equal(spawnOpenDescriptor({ ...d, [field]: 'PRIVATE' }), null);
  for (const bad of [{ ...d, kind: 'run' }, { ...d, connectionEpoch: '0' }, { ...d, target: { ...t, incarnation: null } }, { ...d, target: { ...t, cmd: 'PRIVATE' } }]) assert.equal(spawnOpenDescriptor(bad), null);
});
test('one explicit PR action uses exact K1 then observation-bound P1; only validated URL opens', async () => {
  const s = reader(); assert.equal(s.calls.length, 0); await s.ctrl.open(target());
  assert.equal(s.calls.length, 2); assert.deepEqual(s.calls[0], { url: '/api/instance-git?ws=team', method: 'POST', body: { action: 'git', selector: { instance: instance.instance, agent: instance.agent, agentsRoot: instance.agentsRoot, server: null } } });
  assert.deepEqual(s.calls[1].body, { selector: s.calls[0].body.selector, observationKey }); assert.deepEqual(s.urls, [pr().url]); assert.deepEqual(s.reports, []); s.ctrl.dispose();
});
for (const [status, text] of [['no-pull-request', 'No pull request found'], ['not-connected', 'Not connected to GitHub'], ['unavailable', 'Pull request unavailable']]) test(`PR ${status} is distinct, never auth/URL fallback`, async () => {
  const s = reader(url => url.startsWith('/api/instance-git') ? gitReply() : { ...forgeReply(), status, data: null, reason: { code: 'E_GH_FAILED', message: 'PRIVATE' } });
  await s.ctrl.open(target()); assert.match(s.reports[0], new RegExp(text)); assert.doesNotMatch(s.reports[0], /PRIVATE/); assert.deepEqual(s.urls, []);
});
for (const phase of ['git', 'forge']) for (const reject of [false, true]) for (const change of ['workspace', 'connection', 'selection', 'birth', 'removed', 'dispose']) test(`${phase} late ${reject ? 'rejection' : 'success'} loses authority on ${change}`, async () => {
  const g = deferred(), s = reader(url => phase === 'git' || !url.startsWith('/api/instance-git') ? g.promise : gitReply());
  const pending = s.ctrl.open(target()); await tick(); s.bump(change); if (reject) g.reject(Error('PRIVATE')); else g.resolve(phase === 'git' ? gitReply() : forgeReply());
  await pending; assert.equal(s.calls.length, phase === 'git' ? 1 : 2); assert.deepEqual(s.urls, []); assert.deepEqual(s.reports, []);
});
for (const [label, change] of [
  ['foreign Git home', v => v.git.target = { ...gitTarget, home: '/other' }], ['foreign Git data', v => v.git.data.home = '/other'],
  ['missing observation key', v => delete v.git.observationKey], ['foreign PR target', v => v.forge.target = { ...gitTarget, agentsRoot: '/other' }],
  ['wrong observation', v => v.forge.observation.key = 'f'.repeat(64)], ['wrong revision', v => v.forge.observation.revision = 'f'.repeat(40)],
  ['wrong branch', v => v.forge.observation.branch = 'other'], ['wrong PR URL', v => v.forge.data.url = 'https://evil.test/owner/repo/pull/42'],
]) test(`${label} never opens an external URL`, async () => {
  const v = { git: gitReply(), forge: forgeReply() }; change(v); const s = reader(url => url.startsWith('/api/instance-git') ? v.git : v.forge);
  await s.ctrl.open(target()); assert.deepEqual(s.urls, []); assert.match(s.reports[0], /unavailable/);
});
test('remote PR action performs no local lookup and no external open', async () => {
  const messages = [], ctrl = createInstancePrAction({ ctx: { api: assert.fail }, beginIntent: () => () => true, currentTarget: () => true,
    generation: () => 0, connectionGeneration: () => 0, report: m => messages.push(m), openExternal: assert.fail });
  await ctrl.open({ ...target(), server: 'peer' }); assert.match(messages[0], /Remote.*no local fallback/);
});
test('PR request subject is copied before await; caller mutation cannot redirect the second read', async () => {
  const g = deferred(); const s = reader(url => url.startsWith('/api/instance-git') ? g.promise : forgeReply()), input = target();
  const pending = s.ctrl.open(input); input.workspace = 'other'; input.home = '/other'; g.resolve(gitReply()); await pending;
  assert.equal(s.calls[1].url, '/api/instance-forge?ws=team'); assert.deepEqual(s.urls, [pr().url]);
});
test('newest explicit PR action owns completion; superseded response cannot open or report', async () => {
  const g = deferred(); let first = true;
  const s = reader(url => { if (first) { first = false; return g.promise; } return url.startsWith('/api/instance-git') ? gitReply() : forgeReply(); });
  const old = s.ctrl.open(target()); await s.ctrl.open(target()); g.resolve(gitReply()); await old;
  assert.deepEqual(s.urls, [pr().url]); assert.equal(s.calls.length, 3); assert.deepEqual(s.reports, []);
});
const terminal = id => ({ kind: 'terminal', workspace: 'team', key: `target-${id}` });
const layout = (split = null, activeId = 1) => ({ split, activeId, tabs: new Map([[1, terminal(1)], [2, terminal(2)]]), workspace: 'team', visible: true });
test('pure split plan keeps all source tabs, provides one empty destination and moves an existing tab without duplicating it', () => {
  const before = layout(), fingerprint = instanceSplitIdentity(before), out = instanceSplitPlan(before);
  assert.equal(out.available, true); assert.deepEqual(out.split.groups.map(g => g.tabs), [[1, 2], []]);
  const moved = fillEmptyGroup(out.split, 2); assert.deepEqual(moved.groups.map(g => g.tabs), [[1], [2]]);
  assert.equal(instanceSplitIdentity(before), fingerprint); assert.equal(before.split, null);
});
test('selected empty destination is reused; unselected empty group, foreign/stage/file context and cap refuse precisely', () => {
  const initial = instanceSplitPlan(layout()).split;
  assert.equal(instanceSplitPlan(layout(initial, null)).split, initial);
  for (const input of [{ ...layout(), visible: false }, { ...layout(), activeId: null }, { ...layout(), workspace: 'other' }, { ...layout(), tabs: new Map([[1, { ...terminal(1), kind: 'file' }]]) }, layout({ ...initial, focusedGroup: 1 })]) {
    const out = instanceSplitPlan(input); assert.equal(out.available, false); assert.ok(out.reason);
  }
  const four = { orientation: 'col', nextId: 5, focusedGroup: 1, groups: [1, 2, 3, 4].map(id => ({ id, tabs: [id], activeTab: id })) };
  const out = instanceSplitPlan({ ...layout(four), tabs: new Map([1, 2, 3, 4].map(id => [id, terminal(id)])) }); assert.equal(out.available, false); assert.match(out.reason, /limit/);
});
test('split additions retain orientation and model fingerprint changes on source/target/layout movement', () => {
  const split = { orientation: 'col', nextId: 3, focusedGroup: 1, groups: [{ id: 1, tabs: [1], activeTab: 1 }, { id: 2, tabs: [2], activeTab: 2 }] };
  assert.equal(instanceSplitPlan(layout(split)).split.orientation, 'col');
  assert.notEqual(instanceSplitIdentity(layout(split)), instanceSplitIdentity(layout({ ...split, focusedGroup: 2 })));
  assert.notEqual(instanceSplitIdentity(layout(split)), instanceSplitIdentity(layout(split, 2)));
});
