import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync, renameSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { qualifyLaunchPromptFixtures } from '../lib/launch-prompt-fixtures.mjs';
import { createLaunchPromptController } from '../lib/launch-prompts.mjs';
import { retainLaunchPromptFrame } from '../lib/launch-prompt-evidence.mjs';
import { classifyClaudeLaunchCompletion, CLAUDE_QUESTION_MARKERS } from '../lib/launch-prompt-completion.mjs';

const root = new URL('../lib/launch-prompt-fixtures/', import.meta.url);
const provenance = JSON.parse(readFileSync(new URL('structural-completion.json', root)));
const fixture = name => readFileSync(new URL('claude-2.1.289-darwin-arm64/' + name, root), 'utf8');
const observed = readFileSync(new URL('./fixtures/launch-prompts/claude-max-started-home-sanitized.txt', import.meta.url), 'utf8');
const prompt = fixture('frame-05-channel-seeded.txt');
const target = { socket: '/synthetic/socket', windowId: '@1', paneId: '%1', pid: '123' };
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const screen = text => ({ text, width: 110, height: 35 });
const lines = (text, mutate) => { const rows = text.split('\n'); mutate(rows); return rows.join('\n'); };

function setup(t, qualificationChanges = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'oats-structural-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const executablePath = join(home, 'stub'); writeFileSync(executablePath, 'never executed', { mode: 0o755 });
  const original = crypto.createHash, stubHash = sha(readFileSync(executablePath));
  const mock = t.mock.method(crypto, 'createHash', (...args) => {
    const hash = original(...args), finish = hash.digest.bind(hash);
    hash.digest = encoding => { const value = finish(encoding); return value === stubHash && !qualificationChanges.badPin ? provenance.binarySha256 : value; }; return hash;
  });
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  const qualified = qualifyLaunchPromptFixtures({ home, harness: 'claude', executablePath, platform: 'darwin', arch: 'arm64',
    argv: ['--dangerously-load-development-channels', 'plugin:aweb-channel@awebai-marketplace'], ...qualificationChanges });
  let invocation = 0;
  return { home, qualified, run(after = observed, options = {}) {
    const startId = `structural-${++invocation}`;
    let text = options.before ?? prompt, sent = false, sends = 0, retained = 0, classified = 0, restored = 0, time = 0;
    const events = [], saved = [];
    const classify = qualified.classifyCompletion;
    const controller = createLaunchPromptController({ home, startId, ...qualified,
      ...(options.exactOverride ? { fixtures: qualified.fixtures.map(f => ({ ...f, frames: [...f.frames,
        { text: after, width: 110, height: 35, kind: 'completed', after: ['awebDevelopmentChannel'] }] })) } : {}),
      ...(options.version ? { harness: { ...qualified.harness, version: 'unqualified' } } : {}),
      classifyCompletion: classify ? value => { classified++; return classify(value); } : undefined,
      policy: { awebDevelopmentChannel: options.consent !== false },
      now: () => time, sleep: ms => { time += ms; },
      audit(data) { events.push(data); return { ok: !(options.auditFailure && data.status === options.auditFailure), row: { kind: 'launch-prompt', data }, results: [] }; },
      retainFrame: options.noWriter ? undefined : input => {
        retained++; saved.push(input);
        if (options.save === 'throw') throw new Error('PRIVATE ERROR MUST NOT ESCAPE');
        if (options.save === 'failed') return { ok: false };
        return options.realWriter ? retainLaunchPromptFrame(input) : { ok: true };
      },
      transport: {
        snapshot: () => ({ ...target, ...screen(text), ...(sent ? options.screen : {}), ...(sent && options.stalePid ? { pid: '999' } : {}) }),
        pin: () => ({ previous: { width: 80, height: 24, windowSize: 'latest' } }),
        restore: () => { restored++; return { status: options.restoreFailed ? 'failed' : 'restored' }; },
        send: (_, key) => {
          assert.equal(key, 'Enter'); sends++; sent = true; text = after;
          if (options.replaceHome) { renameSync(home, home + '-old'); mkdirSync(home); t.after(() => rmSync(home + '-old', { recursive: true, force: true })); }
          return { status: options.sendStatus ?? 'submitted' };
        },
      },
    });
    const result = controller.observeNew(target);
    text = prompt;
    assert.equal(controller.observeNew(target), result, 'terminal authority never reopens for a later exact prompt');
    return { result, sends, retained, classified, restored, events, saved, startId,
      evidenceDir: join(home, '.oats/launch-prompt-evidence', sha(startId)) };
  } };
}

