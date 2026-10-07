import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { v2Deployment } from './helpers/v2-deployment.mjs';
import { startInstanceSession } from '../lib/core.mjs';
import { readEvents } from '../lib/instance-events.mjs';

// Only isolated fixture deployments and a long-lived inert stub are used.
// v2Deployment supplies a private TMUX_TMPDIR and cleans its sockets by path.
function setup(t, name, options = {}) {
  const fx = v2Deployment(options);
  t.after(() => fx.cleanup());
  const executable = join(fx.base, 'stub');
  writeFileSync(executable, `#!${process.execPath}\nconsole.log('SYNTHETIC unexpected frame');\nsetInterval(() => {}, 1000);\n`);
  chmodSync(executable, 0o755);
  const home = join(fx.root, 'dev', 'instances', name);
  const configFile = join(fx.dep, 'oats-local.yaml');
  const config = YAML.parse(readFileSync(configFile, 'utf8'));
  config['launch-configs'] = { stub: { harness: 'claude', executable } };
  config.launchPromptAnswers = { homes: { [home]: { awebDevelopmentChannel: true } } };
  writeFileSync(configFile, YAML.stringify(config));
  return { fx, home, config, configFile };
}
const metadata = home => JSON.parse(readFileSync(join(home, 'instance.json'), 'utf8'));
function observingIO(onCall) {
  const calls = [];
  return { calls, exec(binary, args, options) {
    calls.push({ binary, args });
    const result = onCall?.(binary, args, options);
    return result === undefined ? execFileSync(binary, args, options) : result;
  } };
}
function assertRetained(error, home, code) {
  assert.equal(error.code, code);
  assert.equal(error.details.retained, true);
  assert.equal(error.details.home, home);
  assert.match(error.details.target.paneId, /^%\d+$/);
  assert.equal(metadata(home).launched, false);
  assert.equal(existsSync(join(home, '.oats-start-pending.json')), true);
}

