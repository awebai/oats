// A retire in progress, as the shared home reads it (awebai/oats#1247): the kernel's row field `retire` (feature
// `status-retire-state`, packages/client/retire-state.mjs), the held home every client draws from it
// (instance-tree.mjs `heldHome`), the acts it offers (instance-acts.mjs) and the places that carry it from a roster
// read to a row (deployment-data.mjs, deployment-panel.mjs, remote-roster.mjs `remotePanel`). A retire that runs
// reads Retiring…, never as a failure; one that failed says so, in the kernel's words through the display filter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { retireData, RETIRE_STATES } from '../packages/client/retire-state.mjs';
import { heldHome } from '../packages/client/instance-tree.mjs';
import { instanceActs, openAct } from '../packages/client/instance-acts.mjs';
import { displayLine, DETAIL_WITHHELD, MAX_DISPLAY_LINE } from '../packages/client/display-text.mjs';
import { deploymentStatusData } from '../packages/client/deployment-data.mjs';
import { rosterRows, panelInstances } from '../packages/client/deployment-panel.mjs';
import { remotePanel } from '../packages/client/remote-roster.mjs';
import { kernelRemoteRow, kernelRemoteGroup } from '../packages/desktop/test/helpers/kernel-remote-row.mjs';

/** The time a remote panel is made at: remotePanel reads no clock, its caller gives the time. */
const AT = '2026-10-15T12:00:00.000Z';
const SINCE = '2026-10-15T11:59:00.000Z';
const LOCAL = { instance: 'dev-one', home: '/agents/dev/instances/dev-one', running: true };
const retire = (state, extra = {}) => ({ state, since: SINCE, self: false, ...extra });
const RUNNING = retire('running'), UNKNOWN = retire('unknown'), INTERRUPTED = retire('interrupted');
const FAILED = retire('failed', { self: true, code: 'E_RETIRE_FAILED', message: 'worktree remove failed' });

test('retireData: the contract\'s value, each field checked; extra fields are dropped', () => {
  assert.deepEqual(RETIRE_STATES, ['running', 'unknown', 'failed', 'interrupted']);
  for (const state of RETIRE_STATES) assert.deepEqual(retireData(retire(state)), { state, since: SINCE, self: false }, state);
  assert.deepEqual(retireData(FAILED), FAILED);
  assert.deepEqual(retireData(retire('failed', { code: 'E_X_2', message: '' })), retire('failed', { code: 'E_X_2', message: '' }), 'an empty message is a string');
  // An absent optional stays absent: the key is not there.
  const bare = retireData(retire('failed')); assert.equal(Object.hasOwn(bare, 'code'), false); assert.equal(Object.hasOwn(bare, 'message'), false);
  // What the contract does not name is not carried.
  assert.deepEqual(retireData({ ...FAILED, holder: 'pid 42', resultPath: '/x', state: 'failed' }), FAILED);
  // The answer is a copy: changing it changes nothing of the input.
  const input = retire('running'), read = retireData(input); read.state = 'failed'; assert.equal(input.state, 'running');
});

test('retireData: one field out of the contract drops the whole value, and what is not an object is null', () => {
  for (const value of [undefined, null, false, true, 0, 1, '', 'running', [], [RUNNING], () => RUNNING]) assert.equal(retireData(value), null, String(value));
  const bad = {
    'no state': { since: SINCE, self: false }, 'a state the contract does not name': retire('done'), 'a state in capitals': retire('Running'),
    'a state that is not a string': retire(1), 'no since': { state: 'running', self: false }, 'a since that is a number': retire('running', { since: 1 }),
    'a since that is null': retire('running', { since: null }), 'no self': { state: 'running', since: SINCE }, 'a self that is a string': retire('running', { self: 'true' }),
    'a self that is null': retire('running', { self: null }), 'a self that is 1': retire('running', { self: 1 }),
    'a code that is not E_': retire('failed', { code: 'RETIRE_FAILED' }), 'a code with nothing after E_': retire('failed', { code: 'E_' }),
    'a code in lower case': retire('failed', { code: 'E_retire' }), 'a code with a space': retire('failed', { code: 'E_A B' }),
    'a code with a line after it': retire('failed', { code: 'E_A\nE_B' }), 'a code that is a number': retire('failed', { code: 7 }),
    'a code that is null': retire('failed', { code: null, message: 'x' }), 'a message that is null': retire('failed', { code: 'E_X', message: null }),
    'a message that is a number': retire('failed', { message: 7 }), 'a message that is an object': retire('failed', { message: { text: 'x' } }),
  };
  for (const [what, value] of Object.entries(bad)) assert.equal(retireData(value), null, what);
});

