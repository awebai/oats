/** The keys both clients share: the leader, the table read after it, the plain keys of the list
 * of instances, and the chords. Written down once, here; the Desktop and the TUI read their defaults
 * from it (packages/tui/lib/actions.mjs LEADER is LEADER_TABLE, and the TUI's test
 * packages/tui/test/keymap.test.mjs fails on a `does` the TUI does not handle).
 *
 * Pure data and readers: no state, no DOM, no imports. Every value is frozen.
 *
 * Key ids are the TUI's spelling (packages/tui/lib/term/keys.mjs keyId): one character as itself,
 * case kept (`n`, `N`, `|`, `?`, `/`, `-`); named keys `up` `down` `left` `right` `tab` `escape`
 * `space` `enter` `home` `end` `pageup` `pagedown`; modifiers as `ctrl+` / `alt+` / `shift+`
 * prefixes, in that order. A chord adds two: `shift+` with Ctrl and a letter (`ctrl+shift+k`, which
 * the TUI reads only under the kitty keyboard protocol), and `cmd+`, first, for macOS's Command
 * (`cmd+k`, the Desktop's ⌘K), which a terminal never passes to a program.
 *
 *   leaderKey(isMac)        -> the leader's key id on that platform        "ctrl+\\" / "alt+o"
 *   leaderDoes(key)         -> what the leader then does for a key id, or null
 *   plainKeys(does)         -> the plain key ids of an action (empty when it has none)
 *   leaderRows()            -> LEADER_TABLE
 *   chordKey(does, isMac)   -> the chord's key id on that platform, or null
 *
 * `does` names an action, not a client's code: each client maps it to its own. */

/** The leader per platform: Ctrl+\ on macOS, Alt+O elsewhere. */
export const LEADER = Object.freeze({ mac: "ctrl+\\", other: "alt+o" });

/** The keys read after the leader, in the TUI's order, and what each does. `terminal`: named in
 * the hint only while a terminal is open. The leader pressed twice is not here: it is the user's
 * key, and each client says what it does. */
export const LEADER_TABLE = Object.freeze([
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
].map((row) => Object.freeze({ ...row, keys: Object.freeze([...row.keys]) })));

/** The plain keys both clients read in the list of instances (the TUI's ACTIONS), one entry per action. */
export const PLAIN_KEYS = Object.freeze([
  { does: "up", keys: ["up", "k"] },
  { does: "down", keys: ["down", "j"] },
  { does: "top", keys: ["g", "home"] },
  { does: "bottom", keys: ["G", "end"] },
  { does: "page-up", keys: ["pageup"] },
  { does: "page-down", keys: ["pagedown"] },
  { does: "collapse", keys: ["left", "h"] },
  { does: "expand", keys: ["right", "l"] },
  { does: "filter", keys: ["/"] },
  { does: "refresh", keys: ["r"] },
  { does: "instances", keys: ["1"] },
  { does: "souls", keys: ["2"] },
  { does: "capabilities", keys: ["3"] },
  { does: "workspaces", keys: ["w"] },
  { does: "open", keys: ["enter"] },
  { does: "zoom", keys: ["z"] },
  { does: "close-terminal", keys: ["c"] },
  { does: "tab-previous", keys: ["["] },
  { does: "tab-next", keys: ["]"] },
  { does: "split-right", keys: ["|"] },
  { does: "split-down", keys: ["-"] },
  { does: "stop", keys: ["X"] },
  { does: "retire", keys: ["D"] },
  { does: "start", keys: ["S"] },
  { does: "restart", keys: ["R"] },
  { does: "spawn", keys: ["n"] },
  { does: "spawn-another", keys: ["N"] },
  { does: "help", keys: ["?"] },
].map((entry) => Object.freeze({ ...entry, keys: Object.freeze([...entry.keys]) })));

/** The chords: one key that does what the leader then a key does, the Desktop's direct chords whose
 * action the TUI has too, per platform (`mac`, `other`). The Desktop's DEFAULT_KEYMAP reads these
 * entries from here (docs/desktop-keyboard.md). The TUI takes the `other` ones, and the `mac` ones
 * without `cmd+`, while the terminal confirms the kitty keyboard protocol (docs/tui.md, "Chords"),
 * as extras: the leader stays the key that always works. The Desktop's Ctrl+1/2/3 (the stages) are
 * the Desktop's own and are not here. */
export const CHORDS = Object.freeze([
  { does: "palette", mac: "cmd+k", other: "ctrl+shift+k" },
  { does: "spawn", mac: "cmd+p", other: "ctrl+shift+p" },
  { does: "tab-next", mac: "ctrl+tab", other: "ctrl+tab" },
  { does: "tab-previous", mac: "ctrl+shift+tab", other: "ctrl+shift+tab" },
  { does: "close-terminal", mac: "cmd+w", other: "ctrl+shift+w" },
  { does: "filter", mac: "cmd+f", other: "ctrl+shift+f" },
  { does: "split-right", mac: "cmd+\\", other: "ctrl+shift+e" },
  { does: "split-down", mac: "cmd+shift+\\", other: "ctrl+shift+o" },
].map((entry) => Object.freeze({ ...entry })));

const NONE = Object.freeze([]);

/** The leader's key id on macOS (`true`) or elsewhere. */
export function leaderKey(isMac) {
  return isMac ? LEADER.mac : LEADER.other;
}

/** What the leader then does for `keyId`, or null when the table has no such key. */
export function leaderDoes(keyId) {
  for (const row of LEADER_TABLE) if (row.keys.includes(keyId)) return row.does;
  return null;
}

/** The plain key ids of the action `does`, frozen; empty when it has none. */
export function plainKeys(does) {
  return PLAIN_KEYS.find((entry) => entry.does === does)?.keys ?? NONE;
}

/** The leader's table, LEADER_TABLE itself. */
export function leaderRows() {
  return LEADER_TABLE;
}

/** The key id of the chord that does `does` on macOS (`true`) or elsewhere, or null when none does. */
export function chordKey(does, isMac) {
  const entry = CHORDS.find((each) => each.does === does);
  return entry === undefined ? null : isMac ? entry.mac : entry.other;
}
