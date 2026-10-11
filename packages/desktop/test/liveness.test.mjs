import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeLiveness } from '../../client/liveness.mjs';
import { HERDR_REMOVED } from '../../client/terminal-contract.mjs';

const sessionTarget = { backend: 'herdr', protocol: 20, socket: '/memory/herdr.sock', paneId: 'w1:pA', terminalId: 'term_ABC' };
const kernelText = `E_HERDR_REMOVED: ${HERDR_REMOVED}`;
function reader() {
  const seen = [];
  return { seen, tmuxReader: (row) => { seen.push(row.instance); return { tmux: row.tmux, running: true, runtimeState: 'running' }; } };
}

test('a Herdr row is unsupported with the kernel runtimeError, and nothing probes it', () => {
  const r = reader();
  const [row] = observeLiveness([{ instance: 'h1', sessionTarget, runtimeState: 'unsupported', runtimeError: `${kernelText} (h1)` }], r);
  assert.deepEqual(row, { running: null, runtimeState: 'unsupported', runtimeError: `${kernelText} (h1)`, tmux: null });
  assert.deepEqual(r.seen, []);
});

test('an older kernel Herdr row (sessionTarget, no unsupported state) gets the interface stem, never its probe error', () => {
  const r = reader();
  const rows = observeLiveness([
    { instance: 'h1', sessionTarget },
    { instance: 'h2', sessionTarget, runtimeState: 'unreachable', runtimeError: 'spawn herdr ENOENT' },
    { instance: 'h3', runtimeState: 'unsupported' },
  ], r);
  for (const row of rows) assert.deepEqual(row, { running: null, runtimeState: 'unsupported', runtimeError: kernelText, tmux: null });
  assert.deepEqual(r.seen, []);
});

test('tmux rows are still observed through the tmux reader, next to a Herdr row', () => {
  const r = reader(), tmux = { session: 'oats-agents', window: 't1', socket: '/memory/tmux.sock' };
  const rows = observeLiveness([{ instance: 't1', tmux }, { instance: 'h1', sessionTarget }], r);
  assert.deepEqual(rows[0], { tmux, running: true, runtimeState: 'running' });
  assert.equal(rows[1].runtimeState, 'unsupported');
  assert.deepEqual(r.seen, ['t1']);
});

// A row the kernel answered as unknown stays unknown (#855, 1d): the probe refines only `running` true or false.
const unknownRow = (instance, extra = {}) => ({ instance, running: null, ...extra });

test('one row per kernel answer: true and false are probed, null is not and keeps the kernel\'s state and reason', () => {
  const r = reader(), tmux = { session: 'oats-agents', window: 'x', socket: '/memory/tmux.sock' };
  const rows = [
    { instance: 'yes', running: true, runtimeState: 'running', tmux },
    { instance: 'no', running: false, runtimeState: 'stopped', tmux },
    unknownRow('unreachable', { runtimeState: 'unreachable', runtimeError: 'error connecting to /memory/tmux.sock', tmux }),
    unknownRow('unsupported', { runtimeState: 'unsupported', runtimeError: `${kernelText} (unsupported)`, tmux }),
    unknownRow('a-later-state', { runtimeState: 'unidentified', runtimeError: 'E_UNIDENTIFIED_INSTANCE_HOME: instance.json cannot be read' }),
    unknownRow('no-state'),
  ];
  const answers = observeLiveness(rows, r);
  assert.deepEqual(r.seen, ['yes', 'no'], 'the reader was asked for the two rows the kernel answered, once each');
  assert.deepEqual(answers[0], { tmux, running: true, runtimeState: 'running' });
  assert.deepEqual(answers[1], { tmux, running: true, runtimeState: 'running' }, 'the probe\'s answer replaces the kernel\'s false');
  assert.deepEqual(answers[2], { running: null, runtimeState: 'unreachable', runtimeError: 'error connecting to /memory/tmux.sock' });
  assert.deepEqual(answers[3], { running: null, runtimeState: 'unsupported', runtimeError: `${kernelText} (unsupported)`, tmux: null }, 'unsupported is decided first, as before');
  assert.deepEqual(answers[4], { running: null, runtimeState: 'unidentified', runtimeError: 'E_UNIDENTIFIED_INSTANCE_HOME: instance.json cannot be read' }, 'a state name this client does not know is kept as it is');
  assert.deepEqual(answers[5], { running: null, runtimeState: 'unreachable' }, 'no state name reads unreachable, and no reason is invented');
  // No `tmux` key in a kept answer: the merged row keeps the kernel's own.
  for (const n of [2, 4, 5]) assert.equal(Object.hasOwn(answers[n], 'tmux'), false, rows[n].instance);
});

