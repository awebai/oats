import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareCapturedComposition, scaffoldCapturedInstance, activateCapturedScaffold, startCapturedInstanceSession } from '../lib/core.mjs';
import { readCapturedInstanceAuthority, readCapturedInstanceIndex } from '../lib/captured-instance-index.mjs';

const CLI = fileURLToPath(new URL('../bin/oats.mjs', import.meta.url));
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oats-home-custody-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), deployment = join(root, 'deployment'), home = join(root, 'home'), user = join(root, 'operator'), bin = join(root, 'bin');
  for (const p of [repo, deployment, user, bin]) mkdirSync(p);
  const write = (p, value, opts) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value), opts); };
  const config = join(user, 'gitconfig'); write(config, '[commit]\n  gpgsign = false\n');
  const env = { PATH: bin + ':' + process.env.PATH, HOME: user, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file', SHELL: '/usr/bin/true' };
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet', '--initial-branch=fixture'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'uploadpack.allowFilter', 'true'); git('config', 'uploadpack.allowAnySHA1InWant', 'true');
  const source = 'git:https://home-custody.invalid/source.git'; git('config', '--file', config, `url.${pathToFileURL(repo).href}.insteadOf`, source.slice(4));
  write(join(repo, 'oats.yaml'), { schemaVersion: 1, exports: { souls: [{ path: 'souls/example', definition: 'souls/example/soul.yaml' }] } });
  write(join(repo, 'souls/example/soul.yaml'), { schemaVersion: 1, name: 'example', work: 'directory' });
  write(join(repo, 'souls/example/AGENTS.md'), '# Inert custody fixture\n'); symlinkSync('AGENTS.md', join(repo, 'souls/example/CLAUDE.md'));
  git('add', '.'); git('commit', '--quiet', '-m', 'public home-only custody fixture');
  const harness = join(bin, 'fixture-runtime'), tmux = join(bin, 'tmux'), effects = join(root, 'effects.jsonl'), replaceOnInspect = join(root, 'replace-on-inspect');
  write(harness, '#!/bin/sh\nexit 98\n', { mode: 0o700 }); // Never executed: no real native-start witness/model claim.
  write(tmux, `#!${process.execPath}
const fs=require('node:fs'),a=process.argv.slice(2),home=${JSON.stringify(home)},flag=${JSON.stringify(replaceOnInspect)},log=${JSON.stringify(effects)};
fs.appendFileSync(log,JSON.stringify({args:a})+'\\n');
if(a.includes('list-panes')){
  if(fs.existsSync(flag)){fs.unlinkSync(flag);fs.renameSync(home,home+'-original');fs.cpSync(home+'-original',home,{recursive:true});}
  console.log('%9\\t0\\tfixture-interactive\\t99999');
}else if(a.includes('load-buffer'))fs.appendFileSync(log,JSON.stringify({stdin:fs.readFileSync(0,'utf8')})+'\\n');
else if(!['paste-buffer','send-keys','delete-buffer'].some(c=>a.includes(c)))throw Error('unexpected inert command');
`, { mode: 0o700 });
  const prepared = prepareCapturedComposition({ deployment, source: { source, revision: git('rev-parse', 'HEAD'), soul: 'souls/example', alias: 'example' }, standaloneContextKey: null,
    launch: { runtime: 'claude', executable: harness, args: [], env: {}, model: 'fixture-model', yolo: false } }, { repositoryOptions: { environment: env, allowLocalGit: true } });
  scaffoldCapturedInstance({ deployment, resolution: prepared.resolution, home, instance: 'home' });
  activateCapturedScaffold({ deployment, resolution: prepared.resolution, home });
  startCapturedInstanceSession(home, { deployment, resolution: prepared.resolution, backend: { backend: 'tmux', binary: tmux, socket: join(root, 'inert.sock'), session: 'fixture' }, task: 'inert fixture', env,
    io: { exec(binary, args) { assert.equal(binary, tmux); if (args.includes('list-panes')) throw Object.assign(new Error("can't find window"), { stderr: "can't find window" }); return ''; }, kill() { assert.fail('no process stop permitted'); } } });
  const run = (op, selectedHome = home) => {
    const child = spawnSync(process.execPath, [CLI, 'session', op, '--home', selectedHome, '--json'], { cwd: user, env, input: op === 'input' ? 'Fetch pending notifications.' : undefined, encoding: 'utf8', timeout: 10000 });
    assert.equal(child.error, undefined); return { status: child.status, ...JSON.parse(child.stdout) };
  };
  const calls = () => existsSync(effects) ? readFileSync(effects, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  return { root, home, deployment, run, calls, write, replaceOnInspect };
}

test('home-only CLI preserves original input and endpoint checks but refuses replaced captured custody before transport', t => {
  const f = fixture(t), before = JSON.stringify(readCapturedInstanceIndex(f.deployment));
  assert.equal(f.run('inspect').result.present, true);
  assert.equal(f.run('input').result.submitted, true);
  assert.equal(JSON.stringify(readCapturedInstanceIndex(f.deployment)), before, 'no new admission/schema is introduced');
  const alias = join(f.root, 'alias'); symlinkSync(f.home, alias, 'dir');
  const aliasCount = f.calls().length;
  assert.equal(f.run('input', alias).status, 1, 'resolving a symlink must not hide nonphysical captured home custody');
  assert.equal(f.calls().length, aliasCount);
  const file = join(f.home, 'instance.json'), bytes = readFileSync(file, 'utf8'), meta = JSON.parse(bytes);
  meta.tmux.window = 'foreign-window'; f.write(file, meta);
  let count = f.calls().length;
  assert.equal(f.run('input').error.code, 'E_RUNTIME_AUTHORITY_MISMATCH'); assert.equal(f.calls().length, count);
  f.write(file, bytes);
  renameSync(f.home, f.home + '-original'); cpSync(f.home + '-original', f.home, { recursive: true });
  assert.throws(() => readCapturedInstanceAuthority(f.deployment, f.home), { code: 'integrity-drift' });
  for (const op of ['inspect', 'input']) {
    const result = f.run(op);
    assert.equal(result.status, 1); assert.equal(result.error.code, 'integrity-drift');
    assert.equal(f.calls().length, count, 'no terminal transport after custody rejection');
  }
  // Erasing mutable home markers cannot turn an independently captured receipt into legacy authority.
  const copy = JSON.parse(bytes); delete copy.executionBinding; delete copy.incarnationId; delete copy.captured; f.write(file, copy);
  assert.equal(f.run('input').status, 1); assert.equal(f.calls().length, count);
});

test('home-only captured input revalidates custody between terminal inspection and payload transport', t => {
  const f = fixture(t); f.write(f.replaceOnInspect, 'replace only this owned fixture during terminal observation');
  const result = f.run('input');
  assert.equal(result.status, 1); assert.match(result.error.message, /captured home\/work/);
  assert.deepEqual(f.calls().map(c => c.args?.[3]), ['list-panes'], 'no load/paste/Enter/cleanup transport on replaced custody');
});
