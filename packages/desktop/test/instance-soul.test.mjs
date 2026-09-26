import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createInstanceSoulSection } from '../renderer/instance-soul.mjs';

// Workspace v4 (W6): the context panel's Soul tab — the soul as this instance was
// spawned from it, from one `oats inspect --home` read per selection.
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const fx = () => JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/teams/inspect-home.json', import.meta.url), 'utf8'));
const HOME = fx().result.subject.home;
const instance = (home = HOME) => ({ instance: home.split('/').pop(), home, agentsRoot: '/r/agents' });
function section(t, request, cli = () => ({ ok: true, operationsApi: 2, features: [] })) {
  const dom = new JSDOM('<body><section></section></body>'), host = dom.window.document.querySelector('section'), calls = [], presence = [];
  const s = createInstanceSoulSection(host, { cli, onPresence: p => presence.push(p),
    request: async (workspace, body) => { calls.push({ workspace, ...body }); return request(workspace, body); } });
  t.after(() => { s.dispose(); dom.window.close(); });
  return { host, s, calls, presence };
}

test('one read per selection renders the soul head, the three core slots and the other capabilities with why each is here', async t => {
  const u = section(t, () => fx().result);
  u.s.update({ active: true, workspace: 'A', instance: instance() }); await tick(); await tick();
  assert.deepEqual(u.calls.map(c => [c.workspace, c.action, c.selector]), [['A', 'inspect', { home: HOME }]]);
  assert.equal(u.presence.at(-1), true);
  assert.equal(u.host.querySelector('.soul-tab-name').textContent, 'release-manager');
  const core = [...u.host.querySelectorAll('.soul-tab-core-row')];
  assert.deepEqual(core.map(r => r.dataset.layer), ['knowledge', 'messaging', 'tasks']);
  assert.match(core[0].textContent, /oats\.okf/); assert.match(core[1].textContent, /nw\.teams/);
  assert.match(core[2].textContent, /None/, 'an empty slot says so');
  const caps = Object.fromEntries([...u.host.querySelectorAll('.soul-tab-cap')].map(r => [r.dataset.capability, r.querySelector('.soul-tab-tag')?.textContent]));
  assert.equal(caps['nw-release-tooling'], 'soul', 'declared by the soul');
  assert.equal(caps['nw-deploy'], 'soul');
  assert.equal(caps['nw-house-style'], 'default', 'not declared: a default the kernel resolved');
  assert.equal(caps['oats.okf'], undefined, 'core providers are not listed twice');
  for (let i = 0; i < 3; i++) u.s.update({ active: true, workspace: 'A', instance: instance() });
  await tick(); assert.equal(u.calls.length, 1, 'renders are frequent: one inspection per selection');
});

test('an inactive tab, a remote instance or a failed read: no read or no section', async t => {
  const a = section(t, () => fx().result);
  a.s.update({ active: false, workspace: 'A', instance: instance() }); await tick();
  a.s.update({ active: true, workspace: 'A', instance: { ...instance(), server: 'remote' } }); await tick();
  assert.equal(a.calls.length, 0);
  const b = section(t, () => { throw new Error('boom'); });
  b.s.update({ active: true, workspace: 'A', instance: instance() }); await tick(); await tick();
  assert.equal(b.host.querySelector('.soul-tab'), null); assert.notEqual(b.presence.at(-1), true);
});

test('a new selection drops the previous soul before its read lands', async t => {
  let release; const gate = new Promise(r => { release = r; });
  const u = section(t, async (_ws, body) => body.selector.home === HOME ? fx().result : (await gate, fx().result));
  u.s.update({ active: true, workspace: 'A', instance: instance() }); await tick(); await tick();
  assert.ok(u.host.querySelector('.soul-tab'));
  u.s.update({ active: true, workspace: 'A', instance: instance(`${HOME}-2`) });
  assert.equal(u.host.querySelector('.soul-tab'), null, 'no stale soul while the next read is in flight');
  release(); await tick(); await tick();
});