test('heldHome: every retire kind, and an older kernel\'s retirePending, reads its row state', () => {
  const retiring = { kind: 'retiring', state: 'Retiring…', status: 'Retiring…', retire: 'secondary', said: { sentence: 'dev-one is being retired.' } };
  const failed = (said) => ({ kind: 'retire-failed', state: 'Retire failed', status: 'Retire failed', hint: 'Retire it again to finish', retire: true, said });
  const incomplete = { kind: 'retire-incomplete', state: "Retire didn't finish", status: "Retire didn't finish", hint: 'Retire it again to complete', retire: true,
    said: { sentence: "The retire of dev-one didn't finish. Retire it again to complete." } };
  const table = [
    ['running', { retire: RUNNING }, retiring],
    ['unknown: the holder\'s liveness can\'t be read', { retire: UNKNOWN }, retiring],
    ['an older kernel: retirePending and no retire', { retirePending: true }, retiring],
    ['running beside retirePending', { retire: RUNNING, retirePending: true }, retiring],
    ['running with a message: not a failure, no kernel words', { retire: retire('running', { code: 'E_X', message: 'still going' }) }, retiring],
    ['failed, with the kernel\'s message and code', { retire: FAILED }, failed({ sentence: 'worktree remove failed (E_RETIRE_FAILED)', origin: 'kernel' })],
    ['failed, with a message only', { retire: retire('failed', { message: 'worktree remove failed' }) }, failed({ sentence: 'worktree remove failed', origin: 'kernel' })],
    ['failed, with a code only', { retire: retire('failed', { code: 'E_RETIRE_FAILED' }) }, failed({ sentence: 'E_RETIRE_FAILED', origin: 'kernel' })],
    ['failed, with an empty message and a code', { retire: retire('failed', { code: 'E_RETIRE_FAILED', message: '' }) }, failed({ sentence: 'E_RETIRE_FAILED', origin: 'kernel' })],
    ['failed, with nothing recorded', { retire: retire('failed') }, failed({ sentence: 'The retire of dev-one failed. Retire it again to finish.' })],
    ['failed beside retirePending: the kernel\'s retire wins', { retire: FAILED, retirePending: true }, failed({ sentence: 'worktree remove failed (E_RETIRE_FAILED)', origin: 'kernel' })],
    ['interrupted', { retire: INTERRUPTED }, incomplete],
    ['interrupted with a message: the sentence is this home\'s', { retire: retire('interrupted', { code: 'E_X', message: 'gone' }) }, incomplete],
    ['a malformed retire beside retirePending: the older reading', { retire: retire('done'), retirePending: true }, retiring],
  ];
  for (const [what, facts, expected] of table) {
    const held = heldHome({ ...LOCAL, ...facts });
    assert.equal(typeof held.sentence, 'function', what);
    const { sentence: _sentence, ...shown } = held;
    assert.deepEqual(shown, expected, what);
    assert.equal(Object.hasOwn(held, 'hint'), expected.kind !== 'retiring', `${what}: a muted line except while retiring`);
  }
  // No retire, or one out of the contract and no retirePending: no hold at all.
  for (const facts of [{}, { retire: retire('done') }, { retire: null }, { retire: 'running' }, { retirePending: false }])
    assert.equal(heldHome({ ...LOCAL, ...facts }), null, JSON.stringify(facts));
  assert.equal(heldHome(null), null); assert.equal(heldHome(undefined), null);
});

