// The `worktree` event (#801, OATS 0.49.0) in the activity view: the `worktree-added` kind and the `spawned`
// row's `worktreeHooks`, both read tolerantly (a malformed receipt drops its fact, never the read).
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createInstanceEventsView } from '../renderer/instance-events-view.mjs';
import { eventsData, hookReceipt, EVENT_TITLES } from '../renderer/instance-events-data.mjs';
import { cli, target, data, event } from './helpers/instance-events-fixture.mjs';
import { MESSY, MESSY_LINE } from './helpers/detail-line.mjs';

const LOG = '/inert/ws/agents/dev/instances/dev-a/.oats/logs/worktree-docs-nw-setup.log';
const hooks = () => [{ capability: 'nw-setup', ok: true, required: true, log: LOG, exitCode: 0 },
  { capability: 'nw-lint', ok: false, required: false, log: null, exitCode: 1, timedOut: true }];
const added = (facts = {}) => event({ kind: 'worktree-added', data: { purpose: 'docs', path: '/inert/ws/agents/dev/instances/dev-a/.work-docs',
  branch: 'agents/dev-a-docs', base: 'main', baseOid: '9f2c41d0', remote: 'https://github.com/nw/docs.git', member: 'github.com/nw/docs',
  hooks: hooks(), ...facts } });
const spawned = (facts = {}) => event({ data: { agent: 'dev', work: 'worktree', branch: 'agents/dev-a', launched: true,
  hooks: { launch: {} }, worktreeHooks: hooks(), ...facts } });
const projected = [{ capability: 'nw-setup', ok: true, log: LOG }, { capability: 'nw-lint', ok: false, log: null }];
/** The server's read (publicView false), then the renderer's re-read of what it sent (publicView true). */
const both = rows => { const out = eventsData(data(rows), target); return [out, out && eventsData(out, target, 100, { publicView: true })]; };

test('worktree-added is titled, its facts and receipt projected, and the re-read agrees', () => {
  assert.equal(EVENT_TITLES['worktree-added'], 'Worktree added');
  const [out, again] = both([added()]);
  assert.ok(out);
  assert.deepEqual(out.events[0].data, { purpose: 'docs', path: '/inert/ws/agents/dev/instances/dev-a/.work-docs',
    branch: 'agents/dev-a-docs', base: 'main', member: 'github.com/nw/docs', hooks: projected });
  assert.deepEqual(again, out);
  assert.doesNotMatch(JSON.stringify(out), /github\.com\/nw\/docs\.git|exitCode|baseOid/, 'remote, exit codes and oids are not projected');
});

test('spawned gains worktreeHooks; its spawn-hook receipt `hooks` stays unread', () => {
  const [out, again] = both([spawned()]);
  assert.ok(out);
  assert.deepEqual(out.events[0].data.worktreeHooks, projected);
  assert.equal(Object.hasOwn(out.events[0].data, 'hooks'), false);
  assert.deepEqual(again, out);
  // An older kernel's spawned row: no fact, the row as before.
  assert.equal(Object.hasOwn(eventsData(data([event()]), target).events[0].data, 'worktreeHooks'), false);
});

for (const [label, value] of [['a string', 'nw-setup'], ['an object', { capability: 'x', ok: true }], ['null', null], ['empty', []],
  ['an entry without ok', [{ capability: 'x', log: LOG }]], ['an entry whose ok is a string', [{ capability: 'x', ok: 'true', log: LOG }]],
  ['an entry without capability', [{ ok: true, log: LOG }]], ['an empty capability', [{ capability: '', ok: true, log: LOG }]],
  ['a log that is a number', [{ capability: 'x', ok: true, log: 7 }]], ['an over-long capability', [{ capability: 'x'.repeat(4097), ok: true, log: null }]],
  ['one malformed entry among good ones', [...hooks(), 'nw-extra']], ['too many entries', Array.from({ length: 257 }, () => ({ capability: 'x', ok: true, log: null }))],
]) test(`a malformed receipt (${label}) drops the Setup fact and never the read`, () => {
  for (const row of [added({ hooks: value }), spawned({ worktreeHooks: value })]) {
    const [out, again] = both([row]);
    assert.ok(out, 'the read is kept');
    assert.equal(Object.hasOwn(out.events[0].data, 'hooks') || Object.hasOwn(out.events[0].data, 'worktreeHooks'), false);
    assert.deepEqual(again, out);
  }
  assert.equal(hookReceipt(value), undefined);
});

test('a hook whose log was removed (log: null or absent) is a valid entry with no path', () => {
  assert.deepEqual(hookReceipt([{ capability: 'nw-setup', ok: true, required: true, log: null, exitCode: 0 }]), [{ capability: 'nw-setup', ok: true, log: null }]);
  assert.deepEqual(hookReceipt([{ capability: 'nw-setup', ok: true }]), [{ capability: 'nw-setup', ok: true, log: null }]);
});

