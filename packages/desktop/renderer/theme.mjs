/* oats desktop — theme runtime.
   theme.css defines the semantic tokens (incl. the --ansi-* terminal set);
   this module owns switching (White by default regardless of OS, choices
   persisted under the SAME legacy key as the web panel) and derives the
   xterm.js theme object from the live tokens. */

const KEY = "oatsweb.theme"; // legacy key name kept so existing user prefs survive
export const THEMES = Object.freeze([
  Object.freeze({ id: "light", label: "White" }),
  Object.freeze({ id: "solarized", label: "Solarized" }),
  Object.freeze({ id: "dark", label: "Dark" }),
]);
const validTheme = name => THEMES.some(theme => theme.id === name);
const normalizeTheme = name => validTheme(name) ? name : "light";

const listeners = new Set();
const terminalListeners = new Set();
const TERM_FONT_KEY = "oats.desktop.terminal.fontFamily";
const TERM_SIZE_KEY = "oats.desktop.terminal.fontSize";

export function currentTheme() {
  return normalizeTheme(document.documentElement.dataset.theme);
}

// Non-persisting projection, retained for callers that apply a temporary theme.
export function applyTheme(name) {
  const next = normalizeTheme(name);
  document.documentElement.dataset.theme = next;
  for (const fn of [...listeners]) { try { fn(next); } catch { /* one listener must not break others */ } }
  return next;
}

export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage-less */ }
  // Intentionally no OS listener: fresh/invalid preferences always mean White.
  return applyTheme(saved);
}

export function setTheme(name) {
  const next = normalizeTheme(name);
  try { localStorage.setItem(KEY, next); } catch { /* choice still works in memory */ }
  return applyTheme(next);
}

// White → Solarized → Dark → White, independent of storage availability.
export function toggleTheme() {
  const index = THEMES.findIndex(theme => theme.id === currentTheme());
  return setTheme(THEMES[(index + 1) % THEMES.length].id);
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* tmux carries cells/colors, never the host terminal emulator's font. Keep
   desktop typography as an explicit persisted preference, seeded from
   semantic CSS tokens (OS monospace + 13px by default). */
export function terminalTypography(el = document.documentElement) {
  const css = getComputedStyle(el);
  let family = css.getPropertyValue("--term-font-family").trim() || "ui-monospace, monospace";
  let size = Number.parseFloat(css.getPropertyValue("--term-font-size")) || 13;
  try {
    family = localStorage.getItem(TERM_FONT_KEY) || family;
    size = Number(localStorage.getItem(TERM_SIZE_KEY)) || size;
  } catch { /* storage-less */ }
  return { fontFamily: family, fontSize: Math.min(28, Math.max(9, size)) };
}

function notifyTerminalTypography() {
  const value = terminalTypography();
  for (const fn of [...terminalListeners]) { try { fn(value); } catch { /* isolate listener */ } }
}
export function setTerminalFontSize(size) {
  const value = Math.min(28, Math.max(9, Number(size) || 13));
  try { localStorage.setItem(TERM_SIZE_KEY, String(value)); } catch { /* storage-less */ }
  notifyTerminalTypography();
}
export function setTerminalFontFamily(family) {
  const value = String(family || "").trim();
  try {
    if (value) localStorage.setItem(TERM_FONT_KEY, value);
    else localStorage.removeItem(TERM_FONT_KEY);
  } catch { /* storage-less */ }
  notifyTerminalTypography();
}
export function onTerminalTypographyChange(fn) {
  terminalListeners.add(fn);
  return () => terminalListeners.delete(fn);
}

/* Build the xterm.js theme object from the live CSS tokens so the embedded
   terminal always matches the app theme (incl. the solarized light remap). */
const ANSI = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "bright-black", "bright-red", "bright-green", "bright-yellow",
  "bright-blue", "bright-magenta", "bright-cyan", "bright-white",
];
export function xtermTheme(el = document.documentElement) {
  const css = getComputedStyle(el);
  const v = (name) => (css.getPropertyValue(name) || "").trim();
  const t = {
    background: v("--term-bg"),
    foreground: v("--term-fg"),
    cursor: v("--term-fg"),
    cursorAccent: v("--term-bg"),
    selectionBackground: v("--term-sel"),
    selectionForeground: v("--term-sel-fg"),
  };
  const camel = (s) => s.replace(/-(\w)/g, (m, c) => c.toUpperCase());
  for (const name of ANSI) {
    const val = v(`--ansi-${name}`);
    if (val) t[camel(name)] = val;
  }
  return t;
}
