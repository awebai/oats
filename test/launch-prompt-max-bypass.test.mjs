import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { qualifyLaunchPromptFixtures } from '../lib/launch-prompt-fixtures.mjs';
import { createLaunchPromptController } from '../lib/launch-prompts.mjs';
const root = new URL('../lib/launch-prompt-fixtures/claude-2.1.289-darwin-arm64/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const pin = JSON.parse(read('manifest.json')).binarySha256;
const target = { socket: '/synthetic/socket', windowId: '@1', paneId: '%1', pid: '123' };

for (const [banner, footerRow] of [['frame-07-after-channel-200ms.txt', 11], ['frame-08-installed-after-channel-200ms.txt', 10]]) {
 test(`SOURCE-DERIVED empty Max/bypass/medium complete frame: ${banner}`, t => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'oats-bypass-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const executablePath = join(home, 'stub'); writeFileSync(executablePath, 'never executed', { mode: 0o755 });
  const original = crypto.createHash, stubHash = original('sha256').update(readFileSync(executablePath)).digest('hex');
  const mock = t.mock.method(crypto, 'createHash', (...args) => {
   const hash = original(...args), finish = hash.digest.bind(hash);
   hash.digest = encoding => { const value = finish(encoding); return value === stubHash ? pin : value; }; return hash;
  });
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  const qualified = qualifyLaunchPromptFixtures({ home, harness: 'claude', executablePath, platform: 'darwin', arch: 'arm64',
   argv: ['--dangerously-load-development-channels', 'plugin:aweb-channel@awebai-marketplace'] });
  const prompt = read('frame-05-channel-seeded.txt');
  const rows = read(banner).split('\n');
  rows[1] = '▝▜██████▀  Opus 5.5 · Claude Max'; rows[2] = ' ▝▝   ▝▝   ' + home;
  rows[footerRow] = '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents' + ' '.repeat(28) + '◐ medium · /effort';
  assert.equal(rows[footerRow].length, 108); assert.equal(rows[footerRow].indexOf('◐'), 90);
  const complete = rows.join('\n');
  const manifest = JSON.parse(read('max-bypass-source.json'));
  const provenance = manifest.candidates.find(candidate => candidate.sourceCapture === banner);
  const sample = [...rows]; sample[2] = ' ▝▝   ▝▝   ' + manifest.sampleHome;
  assert.equal(original('sha256').update(sample.join('\n')).digest('hex'), provenance.candidateSha256);
  assert.equal(Buffer.byteLength(sample.join('\n')), provenance.candidateBytes);
  assert.equal(original('sha256').update(read(banner)).digest('hex'), provenance.sourceSha256);
  for (const mode of ['valid', 'question-added', 'question-replaced', 'overlay', 'task', 'gap', 'effort', 'effort-absent', 'model', 'billing', 'foreign-home', 'width', 'height', 'no-consent', 'audit-failure', 'stale-pid', 'version']) {
   let text = prompt, sends = 0, restored = 0, sent = false;
   const events = [];
   const controller = createLaunchPromptController({ home, startId: 'synthetic-max-bypass', ...qualified,
    ...(mode === 'version' ? { harness: { ...qualified.harness, version: 'unqualified' } } : {}),
    policy: { awebDevelopmentChannel: mode !== 'no-consent' },
    audit(data) { events.push(data); return { ok: !(mode === 'audit-failure' && data.status === 'completed'), row: { kind: 'launch-prompt', data }, results: [] }; },
    transport: {
     snapshot: () => ({ ...target, pid: sent && mode === 'stale-pid' ? '999' : target.pid, width: sent && mode === 'width' ? 111 : 110, height: sent && mode === 'height' ? 36 : 35, text }),
     pin: () => ({ previous: { width: 80, height: 24, windowSize: 'latest' } }), restore: () => { restored++; return { status: 'restored' }; },
     send: (_, key) => {
      assert.equal(key, 'Enter'); sends++; sent = true; text = complete;
      if (mode === 'question-added') text = text.replace('\n\n', '\nAllow access?\n');
      if (mode === 'question-replaced') text = text.replace('Channels (experimental)', 'Confirm access?');
      if (mode === 'overlay') text = text.replace('❯\u00a0', '❯ Confirm / Cancel');
      if (mode === 'task') text = text.replace('\n\n', '\nPrivate task transcript\n');
      if (mode === 'gap') text = text.replace(' '.repeat(28) + '◐', ' '.repeat(37) + '◐');
      if (mode === 'effort') text = text.replace('medium · /effort', 'high · /effort');
      if (mode === 'effort-absent') text = text.replace('◐ medium · /effort', '');
      if (mode === 'model') text = text.replace('Opus 5.5', 'Sonnet 5');
      if (mode === 'billing') text = text.replace('Claude Max', 'Claude Pro');
      if (mode === 'foreign-home') text = text.replace(home, '/foreign/home');
      return { status: 'submitted' };
     },
    },
   });
   const result = controller.observeNew(target);
   assert.equal(result.status, mode === 'valid' ? 'completed' : mode === 'audit-failure' ? 'incomplete' : 'blocked', mode);
   assert.equal(sends, ['no-consent', 'version'].includes(mode) ? 0 : 1, mode);
   assert.equal(result.answers.length, sends);
   if (mode === 'valid') assert.ok(events.some(e => e.status === 'completed'));
   assert.equal(restored, ['no-consent', 'version'].includes(mode) ? 0 : 1);
   text = prompt; assert.equal(controller.observeNew(target), result); assert.equal(sends, ['no-consent', 'version'].includes(mode) ? 0 : 1);
  }
 });
}
