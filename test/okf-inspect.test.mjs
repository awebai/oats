import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture, write, json, readJSON, CAP, CLI, ROOT } from './helpers/okf-v2.mjs';
import { materializeOkfGitPayload } from '../scripts/check-okf-mirror.mjs';
import { inertHarnessPath } from './helpers/runtime-stub.mjs';

const operation = f => f.cli(['operation', 'run', 'knowledge:inspect', '--home', f.home, '--json']);

// `oats inspect --home` and `oats operation run --home` answer only on the
// workspace model (0.26.0), so the public pipes run on a workspace home: one
// deployment pinning the REAL oats.okf package (the git payload the release
// mirrors), built once; each test spawns its own home in it. The direct pipe
// runs the source tree's provider (CAP) against that same home.
let deployment;
after(() => { if (deployment) fs.rmSync(deployment.room, { recursive: true, force: true }); });
function workspaceDeployment() {
  if (deployment) return deployment;
  const room = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'okf-inspect-v2-')));
  deployment = { room };
  const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  const git = (dir, ...args) => sh('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args]);
  const official = join(room, 'official'); materializeOkfGitPayload(join(official, 'oats-package'), { repoRoot: ROOT });
  sh('git', ['init', '-q', official]); git(official, 'add', '-A'); git(official, 'commit', '-qm', 'okf'); git(official, 'tag', 'v2.1.3');
  const host = join(room, 'host'), hostRef = pathToFileURL(host).href;
  sh('git', ['init', '-q', host]);
  write(join(host, 'oats-workspace.yaml'), `schemaVersion: 2\nname: okf-inspect\nmembers:\n  - ${hostRef}\npackages:\n  oats.okf: v2.1.3\nteams:\n  global: { description: all }\ndefaults:\n  knowledge:\n    oats.okf: { from: package }\n`);
  write(join(host, 'oats-membership.yaml'), `schemaVersion: 2\nworkspace: ${hostRef}\n`);
  write(join(host, 'souls/source/soul.yaml'), 'schemaVersion: 2\nname: source\ndescription: source\nwork: directory\n');
  write(join(host, 'souls/source/AGENTS.md'), '# Expert\nOwn rationale and observed limitations, not code descriptions.\n');
  json(join(host, 'souls/source/okf.json'), { version: 1, owner: 'source-owner', owns: ['project/expert'], reads: [] });
  git(host, 'add', '-A'); git(host, 'commit', '-qm', 'host');
  const dep = join(room, 'dep'), accepted = join(room, 'accepted'), bindings = join(room, 'bindings.json');
  fs.mkdirSync(join(dep, 'agents'), { recursive: true });
  json(bindings, { version: 1, stateDir: join(room, 'state'), bases: { project: { id: 'fixture-base', kind: 'directory', path: accepted } } });
  write(join(dep, 'oats-local.yaml'), `schemaVersion: 2\nworkspace: ${hostRef}\nsettings:\n  oats.okf:\n    bindings-file: ${bindings}\n    harvest: "on"\n`); // okf 4.0.0: harvest (source registration) is off by default
  const catalog = join(room, 'catalog.json');
  json(catalog, { packages: { 'oats.okf': { url: pathToFileURL(official).href, ref: 'v2.1.3', path: 'oats-package' } } });
  const user = join(room, 'user'); fs.mkdirSync(user);
  const env = { HOME: user, PATH: inertHarnessPath(room), OATS_HOME_DIR: join(room, 'host-state'), LANG: 'en_US.UTF-8',
    OATS_PACKAGE_CATALOG: catalog, OATS_REMOTE_CACHE: join(room, 'cache'), OATS_TMUX_SESSION: `none-${process.pid}`,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_ALLOW_PROTOCOL: 'file' };
  const cli = args => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dep, env, encoding: 'utf8', timeout: 90000, maxBuffer: 32 * 1024 * 1024 });
    assert.equal(r.status, 0, JSON.stringify(args) + '\n' + r.stdout + r.stderr);
    const out = JSON.parse(r.stdout); assert.equal(out.ok, true, JSON.stringify(out)); return out.result;
  };
  cli(['sync', '--dir', dep, '--json']);
  const nodes = join(room, 'nodes.json'); json(nodes, { expert: { path: 'expert', owner: 'source-owner' } });
  cli(['okf', 'init', '--base', 'project', '--nodes', nodes, '--confirm', '--soul', 'source', '--json']);
  Object.assign(deployment, { dep, accepted, env, cli });
  return deployment;
}
let homes = 0;
function workspaceHome() {
  const d = workspaceDeployment();
  const source = d.cli(['spawn', 'source', '--dir', d.dep, '--purpose', `probe-${++homes}`, '--no-launch', '--json']);
  const home = source.home, meta = readJSON(join(home, 'instance.json'));
  assert.ok(meta.modules?.['oats.okf'], 'the home materialized the real oats.okf');
  const sourceFile = readJSON(join(home, '.okf-source.json')).source;
  const f = { home, source, accepted: d.accepted, cli: d.cli };
  // The source tree's provider against this home, with the payload the spawn recorded.
  f.direct = args => {
    const r = spawnSync(process.execPath, [join(CAP, 'bin/oats-okf.mjs'), ...args, '--json'], {
      cwd: d.dep, env: { ...d.env, OATS_CLI_BIN: CLI, OATS_PKG_ROOT: CAP, OATS_HOME: home, OATS_INSTANCE_HOME: home,
        OATS_SOUL: meta.soulDir, OATS_CONTEXT: d.dep, OATS_SETTINGS: JSON.stringify(meta.providers['oats.okf']) },
      encoding: 'utf8', timeout: 90000, maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(r.status, 0, args.join(' ') + '\n' + r.stdout + r.stderr);
    return { ...r, out: JSON.parse(r.stdout) };
  };
  f.inspect = () => d.cli(['okf', 'inspect', '--source', sourceFile, '--soul', 'source', '--json']);
  return f;
}
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
      OATS_OKF_CLI: '/must-not-use-installed-cli', OATS_CLI_BIN: '/must-not-use-harness-cli',
      OATS_INSTANCE_HOME: '/must-not-use-source-home', OATS_HOME: '/must-not-use-source-home',
      OATS_PACKAGE_CATALOG: '/must-not-use-host-catalog', OATS_SETTINGS: '{broken' },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
test('OKF inspect exposes matching STATE/log/notes alongside durable evidence through direct and public operation pipes', { timeout: 300_000 }, () => {
  const f = workspaceHome();
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

test('large pipe regression: three live documents over 128 KiB arrive byte-exact through both stdout pipes', { timeout: 300_000 }, () => {
  const f = workspaceHome();
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

test('inspection announces its document preview cap without splitting UTF-8', { timeout: 300_000 }, () => {
  const f = workspaceHome(), text = 'x'.repeat(256 * 1024 - 1) + 'α trailing bytes';
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
  // okf 3.0.0 has no views: refresh is removed, and nothing is materialized for the home.
  const refresh = f.raw(['okf', 'refresh', '--source', f.sourceFile, '--soul', 'source', '--json']);
  assert.equal(JSON.parse(refresh.stdout).error.code, 'E_REMOVED');
  assert.equal(fs.existsSync(join(f.home, 'knowledge-view')), false);
  assert.equal(fs.existsSync(join(dirname(f.sourceFile), 'views')), false);
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
