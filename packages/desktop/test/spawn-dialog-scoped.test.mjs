// The spawn dialog scoped to one soul (design board 6): the preview column instead of the
// chooser, the identity header with "Change soul" switching layouts in place, the segmented
// Relationship control and the one-border Name field. The dialog is mounted directly with a
// stubbed ctx whose preview endpoint answers the kernel captures (test/fixtures/workspace-v2/f3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSpawnDialog, spawnDialogCSS, composePreviewModules, soulOriginText, worksInText, moduleSourceText } from '../renderer/spawn-dialog.mjs';
import { identityCSS } from '../renderer/identity-marks.mjs';
import { spawnProblem } from '../renderer/spawn-messages.mjs';
import { cli as CLI, kernel, ROOT, target, view, deferred } from './helpers/spawn-preview-fixture.mjs';

const themeCSS = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function settle(n = 8) { for (let i = 0; i < n; i++) await tick(); }
const member = { name: 'release-manager', description: 'Cuts releases.', kind: 'persistent', work: 'worktree', agentsRoot: ROOT, soulKind: 'member', origin: 'member', repoName: 'agents' };
const other = { name: 'support-triager', description: 'Triages.', kind: 'persistent', work: 'directory', agentsRoot: ROOT, soulKind: 'member', origin: 'member', repoName: 'agents' };
const packaged = { name: 'code-reviewer', description: 'Reviews.', kind: 'persistent', work: 'worktree', agentsRoot: ROOT, soulKind: 'package', package: 'oats.engineering', version: '1.3.0', repoName: 'package oats.engineering' };
const preview = name => kernel(name).result;
const v2 = name => JSON.parse(readFileSync(new URL(`./fixtures/team-model-v2/${name}.json`, import.meta.url), 'utf8'));

function mount(t, { soul = member, agents = [member, other, packaged], layout, previews = () => view(target, preview('preview-worktree-default')), cli = CLI, theme = 'light' } = {}) {
  const dom = new JSDOM(`<!doctype html><html data-theme="${theme}"><body><div class="oats-view"><div class="spawn-modal"></div></div></body></html>`, { url: 'http://localhost', pretendToBeVisual: true });
  const doc = dom.window.document;
  for (const source of [themeCSS, identityCSS, spawnDialogCSS]) { const style = doc.createElement('style'); style.textContent = source; doc.head.append(style); }
  const calls = [], chosen = [];
  const ctx = { api: async (path, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : undefined; calls.push({ path, body });
    if (path.startsWith('/api/workspace-spawn-preview')) return previews(body);
    if (path === '/api/models') return { models: [] };
    if (path.startsWith('/api/launch-configs')) return { selected: body.selector, configurations: [] };
    throw new Error(`unexpected ${path}`);
  } };
  const ui = createSpawnDialog(doc.querySelector('.spawn-modal'), { ctx, soul, agents, workspace: () => ({ id: 'northwind', name: 'northwind' }), cli: () => cli, instances: () => [],
    owns: () => true, canChoose: () => true, choose: (candidate, draft) => chosen.push({ candidate, draft }), close: () => {}, servers: [], delay: 0, ...(layout ? { layout } : {}) });
  ui.start();
  t.after(() => { ui.dispose(); dom.window.close(); });
  const q = selector => ui.dialog.querySelector(selector);
  return { dom, doc, ui, calls, chosen, q, text: selector => (q(selector)?.textContent || '').trim(), style: el => dom.window.getComputedStyle(el),
    hidden: el => !el || el.hidden || !!el.closest('[hidden]'),
    // A fact's words, without the decorative harness badge's glyph.
    facts: () => Object.fromEntries([...ui.dialog.querySelectorAll('.spawn-preview-facts dt')].map(dt => {
      const dd = dt.nextElementSibling.cloneNode(true); for (const badge of dd.querySelectorAll('.runtime-badge')) badge.remove();
      return [dt.textContent, dd.textContent.trim()];
    })),
    // jsdom does not compute a shorthand holding var() (border:1px solid var(--border)), so frames are read from the rules.
    rule: (selector, prop) => [...doc.styleSheets].flatMap(sheet => [...sheet.cssRules]).filter(r => r.selectorText?.split(',').map(x => x.trim()).includes(selector)).map(r => r.style.getPropertyValue(prop)).filter(Boolean).at(-1) ?? '',
    async type(selector, value) { const el = q(selector); el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await settle(); } };
}

