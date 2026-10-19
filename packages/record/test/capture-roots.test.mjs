// Registry fixtures use private paths only. No setup service, harness or live settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { preflightCaptureRoots, applyCaptureRoots, readCaptureRoots, forgetRetiredRoot } from '../lib/capture-roots.mjs';
import { acquireCaptureLock, readCaptureLockOwner } from '../lib/capture-lock.mjs';

function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'capture-roots-'))), root = join(base, 'record');
  const deployment = join(base, 'deployment'), other = join(base, 'other');
  for (const path of [deployment, other]) fs.mkdirSync(path);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const entry = d => join(root, 'capture-roots', createHash('sha256').update(d).digest('hex') + '.json');
  const request = (roots, d = deployment, unavailable = []) => ({ schemaVersion: 1, deployment: fs.realpathSync(d), roots, unavailable });
  const refresh = (roots, d = deployment, unavailable = []) => applyCaptureRoots(preflightCaptureRoots(root, request(roots, d, unavailable)), { entry: 'turn-record' });
  return { base, root, deployment, other, entry, request, refresh };
}
const pi = path => ({ source: 'pi', path });

test('absent absolute roots register durably, idempotently and independently; empty refresh retires and re-add restores', t => {
  const f = fixture(t), shared = pi(join(f.base, 'not-yet-created'));
  f.refresh([shared, shared]);
  assert.equal(fs.existsSync(shared.path), false);
  assert.equal(fs.statSync(f.entry(f.deployment)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(join(f.root, 'capture-roots')).mode & 0o777, 0o700);
  const before = fs.readFileSync(f.entry(f.deployment));
  assert.equal(f.refresh([shared]).changed, false);
  assert.deepEqual(fs.readFileSync(f.entry(f.deployment)), before);
  f.refresh([shared], f.other); f.refresh([]);
  const a = JSON.parse(fs.readFileSync(f.entry(f.deployment)));
  assert.deepEqual(a.roots, []); assert.deepEqual(a.retiredRoots, [shared]);
  let inventory = readCaptureRoots(f.root);
  assert.deepEqual(inventory.roots, [shared]); assert.deepEqual(inventory.rows, []);
  f.refresh([shared]);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.entry(f.deployment))).retiredRoots, []);
  assert.deepEqual(readCaptureRoots(f.root).roots, [shared]);
});

test('lock overlap refuses registration before mutation and attributes setup-roots', t => {
  const f = fixture(t), selected = pi(join(f.base, 'sessions'));
  const plan = preflightCaptureRoots(f.root, f.request([selected]));
  const lock = acquireCaptureLock(f.root, { command: 'pass', caller: { entry: 'turn-record', trigger: 'manual' } });
  try {
    assert.throws(() => applyCaptureRoots(plan, { entry: 'oats' }), /pass|retry.*current/i);
    assert.equal(fs.existsSync(f.entry(f.deployment)), false);
  } finally { lock.release(); }
  f.refresh([selected]);
  const own = acquireCaptureLock(f.root, { command: 'setup-roots', caller: { entry: 'oats', trigger: 'setup' } });
  try { assert.equal(readCaptureLockOwner(f.root).command, 'setup-roots'); } finally { own.release(); }
});

test('forget removes only exact retired reference without statting transcript path; current refuses; repeated forget succeeds', t => {
  const f = fixture(t), path = join(f.base, 'dangling'), root = pi(path);
  fs.symlinkSync(join(f.base, 'never-created'), path);
  f.refresh([root]); f.refresh([root], f.other); f.refresh([]);
  const selected = { deployment: f.deployment, source: 'pi', path };
  assert.equal(forgetRetiredRoot(f.root, selected).changed, true);
  assert.equal(forgetRetiredRoot(f.root, selected).changed, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.entry(f.other))).roots, [root]);
  assert.throws(() => forgetRetiredRoot(f.root, { ...selected, deployment: f.other }), /current/);
  assert.equal(fs.lstatSync(path).isSymbolicLink(), true);
});

