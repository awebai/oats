// Per-window request generations (#481, item 10): the suggestions and add generations, and the paths
// last offered, are keyed by the sending window. One window's call never supersedes another's; adds
// still run one at a time through the one transactional executor, so a second window's add queues.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGenerations, createPerformAdd, createSuggestionCalls, createAddExecutor, stageDirs, createOnboardExecutor } from '../workspace-registry.mjs';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise((r) => setImmediate(r));

test('suggestions: concurrent calls from two windows both answer; a newer call from the same window supersedes', async () => {
  const gates = [];
  const calls = createSuggestionCalls({ generations: createGenerations(),
    refresh: () => { const g = deferred(); gates.push(g); return g.promise; },
    list: () => [{ path: '/d/a' }, { path: '/d/b' }] });
  const one = calls.suggest('1'), two = calls.suggest('2'), oneAgain = calls.suggest('1');
  for (const g of gates) g.resolve();
  assert.deepEqual(await two, { stale: false, suggestions: [{ path: '/d/a' }, { path: '/d/b' }] });
  assert.deepEqual(await one, { stale: true, suggestions: [] }, 'superseded by its own window\'s newer call');
  assert.equal((await oneAgain).stale, false);
  assert.deepEqual([...calls.offered('1')], ['/d/a', '/d/b']);
  assert.deepEqual([...calls.offered('2')], ['/d/a', '/d/b']);
  assert.deepEqual([...calls.offered('3')], [], 'a window never offered anything has no provenance');
  calls.forget('1');
  assert.deepEqual([...calls.offered('1')], []);
});

test('suggestions: a superseded call does not overwrite its window\'s offered paths', async () => {
  const gates = []; let n = 0;
  const calls = createSuggestionCalls({ generations: createGenerations(),
    refresh: () => { const g = deferred(); gates.push(g); return g.promise; },
    list: () => [{ path: `/d/${++n}` }] });
  const older = calls.suggest('1'), newer = calls.suggest('1');
  gates[1].resolve(); await newer;
  gates[0].resolve(); await older;
  assert.deepEqual([...calls.offered('1')], ['/d/1'], 'only the current call records what it offered');
});

function performAdd({ execute }) {
  const seen = [];
  const run = createPerformAdd({ generations: createGenerations(),
    decide: (path, fromPicker, scope) => { seen.push(['decide', scope]); return { ok: true, action: 'replace-server', workspace: { id: path, path } }; },
    realpath: (p) => p, choices: (_dir, scope) => { seen.push(['choices', scope]); return { choices: [] }; }, offer: () => null,
    execute });
  return { run, seen };
}

test('add: two windows\' adds are each current; a newer add from the same window supersedes its own', async () => {
  const gate = deferred(), currents = [];
  const p = performAdd({ execute: async (ws, isCurrent) => { await gate.promise; currents.push([ws.id, isCurrent()]); return { ok: isCurrent() }; } });
  const a = p.run('/d/a', false, '1'), b = p.run('/d/b', false, '2'), c = p.run('/d/c', false, '1');
  gate.resolve(); await Promise.all([a, b, c]);
  assert.deepEqual(currents, [['/d/a', false], ['/d/b', true], ['/d/c', true]]);
  assert.deepEqual(p.seen, [['decide', '1'], ['decide', '2'], ['decide', '1']], 'the decision knows which window asked');
});

test('add: a second window\'s add queues behind the first through the one executor, and both commit', async () => {
  const replace = deferred(); let dirs = ['/d/a'];
  const log = [];
  const execute = createAddExecutor({
    getDirs: () => [...dirs], stage: (d, path) => stageDirs(d, path, (p) => ({ id: p, path: p })),
    commitDirs: (next) => { log.push(['commit', next]); dirs = next; }, commitRecent: () => {},
    replaceServer: async (next) => { log.push(['replace', next]); if (next.includes('/d/b') && !next.includes('/d/c')) await replace.promise; },
    refreshAdvertised: async () => true, probeVersion: async () => ({ ok: true }), isCompatible: () => true,
    advertises: async () => true, delay: async () => {}, attempts: 2,
  });
  const p = performAdd({ execute });
  const first = p.run('/d/b', false, '1'), second = p.run('/d/c', false, '2');
  await flush();
  assert.deepEqual(log, [['replace', ['/d/a', '/d/b']]], 'the second add waits: one replacement at a time');
  replace.resolve();
  assert.equal((await first).ok, true); assert.equal((await second).ok, true, 'queued, not superseded');
  assert.deepEqual(log.filter(([k]) => k === 'commit').map(([, d]) => d), [['/d/a', '/d/b'], ['/d/a', '/d/b', '/d/c']]);
});

test('onboarding registers its deployment through the add of the window that asked', async () => {
  const adds = [];
  const onboard = createOnboardExecutor({ validRef: () => true, take: () => '/d/new', offer: () => 'again', realpath: (p) => p,
    isDeployment: () => false, readCli: async () => ({}), run: async () => ({ ok: true, document: {} }), project: () => ({ ok: true }),
    add: async (dir, scope) => { adds.push([dir, scope]); return { ok: true }; } });
  assert.equal((await onboard('token', 'github.com/o/r', '7')).ok, true);
  assert.deepEqual(adds, [['/d/new', '7']]);
});