test('start capture failure retains actual endpoint and sends no keys, including on repeated start', async t => {
  const { fx, home } = setup(t, 'capture-failure');
  await fx.spawn('dev', { name: 'capture-failure', launchConfig: 'stub', launch: false });
  const io = observingIO((_binary, args) => {
    if (args.includes('capture-pane')) throw Object.assign(new Error('SYNTHETIC_SECRET_CAPTURE_FAILURE'), { code: 'ETIMEDOUT' });
  });
  let error;
  await assert.rejects(fx.inEnv(() => startInstanceSession(home, { io })), e => { error = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  assertRetained(error, home, 'E_SPAWN_INCOMPLETE');
  assert.equal(error.details.launchPrompts.status, 'blocked');
  assert.ok(io.calls.some(c => c.args.includes('capture-pane')));
  assert.ok(!io.calls.some(c => c.args.includes('send-keys')));
  assert.doesNotMatch(JSON.stringify(error.details), /SYNTHETIC_SECRET/);
  const allocations = io.calls.filter(c => c.args.includes('new-window')).length;
  await assert.rejects(fx.inEnv(() => startInstanceSession(home, { io })), e => ['E_SESSION_RUNNING', 'E_SESSION_START_BUSY'].includes(e.code));
  assert.equal(io.calls.filter(c => c.args.includes('new-window')).length, allocations);
});

test('both event log writes failing retains incomplete launch without claiming an answer', async t => {
  const name = 'audit-failure';
  const { fx, home } = setup(t, name);
  await fx.spawn('dev', { name, launchConfig: 'stub', launch: false });
  const logs = [join(home, '.oats-events.jsonl'), join(fx.dep, '.agents', 'events', `dev--${name}.jsonl`)];
  for (const path of logs) { rmSync(path, { force: true }); mkdirSync(path, { recursive: true }); }
  const io = observingIO();
  let error;
  await assert.rejects(fx.inEnv(() => startInstanceSession(home, { io })), e => { error = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  assertRetained(error, home, 'E_SPAWN_INCOMPLETE');
  assert.equal(error.details.launchPrompts.status, 'incomplete');
  assert.deepEqual(error.details.launchPrompts.answers, []);
  assert.ok(error.details.launchPrompts.receipt.length > 0);
  assert.ok(error.details.launchPrompts.receipt.every(receipt => !receipt.ok && receipt.results.every(row => !row.ok)));
  assert.ok(!io.calls.some(c => c.args.includes('send-keys')));
});

test('one durable event log is sufficient and partial availability is explicit', async t => {
  const name = 'partial-audit';
  const { fx, home } = setup(t, name);
  await fx.spawn('dev', { name, launchConfig: 'stub', launch: false });
  const path = join(home, '.oats-events.jsonl');
  rmSync(path, { force: true }); mkdirSync(path);
  let error;
  await assert.rejects(fx.inEnv(() => startInstanceSession(home)), e => { error = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  assertRetained(error, home, 'E_SPAWN_INCOMPLETE');
  assert.ok(error.details.launchPrompts.receipt.some(receipt => receipt.ok && receipt.results.some(row => row.ok) && receipt.results.some(row => !row.ok)));
});

test('no-launch creates no prompt event or terminal window despite exact-home opt-in', async t => {
  const { fx, home } = setup(t, 'quiet');
  const result = await fx.spawn('dev', { name: 'quiet', launchConfig: 'stub', launch: false });
  assert.equal(result.launched, false);
  assert.equal(metadata(home).launchPromptTarget, undefined);
  assert.equal(metadata(home).launchPrompts, undefined);
  assert.equal(existsSync(join(home, '.oats-start-pending.json')), false);
  assert.deepEqual(readEvents(home).events.filter(event => event.kind === 'launch-prompt'), []);
});

test('policy refusal before dispatch preserves anchor and compensates new home', async t => {
  const name = 'predispatch-parent';
  const { fx, home, config, configFile } = setup(t, name);
  const anchor = await fx.spawn('dev', { name: 'anchor', launchConfig: 'stub', launch: false });
  const anchorFile = join(anchor.home, 'instance.json');
  const before = readFileSync(anchorFile, 'utf8');
  const wrapperDir = join(fx.base, 'tmux-wrapper');
  mkdirSync(wrapperDir);
  const actualTmux = execFileSync('/usr/bin/which', ['tmux'], { encoding: 'utf8' }).trim();
  const marker = join(fx.base, 'policy-invalidated');
  const allocations = join(fx.base, 'unexpected-launch');
  const invalid = { ...config, launchPromptAnswers: { homes: { [home]: { awebDevelopmentChannel: 'true' } } } };
  writeFileSync(join(wrapperDir, 'tmux'), `#!${process.execPath}\nimport { execFileSync } from 'node:child_process';\nimport { existsSync, writeFileSync } from 'node:fs';\nconst args = process.argv.slice(2);\nif (args.includes('list-windows') && existsSync(${JSON.stringify(home)})) { writeFileSync(${JSON.stringify(configFile)}, ${JSON.stringify(YAML.stringify(invalid))}); writeFileSync(${JSON.stringify(marker)}, 'invalid'); }\nif (args.includes('new-window')) writeFileSync(${JSON.stringify(allocations)}, 'unexpected');\ntry { process.stdout.write(execFileSync(${JSON.stringify(actualTmux)}, args, {encoding:'utf8', timeout:3000, stdio:['ignore','pipe','pipe']})); } catch(e) { process.stderr.write(String(e.stderr ?? '')); process.exit(e.status ?? 1); }\n`);
  chmodSync(join(wrapperDir, 'tmux'), 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}:${previousPath}`;
  try {
    await assert.rejects(fx.spawn('dev', { name, launchConfig: 'stub', launch: true, relativeTo: anchor.instance, relation: 'parent' }), e => e.code === 'E_WORKSPACE_SCHEMA');
  } finally { process.env.PATH = previousPath; }
  assert.equal(existsSync(marker), true);
  assert.equal(existsSync(allocations), false);
  assert.equal(readFileSync(anchorFile, 'utf8'), before);
  assert.equal(existsSync(home), false);
});

test('default-off launch failure preserves a concurrent anchor edit and compensates window and scaffold', async t => {
  const name = 'changed-anchor';
  const { fx, home, config, configFile } = setup(t, name);
  config.launchPromptAnswers.homes[home].awebDevelopmentChannel = false;
  writeFileSync(configFile, YAML.stringify(config));
  const anchor = await fx.spawn('dev', { name: 'anchor', launchConfig: 'stub', launch: false });
  const anchorFile = join(anchor.home, 'instance.json');
  const wrapperDir = join(fx.base, 'tmux-wrapper'); mkdirSync(wrapperDir);
  const actualTmux = execFileSync('/usr/bin/which', ['tmux'], { encoding: 'utf8' }).trim();
  const marker = join(fx.base, 'allocated-target');
  writeFileSync(join(wrapperDir, 'tmux'), `#!${process.execPath}
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('set-option') && existsSync(${JSON.stringify(marker)})) process.exit(1);
try {
  const out = execFileSync(${JSON.stringify(actualTmux)}, args, {encoding:'utf8', timeout:3000, stdio:['ignore','pipe','pipe']});
  if (args.includes('new-window')) {
    const anchor = JSON.parse(readFileSync(${JSON.stringify(anchorFile)}, 'utf8'));
    anchor.concurrentNote = 'preserve this edit';
    writeFileSync(${JSON.stringify(anchorFile)}, JSON.stringify(anchor));
    writeFileSync(${JSON.stringify(marker)}, JSON.stringify({socket:args[args.indexOf('-S')+1],windowId:out.trim()}));
  }
  process.stdout.write(out);
} catch(e) { process.stderr.write(String(e.stderr ?? '')); process.exit(e.status ?? 1); }
`);
  chmodSync(join(wrapperDir, 'tmux'), 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}:${previousPath}`;
  let failure;
  try {
    await assert.rejects(fx.spawn('dev', { name, launchConfig: 'stub', launch: true, relativeTo: anchor.instance, relation: 'parent' }), e => { failure = e; return e.code === 'E_SPAWN_LAUNCH_FAILED'; });
  } finally { process.env.PATH = previousPath; }
  assert.equal(failure.details?.unconfirmed, undefined, 'off-case launch never committed parent lineage');
  assert.doesNotMatch(failure.message, /parent lineage could not be restored/);
  assert.equal(metadata(anchor.home).concurrentNote, 'preserve this edit');
  assert.equal(existsSync(home), false, 'scaffold compensation still runs');
  const allocated = JSON.parse(readFileSync(marker, 'utf8'));
  const remaining = execFileSync(actualTmux, ['-u', '-S', allocated.socket, 'list-windows', '-a', '-F', '#{window_id}'], {encoding:'utf8'}).trim().split('\n');
  assert.ok(!remaining.includes(allocated.windowId), 'allocated window was removed');
});


for (const concurrentEdit of [false, true]) test(`opted-in predispatch failure ${concurrentEdit ? 'reports refused anchor restoration' : 'restores parent lineage'} and still compensates scaffold`, async t => {
  const name = 'predispatch-concurrent';
  const { fx, home } = setup(t, name);
  const anchor = await fx.spawn('dev', { name: 'anchor', launchConfig: 'stub', launch: false });
  const anchorFile = join(anchor.home, 'instance.json');
  const before = readFileSync(anchorFile, 'utf8');
  const original = fs.lstatSync;
  let injected = false;
  // Fail the controller's home-identity read AFTER the consented parent write,
  // before any new-window dispatch. Model a concurrent anchor writer at that
  // boundary; cleanup must report that its restore cannot overwrite the edit.
  const mock = t.mock.method(fs, 'lstatSync', (path, ...rest) => {
    if (!injected && path === home && metadata(anchor.home).parentInstance === name) {
      injected = true;
      if (concurrentEdit) {
        const concurrent = metadata(anchor.home);
        concurrent.concurrentNote = 'preserve this edit';
        writeFileSync(anchorFile, JSON.stringify(concurrent));
      }
      throw new Error('forced controller home-identity failure');
    }
    return original(path, ...rest);
  });
  syncBuiltinESMExports();
  let failure;
  try {
    await assert.rejects(fx.spawn('dev', { name, launchConfig: 'stub', launch: true, relativeTo: anchor.instance, relation: 'parent' }), e => {
      failure = e;
      return /forced controller home-identity failure/.test(e.message);
    });
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(injected, true);
  if (concurrentEdit) {
    assert.equal(failure.details.unconfirmed, true);
    assert.match(failure.message, /parent lineage could not be restored/);
    assert.equal(metadata(anchor.home).concurrentNote, 'preserve this edit');
  } else {
    assert.equal(failure.details?.unconfirmed, undefined);
    assert.equal(readFileSync(anchorFile, 'utf8'), before);
  }
  assert.equal(existsSync(home), false, 'independent scaffold compensation still runs');
});


for (const enabled of [false, true]) for (const mutation of ['edit', 'remove']) test(`spawn hook ${mutation} of the anchor is preserved and compensated (prompt opt-in ${enabled})`, async t => {
  const name = 'hook-anchor';
  const hook = `
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
if (process.env.OATS_INSTANCE === '${name}') {
  const root = process.env.OATS_ROOT;
  if (process.env.OATS_EVENT === 'spawn') {
    const file = join(root, 'dev', 'instances', 'anchor', 'instance.json');
    if ('${mutation}' === 'remove') unlinkSync(file);
    else { const data = JSON.parse(readFileSync(file, 'utf8')); data.concurrentNote = 'hook edit'; writeFileSync(file, JSON.stringify(data)); }
  } else if (process.env.OATS_EVENT === 'retire') writeFileSync(join(root, 'compensated'), 'yes');
}
`;
  const { fx, home, config, configFile } = setup(t, name, {
    souls: { dev: { soul: { capabilities: { 'test.anchor': { from: 'here' } } } } },
    capabilities: { 'test.anchor': { manifest: { hooks: { spawn: 'hook.mjs', retire: 'hook.mjs' } }, files: { 'hook.mjs': hook } } },
  });
  config.launchPromptAnswers.homes[home].awebDevelopmentChannel = enabled;
  writeFileSync(configFile, YAML.stringify(config));
  const anchor = await fx.spawn('dev', { name: 'anchor', launchConfig: 'stub', launch: false });
  await assert.rejects(fx.spawn('dev', { name, launchConfig: 'stub', launch: true, relativeTo: anchor.instance, relation: 'parent' }), /failed to re-point anchor.*rolled back/s);
  assert.equal(existsSync(home), false);
  assert.equal(readFileSync(join(fx.root, 'compensated'), 'utf8'), 'yes', 'hook effects are compensated');
  if (mutation === 'edit') {
    assert.equal(metadata(anchor.home).concurrentNote, 'hook edit');
    assert.equal(metadata(anchor.home).parentInstance, undefined);
  } else assert.equal(existsSync(join(anchor.home, 'instance.json')), false, 'removed anchor metadata is never resurrected');
});
