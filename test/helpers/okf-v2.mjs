// Public-CLI OKF v2 fixtures. No kernel-private imports, global config, harness
// sessions, host schedulers, GitHub access, or inherited agent identity.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { linkExecutables } from './host-fixture.mjs';
import YAML from 'yaml';
import { git as gitIn, v2Deployment } from './v2-deployment.mjs';
import { materializeOkfGitPayload } from '../../scripts/check-okf-mirror.mjs';
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// These are local integration tests, never ambient installed-capability tests.
// Packed-kernel execution has its own clean-room driver and public API boundary.
export const CLI = resolve(ROOT, 'bin/oats.mjs');
export const CAP = resolve(ROOT, 'capabilities/oats-okf');
export const write = (p, text) => { fs.mkdirSync(dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
export const json = (p, value) => write(p, JSON.stringify(value, null, 2) + '\n');
export const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));

/** The REAL oats.okf package (the verified mirror: its capabilities, package souls and
 *  trigger) as a tagged Git repository, and the catalog file that names it. */
function okfPackage(base) {
  const repo = join(base, 'oats-okf');
  const inventory = materializeOkfGitPayload(join(repo, 'oats-package'));
  gitIn(repo, 'init', '-q', '-b', 'main');
  gitIn(repo, 'add', '.'); gitIn(repo, 'commit', '-qm', `oats.okf ${inventory.version}`);
  const tag = `v${inventory.version}`;
  gitIn(repo, 'tag', tag);
  const catalog = join(base, 'okf-catalog.json');
  json(catalog, { packages: { 'oats.okf': { url: repo, ref: tag, path: 'oats-package' } } });
  return { repo, tag, catalog };
}

/**
 * A workspace-model deployment (test/helpers/v2-deployment.mjs) that locks the
 * REAL oats.okf package (okf 4.0.0: oats.okf, oats.okf-harvest, oats.okf-maintenance
 * and the package souls, the harvester among them) through a file catalog, binds
 * oats.okf to the knowledge slot by the workspace defaults, and has a `source`
 * soul. Host settings (bindings-file, harvest, harvest-*) are the deployment's
 * oats-local.yaml `settings:`; harvest is on unless `settings.harvest` says off.
 * `f.context` is the deployment; every CLI call runs there, hermetically.
 */
