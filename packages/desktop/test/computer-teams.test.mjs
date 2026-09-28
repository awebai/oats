// Team model v2 (0.30, D2 screen 1): the Workspace Teams tab's "Teams on this computer", on the REAL
// 0.30 kernel: K1 (feat/030-team-model @bba0a9b8) captured by the engineer in
// test/fixtures/team-model-v2 (#269; provenance.json), decoded by teamsData exactly as the
// /api/workspace-teams route does ({status: 'ok', teams}). A scenario the capture run did not reach
// is DERIVED from a capture, and says so. Northwind: shared engineering/global/marketing (no ids
// yet), a local team `mine` (the default); release-manager takes mine + engineering, every soul global.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createComputerTeams, computerTeamsCSS, teamInUse, teamsAnswer } from '../renderer/computer-teams.mjs';
import { renderSetup, setupCSS, teamsBox } from '../renderer/workspace-setup.mjs';
import { teamsData } from '../deployment-data.mjs';

const capture = name => JSON.parse(readFileSync(new URL(`./fixtures/team-model-v2/${name}.json`, import.meta.url), 'utf8'));
const DEPLOYMENT = '/fixture/base/northwind-workspace';
/** A captured `oats teams` document, decoded as the route answers it. */
const teams = name => teamsData(capture(name), DEPLOYMENT);
/** A captured kernel refusal, as the route passes it on (code + the kernel's words). */
const refused = name => { const e = capture(name).error; return Object.assign(new Error(e.message), { code: e.code }); };
const refusal = (code, message) => Object.assign(new Error(message), { code });
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
/** DERIVED: the capture with engineering given an id (the run left every shared team unmapped). */
const mapped = (name = 'teams-after') => { const d = teams(name); d.teams.find(t => t.label === 'engineering').team = 'engineering:northwind.aweb.ai';
  d.problems = d.problems.filter(p => p.label !== 'engineering'); return d; };

async function mount(t, answer = () => teams('teams-after')) {
  const dom = new JSDOM('<!doctype html><body><main class="oats-view"></main></body>', { pretendToBeVisual: true }), doc = dom.window.document;
  const style = doc.createElement('style'); style.textContent = setupCSS + computerTeamsCSS; doc.head.append(style);
  const calls = [];
  const card = createComputerTeams(doc, { request: async body => { calls.push(body); return answer(body, calls.length); } });
  doc.querySelector('main').append(card.element);
  t.after(() => { card.dispose(); dom.window.close(); });
  await tick();
  const q = s => card.element.querySelector(s), row = label => q(`[data-team="${label}"]`);
  const click = async el => { el.click(); await tick(); };
  const act = (label, name) => [...row(label).querySelectorAll('.ct-actions > .ct-act')].find(b => b.textContent === name) ?? null;
  return { dom, doc, card, calls, q, row, click, act };
}

test('real capture: the shared and local teams with their ids, the default, the kernel\'s problems on their rows; one read', async t => {
  const u = await mount(t);
  assert.deepEqual(u.calls, [{ action: 'list' }]);
  assert.equal(u.q('.setup-box-head h3').textContent, 'Teams on this computer');
  assert.equal(u.q('.setup-scope').textContent, 'Not shared');
  assert.ok(u.card.element.classList.contains('setup-local'), "this computer's own settings: the dashed local card");
  const rows = [...u.card.element.querySelectorAll('.ct-row')].map(r => [r.dataset.team, r.querySelector('.ct-from').textContent, r.querySelector('.ct-id').textContent, !!r.querySelector('.ct-chip')]);
  assert.deepEqual(rows, [['engineering', 'shared · from the workspace', 'no provider id yet', false], ['global', 'shared · from the workspace', 'no provider id yet', false],
    ['marketing', 'shared · from the workspace', 'no provider id yet', false], ['mine', 'local · on this computer', 'mine:juan.aweb.ai', true]], "the kernel's order");
  assert.equal(u.row('mine').querySelector('.ct-desc').textContent, 'My own team');
  assert.equal(u.row('engineering').querySelector('.ct-warn').textContent, 'shared team engineering has no provider id yetits owner runs `oats aweb setup`, then commits the id', "the kernel's problem and fix, verbatim");
  assert.equal(u.row('engineering').querySelector('.ct-blocking'), null, 'not the default: a warning, not blocking');
  assert.equal(u.q('.ct-all').textContent, 'Every soul may join: global.');
  assert.doesNotMatch(u.card.element.textContent, /primary|personal/i);
});