test('scoped layout: no chooser, the identity header names the soul and where it comes from, and offers Change soul', async t => {
  const u = mount(t, { layout: 'scoped' }); await settle();
  assert.equal(u.ui.layout, 'scoped'); assert.equal(u.ui.dialog.dataset.layout, 'scoped');
  assert.equal(u.hidden(u.q('.spawn-chooser')), true, 'no chooser column'); assert.equal(u.hidden(u.q('.spawn-preview')), false);
  assert.equal(u.q('.spawn-preview').getAttribute('aria-label'), 'Spawn preview');
  const title = u.q('h2#spawn-dialog-title');
  assert.equal(title.textContent, 'Spawn release-manager'); assert.equal(u.ui.dialog.getAttribute('aria-labelledby'), 'spawn-dialog-title');
  assert.equal(u.text('.spawn-context'), 'from agents · in northwind', 'a member soul: its repository');
  const mark = u.q('.spawn-dialog-head .identity-mark'); assert.ok(mark && !u.hidden(mark), 'the soul mark'); assert.equal(mark.textContent, 'R');
  const change = u.q('button.spawn-change-soul'); assert.equal(change.type, 'button'); assert.equal(change.textContent, 'Change soul'); assert.equal(u.hidden(change), false);
  assert.equal(u.style(change).color, 'var(--accent)'); assert.equal(u.style(change).borderStyle || u.style(change).border, u.style(change).borderStyle ? 'none' : '0');
  assert.equal(u.q('.close-act').getAttribute('aria-label'), 'Close spawn dialog');
  assert.equal(u.style(u.ui.dialog).width, '1000px');
  // A narrower window never clips it: the cap is the viewport less the modal's 24px padding, not 100%
  // (the modal's centring grid track grows to the dialog, so a percentage would not cap it).
  assert.equal(u.style(u.ui.dialog).maxWidth, 'calc(100vw - 48px)'); assert.equal(u.style(u.q('.spawn-columns')).gridTemplateColumns, '360px minmax(0,1fr)');
});

test('the origin subline: a package soul says its package and version; an external soul its origin', async t => {
  const u = mount(t, { layout: 'scoped', soul: packaged, previews: () => view(target, preview('preview-soul-unknown')) }); await settle();
  assert.equal(u.text('h2'), 'Spawn code-reviewer'); assert.equal(u.text('.spawn-context'), 'from package oats.engineering 1.3.0 · in northwind');
  assert.equal(soulOriginText({ soulKind: 'external', origin: 'github.com/acme/souls', repoName: 'external' }), 'from github.com/acme/souls');
  assert.equal(soulOriginText({ soulKind: 'member' }), '', 'nothing invented when the row carries no repository');
});

test('the default layout is the picker: chooser, "Spawn instance · in <workspace>", no Change soul, no preview column', async t => {
  const u = mount(t); await settle();
  assert.equal(u.ui.layout, 'picker'); assert.equal(u.hidden(u.q('.spawn-chooser')), false); assert.equal(u.hidden(u.q('.spawn-preview')), true);
  assert.equal(u.text('h2'), 'Spawn instance'); assert.equal(u.text('.spawn-context'), 'in northwind');
  assert.equal(u.hidden(u.q('.spawn-change-soul')), true); assert.equal(u.hidden(u.q('.spawn-dialog-head .identity-mark')), true);
  assert.equal(u.style(u.ui.dialog).width, '880px'); assert.equal(u.style(u.q('.spawn-columns')).gridTemplateColumns, '300px minmax(0,1fr)');
});

