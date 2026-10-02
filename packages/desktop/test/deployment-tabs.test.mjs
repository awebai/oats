// The Deployments page's tabs and labels (UI spec, #482): All first with two or more deployments, the
// machine as the label (with the path tail when one machine holds two), and the tab remembered per view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { machineLabels, pathTail } from '../renderer/deployment-label.mjs';
import { deploymentTabs, selectedDeploymentTab, rememberDeploymentTab, rememberedDeploymentTab, requestDeploymentTab, onDeploymentTabRequest,
  DEPLOYMENT_TAB_KEY, DEPLOYMENT_TAB_VIEWS_MAX, ALL_TAB } from '../renderer/deployment-tabs.mjs';

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), map: m }; };
const local = (path) => ({ id: path, machine: 'This Mac', path, local: true, reachable: true });
const far = (server, path) => ({ id: `remote:${server}:aaaaaaaaaaaa`, machine: server, path, local: false, reachable: true });

test('machine labels: the machine alone, its path tail only when one machine holds two, never an id', () => {
  assert.equal(pathTail('/Users/juan/awebai/oats-v2'), 'oats-v2');
  assert.equal(pathTail('/a/b/c', 2), 'b/c');
  const labels = machineLabels([local('/Users/juan/Agents/oats'), local('/Users/juan/awebai/oats-v2'), far('altair', '/Users/juan/Agents/tsm')]);
  assert.deepEqual([...labels.values()], ['This Mac · oats', 'This Mac · oats-v2', 'altair']);
  const same = machineLabels([local('/a/x/oats'), local('/b/y/oats')]);
  assert.deepEqual([...same.values()], ['This Mac · x/oats', 'This Mac · y/oats'], 'colliding tails take two segments');
  assert.deepEqual([...machineLabels([far('vega', '')]).values()], ['vega']);
  for (const label of [...labels.values(), ...same.values()]) assert.doesNotMatch(label, /remote:|aaaaaaaaaaaa/);
});

test('tabs: All then each deployment in served order; one deployment has only its own tab', () => {
  const two = [local('/Users/juan/Agents/oats'), far('altair', '/srv/tsm')];
  assert.deepEqual(deploymentTabs(two).map(t => [t.id, t.label]), [[ALL_TAB, 'All'], ['/Users/juan/Agents/oats', 'This Mac'], ['remote:altair:aaaaaaaaaaaa', 'altair']]);
  assert.deepEqual(deploymentTabs([two[1]]).map(t => t.label), ['altair'], 'a single deployment: its tab, no All');
  assert.deepEqual(deploymentTabs([]), []);
});

test('the selected tab is remembered per view, falls back to the first, and storage failures change nothing', () => {
  const store = memory(), two = [local('/d1'), far('altair', '/srv')];
  assert.equal(selectedDeploymentTab('ws:v', two, store), ALL_TAB);
  rememberDeploymentTab('ws:v', 'remote:altair:aaaaaaaaaaaa', store);
  assert.equal(selectedDeploymentTab('ws:v', two, store), 'remote:altair:aaaaaaaaaaaa');
  assert.equal(selectedDeploymentTab('ws:v', [two[0]], store), '/d1', 'a remembered tab the view no longer has falls back');
  assert.equal(selectedDeploymentTab('ws:other', two, store), ALL_TAB, 'per view');
  for (let i = 0; i < DEPLOYMENT_TAB_VIEWS_MAX + 5; i++) rememberDeploymentTab(`ws:${i}`, '/d1', store);
  assert.equal(Object.keys(JSON.parse(store.map.get(DEPLOYMENT_TAB_KEY))).length, DEPLOYMENT_TAB_VIEWS_MAX, 'capped');
  assert.equal(rememberedDeploymentTab(`ws:${DEPLOYMENT_TAB_VIEWS_MAX + 4}`, store), '/d1', 'the most recent kept');
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(selectedDeploymentTab('ws:v', two, broken), ALL_TAB);
  assert.doesNotThrow(() => rememberDeploymentTab('ws:v', '/d1', broken));
  assert.equal(selectedDeploymentTab('ws:v', two, null), ALL_TAB);
});

test('a tab request is remembered and announced; a bad id is ignored', () => {
  const store = memory(), seen = [];
  const off = onDeploymentTabRequest(e => seen.push(e));
  requestDeploymentTab('/rigel-view', '/rigel-view', store);
  requestDeploymentTab('', '/x', store);
  requestDeploymentTab('ws:v', 'bad\nid', store);
  off();
  requestDeploymentTab('ws:v', '/d1', store);
  assert.deepEqual(seen, [{ view: '/rigel-view', tab: '/rigel-view' }]);
  assert.equal(rememberedDeploymentTab('/rigel-view', store), '/rigel-view');
});
