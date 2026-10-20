// The help view: the action table, the marks and what this version does not do, as rows of safe
// text. Pure: no IO, no clock, no escape byte. The keys are generated from the table the reducer
// acts on, so the help names every key that does something and no key that does not; the marks
// are the ones the list and the switcher draw (views/instances.mjs, views/switcher.mjs).
import { LEADER, backKeyLabel, keyLabel, keysTogether } from "../actions.mjs";
import { lit, ownEllipsis } from "../term/text.mjs";
import { style } from "../term/style.mjs";
import { cutNote, marksOf, measured } from "./instances.mjs";
import { windowOf } from "./scroll.mjs";
import { SOUL_MARK } from "./souls.mjs";
import { OPEN_MARK } from "./switcher.mjs";

const TITLE = style({ bold: true });
const KEYS = style({ bold: true });
const HINT = style({ dim: true });
const INDENT = 2;
const GAP = 3;

/** The keys of an action as a person reads them: `q, Ctrl+C`. */
export const keysLabel = (action) => action.keys.map(keyLabel).join(", ");
/** A key's label for the screen: `{ text, width }`. A key is the user's once their tui.json names
 *  it, so its label is text the TUI did not write: it goes through shown(), and takes the cells
 *  its display takes (a key may be a wide character). */
export function keyText(label) {
  return measured(label);
}

/** What this version does not do, each with the `oats` command that does it: an omission is
 *  stated where a user looks for it. test/tui-word.test.mjs holds every command here to the
 *  kernel's own usage, so the help cannot name a command that does not exist. A later version
 *  removes a line when it adds the act. */
export const NOT_YET = Object.freeze([
  // The spawn prompt (n, N) spawns on this machine, with the launch the soul and this machine
  // choose, and no task: the rest is the kernel's command's (run on that machine for another).
  Object.freeze({ what: "spawn on another machine", command: "oats spawn <soul>" }),
  Object.freeze({ what: "spawn with a harness, model or task", command: "oats spawn <soul>" }),
  // The Capabilities view lists them and their facts: a capability's skills' text and its files are the kernel's command's.
  Object.freeze({ what: "see a capability's skills and files", command: "oats capabilities show <name>" }),
  Object.freeze({ what: "open an agent in its own tmux window", command: "oats session attach --home <home>" }),
  Object.freeze({ what: "start with another harness or model", command: "oats session start --home <home>" }),
  Object.freeze({ what: "add a machine to this workspace", command: "oats server connect <id> --ssh <alias> --dir <path on that machine>" }),
  Object.freeze({ what: "check a machine", command: "oats server check <id>" }),
  Object.freeze({ what: "remove a machine", command: "oats server remove <id>" }),
  // The switcher lists the deployments opened in this run and those on this computer's list, and no other.
  Object.freeze({ what: "open a deployment that is not listed", command: "oats tui --dir <path>" }),
]);
/** What a user should know of the machines the list shows, each a sentence of the TUI's own: a
 *  limit that no command lifts is stated too. */
export const MACHINES = Object.freeze([
  "A machine's rows are what it reported at the time on its heading (in a view of one machine, at the top of this help).",
  "Nothing of its own is kept on disk: a machine not reached in this run is listed by its own name.",
  "Souls and Capabilities are this machine's.",
]);
/** The views the frame names, what each holds, and what to run for what a view does not do yet.
 *  The Souls view spawns an agent of the selected soul (n, N). */
export const VIEWS = Object.freeze([
  Object.freeze({ name: "1 Instances", what: "the instances of the open workspace", commands: Object.freeze([]) }),
  Object.freeze({ name: "2 Souls", what: "the souls of the open workspace and their detail, i their instances, n an agent of the selected soul", commands: Object.freeze([]) }),
  Object.freeze({ name: "3 Capabilities", what: "the capabilities of the open workspace and their detail, Enter on a soul that uses one shows it in Souls", commands: Object.freeze([]) }),
]);

const words = (text) => text.split(" ");
/** Pieces set on lines of at most `room` cells, a space between two; a piece is never broken. */
const flow = (pieces, room) => pieces.reduce((lines, piece) => {
  const last = lines.at(-1);
  if (last !== undefined && last.length + 1 + piece.length <= room) lines[lines.length - 1] = `${last} ${piece}`;
  else lines.push(piece);
  return lines;
}, []);
/** A table: a left column as wide as its widest entry, then what each entry means, given as
 *  pieces that are never cut (a word, or a whole command: a command cut short cannot be typed).
 *  What does not fit `cols` goes on in the same column on the next row. A table with a piece
 *  wider than that column puts every meaning under its entry instead, so no row is cut at the
 *  smallest width the frame draws at; a piece wider than even that starts further left, and a
 *  command wider than the whole area is broken before its flags (commandRows). */
