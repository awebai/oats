// The theme picker (renderer/theme-picker.mjs): a centred modal over the four themes.
// Inert jsdom, as test/lifecycle-dialog.test.mjs; no Electron, storage or OS theme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { createThemePicker, themePickerCSS } from '../renderer/theme-picker.mjs';
import { createPalette } from '../renderer/palette.mjs';
import { THEMES } from '../renderer/theme.mjs';
import { TEXT_PAIRS } from '../renderer/contrast-inventory.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, { current = 'dark' } = {}) {
  const dom = new JSDOM('<!doctype html><body><button id="opener">Theme</button><input id="field"></body>', { pretendToBeVisual: true });
  const doc = dom.window.document, chosen = []; let theme = current, listener = null;
  const picker = createThemePicker({ doc, themes: THEMES, current: () => theme, choose: id => chosen.push(id),
    subscribe: fn => { listener = fn; return () => { listener = null; }; } });
  t.after(() => { picker.dispose(); dom.window.close(); });
  const opener = doc.getElementById('opener'); opener.focus();
  const key = (value, extra = {}, target = doc.activeElement) => {
    const event = new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event); return event;
  };
  return { dom, doc, picker, chosen, opener, key,
    overlays: () => doc.querySelectorAll('.theme-picker-overlay'), rows: () => [...doc.querySelectorAll('.theme-picker-row')],
    change(next) { theme = next; listener?.(next); } };
}

