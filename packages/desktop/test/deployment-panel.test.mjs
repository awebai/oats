// What one deployment's observation becomes for the panel (packages/client/deployment-panel.mjs, #855 1d):
// the functions the Desktop's server calls between the observer's answer and /api/panel. Pure: every
// input here is frozen, at every depth, and a function that changed one would throw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rosterRows, livenessInput, livenessAnswers, panelInstance, panelInstances, pendingEntry, failedEntry, observedEntry, publicDeployment } from '../../client/deployment-panel.mjs';

/** Frozen at every depth: a function that writes to its input throws (modules are strict). */
const frozen = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(frozen); }
  return value;
};
const claim = { since: '2026-10-03T10:00:00.000Z', producer: 'claude-hook', reason: 'question', message: null };
const UNKNOWN = { running: null, runtimeState: 'unreachable', runtimeError: 'Terminal status is unavailable' };
/** A roster as deployment-data.mjs `deploymentStatusData` answers it: two souls, three instances. */
const roster = () => frozen({
  root: '/d/agents', workspace: { reachable: true }, withheld: [],
  agents: [
    { name: 'dev', description: 'Writes code', team: 'aweb:oats', dir: '/d/agents/dev', instances: [
      { instance: 'dev-b', home: '/d/agents/dev/instances/dev-b', running: false, runtimeState: 'stopped', tmux: { session: 'oats', window: 'dev-b' }, waitingOnYou: claim },
      { instance: 'dev-a', home: '/d/agents/dev/instances/dev-a', agent: 'dev-renamed', running: null, runtimeState: 'unreachable', runtimeError: 'no server', waitingOnYou: null },
    ] },
    { name: 'ops', dir: '/d/agents/ops', instances: [
      { instance: 'ops-a', home: '/d/agents/ops/instances/ops-a', sessionTarget: { backend: 'herdr' }, tmux: null },
    ] },
  ],
});
const WAITING = frozen({ ok: true, features: ['desktop-facts', 'waiting-on-you'] });

test('rosterRows: one row per instance, in the roster\'s order, with its soul\'s agent, description and team and the roster\'s root', () => {
  const rows = rosterRows(roster(), WAITING);
  assert.deepEqual(rows.map(r => [r.instance, r.agent, r.description, r.team, r.agentsRoot]), [
    ['dev-b', 'dev', 'Writes code', 'aweb:oats', '/d/agents'],
    ['dev-a', 'dev-renamed', 'Writes code', 'aweb:oats', '/d/agents'],
    ['ops-a', 'ops', '', null, '/d/agents'],
  ]);
  // The kernel's own fields ride along as they are.
  assert.deepEqual(rows[0].tmux, { session: 'oats', window: 'dev-b' });
  assert.deepEqual([rows[1].running, rows[1].runtimeState, rows[1].runtimeError], [null, 'unreachable', 'no server']);
  assert.deepEqual(rows[2].sessionTarget, { backend: 'herdr' });
  assert.deepEqual(rosterRows(frozen({ root: '/d/agents', agents: [] }), WAITING), []);
});

test('rosterRows: waitingOnYou is kept only when cli.features lists waiting-on-you, as the kernel gave it', () => {
  const kept = rosterRows(roster(), WAITING);
  assert.deepEqual(kept[0].waitingOnYou, claim);
  assert.ok(Object.hasOwn(kept[1], 'waitingOnYou') && kept[1].waitingOnYou === null, 'null (unknown) is kept as null');
  assert.equal(Object.hasOwn(kept[2], 'waitingOnYou'), false, 'a row without the key stays without it');
  // Not listed: dropped, whatever the version says. A string is not a list, even one that spells the feature.
  for (const cli of [{}, { features: null }, { features: undefined }, { features: [] }, { features: ['desktop-facts'] }, { features: 'waiting-on-you' },
    { features: { 0: 'waiting-on-you', length: 1 } }, { version: '99.0.0' }, null, undefined]) {
    for (const row of rosterRows(roster(), cli === null || cli === undefined ? cli : frozen(cli))) assert.equal(Object.hasOwn(row, 'waitingOnYou'), false, JSON.stringify(cli));
  }
});

