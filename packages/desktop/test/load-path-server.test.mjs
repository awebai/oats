// The load path against the shipped server and a scripted fake kernel (helpers/load-path-server.mjs):
// the roster never waits on souls, the held catalogs answer without a kernel run, identical
// inspections coalesce, an unchanged focus reprobe cancels and wipes nothing, the cadence is
// measured from completion and backs off while blurred, every answer carries observedAt and
// refreshing, and --max-age travels only when the kernel declares observe-max-age.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startLoadPathServer, FAKE_OBSERVED_AT } from './helpers/load-path-server.mjs';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const of = (calls, verb) => calls.filter(c => c.verb === verb);
const maxAge = call => { const i = call.argv.indexOf('--max-age'); return i < 0 ? null : call.argv[i + 1]; };
const soulSelector = agents => { const a = agents.find(x => x.name === 'release-manager'); return { soul: a.name, agentsRoot: a.agentsRoot }; };
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
// The bound is on the code path (no kernel process), not on scheduler noise: the best of three repeats.
async function fastest(request, times = 3) {
  let best = Infinity;
  for (let n = 0; n < times; n++) { const t = performance.now(); await request(); best = Math.min(best, performance.now() - t); }
  return best;
}

test('cold cycle, held catalogs, coalescing, focus no-op, cadence and blur back-off (kernel without observe-max-age)', async () => {
  // souls and capabilities are much slower than the roster reads, so "published before souls landed" holds even
  // when a loaded machine delays the liveness child that precedes publication.
  const s = await startLoadPathServer({ delays: { status: 300, 'workspace-status': 300, souls: 2500, capabilities: 2500, inspect: 200 } });
  try {
    const probe = await s.post('/api/cli/reprobe', {});
    assert.equal(probe.ok, true, JSON.stringify(probe));
    assert.equal(probe.features.includes('observe-max-age'), false);
    const observed = await s.until(async () => { const p = await s.panel(); return p.deployment?.status === 'observed' ? p : null; });
    const rosterAt = Date.now();
    assert.equal(observed.instances.length, 1); assert.match(observed.observedAt, ISO); assert.equal(typeof observed.refreshing, 'boolean');
    // The roster was published while souls was still running, and souls started with the roster reads.
    let calls = s.calls();
    assert.equal(of(calls, 'status').length, 1); assert.equal(of(calls, 'workspace-status').length, 1);
    const agentsWhilePending = await s.agents();
    assert.deepEqual([agentsWhilePending.agents.length, agentsWhilePending.refreshing, agentsWhilePending.observedAt], [0, true, null], 'the catalog is still coming');
    const agents = await s.until(async () => { const a = await s.agents(); return a.agents.length ? a : null; });
    calls = s.calls();
    const souls = of(calls, 'souls')[0], status = of(calls, 'status')[0];
    assert.ok(souls.start <= status.end, `souls started (${souls.start}) before status finished (${status.end}), not after`);
    assert.ok(souls.end > rosterAt, `the roster (${rosterAt}) was published before souls landed (${souls.end})`);
    assert.deepEqual([agents.agents.length, agents.refreshing], [9, false]); assert.match(agents.observedAt, ISO);
    // The capabilities table was read at admission, in parallel, before anyone asked for it.
    const capsRead = of(calls, 'capabilities');
    assert.equal(capsRead.length, 1); assert.ok(capsRead[0].start <= status.end, 'capabilities started with the roster reads');
    const caps = await s.until(async () => { const c = await s.post(`/api/workspace-sync${s.ws}`, { action: 'read' }); return c.status === 'ok' ? c : null; });
    assert.deepEqual([caps.capabilities.capabilities.length, caps.reason, caps.refreshing], [10, null, false]); assert.match(caps.observedAt, ISO);
    const took = await fastest(async () => { const again = await s.post(`/api/workspace-sync${s.ws}`, { action: 'read' }); assert.equal(again.status, 'ok'); });
    assert.ok(took < 50, `a held catalog answers in <50ms (${took.toFixed(1)}ms)`);
    assert.equal(of(s.calls(), 'capabilities').length, 1, 'repeat reads never re-run oats capabilities while the key is unchanged');
    const forced = await s.post(`/api/workspace-sync${s.ws}`, { action: 'read', refresh: true });
    assert.equal(forced.status, 'ok'); assert.equal(of(s.calls(), 'capabilities').length, 2, 'refresh:true is a live read');
    assert.equal(maxAge(of(s.calls(), 'capabilities')[1]), null, 'no --max-age without the feature');
    // Inspect: two concurrent identical requests → one kernel run; a repeat is served from the cache; refresh bypasses it.
    const selector = soulSelector(agents.agents);
    const [a, b] = await Promise.all([s.post(`/api/capabilities${s.ws}`, { action: 'inspect', selector }), s.post(`/api/capabilities${s.ws}`, { action: 'inspect', selector })]);
    assert.equal(a.subject.soul, 'release-manager'); assert.deepEqual(a.subject, b.subject);
    assert.match(a.observedAt, ISO); assert.equal(a.refreshing, false);
    assert.equal(of(s.calls(), 'inspect').length, 1, 'concurrent identical inspections coalesce');
    const hit = await fastest(async () => { const c = await s.post(`/api/capabilities${s.ws}`, { action: 'inspect', selector }); assert.equal(c.subject.soul, 'release-manager'); });
    assert.ok(hit < 50, `a repeat inspect is a cache hit (${hit.toFixed(1)}ms)`);
    assert.equal(of(s.calls(), 'inspect').length, 1);
    await s.post(`/api/capabilities${s.ws}`, { action: 'inspect', selector, refresh: true });
    assert.equal(of(s.calls(), 'inspect').length, 2, 'refresh:true bypasses the cache');
    const home = observed.instances[0].home;
    await Promise.all([s.post(`/api/capabilities${s.ws}`, { action: 'inspect', selector: { home } }), s.post(`/api/capabilities${s.ws}`, { action: 'inspect', selector: { home } })]);
    const homeReads = of(s.calls(), 'inspect').filter(x => x.argv.includes('--home'));
    assert.equal(homeReads.length, 1, 'selecting an instance runs inspect --home once, not twice');
    assert.equal(homeReads[0].argv[homeReads[0].argv.indexOf('--home') + 1], home);
    assert.equal(of(s.calls(), 'operation-run').length, 0);
    // Cadence: the second cycle starts a fixed interval AFTER the first completed, never back to back.
    const second = await s.until(() => { const st = of(s.calls(), 'status'); return st.length >= 2 ? st : null; }, { timeout: 12_000 });
    const firstCycleEnd = Math.max(of(s.calls(), 'status')[0].end, of(s.calls(), 'workspace-status')[0].end);
    assert.ok(second[1].start - firstCycleEnd >= 4800, `next cycle ${second[1].start - firstCycleEnd}ms after completion (≥ ~5s)`);
    assert.equal(of(s.calls(), 'souls').length, 1, 'an unchanged workspace never re-reads souls');
    assert.equal(of(s.calls(), 'capabilities').length, 2, 'nor capabilities');
    // Focus reprobe with an unchanged probe, while an observation is in flight: nothing is cancelled, nothing wiped.
    await s.until(async () => of(s.calls(), 'workspace-status').length >= 2 && !(await s.panel()).refreshing, { timeout: 8000 }); // the second cycle has fully completed
    s.reconfigure(cfg => { cfg.delays.status = 1500; cfg.delays['workspace-status'] = 1500; });
    const before = of(s.calls(), 'status').length;
    await s.post('/api/window-state', { focused: false });
    const back = await s.post('/api/window-state', { focused: true }); // focus return: one prompt cycle, now
    assert.deepEqual(back, { focused: true });
    await settle(250);
    assert.equal((await s.panel()).refreshing, true, 'an observation is in flight');
    const during = await s.post('/api/cli/reprobe', {});
    assert.equal(during.ok, true); assert.ok(during.probedAt > probe.probedAt, 'the probe ran and its diagnostics were refreshed');
    await s.until(() => of(s.calls(), 'status').length >= before + 1 && of(s.calls(), 'status').at(-1).end);
    await settle(200);
    const panel = await s.panel();
    assert.equal(panel.deployment.status, 'observed', 'the in-flight observation was published, not revoked');
    assert.equal(of(s.calls(), 'status').length, before + 1, 'exactly one status read for the prompt cycle: the reprobe did not cancel and restart it');
    assert.equal(of(s.calls(), 'souls').length, 1, 'the souls catalog was not wiped by an unchanged probe');
    assert.equal(of(s.calls(), 'capabilities').length, 2, 'nor the capabilities table');
    assert.equal((await s.agents()).agents.length, 9);
    // Blurred: the interval backs off to 30s, so no further cycle starts within the focused interval.
    const blurred = await s.post('/api/window-state', { focused: false });
    assert.deepEqual(blurred, { focused: false });
    const count = of(s.calls(), 'status').length;
    await settle(6500);
    assert.equal(of(s.calls(), 'status').length, count, 'no cycle within 6.5s while blurred (30s back-off)');
    for (const body of [{}, { focused: 'yes' }]) assert.equal((await s.post('/api/window-state', body)).code, 'E_BAD_ARGS');
  } finally { await s.stop(); }
});