test('retired dangling roots warn with exact forget selectors; absent roots do not warn', t => {
  const f = fixture(t), path = join(f.base, 'dangling');
  fs.symlinkSync(join(f.base, 'missing-target'), path);
  f.refresh([pi(path)]); f.refresh([]);
  const inventory = readCaptureRoots(f.root);
  assert.equal(inventory.rows[0].code, 'capture-roots-unavailable');
  for (const selector of ['--forget-retired-root', '--deployment', '--source pi', '--root']) assert.ok(inventory.rows[0].message.includes(selector));
  fs.unlinkSync(path);
  assert.deepEqual(readCaptureRoots(f.root).rows, []);
});

test('absent and inode-recreated deployments do not silently reactivate prior current roots', t => {
  const f = fixture(t), selected = pi(join(f.base, 'sessions'));
  fs.mkdirSync(selected.path); f.refresh([selected]);
  fs.renameSync(f.deployment, f.deployment + '-old');
  assert.deepEqual(readCaptureRoots(f.root).rows, []);
  assert.deepEqual(readCaptureRoots(f.root).roots, [selected]);
  fs.mkdirSync(f.deployment);
  assert.equal(readCaptureRoots(f.root).rows[0].code, 'capture-roots-refresh-required');
  f.refresh([selected]); assert.deepEqual(readCaptureRoots(f.root).rows, []);
});

test('closed wire, corrupt/future entries, filename mismatch and nonregular entries fail visibly', t => {
  const f = fixture(t), selected = pi(join(f.base, 'sessions'));
  assert.throws(() => preflightCaptureRoots(f.root, { ...f.request([selected]), env: { SECRET: 'no' } }), /invalid/);
  f.refresh([selected]);
  const path = f.entry(f.deployment), original = fs.readFileSync(path), value = JSON.parse(original);
  for (const contents of ['{', JSON.stringify({ ...value, schemaVersion: 2 }), JSON.stringify({ ...value, extra: true }), ' '.repeat(1024 * 1024 + 1)]) {
    fs.writeFileSync(path, contents);
    assert.equal(readCaptureRoots(f.root).rows[0].code, 'capture-roots-invalid');
    assert.throws(() => preflightCaptureRoots(f.root, f.request([])));
  }
  fs.writeFileSync(path, original); fs.renameSync(path, join(f.root, 'capture-roots', '0'.repeat(64) + '.json'));
  assert.equal(readCaptureRoots(f.root).rows[0].code, 'capture-roots-invalid');
});

test('dry preflight makes no directories or transcript changes; checked publication refuses replacement after preflight', t => {
  const f = fixture(t), selected = pi(join(f.base, 'absent'));
  const plan = preflightCaptureRoots(f.root, f.request([selected]));
  assert.equal(fs.existsSync(f.root), false);
  f.refresh([selected]);
  assert.throws(() => applyCaptureRoots(plan), /changed|preflight/);
  assert.equal(fs.existsSync(selected.path), false);
});

test('root diagnostic rows remain bounded and generic envelope accepts a future capture-roots code', async t => {
  const f = fixture(t);
  const unavailable = Array.from({ length: 110 }, (_, n) => ({ configuration: `config${n}`, selector: 'CODEX_HOME', reason: 'relative' }));
  f.refresh([], f.deployment, unavailable);
  assert.equal(readCaptureRoots(f.root).rows.length, 101);
  const { validCaptureHealthEnvelope, emptyCaptureStatus } = await import('../lib/capture-status.mjs');
  const status = emptyCaptureStatus({ pending: false, setAsideCount: 0, setAside: [], truncated: false, failedCount: 0, failed: [], failedTruncated: false });
  assert.equal(validCaptureHealthEnvelope({ schemaVersion: 1, status: 'warning', rows: [{ code: 'capture-roots-future', message: 'Future diagnostic' }],
    lastRun: null, lastSuccess: null, lastFailure: null, backlog: status.backlog }), true);
});

