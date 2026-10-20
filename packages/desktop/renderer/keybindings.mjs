// oats desktop — keybinding engine (pure logic; unit-tested without a DOM).
//
// One shared registry: the shell/wiring code registers actions
// ({ id, label, context, run }); this module owns chord parsing, the default
// keymap, user overrides (localStorage), context scoping, and dispatch.
//
// Terminal safety (the rule: a default chord never takes a key a program inside
// the terminal reads). When the keydown target is inside `.xterm`, on macOS ONLY
// chords whose `Mod` resolves to ⌘ (meta) may fire — ⌘ never reaches the pty —
// plus two shapes named by action id, Ctrl+Tab tab cycling and the leader's ⌃\;
// every other chord (⌃digits, F6, Ctrl+letters) belongs to the attached program.
// On Linux/Windows the Ctrl key IS the terminal's control key, so only an explicit allowlist of action ids may
// fire inside the terminal; every other chord passes through. Their defaults
// there are chords xterm sends nothing for (Ctrl+Shift+key, the GNOME Terminal /
// Alacritty / Ghostty / kitty convention) or a byte a plainer key still sends (the
// shared Ctrl+Alt family: ESC, then the Ctrl+letter byte or the digit), and two named
// exceptions (TERMINAL_ALLOWLIST has the rule), so plain Ctrl+letter (Ctrl+W, Ctrl+K,
// Ctrl+P, Ctrl+B, Ctrl+\), F6 and Alt+digit stay the program's. app-menu.mjs follows the
// same policy for the menu accelerators.
// docs/desktop-keyboard.md is the keymap's reference.
//
// The leader, the plain keys and the chords the Desktop shares with the TUI are written down once,
// in packages/client/keymap.mjs: DEFAULT_KEYMAP reads app.leader, the sidebar.key.* defaults and
// the chords of CHORDS_READ from there (chordFromKeyId), never a literal of its own.

import { CHORDS, LEADER, PLAIN_KEYS } from "../../client/keymap.mjs";

const STORAGE_KEY = "oats-desktop-keymap";

// ---------------------------------------------------------------- chords

const MOD_ORDER = ["Mod", "Ctrl", "Alt", "Shift"];

// e.key values normalized so layouts/shift variants land on one spelling.
const KEY_ALIASES = new Map([
  ["pgdn", "pagedown"], ["pgup", "pageup"],
  ["esc", "escape"],
  [" ", "space"],
  ["spacebar", "space"],
  // An arrow's stored spelling is its label (chordToString: "Alt+Shift+↑"), read back as the key.
  ["↑", "arrowup"], ["↓", "arrowdown"], ["←", "arrowleft"], ["→", "arrowright"],
]);
// Only for a chord that holds Mod, Ctrl or Alt: there the shifted character names its key.
// A plain chord keeps its own character, so a plain `|` never fires on a plain `\`.
const MODIFIED_ALIASES = new Map([
  ["+", "="], // Shift-= / numpad plus both mean the "=" binding (Mod+=)
  ["|", "\\"], // Shift-\ produces "|" — both mean the "\" binding (Mod+Shift+\)
]);

/** A key as a chord holding a modifier names it (the aliases of both tables). */
export function normalizeKey(key) {
  const k = String(key || "").toLowerCase();
  const base = KEY_ALIASES.get(k) || k;
  return MODIFIED_ALIASES.get(base) || base;
}

const baseKey = (key) => { const k = String(key || "").toLowerCase(); return KEY_ALIASES.get(k) || k; };

/** One printable character that is not a letter (`?`, `|`, `[`, `/`, a digit): a plain chord on
 * such a key matches whatever Shift the layout needed to type it, so it never carries Shift
 * (`KeyboardEvent.key` already holds the shift). Letters keep their case: `N` is Shift+N. */
const shiftFreeKey = (key) => [...key].length === 1 && !/\p{L}/u.test(key) && /\S/u.test(key);

/** The chord's own spelling of its key, and Shift dropped where the rule above says so. */
function settleChord(chord) {
  if (chord.mod || chord.ctrl || chord.alt) chord.key = MODIFIED_ALIASES.get(chord.key) || chord.key;
  else if (shiftFreeKey(chord.key)) chord.shift = false;
  return chord;
}

