// CI-only real kernel adapter fixtures: no discovery remote, harness or manager.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const cli = new URL('../bin/oats.mjs', import.meta.url).pathname;
function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'roots-kernel-'))), home = join(base, 'home'), parent = join(base, 'parent'), deployment = join(parent, 'child'), root = join(base, 'record');
  for (const dir of [home, deployment, join(base, 'tmp'), join(base, 'cache'), join(base, 'bin')]) fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(process.execPath, join(base, 'bin/node'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const declaration = configurations => ({ schemaVersion: 2, workspace: 'file://' + join(base, 'nonexistent-workspace.git'), 'launch-configs': configurations });
  const put = (dir, configurations) => fs.writeFileSync(join(dir, 'oats-local.yaml'), JSON.stringify(declaration(configurations)));
  const run = () => spawnSync(process.execPath, [cli, 'setup', '--dir', deployment, '--root', root, '--owner', 'fixture', '--no-hooks', '--no-service', '--dry-run', '--json'],
    { cwd: home, env: { HOME: home, TMPDIR: join(base, 'tmp'), XDG_CACHE_HOME: join(base, 'cache'), PATH: join(base, 'bin'),
      PRIVATE_CODEX: join(base, 'codex'), SECRET: 'never-serialize-this' }, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  return { base, parent, deployment, root, put, run };
}

test('real kernel setup uses the effective deployment map, includes unselected names and excludes shadowed declarations', t => {
  const f = fixture(t);
  f.put(f.parent, { shadowed: { harness: 'claude', env: { CLAUDE_CONFIG_DIR: join(f.base, 'shadowed') } } });
  f.put(f.deployment, { selected: { harness: 'codex', default: true, executable: join(f.base, 'must-not-probe'), env: { CODEX_HOME: { fromEnv: 'PRIVATE_CODEX' }, SECRET: { fromEnv: 'SECRET' } } },
    unselected: { harness: 'pi', env: { PI_CODING_AGENT_SESSION_DIR: join(f.base, 'pi') } },
    refused: { harness: 'claude', env: { CLAUDE_CONFIG_DIR: './wrong-cwd' } } });
  const result = f.run(); assert.equal(result.status, 0, result.stderr + result.stdout);
  const value = JSON.parse(result.stdout);
  assert.deepEqual(value.summary.rootChanges.roots, [{ source: 'codex', path: join(f.base, 'codex/sessions') }, { source: 'pi', path: join(f.base, 'pi') }]);
  assert.equal(value.warnings[0].configuration, 'refused'); assert.equal(value.warnings[0].reason, 'relative');
  assert.doesNotMatch(result.stdout, /never-serialize-this|must-not-probe|wrong-cwd|shadowed/);
  assert.equal(fs.existsSync(f.root), false);
});

test('real kernel map-read failure is a visible coverage warning with dry-run exit0 and one document', t => {
  const f = fixture(t); f.put(f.deployment, { invalid: { harness: 'unsupported-harness' } });
  const result = f.run(); assert.equal(result.status, 0, result.stderr + result.stdout);
  const value = JSON.parse(result.stdout);
  assert.equal(value.warnings[0].selector, 'launch-configs'); assert.equal(value.warnings[0].reason, 'unreadable');
  assert.equal(fs.existsSync(f.root), false);
});
