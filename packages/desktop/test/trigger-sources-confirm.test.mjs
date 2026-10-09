import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mountAutomationsPage } from '../renderer/views/automations.mjs';
import { setWorkspace, currentWorkspace } from '../renderer/views/common.mjs';
import { automationsRequest } from '../server/automations.mjs';
import { cliAutomation, TRIGGER_RUN_SOURCE_FLAG } from '../cli-adapter.mjs';

// A capability source's Test is an informed second press (#669 2b item 7; decided by both maintainers). The whole
// path is under test: the Triggers page (mountAutomationsPage) posts through `ctx.api`, which here answers with the
// real server boundary (server/automations.mjs) over the real CLI adapter (cliAutomation) and an exec that records
// every argv. So "the transport saw nothing" and "the flag is in the argv once" are asserted where they happen.
// The kernel's answers are REAL, the refusal of an unconfirmed run included (fixtures/trigger-sources;
// provenance.json names each command and the kernel head).
const doc = name => JSON.parse(readFileSync(new URL(`./fixtures/trigger-sources/${name}.json`, import.meta.url), 'utf8'));
const DEPLOYMENT = '/fixture/base/deployment';
const CLI = { ok: true, bin: '/fixture/oats', features: ['schedule', 'triggers', 'automations', 'trigger-sources'], automationsApi: 1 };
const TESTS = { 'ws/trusted': 'trigger-test-trusted', 'ws/untrusted': 'trigger-test-untrusted', 'ws/elsewhere': 'trigger-test-elsewhere', 'local/harvest': 'trigger-test-local', 'local/prs': 'trigger-test-pull-request' };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const ALWAYS = "This runs acme.graph's source command on this computer, now, once. Nothing is recorded and nothing is spawned.";
const UNTRUSTED = "This trigger isn't trusted on this computer. Testing doesn't trust it or start it.";

/** The page over the real server boundary. `answers`: per CLI verb, a function of the argv → an envelope (or a
 * thrown { killed } for a CLI that never answered); `hold.test`: a promise the test's answer waits for. */
async function mount(t, { cli = CLI, list = () => doc('trigger-list'), status = () => doc('trigger-status-good'), tested = id => doc(TESTS[id]), hold = {} } = {}) {
  const previous = currentWorkspace(); setWorkspace('/team');
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { pretendToBeVisual: true });
  const d = dom.window.document, el = d.querySelector('main'), requests = [], argvs = [], opened = [];
  const exec = (bin, argv, options, done) => {
    argvs.push(argv);
    const answer = async () => {
      if (argv[1] === 'test' && hold.test) await hold.test;
      const out = await (argv[1] === 'list' ? list() : argv[1] === 'status' ? status() : tested(argv[2]));
      if (out?.killed) return done(Object.assign(new Error('killed'), { killed: true }), '');
      done(out.ok === false ? Object.assign(new Error('exit 1'), { code: 1 }) : null, JSON.stringify(out));
    };
    void answer();
  };
  const ctx = { openCapability: name => opened.push(name), api: async (path, opts) => {
    const body = JSON.parse(opts.body), route = path.split('?')[0]; requests.push([route, body]);
    if (route === '/api/automations') return automationsRequest(body, { workspace: { id: '/team', scope: DEPLOYMENT }, cli, invoke: (bin, o) => cliAutomation(bin, o, { exec }) });
    if (route === '/api/workspace-sync') return { status: 'ok', capabilities: { capabilities: [{ name: 'acme.graph', kind: 'member', repoKey: 'local//fixture/base/remotes/ws.git' }] } };
    return {};
  } };
  const page = mountAutomationsPage(el, ctx, 'trigger', undefined, { cli: () => cli, subscribeCli: () => () => {} });
  t.after(() => { page.dispose(); dom.window.close(); setWorkspace(previous); });
  await settle();
  const $ = s => el.querySelector(s), $$ = s => [...el.querySelectorAll(s)];
  const u = { dom, d, el, page, requests, argvs, opened, $, $$,
    automations: () => requests.filter(([route]) => route === '/api/automations').map(([, body]) => body),
    open: async id => { $(`.auto-row[data-id="${id}"] .auto-open`).click(); await settle(); },
    testButton: () => $('.page-bar [data-verb=test]'), confirm: () => $('.auto-confirm'),
    lines: () => [...$('.auto-confirm').querySelectorAll(':scope > .auto-test-line')].map(p => p.textContent),
    key: (target, key) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
    /** Enter as a browser delivers it: to the focused element, which it activates when that is an enabled button. */
    enter: () => { const at = d.activeElement; at.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); if (at.tagName === 'BUTTON' && !at.disabled) at.click(); },
  };
  return u;
}