/** Parse "Mod+Shift+K" → { key, mod, ctrl, alt, shift } or null. */
export function parseChord(str) {
  if (!str || typeof str !== "string") return null;
  const parts = str.split("+");
  // "Mod+=" splits as ["Mod", "", ""] — rejoin a trailing empty pair as "+".
  if (parts.length >= 2 && parts[parts.length - 1] === "" && parts[parts.length - 2] === "") {
    parts.splice(parts.length - 2, 2, "+");
  }
  const chord = { key: "", mod: false, ctrl: false, alt: false, shift: false };
  for (const raw of parts) {
    const p = raw.trim().toLowerCase();
    if (p === "mod" || p === "cmdorctrl" || p === "cmd" || p === "meta") chord.mod = true;
    else if (p === "ctrl" || p === "control") chord.ctrl = true;
    else if (p === "alt" || p === "option") chord.alt = true;
    else if (p === "shift") chord.shift = true;
    else if (p) {
      if (chord.key) return null; // two non-modifier keys — invalid
      chord.key = baseKey(p);
    }
  }
  if (!chord.key) return null;
  return settleChord(chord);
}

const KEY_LABELS = new Map([
  ["escape", "Esc"], ["arrowup", "↑"], ["arrowdown", "↓"],
  ["arrowleft", "←"], ["arrowright", "→"], ["space", "Space"],
  ["tab", "Tab"], ["enter", "Enter"], ["backspace", "Backspace"],
  ["pagedown", "PgDn"], ["pageup", "PgUp"],
]);

function keyLabel(key) {
  return KEY_LABELS.get(key) || (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
}

/** The keys of a chord (object or string) as shown, one label per key, in the order
 * they are written: ["⇧", "⌘", "B"] on mac, ["Ctrl", "Shift", "B"] elsewhere. */
export function chordKeys(chord, isMac = defaultIsMac()) {
  const c = typeof chord === "string" ? parseChord(chord) : chord;
  if (!c) return [];
  const keys = [];
  if (isMac) {
    if (c.ctrl) keys.push("⌃");
    if (c.alt) keys.push("⌥");
    if (c.shift) keys.push("⇧");
    if (c.mod) keys.push("⌘");
  } else {
    if (c.mod || c.ctrl) keys.push("Ctrl");
    if (c.alt) keys.push("Alt");
    if (c.shift) keys.push("Shift");
  }
  keys.push(keyLabel(c.key));
  return keys;
}

/** Human label for a chord (object or string). Mod = ⌘ on mac, Ctrl elsewhere. */
export function formatChord(chord, isMac = defaultIsMac()) {
  return chordKeys(chord, isMac).join(isMac ? "" : "+");
}

/** Canonical storage/comparison string for a chord object. */
export function chordToString(chord) {
  const c = typeof chord === "string" ? parseChord(chord) : chord;
  if (!c) return null;
  const parts = [];
  if (c.mod) parts.push("Mod");
  if (c.ctrl) parts.push("Ctrl");
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("Shift");
  parts.push(c.key === "=" ? "=" : keyLabel(c.key));
  return parts.join("+");
}

/** Build a chord object from a keydown event (for the recorder + matching).
 * On mac, metaKey is `Mod`; elsewhere ctrlKey is `Mod` (never both). */
export function chordFromEvent(e, isMac = defaultIsMac()) {
  const key = baseKey(e.key);
  if (!key || ["meta", "control", "alt", "shift"].includes(key)) return null;
  const chord = { key, mod: false, ctrl: false, alt: !!e.altKey, shift: !!e.shiftKey };
  if (isMac) {
    chord.mod = !!e.metaKey;
    chord.ctrl = !!e.ctrlKey;
  } else {
    chord.mod = !!e.ctrlKey; // Ctrl plays the Mod role; explicit meta ignored
  }
  return settleChord(chord);
}

const NAMED_KEY_IDS = new Map([
  ["up", "ArrowUp"], ["down", "ArrowDown"], ["left", "ArrowLeft"], ["right", "ArrowRight"],
  ["escape", "Escape"], ["space", "Space"], ["enter", "Enter"], ["tab", "Tab"],
  ["home", "Home"], ["end", "End"], ["pageup", "PageUp"], ["pagedown", "PageDown"],
]);

/** A key id of the shared keymap (packages/client/keymap.mjs, the TUI's spelling: `alt+o`,
 * `ctrl+\\`, `N`, `?`, `ctrl+alt+shift+e`, `alt+shift+up`, and `cmd+` for ⌘) as this engine's
 * canonical chord string (`Alt+O`, `Ctrl+\\`, `Shift+N`, `?`, `Ctrl+Alt+Shift+E`, `Alt+Shift+↑`,
 * `Mod+K`). */
export function chordFromKeyId(keyId) {
  let rest = String(keyId || "");
  const chord = { key: "", mod: false, ctrl: false, alt: false, shift: false };
  for (;;) {
    if (rest.startsWith("cmd+") && rest.length > 4) { chord.mod = true; rest = rest.slice(4); }
    else if (rest.startsWith("ctrl+") && rest.length > 5) { chord.ctrl = true; rest = rest.slice(5); }
    else if (rest.startsWith("alt+") && rest.length > 4) { chord.alt = true; rest = rest.slice(4); }
    else if (rest.startsWith("shift+") && rest.length > 6) { chord.shift = true; rest = rest.slice(6); }
    else break;
  }
  if (NAMED_KEY_IDS.has(rest)) chord.key = baseKey(NAMED_KEY_IDS.get(rest));
  else if ([...rest].length === 1) {
    chord.key = rest.toLowerCase();
    chord.shift ||= rest !== chord.key; // a capital letter is Shift and the letter
  } else return null;
  return chordToString(settleChord(chord));
}

/** Platform-concrete equality: does `chord` (with Mod) match the event chord? */
function chordMatches(chord, evChord, isMac) {
  if (!chord || !evChord) return false;
  if (chord.key !== evChord.key || chord.alt !== evChord.alt || chord.shift !== evChord.shift) return false;
  if (isMac) return chord.mod === evChord.mod && chord.ctrl === evChord.ctrl;
  // non-mac: Mod and Ctrl are the same physical modifier
  return (chord.mod || chord.ctrl) === (evChord.mod || evChord.ctrl);
}

function defaultIsMac() {
  try {
    return /mac/i.test(navigator.platform || "");
  } catch { return false; }
}

/** True when the event target is a real editable control — plain-key chords
 * must not steal typing (mirrors the panel's logical key-routing lesson). */
function isEditableTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!target.isContentEditable;
}