test('real capture: shared teams are read-only; the default local team cannot be removed, and says why', async t => {
  const u = await mount(t);
  for (const shared of ['engineering', 'global', 'marketing']) assert.equal(u.act(shared, 'Remove'), null, 'shared: edited by a PR to the workspace, never here');
  const mine = u.act('mine', 'Remove');
  assert.equal(mine.disabled, true); assert.equal(mine.title, "Can't remove: it is the default team; 1 soul uses it. Change that first.");
  assert.equal(u.row('mine').querySelector('.ct-why').textContent, mine.title, 'the reason is on the page too, not only in a tooltip');
  assert.equal(teamInUse(teams('teams-after'), 'global'), "Can't remove: every soul may join it. Change that first.");
  assert.equal(teamInUse(teams('teams-after'), 'engineering'), "Can't remove: 1 soul uses it. Change that first.", 'a soul default and a soul team: the same soul, counted once');
  assert.equal(teamInUse(teams('teams-add'), 'mine'), "Can't remove: it is the default team. Change that first.");
  assert.equal(teamInUse(teams('teams-after'), 'nobody'), null);
});

test('Make default: a team with no provider id cannot be the default; a mapped one asks first and sends its label (DERIVED: engineering mapped)', async t => {
  const plain = await mount(t);
  assert.equal(plain.act('mine', 'Make default'), null, 'the default has no Make default');
  assert.equal(plain.act('engineering', 'Make default').disabled, true, 'real capture: no provider id yet');
  const u = await mount(t, body => { const d = mapped(); if (body.action === 'default') { d.defaultTeam = body.label; for (const r of d.teams) r.default = r.label === body.label; } return d; });
  await u.click(u.act('engineering', 'Make default'));
  assert.equal(u.row('engineering').querySelector('.ct-confirm p').textContent, 'Make engineering the default team on this computer? Running instances keep their current default team until they are respawned.');
  assert.equal(u.doc.activeElement, u.row('engineering').querySelector('.ct-confirm .primary'));
  await u.click(u.row('engineering').querySelector('.ct-confirm .primary'));
  assert.deepEqual(u.calls.at(-1), { action: 'default', label: 'engineering' });
  assert.ok(u.row('engineering').querySelector('.ct-chip'), 'repainted from the answer'); assert.equal(u.row('engineering').querySelector('.ct-confirm'), null);
  await u.click(u.act('mine', 'Make default')); await u.click([...u.row('mine').querySelectorAll('.ct-confirm .ct-act')].find(b => b.textContent === 'Cancel'));
  assert.equal(u.row('mine').querySelector('.ct-confirm'), null); assert.equal(u.calls.length, 2, 'Cancel sends nothing');
});

test("Add a local team: label + an existing id; the kernel's refusals (captured) verbatim; a label is lowercase; the form keeps what was typed", async t => {
  const u = await mount(t, body => body.action !== 'add' ? teams('teams-initial')
    : body.label === 'mine' ? Promise.reject(refused('teams-add-exists')) : body.label === 'engineering' ? Promise.reject(refused('teams-add-shared')) : teams('teams-add'));
  await u.click([...u.card.element.querySelectorAll('.ct-foot > .ct-act')].find(b => b.textContent === 'Add a local team'));
  const form = u.q('.ct-form');
  assert.deepEqual([...form.querySelectorAll('label')].map(l => l.firstChild.textContent), ['Label', 'Team id', 'Description (optional)']);
  assert.equal(form.querySelector('.ct-hint').textContent, 'To create a new team, run oats aweb setup.');
  assert.equal(u.doc.activeElement, form.querySelector('input[name=label]'));
  const submit = async () => { u.q('.ct-form button[type=submit]').click(); await tick(); };
  const type = (name, value) => { const input = u.q(`.ct-form input[name=${name}]`); input.value = value; input.dispatchEvent(new u.dom.window.Event('input', { bubbles: true })); };
  await submit();
  assert.equal(u.q('.ct-error p').textContent, 'A local team needs a label and its provider team id.'); assert.equal(u.calls.length, 1, 'nothing sent');
  type('label', 'Mine'); type('team', 'mine:juan.aweb.ai'); await submit();
  assert.equal(u.q('.ct-error p').textContent, 'A label is lowercase letters and digits, with . _ or - after the first character.'); assert.equal(u.calls.length, 1, "the kernel's grammar, said before sending");
  type('label', 'engineering'); await submit();
  assert.deepEqual(u.calls.at(-1), { action: 'add', label: 'engineering', team: 'mine:juan.aweb.ai' });
  assert.equal(u.q('.ct-error p').textContent, 'team engineering is already declared (shared, in oats-workspace.yaml)', 'real: a shared label is E_TEAM_EXISTS');
  assert.equal(u.q('.ct-error pre').textContent, 'E_TEAM_EXISTS');
  type('label', 'mine'); await submit();
  assert.equal(u.q('.ct-error p').textContent, 'team mine is already declared (local, in oats-local.yaml): remove it first (`oats teams remove`) to redefine it');
  assert.equal(u.q('.ct-form input[name=label]').value, 'mine', 'kept for a fix');
  type('label', 'scratch'); type('description', '  Try-outs  '); await submit();
  assert.deepEqual(u.calls.at(-1), { action: 'add', label: 'scratch', team: 'mine:juan.aweb.ai', description: 'Try-outs' });
  assert.equal(u.q('.ct-form'), null, 'added: the form closes');
});

