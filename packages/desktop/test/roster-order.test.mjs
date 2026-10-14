// The roster's one order (awebai/oats#1083): running (`running === true`), then unknown (`null`, or anything
// not a boolean), then stopped (`false`); by name within each. One comparison, `byRuntimeState`
// (packages/client/instance-presentation.mjs), read by both sorts: `panelInstances` (deployment-panel.mjs) and
// `clusterInstances` (instance-tree.mjs). Each sort is fed a row of each state in every input order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { byRuntimeState } from '../../client/instance-presentation.mjs';
import { panelInstances } from '../../client/deployment-panel.mjs';
import { clusterInstances } from '../../client/instance-tree.mjs';

/** Every order of `items`. */
const permutations = items => items.length <= 1 ? [items] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]));
/** Names that sort against the states (stopped < unknown < running by name), so only the state can put a
 * running row first. */
const ONE = [['z-run', true], ['m-unknown', null], ['a-stopped', false]];
const TWO = [['z1-run', true], ['z2-run', true], ['m1-unknown', null], ['m2-unknown', 'yes'], ['a1-stopped', false], ['a2-stopped', false]];
const want = rows => rows.map(([instance]) => instance);
const row = ([instance, running]) => ({ instance, agentsRoot: '/d/agents', running });

const panelOrder = rows => panelInstances(rows, rows.map(() => ({}))).map(i => i.instance);
const clusterOrder = rows => clusterInstances(rows).map(c => c.instances[0].instance);
/** A root with every row as its child: the order of children inside one cluster. */
const childOrder = rows => clusterInstances([{ instance: 'root', running: true }, ...rows.map(r => ({ ...r, parentInstance: 'root' }))])[0].instances.slice(1).map(i => i.instance);

for (const [what, order] of [['panelInstances', panelOrder], ['clusterInstances: clusters', clusterOrder], ['clusterInstances: children of one root', childOrder]]) {
  test(`${what}: running, then unknown, then stopped, whatever the input order`, () => {
    const one = permutations(ONE);
    assert.equal(one.length, 6);
    for (const input of one) assert.deepEqual(order(input.map(row)), want(ONE), JSON.stringify(input));
    // Two names per state: all 720 orders of the six rows.
    const two = permutations(TWO);
    assert.equal(two.length, 720);
    for (const input of two) assert.deepEqual(order(input.map(row)), want(TWO), JSON.stringify(input));
  });
}

test('both sorts give the same order for the same rows', () => {
  for (const input of permutations(TWO)) assert.deepEqual(panelOrder(input.map(row)), clusterOrder(input.map(row)));
});

test('byRuntimeState is a total order whatever `running` holds: anything not a boolean is unknown', () => {
  const values = [true, false, null, undefined, 'true', 'false', 1, 0, {}, []];
  const rows = values.flatMap((running, i) => [{ instance: `x${i}`, running }, { instance: `y${i}`, running }]);
  const sign = (a, b) => Math.sign(byRuntimeState(a, b));
  for (const a of rows) {
    assert.equal(sign(a, a), 0);
    for (const b of rows) {
      assert.equal(sign(a, b) + sign(b, a), 0, `${a.instance} ${b.instance}`);
      for (const c of rows) if (sign(a, b) <= 0 && sign(b, c) <= 0) assert.ok(sign(a, c) <= 0, `${a.instance} ${b.instance} ${c.instance}`);
    }
  }
  const sorted = [...rows].sort(byRuntimeState);
  assert.deepEqual(sorted.slice(0, 2).map(r => r.running), [true, true]);
  assert.deepEqual(sorted.slice(-2).map(r => r.running), [false, false]);
  assert.ok(sorted.slice(2, -2).every(r => typeof r.running !== 'boolean'), 'every non-boolean stands between them');
});
