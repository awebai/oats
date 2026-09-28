// Team model v2 (0.30, D2 screen 2): the soul page's "Teams here". The document is K1's
// `oats soul teams <soul> --json` example verbatim (docs/desktop-cli-api.md "Team model v2",
// feat/030-team-model 8dd82158) until the real 0.30 capture exists; the IO is the proposed
// /api/workspace-soul-teams route (show | add | remove | default | clear-default), faked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSoulTeamsHere, soulTeamsHereCSS, viaText } from '../renderer/soul-teams-here.mjs';

const K1 = () => ({ soulTeamsApi: 1, soul: 'oats-expert', key: 'oats-expert',
  defaultTeam: { label: 'oats', team: 'oats:oats.aweb.ai', from: 'soul' },
  teams: [{ label: 'oats', team: 'oats:oats.aweb.ai', default: true, from: 'shared', via: ['default', '*'] },
    { label: 'reviewers', team: null, default: false, from: 'shared', via: ['soul'] }],
  local: { teams: ['reviewers'], default: 'oats' }, all: ['oats'] });
// The same soul after --clear-default: the deployment's default (a local team) comes first.
const INHERITED = () => ({ ...K1(), defaultTeam: { label: 'antares-oats', team: 'antares-oats:juan.aweb.ai', from: 'deployment' },
  teams: [{ label: 'antares-oats', team: 'antares-oats:juan.aweb.ai', default: true, from: 'local', via: ['default'] },
    { label: 'oats', team: 'oats:oats.aweb.ai', default: false, from: 'shared', via: ['*'] },
    { label: 'reviewers', team: null, default: false, from: 'shared', via: ['soul'] }],
  local: { teams: ['reviewers'], default: null } });
const TEAMS = () => ({ teamsApi: 1, deployment: '/w', defaultTeam: 'antares-oats', teams: [
  { label: 'antares-oats', team: 'antares-oats:juan.aweb.ai', description: null, from: 'local', default: true },
  { label: 'oats', team: 'oats:oats.aweb.ai', description: 'The OATS project', from: 'shared', default: false },
  { label: 'reviewers', team: null, description: null, from: 'shared', default: false },
  { label: 'scratch', team: null, description: null, from: 'local', default: false }], souls: { teams: {}, default: {} }, problems: [] });
const refusal = (code, message) => Object.assign(new Error(message), { code });
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

async function mount(t, answer = () => K1(), listTeams = async () => TEAMS()) {
  const dom = new JSDOM('<!doctype html><body><main class="oats-view"></main></body>', { pretendToBeVisual: true }), doc = dom.window.document;
  const style = doc.createElement('style'); style.textContent = soulTeamsHereCSS; doc.head.append(style);
  const calls = [];
  const card = createSoulTeamsHere(doc, { soul: 'oats-expert', request: async body => { calls.push(body); return answer(body, calls.length); }, listTeams });
  doc.querySelector('main').append(card.element);
  t.after(() => { card.dispose(); dom.window.close(); });
  await tick();
  const q = s => card.element.querySelector(s), row = label => q(`[data-team="${label}"]`);
  const click = async el => { el.click(); await tick(); };
  const act = (label, name) => [...row(label).querySelectorAll('.sth-actions > .sth-act')].find(b => b.textContent === name) ?? null;
  return { dom, doc, card, calls, q, row, click, act };
}

test("it shows the soul's teams here, its own default, and why it has each team; one read", async t => {
  const u = await mount(t);
  assert.deepEqual(u.calls, [{ soul: 'oats-expert', action: 'show' }]);
  assert.equal(u.card.element.dataset.card, 'Teams here'); assert.equal(u.q('.page-card-lead').textContent, 'on this computer');
  assert.equal(u.q('.sth-default').textContent, "Default: oats (this soul's own)");
  const rows = [...u.card.element.querySelectorAll('.sth-row')].map(r => [r.dataset.team, !!r.querySelector('.page-tag'), ...[...r.querySelectorAll('.sth-meta')].map(m => m.textContent)]);
  assert.deepEqual(rows, [['oats', true, 'oats:oats.aweb.ai · shared', 'its own default · every soul may join it'],
    ['reviewers', false, 'no provider id yet · shared', 'added for this soul']]);
  assert.ok(u.row('reviewers').querySelector('.sth-meta.warn'), 'no provider id yet is a warning');
  assert.doesNotMatch(u.card.element.textContent, /primary|personal/i);
});

test('the default: inherited from the workspace, or none configured', async t => {
  const inherited = await mount(t, () => INHERITED());
  assert.equal(inherited.q('.sth-default').textContent, "Default: antares-oats (the workspace's default on this computer)");
  assert.equal(inherited.row('antares-oats').querySelectorAll('.sth-meta')[1].textContent, "the workspace's default here");
  const none = await mount(t, () => ({ ...K1(), defaultTeam: null, teams: K1().teams.slice(1) }));
  assert.equal(none.q('.sth-default').textContent, 'No default team on this computer: run oats aweb setup.');
  assert.equal(viaText(['default', '*', 'soul'], 'soul'), 'its own default · every soul may join it · added for this soul');
  assert.equal(viaText(['future'], 'deployment'), 'future', 'an unknown reason is shown as written');
});