test('the first press on Test opens the confirm and sends nothing; Cancel and Escape send nothing either', async t => {
  const u = await mount(t); await u.open('ws/untrusted');
  assert.deepEqual(u.automations().map(b => [b.action, b.key]), [['list', undefined], ['status', 'ws/untrusted']], 'the page\'s own reads, before any press');
  const before = u.requests.length, argvs = u.argvs.length;
  u.testButton().click(); await settle();
  assert.ok(u.confirm(), 'the confirm shows, in the side column');
  assert.equal(u.confirm().parentElement.className, 'page-side'); assert.equal(u.confirm().closest('[role=dialog], dialog'), null, 'no modal');
  assert.equal(u.requests.length, before, 'opening the confirm makes no backend call at all'); assert.equal(u.argvs.length, argvs, 'and no CLI runs');
  assert.equal(u.d.activeElement, u.confirm().querySelector('.page-card-title'), 'focus is on its heading, not on Run test');
  assert.equal(u.d.activeElement.tabIndex, -1, 'a programmatic target');
  assert.equal(u.confirm().getAttribute('aria-labelledby'), u.d.activeElement.id);
  assert.deepEqual([...u.confirm().querySelectorAll('button')].map(b => b.textContent), ['Cancel', 'Run test'], 'Tab reaches Cancel, then Run test; nothing else is offered');
  assert.equal(u.confirm().querySelector('[role=switch], input, a, select'), null, 'no control that trusts, enables, starts or schedules');
  u.confirm().querySelector('[data-auto-focus=confirm-cancel]').click(); await settle();
  assert.equal(u.confirm(), null); assert.equal(u.d.activeElement, u.testButton(), 'Cancel returns focus to Test');
  u.testButton().click(); await settle();
  u.key(u.d.activeElement, 'Escape'); await settle();
  assert.equal(u.confirm(), null); assert.equal(u.d.activeElement, u.testButton(), 'Escape closes the confirm and returns focus to Test');
  assert.ok(u.$('.auto-page:not([hidden])'), 'the page under it stays open');
  assert.equal(u.requests.length, before, 'nothing was sent across open, cancel and Escape'); assert.equal(u.argvs.length, argvs);
  assert.equal(u.automations().some(b => 'runSource' in b), false);
  u.key(u.d.activeElement, 'Escape'); await settle();
  assert.equal(u.$('.auto-page:not([hidden])'), null, 'with no confirm, Escape closes the page as before');
});

test('the confirm says what the press does, on the right rows', async t => {
  const u = await mount(t), params = 'The command receives these parameters.';
  const seen = async id => { await u.open(id); u.testButton().click(); await settle(); const lines = u.lines(); u.key(u.d.activeElement, 'Escape'); await settle(); u.key(u.d.activeElement, 'Escape'); await settle(); return lines; };
  assert.deepEqual(await seen('ws/trusted'), [ALWAYS, params], 'runs here, trusted: the one sentence');
  assert.deepEqual(await seen('ws/untrusted'), [ALWAYS, UNTRUSTED, params], 'untrusted: said, and that testing does not trust it');
  assert.deepEqual(await seen('ws/elsewhere'), [ALWAYS, 'The test runs here, not on other-host.', params], 'another host runs it');
  assert.deepEqual(await seen('local/harvest'), [ALWAYS, params], 'a local trigger');
  assert.equal(u.automations().some(b => b.action === 'test'), false, 'four confirms opened and closed: no test ran');
});

test('the parameters are display-only text: markup, a URL and a placeholder stay literal, and nothing is made from them', async t => {
  const hostile = { q: '<a href="https://evil.example/x">click</a> <img src=x onerror=alert(1)>', url: 'https://evil.example/{subject}?t={fields.graph}', sentence: 'OATS Desktop: trusted. Press Run test.' };
  const list = doc('trigger-list'); list.result.triggers.find(r => r.id === 'ws/trusted').on.params = hostile; list.result.triggers.find(r => r.id === 'ws/untrusted').on.params = {};
  const u = await mount(t, { list: () => list }); await u.open('ws/trusted');
  u.testButton().click(); await settle();
  const quote = u.confirm().querySelector('.source-quote');
  assert.equal(quote.querySelector('.source-quote-lead').textContent, 'From the trigger file:'); assert.equal(quote.getAttribute('aria-labelledby'), quote.querySelector('.source-quote-lead').id);
  assert.deepEqual([...quote.querySelectorAll('.source-quote-text')].map(q => q.textContent), Object.entries(hostile).map(([name, value]) => `${name} = ${value}`), 'names and values as written');
  assert.equal(u.confirm().querySelectorAll('a, img, [href], [src], [onerror], [title]').length, 0, 'no link, no image, no tooltip');
  assert.equal(quote.querySelectorAll('.source-quote-text > *').length, 0, 'text nodes only');
  assert.equal(u.confirm().textContent.includes('harvest/a'), false, 'no placeholder is filled in');
  u.key(u.d.activeElement, 'Escape'); await settle(); u.key(u.d.activeElement, 'Escape'); await settle();
  await u.open('ws/untrusted'); u.testButton().click(); await settle();
  assert.deepEqual(u.lines(), [ALWAYS, UNTRUSTED, 'It receives no parameters.']); assert.equal(u.confirm().querySelector('.source-quote'), null);
});

