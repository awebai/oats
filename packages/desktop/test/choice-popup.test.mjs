import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { createChoicePopup } from '../renderer/choice-popup.mjs';
import { spawnDialogCSS } from '../renderer/spawn-dialog.mjs';
import { revealInScrollport } from '../renderer/reveal-in-scrollport.mjs';
const defaults = { value: '', label: 'Use resolved defaults', group: 'Defaults', search: false, selected: true };
const custom = { custom: true, label: 'Custom entry…', group: 'Custom', search: false };
const suggestions = [{ value: 'provider/one', label: 'One model', detail: 'provider/one', group: 'Reported suggestions' }, { value: 'provider/two', label: 'Two model', group: 'Reported suggestions' }];
function setup(t, { create = createChoicePopup, rows = [defaults, ...suggestions, custom] } = {}) {
  const dom = new JSDOM('<body><main class="oats-view"><section class="spawn-dialog"><div class="soul-form"><div id="host"></div></div></section></main></body>');
  const doc = dom.window.document, host = doc.querySelector('#host'), selected = [], bubbled = [];
  let scope = 'runtime-A';
  const popup = create(doc, host, 'Model choices', 'fixture-models', () => rows, item => selected.push(item), {
    searchable: true, scope: () => scope, nothingReported: 'No model suggestions reported.', noMatch: 'No reported model suggestions match this filter.',
  });
  host.parentElement.addEventListener('keydown', e => { if (e.key === 'Enter' && e.metaKey && !e.defaultPrevented) bubbled.push('launch'); });
  t.after(() => { popup.dispose(); dom.window.close(); });
  return { dom, doc, host, popup, selected, bubbled, one: s => host.querySelector(s), options: () => [...host.querySelectorAll('[role=option]')],
    open: () => popup.trigger.click(), scope: value => { scope = value; }, rows: value => { rows = value; },
    search(value) { const input = host.querySelector('input'); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); },
    key(key, fields = {}, target = doc.activeElement) { const e = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...fields }); target.dispatchEvent(e); return e; } };
}

test('searchable reported choices group real data, keep the filter stable and consume selection before an outer launch', t => {
  const u = setup(t); u.open(); const input = u.one('input'); assert.equal(u.doc.activeElement, input);
  assert.equal(u.doc.getElementById(u.popup.trigger.getAttribute('aria-controls')).getAttribute('role'), 'listbox');
  assert.deepEqual([...u.host.querySelectorAll('[role=group]')].map(el => el.getAttribute('aria-label')), ['Defaults', 'Reported suggestions', 'Custom']);
  u.search('provider/one'); assert.equal(u.doc.activeElement, input); assert.equal(u.one('input'), input);
  assert.deepEqual(u.options().map(el => el.textContent), ['One modelprovider/one', 'Custom entry…']);
  const enter = u.key('Enter', { metaKey: true });
  assert.equal(enter.defaultPrevented, true); assert.deepEqual(u.bubbled, []); assert.equal(u.selected[0].value, 'provider/one');
  assert.equal(u.one('.spawn-choice-menu').hidden, true); assert.equal(u.doc.activeElement, u.popup.trigger);
});

test('space, repeated spaces, caret keys and IME remain text; Escape and Tab close only the popup', t => {
  const u = setup(t); u.open(); const input = u.one('input');
  for (const [key, fields] of [[' ', {}], [' ', { repeat: true }], ['Home', {}], ['End', {}], ['ArrowLeft', {}], ['a', { metaKey: true }], ['Enter', { isComposing: true }], ['Enter', { keyCode: 229 }]]) {
    assert.equal(u.key(key, fields, input).defaultPrevented, false, `${key} ${JSON.stringify(fields)}`);
  }
  u.key('Escape'); assert.equal(u.one('.spawn-choice-menu').hidden, true); assert.equal(u.doc.activeElement, u.popup.trigger);
  u.open(); u.key('Tab'); assert.equal(u.one('.spawn-choice-menu').hidden, true); assert.equal(u.doc.activeElement, u.popup.trigger);
});

