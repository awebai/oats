// This suite pins the original exact-frame adapter in isolation. The qualified
// structural policy and marker precedence run through the same controller in
// launch-prompt-structural.test.mjs; input signatures remain unchanged.
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
const pin = JSON.parse(readFileSync(new URL('manifest.json', root))).binarySha256;
const read = name => readFileSync(new URL(name, root), 'utf8');

for (const billing of ['Claude Max', 'Claude Pro', 'Claude Team', 'Claude Enterprise']) {
  test(`SOURCE-DERIVED synthetic ${billing} empty completion retains exact input authority`, t => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'oats-subscription-')));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const executablePath = join(home, 'stub');
    writeFileSync(executablePath, 'not executed', { mode: 0o755 });
    // Synthetic executable qualification only, never a claim that these bytes
    // are a harness or that the subscription frame was captured from an account.
    const original = crypto.createHash;
    const stubHash = original('sha256').update(readFileSync(executablePath)).digest('hex');
    const mock = t.mock.method(crypto, 'createHash', (...args) => {
      const hash = original(...args), finish = hash.digest.bind(hash);
      hash.digest = encoding => { const value = finish(encoding); return value === stubHash ? pin : value; };
      return hash;
    });
    syncBuiltinESMExports();
    t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
    const qualified = qualifyLaunchPromptFixtures({ home, harness: 'claude', executablePath,
      platform: 'darwin', arch: 'arm64', argv: ['--dangerously-load-development-channels', 'plugin:aweb-channel@awebai-marketplace'] });
    const prompt = read('frame-05-channel-seeded.txt');
    assert.equal(qualified.fixtures[0].frames[0].text, prompt);
    for (const banner of ['frame-07-after-channel-200ms.txt', 'frame-08-installed-after-channel-200ms.txt']) {
      // Explicit source-derived derivative of the API capture: only the source
      // billing atom and the already-qualified canonical-home row differ.
      const rows = read(banner).split('\n');
      rows[1] = rows[1].replace('API Usage Billing', billing);
      rows[2] = ' ▝▝   ▝▝   ' + home;
      const completion = rows.join('\n');
      for (const mode of ['valid', 'question', 'bypass', 'audit-failure', 'no-consent']) {
        let screen = prompt, sends = 0;
        const events = [];
        const controller = createLaunchPromptController({ home, startId: 'synthetic-subscription', ...qualified, classifyCompletion: undefined, geometry: undefined,
          policy: { awebDevelopmentChannel: mode !== 'no-consent' },
          audit(data) { events.push(data); return { ok: !(mode === 'audit-failure' && data.status === 'completed'), row: { kind: 'launch-prompt', data }, results: [] }; },
          transport: { snapshot: () => ({ ...target, width: 110, height: 35, text: screen }),
            send: (_, key) => { assert.equal(key, 'Enter'); sends++; screen = completion;
              if (mode === 'question') screen = screen.replace('\n\n', '\nAllow access?\n');
              if (mode === 'bypass') screen = screen.replace('auto mode on', 'bypass permissions on');
              return { status: 'submitted' }; } },
        });
        const target = { socket: '/synthetic/socket', windowId: '@1', paneId: '%1', pid: '123' };
        const result = controller.observeNew(target);
        assert.equal(result.status, mode === 'valid' ? 'completed' : mode === 'audit-failure' ? 'incomplete' : 'blocked', `${banner}: ${mode}`);
        assert.equal(sends, mode === 'no-consent' ? 0 : 1);
        assert.equal(result.answers.length, sends);
        if (mode === 'valid') {
          assert.equal(events.at(-1).status, 'completed');
          assert.equal(result.receipt.at(-1).ok, true);
        }
        screen = prompt;
        assert.equal(controller.observeNew(target), result);
        assert.equal(sends, mode === 'no-consent' ? 0 : 1, 'terminal authority never reopens');
      }
    }
  });
}
