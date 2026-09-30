// The gate-relevant probe signature: a window-focus reprobe that finds the
// same CLI must compare EQUAL to the previous payload although /api/cli mints
// a fresh probedAt and re-describes the locator's path every time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROBE_DIAGNOSTIC_FIELDS, probeChanged, probeSignature } from '../renderer/cli-probe-contract.mjs';

const payload = (extra = {}) => ({
  ok: true, bin: '/current/oats', version: '0.22.19', source: 'path',
  required: { desktopApi: 7, range: '>=0.22.0 <0.23.0' }, install: 'npm install -g @awebai/oats@0.22.19',
  harnesses: ['pi', 'claude'], harnessesSource: 'reported', sessionBackends: ['tmux'], launchOptions: ['--dir'],
  features: ['observe-max-age', 'spawn-relations'], scheduleApi: 2, scheduleHistoryApi: 3, lifecycleApi: 1,
  readinessApi: 2, automationsApi: 1, operationsApi: 2, spawnPreviewApi: 2, spawnApplyApi: 1, eventsApi: 2, workspaceApi: 2,
  remote: [{ id: 'lab', host: 'lab.local' }], relations: true, relationsMin: '0.18.6',
  probedAt: 1700000000000, tried: [],
  ...extra,
});

test('diagnostics that differ between identical probes never change the signature', () => {
  const before = payload();
  const same = [
    payload({ probedAt: 1700000009999 }),
    payload({ probedAt: null }),
    payload({ tried: [{ path: '/old/oats', source: 'npm', reason: 'probe failed: spawn ETIMEDOUT' }] }),
    payload({ tried: undefined }),
    payload({ source: 'login-shell' }),
    payload({ source: null }),
  ];
  assert.deepEqual(PROBE_DIAGNOSTIC_FIELDS, ['probedAt', 'tried', 'source']);
  for (const after of same) {
    assert.equal(probeSignature(after), probeSignature(before));
    assert.equal(probeChanged(before, after), false);
  }
  assert.equal(probeSignature(payload({ probedAt: undefined, tried: undefined, source: undefined })), probeSignature(before));
});

test('the signature is a JSON string that excludes the diagnostics and keeps the rest', () => {
  const sig = probeSignature(payload());
  const parsed = JSON.parse(sig);
  for (const field of PROBE_DIAGNOSTIC_FIELDS) assert.equal(field in parsed, false, field);
  assert.equal(parsed.bin, '/current/oats');
  assert.deepEqual(parsed.features, ['observe-max-age', 'spawn-relations']);
  assert.deepEqual(parsed.remote, [{ host: 'lab.local', id: 'lab' }]);
});

test('every gate-relevant field participates', () => {
  const before = payload();
  const changes = {
    ok: { ok: false }, bin: { bin: '/other/oats' }, version: { version: '0.22.20' },
    'features added': { features: ['observe-max-age', 'spawn-relations', 'x'] },
    'features removed': { features: ['spawn-relations'] },
    'features reordered': { features: ['spawn-relations', 'observe-max-age'] },
    remote: { remote: [] }, 'remote entry': { remote: [{ id: 'lab', host: 'lab2.local' }] },
    harnesses: { harnesses: ['pi'] }, harnessesSource: { harnessesSource: 'assumed' },
    sessionBackends: { sessionBackends: ['tmux', 'zellij'] }, launchOptions: { launchOptions: [] },
    scheduleApi: { scheduleApi: 1 }, scheduleHistoryApi: { scheduleHistoryApi: null }, lifecycleApi: { lifecycleApi: null },
    readinessApi: { readinessApi: null }, automationsApi: { automationsApi: null }, operationsApi: { operationsApi: null },
    spawnPreviewApi: { spawnPreviewApi: null }, spawnApplyApi: { spawnApplyApi: null }, eventsApi: { eventsApi: null },
    workspaceApi: { workspaceApi: null }, relations: { relations: false }, relationsMin: { relationsMin: '0.19.0' },
    install: { install: 'npm install -g @awebai/oats@0.22.20' },
    'required range': { required: { desktopApi: 7, range: '>=0.23.0 <0.24.0' } },
    'required api': { required: { desktopApi: 8, range: '>=0.22.0 <0.23.0' } },
    'new unknown field': { observeApi: 1 },
  };
  for (const [name, change] of Object.entries(changes)) {
    const after = payload(change);
    assert.equal(probeChanged(before, after), true, name);
    assert.equal(probeChanged(after, before), true, name);
  }
  // integer vs string vs null must all differ: "2" is not API 2
  assert.equal(probeChanged(payload({ scheduleApi: 2 }), payload({ scheduleApi: '2' })), true);
  assert.equal(probeChanged(payload({ scheduleApi: null }), payload({ scheduleApi: 0 })), true);
});

test('key order never changes the signature, at any depth', () => {
  const a = { ok: true, bin: '/x', required: { range: 'r', desktopApi: 7 }, remote: [{ id: 'a', host: 'h' }], features: ['f'] };
  const b = { features: ['f'], remote: [{ host: 'h', id: 'a' }], required: { desktopApi: 7, range: 'r' }, bin: '/x', ok: true };
  assert.equal(probeSignature(a), probeSignature(b));
  assert.equal(probeChanged(a, b), false);
  assert.equal(probeSignature(a), probeSignature(JSON.parse(JSON.stringify(b))));
});

test('nested diagnostics-named keys are only excluded at the top level', () => {
  // `source` inside a remote entry is data about that remote, not the locator.
  assert.equal(probeChanged(payload({ remote: [{ id: 'lab', source: 'a' }] }), payload({ remote: [{ id: 'lab', source: 'b' }] })), true);
});

test('unsettled and empty states are distinct from any payload and from each other', () => {
  assert.equal(probeSignature(null), 'null');
  assert.equal(probeSignature(undefined), 'null');
  assert.equal(probeSignature({}), '{}');
  assert.equal(probeChanged(null, undefined), false);
  assert.equal(probeChanged(null, {}), true);
  assert.equal(probeChanged({}, payload()), true);
  assert.equal(probeChanged(null, payload()), true);
  assert.equal(probeChanged(payload(), null), true);
  // a payload made ONLY of diagnostics is indistinguishable from empty — by design
  assert.equal(probeSignature({ probedAt: 1, tried: [], source: 'path' }), '{}');
});

test('the signature is a pure function of its input and never mutates it', () => {
  const p = payload({ features: ['b', 'a'] });
  const frozen = JSON.stringify(p);
  probeSignature(p); probeChanged(p, payload());
  assert.equal(JSON.stringify(p), frozen);
  assert.equal(probeSignature(p), probeSignature(p));
});