test('observed home-only derivative: red-before57, one submitted answer, structural completion and exact private evidence', t => {
  assert.equal(Buffer.byteLength(observed), provenance.observedRegression.derivativeBytes);
  assert.equal(sha(observed), provenance.observedRegression.derivativeSha256);
  assert.deepEqual(provenance.observedRegression.changedRowIndices, [2]);
  const { run } = setup(t);
  const x = run(observed, { realWriter: true });
  assert.equal(x.result.status, 'completed'); assert.equal(x.sends, 1); assert.equal(x.retained, 1);
  assert.equal(x.result.answers[0].status, 'submitted');
  const receipt = JSON.parse(readFileSync(join(x.evidenceDir, 'receipt.json')));
  assert.equal(receipt.version, 2); assert.equal(receipt.outcome, 'completed'); assert.equal(receipt.recognition, 'structural');
  assert.equal(readFileSync(join(x.evidenceDir, 'frame.txt'), 'utf8'), observed);
  assert.equal(receipt.signatureDigest, sha(observed)); assert.equal(receipt.startId, x.startId);
  assert.deepEqual(receipt.target, target); assert.equal(receipt.captureTime, null);
  assert.ok(x.events.some(e => e.status === 'completed' && e.signatureDigest === receipt.signatureDigest));
  assert.ok(!JSON.stringify(x.result).includes('Wrangling')); assert.ok(!JSON.stringify(x.events).includes('@TASK.md'));
});

test('all 21 markers block anywhere after submission, but never suppress the initial exact channel prompt', t => {
  assert.equal(CLAUDE_QUESTION_MARKERS.length, 21);
  assert.deepEqual([...CLAUDE_QUESTION_MARKERS], provenance.markers);
  assert.equal(CLAUDE_QUESTION_MARKERS.filter(m => prompt.includes(m)).length, 4);
  const { run, qualified } = setup(t);
  const exact = qualified.fixtures[0].frames.find(f => f.kind === 'completed').text;
  for (const marker of provenance.markers) {
    for (let row = 0; row < 35; row++) {
      const modified = lines(observed, rows => { rows[row] = marker; });
      assert.equal(classifyClaudeLaunchCompletion(screen(modified)), 'blocked', `${marker} row ${row}`);
    }
    for (const base of [observed, exact]) {
      const x = run(lines(base, rows => { rows[0] = marker; }));
      assert.equal(x.result.status, 'blocked', marker); assert.equal(x.sends, 1);
      assert.equal(x.result.answers[0].status, 'submitted'); assert.equal(x.retained, 1);
      assert.equal(x.saved[0].outcome, 'blocked'); assert.equal(x.saved[0].recognition, 'unmatched');
    }
    const exactWithMarker = lines(observed, rows => { rows[0] = marker; });
    const precedence = run(exactWithMarker, { exactOverride: true });
    assert.equal(precedence.result.status, 'blocked', 'marker overrides even an otherwise exact accepted completion: ' + marker);
    assert.equal(precedence.sends, 1);
  }
  const x = run(prompt); // repeated channel question after its sole Enter
  assert.equal(x.sends, 1); assert.equal(x.result.status, 'blocked');
});

test('SOURCE-DERIVED SYNTHETIC six modes / five efforts / exact finite hints and alignment', () => {
  const modes = [['default', '⏸ manual mode on'], ['plan', '⏸ plan mode on'], ['acceptEdits', '⏵⏵ accept edits on'],
    ['bypassPermissions', '⏵⏵ bypass permissions on'], ['dontAsk', "⏵⏵ don't ask on"], ['auto', '⏵⏵ auto mode on']];
  const efforts = ['○ low · /effort', '◐ medium · /effort', '● high · /effort', '◉ xhigh · /effort', '◈ max · /effort'];
  for (const [mode, label] of modes) for (const cycle of mode === 'default' ? [''] : ['', ' (shift+tab to cycle)']) {
    const hints = ['', ' · ← for agents', ' · esc to interrupt', ' · esc to interrupt · ← for agents',
      ...(mode === 'default' ? [' · ? for shortcuts', ' · ? for shortcuts · ← for agents'] : [])];
    for (const hint of hints) for (const right of efforts) {
      const left = label + cycle + hint, row = '  ' + left + ' '.repeat(106 - left.length - right.length) + right;
      const text = lines(observed, rows => { rows[14] = row; });
      assert.equal(classifyClaudeLaunchCompletion(screen(text)), 'completed', `${mode}/${cycle}/${hint}/${right}`);
      assert.equal(classifyClaudeLaunchCompletion(screen(lines(text, rows => { rows[14] = row.replace('  ', ' '); }))), null);
    }
  }
  for (const hint of ['? for shortcuts', 'esc to interrupt']) {
    assert.equal(classifyClaudeLaunchCompletion(screen(lines(observed, rows => { rows[0] = hint; }))), 'completed');
  }
});

