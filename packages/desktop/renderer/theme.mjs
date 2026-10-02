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
/** The terminal's default size: Inconsolata at 16px (the operator's decision,
 * 2026-10-02; spec F item 6). Mirrors --term-font-size. Every reset lands here. */
export const TERMINAL_FONT_SIZE = 16;
/** The range every size control clamps to (keys, palette, Settings). */
export const TERMINAL_FONT_MIN = 9, TERMINAL_FONT_MAX = 28;

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
   semantic CSS tokens (the bundled Inconsolata, then the OS monospace stack,
   at 16px by default). A stored family or size wins; the defaults apply only
   where nothing is stored. */
export function terminalTypography(el = document.documentElement) {
  const css = getComputedStyle(el);
  let family = css.getPropertyValue("--term-font-family").trim() || `"${BUNDLED_MONO}", ui-monospace, monospace`;
  let size = Number.parseFloat(css.getPropertyValue("--term-font-size")) || TERMINAL_FONT_SIZE;
  try {
    family = localStorage.getItem(TERM_FONT_KEY) || family;
    size = Number(localStorage.getItem(TERM_SIZE_KEY)) || size;
  } catch { /* storage-less */ }
  // xterm measures its cell from the font when a terminal is created, and again
  // only when the font option changes. Until the bundled face has loaded, hand
  // out the rest of the stack; once it has, listeners get the full family (a
  // real change, so every live terminal re-measures and refits).
  if (BUNDLED_FIRST.test(family) && !bundledMonoReady(el.ownerDocument)) {
    family = family.replace(BUNDLED_FIRST, "") || "ui-monospace, monospace";
  }
  // No line height: xterm's default (1.0) keeps native cell geometry (a block
  // cursor one cell tall); tmux owns row spacing (060de502).
  return { fontFamily: family, fontSize: clampTerminalFontSize(size) };
}

/** The bundled default monospace face (theme.css @font-face; fonts/README.md). */
export const BUNDLED_MONO = "Inconsolata";
const BUNDLED_FIRST = /^\s*(["']?)Inconsolata\1\s*(,\s*|$)/i;
let bundledMono = "unknown"; // "loading" | "ready"
/** Whether the bundled face can be measured now. The first miss starts its load;
 * when it settles (loaded, or failed: the stack then falls back as the browser
 * would) every terminal typography listener hears the full family. */
function bundledMonoReady(doc) {
  const fonts = doc?.fonts;
  if (bundledMono === "ready" || typeof fonts?.check !== "function") return true;
  try { if (fonts.check(`13px "${BUNDLED_MONO}"`)) { bundledMono = "ready"; return true; } } catch { return true; }
  if (bundledMono !== "loading") {
    bundledMono = "loading";
    Promise.resolve().then(() => fonts.load(`13px "${BUNDLED_MONO}"`)).catch(() => {})
      .then(() => { bundledMono = "ready"; notifyTerminalTypography(); });
  }
  return false;
}

function notifyTerminalTypography() {
  const value = terminalTypography();
  for (const fn of [...terminalListeners]) { try { fn(value); } catch { /* isolate listener */ } }
}
/** A whole pixel size within TERMINAL_FONT_MIN..MAX. Any finite number is
 * rounded and clamped (0, -3 and 0.4 all give the minimum); only an unreadable
 * value (missing, blank, not a number) falls back to the default. */
export function clampTerminalFontSize(size) {
  const n = typeof size === "number" ? size : typeof size === "string" && size.trim() !== "" ? Number(size) : NaN;
  if (!Number.isFinite(n)) return TERMINAL_FONT_SIZE;
  return Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, Math.round(n)));
}
export function setTerminalFontSize(size) {
  const value = clampTerminalFontSize(size);
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
/** Back to the defaults: forget the stored family and size, so the tokens
 * (and any later change to them) apply again instead of a pinned copy. */
export function resetTerminalTypography() {
  try { localStorage.removeItem(TERM_FONT_KEY); localStorage.removeItem(TERM_SIZE_KEY); } catch { /* storage-less */ }
  notifyTerminalTypography();
}
/** Settings' "Reset to default": the size only; a chosen family stays. */
export function resetTerminalFontSize() {
  try { localStorage.removeItem(TERM_SIZE_KEY); } catch { /* storage-less */ }
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
