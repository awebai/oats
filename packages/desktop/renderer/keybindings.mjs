// oats desktop — keybinding engine (pure logic; unit-tested without a DOM).
//
// One shared registry: the shell/wiring code registers actions
// ({ id, label, context, run }); this module owns chord parsing, the default
// keymap, user overrides (localStorage), context scoping, and dispatch.
//
// Terminal safety (mirrors palette.mjs isPaletteShortcut and app-menu.mjs):
// when the keydown target is inside `.xterm`, on macOS ONLY chords whose
// `Mod` resolves to ⌘ (meta) may fire, plus three structural shapes that
// never reach a program as text: Ctrl+Tab tab cycling, ⌃1–⌃9 go-to-tab and
// F6 region cycling — other Ctrl chords belong to the attached program. On
// Linux/Windows the Ctrl key IS the terminal's control key, so only an
// explicit allowlist of action ids may fire inside the terminal; every other
// chord passes through. Their defaults there are Ctrl+Shift+key (the GNOME
// Terminal / Alacritty / Ghostty / kitty convention), so plain Ctrl+letter
// (Ctrl+W, Ctrl+K, Ctrl+P, Ctrl+B, Ctrl+\) stays the program's.
// docs/desktop-keyboard.md is the keymap's reference.

const STORAGE_KEY = "oats-desktop-keymap";

// ---------------------------------------------------------------- chords

const MOD_ORDER = ["Mod", "Ctrl", "Alt", "Shift"];

// e.key values normalized so layouts/shift variants land on one spelling.
const KEY_ALIASES = new Map([
  ["+", "="], // Shift-= / numpad plus both mean the "=" binding (Mod+=)
  ["|", "\\"], // Shift-\ produces "|" — both mean the "\" binding (Mod+Shift+\)
  ["pgdn", "pagedown"], ["pgup", "pageup"],
  ["esc", "escape"],
  [" ", "space"],
  ["spacebar", "space"],
]);

export function normalizeKey(key) {
  const k = String(key || "").toLowerCase();
  return KEY_ALIASES.get(k) || k;
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
      chord.key = normalizeKey(p);
    }
  }
  if (!chord.key) return null;
  return chord;
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

