// The font picker (renderer/theme-picker.mjs createFontPicker, app.fontPicker): the theme picker's modal over
// the two fonts, Omarchy's font and System font (theme.mjs fontChoices). Mirrors test/theme-picker.test.mjs:
// inert jsdom, no Electron, storage or OS font.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { createFontPicker, createThemePicker } from '../renderer/theme-picker.mjs';
import { createPalette } from '../renderer/palette.mjs';
import { FONTS, THEMES, fontChoices } from '../renderer/theme.mjs';
import { registerAction, handleKeydown, setBinding, resetBinding } from '../renderer/keybindings.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, { current = 'omarchy', isMac = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><button id="opener">Font</button><input id="field"></body>', { pretendToBeVisual: true });
  const doc = dom.window.document, chosen = []; let font = current, listener = null;
  const picker = createFontPicker({ doc, fonts: fontChoices(isMac), current: () => font, choose: id => chosen.push(id),
    subscribe: fn => { listener = fn; return () => { listener = null; }; } });
  t.after(() => { picker.dispose(); dom.window.close(); });
  const opener = doc.getElementById('opener'); opener.focus();
  const key = (value, extra = {}, target = doc.activeElement) => {
    const event = new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event); return event;
  };
  return { dom, doc, picker, chosen, opener, key,
    overlays: () => doc.querySelectorAll('.font-picker-overlay'), rows: () => [...doc.querySelectorAll('.font-picker-overlay .theme-picker-row')],
    change(next) { font = next; listener?.(next); } };
}

test('open: one centred overlay, a labelled modal dialog named Font, the two fonts in order, the current one marked and focused', t => {
  const f = fixture(t, { current: 'system' });
  f.picker.open();
  assert.equal(f.overlays().length, 1);
  const overlay = f.overlays()[0];
  assert.ok(overlay.classList.contains('palette-overlay'), 'the shared modal backdrop (scrim, focus provenance)');
  assert.ok(overlay.classList.contains('theme-picker-overlay'), "the theme picker's centring and styles");
  const dialog = overlay.querySelector('[role="dialog"]');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  const title = f.doc.getElementById(dialog.getAttribute('aria-labelledby'));
  assert.ok(title && dialog.contains(title)); assert.equal(title.textContent, 'Font');
  assert.match(title.id, /^font-picker-title-/, "its own id, never the theme picker's");
  assert.equal(dialog.querySelector('.theme-picker-close').getAttribute('aria-label'), 'Close font picker');
  const rows = f.rows();
  assert.deepEqual(rows.map(row => row.dataset.choiceId), FONTS.map(font => font.id));
  assert.deepEqual(rows.map(row => row.querySelector('.theme-picker-label').textContent), ["Omarchy's font", 'System font']);
  assert.equal(rows[0].querySelector('.theme-picker-note').textContent, "This computer's monospace font");
  assert.equal(rows[1].querySelector('.theme-picker-note'), null, 'System font has no second line');
  assert.ok(rows.every(row => row.tagName === 'BUTTON' && row.type === 'button' && row.parentElement.tagName === 'LI'));
  assert.deepEqual(rows.map(row => row.getAttribute('aria-current')), [null, 'true']);
  assert.deepEqual(rows.map(row => /Current/.test(row.textContent)), [false, true], 'the visible word, not colour alone');
  assert.equal(f.doc.activeElement, rows[1], 'focus on the current row');
});

test('on macOS the Omarchy row is named by its face, JetBrains Mono, and says the terminals keep Inconsolata', t => {
  const f = fixture(t, { isMac: true });
  f.picker.open();
  const rows = f.rows();
  assert.deepEqual(rows.map(row => [row.dataset.choiceId, row.querySelector('.theme-picker-label').textContent, row.querySelector('.theme-picker-note')?.textContent ?? null]),
    [['omarchy', 'JetBrains Mono', 'Terminals keep Inconsolata'], ['system', 'System font', null]]);
  assert.equal(f.doc.activeElement, rows[0]);
});

