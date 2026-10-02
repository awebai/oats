// Team model 3 (feature team-model-3, OATS 0.38): the Workspace › Teams page on the REAL 0.38 kernel's
// `oats teams --json` (teamsApi 2; test/fixtures/team-model-3, provenance.json), decoded by teamsData as the
// route answers it. Northwind: shared global (the workspace's default) and engineering with ids, marketing
// unmapped; souls: "*" (no teams), agents/* (engineering), agents/release-manager (default engineering,
// teams marketing), agents/no-such-soul (a typo: team-soul-unknown). Its states:
//   - local teams allowed (localTeams: true, or null in the standalone view): Add, Make default, Remove;
//   - local teams closed (the default): no Add, no Make default (the kernel refuses both before writing);
//   - closed but present in oats-local.yaml: the kernel's local-teams-closed failure leads the page, in its
//     own words, and each local team keeps Remove (the kernel accepts it there: the migration's last step,
//     proven against the real CLI in test/desktop-team-model-3-kernel.test.mjs at the repository root).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createComputerTeams, computerTeamsCSS, LOCAL_TEAMS_CLOSED } from '../renderer/computer-teams.mjs';
import { setupCSS } from '../renderer/workspace-setup.mjs';
import { teamsData } from '../deployment-data.mjs';

const BASE = '/fixture/base', DEP = `${BASE}/northwind-workspace`;
const capture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/team-model-3/${name}.json`, import.meta.url), 'utf8').split('<base>').join(BASE));
const teams = (name) => teamsData(capture(name), DEP);
/** DERIVED: the standalone view (no workspace file read): localTeams null, nothing shared, a local team. */
const standalone = () => { const d = teams('teams-after'); d.localTeams = null; d.teams = d.teams.filter((t) => t.from === 'local'); d.souls = {}; d.problems = []; return d; };
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve)); };

async function mount(t, answer) {
  const dom = new JSDOM('<!doctype html><body><main class="oats-view"></main></body>', { pretendToBeVisual: true }), doc = dom.window.document;
  const style = doc.createElement('style'); style.textContent = setupCSS + computerTeamsCSS; doc.head.append(style);
  const calls = [];
  const card = createComputerTeams(doc, { request: async (body) => { calls.push(body); return answer(body, calls.length); } });
  doc.querySelector('main').append(card.element);
  t.after(() => { card.dispose(); dom.window.close(); });
  await tick();
  const q = (s) => card.element.querySelector(s), row = (label) => q(`[data-team="${label}"]`);
  const acts = (label) => [...row(label).querySelectorAll('.ct-actions > .ct-act')].map((b) => b.textContent);
  const addShown = () => { const b = q('.ct-page-head button.ct-add'); return !!b && !b.hidden; };
  return { doc, card, calls, q, row, acts, addShown };
}

test('closed (the default): no Add anywhere, no Make default; the workspace default says where it comes from', async (t) => {
  const u = await mount(t, () => teams('teams-closed'));
  assert.equal(u.addShown(), false, 'no Add in the head');
  for (const label of ['global', 'engineering', 'marketing']) assert.deepEqual(u.acts(label), [], `${label}: no actions`);
  assert.equal(u.row('global').querySelector('.ct-pill').textContent, "Default · the workspace's");
  const local = u.q('[data-section=local]');
  assert.match(local.textContent, /oats-workspace\.yaml does not allow local teams \(localTeams: true\)/);
  assert.equal(local.querySelector('button'), null, 'no Add a local team link');
});

test('closed: the kernel\'s problems lead the page in its own words; team-soul-unknown names its key', async (t) => {
  const u = await mount(t, () => teams('teams-closed'));
  const top = [...u.card.element.querySelectorAll('.ct-body > .ct-problem [data-problem]')].map((p) => p.dataset.problem);
  assert.deepEqual(top, ['team-soul-unknown']);
  const unknown = u.q('.ct-problem [data-problem=team-soul-unknown]');
  assert.match(unknown.textContent, /souls: agents\/no-such-soul names no soul of this workspace/);
  assert.match(unknown.querySelector('.ct-fix').textContent, /correct the key to a soul's qualified name/);
  assert.ok(u.row('marketing').querySelector('[data-problem=team-unmapped]'), 'a team\'s own problem stays on its card');
});

test('closed but present: the local-teams-closed failure first, verbatim with its fix; each local team keeps Remove only', async (t) => {
  const u = await mount(t, () => teams('teams-closed-local'));
  const first = u.q('.ct-body > .ct-problem');
  const closed = first.querySelector('[data-problem=E_WORKSPACE_SCHEMA]');
  assert.ok(closed, 'the failure is the page\'s first block');
  assert.equal(closed.getAttribute('role'), 'alert');
  assert.match(closed.textContent, /oats-local\.yaml declares teams, but oats-workspace\.yaml does not allow local teams/);
  assert.equal(closed.querySelector('.ct-fix').textContent, capture('teams-closed-local').result.problems.find((p) => p.condition === 'local-teams-closed').fix, 'the kernel\'s fix, not a second version');
  for (const label of ['mine', 'spare']) assert.deepEqual(u.acts(label), ['Remove'], `${label}: Remove only`);
  assert.equal(u.addShown(), false);
});

test('closed but present: Remove runs the kernel\'s remove', async (t) => {
  const u = await mount(t, (body, n) => (n === 1 ? teams('teams-closed-local') : teams('teams-remove-closed')));
  [...u.row('spare').querySelectorAll('.ct-act')].find((b) => b.textContent === 'Remove').click(); await tick();
  assert.deepEqual(u.calls.at(-1), { action: 'remove', label: 'spare' });
  assert.equal(u.row('spare'), null, 'gone after the answer');
});

test('allowed (localTeams: true): Add, Make default and Remove; this deployment\'s own default says so', async (t) => {
  const u = await mount(t, () => teams('teams-after'));
  assert.equal(u.addShown(), true);
  assert.equal(u.row('mine').querySelector('.ct-pill').textContent, 'Default · this deployment');
  assert.deepEqual(u.acts('global'), ['Make default']);
  assert.ok(u.acts('mine').includes('Remove'));
  assert.match(u.row('mine').querySelector('.ct-why').textContent, /it is the default team/, 'the local default is in use');
});

test('standalone (no workspace file read): local teams are the deployment\'s own; no souls: section', async (t) => {
  const u = await mount(t, standalone);
  assert.equal(u.addShown(), true);
  assert.equal(u.q('[data-section=souls]'), null);
});

test('souls: as committed, read only, with where to change it in the kernel\'s words', async (t) => {
  const u = await mount(t, () => teams('teams-closed'));
  const souls = u.q('[data-section=souls]');
  const rows = [...souls.querySelectorAll('.ct-soul-rule')].map((r) => [r.querySelector('.ct-soul-key').textContent, r.querySelector('.ct-soul-teams').textContent]);
  assert.deepEqual(rows, [['*', 'no other team'], ['agents/*', 'engineering'], ['agents/release-manager', 'default engineering · marketing'], ['agents/no-such-soul', 'global']]);
  assert.match(souls.textContent, /souls: in oats-workspace\.yaml \(a PR to the workspace file\)/);
  assert.equal(souls.querySelector('button'), null, 'nothing to edit here');
  assert.equal(u.row('engineering').querySelector('.ct-join').textContent, '2 souls: entries', 'who may join, from the patterns');
});

test('the closed-state wording is the kernel\'s own clause', () => {
  const kernel = readFileSync(new URL('../../../lib/teams.mjs', import.meta.url), 'utf8');
  assert.ok(kernel.includes(LOCAL_TEAMS_CLOSED), 'lib/teams.mjs says exactly this');
});