// ---------------------------------------------------------------- defaults

// One entry per action: a chord string (the same on every platform, `Mod` = ⌘ on
// macOS and Ctrl elsewhere) or `{ mac, other }` when the platforms differ (null =
// no default there). Principles (docs/desktop-keyboard.md): Super/Meta belongs to
// the window manager on Linux, so `Mod` is Ctrl there and nothing binds Super;
// a chord that must work while a terminal has focus is one xterm.js sends no byte
// for on Linux/Windows, or a byte the program still gets from a plainer key
// (TERMINAL_ALLOWLIST has the rule), because plain Ctrl+letter belongs to the
// program; macOS keeps ⌘, which never reaches the pty. Every default passed the collision review in the
// keyboard lesson, shifted punctuation included (KEY_ALIASES, tested with the
// real shifted event). Action ids never change, so stored overrides survive.
//
// The sidebar's plain keys (context `sidebar`): one action per key of the shared PLAIN_KEYS that
// the Desktop reads in the sidebar, each with the `does` its default comes from. The tree keys
// (up/down/top/bottom/page/collapse/expand) stay DOM-local in roster-keys.mjs; `open` is the
// row's own Enter.
export const SIDEBAR_KEYS = Object.freeze([
  ["sidebar.key.instances", "instances"], ["sidebar.key.souls", "souls"], ["sidebar.key.capabilities", "capabilities"],
  ["sidebar.key.workspaces", "workspaces"], ["sidebar.key.filter", "filter"], ["sidebar.key.refresh", "refresh"],
  ["sidebar.key.zoom", "zoom"], ["sidebar.key.closeTerminal", "close-terminal"],
  ["sidebar.key.tabPrevious", "tab-previous"], ["sidebar.key.tabNext", "tab-next"],
  ["sidebar.key.splitRight", "split-right"], ["sidebar.key.splitDown", "split-down"],
  ["sidebar.key.stop", "stop"], ["sidebar.key.retire", "retire"], ["sidebar.key.start", "start"], ["sidebar.key.restart", "restart"],
  ["sidebar.key.spawn", "spawn"], ["sidebar.key.spawnAnother", "spawn-another"], ["sidebar.key.help", "help"],
].map(([id, does]) => Object.freeze({ id, does })));

const plainDefault = (does) => chordFromKeyId(PLAIN_KEYS.find((entry) => entry.does === does)?.keys[0]) ?? null;

