/** The keys both clients share: the leader, the table read after it, the plain keys of the list
 * of instances, the chords, and the palette's own keys. Written down once, here; the Desktop and the TUI read their defaults
 * from it (packages/tui/lib/actions.mjs LEADER is LEADER_TABLE, and the TUI's test
 * packages/tui/test/keymap.test.mjs fails on a `does` the TUI does not handle).
 *
 * Pure data and readers: no state, no DOM, no imports. Every value is frozen.
 *
 * Key ids are the TUI's spelling (packages/tui/lib/term/keys.mjs keyId): one character as itself,
 * case kept (`n`, `N`, `|`, `?`, `/`, `-`); named keys `up` `down` `left` `right` `tab` `escape`
 * `space` `enter` `home` `end` `pageup` `pagedown`; modifiers as `ctrl+` / `alt+` / `shift+`
 * prefixes, in that order. A chord adds two: `shift+` with Ctrl or Alt and a letter or an arrow
 * (`ctrl+alt+shift+e`, `alt+shift+up`), and `cmd+`, first, for macOS's Command (`cmd+k`, the
 * Desktop's ⌘K), which a terminal never passes to a program.
 *
 *   leaderKey(isMac)        -> the leader's key id on that platform        "ctrl+\\" / "alt+o"
 *   leaderDoes(key)         -> what the leader then does for a key id, or null
 *   plainKeys(does)         -> the plain key ids of an action (empty when it has none)
 *   leaderRows()            -> LEADER_TABLE
 *   chordKey(does, isMac, family)    -> the chord's key id on that platform and in that family, or null
 *   chordKeyOf(entry, isMac, family) -> the same for a CHORDS row
 *   paletteKey(does, isMac) -> the palette's own key id on that platform, or null
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

/** The chords: one key that does what the leader then a key does, from every focus, the same in
 * both clients, per platform (`mac`, `other`). The Desktop's DEFAULT_KEYMAP reads these entries from
 * here (CHORDS_READ, docs/desktop-keyboard.md); the TUI binds the `other` ones, and the `mac` ones
 * without `cmd+`, from every focus (docs/tui.md, "Chords"). The leader stays the key that always
 * works: help, the views and the acts (stop, restart, start, retire) are reached by it alone.
 *
 * One family, so that no terminal's own keys take them (the matrix in docs/tui.md, "Chords"):
 * Ctrl+Alt with a letter or a digit for an action, Alt+Shift with the leader's arrow to move. On
 * macOS the Desktop holds ⌘ (⌘⌥ for the rows new in phase 3). A Ctrl+Alt chord reaches the TUI only
 * under the kitty keyboard protocol (ESC then Ctrl+K is what Ctrl+Alt+K sends without it); an
 * Alt+Shift arrow has a sequence of its own (`CSI 1;4A`) and reaches it with or without. `tab-N`
 * shows the Nth tab of the focused group, `tab-9` its last. The Desktop's Ctrl+Tab, Ctrl+1/2/3 (the
 * stages) and Ctrl+, are the Desktop's own and are not here.
 *
 * `shift` is the row's key in the Ctrl+Shift family, the option a user picks in keys.json
 * (packages/client/keys-file.mjs) for a terminal that passes Ctrl+Shift apart from Ctrl: foot and
 * Alacritty (docs/tui.md, "Which family for my terminal"). Seven rows move (K palette, P spawn,
 * S workspaces, M zoom, W close, E split right, D split down: the maintainer's cut, a43470ce); the
 * others keep their `other` key in both families: the Alt+Shift arrows, since Ctrl+Shift+arrow
 * selects text in inputs and editors; Ctrl+Alt+1–9, since Ctrl+Shift+digit is a shifted symbol on
 * most layouts; group-next and filter, whose Ctrl+Shift A and F a terminal or an agent takes; and
 * edit-instance, the Desktop's alone, Ctrl+Alt+R in both. macOS has no family: `mac` is the only key there. */
