import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { v2Deployment } from './helpers/v2-deployment.mjs';
import { startInstanceSession, restartInstanceSession, inspectInstanceSession, stopInstanceSession, retireInstance, DEV_CHANNEL_STATEMENT, FLAG_IGNORED_WARNING } from '../lib/core.mjs';
import { DEV_CHANNEL_ENTRIES, FLAG_IGNORED_ENTRIES, CLAUDE_SESSION_HINT } from '../lib/launch-prompt-fixtures.mjs';
import { waitUntil } from './helpers/host-fixture.mjs';
import { readEvents } from '../lib/instance-events.mjs';

const DEV = ['--dangerously-load-development-channels', 'plugin:aweb-channel@awebai-marketplace'];
const ENTRY = DEV_CHANNEL_ENTRIES[0].id;

// v2Deployment installs a private TMUX_TMPDIR and inert harness PATH. The only
// launched programs here are these stubs; no real harness or default server is used.
// `confirm-stub` is SYNTHETIC: it draws the real confirmation's text word-wrapped
// to its pane width, logs every key it reads, and on Enter shows a session screen.
// `question-stub` shows a question no entry matches. `ignored-stub` and `hidden-stub`
// draw the real Claude 2.1.296 screens of a start that ignored the flag (its notice
// visible, and hidden behind another notice), log every key, and keep running.
const capture = name => fileURLToPath(new URL(`./fixtures/launch-prompts/${name}`, import.meta.url));
function fixture(t) {
  const fx = v2Deployment();
  t.after(() => fx.cleanup());
  const confirm = join(fx.base, 'confirm-stub'), question = join(fx.base, 'question-stub');
  const ignored = join(fx.base, 'ignored-stub'), hidden = join(fx.base, 'hidden-stub');
  const paragraphs = JSON.stringify(['WARNING: Loading development channels',
    '--dangerously-load-development-channels is for local channel development only. Do not use this option to run channels you have downloaded off the internet.',
    'Please use --channels to run a list of approved channels.', 'Channels: plugin:aweb-channel@awebai-marketplace',
    '❯ 1. I am using this for local development', '  2. Exit', 'Enter to confirm · Esc to cancel']);
  writeFileSync(confirm, `#!${process.execPath}
const fs = require('fs');
const cols = process.stdout.columns || 80;
const wrap = p => { const rows = []; let row = ''; for (const w of p.split(' ')) { if (row && row.length + 1 + w.length > cols - 2) { rows.push('  ' + row); row = w; } else row += (row ? ' ' : '') + w; } rows.push('  ' + row); return rows; };
process.stdout.write(['─'.repeat(cols), ...${paragraphs}.flatMap(p => [...wrap(p), ''])].join('\\n'));
process.stdin.setRawMode(true); process.stdin.resume();
process.stdin.on('data', d => { fs.appendFileSync('stub-keys.log', JSON.stringify(d.toString()) + '\\n'); if (d.includes(13)) process.stdout.write('\\x1b[2J\\x1b[HSYNTHETIC session ready\\n> '); });
`);
  writeFileSync(question, `#!${process.execPath}\nconsole.log('Unexpected stub question: secret text must not enter receipts');\nsetInterval(() => {}, 1000);\n`);
  for (const [file, screen] of [[ignored, 'claude-2.1.296-darwin-arm64-flag-ignored-80x24.txt'], [hidden, 'claude-2.1.296-darwin-arm64-flag-ignored-hidden-80x24.txt']]) {
    writeFileSync(file, `#!${process.execPath}
const fs = require('fs');
process.stdout.write(fs.readFileSync(${JSON.stringify(capture(screen))}, 'utf8').replace(/\\n$/, ''));
process.stdin.setRawMode(true); process.stdin.resume();
process.stdin.on('data', d => fs.appendFileSync('stub-keys.log', JSON.stringify(d.toString()) + '\\n'));
`);
  }
  for (const f of [confirm, question, ignored, hidden]) chmodSync(f, 0o755);
  const local = YAML.parse(readFileSync(join(fx.dep, 'oats-local.yaml'), 'utf8'));
  local['launch-configs'] = {
    confirm: { harness: 'claude', executable: confirm, args: [...DEV] },
    question: { harness: 'claude', executable: question, args: [...DEV] },
    ignored: { harness: 'claude', executable: ignored, args: [...DEV] },
    hidden: { harness: 'claude', executable: hidden, args: [...DEV] },
    plain: { harness: 'claude', executable: confirm },
    codex: { harness: 'codex', executable: confirm, args: [...DEV] },
  };
  const write = (extra = {}) => writeFileSync(join(fx.dep, 'oats-local.yaml'), YAML.stringify({ ...local, ...extra }));
  write();
  return { fx, write, home: name => join(fx.root, 'dev', 'instances', name) };
}
const meta = home => JSON.parse(readFileSync(join(home, 'instance.json'), 'utf8'));
const keys = home => existsSync(join(home, 'stub-keys.log')) ? readFileSync(join(home, 'stub-keys.log'), 'utf8').trim().split('\n').map(JSON.parse) : [];
const promptEvents = home => readEvents(home).events.filter(e => e.kind === 'launch-prompt');
const readinessItems = (fx, home) => { const r = fx.cli(['readiness', '--home', home, '--json']); assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result.checks.configured.items.filter(i => i.code === 'launch-prompt'); };