function table(pairs, cols, look) {
  // An entry is the TUI's own word, or text made elsewhere with its width (a key's label). A
  // third member makes rows of its own under the entry's meaning: given the meaning's column and
  // the cells it has, it answers rows of spans placed from column 0.
  const under = new Map(pairs.map(([, pieces, more]) => [pieces, more]));
  pairs = pairs.map(([left, pieces]) => [typeof left === "string" ? { text: lit(left), width: left.length } : left, pieces]);
  const entry = (left) => ({ col: INDENT, text: left.text, width: left.width, ...(look ? { style: look } : {}) });
  const column = INDENT + Math.max(...pairs.map(([left]) => left.width)) + GAP;
  const stacked = pairs.some(([, pieces]) => pieces.some((piece) => column + piece.length > cols));
  const at = stacked ? INDENT + 2 : column;
  return pairs.flatMap(([left, pieces]) => {
    // A row wider than its column (a whole command, in a narrow area) starts as far left as it
    // must to stand whole, down to the area's first column: a command cut short cannot be typed.
    const lines = flow(pieces, cols - at).flatMap((text) => (text.length <= cols ? [{ col: Math.max(0, Math.min(at, cols - text.length)), text: lit(text) }] : commandRows(text, at, cols)));
    const more = (under.get(pieces)?.(cols - at) ?? []).map((spans) => spans.map((span) => ({ ...span, col: span.col + at })));
    return [...(stacked ? [[entry(left)], ...lines.map((line) => [line])] : lines.map((line, i) => (i === 0 ? [entry(left), line] : [line]))), ...more];
  });
}

/** A command wider than the whole area (`oats server connect`'s, at 80 columns and under), on as
 *  few rows as it needs: broken only before a flag (`--dir`), each flag with its value, the rows
 *  after the first 2 cells further in, so read in order they are the command, and every row
 *  stands whole inside the area, as far right as `at` when there is room. */
function commandRows(command, at, cols) {
  const rows = command.split(/ (?=--)/).reduce((rows, part) => {
    const last = rows.length - 1;
    if (last >= 0 && rows[last].length + 1 + part.length <= (last === 0 ? cols : cols - 2)) rows[last] += ` ${part}`;
    else rows.push(part);
    return rows;
  }, []);
  const start = Math.max(0, Math.min(at, cols - Math.max(rows[0].length, ...rows.slice(1).map((row) => row.length + 2))));
  return rows.map((row, i) => ({ col: start + (i === 0 ? 0 : 2), text: lit(row) }));
}

/** The TUI's own sentences under the line of `open` in the list of instances: what the terminal
 *  takes, what it does not do, and where the keys that can be the back key are listed (the help
 *  does not restate the grammar). */
export const OPEN_RULES = Object.freeze([
  "While the terminal has the focus every other key goes to the agent, Ctrl+C and Ctrl+Z too.",
  "Up to 4 terminals are open at a time, each a tab. They have no scrollback but the viewer's own, and no mouse.",
  "docs/tui.md has the keys that can be the leader.",
]);
/** The rows under the line of `open`, in `room` cells: the leader then Esc, which takes the focus
 *  from the open terminal, and the leader twice, which types it into the terminal (tui.json's
 *  open.detachKey, text from outside), then OPEN_RULES, each sentence on as many rows as it needs. */
function openRows(detachKey, room, chorded = false) {
  const label = backKeyLabel(detachKey), esc = keyLabel(LEADER.find((entry) => entry.does === "list").keys[0]);
  const pair = (keys, said) => {
    const key = keyText(keys), lines = flow(words(said), Math.max(1, room - key.width - 1));
    return [[{ col: 0, text: key.text, width: key.width }, { col: key.width + 1, text: lit(lines[0]) }], ...lines.slice(1).map((text) => [{ col: key.width + 1, text: lit(text) }])];
  };
  return [
    ...pair(`${label} ${esc}`, "takes the focus from the terminal back to the list; the agent keeps running."),
    ...pair(`${label} ${label}`, "types the leader into the terminal."),
    ...[...OPEN_RULES, ...(chorded ? [CHORD_OPEN_RULE] : [])].flatMap((sentence) => flow(words(sentence), room).map((text) => [{ col: 0, text: lit(text) }])),
  ];
}
/** Under OPEN_RULES, while the chords are listed: they too are the TUI's in a terminal. */
export const CHORD_OPEN_RULE = "The chords are taken there too: they never reach the agent.";
/** The TUI's own sentences under the line of the last act: how a confirmation is worked, and that
 *  what it sent is never ended by the TUI. */