export function fixture(t, { git = false, settings = {}, register = true } = {}) {
  const fx = v2Deployment({
    name: 'okf-fixture',
    souls: { source: { soul: { work: 'directory' }, agents: '# Expert\nOwn rationale and observed limitations, not code descriptions.\n' } },
    files: { 'souls/source/okf.json': { json: { version: 1, owner: 'source-owner', owns: ['project/expert'], reads: ['project/peer'] } } },
  });
  t.after(() => fx.cleanup());
  const base = fx.base, context = fx.dep, bin = join(base, 'bin'), user = join(base, 'user');
  fs.mkdirSync(user);
  linkExecutables(bin, ['node', 'git']);
  for (const harness of ['pi', 'claude', 'codex']) {
    write(join(bin, harness), '#!/bin/sh\necho NO_MODEL_SESSIONS_IN_FIXTURES >&2\nexit 98\n');
    fs.chmodSync(join(bin, harness), 0o755);
  }
  const env = { HOME: user, PATH: bin, OATS_HOME_DIR: join(base, 'host'), LANG: 'en_US.UTF-8',
    OATS_REMOTE_CACHE: fx.env.OATS_REMOTE_CACHE, OATS_PACKAGE_CATALOG: '', OATS_TMUX_SESSION: `none-${process.pid}`, PI_AGENTS_TMUX_SESSION: `none-${process.pid}`,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_ALLOW_PROTOCOL: 'file',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const cap = CAP;
  // The soul copy spawns incarnate (ensureWorkspaceSoul refreshes it from the member).
  const soul = join(context, 'agents/source/soul');
  // The knowledge slot: the locked oats.okf package, for every soul (workspace default).
  const okf = okfPackage(base);
  env.OATS_PACKAGE_CATALOG = okf.catalog;
  const wsFile = join(fx.member, 'oats-workspace.yaml');
  const wsDoc = YAML.parse(fs.readFileSync(wsFile, 'utf8'));
  wsDoc.packages = { ...(wsDoc.packages || {}), 'oats.okf': okf.tag };
  wsDoc.teams = { ...(wsDoc.teams || {}), okf: { description: 'Knowledge operations' } };
  wsDoc.defaults = { ...(wsDoc.defaults || {}), knowledge: { 'oats.okf': { from: 'package' } } };
  fx.commit({ 'oats-workspace.yaml': { yaml: wsDoc } }, 'lock oats.okf; bind the knowledge slot to it');
  const bindings = join(base, 'bindings.json'), accepted = join(base, 'accepted');
  json(bindings, { version: 1, stateDir: join(base, 'state'), bases: {
    project: git ? { id: 'fixture-base', kind: 'git', repository: accepted, root: 'knowledge', acceptedBranch: 'main', pr: { repository: 'fixture/knowledge' } }
      : { id: 'fixture-base', kind: 'directory', path: accepted },
  } });
  const configSettings = { 'bindings-file': bindings, harvest: 'on', ...settings };
  const localFile = join(context, 'oats-local.yaml');
  const local = YAML.parse(fs.readFileSync(localFile, 'utf8'));
  write(localFile, YAML.stringify({ ...local, settings: { 'oats.okf': configSettings } }, { lineWidth: 0 }));
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
  cli(['sync', '--json']);
  if (git) {
    gitRun('init', '-q', '-b', 'main', accepted);
    const seed = join(base, 'seed-knowledge');
    cli(['okf', 'init', '--base', 'project', '--nodes', nodes, '--output', seed, '--soul', 'source', '--json']);
    fs.cpSync(seed, join(accepted, 'knowledge'), { recursive: true });
    write(join(accepted, 'code.txt'), 'untouched code\n');
    gitRun('-C', accepted, 'add', '.'); gitRun('-C', accepted, 'commit', '-qm', 'accepted baseline');
  } else cli(['okf', 'init', '--base', 'project', '--nodes', nodes, '--confirm', '--soul', 'source', '--json']);
  const f = { base, context, bin, user, env, cap, soul, bindings, accepted, cli, raw, git: gitRun, fx, localFile, configSettings, okf };
  /** okf 3.0.0: a home has no ./knowledge/ view; it consults the accepted state (`oats okf cat`). null when absent. */
  f.consult = (home, path, { fresh = false } = {}) => {
    const r = raw(['okf', 'cat', '--base', 'project', path, ...(fresh ? ['--fresh'] : []), '--json'], { cwd: home, environment: { ...env, OATS_INSTANCE_HOME: home } }), out = JSON.parse(r.stdout);
    assert.equal(fs.existsSync(join(home, 'knowledge')), false, 'okf 3.0.0 materializes no ./knowledge/ in a home');
    return out.ok ? out.result.text : null;
  };
  f.spawn = (purpose = 'probe') => cli(['spawn', 'source', '--purpose', purpose, '--repo', context, '--work', 'directory', '--harness', 'pi', '--no-launch', '--json']);
  if (register) {
    f.source = f.spawn(); f.home = f.source.home;
    f.marker = readJSON(join(f.home, '.okf-source.json'));
    f.soulDir = readJSON(join(f.home, 'instance.json')).soulDir;
    f.sourceFile = f.marker.source;
  }
  f.direct = (args, { environment = {}, status = 0 } = {}) => {
    const r = spawnSync(process.execPath, [join(cap, 'bin/oats-okf.mjs'), ...args, '--json'], {
      cwd: context, env: { ...env, OATS_CLI_BIN: CLI, OATS_PKG_ROOT: cap, OATS_HOME: f.home,
        OATS_INSTANCE_HOME: f.home, OATS_SOUL: f.soulDir ?? soul, OATS_CONTEXT: context,
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
    json(file, { version: 1, exclusionsReviewed: true, outcomes: evidence.inputs.map(i => ({ input: i.id, verdict: drop ? 'drop' : 'promote', reason: drop ? 'Task residue.' : 'Accepted rationale.', concepts: drop ? [] : [{ base: 'project', path: 'expert/decision.md' }],
      // okf 4.0.0: a promotion from a transcript (record) input cites the turn ids it relied on.
      ...(i.kind === 'record' && !drop ? { turns: i.turns.map(turn => turn.id) } : {}) })) });
    return file;
  };
  f.complete = (run, judgment = f.judgment(run)) => cli(['okf', 'complete', '--source', f.sourceFile, '--run', run.run, '--judgment', judgment, '--soul', 'source', '--json']);
  return f;
}
