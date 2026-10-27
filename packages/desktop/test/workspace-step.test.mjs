// The leader's ↑ ↓ over the sidebar's list of workspaces (packages/client/workspace-step.mjs): the next
// openable row in a direction, passing over the others, from a current row or from none. Without `wrap` (the
// TUI's) it stops at the ends; with it (the Desktop's) it goes on from the other end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceStep } from '../../client/workspace-step.mjs';

const ROWS = Object.freeze([
  { key: 'a', openable: true }, { key: 'b', openable: false }, { key: 'c', openable: true },
  { key: 'd', openable: false }, { key: 'e', openable: true },
].map(Object.freeze));

test('down and up: the next openable row, passing over the rows that are not', () => {
  assert.equal(workspaceStep(ROWS, 'a', 1), 'c');
  assert.equal(workspaceStep(ROWS, 'c', 1), 'e');
  assert.equal(workspaceStep(ROWS, 'e', -1), 'c');
  assert.equal(workspaceStep(ROWS, 'c', -1), 'a');
  // From a row that is not openable itself: the next openable one either way.
  assert.equal(workspaceStep(ROWS, 'b', 1), 'c');
  assert.equal(workspaceStep(ROWS, 'd', -1), 'c');
});

test('no wrap: null at either end, and past the last openable row', () => {
  assert.equal(workspaceStep(ROWS, 'e', 1), null);
  assert.equal(workspaceStep(ROWS, 'a', -1), null);
  const tail = [{ key: 'x', openable: true }, { key: 'y', openable: false }];
  assert.equal(workspaceStep(tail, 'x', 1), null, 'only a row that cannot be opened below');
  assert.equal(workspaceStep(tail, 'y', -1), 'x');
});

test('a current key not among the rows, null included: the first openable row down, the last up', () => {
  for (const current of [null, undefined, 'gone']) {
    assert.equal(workspaceStep(ROWS, current, 1), 'a', String(current));
    assert.equal(workspaceStep(ROWS, current, -1), 'e', String(current));
  }
  const closed = [{ key: 'b', openable: false }, { key: 'c', openable: true }, { key: 'd', openable: false }];
  assert.equal(workspaceStep(closed, null, 1), 'c', 'the first openable, not the first row');
  assert.equal(workspaceStep(closed, null, -1), 'c', 'the last openable, not the last row');
});

test('nothing openable, or no rows: null; `openable` is true exactly, and nothing given is changed', () => {
  const none = [{ key: 'a', openable: false }, { key: 'b', openable: 'yes' }, { key: 'c' }];
  for (const step of [1, -1]) {
    assert.equal(workspaceStep(none, null, step), null);
    assert.equal(workspaceStep(none, 'a', step), null);
    assert.equal(workspaceStep([], null, step), null);
    assert.equal(workspaceStep(undefined, null, step), null);
  }
  // Frozen rows: a write would throw.
  assert.equal(workspaceStep(ROWS, 'c', 1), 'e');
  assert.equal(ROWS.length, 5);
});

// The Desktop's moves wrap (`wrap: true`); the TUI's call, without the option, is unchanged (above).
test('wrap: past the last openable row the first, before the first the last, rows that cannot be opened passed over', () => {
  const wrap = { wrap: true };
  assert.equal(workspaceStep(ROWS, 'e', 1, wrap), 'a');
  assert.equal(workspaceStep(ROWS, 'a', -1, wrap), 'e');
  assert.equal(workspaceStep(ROWS, 'a', 1, wrap), 'c', 'inside the list, as without wrap');
  assert.equal(workspaceStep(ROWS, 'c', -1, wrap), 'a');
  const edges = [{ key: 'x', openable: false }, { key: 'a', openable: true }, { key: 'b', openable: true }, { key: 'y', openable: false }];
  assert.equal(workspaceStep(edges, 'b', 1, wrap), 'a', 'y and x passed over across the wrap');
  assert.equal(workspaceStep(edges, 'a', -1, wrap), 'b', 'x and y passed over across the wrap');
  assert.equal(workspaceStep(edges, 'y', 1, wrap), 'a', 'from a row that is not openable itself');
});

test('wrap: the current row alone openable answers itself ("only this one"); none openable, null', () => {
  const wrap = { wrap: true };
  const alone = [{ key: 'x', openable: false }, { key: 'a', openable: true }, { key: 'y', openable: false }];
  for (const step of [1, -1]) {
    assert.equal(workspaceStep(alone, 'a', step, wrap), 'a', `${step}: only this one`);
    assert.equal(workspaceStep([{ key: 'a', openable: true }], 'a', step, wrap), 'a', `${step}: a list of one`);
    assert.equal(workspaceStep(alone, 'x', step, wrap), 'a', `${step}: from a row that cannot be opened, the one that can`);
    assert.equal(workspaceStep([{ key: 'x', openable: false }], 'x', step, wrap), null, `${step}: none`);
    assert.equal(workspaceStep([], null, step, wrap), null);
    assert.equal(workspaceStep(undefined, 'a', step, wrap), null);
  }
});

test('wrap: with no current row, as without it: the first openable row down, the last up', () => {
  for (const current of [null, undefined, 'gone']) {
    assert.equal(workspaceStep(ROWS, current, 1, { wrap: true }), 'a', String(current));
    assert.equal(workspaceStep(ROWS, current, -1, { wrap: true }), 'e', String(current));
  }
});
