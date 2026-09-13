import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fixture, write, json, readJSON, CAP } from './helpers/okf-v2.mjs';

const operation = f => f.cli(['operation', 'run', 'knowledge:inspect', '--home', f.home, '--json']);
test('local execution ignores ambient installed-package roots and source identity', () => {
  const helper = new URL('./helpers/okf-v2.mjs', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { fixture, write } from ${JSON.stringify(helper)};
    import { join } from 'node:path';
    let cleanup;
    try {
      const f = fixture({ after: fn => { cleanup = fn; } });
      write(join(f.home, 'STATE.md'), 'isolated local inspection');
      const out = f.direct(['inspect']).out.result;
      assert.equal(out.liveMemory.available, true);
      assert.equal(out.documents[0].text, 'isolated local inspection');
      f.retire(f.source.instance);
      assert.equal(f.inspect().liveMemory.reason, 'retired');
    } finally { cleanup?.(); }
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 90000,
    env: { ...process.env, OATS_PKG_ROOT: '/must-not-use-installed-package',
      OATS_OKF_CLI: '/must-not-use-installed-cli', OATS_CLI_BIN: '/must-not-use-runtime-cli',
      OATS_INSTANCE_HOME: '/must-not-use-source-home', OATS_HOME: '/must-not-use-source-home',
      OATS_PACKAGE_CATALOG: '/must-not-use-host-catalog', OATS_SETTINGS: '{broken' },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
test('OKF inspect exposes matching STATE/log/notes alongside durable evidence through direct and public operation pipes', t => {
  const f = fixture(t);
  const manifest = readJSON(join(CAP, 'oats.json'));
  assert.deepEqual(Object.keys(manifest.operations).sort(), ['harvest', 'inspect']);
  assert.equal(manifest.operations.inspect.kind, 'view');
  write(join(f.home, 'STATE.md'), '# state\n\nworking\n'); write(join(f.home, 'log.md'), '# log\n');
  write(join(f.home, 'notes/b.md'), 'note b\n'); write(join(f.home, 'notes/a.md'), 'note a\n');
  write(join(f.home, 'notes/nested/c.md'), 'nested note\n'); write(join(f.home, 'notes/skip.txt'), 'not markdown');
  const discovery = f.cli(['inspect', '--home', f.home, '--json']);
  assert.equal(discovery.knowledge.provider, 'oats.okf');
  assert.deepEqual(discovery.knowledge.operations.map(o => [o.name, o.kind, o.available]).sort(), [['harvest', 'action', true], ['inspect', 'view', true]]);
  for (const out of [f.direct(['inspect']).out.result, operation(f).result, f.inspect()]) {
    assert.equal(out.liveMemory.available, true);
    assert.deepEqual(out.documents.map(d => d.label), ['Working state (STATE.md)', 'Log (log.md)', 'Pending note: a.md', 'Pending note: b.md', 'Pending note: nested/c.md', 'Durable processing receipts']);
    assert.equal(out.documents[0].text, '# state\n\nworking\n');
    assert.equal(out.documents[2].path, join(f.home, 'notes/a.md'));
    assert.deepEqual(JSON.parse(out.documents.at(-1).text), out.status);
    assert.ok(out.acceptedView.project.digest); assert.equal(out.bases.project.path, f.accepted);
    assert.match(out.summary, /5 working-memory documents/);
    assert.equal(out.status.activeRun, null, 'inspection never requests a worker');
  }
  assert.equal(operation(f).instance, undefined, 'a view launches nothing');
  for (const p of ['STATE.md', 'log.md', 'notes']) fs.rmSync(join(f.home, p), { recursive: true });
  const empty = operation(f).result;
  assert.equal(empty.documents.length, 1, 'durable receipts remain even without live documents');
  assert.equal(empty.liveMemory.available, true); assert.match(empty.summary, /0 working-memory documents/);
});

test('large pipe regression: three live documents over 128 KiB arrive byte-exact through both stdout pipes', t => {
  const f = fixture(t);
  const texts = ['# State\n' + 'Live α state: do not truncate this pipe.\n'.repeat(5000), '# Log\n' + 'Observed β limitation in the source.\n'.repeat(5000), '# Note\n' + 'A live γ note for inspection.\n'.repeat(6000)];
  for (const [i, p] of ['STATE.md', 'log.md', 'notes/live.md'].entries()) {
    assert.ok(Buffer.byteLength(texts[i]) > 128 * 1024 && Buffer.byteLength(texts[i]) < 256 * 1024);
    write(join(f.home, p), texts[i]);
  }
  const direct = f.direct(['inspect']);
  assert.ok(Buffer.byteLength(direct.stdout) > 3 * 128 * 1024);
  for (const result of [direct.out.result, operation(f).result]) {
    assert.deepEqual(result.documents.slice(0, 3).map(d => d.text), texts);
    assert.ok(result.documents.slice(0, 3).every(d => d.truncated === undefined));
    assert.equal(result.documents.at(-1).label, 'Durable processing receipts');
  }
});

test('inspection announces its document preview cap without splitting UTF-8', t => {
  const f = fixture(t), text = 'x'.repeat(256 * 1024 - 1) + 'α trailing bytes';
  write(join(f.home, 'STATE.md'), text);
  for (const result of [f.direct(['inspect']).out.result, operation(f).result]) {
    const d = result.documents[0]; assert.equal(d.text, 'x'.repeat(256 * 1024 - 1));
    assert.equal(d.truncated, true); assert.equal(d.bytes, Buffer.byteLength(text)); assert.doesNotMatch(d.text, /\uFFFD/);
  }
});

for (const mode of ['retired', 'missing', 'reused', 'invalid-marker']) test(`descriptor inspection retains evidence but never exposes ${mode} live memory`, t => {
  const f = fixture(t);
  write(join(f.home, 'notes/decision.md'), 'Durable evidence before disappearance.\n');
  if (mode === 'retired') f.retire(f.source.instance);
  else {
    // Capture through the real command, but never launch a model.
    const run = f.run(); assert.equal(run.status, 'ready');
    fs.renameSync(f.home, join(f.base, 'preserved-home'));
    if (mode !== 'missing') {
      write(join(f.home, 'STATE.md'), 'DO_NOT_EXPOSE_REUSED_HOME');
      if (mode === 'reused') json(join(f.home, '.okf-source.json'), { version: 1, id: 'replacement', source: f.sourceFile });
      else write(join(f.home, '.okf-source.json'), 'DO_NOT_EXPOSE_REUSED_HOME');
    }
  }
  const out = f.inspect();
  assert.equal(out.liveMemory.available, false); assert.equal(out.documents.length, 1);
  assert.equal(out.status.captured.inputs.length, 1); assert.doesNotMatch(JSON.stringify(out), /DO_NOT_EXPOSE_REUSED_HOME/);
  const refresh = f.cli(['okf', 'refresh', '--source', f.sourceFile, '--soul', 'source', '--json']);
  assert.equal(dirname(refresh.path), join(dirname(f.sourceFile), 'views'));
  assert.equal(fs.existsSync(join(f.home, 'knowledge-view')), false);
});

for (const mode of ['symlink', 'hardlink', 'directory', 'notes-file']) test(`inspection fails explicitly for unsafe live ${mode}, never returns partial success`, t => {
  const f = fixture(t), secret = join(f.base, 'secret'); write(secret, 'DO_NOT_EXPOSE_UNSAFE_DOCUMENT');
  const state = join(f.home, 'STATE.md');
  if (mode === 'notes-file') { fs.rmSync(join(f.home, 'notes'), { recursive: true }); write(join(f.home, 'notes'), 'not a directory'); }
  else { fs.unlinkSync(state); if (mode === 'symlink') fs.symlinkSync(secret, state); else if (mode === 'hardlink') fs.linkSync(secret, state); else fs.mkdirSync(state); }
  const r = f.direct(['inspect'], { status: 1 });
  assert.equal(r.out.ok, false); assert.equal(r.out.error.code, mode === 'notes-file' ? 'E_INSPECT_FAILED' : 'E_PATH');
  assert.equal(r.out.result, undefined); assert.doesNotMatch(r.stdout, /DO_NOT_EXPOSE_UNSAFE_DOCUMENT/);
});

test('installed Git-source capability preserves the canonical soul and public dispatch through retirement and fresh-reader delivery', t => {
  const f = fixture(t, { installed: true });
  assert.equal(fs.readlinkSync(join(f.cap, 'agents/memory-harvest/CLAUDE.md')), 'AGENTS.md');
  write(join(f.home, 'notes/one.md'), 'Accepted deployment-independent rationale.\n');
  assert.equal(operation(f).result.liveMemory.available, true);
  f.retire(f.source.instance);
  const durable = f.inspect();
  assert.equal(durable.liveMemory.reason, 'retired'); assert.equal(durable.status.captured.inputs.length, 1);
  const run = f.run(); assert.equal(run.status, 'ready');
  const metadata = readJSON(join(run.home, 'instance.json'));
  assert.equal(metadata.work, 'directory'); assert.equal(metadata.launched, false);
  assert.equal(metadata.parentInstance, undefined, 'retired source is not an attachment dependency');
  assert.equal(f.complete(run).receipts.project.status, 'accepted');
  f.retire(run.instance);
  const reader = f.spawn('installed-reader');
  assert.match(fs.readFileSync(join(reader.home, 'knowledge/bases/project/expert/decision.md'), 'utf8'), /avoids silent fallback/);
  f.retire(reader.instance);
});