export const CHORDS = Object.freeze([
  { does: "palette", mac: "cmd+k", other: "ctrl+alt+k", shift: "ctrl+shift+k" },
  { does: "spawn", mac: "cmd+p", other: "ctrl+alt+p", shift: "ctrl+shift+p" },
  { does: "workspaces", mac: "cmd+alt+o", other: "ctrl+alt+o", shift: "ctrl+shift+s" },
  { does: "previous", mac: "cmd+alt+up", other: "alt+shift+up" },
  { does: "next", mac: "cmd+alt+down", other: "alt+shift+down" },
  { does: "tab-previous", mac: "cmd+alt+left", other: "alt+shift+left" },
  { does: "tab-next", mac: "cmd+alt+right", other: "alt+shift+right" },
  ...Array.from({ length: 9 }, (_, i) => ({ does: `tab-${i + 1}`, mac: `cmd+alt+${i + 1}`, other: `ctrl+alt+${i + 1}` })),
  { does: "zoom", mac: "cmd+alt+z", other: "ctrl+alt+z", shift: "ctrl+shift+m" },
  { does: "close-terminal", mac: "cmd+w", other: "ctrl+alt+w", shift: "ctrl+shift+w" },
  { does: "split-right", mac: "cmd+\\", other: "ctrl+alt+e", shift: "ctrl+shift+e" },
  { does: "split-down", mac: "cmd+shift+\\", other: "ctrl+alt+shift+e", shift: "ctrl+shift+d" },
  { does: "group-next", mac: "cmd+alt+a", other: "ctrl+alt+a" },
  { does: "filter", mac: "cmd+f", other: "ctrl+alt+f" },
  // The Desktop's alone for now (#1421): its name and colour dialog. No leader key; the TUI has no
  // such action, so it binds no key for it (chordKeys skips a `does` it does not handle). Not one of
  // the seven the Ctrl+Shift family moves: Ctrl+Alt+R in both families (the maintainer's ruling).
  { does: "edit-instance", mac: "cmd+alt+r", other: "ctrl+alt+r" },
].map((entry) => Object.freeze({ ...entry, shift: entry.shift ?? entry.other })));

/** The palette's own keys, read only while the palette is open: there they win over every binding
 * (the Desktop's ⌘N, `app.chooseSoul`; the chords `previous` and `next`), so they are not CHORDS,
 * which are bound from every focus. The selection goes to the first row of the next group, or of
 * the one before, and wraps (docs/tui.md, "The palette"; packages/desktop/docs/desktop-keyboard.md).
 * On macOS the TUI has none: a terminal never passes ⌘. The previous group is ⌥⌘N, not ⇧⌘N: that is
 * the Desktop's File → New Window, a key its menu shows, which the palette does not shadow. */
export const PALETTE_KEYS = Object.freeze([
  { does: "palette-next-group", mac: "cmd+n", other: "alt+shift+down" },
  { does: "palette-previous-group", mac: "cmd+alt+n", other: "alt+shift+up" },
].map((entry) => Object.freeze({ ...entry })));

/** The chord families on Linux and Windows: the default and the option (CHORDS `other` and `shift`),
 * with the name a client shows for each. */
export const CHORD_FAMILIES = Object.freeze(["ctrl+alt", "ctrl+shift"]);
export const DEFAULT_CHORD_FAMILY = "ctrl+alt";
export const CHORD_FAMILY_LABELS = Object.freeze({ "ctrl+alt": "Ctrl+Alt", "ctrl+shift": "Ctrl+Shift" });

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

/** The key id of the CHORDS row `entry` on macOS (`true`) or elsewhere, in `family` (CHORD_FAMILIES;
 * anything else is the default), which macOS ignores. */
export function chordKeyOf(entry, isMac, family = DEFAULT_CHORD_FAMILY) {
  return isMac ? entry.mac : family === "ctrl+shift" ? entry.shift : entry.other;
}

/** The key id of the chord that does `does` on macOS (`true`) or elsewhere, in `family` (chordKeyOf),
 * or null when none does. */
export function chordKey(does, isMac, family = DEFAULT_CHORD_FAMILY) {
  const entry = CHORDS.find((each) => each.does === does);
  return entry === undefined ? null : chordKeyOf(entry, isMac, family);
}

/** The key id of the palette's own key that does `does` on macOS (`true`) or elsewhere, or null. */
export function paletteKey(does, isMac) {
  const entry = PALETTE_KEYS.find((each) => each.does === does);
  return entry === undefined ? null : isMac ? entry.mac : entry.other;
}
