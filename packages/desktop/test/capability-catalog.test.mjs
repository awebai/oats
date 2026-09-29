// The capability catalog (server/capability-catalog.mjs): the `oats
// capabilities` table held per deployment and keyed by workspace state, and
// the sync boundary answering reads from it. Fake invokes and a fake clock
// only; no CLI, timer wait or process is involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workspaceStatusData, capabilitiesData } from '../deployment-data.mjs';
import { createCapabilityCatalog, capabilityCatalogKey, CAPABILITY_CATALOG_RETRY_MS } from '../server/capability-catalog.mjs';
import { soulCatalogKey } from '../server/soul-catalog.mjs';
import { HELD_TTL_MS } from '../server/keyed-catalog.mjs';
import { createWorkspaceSyncBoundary, syncFailure } from '../server/workspace-sync.mjs';

const facts = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/desktop-facts/${name}.json`, import.meta.url), 'utf8'));
const f2 = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f2/${name}.json`, import.meta.url), 'utf8'));
const deployment = '/fixture/base/northwind-workspace';
const CLI = { ok: true, bin: '/fixture/bin/oats', version: '0.31.0', workspaceApi: 2, features: ['workspace-v2', 'packages-no-approval'] };
const WS = workspaceStatusData(facts('workspace-status'), deployment);
const CAPS = () => facts('capabilities');
const TABLE = capabilitiesData(CAPS());
const move = mutate => { const ws = structuredClone(WS); mutate(ws); return ws; };
const settle = () => new Promise(r => setImmediate(r));

function harness() {
  let clock = 1_700_000_000_000, next = () => ({ ok: true, document: CAPS() });
  const calls = [], gates = [];
  const catalog = createCapabilityCatalog({ now: () => clock, invoke: async (cli, request) => {
    calls.push(request);
    if (gates.length) await gates.shift();
    return next();
  } });
  return { catalog, calls, tick: ms => { clock += ms; }, now: () => clock, answer: fn => { next = fn; }, gate: promise => gates.push(promise) };
}

test('the key follows package identity, lock currency and the lock file; not names, warnings or clones', () => {
  const base = capabilityCatalogKey(CLI, WS);
  assert.ok(base.includes(JSON.stringify(soulCatalogKey(CLI, WS)).slice(1, -1)), 'the soul key (members, workspace commit, CLI) is part of it');
  const changed = [
    move(ws => { ws.packages[0].version = '0.4.1'; }), move(ws => { ws.packages[0].commit = 'f'.repeat(40); }),
    move(ws => { ws.packages[0].integrity = 'sha256-other'; }), move(ws => { ws.packages.pop(); }),
    move(ws => { ws.declaredPackages.push('nw.extra'); }), move(ws => { ws.unsynced = ['nw.tools']; }), move(ws => { ws.stale = ['oats.okf']; }),
    move(ws => { ws.lock.lockfileVersion = 4; }), move(ws => { delete ws.lock; }),
    move(ws => { ws.members[0].commit = 'e'.repeat(40); }), move(ws => { ws.workspace.commit = 'd'.repeat(40); }),
  ];
  for (const ws of changed) assert.notEqual(capabilityCatalogKey(CLI, ws), base);
  assert.notEqual(capabilityCatalogKey({ ...CLI, version: '0.31.1' }, WS), base);
  const same = [
    move(ws => { ws.members[0].name = 'renamed'; }), move(ws => { ws.warnings = [{ code: 'W', message: 'm' }]; }),
    move(ws => { ws.problems = [{ code: 'P', message: 'm' }]; }), move(ws => { ws.clones = []; }), move(ws => { ws.packages[0].latest = { version: '9', ref: 'v9' }; }),
    move(ws => { ws.packages[0].source = 'elsewhere'; }), move(ws => { ws.workspace.observedAt = '2030-01-01T00:00:00.000Z'; }),
  ];
  for (const ws of same) assert.equal(capabilityCatalogKey(CLI, ws), base);
  assert.equal(capabilityCatalogKey(CLI, null), capabilityCatalogKey(CLI, {}));
});

