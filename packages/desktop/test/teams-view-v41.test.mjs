// The Workspace › Teams page after the v4.1 board (design/v4.1/Teams.dc.html): the page's own
// fg/bg pairings hold computed AA in the three themes (the same approach as theme-contrast.test.mjs:
// the declared token pair on the element, then its effective contrast), and the shared control rules
// (a selected state is the brand tint; no ring on pointer focus; one border per field).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createComputerTeams, computerTeamsCSS } from '../renderer/computer-teams.mjs';
import { identityCSS } from '../renderer/identity-marks.mjs';
import { teamsData } from '../deployment-data.mjs';

const css = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8');
const capture = name => JSON.parse(readFileSync(new URL(`./fixtures/team-model-v2/${name}.json`, import.meta.url), 'utf8'));
const tokens = block => new Map([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6}(?:[0-9a-f]{2})?)\b/gi)].map(m => [m[1], m[2].toLowerCase()]));
const dark = tokens(css.match(/:root, \[data-theme="dark"\] \{([\s\S]*?)\n\}/)?.[1] || '');
const themed = name => { const palette = new Map(dark); for (const [k, v] of tokens(css.match(new RegExp(`\\[data-theme="${name}"\\] \\{([\\s\\S]*?)\\n\\}`))?.[1] || '')) palette.set(k, v); return palette; };
const palettes = [['light', themed('light')], ['solarized', themed('solarized')], ['dark', dark]];
const channels = hex => { assert.match(hex, /^#[0-9a-f]{6}$/i, 'opaque'); return hex.slice(1).match(/../g).map(v => parseInt(v, 16)); };
const luminance = rgb => { const [r, g, b] = rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (fg, bg) => { const a = luminance(fg), b = luminance(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

/** The real K1 capture (teams-after), with engineering given an id so a mapped shared team has members. */
function document() {
  const d = teamsData(capture('teams-after'), '/fixture/base/northwind-workspace');
  d.teams.find(t => t.label === 'engineering').team = 'engineering:northwind.aweb.ai'; d.problems = d.problems.filter(p => p.label !== 'engineering');
  return d;
}
const roster = [{ instance: 'rm-1', agent: 'release-manager', agentsRoot: '/a', identity: { team: 'mine:juan.aweb.ai' }, running: true },
  { instance: 'e-1', agent: 'engineer', agentsRoot: '/a', identity: { team: 'engineering:northwind.aweb.ai' }, running: true }];

async function mount(t, theme) {
  const dom = new JSDOM(`<!doctype html><html data-theme="${theme}"><body><main class="oats-view"><div class="workspace-discovery" data-tab="teams"></div></main></body></html>`, { pretendToBeVisual: true });
  const doc = dom.window.document;
  for (const source of [css, identityCSS, computerTeamsCSS]) { const style = doc.createElement('style'); style.textContent = source; doc.head.append(style); }
  const page = createComputerTeams(doc, { request: async () => document(), instances: () => roster });
  doc.querySelector('.workspace-discovery').append(page.element);
  t.after(() => { page.dispose(); dom.window.close(); });
  await tick();
  return { dom, doc, page };
}

for (const [name, palette] of palettes) test(`${name}: the Teams page's text sits on its declared surfaces at AA (pill and tile accent on sel; muted and fg on surface; the empty card on bg)`, async t => {
  const u = await mount(t, name);
  const style = el => u.dom.window.getComputedStyle(el);
  const painted = el => style(el).background.replace(/^.*(var\(--[\w-]+\)).*$/, '$1');
  const mine = u.doc.querySelector('[data-team="mine"]'), eng = u.doc.querySelector('[data-team="engineering"]');
  const cases = [
    // [element, its painted surface, fg token, bg token]
    [mine.querySelector('.ct-pill'), mine.querySelector('.ct-pill'), 'accent', 'sel'],
    [mine.querySelector('.ct-tile.default'), mine.querySelector('.ct-tile.default'), 'accent', 'sel'],
    [eng.querySelector('.ct-tile'), eng.querySelector('.ct-tile'), 'chip-fg', 'chip-bg'],
    [mine.querySelector('.ct-label'), mine, 'fg', 'surface'], [mine.querySelector('.ct-desc'), mine, 'fg', 'surface'],
    [mine.querySelector('.ct-facts'), mine, 'muted', 'surface'], [mine.querySelector('.ct-id'), mine, 'fg', 'surface'],
    [u.doc.querySelector('[data-team="global"] .ct-id.none'), u.doc.querySelector('[data-team="global"]'), 'warn', 'surface'],
    [mine.querySelector('.ct-join'), mine, 'fg', 'surface'], [u.doc.querySelector('[data-team="marketing"] .ct-join.none'), u.doc.querySelector('[data-team="marketing"]'), 'muted', 'surface'],
    [mine.querySelector('.ct-count'), mine, 'fg', 'surface'], [mine.querySelector('.ct-note'), mine, 'muted', 'surface'],
    [mine.querySelector('.ct-why'), mine, 'muted', 'surface'], [u.doc.querySelector('[data-team="global"] .ct-warn'), u.doc.querySelector('[data-team="global"]'), 'warn', 'surface'],
    [u.doc.querySelector('.ct-scope'), u.doc.querySelector('.ct-scope'), 'muted', 'surface'],
    [u.doc.querySelector('button.ct-add'), u.doc.querySelector('button.ct-add'), 'fg', 'surface'],
    [eng.querySelector('button.ct-act:not(:disabled)'), eng.querySelector('button.ct-act:not(:disabled)'), 'fg', 'surface'],
    [u.doc.querySelector('[data-team="global"] button.ct-act:disabled'), u.doc.querySelector('[data-team="global"] button.ct-act:disabled'), 'muted', 'surface'],
  ];
  for (const [el, surface, fg, bg] of cases) {
    assert.ok(el && surface, `${fg} on ${bg}: rendered`);
    assert.equal(style(el).color, `var(--${fg})`, `${fg} on ${bg}: declared`);
    assert.equal(painted(surface), `var(--${bg})`, `${fg} on ${bg}: painted`);
    assert.ok(contrast(channels(palette.get(fg)), channels(palette.get(bg))) >= 4.5, `${name}: --${fg} on --${bg}`);
    for (let parent = el; parent; parent = parent.parentElement) assert.equal(style(parent).opacity, '1', 'no opacity compositing over text');
  }
  // The section titles, the lead and the empty dashed card are painted on the page's --bg; the link is accent on bg.
  for (const [fg, bg] of [['muted', 'bg'], ['fg', 'bg'], ['accent', 'bg'], ['accent', 'surface'], ['fg', 'surface-2']]) {
    assert.ok(contrast(channels(palette.get(fg)), channels(palette.get(bg))) >= 4.5, `${name}: --${fg} on --${bg}`);
  }
  for (const sel of ['.ct-section-title', '.ct-lead']) assert.equal(style(u.doc.querySelector(sel)).color, 'var(--muted)', sel);
  assert.equal(style(u.doc.querySelector('.ct-title')).color, 'var(--fg)');
  assert.equal(u.doc.querySelector('[data-team="mine"] .ct-marks .identity-mark').dataset.avatarColor.length > 0, true, 'a soul tone pair, never a raw colour');
});

test('the board\'s measures and the shared control rules, in the page\'s own CSS (tokens only)', () => {
  const rule = selector => { const m = computerTeamsCSS.match(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm')); assert.ok(m, selector); return m[1]; };
  assert.doesNotMatch(computerTeamsCSS, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|opacity/i, 'no raw colours, no opacity');
  assert.match(rule('.workspace-discovery[data-tab=teams] > :has(> .computer-teams)'), /max-width:1120px/, 'the board is one wide column (the box holding the page)');
  assert.match(rule('.computer-teams .ct-title'), /font-size:17px; font-weight:700/); assert.match(rule('.computer-teams .ct-lead'), /font-size:12.5px/);
  assert.match(rule('.oats-view .computer-teams button.ct-add'), /height:32px;.*border-radius:7px; font-size:12.5px/);
  // The sections stack at the page's gap: the second as far below the first as the first below the head.
  assert.match(rule('.computer-teams'), /gap:18px/); assert.match(rule('.computer-teams .ct-body'), /display:flex; flex-direction:column; gap:18px/);
  assert.doesNotMatch(computerTeamsCSS, /\.ct-section \+ \.ct-section/, 'no tighter margin of its own');
  assert.match(rule('.computer-teams .ct-section-title'), /font-size:10.5px; font-weight:650; letter-spacing:.065em; text-transform:uppercase/);
  assert.match(rule('.computer-teams .ct-scope'), /height:20px;.*border:1px solid var\(--border\); border-radius:5px; background:var\(--surface\); color:var\(--muted\); font-size:10.5px; font-weight:600/);
  assert.match(rule('.computer-teams .ct-scope.dashed'), /border:1px dashed var\(--tree-line\)/);
  assert.match(rule('.computer-teams .ct-card'), /grid-template-columns:44px minmax\(0,1fr\) 240px; column-gap:16px;.*padding:16px 18px; background:var\(--surface\); border:1px solid var\(--border\); border-radius:10px/);
  assert.match(rule('.computer-teams .ct-tile'), /width:40px; height:40px; border-radius:10px; background:var\(--chip-bg\); color:var\(--chip-fg\)/);
  assert.match(rule('.computer-teams .ct-tile.default'), /background:var\(--sel\); color:var\(--accent\)/, 'rule 1: the selected state is the brand tint');
  assert.match(rule('.computer-teams .ct-pill'), /border-radius:10px; background:var\(--sel\); color:var\(--accent\); font-size:10.5px; font-weight:650/);
  assert.match(rule('.computer-teams .ct-label'), /font-size:14.5px; font-weight:650/);
  assert.match(rule('.computer-teams .ct-marks .identity-mark'), /width:22px; height:22px;.*border:1.5px solid var\(--surface\)/);
  assert.match(rule('.computer-teams .ct-marks .identity-mark + .identity-mark'), /margin-left:-6px/);
  assert.match(rule('.computer-teams .ct-empty'), /padding:16px 18px; border:1px dashed var\(--tree-line\); border-radius:10px; color:var\(--muted\); font-size:12.5px/);
  assert.match(rule('.oats-view .computer-teams button.ct-link'), /border:0;.*background:none; color:var\(--accent\)/);
  // Rule 2 is the shell's (theme.css :focus-visible): the page adds no focus rule of its own for its buttons.
  assert.doesNotMatch(computerTeamsCSS, /button[^{]*:focus|outline:2px|outline-offset/);
  // Rule 3: one border per field, the wrapper's; accent on focus-within; the input has none in every state.
  assert.match(rule('.computer-teams .ct-field'), /border:1px solid var\(--border\)/); assert.match(rule('.computer-teams .ct-field:focus-within'), /border-color:var\(--accent\)/);
  assert.match(rule('.oats-view .computer-teams .ct-field input'), /border:0; outline:none/);
  assert.match(rule('.oats-view .computer-teams .ct-field input:focus, .oats-view .computer-teams .ct-field input:focus-visible'), /border:0; outline:none/);
});

test('the copy is the board\'s; the roster shows only matches, and nothing without a roster', async t => {
  const u = await mount(t, 'light');
  assert.equal(u.doc.querySelector('.ct-lead').textContent, 'Who your agents can message. A team never adds capabilities or restricts what a soul can do.');
  assert.deepEqual([...u.doc.querySelectorAll('.ct-section-title')].map(h => h.textContent), ['Shared with the workspace', 'Only on this computer']);
  assert.deepEqual([...u.doc.querySelectorAll('.ct-scope')].map(h => h.textContent), ['Shared · Git', 'Not shared']);
  assert.deepEqual([...u.doc.querySelectorAll('.ct-card')].map(c => [c.dataset.team, c.querySelector('.ct-count')?.textContent ?? null, c.querySelector('.ct-note')?.textContent ?? null]),
    [['engineering', '1 instance in it', null], ['global', null, null], ['marketing', null, null], ['mine', '1 instance in it', 'every instance joins its default team']]);
  const dom = new JSDOM('<!doctype html><body><main class="oats-view"></main></body>'), doc = dom.window.document;
  const bare = createComputerTeams(doc, { request: async () => document() }); doc.querySelector('main').append(bare.element);
  t.after(() => { bare.dispose(); dom.window.close(); }); await tick();
  assert.equal(doc.querySelector('.ct-inst'), null, 'no roster option: nothing about instances');
  assert.doesNotMatch(doc.querySelector('main').textContent, /instance/i);
});