test('Change soul switches to the picker in place, keeps every typed value and focuses the selected row; choosing passes layout picker', async t => {
  const u = mount(t, { layout: 'scoped' }); await settle();
  await u.type('.fpurpose', 'api-v2'); await u.type('.ftask', 'Cut 3.2');
  const dialog = u.ui.dialog;
  u.q('.spawn-change-soul').click();
  assert.equal(u.ui.dialog, dialog, 'never reopened'); assert.equal(u.ui.layout, 'picker');
  assert.equal(u.hidden(u.q('.spawn-chooser')), false); assert.equal(u.hidden(u.q('.spawn-preview')), true); assert.equal(u.hidden(u.q('.spawn-change-soul')), true);
  assert.equal(u.text('h2'), 'Spawn instance'); assert.equal(u.text('.spawn-context'), 'in northwind');
  assert.equal(u.q('.fpurpose').value, 'api-v2'); assert.equal(u.q('.ftask').value, 'Cut 3.2');
  const pressed = u.q('.spawn-choice[aria-pressed=true]'); assert.equal(pressed.dataset.agent, 'release-manager'); assert.equal(u.doc.activeElement, pressed);
  [...dialog.querySelectorAll('.spawn-choice')].find(row => row.dataset.agent === 'support-triager').click();
  assert.equal(u.chosen.length, 1); assert.equal(u.chosen[0].candidate.name, 'support-triager');
  assert.deepEqual(u.chosen[0].draft, { query: '', purpose: 'api-v2', task: 'Cut 3.2', prefixed: true, layout: 'picker' });
  u.ui.setLayout('scoped'); assert.equal(u.ui.layout, 'scoped'); assert.equal(u.hidden(u.q('.spawn-chooser')), true); assert.equal(u.q('.fpurpose').value, 'api-v2');
});

test('Change soul with the selected row filtered out lands on the search', async t => {
  const u = mount(t, { layout: 'scoped' }); await settle();
  u.q('.spawn-soul-search').value = 'triager'; u.q('.spawn-soul-search').dispatchEvent(new u.dom.window.Event('input', { bubbles: true }));
  u.q('.spawn-change-soul').click();
  assert.equal(u.doc.activeElement, u.q('.spawn-soul-search'));
});

test('the preview column: a skeleton with aria-busy while reading, then the facts the kernel decided', async t => {
  const gate = deferred();
  const u = mount(t, { layout: 'scoped', previews: async () => { await gate.promise; return view(target, preview('preview-worktree-default')); } });
  await settle();
  const aside = u.q('.spawn-preview');
  assert.equal(aside.getAttribute('aria-busy'), 'true');
  assert.equal(aside.querySelectorAll('.spawn-preview-skeleton span').length, 8, '4 rows of blocks');
  assert.equal(u.style(aside.querySelector('.spawn-preview-skeleton span')).background, 'var(--tag-bg)');
  assert.equal(u.text('.spawn-preview-reading'), 'Reading the preview…'); assert.ok(u.q('.spawn-preview-reading').classList.contains('workspace-sr-only'));
  assert.equal(u.text('.spawn-preview-title'), 'What will be created', 'section titles stay while loading');
  assert.equal(u.text('.spawn-preview-note'), 'Resolved by the installed CLI. Spawn refuses if this changes before you confirm.');
  assert.equal(u.text('.fstatus'), 'Reading defaults…'); assert.equal(u.q('.fstatus').classList.contains('ok'), false);
  gate.resolve(); await settle(12);
  assert.equal(aside.getAttribute('aria-busy'), 'false'); assert.equal(aside.querySelector('.spawn-preview-skeleton'), null);
  // Board 6: the footer says the preview settled — a check in --ok (decoration, empty alt), then the words.
  assert.equal(u.text('.fstatus'), 'Preview ready'); assert.ok(u.q('.fstatus').classList.contains('ok'));
  assert.equal(u.rule('.spawn-footer .fstatus.ok::before', 'color'), 'var(--ok)');
  assert.match(u.rule('.spawn-footer .fstatus.ok::before', 'content'), /^"\\2713"\s*\/\s*""$/);
  const data = preview('preview-worktree-default');
  assert.deepEqual(u.facts(), { Name: data.instance, 'Works in': 'own worktree', Harness: 'Pi · native default', Team: 'engineering' });
  assert.ok(u.q('.spawn-preview-facts dd .mono'), 'the name in monospace');
  const harness = u.q('.spawn-preview-harness'); assert.equal(harness.querySelector('.runtime-badge').dataset.runtime, 'pi');
  assert.equal(harness.querySelector('.runtime-badge').getAttribute('aria-hidden'), 'true', 'decorative beside the words');
  assert.equal(u.style(harness.querySelector('.runtime-badge')).width, '16px');
  // The captured kernel's modules[] (projected as names and sources): Core capabilities and the Capabilities list.
  assert.equal(u.hidden(u.q('.spawn-preview-core')), false); assert.equal(u.q('.spawn-preview-core h3').textContent, 'Core capabilities');
  assert.deepEqual([...u.q('.spawn-preview-core').querySelectorAll('.spawn-core-row')].map(row => row.textContent), ['Knowledgeoats.okf 2.1.3', 'Messagingnone', 'Tasksnone']);
  assert.equal(u.hidden(u.q('.spawn-preview-caps')), false); assert.equal(u.q('.spawn-preview-caps h3').textContent, `Capabilities · ${data.modules.length}`);
  assert.deepEqual([...u.q('.spawn-preview-caps').querySelectorAll('.spawn-cap-row')].map(row => row.dataset.module), data.modules.map(m => m.name).sort());
  // A kernel without modules[]: neither section exists, not even a title.
  const bare = { ...data }; delete bare.modules;
  const without = mount(t, { layout: 'scoped', previews: () => view(target, bare) }); await settle(12);
  assert.equal(without.hidden(without.q('.spawn-preview-core')), true); assert.equal(without.q('.spawn-preview-core').childElementCount, 0);
  assert.equal(without.hidden(without.q('.spawn-preview-caps')), true); assert.doesNotMatch(without.q('.spawn-preview').textContent, /Core capabilities|Capabilities ·/);
  assert.equal(u.style(aside).background, 'var(--surface-2)'); assert.equal(u.rule('.spawn-preview', 'width'), '', 'sized by its 360px grid column');
});