test('ensure() reads once per key; a repeat read() of an unchanged key answers without invoke and without waiting', async () => {
  const h = harness();
  for (let i = 0; i < 5; i++) h.catalog.ensure(deployment, CLI, WS);
  assert.equal(h.calls.length, 1); assert.equal(h.catalog.refreshing(deployment), true);
  assert.deepEqual(h.calls[0], { action: 'capabilities', context: deployment }, 'maxAge travels only when given');
  const first = await h.catalog.read(deployment, CLI, WS);
  assert.deepEqual(first.capabilities, TABLE); assert.equal(first.reason, null); assert.equal(first.refreshing, false);
  for (let i = 0; i < 50; i++) { h.catalog.ensure(deployment, CLI, structuredClone(WS)); h.tick(HELD_TTL_MS / 100); }
  assert.equal(h.calls.length, 1, 'polls never re-read an unchanged workspace inside HELD_TTL_MS');
  const started = process.hrtime.bigint();
  const again = await h.catalog.read(deployment, CLI, WS);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 50, 'a held table is immediate');
  assert.equal(h.calls.length, 1); assert.deepEqual(again.capabilities, TABLE);
  h.catalog.ensure(deployment, CLI, WS, { maxAge: 30 }); assert.equal(h.calls.length, 1);
});

test('a changed key re-reads and the new table replaces the old; a poll passes maxAge through', async () => {
  const h = harness(); await h.catalog.read(deployment, CLI, WS);
  const moved = move(ws => { ws.packages[0].version = '0.5.0'; });
  const doc = CAPS(); doc.result.capabilities = doc.result.capabilities.slice(0, 3); h.answer(() => ({ ok: true, document: doc }));
  const stale = await h.catalog.read(deployment, CLI, moved, { maxAge: 30 });
  assert.equal(stale.capabilities.capabilities.length, TABLE.capabilities.length, 'the held table answers while the re-read runs');
  assert.equal(stale.refreshing, true);
  assert.deepEqual(h.calls[1], { action: 'capabilities', context: deployment, maxAge: 30 });
  await settle();
  const fresh = await h.catalog.read(deployment, CLI, moved);
  assert.equal(fresh.capabilities.capabilities.length, 3); assert.equal(fresh.refreshing, false); assert.equal(h.calls.length, 2);
  assert.equal(fresh.key, capabilityCatalogKey(CLI, moved));
});

test('a failed re-read keeps the last good table with the reason next to it and retries only after the window', async () => {
  const h = harness(); const good = await h.catalog.read(deployment, CLI, WS);
  const moved = move(ws => { ws.unsynced = ['nw.tools']; });
  h.answer(() => ({ ok: false, reason: { code: 'E_WORKSPACE', message: 'members not ready' } }));
  h.catalog.ensure(deployment, CLI, moved); await settle();
  const failed = h.catalog.held(deployment);
  assert.deepEqual(failed.capabilities, good.capabilities); assert.equal(failed.observedAt, good.observedAt);
  assert.deepEqual(failed.reason, { code: 'E_WORKSPACE', message: 'members not ready', kernel: true });
  for (let i = 0; i < 10; i++) { h.catalog.ensure(deployment, CLI, moved); h.tick(CAPABILITY_CATALOG_RETRY_MS / 20); }
  assert.equal(h.calls.length, 2, 'no retry storm');
  // A held failure — table behind it or not — is not an answer for someone asking: the boundary shows it as a failure
  // and today's Retry is a plain read, so a request inside the window reads now and gets the recovered table on the first ask.
  const within = await h.catalog.read(deployment, CLI, moved);
  assert.equal(within.reason.code, 'E_WORKSPACE'); assert.equal(h.calls.length, 3, 'a request inside the window re-reads even with a table behind the failure');
  h.answer(() => ({ ok: true, document: CAPS() }));
  const retried = await h.catalog.read(deployment, CLI, moved);
  assert.deepEqual([retried.reason, retried.capabilities.capabilities.length, h.calls.length], [null, TABLE.capabilities.length, 4], 'Retry recovers on the first press');
  h.answer(() => ({ ok: false, reason: { code: 'E_WORKSPACE', message: 'members not ready' } }));
  h.tick(CAPABILITY_CATALOG_RETRY_MS); h.catalog.ensure(deployment, CLI, { ...moved, workspace: { key: 'k', commit: 'c3' } }); await settle();
  assert.equal(h.calls.length, 5); assert.equal(h.catalog.held(deployment).reason.code, 'E_WORKSPACE');
  for (let i = 0; i < 10; i++) { h.catalog.ensure(deployment, CLI, { ...moved, workspace: { key: 'k', commit: 'c3' } }); h.tick(CAPABILITY_CATALOG_RETRY_MS / 20); }
  assert.equal(h.calls.length, 5, 'background cycles are still throttled by the window');
});