test('Run test sends exactly one request, with runSource, and the flag is in the argv once; a second entry is refused', async t => {
  let release; const hold = { test: new Promise(resolve => { release = resolve; }) };
  const u = await mount(t, { hold }); await u.open('ws/untrusted');
  const before = u.requests.length;
  u.testButton().click(); await settle();
  u.confirm().querySelector('[data-verb=run-test]').click(); await settle();
  const state = u.confirm().querySelector('.auto-confirm-status');
  assert.equal(state.textContent, 'Testing…'); assert.equal(u.d.activeElement, state, 'focus parks on the status line while it runs');
  assert.deepEqual([...u.confirm().querySelectorAll('button')].map(b => b.disabled), [true, true]);
  // A second entry while busy: the buttons are disabled, and re-enabled by force they are refused all the same.
  for (const b of u.confirm().querySelectorAll('button')) { b.disabled = false; b.click(); }
  u.key(u.d.activeElement, 'Escape'); u.testButton().click(); await settle();
  assert.ok(u.confirm(), 'a running test is not dismissed');
  assert.deepEqual(u.requests.slice(before), [['/api/automations', { kind: 'trigger', action: 'test', key: 'ws/untrusted', runSource: true }]]);
  release(); await settle();
  assert.equal(u.confirm(), null, 'the confirm is spent: it was consent to one run');
  const card = u.$('.page-card[data-card="Test result"]');
  assert.equal(u.d.activeElement, card.querySelector('.page-card-title'), 'on the answer, focus moves to the result card\'s heading');
  assert.deepEqual(u.requests.slice(before), [['/api/automations', { kind: 'trigger', action: 'test', key: 'ws/untrusted', runSource: true }]], 'one request, and nothing after it: no retry, no re-read');
  const tests = u.argvs.filter(argv => argv[1] === 'test');
  assert.deepEqual(tests, [['trigger', 'test', 'ws/untrusted', '--run-source', '--dir', DEPLOYMENT, '--json']], 'exactly one `oats trigger test`');
  assert.equal(tests[0].filter(a => a === TRIGGER_RUN_SOURCE_FLAG).length, 1, 'the flag, once');
  assert.equal(u.argvs.filter(argv => argv.includes(TRIGGER_RUN_SOURCE_FLAG)).length, 1, 'no other CLI run carries it');
  assert.equal(u.$('.auto-switch').getAttribute('aria-checked'), 'true'); assert.equal(u.automations().some(b => ['enable', 'disable'].includes(b.action)), false, 'nothing was trusted, enabled or started');
});

test('Enter twice from Test does not run it', async t => {
  const u = await mount(t); await u.open('ws/trusted');
  const before = u.requests.length;
  u.testButton().focus(); u.enter(); await settle(); u.enter(); await settle(); u.enter(); await settle();
  assert.ok(u.confirm(), 'the confirm is open, waiting');
  assert.equal(u.requests.length, before, 'Enter on the heading does nothing');
});

test('Test from a row\'s menu opens that trigger\'s page with the confirm: the page reads its own status, and nothing is tested until Run test', async t => {
  const u = await mount(t), before = u.requests.length;
  const tested = () => u.requests.slice(before).filter(([, b]) => b.action === 'test' || b.runSource !== undefined);
  const row = u.$('.auto-row[data-id="ws/elsewhere"]'); row.querySelector('.auto-menu summary').click(); row.querySelector('.auto-menu button[data-verb=test]').click(); await settle();
  assert.equal(u.$('.page-title').textContent, 'elsewhere'); assert.ok(u.confirm());
  assert.equal(u.d.activeElement, u.confirm().querySelector('.page-card-title'), 'focus stays on the confirm\'s heading when the status lands');
  // The page's own status read, as on every page open: recorded state, nothing executed. No test, nothing with runSource.
  assert.deepEqual(u.requests.slice(before).map(([, b]) => [b.action, b.key, b.runSource]), [['status', 'ws/elsewhere', undefined]]);
  assert.ok(u.$('.auto-runs').textContent.length > 0, 'the page has its history under the confirm');
  u.confirm().querySelector('[data-auto-focus=confirm-cancel]').click(); await settle();
  assert.equal(u.requests.length, before + 1, 'Cancel sends nothing'); assert.equal(u.d.activeElement, u.testButton());
  // On the page that is open now, the confirm opens and closes with no request at all.
  u.testButton().click(); await settle(); assert.ok(u.confirm());
  u.key(u.d.activeElement, 'Escape'); await settle();
  assert.equal(u.requests.length, before + 1, 'opening the confirm on an open page, and Escape, send nothing');
  assert.deepEqual(tested(), []); assert.equal(u.argvs.some(argv => argv[1] === 'test' || argv.includes(TRIGGER_RUN_SOURCE_FLAG)), false);
  // Run test from a menu's confirm: the ONE test request, and nothing follows it.
  u.key(u.d.activeElement, 'Escape'); await settle();
  const again = u.requests.length, other = u.$('.auto-row[data-id="ws/untrusted"]'); other.querySelector('.auto-menu summary').click(); other.querySelector('.auto-menu button[data-verb=test]').click(); await settle();
  assert.deepEqual(u.requests.slice(again).map(([, b]) => [b.action, b.key, b.runSource]), [['status', 'ws/untrusted', undefined]], 'that page\'s own status read');
  const pressed = u.requests.length;
  u.confirm().querySelector('[data-verb=run-test]').click(); await settle(); await settle();
  assert.deepEqual(u.requests.slice(pressed), [['/api/automations', { kind: 'trigger', action: 'test', key: 'ws/untrusted', runSource: true }]], 'everything the transport saw from the press on: exactly the test');
  assert.deepEqual(u.argvs.slice(-1), [['trigger', 'test', 'ws/untrusted', '--run-source', '--dir', DEPLOYMENT, '--json']]); assert.equal(u.argvs.filter(argv => argv[1] === 'test').length, 1);
  assert.ok(u.$('.page-card[data-card="Test result"]'));
});