test('actions: Make default needs an id; Use workspace default only for its own default; Remove only what was added for this soul', async t => {
  const own = await mount(t);
  assert.equal(own.act('oats', 'Make default'), null, 'already the default');
  assert.ok(own.act('oats', 'Use workspace default'), 'its own default can go back to the workspace one');
  assert.equal(own.act('oats', 'Remove'), null, 'every soul may join oats: not removable per soul');
  assert.equal(own.act('reviewers', 'Make default'), null, 'no provider id yet: it cannot be the default');
  assert.ok(own.act('reviewers', 'Remove'));
  const inherited = await mount(t, () => INHERITED());
  assert.equal(inherited.act('antares-oats', 'Use workspace default'), null, 'already the workspace default');
  assert.equal(inherited.act('antares-oats', 'Remove'), null);
  assert.equal(inherited.act('oats', 'Make default').getAttribute('aria-label'), 'Make oats the default team of oats-expert');
});

test('each action sends its body and repaints from the answer', async t => {
  const u = await mount(t, body => body.action === 'clear-default' || body.action === 'remove' ? INHERITED() : K1());
  await u.click(u.act('oats', 'Use workspace default'));
  assert.deepEqual(u.calls.at(-1), { soul: 'oats-expert', action: 'clear-default' });
  assert.equal(u.q('.sth-default').textContent, "Default: antares-oats (the workspace's default on this computer)");
  await u.click(u.act('oats', 'Make default'));
  assert.deepEqual(u.calls.at(-1), { soul: 'oats-expert', action: 'default', label: 'oats' });
  assert.equal(u.q('.sth-default').textContent, "Default: oats (this soul's own)");
  await u.click(u.act('reviewers', 'Remove'));
  assert.deepEqual(u.calls.at(-1), { soul: 'oats-expert', action: 'remove', labels: ['reviewers'] });
});

test('Add offers the teams on this computer the soul is not in yet, then focuses the choice', async t => {
  let listed = 0;
  const u = await mount(t, body => body.action === 'add' ? { ...K1(), teams: [...K1().teams, { label: body.labels[0], team: null, default: false, from: 'local', via: ['soul'] }] } : K1(),
    async () => { listed++; return TEAMS(); });
  assert.equal(listed, 0, 'the list is read only when asked');
  await u.click([...u.q('.sth-add').querySelectorAll('.sth-act')].find(b => b.textContent === 'Add a team'));
  const select = u.q('.sth-add select');
  assert.deepEqual([...select.options].map(o => [o.value, o.textContent]), [['antares-oats', 'antares-oats'], ['scratch', 'scratch (no provider id yet)']]);
  assert.equal(u.doc.activeElement, select);
  select.value = 'scratch';
  await u.click([...u.q('.sth-add').querySelectorAll('.sth-act')].find(b => b.textContent === 'Add'));
  assert.deepEqual(u.calls.at(-1), { soul: 'oats-expert', action: 'add', labels: ['scratch'] });
  assert.ok(u.row('scratch'), 'repainted from the answer');
  assert.deepEqual([...u.q('.sth-add select').options].map(o => o.value), ['antares-oats']);
});

test("the kernel's refusals are shown verbatim with their code", async t => {
  const u = await mount(t, body => body.action === 'remove' ? Promise.reject(refusal('E_TEAM_UNKNOWN', 'unknown team reviewers'))
    : body.action === 'add' ? Promise.reject(refusal('E_TEAM_NOT_ELIGIBLE', 'oats is not one of the teams of oats-expert')) : K1());
  await u.click(u.act('reviewers', 'Remove'));
  assert.equal(u.row('reviewers').querySelector('.sth-error p').textContent, 'unknown team reviewers');
  assert.equal(u.row('reviewers').querySelector('.sth-error pre').textContent, 'E_TEAM_UNKNOWN');
  assert.equal(u.row('reviewers').querySelector('.sth-error').getAttribute('role'), 'alert');
  await u.click([...u.q('.sth-add').querySelectorAll('.sth-act')].find(b => b.textContent === 'Add a team'));
  await u.click([...u.q('.sth-add').querySelectorAll('.sth-act')].find(b => b.textContent === 'Add'));
  assert.equal(u.q('.sth-add .sth-error pre').textContent, 'E_TEAM_NOT_ELIGIBLE');
  assert.equal(u.row('reviewers').querySelector('.sth-error'), null, 'one error at a time');
});

test('a failed or malformed read says so', async t => {
  const failed = await mount(t, () => Promise.reject(refusal('E_SOUL_UNKNOWN', 'no soul oats-expert here')));
  assert.equal(failed.q('.sth-error p').textContent, 'no soul oats-expert here');
  const malformed = await mount(t, () => ({ soulTeamsApi: 1 }));
  assert.equal(malformed.q('.sth-error p').textContent, 'The teams of oats-expert on this computer could not be read.');
});