export const ACT_RULES = Object.freeze([
  "Each act opens a confirmation with Cancel chosen: move to the act with Left/Right or Tab, then press Enter.",
  "Esc closes a confirmation; an act it sent goes on, also after oats tui quits.",
]);
const actRows = (room) => ACT_RULES.flatMap((sentence) => flow(words(sentence), room).map((text) => [{ col: 0, text: lit(text) }]));
const heading = (text) => [{ col: INDENT, text: lit(text), style: TITLE }];
/** Sentences, each from the left margin on as many rows as it needs, with that margin kept at
 *  the right too: its later rows are set in, so the next sentence is seen to start. */
const sentences = (list, cols) => list.flatMap((sentence) => {
  const [first, ...rest] = flow(words(sentence), cols - 2 * INDENT);
  return [first, ...flow(rest.flatMap(words), cols - 2 * INDENT - 2)].map((text, i) => [{ col: INDENT + (i ? 2 : 0), text: lit(text) }]);
});

/** What the leader pressed again does, the last line of the leader's table. */
export const LEADER_AGAIN = "the leader again: types it into the terminal that has the focus; with the list focused, closes the hint";

/** THE CHORDS (docs/tui.md, "Chords"): the chords read now, the extras of the leader, which is the
 *  key that always works. While the terminal confirms the kitty keyboard protocol they lead the
 *  help, first of all; without it only the Alt+Shift arrows are read, listed after the leader's
 *  section. What a
 *  terminal may take first is said, and where the table of terminals is, as sentences the help
 *  flows. */
export const CHORD_RULES = Object.freeze([
  "Your terminal may take some first: Windows Terminal takes Ctrl+Alt+1 to Ctrl+Alt+9 for its own tabs, and the Alt+Shift arrows while its panes are split.",
  "Terminals without the kitty keyboard protocol (GNOME Terminal and the other VTE terminals, Konsole before 26.08, WezTerm unless enable_kitty_keyboard is set) send only the Alt+Shift arrows.",
  "On a keyboard layout where AltGr is Ctrl+Alt (Windows), a Ctrl+Alt key that types a character types it.",
  "The leader works in every terminal.",
  "docs/tui.md, \"Chords\", has the table of terminals.",
]);
/** The chords listed on one row of their own, both keys first, their modifiers said once
 *  (`Alt+Shift+Up/Down`, actions.mjs keysTogether, as the cheat sheet says them): the leader's Up
 *  and Down, its Left and Right. The table's left column stays narrow enough for the help beside
 *  the sidebar at 80 columns. */
const CHORD_PAIRS = Object.freeze([Object.freeze(["previous", "next"]), Object.freeze(["tab-previous", "tab-next"])]);
/** The chords' own (actions.mjs CHORD_OWN), the Nth tab: one row for the nine, as the TUI's words. */
const TAB_N = /^tab-([1-9])$/;
const TABS_SAID = "the focused group's first to eighth tab, 9 its last";
/** Two labels of the leader's table as one: `previous instance` and `next instance` are
 *  `previous and next instance`. */
function bothSaid(a, b) {
  const [x, y] = [words(a), words(b)];
  return x.length > 1 && x.at(-1) === y.at(-1) ? `${x.slice(0, -1).join(" ")} and ${y.join(" ")}` : `${a} and ${b}`;
}
/** The chords' rows: `chords` are `[key id, does]` in the table's order, each said as the leader's
 *  table says its `does`, then `or <the leader> then <its key>` (`detachKey`'s label, when one is
 *  given); a pair of CHORD_PAIRS on one row, and the nine tab-N on one, `Ctrl+Alt+1 … Ctrl+Alt+9`
 *  (`...` in ASCII), which no leader's key does. */