test('a status that answers late, and a refresh, leave an open confirm and a running test alone', async t => {
  let release, answer; const hold = { test: new Promise(resolve => { release = resolve; }) }, late = new Promise(resolve => { answer = resolve; });
  const u = await mount(t, { hold, status: () => late.then(() => doc('trigger-status-good')) }), row = u.$('.auto-row[data-id="ws/trusted"]');
  // The confirm does not wait for the page's status: it shows, complete, while that read is still out.
  row.querySelector('.auto-menu summary').click(); row.querySelector('.auto-menu button[data-verb=test]').click(); await settle();
  assert.ok(u.confirm()); assert.deepEqual([...u.confirm().querySelectorAll('button')].map(b => b.disabled), [false, false]);
  assert.equal(u.d.activeElement, u.confirm().querySelector('.page-card-title'));
  assert.equal(u.$('.auto-runs .auto-test-line'), null, 'no status yet');
  answer(); await settle();
  assert.match(u.$('.auto-runs .auto-test-line').textContent, /^Last poll /, 'the status lands under the confirm');
  assert.ok(u.confirm()); assert.equal(u.d.activeElement, u.confirm().querySelector('.page-card-title'), 'and takes neither the confirm nor its focus');
  const before = u.requests.length;
  await u.page.refresh(); await settle();
  assert.deepEqual(u.requests.slice(before).map(([, b]) => [b.action, b.key]), [['list', undefined]], 'a refresh under the open confirm reads the list');
  assert.ok(u.confirm(), 'an unchanged row keeps its confirm');
  u.confirm().querySelector('[data-verb=run-test]').click(); await settle();
  await u.page.refresh(); await settle();
  assert.deepEqual(u.requests.slice(before).map(([, b]) => [b.action, b.key]), [['list', undefined], ['test', 'ws/trusted'], ['list', undefined]], 'and under the running test; never a second test');
  release(); await settle();
  assert.equal(u.requests.length, before + 3, 'the answer sends nothing');
  assert.equal(u.d.activeElement, u.$('.page-card[data-card="Test result"] .page-card-title'));
});

