// Readiness on an OATS 0.52.0 kernel (awebai/oats#917): the `harness-trust` item names its configuration
// file, also when it passes, and the `launch-prompt` warning's reason, which quotes what a terminal showed,
// is one display line. The two items are hand-written from the documented shapes at kernel head 881ecc1f
// (lib/instance-inspect.mjs `folderTrustItems` and `launchPromptItems`, lib/harness-trust.mjs's warning),
// added to the captured readiness document; no kernel execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createReadinessView } from '../renderer/readiness-view.mjs';
import { currentWorkspace, setWorkspace } from '../renderer/views/common.mjs';
import { readinessData } from '../../client/readiness-contract.mjs';
import { cli, workspace, instanceTarget, data, view } from './helpers/readiness-fixture.mjs';
import { differed } from './helpers/launch-prompt-fixture.mjs';

const FILE = '/home/op/.claude-work/.claude.json';
const trust = (status = 'pass', fields = {}) => ({ subject: 'launch', status, required: false,
  reason: status === 'pass' ? null : `claude folder trust is not established in ${FILE}: oats harness trust --dir /team`,
  producer: 'harness folder trust', evidence: null, remedy: null, code: 'harness-trust', harness: 'claude', file: FILE, deployment: '/team', ...fields });
const REMEDY = "read the prompt in the instance's terminal and press Enter if it is the development-channel confirmation, or add its captured wording as a tolerance entry (lib/launch-prompt-fixtures/dev-channel-confirmation.json) in a reviewed PR";
/** The kernel JSON-quotes the two snippets inside its sentence. */
const blocked = (d = differed()) => ({ subject: 'launch', status: 'fail', required: false, producer: 'launch prompt', code: 'launch-prompt', evidence: null,
  reason: `the last start of this instance stopped at a prompt OATS does not confirm: blocked: unexpected prompt (nearest tolerance entry ${d.nearest}, first difference at ${d.firstDifference.index}: expected ${JSON.stringify(d.firstDifference.expected)}, found ${JSON.stringify(d.firstDifference.found)})`,
  remedy: REMEDY, differed: d });
/** The captured instance readiness with these items added to `configured` (none is required: the summary stands). */
const withItems = (...items) => { const v = data(instanceTarget); v.checks.configured.items.push(...structuredClone(items)); return v; };
const added = (v, code) => readinessData(v, instanceTarget).checks.configured.items.filter(i => i.code === code);

test('harness-trust: the item\'s top-level file is read, when it fails and when it passes', () => {
  for (const status of ['pass', 'fail']) {
    const [item] = added(withItems(trust(status)), 'harness-trust');
    assert.equal(item.file, FILE); assert.equal(item.status, status);
    // No other top-level key of the item is read.
    assert.equal(Object.hasOwn(item, 'harness'), false); assert.equal(Object.hasOwn(item, 'deployment'), false);
  }
  assert.equal(added(withItems(trust('pass')), 'harness-trust')[0].reason, null);
  assert.match(added(withItems(trust('fail')), 'harness-trust')[0].reason, /folder trust is not established in/);
});
test('harness-trust: anything but an absolute path drops the fact, never the read', () => {
  const plain = added(withItems(trust('fail', { file: undefined })), 'harness-trust')[0];
  assert.equal(Object.hasOwn(plain, 'file'), false);
  const { file: _absent, ...withoutKey } = trust('fail');
  assert.deepEqual(added(withItems(withoutKey), 'harness-trust')[0], plain);
  for (const file of [null, '', '.claude.json', 'relative/.claude.json', 7, {}, ['/a'], `/${'x'.repeat(4096)}`, '/a\nb', '/home/op/password=hunter2/.claude.json', 'https://user@host/x']) {
    const read = readinessData(withItems(trust('fail', { file })), instanceTarget);
    assert.ok(read, JSON.stringify(file));
    assert.deepEqual(added(withItems(trust('fail', { file })), 'harness-trust')[0], plain, JSON.stringify(file));
  }
});
test('harness-trust: a file on an item of another code is not read, and the other items read as before', () => {
  const before = readinessData(data(instanceTarget), instanceTarget);
  const v = withItems(trust('pass'), blocked());
  v.checks.installed.items[0] = { ...v.checks.installed.items[0], file: FILE };
  const after = readinessData(v, instanceTarget);
  assert.equal(Object.hasOwn(after.checks.installed.items[0], 'file'), false);
  assert.deepEqual(after.checks.installed, before.checks.installed);
  assert.deepEqual(after.checks.member, before.checks.member); assert.deepEqual(after.checks.providers, before.checks.providers);
  assert.deepEqual(after.checks.configured.items.slice(0, before.checks.configured.items.length), before.checks.configured.items);
  // Neither item is required: the summary and the counts stand.
  assert.deepEqual(after.summary, before.summary);
});
test('launch-prompt: the reason is one display line; the terminal\'s bidi controls are replaced, its item\'s differed is not read', () => {
  const clean = added(withItems(blocked()), 'launch-prompt')[0];
  assert.equal(clean.reason, blocked().reason);
  assert.equal(Object.hasOwn(clean, 'differed'), false);
  assert.equal(clean.remedy, REMEDY); assert.equal(clean.producer, 'launch prompt');
  // JSON.stringify leaves the bidi controls and the line separator as they are: the filter replaces them.
  const hostile = blocked(differed({ found: 'Trust\u202E this\u2066 folder?\u2028  yes' }));
  assert.match(hostile.reason, /\u202E/);
  const [item] = added(withItems(hostile), 'launch-prompt');
  assert.doesNotMatch(item.reason, /[\u202A-\u202E\u2066-\u2069\u2028]/);
  assert.match(item.reason, /found "Trust\uFFFD this\uFFFD folder\? yes"\)$/);
  // Only this code: another item's reason is as the kernel sent it.
  const other = added(withItems(trust('fail', { reason: 'a\u202Eb  c' })), 'harness-trust')[0];
  assert.equal(other.reason, 'a\u202Eb  c');
});
test('launch-prompt and harness-trust: projecting twice equals projecting once (server, then main and the renderer)', () => {
  for (const v of [withItems(trust('pass'), blocked(differed({ found: 'Trust\u202E\tthis' }))), withItems(trust('fail', { file: 'relative' }), blocked()),
    withItems(trust('fail', { file: '/home/op/password=hunter2/.claude.json' })), withItems(trust('pass', { file: null }))]) {
    const once = readinessData(v, instanceTarget);
    assert.ok(once);
    assert.deepEqual(readinessData(once, instanceTarget), once);
    assert.deepEqual(readinessData(JSON.parse(JSON.stringify(once)), instanceTarget), once);
  }
});