// The chords the Desktop shares with the TUI (packages/client/keymap.mjs CHORDS), by the action that
// reads each and its `does`, in the table's order. One string where both platforms have the same
// chord. The shared tab moves are the second tab-cycling chords (tabs.prevPage, tabs.nextPage):
// Ctrl+Tab and Ctrl+Shift+Tab stay the Desktop's own (tabs.next, tabs.prev). The leader's ↑ ↓ z
// have actions of their own here (roster.openPrevious, roster.openNext, terminal.zoom: shell.mjs),
// which run what the leader then that key runs.
export const CHORDS_READ = Object.freeze([
  ["app.palette", "palette"], ["app.quickOpenSouls", "spawn"], ["app.workspaces", "workspaces"],
  ["roster.openPrevious", "previous"], ["roster.openNext", "next"],
  ["tabs.prevPage", "tab-previous"], ["tabs.nextPage", "tab-next"],
  ...Array.from({ length: 9 }, (_, i) => [`tabs.goto${i + 1}`, `tab-${i + 1}`]),
  ["terminal.zoom", "zoom"], ["tabs.close", "close-terminal"],
  ["split.vertical", "split-right"], ["split.horizontal", "split-down"], ["split.focusNextGroup", "group-next"],
  ["sidebar.focusFilter", "filter"],
].map(([id, does]) => Object.freeze({ id, does })));
function chordDefault(does) {
  const entry = CHORDS.find((each) => each.does === does);
  const mac = chordFromKeyId(entry.mac), other = chordFromKeyId(entry.other);
  return mac === other ? mac : { mac, other };
}
const chordOf = (id) => chordDefault(CHORDS_READ.find((each) => each.id === id).does);

export const DEFAULT_KEYMAP = Object.freeze({
  // The leader (docs/desktop-keyboard.md, "The leader"): the TUI's, read from the shared keymap.
  // Ctrl+\ on macOS fires in a terminal by name (macStructuralChord); Alt+O on Linux/Windows is
  // terminal-allowlisted (it sends ESC o, which the program still gets from Esc, then o).
  "app.leader": { mac: chordFromKeyId(LEADER.mac), other: chordFromKeyId(LEADER.other) },
  ...Object.fromEntries(SIDEBAR_KEYS.map(({ id, does }) => [id, plainDefault(does)])),
  // The leader's Tab, as a chord (CHORDS group-next).
  "split.focusNextGroup": chordOf("split.focusNextGroup"),
  // The shared chords on Linux/Windows are Ctrl+Alt+letter (Ctrl+Alt+K, Ctrl+Alt+P, Ctrl+Alt+O):
  // plain Ctrl+K and Ctrl+P are bytes a program reads (readline's kill-line, shell history), and
  // what xterm sends for the Ctrl+Alt chord, ESC then that byte, the program still gets from Esc,
  // then Ctrl+K. On Windows the same chord is AltGr: where the layout types a character on it, the
  // event carries that character and matches no chord (docs/desktop-keyboard.md).
  "app.palette": chordOf("app.palette"),
  "app.quickOpenSouls": chordOf("app.quickOpenSouls"),
  "app.workspaces": chordOf("app.workspaces"),
  // The leader's ↑ / ↓ / z, as chords: Alt+Shift+↑/↓ (a named exception of the terminal rule) and
  // Ctrl+Alt+Z on Linux/Windows, ⌘⌥↑/↓ and ⌘⌥Z on macOS.
  "roster.openPrevious": chordOf("roster.openPrevious"),
  "roster.openNext": chordOf("roster.openNext"),
  "terminal.zoom": chordOf("terminal.zoom"),
  "app.chooseSoul": { mac: "Mod+N", other: "Ctrl+Shift+N" },
  "app.shortcuts": "Mod+,",
  // No default (spec F): ⌘⇧T is "reopen closed tab" in browsers and Ctrl+Shift+T "new tab" in
  // Linux terminals. The palette keeps the command; the editor can bind one.
  "app.themeToggle": null,
  // The theme picker: the in-app counterpart of Omarchy's theme menu (Super+Ctrl+Shift+Space), without
  // Super on Linux/Windows (the window manager's) and with ⌘ for Super on macOS, without ⌃: on macOS a
  // chord holding ⌃ never fires in a terminal (matchEvent). xterm.js sends nothing for either chord.
  "app.themePicker": { mac: "Mod+Shift+Space", other: "Ctrl+Shift+Space" },
  "stage.hierarchy": "Mod+1",
  "stage.spawn": "Mod+2",
  "stage.automations": "Mod+3",
  // The Desktop's own, on both platforms (a terminal program never sees Ctrl+Tab as anything but Tab).
  "tabs.next": "Ctrl+Tab",
  "tabs.prev": "Ctrl+Shift+Tab",
  // The shared tab moves: Alt+Shift+→/← (a named exception of the terminal rule), ⌘⌥→/← on macOS.
  "tabs.nextPage": chordOf("tabs.nextPage"),
  "tabs.prevPage": chordOf("tabs.prevPage"),
  // ⌘⌥1–⌘⌥9 on macOS (⌘1–⌘3 are the stages; ⌃digits are control bytes a program reads);
  // Ctrl+Alt+1–Ctrl+Alt+9 elsewhere, which send ESC and the digit, as Alt+digit does. 9 is the last tab.
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`tabs.goto${i + 1}`, chordOf(`tabs.goto${i + 1}`)])),
  "tabs.close": chordOf("tabs.close"),
  // F6 / Shift+F6 cycle regions outside a terminal (mc, htop and nano read F6 in one);
  // ⌘⇧F6 / Ctrl+Shift+F6 leaves a terminal for the next region, after which F6 works.
  "focus.nextRegion": "F6",
  "focus.prevRegion": "Shift+F6",
  "focus.leaveTerminal": "Mod+Shift+F6",
  // Ctrl+Alt+F / Ctrl+Shift+B on Linux/Windows: plain Ctrl+F and Ctrl+B are bytes a program
  // reads (readline's forward-char, the tmux prefix).
  "sidebar.focusFilter": chordOf("sidebar.focusFilter"),
  "sidebar.toggle": { mac: "Mod+B", other: "Ctrl+Shift+B" },
  // Ctrl+Alt+E splits right, Ctrl+Alt+Shift+E down.
  "split.vertical": chordOf("split.vertical"),
  "split.horizontal": chordOf("split.horizontal"),
  "split.close": { mac: "Mod+Alt+W", other: "Ctrl+Shift+Alt+W" },
  // The instance panel (the right-hand panel). Ctrl+Shift+I on Linux/Windows: plain Ctrl+I is
  // the Tab byte, which stays with the program.
  "panel.toggle": { mac: "Mod+I", other: "Ctrl+Shift+I" },
  // Copy the terminal's selection (#672): Ctrl+Shift+C, the Linux terminals' copy (Ctrl+C is the
  // interrupt). No macOS default: ⌘C is Edit › Copy, the menu role. xterm.js sends nothing for
  // Ctrl+Shift+C (its Ctrl+letter control bytes need Shift up), so claiming it takes nothing.
  "terminal.copySelection": { mac: null, other: "Ctrl+Shift+C" },
  "terminal.fontBigger": "Mod+=",
  "terminal.fontSmaller": "Mod+-",
  "terminal.fontReset": "Mod+0",
});