test('livenessInput: one per row, in order, with the five fields the collector reads and nothing else', () => {
  const rows = frozen(rosterRows(roster(), WAITING));
  assert.deepEqual(livenessInput(rows), [
    { instance: 'dev-b', tmux: { session: 'oats', window: 'dev-b' }, sessionTarget: undefined, runtimeState: 'stopped', runtimeError: undefined },
    { instance: 'dev-a', tmux: undefined, sessionTarget: undefined, runtimeState: 'unreachable', runtimeError: 'no server' },
    { instance: 'ops-a', tmux: null, sessionTarget: { backend: 'herdr' }, runtimeState: undefined, runtimeError: undefined },
  ]);
  for (const input of livenessInput(rows)) assert.deepEqual(Object.keys(input), ['instance', 'tmux', 'sessionTarget', 'runtimeState', 'runtimeError']);
  assert.deepEqual(livenessInput(frozen([])), []);
});

test('livenessAnswers: the collector\'s array when it is one answer per row; anything else is unknown for every row', () => {
  const rows = frozen([{ instance: 'a' }, { instance: 'b' }]);
  const answers = [{ running: true, runtimeState: 'running', tmux: { session: 'oats', window: 'a', id: '@1' } }, { running: false, runtimeState: 'stopped', tmux: { session: 'oats', window: 'b' } }];
  assert.deepEqual(livenessAnswers(rows, JSON.stringify(answers)), answers, 'returned as parsed');
  for (const [what, stdout] of [['null (the collector failed)', null], ['undefined', undefined], ['empty', ''], ['not JSON', 'tmux: no server running'],
    ['JSON that is not an array', '{"0":{},"1":{},"length":2}'], ['a JSON string', '"[]"'], ['JSON null', 'null'], ['one short', JSON.stringify(answers.slice(1))],
    ['one long', JSON.stringify([...answers, answers[0]])], ['truncated', JSON.stringify(answers).slice(0, -1)], ['not text', 7], ['an array, not text', answers]]) {
    assert.deepEqual(livenessAnswers(rows, stdout), [UNKNOWN, UNKNOWN], what);
  }
  // Each unknown answer is its own object: a caller that merges one changes no other.
  const [first, second] = livenessAnswers(rows, null);
  assert.notEqual(first, second);
  // No rows: nothing to answer, whatever was printed.
  for (const stdout of [null, '', '[]', 'not JSON', JSON.stringify(answers)]) assert.deepEqual(livenessAnswers(frozen([]), stdout), [], String(stdout));
});

test('panelInstances: each row merged with its answer, projected, running first and then by name', () => {
  const rows = frozen(rosterRows(roster(), WAITING));
  const answers = frozen([
    { tmux: { session: 'oats', window: 'dev-b', id: '@4' }, running: true, runtimeState: 'running' },
    { tmux: { session: 'oats-agents', window: 'dev-a' }, running: false, runtimeState: 'stopped' },
    { running: null, runtimeState: 'unsupported', runtimeError: 'E_HERDR_REMOVED: gone', tmux: null },
  ]);
  const instances = panelInstances(rows, answers);
  assert.deepEqual(instances.map(i => [i.instance, i.running, i.runtimeState]), [['dev-b', true, 'running'], ['dev-a', false, 'stopped'], ['ops-a', null, 'unsupported']]);
  // The answer wins over the kernel's own liveness fields; an answer without a field leaves the row's.
  assert.deepEqual(instances[0].tmux, { session: 'oats', window: 'dev-b', id: '@4' });
  assert.equal(instances[1].runtimeError, 'no server', 'the answer named no runtimeError: the kernel\'s stays');
  assert.deepEqual(instances[2], panelInstance({ ...rows[2], ...answers[2] }));
  // With the unknown answer for every row (the collector failed), each row keeps the kernel's tmux.
  const unknown = panelInstances(rows, livenessAnswers(rows, null));
  assert.deepEqual(unknown.map(i => [i.instance, i.running, i.runtimeState, i.runtimeError, i.tmux]), [
    ['dev-a', null, 'unreachable', 'Terminal status is unavailable', undefined],
    ['dev-b', null, 'unreachable', 'Terminal status is unavailable', { session: 'oats', window: 'dev-b' }],
    ['ops-a', null, 'unreachable', 'Terminal status is unavailable', null],
  ]);
  assert.deepEqual(panelInstances(frozen([]), frozen([])), []);
});