test('a read whose key moves on while it flies answers for the key it asked and never crashes the boundary; the newer state keeps its own entry', async () => {
  // Cold: the user opens the Workspace tab while the admission read flies; a member commit moves, and the next
  // cycle binds the newer key before the request's read lands.
  const h = harness(), states = ['c1', 'c2', 'c3', 'c4'].map(commit => move(ws => { ws.workspace.commit = commit; }));
  const cold = h.catalog.read(deployment, CLI, states[0]);
  h.catalog.ensure(deployment, CLI, states[1]);
  assert.equal(h.calls.length, 2, 'the newer key has its own flight');
  const answered = await cold;
  assert.ok(answered, 'the request is answered, not null');
  assert.deepEqual([answered.key, answered.reason, answered.capabilities.capabilities.length], [capabilityCatalogKey(CLI, states[0]), null, TABLE.capabilities.length], "with the table ITS read produced");
  await settle();
  assert.equal(h.catalog.held(deployment).key, capabilityCatalogKey(CLI, states[1]), 'what is held is the newer state\'s entry');
  // Warm: a superseded live read that fails does not hand its failure to the newer state, and the request sees its own failure.
  h.answer(() => ({ ok: false, reason: { code: 'E_CLI_TIMEOUT', message: 'slow' } }));
  const late = h.catalog.read(deployment, CLI, states[2], { refresh: true });
  h.answer(() => ({ ok: true, document: CAPS() }));
  h.catalog.ensure(deployment, CLI, states[3]);
  assert.equal((await late).reason.code, 'E_CLI_TIMEOUT'); await settle();
  assert.deepEqual([h.catalog.held(deployment).key, h.catalog.held(deployment).reason], [capabilityCatalogKey(CLI, states[3]), null]);
  // Through the boundary: the cold race is a healthy 'ok' answer, never a 400.
  let observed = states[0];
  const b = boundary({ observed: () => observed });
  const request = b.request({ action: 'read' }, { workspace, cli: CLI });
  observed = states[1]; b.catalog.ensure(deployment, CLI, observed);
  const response = await request;
  assert.deepEqual([response.status, response.reason, response.capabilities], ['ok', null, TABLE]);
});

test('a first read that fails holds no table; local, protocol and thrown failures are flagged as not the kernel\'s', async () => {
  const h = harness(); h.answer(() => ({ ok: false, reason: { code: 'E_CLI_TIMEOUT', message: 'slow' } }));
  const timeout = await h.catalog.read(deployment, CLI, WS);
  assert.equal(timeout.capabilities, null); assert.equal(timeout.observedAt, null);
  assert.deepEqual(timeout.reason, { code: 'E_CLI_TIMEOUT', message: 'slow', kernel: false });
  // The retry window throttles background cycles only: someone asking while nothing is held reads now,
  // and gets the recovered table on the FIRST ask (today's Retry button is a plain read).
  h.catalog.ensure(deployment, CLI, WS); assert.equal(h.calls.length, 1, 'a cycle inside the window does not retry');
  assert.equal((await h.catalog.read(deployment, CLI, WS)).reason.code, 'E_CLI_TIMEOUT'); assert.equal(h.calls.length, 2, 'a request inside the window reads again');
  h.answer(() => ({ ok: true, document: CAPS() }));
  const recovered = await h.catalog.read(deployment, CLI, WS);
  assert.equal(recovered.reason, null); assert.equal(recovered.capabilities.capabilities.length, TABLE.capabilities.length); assert.equal(h.calls.length, 3);
  const h2 = harness(); h2.answer(() => ({ ok: false, reason: { code: 'E_CLI_TIMEOUT', message: 'slow' } })); await h2.catalog.read(deployment, CLI, WS);
  h2.tick(CAPABILITY_CATALOG_RETRY_MS + 1); h2.answer(() => ({ ok: true, document: CAPS() }));
  assert.equal((await h2.catalog.read(deployment, CLI, WS)).reason, null, 'after the window too, the first ask returns the table, not the stale failure');
  h.tick(CAPABILITY_CATALOG_RETRY_MS); h.answer(() => ({ ok: true, document: { ...CAPS(), result: { capabilitiesApi: 9 } } }));
  h.catalog.ensure(deployment, CLI, move(ws => { ws.stale = ['x']; })); await settle();
  assert.deepEqual(h.catalog.held(deployment).reason, { code: 'E_CLI_PROTOCOL', message: '', kernel: false });
  const thrown = createCapabilityCatalog({ invoke: async () => { throw new Error('spawn ENOENT'); } });
  assert.deepEqual((await thrown.read(deployment, CLI, WS)).reason, { code: 'E_CLI_FAILED', message: '', kernel: false });
  thrown.forget(deployment); assert.equal(thrown.held(deployment), null); assert.equal(thrown.refreshing(deployment), false);
});