test('the preview follows the latest choice: typing shows the skeleton again, then the new name', async t => {
  let n = 0;
  const u = mount(t, { layout: 'scoped', previews: body => { n++; return view(target, preview(body.choices.purpose ? 'preview-worktree-purpose' : 'preview-worktree-default')); } });
  await settle();
  assert.equal(u.facts().Name, preview('preview-worktree-default').instance);
  const el = u.q('.fpurpose'); el.value = 'api-v2'; el.dispatchEvent(new u.dom.window.Event('input', { bubbles: true }));
  assert.equal(u.q('.spawn-preview').getAttribute('aria-busy'), 'true', 'a read is due for the new choice');
  assert.ok(u.q('.spawn-preview-skeleton'));
  await settle(12);
  assert.equal(u.facts().Name, 'release-manager-api-v2'); assert.ok(n >= 2);
});

test('Harness says where the launch came from (0.30 launch), Team the default the kernel resolved (team model v2)', async t => {
  const featured = { ...structuredClone(CLI), features: [...CLI.features, 'launch-preference'] };
  const data = { ...preview('preview-worktree-default'), launch: { declared: { harness: 'pi', model: null }, effective: { harness: 'pi', model: null, launchConfig: null }, from: 'soul', at: 'souls/release-manager/soul.yaml#/launch', problem: null } };
  const u = mount(t, { layout: 'scoped', cli: featured, previews: () => view(target, data) }); await settle(12);
  assert.equal(u.facts().Harness, "Pi · the soul's preference");
  const teams = mount(t, { layout: 'scoped', cli: { ...structuredClone(v2('version')), ok: true, bin: '/fixture/oats' }, previews: () => view(target, v2('preview').result) }); await settle(12);
  assert.equal(teams.facts().Team, 'engineering (default)');
  assert.equal(teams.q('.spawn-preview-facts dd .muted').textContent, '(default)');
  const none = mount(t, { layout: 'scoped', cli: { ...structuredClone(v2('version')), ok: true, bin: '/fixture/oats' }, previews: () => view(target, { ...v2('preview').result, defaultTeam: null, teams: [] }) }); await settle(12);
  assert.equal(none.facts().Team, 'none'); assert.equal(none.q('.spawn-preview-facts dd .muted').textContent, 'none');
});

test('a kernel refusal replaces the facts with the footer\'s plain sentence; a name refusal stays at the Name field', async t => {
  const refusal = kernel('preview-clone-missing');
  const u = mount(t, { layout: 'scoped', previews: () => ({ spawnPreviewViewApi: 1, status: 'unavailable', target, data: null, reason: { code: refusal.error.code, message: refusal.error.message } }) });
  await settle(12);
  const said = spawnProblem({ code: refusal.error.code, message: refusal.error.message }, 'preview').text;
  assert.equal(u.text('.spawn-preview-failure'), said); assert.equal(u.text('.fstatus'), said, 'the same sentence as the footer');
  assert.equal(u.q('.fstatus').classList.contains('ok'), false, 'a refusal is never "ready"');
  assert.equal(u.style(u.q('.spawn-preview-failure')).color, 'var(--warn)');
  assert.equal(u.q('.spawn-preview-facts'), null); assert.equal(u.q('.spawn-preview').getAttribute('aria-busy'), 'false');
  const taken = kernel('preview-name-taken');
  const n = mount(t, { layout: 'scoped', previews: () => ({ spawnPreviewViewApi: 1, status: 'unavailable', target, data: null, reason: { code: taken.error.code, message: taken.error.message } }) });
  await settle(12);
  assert.equal(n.q('.spawn-preview-failure'), null, 'said once, next to the name'); assert.ok(n.q('.spawn-name-result').classList.contains('err'));
  assert.equal(n.text('.spawn-preview-empty'), 'No preview until the name is accepted.');
});

