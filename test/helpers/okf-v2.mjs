// Public-CLI OKF v2 fixtures. No kernel-private imports, global config, runtime
// sessions, host schedulers, GitHub access, or inherited agent identity.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linkExecutables } from './host-fixture.mjs';
import { materializeOkfGitPayload, checkOkfPayload } from '../../scripts/check-okf-mirror.mjs';
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// These are local integration tests, never ambient installed-capability tests.
// Packed-kernel execution has its own clean-room driver and public API boundary.
export const CLI = resolve(ROOT, 'bin/oats.mjs');
export const CAP = resolve(ROOT, 'capabilities/oats-okf');
export const write = (p, text) => { fs.mkdirSync(dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
export const json = (p, value) => write(p, JSON.stringify(value, null, 2) + '\n');
export const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));

export function fixture(t, { git = false, installed = false, settings = {}, register = true } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "okf-v2-fixture-")));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const context = join(base, 'context'), bin = join(base, 'bin'), user = join(base, 'user');
  fs.mkdirSync(context); fs.mkdirSync(user);
  linkExecutables(bin, ['node', ...(git || installed ? ['git'] : [])]);
  for (const runtime of ['pi', 'claude', 'codex']) {
    write(join(bin, runtime), '#!/bin/sh\necho NO_MODEL_SESSIONS_IN_FIXTURES >&2\nexit 98\n');
    fs.chmodSync(join(bin, runtime), 0o755);
  }
  const env = { HOME: user, PATH: bin, OATS_HOME_DIR: join(base, 'host'), LANG: 'en_US.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const packageSource = join(base, 'package-source');
  const cap = join(context, installed ? '.agents/capabilities/installed/oats.okf' : '.agents/capabilities/owned/oats-okf');
  if (!installed) fs.cpSync(CAP, cap, { recursive: true, verbatimSymlinks: true });
  const bindings = join(base, 'bindings.json'), accepted = join(base, 'accepted');
  json(bindings, { version: 1, stateDir: join(base, 'state'), bases: {
    project: git ? { id: 'fixture-base', kind: 'git', repository: accepted, root: 'knowledge', acceptedBranch: 'main', pr: { repository: 'fixture/knowledge' } }
      : { id: 'fixture-base', kind: 'directory', path: accepted },
  } });
  const configSettings = { 'bindings-file': bindings, ...settings };
  write(join(context, 'oats-config.yaml'), `name: okf-fixture\ncapabilities:\n  layers:\n    knowledge:\n      capability: oats.okf\n      from: ${installed ? 'installed' : 'owned'}\n      global:\n        enabled: true\n        settings:\n${Object.entries(configSettings).map(([k,v]) => `          ${k}: ${JSON.stringify(v)}\n`).join('')}    messaging: none\n    tasks: none\n`);
  const soul = join(context, 'agents/source/soul');
  write(join(soul, 'soul.yaml'), 'name: source\nwork: directory\nruntime: pi\n');
  write(join(soul, 'AGENTS.md'), '# Expert\nOwn rationale and observed limitations, not code descriptions.\n');
  fs.symlinkSync('AGENTS.md', join(soul, 'CLAUDE.md'));
  json(join(soul, 'okf.json'), { version: 1, owner: 'source-owner', owns: ['project/expert'], reads: ['project/peer'] });
  const nodes = join(base, 'nodes.json');
  json(nodes, { expert: { path: 'expert', owner: 'source-owner' }, peer: { path: 'peer', owner: 'peer-owner' } });
  const raw = (args, { cwd = context, environment = env } = {}) => spawnSync(process.execPath, [CLI, ...args], { cwd, env: environment, encoding: 'utf8', timeout: 90000, maxBuffer: 32 * 1024 * 1024 });
  const cli = (args, opts) => {
    const r = raw(args, opts); assert.equal(r.status, 0, JSON.stringify(args) + '\n' + r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    if (args[0] === 'retire') return out;
    assert.equal(out.ok, true, JSON.stringify(out)); return out.result;
  };
  const gitRun = (...args) => {
    const r = spawnSync(join(bin, 'git'), args, { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  if (installed) {
    const inventory = materializeOkfGitPayload(join(packageSource, 'oats-package'), { repoRoot: ROOT });
    const alias = 'oats-package/capabilities/oats-okf/agents/memory-harvest/CLAUDE.md';
    assert.equal(fs.readlinkSync(join(packageSource, alias)), 'AGENTS.md');
    gitRun('init', '-q', '-b', 'main', packageSource);
    gitRun('-C', packageSource, 'add', '.'); gitRun('-C', packageSource, 'commit', '-qm', 'fixture package');
    const commit = gitRun('-C', packageSource, 'rev-parse', 'HEAD');
    assert.match(gitRun('-C', packageSource, 'ls-tree', commit, '--', alias), /^120000 blob /);
    const catalog = join(base, 'catalog.json');
    json(catalog, { packages: { 'oats.okf': { url: pathToFileURL(packageSource).href, ref: commit, path: 'oats-package' } } });
    env.OATS_PACKAGE_CATALOG = catalog;
    env.GIT_ALLOW_PROTOCOL = 'file';
    const acquired = raw(['install', 'oats.okf', '--dir', context]);
    assert.equal(acquired.status, 0, acquired.stdout + acquired.stderr);
    // The installer adds only its own receipt; source runtime bytes and alias
    // must otherwise remain identical. Verify those separately in a plain copy.
    const installedCopy = join(base, 'installed-payload-check');
    fs.cpSync(cap, installedCopy, { recursive: true, verbatimSymlinks: true });
    fs.rmSync(join(installedCopy, '.oats-installation.json'));
    checkOkfPayload(installedCopy, inventory);
    const trusted = raw(['trust', 'oats.okf', '--dir', context]);
    assert.equal(trusted.status, 0, trusted.stdout + trusted.stderr);
    fs.rmSync(packageSource, { recursive: true });
    fs.rmSync(installedCopy, { recursive: true });
  }
  if (git) {
    gitRun('init', '-q', '-b', 'main', accepted);
    const seed = join(base, 'seed');
    cli(['okf', 'init', '--base', 'project', '--nodes', nodes, '--output', seed, '--soul', 'source', '--json']);
    fs.cpSync(seed, join(accepted, 'knowledge'), { recursive: true });
    write(join(accepted, 'code.txt'), 'untouched code\n');
    gitRun('-C', accepted, 'add', '.'); gitRun('-C', accepted, 'commit', '-qm', 'accepted baseline');
  } else cli(['okf', 'init', '--base', 'project', '--nodes', nodes, '--confirm', '--soul', 'source', '--json']);
  const f = { base, context, bin, user, env, cap, soul, bindings, accepted, cli, raw, git: gitRun };
  f.spawn = (purpose = 'probe') => cli(['spawn', 'source', '--purpose', purpose, '--repo', context, '--work', 'directory', '--runtime', 'pi', '--no-launch', '--json']);
  if (register) {
    f.source = f.spawn(); f.home = f.source.home;
    f.marker = readJSON(join(f.home, '.okf-source.json'));
    f.sourceFile = f.marker.source;
  }
  f.direct = (args, { environment = {}, status = 0 } = {}) => {
    const r = spawnSync(process.execPath, [join(cap, 'bin/oats-okf.mjs'), ...args, '--json'], {
      cwd: context, env: { ...env, OATS_CLI_BIN: CLI, OATS_PKG_ROOT: cap, OATS_HOME: f.home,
        OATS_INSTANCE_HOME: f.home, OATS_SOUL: soul, OATS_CONTEXT: context,
        OATS_SETTINGS: JSON.stringify(configSettings), ...environment },
      encoding: 'utf8', timeout: 90000, maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(r.status, status, args.join(' ') + '\n' + r.stdout + r.stderr);
    return { ...r, out: JSON.parse(r.stdout) };
  };
  f.inspect = () => cli(['okf', 'inspect', '--source', f.sourceFile, '--soul', 'source', '--json']);
  f.run = () => cli(['okf', 'run-source', '--source', f.sourceFile, '--manual', '--no-launch', '--soul', 'source', '--json']);
  f.retire = instance => cli(['retire', instance, '--json']);
  f.inputs = () => f.inspect().status.captured.inputs.map(id => ({ id, ...readJSON(join(dirname(f.sourceFile), 'inputs', id + '.json')) }));
  f.judgment = (run, { drop = false } = {}) => {
    const work = join(run.home, 'work'), evidence = readJSON(join(work, 'input.json'));
    if (!drop) {
      const stage = readJSON(join(work, 'staging.json')).project.root;
      write(join(stage, 'expert/decision.md'), `---\ntype: Decision\ntitle: Explicit custody\ndescription: Why custody is explicit.\n---\n\nExplicit custody avoids silent fallback.\n${evidence.inputs.map(i => `Evidence: OKF input ${i.id}.`).join('\n')}\n`);
      fs.appendFileSync(join(stage, 'expert/index.md'), '* [Explicit custody](decision.md) - Why custody is explicit.\n');
      fs.appendFileSync(join(stage, 'expert/log.md'), '* Creation: explicit custody.\n');
    }
    const file = join(work, 'judgment.json');
    json(file, { version: 1, exclusionsReviewed: true, outcomes: evidence.inputs.map(i => ({ input: i.id, verdict: drop ? 'drop' : 'promote', reason: drop ? 'Task residue.' : 'Accepted rationale.', concepts: drop ? [] : [{ base: 'project', path: 'expert/decision.md' }] })) });
    return file;
  };
  f.complete = (run, judgment = f.judgment(run)) => cli(['okf', 'complete', '--source', f.sourceFile, '--run', run.run, '--judgment', judgment, '--soul', 'source', '--json']);
  return f;
}
