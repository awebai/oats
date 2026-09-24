// F3b-2: inspect on the workspace model (operationsApi 2, soul rows soulsApi 2)
// from the kernel capture (fixtures/workspace-v2/f3b2, kernel #162).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discover } from '../cli-locator.mjs';
import { inspectData, inspectSupported, inspectFacts, originText } from '../renderer/inspect-contract.mjs';
import { JSDOM } from 'jsdom';
import { createSoulInspector } from '../renderer/soul-inspector.mjs';
import { setWorkspace, currentWorkspace } from '../renderer/views/common.mjs';

const doc = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f3b2/${name}.json`, import.meta.url), 'utf8'));
const soul = doc('inspect-soul').result, home = doc('inspect-home').result, probe = doc('version');
const soulSelection = { agent: { name: 'release-manager', agentsRoot: '/fixture/base/northwind-workspace/agents' } };
const homeSelection = { instance: { instance: 'release-manager-cap' }, selector: { home: home.subject.home } };

test('the probe gate is the exact integer 2: the locator forwards only operationsApi 2 (0.25 kernels report 1)', async () => {
  assert.equal(probe.operationsApi, 2, 'the captured kernel advertises operationsApi 2');
  for (const operationsApi of [undefined, 1, '2', 3, true, 2]) {
    const found = await discover({ persisted: () => '/fixture/bin/oats', env: {}, isExecutableFile: () => true },
      async () => ({ stdout: JSON.stringify({ ...probe, operationsApi }) }));
    assert.equal(found.ok, true); assert.equal(found.operationsApi, operationsApi === 2 ? 2 : undefined, String(operationsApi));
    assert.equal(inspectSupported(found), operationsApi === 2);
  }
});

test('an inspection binds to exactly its subject: a soul for --soul, an instance for --home', () => {
  assert.equal(inspectData(soul, soulSelection), soul);
  assert.equal(inspectData(home, homeSelection), home);
  assert.equal(inspectData(soul, { agent: { name: 'other-soul' } }), null, 'another soul');
  assert.equal(inspectData(home, { instance: {}, selector: { home: '/other/home' } }), null, 'another home');
  assert.equal(inspectData(soul, homeSelection), null); assert.equal(inspectData(home, soulSelection), null);
  assert.equal(inspectData(soul, null), null, 'no scope subject');
  for (const mutate of [v => v.operationsApi = 1, v => v.souls[0].soulsApi = 1, v => delete v.problems, v => v.capabilities = {}, v => v.souls.push(v.souls[0])]) {
    const v = structuredClone(soul); mutate(v); assert.equal(inspectData(v, soulSelection), null);
  }
});

test('a scope subject is refused by the kernel itself (inspect needs --soul or --home)', () => {
  const refused = doc('inspect-scope');
  assert.equal(refused.ok, false); assert.equal(refused.error.code, 'E_BAD_ARGS'); assert.match(refused.error.message, /--soul <name> or --home <abs>/);
});

test("facts are the kernel's records: a module's origin is its from (member commit, or package version + commit)", () => {
  const byId = Object.fromEntries(soul.capabilities.map(cap => [cap.id, cap]));
  const okf = byId['oats.okf'], house = byId['nw-house-style'];
  assert.equal(originText(okf.from), `package oats.okf ${okf.from.version} @ ${okf.from.commit.slice(0, 7)}`);
  assert.equal(originText(house.from), `member agents @ ${house.from.commit.slice(0, 7)}`);
  assert.deepEqual(Object.fromEntries(inspectFacts.capability(okf)), { Version: okf.version, Layer: 'knowledge', Origin: originText(okf.from), 'Missing requirements': 'None' });
  assert.deepEqual(Object.fromEntries(inspectFacts.layers(soul.layers)), { Knowledge: 'oats.okf', Messaging: 'None', Tasks: 'None' });
  const facts = Object.fromEntries(inspectFacts.soul(soul.souls[0]));
  assert.equal(facts.Source, `member agents @ ${soul.souls[0].commit.slice(0, 7)}`); assert.equal(facts.Runtime, 'Chosen at spawn');
  assert.equal(Object.fromEntries(inspectFacts.instance(home.instance)).Resolution, home.instance.resolution.slice(0, 12));
  // Removed classic fields are not read (and not present).
  for (const key of ['scope', 'selected', 'currentConfig', 'snapshot', 'sources']) assert.equal(Object.hasOwn(soul, key), false, key);
  assert.ok(soul.capabilities.every(cap => !Object.hasOwn(cap, 'activation') && !Object.hasOwn(cap, 'health')));
});

// The real inspector renders the captured documents; problems read plainly with their code behind Details.
async function rendered(t, selection, value) {
  const previous = currentWorkspace(); setWorkspace('/team');
  const dom = new JSDOM('<body><main><aside hidden></aside></main></body>'), el = dom.window.document.querySelector('aside');
  const inspector = createSoulInspector(el, { ctx: { api: async () => value } });
  t.after(() => { inspector.dispose(); dom.window.close(); setWorkspace(previous); });
  await inspector.show(selection); return el;
}
test('the inspector renders a soul and a home from the capture, read-only, with kernel problems verbatim', async t => {
  const v = structuredClone(soul); v.problems = [{ code: 'E_EXAMPLE_PROBLEM', message: 'The kernel could not read one declaration.' }];
  const s = await rendered(t, { ...soulSelection, selector: { soul: 'release-manager', agentsRoot: soulSelection.agent.agentsRoot } }, v);
  const text = s.textContent;
  assert.match(text, /What a spawn of this soul resolves now/); assert.match(text, /member agents @ [0-9a-f]{7}/); assert.match(text, /Chosen at spawn/);
  assert.match(text, /Capabilities · 5/); assert.match(text, /package oats\.okf 2\.1\.3 @ [0-9a-f]{7}/);
  const problem = s.querySelector('.inspector-problem');
  assert.equal(problem.querySelector('p').textContent, 'The kernel could not read one declaration.');
  assert.equal(problem.querySelector('details summary').textContent, 'Details'); assert.equal(problem.querySelector('details p').textContent, 'E_EXAMPLE_PROBLEM');
  assert.equal(s.querySelector('form, textarea, input, select'), null, 'read-only');
  const h = await rendered(t, homeSelection, structuredClone(home));
  assert.match(h.textContent, /As spawned/); assert.match(h.textContent, /Composed from: kernel:instance-boundary/);
  assert.match(h.textContent, new RegExp(home.instance.resolution.slice(0, 12)));
});
