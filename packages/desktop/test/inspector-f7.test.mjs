// F7: the Workspace inspector in the spawn modal's language — soul teams
// (read-only, kernel `teams`), readiness as one line, compact cards/lists,
// declarations behind a disclosure; the instance: Teams first, then the
// instance, "Spawned from", the as-spawned modules collapsed. Kernel capture
// fixtures/workspace-v2/f7 (kernel 0.29.3, the real oats.aweb 1.16.0 + a fake aw).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSoulInspector } from '../renderer/soul-inspector.mjs';
import { soulTeams } from '../renderer/teams-panel.mjs';
import { setWorkspace, currentWorkspace } from '../renderer/views/common.mjs';
import { refreshCli, resetCliStateForTests } from '../renderer/views/cli-status.mjs';
import { layerFrom } from '../renderer/inspect-contract.mjs';

const doc = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f7/${name}.json`, import.meta.url), 'utf8'));
const soul = doc('inspect-soul').result, home = doc('inspect-home').result, teamsRun = doc('teams-initial').result;
const agentsRoot = '/fixture/base/northwind-workspace/agents';
const soulSelection = { agent: { name: 'release-manager', agentsRoot }, selector: { soul: 'release-manager', agentsRoot } };
const homeSelection = { instance: { instance: home.subject.instance, agentsRoot, home: home.subject.home }, selector: { home: home.subject.home } };
const tick = () => new Promise(r => setTimeout(r, 0));

async function rendered(t, selection, answer, options = {}) {
  const previous = currentWorkspace(); setWorkspace('/team'); const calls = [];
  const dom = new JSDOM('<body><main><aside hidden></aside></main></body>'), el = dom.window.document.querySelector('aside');
  const inspector = createSoulInspector(el, { ...options, ctx: { api: async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push(body);
    const out = typeof answer === 'function' ? answer(body) : answer; if (out instanceof Error) throw out; return structuredClone(out);
  } } });
  t.after(() => { inspector.dispose(); dom.window.close(); setWorkspace(previous); });
  await inspector.show(selection); await tick(); await tick();
  return { el, calls, sections: () => [...el.querySelectorAll('h3.inspector-section')].map(h => h.textContent) };
}

test('the capture: a soul with two labels, one mapped; the kernel answers teams primary first', () => {
  assert.deepEqual(soulTeams(soul.teams), [{ label: 'engineering', team: 'northwind:eng', mapped: true }, { label: 'global', team: null, mapped: false }]);
  assert.equal(soul.teamsSource, 'live');
  for (const bad of [null, {}, [{ label: 'x', team: null, mapped: true }], [{ label: 'x', team: 'a:b', mapped: false }], [{ label: 'Bad Label', team: null, mapped: false }],
    [{ label: 'x', team: null, mapped: false }, { label: 'x', team: null, mapped: false }], [{ label: 'x', team: null }]]) assert.equal(soulTeams(bad), null, JSON.stringify(bad));
  assert.deepEqual(soulTeams([]), []);
});

test('soul: only what a person needs — Teams, Harness, Core capabilities, Capabilities; no readiness, source, spawn internals or declarations', async t => {
  const u = await rendered(t, soulSelection, soul);
  assert.deepEqual(u.sections(), ['Teams', 'Harness', 'Core capabilities', `Capabilities · ${soul.capabilities.length}`]);
  assert.doesNotMatch(u.el.textContent, /When spawned|Effective providers|Declared in soul\.yaml|AGENTS\.md|Provider operations/);
  assert.equal(u.el.querySelector('.readiness-view'), null);
  const chips = u.el.querySelector('h3.inspector-section + p + .inspector-chips');
  assert.ok(chips, 'one horizontal row of chips follows the one-line explanation');
  assert.equal(chips.previousElementSibling.textContent, "The teams this soul has access to. Its instances start in the workspace's default team only and can join these:");
  assert.deepEqual([...chips.children].map(c => [c.textContent, c.className, c.title]),
    [['engineering · primary', 'inspector-chip', 'engineering (northwind:eng)']], 'global is not mapped: not shown');
  assert.doesNotMatch(u.el.textContent, /global/);
  assert.equal(u.el.querySelector('form, input, select, textarea'), null, 'read-only: joining is per instance');
  const caps = [...u.el.querySelectorAll('.inspector-cap-row')];
  assert.equal(caps.length, soul.capabilities.length);
});

test('soul: no teams reported shows nothing; an empty list says default team only', async t => {
  const none = structuredClone(soul); delete none.teams;
  const a = await rendered(t, soulSelection, none);
  assert.equal(a.sections()[0], 'Harness');
  const empty = structuredClone(soul); empty.teams = [];
  const b = await rendered(t, soulSelection, empty);
  assert.equal(b.sections()[0], 'Teams');
  assert.match(b.el.textContent, /Default team only: this soul has access to no other team\./);
  const unmapped = structuredClone(soul); unmapped.teams = [{ label: 'global', team: null, mapped: false, payload: {} }];
  const c = await rendered(t, soulSelection, unmapped);
  assert.match(c.el.textContent, /Default team only: this soul has access to no other team\./); assert.doesNotMatch(c.el.textContent, /global/);
  assert.equal(b.el.querySelector('.inspector-chips'), null);
});

test('soul: a declared default harness and model are named; the summary is the description only', async t => {
  const v = structuredClone(soul); v.souls[0].harness = 'claude'; v.souls[0].model = 'claude-opus-4';
  const u = await rendered(t, { agent: { ...soulSelection.agent, description: 'Ships the releases.' }, selector: soulSelection.selector }, v);
  const harness = [...u.el.querySelectorAll('h3.inspector-section')].find(h => h.textContent === 'Harness').nextElementSibling;
  assert.deepEqual([...harness.querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]), [['Default harness', 'Claude Code'], ['Default model', 'claude-opus-4']]);
  assert.equal(u.el.querySelector('.inspector-summary .inspector-lede').textContent, 'Ships the releases.');
  assert.equal(u.el.querySelector('.inspector-summary .inspector-facts'), null, 'no Source/Runtime facts');
});

test('instance: Teams first, then the instance card, "Spawned from" with Open soul, the as-spawned modules collapsed', async t => {
  const opened = [];
  const u = await rendered(t, homeSelection, body => body.action === 'inspect' ? home : teamsRun, { openSoul: ref => { opened.push(ref); return true; } });
  assert.deepEqual(u.sections().slice(0, 2), ['Teams', 'Instance']);
  const panel = u.el.querySelector('h3.inspector-section + .teams-panel');
  assert.ok(panel, 'the Teams card follows its heading'); assert.equal(panel.querySelector('h3'), null);
  const spawned = u.el.querySelector('.inspector-spawned');
  assert.equal(spawned.querySelector('span').textContent, `Spawned from release-manager @ ${home.souls[0].commit.slice(0, 7)}`);
  spawned.querySelector('button').click();
  assert.deepEqual(opened, [{ name: 'release-manager', agentsRoot, server: null }]);
  const modules = [...u.el.querySelectorAll('details.inspector-disclosure')].find(d => /^Modules as spawned · \d+$/.test(d.querySelector('summary').textContent));
  assert.ok(modules); assert.equal(modules.open, false);
  assert.ok(modules.querySelector('.inspector-cap-row'), 'the frozen capabilities are inside');
  assert.equal(u.el.querySelector('.soul-declarations'), null, 'an instance does not restate the soul\'s declarations');
});

test('instance: Open soul says so when the roster has no exact match; no host resolver, no button', async t => {
  const u = await rendered(t, homeSelection, body => body.action === 'inspect' ? home : teamsRun, { openSoul: () => false });
  u.el.querySelector('.inspector-spawned button').click();
  assert.equal(u.el.querySelector('.inspector-status').textContent, "release-manager is not in this workspace's souls.");
  const v = await rendered(t, homeSelection, body => body.action === 'inspect' ? home : teamsRun);
  assert.equal(v.el.querySelector('.inspector-spawned button'), null);
  assert.match(v.el.querySelector('.inspector-spawned').textContent, /^Spawned from release-manager/);
});

test('a refused inspection reads as the kernel sentence with the code behind Details (E_TEAM_CONFLICT, captured)', async t => {
  const refused = doc('inspect-soul-conflict').error;
  const u = await rendered(t, soulSelection, Object.assign(new Error(refused.message), { code: refused.code }));
  const status = u.el.querySelector('.inspector-status');
  assert.equal(status.textContent, refused.message); assert.ok(status.classList.contains('error'));
  assert.match(status.textContent, /team labels "engineering" and "global" give it different entries/);
  const details = u.el.querySelector('.inspector-problem-code');
  assert.equal(details.querySelector('summary').textContent, 'Details'); assert.equal(details.querySelector('p').textContent, 'E_TEAM_CONFLICT');
});

// E_TEAM_CONFLICT end to end: the kernel's details.labels, bounded, through the
// server refusal, the HTTP payload and both renderer error paths, to the inspector.
import { capabilityRequest } from '../server/capabilities.mjs';
import { apiJson, httpError } from '../renderer/views/common.mjs';
const spawnErrorPayload = (() => {
  const source = readFileSync(new URL('../server/oats-web.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function spawnErrorPayload(e)'), end = source.indexOf('/* OATSWEB_SPAWNERR_END */', start);
  return new Function(`${source.slice(start, end)}\nreturn spawnErrorPayload;`)();
})();
const conflict = doc('inspect-soul-conflict');
const refusal = async envelope => {
  try {
    await capabilityRequest({ action: 'inspect', selector: { soul: 'release-manager', agentsRoot } }, {
      workspace: { id: 'nw', scope: '/fixture/base/northwind-workspace' }, cli: { ok: true, operationsApi: 2, bin: '/fixture/bin/oats' },
      agents: [{ name: 'release-manager', agentsRoot }], invoke: async () => envelope });
  } catch (error) { return error; }
  assert.fail('expected a refusal');
};

test('E_TEAM_CONFLICT: the server refusal carries the two labels (validated); nothing else does', async () => {
  assert.deepEqual(conflict.error.details.labels, ['engineering', 'global'], 'captured');
  const e = await refusal(conflict);
  assert.equal(e.code, 'E_TEAM_CONFLICT'); assert.equal(e.message, conflict.error.message); assert.deepEqual(e.labels, ['engineering', 'global']);
  for (const labels of [['engineering'], ['engineering', '-x'], 'engineering,global', Array.from({ length: 17 }, (_, i) => `t${i}`)]) {
    const bad = structuredClone(conflict); bad.error.details.labels = labels;
    assert.equal(Object.hasOwn(await refusal(bad), 'labels'), false, JSON.stringify(labels));
  }
  const other = structuredClone(conflict); other.error.code = 'E_SOUL_UNKNOWN';
  assert.equal(Object.hasOwn(await refusal(other), 'labels'), false, 'only the conflict carries labels');
  assert.deepEqual(spawnErrorPayload(e).body, { error: conflict.error.message, code: 'E_TEAM_CONFLICT', labels: ['engineering', 'global'] });
  assert.equal(Object.hasOwn(spawnErrorPayload(Object.assign(new Error('x'), { code: 'E_SOUL_UNKNOWN', labels: ['a', 'b'] })).body, 'labels'), false);
  // both renderer paths keep them
  const body = spawnErrorPayload(e).body;
  const viaFetch = await apiJson({ api: async () => ({ ok: false, status: 409, json: async () => body }) }, '/api/capabilities', {}).catch(x => x);
  assert.deepEqual(viaFetch.labels, ['engineering', 'global']);
  assert.deepEqual(httpError({ status: 409, body }, '/api/capabilities').labels, ['engineering', 'global']);
});

test('E_TEAM_CONFLICT in the inspector: the sentence, the two labels, the code behind Details; unreadable labels are not shown', async t => {
  const make = labels => Object.assign(new Error(conflict.error.message), { code: 'E_TEAM_CONFLICT', labels });
  const u = await rendered(t, soulSelection, make(['engineering', 'global']));
  assert.equal(u.el.querySelector('.inspector-conflict-labels').textContent, 'Team labels in conflict: engineering, global');
  assert.equal(u.el.querySelector('.inspector-problem-code p').textContent, 'E_TEAM_CONFLICT');
  for (const labels of [undefined, ['engineering'], ['engineering', 'engineering'], ['a b', 'c']]) {
    const v = await rendered(t, soulSelection, make(labels));
    assert.equal(v.el.querySelector('.inspector-conflict-labels'), null, JSON.stringify(labels));
  }
});

test('Core capabilities name where each provider came from, only with feature layers-from (kernel #191, captured)', async t => {
  assert.deepEqual(soul.layers.knowledge, { id: 'oats.okf', from: 'workspace' }, 'the capture');
  assert.deepEqual(home.layers.messaging, { id: 'oats.aweb', from: 'workspace' }, 'a home answers what its spawn recorded');
  // The contract's values in words; a home from before layers-from (null) and junk name nothing; a newer kind is shown as sent.
  assert.deepEqual(['soul', 'workspace', 'team:engineering', 'someday', null, 7, ''].map(layerFrom),
    ["the soul's own choice", 'workspace default', 'team engineering default', 'someday', null, null, null]);
  const core = el => {
    const head = [...el.querySelectorAll('h3.inspector-section')].find(h => h.textContent === 'Core capabilities');
    return Object.fromEntries([...head.nextElementSibling.querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]));
  };
  t.after(() => resetCliStateForTests());
  await refreshCli({ api: async () => ({ ...doc('version'), ok: true, bin: '/fixture/bin/oats' }) });
  assert.ok(doc('version').features.includes('layers-from'));
  const withFrom = await rendered(t, soulSelection, soul);
  assert.deepEqual(core(withFrom.el), { Knowledge: 'oats.okf · workspace default', Messaging: 'oats.aweb · workspace default', Tasks: 'None' });
  await refreshCli({ api: async () => ({ ...doc('version'), features: doc('version').features.filter(f => f !== 'layers-from'), ok: true, bin: '/fixture/bin/oats' }) });
  const without = await rendered(t, soulSelection, soul);
  assert.deepEqual(core(without.el), { Knowledge: 'oats.okf', Messaging: 'oats.aweb', Tasks: 'None' }, 'no origin without the feature');
});