/** Human label for a chord (object or string). Mod = ⌘ on mac, Ctrl elsewhere. */
export function formatChord(chord, isMac = defaultIsMac()) {
  const c = typeof chord === "string" ? parseChord(chord) : chord;
  if (!c) return "";
  if (isMac) {
    let s = "";
    if (c.ctrl) s += "⌃";
    if (c.alt) s += "⌥";
    if (c.shift) s += "⇧";
    if (c.mod) s += "⌘";
    return s + keyLabel(c.key);
  }
  const parts = [];
  if (c.mod || c.ctrl) parts.push("Ctrl");
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("Shift");
  parts.push(keyLabel(c.key));
  return parts.join("+");
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
  const key = normalizeKey(e.key);
  if (!key || ["meta", "control", "alt", "shift"].includes(key)) return null;
  const chord = { key, mod: false, ctrl: false, alt: !!e.altKey, shift: !!e.shiftKey };
  if (isMac) {
    chord.mod = !!e.metaKey;
    chord.ctrl = !!e.ctrlKey;
  } else {
    chord.mod = !!e.ctrlKey; // Ctrl plays the Mod role; explicit meta ignored
  }
  return chord;
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
// a chord that must work while a terminal has focus is Ctrl+Shift+key on
// Linux/Windows, because plain Ctrl+letter belongs to the program; macOS keeps ⌘,
// which never reaches the pty. Every default passed the collision review in the
// keyboard lesson, shifted punctuation included (KEY_ALIASES, tested with the
// real shifted event). Action ids never change, so stored overrides survive.
export const DEFAULT_KEYMAP = Object.freeze({
  "app.palette": { mac: "Mod+K", other: "Ctrl+Shift+P" },
  "app.quickOpenSouls": "Mod+P",
  "app.chooseSoul": { mac: "Mod+N", other: "Ctrl+Shift+N" },
  "app.shortcuts": "Mod+,",
  // No default (spec F): ⌘⇧T is "reopen closed tab" in browsers and Ctrl+Shift+T "new tab" in
  // Linux terminals. The palette keeps the command; the editor can bind one.
  "app.themeToggle": null,
  "stage.hierarchy": "Mod+1",
  "stage.spawn": "Mod+2",
  "stage.automations": "Mod+3",
  "tabs.next": "Ctrl+Tab",
  "tabs.prev": "Ctrl+Shift+Tab",
  "tabs.nextPage": { mac: null, other: "Ctrl+PageDown" },
  "tabs.prevPage": { mac: null, other: "Ctrl+PageUp" },
  // ⌃1–⌃9 on macOS; Alt+1–Alt+9 elsewhere (GNOME Terminal, Firefox). 9 is the last tab.
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`tabs.goto${i + 1}`, { mac: `Ctrl+${i + 1}`, other: `Alt+${i + 1}` }])),
  "tabs.close": { mac: "Mod+W", other: "Ctrl+Shift+W" },
  "focus.nextRegion": "F6",
  "focus.prevRegion": "Shift+F6",
  "sidebar.focusFilter": "Mod+F",
  "sidebar.toggle": "Mod+B",
  // Terminator / Tilix: Ctrl+Shift+E splits right, Ctrl+Shift+O splits down.
  "split.vertical": { mac: "Mod+\\", other: "Ctrl+Shift+E" },
  "split.horizontal": { mac: "Mod+Shift+\\", other: "Ctrl+Shift+O" },
  "split.close": { mac: "Mod+Alt+W", other: "Ctrl+Shift+Alt+W" },
  // The instance panel (the tab bar's panel-right toggle). Not terminal-allowlisted: on
  // Linux/Windows Ctrl+Alt+B stays with the program in the terminal (macOS ⌘⌥B fires there).
  "panel.toggle": "Mod+Alt+B",
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
// Their defaults there are Ctrl+Shift+key, Alt+digit, Ctrl+Tab/PgDn/PgUp or F6:
// none of them is a plain Ctrl+letter a program reads.
// sidebar.toggle is deliberately NOT allowlisted: its default Mod+B would
// intercept Ctrl+B — the tmux prefix — inside the terminal on non-mac
// (macOS ⌘B still fires in xterm via the ⌘-chord rule).
// app.quickOpenSouls is deliberately ABSENT too: Ctrl+P inside a terminal
// is shell history navigation — it must reach the pty (⌘P on macOS still
// fires inside xterm via the ⌘-chord policy above).
export const TERMINAL_ALLOWLIST = Object.freeze([
  "app.palette", "app.chooseSoul",
  "tabs.next", "tabs.prev", "tabs.nextPage", "tabs.prevPage", "tabs.close",
  ...Array.from({ length: 9 }, (_, i) => `tabs.goto${i + 1}`),
  "split.vertical", "split.horizontal", "split.close",
  "focus.nextRegion", "focus.prevRegion",
]);

export const CONTEXTS = Object.freeze([
  "global", "stage:hierarchy", "stage:spawn", "roster", "tabs",
]);

// ---------------------------------------------------------------- registry

const actions = new Map();   // id -> { id, label, context, run }
let activeContexts = new Set();
const keymapListeners = new Set();

/** Register an action; returns an unregister function. Re-registering an id
 * replaces it (views re-mount). Optional `defaultChord` folds into the
 * effective keymap exactly like a DEFAULT_KEYMAP entry: user override wins,
 * an explicit editor unbind (persisted null) kills it, and getBinding /
 * findConflict / the editor all see it — view-local actions registered at
 * mount carry their defaults with the registration (contract addendum 3). */
