// Capabilities › Workspace owned split by repository (human, 2026-10-07): repository groups headed
// as on the Souls tab, and single-choice group pills in place of the Team and Repo dropdowns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as catalog from '../renderer/workspace-catalog.mjs';
import { groupHeading, groupHeadingCSS } from '../renderer/group-heading.mjs';

const { catalogCSS, renderRepoPills, repoChoices, groupCapabilities, filterCapabilities, renderCapabilitySections, capabilitySections, memberNames } = catalog;
const themeCSS = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8');
const spawnSource = readFileSync(new URL('../renderer/views/spawn.mjs', import.meta.url), 'utf8');

const HOST = 'github.com/acme/agents';
const STATUS = { workspace: { key: HOST }, members: [
  { key: HOST, name: 'agents', status: 'confirmed' }, { key: 'github.com/acme/zeta', name: 'zeta', status: 'confirmed' }, { key: 'github.com/acme/alpha', name: 'alpha', status: 'confirmed' }] };
const row = (name, kind, repoKey, extra = {}) => ({ name, kind, repoKey, origin: `${kind} ${repoKey}`, ...extra });
const ROWS = [
  row('z-one', 'member', 'github.com/acme/zeta'), row('ext-a', 'external', 'github.com/other/tools'),
  row('a-one', 'member', 'github.com/acme/alpha'), row('a-two', 'member', 'github.com/acme/alpha'),
  row('h-one', 'member', HOST), row('ext-b', 'external', 'github.com/third/kit'),
  { name: 'pkg', kind: 'package', package: 'p', version: '1.0.0', origin: 'package p v1.0.0' },
];

function mount(t) {
  const dom = new JSDOM('<!doctype html><html data-theme="light"><body><main class="oats-view"><div class="pills"></div><div class="sections"></div></main></body></html>');
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  for (const source of [themeCSS, catalogCSS]) { const style = doc.createElement('style'); style.textContent = source; doc.head.append(style); }
  return { dom, doc, css: el => dom.window.getComputedStyle(el), $: sel => doc.querySelector(sel), $$: sel => [...doc.querySelectorAll(sel)] };
}
const key = (u, el, name) => el.dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

test('repository groups follow the Souls tab order: the host first, then members by name, one "external" group last', () => {
  const names = memberNames(STATUS);
  const groups = groupCapabilities(capabilitySections(ROWS).workspace, names, HOST);
  assert.deepEqual(groups.map(g => [g.key, g.name, g.note, g.rows.map(r => r.name)]), [
    [`member:${HOST}`, 'agents', 'member repo · host', ['h-one']],
    ['member:github.com/acme/alpha', 'alpha', 'member repo', ['a-one', 'a-two']],
    ['member:github.com/acme/zeta', 'zeta', 'member repo', ['z-one']],
    ['external', 'external', 'not in a member repo', ['ext-a', 'ext-b']],
  ]);
  // Without a reported host nothing is called the host.
  assert.deepEqual(groupCapabilities(capabilitySections(ROWS).workspace, names, null).map(g => g.name), ['agents', 'alpha', 'zeta', 'external']);
  assert.ok(groupCapabilities(capabilitySections(ROWS).workspace, names, null).every(g => !g.note.includes('host')));
  assert.deepEqual(repoChoices(ROWS, names, HOST).map(c => [c.label, c.count]), [['agents', 1], ['alpha', 2], ['zeta', 1], ['external', 2]], 'never a package');
  assert.deepEqual(filterCapabilities(ROWS, { repo: 'external' }, names, HOST).map(r => r.name), ['ext-a', 'ext-b']);
});

test('the dead Team filter is gone: no team choice, parameter, dropdown or CSS', () => {
  assert.equal(catalog.renderFilters, undefined); assert.equal(catalog.filterChoices, undefined);
  const withTeam = ROWS.map(r => ({ ...r, team: 'x' }));
  assert.equal(filterCapabilities(withTeam, { team: 'nope' }).length, withTeam.length, 'a team is not a filter');
  assert.doesNotMatch(catalogCSS, /catalog-select|catalog-clear|Filter by/);
});

