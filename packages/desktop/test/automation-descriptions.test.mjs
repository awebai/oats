// Automation summaries (kernel 0.43, feature automation-descriptions): the list row's summary line
// (authored, derived from the prompt, or "No summary"; never from argv), the detail page's cards
// (what it sends, Spawns, Run state, Invalid/Unreadable, Comes from) and Edit summary, the feature
// gate and the schedule form's Summary field. Read from the REAL kernel's output on the K branch
// (fixtures/automation-descriptions, capture-descriptions.mjs + provenance.json): local schedules of
// every run (command with a summary; wake, operation, spawn without), local triggers with and without,
// workspace triggers made from a package template, and run state from the kernel's own state files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { automationRows, summaryLine, runState, reconcileCommand, templateProvenance } from '../renderer/automation-rows.mjs';
import { createAutomationsView, mountAutomationsPage, automationDescriptionsSupported } from '../renderer/views/automations.mjs';
import { setWorkspace } from '../renderer/views/common.mjs';
import { setup, posts } from './helpers/schedules-view.mjs';

const doc = name => JSON.parse(readFileSync(new URL(`./fixtures/automation-descriptions/${name}.json`, import.meta.url), 'utf8'));
const fx = name => doc(name).result;
const provenance = doc('provenance');
const NOW = Date.parse('2026-10-06T10:00:00.000Z');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const rowsOf = kind => Object.fromEntries(automationRows(fx(`${kind}-list`), kind).rows.map(r => [r.id, r]));

