// Team model v2 (0.30, D2 screen 1): the Workspace Teams tab's "Teams on this computer". The document is K1's
// `oats teams --json` example verbatim (docs/desktop-cli-api.md "Team model v2",
// feat/030-team-model 8dd82158) until the real 0.30 capture exists; the IO is the proposed
// /api/workspace-teams route (list | add | remove | default), faked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createComputerTeams, computerTeamsCSS, teamInUse, teamsAnswer } from '../renderer/computer-teams.mjs';
import { renderSetup, setupCSS, teamsBox } from '../renderer/workspace-setup.mjs';

const K1 = () => ({ teamsApi: 1, deployment: '/w', defaultTeam: 'antares-oats',
  teams: [
    { label: 'antares-oats', team: 'antares-oats:juan.aweb.ai', description: null, from: 'local', default: true, at: 'oats-local.yaml#/teams/antares-oats' },
    { label: 'oats', team: 'oats:oats.aweb.ai', description: 'The OATS project', from: 'shared', default: false, at: 'github.com/awebai/oats:oats-workspace.yaml#/teams/oats' },
    { label: 'reviewers', team: null, description: null, from: 'shared', default: false, at: 'github.com/awebai/oats:oats-workspace.yaml#/teams/reviewers' }],
  souls: { teams: { '*': ['oats'], 'oats-expert': ['reviewers'] }, default: { 'oats-expert': 'oats' } },
  problems: [{ code: 'team-unmapped', label: 'reviewers', default: false, message: 'shared team reviewers has no provider id yet', fix: 'its owner runs `oats aweb setup`, then commits the id' }] });
const refusal = (code, message) => Object.assign(new Error(message), { code });
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