test('an eligible claude argv engages on spawn, start and restart: one Enter each, completed, and the start says so', async t => {
  const { fx, home } = fixture(t);
  const spawned = await fx.spawn('dev', { name: 'dev-spawn', launchConfig: 'confirm', launch: true });
  assert.ok(spawned.warnings.includes(DEV_CHANNEL_STATEMENT));
  const a = home('dev-spawn');
  assert.equal(meta(a).launched, true);
  assert.equal(meta(a).launchPrompts.status, 'completed');
  assert.deepEqual(meta(a).launchPrompts.answers, [{ class: 'awebDevelopmentChannel', signatureId: ENTRY, status: 'submitted' }]);
  assert.deepEqual(keys(a), ['\r']);
  const rows = promptEvents(a).map(e => e.data);
  assert.deepEqual(rows.map(r => r.status), ['attempted', 'submitted', 'completed']);
  assert.ok(rows.every(r => !Object.hasOwn(r, 'consentSource') && typeof r.claudeVersion === 'string' && ['executable-path', 'unknown'].includes(r.claudeVersionSource)));

  await fx.spawn('dev', { name: 'dev-start', launchConfig: 'confirm', launch: false });
  const b = home('dev-start');
  assert.equal(promptEvents(b).length, 0, 'no start, no capture');
  const started = await fx.inEnv(() => startInstanceSession(b));
  assert.ok(started.warnings.includes(DEV_CHANNEL_STATEMENT));
  assert.equal(started.launchPrompts.status, 'completed', 'the start result carries what it recorded');
  assert.equal(meta(b).launchPrompts.status, 'completed');
  await waitUntil(() => keys(b).length === 1, 'the start sent its Enter');
  const restarted = await fx.inEnv(() => restartInstanceSession(b));
  assert.ok(restarted.warnings.includes(DEV_CHANNEL_STATEMENT));
  assert.equal(meta(b).launchPrompts.status, 'completed');
  assert.notEqual(meta(b).launchPrompts.receipt[0].row.data.startId, undefined);
  await waitUntil(() => keys(b).length === 2, 'the restart sent its own Enter');
  assert.deepEqual(keys(b), ['\r', '\r']);
  // Healthy sessions are stopped here, not left for the fixture's kill-server.
  for (const h of [a, b]) await fx.inEnv(() => stopInstanceSession(h));
});