/** The default chord for an action on this platform (string or null). */
export function defaultBinding(actionId, isMac = defaultIsMac()) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_KEYMAP, actionId)) return undefined;
  const entry = DEFAULT_KEYMAP[actionId];
  if (entry && typeof entry === "object") return (isMac ? entry.mac : entry.other) ?? null;
  return entry ?? null;
}

// Action ids allowed to fire inside .xterm on Linux/Windows, where their
// chords would otherwise belong to the attached program. Allowlisting by
// action id (not chord) keeps the policy stable across user rebinds.
// The rule (docs/desktop-keyboard.md, principle 2): a chord fires in a terminal
// on Linux/Windows only when xterm sends nothing for it, or when what it sends is
// a byte the program still gets from a plainer key. Nothing: the Ctrl+Shift+letter
// defaults and Ctrl+Shift+Space (xterm's Ctrl+letter and Ctrl+Space bytes need
// Shift up), Ctrl+1, Ctrl+2, Ctrl+, and the zoom chords Ctrl+= Ctrl+- Ctrl+0.
// A byte the program still gets: Ctrl+3 (ESC: Esc), Ctrl+Tab (Tab), Ctrl+Shift+Tab
// (back-tab: Shift+Tab), app.leader (Alt+O sends ESC o: Esc, then o; the key the TUI
// reads its leader from too), the shared Ctrl+Alt chords (Ctrl+Alt+letter, with Shift
// or without, sends ESC and the Ctrl+letter byte: Esc, then Ctrl+letter; Ctrl+Alt+digit
// ESC and the digit: Alt+digit) and Ctrl+Shift+Alt+W (ESC Ctrl+W: Esc, then Ctrl+W).
// On Windows xterm sends nothing for Ctrl+Alt+letter or digit: it reads them as AltGr.
// Named exceptions, sequences no plainer key sends: Ctrl+Shift+F6, without which F6
// cannot get out of a terminal, and the Alt+Shift arrows (CSI 1;4 A–D: the shared
// previous / next instance and tab moves), which no agent or readline binds.
// test/terminal-xterm-bytes.test.mjs runs each allowlisted default through xterm's own
// keydown and pins exactly what it sends.
// Every plain Ctrl+letter, other Alt+key and F-key stays the program's, so these stay
// out: app.openFile (Ctrl+O) and focus.next/prevRegion (F6: mc, htop, nano).
export const TERMINAL_ALLOWLIST = Object.freeze([
  "app.leader", "app.palette", "app.quickOpenSouls", "app.workspaces", "app.chooseSoul", "app.themePicker", "app.shortcuts", "terminal.copySelection",
  "roster.openPrevious", "roster.openNext", "terminal.zoom",
  "tabs.next", "tabs.prev", "tabs.nextPage", "tabs.prevPage", "tabs.close",
  ...Array.from({ length: 9 }, (_, i) => `tabs.goto${i + 1}`),
  "split.vertical", "split.horizontal", "split.close", "split.focusNextGroup",
  "focus.leaveTerminal",
  "sidebar.toggle", "sidebar.focusFilter", "panel.toggle",
  "stage.hierarchy", "stage.spawn", "stage.automations",
  "terminal.fontBigger", "terminal.fontSmaller", "terminal.fontReset",
]);

