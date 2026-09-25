// F7: the Workspace inspector in the spawn modal's language — soul teams
// (read-only, kernel `teams`), readiness as one line, compact cards/lists,
// declarations behind a disclosure; the instance: Teams first, then the
// instance, "Spawned from", the as-spawned modules collapsed. Kernel capture
// fixtures/workspace-v2/f7 (kernel #179 86faf9f6, stand-in nw.teams).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSoulInspector } from '../renderer/soul-inspector.mjs';
import { soulTeams } from '../renderer/teams-panel.mjs';
import { setWorkspace, currentWorkspace } from '../renderer/views/common.mjs';

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

test('soul: Teams (read-only), then what a spawn resolves, capabilities as a compact list, declarations behind a disclosure', async t => {
  const u = await rendered(t, soulSelection, soul);
  assert.deepEqual(u.sections().slice(0, 4), ['Teams', 'When spawned', 'Effective providers', `Capabilities · ${soul.capabilities.length}`]);
  const list = u.el.querySelector('h3.inspector-section + p + .inspector-list');
  assert.ok(list, 'the teams list follows its one-line explanation');
  assert.equal(list.previousElementSibling.textContent, "Its instances start in their person's personal team only. They can join these teams:");
  assert.deepEqual([...list.children].map(row => [row.querySelector('.inspector-item-name').textContent, row.querySelector('.inspector-item-meta').textContent, row.querySelector('.inspector-badge').textContent]),
    [['engineering · primary', 'northwind:eng', 'Joinable'], ['global', 'Not mapped by this workspace', 'Unavailable']]);
  assert.match(list.querySelectorAll('.inspector-badge')[1].title, /does not map this team/);
  assert.equal(u.el.querySelector('form, input, select, textarea'), null, 'read-only: joining is per instance');
  assert.ok(![...u.el.querySelectorAll('.inspector-card dt')].some(dt => dt.textContent === 'Team'), 'the single team fact gave way to the Teams section');
  const caps = [...u.el.querySelectorAll('.inspector-cap-row')];
  assert.equal(caps.length, soul.capabilities.length);
  for (const row of caps) { const details = row.querySelector('details'); assert.equal(details.open, false); assert.equal(details.querySelector('summary').textContent, 'Details'); }
  const declared = [...u.el.querySelectorAll('details.inspector-disclosure')].find(d => d.querySelector('summary').textContent === 'Declared in soul.yaml');
  assert.ok(declared); assert.equal(declared.open, false); assert.equal(declared.querySelector('h3'), null, 'no second heading inside the disclosure');
  assert.ok(declared.querySelector('pre'), 'the raw declaration is behind it');
});

test('soul: no teams reported shows nothing; an empty list says personal team only', async t => {
  const none = structuredClone(soul); delete none.teams;
  const a = await rendered(t, soulSelection, none);
  assert.equal(a.sections()[0], 'When spawned');
  const empty = structuredClone(soul); empty.teams = [];
  const b = await rendered(t, soulSelection, empty);
  assert.equal(b.sections()[0], 'Teams');
  assert.match(b.el.textContent, /Personal team only: the soul names no wider team\./);
  assert.equal(b.el.querySelector('.inspector-list .inspector-badge'), null);
});

test('soul: readiness is one line under the summary, its checks behind a disclosure; the summary shows only reported facts', async t => {
  const u = await rendered(t, soulSelection, soul);
  const readiness = u.el.querySelector('.inspector-readiness .readiness-view');
  assert.ok(readiness);
  const more = readiness.querySelector('details.readiness-more');
  assert.equal(more.open, false); assert.equal(more.querySelector('summary').textContent, 'Checks and policy');
  assert.equal(readiness.querySelector(':scope > .readiness-status').parentElement, readiness, 'the status line is outside the disclosure');
  assert.ok(more.querySelector('.readiness-context'));
  const position = u.el.querySelector('.inspector-readiness').compareDocumentPosition(u.el.querySelector('h3.inspector-section'));
  assert.ok(position & 4, 'readiness comes before the inspection');
  assert.doesNotMatch(u.el.textContent, /Reported runtime|Description—|Source—/);
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