function chordRows(chords, cols, detachKey, ascii) {
  const by = (does) => LEADER.find((entry) => entry.does === does);
  const leader = typeof detachKey === "string" ? backKeyLabel(detachKey) : null;
  const then = (list) => (leader === null || list.some((does) => !by(does)) ? "" : `, or ${leader} then ${list.map((does) => keyLabel(by(does).keys[0])).join(" and ")}`);
  const keyOf = new Map(chords.map(([key, does]) => [does, key]));
  const tabs = chords.filter(([, does]) => TAB_N.test(does));
  const done = new Set(), rows = [];
  for (const [key, does] of chords) {
    if (done.has(does)) continue;
    const pair = CHORD_PAIRS.find((each) => each.includes(does) && each.every((one) => keyOf.has(one)));
    if (pair) {
      pair.forEach((one) => done.add(one));
      rows.push([keysTogether(pair.map((one) => keyOf.get(one))), `${bothSaid(by(pair[0]).label, by(pair[1]).label)}${then(pair)}`]);
    } else if (TAB_N.test(does) && tabs.length === 9) {
      tabs.forEach(([, one]) => done.add(one));
      rows.push([ownEllipsis(`${keyLabel(tabs[0][0])} \u2026 ${keyLabel(tabs[8][0])}`, ascii), TABS_SAID]);
    } else {
      const n = TAB_N.exec(does)?.[1];
      rows.push([keyLabel(key), n === undefined ? `${by(does)?.label ?? does}${then([does])}` : n === "9" ? "the focused group's last tab" : `the focused group's tab ${n}`]);
    }
  }
  return [
    heading("Chords"),
    [],
    ...sentences(["One keypress each, from every focus, a terminal's too: none reaches the agent."], cols),
    ...table(rows.map(([keys, said]) => [keyText(keys), words(said)]), cols, KEYS),
    ...sentences(CHORD_RULES, cols),
  ];
}

/** The palette's keys (docs/tui.md, "The palette"): it reads its keys itself, so they are fixed
 *  and the TUI's words. */
export const PALETTE_KEYS = Object.freeze([
  Object.freeze(["Up, Down", "move; typing narrows the list"]),
  Object.freeze(["Enter", "run the selected row"]),
  Object.freeze(["Esc", "close the palette"]),
]);
const paletteRows = (cols) => [heading("The palette"), [], ...table(PALETTE_KEYS.map(([keys, said]) => [keys, words(said)]), cols, KEYS)];

/** The leader's rows (docs/tui.md, "The leader"): its key, then the table of what each key after
 *  it does (actions.mjs LEADER), from every focus. */
function leaderRows(detachKey, cols) {
  const key = keyText(backKeyLabel(detachKey));
  // The sentence after the key on as many rows as it needs, its later rows under its first.
  const at = INDENT + key.width + 1;
  const lead = flow(words("then one of these keys, from every focus; a terminal too:"), Math.max(1, cols - INDENT - at));
  return [
    [{ col: INDENT, text: lit("The leader"), style: TITLE }],
    [],
    [{ col: INDENT, text: key.text, width: key.width, style: KEYS }, { col: at, text: lit(lead[0]) }],
    ...lead.slice(1).map((text) => [{ col: at, text: lit(text) }]),
    ...table([...LEADER.map((entry) => [entry.keys.map(keyLabel).join(", "),
      words(entry.terminal ? `${entry.label}, while a terminal is open` : entry.label)]),
    // The leader again is the user's key, so it is not in the table: it types the leader into the
    // terminal that has the focus, and with the list focused only closes the hint.
    [key, words(LEADER_AGAIN)]], cols, KEYS),
  ];
}

/** The spawn prompt's keys (docs/tui.md, "Spawning an agent"): the prompt reads its keys itself, as
 *  the palette does, so they are fixed and the TUI's words. Each step's keys, then the paste guard. */
export const SPAWN_KEYS = Object.freeze([
  Object.freeze(["Up, Down", "move in the soul picker; typing narrows it"]),
  Object.freeze(["Enter", "pick the selected soul; a soul marked ! would be refused here and cannot be picked"]),
  Object.freeze(["Esc", "close the soul picker"]),
  Object.freeze(["Tab, Shift+Tab", "move the focus in the preview: Spawn, name, child of, then each fold"]),
  Object.freeze(["Enter", "do what the cheat sheet names: on Spawn spawn, on name keep the name and read the preview again, on child of switch it, on a fold open or close it"]),
  Object.freeze(["Esc", "from a field back to Spawn; from Spawn back to the picker, or to the list"]),
]);
export const SPAWN_RULES = Object.freeze([
  "Enter spawns only once the preview on the screen is the one for the choices shown, read after it was first drawn: a paste cannot spawn.",
]);
const spawnRows = (cols) => [heading("The spawn prompt"), [], ...table(SPAWN_KEYS.map(([keys, said]) => [keys, words(said)]), cols, KEYS), ...sentences(SPAWN_RULES, cols)];