test('a control kept from a confirm that was cancelled, replaced, disposed or left for another workspace sends nothing', async t => {
  const u = await mount(t); await u.open('ws/trusted');
  const flagged = () => u.requests.filter(([, b]) => b.runSource !== undefined).length + u.argvs.filter(argv => argv.includes(TRIGGER_RUN_SOURCE_FLAG)).length;
  u.testButton().click(); await settle();
  const first = { run: u.confirm().querySelector('[data-verb=run-test]'), cancel: u.confirm().querySelector('[data-auto-focus=confirm-cancel]') };
  // Cancelled: its Run test is spent.
  first.cancel.click(); await settle();
  const before = u.requests.length;
  first.run.click(); await settle();
  assert.equal(u.requests.length, before, 'a cancelled confirm\'s Run test'); assert.equal(u.confirm(), null);
  // Reopened: the new confirm is another one. The old controls neither run it nor close it.
  u.testButton().click(); await settle();
  first.run.click(); first.cancel.click(); await settle();
  assert.equal(u.requests.length, before, 'the old Run test does not run the new confirm'); assert.ok(u.confirm(), 'and the old Cancel does not close it');
  // Replaced by another row's confirm (the page changed): the kept control of ws/trusted runs nothing for ws/untrusted.
  const second = u.confirm().querySelector('[data-verb=run-test]');
  u.key(u.d.activeElement, 'Escape'); await settle(); u.key(u.testButton(), 'Escape'); await settle();
  await u.open('ws/untrusted'); u.testButton().click(); await settle();
  const reads = u.requests.length;
  second.click(); first.run.click(); await settle();
  assert.equal(u.requests.length, reads); assert.ok(u.confirm());
  // Another workspace: the view is rebuilt for it, and the control of the old one sends nothing there.
  const third = u.confirm().querySelector('[data-verb=run-test]');
  setWorkspace('/other'); await settle();
  const after = u.requests.length;
  third.click(); second.click(); first.run.click(); await settle();
  assert.deepEqual(u.requests.slice(after), [], 'no request to the workspace shown now');
  // Disposed.
  setWorkspace('/team'); await settle(); await u.open('ws/trusted'); u.testButton().click(); await settle();
  const last = u.confirm().querySelector('[data-verb=run-test]'), disposedAt = u.requests.length;
  u.page.dispose(); last.click(); third.click(); await settle();
  assert.equal(u.requests.length, disposedAt, 'a disposed view');
  assert.equal(flagged(), 0, 'across all of it, nothing ever carried runSource');
});

test('a test answers for the source it was asked about: one that lands after the row\'s source changed leaves no result', async t => {
  const other = () => { const l = doc('trigger-list'); l.result.triggers.find(r => r.id === 'ws/trusted').on.source = 'acme.graph:other-source'; return l; };
  const pull = () => { const l = doc('trigger-list'); l.result.triggers.find(r => r.id === 'ws/trusted').on = { source: 'github.pull_request', repo: 'github.com/acme/kb', events: ['opened'], labels: [], poll: '2m' }; return l; };
  const refusal = { schemaVersion: 1, ok: false, error: { code: 'E_TRIGGER_INVALID', message: 'ws/trusted: on.poll must be a duration' } };
  for (const outcome of ['success', 'rejection']) {
    // A one-click pull-request test in flight; the row becomes a capability source's; the old answer lands.
    {
      let release, list = pull(); const hold = { test: new Promise(resolve => { release = resolve; }) };
      const u = await mount(t, { hold, list: () => list, tested: () => outcome === 'success' ? doc('trigger-test-pull-request') : refusal }); await u.open('ws/trusted');
      u.testButton().click(); await settle();
      list = doc('trigger-list'); await u.page.refresh(); await settle();
      release(); await settle();
      assert.equal(u.$('.page-card[data-card="Test result"]'), null, `one click, ${outcome}: no result about another source`);
      assert.equal(u.el.textContent.includes('did not answer about the source'), false);
      assert.equal(u.argvs.filter(argv => argv[1] === 'test').length, 1, 'and no second test');
    }
    // A confirmed test in flight; the source changes and changes back (A → B → A); the old answer lands.
    {
      let release, list = doc('trigger-list'); const hold = { test: new Promise(resolve => { release = resolve; }) };
      const u = await mount(t, { hold, list: () => list, tested: () => outcome === 'success' ? doc('trigger-test-trusted') : refusal }); await u.open('ws/trusted');
      u.testButton().click(); await settle(); u.confirm().querySelector('[data-verb=run-test]').click(); await settle();
      list = other(); await u.page.refresh(); await settle();
      list = doc('trigger-list'); await u.page.refresh(); await settle();
      release(); await settle();
      assert.equal(u.$('.page-card[data-card="Test result"]'), null, `confirmed, ${outcome}, A → B → A: the result of the test asked before the change is not kept`);
      assert.equal(u.confirm(), null); assert.equal(u.d.activeElement, u.testButton(), 'focus is not dropped: back at Test');
      assert.deepEqual(u.argvs.filter(argv => argv[1] === 'test'), [['trigger', 'test', 'ws/trusted', '--run-source', '--dir', DEPLOYMENT, '--json']], 'one test, never repeated');
      // The same change with no test in flight keeps working: a new test of the row as it is now has its result.
      u.testButton().click(); await settle(); u.confirm().querySelector('[data-verb=run-test]').click(); await settle();
      assert.ok(u.$('.page-card[data-card="Test result"]'));
    }
  }
  // Leaving the page is not a source change: the result is kept (the spec's edge case), as the test above shows.
});

test('a github.pull_request trigger tests on one click, without the flag', async t => {
  const u = await mount(t); await u.open('local/prs');
  const before = u.requests.length;
  u.testButton().click(); await settle();
  assert.equal(u.confirm(), null);
  assert.deepEqual(u.requests.slice(before), [['/api/automations', { kind: 'trigger', action: 'test', key: 'local/prs' }]]);
  assert.deepEqual(u.argvs.at(-1), ['trigger', 'test', 'local/prs', '--dir', DEPLOYMENT, '--json']);
  assert.ok(u.$('.page-card[data-card="Test result"]'));
});

