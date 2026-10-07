import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { retainLaunchPromptFrame, launchPromptEvidenceRecognition } from '../lib/launch-prompt-evidence.mjs';
import { createLaunchPromptController } from '../lib/launch-prompts.mjs';
import { appendEvent } from '../lib/instance-events.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const target = { socket: '/private/synthetic.sock', windowId: '@4', paneId: '%7', pid: '42' };
const frame = text => text + '\n'.repeat(35);
function setup(t) {
  const base = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), 'oats-evidence-'))), home = join(base, 'agents', 'dev', 'instances', 'home');
  fs.mkdirSync(home, { mode: 0o700, recursive: true });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const stat = fs.lstatSync(home), startId = 'synthetic-invocation';
  const args = { home, homeIdentity: { dev: stat.dev, ino: stat.ino }, startId, target,
    screen: { text: frame('PRIVATE exact  ❯\u00a0  '), width: 110, height: 35 } };
  const dir = join(home, '.oats', 'launch-prompt-evidence', hash(startId));
  return { base, home, args, dir };
}
function mock(t, method, handler) {
  const original = fs[method];
  const stub = t.mock.method(fs, method, (...args) => handler(original, ...args));
  syncBuiltinESMExports();
  t.after(() => { stub.mock.restore(); syncBuiltinESMExports(); });
}

test('private receipt reader keeps historical v1 readable and accepts only the two v2 pairs', () => {
  const old = { version: 1, kind: 'launch-prompt-unmatched', captureTime: null };
  const bytes = JSON.stringify(old);
  assert.deepEqual(launchPromptEvidenceRecognition(old), { outcome: 'blocked', recognition: 'unmatched' });
  assert.equal(JSON.stringify(old), bytes, 'reading does not migrate historical evidence');
  for (const [outcome, recognition] of [['blocked', 'unmatched'], ['completed', 'structural']]) {
    assert.deepEqual(launchPromptEvidenceRecognition({ version: 2, kind: 'launch-prompt-frame', outcome, recognition }), { outcome, recognition });
  }
  for (const wrong of [null, {}, { ...old, outcome: 'completed' }, { ...old, version: 2 },
    { version: 2, kind: 'launch-prompt-frame', outcome: 'blocked', recognition: 'structural' },
    { version: 2, kind: 'launch-prompt-frame', outcome: 'completed', recognition: 'unmatched' },
    { version: 3, kind: 'launch-prompt-frame', outcome: 'completed', recognition: 'structural' }]) {
    assert.equal(launchPromptEvidenceRecognition(wrong), null);
  }
});

test('private evidence retains exact compared bytes, target and receipt-last identities', t => {
  const { args, dir, home } = setup(t);
  assert.deepEqual(retainLaunchPromptFrame(args), { ok: true });
  const receipt = JSON.parse(fs.readFileSync(join(dir, 'receipt.json')));
  assert.equal(receipt.version, 2);
  assert.equal(receipt.kind, 'launch-prompt-frame');
  assert.equal(receipt.outcome, 'blocked');
  assert.equal(receipt.recognition, 'unmatched');
  assert.equal(fs.readFileSync(join(dir, 'frame.txt'), 'utf8'), args.screen.text);
  assert.equal(receipt.signatureDigest, hash(args.screen.text));
  assert.equal(receipt.bytes, Buffer.byteLength(args.screen.text));
  assert.equal(receipt.startId, args.startId); assert.equal(receipt.home, home);
  assert.deepEqual(receipt.target, target); assert.deepEqual(receipt.homeIdentity, args.homeIdentity);
  const stat = fs.lstatSync(join(dir, 'frame.txt'));
  assert.deepEqual(receipt.frameIdentity, { dev: stat.dev, ino: stat.ino });
  assert.equal(receipt.captureTime, null); assert.equal(receipt.source, 'controller-compared-frame');
  assert.ok(Number.isFinite(Date.parse(receipt.retainedAt)));
  for (const path of [join(home, '.oats'), join(home, '.oats/launch-prompt-evidence'), dir]) assert.equal(fs.statSync(path).mode & 0o777, 0o700);
  for (const file of ['frame.txt', 'receipt.json']) assert.equal(fs.statSync(join(dir, file)).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['frame.txt', 'receipt.json']);
  const before = fs.readFileSync(join(dir, 'receipt.json'));
  assert.deepEqual(retainLaunchPromptFrame(args), { ok: false }, 'no overwrite of any invocation');
  assert.deepEqual(fs.readFileSync(join(dir, 'receipt.json')), before);
});

