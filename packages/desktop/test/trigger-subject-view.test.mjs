import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createAutomationsView } from '../renderer/views/automations.mjs';

// OATS 0.49 (#669) on the trigger detail page and its Test card: the last poll, the last error with its
// code, the events waiting, the instances live, subject labels and the instance a fire would derive.
// The list is the real capture (fixtures/automations/kernel); the 0.49 status and test answers are added here.
const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/automations/kernel/${name}.json`, import.meta.url), 'utf8')).result;
const NOW = Date.parse('2026-09-26T15:40:00.000Z');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const at = min => new Date(NOW - min * 60e3).toISOString();
const NAME_CUT = 'The purpose was cut and a hash added so the name fits 64 characters.';

const pending = Array.from({ length: 12 }, (_, i) => ({ key: `github.com/northwind/storefront#${i + 1}`, event: i % 2 ? 'ready_for_review' : 'opened', number: i + 1, subject: String(i + 1), url: `https://github.com/northwind/storefront/pull/${i + 1}`, observedAt: at(30 - i) }));
const STATUS = { triggers: [{ id: 'agents/pr-review', repo: 'github.com/northwind/storefront', firedTotal: 3, liveCount: 1, concurrency: { max: 2 },
  live: [{ instance: 'pr-review-storefront-41', home: '/h/41', repo: 'github.com/northwind/storefront', number: 41, subject: '41', event: 'opened' }, 'junk'],
  lastPoll: { at: at(1), ok: true, prs: 14, matching: 12 }, pending,
  fired: [{ key: 'k40', at: at(8), instance: 'pr-review-storefront-40', event: 'ready_for_review', number: 40, subject: '40' }],
  lastError: { at: at(2), code: 'E_INSTANCE_NAME_INVALID', message: 'The soul name is too long for a triggered spawn', key: pending[0].key } }] };
const TEST = { ok: true, problems: [], warnings: [], wouldFire: [
  { key: 'k1', number: 1, subject: '1', instance: 'pr-review-storefront-1', nameCut: false },
  { key: 'k2', number: 2, subject: '2', instance: 'oats-okf--harvester-review-storefront-a1b2c3', nameCut: true },
  { key: 'k3', number: 3, subject: '3', instance: null, nameCut: null, held: true },
] };

function mount(t, { json = fx('trigger-list'), status = async () => STATUS, test = TEST } = {}) {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { pretendToBeVisual: true });
  const host = dom.window.document.querySelector('main');
  const view = createAutomationsView(host, { kind: 'trigger', read: async () => json, act: async () => test, status, now: () => NOW });
  t.after(() => { view.dispose(); dom.window.close(); });
  const $ = s => host.querySelector(s), $$ = s => [...host.querySelectorAll(s)];
  return { dom, host, view, $, $$ };
}
async function openPage(u, id = 'agents/pr-review') {
  await tick(); u.$(`.auto-row[data-id="${id}"] .auto-open`).click(); await tick(); await tick(); await tick();
}

