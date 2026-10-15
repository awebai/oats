// The action table: what the TUI can do and the keys that do it. The reducer and the help view
// both read it, so the help cannot name a key the program does not act on. `keys` are key ids
// (term/keys.mjs keyId); they are the part a user's tui.json replaces (config.mjs), so everything
// that acts on a key or names one reads the EFFECTIVE table it is handed, never this constant.
// An action that does one thing in the list of instances and another in the switcher (`open`)
// says so in `views`: what it does in each, in the order the help lists them. An action of one
// view only (the four acts) names that view, so the help says where it acts.
export const ACTIONS = Object.freeze([
  { id: "up", keys: ["up", "k"], label: "up" },
  { id: "down", keys: ["down", "j"], label: "down" },
  { id: "top", keys: ["g", "home"], label: "first" },
  { id: "bottom", keys: ["G", "end"], label: "last" },
  { id: "page-up", keys: ["pageup"], label: "page up" },
  { id: "page-down", keys: ["pagedown"], label: "page down" },
  { id: "collapse", keys: ["left", "h"], label: "collapse, or go to the parent" },
  { id: "expand", keys: ["right", "l"], label: "expand, or go to the first child" },
  { id: "detail", keys: ["tab"], label: "detail" },
  { id: "filter", keys: ["/"], label: "filter" },
  { id: "refresh", keys: ["r"], label: "refresh" },
  // The views by their number. The header names the views and never draws a digit against a name
  // (docs/tui.md, "The header"): the digits are named here, so in the help and the footer.
  { id: "instances", keys: ["1"], label: "instances" },
  { id: "souls", keys: ["2"], label: "souls" },
  { id: "capabilities", keys: ["3"], label: "capabilities" },
  { id: "workspaces", keys: ["w"], label: "workspaces" },
  { id: "open", keys: ["enter"], label: "open", views: [["instances", "open the selected agent's terminal beside the list, or go to it when it is the open one, in the list of instances"], ["switcher", "open the selected workspace, in the switcher"]] },
  // The open terminal, from the list (docs/tui.md, "Open an agent's terminal"). While the terminal
  // has the focus the TUI takes no key but the back key (tui.json's open.detachKey), so neither of
  // these is ever read there.
  { id: "zoom", keys: ["z"], label: "zoom", views: [["instances", "go to the open terminal with the whole screen; the back key brings the list back"]] },
  { id: "close-terminal", keys: ["c"], label: "close terminal", views: [["instances", "close the open terminal; the agent keeps running"]] },
  // The four acts on an instance: each opens a confirmation, and nothing is done before a move and
  // a press in it. Capitals: a lower-case key is one slip away, a capital takes Shift.
  { id: "stop", keys: ["X"], label: "stop", views: [["instances", "stop the selected agent, after a confirmation"]] },
  { id: "retire", keys: ["D"], label: "retire", views: [["instances", "retire the selected agent, after a confirmation"]] },
  { id: "start", keys: ["S"], label: "start", views: [["instances", "start the selected agent as it was last launched, after a confirmation"]] },
  { id: "restart", keys: ["R"], label: "restart", views: [["instances", "restart the selected agent as it was last launched, after a confirmation"]] },
  { id: "help", keys: ["?"], label: "help" },
  { id: "close", keys: ["escape"], label: "close" },
  { id: "quit", keys: ["q", "ctrl+c"], label: "quit" },
  { id: "suspend", keys: ["ctrl+z"], label: "suspend" },
  { id: "redraw", keys: ["ctrl+l"], label: "redraw" },
].map((action) => Object.freeze({ ...action, keys: Object.freeze([...action.keys]), ...(action.views ? { views: Object.freeze(action.views.map((view) => Object.freeze([...view]))) } : {}) })));

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