test("a stale view: the kernel's captured E_TEAM_IN_USE on Remove is shown under its row with the code (DERIVED: mine shown unused)", async t => {
  const stale = () => { const d = teams('teams-add'); d.defaultTeam = null; for (const r of d.teams) r.default = false; return d; };
  const u = await mount(t, body => body.action === 'remove' ? Promise.reject(refused('teams-remove-in-use')) : stale());
  await u.click(u.act('mine', 'Remove'));
  assert.deepEqual(u.calls.at(-1), { action: 'remove', label: 'mine' });
  assert.equal(u.row('mine').querySelector('.ct-error p').textContent, 'team mine is still referenced (defaultTeam, souls.teams:release-manager): remove the references first (`oats teams default`, `oats soul teams … --remove mine`)');
  assert.equal(u.row('mine').querySelector('.ct-error pre').textContent, 'E_TEAM_IN_USE');
});

test('no teams yet says what to do; a failed read says so', async t => {
  const empty = await mount(t, () => ({ ...teams('teams-initial'), defaultTeam: null, teams: [], souls: { teams: {}, default: {} }, problems: [] }));
  assert.equal(empty.q('.ct-all').textContent, 'No teams on this computer yet. Add a local team, or run oats aweb setup.');
  const failed = await mount(t, () => Promise.reject(refusal('E_CLI_PROTOCOL', 'oats teams answered something this Desktop cannot read')));
  assert.equal(failed.q('.ct-error p').textContent, 'oats teams answered something this Desktop cannot read');
});

test('Setup has no Teams box: teams live on the Workspace Teams tab (workspace-v2-view.test.mjs); the 0.29 box is teamsBox', async t => {
  const dom = new JSDOM('<!doctype html><body><div></div></body>'), doc = dom.window.document; t.after(() => dom.window.close());
  const status = { workspace: { name: 'oats', key: 'k', teams: ['global'] }, members: [], packages: [] };
  const host = doc.querySelector('div');
  renderSetup(host, { status });
  assert.deepEqual([...host.querySelectorAll('[data-box]')].map(b => b.dataset.box).filter(b => /Teams/.test(b)), []);
  const box = teamsBox(doc, { status });
  assert.equal(box.dataset.box, 'Teams'); assert.deepEqual([...box.querySelectorAll('[data-team]')].map(r => r.dataset.team), ['global']);
});

test("the default team's problem (default: true) is blocking: said as such, with the kernel's words and fix, and another default offered (DERIVED: engineering the default)", async t => {
  const d = teams('teams-after'); d.defaultTeam = 'engineering'; for (const r of d.teams) r.default = r.label === 'engineering';
  for (const p of d.problems) if (p.label === 'engineering') p.default = true;
  const u = await mount(t, () => structuredClone(d));
  const block = u.row('engineering').querySelector('.ct-blocking');
  assert.equal(block.getAttribute('role'), 'alert');
  assert.deepEqual([...block.children].map(c => c.textContent), ['The default team engineering has no provider id yet: nothing can be spawned until it has one.',
    'shared team engineering has no provider id yet', 'its owner runs `oats aweb setup`, then commits the id', 'Or make another team the default.']);
  assert.equal(u.row('global').querySelector('.ct-blocking'), null, 'a non-default unmapped team only warns');
  assert.ok(u.row('global').querySelector('.ct-warn'));
});

test("the routes' answer (#269 df06befe, docs/desktop-teams.md): ok → the decoded document under its key; refused → the reason, verbatim", () => {
  const doc = teams('teams-initial');
  assert.equal(teamsAnswer({ status: 'ok', teams: doc }, 'teams', 'x'), doc);
  assert.throws(() => teamsAnswer({ status: 'ok', soulTeams: doc }, 'teams', 'The teams on this computer could not be read.'), /could not be read/, 'the wrong key is not read');
  const refused = reason => { try { teamsAnswer({ status: 'refused', reason }, 'teams', 'The teams on this computer could not be read.'); } catch (e) { return [e.code, e.message]; } return null; };
  const inUse = capture('teams-remove-in-use').error;
  assert.deepEqual(refused(inUse), ['E_TEAM_IN_USE', inUse.message], "the kernel's words (captured)");
  assert.deepEqual(refused({ code: 'E_BUSY', message: 'Another change is in progress. Try again.' }), ['E_BUSY', 'Another change is in progress. Try again.'], "the Desktop's own words");
  assert.deepEqual(refused({ code: 'E_CLI_PROTOCOL' }), ['E_CLI_PROTOCOL', 'The teams on this computer could not be read.'], 'no message: the fallback, with the code');
});