test('heldHome: a spawn\'s hold wins over every retire kind; this client\'s own retire in flight wins over all', () => {
  const kinds = { running: { retire: RUNNING }, unknown: { retire: UNKNOWN }, failed: { retire: FAILED }, interrupted: { retire: INTERRUPTED }, pending: { retirePending: true } };
  for (const [name, facts] of Object.entries(kinds)) {
    assert.equal(heldHome({ ...LOCAL, ...facts, rollbackIncomplete: true }).kind, 'spawn-incomplete', `${name}: rollbackIncomplete`);
    assert.equal(heldHome({ ...LOCAL, ...facts, spawnInProgress: true }).kind, 'spawning', `${name}: spawnInProgress`);
    assert.equal(heldHome({ ...LOCAL, ...facts, spawnInProgress: true, rollbackIncomplete: true }).kind, 'spawn-incomplete', `${name}: both, the spawn is gone`);
    // A spawn in progress that is not `true` is no hold: the retire reads.
    assert.equal(heldHome({ ...LOCAL, ...facts, spawnInProgress: 'true' }).kind, heldHome({ ...LOCAL, ...facts }).kind, `${name}: spawnInProgress 'true'`);
  }
  for (const facts of [{}, ...Object.values(kinds), { rollbackIncomplete: true }, { spawnInProgress: true }, { rollbackIncomplete: true, spawnInProgress: true, retire: FAILED }]) {
    const held = heldHome({ ...LOCAL, ...facts, retireInFlight: true });
    assert.equal(held.kind, 'retiring', JSON.stringify(facts));
    assert.deepEqual(held.said, { sentence: 'dev-one is being retired.' }, `${JSON.stringify(facts)}: this home's sentence, never the kernel's words of a failure`);
  }
  // Only `true` is this client's hold.
  for (const value of ['true', 1, {}]) assert.equal(heldHome({ ...LOCAL, retireInFlight: value }), null, String(value));
});

test('instanceActs: a retiring row offers Retire alone, secondary; a failed or interrupted one offers it as the act, and openAct is null', () => {
  const secondary = { verb: 'retire', enabled: true, reason: null, secondary: true }, retireAct = { verb: 'retire', enabled: true, reason: null };
  const limited = (kind, sentence, extra = {}) => ({ code: 'held', kind, sentence, ...extra });
  for (const facts of [{ retire: RUNNING }, { retire: UNKNOWN }, { retirePending: true }, { retireInFlight: true }, { retireInFlight: true, retire: FAILED }]) {
    for (const running of [true, false, null]) {
      const row = { ...LOCAL, ...facts, running };
      assert.deepEqual(instanceActs(row), { blocked: null, limited: limited('retiring', 'dev-one is being retired.'), acts: [secondary] }, JSON.stringify(row));
      assert.equal(openAct(row), null, `${JSON.stringify(row)}: nothing opens`);
    }
  }
  assert.deepEqual(instanceActs({ ...LOCAL, retire: FAILED }),
    { blocked: null, limited: limited('retire-failed', 'worktree remove failed (E_RETIRE_FAILED)', { origin: 'kernel' }), acts: [retireAct] });
  assert.deepEqual(instanceActs({ ...LOCAL, retire: retire('failed', { code: 'E_RETIRE_FAILED' }) }),
    { blocked: null, limited: limited('retire-failed', 'E_RETIRE_FAILED', { origin: 'kernel' }), acts: [retireAct] });
  assert.deepEqual(instanceActs({ ...LOCAL, retire: retire('failed') }),
    { blocked: null, limited: limited('retire-failed', 'The retire of dev-one failed. Retire it again to finish.'), acts: [retireAct] });
  assert.deepEqual(instanceActs({ ...LOCAL, retire: INTERRUPTED }),
    { blocked: null, limited: limited('retire-incomplete', "The retire of dev-one didn't finish. Retire it again to complete."), acts: [retireAct] });
  for (const retireValue of [FAILED, INTERRUPTED]) assert.equal(openAct({ ...LOCAL, retire: retireValue }), null);
  // Only Retire on a retiring row is ever secondary.
  for (const facts of [{}, { running: false }, { retire: FAILED }, { retire: INTERRUPTED }, { rollbackIncomplete: true }])
    for (const act of instanceActs({ ...LOCAL, ...facts }).acts) assert.equal(Object.hasOwn(act, 'secondary'), false, JSON.stringify(facts));
  // A spawn's hold is drawn before the retire's; a remote row the kernel does not report addressable before both.
  assert.equal(instanceActs({ ...LOCAL, retire: RUNNING, spawnInProgress: true }).blocked.kind, 'spawning');
  assert.equal(instanceActs({ ...LOCAL, home: '/remote/dev-one', server: 'host', repoName: 'Build box', addressable: false, retire: RUNNING }).blocked.code, 'unaddressable');
});

