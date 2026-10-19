// The action table: what the TUI can do and the keys that do it. The reducer and the help view
// both read it, so the help cannot name a key the program does not act on. `keys` are key ids
// (term/keys.mjs keyId); they are the part a user's tui.json replaces (config.mjs), so everything
// that acts on a key or names one reads the EFFECTIVE table it is handed, never this constant.
// An action that does one thing in the list of instances and another in the switcher (`open`)
// says so in `views`: what it does in each, in the order the help lists them. An action of one
// view only (the four acts) names that view, so the help says where it acts.
import { isBackKey } from "./term/through.mjs";

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
  // The views by their number. The sidebar names the views, each with its key at the right of its row
  // (docs/tui.md, "What it shows"): the digits are named here, so in the help and the cheat sheet.
  { id: "instances", keys: ["1"], label: "instances" },
  { id: "souls", keys: ["2"], label: "souls" },
  { id: "capabilities", keys: ["3"], label: "capabilities" },
  { id: "workspaces", keys: ["w"], label: "workspaces" },
  // The palette (docs/tui.md, "The palette"): from every focus it is the leader and then `k`.
  { id: "palette", keys: ["ctrl+k"], label: "palette" },
  { id: "open", keys: ["enter"], label: "open", views: [["instances", "open the selected agent's terminal as a tab beside the list, or show its tab when it has one, in the list of instances"], ["switcher", "open the selected workspace, in the switcher"], ["souls", "show the selected soul's detail, and from the detail its instances, in the Souls view"], ["capabilities", "show the selected capability's detail, and from the detail the marked soul that uses it, in the Capabilities view"]] },
  // The Souls view (docs/tui.md, "The Souls view"): the selected soul's instances, in the
  // Instances view, filtered by that soul.
  { id: "soul-instances", keys: ["i"], label: "instances", views: [["souls", "the selected soul's instances, in the Instances view"]] },
  // The open terminal, from the list (docs/tui.md, "Open an agent's terminal"). While the terminal
  // has the focus the TUI takes no key but the leader (tui.json's open.detachKey), so neither of
  // these is ever read there: the leader's table has its own (LEADER).
  { id: "zoom", keys: ["z"], label: "zoom", views: [["instances", "go to the shown terminal with the whole screen; the leader then Esc brings the list back"]] },
  { id: "close-terminal", keys: ["c"], label: "close terminal", views: [["instances", "close the shown terminal and show its neighbour; the agent keeps running"]] },
  { id: "tab-previous", keys: ["["], label: "previous tab", views: [["instances", "show the terminal of the tab before the shown one"]] },
  { id: "tab-next", keys: ["]"], label: "next tab", views: [["instances", "show the terminal of the tab after the shown one"]] },
  // The split (docs/tui.md, "Splits"): two groups of tabs at most, side by side or one above the
  // other. `group-next`, `tab-move` and `group-close` have no key of their own here by default
  // (Tab is the detail's, and `m` and `x` are often a tui.json's): the leader's are.
  { id: "split-right", keys: ["|"], label: "split right", views: [["instances", "split the panel side by side; the new group, on the right, is empty and focused"]] },
  { id: "split-down", keys: ["-"], label: "split down", views: [["instances", "split the panel one above the other; the new group, below, is empty and focused"]] },
  { id: "group-next", keys: [], label: "next group", views: [["instances", "go to the other group's terminal, or to the focused group's from the list"]] },
  { id: "tab-move", keys: [], label: "move tab", views: [["instances", "move the shown tab to the other group, and go there"]] },
  { id: "group-close", keys: [], label: "close group", views: [["instances", "close the focused group while it is empty"]] },
  // The four acts on an instance: each opens a confirmation, and nothing is done before a move and
  // a press in it. Capitals: a lower-case key is one slip away, a capital takes Shift.
  { id: "stop", keys: ["X"], label: "stop", views: [["instances", "stop the selected agent, after a confirmation"]] },
  { id: "retire", keys: ["D"], label: "retire", views: [["instances", "retire the selected agent, after a confirmation"]] },
  { id: "start", keys: ["S"], label: "start", views: [["instances", "start the selected agent as it was last launched, after a confirmation"]] },
  { id: "restart", keys: ["R"], label: "restart", views: [["instances", "restart the selected agent as it was last launched, after a confirmation"]] },
  // A spawn (docs/tui.md, "Spawning an agent"): a prompt over the list, the soul picked, the
  // shared preview, and one Enter. Only on this machine's workspace, one spawn at a time.
  { id: "spawn", keys: ["n"], label: "spawn", views: [["instances", "spawn an agent: pick its soul, then the preview, and Enter spawns it"], ["souls", "spawn an agent of the selected soul: the preview, and Enter spawns it"]] },
  { id: "spawn-another", keys: ["N"], label: "spawn another", views: [["instances", "spawn another agent of the selected agent's soul: the preview, and Enter spawns it"], ["souls", "the same as n"]] },
  // Offered only while a spawn's outcome is not known: it asks the kernel once, never spawns again.
  { id: "spawn-check", keys: ["C"], label: "check spawn", views: [["instances", "check the result of a spawn whose outcome is not known, while one is"]] },
  { id: "help", keys: ["?"], label: "help" },
  { id: "close", keys: ["escape"], label: "close" },
  { id: "quit", keys: ["q", "ctrl+c"], label: "quit" },
  { id: "suspend", keys: ["ctrl+z"], label: "suspend" },
  { id: "redraw", keys: ["ctrl+l"], label: "redraw" },
].map((action) => Object.freeze({ ...action, keys: Object.freeze([...action.keys]), ...(action.views ? { views: Object.freeze(action.views.map((view) => Object.freeze([...view]))) } : {}) })));