export const CONTEXTS = Object.freeze([
  "global", "stage:hierarchy", "stage:spawn", "roster", "tabs", "sidebar",
]);

// ---------------------------------------------------------------- registry

const actions = new Map();   // id -> { id, label, context, run, when }
let activeContexts = new Set();
const keymapListeners = new Set();

/** Register an action; returns an unregister function. Re-registering an id
 * replaces it (views re-mount). Optional `defaultChord` folds into the
 * effective keymap exactly like a DEFAULT_KEYMAP entry: user override wins,
 * an explicit editor unbind (persisted null) kills it, and getBinding /
 * findConflict / the editor all see it — view-local actions registered at
 * mount carry their defaults with the registration (contract addendum 3).
 * Optional `when()`: while it answers false the action does not exist for dispatch — its chord
 * is not matched, so the key goes where it would go without it (app.leader under a modal). */
export function registerAction({ id, label, context = "global", run, defaultChord = null, when = null }) {
  if (!id || typeof run !== "function") throw new Error("registerAction: id and run required");
  const canonical = defaultChord == null ? null : chordToString(parseChord(defaultChord));
  const action = { id, label: label || id, context, run, defaultChord: canonical, when: typeof when === "function" ? when : null };
  actions.set(id, action);
  notifyKeymapChange(); // a new default can change effective bindings
  return () => {
    if (actions.get(id) === action) { actions.delete(id); notifyKeymapChange(); }
  };
}

/** Run a registered action by id exactly as a matched chord would —
 * context-gated, so a mouse affordance can never fire an action its
 * keyboard dispatch could not (buttons and chords share ONE registered
 * run — single source of truth). Returns true when the action ran. */
export function runAction(id) {
  const action = actions.get(id);
  if (!action || !contextEligible(action.context) || !actionLive(action)) return false;
  try { action.run(); } catch { /* an action must not break its caller */ }
  return true;
}

/** Registered actions (editor rendering). */
export function listActions() {
  return [...actions.values()];
}

export function setActiveContexts(set) {
  activeContexts = new Set(set || []);
}

function contextEligible(context) {
  return context === "global" || activeContexts.has(context);
}

function actionLive(action) {
  try { return !action.when || action.when() !== false; } catch { return false; }
}

// ---------------------------------------------------------------- overrides

function readOverrides() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    // Sanitize: only `null` (explicit unbind) or a parseable chord string
    // survives — anything else (numbers, objects, junk strings) is discarded
    // so a corrupted/legacy payload can never reach formatChord/matchEvent.
    const clean = {};
    for (const [id, value] of Object.entries(obj)) {
      if (value === null) clean[id] = null;
      else if (typeof value === "string") {
        const canonical = chordToString(parseChord(value));
        if (canonical) clean[id] = canonical;
      }
    }
    return clean;
  } catch { return {}; }
}

