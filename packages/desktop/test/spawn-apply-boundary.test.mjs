import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpawnApplyBoundary } from '../server/spawn-apply.mjs';
import { spawnCreationReceipt, spawnWakeOutcome, WAKE_OUTCOME_UNKNOWN } from '../renderer/spawn-apply-contract.mjs';
import { selector, target, anchor, deferred, tick, DEPLOYMENT } from './helpers/spawn-preview-fixture.mjs';
import { applyContext, applyPreview, creation, envelope } from './helpers/spawn-apply-fixture.mjs';
const wake = { cron: '0 * * * *', tz: 'UTC', message: 'PRIVATE wake' };
const prepare = changes => ({ action: 'prepare', selector, choices: {}, task: 'PRIVATE task', ...changes });
function fixture({ read, invoke, mint } = {}) {
  const c = applyContext(), calls = [], reads = [];
  let time = 0, ids = 0;
  const broker = createSpawnApplyBoundary({ now: () => time, mint: mint ?? (() => (++ids).toString(16).padStart(64, '0')),
    read: async (request, context) => { reads.push(structuredClone(request)); return read ? read(request, context) : { status: 'available', data: applyPreview(target) }; },
    invoke: async (cli, args) => { calls.push(structuredClone({ cli, args })); return invoke ? invoke(cli, args) : { started: true, envelope: envelope(creation(applyPreview(args.target), {
      wake: args.wake ? { requested: true, saved: true, error: null } : { requested: false, saved: null, error: null } })) }; } });
  return { c, calls, reads, broker, send: request => broker(request, () => c), advance: ms => { time += ms; }, ids: () => ids };
}
test('prepare is task-free READ; immutable ref consumes one key only at first confirmation', async () => {
  const f = fixture(), draft = prepare({ choices: { purpose: 'review' }, wake });
  const p = await f.send(draft); assert.equal(p.status, 'prepared'); assert.equal(f.ids(), 1); assert.equal(f.calls.length, 0);
  assert.equal(f.reads.length, 1); assert.deepEqual(Object.keys(f.reads[0]).sort(), ['action', 'choices', 'selector']); assert.doesNotMatch(JSON.stringify(p), /PRIVATE/);
  draft.task = 'changed'; draft.wake = { ...wake, message: 'changed' }; draft.choices.purpose = 'changed'; p.preview.decision.home = '/caller';
  const complete = await f.send({ action: 'apply', spawnRef: p.spawnRef });
  assert.equal(complete.status, 'complete'); assert.equal(f.ids(), 2); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].args.task, 'PRIVATE task'); assert.equal(f.calls[0].args.wake.message, 'PRIVATE wake'); assert.equal(f.calls[0].args.choices.purpose, 'review');
  assert.notEqual(f.calls[0].args.key, p.spawnRef); assert.equal(f.calls[0].args.decision.home, applyPreview(target).decision.home);
  complete.receipt.home = '/caller';
  const result = await f.send({ action: 'result', spawnRef: p.spawnRef }); assert.equal(result.receipt.home, applyPreview(target).decision.home);
  assert.equal((await f.send({ action: 'apply', spawnRef: p.spawnRef })).repeated, true); assert.equal(f.calls.length, 1); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