test('refresh: true forces a live read (maxAge 0) and joins an in-flight one instead of starting a second', async () => {
  const h = harness(); await h.catalog.read(deployment, CLI, WS);
  let open; h.gate(new Promise(r => { open = r; }));
  const doc = CAPS(); doc.result.capabilities.pop(); h.answer(() => ({ ok: true, document: doc }));
  const forced = h.catalog.read(deployment, CLI, WS, { refresh: true });
  await settle();
  assert.equal(h.calls.length, 2); assert.deepEqual(h.calls[1], { action: 'capabilities', context: deployment, maxAge: 0 });
  assert.equal(h.catalog.refreshing(deployment), true);
  assert.equal(h.catalog.held(deployment).refreshing, true);
  const joined = h.catalog.read(deployment, CLI, WS, { refresh: true });
  const poll = await h.catalog.read(deployment, CLI, WS);
  assert.equal(poll.capabilities.capabilities.length, TABLE.capabilities.length, 'a poll during the refresh still answers from the held table');
  open(); const [a, b] = await Promise.all([forced, joined]);
  assert.equal(h.calls.length, 2, 'two refreshes share one live flight'); assert.deepEqual(a, b);
  assert.equal(a.capabilities.capabilities.length, TABLE.capabilities.length - 1); assert.equal(a.refreshing, false);
  // With observe-max-age declared, a BACKGROUND read in the air (maxAge 60: heads may be up to a minute old)
  // is not a live read: a refresh starts its own beside it.
  const REUSING = { ...CLI, features: [...CLI.features, 'observe-max-age'] };
  const moved = move(ws => { ws.stale = ['nw.tools']; });
  let release; h.gate(new Promise(r => { release = r; }));
  h.catalog.ensure(deployment, REUSING, moved, { maxAge: 60 }); await settle();
  assert.deepEqual(h.calls.at(-1), { action: 'capabilities', context: deployment, maxAge: 60 });
  const live = h.catalog.read(deployment, REUSING, moved, { refresh: true }); await settle();
  assert.deepEqual(h.calls.at(-1), { action: 'capabilities', context: deployment, maxAge: 0 }, 'refresh:true did not join the background flight');
  assert.equal(h.calls.length, 4);
  release(); assert.equal((await live).reason, null);
  // Without the feature every read is live already: a refresh joins the key-change re-read instead of running a twin.
  const plain = move(ws => { ws.stale = ['oats.okf'] ; });
  h.gate(new Promise(r => { release = r; }));
  h.catalog.ensure(deployment, CLI, plain, { maxAge: 60 }); await settle();
  const shared = h.catalog.read(deployment, CLI, plain, { refresh: true }); await settle();
  assert.equal(h.calls.length, 5, 'one kernel run: the refresh joined the flight of a kernel that cannot reuse anyway');
  release(); assert.equal((await shared).reason, null);
});

test('two concurrent read() on a cold deployment share one invoke; a second deployment is its own flight', async () => {
  const h = harness(); let open; h.gate(new Promise(r => { open = r; }));
  const pending = [h.catalog.read(deployment, CLI, WS), h.catalog.read(deployment, CLI, WS)];
  await settle(); assert.equal(h.calls.length, 1);
  open(); const [a, b] = await Promise.all(pending);
  assert.deepEqual(a, b); assert.equal(h.calls.length, 1);
  await h.catalog.read('/fixture/base/other', CLI, WS); assert.equal(h.calls.length, 2);
  h.catalog.forgetAll(); assert.equal(h.catalog.held(deployment), null); assert.equal(h.catalog.held('/fixture/base/other'), null);
});