test('an ineligible argv, or codex, never engages: no capture, no key, and the start records not-engaged', async t => {
  const { fx, home } = fixture(t);
  for (const [name, launchConfig] of [['dev-plain', 'plain'], ['dev-codex', 'codex']]) {
    const spawned = await fx.spawn('dev', { name, launchConfig, launch: true });
    assert.ok(!(spawned.warnings || []).includes(DEV_CHANNEL_STATEMENT), name);
    const h = home(name);
    assert.equal(meta(h).launched, true);
    assert.equal(meta(h).launchPrompts.status, 'not-engaged');
    assert.match(meta(h).launchPrompts.startId, /^[0-9a-f-]{36}$/);
    assert.equal(Object.hasOwn(meta(h), 'launchPromptTarget'), false);
    assert.equal(promptEvents(h).length, 0);
  }
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(keys(home('dev-plain')), [], 'the prompt on screen was left for a person');
  for (const name of ['dev-plain', 'dev-codex']) await fx.inEnv(() => stopInstanceSession(home(name)));
});

test('preview and no-launch have no capture effects; a blocked spawn retains lineage, says what differed and refuses cached replay', async t => {
  const { fx, home } = fixture(t);
  const anchor = await fx.spawn('dev', { name: 'dev-anchor', launchConfig: 'plain' });
  const h = home('dev-blocked');
  const args = { name: 'dev-blocked', launchConfig: 'question', launch: true, relativeTo: anchor.instance, relation: 'parent' };
  const preview = await fx.spawn('dev', { ...args, preview: true });
  assert.equal(Object.hasOwn(preview, 'launchPromptAnswers'), false);
  assert.ok(!(preview.warnings || []).includes(DEV_CHANNEL_STATEMENT), 'spawn preview runs no launch hook, so it cannot know the argv');
  assert.equal(existsSync(h), false);
  const apply = { ...args, expectDecision: preview.decision.revision, idempotencyKey: 'blocked-test' };
  let failure;
  await assert.rejects(fx.spawn('dev', apply), e => { failure = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  assert.equal(failure.details.retained, true);
  assert.equal(failure.details.parentLineageCommitted, true);
  assert.equal(failure.details.launchPrompts.reason, 'blocked: unexpected prompt');
  assert.equal(failure.details.launchPrompts.differed.nearest, ENTRY);
  assert.equal(failure.details.launchPrompts.differed.firstDifference.index, 0);
  assert.match(failure.message, /press Enter yourself|tolerance entry/);
  assert.equal(meta(anchor.home).parentInstance, 'dev-blocked');
  assert.equal(meta(h).launched, false);
  const retainedState = await fx.inEnv(() => inspectInstanceSession(h));
  assert.equal(retainedState.present, true);
  assert.equal(retainedState.paneId, failure.details.target.paneId);
  assert.equal(meta(h).spawnCompleted, false);
  assert.ok(failure.details.launchPrompts.receipt.some(r => r.results.some(p => p.ok && p.path)));
  const events = promptEvents(h);
  assert.ok(events.length);
  assert.doesNotMatch(JSON.stringify(events), /secret text must not/);
  await assert.rejects(fx.spawn('dev', apply), e => e.code === 'E_SPAWN_INCOMPLETE' && e.details.retained);
  await assert.rejects(fx.inEnv(() => startInstanceSession(h)), e => ['E_SESSION_RUNNING', 'E_SESSION_START_BUSY'].includes(e.code));
  await fx.spawn('dev', { name: 'dev-no-launch', launchConfig: 'confirm', launch: false });
  const quiet = home('dev-no-launch');
  assert.equal(meta(quiet).launched, false);
  assert.equal(Object.hasOwn(meta(quiet), 'launchPrompts'), false);
  assert.equal(promptEvents(quiet).length, 0);
});

test('launch-config preview states the confirmation for an eligible argv, nothing for an ineligible one, and never the removed field', async t => {
  const { fx, home } = fixture(t);
  await fx.spawn('dev', { name: 'dev-preview', launchConfig: 'confirm', launch: false });
  const h = home('dev-preview');
  const eligible = fx.cli(['launch-config', 'preview', '--home', h, '--json']).json();
  assert.equal(eligible.ok, true);
  assert.equal(Object.hasOwn(eligible.result, 'launchPromptAnswers'), false);
  assert.ok(eligible.result.warnings.includes(DEV_CHANNEL_STATEMENT));
  const ineligible = fx.cli(['launch-config', 'preview', '--home', h, '--launch-config', 'plain', '--json']).json();
  assert.ok(!(ineligible.result.warnings || []).includes(DEV_CHANNEL_STATEMENT));
  // A home that predates recipes: its frozen command is judged the same way.
  const legacy = meta(h); delete legacy.launch;
  writeFileSync(join(h, 'instance.json'), JSON.stringify(legacy));
  const frozen = fx.cli(['launch-config', 'preview', '--home', h, '--json']).json();
  assert.equal(frozen.ok, true);
  assert.equal(Object.hasOwn(frozen.result, 'launchPromptAnswers'), false);
  assert.ok(frozen.result.warnings.includes(DEV_CHANNEL_STATEMENT));
});

test('an old launchPromptAnswers block of true entries is ignored with one warning on every launch path', async t => {
  const { fx, write, home } = fixture(t);
  write({ launchPromptAnswers: { homes: { [home('dev-old')]: { awebDevelopmentChannel: true } } } });
  const notice = w => (w || []).filter(x => x.startsWith('launchPromptAnswers in ')).length;
  const preview = await fx.spawn('dev', { name: 'dev-old', launchConfig: 'confirm', launch: true, preview: true });
  assert.equal(notice(preview.warnings), 1);
  const spawned = await fx.spawn('dev', { name: 'dev-old', launchConfig: 'confirm', launch: true });
  assert.equal(notice(spawned.warnings), 1);
  assert.equal(meta(home('dev-old')).launchPrompts.status, 'completed', 'the block decides nothing');
  const restarted = await fx.inEnv(() => restartInstanceSession(home('dev-old')));
  assert.equal(notice(restarted.warnings), 1);
  const plan = fx.cli(['launch-config', 'preview', '--home', home('dev-old'), '--json']).json();
  assert.equal(notice(plan.result.warnings), 1);
});

test('a blocked start, then a restart that does not engage, records not-engaged and clears the readiness warning', async t => {
  const { fx, home } = fixture(t);
  await fx.spawn('dev', { name: 'dev-start', launchConfig: 'question', launch: false });
  const h = home('dev-start');
  let first;
  await assert.rejects(fx.inEnv(() => startInstanceSession(h)), e => { first = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  assert.equal(first.details.retained, true);
  assert.equal(meta(h).launched, false);
  assert.equal(meta(h).launchPrompts.status, 'blocked');
  const [warning] = readinessItems(fx, h);
  assert.equal(warning.status, 'fail');
  assert.equal(warning.required, false);
  assert.match(warning.reason, new RegExp(`nearest tolerance entry ${ENTRY}`));
  assert.match(warning.reason, /first difference at 0/);
  assert.match(warning.remedy, /tolerance entry/);
  assert.match(warning.remedy, /press Enter/);
  await assert.rejects(fx.inEnv(() => startInstanceSession(h)), e => ['E_SESSION_RUNNING', 'E_SESSION_START_BUSY'].includes(e.code));
  let second;
  await assert.rejects(fx.inEnv(() => restartInstanceSession(h)), e => { second = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  assert.equal(second.details.target.paneId, first.details.target.paneId);
  assert.notEqual(second.details.target.pid, first.details.target.pid);
  const result = await fx.inEnv(() => restartInstanceSession(h, { launchConfig: 'plain' }));
  assert.equal(result.reused, 'pane');
  assert.deepEqual(result.launchPrompts, meta(h).launchPrompts, 'the restart result carries what it recorded');
  assert.equal(result.launchPrompts.status, 'not-engaged');
  assert.equal(meta(h).launched, true);
  assert.equal(meta(h).launchPrompts.status, 'not-engaged');
  assert.equal(Object.hasOwn(meta(h), 'launchPromptTarget'), false);
  assert.deepEqual(readinessItems(fx, h), []);
});

test('a later completed start clears the readiness warning', async t => {
  const { fx, home } = fixture(t);
  await fx.spawn('dev', { name: 'dev-clear', launchConfig: 'question', launch: false });
  const h = home('dev-clear');
  await assert.rejects(fx.inEnv(() => startInstanceSession(h)), e => e.code === 'E_SPAWN_INCOMPLETE');
  assert.equal(readinessItems(fx, h).length, 1);
  await fx.inEnv(() => restartInstanceSession(h, { launchConfig: 'confirm' }));
  assert.equal(meta(h).launchPrompts.status, 'completed');
  assert.deepEqual(readinessItems(fx, h), []);
});

test('plain start reuses a stopped retained pane only for its newly created process', async t => {
  const { fx, home } = fixture(t);
  await fx.spawn('dev', { name: 'dev-plain-reuse', launchConfig: 'question', launch: false });
  const h = home('dev-plain-reuse');
  let first;
  await assert.rejects(fx.inEnv(() => startInstanceSession(h)), e => { first = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  await fx.inEnv(() => stopInstanceSession(h));
  await waitUntil(() => existsSync(join(h, '.oats-start-exited')), 'stub exit receipt');
  let second;
  await assert.rejects(fx.inEnv(() => startInstanceSession(h)), e => { second = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  assert.equal(second.details.target.paneId, first.details.target.paneId);
  assert.notEqual(second.details.target.pid, first.details.target.pid);
  assert.equal(second.details.launchPrompts.answers.length, 0);
});

test('CLI JSON preserves the established incomplete envelope and additive prompt receipt', t => {
  const { fx, home } = fixture(t);
  const args = ['spawn', 'dev', '--name', 'dev-cli', '--launch-config', 'question', '--json'];
  const preview = fx.cli([...args, '--preview']).json();
  assert.equal(preview.ok, true, JSON.stringify(preview.error));
  assert.equal(Object.hasOwn(preview.result, 'launchPromptAnswers'), false);
  assert.equal(Object.hasOwn(preview.result, 'launchPromptWarning'), false);
  const run = fx.cli(args);
  assert.notEqual(run.status, 0);
  const response = run.json();
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'E_SPAWN_INCOMPLETE');
  assert.equal(response.error.details.home, home('dev-cli'));
  assert.equal(response.error.details.launched, 'unknown');
  assert.equal(response.error.details.unconfirmed, true);
  assert.equal(response.error.details.retained, true);
  assert.equal(response.error.details.launchPrompts.status, 'blocked');
  assert.equal(response.error.details.launchPrompts.differed.nearest, ENTRY);
  assert.match(response.error.details.target.paneId, /^%\d+$/);
});

test('blocked spawn keeps conservative retirement recovery and refuses a mismatched endpoint', async t => {
  const { fx, home } = fixture(t);
  const name = 'dev-retire-blocked', h = home(name);
  await assert.rejects(fx.spawn('dev', { name, launchConfig: 'question', launch: true }), e => e.code === 'E_SPAWN_INCOMPLETE');
  const file = join(h, 'instance.json'), original = readFileSync(file, 'utf8');
  const changed = JSON.parse(original);
  changed.tmux.window = 'unrelated-window';
  writeFileSync(file, JSON.stringify(changed));
  await assert.rejects(fx.inEnv(() => inspectInstanceSession(h)), e => e.code === 'E_RUNTIME_AUTHORITY_MISMATCH');
  await assert.rejects(fx.inEnv(() => retireInstance(fx.root, name)), e => e.code === 'E_RUNTIME_AUTHORITY_MISMATCH');
  assert.equal(existsSync(h), true);
  writeFileSync(file, original);
  const result = await fx.inEnv(() => retireInstance(fx.root, name));
  assert.ok(result.workRecovery.classes.includes('changed instance-home bytes'));
  assert.equal(existsSync(join(result.workRecovery.path, 'home', 'instance.json')), true);
  assert.equal(existsSync(h), false);
});

test('Claude ignoring the flag is a successful start: flag-ignored recorded, no key, a warning, no readiness item', async t => {
  const { fx, home } = fixture(t);
  const spawned = await fx.spawn('dev', { name: 'dev-ignored', launchConfig: 'ignored', launch: true });
  assert.ok(spawned.warnings.includes(FLAG_IGNORED_WARNING));
  assert.ok(!spawned.warnings.includes(DEV_CHANNEL_STATEMENT), 'the answer never also says OATS confirms the prompt');
  assert.match(FLAG_IGNORED_WARNING, /^Claude ignored --dangerously-load-development-channels: channels are not available for this Claude account, so this instance gets no channel delivery: mail and chat will not wake it; /);
  assert.match(FLAG_IGNORED_WARNING, /settings\.oats\.aweb\.delivery: session/);
  const h = home('dev-ignored');
  const recorded = meta(h).launchPrompts;
  assert.deepEqual(Object.keys(recorded).sort(), ['at', 'reason', 'signatureId', 'startId', 'status']);
  assert.equal(recorded.status, 'flag-ignored');
  assert.equal(recorded.reason, 'channels-unavailable');
  assert.equal(recorded.signatureId, FLAG_IGNORED_ENTRIES[0].id);
  assert.equal(spawned.launchPrompts.signatureId, FLAG_IGNORED_ENTRIES[0].id, 'the spawn answer carries it');
  assert.doesNotMatch(JSON.stringify([recorded, promptEvents(h)]), /Channels are not|currently available/, 'no screen text in public rows');
  assert.match(recorded.startId, /^[0-9a-f-]{36}$/);
  assert.equal(meta(h).launched, true);
  const rows = promptEvents(h).map(e => e.data);
  assert.deepEqual(rows.map(r => [r.status, r.signatureId, r.startId]), [['flag-ignored', FLAG_IGNORED_ENTRIES[0].id, recorded.startId]]);
  assert.deepEqual(readinessItems(fx, h), []);

  const restarted = await fx.inEnv(() => restartInstanceSession(h));
  assert.ok(restarted.warnings.includes(FLAG_IGNORED_WARNING));
  assert.ok(!restarted.warnings.includes(DEV_CHANNEL_STATEMENT));
  assert.equal(restarted.launchPrompts.status, 'flag-ignored', 'the restart result carries what it recorded');
  assert.deepEqual(restarted.launchPrompts, meta(h).launchPrompts);
  assert.notEqual(meta(h).launchPrompts.startId, recorded.startId);
  assert.equal(meta(h).launched, true);
  assert.deepEqual(readinessItems(fx, h), []);
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(keys(h), [], 'no key was ever sent');
  await fx.inEnv(() => stopInstanceSession(h));
});

test('a running session with the notice hidden stays blocked, and the error and readiness say the flag may have been ignored', async t => {
  const { fx, home } = fixture(t);
  let error;
  await assert.rejects(fx.spawn('dev', { name: 'dev-hidden', launchConfig: 'hidden', launch: true }), e => { error = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  assert.ok(error.message.includes(CLAUDE_SESSION_HINT), error.message);
  const h = home('dev-hidden');
  assert.equal(meta(h).launchPrompts.status, 'blocked');
  assert.equal(meta(h).launchPrompts.reason, 'blocked: unexpected prompt');
  assert.equal(meta(h).launchPrompts.claudeSessionShown, true);
  const [warning] = readinessItems(fx, h);
  assert.ok(warning.remedy.includes(CLAUDE_SESSION_HINT), warning.remedy);
  assert.deepEqual(keys(h), []);

  await fx.spawn('dev', { name: 'dev-question', launchConfig: 'question', launch: false });
  const q = home('dev-question');
  let foreign;
  await assert.rejects(fx.inEnv(() => startInstanceSession(q)), e => { foreign = e; return e.code === 'E_SPAWN_INCOMPLETE'; });
  assert.ok(!foreign.message.includes(CLAUDE_SESSION_HINT));
  assert.ok(!readinessItems(fx, q)[0].remedy.includes(CLAUDE_SESSION_HINT));
});