test('the headings: the Souls tab grammar (icon, mono name, "member repo · host · N capabilities"), shared code and CSS', t => {
  const u = mount(t);
  renderCapabilitySections(u.$('.sections'), { sections: capabilitySections(ROWS), shown: capabilitySections(ROWS).workspace, filterHost: null, privateListed: false, status: STATUS, instances: [], onOpen() {} });
  const heads = u.$$('[data-section=workspace] .catalog-group');
  assert.deepEqual(heads.map(h => [h.tagName, h.querySelector('svg').getAttribute('data-icon'), h.querySelector('.souls-group-name').textContent, h.querySelector('.souls-group-note').textContent]), [
    ['H3', 'repo', 'agents', 'member repo · host · 1 capability'], ['H3', 'repo', 'alpha', 'member repo · 2 capabilities'],
    ['H3', 'repo', 'zeta', 'member repo · 1 capability'], ['H3', 'external', 'external', 'not in a member repo · 2 capabilities']]);
  assert.ok(heads.every(h => h.classList.contains('souls-group-title')));
  assert.match(groupHeadingCSS, /\.souls-group-name \{ font:650 13px var\(--mono,monospace\)/, 'the name in monospace');
  assert.equal(heads[3].querySelector('.souls-group-name').classList.contains('plain'), true, '"external" is a word, not a repository name');
  assert.equal(u.css(heads[0].querySelector('.souls-group-note')).color, 'var(--muted)');
  // The Souls tab builds its headings with the same helper and CSS.
  assert.match(spawnSource, /groupHeading\(doc, \{ icon: g\.icon, name: g\.name, note: g\.qualifier/);
  assert.match(spawnSource, /\$\{groupHeadingCSS\}/); assert.doesNotMatch(spawnSource, /\.souls-group-title \{ display:flex/);
  assert.ok(catalogCSS.includes(groupHeadingCSS));
  const h = groupHeading(u.doc, { icon: 'users', name: 'core-team', note: '2 souls', mono: false });
  assert.equal(h.tagName, 'H2'); assert.equal(h.textContent, 'core-team2 souls');
});

test('pills: All first, one per repository, single choice with the counts; "N of M shown" only when narrowed; none without choices', t => {
  const u = mount(t);
  const host = u.$('.pills'), chosen = [];
  const repos = repoChoices(ROWS, memberNames(STATUS), HOST);
  renderRepoPills(host, { repos, value: null, total: 6, onChange: v => chosen.push(v) });
  const group = host.querySelector('.catalog-pills');
  assert.equal(group.getAttribute('role'), 'group'); assert.equal(group.getAttribute('aria-label'), 'Show capabilities from');
  const pills = () => [...host.querySelectorAll('.catalog-pills button')];
  assert.deepEqual(pills().map(b => [b.textContent, b.getAttribute('aria-pressed'), b.type]), [
    ['All 6', 'true', 'button'], ['agents 1', 'false', 'button'], ['alpha 2', 'false', 'button'], ['zeta 1', 'false', 'button'], ['external 2', 'false', 'button']]);
  assert.ok(pills().every(b => b.querySelector('.capability-nav-count')), 'counts in the nav count style');
  assert.equal(host.querySelector('.catalog-shown'), null);
  pills()[2].click(); pills()[0].click();
  assert.deepEqual(chosen, ['member:github.com/acme/alpha'], 'the pressed pill is not chosen again');
  renderRepoPills(host, { repos, value: 'member:github.com/acme/alpha', total: 6, shown: 2, narrowed: true, onChange() {} });
  assert.deepEqual(pills().map(b => b.getAttribute('aria-pressed')), ['false', 'false', 'true', 'false', 'false']);
  assert.equal(host.querySelector('.catalog-shown').textContent, '2 of 6 shown');
  assert.equal(host.querySelector('.catalog-shown').closest('[role=group]'), null, 'the count is not a member of the button group');
  // One repository: All and that repository. None: nothing at all.
  renderRepoPills(host, { repos: repos.slice(0, 1), value: null, total: 1, onChange() {} });
  assert.deepEqual(pills().map(b => b.textContent), ['All 1', 'agents 1']);
  renderRepoPills(host, { repos: [], value: null, total: 0, onChange() {} });
  assert.equal(host.childElementCount, 0);
});

test('pills keyboard: one tab stop (the pressed pill); Arrow keys move along and wrap, Home/End go to the ends, nothing is chosen by moving', t => {
  const u = mount(t);
  const host = u.$('.pills'), chosen = [];
  renderRepoPills(host, { repos: repoChoices(ROWS, memberNames(STATUS), HOST), value: 'member:github.com/acme/zeta', total: 6, onChange: v => chosen.push(v) });
  const pills = [...host.querySelectorAll('button')];
  assert.deepEqual(pills.map(b => b.tabIndex), [-1, -1, -1, 0, -1], 'the pressed pill is the tab stop');
  pills[3].focus();
  key(u, pills[3], 'ArrowRight'); assert.equal(u.doc.activeElement, pills[4]);
  key(u, pills[4], 'ArrowRight'); assert.equal(u.doc.activeElement, pills[0], 'wraps');
  key(u, pills[0], 'ArrowLeft'); assert.equal(u.doc.activeElement, pills[4]);
  key(u, pills[4], 'Home'); assert.equal(u.doc.activeElement, pills[0]);
  key(u, pills[0], 'End'); assert.equal(u.doc.activeElement, pills[4]);
  key(u, pills[4], 'ArrowUp'); assert.equal(u.doc.activeElement, pills[3]);
  key(u, pills[3], 'ArrowDown'); assert.equal(u.doc.activeElement, pills[4]);
  assert.deepEqual(pills.map(b => b.tabIndex), [-1, -1, -1, -1, 0], 'the focused pill is the one tab stop');
  assert.deepEqual(chosen, [], 'moving is not choosing');
  const other = new u.dom.window.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
  pills[4].dispatchEvent(other); assert.equal(other.defaultPrevented, false, 'other keys pass through');
  const modified = new u.dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true });
  pills[4].dispatchEvent(modified); assert.equal(modified.defaultPrevented, false); assert.equal(u.doc.activeElement, pills[4]);
});

test('pills wrap as chips: their own frame, the brand tint when pressed, never overflowing the section head', t => {
  const u = mount(t);
  renderRepoPills(u.$('.pills'), { repos: repoChoices(ROWS, memberNames(STATUS), HOST), value: 'external', total: 6, onChange() {} });
  assert.equal(u.css(u.$('.catalog-pills')).flexWrap, 'wrap'); assert.equal(u.css(u.$('.catalog-filters')).flexWrap, 'wrap');
  assert.equal(u.css(u.$('.catalog-pills')).maxWidth, '100%');
  const [rest, , , , pressed] = u.$$('.catalog-pills button');
  assert.equal(u.css(rest).color, 'var(--muted)'); assert.equal(u.css(rest).background, 'var(--surface)');
  assert.equal(u.css(pressed).color, 'var(--accent)'); assert.equal(u.css(pressed).background, 'var(--sel)'); assert.equal(u.css(pressed).fontWeight, '650');
  assert.match(catalogCSS, /\.catalog-pills button \{[^}]*border:1px solid var\(--border\)/, 'each pill its own frame');
  assert.doesNotMatch(catalogCSS, /999px/, 'chips, not round pills');
  assert.match(catalogCSS, /\.catalog-pill-name \{[^}]*text-overflow:ellipsis/, 'a long repository name ellipsizes inside its pill');
});
