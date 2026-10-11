// #461 against the shipped server and the scripted fake kernel (helpers/load-path-server.mjs):
// with more deployments than the observer admits at once, every one is still read each cycle,
// never more than MAX_DEPLOYMENT_OBSERVATIONS at a time, and a slow deployment holds one slot while
// the others go through the other: none is left on "pending" forever. And an explicit ?ws= the
// server does not serve is refused (404 E_WORKSPACE_NOT_SERVED), never answered with the first
// workspace. Orderings are controlled by gating the fake kernel's `status` calls, never timed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startLoadPathServer } from './helpers/load-path-server.mjs';
import { MAX_DEPLOYMENT_OBSERVATIONS } from '../../client/deployment-observer.mjs';

const dirOf = call => call.argv[call.argv.indexOf('--dir') + 1];

test('four deployments: each is read in the cycle, two at a time, and a slow one starves none', async () => {
  const s = await startLoadPathServer({ gated: ['status'], extra: 3 });
  try {
    await s.post('/api/window-state', { focused: false }); // cycles run on demand only
    const [d1, d2, d3, d4] = s.deployments;
    const inFlight = () => s.pending('status').map(dirOf);
    const atMostTwo = () => assert.ok(inFlight().length <= MAX_DEPLOYMENT_OBSERVATIONS, `in flight: ${inFlight().join(', ')}`);
    // The first cycle takes the first two deployments; the others wait for a slot, not for the next cycle.
    await s.until(() => inFlight().length === MAX_DEPLOYMENT_OBSERVATIONS || null);
    assert.deepEqual(inFlight().sort(), [d1, d2].sort());
    // d1 is slow (held at its gate). Releasing d2 frees a slot: d3 is read beside d1.
    s.release(s.pending('status').find(c => dirOf(c) === d2).id);
    await s.until(() => inFlight().includes(d3) || null);
    atMostTwo(); assert.ok(inFlight().includes(d1), 'the slow one still holds its slot');
    s.release(s.pending('status').find(c => dirOf(c) === d3).id);
    await s.until(() => inFlight().includes(d4) || null);
    atMostTwo(); assert.ok(inFlight().includes(d1));
    s.open('status'); // d4 and the slow d1 finish; later cycles run through
    for (const dir of [d1, d2, d3, d4]) {
      const panel = await s.until(async () => { const p = await s.get(`/api/panel?ws=${encodeURIComponent(dir)}`); return p.deployment?.status === 'observed' ? p : null; });
      assert.equal(panel.workspace.id, dir, 'each deployment is observed: none stays "pending"');
    }
    assert.deepEqual([...new Set(s.calls().filter(c => c.verb === 'status').map(dirOf))].sort(), [d1, d2, d3, d4].sort());
  } finally { await s.stop(); }
});

test('an explicit ?ws= the server does not serve is 404 E_WORKSPACE_NOT_SERVED on the roster and agents reads, never the first workspace', async () => {
  const s = await startLoadPathServer();
  try {
    for (const path of ['/api/panel', '/api/agents']) {
      // A local path, a bare id, a remote id the server no longer has: every explicit unknown ?ws=.
      for (const asked of ['/not/served', 'unknown', 'remote:gone']) {
        const refused = await s.getStatus(`${path}?ws=${encodeURIComponent(asked)}`);
        assert.equal(refused.status, 404, `${path} ?ws=${asked}`);
        assert.deepEqual(refused.body, { error: "This Desktop's server isn't serving this deployment.", code: 'E_WORKSPACE_NOT_SERVED', workspace: asked });
      }
      const served = await s.getStatus(`${path}${s.ws}`);
      assert.equal(served.status, 200); assert.equal(served.body.workspace.id, s.deployment);
      const none = await s.getStatus(path);
      assert.equal(none.status, 200, 'no ?ws= still means the first workspace'); assert.equal(none.body.workspace.id, s.deployment);
    }
  } finally { await s.stop(); }
});

test('an empty deployment (no souls, no instances) among three settles to observed-empty in the first cycle; the others are unchanged', async () => {
  // Juan's second repro: three deployments, the empty one listed last. Before the pool it was the one the
  // observer's two slots never admitted, so it stayed { status: "pending", observedAt: null, refreshing: false }
  // forever with no kernel read; an empty answer itself always settled.
  const s = await startLoadPathServer({ extra: 2, empty: [2] });
  try {
    const [full, other, empty] = s.deployments;
    const panelOf = dir => s.get(`/api/panel?ws=${encodeURIComponent(dir)}`);
    const observed = await s.until(async () => {
      const panels = await Promise.all([full, other, empty].map(panelOf));
      return panels.every(p => p.deployment?.status === 'observed') ? panels : null;
    });
    const [a, b, e] = observed;
    assert.equal(e.workspace.id, empty);
    assert.deepEqual(e.instances, [], 'observed and empty: not pending, not an error');
    assert.equal(e.running, 0); assert.equal(typeof e.observedAt, 'string', 'an observation was recorded');
    assert.equal(e.error, undefined); assert.equal(e.deployment.reason, undefined);
    assert.equal(e.deployment.root, `${empty}/agents`);
    const statusDirs = s.calls().filter(c => c.verb === 'status').map(c => c.argv[c.argv.indexOf('--dir') + 1]);
    assert.ok(statusDirs.includes(empty), 'the empty deployment was read by the kernel');
    // The non-empty deployments are unchanged: their rosters are the fixture's.
    for (const p of [a, b]) { assert.ok(p.instances.length > 0); assert.equal(p.instances[0].instance, 'release-manager-facts'); }
    // The agents read answers for it as observed (the catalog is the workspace's offer, not this roster).
    const agents = await s.getStatus(`/api/agents?ws=${encodeURIComponent(empty)}`);
    assert.equal(agents.status, 200); assert.ok(Array.isArray(agents.body.agents)); assert.ok(agents.body.catalog, 'observed: the catalog projection is present');
  } finally { await s.stop(); }
});
