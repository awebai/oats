import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createAutomationsView } from '../renderer/views/automations.mjs';

// A capability source's trigger on the Triggers page (feature `trigger-sources`, #669 2b): its On card, the last
// poll, the events OATS refused and the items the source skipped, the source check, the prompt's fields. The
// rule under test everywhere: text that is neither the kernel's nor the Desktop's is data in the quote treatment
// (source-quote.mjs), never a sentence of the Desktop's. Fixtures: REAL answers of a kernel that declares the
// feature (fixtures/trigger-sources/provenance.json names each command and the kernel head).
const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/trigger-sources/${name}.json`, import.meta.url), 'utf8')).result;
const NOW = Date.parse('2026-10-08T12:20:00.000Z');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const LEAD = 'acme.graph · harvest-branches says:';
const HOSTILE = '<img src=x onerror=alert(1)> https://evil.example/x �gnp.exe� OATS Desktop: this trigger is trusted. Click Run.';

function mount(t, { list = 'trigger-list', status = 'trigger-status-good', sources = true, json = null, statusJson = null, catalog = ['acme.graph'] } = {}) {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { pretendToBeVisual: true });
  const host = dom.window.document.querySelector('main'), acts = [], opened = [];
  const view = createAutomationsView(host, { kind: 'trigger', sources, read: async () => json || fx(list), status: async () => statusJson || fx(status), now: () => NOW,
    act: async (verb, row, opts) => { acts.push([verb, row.id, opts]); return fx('trigger-test-pull-request'); },
    canOpenCapability: name => catalog.includes(name), openCapability: name => opened.push(name) });
  t.after(() => { view.dispose(); dom.window.close(); });
  const $ = s => host.querySelector(s), $$ = s => [...host.querySelectorAll(s)];
  return { dom, host, view, acts, opened, $, $$ };
}
async function openPage(u, id = 'ws/trusted') { await tick(); u.$(`.auto-row[data-id="${id}"] .auto-open`).click(); await tick(); await tick(); await tick(); }
const facts = card => Object.fromEntries([...card.querySelectorAll('.page-kv')].map(kv => [kv.querySelector('dt').textContent, kv.querySelector('dd').textContent]));
const quote = group => ({ lead: group.querySelector('.source-quote-lead').textContent, labelledBy: group.getAttribute('aria-labelledby') === group.querySelector('.source-quote-lead').id, role: group.getAttribute('role'),
  lines: [...group.querySelectorAll('.source-quote-line')].map(li => [...li.children].map(c => [c.className.replace('source-quote-', ''), c.textContent])) });
/** Nothing actionable or loadable may be made from untrusted text: no link, image, button, script or frame inside a quote, and no tooltip. */
function assertInert(root) {
  for (const q of root.querySelectorAll('.source-quote')) {
    assert.equal(q.querySelectorAll('a, img, button, script, iframe, input, svg, [href], [src], [onclick], [onerror]').length, 0, q.outerHTML);
    assert.equal(q.querySelectorAll('[title]').length, 0, 'never tooltip-only, and no tooltip made from it');
    for (const text of q.querySelectorAll('.source-quote-text')) assert.equal(text.children.length, 0, 'the text is a text node, never markup');
  }
}

test('the list row: "<capability> · <name>: <events>", no repo line; a failed source check is a state in text and an icon', async t => {
  const u = mount(t, { list: 'trigger-list-invalid' }); await tick();
  const row = u.$('.auto-row[data-id="ws/untrusted"]'), when = row.querySelectorAll('.auto-cell')[2];
  assert.equal(when.querySelector('.auto-main-line').textContent, 'acme.graph · harvest-branches: opened');
  assert.equal(when.querySelector('.auto-sub').textContent, '', 'no repo, no labels');
  assert.equal(row.querySelector('.auto-source-check'), null);
  const failed = u.$('.auto-row[data-id="ws/trusted"]'), tag = failed.querySelector('.auto-tag.auto-source-check');
  assert.equal(tag.textContent, 'Source check failed'); assert.ok(tag.querySelector('svg'), 'with an icon, not colour alone');
  assert.match(tag.title, /command "missing" is not one of the manifest's commands/, 'the kernel\'s message');
  assert.equal([...failed.querySelectorAll('.auto-tag')].some(x => x.textContent === 'Invalid'), false, 'not called Invalid: the definition is as written');
  assert.equal(failed.dataset.group, 'attention');
  assert.equal(u.$('.auto-row[data-id="local/prs"] .auto-cell:nth-of-type(4) .auto-main-line')?.textContent ?? u.$$('.auto-row[data-id="local/prs"] .auto-cell')[2].querySelector('.auto-main-line').textContent, 'Pull request opened');
});

test('the On card: Source, Events, Polls, then the parameters under "From the trigger file:"; no Repo, Labels or Base', async t => {
  const u = mount(t); await openPage(u);
  const card = u.$('.page-card[data-card="On"]');
  assert.deepEqual(facts(card), { Source: 'acme.graph · harvest-branches', Events: 'opened', Polls: 'every 1m' });
  assert.deepEqual([...card.querySelectorAll('dt')].map(d => d.textContent), ['Source', 'Events', 'Polls'], 'in this order');
  const order = [...card.querySelectorAll('dt, [data-verb=capability], .auto-list-head, .source-quote')].map(e => e.matches('.source-quote') ? 'quote' : e.textContent);
  assert.deepEqual(order, ['Source', 'Events', 'Polls', 'Open capability', 'Parameters', 'quote']);
  assert.deepEqual(quote(card.querySelector('.source-quote')), { lead: 'From the trigger file:', labelledBy: true, role: 'group', lines: [[['text', 'prefix = harvest/']], [['text', 'graph = kb']]] });
  card.querySelector('[data-verb=capability]').click();
  assert.deepEqual(u.opened, ['acme.graph'], 'Open capability asks for the capability by its name');
  assert.equal(card.querySelector('[data-verb=capability]').getAttribute('aria-label'), 'Open capability acme.graph');
  assertInert(u.host);
});

test('the On card without a catalog match, without parameters, and before status is read', async t => {
  const json = structuredClone(fx('trigger-list')); delete json.triggers.find(r => r.id === 'ws/trusted').on.params; json.triggers.find(r => r.id === 'ws/untrusted').on.params = {};
  const never = new Promise(() => {});
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { pretendToBeVisual: true }), host = dom.window.document.querySelector('main');
  const view = createAutomationsView(host, { kind: 'trigger', sources: true, read: async () => json, status: () => never, now: () => NOW, openCapability: () => {}, canOpenCapability: () => false });
  t.after(() => { view.dispose(); dom.window.close(); });
  for (const id of ['ws/trusted', 'ws/untrusted']) {
    await tick(); view.open(id); await tick();
    const card = host.querySelector('.page-card[data-card="On"]');
    assert.equal(facts(card).Source, 'acme.graph · harvest-branches', 'from the row, split from on.source');
    assert.equal(card.querySelector('[data-verb=capability]'), null, 'the source stays text when the catalog does not list its capability');
    assert.equal(card.querySelector('.source-quote'), null); assert.equal(card.textContent.includes('Parameters'), false, 'no Parameters fact when there are none');
  }
});

test('a good poll: its counts, only the non-zero ones; then the refused and skipped lists, labelled by that poll', async t => {
  const u = mount(t); await openPage(u);
  const fires = u.$('.page-section[data-section="Recent fires"]');
  assert.equal(fires.querySelector('.auto-test-line').textContent, 'Last poll 20 min ago: 1 event, 1 filtered, 2 skipped, 3 refused');
  assert.equal(fires.querySelectorAll('.auto-test-line').length, 1, 'no Last error');
  const lists = fires.querySelector('.auto-source-lists');
  assert.equal(lists.querySelector('.auto-lists-from').textContent, 'At the last poll, 20 min ago');
  assert.ok(lists.querySelector('.auto-lists-from time').title, 'with its exact time');
  assert.deepEqual([...lists.querySelectorAll('.auto-list-head')].map(h => h.textContent), ['Refused by OATS', 'Skipped by the source']);
  const [refused, skipped] = [...lists.querySelectorAll('.source-quote')].map(quote);
  assert.deepEqual([refused.lead, refused.role, refused.labelledBy], [LEAD, 'group', true]);
  assert.deepEqual(refused.lines.map(l => l.map(([cls, text]) => cls === 'text' ? cls : text)), [['text', "Refused: a URL that isn't allowed."], ['text', "Refused: an event this source doesn't declare."], ['text', 'Refused: not an event object.']]);
  assert.equal(refused.lines[2][0][1], '"not an object"', 'the event as the source wrote it, quoted');
  assert.deepEqual(skipped, { lead: LEAD, labelledBy: true, role: 'group', lines: [[['label', 'harvest/y'], ['text', HOSTILE]], [['label', 'harvest/z'], ['text', 'not judged yet']]] });
  assertInert(u.host);
  // A poll with nothing left out says only its events.
  const quiet = structuredClone(fx('trigger-status-good')); Object.assign(quiet.triggers.find(r => r.id === 'ws/trusted'), { lastPoll: { at: '2026-10-08T12:19:00.000Z', ok: true, events: 1, invalidEvents: 0, skipped: 0, filtered: 0 }, invalidEvents: [], skipped: [] });
  const v = mount(t, { statusJson: quiet }); await openPage(v);
  assert.equal(v.$('.page-section[data-section="Recent fires"] .auto-test-line').textContent, 'Last poll 1 min ago: 1 event');
  assert.equal(v.$('.auto-source-lists'), null, 'each list only when it has entries');
});

test('attribution: a hostile `why` is quoted data under its lead-in; no element, link or button is made from it', async t => {
  const u = mount(t); await openPage(u);
  const page = u.$('.auto-page'), holders = [...page.querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.includes('this trigger is trusted')));
  assert.deepEqual(holders.map(e => e.className), ['source-quote-text'], 'the text exists only inside the quote');
  assert.equal(holders[0].tagName, 'BLOCKQUOTE'); assert.equal(holders[0].textContent, HOSTILE, 'markup, a URL and a Desktop-like sentence, as text');
  assert.equal(page.querySelector('img, a[href*="evil"], [onerror]'), null);
  assert.equal([...page.querySelectorAll('[title]')].some(e => e.title.includes('evil.example')), false, 'never in a tooltip');
  assert.equal(holders[0].closest('.source-quote').querySelector('.source-quote-lead').textContent, LEAD);
  assertInert(u.host);
});

test('a refused poll: the cause in the Desktop\'s words, the kernel\'s error with its code, the source\'s own words quoted; said once', async t => {
  const u = mount(t, { status: 'trigger-status-refused' }); await openPage(u);
  const fires = u.$('.page-section[data-section="Recent fires"]'), lines = [...fires.querySelectorAll('.auto-test-line')];
  assert.deepEqual(lines.map(p => p.textContent), ['Last poll 19 min ago failed: the source refused', 'acme.graph:harvest-branches refused the poll E_TRIGGER_POLL']);
  assert.equal(lines[1].querySelector('code.auto-mono').textContent, 'E_TRIGGER_POLL', 'lastError is this same failure: its code beside the kernel\'s text, no second line');
  assert.equal(fires.textContent.includes('Last error'), false);
  const said = quote(lines[1].nextElementSibling);
  assert.deepEqual(said, { lead: LEAD, labelledBy: true, role: 'group', lines: [[['text', 'E_GRAPH_<b>DOWN</b>'], ['text', HOSTILE]]] });
  assert.equal(fires.querySelector('.auto-lists-from').textContent, 'From the last successful poll, before the failure above', 'the lists are stale: no time is claimed');
  assert.equal(fires.querySelector('.auto-lists-from time'), null);
  assert.equal(fires.querySelectorAll('.auto-source-list').length, 2);
  assertInert(u.host);
});

test('every cause has its words; an unknown cause shows its code; a different last error keeps its own line', async t => {
  const words = { exit: "the source's command failed", result: "the source's answer was not valid", 'too-many-events': 'the source returned too many events', timeout: "the source's command timed out", resolution: 'the source could not be found', quota: 'quota' };
  for (const [cause, expected] of Object.entries(words)) {
    const st = structuredClone(fx('trigger-status-exit')), row = st.triggers.find(r => r.id === 'ws/trusted'); row.lastPoll.cause = cause;
    row.lastError = { at: '2026-10-08T12:01:00.000Z', code: 'E_INSTANCE_NAME_INVALID', message: 'The soul name is too long', source: { code: 'X_OLD', message: 'older words' } };
    const u = mount(t, { statusJson: st }); await openPage(u);
    const lines = [...u.$$('.page-section[data-section="Recent fires"] .auto-test-line')].map(p => p.textContent);
    assert.deepEqual(lines, [`Last poll 18 min ago failed: ${expected}`, 'acme.graph:harvest-branches: the source exited 3', 'Last error: The soul name is too long E_INSTANCE_NAME_INVALID'], cause);
    assert.deepEqual(quote(u.$('.page-section[data-section="Recent fires"] .source-quote')).lines, [[['text', 'X_OLD'], ['text', 'older words']]], 'lastError.source, quoted under its own line');
  }
});

test('a failed source check: its own card with the kernel\'s message, code and time; never "Invalid", and said once', async t => {
  const u = mount(t, { list: 'trigger-list-invalid', status: 'trigger-status-invalid' }); await openPage(u);
  const card = u.$('.page-card[data-card="Source check failed"]'), f = facts(card);
  assert.match(f.Message, /^acme\.graph:harvest-branches: capability acme\.graph declares it malformed: .*command "missing" is not one of the manifest's commands/);
  assert.deepEqual([f.Code, f.Checked, f.Field], ['E_TRIGGER_SOURCE', '6 min ago', undefined]);
  assert.equal(u.$('.page-card[data-card="Invalid"]'), null);
  const fires = u.$('.page-section[data-section="Recent fires"]');
  assert.equal(fires.textContent.includes('Last error'), false, 'lastError repeats the invalid: shown once, in its card');
  assert.match(fires.querySelector('.auto-test-line').textContent, /^Last poll 18 min ago failed: the source's command failed$/, 'lastPoll is left as it was');
  // A field, when the kernel names one; an `invalid` without a time keeps today's Invalid card.
  const list = structuredClone(fx('trigger-list-invalid')), row = list.triggers.find(r => r.id === 'ws/trusted');
  row.invalid = { code: 'E_TRIGGER_INVALID', message: 'on.params.prefix does not match', field: 'on.params.prefix', at: '2026-10-08T12:19:00.000Z' };
  const v = mount(t, { json: list, status: 'trigger-status-good' }); await openPage(v);
  assert.deepEqual(facts(v.$('.page-card[data-card="Source check failed"]')), { Message: 'on.params.prefix does not match', Code: 'E_TRIGGER_INVALID', Field: 'on.params.prefix', Checked: '1 min ago' });
  delete row.invalid.at;
  const w = mount(t, { json: list, status: 'trigger-status-good' }); await openPage(w);
  assert.equal(w.$('.page-card[data-card="Source check failed"]'), null);
  assert.deepEqual(facts(w.$('.page-card[data-card="Invalid"]')), { Code: 'E_TRIGGER_INVALID', Field: 'on.params.prefix', Message: 'on.params.prefix does not match' });
  assert.equal(w.$('.auto-row[data-id="ws/trusted"] .auto-source-check'), null);
});

test('at most ten refused and ten skipped, then "and N more"; long parameter lists are capped at 16', async t => {
  const st = structuredClone(fx('trigger-status-good')), row = st.triggers.find(r => r.id === 'ws/trusted');
  row.invalidEvents = Array.from({ length: 14 }, (_, i) => ({ text: `{"n":${i}}`, rule: 'key' })); row.skipped = Array.from({ length: 11 }, (_, i) => ({ subject: `s${i}`, why: `w${i}` }));
  const list = structuredClone(fx('trigger-list')); list.triggers.find(r => r.id === 'ws/trusted').on.params = Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`p${i}`, `v${i}`]));
  const u = mount(t, { json: list, statusJson: st }); await openPage(u);
  const [refused, skipped] = u.$$('.page-section[data-section="Recent fires"] .auto-source-list');
  assert.deepEqual([refused.querySelectorAll('.source-quote-line').length, refused.querySelector('.page-note').textContent], [10, 'and 4 more']);
  assert.deepEqual([skipped.querySelectorAll('.source-quote-line').length, skipped.querySelector('.page-note').textContent], [10, 'and 1 more']);
  const params = u.$('.page-card[data-card="On"] .auto-params');
  assert.deepEqual([params.querySelectorAll('.source-quote-line').length, params.querySelector('.page-note').textContent], [16, 'and 3 more']);
});

test('the prompt: a capability source\'s fields are highlighted, with its own note; a pull request\'s gain subject, key and trigger', async t => {
  const u = mount(t); await openPage(u);
  const prompt = u.$('.page-section[data-section="Prompt"]');
  assert.deepEqual([...prompt.querySelectorAll('.auto-token')].map(s => s.textContent), ['{subject}', '{fields.graph}', '{url}']);
  assert.equal(prompt.querySelector('.page-note').textContent, "The highlighted fields are filled from the source's event after OATS checks them. They are still the source's data, and the instance is told so.");
  const list = structuredClone(fx('trigger-list')); list.triggers.find(r => r.id === 'local/prs').spawn.task = list.triggers.find(r => r.id === 'local/prs').task = 'Review {url} {subject} {key} {trigger} {source} {fields.graph}';
  const v = mount(t, { json: list }); await openPage(v, 'local/prs');
  const pr = v.$('.page-section[data-section="Prompt"]');
  assert.deepEqual([...pr.querySelectorAll('.auto-token')].map(s => s.textContent), ['{url}', '{subject}', '{key}', '{trigger}']);
  assert.equal(pr.querySelector('.page-note').textContent, 'Pull request titles and bodies are never inserted: the instance reads them from its event file.');
});

test('a pull-request trigger keeps its page and its one-click Test, beside capability sources', async t => {
  const u = mount(t); await openPage(u, 'local/prs');
  assert.deepEqual(facts(u.$('.page-card[data-card="On"]')), { Event: 'Pull request opened', Repo: 'acme/kb', Polls: 'every 2m' });
  assert.equal(u.$('.page-section[data-section="Recent fires"] .auto-test-line').textContent, 'Last poll 20 min ago: 0 pull requests, 0 matching');
  assert.equal(u.$('.source-quote'), null); assert.equal(u.$('.auto-confirm'), null);
  u.$('.page-bar [data-verb=test]').click(); await tick(); await tick();
  assert.deepEqual(u.acts, [['test', 'local/prs', undefined]], 'one click, one test, and no runSource');
  assert.equal(u.$('.auto-confirm'), null);
  const card = u.$('.page-card[data-card="Test result"]');
  assert.equal(card.querySelector('.auto-test-line').textContent, 'Not ready on this computer.');
  assert.equal(u.$('.page-side').lastElementChild, card, 'where it was');
  assert.equal(card.querySelector('.page-card-title').hasAttribute('tabindex'), false);
});

test('an older kernel (no trigger-sources): nothing changes, even for a row whose source is not github.pull_request', async t => {
  const u = mount(t, { sources: false, list: 'trigger-list-invalid', status: 'trigger-status-invalid' }); await tick();
  const row = u.$('.auto-row[data-id="ws/trusted"]');
  assert.equal(row.querySelectorAll('.auto-cell')[2].querySelector('.auto-main-line').textContent, 'acme.graph:harvest-branches opened', "today's title");
  assert.equal(row.querySelector('.auto-source-check'), null);
  assert.deepEqual([...row.querySelectorAll('.auto-tag.warn')].map(x => x.textContent), ['Invalid']);
  await openPage(u);
  assert.deepEqual(facts(u.$('.page-card[data-card="On"]')), { Event: 'acme.graph:harvest-branches opened', Polls: 'every 1m' });
  assert.equal(u.$('.source-quote'), null); assert.equal(u.$('.auto-source-lists'), null); assert.equal(u.$('.page-card[data-card="Source check failed"]'), null);
  assert.ok(u.$('.page-card[data-card="Invalid"]'));
  assert.deepEqual([...u.$$('.page-section[data-section="Prompt"] .auto-token')].map(s => s.textContent), ['{url}'], "today's five fields");
  assert.equal(u.$('.page-section[data-section="Prompt"] .page-note').textContent, 'Pull request titles and bodies are never inserted: the instance reads them from its event file.');
  u.$('.page-bar [data-verb=test]').click(); await tick(); await tick();
  assert.deepEqual(u.acts, [['test', 'ws/trusted', undefined]], 'one-click Test, no confirm, no runSource');
  assert.equal(u.$('.auto-confirm'), null);
});

// ── The Test result card of a capability source (item 8): the source first, then placement as the kernel reports it ──
async function tested(t, id, fixture, { mutate = null } = {}) {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { pretendToBeVisual: true }), host = dom.window.document.querySelector('main'), acts = [];
  const answer = structuredClone(fx(fixture)); mutate?.(answer);
  const view = createAutomationsView(host, { kind: 'trigger', sources: true, read: async () => fx('trigger-list'), status: async () => fx('trigger-status-good'), now: () => NOW,
    act: async (verb, row, opts) => { acts.push([verb, row.id, opts]); return answer; } });
  t.after(() => { view.dispose(); dom.window.close(); });
  await tick(); host.querySelector(`.auto-row[data-id="${id}"] .auto-open`).click(); await tick(); await tick();
  host.querySelector('.page-bar [data-verb=test]').click(); await tick(); host.querySelector('[data-verb=run-test]').click(); await tick(); await tick();
  assert.deepEqual(acts, [['test', id, { runSource: true }]], 'one confirmed test');
  const card = host.querySelector('.page-card[data-card="Test result"]');
  return { host, card, lines: [...card.querySelectorAll(':scope > .auto-test-line')].map(p => p.textContent) };
}
const CREDENTIAL = "this source's credential may not be visible to the host timer: it runs with only PATH and OATS_HOME_DIR set, so keep the source's login in its own store, not in an exported variable";

test('Test result, the source answered on a row that runs here: its counts, "Would run here on its own", what would fire with its URL as text', async t => {
  const u = await tested(t, 'ws/trusted', 'trigger-test-trusted');
  assert.deepEqual(u.lines, ['The source answered: 1 event, 1 filtered, 2 skipped, 3 refused', 'Would run here on its own', CREDENTIAL, 'gh acts as kb-bot', 'Would fire now:']);
  assert.equal(u.host.querySelector('.page-side').firstElementChild, u.card, 'the result leads the side column');
  assert.equal(u.card.textContent.includes('Ready: it would run here'), false, 'never "Ready" from ok alone');
  const fire = u.card.querySelector('.auto-fire li');
  assert.equal(fire.textContent, 'harvest/a → reviewer-trusted-harvest-ahttps://graph.example.org/a');
  assert.equal(fire.querySelector('.auto-fire-url').textContent, 'https://graph.example.org/a'); assert.equal(fire.querySelector('a, [href]'), null, 'the URL is the source\'s: text, never a link');
  assert.deepEqual([...u.card.querySelectorAll('.auto-list-head')].map(h => h.textContent), ['Refused by OATS', 'Skipped by the source'], 'the lists as on the page');
  assert.equal(u.card.querySelector('.auto-lists-from'), null, 'they are this test\'s own');
  assert.equal(u.card.querySelector('.source-quote-lead').textContent, LEAD);
  assertInert(u.host);
});

test('Test result, a local trigger (gh null): no "gh acts as" line; nothing would fire only when the source answered', async t => {
  const u = await tested(t, 'local/harvest', 'trigger-test-local', { mutate: a => { a.wouldFire = []; a.source.events = []; a.source.invalidEvents = []; a.source.skipped = []; } });
  assert.deepEqual(u.lines, ['The source answered: 0 events', 'Would run here on its own', CREDENTIAL, 'Nothing would fire now.']);
  assert.equal(u.card.querySelector('.source-quote'), null);
});

test('Test result, placement: an untrusted row and one another host runs were "Tested by hand", with the kernel\'s problems', async t => {
  const u = await tested(t, 'ws/untrusted', 'trigger-test-untrusted');
  assert.deepEqual(u.lines.slice(0, 3), ['The source answered: 1 event, 1 filtered, 2 skipped, 3 refused', 'Tested by hand',
    'run manually with --run-source; the tick will not run it here: untrusted (declared for this host, not trusted here; to run it, add the line "- ws/untrusted" under automations: trust: in oats-local.yaml)']);
  assert.equal(u.card.textContent.includes('Would run here on its own'), false);
  const v = await tested(t, 'ws/elsewhere', 'trigger-test-elsewhere');
  assert.deepEqual(v.lines.slice(1, 3), ['Tested by hand', 'run manually with --run-source; the tick will not run it here: assigned-elsewhere (runs on other-host; this host is kb-host)']);
});

test('Test result, the poll failed: the cause, the kernel\'s error once, the source\'s own words quoted; nothing about what would fire', async t => {
  const u = await tested(t, 'ws/trusted', 'trigger-test-refused');
  assert.deepEqual(u.lines, ['The poll failed: the source refused', 'acme.graph:harvest-branches refused the poll E_TRIGGER_POLL', CREDENTIAL, 'gh acts as kb-bot'],
    'no placement line: the only "problem" was the failure itself; and nothing about firing');
  assert.equal(u.card.textContent.includes('fire'), false); assert.equal(u.card.textContent.includes('Tested by hand'), false);
  assert.deepEqual(quote(u.card.querySelector('.source-quote')), { lead: LEAD, labelledBy: true, role: 'group', lines: [[['text', 'E_GRAPH_<b>DOWN</b>'], ['text', HOSTILE]]] });
  assertInert(u.host);
  const v = await tested(t, 'ws/untrusted', 'trigger-test-exit');
  assert.deepEqual(v.lines.slice(0, 4), ["The poll failed: the source's command failed", 'acme.graph:harvest-branches: the source exited 3 E_TRIGGER_POLL', 'Tested by hand',
    'run manually with --run-source; the tick will not run it here: untrusted (declared for this host, not trusted here; to run it, add the line "- ws/untrusted" under automations: trust: in oats-local.yaml)']);
  assert.equal(v.card.querySelector('.source-quote'), null, 'the source said nothing of its own');
});

test('Test result, the source check failed: the kernel\'s message, code and field', async t => {
  const u = await tested(t, 'ws/trusted', 'trigger-test-invalid', { mutate: a => { a.source.invalid.field = 'on.source'; } });
  assert.equal(u.lines[0], 'The source check failed');
  const f = facts(u.card);
  assert.match(f.Message, /command "missing" is not one of the manifest's commands/); assert.deepEqual([f.Code, f.Field], ['E_TRIGGER_SOURCE', 'on.source']);
  assert.equal(u.card.textContent.includes('fire'), false); assert.equal(u.card.textContent.includes('Tested by hand'), false);
});