function setup(t, value) {
  const dom = new JSDOM('<!doctype html><body><main></main>', { pretendToBeVisual: true }), host = dom.window.document.querySelector('main');
  const previous = currentWorkspace(); setWorkspace('team');
  const component = createReadinessView(host, { ctx: { api: () => view(instanceTarget, readinessData(value, instanceTarget)) } });
  t.after(() => { component.dispose(); setWorkspace(previous); dom.window.close(); });
  const facts = item => Object.fromEntries([...item.querySelectorAll('dl > dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]));
  return { host, facts, update: () => component.update({ active: true, workspace, selector: instanceTarget.selector, cli }),
    item: code => [...host.querySelectorAll('.readiness-item')].find(i => facts(i).Code === code) };
}
test('view: the folder-trust item shows "Configuration file", also when it passes; other items show none', async t => {
  for (const status of ['pass', 'fail']) {
    const u = setup(t, withItems(trust(status))); await u.update();
    const item = u.item('harness-trust');
    assert.equal(item.querySelector('summary').textContent, `launch · ${status} · optional`);
    assert.equal(u.facts(item)['Configuration file'], FILE);
    assert.equal(u.facts(item).Producer, 'harness folder trust');
    assert.equal([...u.host.querySelectorAll('dt')].filter(dt => dt.textContent === 'Configuration file').length, 1);
  }
  const none = setup(t, withItems(trust('fail', { file: 'relative/.claude.json' }))); await none.update();
  assert.equal(Object.hasOwn(none.facts(none.item('harness-trust')), 'Configuration file'), false);
  assert.match(none.facts(none.item('harness-trust')).Reason, /folder trust is not established/);
});
test('view: the launch-prompt warning shows its filtered reason as text, and the kernel\'s remedy as display only', async t => {
  const u = setup(t, withItems(blocked(differed({ found: '<b>Trust</b>\u202E this folder?' })))); await u.update();
  const item = u.item('launch-prompt'), facts = u.facts(item);
  assert.equal(item.querySelector('summary').textContent, 'launch · fail · optional');
  assert.equal(facts.Producer, 'launch prompt');
  assert.match(facts.Reason, /found "<b>Trust<\/b>\uFFFD this folder\?"\)$/);
  assert.equal(item.querySelector('b'), null);
  assert.equal(facts['Remedy (display only)'], REMEDY);
  assert.equal(item.querySelector('.launch-differed'), null);
  assert.equal(item.querySelectorAll('button').length, 0);
});