test('panelInstances: the sort is today\'s, by `running` as it is and then by localeCompare of the name', () => {
  const named = (instance, running) => ({ instance, agentsRoot: '/d/agents', running });
  const order = (rows) => panelInstances(frozen(rows), frozen(rows.map(() => ({})))).map(i => i.instance);
  assert.deepEqual(order([named('b', false), named('a', false), named('d', true), named('c', true)]), ['c', 'd', 'a', 'b']);
  assert.deepEqual(order([named('B', true), named('a', true), named('C', true)]), ['a', 'B', 'C'].sort((x, y) => x.localeCompare(y)));
  // Two rows of the same `running` are ordered by name; unknown (null) is not running, and sorts after it.
  assert.deepEqual(order([named('z', null), named('y', null), named('x', true)]), ['x', 'y', 'z']);
});

// ── The deployment's entry ────────────────────────────────────────────────────

const AT = '2026-10-11T12:00:00.000Z';
const HELD = () => frozen({
  deployment: { status: 'observed', root: '/d/agents', workspace: { name: 'd' }, workspaceStatus: { workspace: { name: 'd' } }, reachable: null, withheld: [],
    souls: [{ name: 'dev' }], catalog: { souls: [] }, catalogKey: 'k' },
  instances: [{ instance: 'dev-a', running: true }], generatedAt: '2026-10-11T11:00:00.000Z', observedAt: '2026-10-11T10:59:00.000Z' });
const UNAVAILABLE = () => frozen({ deployment: { status: 'unavailable', reason: { code: 'E_CLI_FAILED', message: 'boom' } }, instances: [], generatedAt: '2026-10-11T11:00:00.000Z' });
const unreadable = cause => frozen({ code: 'E_REMOTE_UNREADABLE', message: 'the cache is locked by /x/index.lock; remove it', ...(cause ? { cause } : {}) });

test('pendingEntry: the entry held, as it is, or a pending one stamped with the caller\'s time', () => {
  for (const previous of [HELD(), UNAVAILABLE()]) assert.equal(pendingEntry(previous, AT), previous);
  for (const none of [undefined, null]) assert.deepEqual(pendingEntry(none, AT), { deployment: { status: 'pending' }, instances: [], generatedAt: AT });
  assert.notEqual(pendingEntry(undefined, AT), pendingEntry(undefined, AT), 'each call makes its own entry: nothing is kept');
});

test('failedEntry: a busy or stale read keeps the entry held, as it is; without one it is unavailable', () => {
  for (const code of ['E_DEPLOYMENT_BUSY', 'E_DEPLOYMENT_STALE']) {
    const reason = frozen({ code, message: 'try again' });
    for (const previous of [HELD(), UNAVAILABLE()]) assert.equal(failedEntry(previous, reason, AT), previous, code);
    for (const none of [undefined, null]) assert.deepEqual(failedEntry(none, reason, AT), { deployment: { status: 'unavailable', reason }, instances: [], generatedAt: AT }, code);
  }
});

