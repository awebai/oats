// #1246 D2: the read of one deployment a created spawn starts at once (oats-web.mjs, the OATSWEB_SPAWNREAD block),
// over a fake per-deployment read whose landings the test settles one by one, and fake timers: nothing is timed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANSWER_WITHIN_MS } from '../../client/spawn-apply.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
const observed = (name) => ({ deployment: { status: 'observed' }, instances: [{ instance: name }] });
const unavailable = () => ({ deployment: { status: 'unavailable' }, instances: [] });

/** The block, evaluated over `snapshot`, a fake `observeDeployment` (each read held in `reads` until the test
 * lands it) and fake timers (`timers` holds each armed one). */
function spawnRead({ now = () => 0 } = {}) {
  const src = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const block = src.match(/\/\* OATSWEB_SPAWNREAD_BEGIN[^*]*\*\/([\s\S]*?)\/\* OATSWEB_SPAWNREAD_END \*\//)[1];
  const snapshot = { byWs: new Map() }, reads = [], timers = [];
  const spawnObserver = { name: 'spawn' };
  const deps = {
    snapshot, spawnObserver, ANSWER_WITHIN_MS, performance: { now },
    observeDeployment: (id, options) => new Promise((resolve, reject) => reads.push({ id, ...options, land: resolve, fail: reject })),
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { timer.cleared = true; },
  };
  const api = new Function(...Object.keys(deps), `${block}\nreturn { observeStamped, publishSpawned, cycleEntries, observeSpawned, awaitSpawned, CREATED_OBSERVE_WITHIN_MS, CREATED_STATUSES };`)(...Object.values(deps));
  return { ...api, snapshot, reads, timers, spawnObserver };
}

test('the post-spawn read is live, through its own observer, and publishes as soon as it lands', async () => {
  const s = spawnRead();
  const done = s.observeSpawned('northwind');
  assert.equal(s.reads.length, 1);
  assert.equal(s.reads[0].observer, s.spawnObserver, 'never the cycle observer: it never joins a read that started earlier');
  assert.equal(s.reads[0].live, true);
  const entry = observed('dev-1'); s.reads[0].land(entry); await done;
  assert.equal(s.snapshot.byWs.get('northwind'), entry);
});

test('the later start wins per deployment: a cycle that started before the post-spawn read never overwrites it, a later one does', async () => {
  const s = spawnRead();
  s.snapshot.byWs.set('northwind', observed('before'));
  const cycle = s.observeStamped('northwind', {}).entry;                // the cycle in flight when the apply answered
  const targeted = s.observeSpawned('northwind');
  assert.equal(s.reads[0].observer, undefined, 'the cycle reads through its own observer (the default)');
  const fresh = observed('dev-1'); s.reads[1].land(fresh); await targeted;
  assert.equal(s.snapshot.byWs.get('northwind'), fresh, 'published before the cycle ends');
  s.reads[0].land(observed('stale')); const entries = [['northwind', await cycle]];
  assert.equal(s.cycleEntries(entries).get('northwind'), fresh, 'the older cycle keeps the newer read');
  const next = s.observeStamped('northwind', {}).entry;                 // the next cycle starts after it
  const newer = observed('newer'); s.reads[2].land(newer);
  assert.equal(s.cycleEntries([['northwind', await next]]).get('northwind'), newer);
  // A post-spawn read that started before the published entry's read never replaces it.
  const late = s.observeSpawned('northwind'), cycleAfter = s.observeStamped('northwind', {}).entry;
  const latest = observed('latest'); s.reads[4].land(latest); s.snapshot.byWs = s.cycleEntries([['northwind', await cycleAfter]]);
  s.reads[3].land(observed('older')); await late;
  assert.equal(s.snapshot.byWs.get('northwind'), latest);
});

test('a failed, unavailable, busy or kept post-spawn read publishes nothing, and never outranks an earlier-started cycle', async () => {
  const s = spawnRead();
  const first = s.observeStamped('northwind', {}).entry, held = observed('held'); s.reads[0].land(held);
  s.snapshot.byWs = s.cycleEntries([['northwind', await first]]);
  const failing = s.observeSpawned('northwind'); s.reads[1].fail(new Error('boom')); await failing;
  const empty = s.observeSpawned('northwind'); s.reads[2].land(unavailable()); await empty;
  assert.equal(s.snapshot.byWs.get('northwind'), held);
  // A busy or stale read answers the held entry itself (deployment-panel.mjs `failedEntry`): it keeps the stamp of the
  // read that made it, so a cycle that started before this read, and read afresh, still publishes.
  const cycle = s.observeStamped('northwind', {}).entry, busy = s.observeSpawned('northwind');
  s.reads[4].land(held); await busy;
  assert.equal(s.snapshot.byWs.get('northwind'), held);
  const fresh = observed('dev-1'); s.reads[3].land(fresh);
  assert.equal(s.cycleEntries([['northwind', await cycle]]).get('northwind'), fresh, 'the earlier-started cycle still publishes its fresh read');
  // A remote the kernel could not read keeps the last observation marked with the failure: not a post-spawn answer.
  const unreadable = s.observeSpawned('northwind'); s.reads[5].land({ ...observed('dev-1'), error: 'the cache is locked' }); await unreadable;
  assert.equal(s.snapshot.byWs.get('northwind'), held);
});

test('per deployment one read runs and one waits: a further request rides the waiting one, which starts after the running one', async () => {
  const s = spawnRead();
  const first = s.observeSpawned('northwind');
  const second = s.observeSpawned('northwind'), third = s.observeSpawned('northwind');
  assert.equal(second, third, 'the third request rides on the queued read');
  void s.observeSpawned('acme');
  assert.deepEqual(s.reads.map(r => r.id), ['northwind', 'acme'], 'one at a time per deployment; another deployment is its own');
  s.reads[0].land(observed('first')); await first; await settle();
  assert.equal(s.reads.length, 3, 'the queued read starts once the running one has landed');
  assert.equal(s.reads[2].id, 'northwind');
  assert.equal(s.observeSpawned('northwind'), s.observeSpawned('northwind'), 'a request meanwhile queues one more, after it');
  const queuedEntry = observed('queued'); s.reads[2].land(queuedEntry); await second;
  assert.equal(s.snapshot.byWs.get('northwind'), queuedEntry);
  await settle(); assert.equal(s.reads.length, 4);
  s.reads[3].land(observed('last')); await settle(); await settle();
  void s.observeSpawned('northwind'); assert.equal(s.reads.length, 5, 'idle again: the next request starts its own read at once');
});

test('the created answer waits for the read, at most CREATED_OBSERVE_WITHIN_MS (5 s) when the read hangs', async () => {
  const s = spawnRead();
  assert.equal(s.CREATED_OBSERVE_WITHIN_MS, 5000);
  assert.deepEqual(s.CREATED_STATUSES, ['complete', 'partial', 'incomplete']);
  let answered = false;
  const wait = s.awaitSpawned('northwind', 0).then(() => { answered = true; });
  assert.equal(s.reads.length, 1, 'the read starts at once');
  assert.deepEqual(s.timers.map(t => t.ms), [5000]);
  await settle(); assert.equal(answered, false);
  s.timers[0].fn(); await wait;
  assert.equal(answered, true, 'answered at 5 s with the read still out');
  // A read that lands first answers at once and clears the bound.
  const quick = spawnRead(), fast = quick.awaitSpawned('northwind', 0);
  quick.reads[0].land(observed('dev-1')); await fast;
  assert.equal(quick.timers[0].cleared, true);
  assert.equal(quick.snapshot.byWs.get('northwind').instances[0].instance, 'dev-1', 'published before the answer');
});

test('never past ANSWER_WITHIN_MS from the request: an apply that answers at about 49 s waits at most 1 s, one at 50 s not at all', async () => {
  let clock = 0;
  const s = spawnRead({ now: () => clock });
  clock = 49000; const wait = s.awaitSpawned('northwind', 0);
  assert.deepEqual(s.timers.map(t => t.ms), [ANSWER_WITHIN_MS - 49000]);
  s.timers[0].fn(); await wait;
  clock = 50500; await s.awaitSpawned('acme', 0);
  assert.equal(s.timers.length, 1, 'no wait left: answered at once');
  assert.deepEqual(s.reads.map(r => r.id), ['northwind', 'acme'], 'the read still starts, and publishes when it lands');
  s.reads[1].land(observed('dev-1')); await settle(); await settle();
  assert.equal(s.snapshot.byWs.get('acme').instances[0].instance, 'dev-1');
});

test('a read that lands without publishing ends no wait: failed, unavailable or busy, the answer goes at the bound', async () => {
  for (const [why, land] of [
    ['failed', r => r.fail(new Error('boom'))],
    ['unavailable', r => r.land(unavailable())],
    ['busy (the held entry itself)', (r, held) => r.land(held)],
    ['a kept failure', r => r.land({ ...observed('dev-1'), error: 'the cache is locked' })],
  ]) {
    const s = spawnRead();
    const first = s.observeStamped('northwind', {}).entry, held = observed('held'); s.reads[0].land(held);
    s.snapshot.byWs = s.cycleEntries([['northwind', await first]]);
    let answered = false;
    const wait = s.awaitSpawned('northwind', 0).then(() => { answered = true; });
    land(s.reads[1], held); await settle(); await settle();
    assert.equal(answered, false, `${why}: still waiting`);
    assert.deepEqual(s.timers.map(t => [t.ms, t.cleared]), [[5000, false]], `${why}: the bound stands`);
    s.timers[0].fn(); await wait;
    assert.equal(s.snapshot.byWs.get('northwind'), held, `${why}: nothing published`);
  }
});

test('a failed read at about 49 s waits for what is left of ANSWER_WITHIN_MS, never past it', async () => {
  let clock = 49000;
  const s = spawnRead({ now: () => clock });
  let answered = false;
  const wait = s.awaitSpawned('northwind', 0).then(() => { answered = true; });
  s.reads[0].fail(new Error('boom')); await settle(); await settle();
  assert.equal(answered, false);
  assert.deepEqual(s.timers.map(t => t.ms), [ANSWER_WITHIN_MS - 49000]);
  s.timers[0].fn(); await wait;
});

test('a fresh read that finds a newer observation already published releases the answer: the roster is newer still', async () => {
  const s = spawnRead();
  let answered = false;
  const wait = s.awaitSpawned('northwind', 0).then(() => { answered = true; });
  const cycle = s.observeStamped('northwind', {}).entry;                   // started after the targeted read
  const newer = observed('newer'); s.reads[1].land(newer);
  s.snapshot.byWs = s.cycleEntries([['northwind', await cycle]]);
  s.reads[0].land(observed('dev-1')); await wait;
  assert.equal(answered, true);
  assert.equal(s.timers[0].cleared, true);
  assert.equal(s.snapshot.byWs.get('northwind'), newer, 'the newer one stays');
});

test('a busy read answering the held entry is never its own observation, stamped or not', async () => {
  const s = spawnRead();
  const held = observed('held'); s.snapshot.byWs.set('northwind', held); // never stamped by a read here
  let answered = false;
  const wait = s.awaitSpawned('northwind', 0).then(() => { answered = true; });
  s.reads[0].land(held); await settle(); await settle();
  assert.equal(answered, false); assert.equal(s.timers[0].cleared, false);
  const cycle = s.observeStamped('northwind', {}).entry, fresh = observed('dev-1'); s.reads[1].land(fresh);
  assert.equal(s.cycleEntries([['northwind', await cycle]]).get('northwind'), fresh, 'a later cycle still publishes');
  s.timers[0].fn(); await wait;
});

test('a newer failure already published is not an observation: the answer goes at the bound', async () => {
  for (const [why, failure] of [['unavailable', unavailable()], ['a kept failure', { ...observed('kept'), error: 'the cache is locked' }]]) {
    const s = spawnRead();
    let answered = false;
    const wait = s.awaitSpawned('northwind', 0).then(() => { answered = true; });
    const cycle = s.observeStamped('northwind', {}).entry;           // started after the targeted read, and fails
    s.reads[1].land(failure); s.snapshot.byWs = s.cycleEntries([['northwind', await cycle]]);
    s.reads[0].land(observed('dev-1')); await settle(); await settle();
    assert.equal(answered, false, why); assert.equal(s.timers[0].cleared, false, why);
    assert.equal(s.snapshot.byWs.get('northwind'), failure, `${why}: the later start still wins`);
    s.timers[0].fn(); await wait;
  }
});
