import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { v2Deployment } from './helpers/v2-deployment.mjs';
import { startInstanceSession, restartInstanceSession, inspectInstanceSession, stopInstanceSession, retireInstance } from '../lib/core.mjs';
import { waitUntil } from './helpers/host-fixture.mjs';
import { readEvents } from '../lib/instance-events.mjs';

// v2Deployment installs a private TMUX_TMPDIR and inert harness PATH. The only
// launched program here is this stub; no real harness or default server is used.
function fixture(t) {
  const fx = v2Deployment();
  t.after(() => fx.cleanup());
  const executable = join(fx.base, 'launch-stub');
  writeFileSync(executable, `#!${process.execPath}\nconsole.log('Unexpected stub question: secret text must not enter receipts');\nsetInterval(() => {}, 1000);\n`);
  chmodSync(executable, 0o755);
  const local = YAML.parse(readFileSync(join(fx.dep, 'oats-local.yaml'), 'utf8'));
  local['launch-configs'] = { stub: { harness: 'claude', executable } };
  const configure = (name, enabled = true) => {
    const home = join(fx.root, 'dev', 'instances', name);
    local.launchPromptAnswers = { homes: { [home]: { awebDevelopmentChannel: enabled } } };
    writeFileSync(join(fx.dep, 'oats-local.yaml'), YAML.stringify(local));
    return home;
  };
  return { fx, configure };
}
const meta = home => JSON.parse(readFileSync(join(home, 'instance.json'), 'utf8'));

