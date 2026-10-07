// Capabilities view row cards (design board v4.1/Capabilities): one button per
// capability, a one-line description, used-by words from the roster and the
// kernel's defaults, a segmented section jump, and AA tile/chip tints in every theme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { identityCSS } from '../renderer/identity-marks.mjs';
import { catalogCSS, renderCapabilities, renderCapabilitySections, capabilitySections, syncCapabilityNav } from '../renderer/workspace-catalog.mjs';

const themeCSS = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8');

// Same palette reading as test/theme-contrast.test.mjs: hex tokens per theme block.
function tokens(block) {
  return new Map([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6}(?:[0-9a-f]{2})?)\b/gi)].map(m => [m[1], m[2].toLowerCase()]));
}
const dark = tokens(themeCSS.match(/:root, \[data-theme="dark"\] \{([\s\S]*?)\n\}/)?.[1] || '');
const overlay = name => { const out = new Map(dark); for (const [k, v] of tokens(themeCSS.match(new RegExp(`\\[data-theme="${name}"\\] \\{([\\s\\S]*?)\\n\\}`))?.[1] || '')) out.set(k, v); return out; };
const palettes = [['light', overlay('light')], ['solarized', overlay('solarized')], ['dark', dark]];
const channels = hex => { assert.match(hex, /^#[0-9a-f]{6}$/i, 'opaque'); return hex.slice(1).match(/../g).map(v => parseInt(v, 16)); };
const luminance = rgb => { const c = rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const ROWS = [
  { name: 'oats.okf', kind: 'package', package: 'oats.okf', version: '2.1.3', layer: 'knowledge', description: 'The OKF knowledge slot for working souls: consult the accepted bases remotely, keep the mirror pinned.', origin: 'package oats.okf v2.1.3' },
  { name: 'oats.aweb', kind: 'member', repoKey: 'github.com/awebai/oats', layer: 'messaging', description: 'Messaging layer via aweb: per-instance team identities.', origin: 'member github.com/awebai/oats' },
  { name: 'oats.jira', kind: 'external', repoKey: 'github.com/acme/tools', layer: 'tasks', description: 'Tasks layer via Jira.', origin: 'external github.com/acme/tools' },
  { name: 'oats.authoring', kind: 'member', repoKey: 'github.com/awebai/oats', layer: null, description: 'Additive framework-authoring guidance for capability packages, agent skills, and souls.', origin: 'member github.com/awebai/oats' },
  { name: 'oats.core', kind: 'package', package: 'oats.framework', version: '1.4.0', layer: null, description: 'How to operate inside OATS.', origin: 'package oats.framework v1.4.0' },
  { name: 'nw-quiet', kind: 'member', repoKey: 'github.com/awebai/oats', layer: null, origin: 'member github.com/awebai/oats' },
];
const STATUS = {
  members: [{ key: 'github.com/awebai/oats', name: 'oats', status: 'confirmed' }],
  defaults: { slots: { knowledge: { name: 'oats.okf', from: 'package' }, messaging: 'none', tasks: null },
    capabilities: [{ name: 'oats.core', from: 'package', off: false }, { name: 'oats.authoring', from: 'here', off: true }] },
};
const INSTANCES = [
  { agent: 'release-manager', agentsRoot: '/w/agents', modules: [{ name: 'oats.aweb' }, { name: 'oats.authoring' }, { name: 'oats.okf' }] },
  { agent: 'campaign-writer', agentsRoot: '/w/agents', modules: { 'oats.aweb': { status: 'current' } } },
  { agent: 'reviewer', agentsRoot: '/w/agents', modules: [{ name: 'oats.aweb' }] },
  { agent: 'planner', agentsRoot: '/w/agents', modules: [{ name: 'oats.aweb' }] },
  { agent: 'release-manager', agentsRoot: '/w/agents', modules: [{ name: 'oats.aweb' }] },
];

function mount(t, theme = 'light') {
  const dom = new JSDOM(`<!doctype html><html data-theme="${theme}"><body><main class="oats-view"><div class="caps"></div><div class="sections"></div></main></body></html>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  for (const source of [themeCSS, identityCSS, catalogCSS]) { const style = doc.createElement('style'); style.textContent = source; doc.head.append(style); }
  return { dom, doc, css: el => dom.window.getComputedStyle(el), $: sel => doc.querySelector(sel), $$: sel => [...doc.querySelectorAll(sel)] };
}
const key = (u, el, name) => el.dispatchEvent(new u.dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

test('each capability is one row card: header, 58px grid, tile + name/kind + one-line description, boxed source, used by, chevron', t => {
  const u = mount(t);
  renderCapabilities(u.$('.caps'), { rows: ROWS, status: STATUS, instances: INSTANCES, onOpen() {} });
  const list = u.$('.catalog-table');
  assert.equal(u.css(list).display, 'flex'); assert.equal(u.css(list).gap, '6px');
  assert.doesNotMatch(catalogCSS, /\.catalog-table \{[^}]*(border|background)/, 'the list itself has no frame or surface: each card does');
  const head = u.$('.catalog-head');
  assert.deepEqual([...head.children].map(el => el.textContent), ['', 'Capability', 'Source', 'Used by', '']);
  assert.equal(u.css(head).textTransform, 'uppercase'); assert.equal(u.css(head).fontSize, '10.5px'); assert.equal(u.css(head).letterSpacing, '0.065em');
  assert.equal(u.css(head).gridTemplateColumns, '44px minmax(0,1fr) 190px 120px 24px');
  const rows = u.$$('.catalog-row');
  assert.equal(rows.length, ROWS.length);
  for (const row of rows) {
    assert.equal(row.tagName, 'BUTTON'); assert.equal(row.type, 'button');
    assert.equal(u.css(row).height, '58px'); assert.equal(u.css(row).borderRadius, '10px');
    assert.equal(u.css(row).background, 'var(--surface)'); assert.equal(u.css(row).color, 'var(--fg)');
    assert.equal(u.css(row).gridTemplateColumns, '44px minmax(0,1fr) 190px 120px 24px'); assert.equal(u.css(row).columnGap, '14px'); assert.equal(u.css(row).padding, '0px 16px');
    assert.deepEqual([...row.children].map(el => el.className.baseVal ?? el.className), ['catalog-tile', 'catalog-cap', 'catalog-source', 'catalog-used', 'shell-icon catalog-chevron']);
    assert.equal(row.querySelectorAll('button, a, input, select, [tabindex]').length, 0, 'no nested interactive element');
    const tile = row.querySelector('.catalog-tile');
    assert.equal(u.css(tile).width, '32px'); assert.equal(u.css(tile).borderRadius, '8px'); assert.ok(tile.querySelector('svg'));
    assert.ok(row.querySelector('.catalog-source .source-chip.boxed'), 'the boxed source chip');
    assert.equal(row.querySelector('.catalog-chevron').tagName.toLowerCase(), 'svg');
  }
  const okf = u.$('.catalog-row[data-capability="oats.okf"]');
  assert.equal(okf.querySelector('.catalog-cap-line').textContent, 'oats.okfKnowledge', 'name and kind chip share one line');
  assert.match(u.css(okf.querySelector('.catalog-name')).font, /650 13px var\(--mono/);
  assert.equal(u.$('.catalog-row[data-capability="oats.authoring"] .catalog-core'), null, 'no kind chip without a layer');
  assert.equal(u.$('.catalog-row[data-capability="nw-quiet"] .catalog-desc'), null, 'no description line when the kernel reports none');
});

test('descriptions render as one element on one line (nowrap + ellipsis), never wrapping', t => {
  const u = mount(t);
  renderCapabilities(u.$('.caps'), { rows: ROWS, status: null, instances: [], onOpen() {} });
  for (const row of ROWS.filter(r => r.description)) {
    const descs = u.$$(`.catalog-row[data-capability="${row.name}"] .catalog-desc`);
    assert.equal(descs.length, 1, `${row.name}: a single description element`);
    assert.equal(descs[0].textContent, row.description);
    const style = u.css(descs[0]);
    assert.equal(style.whiteSpace, 'nowrap'); assert.equal(style.overflow, 'hidden'); assert.equal(style.textOverflow, 'ellipsis');
    assert.equal(style.color, 'var(--muted)'); assert.equal(style.fontSize, '12px');
    assert.equal(descs[0].title, row.description, 'the full text stays reachable');
  }
  assert.equal(u.css(u.$('.catalog-cap')).flexDirection, 'column', 'the description sits under the name line, not beside it');
});

test('the row is a button named "<capability>, <kind>, from <source>", described by its description and used-by; activation is the native button\'s', t => {
  const u = mount(t);
  const opened = [];
  renderCapabilities(u.$('.caps'), { rows: ROWS, status: STATUS, instances: INSTANCES, onOpen: row => opened.push(row) });
  const name = cap => u.$(`.catalog-row[data-capability="${cap}"]`).getAttribute('aria-label');
  assert.equal(name('oats.okf'), 'oats.okf, Knowledge, from oats.okf 2.1.3');
  assert.equal(name('oats.aweb'), 'oats.aweb, Messaging, from oats latest');
  assert.equal(name('oats.jira'), 'oats.jira, Tasks, from tools');
  assert.equal(name('oats.authoring'), 'oats.authoring, capability, from oats latest');
  assert.equal(name('oats.core'), 'oats.core, capability, from oats.framework 1.4.0');
  // The short name replaces the content, so the rest is its accessible description: the description, then used-by.
  const described = cap => {
    const ids = u.$(`.catalog-row[data-capability="${cap}"]`).getAttribute('aria-describedby').split(' ');
    for (const id of ids) assert.equal(u.doc.querySelectorAll(`#${id}`).length, 1, `${id} resolves to one element`);
    return ids.map(id => u.doc.getElementById(id).textContent).join(' ');
  };
  assert.equal(described('oats.aweb'), 'Messaging layer via aweb: per-instance team identities. Used by 4 souls');
  assert.equal(described('oats.okf'), `${ROWS[0].description} Used by Every soul`);
  assert.equal(described('oats.jira'), 'Tasks layer via Jira. Not used');
  const threeSouls = [{ agent: 'a', agentsRoot: '/w', modules: [{ name: 'oats.jira' }] }, { agent: 'b', agentsRoot: '/w', modules: [{ name: 'oats.jira' }] }, { agent: 'c', agentsRoot: '/w', modules: [{ name: 'oats.jira' }] }];
  renderCapabilities(u.$('.caps'), { rows: ROWS, status: STATUS, instances: threeSouls, onOpen: row => opened.push(row) });
  assert.equal(described('oats.jira'), 'Tasks layer via Jira. Used by 3 souls');
  const ids = u.$$('.catalog-row').flatMap(el => el.getAttribute('aria-describedby').split(' '));
  assert.equal(new Set(ids).size, ids.length, 'ids are unique across rows');
  renderCapabilities(u.$('.caps'), { rows: ROWS, status: STATUS, instances: INSTANCES, onOpen: row => opened.push(row) });
  const row = u.$('.catalog-row[data-capability="oats.aweb"]');
  assert.ok(row.classList.contains('openable')); assert.equal(row.tabIndex, 0); assert.equal(row.localName, 'button'); assert.equal(row.type, 'button');
  row.click();
  assert.equal(opened.length, 1); assert.equal(opened[0], ROWS[1], 'the catalog row object itself');
  // Enter and Space are the native button's: the row handles no keydown (nothing cancelled, nothing opened
  // twice); a browser turns the key into the click above.
  for (const name of ['Enter', ' ', 'a']) assert.equal(key(u, row, name), true, `${JSON.stringify(name)} is not cancelled`);
  assert.equal(opened.length, 1, 'a keydown alone opens nothing: only the native activation (click) does');
  row.focus(); row.dispatchEvent(new u.dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
  assert.equal(opened.length, 2, 'the keyboard\'s activation (a click with detail 0) opens it once'); assert.ok(opened.every(r => r === ROWS[1]));
  // Without a page to open the card is inert, not a live control that does nothing.
  renderCapabilities(u.$('.caps'), { rows: ROWS, status: STATUS, instances: INSTANCES });
  assert.equal(u.$('.catalog-row').disabled, true); assert.equal(u.$('.catalog-row.openable'), null);
});

test('used by: "Not used" / "N soul(s)" with at most three tiles / "Every soul" from status.defaults — never a bare dash', t => {
  const u = mount(t);
  renderCapabilities(u.$('.caps'), { rows: ROWS, status: STATUS, instances: INSTANCES, onOpen() {} });
  const used = cap => u.$(`.catalog-row[data-capability="${cap}"] .catalog-used`);
  const count = cap => used(cap).querySelector('.catalog-used-count');
  // Four distinct souls carry oats.aweb (one instance twice): three tiles, "4 souls".
  assert.equal(count('oats.aweb').textContent, '4 souls'); assert.equal(count('oats.aweb').title, 'Used by release-manager, campaign-writer, reviewer, planner');
  assert.equal(used('oats.aweb').querySelectorAll('.identity-mark').length, 3);
  assert.equal(u.css(count('oats.aweb')).color, 'var(--fg)');
  // An off default is not a default: it falls back to the roster's count.
  assert.equal(count('oats.authoring').textContent, '1 soul'); assert.equal(used('oats.authoring').querySelectorAll('.identity-mark').length, 1);
  // A default capability (off !== true) and the knowledge slot's capability.
  assert.equal(count('oats.core').textContent, 'Every soul'); assert.equal(count('oats.okf').textContent, 'Every soul');
  assert.equal(used('oats.core').querySelectorAll('.identity-mark').length, 0);
  assert.match(count('oats.okf').title, /workspace default/); assert.match(count('oats.okf').title, /release-manager/, 'names the souls that record it too');
  assert.equal(u.css(count('oats.core')).color, 'var(--fg)');
  // Nobody carries it, nothing declares it.
  assert.equal(count('oats.jira').textContent, 'Not used'); assert.equal(count('nw-quiet').textContent, 'Not used');
  assert.equal(u.css(count('oats.jira')).color, 'var(--muted)'); assert.equal(count('oats.jira').title, 'No instance carries it yet');
  assert.equal(u.$('.catalog-table').textContent.includes('—'), false, 'never the bare dash');
  const marks = u.css(used('oats.aweb').querySelector('.identity-mark'));
  assert.equal(marks.width, '20px'); assert.equal(marks.marginLeft, '-5px');
  // jsdom does not compute a border shorthand holding var(): read the ring from the sheet.
  assert.match(catalogCSS, /\.catalog-used-marks \.identity-mark \{ width:20px; height:20px; margin-left:-5px;[^}]*border:1\.5px solid var\(--surface\)/);
});

test('without reported defaults nothing is claimed: a declared name still reads from the roster', t => {
  const u = mount(t);
  const { defaults, ...bare } = STATUS;
  renderCapabilities(u.$('.caps'), { rows: ROWS, status: bare, instances: INSTANCES, onOpen() {} });
  const count = cap => u.$(`.catalog-row[data-capability="${cap}"] .catalog-used-count`).textContent;
  assert.equal(count('oats.core'), 'Not used'); assert.equal(count('oats.okf'), '1 soul');
  renderCapabilities(u.$('.caps'), { rows: ROWS, status: null, instances: [], onOpen() {} });
  assert.deepEqual(u.$$('.catalog-used-count').map(el => el.textContent), ROWS.map(() => 'Not used'));
  assert.ok(u.$('.catalog-head'), 'the header row is drawn over the cards');
});

test('tile and kind chip share one tint per kind: layer wins, member/external → clay, plain package → neutral', t => {
  const u = mount(t);
  renderCapabilities(u.$('.caps'), { rows: ROWS, status: STATUS, instances: [], onOpen() {} });
  const tint = cap => u.$(`.catalog-row[data-capability="${cap}"] .catalog-tile`).dataset.tint;
  assert.deepEqual(['oats.okf', 'oats.aweb', 'oats.jira', 'oats.authoring', 'oats.core'].map(tint), ['slate', 'sage', 'mauve', 'clay', 'neutral']);
  for (const cap of ['oats.okf', 'oats.aweb', 'oats.jira']) {
    const row = u.$(`.catalog-row[data-capability="${cap}"]`);
    assert.equal(row.querySelector('.catalog-core').dataset.tint, tint(cap), `${cap}: the chip agrees with the tile`);
  }
  const painted = (sel, pair) => { const s = u.css(u.$(sel)); assert.equal(s.background, `var(--${pair}-bg)`); assert.equal(s.color, `var(--${pair}-fg)`); };
  painted('.catalog-row[data-capability="oats.okf"] .catalog-tile', 'soul-slate'); painted('.catalog-row[data-capability="oats.okf"] .catalog-core', 'soul-slate');
  painted('.catalog-row[data-capability="oats.aweb"] .catalog-tile', 'soul-sage'); painted('.catalog-row[data-capability="oats.jira"] .catalog-core', 'soul-mauve');
  painted('.catalog-row[data-capability="oats.authoring"] .catalog-tile', 'soul-clay'); painted('.catalog-row[data-capability="oats.core"] .catalog-tile', 'chip');
});

for (const [theme, palette] of palettes) test(`${theme}: the row card's text pairs and every tile/chip tint hold WCAG AA on their painted surfaces`, () => {
  const ratio = (fg, bg) => contrast(channels(palette.get(fg)), channels(palette.get(bg)));
  for (const tone of ['slate', 'sage', 'mauve', 'clay']) assert.ok(ratio(`soul-${tone}-fg`, `soul-${tone}-bg`) >= 4.5, `${theme}: soul-${tone}`);
  assert.ok(ratio('chip-fg', 'chip-bg') >= 4.5, `${theme}: neutral tile`);
  // Name, description, used-by words and the source chip on the card, at rest and hovered/focused.
  for (const bg of ['surface', 'surface-2']) for (const fg of ['fg', 'muted']) assert.ok(ratio(fg, bg) >= 4.5, `${theme}: ${fg} on ${bg}`);
  // The column header sits on the view background; the jump's current segment is accent on the tint.
  assert.ok(ratio('muted', 'bg') >= 4.5); assert.ok(ratio('accent', 'sel') >= 4.5); assert.ok(ratio('muted', 'surface') >= 4.5);
});

test('rule 2 in the card CSS: hover restyles the border and surface; focus is the shell\'s (no rule of its own, no offset ring anywhere)', () => {
  assert.match(catalogCSS, /button\.catalog-row:hover \{ background:var\(--surface-2\); border-color:var\(--tree-line\); \}/);
  // The shell's :focus-visible (theme.css) is the keyboard's tint + 1px accent edge; a component rule would override it.
  assert.doesNotMatch(catalogCSS, /(catalog-row|capability-nav[^{]*button):focus/);
  // The repository pills: each chip has its own 1px frame. Its background out-ranks the global focus tint, so
  // its one focus rule restates the shell's tint (as #ws-trigger does), and nothing else: the edge stays the shell's.
  assert.match(catalogCSS, /\.catalog-pills button \{[^}]*border:1px solid var\(--border\); border-radius:7px; background:var\(--surface\); color:var\(--muted\)/);
  assert.deepEqual(catalogCSS.match(/[^{}\n]*catalog-pills[^{}\n]*:focus[^{}]*\{[^}]*\}/g).map(rule => rule.trim()), ['.oats-view .catalog-pills button:focus-visible { background:var(--sel); }']);
  assert.doesNotMatch(catalogCSS, /catalog-select|catalog-clear/, 'the Team and Repo dropdowns are gone');
  // jsdom cannot compute a border shorthand holding var(): the card's frame is read from the sheet.
  assert.match(catalogCSS, /button\.catalog-row \{[^}]*border:1px solid var\(--border\); border-radius:10px; background:var\(--surface\)/);
  for (const rule of catalogCSS.match(/^[^{\n]*(catalog-row|capability-nav)[^{\n]*\{[^}]*\}/gm)) assert.doesNotMatch(rule, /outline:2px|outline-offset/, rule);
  assert.doesNotMatch(catalogCSS, /999px/, 'no pill left');
  assert.doesNotMatch(catalogCSS, /#[0-9a-f]{3,8}\b|rgba?\(|opacity/i, 'tokens only');
});

test('the section jump is one ws-segmented group of navigation segments (aria-current); click and scroll sync move the current one', t => {
  const u = mount(t);
  const sections = capabilitySections([...ROWS, { name: 'nw-runbook', kind: 'member', repoKey: 'github.com/awebai/oats', private: true, origin: 'member github.com/awebai/oats' }]);
  const opened = [];
  renderCapabilitySections(u.$('.sections'), { sections, shown: sections.workspace, filterHost: null, privateListed: true, status: STATUS, instances: INSTANCES, onOpen: row => opened.push(row.name) });
  const nav = u.$('.capability-nav');
  assert.ok(nav.classList.contains('ws-segmented'));
  assert.equal(u.css(nav).padding, '2px'); assert.equal(u.css(nav).borderRadius, '8px'); assert.equal(u.css(nav).gap, '2px');
  assert.match(catalogCSS, /\.capability-nav\.ws-segmented \{[^}]*border:1px solid var\(--border\); border-radius:8px; background:var\(--surface\)/, 'one outer frame');
  const buttons = [...nav.querySelectorAll('button')];
  const current = () => buttons.map(b => b.getAttribute('aria-current'));
  assert.deepEqual(buttons.map(b => [b.dataset.jump, b.getAttribute('aria-current'), b.getAttribute('aria-pressed')]), [['workspace', 'true', null], ['repo', null, null], ['packages', null, null]], 'Repo owned before Packages');
  assert.deepEqual(u.$$('.capability-section').map(el => el.dataset.section), ['workspace', 'repo', 'packages'], 'the sections in the nav\'s order');
  assert.match(catalogCSS, /\.capability-nav\.ws-segmented button\[aria-current\] \{ background:var\(--sel\); color:var\(--accent\); font-weight:650; \}/, 'rule 1 look on the current segment');
  for (const rule of catalogCSS.match(/^[^{\n]*capability-nav[^{\n]*\{[^}]*\}/gm)) assert.doesNotMatch(rule, /aria-pressed/, 'the jump is navigation: no pressed state');
  assert.deepEqual(buttons.map(b => b.querySelector('.capability-nav-count').textContent), ['4', '1', '2'], 'the count span stays');
  assert.equal(u.css(buttons[0]).borderRadius, '6px');
  assert.equal(u.css(buttons[1]).background, 'rgba(0, 0, 0, 0)'); assert.equal(u.css(buttons[1]).color, 'var(--muted)');
  assert.equal(u.css(nav).background, 'var(--surface)', 'the unpressed segment reads on the group frame');
  const pressed = u.css(buttons[0]);
  assert.equal(pressed.background, 'var(--sel)'); assert.equal(pressed.color, 'var(--accent)'); assert.equal(pressed.fontWeight, '650');
  buttons[2].click();
  assert.deepEqual(current(), [null, null, 'true']);
  assert.equal(u.doc.activeElement, u.$('#capability-section-packages'), 'the jump focuses the section title');
  // Scroll sync: the section whose top passed the scroller's top is the pressed one.
  const tops = { workspace: -400, repo: -10, packages: 300 };
  for (const el of u.$$('.capability-section')) el.getBoundingClientRect = () => ({ top: tops[el.dataset.section] });
  syncCapabilityNav(u.$('.sections'), { getBoundingClientRect: () => ({ top: 0 }) });
  assert.deepEqual(current(), [null, 'true', null], 'Repo owned in view');
  tops.packages = 10; syncCapabilityNav(u.$('.sections'), { getBoundingClientRect: () => ({ top: 0 }) });
  assert.deepEqual(current(), [null, null, 'true'], 'Packages in view');
  assert.equal(u.$('[aria-pressed]'), null, 'navigation, not a toggle');
  // Repo owned: the repository heading (the Souls tab's grammar) sits between cards, and its card is a button too.
  const group = u.$('[data-section=repo] .catalog-group');
  assert.equal(group.tagName, 'H3'); assert.equal(group.querySelector('.souls-group-name').textContent, 'oats');
  assert.equal(group.querySelector('.souls-group-note').textContent, 'member repo · 1 capability');
  assert.equal(group.nextElementSibling.tagName, 'BUTTON'); assert.equal(group.nextElementSibling.dataset.capability, 'nw-runbook');
  group.nextElementSibling.click(); assert.deepEqual(opened, ['nw-runbook']);
});

test('empty states keep their words and no header row is drawn over nothing', t => {
  const u = mount(t);
  renderCapabilities(u.$('.caps'), { rows: [], status: null, instances: [], total: 4, onOpen() {} });
  assert.equal(u.$('.catalog-head'), null); assert.match(u.$('.catalog-empty').textContent, /No capabilities match these filters/);
  renderCapabilities(u.$('.caps'), { rows: [], status: null, instances: [], empty: 'Nothing here.', onOpen() {} });
  assert.equal(u.$('.catalog-empty').textContent, 'Nothing here.');
  renderCapabilities(u.$('.caps'), { rows: [], status: null, instances: [], onOpen() {} });
  assert.match(u.$('.catalog-empty').textContent, /reports no capabilities yet/);
  assert.equal(u.css(u.$('.catalog-empty')).color, 'var(--muted)');
});
