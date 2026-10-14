// What a blocked launch differed in (OATS 0.52.0, awebai/oats#917): the words (packages/client
// `differedLines`), the one component that shows them (renderer/launch-differed.mjs), and the two places
// of a spawn: the Spawn dialog's result and the background notice. Fixtures: helpers/launch-prompt-fixture.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { differedLines, retainedSpawnMessage, retainedSpawnDetails, DIFFERED_LEAD_IN, DIFFERED_NO_TEXT, DIFFERED_IN_ACTIVITY } from '../../client/launch-prompt-outcome.mjs';
import { launchDiffered, launchDifferedCSS } from '../renderer/launch-differed.mjs';
import { retained, differed, DIFFERED, EXPECTED, FOUND } from './helpers/launch-prompt-fixture.mjs';

const withDiffered = (d, value = differed()) => { const r = retained(d); return { ...r, launchPrompts: { ...r.launchPrompts, differed: value } }; };

test('differedLines: the lead-in, the two labelled texts and the data for Details', () => {
  assert.deepEqual(differedLines(differed({ index: 212 })), { leadIn: 'Where the screen first differed from the confirmation OATS answers:',
    lines: [{ leadIn: 'OATS expected:', text: EXPECTED, note: null }, { leadIn: 'The terminal showed:', text: FOUND, note: null }],
    detail: 'Nearest entry aweb-dev-channel-confirmation-1, first difference at 212' });
  // The outcome reader's own answer says the same.
  assert.deepEqual(differedLines(DIFFERED), differedLines(differed()));
  assert.equal(DIFFERED_LEAD_IN, 'Where the screen first differed from the confirmation OATS answers:');
});
test('differedLines: a side with nothing to show reads "(no visible text)"; a withheld side is withheld alone', () => {
  const ended = differedLines(differed({ found: '' }));
  assert.deepEqual(ended.lines[1], { leadIn: 'The terminal showed:', text: null, note: '(no visible text)' });
  assert.deepEqual(ended.lines[0], { leadIn: 'OATS expected:', text: EXPECTED, note: null });
  assert.equal(differedLines(differed({ expected: '' })).lines[0].note, DIFFERED_NO_TEXT);
  const withheld = differedLines(differed({ found: 'password: hunter2' }));
  assert.deepEqual(withheld.lines.map(l => l.text), [EXPECTED, '[withheld]']);
});
test('differedLines: nothing decodable says nothing', () => {
  for (const bad of [undefined, null, 'x', {}, differed({ index: -1 }), differed({ found: 7 })]) assert.equal(differedLines(bad), null);
});