test('observedAt is the kernel\'s observation stamp when present, else the completion time; clones are independent', async () => {
  const h = harness(); const plain = await h.catalog.read(deployment, CLI, WS);
  assert.equal(plain.observedAt, new Date(h.now()).toISOString()); assert.equal(plain.at, h.now());
  const stamped = CAPS(); stamped.result.observation = { observedAt: '2026-09-26T19:57:15.436Z', reused: true };
  h.answer(() => ({ ok: true, document: stamped }));
  const live = await h.catalog.read(deployment, CLI, WS, { refresh: true });
  assert.equal(live.observedAt, '2026-09-26T19:57:15.436Z');
  // A malformed stamp is no stamp: the table stands, stamped with the read's completion time (never a refusal).
  const bad = CAPS(); bad.result.observation = { observedAt: 12, reused: false }; h.answer(() => ({ ok: true, document: bad }));
  h.tick(5000); const unstamped = await h.catalog.read(deployment, CLI, WS, { refresh: true });
  assert.deepEqual([unstamped.reason, unstamped.observedAt, unstamped.capabilities.capabilities.length], [null, new Date(h.now()).toISOString(), TABLE.capabilities.length]);
  const copy = h.catalog.held(deployment); copy.capabilities.capabilities.pop(); copy.reason = { code: 'X' };
  assert.equal(h.catalog.held(deployment).capabilities.capabilities.length, TABLE.capabilities.length); assert.equal(h.catalog.held(deployment).reason, null);
});

/* ── through the sync boundary ───────────────────────────────────────── */
const workspace = { id: deployment, scope: deployment };
function boundary({ observed = () => WS, maxAge, answers = [] } = {}) {
  const calls = [];
  const invoke = async (_cli, options) => {
    calls.push(options);
    const step = answers.shift();
    if (step === undefined) return { ok: true, document: options.action === 'sync' ? f2('sync-current') : CAPS() };
    return typeof step === 'function' ? step(options) : step;
  };
  let clock = 1_700_000_000_000;
  const catalog = createCapabilityCatalog({ invoke, now: () => clock });
  return { catalog, calls, answers, now: ms => { clock = 1_700_000_000_000 + ms; }, request: createWorkspaceSyncBoundary({ invoke, catalog, observed, maxAge }) };
}

test('boundary: a read answers from the held table with observedAt and refreshing; the poll maxAge travels on a miss', async () => {
  const b = boundary({ maxAge: 30 });
  const cold = await b.request({ action: 'read' }, { workspace, cli: CLI });
  assert.deepEqual(b.calls, [{ action: 'capabilities', context: deployment, maxAge: 30 }]);
  assert.equal(cold.status, 'ok'); assert.deepEqual(cold.capabilities, TABLE); assert.equal(cold.reason, null);
  assert.equal(cold.observedAt, new Date(1_700_000_000_000).toISOString()); assert.equal(cold.refreshing, false);
  assert.deepEqual(Object.keys(cold), ['workspaceSyncApi', 'status', 'report', 'capabilities', 'reason', 'observedAt', 'refreshing']);
  const started = process.hrtime.bigint();
  const held = await b.request({ action: 'read' }, { workspace, cli: CLI });
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 50); assert.equal(b.calls.length, 1); assert.deepEqual(held, cold);
});

