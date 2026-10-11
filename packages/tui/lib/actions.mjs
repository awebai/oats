// The action table: what the TUI can do and the keys that do it. The reducer and the help view
// both read it, so the help cannot name a key the program does not act on. `keys` are key ids
// (term/keys.mjs keyId); they are the part a user's tui.json will replace.
export const ACTIONS = Object.freeze([
  { id: "help", keys: ["?"], label: "help" },
  { id: "close", keys: ["escape"], label: "close" },
  { id: "quit", keys: ["q", "ctrl+c"], label: "quit" },
  { id: "suspend", keys: ["ctrl+z"], label: "suspend" },
  { id: "redraw", keys: ["ctrl+l"], label: "redraw" },
].map((action) => Object.freeze({ ...action, keys: Object.freeze([...action.keys]) })));

/** key id -> action id. A key bound twice is a defect of the table, refused when it is read. */
export function bindings(actions = ACTIONS) {
  const map = new Map();
  for (const action of actions) for (const key of action.keys) {
    if (map.has(key)) throw new Error(`key ${key} is bound to ${map.get(key)} and to ${action.id}`);
    map.set(key, action.id);
  }
  return map;
}

const NAMES = Object.freeze({ escape: "Esc", enter: "Enter", tab: "Tab", backspace: "Backspace", space: "Space", up: "Up", down: "Down", left: "Left", right: "Right", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown", insert: "Insert", delete: "Delete", ctrl: "Ctrl", alt: "Alt", shift: "Shift" });
/** A key id as a person reads it: `ctrl+c` is `Ctrl+C`, `escape` is `Esc`, `?` is `?`. */
export function keyLabel(key) {
  if (key.length === 1) return key;
  const parts = key.split("+"), last = parts.pop();
  const name = NAMES[last] ?? (/^f\d+$/.test(last) ? last.toUpperCase() : parts.length && last.length === 1 ? last.toUpperCase() : last);
  return [...parts.map((part) => NAMES[part] ?? part), name].join("+");
}
