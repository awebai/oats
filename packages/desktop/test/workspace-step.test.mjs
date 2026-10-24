// The leader's ↑ ↓ over the sidebar's list of workspaces (packages/client/workspace-step.mjs): the next
// openable row in a direction, passing over the others, with no wrap, from a current row or from none.
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