/** Every row of the help for an area `cols` wide, before it is scrolled. Unbound actions are
 *  listed as such: the table can be changed by the user's tui.json, and the help says what is so
 *  now. An action that does one thing in each view has a line per view, its key on each; under
 *  the line of opening an agent stand the back key (`detachKey`, tui.json's `open.detachKey`) and
 *  the rules of OPEN_RULES; under the line of the last act, ACT_RULES. The chords read now
 *  (`chords`, `[key id, does]`; none, or null, lists none) lead the whole help while the terminal
 *  confirms the kitty keyboard protocol (`chordsLead`), before this table; without it they come
 *  after the leader's table. Then the palette's keys (PALETTE_KEYS) and the spawn prompt's
 *  (SPAWN_KEYS, SPAWN_RULES). */
export function helpRows(actions, ascii, cols = 100, detachKey = null, chords = null, chordsLead = false) {
  const marks = marksOf(ascii), chorded = chords !== null && chords.length > 0;
  const closing = keyText(["close", "help"].map((id) => actions.find((action) => action.id === id)).filter((action) => action?.keys.length).map((action) => keyLabel(action.keys[0])).join(" or "));
  return [
    ...(chorded && chordsLead ? [...chordRows(chords, cols, detachKey, ascii), []] : []),
    heading("Keys"),
    [],
    ...table(actions.flatMap((action) => {
      const left = action.keys.length ? keyText(keysLabel(action)) : "(no key)";
      if (!action.views) return [[left, words(action.label)]];
      return action.views.map(([view, said]) => [left, words(said), action.id === "open" && view === "instances" && detachKey !== null ? (room) => openRows(detachKey, room, chorded)
        : action.id === "restart" ? actRows : undefined]);
    }), cols, KEYS),
    ...(detachKey !== null ? [[], ...leaderRows(detachKey, cols)] : []),
    ...(chorded && !chordsLead ? [[], ...chordRows(chords, cols, detachKey, ascii)] : []),
    [],
    ...paletteRows(cols),
    [],
    ...spawnRows(cols),
    [],
    heading("Marks"),
    [],
    ...table([
      [marks.running, "running"],
      [marks.stopped, "stopped"],
      [marks.shell, "stopped, with a shell left in its terminal"],
      [marks.unknown, "state unknown"],
      [marks.held, ownEllipsis("held by a spawn or a retire: under way (Retiring\u2026), failed or not finished", ascii)],
      ["+N", "N instances folded away below it"],
      [marks.waiting, "needs input"],
      [`${marks.waiting}N`, "N instances folded away below it need input"],
      [marks.selected, "the selected row, and the pane the movement keys act on"],
      [OPEN_MARK, "among the workspaces: the one that is open"],
      [ascii ? SOUL_MARK.ascii : SOUL_MARK.utf8, "among the souls: a soul, in its colour"],
      ["!", "among the souls: a spawn of it here would be refused"],
    ].map(([mark, meaning]) => [mark, words(meaning)]), cols),
    [],
    heading("Views"),
    [],
    ...table(VIEWS.map((view) => [view.name, view.commands.length ? [...words(`${view.what}:`), ...view.commands.map((command, i) => (i < view.commands.length - 1 ? `${command},` : command))] : words(view.what)]), cols),
    [],
    heading("Machines"),
    [],
    ...sentences(MACHINES, cols),
    [],
    heading("Not in this version"),
    [],
    ...table(NOT_YET.map(({ what, command }) => [what, [command]]), cols),
    ...(closing.width ? [[], [{ col: INDENT, text: closing.text, width: closing.width, style: HINT }, { col: INDENT + closing.width + 1, text: lit("closes this help"), style: HINT }]] : []),
  ];
}

/** `{ rows, extent }`: `size.rows` rows for an area `size.cols` wide, scrolled to `top`, and how
 *  many rows the whole help has. The movement keys scroll it. */
export function help(actions, size, { top = 0, ascii = false, detachKey = null, chords = null, chordsLead = false } = {}) {
  const all = helpRows(actions, ascii, size.cols, detachKey, chords, chordsLead);
  const rows = Array.from({ length: size.rows }, () => []);
  const win = windowOf({ top, count: all.length, height: size.rows });
  all.slice(win.top, win.top + win.size).forEach((spans, i) => { rows[i] = spans; });
  const note = cutNote(win.above, win.below);
  if (note && size.rows > 0) rows[size.rows - 1] = [{ col: INDENT, text: lit(note), style: HINT }];
  return { rows, extent: all.length };
}