test('the trigger page: last poll, the last error with its code in mono, events waiting (newest 10) and live instances', async t => {
  const u = mount(t); await openPage(u);
  const fires = u.$('.page-section[data-section="Recent fires"]');
  const lines = [...fires.querySelectorAll('.auto-test-line')];
  assert.equal(lines[0].textContent, 'Last poll 1 min ago: 14 pull requests, 12 matching');
  assert.ok(lines[0].querySelector('time').title, 'the poll time has its exact time as title');
  assert.equal(lines[1].textContent, 'Last error: The soul name is too long for a triggered spawn E_INSTANCE_NAME_INVALID', 'the message, then the code');
  assert.equal(lines[1].querySelector('code.auto-mono').textContent, 'E_INSTANCE_NAME_INVALID');
  const waiting = fires.querySelector('ul[aria-label="Waiting"]');
  const rows = [...waiting.querySelectorAll('li')].map(li => li.textContent);
  assert.equal(rows.length, 10, 'at most ten');
  assert.deepEqual(rows.slice(0, 3), ['19 min ago#12 · ready for review', '20 min ago#11 · opened', '21 min ago#10 · ready for review'], 'newest observed first');
  assert.match(fires.textContent, /and 2 more/);
  assert.match(fires.textContent, /1 of 2 live now · 3 fired in all · 12 waiting/);
  assert.deepEqual([...fires.querySelectorAll('ul[aria-label="Live now"] li')].map(li => li.textContent), ['#41 · opened · pr-review-storefront-41']);
  assert.equal(fires.querySelector('ul[aria-label="Live now"] .auto-mono').textContent, 'pr-review-storefront-41');
  assert.match([...fires.querySelectorAll('.auto-run')].at(-1).textContent, /^8 min ago#40 · ready for review · pr-review-storefront-40$/, 'a fire is named by its subject');
  assert.ok(!/null|undefined/.test(fires.textContent));
});

test('a failed poll says so; an older kernel shows none of the new lines', async t => {
  const failed = structuredClone(STATUS); Object.assign(failed.triggers[0], { lastPoll: { at: at(3), ok: false, error: 'gh: HTTP 502' }, lastError: { code: 'E_X' }, pending: [], live: [] });
  const u = mount(t, { status: async () => failed }); await openPage(u);
  const lines = [...u.$$('.page-section[data-section="Recent fires"] .auto-test-line')].map(p => p.textContent);
  assert.deepEqual(lines, ['Last poll 3 min ago failed: gh: HTTP 502', 'Last error: E_X'], 'a code alone still shows, in mono');
  const old = { triggers: [{ id: 'agents/pr-review', firedTotal: 1, liveCount: 1, live: [{ number: 41 }], concurrency: { max: 1 }, pending: [], fired: [{ key: 'k41', at: at(8), number: 41, event: 'opened' }] }] };
  const v = mount(t, { status: async () => old }); await openPage(v);
  const section = v.$('.page-section[data-section="Recent fires"]');
  assert.equal(section.querySelectorAll('.auto-test-line').length, 0); assert.equal(section.querySelector('ul[aria-label="Waiting"]'), null);
  assert.deepEqual([...section.querySelectorAll('ul[aria-label="Live now"] li')].map(li => li.textContent), ['#41'], 'a pre-0.49 live entry by its number');
  assert.match(section.textContent, /8 min ago#41 · opened$/, 'a pre-0.49 fire by its number, in the section\'s order');
});

test('the last poll counts one pull request in the singular', async t => {
  const one = structuredClone(STATUS); Object.assign(one.triggers[0], { lastPoll: { at: at(1), ok: true, prs: 1, matching: 1 } });
  const u = mount(t, { status: async () => one }); await openPage(u);
  assert.equal(u.$('.page-section[data-section="Recent fires"] .auto-test-line').textContent, 'Last poll 1 min ago: 1 pull request, 1 matching');
});

test('the Test card: each event that would fire, the instance it would derive, and a shortened name described', async t => {
  const u = mount(t); await openPage(u);
  u.$('.page-bar-actions button[data-verb=test]').click(); await tick(); await tick();
  const card = u.$('.page-card[data-card="Test result"]');
  assert.ok([...card.querySelectorAll('.auto-test-line')].some(p => p.textContent === 'Would fire now:'));
  const items = [...card.querySelectorAll('ul[aria-label="Would fire now"] li')];
  assert.deepEqual(items.map(li => li.textContent), ['#1 → pr-review-storefront-1', '#2 → oats-okf--harvester-review-storefront-a1b2c3 · name shortened to fit', '#3 (held)']);
  assert.equal(items[1].getAttribute('aria-description'), NAME_CUT); assert.equal(items[1].title, NAME_CUT);
  assert.equal(items[0].getAttribute('aria-description'), null);
  assert.equal(items[1].querySelector('.auto-mono').textContent, 'oats-okf--harvester-review-storefront-a1b2c3');
});

test('nothing would fire: the line stays', async t => {
  const u = mount(t, { test: { ok: true, wouldFire: [] } }); await openPage(u);
  u.$('.page-bar-actions button[data-verb=test]').click(); await tick(); await tick();
  assert.ok([...u.$$('.page-card[data-card="Test result"] .auto-test-line')].some(p => p.textContent === 'Nothing would fire now.'));
  assert.equal(u.$('ul[aria-label="Would fire now"]'), null);
});

test('a non-pull-request source shows no #; repo null shows no Repo fact and never "null"', async t => {
  const json = fx('trigger-list'), row = json.triggers.find(r => r.id === 'agents/pr-review');
  row.on = { ...row.on, source: 'capability.release', repo: null };
  row.lastRun = { at: at(8), instance: 'rel-7', event: 'published', number: null, subject: 'v7', key: 'cap:v7' };
  const capStatus = { triggers: [{ id: 'agents/pr-review', repo: null, liveCount: 1, live: [{ instance: 'rel-7', repo: null, number: null, subject: 'v7', event: 'published' }],
    pending: [{ key: 'cap:v8', event: 'published', number: null, subject: 'v8', url: null, observedAt: at(1) }, { key: 'cap:v9', event: 'published', number: null, subject: null, observedAt: at(0) }],
    fired: [{ key: 'cap:v7', at: at(8), instance: 'rel-7', event: 'published', number: null, subject: 'v7' }], lastPoll: null, lastError: null }] };
  const u = mount(t, { json, status: async () => capStatus, test: { ok: true, wouldFire: [{ key: 'cap:v8', number: null, subject: 'v8', instance: 'rel-v8', nameCut: false }] } });
  await tick();
  const listRow = u.$('.auto-row[data-id="agents/pr-review"]');
  assert.match(listRow.textContent, /Last 8 min ago · v7/); assert.ok(!/null|#v7/.test(listRow.textContent));
  await openPage(u);
  const facts = Object.fromEntries([...u.$('.page-card[data-card="On"]').querySelectorAll('.page-kv')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd').textContent]));
  assert.equal(Object.hasOwn(facts, 'Repo'), false, 'repo null: the fact is omitted');
  const fires = u.$('.page-section[data-section="Recent fires"]');
  assert.deepEqual([...fires.querySelectorAll('ul[aria-label="Waiting"] li span')].map(s => s.textContent), ['cap:v9 · published', 'v8 · published'], 'no subject and no number: the key');
  assert.deepEqual([...fires.querySelectorAll('ul[aria-label="Live now"] li')].map(li => li.textContent), ['v7 · published · rel-7']);
  assert.ok(!/#|null/.test(fires.textContent), fires.textContent);
  u.$('.page-bar-actions button[data-verb=test]').click(); await tick(); await tick();
  assert.deepEqual([...u.$$('ul[aria-label="Would fire now"] li')].map(li => li.textContent), ['v8 → rel-v8']);
});

test('kernel strings are text, never markup, and pass through the display filter', async t => {
  const hostile = structuredClone(STATUS);
  Object.assign(hostile.triggers[0], { pending: [{ key: 'k', event: 'opened', subject: '<img src=x onerror=alert(1)>', observedAt: at(1) }],
    live: [{ instance: 'a‮b', subject: '1' }], lastError: { code: 'E_X', message: 'token: ghp_abcdefghijklmnopqrstuvwxyz' }, lastPoll: { at: at(1), ok: false, error: 'line1\nline2' } });
  const u = mount(t, { status: async () => hostile }); await openPage(u);
  const fires = u.$('.page-section[data-section="Recent fires"]');
  assert.equal(fires.querySelector('img'), null);
  assert.match(fires.querySelector('ul[aria-label="Waiting"] li span').textContent, /^#<img src=x onerror=alert\(1\)> · opened$/);
  assert.equal(fires.querySelector('ul[aria-label="Live now"] .auto-mono').textContent, 'a�b');
  const lines = [...fires.querySelectorAll('.auto-test-line')].map(p => p.textContent);
  assert.deepEqual(lines, ['Last poll 1 min ago failed: line1 line2', 'Last error: [Detail withheld] E_X']);
});