test('failedEntry: an unreadable remote keeps an observed entry, marked with the kernel\'s message and its bounded cause', () => {
  const held = HELD(), reason = unreadable({ reason: 'cache' });
  const kept = failedEntry(held, reason, AT);
  assert.deepEqual(kept, { ...held, error: reason.message, errorCause: { code: 'E_REMOTE_UNREADABLE', reason: 'cache' } });
  assert.equal(kept.deployment, held.deployment, 'the observation is the one held');
  assert.deepEqual([kept.generatedAt, kept.observedAt], [held.generatedAt, held.observedAt], 'its stamps are the old observation\'s: `at` is not used');
  assert.deepEqual(Object.keys(kept), ['deployment', 'instances', 'generatedAt', 'observedAt', 'error', 'errorCause']);
  // An entry that already carries an error and a cause: both replaced, and the cause removed when the new reason has none.
  const again = failedEntry(frozen({ ...kept }), unreadable({ reason: 'network', host: 'github.com' }), AT);
  assert.deepEqual([again.error, again.errorCause], [reason.message, { code: 'E_REMOTE_UNREADABLE', reason: 'network', host: 'github.com' }]);
  const bare = failedEntry(frozen({ ...again, error: 'an older message' }), unreadable(null), AT);
  assert.equal(bare.error, reason.message);
  assert.equal(Object.hasOwn(bare, 'errorCause'), false, 'a failure without a cause drops the old one');
  assert.deepEqual(Object.keys(bare), ['deployment', 'instances', 'generatedAt', 'observedAt', 'error']);
});

test('failedEntry: an unreadable remote over nothing observed, and every other failure, is unavailable with the reason', () => {
  const reason = unreadable({ reason: 'network', host: 'github.com' });
  const unavailable = r => ({ deployment: { status: 'unavailable', reason: r }, instances: [], generatedAt: AT });
  // Nothing held, an unavailable entry, a pending one: there is no observation to keep.
  for (const previous of [undefined, null, UNAVAILABLE(), frozen({ deployment: { status: 'pending' }, instances: [], generatedAt: AT }), frozen({})]) {
    assert.deepEqual(failedEntry(previous, reason, AT), unavailable(reason));
  }
  assert.equal(failedEntry(undefined, reason, AT).deployment.reason, reason, 'the reason is the one given, cause included');
  // Another code replaces even an observed entry, as before; so does a reason with no code, and no reason at all.
  for (const other of [frozen({ code: 'E_WORKSPACE_SCHEMA', message: 'bad' }), frozen({ code: 'E_DEPLOYMENT_FEATURE', feature: 'served-identity' }), frozen({ message: 'no code' }), frozen({}), undefined]) {
    for (const previous of [HELD(), UNAVAILABLE(), undefined]) assert.deepEqual(failedEntry(previous, other, AT), unavailable(other), JSON.stringify(other));
  }
});

test('observedEntry: the deployment\'s facts from the observer\'s answer, the rows as given, the two stamps', () => {
  const r = roster(), workspaceStatus = frozen({ workspace: { name: 'd', commit: 'abc' }, clones: [] }), instances = frozen([{ instance: 'dev-a' }]);
  const entry = observedEntry(frozen({ roster: r, workspaceStatus, observedAt: '2026-10-11T11:59:00.000Z' }), instances, AT);
  assert.deepEqual(entry, {
    deployment: { status: 'observed', root: '/d/agents', workspace: { name: 'd', commit: 'abc' }, workspaceStatus, reachable: { reachable: true }, withheld: [],
      souls: [{ name: 'dev', description: 'Writes code', team: 'aweb:oats', dir: '/d/agents/dev' }, { name: 'ops', dir: '/d/agents/ops' }] },
    instances, generatedAt: AT, observedAt: '2026-10-11T11:59:00.000Z',
  });
  // The order of the deployment's keys is the served one; a client's own facts come after them.
  assert.deepEqual(Object.keys(entry.deployment), ['status', 'root', 'workspace', 'workspaceStatus', 'reachable', 'withheld', 'souls']);
  assert.deepEqual(Object.keys(entry), ['deployment', 'instances', 'generatedAt', 'observedAt']);
  assert.equal(entry.instances, instances);
  // A roster that reports no workspace: reachable is null, never undefined.
  const silent = observedEntry({ roster: frozen({ root: '/d/agents', agents: [], withheld: [] }), workspaceStatus, observedAt: null }, [], AT);
  assert.deepEqual([silent.deployment.reachable, silent.deployment.souls, silent.observedAt], [null, [], null]);
  // The entry is the caller's to add to (the Desktop adds its catalog): it is not frozen, and no input was changed.
  Object.assign(entry.deployment, { catalog: { souls: null }, catalogKey: 'k' });
  assert.deepEqual(Object.keys(entry.deployment).slice(-2), ['catalog', 'catalogKey']);
});