test('structural evidence binds the proposed completion without asserting the final public outcome', t => {
  const { args, dir } = setup(t);
  assert.deepEqual(retainLaunchPromptFrame({ ...args, outcome: 'completed', recognition: 'structural' }), { ok: true });
  const receipt = JSON.parse(fs.readFileSync(join(dir, 'receipt.json')));
  assert.equal(receipt.version, 2);
  assert.equal(receipt.kind, 'launch-prompt-frame');
  assert.equal(receipt.outcome, 'completed');
  assert.equal(receipt.recognition, 'structural');
  assert.equal(receipt.signatureDigest, hash(args.screen.text));
  assert.equal(fs.readFileSync(join(dir, 'frame.txt'), 'utf8'), args.screen.text);
  assert.equal(Object.hasOwn(receipt, 'ready'), false);
  assert.equal(Object.hasOwn(receipt, 'audit'), false);
});

for (const [outcome, recognition] of [['completed', 'unmatched'], ['blocked', 'structural'],
  ['incomplete', 'structural'], ['completed', 'exact'], ['unknown', 'unmatched'], [null, null]]) {
  test(`private receipt refuses unsupported pair ${outcome}/${recognition} before any publication`, t => {
    const { args, home } = setup(t);
    assert.deepEqual(retainLaunchPromptFrame({ ...args, outcome, recognition }), { ok: false });
    assert.equal(fs.existsSync(join(home, '.oats')), false);
  });
}

for (const mode of ['width', 'height', 'rows', 'oversized', 'start', 'target', 'identity', 'home-replaced', 'oats-symlink', 'root-symlink', 'root-mode', 'home-mode', 'invocation-symlink']) {
  test(`evidence refuses unsafe ${mode} without writing through it`, t => {
    const { args, home, base, dir } = setup(t);
    const outside = join(base, 'outside'); fs.mkdirSync(outside);
    if (mode === 'width') args.screen.width++;
    if (mode === 'height') args.screen.height++;
    if (mode === 'rows') args.screen.text += '\n';
    if (mode === 'oversized') args.screen.text = frame('x'.repeat(65536));
    if (mode === 'start') args.startId = '';
    if (mode === 'target') args.target = { ...target, paneId: 'unknown' };
    if (mode === 'identity') args.homeIdentity.ino = -1;
    if (mode === 'home-replaced') { fs.renameSync(home, home + '-old'); fs.mkdirSync(home); }
    if (mode === 'home-mode') fs.chmodSync(home, 0o777);
    if (mode === 'oats-symlink') fs.symlinkSync(outside, join(home, '.oats'));
    if (['root-symlink', 'root-mode', 'invocation-symlink'].includes(mode)) {
      fs.mkdirSync(join(home, '.oats'));
      const root = join(home, '.oats/launch-prompt-evidence');
      if (mode === 'root-symlink') fs.symlinkSync(outside, root);
      else {
        fs.mkdirSync(root, { mode: mode === 'root-mode' ? 0o755 : 0o700 });
        if (mode === 'invocation-symlink') fs.symlinkSync(outside, dir);
      }
    }
    assert.deepEqual(retainLaunchPromptFrame(args), { ok: false });
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.equal(fs.existsSync(join(dir, 'receipt.json')), false);
  });
}

for (const mode of ['write', 'fsync', 'receipt-write', 'publication', 'readback', 'cleanup', 'parent-replacement', 'file-symlink', 'hardlink']) {
  test(`evidence ${mode} failure is truthful and never rolls back published files`, t => {
    const { args, dir, home, base } = setup(t);
    let writes = 0;
    if (['write', 'receipt-write'].includes(mode)) mock(t, 'writeFileSync', (original, ...a) => {
      if (++writes === (mode === 'write' ? 1 : 2)) throw new Error('private diagnostic');
      return original(...a);
    });
    if (mode === 'fsync') mock(t, 'fsyncSync', (original, fd) => {
      if (fs.fstatSync(fd).isFile()) throw new Error('fsync failure'); return original(fd);
    });
    if (mode === 'publication') mock(t, 'linkSync', (original, ...a) => { if (a[1].endsWith('receipt.json')) throw new Error('link failure'); return original(...a); });
    if (mode === 'readback') mock(t, 'readSync', (original, fd, buffer, ...a) => { const count = original(fd, buffer, ...a); if (count) buffer[0] ^= 1; return count; });
    if (mode === 'cleanup') mock(t, 'unlinkSync', (original, path) => { if (path.endsWith('.tmp')) throw new Error('unlink failure'); return original(path); });
    if (mode === 'parent-replacement') mock(t, 'writeFileSync', (original, ...a) => {
      const result = original(...a);
      if (++writes === 1) { fs.renameSync(join(home, '.oats'), join(base, 'old-oats')); fs.mkdirSync(join(home, '.oats')); }
      return result;
    });
    if (['file-symlink', 'hardlink'].includes(mode)) mock(t, 'linkSync', (original, temp, path) => {
      const result = original(temp, path);
      if (path.endsWith('frame.txt')) {
        if (mode === 'hardlink') original(temp, join(base, 'extra-link'));
        else { fs.unlinkSync(path); fs.symlinkSync(join(base, 'absent'), path); }
      }
      return result;
    });
    assert.deepEqual(retainLaunchPromptFrame(args), { ok: false });
    assert.equal(fs.existsSync(join(dir, 'receipt.json')), false);
    if (['receipt-write', 'publication', 'readback', 'cleanup', 'hardlink'].includes(mode)) assert.ok(fs.existsSync(join(dir, 'frame.txt')), 'published evidence is preserved');
    if (mode === 'parent-replacement') assert.deepEqual(fs.readdirSync(join(home, '.oats')), []);
  });
}

