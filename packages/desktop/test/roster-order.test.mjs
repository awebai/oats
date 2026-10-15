// Two orders. The panel's list (awebai/oats#1083): running (`running === true`), then unknown (`null`, or anything
// not a boolean), then stopped (`false`); by name within each. One comparison, `byRuntimeState`
// (packages/client/instance-presentation.mjs), read by `panelInstances` (deployment-panel.mjs) and
// `rosterRank("status")` (instance-tree.mjs). The roster (#1262, Pepe's decision, comment 6196531154): by name,
// ties broken by instanceId, whatever runs; `clusterInstances` ranks clusters (by their first root) and children
// that way, so a start or a stop moves nothing. Each is fed a row of each state in every input order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { byRuntimeState } from '../../client/instance-presentation.mjs';
import { panelInstances } from '../../client/deployment-panel.mjs';
import { clusterInstances, rosterRank } from '../../client/instance-tree.mjs';

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
const statusOrder = rows => [...rows].sort(rosterRank('status')).map(i => i.instance);
/** A root with every row as its child: the order of children inside one cluster. */
const childOrder = rows => clusterInstances([{ instance: 'root', running: true }, ...rows.map(r => ({ ...r, parentInstance: 'root' }))])[0].instances.slice(1).map(i => i.instance);

for (const [what, order] of [['panelInstances', panelOrder], ['rosterRank("status")', statusOrder]]) {
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

/** The same rows by name: what the roster draws, whatever runs. */
const byName = rows => [...rows].map(([instance]) => instance).sort((a, b) => a.localeCompare(b));
for (const [what, order] of [['clusterInstances: clusters', clusterOrder], ['clusterInstances: children of one root', childOrder]]) {
  test(`${what}: by name, whatever runs and whatever the input order (#1262)`, () => {
    const one = permutations(ONE);
    for (const input of one) assert.deepEqual(order(input.map(row)), byName(ONE), JSON.stringify(input));
    const two = permutations(TWO);
    assert.equal(two.length, 720);
    for (const input of two) assert.deepEqual(order(input.map(row)), byName(TWO), JSON.stringify(input));
  });
}

test('the panel and rosterRank("status") give the same order for the same rows; the roster gives the name order', () => {
  for (const input of permutations(TWO)) {
    const panel = panelOrder(input.map(row));
    assert.deepEqual(statusOrder(input.map(row)), panel, JSON.stringify(input));
    assert.deepEqual(clusterOrder(input.map(row)), byName(TWO), JSON.stringify(input));
  }
});

test('the roster order is total: one name in two agents roots ranks by identity, the same whatever the input order', () => {
  const twins = [['dev', true, '/b/agents'], ['dev', false, '/a/agents'], ['dev', null, '/c/agents'], ['alpha', false, '/a/agents'], ['zulu', true, '/a/agents']]
    .map(([instance, running, agentsRoot]) => ({ instance, agentsRoot, home: `${agentsRoot}/${instance}`, running }));
  const roots = rows => clusterInstances(rows).map(c => `${c.instances[0].instance}@${c.instances[0].agentsRoot}`);
  const first = roots(twins);
  assert.deepEqual(first, ['alpha@/a/agents', 'dev@/a/agents', 'dev@/b/agents', 'dev@/c/agents', 'zulu@/a/agents']);
  for (const input of permutations(twins)) assert.deepEqual(roots(input), first, JSON.stringify(input.map(r => r.agentsRoot + r.instance)));
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