/** THE LEADER'S TABLE (docs/tui.md, "The leader"): the keys read after the leader (tui.json's
 *  open.detachKey) and what each does, from every focus. Fixed: tui.json's `keys` rebinds the plain
 *  keys of ACTIONS only. `does` is an action id of ACTIONS, or one of the leader's own: `previous`
 *  and `next` (the instance before or after the shown terminal's, or the selection's: its tab
 *  shown, or opened as a new one, with the focus in it) and `list` (the list's focus, which
 *  Esc gives). The leader pressed again is not in this table either, as it is the user's key: from
 *  the open terminal's focus it types the leader's own bytes into the agent, the focus staying
 *  there, and from any other focus it only closes the hint (lib/store.mjs `twice`). `terminal`: named in the hint only while a terminal
 *  is open, and nothing without one (the hint names the tab keys only with two tabs or more). */
export const LEADER = Object.freeze([
  { keys: ["k", "space"], does: "palette", label: "palette" },
  { keys: ["1"], does: "instances", label: "instances" },
  { keys: ["2"], does: "souls", label: "souls" },
  { keys: ["3"], does: "capabilities", label: "capabilities" },
  { keys: ["up"], does: "previous", label: "previous instance" },
  { keys: ["down"], does: "next", label: "next instance" },
  { keys: ["z"], does: "zoom", label: "zoom", terminal: true },
  { keys: ["w"], does: "close-terminal", label: "close terminal", terminal: true },
  { keys: ["left"], does: "tab-previous", label: "previous tab", terminal: true },
  { keys: ["right"], does: "tab-next", label: "next tab", terminal: true },
  { keys: ["|"], does: "split-right", label: "split right", terminal: true },
  { keys: ["-"], does: "split-down", label: "split down", terminal: true },
  { keys: ["tab"], does: "group-next", label: "next group", terminal: true },
  { keys: ["m"], does: "tab-move", label: "move tab", terminal: true },
  { keys: ["x"], does: "group-close", label: "close group", terminal: true },
  { keys: ["X"], does: "stop", label: "stop" },
  { keys: ["R"], does: "restart", label: "restart" },
  { keys: ["S"], does: "start", label: "start" },
  { keys: ["D"], does: "retire", label: "retire" },
  { keys: ["n"], does: "spawn", label: "spawn" },
  { keys: ["N"], does: "spawn-another", label: "spawn another" },
  { keys: ["/"], does: "filter", label: "filter" },
  { keys: ["o"], does: "workspaces", label: "workspaces" },
  { keys: ["?"], does: "help", label: "help" },
  { keys: ["escape"], does: "list", label: "the list" },
].map((entry) => Object.freeze({ ...entry, keys: Object.freeze([...entry.keys]) })));
/** key id -> what the leader then does (LEADER's `does`). */
export const LEADER_KEYS = new Map(LEADER.flatMap((entry) => entry.keys.map((key) => [key, entry.does])));

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

/** The modifiers of the back key's grammar (term/through.mjs BACK_KEY) as a person reads them. */
const BACK_MODIFIERS = Object.freeze({ C: "Ctrl", M: "Alt", S: "Shift" });
/** A back key (tui.json's open.detachKey, the leader) as the cheat sheet and the help name it, spelt
 *  for people as keyLabel spells a key id: `C-\\` is `Ctrl+\\`, `C-x` is `Ctrl+X`, `M-o` is `Alt+O`,
 *  `M-5` is `Alt+5`, `F12` is `F12`, `S-F5` is `Shift+F5`. A letter is written as a capital, which
 *  never means Shift (the grammar has lowercase Meta letters only). Pure. A value outside the
 *  grammar is answered as it was given (tui.json refuses it; a view draws it as text from outside). */
export function backKeyLabel(key) {
  if (!isBackKey(key)) return key;
  const [, mod, rest] = /^(?:([CMS])-)?(.+)$/.exec(key);
  const name = rest.length === 1 ? rest.toUpperCase() : rest;
  return mod ? `${BACK_MODIFIERS[mod]}+${name}` : name;
}
