// What one deployment's observation becomes for the panel (packages/client/deployment-panel.mjs, #855 1d):
// the functions the Desktop's server calls between the observer's answer and /api/panel. Pure: every
// input here is frozen, at every depth, and a function that changed one would throw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { observeLiveness } from '../../client/liveness.mjs';
import { deploymentStatusData } from '../../client/deployment-data.mjs';
import { HERDR_REMOVED } from '../../client/terminal-contract.mjs';
import { rosterRows, livenessInput, livenessAnswers, panelInstance, panelInstances, pendingEntry, failedEntry, observedEntry, publicDeployment } from '../../client/deployment-panel.mjs';

/** Frozen at every depth: a function that writes to its input throws (modules are strict). */
const frozen = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(frozen); }
  return value;
};
const claim = { since: '2026-10-03T10:00:00.000Z', producer: 'claude-hook', reason: 'question', message: null };
const UNKNOWN = { running: null, runtimeState: 'unreachable', runtimeError: 'Terminal status is unavailable', runtimeErrorOrigin: 'terminal-probe' };
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

test('livenessInput: one per row, in order, with the six fields the collector reads and nothing else', () => {
  const rows = frozen(rosterRows(roster(), WAITING));
  assert.deepEqual(livenessInput(rows), [
    { instance: 'dev-b', running: false, tmux: { session: 'oats', window: 'dev-b' }, sessionTarget: undefined, runtimeState: 'stopped', runtimeError: undefined },
    { instance: 'dev-a', running: null, tmux: undefined, sessionTarget: undefined, runtimeState: 'unreachable', runtimeError: 'no server' },
    { instance: 'ops-a', running: undefined, tmux: null, sessionTarget: { backend: 'herdr' }, runtimeState: undefined, runtimeError: undefined },
  ]);
  for (const input of livenessInput(rows)) assert.deepEqual(Object.keys(input), ['instance', 'running', 'tmux', 'sessionTarget', 'runtimeState', 'runtimeError']);
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

test('failedEntry: the kept entry says who made its message (#982), from the reason given and from nothing else', () => {
  const held = HELD();
  // The reader's mark on the reason: the installed CLI printed it.
  const marked = failedEntry(held, frozen({ ...unreadable({ reason: 'cache' }), origin: 'kernel' }), AT);
  assert.deepEqual(marked, { ...held, error: unreadable().message, errorOrigin: 'kernel', errorCause: { code: 'E_REMOTE_UNREADABLE', reason: 'cache' } });
  assert.deepEqual(Object.keys(marked), ['deployment', 'instances', 'generatedAt', 'observedAt', 'error', 'errorOrigin', 'errorCause']);
  // A reason with no mark (a hand-made one), or with any other value: no key.
  for (const origin of [undefined, null, '', 'Kernel', 'terminal-probe', 'roster-read', true, 1, {}, ['kernel']]) {
    const kept = failedEntry(held, frozen({ ...unreadable(null), ...(origin === undefined ? {} : { origin }) }), AT);
    assert.equal(Object.hasOwn(kept, 'errorOrigin'), false, JSON.stringify(origin));
    assert.deepEqual(kept, { ...held, error: unreadable().message });
  }
  // A key the entry already carried never survives: the next failure decides it again.
  const again = failedEntry(frozen({ ...marked }), unreadable(null), AT);
  assert.deepEqual(again, { ...held, error: unreadable().message });
  for (const carried of ['kernel', 'roster-read', 'anything', 7]) {
    assert.equal(Object.hasOwn(failedEntry(frozen({ ...held, error: 'an older message', errorOrigin: carried }), unreadable(null), AT), 'errorOrigin'), false, String(carried));
    assert.equal(failedEntry(frozen({ ...held, error: 'an older message', errorOrigin: carried }), frozen({ ...unreadable(null), origin: 'kernel' }), AT).errorOrigin, 'kernel');
  }
  // A busy or stale read keeps the entry as it is, its message and its speaker with it.
  assert.equal(failedEntry(marked, frozen({ code: 'E_DEPLOYMENT_BUSY', message: 'try again', origin: 'kernel' }), AT), marked);
  // Any other failure, marked or not, is unavailable with the reason: the entry itself carries no key.
  const refused = frozen({ code: 'E_WORKSPACE_SCHEMA', message: 'not valid', origin: 'kernel' });
  assert.deepEqual(failedEntry(marked, refused, AT), { deployment: { status: 'unavailable', reason: refused }, instances: [], generatedAt: AT });
});

test('failedEntry: a kept failure\'s `error` is always a string, the message or "" when the reason carries none (#982)', () => {
  const held = HELD();
  for (const [message, error] of [['', ''], ['   ', '   '], [undefined, ''], [null, ''], [7, ''], [{ text: 'x' }, ''], [['x'], '']]) {
    const reason = frozen({ code: 'E_REMOTE_UNREADABLE', ...(message === undefined ? {} : { message }), origin: 'kernel' });
    const kept = failedEntry(held, reason, AT);
    assert.deepEqual(kept, { ...held, error, errorOrigin: 'kernel' }, JSON.stringify(message));
    assert.equal(typeof kept.error, 'string');
  }
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
    runtimeState: extra.runtimeState, runtimeError: extra.runtimeError, ...(extra.runtimeErrorOrigin ? { runtimeErrorOrigin: extra.runtimeErrorOrigin } : {}), tmux: extra.tmux, git: null,
    ...(Object.hasOwn(extra, 'waitingOnYou') ? { waitingOnYou: extra.waitingOnYou } : {}), team: extra.team });
  assert.deepEqual(entry, {
    deployment: { status: 'observed', root: '/d/agents', workspace: { name: 'd' }, workspaceStatus, reachable: { reachable: true }, withheld: [],
      souls: [{ name: 'dev', description: 'Writes code', team: 'aweb:oats', dir: '/d/agents/dev' }, { name: 'ops', dir: '/d/agents/ops' }] },
    instances: [
      // dev-a: this answer named no runtimeError, so the kernel's own text stays, and its speaker is the kernel.
      row('dev-a', 'dev-renamed', { soul: 'dev', description: 'Writes code', running: true, runtimeState: 'running', runtimeError: 'no server', runtimeErrorOrigin: 'kernel', tmux: { session: 'oats', window: 'dev-a' }, waitingOnYou: null, team: 'aweb:oats' }),
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

// ── A row the kernel answered as unknown stays unknown ────────────────────────

/** A roster with one row per kernel answer, and every `tmux` the projection lets through on an unknown one. */
const answered = () => frozen({ root: '/d/agents', withheld: [], agents: [{ name: 'dev', description: '', team: null, instances: [
  { instance: 'yes', home: '/d/agents/dev/instances/yes', running: true, runtimeState: 'running', tmux: { session: 'oats', window: 'yes' } },
  { instance: 'no', home: '/d/agents/dev/instances/no', running: false, runtimeState: 'stopped', tmux: { session: 'oats', window: 'no' } },
  { instance: 'unknown-recorded', home: '/d/agents/dev/instances/unknown-recorded', running: null, runtimeState: 'unreachable', runtimeError: 'error connecting to /x/tmux.sock', tmux: { session: 'oats', window: 'unknown-recorded', socket: '/x/tmux.sock' } },
  { instance: 'unknown-bare', home: '/d/agents/dev/instances/unknown-bare', running: null, runtimeState: 'unreachable', runtimeError: 'E_UNIDENTIFIED_INSTANCE_HOME: instance.json cannot be read' },
  { instance: 'unknown-null', home: '/d/agents/dev/instances/unknown-null', running: null, tmux: null },
  { instance: 'unknown-empty', home: '/d/agents/dev/instances/unknown-empty', running: null, runtimeState: 'unidentified', tmux: {} },
] }] });
const UNKNOWN_ROWS = ['unknown-bare', 'unknown-empty', 'unknown-null', 'unknown-recorded'];
/** The collector as the Desktop runs it, in this process: its input as JSON in, what it would print out. */
const collector = tmuxReader => input => JSON.stringify(observeLiveness(JSON.parse(JSON.stringify(input)), { tmuxReader }));

test('input, collector, answers and panel together: no row the kernel answered `running: null` leaves as running or stopped', () => {
  const rows = rosterRows(answered(), WAITING);
  const verdicts = { running: { running: true, runtimeState: 'running' }, stopped: { running: false, runtimeState: 'stopped' }, unknown: { running: null, runtimeState: 'unreachable', runtimeError: 'no server' } };
  for (const [what, verdict] of Object.entries(verdicts)) {
    const asked = [];
    const print = collector(row => { asked.push(row.instance); return { tmux: { ...row.tmux, session: row.tmux?.session || 'oats-agents', window: row.tmux?.window || row.instance }, ...verdict }; });
    const instances = panelInstances(rows, livenessAnswers(rows, print(livenessInput(rows))));
    assert.deepEqual(asked, ['yes', 'no'], `${what}: only the rows the kernel answered are probed`);
    const by = Object.fromEntries(instances.map(i => [i.instance, i]));
    assert.deepEqual([by.yes.running, by.no.running], [verdict.running, verdict.running], `${what}: the probe decides for a row the kernel answered`);
    for (const name of UNKNOWN_ROWS) assert.equal(by[name].running, null, `${what}: ${name}`);
    // The state, the reason and the tmux of an unknown row are the kernel's own; no default session or window is filled in.
    assert.deepEqual([by['unknown-recorded'].runtimeState, by['unknown-recorded'].runtimeError, by['unknown-recorded'].tmux],
      ['unreachable', 'error connecting to /x/tmux.sock', { session: 'oats', window: 'unknown-recorded', socket: '/x/tmux.sock' }]);
    assert.deepEqual([by['unknown-bare'].runtimeState, by['unknown-bare'].runtimeError, by['unknown-bare'].tmux], ['unreachable', 'E_UNIDENTIFIED_INSTANCE_HOME: instance.json cannot be read', undefined]);
    assert.deepEqual([by['unknown-null'].runtimeState, by['unknown-null'].runtimeError, by['unknown-null'].tmux], ['unreachable', undefined, null]);
    assert.deepEqual([by['unknown-empty'].runtimeState, by['unknown-empty'].tmux], ['unidentified', {}]);
  }
  // The collector failed (it printed nothing the Desktop can read): every row is unknown, those four among them.
  for (const stdout of [null, '', 'tmux: no server running', '[]']) {
    const instances = panelInstances(rows, livenessAnswers(rows, stdout));
    for (const i of instances) assert.equal(i.running, null, `${JSON.stringify(stdout)}: ${i.instance}`);
    assert.deepEqual(instances.filter(i => UNKNOWN_ROWS.includes(i.instance)).map(i => i.instance), UNKNOWN_ROWS);
  }
});

test('the collector as a program, with no terminal server to ask: the kernel\'s unknown rows come back unknown, with the kernel\'s reason', () => {
  // PATH names nothing, so tmux cannot be started: what the probe says of the two answered rows is its own business.
  const rows = rosterRows(answered(), WAITING);
  const program = fileURLToPath(new URL('../../client/liveness-main.mjs', import.meta.url));
  const child = spawnSync(process.execPath, [program], { input: JSON.stringify(livenessInput(rows)), encoding: 'utf8', timeout: 30_000, env: { PATH: '/nonexistent' } });
  assert.equal(child.status, 0, child.stderr);
  const instances = panelInstances(rows, livenessAnswers(rows, child.stdout));
  const by = Object.fromEntries(instances.map(i => [i.instance, i]));
  for (const name of UNKNOWN_ROWS) assert.equal(by[name].running, null, name);
  assert.equal(by['unknown-bare'].runtimeError, 'E_UNIDENTIFIED_INSTANCE_HOME: instance.json cannot be read');
  assert.equal(by['unknown-recorded'].runtimeError, 'error connecting to /x/tmux.sock');
});

// ── Who made a row's runtimeError (#982) ──────────────────────────────────────

const ORIGINS = ['kernel', 'terminal-probe', 'roster-read'];
const STAND_IN = `E_HERDR_REMOVED: ${HERDR_REMOVED}`;
const origins = instances => Object.fromEntries(instances.map(i => [i.instance, [i.runtimeError, i.runtimeErrorOrigin, Object.hasOwn(i, 'runtimeErrorOrigin')]]));

test('livenessAnswers: an answer with a runtimeError says who made it, from the row that was sent; an answer without one has no key', () => {
  const rows = frozen([
    { instance: 'probed', running: true }, { instance: 'kept', running: null, runtimeError: 'the kernel could not read the socket' },
    { instance: 'herdr-new', running: null, runtimeState: 'unsupported', runtimeError: 'E_HERDR_REMOVED: the kernel\'s own reason' },
    { instance: 'herdr-old', sessionTarget: { backend: 'herdr' }, runtimeState: 'unreachable', runtimeError: 'spawn herdr ENOENT' },
    { instance: 7 }, { instance: 'fine', running: false },
  ]);
  const printed = [
    { running: null, runtimeState: 'unreachable', runtimeError: 'Cannot reach terminal server' },
    { running: null, runtimeState: 'unreachable', runtimeError: 'the kernel could not read the socket' },
    { running: null, runtimeState: 'unsupported', runtimeError: 'E_HERDR_REMOVED: the kernel\'s own reason', tmux: null },
    { running: null, runtimeState: 'unsupported', runtimeError: STAND_IN, tmux: null },
    { running: null, runtimeState: 'unreachable', runtimeError: 'Invalid terminal target' },
    { running: false, runtimeState: 'stopped', tmux: { session: 'oats', window: 'fine' } },
  ];
  const answers = livenessAnswers(rows, JSON.stringify(printed));
  assert.deepEqual(answers.map(a => a.runtimeErrorOrigin), ['terminal-probe', 'kernel', 'kernel', undefined, 'terminal-probe', undefined]);
  assert.deepEqual(answers.map(a => Object.hasOwn(a, 'runtimeErrorOrigin')), [true, true, true, false, true, false], 'the stand-in and an answer without a text carry no key');
  // Nothing else of an answer changes: each is what was printed, and the text is the same string.
  assert.deepEqual(answers.map(({ runtimeErrorOrigin: _origin, ...rest }) => rest), printed);
  // An empty text, and one that is not a string, are not a runtimeError: no key.
  for (const runtimeError of ['', null, 5, { message: 'x' }]) {
    const [answer] = livenessAnswers(rows.slice(0, 1), JSON.stringify([{ running: null, runtimeError, runtimeErrorOrigin: 'kernel' }]));
    assert.deepEqual(answer, { running: null, runtimeError }, JSON.stringify(runtimeError));
  }
});

test('livenessAnswers: a runtimeErrorOrigin the collector printed never survives, whatever it says', () => {
  const rows = frozen([{ instance: 'probed', running: true }, { instance: 'kept', running: null, runtimeError: 'the kernel\'s text' }, { instance: 'herdr-old', sessionTarget: { backend: 'herdr' } }, { instance: 'fine', running: true }]);
  for (const sent of [...ORIGINS, 'the-collector', '__proto__', 7, null, { kernel: true }]) {
    const printed = [
      { running: null, runtimeState: 'unreachable', runtimeError: 'tmux said no', runtimeErrorOrigin: sent },
      { running: null, runtimeState: 'unreachable', runtimeError: 'the kernel\'s text', runtimeErrorOrigin: sent },
      { running: null, runtimeState: 'unsupported', runtimeError: STAND_IN, tmux: null, runtimeErrorOrigin: sent },
      { running: true, runtimeState: 'running', runtimeErrorOrigin: sent },
    ];
    const answers = livenessAnswers(rows, JSON.stringify(printed)), at = JSON.stringify(sent);
    // A probed row whose answer says "kernel" is the terminal check's all the same, and so on for each row.
    assert.deepEqual(answers.map(a => [a.runtimeErrorOrigin, Object.hasOwn(a, 'runtimeErrorOrigin')]), [['terminal-probe', true], ['kernel', true], [undefined, false], [undefined, false]], at);
    assert.deepEqual(origins(panelInstances(rows.map(row => ({ ...row, agentsRoot: '/d/agents' })), answers)),
      { fine: [undefined, undefined, false], probed: ['tmux said no', 'terminal-probe', true], kept: ['the kernel\'s text', 'kernel', true], 'herdr-old': [STAND_IN, undefined, false] }, at);
  }
});

test('the collector failed or printed something else: every row is the terminal check\'s, a row the kernel answered itself included', () => {
  const rows = rosterRows(answered(), WAITING);
  for (const stdout of [null, '', 'tmux: no server running', '[]', '{"runtimeErrorOrigin":"kernel"}']) {
    for (const i of panelInstances(rows, livenessAnswers(rows, stdout))) {
      assert.deepEqual([i.runtimeError, i.runtimeErrorOrigin], ['Terminal status is unavailable', 'terminal-probe'], `${JSON.stringify(stdout)}: ${i.instance}`);
    }
  }
});

test('input, collector, answers and panel together: each row\'s text has the speaker of the place that chose it, and the text is the base\'s', () => {
  const herdr = [
    { instance: 'herdr-new', home: '/d/agents/dev/instances/herdr-new', running: null, runtimeState: 'unsupported', runtimeError: `${STAND_IN} (herdr-new)`, sessionTarget: { backend: 'herdr' } },
    { instance: 'herdr-empty', home: '/d/agents/dev/instances/herdr-empty', running: null, runtimeState: 'unsupported', runtimeError: '' },
    { instance: 'herdr-old', home: '/d/agents/dev/instances/herdr-old', running: null, runtimeState: 'unreachable', runtimeError: 'spawn herdr ENOENT', sessionTarget: { backend: 'herdr' } },
  ];
  const document = answered(), rows = rosterRows({ ...document, agents: [{ ...document.agents[0], instances: [...document.agents[0].instances, ...herdr] }] }, WAITING);
  const failing = collector(row => ({ tmux: row.tmux, running: null, runtimeState: 'unreachable', runtimeError: 'Cannot reach terminal server' }));
  assert.deepEqual(origins(panelInstances(rows, livenessAnswers(rows, failing(livenessInput(rows))))), {
    yes: ['Cannot reach terminal server', 'terminal-probe', true], no: ['Cannot reach terminal server', 'terminal-probe', true],
    'unknown-recorded': ['error connecting to /x/tmux.sock', 'kernel', true],
    'unknown-bare': ['E_UNIDENTIFIED_INSTANCE_HOME: instance.json cannot be read', 'kernel', true],
    // The kernel answered unknown and gave no text: no runtimeError, so no key.
    'unknown-null': [undefined, undefined, false], 'unknown-empty': [undefined, undefined, false],
    'herdr-new': [`${STAND_IN} (herdr-new)`, 'kernel', true],
    // The stand-in is written here for a reason the kernel did not give: it has no speaker.
    'herdr-empty': [STAND_IN, undefined, false], 'herdr-old': [STAND_IN, undefined, false],
  });
  // A probe that finds the window: a row that is running or stopped has no text and no key.
  const finding = collector(row => ({ tmux: row.tmux, running: row.instance === 'yes', runtimeState: row.instance === 'yes' ? 'running' : 'stopped' }));
  const found = origins(panelInstances(rows, livenessAnswers(rows, finding(livenessInput(rows)))));
  assert.deepEqual([found.yes, found.no], [[undefined, undefined, false], [undefined, undefined, false]]);
});

test('panelInstances: the key is set here or removed, whatever a row or an answer carried', () => {
  const row = (instance, extra = {}) => ({ instance, agentsRoot: '/d/agents', ...extra });
  for (const carried of [...ORIGINS, 'someone-else']) {
    const rows = frozen([
      row('a-kernel-text', { running: true, runtimeError: 'the kernel sent this beside running: true', runtimeErrorOrigin: carried }),
      row('b-no-text', { running: false, runtimeErrorOrigin: carried }),
      row('c-answered', { running: true, runtimeErrorOrigin: carried }),
      row('d-unmarked-answer', { running: true, runtimeErrorOrigin: carried }),
      row('e-emptied', { running: null, runtimeError: 'the kernel\'s', runtimeErrorOrigin: carried }),
    ]);
    const answers = frozen([{ running: true }, { running: false }, { running: null, runtimeError: 'tmux said no', runtimeErrorOrigin: 'terminal-probe' },
      { running: null, runtimeError: 'an answer made by hand, with no speaker' }, { running: null, runtimeError: '' }]);
    assert.deepEqual(origins(panelInstances(rows, answers)), {
      // The probe's answer named no text, so the kernel's own stays in the merged row: it is the kernel's.
      'a-kernel-text': ['the kernel sent this beside running: true', 'kernel', true],
      'b-no-text': [undefined, undefined, false],
      'c-answered': ['tmux said no', 'terminal-probe', true],
      'd-unmarked-answer': ['an answer made by hand, with no speaker', undefined, false],
      'e-emptied': ['', undefined, false],
    }, carried);
  }
});

test('panelInstance: the key only beside a runtimeError, and only as one of the three speakers', () => {
  const base = { instance: 'a', agentsRoot: '/d/agents' };
  for (const origin of ORIGINS) assert.equal(panelInstance({ ...base, runtimeError: 'x', runtimeErrorOrigin: origin }).runtimeErrorOrigin, origin);
  for (const origin of ['Kernel', 'server-probe', '', '__proto__', 'constructor', 7, null, undefined, ['kernel'], { kernel: true }]) {
    assert.equal(Object.hasOwn(panelInstance({ ...base, runtimeError: 'x', runtimeErrorOrigin: origin }), 'runtimeErrorOrigin'), false, JSON.stringify(origin));
  }
  for (const runtimeError of [undefined, null, '', 5, {}]) {
    assert.equal(Object.hasOwn(panelInstance({ ...base, runtimeError, runtimeErrorOrigin: 'kernel' }), 'runtimeErrorOrigin'), false, JSON.stringify(runtimeError));
  }
});

test('a local status row is built from named fields: a runtimeErrorOrigin the kernel sent does not arrive', () => {
  const instance = (name, extra) => ({ instance: name, home: `/d/agents/dev/instances/${name}`, ...extra });
  for (const sent of [...ORIGINS, 'someone-else']) {
    const document = { root: '/d/agents', agents: [{ name: 'dev', dir: '/d/agents/dev', instances: [
      instance('lost', { running: null, runtimeState: 'unreachable', runtimeError: 'the kernel could not read the socket', runtimeErrorOrigin: sent }),
      instance('up', { running: true, runtimeErrorOrigin: sent }),
    ] }] };
    const read = deploymentStatusData(document, '/d');
    for (const row of read.agents[0].instances) assert.equal(Object.hasOwn(row, 'runtimeErrorOrigin'), false, `${sent}: ${row.instance}`);
    // So the panel's key is the shared home's own: the kernel's text, left as it is, is the kernel's.
    const rows = rosterRows(read, WAITING), print = collector(row => ({ tmux: row.tmux, running: true, runtimeState: 'running' }));
    assert.deepEqual(origins(panelInstances(rows, livenessAnswers(rows, print(livenessInput(rows))))),
      { up: [undefined, undefined, false], lost: ['the kernel could not read the socket', 'kernel', true] }, sent);
  }
});