test('a changed probe (version) still invalidates: pending reads are revoked and every catalog is re-read', async () => {
  const s = await startLoadPathServer({ delays: { status: 100, 'workspace-status': 100 } });
  try {
    await s.post('/api/cli/reprobe', {});
    await s.until(async () => (await s.panel()).deployment?.status === 'observed');
    await s.until(async () => (await s.agents()).agents.length === 9);
    assert.deepEqual([of(s.calls(), 'souls').length, of(s.calls(), 'capabilities').length], [1, 1]);
    s.reconfigure(cfg => { cfg.version.version = '0.29.3'; });
    const probe = await s.post('/api/cli/reprobe', {});
    assert.equal(probe.version, '0.29.3');
    await s.until(() => of(s.calls(), 'souls').length >= 2 && of(s.calls(), 'capabilities').length >= 2, { timeout: 8000 });
    await s.until(async () => (await s.agents()).agents.length === 9);
  } finally { await s.stop(); }
});

test('with observe-max-age declared: admission and refresh observe live (0), background cycles and cache misses reuse (60); observedAt is the kernel\'s', async () => {
  const s = await startLoadPathServer({ probe: v => ({ ...v, features: [...v.features, 'observe-max-age'] }), delays: { status: 100, 'workspace-status': 100 } });
  try {
    const probe = await s.post('/api/cli/reprobe', {});
    assert.ok(probe.features.includes('observe-max-age'));
    const panel = await s.until(async () => { const p = await s.panel(); return p.deployment?.status === 'observed' ? p : null; });
    const agents = await s.until(async () => { const a = await s.agents(); return a.agents.length ? a : null; });
    await s.until(() => of(s.calls(), 'capabilities').length >= 1);
    // Admission: every read of the first cycle is live.
    for (const verb of ['status', 'workspace-status', 'souls', 'capabilities']) assert.equal(maxAge(of(s.calls(), verb)[0]), '0', `${verb} at admission`);
    assert.equal(panel.observedAt, FAKE_OBSERVED_AT, '/api/panel carries the kernel\'s observation time');
    assert.equal(agents.observedAt, FAKE_OBSERVED_AT, '/api/agents too');
    const caps = await s.until(async () => { const c = await s.post(`/api/workspace-sync${s.ws}`, { action: 'read' }); return c.status === 'ok' ? c : null; });
    assert.equal(caps.observedAt, FAKE_OBSERVED_AT);
    // A user refresh is live; an inspect miss reuses; an inspect refresh is live.
    await s.post(`/api/workspace-sync${s.ws}`, { action: 'read', refresh: true });
    assert.equal(maxAge(of(s.calls(), 'capabilities').at(-1)), '0');
    const selector = soulSelector(agents.agents);
    const inspected = await s.post(`/api/capabilities${s.ws}`, { action: 'inspect', selector });
    assert.equal(maxAge(of(s.calls(), 'inspect').at(-1)), '60'); assert.equal(inspected.observedAt, FAKE_OBSERVED_AT);
    await s.post(`/api/capabilities${s.ws}`, { action: 'inspect', selector, refresh: true });
    assert.equal(maxAge(of(s.calls(), 'inspect').at(-1)), '0');
    // The next background cycle reuses.
    await s.until(() => of(s.calls(), 'status').length >= 2 && of(s.calls(), 'workspace-status').length >= 2, { timeout: 12_000 });
    assert.equal(maxAge(of(s.calls(), 'status')[1]), '60'); assert.equal(maxAge(of(s.calls(), 'workspace-status')[1]), '60');
    // A mutation's follow-up observes live.
    s.reconfigure(cfg => { cfg.delays.status = 0; });
    const statusCount = of(s.calls(), 'status').length;
    const started = await s.post(`/api/start/${panel.instances[0].instance}${s.ws}&home=${encodeURIComponent(panel.instances[0].home)}`, {});
    assert.ok(started, 'start answered');
    await s.until(() => of(s.calls(), 'status').length > statusCount, { timeout: 8000 });
    assert.equal(maxAge(of(s.calls(), 'status').at(-1)), '0', 'a mutation\'s follow-up observation is live');
  } finally { await s.stop(); }
});