test('publicDeployment: pending when absent, as it is when not observed, without souls and the catalog key when observed', () => {
  for (const none of [undefined, null]) assert.deepEqual(publicDeployment(none), { status: 'pending' });
  for (const d of [frozen({ status: 'pending' }), UNAVAILABLE().deployment]) assert.equal(publicDeployment(d), d);
  const { deployment } = HELD();
  assert.deepEqual(publicDeployment(deployment), { status: 'observed', root: '/d/agents', workspace: { name: 'd' }, workspaceStatus: { workspace: { name: 'd' } }, reachable: null, withheld: [], catalog: { souls: [] } });
});

test('composed: a fixture roster becomes the entry the Desktop\'s observeDeployment built before the move', () => {
  // What the server does between the observer's answer and its own catalog, with the collector's answer given.
  const r = roster(), workspaceStatus = frozen({ workspace: { name: 'd' } });
  const rows = rosterRows(r, WAITING);
  const printed = JSON.stringify(livenessInput(rows).map(input => (input.sessionTarget
    ? { running: null, runtimeState: 'unsupported', runtimeError: 'E_HERDR_REMOVED: gone', tmux: null }
    : { tmux: { session: 'oats', window: input.instance }, running: input.instance === 'dev-a', runtimeState: input.instance === 'dev-a' ? 'running' : 'stopped' })));
  const entry = observedEntry({ roster: r, workspaceStatus, observedAt: '2026-10-11T11:59:00.000Z' }, panelInstances(rows, livenessAnswers(rows, printed)), AT);
  const row = (instance, agent, extra) => ({ instance, agent, description: extra.description, repo: undefined, work: undefined, branch: null, harness: null, model: null,
    running: extra.running, createdAt: undefined, home: `/d/agents/${extra.soul}/instances/${instance}`, agentsRoot: '/d/agents', workspace: '/d', repoName: 'd',
    parentInstance: null, siblingInstance: null, relation: null, relativeTo: null, ...(extra.sessionTarget ? { sessionTarget: extra.sessionTarget } : {}),
    runtimeState: extra.runtimeState, runtimeError: extra.runtimeError, tmux: extra.tmux, git: null,
    ...(Object.hasOwn(extra, 'waitingOnYou') ? { waitingOnYou: extra.waitingOnYou } : {}), team: extra.team });
  assert.deepEqual(entry, {
    deployment: { status: 'observed', root: '/d/agents', workspace: { name: 'd' }, workspaceStatus, reachable: { reachable: true }, withheld: [],
      souls: [{ name: 'dev', description: 'Writes code', team: 'aweb:oats', dir: '/d/agents/dev' }, { name: 'ops', dir: '/d/agents/ops' }] },
    instances: [
      row('dev-a', 'dev-renamed', { soul: 'dev', description: 'Writes code', running: true, runtimeState: 'running', runtimeError: 'no server', tmux: { session: 'oats', window: 'dev-a' }, waitingOnYou: null, team: 'aweb:oats' }),
      row('dev-b', 'dev', { soul: 'dev', description: 'Writes code', running: false, runtimeState: 'stopped', runtimeError: undefined, tmux: { session: 'oats', window: 'dev-b' }, waitingOnYou: claim, team: 'aweb:oats' }),
      row('ops-a', 'ops', { soul: 'ops', description: '', running: null, runtimeState: 'unsupported', runtimeError: 'E_HERDR_REMOVED: gone', tmux: null, sessionTarget: { backend: 'herdr' }, team: null }),
    ],
    generatedAt: AT, observedAt: '2026-10-11T11:59:00.000Z',
  });
  // The collector failed: the same rows, every one unknown, in name order; and before any read, the pending entry.
  const failed = panelInstances(rows, livenessAnswers(rows, null));
  assert.deepEqual(failed.map(i => [i.instance, i.running, i.runtimeState]), [['dev-a', null, 'unreachable'], ['dev-b', null, 'unreachable'], ['ops-a', null, 'unreachable']]);
  assert.deepEqual(publicDeployment(pendingEntry(undefined, AT).deployment), { status: 'pending' });
});