test('duplicate pending requests do not invoke; one slot covers distinct prepared intents', async () => {
  const gate = deferred(), f = fixture({ invoke: () => gate.promise });
  const a = await f.send(prepare()), b = await f.send(prepare({ choices: { purpose: 'other' } }));
  assert.notEqual(a.spawnRef, b.spawnRef);
  const pending = f.send({ action: 'apply', spawnRef: a.spawnRef }); await tick();
  assert.equal((await f.send({ action: 'apply', spawnRef: a.spawnRef })).status, 'pending');
  assert.equal((await f.send({ action: 'result', spawnRef: a.spawnRef })).status, 'pending');
  const second = f.send({ action: 'apply', spawnRef: b.spawnRef }); await tick();
  assert.equal(f.calls.length, 1, 'reserve the mutation slot before a competing confirmation');
  assert.equal((await second).reason.code, 'E_BUSY');
  f.advance(2 * 3600000); assert.equal((await f.send({ action: 'result', spawnRef: a.spawnRef })).status, 'pending');
  gate.resolve({ started: true, envelope: envelope(creation(applyPreview(target))) }); assert.equal((await pending).status, 'complete');
});
test('one broker serializes mutation across admitted workspaces', async () => {
  const gate = deferred(), f = fixture({ invoke: () => gate.promise });
  const a = await f.send(prepare()); f.c.workspace.id = 'other';
  const b = await f.send(prepare()); assert.equal(b.target.workspace, 'other');
  f.c.workspace.id = 'northwind'; const first = f.send({ action: 'apply', spawnRef: a.spawnRef }); await tick();
  f.c.workspace.id = 'other'; assert.equal((await f.send({ action: 'apply', spawnRef: b.spawnRef })).reason.code, 'E_BUSY');
  assert.equal(f.calls.length, 1); f.c.workspace.id = 'northwind'; gate.resolve({ started: true, envelope: envelope(creation(applyPreview(target))) }); await first;
});
test('unknown can explicitly retry identical intent/key; result never invokes or mints', async () => {
  let attempts = 0;
  const f = fixture({ invoke: (_c, args) => ++attempts === 1 ? { started: true, envelope: { schemaVersion: 1, ok: false, error: { code: 'E_CLI_TIMEOUT' } } }
    : { started: true, envelope: envelope(creation(applyPreview(args.target), { replayed: true })) } });
  const p = await f.send(prepare()); assert.equal((await f.send({ action: 'apply', spawnRef: p.spawnRef })).status, 'unknown');
  for (let i = 0; i < 3; i++) assert.equal((await f.send({ action: 'result', spawnRef: p.spawnRef })).status, 'unknown');
  assert.equal(f.calls.length, 1); assert.equal(f.ids(), 2);
  const replay = await f.send({ action: 'apply', spawnRef: p.spawnRef }); assert.equal(replay.status, 'complete'); assert.equal(replay.receipt.replayed, true);
  assert.equal(f.ids(), 2); assert.deepEqual(f.calls[0].args, f.calls[1].args);
});
for (const code of ['E_DECISION_STALE', 'E_IDEMPOTENCY_CONFLICT', 'E_PLACEMENT_TAKEN']) test(`${code} consumes intent, no replacement ref/key/apply from advisory`, async () => {
  const f = fixture({ invoke: () => ({ started: true, envelope: { schemaVersion: 1, ok: false, error: { code, details: { decision: applyPreview(target).decision, home: '/advisory' } } } }) });
  const p = await f.send(prepare()), r = await f.send({ action: 'apply', spawnRef: p.spawnRef });
  assert.equal(r.status, 'stale'); assert.equal(r.reason.code, code); assert.equal(r.receipt, null); assert.equal(r.spawnRef, p.spawnRef); assert.equal(f.ids(), 2);
  await f.send({ action: 'apply', spawnRef: p.spawnRef }); assert.equal(f.calls.length, 1);
  const next = await f.send(prepare()); assert.notEqual(next.spawnRef, p.spawnRef); assert.equal(f.calls.length, 1);
  await f.send({ action: 'apply', spawnRef: next.spawnRef }); assert.notEqual(f.calls[0].args.key, f.calls[1].args.key);
});
test('incomplete is diagnostic only, never completed receipt or another spawn', async () => {
  const v = applyPreview(target);
  const f = fixture({ invoke: () => ({ started: true, envelope: { schemaVersion: 1, ok: false, error: { code: 'E_SPAWN_INCOMPLETE', details: { instance: v.instance, home: v.home, launched: 'unknown' } } } }) });
  const p = await f.send(prepare()), r = await f.send({ action: 'apply', spawnRef: p.spawnRef });
  assert.equal(r.status, 'incomplete'); assert.equal(r.receipt, null); assert.equal(r.incomplete.launched, 'unknown');
  await f.send({ action: 'apply', spawnRef: p.spawnRef }); assert.equal(f.calls.length, 1);
});
test('arbitrary post-dispatch errors are not proof of no effects; local pre-dispatch errors are definite', async () => {
  for (const started of [true, false]) {
    const f = fixture({ invoke: () => ({ started, envelope: { schemaVersion: 1, ok: false, error: { code: 'E_BAD_ARGS' } } }) });
    const p = await f.send(prepare()), r = await f.send({ action: 'apply', spawnRef: p.spawnRef });
    assert.equal(r.status, started ? 'unknown' : 'refused');
  }
});
for (const saved of [true, false, null]) test(`qualified creation keeps honest wake state (${saved})`, async () => {
  const rawWake = { requested: saved === null ? null : true, saved, error: saved === false ? { code: 'PRIVATE', message: 'PRIVATE task data' } : null };
  const f = fixture({ invoke: () => ({ started: true, envelope: envelope(creation(applyPreview(target), { replayed: true, wake: rawWake, launch: { SECRET: 'PRIVATE' }, warnings: ['PRIVATE'] })) }) });
  const p = await f.send(prepare({ wake })), r = await f.send({ action: 'apply', spawnRef: p.spawnRef });
  assert.equal(r.status, saved === true ? 'complete' : 'partial'); assert.equal(r.receipt.wake.saved, saved); assert.equal(r.receipt.warningCount, 1); assert.doesNotMatch(JSON.stringify(r), /PRIVATE/);
  if (saved === null) assert.equal(r.reason.message, WAKE_OUTCOME_UNKNOWN);
  await f.send({ action: 'apply', spawnRef: p.spawnRef }); assert.equal(f.calls.length, 1, 'never respawn to repair a wake');
});
test('full decision receipt qualification rejects copied revision with mismatched effective or identity', async () => {
  for (const alter of [r => delete r.decision.effective, r => r.decision.effective.model = 'different', r => r.home = '/other', r => r.agent = 'other', r => r.replayed = 'true', r => r.runtime = 'codex']) {
    const raw = creation(applyPreview(target)); alter(raw);
    const f = fixture({ invoke: () => ({ started: true, envelope: envelope(raw) }) });
    const p = await f.send(prepare()), r = await f.send({ action: 'apply', spawnRef: p.spawnRef }); assert.equal(r.status, 'unknown'); assert.equal(r.receipt, null);
  }
});
for (const reject of [false, true]) for (const kind of ['CLI', 'workspace', 'anchor']) test(`prepare latest owner on ${reject ? 'rejection' : 'success'}: ${kind}`, async () => {
  const gate = deferred(), f = fixture({ read: () => gate.promise });
  const p = f.send(prepare({ choices: { relation: { kind: 'child', anchor } } })); await tick();
  if (kind === 'CLI') f.c.cli.spawnApplyApi = 2;
  if (kind === 'workspace') f.c.workspace.scope = '/other';
  if (kind === 'anchor') f.c.instances[0].createdAt = 'recreated';
  if (reject) gate.reject(Error('PRIVATE')); else gate.resolve({ status: 'available', data: applyPreview(target) });
  assert.equal((await p).reason?.code, 'E_PLAN_CHANGED'); assert.equal(f.calls.length, 0); assert.equal(f.ids(), 0);
});
for (const reject of [false, true]) test(`late mutation ${reject ? 'rejection' : 'success'} stays with original entry, scope loses response ownership`, async () => {
  const gate = deferred(), f = fixture({ invoke: () => gate.promise }), p = await f.send(prepare());
  const pending = f.send({ action: 'apply', spawnRef: p.spawnRef }); await tick(); f.c.workspace.scope = '/other';
  if (reject) gate.reject(Error('PRIVATE')); else gate.resolve({ started: true, envelope: envelope(creation(applyPreview(target))) });
  assert.equal((await pending).status, 'unknown');
  f.c.workspace.scope = DEPLOYMENT; const r = await f.send({ action: 'result', spawnRef: p.spawnRef }); assert.equal(r.status, reject ? 'unknown' : 'complete'); assert.equal(f.calls.length, 1);
});
test('downgrade before first apply and before unknown retry refuses without new dispatch/key', async () => {
  for (const afterUnknown of [false, true]) {
    const f = fixture({ invoke: () => { throw Error('PRIVATE'); } }), p = await f.send(prepare());
    if (afterUnknown) await f.send({ action: 'apply', spawnRef: p.spawnRef });
    const calls = f.calls.length, ids = f.ids(); f.c.cli.features = f.c.cli.features.filter(v => v !== 'spawn-idempotency-2');
    assert.equal((await f.send({ action: 'apply', spawnRef: p.spawnRef })).reason.code, 'E_PLAN_CHANGED'); assert.equal(f.calls.length, calls); assert.equal(f.ids(), ids);
  }
});
for (const [name, alter] of [['remote', c => c.workspace.remote = true], ['attached', c => c.agents[0].work = 'attached'], ['captured', c => c.agents[0].captured = {}],
  ['old replay', c => c.cli.features = c.cli.features.filter(v => v !== 'spawn-idempotency-2')], ['ambiguous', c => c.agents.push({ ...c.agents[0] })]]) test(`prepare zero-effect admission: ${name}`, async () => {
  const f = fixture(); alter(f.c); const r = await f.send(prepare()); assert.equal(r.status, 'unavailable'); assert.equal(f.reads.length, 0); assert.equal(f.calls.length, 0);
});
test('prepare never infers optional wake support from the guarded-spawn marker', async () => {
  const f = fixture(); f.c.cli.features = f.c.cli.features.filter(v => v !== 'schedule');
  assert.equal((await f.send(prepare({ wake }))).reason.code, 'E_UNSUPPORTED_OPTION');
  assert.equal(f.reads.length, 0); assert.equal(f.calls.length, 0); assert.equal(f.ids(), 0);
});
test('input/ref schema rejects caller key/decision/task changes and non-approved retry action', async () => {
  const f = fixture(), p = await f.send(prepare());
  for (const request of [prepare({ key: 'caller' }), { action: 'apply', spawnRef: p.spawnRef, task: 'replace' }, { action: 'result', spawnRef: p.spawnRef, key: 'caller' }, { action: 'retry', spawnRef: p.spawnRef }]) {
    assert.equal((await f.send(request)).reason.code, 'E_BAD_ARGS');
  }
  assert.equal(f.calls.length, 0);
});
test('expiry and new server lose ref authority, never recover by name or mint a key', async () => {
  const f = fixture(), p = await f.send(prepare()); f.advance(300001);
  assert.equal((await f.send({ action: 'apply', spawnRef: p.spawnRef })).reason.code, 'E_INTENT_EXPIRED'); assert.equal(f.ids(), 1); assert.equal(f.calls.length, 0);
  const other = fixture(); assert.equal((await other.send({ action: 'apply', spawnRef: p.spawnRef })).reason.code, 'E_INTENT_EXPIRED'); assert.equal(other.ids(), 0);
});
test('32 preparation reservations are bounded even while a shared read is pending', async () => {
  const gate = deferred(), f = fixture({ read: () => gate.promise });
  const requests = Array.from({ length: 32 }, () => f.send(prepare())); await tick();
  assert.equal((await f.send(prepare())).reason.code, 'E_BUSY'); assert.equal(f.reads.length, 32);
  gate.resolve({ status: 'available', data: applyPreview(target) }); const ready = await Promise.all(requests);
  assert.ok(ready.every(r => r.status === 'prepared')); assert.equal(new Set(ready.map(r => r.spawnRef)).size, 32);
});
test('32 submitted outcomes cap admission before a 33rd key/dispatch; expiry releases capacity', async () => {
  const f = fixture({ invoke: () => ({ started: false, envelope: { schemaVersion: 1, ok: false, error: { code: 'E_INPUT_PREPARATION' } } }) });
  for (let i = 0; i < 32; i++) { const p = await f.send(prepare()); assert.equal((await f.send({ action: 'apply', spawnRef: p.spawnRef })).status, 'refused'); }
  const next = await f.send(prepare()), ids = f.ids(); assert.equal((await f.send({ action: 'apply', spawnRef: next.spawnRef })).reason.code, 'E_BUSY');
  assert.equal(f.calls.length, 32); assert.equal(f.ids(), ids);
  f.advance(30 * 60000 + 1); const fresh = await f.send(prepare()); await f.send({ action: 'apply', spawnRef: fresh.spawnRef }); assert.equal(f.calls.length, 33);
});
test('incomplete preflight, missing strong decision and unavailable backend mint no ref', async () => {
  for (const [change, code] of [[v => v.preflight.status = 'timeout', 'E_PREFLIGHT_INCOMPLETE'], [v => delete v.decision.effective, 'E_CLI_PROTOCOL'], [v => v.backendStatus.installed = false, 'E_BACKEND_UNAVAILABLE']]) {
    const v = applyPreview(target); change(v); const f = fixture({ read: () => ({ status: 'available', data: v }) });
    assert.equal((await f.send(prepare())).reason.code, code); assert.equal(f.ids(), 0); assert.equal(f.calls.length, 0);
  }
});
test('mint collision cannot alias another confirmation or dispatch with its ref as key', async () => {
  const f = fixture({ mint: () => 'a'.repeat(64) }), first = await f.send(prepare());
  assert.equal((await f.send(prepare())).reason.code, 'E_BUSY');
  assert.equal((await f.send({ action: 'apply', spawnRef: first.spawnRef })).reason.code, 'E_BUSY'); assert.equal(f.calls.length, 0);
});
test('bloated kernel payloads are not retained: 32 intents fit the byte budget, the 33rd is refused by count', async () => {
  const v = applyPreview(target); v.skills = Array(512).fill('界'.repeat(512)); v.capabilities = [...v.skills]; v.modules = [...v.skills];
  const f = fixture({ read: () => ({ status: 'available', data: v }) });
  for (let i = 0; i < 32; i++) { const r = await f.send(prepare()); assert.equal(r.status, 'prepared'); assert.doesNotMatch(JSON.stringify(r), /界/); }
  assert.equal((await f.send(prepare())).reason.code, 'E_BUSY'); assert.equal(f.calls.length, 0);
});
test('observed keyed home disappearance blocks further unknown retry; complete cache never dispatches after retire', async () => {
  const f = fixture({ invoke: () => { throw Error('unknown'); } }), p = await f.send(prepare());
  await f.send({ action: 'apply', spawnRef: p.spawnRef }); const call = f.calls[0].args;
  f.c.instances.push({ instance: call.decision.instance, home: call.decision.home, agent: selector.soul, agentsRoot: selector.agentsRoot, spawnIdempotencyKey: call.key, createdAt: 'first' });
  await f.send({ action: 'apply', spawnRef: p.spawnRef }); assert.equal(f.calls.length, 2);
  f.c.instances = []; const gone = await f.send({ action: 'apply', spawnRef: p.spawnRef }); assert.equal(gone.reason.code, 'E_INSTANCE_GONE'); assert.equal(f.calls.length, 2);
  const complete = fixture(), q = await complete.send(prepare()); await complete.send({ action: 'apply', spawnRef: q.spawnRef }); complete.c.instances = [];
  assert.equal((await complete.send({ action: 'apply', spawnRef: q.spawnRef })).status, 'complete'); assert.equal(complete.calls.length, 1);
});
test('wake projector rejects contradictions and safe receipt never leaks raw provider data', () => {
  for (const value of [null, {}, { requested: false, saved: true, error: null }, { requested: null, saved: false, error: null }, { requested: true, saved: false, error: null }, { requested: true, saved: true, error: { code: 'x' } }]) assert.equal(spawnWakeOutcome(value, true), null);
  const preview = applyPreview(target), raw = creation(preview, { launch: { env: 'PRIVATE' }, attach: 'PRIVATE', task: 'PRIVATE', warnings: ['PRIVATE'] });
  assert.doesNotMatch(JSON.stringify(spawnCreationReceipt(raw, { target, preview })), /PRIVATE/);
});
