// Workspace › Capabilities opens with the workspace's defaults (renderer/workspace-defaults.mjs, rendered first by
// workspace-catalog.mjs renderCapabilitySections) and its "i" opens "About capabilities" (renderer/about-dialog.mjs,
// shared with Workspace › Souls). Facts only from `oats workspace status --json` `defaults` and the catalog rows:
// without a reported `defaults` nothing is shown. jsdom; no CLI, server or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderCapabilitySections, syncCapabilityNav } from '../renderer/workspace-catalog.mjs';
import { workspaceDefaults, defaultRow, defaultsCSS, DEFAULTS_COPY } from '../renderer/workspace-defaults.mjs';
import { ABOUT_COPY, aboutCSS, createAboutDialog } from '../renderer/about-dialog.mjs';
import { takePickerFocusReturn } from '../renderer/overlay-picker.mjs';
import { capabilitySections } from '../../client/capability-rows.mjs';
import { iconElement } from '../renderer/shell-icons.mjs';

const HOST = 'github.com/nw/agents', MKT = 'github.com/nw/marketing';
const ROWS = [
  { name: 'oats.okf', kind: 'package', package: 'oats.okf', version: '2.1.3', layer: 'knowledge', origin: 'package oats.okf v2.1.3' },
  { name: 'oats.aweb', kind: 'package', package: 'oats.aweb', version: '1.28.0', layer: 'messaging', origin: 'package oats.aweb v1.28.0' },
  { name: 'oats.core', kind: 'package', package: 'oats.framework', version: '1.11.0', origin: 'package oats.framework v1.11.0' },
  { name: 'nw-house-style', kind: 'member', repoKey: HOST, origin: `member ${HOST}` },
  { name: 'nw-brand-voice', kind: 'member', repoKey: MKT, origin: `member ${MKT}` },
  // The same name in another repository: matching never takes it for the host's.
  { name: 'nw-tasks', kind: 'member', repoKey: MKT, layer: 'tasks', origin: `member ${MKT}` },
];
const MEMBERS = [{ key: HOST, name: 'agents', status: 'confirmed' }, { key: MKT, name: 'marketing', status: 'confirmed' }];
const status = (defaults, workspace = { key: HOST, name: 'northwind' }) => ({ workspace, members: MEMBERS, ...(defaults === undefined ? {} : { defaults }) });
const FULL = {
  slots: { knowledge: { name: 'oats.okf', from: 'package' }, messaging: { name: 'oats.aweb', from: 'package' }, tasks: { name: 'nw-tasks', from: 'here' } },
  capabilities: [{ name: 'oats.core', from: 'package', off: false }, { name: 'nw-brand-voice', from: MKT, off: false }, { name: 'nw-house-style', from: null, off: true }],
};
const MIXED = { slots: { knowledge: { name: 'oats.okf', from: 'package' }, messaging: 'none', tasks: null }, capabilities: [{ name: 'nw-house-style', from: 'here', off: false }] };