test('a confirm left open when its row changes under it, or when another page opens, is closed; it is never applied to another row', async t => {
  let list = doc('trigger-list');
  const u = await mount(t, { list: () => list }); await u.open('ws/trusted');
  u.testButton().click(); await settle();
  const run = u.confirm().querySelector('[data-verb=run-test]');
  list = doc('trigger-list'); list.result.triggers.find(r => r.id === 'ws/trusted').on.params = { prefix: 'other/' };
  await u.page.refresh(); await settle();
  assert.equal(u.confirm(), null, 'the row changed: what the confirm said is no longer what would run');
  assert.equal(u.d.activeElement, u.testButton(), 'focus goes to Test, never to <body>');
  run.click(); await settle();
  assert.equal(u.automations().some(b => b.action === 'test'), false, 'the old confirm\'s button runs nothing');
  u.testButton().click(); await settle();
  assert.deepEqual([...u.confirm().querySelectorAll('.source-quote-text')].map(q => q.textContent), ['prefix = other/'], 'a new confirm shows the row as it is now');
  // Another page: the confirm does not follow.
  u.page.view.open('ws/untrusted'); await settle();
  assert.equal(u.confirm(), null); assert.equal(u.$('.page-title').textContent, 'untrusted');
  assert.equal(u.automations().some(b => b.action === 'test' || 'runSource' in b), false);
});

test('a test that answers after the operator left the page keeps its result for that row and does not pull focus back', async t => {
  let release; const hold = { test: new Promise(resolve => { release = resolve; }) };
  const u = await mount(t, { hold }); await u.open('ws/trusted');
  u.testButton().click(); await settle(); u.confirm().querySelector('[data-verb=run-test]').click(); await settle();
  u.$('.page-back').click(); await settle();
  assert.equal(u.$('.auto-page:not([hidden])'), null);
  assert.equal(u.d.activeElement, u.$('.auto-row[data-id="ws/trusted"] .auto-open'), 'Back returns to the row');
  release(); await settle();
  assert.equal(u.$('.auto-page:not([hidden])'), null, 'the list stays');
  assert.equal(u.d.activeElement, u.$('.auto-row[data-id="ws/trusted"] .auto-open'), 'focus is where the operator put it: on the same row\'s control');
  await u.open('ws/trusted');
  assert.match(u.$('.page-card[data-card="Test result"] .auto-test-line').textContent, /^The source answered: 1 event/, 'kept for that row');
  assert.equal(u.confirm(), null);
  assert.equal(u.argvs.filter(argv => argv[1] === 'test').length, 1);
});

test('a test the CLI refuses shows the kernel\'s message and code and returns focus to Test; one that never answers says so and shows no result', async t => {
  const refusal = { schemaVersion: 1, ok: false, error: { code: 'E_TRIGGER_INVALID', message: 'ws/trusted: on.poll must be a duration', details: { id: 'ws/trusted', field: 'on.poll' } } };
  const u = await mount(t, { tested: () => refusal }); await u.open('ws/trusted');
  u.testButton().click(); await settle(); u.confirm().querySelector('[data-verb=run-test]').click(); await settle();
  let card = u.$('.page-card[data-card="Test result"]');
  assert.deepEqual([...card.querySelectorAll('.auto-test-line')].map(p => p.textContent), ['ws/trusted: on.poll must be a duration E_TRIGGER_INVALID']);
  assert.equal(card.querySelector('code.auto-mono').textContent, 'E_TRIGGER_INVALID');
  assert.equal(u.confirm(), null); assert.equal(u.d.activeElement, u.testButton(), 'a recoverable failure: back at Test');
  assert.equal(u.argvs.filter(argv => argv[1] === 'test').length, 1, 'no retry');
  // The refusal's text can repeat a trigger file's own key: it is one display line like every other string
  // (bidi controls replaced), and text the display filter withholds is withheld here too.
  const hostile = { schemaVersion: 1, ok: false, error: { code: 'E_TRIGGER_INVALID', message: 'ws/trusted: on: unknown key "x\u202Eevil\u2066"' } };
  const w = await mount(t, { tested: () => hostile }); await w.open('ws/trusted');
  w.testButton().click(); await settle(); w.confirm().querySelector('[data-verb=run-test]').click(); await settle();
  assert.deepEqual([...w.$('.page-card[data-card="Test result"]').querySelectorAll('.auto-test-line')].map(p => p.textContent), ['ws/trusted: on: unknown key "x\uFFFDevil\uFFFD" E_TRIGGER_INVALID']);
  const secret = { schemaVersion: 1, ok: false, error: { code: 'E_TRIGGER_INVALID', message: 'ws/trusted: on: unknown key "token=abcd1234efgh5678"' } };
  const x = await mount(t, { tested: () => secret }); await x.open('ws/trusted');
  x.testButton().click(); await settle(); x.confirm().querySelector('[data-verb=run-test]').click(); await settle();
  const shown = x.$('.page-card[data-card="Test result"]').textContent;
  assert.equal(shown.includes('abcd1234efgh5678'), false, shown); assert.match(shown, /Detail withheld/);
  const v = await mount(t, { tested: () => ({ killed: true }) }); await v.open('ws/trusted');
  v.testButton().click(); await settle(); v.confirm().querySelector('[data-verb=run-test]').click(); await settle();
  card = v.$('.page-card[data-card="Test result"]');
  assert.deepEqual([...card.querySelectorAll('.auto-test-line')].map(p => p.textContent), ['The test did not answer in time. Nothing was recorded.']);
  assert.equal(card.querySelector('.auto-fire, .source-quote, code'), null, 'no result');
  assert.equal(v.d.activeElement, v.testButton()); assert.equal(v.argvs.filter(argv => argv[1] === 'test').length, 1, 'no retry');
});