test('registered setup evidence is diagnosed without hooks/service; no registration on old hosts stays silent', async t => {
  const f = fixture(t), home = join(f.base, 'home'); fs.mkdirSync(home);
  const { captureHealth } = await import('../lib/capture-health.mjs');
  assert.deepEqual(captureHealth(f.root, { home, platform: 'fixture' }).rows, []);
  assert.equal(fs.existsSync(f.root), false);
  f.refresh([], f.deployment, [{ configuration: 'relative', selector: 'CODEX_HOME', reason: 'relative' }]);
  const before = fs.readFileSync(f.entry(f.deployment));
  const health = captureHealth(f.root, { home, platform: 'fixture' });
  assert.ok(health.rows.some(row => row.code === 'capture-roots-unavailable'));
  assert.ok(health.rows.some(row => row.code === 'capture-status-missing'));
  assert.deepEqual(fs.readFileSync(f.entry(f.deployment)), before);
});

test('checked publisher is reused and unsafe registry directory/entry links are refused', t => {
  const f = fixture(t), path = join(f.base, 'sessions');
  const source = fs.readFileSync(new URL('../lib/capture-roots.mjs', import.meta.url), 'utf8');
  assert.match(source, /import .*writeCaptureSetup.*from ['"]\.\/capture-setup-write\.mjs/);
  assert.doesNotMatch(source, /renameSync|fsyncSync|writeFileSync/);
  f.refresh([pi(path)]);
  fs.unlinkSync(f.entry(f.deployment));
  const external = join(f.base, 'external'); fs.writeFileSync(external, 'private');
  fs.symlinkSync(external, f.entry(f.deployment));
  assert.throws(() => preflightCaptureRoots(f.root, f.request([])), /unsafe/);
  assert.equal(readCaptureRoots(f.root).rows[0].code, 'capture-roots-invalid');
  assert.equal(fs.readFileSync(external, 'utf8'), 'private');
});

for (const stage of ['write', 'file-sync', 'rename', 'directory-sync']) test(`registry fault at ${stage} leaves an old-or-new valid snapshot and reports uncertainty honestly`, t => {
  const f = fixture(t), beforeRoot = pi(join(f.base, 'before')), afterRoot = pi(join(f.base, 'after'));
  f.refresh([beforeRoot]);
  const before = fs.readFileSync(f.entry(f.deployment));
  const plan = preflightCaptureRoots(f.root, f.request([afterRoot]));
  let syncs = 0;
  const operations = { ...fs,
    writeFileSync(...args) { if (stage === 'write') throw new Error('injected write'); return fs.writeFileSync(...args); },
    fsyncSync(...args) { syncs++; if (syncs === (stage === 'file-sync' ? 1 : stage === 'directory-sync' ? 2 : -1)) throw new Error('injected sync'); return fs.fsyncSync(...args); },
    renameSync(...args) { if (stage === 'rename') throw new Error('injected rename'); return fs.renameSync(...args); },
  };
  assert.throws(() => applyCaptureRoots(plan, { operations }), error => {
    assert.equal(error.published, stage === 'directory-sync');
    assert.match(error.message, stage === 'directory-sync' ? /publication may have occurred/ : /not published/);
    return true;
  });
  const after = fs.readFileSync(f.entry(f.deployment));
  assert.ok(after.equals(before) || after.equals(Buffer.from(plan.contents)));
  assert.equal(readCaptureRoots(f.root).rows.length, 0);
  assert.equal(fs.readdirSync(join(f.root, 'capture-roots')).some(name => name.includes('.tmp-')), false);
});

test('a competing refresh invalidates a stale plan while another deployment remains unchanged', t => {
  const f = fixture(t), a = pi(join(f.base, 'a')), b = pi(join(f.base, 'b'));
  f.refresh([a]); f.refresh([a], f.other);
  const other = fs.readFileSync(f.entry(f.other)), stale = preflightCaptureRoots(f.root, f.request([]));
  f.refresh([b]);
  assert.throws(() => applyCaptureRoots(stale), /changed/);
  assert.deepEqual(fs.readFileSync(f.entry(f.other)), other);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.entry(f.deployment))).roots, [b]);
});