test('unsupported regions and controls do not become completion from prompt/status lookalikes', t => {
  const { run } = setup(t);
  const mutations = [
    r => { r[12] = '❯ '; }, r => { r[12] = '❯ transcript'; }, r => { r[12] = '$\u00a0'; },
    r => { r[11] = '─'.repeat(109); }, r => { r[13] = '─'.repeat(109); },
    r => { r[14] = r[14].replace('bypass permissions', 'unknown mode'); },
    r => { r[14] = r[14].replace('◐ medium', '● medium'); },
    r => { r[14] = r[14].replace('◐ medium · /effort', ''); },
    r => { r[14] += ' '; }, r => { r[14] = r[14].replace(' · /effort', ' · ultracode · /effort'); },
    r => { r[15] = 'Update available'; }, r => { r[14] = ''; },
    r => { r[0] = '\x1b[0m'; }, r => { r[0] = '\r'; }, r => { r[0] = '\t'; },
    r => { r[0] = 'x'.repeat(65536); }, r => { r.push(''); }, r => { r.pop(); },
  ];
  for (const mutate of mutations) {
    const text = lines(observed, mutate);
    assert.equal(classifyClaudeLaunchCompletion(screen(text)), null);
    const x = run(text); assert.equal(x.result.status, 'blocked'); assert.equal(x.sends, 1);
  }
  // Identical region is not bottom UI if nonempty content follows it.
  const lookalike = lines(observed, r => { r[34] = 'not a footer'; });
  assert.equal(classifyClaudeLaunchCompletion(screen(lookalike)), null);
});

test('existing exact API/Max completion stays completed; structural policy ignores header/transcript only after input', t => {
  const { run, qualified } = setup(t);
  for (const f of qualified.fixtures[0].frames.filter(f => f.kind === 'completed' && f.after.length === 1)) {
    const x = run(f.text); assert.equal(x.result.status, 'completed'); assert.equal(x.sends, 1);
    assert.equal(x.retained, 0, 'an existing exact completion does not acquire structural evidence requirements');
  }
  const x = run(lines(observed, r => { r[0] = 'Unknown dialog text without a known marker'; }));
  assert.equal(x.result.status, 'completed', 'explicitly accepted unknown-dialog reporting risk, not absence proof');
  const before = run(observed, { before: observed });
  assert.equal(before.result.status, 'blocked'); assert.equal(before.sends, 0); assert.equal(before.classified, 0);
});

test('save/audit/ownership/consent/send failures preserve the answer and permanently close authority', t => {
  const { run } = setup(t);
  for (const options of [{ save: 'failed' }, { save: 'throw' }, { noWriter: true }, { auditFailure: 'completed' }, { restoreFailed: true }]) {
    const x = run(observed, options); assert.equal(x.result.status, 'incomplete'); assert.equal(x.sends, 1);
    assert.equal(x.result.answers[0].status, 'submitted'); assert.ok(!JSON.stringify(x.result).includes('PRIVATE ERROR'));
    if (options.save || options.noWriter) assert.ok(x.events.some(e => e.status === 'incomplete'));
  }
  const block = lines(observed, r => { r[0] = 'Do you want to proceed?'; });
  const failed = run(block, { save: 'failed' });
  assert.equal(failed.result.status, 'blocked'); assert.match(failed.result.reason, /; private launch evidence retention failed$/);
  const audit = run(block, { auditFailure: 'blocked' }); assert.equal(audit.result.status, 'incomplete');
  for (const sendStatus of ['failed', 'uncertain']) {
    const x = run(observed, { sendStatus }); assert.equal(x.result.status, 'incomplete');
    assert.equal(x.classified, 0); assert.equal(x.retained, 0); assert.equal(x.sends, 1);
  }
  for (const options of [{ consent: false }, { version: true }]) {
    const x = run(observed, options); assert.equal(x.result.status, 'blocked'); assert.equal(x.sends, 0); assert.equal(x.classified, 0);
  }
  for (const options of [{ screen: { width: 111 } }, { screen: { height: 36 } }, { stalePid: true }]) {
    const x = run(observed, options); assert.equal(x.result.status, 'blocked'); assert.equal(x.sends, 1);
  }
  const replaced = run(observed, { replaceHome: true });
  assert.equal(replaced.result.status, 'incomplete'); assert.equal(replaced.retained, 0);
});

for (const change of [{ badPin: true }, { platform: 'linux' }, { arch: 'x64' }, { argv: [] }]) {
  test(`unqualified executable/platform/argv cannot enable structural recognition: ${JSON.stringify(change)}`, t => {
    const { qualified, run } = setup(t, change);
    assert.equal(qualified.classifyCompletion, undefined);
    const x = run(); assert.equal(x.result.status, 'blocked'); assert.equal(x.sends, 0); assert.equal(x.classified, 0);
  });
}