for (const mode of ['saved', 'write-failed', 'throw', 'audit-failed', 'no-consent', 'no-answer', 'send-failed', 'send-uncertain', 'completed', 'geometry', 'replaced-home']) {
 test(`controller retention trigger and permanent closure: ${mode}`, t => {
  const { args, home, dir } = setup(t), prompt = frame('SYNTHETIC channel'), done = frame('SYNTHETIC complete');
  let text = mode === 'no-answer' ? args.screen.text : prompt, time = 0, calls = 0, captures = 0, sends = 0, restored = 0;
  const rows = [];
  const controller = createLaunchPromptController({ home, startId: args.startId,
    harness: { name: 'claude', version: 'test', platform: 'test', developmentChannelEligible: true },
    policy: { awebDevelopmentChannel: mode !== 'no-consent' }, geometry: { width: 110, height: 35 },
    fixtures: [{ home, id: 'synthetic', harness: 'claude', version: 'test', platform: 'test', frames: [
      { text: prompt, width: 110, height: 35, kind: 'prompt', class: 'awebDevelopmentChannel', after: [] },
      { text: done, width: 110, height: 35, kind: 'completed', after: ['awebDevelopmentChannel'] },
    ] }], now: () => time, sleep: ms => { time += ms; },
    audit(data) { rows.push(data); return mode === 'audit-failed' && data.status === 'blocked' ? { ok: false, results: [] } : appendEvent(home, { kind: 'launch-prompt', data }); },
    retainFrame(input) {
      calls++; assert.equal(input.screen.text, args.screen.text);
      text = 'A NEWER SCREEN MUST NOT BE CAPTURED';
      if (mode === 'write-failed') return { ok: false };
      if (mode === 'throw') throw new Error('PRIVATE secret error');
      return retainLaunchPromptFrame(input);
    },
    transport: {
      snapshot: () => { captures++; return { ...target, text, width: sends && mode === 'geometry' ? 111 : 110, height: 35 }; },
      pin: () => ({ previous: { width: 80, height: 24 } }), restore: () => { restored++; return { status: 'restored' }; },
      send: () => {
        sends++; text = mode === 'completed' ? done : args.screen.text;
        if (mode === 'replaced-home') { fs.renameSync(home, home + '-old'); fs.mkdirSync(home); }
        return { status: mode === 'send-failed' ? 'failed' : mode === 'send-uncertain' ? 'uncertain' : 'submitted' };
      },
    },
  });
  const result = controller.observeNew(target);
  const wanted = ['saved', 'write-failed', 'throw', 'audit-failed'].includes(mode);
  assert.equal(calls, wanted ? 1 : 0);
  assert.equal(sends, ['no-consent', 'no-answer'].includes(mode) ? 0 : 1);
  assert.equal(restored, mode === 'no-consent' ? 0 : 1);
  assert.equal(result.status, mode === 'completed' ? 'completed' : ['audit-failed', 'send-failed', 'send-uncertain', 'replaced-home'].includes(mode) ? 'incomplete' : 'blocked');
  if (wanted) {
    assert.equal(result.answers[0].status, 'submitted');
    if (['write-failed', 'throw'].includes(mode)) assert.equal(result.reason, 'blocked: unexpected prompt; private launch evidence retention failed');
    else if (mode === 'saved') assert.equal(result.reason, 'blocked: unexpected prompt');
    else assert.equal(result.reason, 'launch prompt audit failed');
  }
  if (['saved', 'audit-failed'].includes(mode)) {
    const receipt = JSON.parse(fs.readFileSync(join(dir, 'receipt.json')));
    const blocked = rows.find(row => row.status === 'blocked');
    assert.equal(receipt.startId, blocked.startId); assert.equal(receipt.signatureDigest, blocked.signatureDigest);
    assert.equal(fs.readFileSync(join(dir, 'frame.txt'), 'utf8'), args.screen.text);
    assert.equal(captures, 5, 'only existing controller captures, no evidence recapture');
    if (mode === 'saved') {
      const eventRows = fs.readFileSync(join(home, '.oats-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      const event = eventRows.find(row => row.kind === 'launch-prompt' && row.data.status === 'blocked');
      assert.equal(event.data.startId, receipt.startId);
      assert.equal(event.data.signatureDigest, receipt.signatureDigest);
      assert.equal(event.data.paneId, receipt.target.paneId);
      assert.ok(!JSON.stringify(eventRows).includes('PRIVATE'));
    }
  } else assert.equal(fs.existsSync(join(dir, 'receipt.json')), false);
  assert.ok(!JSON.stringify({ result, rows }).includes('PRIVATE'));
  const before = captures; text = prompt;
  assert.equal(controller.observeNew(target), result); assert.equal(captures, before); assert.equal(calls, wanted ? 1 : 0);
 });
}

for (const mode of ['directory-sync', 'receipt-sync', 'final-frame-check']) {
 test(`failure after publication preserves artifacts without a success claim: ${mode}`, t => {
  const { args, dir } = setup(t);
  if (mode === 'final-frame-check') mock(t, 'linkSync', (original, temp, path) => {
    const result = original(temp, path);
    if (path.endsWith('receipt.json')) fs.writeFileSync(join(dir, 'frame.txt'), frame('changed after receipt'));
    return result;
  });
  else mock(t, 'fsyncSync', (original, fd) => {
    if (fs.fstatSync(fd).isDirectory() && fs.existsSync(join(dir, mode === 'receipt-sync' ? 'receipt.json' : 'frame.txt'))) throw new Error('directory sync failure');
    return original(fd);
  });
  assert.deepEqual(retainLaunchPromptFrame(args), { ok: false });
  assert.ok(fs.existsSync(join(dir, 'frame.txt')));
  assert.equal(fs.existsSync(join(dir, 'receipt.json')), mode !== 'directory-sync');
 });
}

test('bounded verification refuses concurrent growth without reading beyond the limit', t => {
  const { args } = setup(t);
  let largest = 0;
  mock(t, 'readSync', (original, fd, buffer, offset, length, position) => {
    largest = Math.max(largest, buffer.length);
    // Simulate an endless growing source, with the expected prefix followed by
    // one extra byte. Verification must stop after that bounded buffer.
    const source = Buffer.concat([Buffer.from(args.screen.text), Buffer.from('x')]);
    source.copy(buffer, offset, position, position + length);
    return length;
  });
  assert.deepEqual(retainLaunchPromptFrame(args), { ok: false });
  assert.equal(largest, Buffer.byteLength(args.screen.text) + 1);
});

// Real ACL manipulation is platform-dependent. The metadata probe's output is
// simulated; no shared native files or ACLs are changed by these tests.
for (const mode of ['acl', 'hidden-acl', 'probe-failed', 'temp-acl']) {
 test(`private evidence refuses ${mode} before exposing frame bytes`, async t => {
  const child = (await import('node:child_process')).default;
  const original = child.execFileSync, { args, dir } = setup(t);
  const stub = t.mock.method(child, 'execFileSync', (command, argv, options) => {
    if (command !== '/bin/ls') return original(command, argv, options);
    const path = argv.at(-1);
    if (mode === 'temp-acl' && !path.endsWith('.tmp')) return original(command, argv, options);
    if (mode === 'probe-failed') throw new Error('probe failed');
    if (mode === 'hidden-acl') return 'drwx------@ 1 owner group 0 date private\n 0: user:other allow read,write\n';
    return (path.endsWith('.tmp') ? '-rw-------+' : 'drwx------+') + ' 1 owner group 0 date private\n';
  });
  syncBuiltinESMExports(); t.after(() => { stub.mock.restore(); syncBuiltinESMExports(); });
  assert.deepEqual(retainLaunchPromptFrame(args), { ok: false });
  assert.equal(fs.existsSync(join(dir, 'frame.txt')), false);
  assert.equal(fs.existsSync(join(dir, 'receipt.json')), false);
 });
}