test('registry name and aggregate guards report incomplete coverage rather than a successful truncated union', t => {
  const f = fixture(t); f.refresh([]);
  const dir = join(f.root, 'capture-roots');
  for (let n = 0; n < 4096; n++) fs.writeFileSync(join(dir, n.toString(16).padStart(64, '0') + '.json'), '{}');
  const result = readCaptureRoots(f.root);
  assert.ok(result.rows.some(row => row.code === 'capture-roots-invalid' && /4096/.test(row.message)));
  assert.ok(result.rows.length <= 101);
});

test('resolved unreadable diagnostics carry a tied optional path; unknown-map warnings stay unbound', t => {
  const f = fixture(t), path = join(f.base, 'dangling'); fs.symlinkSync(join(f.base, 'missing-target'), path);
  const warning = { configuration: 'selected', selector: 'PI_CODING_AGENT_SESSION_DIR', reason: 'unreadable', path };
  f.refresh([pi(path)], f.deployment, [warning]);
  const before = fs.readFileSync(f.entry(f.deployment));
  assert.ok(readCaptureRoots(f.root).rows.some(row => /configuration selected/.test(row.message)));
  fs.unlinkSync(path);
  assert.equal(readCaptureRoots(f.root).rows.some(row => /configuration selected/.test(row.message)), false);
  assert.deepEqual(fs.readFileSync(f.entry(f.deployment)), before, 'observation does not rewrite inventory');
  fs.mkdirSync(path);
  assert.deepEqual(readCaptureRoots(f.root).rows, []);
  for (const invalid of [{ ...warning, reason: 'relative' }, { ...warning, path: join(f.base, 'foreign') }, { ...warning, path: './relative' }])
    assert.throws(() => preflightCaptureRoots(f.root, f.request([pi(path)], f.deployment, [invalid])), /invalid/);
  f.refresh([], f.deployment, [{ configuration: '(deployment)', selector: 'launch-configs', reason: 'unreadable' }]);
  assert.ok(readCaptureRoots(f.root).rows.some(row => /launch-configs/.test(row.message)));
});

test('two configurations sharing one unreadable root resolve together without hiding a different root', t => {
  const f = fixture(t), paths = ['one', 'two'].map(name => join(f.base, name));
  for (const path of paths) fs.symlinkSync(join(f.base, 'missing'), path);
  const unavailable = ['a', 'b', 'c'].map((configuration, n) => ({ configuration, selector: 'CODEX_HOME', reason: 'unreadable', path: paths[n === 2 ? 1 : 0] }));
  f.refresh(paths.map(pi), f.deployment, unavailable);
  fs.unlinkSync(paths[0]); fs.mkdirSync(paths[0]);
  const rows = readCaptureRoots(f.root).rows;
  assert.equal(rows.some(row => /configuration [ab],/.test(row.message)), false);
  assert.ok(rows.some(row => /configuration c,/.test(row.message)));
});

test('fresh-prefix owner keeps ordinary mode and a losing lock claim reports only its initialization effects', t => {
  const f = fixture(t), plan = preflightCaptureRoots(f.root, f.request([pi(join(f.base, 'sessions'))]));
  let competitor, injected = false;
  try {
    assert.throws(() => applyCaptureRoots(plan, { acquire(root, options) {
      injected = true;
      // Competing setup preflights after this caller created the prefix.
      preflightCaptureRoots(root, f.request([]));
      competitor = acquireCaptureLock(root, { command: 'setup-roots', caller: { entry: 'turn-record', trigger: 'setup' } });
      return acquireCaptureLock(root, options);
    } }), error => {
      assert.equal(error.code, 'E_CAPTURE_ROOTS_BUSY');
      assert.deepEqual(error.applied, [`created setup parent ${f.root}`]);
      return true;
    });
    assert.equal(injected, true);
    assert.equal(fs.statSync(f.root).mode & 0o777, 0o777 & ~process.umask());
    assert.equal(fs.statSync(f.root).uid, fs.statSync(f.base).uid);
    assert.equal(fs.existsSync(join(f.root, 'capture-roots')), false);
  } finally { competitor?.release(); }
});

