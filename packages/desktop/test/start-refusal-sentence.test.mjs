// The Start and Restart dialog says one refusal in the Desktop's words (awebai/oats#1079): a start, a restart
// or a launch preview refused with E_LAUNCH_CONFIG_AMBIGUOUS reads the Desktop's sentence
// (packages/client/start-messages.mjs), which names the dialog's own two controls, with the kernel's message
// as one filtered line under it (renderer/speaker-line.mjs `kernelLines`). Every other refusal reads as before.
// Also held: how much of that message the launch-configs route answers, and that no other route changed.
// No kernel sentence is written in this file: every message is a text of the tests' own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LAUNCH_CONFIG_NONE } from '../../client/launch-contract.mjs';
import { startRefusalSentence } from '../../client/start-messages.mjs';
import { MAX_DISPLAY_LINE } from '../../client/display-text.mjs';
import { MARKUP, CONTROL, DETAIL_WITHHELD } from './helpers/speaker-cases.mjs';
import { CODE, OTHER_CODE, LABEL, SENTENCE, PREVIEW_ONLY, SAID, LONG, PLACES, home, refusal, settle, http, dialog, refuse, refuseAsResponse } from './helpers/start-dialog.mjs';

/* ── The sentence ── */

test('startRefusalSentence: the Desktop\'s sentence for this one code, and nothing for any other', () => {
  assert.equal(startRefusalSentence(CODE), SENTENCE);
  for (const other of [OTHER_CODE, 'E_SPAWN_INCOMPLETE', '', undefined, null, 5, 'toString', 'constructor', '__proto__', CODE.toLowerCase(), ` ${CODE}`]) assert.equal(startRefusalSentence(other), null, String(other));
  // It names the dialog's own two controls, as the dialog writes them, in straight quotes, and no machine.
  assert.ok(SENTENCE.includes(`"${LABEL.slice(0, LABEL.indexOf(' ('))}"`) && SENTENCE.includes('under Launch configuration'));
  assert.doesNotMatch(SENTENCE, /[‘’“”]|machine|computer|server/);
});

/* ── How much of the refusal's message the launch-configs route answers ── */

const previewBody = { action: 'preview', selector: { home }, choices: { harness: 'codex' } };

test('the launch-configs route answers this refusal\'s message up to the shared home\'s display bound, and every other refusal cut at 300 as before', async () => {
  const refusedWith = (code, message) => http({ invoke: async () => refusal(code, message) })({ body: previewBody });
  assert.ok(LONG.length > 300 && LONG.length < MAX_DISPLAY_LINE);
  // Longer than 300 and within the bound: whole.
  assert.deepEqual(await refusedWith(CODE, LONG), { status: 409, body: { error: LONG, code: CODE } });
  // Longer than the bound: no longer than the bound, and a beginning of the message.
  const beyond = `${'y'.repeat(MAX_DISPLAY_LINE)} and more`;
  const cut = (await refusedWith(CODE, beyond)).body.error;
  assert.equal(cut, 'y'.repeat(MAX_DISPLAY_LINE));
  // The bound never splits a character in two.
  const astral = `${'y'.repeat(MAX_DISPLAY_LINE - 1)}\u{1F600} and more`;
  assert.equal((await refusedWith(CODE, astral)).body.error, 'y'.repeat(MAX_DISPLAY_LINE - 1));
  // Another code's message is cut at 300, as today.
  assert.deepEqual(await refusedWith(OTHER_CODE, LONG), { status: 409, body: { error: LONG.slice(0, 300), code: OTHER_CODE } });
});

test('the exception is the launch-configs route\'s alone: a spawn on a server refused with the same code is cut at 300 as before', async () => {
  const spawned = await http({ spawnAgent: async () => { throw Object.assign(new Error(LONG), { code: CODE }); } })({ url: '/api/spawn', body: { agent: 'dev', agentsRoot: '/team/agents', serverId: 'host' } });
  assert.deepEqual(spawned, { status: 409, body: { error: LONG.slice(0, 300), code: CODE } });
});

/* ── The dialog ── */

for (const [place, at] of PLACES) for (const [hop, refused] of [['thrown by the shell', refuse], ['a response of the route', refuseAsResponse]])
  test(`${place}, refused with ${CODE} (${hop}): the Desktop's sentence is the status and the kernel's message is one line under it`, async () => {
    const d = dialog({ ...at, start: refused(CODE, SAID) });
    try {
      await settle();
      d.choose(d.harness, 'codex');
      await d.submit();
      assert.equal(d.q('.start-status').textContent, SENTENCE);
      const outcome = d.q('.start-outcome');
      assert.equal(outcome.hidden, false);
      assert.deepEqual([...outcome.children].map(line => [line.tagName, line.className, line.textContent]), [['P', 'start-kernel-says', `OATS says: ${SAID}`]]);
      assert.equal(outcome.querySelector('bdi'), null);
      assert.equal(d.modal.isConnected, true, 'the dialog stays');
      assert.equal(d.harness.disabled, false, 'the Harness list is usable for another choice');
      // As after any refusal today: the button is offered again only after Refresh status, and the lines go with the sentence.
      assert.equal(d.q('.start-submit').disabled, true);
      d.q('.start-retry').click(); await settle();
      assert.equal(outcome.hidden, true); assert.equal(outcome.children.length, 0);
      assert.notEqual(d.q('.start-status').textContent, SENTENCE);
    } finally { d.close(); }
  });

