// F7 Part C: the spawn dialog's Teams row (teams contract; kernel #179). The
// workspace's default team is fixed; the soul's mapped teams are unchecked checkboxes;
// unmapped ones are greyed with the reason. The choice travels as
// `--provider <cap> join=<a,b>` and must come back bound (settings echo).
// Offered only when the provider DECLARES the spawn setting `join` — the
// kernel binds join= for any provider, so without the declared fact the row
// would promise joins an older provider ignores (captured: preview-no-join-sent).
// Kernel captures: test/fixtures/workspace-v2/f7 from main (#181's `declares`,
// feature settings-declared; contract bdd7e55e), with the stand-in providers
// nw.teams (declares ["join"]) and nw.chat (declares ["identity"]) — provenance `standIn`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewChoices, previewData, choiceArgv } from '../renderer/spawn-preview-contract.mjs';
import { mountSpawn, settle } from './helpers/spawn-dialog-host.mjs';
import { cli as CLI, target } from './helpers/spawn-preview-fixture.mjs';

const f7 = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f7/${name}.json`, import.meta.url), 'utf8'));
const provenance = f7('provenance');
const JOIN = { provider: 'nw.teams', labels: ['engineering'] };
/** As captured: the kernel's messaging row declares `join` (nw.teams). */
const declared = envelope => structuredClone(envelope);
/** A kernel before #181: no `declares` on the rows. */
const undeclared = envelope => { const v = structuredClone(envelope); for (const m of v.result.modules) delete m.declares; return v; };
const previewFor = choices => choices.join ? 'preview-teams-join' : 'preview-teams-default';
const argvOf = name => { const a = provenance.files[name].argv; return a.slice(a.indexOf('--purpose'), a.indexOf(name.startsWith('apply') ? '--expect-decision' : '--preview')); };

const DECLARED_CLI = () => ({ ...structuredClone(CLI), features: [...CLI.features, 'settings-declared'] });
async function dialog(t, { kernel = choices => declared(f7(previewFor(choices))), cli = DECLARED_CLI(), ...options } = {}) {
  const u = await mountSpawn(t, { kernel: (_c, { choices }) => kernel(choices), cli, ...options });
  await u.open(); await u.type('.fpurpose', 'teams'); await settle();
  return u;
}
const rows = u => [...u.dialog().querySelectorAll('.spawn-team')].map(r => {
  const box = r.querySelector('input');
  return [r.querySelector('.spawn-team-name').textContent, r.title, box.checked, box.disabled];
});

test('join choices: the mapped labels to join, as the provider spawn setting; anything else is refused', () => {
  assert.deepEqual(previewChoices({ join: JOIN }).join, JOIN);
  assert.deepEqual(previewChoices({ join: { provider: 'nw.teams', labels: ['engineering', 'global'] } }).join.labels, ['engineering', 'global']);
  for (const bad of [{ provider: 'nw.teams', labels: [] }, { provider: 'nw.teams', labels: ['a', 'a'] }, { provider: 'nw.teams', labels: ['a,b'] },
    { provider: 'nw.teams', labels: ['-x'] }, { provider: '--dir', labels: ['a'] }, { provider: 'nw.teams' }, { provider: 'nw.teams', labels: ['a'], extra: 1 },
    { provider: 'nw.teams', labels: Array.from({ length: 17 }, (_, i) => `t${i}`) }, ['engineering'], 'engineering', null])
    assert.equal(previewChoices({ join: bad }), null, JSON.stringify(bad));
});

test('the flags are the captured kernel argv: --provider <cap> join=<a,b>, the same for preview and apply', () => {
  assert.deepEqual(choiceArgv(previewChoices({ purpose: 'teams', join: JOIN })), argvOf('preview-teams-join'));
  assert.deepEqual(choiceArgv(previewChoices({ purpose: 'teams', join: JOIN })), argvOf('apply-teams-join'));
  assert.deepEqual(choiceArgv(previewChoices({ purpose: 'teams' })), argvOf('preview-teams-default'), 'nothing chosen, nothing sent');
});

test('the projection carries the kernel\'s teams (primary first, no payloads), the bound join, and the declared fact', () => {
  const t = { ...target, selector: { ...target.selector } };
  const d = previewData(declared(f7('preview-teams-default')).result, t);
  assert.deepEqual(d.teams, [{ label: 'engineering', team: 'northwind:eng', mapped: true }, { label: 'global', team: null, mapped: false }]);
  assert.equal(d.messaging.provider, 'nw.teams'); assert.equal(d.messaging.join, null); assert.equal(d.messaging.joinDeclared, true);
  assert.equal(previewData(declared(f7('preview-teams-join')).result, t).messaging.join, 'engineering');
  assert.deepEqual(f7('preview-teams-default').result.modules.find(m => m.layer === 'messaging').declares, ['join'], 'the kernel\'s declared fact (#181)');
  assert.equal(previewData(undeclared(f7('preview-teams-default')).result, t).messaging.joinDeclared, false, 'a kernel before #181 declares nothing');
  const chat = previewData(f7('preview-teams-no-join').result, t);
  assert.equal(chat.messaging.provider, 'nw.chat'); assert.equal(chat.messaging.joinDeclared, false);
  // The captured hazard: an undeclared provider still gets join= bound.
  assert.equal(previewData(f7('preview-no-join-sent').result, t).messaging.join, 'engineering');
  const once = previewData(declared(f7('preview-teams-join')).result, t);
  assert.deepEqual(previewData(once, t), once, "the renderer's re-validation of the server projection keeps it");
  for (const [label, mutate] of [
    ['bound and shown join disagree', v => { v.settings['nw.teams'].join = 'global'; }],
    ['mapped without a team', v => { v.teams[0].team = null; }], ['unmapped with a team', v => { v.teams[1].team = 'x:y'; }],
    ['duplicate labels', v => { v.teams[1].label = 'engineering'; }], ['teams not a list', v => { v.teams = {}; }],
  ]) { const v = declared(f7('preview-teams-join')).result; mutate(v); assert.equal(previewData(v, t), null, label); }
  const older = f7('preview-teams-default').result; delete older.teams;
  assert.equal(previewData(older, t).teams, null, 'a kernel before #179 reports no teams');
});

test('the main form shows the Teams row — one line like Relationship: the default team fixed, the teams the soul has access to unchecked, unmapped not shown', async t => {
  const u = await dialog(t);
  const field = u.q('.spawn-teams');
  assert.equal(field.hidden, false); assert.equal(field.tagName, 'FIELDSET');
  assert.equal(field.closest('.spawn-advanced'), null, 'the main form, not Developer settings');
  assert.equal(field.querySelector('legend').textContent, 'Teams');
  assert.equal(u.text('.spawn-teams-hint'), "By default it's only in the workspace's default team. These are the teams release-manager has access to — tick the ones it should also join.");
  assert.deepEqual(rows(u), [['Default', "The workspace's default team — always. Every instance is in it.", true, true],
    ['engineering', 'Join engineering (northwind:eng)', false, false]], 'global is not mapped: not shown');
  const row = u.q('.spawn-teams-row');
  assert.ok(row.classList.contains('spawn-seg'), 'the Relationship segmented control, as toggles');
  assert.equal(row.querySelectorAll('.spawn-team').length, 2); assert.equal(row.parentElement, field);
  assert.ok(u.previews().every(p => !Object.hasOwn(p.choices, 'join')), 'by default nothing is sent');
  assert.equal(u.q('.fspawn').disabled, false);
});

test('ticking a team previews it, the kernel binds it, and the apply sends it by value', async t => {
  const applied = [];
  const u = await dialog(t, { apply: args => { applied.push(args); return { started: true, envelope: f7('apply-teams-join') }; } });
  await u.change('.fteam[value="engineering"]', true); await settle();
  assert.deepEqual(u.previews().at(-1).choices.join, JOIN);
  assert.equal(u.q('.fteam[value="engineering"]').checked, true, 'the tick survives the re-render');
  assert.equal(u.text('.spawn-teams-error'), '');
  assert.equal(u.q('.fspawn').disabled, false);
  await u.spawn(); await settle();
  assert.deepEqual(u.spawns()[0].choices.join, JOIN);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].decision.revision, f7('preview-teams-join').result.decision.revision, 'bound to the decision that carries the join');
  assert.deepEqual(choiceArgv(applied[0].choices), argvOf('apply-teams-join'));
  assert.match(u.text('.fstatus'), /^Created release-manager-teams/);
  // untick: nothing is sent again
  const v = await dialog(t);
  await v.change('.fteam[value="engineering"]', true); await v.change('.fteam[value="engineering"]', false); await settle();
  assert.equal(Object.hasOwn(v.previews().at(-1).choices, 'join'), false);
});

test('a preview that does not bind the ticked teams keeps Spawn off and says so', async t => {
  const u = await dialog(t, { kernel: () => declared(f7('preview-teams-default')) });
  await u.change('.fteam[value="engineering"]', true); await settle();
  assert.deepEqual(u.previews().at(-1).choices.join, JOIN);
  assert.equal(u.text('.spawn-teams-error'), "The kernel didn't bind the ticked teams. Spawn waits until it does.");
  assert.equal(u.q('.fspawn').disabled, true);
});

test('no row without the declared fact (a kernel before #181), for a provider that does not declare join, without spawn-provider-payload, or without settings-declared', async t => {
  const a = await dialog(t, { kernel: choices => undeclared(f7(previewFor(choices))) });
  assert.equal(a.q('.spawn-teams').hidden, true);
  const b = await dialog(t, { kernel: () => f7('preview-teams-no-join') });
  assert.equal(b.q('.spawn-teams').hidden, true);
  const c = await dialog(t, { cli: { ...DECLARED_CLI(), features: DECLARED_CLI().features.filter(f => f !== 'spawn-provider-payload') } });
  assert.equal(c.q('.spawn-teams').hidden, true);
  const d = await dialog(t, { cli: structuredClone(CLI) }); // declares present, but the CLI does not advertise settings-declared
  assert.equal(d.q('.spawn-teams').hidden, true);
  for (const u of [a, b, c, d]) assert.ok(u.previews().every(p => !Object.hasOwn(p.choices, 'join')));
});

test('a soul whose preview reports no teams shows no row, even with the declared fact', async t => {
  const u = await dialog(t, { kernel: choices => { const v = declared(f7(previewFor(choices))); v.result.teams = []; return v; } });
  assert.equal(u.q('.spawn-teams').hidden, true);
});

test('when the kernel\'s list changes under a tick, the redrawn row keeps it', async t => {
  let extra = false;
  const u = await dialog(t, { kernel: choices => {
    const v = declared(f7(previewFor(choices)));
    if (extra) v.result.teams.push({ label: 'platform', team: 'northwind:platform', mapped: true, payload: {} });
    return v;
  } });
  await u.change('.fteam[value="engineering"]', true); await settle();
  extra = true; await u.type('.fpurpose', 'teams'); await settle();
  assert.deepEqual(rows(u).map(r => r[0]), ['Default', 'engineering', 'platform'], 'redrawn from the kernel\'s new list');
  assert.equal(u.q('.fteam[value="engineering"]').checked, true);
  assert.equal(u.q('.fteam[value="platform"]').checked, false);
});

test('a soul with no team it has access to (all unmapped) shows no row: there is nothing to choose', async t => {
  const u = await dialog(t, { kernel: choices => { const v = declared(f7(previewFor(choices))); v.result.teams = v.result.teams.map(x => ({ ...x, mapped: false, team: null })); return v; } });
  assert.equal(u.q('.spawn-teams').hidden, true);
  assert.ok(u.previews().every(p => !Object.hasOwn(p.choices, 'join')));
});