function writeOverrides(overrides) {
  try {
    if (Object.keys(overrides).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage-less */ }
}

let overrides = readOverrides();

function notifyKeymapChange() {
  for (const fn of [...keymapListeners]) { try { fn(); } catch { /* isolate listener */ } }
}

/** Effective chord string for an action (override ?? this platform's static
 * default ?? registration default), or null. An explicit persisted null (editor
 * Backspace-unbind) wins over BOTH default sources, and a DEFAULT_KEYMAP entry
 * that is null on this platform means "no default" (never the registration's). */
export function getBinding(actionId, isMac = defaultIsMac()) {
  if (Object.prototype.hasOwnProperty.call(overrides, actionId)) {
    const v = overrides[actionId];
    return v == null ? null : v; // explicit null = unbound
  }
  const fixed = defaultBinding(actionId, isMac);
  if (fixed !== undefined) return fixed;
  return actions.get(actionId)?.defaultChord ?? null;
}

/** Persist an override: chord (string or object) or null to unbind. */
export function setBinding(actionId, chordOrNull) {
  if (chordOrNull == null) {
    overrides[actionId] = null;
  } else {
    const s = chordToString(chordOrNull);
    if (!s) return;
    overrides[actionId] = s;
  }
  writeOverrides(overrides);
  notifyKeymapChange();
}

export function resetBinding(actionId) {
  if (!Object.prototype.hasOwnProperty.call(overrides, actionId)) return;
  delete overrides[actionId];
  writeOverrides(overrides);
  notifyKeymapChange();
}

export function resetAllBindings() {
  overrides = {};
  writeOverrides(overrides);
  notifyKeymapChange();
}

export function onKeymapChange(fn) {
  keymapListeners.add(fn);
  return () => keymapListeners.delete(fn);
}

// ---------------------------------------------------------------- conflicts

/** A modal dialog's own context (`spawn-dialog-local`): while the dialog is open
 * its keys are its own and it stops them, so nothing behind the modal sees them;
 * while it is closed they do nothing. Its chords collide only with each other,
 * never with a global action (Spec E: Mod+1 jumps to Name in the spawn dialog and
 * shows Active everywhere else). */
const isModalContext = (context) => typeof context === "string" && context.endsWith("-dialog-local");

/** Two contexts the shell has on at once (shell.mjs updateActiveContexts): the sidebar's, while
 * focus is in the sidebar, beside the tab layer's or a stage's. A chord bound in both would run
 * only one of them, so they clash like a same-context pair. */
const SHARES_SIDEBAR = (context) => context === "tabs" || context === "roster" || (typeof context === "string" && context.startsWith("stage:"));
const onTogether = (a, b) => (a === "sidebar" && SHARES_SIDEBAR(b)) || (b === "sidebar" && SHARES_SIDEBAR(a));

/** First OTHER action whose effective binding collides with `chord` in a way
 * visible from `context` (same context, either side global, or two contexts on at
 * once, the sidebar's beside the tabs' or a stage's — except a modal dialog's own
 * context, which only its own actions share), optionally excluding one action id
 * (the one being edited). Returns the action or null. */
export function findConflict(chord, context, excludeId = null, isMac = defaultIsMac()) {
  const c = typeof chord === "string" ? parseChord(chord) : chord;
  if (!c) return null;
  for (const action of actions.values()) {
    if (action.id === excludeId) continue;
    const bound = parseChord(getBinding(action.id, isMac) || "");
    if (!bound) continue;
    if (!chordMatches(bound, resolveForCompare(c, isMac), isMac)) continue;
    if (action.context === context) return action;
    if (isModalContext(context) || isModalContext(action.context)) continue;
    if (context === "global" || action.context === "global") return action;
    if (onTogether(context, action.context)) return action;
  }
  return null;
}

/** Clashes that involve a stored rebind: pairs of actions whose effective chords
 * collide (findConflict's visibility rule) where at least one side is a user
 * override — e.g. a rebind that a new default now shares. Nothing is ever changed
 * silently; the shell marks the shortcuts button and the editor lists them. */
export function keymapConflicts(isMac = defaultIsMac()) {
  const own = (id) => Object.prototype.hasOwnProperty.call(overrides, id);
  const out = [], seen = new Set();
  for (const action of actions.values()) {
    const chord = getBinding(action.id, isMac);
    if (!chord) continue;
    const other = findConflict(chord, action.context, action.id, isMac);
    if (!other || !(own(action.id) || own(other.id))) continue;
    const key = [action.id, other.id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ chord, actions: [action, other] });
  }
  return out;
}

// findConflict compares two stored chords (both may use Mod); flatten one to
// the event-shaped side so chordMatches' non-mac Mod/Ctrl folding applies.
function resolveForCompare(chord, isMac) {
  if (isMac) return { ...chord };
  return { ...chord, mod: chord.mod || chord.ctrl, ctrl: false };
}

/** True for a chord with no ctrl/alt/mod modifiers (shift-only counts as
 * plain — typing produces shifted characters). Such bindings are guarded off
 * editable fields by matchEvent; the editor warns when recording one.
 * Function keys (F1–F24) never type text, so they are not plain: F6 must cycle
 * regions from a text field and from a terminal's input textarea (spec F). */
export function isPlainChord(chord) {
  const c = typeof chord === "string" ? parseChord(chord) : chord;
  return !!c && !c.mod && !c.ctrl && !c.alt && !/^f\d{1,2}$/.test(c.key);
}

// ---------------------------------------------------------------- dispatch

/** On macOS inside a terminal, one non-⌘ shape still belongs to the app, by
 * action id AND chord shape (a rebind to another Ctrl chord stays the program's):
 * Ctrl+Tab / Ctrl+Shift+Tab cycling tabs (standard on macOS too; a terminal
 * program never sees Ctrl+Tab as anything but Tab). */