test('the kernel\'s line is filtered: a long message whole, markup as text, a withheld one with no name before it, and none at all for no message', async () => {
  const shown = async message => {
    const d = dialog({ start: refuse(CODE, message) });
    try { await settle(); await d.submit(); const outcome = d.q('.start-outcome'); return { status: d.q('.start-status').textContent, hidden: outcome.hidden, lines: [...outcome.children].map(line => line.textContent), markup: outcome.querySelector('b, script') }; }
    finally { d.close(); }
  };
  assert.deepEqual(await shown(LONG), { status: SENTENCE, hidden: false, lines: [`OATS says: ${LONG}`], markup: null });
  assert.deepEqual(await shown(MARKUP), { status: SENTENCE, hidden: false, lines: [`OATS says: ${MARKUP}`], markup: null });
  assert.deepEqual(await shown(CONTROL), { status: SENTENCE, hidden: false, lines: [DETAIL_WITHHELD], markup: null });
  assert.deepEqual(await shown(''), { status: SENTENCE, hidden: true, lines: [], markup: null });
});

for (const [place, at] of PLACES) test(`${place}: a preview refused with ${CODE} reads the sentence, then that it was a preview only, and the kernel's line under it`, async () => {
  let refusing = true;
  const d = dialog({ ...at, preview: body => refusing ? refuse(CODE, SAID)() : { command: 'the-command', ok: true } });
  try {
    await settle();
    d.choose(d.harness, 'codex');
    await d.preview();
    assert.equal(d.q('.launch-config-status').textContent, `${SENTENCE} ${PREVIEW_ONLY}`);
    const said = d.q('.launch-config-said');
    assert.equal(said.hidden, false);
    assert.deepEqual([...said.children].map(line => [line.tagName, line.className, line.textContent]), [['P', 'start-kernel-says', `OATS says: ${SAID}`]]);
    assert.equal(d.q('.launch-preview-output').hidden, true);
    assert.equal(d.calls.some(call => call.path.startsWith('/api/start/') || call.path.startsWith('/api/restart/')), false, 'nothing was started');
    // The lines belong to that status: the next preview replaces both.
    refusing = false; d.choose(d.select, LAUNCH_CONFIG_NONE);
    await d.preview();
    assert.equal(d.q('.launch-config-status').textContent, PREVIEW_ONLY);
    assert.equal(said.hidden, true); assert.equal(said.children.length, 0);
    assert.equal(d.q('.launch-preview-output').hidden, false);
  } finally { d.close(); }
});

test('a refused preview\'s kernel line is filtered as the start\'s is: withheld with no name before it', async () => {
  const d = dialog({ preview: refuse(CODE, CONTROL) });
  try {
    await settle(); await d.preview();
    assert.equal(d.q('.launch-config-status').textContent, `${SENTENCE} ${PREVIEW_ONLY}`);
    assert.deepEqual([...d.q('.launch-config-said').children].map(line => line.textContent), [DETAIL_WITHHELD]);
  } finally { d.close(); }
});

test('every other refusal reads as before: the answer\'s message as the status, at a start, a restart and a preview, with no line under it', async () => {
  for (const restart of [false, true]) {
    const d = dialog({ restart, start: refuse(OTHER_CODE, SAID), preview: refuse(OTHER_CODE, SAID) });
    try {
      await settle();
      await d.preview();
      assert.equal(d.q('.launch-config-status').textContent, SAID);
      assert.equal(d.q('.launch-config-said').hidden, true); assert.equal(d.q('.launch-config-said').children.length, 0);
      await d.submit();
      assert.equal(d.q('.start-status').textContent, SAID);
      assert.equal(d.q('.start-outcome').hidden, true); assert.equal(d.q('.start-outcome').children.length, 0);
      assert.equal(d.q('.start-submit').disabled, true);
    } finally { d.close(); }
  }
  // A refusal with no code at all (a transport failure) too. With the choice made, the Harness list stays usable after it.
  const d = dialog({ start: () => { throw new Error(SAID); } });
  try {
    await settle(); d.choose(d.select, LAUNCH_CONFIG_NONE); await d.submit();
    assert.equal(d.q('.start-status').textContent, SAID); assert.equal(d.q('.start-outcome').hidden, true);
    assert.equal(d.harness.disabled, false);
  } finally { d.close(); }
});
