// What one deployment's observation becomes for the panel (packages/client/deployment-panel.mjs, #855 1d):
// the functions the Desktop's server calls between the observer's answer and /api/panel. Pure: every
// input here is frozen, at every depth, and a function that changed one would throw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rosterRows, livenessInput, livenessAnswers, panelInstance, panelInstances } from '../../client/deployment-panel.mjs';

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