for (const how of ['click', 'Enter', 'Space']) test(`choose by ${how}: choose(id) once, the dialog gone, focus back on the opener`, t => {
  const f = fixture(t);
  f.picker.open(); const system = f.rows()[1];
  if (how === 'click') system.click();
  else { system.focus(); const event = f.key(how === 'Enter' ? 'Enter' : ' '); assert.equal(event.defaultPrevented, true); }
  assert.deepEqual(f.chosen, ['system']);
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

test('arrows wrap, Home/End go to the ends, Tab / Shift+Tab never leave the dialog, and moving applies nothing', t => {
  const f = fixture(t);
  f.picker.open(); const rows = f.rows(), close = f.doc.querySelector('.theme-picker-close');
  const at = () => rows.indexOf(f.doc.activeElement);
  assert.equal(at(), 0);
  f.key('ArrowDown'); assert.equal(at(), 1);
  f.key('ArrowDown'); assert.equal(at(), 0, 'Down wraps to the first row');
  f.key('ArrowUp'); assert.equal(at(), 1, 'Up wraps to the last row');
  f.key('Home'); assert.equal(at(), 0); f.key('End'); assert.equal(at(), 1);
  assert.deepEqual(f.chosen, [], 'no preview');
  rows[1].focus(); assert.equal(f.key('Tab').defaultPrevented, true); assert.equal(f.doc.activeElement, close);
  assert.equal(f.key('Tab', { shiftKey: true }).defaultPrevented, true); assert.equal(f.doc.activeElement, rows[1]);
});

test('a font changed while open moves the marks only: the rows and focus stay', t => {
  const f = fixture(t);
  f.picker.open(); const rows = f.rows(); rows[1].focus();
  f.change('system');
  assert.deepEqual(f.rows(), rows, 'no rebuild under focus'); assert.equal(f.doc.activeElement, rows[1]);
  assert.deepEqual(rows.map(row => row.getAttribute('aria-current')), [null, 'true']);
});

// With the keymap engine and the shell's one window keydown listener present (Linux chords), and a chord given
// to the picker in the shortcuts editor (it has no default): Ctrl+Alt+Shift+Space here.
function withEngine(t, f, extra = []) {
  const offs = [
    registerAction({ id: 'sidebar.focusFilter', label: 'Focus the instance roster', context: 'global', run: () => f.doc.getElementById('field').focus() }),
    registerAction({ id: 'app.fontPicker', label: 'Font: choose…', context: 'global', run: e => { if (!e?.repeat) f.picker.toggle(); } }),
    ...extra,
  ];
  setBinding('app.fontPicker', 'Ctrl+Alt+Shift+Space');
  const listener = event => handleKeydown(event, { isMac: false });
  f.dom.window.addEventListener('keydown', listener);
  t.after(() => { offs.forEach(off => off()); resetBinding('app.fontPicker'); f.dom.window.removeEventListener('keydown', listener); });
  return { chord: (more = {}) => f.key(' ', { code: 'Space', ctrlKey: true, altKey: true, shiftKey: true, ...more }) };
}

test('a chord given to it opens and closes it; a held chord does nothing; Alt+F cannot take focus out', t => {
  const f = fixture(t), engine = withEngine(t, f);
  engine.chord(); assert.equal(f.overlays().length, 1, 'the chord opens it from the opener');
  const rows = f.rows(); rows[1].focus();
  assert.equal(f.key('f', { altKey: true }).defaultPrevented, true, 'the background action ran');
  assert.equal(f.doc.activeElement, rows[1], 'focus is pulled back to where it was in the picker');
  f.key('Escape'); assert.equal(f.overlays().length, 0); assert.equal(f.doc.activeElement, f.opener, 'Escape returns focus');
  engine.chord(); engine.chord({ repeat: true }); assert.equal(f.overlays().length, 1, 'a repeat neither closes nor reopens');
  engine.chord(); assert.equal(f.overlays().length, 0); assert.equal(f.doc.activeElement, f.opener);
  assert.deepEqual(f.chosen, []);
});

test('opened over the open theme picker it stacks above it, and closing returns focus to the theme row it came from', t => {
  const f = fixture(t);
  const themePicker = createThemePicker({ doc: f.doc, themes: THEMES, current: () => 'dark', choose: () => {} });
  t.after(() => themePicker.dispose());
  const engine = withEngine(t, f);
  themePicker.open();
  const themeRow = f.doc.activeElement;
  assert.equal(themeRow.dataset.choiceId, 'dark');
  engine.chord();
  assert.equal(f.overlays().length, 1); assert.ok(f.rows().includes(f.doc.activeElement), 'focus is in the font picker');
  assert.equal(themePicker.isOpen(), true, 'the theme picker stays open under it');
  f.key('Escape');
  assert.equal(f.overlays().length, 0); assert.equal(f.doc.activeElement, themeRow, 'back on the theme row');
  themePicker.close(); assert.equal(f.doc.activeElement, f.opener);
});

test('opened from the palette: the palette is gone, and closing returns to the original opener', async t => {
  const f = fixture(t), previous = globalThis.document;
  let palette;
  try {
    globalThis.document = f.doc;
    palette = createPalette({ loadInstances: async () => [], openTerminal: () => {},
      commands: [{ label: 'Font: choose…', run: () => f.picker.open() }] });
  } finally { globalThis.document = previous; }
  t.after(() => palette.close());
  await palette.open(); await tick();
  const input = f.doc.querySelector('.palette-input');
  input.value = '>font'; input.dispatchEvent(new f.dom.window.Event('input', { bubbles: true })); await tick();
  f.key('Enter', {}, input); await tick();
  assert.equal(f.doc.querySelector('.palette-input'), null, 'the palette is gone');
  assert.equal(f.doc.querySelectorAll('[aria-modal="true"]').length, 1, 'one modal: the picker');
  assert.equal(f.doc.activeElement, f.rows()[0]);
  f.key('Escape');
  assert.equal(f.overlays().length, 0); assert.equal(f.doc.activeElement, f.opener);
});

// With the real runtime (theme.mjs evaluated on its own, as theme-selection.test.mjs does).
test('no saved font: Omarchy\'s font is current and not stored; choosing System font stores it and marks it', t => {
  const source = readFileSync(new URL('../renderer/theme.mjs', import.meta.url), 'utf8');
  const dom = new JSDOM('<!doctype html><html><body><button id="opener">Font</button></body></html>');
  t.after(() => dom.window.close());
  let saved = null; const writes = [];
  const context = { document: dom.window.document, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    localStorage: { getItem: () => saved, setItem: (key, value) => { writes.push([key, value]); saved = value; } } };
  const theme = runInNewContext(`${source.replace(/\bexport /g, '')}\n({ initFont, currentFont, setFont, onFontChange, fontChoices })`, context);
  assert.equal(theme.initFont(false), 'omarchy'); assert.deepEqual(writes, [], 'the default is not stored');
  const doc = dom.window.document;
  const picker = createFontPicker({ doc, fonts: theme.fontChoices(false), current: theme.currentFont, choose: theme.setFont, subscribe: theme.onFontChange });
  t.after(() => picker.dispose());
  doc.getElementById('opener').focus(); picker.open();
  const rows = [...doc.querySelectorAll('.theme-picker-row')];
  assert.deepEqual(rows.map(row => row.getAttribute('aria-current')), ['true', null], "Omarchy's font is current");
  rows[1].click();
  assert.deepEqual(writes, [['oats.desktop.font', 'system']], 'stored, per computer, like the theme');
  assert.equal(theme.currentFont(), 'system');
  assert.equal(doc.activeElement, doc.getElementById('opener'));
  picker.open();
  assert.deepEqual([...doc.querySelectorAll('.theme-picker-row')].map(row => row.getAttribute('aria-current')), [null, 'true']);
});