test('a confirmed Run test can come back with the source check failed (the script is gone): said as that, once, with no placement line', async t => {
  const u = await mount(t, { tested: () => doc('trigger-test-missing-script') }); await u.open('ws/trusted');
  const before = u.requests.length;
  u.testButton().click(); await settle(); u.confirm().querySelector('[data-verb=run-test]').click(); await settle();
  const card = u.$('.page-card[data-card="Test result"]');
  assert.equal(card.querySelector('.auto-test-line').textContent, 'The source check failed');
  const facts = Object.fromEntries([...card.querySelectorAll('.page-kv')].map(kv => [kv.querySelector('dt').textContent, kv.querySelector('dd').textContent]));
  assert.match(facts.Message, /the source's command review-source \(bin\/source\.mjs\) is not a file inside capability acme\.graph's directory$/); assert.equal(facts.Code, 'E_TRIGGER_SOURCE');
  assert.equal(card.textContent.includes('Tested by hand'), false); assert.equal(card.textContent.includes('Would run here'), false); assert.equal(card.textContent.includes('fire'), false);
  assert.equal(card.textContent.split('is not a file inside').length, 2, 'the kernel says it twice (source and problems): shown once');
  assert.equal(u.d.activeElement, card.querySelector('.page-card-title'), 'an answer: focus on the result');
  assert.deepEqual(u.requests.slice(before), [['/api/automations', { kind: 'trigger', action: 'test', key: 'ws/trusted', runSource: true }]]);
});

test('E_TRIGGER_SOURCE_RUN is not a failure of the trigger: a neutral notice, the row re-read, the operator left at Test', async t => {
  // The list on screen still says github.pull_request; the kernel's definition is a capability source's by now.
  const stale = doc('trigger-list'); stale.result.triggers.find(r => r.id === 'ws/trusted').on = { source: 'github.pull_request', repo: 'github.com/acme/kb', events: ['opened'], labels: [], poll: '2m' };
  let list = stale;
  const u = await mount(t, { list: () => list, tested: () => doc('trigger-test-unconfirmed') }); await u.open('ws/trusted');
  assert.equal(u.$('.page-card[data-card="On"] dd').textContent, 'Pull request opened');
  list = doc('trigger-list');
  const before = u.requests.length;
  u.testButton().click(); await settle();
  assert.deepEqual(u.requests.slice(before).map(([, b]) => [b.action, b.key, b.runSource]), [['test', 'ws/trusted', undefined], ['list', undefined, undefined], ['status', 'ws/trusted', undefined]], 'one unconfirmed test (the kernel ran nothing), then the row and its status re-read');
  const notice = u.$('.auto-page .auto-ran-nothing');
  assert.equal(notice.textContent, "Nothing ran. Testing this trigger runs a capability's source command and needs your confirmation.");
  assert.equal(notice.getAttribute('role'), 'status'); assert.equal(notice.classList.contains('error'), false, 'no warning tone');
  assert.equal(u.$('.page-card[data-card="Test result"]'), null, 'no result card, no "Not ready"');
  assert.equal(u.el.textContent.includes('Not ready'), false);
  assert.equal(u.d.activeElement, u.testButton(), 'left at Test');
  assert.equal(u.$('.page-card[data-card="On"] dd').textContent, 'acme.graph · harvest-branches', 'the row as it is now');
  u.testButton().click(); await settle();
  assert.ok(u.confirm(), 'Test now opens the confirm'); assert.equal(u.$('.auto-ran-nothing'), null);
  assert.equal(u.argvs.some(argv => argv.includes(TRIGGER_RUN_SOURCE_FLAG)), false, 'and still nothing carried the flag');
});