test('boundary: refresh: true forces a live read; a failed re-read is today\'s failure shape (never a healthy table) with lastGood beside it', async () => {
  const b = boundary();
  await b.request({ action: 'read' }, { workspace, cli: CLI });
  b.answers.push({ ok: false, reason: { code: 'E_WORKSPACE', message: 'members not ready' } });
  const forced = await b.request({ action: 'read', refresh: true }, { workspace, cli: CLI });
  assert.deepEqual(b.calls[1], { action: 'capabilities', context: deployment, maxAge: 0 });
  assert.equal(forced.status, 'refused', 'the renderer shows the error and Retry exactly as on main'); assert.equal(forced.capabilities, null);
  assert.deepEqual(forced.reason, { code: 'E_WORKSPACE', message: 'members not ready' }); assert.equal(forced.refreshing, false);
  assert.deepEqual(forced.lastGood, { capabilities: TABLE, observedAt: new Date(1_700_000_000_000).toISOString() }, 'additive: a renderer that can label a stale table finds it here');
  // The lock moved (a new key) and the kernel refuses the re-read: non-ok with the kernel's reason, lastGood holds the old table.
  const movedLock = move(ws => { ws.packages[0].integrity = 'sha256-other'; ws.stale = ['nw.tools']; });
  const c = boundary({ observed: () => movedLock, answers: [{ ok: true, document: CAPS() }, { ok: false, reason: { code: 'E_PACKAGE_INTEGRITY', message: 'nw.tools does not match the lock' } }] });
  c.catalog.ensure(deployment, CLI, WS); await settle(); // the table held before the lock moved
  const during = await c.request({ action: 'read' }, { workspace, cli: CLI });
  assert.deepEqual([during.status, during.reason, during.refreshing], ['ok', null, true], 'until the re-read lands, the held table is still the truth (and a re-read is announced)');
  await settle();
  c.answers.push({ ok: false, reason: { code: 'E_PACKAGE_INTEGRITY', message: 'nw.tools does not match the lock' } }); // the kernel still refuses
  const afterLock = await c.request({ action: 'read' }, { workspace, cli: CLI });
  assert.deepEqual([afterLock.status, afterLock.capabilities, afterLock.reason], ['refused', null, { code: 'E_PACKAGE_INTEGRITY', message: 'nw.tools does not match the lock' }]);
  assert.deepEqual(afterLock.lastGood.capabilities, TABLE); assert.equal(typeof afterLock.lastGood.observedAt, 'string');
  assert.equal(c.calls.length, 3, 'a held failure is re-read on the ask (today\'s Retry is a plain read): the retry window throttles cycles only');
  const recovered = await c.request({ action: 'read' }, { workspace, cli: CLI }); // the kernel recovers: Retry works on the first press
  assert.deepEqual([recovered.status, recovered.reason, recovered.lastGood, c.calls.length], ['ok', null, undefined, 4]);
  const localFailure = boundary({ answers: [{ ok: true, document: CAPS() }, { ok: false, reason: { code: 'E_CLI_TIMEOUT', message: 'x' } }] });
  await localFailure.request({ action: 'read' }, { workspace, cli: CLI });
  const timedOut = await localFailure.request({ action: 'read', refresh: true }, { workspace, cli: CLI });
  assert.deepEqual({ ...timedOut, lastGood: undefined }, { ...syncFailure('E_CLI_TIMEOUT'), observedAt: null, refreshing: false, lastGood: undefined });
  assert.deepEqual(timedOut.lastGood.capabilities, TABLE);
});

test('boundary: a held table is served inside HELD_TTL_MS and re-read past it — an out-of-band `oats teams`/`sync` is seen within 60 s with no file access; Refresh stays live', async () => {
  const b = boundary({ maxAge: 60 });
  const first = await b.request({ action: 'read' }, { workspace, cli: CLI });
  assert.deepEqual([first.status, b.calls.length], ['ok', 1]);
  b.now(HELD_TTL_MS - 1);
  const inside = await b.request({ action: 'read' }, { workspace, cli: CLI });
  assert.deepEqual([inside.status, inside.refreshing, b.calls.length], ['ok', false, 1], 'inside the TTL: the held table, no kernel run');
  const changed = CAPS(); changed.result.capabilities = changed.result.capabilities.slice(1); // the kernel now reports one capability fewer
  b.answers.push({ ok: true, document: changed });
  b.now(HELD_TTL_MS);
  const past = await b.request({ action: 'read' }, { workspace, cli: CLI });
  assert.deepEqual([past.status, past.capabilities.capabilities.length, b.calls.length], ['ok', TABLE.capabilities.length - 1, 2], 'past the TTL: the request awaited a re-read and sees the change');
  assert.deepEqual(b.calls[1], { action: 'capabilities', context: deployment, maxAge: 60 }, 'a TTL re-read is a background-grade read');
  assert.equal((await b.request({ action: 'read' }, { workspace, cli: CLI })).capabilities.capabilities.length, TABLE.capabilities.length - 1); assert.equal(b.calls.length, 2, 'held again');
  await b.request({ action: 'read', refresh: true }, { workspace, cli: CLI });
  assert.deepEqual(b.calls[2], { action: 'capabilities', context: deployment, maxAge: 0 }, 'Refresh is live whatever the age');
});

