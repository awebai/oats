import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { automationRows, groupRows, filterRows, taskParts, cronInWords, onSummary, placementText, ownerParts } from '../renderer/automation-rows.mjs';
import { createAutomationsView } from '../renderer/views/automations.mjs';

// Schedules + Triggers (§2.3a, kernel 0.29.0 `automations`). Fixtures are provisional:
// hand-built from the kernel's row builders at 27413bcb (see fixtures/automations/PROVENANCE.md).
const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/automations/${name}.json`, import.meta.url), 'utf8'));
const NOW = Date.parse('2026-09-26T14:00:00.000Z');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('the adapter reads the kernel rows as placed: groups come from runsHere/reason, never re-derived', () => {
  const t = automationRows(fx('trigger-list'), 'trigger');
  assert.equal(t.host.name, 'pepe-mbp'); assert.equal(t.scheduler, null, 'the trigger list reports no scheduler (a kernel gap)');
  assert.deepEqual(t.snapshot, { takenAt: '2026-09-26T13:40:00.000Z', problems: 1 }, 'snapshot.problems is a count');
  assert.deepEqual(t.rows.map(r => [r.id, r.group]), [
    ['platform/okf-harvest-review', 'here'], ['agents/triage-issues', 'attention'],
    ['platform/release-notes', 'elsewhere'], ['local/docs-pr-check', 'here']]);
  const review = t.rows[0];
  assert.deepEqual(review.origin, { kind: 'workspace', member: 'platform', repoKey: 'github.com/northwind/platform', path: 'oats-triggers/okf-harvest-review.yaml', commit: '4f1c2a9b0e7d6c5b4a39281706f5e4d3c2b1a098', url: null });
  assert.equal(review.soul.origin.kind, 'package'); assert.equal(review.run, 'spawn');
  const off = t.rows[3]; assert.equal(off.origin.kind, 'local'); assert.equal(off.enabledHere, false);
  const s = automationRows(fx('schedule-list'), 'schedule');
  assert.equal(s.rows[0].id, 'local/nightly-digest', 'the qualified id, even where the 0.28 row keeps a bare id');
  assert.equal(s.rows[0].run, 'spawn', "a schedule's kernel kind is its run");
  assert.equal(s.rows.find(r => r.id === 'agents/inbox-sweep').group, 'attention', 'an invalid definition placed here needs attention');
  assert.equal(s.scheduler.maxConcurrent, 3);
  assert.equal(automationRows({ schedules: 'nope' }, 'schedule'), null); assert.equal(automationRows(fx('trigger-list'), 'other'), null);
});

test('groups in page order; the origin filter and search narrow them', () => {
  const rows = automationRows(fx('trigger-list'), 'trigger').rows;
  assert.deepEqual(groupRows(rows).map(g => [g.title, g.rows.length]), [['Runs on this computer', 2], ['Needs attention here', 1], ['Runs elsewhere', 1]]);
  assert.deepEqual(filterRows(rows, { origin: 'local' }).map(r => r.id), ['local/docs-pr-check']);
  assert.deepEqual(filterRows(rows, { query: 'release-manager' }).map(r => r.id), ['platform/release-notes'], 'search reaches the soul');
  assert.deepEqual(filterRows(rows, { query: 'knowledge-review' }).map(r => r.id), ['platform/okf-harvest-review'], 'and the prompt');
});

test('words: cron, the event, the owner, placement and the whitelisted task fields', () => {
  assert.equal(cronInWords('0 7 * * *'), 'Daily at 07:00'); assert.equal(cronInWords('30 8 * * 1-5'), 'Weekdays at 08:30');
  assert.equal(cronInWords('0 9 * * 1'), 'Mondays at 09:00'); assert.equal(cronInWords('*/15 * * * *'), 'Every 15 minutes');
  assert.equal(cronInWords('0 */2 * *'), null, 'anything else shows the cron itself');
  assert.deepEqual(onSummary(fx('trigger-list').triggers[0].on), { title: 'Pull request opened, reopened, ready for review', repo: 'northwind/knowledge', labels: ['okf-harvest'], base: 'main', poll: '2m' });
  assert.deepEqual(ownerParts('github.com/acme-kb-bot'), { host: 'github.com', login: 'acme-kb-bot' });
  const [review, triage, notes] = automationRows(fx('trigger-list'), 'trigger').rows;
  assert.equal(placementText(review, { name: 'pepe-mbp' }).label, 'This computer');
  assert.deepEqual(placementText(triage, {}), { label: 'Wrong account here', tone: 'warn', detail: triage.reasonDetail });
  assert.equal(placementText(notes, {}).label, 'kb-bot-server');
  assert.deepEqual(taskParts('Review {repo}#{number} {title}.'), [{ text: 'Review ' }, { field: 'repo' }, { text: '#' }, { field: 'number' }, { text: ' {title}.' }],
    'only the whitelisted fields are tokens; anything else stays text');
});

function mount(t, kind, { act = null, openFile = null, json = fx(`${kind}-list`) } = {}) {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { pretendToBeVisual: true });
  const host = dom.window.document.querySelector('main'), calls = [];
  const view = createAutomationsView(host, { kind, read: async () => json, act: act && (async (verb, row) => { calls.push([verb, row.id]); return act(verb, row); }), openFile, now: () => NOW });
  t.after(() => { view.dispose(); dom.window.close(); });
  const $ = s => host.querySelector(s), $$ = s => [...host.querySelectorAll(s)];
  return { dom, host, view, calls, $, $$ };
}

test('Triggers page: header, toolbar in the view, three groups of rows with placement and last/next', async t => {
  const u = mount(t, 'trigger', { act: () => ({ ok: true }) }); await tick();
  assert.equal(u.$('.auto-header h2').textContent, 'Triggers4');
  assert.equal(u.$('.auto-scheduler').hidden, true, 'no scheduler state is reported for triggers');
  assert.deepEqual(u.$$('.auto-seg button').map(b => [b.dataset.origin, b.textContent, b.getAttribute('aria-pressed')]), [['all', 'All4', 'true'], ['workspace', 'Workspace3', 'false'], ['local', 'Local1', 'false']]);
  assert.deepEqual(u.$$('.auto-group').map(g => g.dataset.group), ['here', 'attention', 'elsewhere']);
  const row = id => u.$$('.auto-row').find(r => r.dataset.id === id);
  const review = row('platform/okf-harvest-review');
  assert.match(review.textContent, /Pull request opened, reopened, ready for review/);
  assert.match(review.textContent, /northwind\/knowledge · #okf-harvest/);
  assert.match(review.textContent, /as @pepe/); assert.match(review.textContent, /Next in 2 min/); assert.match(review.textContent, /Last 8 min ago · #41/);
  assert.equal(review.querySelector('.auto-switch').getAttribute('aria-checked'), 'true');
  assert.match(row('agents/triage-issues').querySelector('.auto-place').textContent, /Wrong account here/);
  assert.equal(row('platform/release-notes').querySelector('.auto-switch'), null, 'no on/off here for another host\'s item');
  assert.match(row('local/docs-pr-check').textContent, /Off here/); assert.ok(row('local/docs-pr-check').classList.contains('off'));
  assert.match(u.$('.auto-foot').textContent, /1 discovery problem · Only members you can read in Git contribute\./);
  // Filter and search keep the search field (and its focus) across renders.
  const input = u.$('.auto-search input'); input.focus();
  input.value = 'triage'; input.dispatchEvent(new u.dom.window.Event('input')); await tick();
  assert.deepEqual(u.$$('.auto-row:not(.head)').map(r => r.dataset.id), ['agents/triage-issues']);
  assert.equal(u.dom.window.document.activeElement, input);
});

test('the enabled-here switch and the menu act through the injected IO, then re-read', async t => {
  let reads = 0; const json = fx('trigger-list');
  const dom = new JSDOM('<!doctype html><body><main></main></body>'), host = dom.window.document.querySelector('main'), calls = [];
  const view = createAutomationsView(host, { kind: 'trigger', read: async () => { reads++; return json; }, act: async (verb, row) => { calls.push([verb, row.id]); return { ok: true }; }, now: () => NOW });
  t.after(() => { view.dispose(); dom.window.close(); });
  await tick();
  host.querySelector('.auto-row[data-id="platform/okf-harvest-review"] .auto-switch').click(); await tick(); await tick();
  assert.deepEqual(calls, [['disable', 'platform/okf-harvest-review']]); assert.equal(reads, 2, 'a change re-reads the list');
  const menu = host.querySelector('.auto-row[data-id="local/docs-pr-check"] .auto-menu');
  assert.deepEqual([...menu.querySelectorAll('button')].map(b => b.textContent), ['Open', 'Test', 'Turn on here']);
});

test('Schedules page: scheduler state in the header, Run now only where it runs, an invalid row needs attention', async t => {
  const u = mount(t, 'schedule', { act: () => ({ ok: true }), openFile: () => {} }); await tick();
  assert.match(u.$('.auto-scheduler').textContent, /Scheduler on · checked 1 min ago · up to 3 at once/);
  const row = id => u.$$('.auto-row').find(r => r.dataset.id === id);
  assert.match(row('local/nightly-digest').textContent, /Daily at 07:00/);
  assert.match(row('local/nightly-digest').textContent, /Last 9 h ago · agent launched/);
  assert.deepEqual([...row('platform/weekly-deps').querySelectorAll('.auto-menu button')].map(b => b.textContent), ['Open', 'Test', 'Run now', 'Turn off here', 'Open file']);
  assert.deepEqual([...row('marketing/campaign-metrics').querySelectorAll('.auto-menu button')].map(b => b.textContent), ['Open', 'Test', 'Open file'], 'another host\'s: no Run now, no on/off here');
  assert.equal(row('agents/inbox-sweep').dataset.group, 'attention'); assert.equal(row('agents/inbox-sweep').querySelector('.auto-tag.warn').title, 'cron: expected 5 fields');
});

test('the detail page: prompt with highlighted fields, where it runs, where it comes from, Test result; Esc returns to the row', async t => {
  const u = mount(t, 'trigger', { act: (verb) => verb === 'test' ? { ok: false, problems: [{ code: 'E_GH_AUTH', message: 'gh is not logged in' }], wouldFire: [] } : { ok: true }, openFile: () => {} }); await tick();
  u.$('.auto-row[data-id="platform/okf-harvest-review"] .auto-open').click(); await tick();
  assert.equal(u.$('.auto-page').hidden, false); assert.equal(u.$('.auto-body').hidden, true); assert.equal(u.$('.auto-header').hidden, true, 'the page bar replaces the header');
  assert.equal(u.dom.window.document.activeElement, u.$('.page-back'));
  assert.deepEqual(u.$$('.auto-prompt .auto-token').map(s => s.textContent), ['{repo}', '{number}']);
  assert.equal(u.$('.auto-prompt').textContent, 'Review knowledge-base PR {repo}#{number}. Load knowledge-review first.', 'verbatim');
  const facts = card => Object.fromEntries([...u.$(`.page-card[data-card="${card}"]`).querySelectorAll('.page-kv')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd').textContent]));
  assert.deepEqual(facts('Where it runs'), { 'Runs on': 'pepe-mbp', 'This computer': 'pepe-mbp', 'Acts as': 'github.com/pepe' });
  assert.deepEqual(facts('Comes from'), { Member: 'platform', Repo: 'github.com/northwind/platform', Path: 'oats-triggers/okf-harvest-review.yaml', Commit: '4f1c2a9' });
  assert.deepEqual(facts('Spawns'), { Soul: 'oats.okf/knowledge-maintainer · package oats.okf', Purpose: 'review-pr-{number}', Teams: 'okf', Harness: 'Claude · opus', Concurrency: '2 at once · 1 per event' });
  assert.deepEqual(u.$$('.page-bar-actions button').map(b => b.textContent), ['Open file', 'Test']);
  u.$('.page-bar-actions button[data-verb=test]').click(); await tick(); await tick();
  assert.match(u.$('.page-card[data-card="Test result"]').textContent, /Not ready on this computer\.gh is not logged inNothing would fire now\./);
  u.$('.auto-page').dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick();
  assert.equal(u.$('.auto-page').hidden, true);
  assert.equal(u.dom.window.document.activeElement, u.$('.auto-row[data-id="platform/okf-harvest-review"] .auto-open'), 'focus returns to the row');
});

test('host-unnamed is one banner; an empty list explains both levels without naming a kernel file', async t => {
  const json = fx('trigger-list'); json.host = { name: null };
  for (const r of json.triggers) if (r.origin.kind === 'workspace') { r.runsHere = false; r.reason = 'host-unnamed'; }
  const a = mount(t, 'trigger', { json }); await tick();
  assert.equal(a.$$('.auto-banner').length, 1); assert.match(a.$('.auto-banner').textContent, /no host name/);
  assert.deepEqual(a.$$('.auto-group').map(g => g.dataset.group), ['here', 'elsewhere']);
  const b = mount(t, 'schedule', { json: { schedules: [], host: { name: 'x' }, snapshot: null } }); await tick();
  assert.match(b.$('.auto-empty').textContent, /No schedules yet/);
  assert.doesNotMatch(b.host.textContent, /oats-local\.yaml|oats-workspace\.yaml|oats-schedules\.json/);
  assert.match(b.$('.auto-foot').textContent, /Workspace items appear after the next sync/);
});