async function mount(t, answer = () => K1()) {
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

test('it lists the shared and local teams with their ids and the default; one read, labelled "on this computer"', async t => {
  const u = await mount(t);
  assert.deepEqual(u.calls, [{ action: 'list' }]);
  assert.equal(u.q('.setup-box-head h3').textContent, 'Teams on this computer');
  assert.equal(u.q('.setup-scope').textContent, 'Not shared');
  assert.ok(u.card.element.classList.contains('setup-local'), "this computer's own settings: the dashed local card");
  const rows = [...u.card.element.querySelectorAll('.ct-row')].map(r => [r.dataset.team, r.querySelector('.ct-from').textContent, r.querySelector('.ct-id').textContent, !!r.querySelector('.ct-chip')]);
  assert.deepEqual(rows, [['antares-oats', 'local · on this computer', 'antares-oats:juan.aweb.ai', true],
    ['oats', 'shared · from the workspace', 'oats:oats.aweb.ai', false], ['reviewers', 'shared · from the workspace', 'no provider id yet', false]]);
  assert.equal(u.row('oats').querySelector('.ct-desc').textContent, 'The OATS project');
  assert.equal(u.row('reviewers').querySelector('.ct-warn').textContent, 'shared team reviewers has no provider id yetits owner runs `oats aweb setup`, then commits the id', "the kernel's problem and fix, verbatim, on its row");
  assert.equal(u.q('.ct-all').textContent, 'Every soul may join: oats.');
  assert.doesNotMatch(u.card.element.textContent, /primary|personal/i);
});

test('shared teams are read-only; a local team in use cannot be removed, and says why', async t => {
  const doc = K1(); doc.teams.push({ label: 'scratch', team: 'scratch:juan.aweb.ai', description: null, from: 'local', default: false, at: 'oats-local.yaml#/teams/scratch' });
  doc.souls.teams['oats-expert'].push('scratch');
  const u = await mount(t, () => structuredClone(doc));
  assert.equal(u.act('oats', 'Remove'), null, 'shared: edited by a PR to the workspace, never here');
  assert.equal(u.act('reviewers', 'Remove'), null);
  const home = u.act('antares-oats', 'Remove');
  assert.equal(home.disabled, true); assert.equal(home.title, "Can't remove: it is the default team. Change that first.");
  assert.equal(u.row('antares-oats').querySelector('.ct-why').textContent, home.title, 'the reason is on the page too, not only in a tooltip');
  assert.equal(u.act('scratch', 'Remove').title, "Can't remove: 1 soul uses it. Change that first.");
  assert.equal(teamInUse(K1(), 'oats'), "Can't remove: every soul may join it; 1 soul uses it. Change that first.");
  assert.equal(teamInUse(K1(), 'nobody'), null);
});

test('Make default asks first, says running instances keep theirs, and sends the label', async t => {
  const u = await mount(t, (body) => { const d = K1(); if (body.action === 'default') { d.defaultTeam = body.label; for (const r of d.teams) r.default = r.label === body.label; } return d; });
  assert.equal(u.act('antares-oats', 'Make default'), null, 'the default has no Make default');
  assert.equal(u.act('reviewers', 'Make default').disabled, true, 'a team with no provider id yet cannot be the default');
  await u.click(u.act('oats', 'Make default'));
  assert.equal(u.row('oats').querySelector('.ct-confirm p').textContent, 'Make oats the default team on this computer? Running instances keep their current default team until they are respawned.');
  assert.equal(u.doc.activeElement, u.row('oats').querySelector('.ct-confirm .primary'));
  await u.click(u.row('oats').querySelector('.ct-confirm .primary'));
  assert.deepEqual(u.calls.at(-1), { action: 'default', label: 'oats' });
  assert.ok(u.row('oats').querySelector('.ct-chip'), 'repainted from the answer'); assert.equal(u.row('oats').querySelector('.ct-confirm'), null);
  await u.click(u.act('antares-oats', 'Make default')); await u.click([...u.row('antares-oats').querySelectorAll('.ct-confirm .ct-act')].find(b => b.textContent === 'Cancel'));
  assert.equal(u.row('antares-oats').querySelector('.ct-confirm'), null); assert.equal(u.calls.length, 2, 'Cancel sends nothing');
});

test('Add a local team: label + an existing id (creating one is oats aweb setup); a refusal is shown verbatim and the form keeps what was typed', async t => {
  const u = await mount(t, body => body.action === 'add' && body.label === 'oats' ? Promise.reject(refusal('E_TEAM_EXISTS', 'team oats is already declared (shared)')) : K1());
  await u.click([...u.card.element.querySelectorAll('.ct-foot > .ct-act')].find(b => b.textContent === 'Add a local team'));
  const form = u.q('.ct-form');
  assert.deepEqual([...form.querySelectorAll('label')].map(l => l.firstChild.textContent), ['Label', 'Team id', 'Description (optional)']);
  assert.equal(form.querySelector('.ct-hint').textContent, 'To create a new team, run oats aweb setup.');
  assert.equal(u.doc.activeElement, form.querySelector('input[name=label]'));
  form.querySelector('button[type=submit]').click(); await tick();
  assert.equal(u.q('.ct-error p').textContent, 'A local team needs a label and its provider team id.'); assert.equal(u.calls.length, 1, 'nothing sent');
  const type = (name, value) => { const input = u.q(`.ct-form input[name=${name}]`); input.value = value; input.dispatchEvent(new u.dom.window.Event('input', { bubbles: true })); };
  type('label', 'oats'); type('team', 'oats:oats.aweb.ai');
  u.q('.ct-form button[type=submit]').click(); await tick();
  assert.deepEqual(u.calls.at(-1), { action: 'add', label: 'oats', team: 'oats:oats.aweb.ai' });
  assert.equal(u.q('.ct-error p').textContent, 'team oats is already declared (shared)'); assert.equal(u.q('.ct-error pre').textContent, 'E_TEAM_EXISTS');
  assert.equal(u.q('.ct-form input[name=label]').value, 'oats', 'kept for a fix');
  type('label', 'scratch'); type('team', 'scratch:juan.aweb.ai'); type('description', '  Try-outs  ');
  u.q('.ct-form button[type=submit]').click(); await tick();
  assert.deepEqual(u.calls.at(-1), { action: 'add', label: 'scratch', team: 'scratch:juan.aweb.ai', description: 'Try-outs' });
  assert.equal(u.q('.ct-form'), null, 'added: the form closes');
});

test("the kernel's refusal on Remove is shown under its row with the code", async t => {
  const doc = K1(); doc.teams.push({ label: 'scratch', team: 'scratch:juan.aweb.ai', description: null, from: 'local', default: false, at: 'oats-local.yaml#/teams/scratch' });
  const u = await mount(t, body => body.action === 'remove' ? Promise.reject(refusal('E_TEAM_IN_USE', 'team scratch is in use: souls.teams:pepe-helper')) : structuredClone(doc));
  await u.click(u.act('scratch', 'Remove'));
  assert.deepEqual(u.calls.at(-1), { action: 'remove', label: 'scratch' });
  assert.equal(u.row('scratch').querySelector('.ct-error p').textContent, 'team scratch is in use: souls.teams:pepe-helper');
  assert.equal(u.row('scratch').querySelector('.ct-error pre').textContent, 'E_TEAM_IN_USE');
});

test('no teams yet says what to do; a failed read says so', async t => {
  const empty = await mount(t, () => ({ ...K1(), defaultTeam: null, teams: [], souls: { teams: {}, default: {} }, problems: [] }));
  assert.equal(empty.q('.ct-all').textContent, 'No teams on this computer yet. Add a local team, or run oats aweb setup.');
  const failed = await mount(t, () => Promise.reject(refusal('E_CLI_FAILED', 'oats teams failed')));
  assert.equal(failed.q('.ct-error p').textContent, 'oats teams failed');
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

test("the default team's problem (default: true) is blocking: said as such, with the kernel's words and fix, and another default offered", async t => {
  const doc = K1(); doc.teams[0].team = null;
  doc.problems.push({ code: 'team-unmapped', label: 'antares-oats', default: true, message: 'local team antares-oats has no provider id yet', fix: 'run `oats aweb setup` for it' });
  const u = await mount(t, () => structuredClone(doc));
  const block = u.row('antares-oats').querySelector('.ct-blocking');
  assert.equal(block.getAttribute('role'), 'alert');
  assert.deepEqual([...block.children].map(c => c.textContent), ['The default team antares-oats has no provider id yet: nothing can be spawned until it has one.',
    'local team antares-oats has no provider id yet', 'run `oats aweb setup` for it', 'Or make another team the default.']);
  assert.equal(u.row('reviewers').querySelector('.ct-blocking'), null, 'a non-default unmapped team only warns');
  assert.ok(u.row('reviewers').querySelector('.ct-warn'));
});

test("the routes' answer (#269, docs/desktop-teams.md): available → the decoded document; unavailable → the reason, verbatim", () => {
  const doc = K1();
  assert.equal(teamsAnswer({ teamsViewApi: 1, status: 'available', action: 'list', data: doc, reason: null }, 'x'), doc);
  const refused = reason => { try { teamsAnswer({ teamsViewApi: 1, status: 'unavailable', data: null, reason }, 'The teams on this computer could not be read.'); } catch (e) { return [e.code, e.message]; } return null; };
  assert.deepEqual(refused({ code: 'E_TEAM_IN_USE', message: 'team scratch is in use: souls.teams:pepe-helper', details: { label: 'scratch', usedBy: ['souls.teams:pepe-helper'] } }),
    ['E_TEAM_IN_USE', 'team scratch is in use: souls.teams:pepe-helper'], "the kernel's words");
  assert.deepEqual(refused({ code: 'E_BUSY' }), ['E_BUSY', 'Another change to the teams on this computer is still running. Try again in a moment.']);
  assert.deepEqual(refused({ code: 'E_TEAMS_UNAVAILABLE' }), ['E_TEAMS_UNAVAILABLE', 'Team settings need OATS 0.30 or later.']);
  assert.deepEqual(refused({ code: 'E_CLI_PROTOCOL' }), ['E_CLI_PROTOCOL', 'The teams on this computer could not be read.']);
  assert.throws(() => teamsAnswer({ status: 'ok', teams: doc }, 'x'), /x/, 'the pre-#269 shape is not accepted');
});
