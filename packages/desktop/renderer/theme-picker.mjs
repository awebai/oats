// oats desktop — the theme picker: a modal in the middle of the window that lists the
// themes (THEMES order), marks the current one, and applies a choice through the
// caller's `choose` (the shell passes setTheme, so it is stored like any choice).
// Built like lifecycle-dialog.mjs (the shared .palette-overlay backdrop, focus
// provenance through takePickerFocusReturn, its own Escape and Tab handling) with
// the spawn dialog's centring and header. Nothing is applied while moving between
// rows (no preview). The rows never rebuild while open: a theme changed by another
// path (the palette, a key, the host) only moves the marks.
import { takePickerFocusReturn } from './overlay-picker.mjs';
import { iconElement } from './shell-icons.mjs';

export const themePickerCSS = `
.palette-overlay.theme-picker-overlay { display:grid; place-items:center; padding:16px; }
.theme-picker { width:min(360px,calc(100vw - 32px)); max-height:calc(100vh - 32px); box-sizing:border-box; display:flex; flex-direction:column; border:1px solid var(--border); border-radius:12px; background:var(--surface); color:var(--fg); box-shadow:var(--shadow-modal); overflow:hidden; }
.theme-picker-head { min-height:52px; flex:none; display:flex; align-items:center; gap:10px; padding:0 12px 0 20px; border-bottom:1px solid var(--border); }
.theme-picker-head h2 { margin:0; font-size:15px; font-weight:700; }
.theme-picker-close { flex:none; margin-left:auto; width:28px; height:28px; display:grid; place-items:center; border:0; border-radius:6px; background:var(--surface); color:var(--muted); cursor:pointer; }
.theme-picker-close:hover { background:var(--surface-2); color:var(--fg); }
.theme-picker-close:focus-visible { background:var(--sel); color:var(--fg); }
.theme-picker-list { list-style:none; margin:0; padding:6px; overflow-y:auto; min-height:0; }
.theme-picker-row { width:100%; display:flex; align-items:center; gap:10px; padding:9px 10px; border:0; border-radius:7px; background:var(--surface); color:var(--fg); font:inherit; font-size:13px; text-align:left; cursor:pointer; }
.theme-picker-row:hover { background:var(--surface-2); }
.theme-picker-row:focus-visible { background:var(--sel); }
.theme-picker-text { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.theme-picker-note { color:var(--muted); font-size:12px; }
.theme-picker-current { flex:none; display:flex; align-items:center; gap:4px; color:var(--accent); font-size:12px; font-weight:600; }
`;

const plainKey = event => !event.ctrlKey && !event.metaKey && !event.altKey;

/**
 * @param {object} spec
 * @param {Document} spec.doc
 * @param {ReadonlyArray<{id: string, label: string}>} spec.themes  THEMES, in its order
 * @param {() => string} spec.current  the current choice's id (currentTheme)
 * @param {(id: string) => void} spec.choose  applies and stores a choice (setTheme)
 * @param {(fn: Function) => Function} [spec.subscribe]  onThemeChange; returns its unsubscribe
 * @param {() => void} [spec.onIntent]  opening is a user intent (the shell's selection ownership)
 * @param {(fn: Function) => void} [spec.applyFocus]  wraps every focus move the picker makes
 */
export function createThemePicker({ doc, themes, current, choose, subscribe = () => () => {},
  onIntent = () => {}, applyFocus = fn => fn() } = {}) {
  let overlay = null, rows = [], restore = null, life = 0;
  const node = (tag, text, cls) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const isOpen = () => !!overlay;

  function close({ restoreFocus = true } = {}) {
    if (!overlay) return;
    life++; overlay.remove(); overlay = null; rows = [];
    const opener = restore; restore = null;
    if (restoreFocus) applyFocus(() => opener?.restore());
  }

  /** The marks follow the current choice; the rows and focus stay as they are. */
  function mark() {
    let id = null;
    try { id = current(); } catch { /* no mark rather than a wrong one */ }
    for (const row of rows) {
      const isCurrent = row.dataset.themeId === id;
      const shown = row.querySelector('.theme-picker-current');
      if (isCurrent) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
      if (isCurrent && !shown) {
        const badge = node('span', undefined, 'theme-picker-current');
        badge.append(iconElement(doc, 'check', { size: 14 }), node('span', 'Current'));
        row.append(badge);
      } else if (!isCurrent && shown) shown.remove();
    }
  }

  function open() {
    if (overlay) return; // one dialog, never two
    onIntent(); restore = takePickerFocusReturn(doc); const mounted = ++life;
    overlay = node('div', undefined, 'palette-overlay theme-picker-overlay');
    const dialog = node('section', undefined, 'theme-picker'), titleId = `theme-picker-title-${mounted}`;
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', titleId);
    const head = node('div', undefined, 'theme-picker-head'), title = node('h2', 'Theme'); title.id = titleId;
    const closeButton = node('button', undefined, 'theme-picker-close'); closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close theme picker'); closeButton.append(iconElement(doc, 'close', { size: 14 }));
    head.append(title, closeButton);
    const list = node('ul', undefined, 'theme-picker-list');
    const owns = () => overlay && life === mounted;
    const pick = id => { if (!owns()) return; close(); choose(id); };
    rows = themes.map(({ id, label }) => {
      const item = node('li'), row = node('button', undefined, 'theme-picker-row'); row.type = 'button'; row.dataset.themeId = id;
      const text = node('span', undefined, 'theme-picker-text'); text.append(node('span', label, 'theme-picker-label'));
      if (id === 'host') text.append(node('span', "Follows this computer's theme", 'theme-picker-note'));
      row.append(text); row.addEventListener('click', () => pick(id));
      item.append(row); list.append(item); return row;
    });
    closeButton.addEventListener('click', () => { if (owns()) close(); });
    dialog.append(head, list); overlay.append(dialog);
    // The backdrop closes; the pointer's own focus move must not undo the focus return.
    const outside = event => { if (owns() && event.target === overlay) { event.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', outside); overlay.addEventListener('click', outside);
    overlay.addEventListener('keydown', event => {
      if (!owns()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key === 'Tab') {
        const stops = [closeButton, ...rows];
        if (event.shiftKey && doc.activeElement === stops[0]) { event.preventDefault(); stops.at(-1).focus(); }
        else if (!event.shiftKey && doc.activeElement === stops.at(-1)) { event.preventDefault(); stops[0].focus(); }
        else if (!stops.includes(doc.activeElement)) { event.preventDefault(); stops[0].focus(); }
        return;
      }
      // Modified keys (the opening chord among them) go on to the keymap engine.
      const at = rows.indexOf(event.target);
      if (at < 0 || !plainKey(event)) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); event.stopPropagation(); if (!event.repeat) pick(rows[at].dataset.themeId); return;
      }
      const to = { ArrowDown: (at + 1) % rows.length, ArrowUp: (at - 1 + rows.length) % rows.length, Home: 0, End: rows.length - 1 }[event.key];
      if (to === undefined) return;
      event.preventDefault(); event.stopPropagation(); rows[to].focus();
    });
    doc.body.append(overlay); mark();
    applyFocus(() => (rows.find(row => row.getAttribute('aria-current') === 'true') || rows[0])?.focus());
  }

  const toggle = () => { if (overlay) close(); else open(); };
  const off = subscribe(() => { if (overlay) mark(); });
  return { open, close, toggle, isOpen, dispose() { close({ restoreFocus: false }); off(); } };
}
