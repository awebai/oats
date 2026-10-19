// Source oracles for the shared preparation helper. No runtime admission implied.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { captureSetupSnapshot, prepareCaptureSetupParents, recheckCaptureSetup, writeCaptureSetup } from '../lib/capture-setup-write.mjs';

function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'root-prefix-'))), root = join(base, 'missing/record');
  const path = join(root, 'capture-roots/entry.json');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, root, path, snapshot: captureSetupSnapshot(path) };
}

test('checked preparation creates only the requested record-root prefix and the same map supports publication', t => {
  const f = fixture(t), map = new Map();
  const result = prepareCaptureSetupParents(f.snapshot, map, { through: f.root });
  assert.equal(result.applied.length, 2);
  assert.equal(fs.existsSync(join(f.root, 'capture-roots')), false);
  assert.equal(map.has(join(f.base, 'missing')), true); assert.equal(map.has(f.root), true);
  recheckCaptureSetup(f.snapshot, map);
  writeCaptureSetup(f.snapshot, '{}\n', map);
  assert.equal(fs.readFileSync(f.path, 'utf8'), '{}\n');
});

test('competing preflight-missing mkdir is refused without adoption or deletion', t => {
  const f = fixture(t), map = new Map();
  fs.mkdirSync(join(f.base, 'missing'));
  assert.throws(() => prepareCaptureSetupParents(f.snapshot, map, { through: f.root }), /changed/);
  assert.equal(map.size, 0); assert.equal(fs.existsSync(f.root), false);
  assert.equal(fs.statSync(join(f.base, 'missing')).isDirectory(), true);
});

test('an EEXIST race during exclusive mkdir does not grant creation ownership', t => {
  const f = fixture(t), map = new Map(); let injected = false;
  const operations = { ...fs, mkdirSync(path) {
    if (!injected) { injected = true; fs.mkdirSync(path); }
    return fs.mkdirSync(path);
  } };
  assert.throws(() => prepareCaptureSetupParents(f.snapshot, map, { through: f.root, operations }), /EEXIST/);
  assert.equal(injected, true); assert.equal(map.size, 0);
  assert.equal(fs.statSync(join(f.base, 'missing')).isDirectory(), true);
  assert.equal(fs.existsSync(f.root), false);
});

test('a failed parent-entry sync revokes map evidence and reports the created prefix without rolling it back', t => {
  const f = fixture(t), map = new Map(); let sync = false;
  const operations = { ...fs, fsyncSync() { sync = true; throw Object.assign(new Error('unsupported directory sync'), { code: 'EINVAL' }); } };
  assert.throws(() => prepareCaptureSetupParents(f.snapshot, map, { through: f.root, operations }), error => {
    assert.equal(error.cause.code, 'EINVAL'); assert.match(error.stage, /created-parent directory fsync/);
    assert.equal(error.applied.length, 1); assert.equal(error.published, false); return true;
  });
  assert.equal(sync, true); assert.equal(map.size, 0);
  assert.equal(fs.existsSync(join(f.base, 'missing')), true); assert.equal(fs.existsSync(f.root), false);
  assert.throws(() => writeCaptureSetup(f.snapshot, '{}', map), /parent changed/);
});

for (const replacement of ['deleted', 'directory', 'link']) test(`prepared ${replacement} ancestry is refused without re-creation or adoption`, t => {
  const f = fixture(t), map = new Map();
  prepareCaptureSetupParents(f.snapshot, map, { through: f.root });
  fs.renameSync(f.root, f.root + '-saved');
  if (replacement === 'directory') fs.mkdirSync(f.root);
  if (replacement === 'link') fs.symlinkSync(f.root + '-saved', f.root);
  assert.throws(() => recheckCaptureSetup(f.snapshot, map), /parent changed/);
  assert.throws(() => writeCaptureSetup(f.snapshot, '{}', map), /parent changed/);
  assert.equal(fs.existsSync(f.path), false);
  if (replacement === 'deleted') assert.equal(fs.existsSync(f.root), false);
  if (replacement === 'link') assert.equal(fs.lstatSync(f.root).isSymbolicLink(), true);
});