test('an unknown row\'s reason is cut at 300 characters as the other answers are, and left out when the row has none', () => {
  const r = reader(), long = 'x'.repeat(1000);
  const [cut, empty, absent, number] = observeLiveness([unknownRow('a', { runtimeState: 'unreachable', runtimeError: long }), unknownRow('b', { runtimeError: '' }),
    unknownRow('c', { runtimeError: null }), unknownRow('d', { runtimeError: 404 })], r);
  assert.equal(cut.runtimeError.length, 300);
  for (const answer of [empty, absent]) assert.deepEqual(answer, { running: null, runtimeState: 'unreachable' });
  assert.deepEqual(number, { running: null, runtimeState: 'unreachable', runtimeError: '404' });
  assert.deepEqual(r.seen, []);
});

test('an older kernel\'s Herdr row answered unknown and unreachable still reads unsupported, never its probe error', () => {
  const r = reader();
  const [row] = observeLiveness([unknownRow('h2', { sessionTarget, runtimeState: 'unreachable', runtimeError: 'spawn herdr ENOENT' })], r);
  assert.deepEqual(row, { running: null, runtimeState: 'unsupported', runtimeError: kernelText, tmux: null });
  assert.deepEqual(r.seen, []);
});

test('a row without a `running` key is probed, and so is one whose `running` is not null', () => {
  const r = reader();
  const rows = observeLiveness([{ instance: 'bare' }, { instance: 'undefined', running: undefined }, { instance: 'zero', running: 0 }, { instance: 'text', running: 'unknown' }], r);
  assert.deepEqual(r.seen, ['bare', 'undefined', 'zero', 'text']);
  for (const row of rows) assert.equal(row.running, true);
});

test('the rule that keeps a row unprobed: it is left only when the kernel answered `running: null`, and it leaves as null', () => {
  // Every kernel answer against every reader verdict: a row the reader was not asked about has `running: null`
  // in and out, and a row the kernel answered null never leaves as true or false, whatever the reader would say.
  const kernel = [true, false, null, undefined], states = [undefined, 'running', 'stopped', 'unreachable', 'unsupported', 'unidentified'];
  const targets = [{}, { tmux: { session: 's', window: 'w' } }, { tmux: null }, { sessionTarget }];
  const rows = kernel.flatMap(running => states.flatMap(runtimeState => targets.map((target, n) => ({
    instance: `${running}-${runtimeState}-${n}`, ...(running === undefined ? {} : { running }), ...(runtimeState ? { runtimeState } : {}), ...target }))));
  for (const verdict of [{ running: true, runtimeState: 'running' }, { running: false, runtimeState: 'stopped' }, { running: null, runtimeState: 'unreachable', runtimeError: 'no server' }]) {
    const seen = [], answers = observeLiveness(rows, { tmuxReader: row => { seen.push(row.instance); return { tmux: row.tmux, ...verdict }; } });
    assert.equal(answers.length, rows.length);
    rows.forEach((row, n) => {
      const herdr = row.sessionTarget !== undefined || row.runtimeState === 'unsupported';
      assert.equal(seen.includes(row.instance), !herdr && row.running !== null, `${row.instance}: probed exactly when the kernel answered and the session is one OATS has`);
      if (!seen.includes(row.instance)) assert.equal(answers[n].running, null, `${row.instance}: a row left unprobed is unknown`);
      if (!seen.includes(row.instance) && !herdr) assert.equal(row.running, null, `${row.instance}: left unprobed only because the kernel answered null`);
      if (row.running === null) assert.equal(answers[n].running, null, `${row.instance}: the kernel's unknown stays unknown`);
    });
  }
});