test('nothing reported and no match differ; unmatched Enter cannot reset defaults or launch', t => {
  const u = setup(t, { rows: [defaults, custom] }); u.open();
  assert.match(u.one('[role=status]').textContent, /No model suggestions reported/);
  u.rows([defaults, ...suggestions, custom]); u.popup.refresh(); u.search('missing');
  assert.match(u.one('[role=status]').textContent, /No reported model suggestions match/);
  u.key('Enter', { metaKey: true }); assert.deepEqual(u.selected, []); assert.deepEqual(u.bubbled, []);
  u.key('ArrowDown'); assert.equal(u.doc.activeElement.textContent, 'Custom entry…'); u.key('Enter'); assert.equal(u.selected[0].custom, true);
});

test('custom preferences are not catalog membership; an unfiltered Enter preserves the selected custom choice', t => {
  const u = setup(t, { rows: [{ ...defaults, selected: false }, ...suggestions, { ...custom, selected: true, detail: 'unlisted/model,other:high' }] });
  u.open(); u.key('Enter'); assert.equal(u.selected[0].custom, true); assert.equal(u.selected[0].detail, 'unlisted/model,other:high');
});

test('filter/reopen removes authority from old controls; disabled or removed current choices cannot act', t => {
  const u = setup(t); u.open(); const old = u.options()[1];
  u.search('two'); old.dispatchEvent(new u.dom.window.Event('click')); assert.equal(u.selected.length, 0);
  u.popup.close(); u.open(); old.dispatchEvent(new u.dom.window.Event('click')); assert.equal(u.selected.length, 0);
  const current = u.options()[1]; u.rows([defaults, { ...suggestions[0], disabled: true }, custom]); current.click(); assert.equal(u.selected.length, 0);
  u.rows([defaults, custom]); current.click(); assert.equal(u.selected.length, 0);
});

test('refresh retains owned option focus or safely returns it to the same filter, without touching foreign focus', t => {
  const u = setup(t); u.open(); u.options()[1].focus(); u.popup.refresh();
  assert.equal(u.doc.activeElement.textContent, 'One modelprovider/one');
  u.rows([defaults, suggestions[1], custom]); u.popup.refresh(); assert.equal(u.doc.activeElement, u.one('input'));
  u.popup.trigger.focus(); u.popup.refresh(); assert.equal(u.doc.activeElement, u.popup.trigger);
});

test('keyboard navigation and retained-choice focus reveal within the popup below its search header, never scroll the page', t => {
  const u = setup(t); const menu = u.one('.spawn-choice-menu'), header = u.one('.spawn-popup-search');
  Object.defineProperty(menu, 'clientHeight', { value: 100 });
  const original = u.dom.window.HTMLElement.prototype.getBoundingClientRect;
  u.dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this === menu) return { top: 100 };
    if (this === header) return { bottom: 135 };
    if (this.matches('[role=option]')) { const top = 140 + u.options().indexOf(this) * 40 - menu.scrollTop; return { top, bottom: top + 36 }; }
    return original.call(this);
  };
  u.doc.documentElement.scrollTop = 23; u.open(); u.key('ArrowDown'); u.key('End');
  assert.equal(u.doc.activeElement.textContent, 'Custom entry…'); assert.equal(menu.scrollTop, 96);
  u.popup.refresh(); assert.equal(menu.scrollTop, 96); assert.equal(u.doc.activeElement.textContent, 'Custom entry…');
  u.key('Home'); assert.equal(menu.scrollTop, 5); assert.equal(u.doc.activeElement.textContent, 'Use resolved defaults');
  assert.equal(u.doc.documentElement.scrollTop, 23);
  u.popup.close(); u.open(); assert.equal(menu.scrollTop, 0); assert.equal(u.doc.activeElement, u.one('input'));
});