export function registerAction({ id, label, context = "global", run, defaultChord = null }) {
  if (!id || typeof run !== "function") throw new Error("registerAction: id and run required");
  const canonical = defaultChord == null ? null : chordToString(parseChord(defaultChord));
  const action = { id, label: label || id, context, run, defaultChord: canonical };
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
  if (!action || !contextEligible(action.context)) return false;
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

/** First OTHER action whose effective binding collides with `chord` in a way
 * visible from `context` (same context, or either side is global), optionally
 * excluding one action id (the one being edited). Returns the action or null. */
export function findConflict(chord, context, excludeId = null, isMac = defaultIsMac()) {
  const c = typeof chord === "string" ? parseChord(chord) : chord;
  if (!c) return null;
  for (const action of actions.values()) {
    if (action.id === excludeId) continue;
    const bound = parseChord(getBinding(action.id, isMac) || "");
    if (!bound) continue;
    if (!chordMatches(bound, resolveForCompare(c, isMac), isMac)) continue;
    if (context === "global" || action.context === "global" || action.context === context) return action;
  }
  return null;
}

// findConflict compares two stored chords (both may use Mod); flatten one to
// the event-shaped side so chordMatches' non-mac Mod/Ctrl folding applies.
function resolveForCompare(chord, isMac) {
  if (isMac) return { ...chord };
  return { ...chord, mod: chord.mod || chord.ctrl, ctrl: false };
}

/** True for a chord with no ctrl/alt/mod modifiers (shift-only counts as
 * plain — typing produces shifted characters). Such bindings are guarded off
 * editable fields by matchEvent; the editor warns when recording one. */
export function isPlainChord(chord) {
  const c = typeof chord === "string" ? parseChord(chord) : chord;
  return !!c && !c.mod && !c.ctrl && !c.alt;
}

// ---------------------------------------------------------------- dispatch

/** On macOS inside a terminal, three non-⌘ shapes still belong to the app, by
 * action id AND chord shape (a rebind to another Ctrl chord stays the program's):
 * Ctrl+Tab / Ctrl+Shift+Tab cycling tabs (standard on macOS too), ⌃1–⌃9 going to
 * a tab, and F6 / Shift+F6 cycling regions (in a terminal Tab is the program's). */
function macStructuralChord(id, c) {
  if (c.mod || c.alt) return false;
  if (id === "tabs.next" || id === "tabs.prev") return c.key === "tab" && c.ctrl;
  if (/^tabs\.goto[1-9]$/.test(id)) return c.ctrl && !c.shift && /^[1-9]$/.test(c.key);
  if (id === "focus.nextRegion" || id === "focus.prevRegion") return c.key === "f6" && !c.ctrl;
  return false;
}

/** Match a keydown to an eligible action id, or null. Honors context scoping
 * and the terminal policy. `opts` is for tests: { isMac, insideTerminal,
 * editableTarget } — each defaults from the environment/event. */
export function matchEvent(e, opts = {}) {
  // A consumed event stays consumed: view-local handlers (hierarchy canvas,
  // roster rows, palette input) preventDefault what they own — the engine
  // must never double-dispatch it (contract addendum a).
  if (e.defaultPrevented) return null;
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
    if (!contextEligible(action.context)) continue;
    const bound = parseChord(getBinding(action.id, isMac) || "");
    if (!bound || !chordMatches(bound, evChord, isMac)) continue;
    if (insideTerminal) {
      if (isMac) {
        // ⌘ chords fire; other chords stay with the attached program, even
        // after a custom rebind — except macStructuralChord's three shapes.
        if (!macStructuralChord(action.id, evChord) && (!(bound.mod && evChord.mod) || evChord.ctrl)) continue;
      } else if (!TERMINAL_ALLOWLIST.includes(action.id)) {
        continue; // Ctrl chords belong to the attached program
      }
    }
    if (action.context === "global") globalHit = globalHit || action;
    else contextHit = contextHit || action;
  }
  const hit = contextHit || globalHit; // specific context wins over global
  return hit ? hit.id : null;
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