test('open: one centred overlay, a labelled modal dialog, the four themes in order, the current one marked and focused', t => {
  const f = fixture(t);
  f.picker.open();
  assert.equal(f.overlays().length, 1);
  const overlay = f.overlays()[0];
  assert.ok(overlay.classList.contains('palette-overlay'), 'the shared modal backdrop (scrim, focus provenance)');
  const dialog = overlay.querySelector('[role="dialog"]');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  const title = f.doc.getElementById(dialog.getAttribute('aria-labelledby'));
  assert.ok(title && dialog.contains(title)); assert.equal(title.textContent, 'Theme');
  assert.equal(dialog.querySelector('.theme-picker-close').getAttribute('aria-label'), 'Close theme picker');
  const rows = f.rows();
  assert.deepEqual(rows.map(row => row.dataset.themeId), THEMES.map(theme => theme.id));
  assert.deepEqual(rows.map(row => row.querySelector('.theme-picker-label').textContent), ['White', 'Solarized', 'Dark', 'This computer']);
  assert.ok(rows.every(row => row.tagName === 'BUTTON' && row.type === 'button' && row.parentElement.tagName === 'LI'));
  assert.equal(rows[3].querySelector('.theme-picker-note').textContent, "Follows this computer's theme");
  assert.equal(rows.filter(row => row.querySelector('.theme-picker-note')).length, 1, 'only This computer has a second line');
  for (const row of rows) {
    const isCurrent = row.dataset.themeId === 'dark';
    assert.equal(row.getAttribute('aria-current'), isCurrent ? 'true' : null, row.dataset.themeId);
    assert.equal(/Current/.test(row.textContent), isCurrent, `${row.dataset.themeId}: the visible word, not colour alone`);
    assert.equal(!!row.querySelector('.theme-picker-current svg[aria-hidden="true"]'), isCurrent, 'the check icon');
  }
  assert.equal(f.doc.activeElement, rows[2], 'focus on the current row');
  // Centred like .spawn-modal, not the palette's top anchor; tokens only.
  assert.match(themePickerCSS, /\.palette-overlay\.theme-picker-overlay \{ display:grid; place-items:center;/);
  assert.match(themePickerCSS, /width:min\(360px,calc\(100vw - 32px\)\); max-height:calc\(100vh - 32px\)/, 'stays inside a small window');
  assert.doesNotMatch(themePickerCSS, /#[0-9a-f]{3,8}\b|rgb|hsl|opacity/i, 'no raw colour, no opacity');
});

for (const how of ['click', 'Enter', 'Space']) test(`choose by ${how}: choose(id) once, the dialog gone, focus back on the opener`, t => {
  const f = fixture(t);
  f.picker.open(); const solarized = f.rows()[1];
  if (how === 'click') solarized.click();
  else { solarized.focus(); const event = f.key(how === 'Enter' ? 'Enter' : ' '); assert.equal(event.defaultPrevented, true); }
  assert.deepEqual(f.chosen, ['solarized']);
  assert.equal(f.overlays().length, 0); assert.equal(f.picker.isOpen(), false);
  assert.equal(f.doc.activeElement, f.opener);
});

for (const how of ['Escape', 'close button', 'backdrop']) test(`${how} closes with nothing chosen and focus back on the opener`, t => {
  const f = fixture(t);
  f.picker.open();
  if (how === 'Escape') { const event = f.key('Escape'); assert.equal(event.defaultPrevented, true); }
  else if (how === 'close button') f.doc.querySelector('.theme-picker-close').click();
  else f.overlays()[0].dispatchEvent(new f.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(f.chosen, []); assert.equal(f.overlays().length, 0);
  assert.equal(f.doc.activeElement, f.opener);
});

test('a click inside the dialog but not on a row does not close it', t => {
  const f = fixture(t);
  f.picker.open();
  for (const target of [f.doc.querySelector('.theme-picker h2'), f.doc.querySelector('.theme-picker-list'), f.doc.querySelector('.theme-picker')]) {
    target.dispatchEvent(new f.dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new f.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  assert.equal(f.overlays().length, 1); assert.deepEqual(f.chosen, []);
});

test('arrows wrap, Home/End go to the ends, and Tab / Shift+Tab never leave the dialog', t => {
  const f = fixture(t);
  f.picker.open(); const rows = f.rows(), close = f.doc.querySelector('.theme-picker-close');
  const at = () => rows.indexOf(f.doc.activeElement);
  assert.equal(at(), 2);
  f.key('ArrowDown'); assert.equal(at(), 3);
  f.key('ArrowDown'); assert.equal(at(), 0, 'Down wraps to the first row');
  f.key('ArrowUp'); assert.equal(at(), 3, 'Up wraps to the last row');
  f.key('Home'); assert.equal(at(), 0); f.key('End'); assert.equal(at(), 3);
  assert.deepEqual(f.chosen, [], 'moving applies nothing (no preview)');
  const dialog = f.doc.querySelector('.theme-picker');
  rows[3].focus(); assert.equal(f.key('Tab').defaultPrevented, true); assert.equal(f.doc.activeElement, close, 'Tab from the last row wraps to the close button');
  assert.equal(f.key('Tab', { shiftKey: true }).defaultPrevented, true); assert.equal(f.doc.activeElement, rows[3], 'Shift+Tab from the close button wraps to the last row');
  for (const stop of [close, ...rows]) for (const shiftKey of [false, true]) {
    stop.focus(); f.key('Tab', { shiftKey }); assert.ok(dialog.contains(f.doc.activeElement), `Tab${shiftKey ? '+Shift' : ''} from ${stop.className}`);
  }
  assert.equal(f.overlays().length, 1);
});

test('modified keys and key repeat on a row choose nothing: the opening chord goes on to the keymap engine', t => {
  const f = fixture(t);
  f.picker.open(); const row = f.rows()[0]; row.focus();
  for (const mods of [{ ctrlKey: true, shiftKey: true }, { metaKey: true, shiftKey: true }, { ctrlKey: true }]) {
    const event = f.key(' ', { code: 'Space', ...mods });
    assert.equal(event.defaultPrevented, false, JSON.stringify(mods));
  }
  f.key('Enter', { repeat: true }); f.key(' ', { repeat: true });
  assert.deepEqual(f.chosen, []); assert.equal(f.overlays().length, 1);
});

test('toggle() opens then closes; open() twice is one dialog', t => {
  const f = fixture(t);
  f.picker.toggle(); assert.equal(f.overlays().length, 1); assert.equal(f.picker.isOpen(), true);
  f.picker.toggle(); assert.equal(f.overlays().length, 0); assert.equal(f.doc.activeElement, f.opener);
  f.picker.open(); const rows = f.rows(); f.picker.open();
  assert.equal(f.overlays().length, 1); assert.equal(f.doc.querySelectorAll('[aria-modal="true"]').length, 1);
  assert.deepEqual(f.rows(), rows, 'the same rows, not a second build');
  f.picker.close(); assert.equal(f.doc.activeElement, f.opener, 'the opener survives a second open()');
});

test('a theme changed while open moves the marks only: the rows and focus stay', t => {
  const f = fixture(t);
  f.picker.open(); const rows = f.rows(); rows[0].focus();
  f.change('host');
  assert.deepEqual(f.rows(), rows, 'no rebuild under focus');
  assert.equal(f.doc.activeElement, rows[0], 'focus stays where it is');
  assert.deepEqual(rows.map(row => row.getAttribute('aria-current')), [null, null, null, 'true']);
  assert.deepEqual(rows.map(row => /Current/.test(row.textContent)), [false, false, false, true]);
  assert.equal(f.doc.querySelectorAll('.theme-picker-current').length, 1);
  f.picker.close(); f.change('light'); assert.equal(f.overlays().length, 0, 'a change while closed builds nothing');
});

test('opened from the palette: the palette and its focus trap are gone, and closing returns to the original opener', async t => {
  const f = fixture(t), previous = globalThis.document;
  let palette;
  try {
    globalThis.document = f.doc;
    palette = createPalette({ loadInstances: async () => [], openTerminal: () => {},
      commands: [{ label: 'Theme: choose…', run: () => f.picker.open() }] });
  } finally { globalThis.document = previous; }
  t.after(() => palette.close());
  await palette.open(); await tick();
  const input = f.doc.querySelector('.palette-input');
  input.value = '>theme'; input.dispatchEvent(new f.dom.window.Event('input', { bubbles: true })); await tick();
  f.key('Enter', {}, input); await tick();
  assert.equal(f.doc.querySelector('.palette-input'), null, 'the palette is gone');
  assert.equal(f.doc.querySelectorAll('[aria-modal="true"]').length, 1, 'one modal: the picker');
  assert.equal(f.doc.activeElement, f.rows()[2]);
  f.doc.getElementById('field').focus();
  assert.equal(f.doc.activeElement.id, 'field', 'no palette focus trap pulls focus back');
  f.rows()[2].focus(); f.key('Escape');
  assert.equal(f.overlays().length, 0); assert.equal(f.doc.activeElement, f.opener, 'focus back on what had it before the palette');
});

test('the painted text and focus pairs are inventoried tokens (held to AA in every theme by theme-contrast.test.mjs)', t => {
  const dom = new JSDOM('<!doctype html><body></body>'), doc = dom.window.document;
  t.after(() => dom.window.close());
  const style = doc.createElement('style'); style.textContent = themePickerCSS; doc.head.append(style);
  const picker = createThemePicker({ doc, themes: THEMES, current: () => 'host', choose: () => {} });
  t.after(() => picker.dispose());
  picker.open();
  const css = el => dom.window.getComputedStyle(el), value = v => v.match(/^var\(--([a-z0-9-]+)\)$/)?.[1];
  const pairs = [];
  const row = doc.querySelector('.theme-picker-row[aria-current]'), close = doc.querySelector('.theme-picker-close');
  pairs.push([value(css(doc.querySelector('.theme-picker')).color), value(css(doc.querySelector('.theme-picker')).background)]);
  pairs.push([value(css(row).color), value(css(row).background)]);
  pairs.push([value(css(row.querySelector('.theme-picker-note')).color), value(css(row).background)]);
  pairs.push([value(css(row.querySelector('.theme-picker-current')).color), value(css(row).background)]);
  pairs.push([value(css(close).color), value(css(close).background)]);
  const rule = selector => [...doc.styleSheets[0].cssRules].find(r => r.selectorText === selector)?.style;
  const focusBg = value(rule('.theme-picker-row:focus-visible').background), hoverBg = value(rule('.theme-picker-row:hover').background);
  for (const bg of [focusBg, hoverBg]) for (const fg of ['fg', 'muted', 'accent']) pairs.push([fg, bg]);
  pairs.push([value(rule('.theme-picker-close:focus-visible').color), value(rule('.theme-picker-close:focus-visible').background)]);
  for (const [fg, bg] of pairs) {
    assert.ok(fg && bg, `token pair: ${fg} on ${bg}`);
    assert.ok(TEXT_PAIRS.some(([f, b]) => f === fg && b === bg), `${fg} on ${bg} is in the contrast inventory`);
  }
});

// With the real theme runtime (as theme-selection.test.mjs evaluates it): the Linux default since #637.
test('no saved theme and the "host" fallback: This computer is marked current, and choosing it stores host', t => {
  const source = readFileSync(new URL('../renderer/theme.mjs', import.meta.url), 'utf8');
  const dom = new JSDOM('<!doctype html><html data-theme="light"><body><button id="opener">Theme</button></body></html>');
  t.after(() => dom.window.close());
  let saved = null; const writes = [];
  const context = { document: dom.window.document, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    localStorage: { getItem: () => saved, setItem: (key, value) => { writes.push([key, value]); saved = value; } } };
  const theme = runInNewContext(`${source.replace(/\bexport /g, '')}\n({ THEMES, initTheme, currentTheme, setTheme, onThemeChange })`, context);
  assert.equal(theme.initTheme(null, 'host'), 'host'); assert.deepEqual(writes, [], 'the default is not stored');
  const doc = dom.window.document;
  const picker = createThemePicker({ doc, themes: theme.THEMES, current: theme.currentTheme, choose: theme.setTheme, subscribe: theme.onThemeChange });
  t.after(() => picker.dispose());
  doc.getElementById('opener').focus(); picker.open();
  const rows = [...doc.querySelectorAll('.theme-picker-row')];
  assert.deepEqual(rows.map(row => row.getAttribute('aria-current')), [null, null, null, 'true'], 'This computer is current');
  assert.equal(doc.activeElement, rows[3]);
  rows[3].click();
  assert.deepEqual(writes, [['oatsweb.theme', 'host']], 'stored like any choice');
  assert.equal(theme.currentTheme(), 'host');
  // Storage that throws: the choice still applies in memory and the picker shows it.
  context.localStorage.setItem = () => { throw new Error('storage full'); };
  picker.open(); doc.querySelectorAll('.theme-picker-row')[2].click();
  assert.equal(theme.currentTheme(), 'dark');
  picker.open();
  assert.deepEqual([...doc.querySelectorAll('.theme-picker-row')].map(row => row.getAttribute('aria-current')), [null, null, 'true', null]);
});