test('a one-press Test answered about a capability source, on a row the list still shows as a pull request: treated as the refusal', async t => {
  // The list on screen says github.pull_request; the kernel's definition is a capability source's whose meaning check
  // fails, so its answer is the normal one (source.ok: false), not E_TRIGGER_SOURCE_RUN. No capability code ran either way.
  const stale = doc('trigger-list'); stale.result.triggers.find(r => r.id === 'ws/trusted').on = { source: 'github.pull_request', repo: 'github.com/acme/kb', events: ['opened'], labels: [], poll: '2m' };
  let list = stale;
  const u = await mount(t, { list: () => list, status: () => doc('trigger-status-invalid'), tested: () => doc('trigger-test-invalid-unconfirmed') }); await u.open('ws/trusted');
  assert.equal(u.$('.page-card[data-card="On"] dd').textContent, 'Pull request opened');
  list = doc('trigger-list-invalid');
  const before = u.requests.length;
  u.testButton().focus(); u.testButton().click(); await settle(); await settle();
  assert.deepEqual(u.requests.slice(before).map(([, b]) => [b.action, b.key, b.runSource]), [['test', 'ws/trusted', undefined], ['list', undefined, undefined], ['status', 'ws/trusted', undefined]],
    'the one test, then the list once, then the status of the row whose source changed; never a second test');
  assert.deepEqual(u.argvs.filter(argv => argv[1] === 'test'), [['trigger', 'test', 'ws/trusted', '--dir', DEPLOYMENT, '--json']]);
  assert.equal(u.$('.page-card[data-card="Test result"]'), null, 'no result card: the answer is not kept');
  assert.equal(u.el.textContent.includes('The source check failed'), false); assert.equal(u.el.textContent.includes('Not ready'), false);
  const notice = u.$('.auto-page .auto-ran-nothing');
  assert.equal(notice.textContent, "Nothing ran. Testing this trigger runs a capability's source command and needs your confirmation.");
  assert.equal(notice.getAttribute('role'), 'status'); assert.equal(notice.classList.contains('error'), false, 'no warning tone');
  assert.equal(u.d.activeElement, u.testButton(), 'left at Test');
  assert.equal(u.$('.page-card[data-card="On"] dd').textContent, 'acme.graph · harvest-branches', 'the row as it is now');
  u.testButton().click(); await settle();
  assert.ok(u.confirm(), 'Test now opens the confirm'); assert.equal(u.$('.auto-ran-nothing'), null);
  assert.equal(u.requests.length, before + 3, 'and opening it sends nothing');
  assert.equal(u.argvs.some(argv => argv.includes(TRIGGER_RUN_SOURCE_FLAG)), false, 'nothing carried the flag');
});

test('a trigger whose source changed: its status is read again and a kept Test result is dropped', async t => {
  let list = doc('trigger-list');
  const u = await mount(t, { list: () => list }); await u.open('ws/trusted');
  u.testButton().click(); await settle(); u.confirm().querySelector('[data-verb=run-test]').click(); await settle();
  assert.ok(u.$('.page-card[data-card="Test result"]'));
  list = doc('trigger-list'); list.result.triggers.find(r => r.id === 'ws/trusted').on.source = 'acme.graph:other-source';
  const before = u.requests.length;
  await u.page.refresh(); await settle();
  assert.equal(u.$('.page-card[data-card="Test result"]'), null, 'the old source\'s result is not this source\'s');
  assert.deepEqual(u.requests.slice(before).map(([, b]) => [b.action, b.key]), [['list', undefined], ['status', 'ws/trusted']], 'the row, then its status again; never a test');
  assert.equal(u.$('.page-card[data-card="On"] dd').textContent, 'acme.graph · harvest-branches', 'named as the kernel\'s status names it');
});

test('Open capability resolves against the catalog and hands the name to the shell', async t => {
  const u = await mount(t); await u.open('ws/trusted');
  assert.deepEqual(u.requests.filter(([route]) => route === '/api/workspace-sync').map(([, b]) => b), [{ action: 'read' }], 'one catalog read for the page');
  u.$('.page-card[data-card="On"] [data-verb=capability]').click();
  assert.deepEqual(u.opened, ['acme.graph']);
});

test('an older kernel: Test is one click, sends no runSource, and the page asks for no catalog', async t => {
  const u = await mount(t, { cli: { ...CLI, features: CLI.features.filter(f => f !== 'trigger-sources') } }); await u.open('ws/trusted');
  assert.equal(u.requests.some(([route]) => route === '/api/workspace-sync'), false);
  const before = u.requests.length;
  u.testButton().click(); await settle();
  assert.equal(u.confirm(), null);
  assert.deepEqual(u.requests.slice(before), [['/api/automations', { kind: 'trigger', action: 'test', key: 'ws/trusted' }]]);
  assert.equal(u.argvs.some(argv => argv.includes(TRIGGER_RUN_SOURCE_FLAG)), false);
});