const page = () => new JSDOM('<!doctype html><html><body></body></html>').window.document;
test('component: one labelled group; each text in the quote treatment under its own lead-in', () => {
  const doc = page(), group = launchDiffered(doc, differed());
  assert.equal(group.className, 'launch-differed'); assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.querySelector(`#${group.getAttribute('aria-labelledby')}`).textContent, DIFFERED_LEAD_IN);
  const quotes = [...group.querySelectorAll('.source-quote')];
  assert.equal(quotes.length, 2);
  for (const [quote, leadIn, text] of [[quotes[0], 'OATS expected:', EXPECTED], [quotes[1], 'The terminal showed:', FOUND]]) {
    assert.equal(quote.getAttribute('role'), 'group');
    assert.equal(quote.querySelector(`#${quote.getAttribute('aria-labelledby')}`).textContent, leadIn);
    const block = quote.querySelectorAll('blockquote.source-quote-text');
    assert.equal(block.length, 1); assert.equal(block[0].textContent, text); assert.equal(block[0].children.length, 0);
  }
  // The terminal's text is in its quote and nowhere in the Desktop's own lead-in.
  assert.equal(group.querySelector('.launch-differed-lead').textContent.includes(FOUND), false);
});
test('component: hostile terminal text stays literal text; bidi controls and line breaks are filtered', () => {
  const doc = page(), group = launchDiffered(doc, differed({ found: '<img src=x onerror=alert(1)>\u202E\tok' }));
  const block = group.querySelectorAll('blockquote')[1];
  assert.equal(block.textContent, '<img src=x onerror=alert(1)>\uFFFD ok');
  assert.equal(group.querySelectorAll('img, a, button').length, 0);
});
test('component: a side with nothing to show has a plain note and no quote; undecodable is null', () => {
  const doc = page(), group = launchDiffered(doc, differed({ found: '' }));
  const [expected, found] = group.querySelectorAll('.source-quote');
  assert.equal(expected.querySelectorAll('blockquote').length, 1);
  assert.equal(found.querySelectorAll('blockquote').length, 0);
  assert.equal(found.querySelector('.source-quote-note').textContent, '(no visible text)');
  assert.equal(found.querySelector('.source-quote-lead').textContent, 'The terminal showed:');
  assert.equal(launchDiffered(doc, differed({ index: -1 })), null);
  assert.equal(launchDiffered(doc, null), null);
  // Two groups in one document never share an id.
  const other = launchDiffered(doc, differed());
  assert.notEqual(other.getAttribute('aria-labelledby'), group.getAttribute('aria-labelledby'));
});
test('component: its CSS paints with tokens only', () => {
  assert.doesNotMatch(launchDifferedCSS, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(|opacity/i);
  assert.match(launchDifferedCSS, /\.launch-differed-lead \{[^}]*color:var\(--muted\)/);
});

test('Spawn dialog: what differed sits under the status, never inside it; Details names the entry and the position', async t => {
  const { mountSpawn, kernel, settle } = await import('./helpers/spawn-dialog-host.mjs');
  const decision = kernel('preview-worktree-purpose').result.decision;
  const u = await mountSpawn(t, { apply: () => ({ started: true, envelope: { schemaVersion: 1, ok: false,
    error: { code: 'E_SPAWN_INCOMPLETE', details: withDiffered(decision, differed({ index: 212 })) } } }) });
  await u.open(); await u.type('.fpurpose', 'api-v2'); u.q('.fspawn').click(); await settle(20);
  const status = u.q('.fstatus'), box = u.q('.spawn-status-differed');
  assert.equal(status.textContent, retainedSpawnMessage(retainedSpawnDetails(withDiffered(decision))));
  assert.match(status.textContent, /blocked: unexpected prompt/);
  assert.equal(status.textContent.includes(FOUND), false); assert.equal(status.textContent.includes(EXPECTED), false);
  assert.equal(status.contains(box), false);
  const group = box.querySelector('.launch-differed');
  assert.equal(group.querySelector('.launch-differed-lead').textContent, DIFFERED_LEAD_IN);
  assert.deepEqual([...group.querySelectorAll('.source-quote-lead')].map(n => n.textContent), ['OATS expected:', 'The terminal showed:']);
  assert.deepEqual([...group.querySelectorAll('blockquote')].map(n => n.textContent), [EXPECTED, FOUND]);
  assert.match(u.q('.spawn-problem-detail').textContent, /^E_SPAWN_INCOMPLETE · .* · Nearest entry aweb-dev-channel-confirmation-1, first difference at 212$/);
  assert.equal(u.q('.spawn-problem-detail').textContent.includes(FOUND), false);
  assert.equal(u.q('.fspawn').disabled, true);
  // The dialog's styles hold the component's and the quote treatment's.
  const css = [...u.doc.querySelectorAll('style')].map(s => s.textContent).join('\n');
  assert.ok(css.includes('.launch-differed-lead') && css.includes('.source-quote-text'));
});
test('Spawn dialog: no lines without differed, with a malformed one, or for a status that is not blocked', async t => {
  const { mountSpawn, kernel, settle } = await import('./helpers/spawn-dialog-host.mjs');
  const decision = kernel('preview-worktree-purpose').result.decision;
  for (const details of [retained(decision), withDiffered(decision, { nearest: 'x', firstDifference: { index: -1, expected: 'a', found: 'b' } }),
    { ...retained(decision, 'incomplete'), launchPrompts: { ...retained(decision, 'incomplete').launchPrompts, differed: differed() } }]) {
    const u = await mountSpawn(t, { apply: () => ({ started: true, envelope: { schemaVersion: 1, ok: false, error: { code: 'E_SPAWN_INCOMPLETE', details } } }) });
    await u.open(); await u.type('.fpurpose', 'api-v2'); u.q('.fspawn').click(); await settle(20);
    assert.match(u.q('.fstatus').textContent, /Inspect its existing pane, then use oats session start --home/);
    assert.equal(u.q('.spawn-status-differed'), null);
    assert.doesNotMatch(u.q('.spawn-problem-detail').textContent, /Nearest entry/);
    u.doc.querySelector('.spawn-dialog .fcancel')?.click(); await settle(3);
  }
});
test('Spawn dialog: the lines go when the status is no longer that sentence', async t => {
  const { mountSpawn, kernel, settle } = await import('./helpers/spawn-dialog-host.mjs');
  const decision = kernel('preview-worktree-purpose').result.decision;
  const u = await mountSpawn(t, { apply: () => ({ started: true, envelope: { schemaVersion: 1, ok: false, error: { code: 'E_SPAWN_INCOMPLETE', details: withDiffered(decision) } } }) });
  await u.open(); await u.type('.fpurpose', 'api-v2'); u.q('.fspawn').click(); await settle(20);
  assert.equal(u.q('.spawn-status-differed').children.length, 1);
  assert.deepEqual([...u.q('.spawn-footer').children].map(el => el.className), ['spawn-status', 'spawn-actions', 'spawn-status-differed', 'spawn-problem-detail']);
  await u.type('.fpurpose', 'docs');
  assert.doesNotMatch(u.q('.fstatus').textContent, /blocked: unexpected prompt/);
  assert.equal(u.q('.spawn-status-differed'), null);
});

test('background notice: with differed, the sentence and where the two texts are; never the terminal\'s text', async t => {
  const { mountSpawn, kernel, settle } = await import('./helpers/spawn-dialog-host.mjs');
  const decision = kernel('preview-worktree-purpose').result.decision;
  const u = await mountSpawn(t, { jobs: true, apply: () => ({ started: true, envelope: { schemaVersion: 1, ok: false,
    error: { code: 'E_SPAWN_INCOMPLETE', details: withDiffered(decision, differed({ index: 212 })) } } }) });
  await u.open(); await u.type('.fpurpose', 'api-v2'); u.q('.fspawn').click(); await settle(30);
  const note = u.notices.find(n => /was retained/.test(n.message));
  assert.ok(note, JSON.stringify(u.notices.map(n => n.message)));
  assert.equal(note.message, `${retainedSpawnMessage(retainedSpawnDetails(withDiffered(decision)))} Its Activity shows what OATS expected and what the terminal showed.`);
  assert.equal(note.message.endsWith(DIFFERED_IN_ACTIVITY), true);
  assert.match(note.options.detail, / · Nearest entry aweb-dev-channel-confirmation-1, first difference at 212$/);
  for (const text of [note.message, note.options.detail]) { assert.equal(text.includes(FOUND), false); assert.equal(text.includes(EXPECTED), false); }
});
test('background notice: without differed the sentence is absent', async t => {
  const { mountSpawn, kernel, settle } = await import('./helpers/spawn-dialog-host.mjs');
  const decision = kernel('preview-worktree-purpose').result.decision;
  for (const details of [retained(decision), withDiffered(decision, 'not a difference'),
    { ...retained(decision, 'incomplete'), launchPrompts: { ...retained(decision, 'incomplete').launchPrompts, differed: differed() } }]) {
    const u = await mountSpawn(t, { jobs: true, apply: () => ({ started: true, envelope: { schemaVersion: 1, ok: false, error: { code: 'E_SPAWN_INCOMPLETE', details } } }) });
    await u.open(); await u.type('.fpurpose', 'api-v2'); u.q('.fspawn').click(); await settle(30);
    const note = u.notices.find(n => /was retained/.test(n.message));
    assert.ok(note);
    assert.equal(note.message, retainedSpawnMessage(retainedSpawnDetails(details)));
    assert.doesNotMatch(note.message, /Its Activity shows/);
    assert.doesNotMatch(note.options.detail ?? '', /Nearest entry/);
    u.jobs.dispose();
  }
});