test('Core capabilities and Capabilities come from the preview\'s modules only', () => {
  const dom = new JSDOM('<body></body>'), doc = dom.window.document;
  assert.equal(composePreviewModules(doc, undefined), null); assert.equal(composePreviewModules(doc, null), null);
  const modules = preview('preview-worktree-purpose').modules.map(m => ({ name: m.name, layer: m.layer, from: m.from }));
  const { core, caps } = composePreviewModules(doc, modules);
  assert.equal(core[0].textContent, 'Core capabilities');
  assert.deepEqual([...core[1].querySelectorAll('.spawn-core-row')].map(row => [row.firstChild.textContent, row.lastChild.textContent, row.lastChild.className]),
    [['Knowledge', 'oats.okf 2.1.3', 'mono'], ['Messaging', 'none', 'muted'], ['Tasks', 'none', 'muted']]);
  assert.equal(caps[0].textContent, 'Capabilities · 5');
  assert.deepEqual([...caps[1].querySelectorAll('.spawn-cap-row')].map(row => [row.querySelector('.mono').textContent, row.querySelector('.spawn-cap-source').textContent]),
    [['nw-deploy', 'package nw.tools 0.4.0'], ['nw-house-style', 'agents · latest'], ['nw-release-tooling', 'agents · latest'], ['oats.core', 'package oats.framework 1.1.3'], ['oats.okf', 'package oats.okf 2.1.3']]);
  assert.equal(moduleSourceText({ kind: 'external' }), 'external'); assert.equal(moduleSourceText(undefined), '');
  assert.equal(worksInText('checkout'), 'shared checkout'); assert.equal(worksInText('attached'), "a parent's worktree"); assert.equal(worksInText('directory'), 'a folder');
  assert.equal(worksInText('workspace'), 'all member repos'); assert.equal(worksInText('other'), 'other');
  dom.window.close();
});

test('Relationship: the first option is Independent (value unrelated), as a tinted segmented control without a focus ring', async t => {
  const u = mount(t, { layout: 'scoped' }); await settle();
  const first = u.q('.spawn-seg.frelation label');
  assert.equal(first.querySelector('input').value, 'unrelated'); assert.equal(first.querySelector('span').textContent, 'Independent');
  assert.equal(u.text('.freldesc'), 'Independent — not linked to another instance.');
  const seg = u.q('.spawn-seg.frelation'), checked = u.q('.spawn-seg input:checked + span'), unchecked = u.q('.spawn-seg input:not(:checked) + span');
  const s = u.style(seg);
  assert.equal(s.background, 'var(--surface)'); assert.equal(u.rule('.spawn-seg', 'border'), '1px solid var(--border)'); assert.equal(s.padding, '2px'); assert.equal(s.borderRadius, '8px');
  const c = u.style(checked);
  assert.equal(c.background, 'var(--sel)'); assert.equal(c.color, 'var(--accent)'); assert.equal(c.fontWeight, '650'); assert.equal(c.boxShadow, ''); assert.equal(c.borderRadius, '6px'); assert.equal(c.height, '28px');
  const n = u.style(unchecked);
  assert.equal(n.background, ''); assert.equal(n.color, 'var(--muted)'); assert.equal(n.fontWeight, '500');
  // The CSS itself: keyboard focus is the tint plus a 1px accent edge; no outline anywhere on the segments.
  const rules = [...u.doc.styleSheets].flatMap(sheet => [...sheet.cssRules]).filter(rule => rule.selectorText?.includes('.spawn-seg input:focus-visible'));
  const onSpan = rules.find(rule => rule.selectorText.includes('+ span')); assert.ok(onSpan);
  assert.equal(onSpan.style.background, 'var(--sel)'); assert.equal(onSpan.style.boxShadow, 'inset 0 0 0 1px var(--accent)'); assert.equal(onSpan.style.outline, '');
  const onInput = rules.find(rule => rule.selectorText.startsWith('.spawn-dialog .spawn-seg input:focus-visible')); assert.ok(onInput, 'the dialog-wide ring is switched off for the segments');
  assert.equal(onInput.style.outline, 'none');
});

