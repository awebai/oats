/* oats desktop — theme runtime.
   theme.css defines the semantic tokens (incl. the --ansi-* terminal set);
   this module owns switching (a saved choice, else the default the shell
   passes: "This computer" on Linux, White elsewhere; choices persisted under
   the SAME legacy key as the web panel) and derives the xterm.js theme object
   from the live tokens.

   "This computer" (`host`) is a choice, not a palette: what it shows is a
   built-in theme as base (Dark or White, on data-theme, so theme.css applies
   as it does for that theme) plus token overrides set inline on the root. The
   host source (host-theme.mjs) says which; the shell hands it to initTheme(),
   because this module imports nothing (tests evaluate its source on its own). */

const KEY = "oatsweb.theme"; // legacy key name kept so existing user prefs survive
const HOST = "host";
export const THEMES = Object.freeze([
  Object.freeze({ id: "light", label: "White" }),
  Object.freeze({ id: "solarized", label: "Solarized" }),
  Object.freeze({ id: "dark", label: "Dark" }),
  Object.freeze({ id: HOST, label: "This computer" }),
]);
const validTheme = name => THEMES.some(theme => theme.id === name);
const normalizeTheme = name => validTheme(name) ? name : "light";

const listeners = new Set();
const terminalListeners = new Set();
const TERM_FONT_KEY = "oats.desktop.terminal.fontFamily";
const TERM_SIZE_KEY = "oats.desktop.terminal.fontSize";
/** The terminal's default size: Inconsolata at 15px (the operator's decision,
 * 2026-10-02; spec F item 6). Mirrors --term-font-size. Every reset lands here. */
export const TERMINAL_FONT_SIZE = 15;
/** The range every size control clamps to (keys, palette, Settings). */
export const TERMINAL_FONT_MIN = 9, TERMINAL_FONT_MAX = 28;

let hostSource = null;   // { mode(), tokens(base), shown(chosen) }, from initTheme
let hostChosen = false;  // the choice is "This computer"; data-theme then carries its base
let hostOverrides = [];  // the inline custom properties the host theme set

/** The choice: a built-in theme, or `host`. */
export function currentTheme() {
  return hostChosen ? HOST : appliedTheme();
}

/** The built-in theme on data-theme (the CSS hook): the choice itself, or the
 * base "This computer" is shown on. */
export function appliedTheme() {
  const name = normalizeTheme(document.documentElement.dataset.theme);
  return name === HOST ? "light" : name;
}

// Non-persisting projection, retained for callers that apply a temporary theme.
export function applyTheme(name) {
  const next = normalizeTheme(name);
  const root = document.documentElement;
  // Every override goes before anything is set, so a built-in theme chosen
  // after "This computer" is exactly what it is on its own.
  for (const property of hostOverrides) root.style.removeProperty(property);
  hostOverrides = [];
  hostChosen = next === HOST;
  if (!hostChosen) root.dataset.theme = next;
  else {
    // The whole map is derived before any of it is set: no override at all
    // when the host has no palette or it cannot be used, never half of one.
    let base = "light", tokens = null;
    try {
      base = hostSource?.mode() === "dark" ? "dark" : "light";
      root.dataset.theme = base;
      const css = getComputedStyle(root);
      tokens = hostSource?.tokens(token => css.getPropertyValue(`--${token}`).trim()) ?? null;
    } catch { root.dataset.theme = base; tokens = null; }
    for (const [property, value] of Object.entries(tokens ?? {})) { root.style.setProperty(property, value); hostOverrides.push(property); }
  }
  try { hostSource?.shown(hostChosen); } catch { /* the theme is applied either way */ }
  for (const fn of [...listeners]) { try { fn(next); } catch { /* one listener must not break others */ } }
  return next;
}

export function initTheme(host = null, fallback = "light") {
  hostSource = host;
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage-less */ }
  // A fresh/invalid preference means `fallback`, the platform's default (the
  // shell passes it: "This computer" on Linux, White elsewhere; anything that
  // is not a theme is White). Intentionally no OS listener, and nothing is
  // stored: the default stays a default until the user chooses.
  return applyTheme(validTheme(saved) ? saved : fallback);
}

export function setTheme(name) {
  const next = normalizeTheme(name);
  try { localStorage.setItem(KEY, next); } catch { /* choice still works in memory */ }
  return applyTheme(next);
}

// White → Solarized → Dark → This computer → White, independent of storage availability.
export function toggleTheme() {
  const index = THEMES.findIndex(theme => theme.id === currentTheme());
  return setTheme(THEMES[(index + 1) % THEMES.length].id);
}

/** The host's theme changed: show it again while "This computer" is the choice
 * (one pass over the properties, then one notification to the listeners). */
export function refreshHostTheme() {
  if (hostChosen) applyTheme(HOST);
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* tmux carries cells/colors, never the host terminal emulator's font. Keep
   desktop typography as an explicit persisted preference, seeded from
   semantic CSS tokens (the bundled Inconsolata, then the OS monospace stack,
   at 15px by default). A stored family or size wins; the defaults apply only
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

/** xterm's `normal`: the weight when the theme names none, or an unusable one. */
export const TERMINAL_FONT_WEIGHT = 400;
/** The terminal's text weight: the theme's --term-font-weight, not a typography
 * preference (why: renderer/README.md, the typography paragraph). */
export function terminalFontWeight(el = document.documentElement) {
  const weight = Number(getComputedStyle(el).getPropertyValue("--term-font-weight"));
  return Number.isFinite(weight) && weight >= 1 && weight <= 1000 ? weight : TERMINAL_FONT_WEIGHT;
}