test('preview/no-launch have no capture or prompt effects; opted-in spawn retains lineage and refuses cached replay', async t => {
  const {fx, configure} = fixture(t);
  const anchor = await fx.spawn('dev', { name: 'dev-anchor', harness: 'claude' });
  const home = configure('dev-blocked');
  const args = {name: 'dev-blocked', launchConfig: 'stub', launch: true, relativeTo: anchor.instance, relation: 'parent'};
  const preview = await fx.spawn('dev', {...args, preview: true});
  assert.equal(preview.launchPromptAnswers.awebDevelopmentChannel, true);
  assert.equal(existsSync(home), false);
  const apply = {...args, expectDecision: preview.decision.revision, idempotencyKey: 'blocked-test'};
  let failure;
  await assert.rejects(fx.spawn('dev', apply), e => { failure = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  assert.equal(failure.details.retained, true);
  assert.equal(failure.details.parentLineageCommitted, true);
  assert.equal(meta(anchor.home).parentInstance, 'dev-blocked');
  assert.equal(meta(home).launched, false);
  const retainedState = await fx.inEnv(() => inspectInstanceSession(home));
  assert.equal(retainedState.present, true);
  assert.equal(retainedState.paneId, failure.details.target.paneId);
  assert.equal(meta(home).spawnCompleted, false);
  assert.match(failure.details.target.paneId, /^%\d+$/);
  assert.ok(failure.details.launchPrompts.receipt.some(r => r.results.some(p => p.ok && p.path)));
  const events = readEvents(home).events.filter(e => e.kind === 'launch-prompt');
  assert.ok(events.length);
  assert.doesNotMatch(JSON.stringify(events), /secret text/);
  await assert.rejects(fx.spawn('dev', apply), e => e.code === 'E_SPAWN_INCOMPLETE' && e.details.retained);
  await assert.rejects(fx.inEnv(() => startInstanceSession(home)), e => ['E_SESSION_RUNNING', 'E_SESSION_START_BUSY'].includes(e.code));
  const quiet = configure('dev-no-launch');
  await fx.spawn('dev', {name: 'dev-no-launch', launchConfig:'stub', launch:false});
  assert.equal(meta(quiet).launched, false);
  assert.equal(readEvents(quiet).events.filter(e => e.kind === 'launch-prompt').length, 0);
  const legacy = meta(quiet); delete legacy.launch;
  writeFileSync(join(quiet, 'instance.json'), JSON.stringify(legacy));
  const legacyPreview = fx.cli(['launch-config', 'preview', '--home', quiet, '--json']).json();
  assert.equal(legacyPreview.ok, true);
  assert.equal(legacyPreview.result.launchPromptAnswers.awebDevelopmentChannel, true);
  assert.ok(legacyPreview.result.warnings.some(w => w.includes('harness update')));
});

test('new start and respawn retain unknown prompt; removal of host opt-in disables next authority', async t => {
  const {fx, configure} = fixture(t);
  const home = configure('dev-start');
  await fx.spawn('dev', {name:'dev-start', launchConfig:'stub', launch:false});
  let first;
  await assert.rejects(fx.inEnv(() => startInstanceSession(home)), e => { first = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  assert.equal(first.details.retained, true);
  assert.equal(meta(home).launched, false);
  assert.equal(existsSync(join(home, '.oats-start-pending.json')), true);
  await assert.rejects(fx.inEnv(() => startInstanceSession(home)), e => ['E_SESSION_RUNNING', 'E_SESSION_START_BUSY'].includes(e.code));
  let second;
  await assert.rejects(fx.inEnv(() => restartInstanceSession(home)), e => { second = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  assert.equal(second.details.target.paneId, first.details.target.paneId);
  assert.notEqual(second.details.target.pid, first.details.target.pid);
  configure('dev-start', false);
  const result = await fx.inEnv(() => restartInstanceSession(home));
  assert.equal(result.reused, 'pane');
  assert.equal(meta(home).launched, true);
  assert.equal(meta(home).launchPrompts, undefined);
});


test('plain start reuses a stopped retained pane only for its newly created process', async t => {
  const {fx, configure} = fixture(t);
  const home = configure('dev-plain-reuse');
  await fx.spawn('dev', {name:'dev-plain-reuse', launchConfig:'stub', launch:false});
  let first;
  await assert.rejects(fx.inEnv(() => startInstanceSession(home)), e => { first = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  await fx.inEnv(() => stopInstanceSession(home));
  await waitUntil(() => existsSync(join(home, '.oats-start-exited')), 'stub exit receipt');
  let second;
  await assert.rejects(fx.inEnv(() => startInstanceSession(home)), e => { second = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  assert.equal(second.details.target.paneId, first.details.target.paneId);
  assert.notEqual(second.details.target.pid, first.details.target.pid);
  assert.equal(second.details.launchPrompts.answers.length, 0);
});

test('CLI JSON preserves the established incomplete envelope and additive prompt receipt', t => {
  const {fx, configure} = fixture(t);
  const home = configure('dev-cli');
  const args = ['spawn', 'dev', '--name', 'dev-cli', '--launch-config', 'stub', '--json'];
  const preview = fx.cli([...args, '--preview']).json();
  assert.equal(preview.ok, true);
  assert.equal(preview.result.launchPromptAnswers.awebDevelopmentChannel, true);
  assert.ok(preview.result.warnings.some(w => w.includes('harness update')));
  assert.equal(Object.hasOwn(preview.result, 'launchPromptWarning'), false);
  const run = fx.cli(args);
  assert.notEqual(run.status, 0);
  const response = run.json();
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'E_SPAWN_INCOMPLETE');
  assert.equal(response.error.details.home, home);
  assert.equal(response.error.details.launched, 'unknown');
  assert.equal(response.error.details.unconfirmed, true);
  assert.equal(response.error.details.retained, true);
  assert.equal(response.error.details.launchPrompts.status, 'blocked');
  assert.match(response.error.details.target.paneId, /^%\d+$/);
});


test('blocked spawn keeps conservative retirement recovery and refuses a mismatched endpoint', async t => {
  const {fx, configure} = fixture(t);
  const name = 'dev-retire-blocked', home = configure(name);
  await assert.rejects(fx.spawn('dev', {name, launchConfig:'stub', launch:true}), e => e.code === 'E_SPAWN_INCOMPLETE');
  const file = join(home, 'instance.json'), original = readFileSync(file, 'utf8');
  const changed = JSON.parse(original);
  changed.tmux.window = 'unrelated-window';
  writeFileSync(file, JSON.stringify(changed));
  await assert.rejects(fx.inEnv(() => inspectInstanceSession(home)), e => e.code === 'E_RUNTIME_AUTHORITY_MISMATCH');
  await assert.rejects(fx.inEnv(() => retireInstance(fx.root, name)), e => e.code === 'E_RUNTIME_AUTHORITY_MISMATCH');
  assert.equal(existsSync(home), true);
  writeFileSync(file, original);
  const result = await fx.inEnv(() => retireInstance(fx.root, name));
  assert.ok(result.workRecovery.classes.includes('changed instance-home bytes'));
  assert.equal(existsSync(join(result.workRecovery.path, 'home', 'instance.json')), true);
  assert.equal(existsSync(home), false);
});