test('boundary: a first read that fails is a refusal or a failure, in today\'s shapes plus observedAt/refreshing', async () => {
  const refusedFirst = boundary({ answers: [{ ok: false, reason: { code: 'E_WORKSPACE', message: 'members not ready' } }] });
  const refused = await refusedFirst.request({ action: 'read' }, { workspace, cli: CLI });
  assert.deepEqual(refused, { workspaceSyncApi: 1, status: 'refused', report: null, capabilities: null, reason: { code: 'E_WORKSPACE', message: 'members not ready' }, observedAt: null, refreshing: false, lastGood: null });
  const failedFirst = boundary({ answers: [{ ok: false, reason: { code: 'E_CLI_TIMEOUT', message: 'x' } }] });
  const failed = await failedFirst.request({ action: 'read' }, { workspace, cli: CLI });
  assert.deepEqual(failed, { ...syncFailure('E_CLI_TIMEOUT'), observedAt: null, refreshing: false, lastGood: null });
});

test('boundary: refresh is a read-only boolean flag; a sync forgets the held table', async () => {
  const b = boundary();
  for (const bad of [{ action: 'sync', refresh: true }, { action: 'read', refresh: 'yes' }, { action: 'read', refresh: 1 }, { action: 'read', refresh: true, extra: 1 }])
    assert.equal((await b.request(bad, { workspace, cli: CLI })).reason.code, 'E_BAD_ARGS', JSON.stringify(bad));
  assert.equal(b.calls.length, 0);
  assert.equal((await b.request({ action: 'read', refresh: false }, { workspace, cli: CLI })).status, 'ok');
  assert.notEqual(b.catalog.held(deployment), null);
  b.answers.push({ ok: false, reason: { code: 'E_PACKAGE_INTEGRITY', message: 'moved' } });
  assert.equal((await b.request({ action: 'sync' }, { workspace, cli: CLI })).status, 'refused');
  assert.notEqual(b.catalog.held(deployment), null, 'a refused sync wrote nothing');
  assert.equal((await b.request({ action: 'sync' }, { workspace, cli: CLI })).status, 'ok');
  assert.equal(b.catalog.held(deployment), null, 'the lock moved: the held table is for the old state');
  await b.request({ action: 'read' }, { workspace, cli: CLI });
  assert.deepEqual(b.calls.map(c => c.action), ['capabilities', 'sync', 'sync', 'capabilities']);
});

test('boundary: without a catalog, or before the deployment is observed, the direct read still works and carries the stamps', async () => {
  const calls = [];
  const plain = createWorkspaceSyncBoundary({ invoke: async (_cli, options) => { calls.push(options); return { ok: true, document: CAPS() }; }, now: () => 1_700_000_000_000 });
  const direct = await plain({ action: 'read' }, { workspace, cli: CLI });
  assert.equal(direct.status, 'ok'); assert.deepEqual(direct.capabilities, TABLE);
  assert.equal(direct.observedAt, new Date(1_700_000_000_000).toISOString()); assert.equal(direct.refreshing, false);
  assert.deepEqual(calls, [{ action: 'capabilities', context: deployment }]);
  const stamped = CAPS(); stamped.result.observation = { observedAt: '2026-09-26T19:57:15.436Z', reused: false };
  const unobserved = boundary({ observed: () => null, answers: [{ ok: true, document: stamped }] });
  const first = await unobserved.request({ action: 'read', refresh: true }, { workspace, cli: CLI });
  assert.equal(first.observedAt, '2026-09-26T19:57:15.436Z'); assert.equal(first.refreshing, false);
  assert.deepEqual(unobserved.calls, [{ action: 'capabilities', context: deployment, maxAge: 0 }]);
  assert.equal(unobserved.catalog.held(deployment), null, 'the direct read does not populate the catalog');
});