function mount(t) {
  const dom = new JSDOM('<!doctype html><html data-theme="light"><body><main class="oats-view"><div class="toolbar"><div class="lead"></div></div><div class="sections"></div></main></body></html>', { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const style = doc.createElement('style'); style.textContent = defaultsCSS + aboutCSS; doc.head.append(style);
  const $ = sel => doc.querySelector(sel), $$ = sel => [...doc.querySelectorAll(sel)];
  const opened = [];
  const render = (st, { rows = ROWS, query = '', shown, onOpen = row => opened.push(row) } = {}) => {
    const sections = capabilitySections(rows);
    $('.lead').replaceChildren(); // the tab host clears its toolbar's jump before each paint
    renderCapabilitySections($('.sections'), { sections, shown: shown ?? sections.workspace, filterHost: null, navHost: $('.lead'), privateListed: false, status: st, instances: [], query, onOpen });
  };
  const key = (el, name, init = {}) => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
  return { dom, doc, $, $$, opened, render, key };
}
const slotCells = u => u.$$('.ws-defaults-slots > li > .ws-default-slot');
// The words as they read: every text run, one space apart (a chip's name and version are separate spans).
const text = el => { const walk = el.ownerDocument.createTreeWalker(el, 4), out = []; while (walk.nextNode()) { const t = walk.currentNode.textContent.trim(); if (t) out.push(t); } return out.join(' '); };

test('workspaceDefaults reads only what the kernel reports: absent → null; a missing slot, "none", null or another string → empty; the count', () => {
  assert.equal(workspaceDefaults(status(undefined)), null, 'no defaults reported: no claim');
  assert.equal(workspaceDefaults(status(null)), null);
  const d = workspaceDefaults(status({ slots: { knowledge: 'none', messaging: 'kernel-says-something' }, capabilities: [{ name: 'a', from: 'package', off: true }, { name: 'b', from: 'package' }, { from: 'package' }] }));
  assert.deepEqual(d.slots.map(s => [s.slot, s.value]), [['knowledge', null], ['messaging', null], ['tasks', null]], 'the strip order, every slot empty');
  assert.deepEqual(d.capabilities.map(c => c.name), ['a', 'b'], 'an entry without a name is not shown');
  assert.equal(d.count, 1, 'filled slots plus capabilities not turned off'); assert.equal(d.empty, false);
  assert.equal(workspaceDefaults(status(FULL)).count, 5);
  assert.equal(workspaceDefaults(status({ slots: { knowledge: null, messaging: 'none', tasks: 'none' }, capabilities: [] })).empty, true);
  assert.equal(workspaceDefaults(status({ slots: {} })).empty, true, 'no capabilities key: none');
});

test('defaultRow: a package by name and kind, a member by its key, "here" as the host; unmatched names its source with no version', () => {
  assert.equal(defaultRow(ROWS, { name: 'oats.okf', from: 'package' }, HOST).row, ROWS[0]);
  assert.equal(defaultRow(ROWS, { name: 'nw-brand-voice', from: MKT }, HOST).row, ROWS[4]);
  assert.equal(defaultRow(ROWS, { name: 'nw-house-style', from: 'here' }, HOST).row, ROWS[3]);
  const other = defaultRow(ROWS, { name: 'nw-tasks', from: 'here' }, HOST);
  assert.deepEqual(other, { row: { name: 'nw-tasks', kind: 'member', repoKey: HOST }, listed: false }, 'the same name in another repository is not the host\'s');
  assert.deepEqual(defaultRow(ROWS, { name: 'nw-house-style', from: 'package' }, HOST), { row: { name: 'nw-house-style', kind: 'package' }, listed: false }, 'a member row is never taken for a package, and no package is named');
  assert.equal(defaultRow(ROWS, { name: 'x', from: null }, HOST), null, 'no source: nothing to name');
  assert.equal(defaultRow(ROWS, { name: 'x', from: 'here' }, null), null, 'no host key: "here" names nothing');
});

test('filled slots and other defaults: Knowledge, Messaging, Tasks with their id and source chip, each a button opening the matched row', t => {
  const u = mount(t);
  u.render(status(FULL));
  const section = u.$('.capability-section');
  assert.equal(section.dataset.section, 'defaults', 'the first section');
  assert.equal(section.getAttribute('aria-labelledby'), 'capability-section-defaults');
  const head = u.$('#capability-section-defaults');
  assert.equal(head.tagName, 'H2'); assert.ok(head.classList.contains('capability-section-title'));
  assert.equal(head.textContent, 'Workspace defaults'); assert.equal(head.querySelector('.capability-section-lead'), null, 'no lead text');
  assert.equal(text(u.$('.ws-defaults-scope')), 'Every soul in northwind starts with these, unless it turns one off.');
  assert.equal(u.$('.ws-defaults-scope .ws-defaults-ws').textContent, 'northwind');
  assert.equal(u.$('.ws-defaults-panel .identity-mark'), null, 'no identity mark');
  const cells = slotCells(u);
  assert.deepEqual(cells.map(c => [c.tagName, c.dataset.slot, c.querySelector('.ws-default-slot-head').textContent, c.querySelector('.ws-default-name').textContent, text(c.querySelector('.source-chip'))]), [
    ['BUTTON', 'knowledge', 'Knowledge', 'oats.okf', 'oats.okf 2.1.3'],
    ['BUTTON', 'messaging', 'Messaging', 'oats.aweb', 'oats.aweb 1.28.0'],
    ['BUTTON', 'tasks', 'Tasks', 'nw-tasks', 'agents'],
  ]);
  assert.deepEqual(cells.map(c => c.querySelector('.ws-default-slot-icon').dataset.tint), ['slate', 'sage', 'mauve']);
  assert.equal(cells[0].getAttribute('aria-label'), 'Knowledge: oats.okf, the workspace default — open its page');
  assert.deepEqual(cells.map(c => c.dataset.focusKey), ['defaults:knowledge', 'defaults:messaging', 'defaults:tasks']);
  cells[0].click(); cells[2].click();
  assert.equal(u.opened[0], ROWS[0], 'the catalog row itself');
  assert.deepEqual(u.opened[1], { name: 'nw-tasks', kind: 'member', repoKey: HOST }, 'unlisted: a minimal row, still opened (the page says it is not listed)');
  assert.equal(cells[2].querySelector('.source-chip-version'), null, 'never a guessed version');
  // Also for every soul: chips, the one turned off is a span, struck through, with its note.
  const more = u.$('.ws-defaults-more');
  assert.equal(more.querySelector('.ws-defaults-more-label').textContent, 'Also for every soul');
  const chips = [...more.querySelectorAll('.ws-default-cap')];
  assert.deepEqual(chips.map(c => [c.tagName, c.dataset.defaultCapability, text(c)]), [
    ['BUTTON', 'oats.core', 'oats.core oats.framework 1.11.0'],
    ['BUTTON', 'nw-brand-voice', 'nw-brand-voice marketing latest'],
    ['SPAN', 'nw-house-style', 'nw-house-style turned off by the workspace'],
  ]);
  assert.equal(chips[0].getAttribute('aria-label'), 'oats.core, from oats.framework 1.11.0, a workspace default — open its page');
  assert.equal(chips[1].dataset.focusKey, 'defaults:cap:nw-brand-voice');
  assert.ok(chips[2].classList.contains('off')); assert.equal(chips[2].dataset.focusKey, undefined); assert.equal(chips[2].querySelector('.source-chip'), null);
  chips[1].click(); assert.equal(u.opened[2], ROWS[4]);
});

test('empty slots: None and the note, not interactive, a neutral tile; an off-only list still shows the strip', t => {
  const u = mount(t);
  u.render(status(MIXED));
  const cells = slotCells(u);
  assert.deepEqual(cells.map(c => c.tagName), ['BUTTON', 'DIV', 'DIV']);
  for (const cell of cells.slice(1)) {
    assert.equal(cell.querySelector('.ws-default-none').textContent, 'None');
    assert.equal(cell.querySelector('.ws-default-note').textContent, 'No workspace default. Each soul chooses its own.');
    assert.ok(cell.querySelector('.ws-default-slot-icon').classList.contains('is-empty'));
    assert.equal(cell.getAttribute('tabindex'), null); assert.equal(cell.dataset.focusKey, undefined);
  }
  assert.equal(text(u.$('.ws-default-cap')), 'nw-house-style agents latest', '"here" is the host repository');
  u.render(status({ slots: { knowledge: null, messaging: null, tasks: null }, capabilities: [{ name: 'x', from: null, off: true }] }));
  assert.equal(slotCells(u).length, 3, 'a turned-off default is still something the workspace says');
  assert.equal(u.$('[data-jump=defaults] .capability-nav-count').textContent, '0');
});

test('an unlisted package default never presents the capability as its package: the chip names the kind alone', t => {
  const u = mount(t);
  // oats.core is listed nowhere here (its package, oats.framework, is not locked yet): the id says nothing about the package.
  u.render(status({ slots: { knowledge: { name: 'oats.okf', from: 'package' } }, capabilities: [{ name: 'oats.core', from: 'package', off: false }] }), { rows: ROWS.filter(r => r.name !== 'oats.core' && r.name !== 'oats.okf') });
  for (const owner of [slotCells(u)[0], u.$('button.ws-default-cap')]) {
    const chip = owner.querySelector('.source-chip');
    assert.equal(chip.querySelector('.source-chip-name').textContent, 'package');
    assert.equal(chip.querySelector('.source-chip-version'), null);
    assert.equal(chip.title, 'A locked package; not in the workspace’s capability list');
    assert.equal(chip.querySelector('svg').innerHTML, iconElement(u.doc, 'package', { size: 13 }).innerHTML, 'the package icon');
  }
  assert.equal(text(u.$('button.ws-default-cap')), 'oats.core package', 'the id once, never as a package name');
  assert.equal(u.$('button.ws-default-cap').getAttribute('aria-label'), 'oats.core, from a package, a workspace default — open its page');
  u.$('button.ws-default-cap').click();
  assert.deepEqual(u.opened.at(-1), { name: 'oats.core', kind: 'package' }, 'the page still opens, with no package claimed');
});

test('empty state: no slot and no capability (a standalone deployment too): the scope line alone', t => {
  const u = mount(t);
  u.render(status({ slots: { knowledge: null, messaging: 'none', tasks: null }, capabilities: [] }));
  assert.equal(text(u.$('.ws-defaults-scope')), 'northwind sets no defaults. Each soul chooses all of its own capabilities.');
  assert.equal(u.$('.ws-defaults-sub').textContent, 'Each soul chooses all of its own capabilities.');
  assert.equal(u.$('.ws-defaults-slots'), null); assert.equal(u.$('.ws-defaults-more'), null);
  assert.equal(u.$('[data-jump=defaults]').textContent, 'Defaults0');
  // No workspace name: "this workspace". A name with markup is text, never HTML.
  u.render(status({ slots: {}, capabilities: [] }, { key: HOST }));
  assert.equal(text(u.$('.ws-defaults-scope')), 'this workspace sets no defaults. Each soul chooses all of its own capabilities.');
  u.render(status(MIXED, { key: HOST, name: '<img src=x onerror=alert(1)>' }));
  assert.equal(u.$('.ws-defaults-ws').textContent, '<img src=x onerror=alert(1)>'); assert.equal(u.$('.ws-defaults-panel img'), null);
});

test('without reported defaults: no section and no Defaults segment, nothing inferred', t => {
  const u = mount(t);
  u.render(status(undefined));
  assert.equal(u.$('[data-section=defaults]'), null); assert.equal(u.$('[data-jump=defaults]'), null);
  assert.equal(u.$('.capability-nav [aria-current]').dataset.jump, 'workspace', 'Workspace owned is current, as before');
});

test('the Defaults segment comes first, counts filled slots plus defaults not turned off, is the initial current one and jumps', t => {
  const u = mount(t);
  u.render(status(FULL));
  const jumps = u.$$('.capability-nav button');
  assert.deepEqual(jumps.map(b => [b.dataset.jump, b.firstChild.textContent, b.querySelector('.capability-nav-count').textContent, b.getAttribute('aria-current')]),
    [['defaults', 'Defaults', '5', 'true'], ['workspace', 'Workspace owned', '3', null], ['packages', 'Packages', '3', null]]);
  assert.deepEqual(u.$$('.capability-section').map(el => el.dataset.section), ['defaults', 'workspace', 'packages']);
  jumps[1].click(); jumps[0].click();
  assert.equal(u.doc.activeElement, u.$('#capability-section-defaults')); assert.equal(jumps[0].getAttribute('aria-current'), 'true');
  // Scroll sync tracks it like the others.
  const tops = { defaults: -300, workspace: 10, packages: 400 };
  for (const el of u.$$('.capability-section')) el.getBoundingClientRect = () => ({ top: tops[el.dataset.section] });
  syncCapabilityNav(u.$('.sections'), { getBoundingClientRect: () => ({ top: 0 }) }, u.$('.lead'));
  assert.equal(u.$('.capability-nav [aria-current]').dataset.jump, 'workspace');
  tops.workspace = 200; syncCapabilityNav(u.$('.sections'), { getBoundingClientRect: () => ({ top: 0 }) }, u.$('.lead'));
  assert.equal(u.$('.capability-nav [aria-current]').dataset.jump, 'defaults');
});

test('search and the repository pills never narrow the defaults', t => {
  const u = mount(t);
  u.render(status(FULL), { query: 'no-such-capability', shown: [] });
  assert.equal(slotCells(u).length, 3); assert.equal(u.$$('.ws-default-cap').length, 3);
  assert.equal(u.$('[data-jump=defaults] .capability-nav-count').textContent, '5');
  assert.equal(slotCells(u)[0].querySelector('.source-chip-version').textContent, '2.1.3', 'matched against every catalog row, not the filtered ones');
});

test('a catalog with no rows still says what every soul gets, with no section jump', t => {
  const u = mount(t);
  u.render(status(MIXED), { rows: [] });
  assert.deepEqual(u.$$('.capability-section').map(el => el.dataset.section), ['defaults']);
  assert.equal(u.$('.capability-nav'), null);
  assert.ok(u.$('.catalog-empty'), 'the catalog\'s own empty line follows');
  assert.equal(slotCells(u)[0].querySelector('.source-chip-version'), null, 'nothing listed: no version');
});

test('the panel\'s look: one --surface panel, 24px tiles, rules in --tag-bg, columns stacking below 700px', () => {
  assert.match(defaultsCSS, /\.ws-defaults-panel \{ background:var\(--surface\); border:1px solid var\(--border\); border-radius:10px;/);
  assert.match(defaultsCSS, /\.ws-defaults-slots \{ display:grid; grid-template-columns:repeat\(3, minmax\(0,1fr\)\);/);
  assert.match(defaultsCSS, /\.ws-defaults-slots > li \{[^}]*border-left:1px solid var\(--tag-bg\)/);
  assert.match(defaultsCSS, /@container \(max-width:700px\) \{\n \.ws-defaults-slots \{ grid-template-columns:minmax\(0,1fr\); \}\n \.ws-defaults-slots > li \{ border-left:0; border-top:1px solid var\(--tag-bg\); \}/);
  assert.match(defaultsCSS, /\.ws-default-slot-icon \{[^}]*width:24px; height:24px;/);
  assert.match(defaultsCSS, /\.ws-default-slot-icon\.is-empty \{ background:var\(--chip-bg\); color:var\(--muted\); \}/);
  assert.match(defaultsCSS, /\.ws-default-slot-head \{[^}]*color:var\(--muted\); font:600 12px/);
  assert.doesNotMatch(defaultsCSS, /uppercase/);
  assert.match(defaultsCSS, /\.ws-default-name \{[^}]*font:650 14px var\(--mono/);
  assert.match(defaultsCSS, /\.ws-default-none \{ color:var\(--muted\); font:500 14px/);
  assert.match(defaultsCSS, /\.oats-view \.ws-default-cap, \.ws-default-cap \{[^}]*height:30px;[^}]*border:1px solid var\(--border\)/);
  assert.match(defaultsCSS, /\.ws-default-cap\.off \{ border-style:dashed;/);
  assert.match(defaultsCSS, /\.ws-default-cap\.off \.ws-default-name \{ color:var\(--muted\); text-decoration:line-through; \}/);
  assert.match(defaultsCSS, /\.oats-view button\.ws-default-slot:focus-visible, \.oats-view button\.ws-default-cap:focus-visible \{ background:var\(--sel\); \}/, 'keyboard focus keeps the shell tint');
  assert.equal(DEFAULTS_COPY.more, 'Also for every soul');
});

function about(t) {
  const u = mount(t);
  const dialog = createAboutDialog(u.doc, { copy: ABOUT_COPY.capabilities, id: 'workspace-capabilities-about' });
  u.$('.lead').append(dialog.button);
  t.after(() => dialog.dispose());
  return { ...u, dialog, overlay: () => u.$('.palette-overlay.lifecycle-overlay'), close: () => u.$('.about-dialog .lifecycle-close') };
}

test('the "i": a 28px round icon button, "About capabilities", aria-haspopup=dialog', t => {
  const u = about(t);
  const b = u.dialog.button;
  assert.equal(b.tagName, 'BUTTON'); assert.equal(b.type, 'button');
  assert.equal(b.getAttribute('aria-label'), 'About capabilities'); assert.equal(b.title, 'About capabilities'); assert.equal(b.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(b.querySelector('svg').getAttribute('width'), '15');
  assert.match(aboutCSS, /\.oats-view button\.ws-info-button \{[^}]*width:28px; height:28px;[^}]*border-radius:50%;/);
  assert.equal(u.overlay(), null, 'closed until pressed');
});

test('About capabilities: the lifecycle frame, labelled by its title, the exact copy, focus on Close', t => {
  const u = about(t);
  u.dialog.button.focus(); u.dialog.button.click();
  const overlay = u.overlay(), dialog = overlay.querySelector('section.lifecycle-dialog.about-dialog');
  assert.ok(dialog);
  assert.equal(dialog.getAttribute('role'), 'dialog'); assert.equal(dialog.getAttribute('aria-modal'), 'true');
  const title = u.doc.getElementById(dialog.getAttribute('aria-labelledby'));
  assert.equal(title.tagName, 'H2'); assert.equal(title.textContent, 'What capabilities are');
  assert.equal(dialog.querySelector('.lifecycle-heading .lifecycle-mark').getAttribute('aria-hidden'), 'true');
  assert.ok(dialog.querySelector('.lifecycle-mark svg'));
  const paragraphs = [...dialog.querySelectorAll(':scope > p')].map(p => p.textContent);
  assert.deepEqual(paragraphs, [
    'A capability is a reusable bundle of skills, commands and instructions, given to every soul whose work needs it.',
    'A soul names the capabilities it needs. When an instance starts, it gets a copy of each one, and the capability’s instructions are injected into the instance’s composed AGENTS.md, after the soul’s own.',
    'Each capability comes from one of three places:',
    'Workspace defaults are capabilities the workspace gives to every soul. A soul gets them without asking. It can turn a default off and name its own in its place, or leave a core capability (knowledge, messaging or tasks) empty.',
  ]);
  assert.equal(dialog.querySelector('p code').textContent, 'AGENTS.md');
  assert.equal(dialog.querySelector('p strong').textContent, 'Workspace defaults');
  const terms = [...dialog.querySelectorAll('dl.about-terms dt')].map(dt => [dt.textContent, dt.nextElementSibling.tagName, dt.nextElementSibling.textContent, !!dt.querySelector('svg')]);
  assert.deepEqual(terms, [
    ['Workspace owned', 'DD', 'Defined in one of the workspace’s repos. Any soul can use it, always at that repo’s latest version.', true],
    ['Repo owned', 'DD', 'Defined in one repo and kept to it. Only souls from that same repo can use it.', true],
    ['Packages', 'DD', 'Installed into the workspace at a pinned version, the same on every machine.', true],
  ]);
  assert.deepEqual([...dialog.querySelectorAll('button')].map(b => [b.textContent, b.className]), [['Close', 'lifecycle-close']]);
  assert.equal(u.doc.activeElement, u.close(), 'opening focuses Close');
  assert.match(aboutCSS, /\.lifecycle-dialog\.about-dialog \{ width:min\(520px, calc\(100vw - 32px\)\); font-size:13px; \}/);
  assert.match(aboutCSS, /\.about-dialog \.lifecycle-mark \{ color:var\(--accent\); \}/);
});

test('About capabilities: Tab and Shift+Tab stay on Close; Escape and Close close it and focus returns to the "i"', t => {
  const u = about(t);
  u.dialog.button.focus(); u.dialog.button.click();
  u.key(u.close(), 'Tab'); assert.equal(u.doc.activeElement, u.close());
  u.key(u.close(), 'Tab', { shiftKey: true }); assert.equal(u.doc.activeElement, u.close());
  let outside = 0; u.doc.body.addEventListener('keydown', e => { if (e.key === 'Escape') outside++; });
  u.key(u.close(), 'Escape');
  assert.equal(u.overlay(), null); assert.equal(outside, 0, 'Escape is the dialog\'s: it does not reach the page');
  assert.equal(u.doc.activeElement, u.dialog.button, 'focus back on the "i"');
  u.dialog.button.click(); u.close().click();
  assert.equal(u.overlay(), null); assert.equal(u.doc.activeElement, u.dialog.button);
  // A scrim click does nothing (as the lifecycle and Forget dialogs).
  u.dialog.button.click(); u.overlay().dispatchEvent(new u.dom.window.MouseEvent('click', { bubbles: true }));
  assert.ok(u.overlay(), 'still open');
});

test('About capabilities: leaving the tab or the workspace closes it without moving focus; another modal dismisses it', t => {
  const u = about(t);
  const other = u.doc.createElement('input'); u.doc.body.append(other);
  u.dialog.button.focus(); u.dialog.button.click();
  other.focus(); u.dialog.close({ focus: 'none' });
  assert.equal(u.overlay(), null); assert.equal(u.doc.activeElement, other, 'focus stays where it is');
  // A dialog opening through the shared handoff (takePickerFocusReturn) dismisses it and inherits its opener: the "i".
  u.dialog.button.focus(); u.dialog.button.click();
  const opener = takePickerFocusReturn(u.doc);
  assert.equal(u.overlay(), null, 'dismissed'); assert.equal(u.doc.activeElement, u.doc.body, 'no focus return of its own');
  assert.equal(opener.resolve(), u.dialog.button, 'the replacement returns focus to the "i"');
  // Any other aria-modal taking focus closes it too.
  u.dialog.button.click();
  const modal = u.doc.createElement('div'); modal.setAttribute('aria-modal', 'true'); const field = u.doc.createElement('input'); modal.append(field); u.doc.body.append(modal);
  field.focus();
  assert.equal(u.overlay(), null); assert.equal(u.doc.activeElement, field);
});

test('About souls: the same dialog with its own button and copy', t => {
  const u = mount(t);
  const souls = createAboutDialog(u.doc, { copy: ABOUT_COPY.souls, id: 'workspace-souls-about' });
  t.after(() => souls.dispose());
  u.$('.lead').append(souls.button);
  assert.equal(souls.button.getAttribute('aria-label'), 'About souls');
  souls.button.focus(); souls.button.click();
  const dialog = u.$('.about-dialog');
  assert.equal(u.doc.getElementById(dialog.getAttribute('aria-labelledby')).textContent, ABOUT_COPY.souls.title);
  assert.equal(u.doc.activeElement, dialog.querySelector('.lifecycle-close'));
  assert.equal(ABOUT_COPY.souls.title, 'What a soul is');
  assert.deepEqual([...dialog.querySelectorAll(':scope > p')].map(p => p.textContent), [
    'A soul defines a kind of agent: the work it specialises in, and the capabilities it gets to do that work.',
    'A team organises its specialist agents as souls, and souls can also organise knowledge: what each one is responsible for knowing, and what it reads to get started. Each running agent is an instance of a soul. Every instance gets the workspace’s default capabilities first, then the soul’s own choices: a soul can add capabilities, turn a default off, or leave a core capability (knowledge, messaging or tasks) empty.',
  ]);
  assert.equal(dialog.querySelector('dl'), null, 'no term list');
  assert.ok(Object.isFrozen(ABOUT_COPY) && Object.isFrozen(ABOUT_COPY.souls) && Object.isFrozen(ABOUT_COPY.capabilities), 'one frozen copy object');
  u.key(u.doc.activeElement, 'Escape'); assert.equal(u.doc.activeElement, souls.button);
});