test('Name: one border on the wrapper that turns to the accent on focus, no ring; the inner input stays borderless', async t => {
  const u = mount(t, { layout: 'scoped' }); await settle();
  const wrapper = u.q('.spawn-name-input'), input = u.q('.fpurpose');
  assert.equal(u.rule('.spawn-name-input', 'border'), '1px solid var(--border)'); assert.equal(u.style(wrapper).height, '36px'); assert.equal(u.style(wrapper).borderRadius, '8px');
  input.focus(); assert.equal(u.doc.activeElement, input);
  assert.ok(wrapper.matches(':focus-within'));
  assert.equal(u.rule('.spawn-name-input:focus-within', 'border-color'), 'var(--accent)'); assert.equal(u.rule('.spawn-name-input:focus-within', 'box-shadow'), 'none');
  assert.equal(u.style(input).border, '0px' === u.style(input).border ? '0px' : u.style(input).border); assert.match(u.style(input).border, /^0/);
  assert.equal(u.style(input).outline, 'none'); assert.equal(u.style(input).boxShadow, 'none');
  const rules = [...u.doc.styleSheets].flatMap(sheet => [...sheet.cssRules]).filter(rule => rule.selectorText?.includes('.spawn-name-input'));
  assert.ok(!rules.some(rule => /focus-within/.test(rule.selectorText) && /3px/.test(rule.style.boxShadow)), 'no 3px ring for the name field');
  assert.ok(rules.some(rule => rule.selectorText.includes('.spawn-name-input input.field:focus-visible') && rule.style.outline === 'none' && rule.style.border === '0px'));
});

test('a remote soul: the preview column says the host decides, without a skeleton or a read', async t => {
  const remote = { ...member, name: 'builder', server: 'build', repoName: 'team', agentsRoot: '/srv/team/agents' };
  const u = mount(t, { layout: 'scoped', soul: remote, agents: [remote] }); await settle();
  assert.equal(u.text('.spawn-preview-empty'), 'Decided on build when it spawns.'); assert.equal(u.q('.spawn-preview').getAttribute('aria-busy'), 'false');
  assert.equal(u.calls.filter(c => c.path.startsWith('/api/workspace-spawn-preview')).length, 0);
});