function macStructuralChord(id, c) {
  if (c.mod || c.alt) return false;
  if (id === "tabs.next" || id === "tabs.prev") return c.key === "tab" && c.ctrl;
  // The leader (a named exception to principle 3): bound to a ⌃-only chord on `\`, as shipped.
  // A rebind to ⌘something fires by the ⌘ rule; a rebind to another ⌃ chord stays the program's.
  if (id === "app.leader") return c.ctrl && !c.shift && c.key === "\\";
  return false;
}

/** Whether an action bound to `chord` may fire while a terminal has focus: on
 * Linux/Windows when its id is in TERMINAL_ALLOWLIST, whatever the chord; on macOS
 * when the chord holds ⌘ and not ⌃ (⌘ never reaches the pty), or is the Ctrl+Tab
 * shape of tabs.next/prev, or the ⌃\\ shape of app.leader. matchEvent applies it; the shortcuts
 * editor shows it. */
export function terminalAllows(actionId, chord, isMac = defaultIsMac()) {
  const c = typeof chord === "string" ? parseChord(chord) : chord;
  if (!c) return false;
  if (!isMac) return TERMINAL_ALLOWLIST.includes(actionId);
  return macStructuralChord(actionId, c) || (c.mod && !c.ctrl);
}

/** Match a keydown to an eligible action id, or null. Honors context scoping
 * and the terminal policy. `opts` is for tests: { isMac, insideTerminal,
 * editableTarget } — each defaults from the environment/event. */
export function matchEvent(e, opts = {}) {
  // A consumed event stays consumed: view-local handlers (hierarchy canvas,
  // roster rows, palette input) preventDefault what they own — the engine
  // must never double-dispatch it (contract addendum a). An event let through
  // (letThrough) is the focused control's, whatever it matches.
  if (e.defaultPrevented || letThroughEvents.has(e)) return null;
  const isMac = opts.isMac ?? defaultIsMac();
  const insideTerminal = opts.insideTerminal ?? !!e.target?.closest?.(".xterm");
  const evChord = chordFromEvent(e, isMac);
  if (!evChord) return null;
  // Unmodified (or shift-only) chords belong to editable fields when one has
  // focus — a plain "b" binding must not fire while typing (addendum b).
  const editable = opts.editableTarget ?? isEditableTarget(e.target);
  const plainKey = isPlainChord(evChord);
  if (plainKey && editable) return null;

  let globalHit = null;
  let contextHit = null;
  for (const action of actions.values()) {
    if (!contextEligible(action.context) || !actionLive(action)) continue;
    const bound = parseChord(getBinding(action.id, isMac) || "");
    if (!bound || !chordMatches(bound, evChord, isMac)) continue;
    // Inside a terminal, every other chord stays with the attached program, even after
    // a custom rebind (on macOS the event's chord equals the bound one here).
    if (insideTerminal && !terminalAllows(action.id, evChord, isMac)) continue;
    if (action.context === "global") globalHit = globalHit || action;
    else contextHit = contextHit || action;
  }
  const hit = contextHit || globalHit; // specific context wins over global
  return hit ? hit.id : null;
}

const letThroughEvents = new WeakSet();
/** Hand an event to the focused control: no action matches it, in any phase of dispatch
 * (the window listener or a terminal's interception). The leader pressed twice in a terminal. */
export function letThrough(e) {
  if (e && typeof e === "object") letThroughEvents.add(e);
}

/** Does the event press the effective chord of `actionId` (whatever its context)? */
export function eventMatchesBinding(e, actionId, isMac = defaultIsMac()) {
  return chordMatches(parseChord(getBinding(actionId, isMac) || ""), chordFromEvent(e, isMac), isMac);
}

/** The single shell-level keydown listener body: match, prevent, run. */
export function handleKeydown(e, opts = {}) {
  const id = matchEvent(e, opts);
  if (!id) return false;
  e.preventDefault();
  const action = actions.get(id);
  try { action.run(e); } catch { /* an action must not break dispatch */ }
  return true;
}

/** While a picker opened by `actionId` is open, its own chord moves the active
 * row down (1) and Shift + that chord moves it up (-1); anything else is 0.
 * Read from the live keymap, so a rebind follows. A chord that already holds
 * Shift (a rebind to Ctrl+Shift+K, say) has no Shift form: ArrowUp moves up
 * there. An unbound action, or a plain chord (typing belongs to the input),
 * never cycles. */
export function pickerCycleDirection(e, actionId, isMac = defaultIsMac()) {
  const bound = parseChord(getBinding(actionId, isMac) || "");
  const evChord = chordFromEvent(e, isMac);
  if (!bound || !evChord || isPlainChord(bound)) return 0;
  if (chordMatches(bound, evChord, isMac)) return 1;
  if (!bound.shift && chordMatches({ ...bound, shift: true }, evChord, isMac)) return -1;
  return 0;
}