function mount(t, kind, { json = fx(`${kind}-list`), describe = null, ...more } = {}) {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { pretendToBeVisual: true });
  const host = dom.window.document.querySelector('main');
  let current = json; const reads = [];
  const view = createAutomationsView(host, { kind, read: async () => { reads.push(1); return structuredClone(current); }, now: () => NOW, describe, ...more });
  t.after(() => { view.dispose(); dom.window.close(); });
  const $ = s => host.querySelector(s), $$ = s => [...host.querySelectorAll(s)];
  const row = id => $$('.auto-row').find(r => r.dataset.id === id);
  const facts = card => Object.fromEntries([...$(`.page-card[data-card="${card}"]`).querySelectorAll('.page-kv')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd').textContent]));
  const key = (k, opts = {}) => (dom.window.document.activeElement || host).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  return { dom, host, view, $, $$, row, facts, key, reads, set: next => { current = next; }, active: () => dom.window.document.activeElement };
}
/** A promise the test settles by hand: a save that answers late, or fails late. */
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

test('the capture: the kernel reports automation-descriptions; summaries fill in on both kinds; out-of-rule headers are warnings', () => {
  assert.equal(provenance.kernelTree.includes('agents/oats-kernel-developer-automation-descriptions @'), true);
  assert.ok(doc('version').features.includes('automation-descriptions'));
  assert.equal(automationDescriptionsSupported({ ok: true, ...doc('version') }), true);
  assert.equal(automationDescriptionsSupported({ ok: true, ...doc('version'), features: doc('version').features.filter(f => f !== 'automation-descriptions') }), false, 'reads need no gate; writes do');
  assert.equal(automationDescriptionsSupported(null), false);
  const problems = fx('sync').problems.filter(p => p.code === 'E_AUTOMATION_SCHEMA').map(p => p.path).sort();
  assert.deepEqual(problems, ['oats-triggers/from-bad-header.yaml#/description', 'ops/nightly.oats-schedule.yaml#/description']);
  const s = rowsOf('schedule'), t = rowsOf('trigger');
  assert.deepEqual(Object.values(s).map(r => [r.id, r.run, r.description]), [['local/digest', 'spawn', null], ['local/harvest', 'operation', null], ['local/standup', 'wake', null],
    ['local/status', 'command', 'Morning workspace status'], ['local/threw', 'command', null], ['ws/nightly', 'spawn', null]], 'the out-of-rule header loads with description null');
  assert.equal(s['ws/nightly'].runsHere, true, 'and still runs');
  assert.deepEqual(Object.values(t).map(r => [r.id, r.description]), [['local/kb-review', 'Reviews every harvest PR'], ['local/kb-triage', null],
    ['ws/from-bad-header', 'Review each harvest PR (template)'], ['ws/from-header', 'The header wins'], ['ws/from-template', 'Review each harvest PR (template)']]);
});

test('the adapter reads what each run sends, the spawn settings, run state and provenance explicitly, never from raw', () => {
  const s = rowsOf('schedule'), t = rowsOf('trigger');
  const status = s['local/status'], standup = s['local/standup'], harvest = s['local/harvest'], digest = s['local/digest'];
  assert.deepEqual(status.argv, ['oats', 'status', '--json', '--dir', 'a dir/with spaces']); assert.equal(status.cwd, '/fixture/base/deployment');
  assert.equal(standup.message, '\n  Post the standup summary to the team.\nThen check the release branch.', 'verbatim');
  assert.equal(standup.home, '/fixture/base/deployment/agents/reviewer/instances/reviewer-1');
  assert.deepEqual([harvest.operation, harvest.home], ['knowledge:harvest', standup.home]);
  assert.deepEqual([digest.purpose, digest.harness, digest.model, digest.yolo, digest.backend], ['digest', 'claude', 'opus', false, 'tmux']);
  assert.deepEqual(digest.wake, { cron: '0 12 * * *', tz: 'UTC', message: 'Midday: post progress.' });
  assert.equal(t['local/kb-review'].purpose, '{trigger}-{number}', "a trigger's purpose sits under spawn");
  assert.deepEqual([status.createdAt, status.scope], [fx('schedule-list').schedules.find(r => r.id === 'status').createdAt, '/fixture/base/deployment']);
  assert.equal(templateProvenance(t['ws/from-template'].template), 'acme.pkg:harvest-review v1.0.0 @d672657');
  assert.equal(templateProvenance({ from: 'acme.pkg:harvest-review' }), 'acme.pkg:harvest-review', "a workspace trigger's `from:` alone");
  assert.equal(templateProvenance(null), null);
  // Run state, from the kernel's state files.
  assert.deepEqual(runState(status), { running: { since: '2026-10-06T08:30:04.000Z' }, unknown: null, pendingWake: null }, 'the job lock + its attempt');
  assert.deepEqual(runState(standup).unknown, { since: '2026-10-06T07:00:03.000Z', scheduledFor: '2026-10-06T07:00:00.000Z', holdsSlot: false, exited: true, exitStatus: 1, exitSignal: null, error: 'the wake was not confirmed' });
  // A held lock is a slot, not a launch: the kernel's run-now whose launcher threw keeps its lock with
  // an unconfirmed attempt (running: true, lastRun unknown). Unknown wins, and says it holds the slot.
  const threw = s['local/threw'];
  assert.deepEqual([threw.running, threw.lastRun.outcome, threw.attempt.error], [true, 'unknown', 'the command launcher failed'], 'the capture');
  assert.equal(runState(threw).running, null);
  assert.deepEqual(runState(threw).unknown, { since: '2026-10-06T09:00:00.000Z', scheduledFor: '2026-10-06T09:00:00.000Z', holdsSlot: true, exited: null, exitStatus: null, exitSignal: null, error: 'the command launcher failed' });
  assert.equal(runState({ ...threw, attempt: null, lastRun: { outcome: 'launched', startedAt: '2026-10-06T09:00:00.000Z' } }).running.since, '2026-10-06T09:00:00.000Z', 'a launched spawn holding its slot: running since its launch');
  assert.deepEqual(runState(digest), { running: null, unknown: null, pendingWake: { scheduledFor: '2026-10-06T12:00:00.000Z' } });
  assert.equal(runState(harvest), null); assert.equal(runState(t['local/kb-review']), null, 'triggers have no run state card');
  assert.deepEqual(runState({ ...harvest, lastRun: { outcome: 'unknown', startedAt: '2026-10-06T06:00:00.000Z' } }).unknown.since, '2026-10-06T06:00:00.000Z', 'a last run of unknown outcome');
  // The reconcile text is a command that works when pasted: the captured reconcile used the qualified id.
  assert.deepEqual(provenance.files['schedule-reconcile'].argv, ['oats', 'schedule', 'reconcile', 'local/standup', '--json']);
  assert.equal(doc('schedule-reconcile').ok, true);
  assert.equal(reconcileCommand(standup), 'oats schedule reconcile local/standup --dir /fixture/base/deployment');
  assert.equal(reconcileCommand({ ...standup, scope: "/a b/it's" }, { clear: true }), "oats schedule reconcile local/standup --clear --dir '/a b/it'\\''s'");
});

test('summary line: authored as text; else the first non-empty line of the task or wake message, marked derived; else "No summary"', () => {
  const s = rowsOf('schedule'), t = rowsOf('trigger');
  assert.deepEqual(summaryLine(s['local/status']), { text: 'Morning workspace status', title: 'Morning workspace status', derived: false });
  const derived = text => ({ text, title: 'No summary set — first line of the prompt', derived: true });
  assert.deepEqual(summaryLine(s['local/standup']), derived('Post the standup summary to the team.'), "a wake's message, past its blank first line");
  assert.deepEqual(summaryLine(s['local/digest']), derived('Write the nightly digest.'));
  assert.deepEqual(summaryLine(t['local/kb-triage']), derived('Triage {repo}#{number} and label it.'));
  assert.equal(summaryLine(s['local/harvest']), null, 'an operation: no summary');
  assert.equal(summaryLine({ ...s['local/status'], description: null }), null, 'a command: never a label made from its argv');
});

test('list rows: the bare name beside its origin tag, then the summary line in its three styles', async t => {
  const u = mount(t, 'schedule'); await tick();
  const status = u.row('local/status');
  assert.equal(status.querySelector('.auto-id').textContent, 'status', 'not local/status: the tag says local');
  assert.equal(status.querySelector('.auto-id').title, 'local/status');
  assert.equal(status.querySelector('.auto-open').getAttribute('aria-label'), 'Open local/status', 'the accessible name keeps the address');
  assert.equal(status.querySelector('.auto-tag').textContent, 'local');
  assert.equal(u.row('ws/nightly').querySelector('.auto-tag').textContent, 'ws', 'a member item: its member as the tag');
  const summary = id => u.row(id).querySelector('.auto-summary');
  assert.deepEqual([summary('local/status').textContent, summary('local/status').title, summary('local/status').className], ['Morning workspace status', 'Morning workspace status', 'auto-sub auto-summary']);
  assert.deepEqual([summary('local/standup').textContent, summary('local/standup').title, summary('local/standup').classList.contains('derived')],
    ['Post the standup summary to the team.', 'No summary set — first line of the prompt', true]);
  assert.deepEqual([summary('local/harvest').textContent, summary('local/harvest').classList.contains('auto-none'), summary('local/harvest').classList.contains('derived')], ['No summary', true, false]);
  const nameCell = u.row('local/status').querySelector('.auto-name').textContent;
  assert.doesNotMatch(nameCell, /oats status|--json/, 'no argv-derived label');
  // Searching still finds a row by its summary or its wake message.
  const input = u.$('.auto-search input'); input.value = 'standup summary'; input.dispatchEvent(new u.dom.window.Event('input')); await tick();
  assert.deepEqual(u.$$('.auto-row:not(.head)').map(r => r.dataset.id), ['local/standup']);
});

test('detail: the name with the qualified id under it; the summary or "No summary" + Edit summary (local, gated)', async t => {
  const plain = mount(t, 'schedule'); await tick();
  plain.view.open('local/harvest'); await tick();
  assert.equal(plain.$('.page-title').textContent, 'harvest'); assert.equal(plain.$('.auto-qid').textContent, 'local/harvest');
  assert.equal(plain.$('.page-lede').textContent, 'No summary');
  assert.equal(plain.$('.auto-page [data-verb=describe]'), null, 'no Edit summary without describe (an older kernel)');
  const u = mount(t, 'schedule', { describe: async () => ({}), openFile: () => {} }); await tick();
  u.view.open('local/harvest'); await tick();
  assert.deepEqual(u.$$('.page-lede button').map(b => b.textContent), ['Edit summary']);
  assert.deepEqual(u.$$('.page-bar-actions [data-verb=describe]').map(b => b.textContent), ['Edit summary']);
  u.view.open('local/status'); await tick();
  assert.equal(u.$('.page-lede').textContent, 'Morning workspace status'); assert.equal(u.$('.page-lede button'), null);
  assert.ok(u.$('.page-bar-actions [data-verb=describe]'), 'a command too: the form cannot edit it, the sheet can');
  u.view.open('ws/nightly'); await tick();
  assert.equal(u.$('.auto-page [data-verb=describe]'), null, 'a workspace item changes in Git'); assert.ok(u.$('.page-card[data-card="Comes from"] button'), 'Open file as today');
  const w = mount(t, 'trigger', { describe: async () => ({}) }); await tick();
  assert.deepEqual([...w.row('local/kb-review').querySelectorAll('.auto-menu button')].map(b => b.textContent), ['Open', 'Edit summary'], 'a local trigger');
  assert.equal(w.row('ws/from-template').querySelector('.auto-menu [data-verb=describe]'), null);
});

test('detail, what it sends: a command\'s argv verbatim and its cwd; a wake\'s whole message and home; an operation and its home; a spawn\'s prompt', async t => {
  const u = mount(t, 'schedule'); await tick();
  u.view.open('local/status'); await tick();
  const command = u.$('.page-section[data-section="Command"]');
  assert.deepEqual([...command.querySelectorAll('.auto-argv li')].map(li => li.textContent), ['oats', 'status', '--json', '--dir', 'a dir/with spaces'], 'one chip per argument, the spaces kept');
  assert.equal(command.querySelector('.auto-argv').getAttribute('aria-label'), 'Command arguments');
  assert.equal(command.querySelector('dd').textContent, '/fixture/base/deployment');
  assert.equal(u.$('.page-card[data-card="Spawns"]'), null, 'a command spawns nothing');
  u.view.open('local/standup'); await tick();
  const wake = u.$('.page-section[data-section="Wake message"]');
  assert.equal(wake.querySelector('.auto-prompt').textContent, '\n  Post the standup summary to the team.\nThen check the release branch.', 'the whole message, verbatim (the adapter used to drop it)');
  assert.deepEqual(Object.fromEntries([...wake.querySelectorAll('.page-kv')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd').textContent])), { Wakes: '/fixture/base/deployment/agents/reviewer/instances/reviewer-1' });
  u.view.open('local/harvest'); await tick();
  const op = u.$('.page-section[data-section="Operation"]');
  assert.deepEqual(Object.fromEntries([...op.querySelectorAll('.page-kv')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd').textContent])), { Operation: 'knowledge:harvest', 'Runs in': '/fixture/base/deployment/agents/reviewer/instances/reviewer-1' });
  assert.doesNotMatch(u.$('.auto-page').textContent, /runs a operation|No prompt/);
  u.view.open('local/digest'); await tick();
  assert.equal(u.$('.page-section[data-section="Prompt"] .auto-prompt').textContent, 'Write the nightly digest.\nKeep it under a page.');
});

test('detail, Spawns: the purpose, harness · model, launch config, permissions, backend, and its own recurring wake', async t => {
  const u = mount(t, 'schedule'); await tick();
  u.view.open('local/digest'); await tick();
  assert.deepEqual(u.facts('Spawns'), { Soul: 'reviewer · ws', Purpose: 'digest', Harness: 'Claude · opus', Permissions: 'Native permission policy', Backend: 'tmux',
    'Wakes it': 'Daily at 12:00 · UTC', 'Wake message': 'Midday: post progress.' });
  const json = fx('schedule-list'); Object.assign(json.schedules.find(r => r.id === 'digest'), { yolo: true, launchConfig: 'nightly' }); // derived: the capture's spawn has neither
  const v = mount(t, 'schedule', { json }); await tick(); v.view.open('local/digest'); await tick();
  assert.equal(v.facts('Spawns').Permissions, 'YOLO — skips permission prompts'); assert.equal(v.facts('Spawns')['Launch config'], 'nightly');
  const tr = mount(t, 'trigger'); await tick(); tr.view.open('local/kb-review'); await tick();
  assert.equal(tr.facts('Spawns').Purpose, '{trigger}-{number}');
});

test('detail, Run state: running since; unknown since, with exit facts, Check run state and the reconcile command; a pending wake', async t => {
  const checks = [];
  const u = mount(t, 'schedule', { rowActions: row => runState(row)?.unknown ? [{ label: 'Check run state', verb: 'reconcile', run: () => checks.push(row.id) }] : [] }); await tick();
  u.view.open('local/status'); await tick();
  const running = u.$('.page-card[data-card="Run state"]');
  assert.match(running.querySelector('.auto-verdict').textContent, /^Running since .+ · 1 h ago$/);
  assert.equal(running.querySelector('.auto-verdict.warn'), null);
  u.view.open('local/standup'); await tick();
  const unknown = u.$('.page-card[data-card="Run state"]');
  assert.match(unknown.querySelector('.auto-verdict.warn').textContent, /^Run state unknown since .+ · 3 h ago$/);
  assert.deepEqual(u.facts('Run state'), { Scheduled: '3 h ago', Exited: 'yes', 'Exit status': '1', Error: 'the wake was not confirmed' });
  assert.deepEqual([...unknown.querySelectorAll('code')].map(c => c.textContent), ['oats schedule reconcile local/standup --dir /fixture/base/deployment', 'oats schedule reconcile local/standup --clear --dir /fixture/base/deployment']);
  unknown.querySelector('button[data-verb=reconcile]').click(); assert.deepEqual(checks, ['local/standup']);
  assert.equal(u.$('.page-bar-actions [data-verb=reconcile]'), null, 'the check lives on its card, not twice');
  u.view.open('local/threw'); await tick();
  const retained = u.$('.page-card[data-card="Run state"]');
  assert.match(retained.querySelector('.auto-verdict.warn').textContent, /^Run state unknown since .+ · 1 h ago$/, 'a held lock does not hide an unknown run');
  assert.doesNotMatch(retained.textContent, /Running since/);
  assert.equal(u.facts('Run state')['Host slot'], 'held (counts against the host limit)'); assert.equal(u.facts('Run state').Error, 'the command launcher failed');
  retained.querySelector('button[data-verb=reconcile]').click(); assert.deepEqual(checks, ['local/standup', 'local/threw']);
  u.view.open('local/digest'); await tick();
  assert.match(u.$('.page-card[data-card="Run state"]').textContent, /A wake message is waiting to be delivered \(due in 2 h\)\./);
  u.view.open('local/harvest'); await tick();
  assert.equal(u.$('.page-card[data-card="Run state"]'), null);
});

test('detail: an Invalid or Unreadable card shows code, field and message; Comes from names the template and local times', async t => {
  // Derived from the capture: the kernel's invalid/unreadable shapes (lib/automations.mjs, lib/schedule.mjs list).
  const json = fx('schedule-list');
  json.schedules.find(r => r.id === 'harvest').invalid = { code: 'E_SCHEDULE_INVALID', message: 'home: an existing instance home inside the scope', field: 'home' };
  json.schedules.push({ id: 'broken', qualifiedId: 'local/broken', name: 'broken', scope: json.scope, scheduleApi: 2, scheduleHistoryApi: 3, unreadable: { code: 'E_SCHEDULE_INVALID', message: 'job lock custody is unreadable' }, history: { status: 'corrupt', stored: null, truncated: false }, recentRuns: [] });
  const u = mount(t, 'schedule', { describe: async () => ({}) }); u.set(json); await u.view.refresh(); await tick();
  assert.equal(u.row('local/harvest').querySelector('.auto-tag.warn').textContent, 'Invalid');
  assert.equal(u.row('local/broken').querySelector('.auto-tag.warn').textContent, 'Unreadable');
  u.view.open('local/harvest'); await tick();
  assert.deepEqual(u.facts('Invalid'), { Code: 'E_SCHEDULE_INVALID', Field: 'home', Message: 'home: an existing instance home inside the scope' });
  u.view.open('local/broken'); await tick();
  assert.deepEqual(u.facts('Unreadable'), { Code: 'E_SCHEDULE_INVALID', Message: 'job lock custody is unreadable' });
  assert.equal(u.$('.auto-page [data-verb=describe]'), null, 'an unreadable item has nothing to describe');
  u.view.open('local/status'); await tick();
  assert.deepEqual(Object.keys(u.facts('Comes from')), ['Created', 'Updated']);
  const tr = mount(t, 'trigger'); await tick();
  tr.view.open('ws/from-template'); await tick();
  assert.equal(tr.facts('Comes from').Template, 'acme.pkg:harvest-review v1.0.0 @d672657');
  tr.view.open('local/kb-review'); await tick();
  assert.deepEqual(Object.keys(tr.facts('Comes from')), ['Created', 'Updated']);
});

test('the Schedules page offers Check run state for an unknown run that still holds its lock', async () => {
  const threw = fx('schedule-list').schedules.find(r => r.id === 'threw');
  const s = setup({ read: async () => ({ schedules: [threw], scheduler: { installed: true, active: true, registered: true } }), mutate: async () => ({ reconciled: 'unknown' }) });
  try {
    await tick(); await tick();
    assert.ok(s.rowAction('threw', 'reconcile'), 'the row menu keeps its recovery action');
  } finally { s.cleanup(); }
});

test('Edit summary: the sheet opens on the summary, saves the text as typed, re-reads, and returns focus to the control by identity', async t => {
  const calls = [];
  const u = mount(t, 'schedule', { describe: async (row, text) => { calls.push([row.key, text]); return doc('schedule-update-describe').result; } }); await tick();
  u.view.open('local/status'); await tick();
  u.$('.page-bar-actions [data-verb=describe]').focus(); u.$('.page-bar-actions [data-verb=describe]').click();
  const sheet = u.$('.auto-sheet'), input = sheet.querySelector('input');
  assert.equal(sheet.hidden, false); assert.equal(u.active(), input); assert.equal(input.value, 'Morning workspace status');
  assert.equal(input.maxLength, 200);
  const form = sheet.querySelector('form');
  assert.deepEqual([form.getAttribute('role'), form.getAttribute('aria-modal'), u.dom.window.document.getElementById(form.getAttribute('aria-labelledby')).textContent], ['dialog', 'true', 'Summary of status']);
  input.value = '  Status, every weekday morning  ';
  const json = fx('schedule-list'); json.schedules.find(r => r.id === 'status').description = '  Status, every weekday morning  '; u.set(json);
  const reads = u.reads.length;
  form.dispatchEvent(new u.dom.window.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual(calls, [['local/status', '  Status, every weekday morning  ']], 'as typed: the kernel keeps boundary spaces');
  assert.equal(sheet.hidden, true); assert.equal(u.reads.length, reads + 1, 'a save re-reads the list');
  assert.equal(u.$('.page-lede').textContent, '  Status, every weekday morning  ');
  assert.equal(u.active(), u.$('.page-bar-actions [data-verb=describe]'), 'focus on the repainted Edit summary, never <body>');
  // Spaces only are a summary (the kernel's rule admits them); only an empty value clears.
  u.active().click(); sheet.querySelector('input').value = '   ';
  form.dispatchEvent(new u.dom.window.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual(calls.at(-1), ['local/status', '   ']);
  u.active().click(); sheet.querySelector('input').value = '';
  form.dispatchEvent(new u.dom.window.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual(calls.at(-1), ['local/status', '']);
  // From the lede (no summary) and from the row menu: focus comes back to that row's menu.
  u.view.open('local/harvest'); await tick(); u.$('.page-lede button').focus(); u.$('.page-lede button').click();
  assert.equal(sheet.hidden, false); assert.equal(sheet.querySelector('input').value, '');
  u.key('Escape'); assert.equal(sheet.hidden, true); assert.equal(u.$('.auto-page').hidden, false, 'Escape closes the sheet, not the page under it');
  assert.equal(u.active(), u.$('.page-lede button'));
  u.key('Escape'); await tick();
  const menu = u.row('local/harvest').querySelector('.auto-menu'); menu.open = true; menu.querySelector('[data-verb=describe]').focus(); menu.querySelector('[data-verb=describe]').click();
  assert.equal(sheet.hidden, false); sheet.querySelector('.act:not(.primary)').click();
  assert.equal(u.active(), u.row('local/harvest').querySelector('.auto-menu summary'));
});

test('Edit summary: out-of-rule text never leaves; a refusal keeps the sheet with its message; Tab stays inside', async t => {
  const calls = [];
  const u = mount(t, 'trigger', { describe: async (row, text) => { calls.push(text); const e = new Error(doc('trigger-update-flag').error.message); throw e; } }); await tick();
  u.view.open('local/kb-review'); await tick(); u.$('.page-bar-actions [data-verb=describe]').click();
  const sheet = u.$('.auto-sheet'), form = sheet.querySelector('form'), input = form.querySelector('input');
  for (const bad of ['a\tb', '\tValid\t', 'x'.repeat(201), 'a\u2028b']) {
    input.value = bad; form.dispatchEvent(new u.dom.window.Event('submit', { cancelable: true })); await tick();
    assert.match(sheet.querySelector('.auto-describe-error').textContent, /one line of up to 200 characters/); assert.equal(u.active(), input);
  }
  assert.deepEqual(calls, [], 'refused before any request');
  input.value = '🙂'.repeat(200); form.dispatchEvent(new u.dom.window.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual(calls, ['🙂'.repeat(200)], '200 characters, not UTF-16 units');
  assert.equal(sheet.hidden, false); assert.match(sheet.querySelector('.auto-describe-error').textContent, /only --description is supported/);
  assert.equal(sheet.querySelector('.auto-describe-error').getAttribute('role'), 'alert'); assert.equal(u.active(), input, 'focus back on the field to correct it');
  // Tab and Shift+Tab wrap inside the sheet.
  const [save, cancel] = form.querySelectorAll('button'); cancel.focus(); u.key('Tab'); assert.equal(u.active(), input);
  input.focus(); u.key('Tab', { shiftKey: true }); assert.equal(u.active(), cancel); void save;
});

test('Edit summary while saving: focus parks on the status line, Escape and Tab cannot leave; a late answer after the view goes changes nothing', async t => {
  const pending = [];
  const u = mount(t, 'schedule', { describe: () => { const d = deferred(); pending.push(d); return d.promise; } }); await tick();
  u.view.open('local/harvest'); await tick(); u.$('.page-lede button').click();
  const sheet = u.$('.auto-sheet'), form = sheet.querySelector('form'), status = sheet.querySelector('.auto-describe-status');
  form.querySelector('input').value = 'Harvest every six hours';
  form.dispatchEvent(new u.dom.window.Event('submit', { cancelable: true })); await tick();
  assert.equal(u.active(), status); assert.equal(status.textContent, 'Saving the summary…');
  assert.equal(form.querySelector('input').disabled, true);
  form.dispatchEvent(new u.dom.window.Event('submit', { cancelable: true })); await tick();
  assert.equal(pending.length, 1, 'a second submit while saving sends nothing');
  u.key('Escape'); assert.equal(sheet.hidden, false, 'a running save cannot be dismissed');
  u.key('Tab'); assert.equal(u.active(), status);
  sheet.dispatchEvent(new u.dom.window.MouseEvent('mousedown', { bubbles: true })); assert.equal(sheet.hidden, false);
  // A late failure lands on the field; then a late success after disposal is ignored.
  pending[0].reject(new Error('E_SCHEDULE_INVALID: description: one line of 1 to 200 characters')); await tick();
  assert.equal(u.active(), form.querySelector('input')); assert.match(sheet.querySelector('.auto-describe-error').textContent, /one line of 1 to 200/);
  form.dispatchEvent(new u.dom.window.Event('submit', { cancelable: true })); await tick();
  const reads = u.reads.length; u.view.dispose();
  pending[1].resolve({}); await tick(); await tick();
  assert.equal(u.reads.length, reads, 'the disposed view does not re-read');
});

test('the mounted page: Edit summary only with automation-descriptions, and it posts describe with the qualified key', async t => {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { pretendToBeVisual: true });
  const el = dom.window.document.querySelector('main'), bodies = [];
  setWorkspace('/team');
  const version = doc('version'); let cli = { ok: true, ...version, features: version.features.filter(f => f !== 'automation-descriptions') }; const listeners = new Set();
  const ctx = { api: async (path, opts) => {
    const body = JSON.parse(opts.body); bodies.push(body);
    if (body.action === 'list') return { automationsViewApi: 1, status: 'ok', kind: 'schedule', action: 'list', result: fx('schedule-list'), reason: null };
    return { automationsViewApi: 1, status: 'ok', kind: 'schedule', action: body.action, result: fx('schedule-update-describe'), reason: null };
  } };
  const page = mountAutomationsPage(el, ctx, 'schedule', undefined, { cli: () => cli, subscribeCli: fn => { listeners.add(fn); return () => listeners.delete(fn); } });
  t.after(() => { page.dispose(); dom.window.close(); });
  await tick(); await tick();
  page.view.open('local/harvest'); assert.equal(el.querySelector('[data-verb=describe]'), null, 'an older kernel: read only');
  cli = { ok: true, ...version }; for (const fn of listeners) fn(); await tick(); await tick();
  page.view.open('local/harvest'); el.querySelector('.page-lede button').click();
  el.querySelector('.auto-sheet input').value = 'Harvest the knowledge base';
  el.querySelector('.auto-sheet form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual(bodies.find(b => b.action === 'describe'), { kind: 'schedule', action: 'describe', key: 'local/harvest', description: 'Harvest the knowledge base' });
});

test('the schedule form: Summary shows only with the feature and is sent as typed; without it the stored one is kept (the shim)', async () => {
  const wake = { kind: 'wake', enabled: true, cron: '*/15 * * * *', tz: 'UTC', home: '/team/agents/reviewer/instances/reviewer-seat', message: 'Check work.', description: '  Keep — as stored  ' };
  const run = async features => {
    let saved = null;
    const s = setup({ cliFacts: { features }, read: async () => ({ schedules: [{ ...wake, id: 'review' }], scheduler: { installed: true, active: true, registered: true } }), mutate: async (path, body) => { saved = body; return { schedule: { ...body.spec, id: 'review' } }; } });
    await tick(); s.rowAction('review', 'edit').click(); await tick();
    return { s, form: s.el.querySelector('form'), field: s.el.querySelector('.schedule-summary-field'), submit: async () => { s.el.querySelector('form').dispatchEvent(new s.dom.window.Event('submit', { cancelable: true })); await tick(); return saved; } };
  };
  let r = await run([]);
  try {
    assert.equal(r.field.hidden, true, 'an older kernel: no Summary field');
    assert.equal((await r.submit()).spec.description, '  Keep — as stored  ', 'the stored summary survives an edit');
  } finally { r.s.cleanup(); }
  r = await run(['automation-descriptions']);
  try {
    assert.equal(r.field.hidden, false); assert.equal(r.form.elements.description.value, '  Keep — as stored  '); assert.equal(r.form.elements.description.maxLength, 200);
    assert.equal((await r.submit()).spec.description, '  Keep — as stored  ', 'untouched: kept exactly');
  } finally { r.s.cleanup(); }
  r = await run(['automation-descriptions']);
  try {
    r.form.elements.description.value = '  Review pending work  ';
    assert.equal((await r.submit()).spec.description, '  Review pending work  ', 'sent as typed');
  } finally { r.s.cleanup(); }
  r = await run(['automation-descriptions']);
  try {
    r.form.elements.description.value = '   ';
    assert.equal((await r.submit()).spec.description, '   ', 'spaces only are kept, not a removal');
  } finally { r.s.cleanup(); }
  r = await run(['automation-descriptions']);
  try {
    r.form.elements.description.value = '';
    assert.equal(Object.hasOwn((await r.submit()).spec, 'description'), false, 'emptied: the replacement has none, which removes it');
  } finally { r.s.cleanup(); }
  r = await run(['automation-descriptions']);
  try {
    r.form.elements.description.value = '\tValid\t'; const saved = await r.submit();
    assert.equal(saved, null, 'out of the rule: nothing is sent'); assert.match(r.s.el.querySelector('.schedule-form-error').textContent, /Summary: one line/);
  } finally { r.s.cleanup(); }
  void posts;
});