test('malformed worktree-added facts drop alone; unsafe text is withheld', () => {
  const [out, again] = both([added({ purpose: 7, path: null, branch: { name: 'x' }, base: '', member: null, hooks: undefined })]);
  assert.ok(out);
  assert.deepEqual(out.events[0].data, {});
  assert.deepEqual(again, out);
  const [secret] = both([added({ branch: 'token: PRIVATE', hooks: [{ capability: 'ghp_ABCDEFGHIJKLMNOPQRSTUV', ok: true, log: null }] })]);
  assert.equal(secret.events[0].data.branch, '[Detail withheld]');
  assert.equal(secret.events[0].data.hooks[0].capability, '[Detail withheld]');
  assert.doesNotMatch(JSON.stringify(secret), /PRIVATE|ghp_/);
});

function mount(t, rows) {
  const dom = new JSDOM('<body><main class="oats-view"><div class="pop"><p class="summary"></p></div></main></body>');
  const doc = dom.window.document, host = doc.querySelector('.pop');
  const reply = { instanceEventsViewApi: 1, status: 'available', target: structuredClone(target), data: eventsData(data(rows), target), reason: null };
  const controller = createInstanceEventsView(host, { summary: doc.querySelector('.summary'), ctx: { api: async () => structuredClone(reply) },
    selection: () => structuredClone(target), cli: () => structuredClone(cli), owner: () => true, generation: () => 0,
    subscribeCli: () => () => {}, connectionGeneration: () => 0, subscribeConnections: () => () => {} });
  t.after(() => { controller.dispose(); dom.window.close(); });
  return { doc, host, controller };
}
/** The facts of the one row: [[term, dd]]. */
const factsOf = host => { const dl = host.querySelector('.events-rows .events-facts'); return [...dl.querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling]); };

test('the worktree-added row: title, facts, one Setup line per hook, the log as a path', async t => {
  const u = mount(t, [added()]);
  await u.controller.read();
  assert.equal(u.host.querySelector('.events-rows strong').textContent, 'Worktree added');
  const facts = factsOf(u.host);
  assert.deepEqual(facts.map(([term, dd]) => [term, term === 'Setup' ? null : dd.textContent]), [['Purpose', 'docs'],
    ['Path', '/inert/ws/agents/dev/instances/dev-a/.work-docs'], ['Branch', 'agents/dev-a-docs'], ['Base', 'main'], ['Member', 'github.com/nw/docs'], ['Setup', null]]);
  const setup = facts.at(-1)[1];
  assert.deepEqual([...setup.children].map(el => [el.className, el.textContent]), [['events-setup', 'nw-setup: done'], ['events-path', LOG],
    ['events-setup', 'nw-lint: failed (continuing)']], 'a removed log shows no path');
  assert.doesNotMatch(setup.textContent, /null/);
});

test('the spawned row shows the same Setup fact', async t => {
  const u = mount(t, [spawned({ worktreeHooks: [{ capability: 'nw-setup', ok: true, required: true, log: null, exitCode: 0 }] })]);
  await u.controller.read();
  const setup = factsOf(u.host).find(([term]) => term === 'Setup')[1];
  assert.deepEqual([...setup.children].map(el => el.textContent), ['nw-setup: done']);
  assert.doesNotMatch(setup.textContent, /null/);
});

test('kernel text in the new facts is shown through displayLine, as text', async t => {
  const u = mount(t, [added({ branch: MESSY, hooks: [{ capability: `<b>cap</b>\n${MESSY}`, ok: false, log: `/inert/log\n${MESSY}` }] })]);
  await u.controller.read();
  const facts = factsOf(u.host);
  assert.equal(facts.find(([term]) => term === 'Branch')[1].textContent, MESSY_LINE);
  const setup = facts.find(([term]) => term === 'Setup')[1];
  assert.deepEqual([...setup.children].map(el => el.textContent), [`<b>cap</b> ${MESSY_LINE}: failed (continuing)`, `/inert/log ${MESSY_LINE}`]);
  assert.equal(setup.querySelector('b'), null, 'set as text, never parsed');
});

test('a row with a malformed receipt still renders, without Setup', async t => {
  const u = mount(t, [added({ hooks: [{ capability: 'nw-setup', ok: 'yes' }] })]);
  await u.controller.read();
  assert.equal(u.host.querySelector('.events-rows strong').textContent, 'Worktree added');
  assert.equal(factsOf(u.host).some(([term]) => term === 'Setup'), false);
  assert.match(u.host.textContent, /Purposedocs/);
});
test('#802 review: a receipt within the preview\'s module bound (65 entries) keeps its Setup fact', () => {
  const many = Array.from({ length: 65 }, (_, i) => ({ capability: `nw-${i}`, ok: true, log: null }));
  const [out] = both([added({ hooks: many })]);
  assert.equal(out.events[0].data.hooks.length, 65);
});