test('two missing-root preflights cannot counterfeit the creator map or adopt a competitor prefix', t => {
  const f = fixture(t), request = f.request([]), first = preflightCaptureRoots(f.root, request), second = preflightCaptureRoots(f.root, request);
  let witness = false;
  const result = applyCaptureRoots(first, { acquire(root, options) {
    assert.throws(() => applyCaptureRoots(second), /parent changed/); witness = true;
    return acquireCaptureLock(root, options);
  } });
  assert.equal(witness, true); assert.equal(result.changed, true);
  assert.equal(readCaptureRoots(f.root).entries.length, 1);
});

test('prepared root deletion before claim refuses without blind recursive re-creation', t => {
  const f = fixture(t), plan = preflightCaptureRoots(f.root, f.request([])); let witness = false;
  assert.throws(() => applyCaptureRoots(plan, { acquire(root, options) {
    fs.rmdirSync(root); witness = true;
    return acquireCaptureLock(root, options);
  } }), /parent changed/);
  assert.equal(witness, true); assert.equal(fs.existsSync(f.root), false);
});

test('an existing-root busy claim leaves registration and foreign state byte-for-byte unchanged', t => {
  const f = fixture(t); f.refresh([]);
  const before = fs.readFileSync(f.entry(f.deployment));
  const foreign = join(f.root, 'foreign'); fs.writeFileSync(foreign, 'unchanged');
  const plan = preflightCaptureRoots(f.root, f.request([pi(join(f.base, 'new'))]));
  const lock = acquireCaptureLock(f.root, { command: 'pass', caller: { entry: 'turn-record', trigger: 'manual' } });
  const names = fs.readdirSync(f.root).sort();
  try {
    assert.throws(() => applyCaptureRoots(plan), error => {
      assert.equal(error.code, 'E_CAPTURE_ROOTS_BUSY'); assert.deepEqual(error.applied, []); return true;
    });
    assert.deepEqual(fs.readFileSync(f.entry(f.deployment)), before);
    assert.deepEqual(fs.readdirSync(f.root).sort(), names); assert.equal(fs.readFileSync(foreign, 'utf8'), 'unchanged');
  } finally { lock.release(); }
});

test('forget never probes or deletes the transcript directory and isolates source/path/deployment references', t => {
  const f = fixture(t), path = join(f.base, 'unavailable'), peer = join(f.base, 'peer');
  fs.symlinkSync(join(f.base, 'missing'), path);
  f.refresh([pi(path), { source: 'cc', path }, pi(peer)]); f.refresh([]); f.refresh([pi(path)], f.other);
  const other = fs.readFileSync(f.entry(f.other));
  const methods = ['statSync', 'lstatSync', 'accessSync', 'realpathSync', 'openSync', 'opendirSync', 'readdirSync', 'readFileSync', 'chmodSync', 'unlinkSync', 'rmSync'];
  const originals = new Map(methods.map(name => [name, fs[name]])); let probes = 0;
  try {
    for (const name of methods) fs[name] = function(value, ...rest) {
      if (typeof value === 'string' && (value === path || value.startsWith(path + '/'))) {
        probes++; throw new Error('forbidden transcript-directory operation');
      }
      return originals.get(name).call(this, value, ...rest);
    };
    syncBuiltinESMExports();
    assert.equal(forgetRetiredRoot(f.root, { deployment: f.deployment, source: 'pi', path }).changed, true);
    assert.equal(probes, 0);
  } finally {
    for (const [name, original] of originals) fs[name] = original;
    syncBuiltinESMExports();
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(f.entry(f.deployment))).retiredRoots, [{ source: 'cc', path }, pi(peer)]);
  assert.deepEqual(fs.readFileSync(f.entry(f.other)), other);
  assert.equal(fs.lstatSync(path).isSymbolicLink(), true);
});