test('a failed retire\'s kernel words reach the screen only through the display filter', () => {
  const said = message => heldHome({ ...LOCAL, retire: retire('failed', { code: 'E_RETIRE_FAILED', message }) }).said;
  // The reason carries the kernel's text as it came, marked as the kernel's: a client filters it.
  assert.deepEqual(said('a\nb'), { sentence: 'a\nb (E_RETIRE_FAILED)', origin: 'kernel' });
  // A line break is a space; an escape sequence withholds the whole text; a bidi override is replaced, never dropped.
  assert.equal(displayLine(said('git worktree remove failed:\nfatal: busy').sentence), 'git worktree remove failed: fatal: busy (E_RETIRE_FAILED)');
  assert.equal(displayLine(said('\u001b[31mfailed\u001b[0m').sentence), DETAIL_WITHHELD);
  assert.equal(displayLine(said('\u001b]0;title\u0007').sentence), DETAIL_WITHHELD);
  assert.equal(displayLine(said('done ‮liaf').sentence), 'done �liaf (E_RETIRE_FAILED)');
  assert.equal(displayLine(said('token=abc123 rejected').sentence), DETAIL_WITHHELD, 'a secret is withheld whole');
  // An over-long message is cut to the filter's bound: its code past the bound is not shown.
  const long = displayLine(said('x'.repeat(10_000)).sentence);
  assert.equal(long.length, MAX_DISPLAY_LINE); assert.equal(long, 'x'.repeat(MAX_DISPLAY_LINE));
  // The reason instanceActs gives is the same text, with the same mark.
  const reason = instanceActs({ ...LOCAL, retire: retire('failed', { message: '\u001b[2Jgone' }) }).limited;
  assert.equal(reason.origin, 'kernel'); assert.equal(displayLine(reason.sentence), DETAIL_WITHHELD);
  // A message the filter reduces to nothing says nothing: the code alone is said, as the kernel's; with no code, the
  // row's own words stand.
  assert.deepEqual(said(' \n '), { sentence: 'E_RETIRE_FAILED', origin: 'kernel' });
  assert.deepEqual(heldHome({ ...LOCAL, retire: retire('failed', { message: '\t' }) }).said, { sentence: 'The retire of dev-one failed. Retire it again to finish.' });
  // A code is the kernel's text too, with or without a message: an over-long one is cut to the filter's bound, one the
  // filter withholds is withheld, never shown as it came.
  const code = value => heldHome({ ...LOCAL, retire: retire('failed', { code: value }) }).said;
  const longCode = code(`E_${'X'.repeat(5000)}`);
  assert.equal(longCode.origin, 'kernel'); assert.equal(displayLine(longCode.sentence).length, MAX_DISPLAY_LINE);
  const secretCode = code(`E_GHP_${'A'.repeat(20)}`);
  assert.equal(secretCode.origin, 'kernel'); assert.equal(displayLine(secretCode.sentence), DETAIL_WITHHELD);
  const both = heldHome({ ...LOCAL, retire: retire('failed', { code: `E_GHP_${'A'.repeat(20)}`, message: 'worktree remove failed' }) }).said;
  assert.equal(both.origin, 'kernel'); assert.equal(displayLine(both.sentence), DETAIL_WITHHELD);
});

/** A status document of one deployment at /d, one soul and the rows given. */
const status = (...instances) => ({ root: '/d/agents', agents: [{ name: 'dev', dir: '/d/agents/dev',
  instances: instances.map(([name, extra]) => ({ instance: name, home: `/d/agents/dev/instances/${name}`, running: true, ...extra })) }] });
const rowsOf = data => data.agents.flatMap(agent => agent.instances);

