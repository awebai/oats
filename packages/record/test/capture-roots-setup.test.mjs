// The typed setup boundary uses only disposable sources and --no-hooks/--no-service.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readCaptureRoots } from '../lib/capture-roots.mjs';
import { RecordStore } from '../lib/store.mjs';

function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'roots-setup-'))), home = join(base, 'home'), deployment = join(base, 'deployment'), root = join(base, 'record');
  for (const path of [home, deployment, join(base, 'tmp'), join(base, 'cache')]) fs.mkdirSync(path);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const request = (roots = [], unavailable = []) => ({ schemaVersion: 1, deployment: fs.realpathSync(deployment), roots, unavailable });
  const run = (deploymentRequest, extra = [], preload) => spawnSync(process.execPath, [...(preload ? ['--import', preload] : []), '--input-type=module', '--eval', `
    import { captureSetup } from ${JSON.stringify(new URL('../lib/capture-setup.mjs', import.meta.url).href)};
    const result = await captureSetup({ argv: ${JSON.stringify(['--owner', 'fixture', '--root', root, '--no-hooks', '--no-service', '--json', ...extra])},
      deploymentRequest: ${JSON.stringify(deploymentRequest)} });
    console.log(JSON.stringify(result)); process.exitCode = result.exitCode;
  `], { cwd: base, env: { HOME: home, TMPDIR: join(base, 'tmp'), XDG_CACHE_HOME: join(base, 'cache'), PATH: '/usr/bin:/bin' },
    encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  return { base, root, home, deployment, request, run };
}

test('typed setup continues independent steps for a per-root warning, emits one JSON document and exit0', t => {
  const f = fixture(t), result = f.run(f.request([], [{ configuration: 'relative', selector: 'CODEX_HOME', reason: 'relative' }]));
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const value = JSON.parse(result.stdout);
  assert.equal(value.ok, true); assert.equal(value.summary.rootRegistration, 'refreshed');
  assert.equal(value.warnings[0].reason, 'relative'); assert.ok(value.warnings[0].remedy);
  assert.equal(value.summary.service, 'skipped (--no-service)');
  assert.match(value.summary.firstPass, /coverage incomplete/);
  assert.equal(readCaptureRoots(f.root).entries.length, 1);
  assert.equal(fs.existsSync(join(f.home, '.config/systemd')), false);
});

test('typed dry setup validates and describes roots but creates nothing; standalone request absence preserves entries', t => {
  const f = fixture(t), selected = { source: 'pi', path: join(f.base, 'future') };
  const dry = f.run(f.request([selected]), ['--dry-run']);
  assert.equal(dry.status, 0, dry.stderr); assert.equal(JSON.parse(dry.stdout).summary.rootRegistration, 'would refresh');
  assert.equal(fs.existsSync(f.root), false); assert.equal(fs.existsSync(selected.path), false);
  assert.equal(f.run(f.request([selected])).status, 0);
  const before = readCaptureRoots(f.root).entries;
  assert.equal(f.run(undefined).status, 0);
  assert.deepEqual(readCaptureRoots(f.root).entries, before);
});

test('actual setup captures independent registered pi roots once and does not duplicate history after refresh', t => {
  const f = fixture(t), roots = ['one', 'two'].map(name => ({ source: 'pi', path: join(f.base, name) }));
  for (const [n, root] of roots.entries()) {
    fs.mkdirSync(root.path);
    fs.writeFileSync(join(root.path, `session${n}.jsonl`), JSON.stringify({ type: 'session', version: 3, id: `session${n}`, cwd: f.deployment, timestamp: '2026-01-01T00:00:00Z' }) + '\n' +
      JSON.stringify({ type: 'message', id: `message${n}`, timestamp: '2026-01-01T00:00:01Z', message: { role: 'user', content: [{ type: 'text', text: `root ${n}` }] } }) + '\n');
  }
  const first = f.run(f.request(roots)); assert.equal(first.status, 0, first.stderr + first.stdout);
  assert.match(JSON.parse(first.stdout).summary.firstPass, /appended 2/);
  const store = new RecordStore(f.root, { owner: 'fixture' });
  const before = store.listStreams().map(stream => [stream, store.readStream(stream).map(turn => turn.id)]);
  const second = f.run(f.request(roots.slice(1))); assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.match(JSON.parse(second.stdout).summary.firstPass, /appended 0/);
  assert.deepEqual(store.listStreams().map(stream => [stream, store.readStream(stream).map(turn => turn.id)]), before);
  assert.equal(readCaptureRoots(f.root).entries[0].retiredRoots.length, 1);
});

test('fresh setup losing admission reports exact prefix initialization and performs no registry/hooks/service/first pass', t => {
  const f = fixture(t), preload = join(f.base, 'competing-lock.mjs'), witness = join(f.base, 'injected');
  fs.writeFileSync(preload, `
    import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    const mkdir = fs.mkdirSync;
    fs.mkdirSync = function(path, options) {
      const result = mkdir(path, options);
      if (path === ${JSON.stringify(f.root)}) {
        mkdir(${JSON.stringify(join(f.root, '.capture.lock'))});
        fs.writeFileSync(${JSON.stringify(join(f.root, '.capture.lock/owner.json'))}, JSON.stringify({ pid: process.pid, nonce: 'competitor',
          startedAt: new Date().toISOString(), command: 'setup-roots' }));
        fs.writeFileSync(${JSON.stringify(witness)}, 'injected');
      }
      return result;
    };
    syncBuiltinESMExports();
  `);
  const result = f.run(f.request([]), [], preload);
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const value = JSON.parse(result.stdout);
  assert.match(value.summary.rootRegistration, /refused; partial initialization: created setup parent/);
  assert.equal(value.summary.firstPass, 'not run'); assert.equal(value.summary.service, 'skipped (--no-service)');
  assert.deepEqual(value.summary.hooks, []);
  assert.equal(fs.readFileSync(witness, 'utf8'), 'injected');
  assert.equal(fs.existsSync(join(f.root, 'capture-roots')), false);
  assert.equal(fs.existsSync(join(f.root, 'capture-status.json')), false);
});
