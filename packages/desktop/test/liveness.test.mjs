import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeLiveness } from '../server/liveness.mjs';
import { HERDR_REMOVED } from '../renderer/terminal-contract.mjs';

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