// Every new fg/bg pairing this layout introduces, checked on the computed tokens like test/theme-contrast.test.mjs.
function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const c = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
for (const theme of ['light', 'solarized', 'dark']) test(`${theme}: the scoped dialog's header, preview column, tags and segments meet computed-token AA with no opacity`, async t => {
  const failing = kernel('preview-clone-missing');
  const u = mount(t, { layout: 'scoped', theme, cli: { ...structuredClone(v2('version')), ok: true, bin: '/fixture/oats' }, previews: () => view(target, v2('preview').result) }); await settle(12);
  // Put every element on screen: the facts and a module section, then a failure sentence beside them.
  const sections = composePreviewModules(u.doc, v2('preview').result.modules.map(m => ({ name: m.name, layer: m.layer, from: m.from })));
  u.q('.spawn-preview-core').hidden = false; u.q('.spawn-preview-core').append(...sections.core); u.q('.spawn-preview-caps').hidden = false; u.q('.spawn-preview-caps').append(...sections.caps);
  const failure = u.doc.createElement('p'); failure.className = 'spawn-preview-failure'; failure.textContent = spawnProblem({ code: failing.error.code, message: failing.error.message }).text; u.q('.spawn-preview-body').append(failure);
  const root = u.dom.window.getComputedStyle(u.doc.documentElement);
  for (const [selector, surfaceSelector, fg, bg] of [
    ['.spawn-dialog-head h2', '.spawn-dialog', 'fg', 'surface'], ['.spawn-context', '.spawn-dialog', 'muted', 'surface'], ['.spawn-change-soul', '.spawn-dialog', 'accent', 'surface'],
    ['.spawn-preview-title', '.spawn-preview', 'muted', 'surface-2'], ['.spawn-preview-facts dt', '.spawn-preview', 'muted', 'surface-2'], ['.spawn-preview-facts', '.spawn-preview', 'fg', 'surface-2'],
    ['.spawn-preview-facts dd .muted', '.spawn-preview', 'muted', 'surface-2'], ['.spawn-preview-failure', '.spawn-preview', 'warn', 'surface-2'], ['.spawn-preview-note', '.spawn-preview', 'muted', 'surface-2'],
    ['.spawn-core-box', '.spawn-core-box', 'fg', 'surface'], ['.spawn-core-layer', '.spawn-core-box', 'muted', 'surface'], ['.spawn-core-row .muted', '.spawn-core-box', 'muted', 'surface'],
    ['.spawn-cap-list', '.spawn-preview', 'fg', 'surface-2'], ['.spawn-cap-source', '.spawn-cap-source', 'muted', 'tag-bg'],
    ['.spawn-seg input:checked + span', '.spawn-seg input:checked + span', 'accent', 'sel'], ['.spawn-seg input:not(:checked) + span', '.spawn-seg', 'muted', 'surface'],
  ]) {
    const pick = sel => u.ui.dialog.matches(sel) ? u.ui.dialog : u.q(sel);
    const element = pick(selector), surface = pick(surfaceSelector); assert.ok(element && surface, selector);
    assert.equal(u.style(element).color, `var(--${fg})`, selector);
    assert.match(u.style(surface).background || u.style(surface).backgroundColor, new RegExp(`var\\(--${bg}\\)`), surfaceSelector);
    const f = luminance(root.getPropertyValue(`--${fg}`).trim()), b = luminance(root.getPropertyValue(`--${bg}`).trim());
    assert.ok((Math.max(f, b) + .05) / (Math.min(f, b) + .05) >= 4.5, `${theme} ${selector}: ${fg} on ${bg}`);
    for (let parent = element; parent; parent = parent.parentElement) assert.equal(u.style(parent).opacity, '1', selector);
  }
  // The skeleton paints a token, no text: nothing to read, nothing to contrast.
  assert.match(spawnDialogCSS, /\.spawn-preview-skeleton span \{[^}]*background:var\(--tag-bg\)/);
  assert.doesNotMatch(spawnDialogCSS, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'tokens only');
});

test('roster polls (sync) with unchanged facts never supersede the read in flight; a changed fact re-reads under latest intent', async t => {
  // A preview slower than the poll: each read waits on its own gate.
  const gates = [], cli = structuredClone(CLI);
  const u = mount(t, { layout: 'scoped', cli, previews: async () => { const gate = deferred(); gates.push(gate); await gate.promise; return view(target, preview(['preview-worktree-default', 'preview-name', 'preview-worktree-purpose'][gates.length - 1])); } });
  await settle();
  const reads = () => u.calls.filter(c => c.path.startsWith('/api/workspace-spawn-preview')).length;
  assert.equal(reads(), 1); assert.equal(u.q('.spawn-preview').getAttribute('aria-busy'), 'true');
  for (let i = 0; i < 3; i++) { u.ui.sync(); await settle(); } // three polls while the read is in flight
  assert.equal(reads(), 1, 'a routine poll does not re-read');
  gates[0].resolve(); await settle(12);
  assert.equal(reads(), 1, 'nor restart the read when it settles'); assert.equal(u.q('.spawn-preview').getAttribute('aria-busy'), 'false');
  assert.equal(u.facts().Name, preview('preview-worktree-default').instance, 'the read settled and its facts are shown');
  u.ui.sync(); await settle(); assert.equal(reads(), 1, 'a settled preview stays put under polls');
  // A fact the preview depends on changes (the CLI's features): the next poll reads again.
  cli.features = [...cli.features, 'a-new-feature'];
  u.ui.sync(); await settle();
  assert.equal(reads(), 2);
  assert.equal(u.facts().Name, 'release-manager-1', 'the same choices: the last facts stay while it reads (no flash)');
  // It changes again while that read is in flight: latest intent wins, the superseded answer is never shown.
  cli.features = [...cli.features, 'another'];
  u.ui.sync(); await settle();
  gates[1].resolve(); await settle(12);
  assert.equal(reads(), 3, 'the superseded read is followed by one for the latest facts');
  assert.equal(u.facts().Name, 'release-manager-1', 'the superseded answer (api-gateway) is never shown');
  gates[2].resolve(); await settle(12);
  assert.equal(u.facts().Name, 'release-manager-api-v2', 'the latest read is shown'); assert.equal(reads(), 3);
});