test('deploymentStatusData keeps a valid retire and drops a malformed one; the row and the roster stay', () => {
  const data = deploymentStatusData(status(['dev-a', { retire: FAILED }], ['dev-b', { retire: { ...RUNNING, holder: 42 } }], ['dev-c', { retire: retire('done') }],
    ['dev-d', { retire: retire('failed', { code: 'nope' }), retirePending: true }], ['dev-e', { retire: null }], ['dev-f', {}]), '/d');
  const [a, b, c, d, e, f] = rowsOf(data);
  assert.deepEqual(a.retire, FAILED);
  assert.deepEqual(b.retire, RUNNING, 'an extra field is dropped, the value kept');
  for (const row of [c, d, e, f]) assert.equal(Object.hasOwn(row, 'retire'), false, row.instance);
  assert.equal(d.retirePending, true, 'retirePending is a fact of its own and stays');
  assert.deepEqual(rowsOf(data).map(row => row.instance), ['dev-a', 'dev-b', 'dev-c', 'dev-d', 'dev-e', 'dev-f'], 'a malformed retire fails no row');
  assert.deepEqual(data.withheld, []);
  assert.deepEqual(rowsOf(data).map(row => heldHome(row)?.kind ?? null), ['retire-failed', 'retiring', null, 'retiring', null, null]);
});

test('the panel projects a row\'s retire, read again: a value out of the contract is absent', () => {
  const data = deploymentStatusData(status(['dev-a', { retire: RUNNING }], ['dev-b', { retire: INTERRUPTED }], ['dev-c', {}]), '/d');
  const rows = rosterRows(data, { features: [] });
  const panel = panelInstances(rows, rows.map(() => ({})));
  const by = name => panel.find(row => row.instance === name);
  assert.deepEqual(by('dev-a').retire, RUNNING); assert.deepEqual(by('dev-b').retire, INTERRUPTED);
  assert.equal(Object.hasOwn(by('dev-c'), 'retire'), false);
  assert.equal(heldHome(by('dev-a')).kind, 'retiring'); assert.equal(heldHome(by('dev-b')).kind, 'retire-incomplete');
  // A row handed to the panel with a value that is not the contract's (not through deployment-data) gets none.
  const raw = [{ ...rows[2], retire: retire('failed', { self: 'yes' }) }, { ...rows[2], instance: 'dev-x', home: '/d/agents/dev/instances/dev-x', retire: { ...FAILED, extra: 1 } }];
  const [bad, extra] = panelInstances(raw, raw.map(() => ({}))).sort((x, y) => x.instance.localeCompare(y.instance));
  assert.equal(Object.hasOwn(bad, 'retire'), false); assert.deepEqual(extra.retire, FAILED);
});

test('remotePanel relays a remote row\'s valid retire unchanged and drops a malformed one', () => {
  const group = kernelRemoteGroup([kernelRemoteRow('dev-run', { retire: RUNNING }), kernelRemoteRow('dev-fail', { retire: FAILED }),
    kernelRemoteRow('dev-bad', { retire: retire('failed', { code: 'E_x' }) }), kernelRemoteRow('dev-extra', { retire: { ...INTERRUPTED, resultPath: '/r' } }),
    kernelRemoteRow('dev-none'), kernelRemoteRow('dev-old', { retirePending: true })]);
  const rows = remotePanel(group, AT).instances, by = name => rows.find(row => row.instance === name);
  assert.deepEqual(by('dev-run').retire, RUNNING); assert.deepEqual(by('dev-fail').retire, FAILED); assert.deepEqual(by('dev-extra').retire, INTERRUPTED);
  for (const name of ['dev-bad', 'dev-none', 'dev-old']) assert.equal(Object.hasOwn(by(name), 'retire'), false, name);
  // The host's row reads as a local one: running reads Retiring…, a failure says the host's words.
  assert.equal(heldHome(by('dev-run')).kind, 'retiring');
  assert.deepEqual(heldHome(by('dev-fail')).said, { sentence: 'worktree remove failed (E_RETIRE_FAILED)', origin: 'kernel' });
  assert.equal(heldHome(by('dev-bad')), null, 'a malformed retire beside the kernel shape\'s retirePending: false is no hold');
  assert.equal(heldHome(by('dev-old')).kind, 'retiring', 'an older host: retirePending reads Retiring…');
  assert.deepEqual(instanceActs(by('dev-run')).acts, [{ verb: 'retire', enabled: true, reason: null, secondary: true }]);
  // A server not reached: its rows are last-known, the relayed retire with them.
  const unreached = remotePanel(kernelRemoteGroup([kernelRemoteRow('dev-run', { retire: RUNNING })], { probe: { ok: false, error: { message: 'unreachable' } } }), AT).instances[0];
  assert.deepEqual(unreached.retire, RUNNING);
});