test('scope change, hidden owner and disposal block picks and focus reclamation', t => {
  const u = setup(t); u.open(); const old = u.options()[1]; u.scope('runtime-B'); old.click(); assert.equal(u.selected.length, 0);
  u.popup.refresh(); assert.equal(u.one('.spawn-choice-menu').hidden, true);
  u.open(); const button = u.options()[1]; u.host.style.display = 'none'; button.click(); assert.equal(u.selected.length, 0);
  u.host.style.display = ''; u.popup.dispose(); button.click(); u.popup.trigger.click(); assert.equal(u.selected.length, 0);
});

test('hostile option labels/details are text, not selectors, resources or attributes', t => {
  const hostile = `'"><img src=x onerror=evil()>[data-x='y']`;
  const u = setup(t, { rows: [{ value: hostile, label: hostile, detail: hostile, group: hostile }] }); u.open(); u.search("[data-x='y']");
  assert.equal(u.one('img,script,a'), null); u.key('Enter'); assert.equal(u.selected[0].value, hostile);
});

for (const guard of ['scope', 'epoch']) for (const weakened of [false, true]) test(`${guard} control ownership${weakened ? ' mutation detected' : ''}`, t => {
  let create = createChoicePopup;
  if (weakened) {
    const source = create.toString(), needle = guard === 'scope' ? 'openedScope !== scope() || !list.contains(button)' : 'mine !== epoch || ';
    assert.equal(source.split(needle).length, 2);
    create = runInNewContext(`(${source.replace(needle, guard === 'scope' ? '!list.contains(button)' : '')})`, { revealInScrollport });
  }
  const u = setup(t, { create }); u.open(); const old = u.options()[1];
  if (guard === 'scope') u.scope('runtime-B');
  else { u.popup.refresh(); u.one('[role=listbox]').append(old); }
  old.dispatchEvent(new u.dom.window.Event('click'));
  const refused = () => assert.equal(u.selected.length, 0);
  if (weakened) assert.throws(refused); else refused();
});

function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const c = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
for (const theme of ['light', 'solarized', 'dark']) test(`${theme}: popup uses reported-data chrome and opaque theme tokens`, t => {
  const u = setup(t), style = u.doc.createElement('style');
  style.textContent = readFileSync(new URL('../renderer/theme.css', import.meta.url), 'utf8') + spawnDialogCSS; u.doc.head.append(style); u.doc.documentElement.dataset.theme = theme;
  u.open();
  assert.equal(u.dom.window.getComputedStyle(u.one('.spawn-choice-menu')).boxShadow, 'var(--shadow-popover)');
  for (const selector of ['.spawn-popup-group', '.spawn-choice-menu small']) assert.equal(u.dom.window.getComputedStyle(u.one(selector)).color, 'var(--muted)');
  assert.equal(u.dom.window.getComputedStyle(u.one('input')).color, 'var(--fg)');
  assert.equal(u.dom.window.getComputedStyle(u.one('input')).height, '30px');
  assert.equal(u.dom.window.getComputedStyle(u.one('.spawn-popup-search')).position, 'sticky');
  const tokens = u.dom.window.getComputedStyle(u.doc.documentElement);
  for (const [selector, fg] of [['.spawn-popup-group', 'muted'], ['.spawn-choice-menu small', 'muted'], ['input', 'fg']]) {
    assert.equal(u.dom.window.getComputedStyle(u.one(selector)).color, `var(--${fg})`);
    assert.equal(u.dom.window.getComputedStyle(u.one('.spawn-choice-menu')).background, 'var(--surface)');
    const a = luminance(tokens.getPropertyValue(`--${fg}`).trim()), b = luminance(tokens.getPropertyValue('--surface').trim());
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5);
  }
  for (const el of u.host.querySelectorAll('*')) assert.equal(u.dom.window.getComputedStyle(el).opacity, '1');
});
