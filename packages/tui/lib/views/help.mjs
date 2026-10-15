// The help view: the action table, the marks and what this version does not do, as rows of safe
// text. Pure: no IO, no clock, no escape byte. The keys are generated from the table the reducer
// acts on, so the help names every key that does something and no key that does not; the marks
// are the ones the list and the switcher draw (views/instances.mjs, views/switcher.mjs).
import { LEADER, keyLabel } from "../actions.mjs";
import { lit, ownEllipsis } from "../term/text.mjs";
import { style } from "../term/style.mjs";
import { cutNote, marksOf, measured } from "./instances.mjs";
import { windowOf } from "./scroll.mjs";
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
  Object.freeze({ what: "open an agent in its own tmux window", command: "oats session attach --home <home>" }),
  Object.freeze({ what: "start with another harness or model", command: "oats session start --home <home>" }),
  Object.freeze({ what: "add a machine to this workspace", command: "oats server connect <id> --ssh <alias>" }),
  Object.freeze({ what: "check a machine", command: "oats server check <id>" }),
  Object.freeze({ what: "remove a machine", command: "oats server remove <id>" }),
  // The switcher lists the deployments opened in this run and those in ~/Agents, and no other.
  Object.freeze({ what: "open a deployment outside ~/Agents", command: "oats tui --dir <path>" }),
]);
/** What a user should know of the machines the list shows, each a sentence of the TUI's own: a
 *  limit that no command lifts is stated too. */
export const MACHINES = Object.freeze([
  "A machine's rows are what it reported at the time on its heading (in a view of one machine, in the header).",
  "Nothing is kept on disk: a machine not reached in this run is listed by its own name.",
  "Souls and Capabilities, when they come, are this machine's.",
]);
/** The views the frame names, and for the two that cannot be opened yet, what to run instead. */
export const VIEWS = Object.freeze([
  Object.freeze({ name: "1 Instances", what: "the instances of the open workspace", commands: Object.freeze([]) }),
  Object.freeze({ name: "2 Souls", what: "not in this version", commands: Object.freeze(["oats souls", "oats spawn <soul>"]) }),
  Object.freeze({ name: "3 Capabilities", what: "not in this version", commands: Object.freeze(["oats capabilities"]) }),
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
 *  pieces that are never broken (a word, or a whole command: a command cut in two cannot be
 *  typed). What does not fit `cols` goes on in the same column on the next row. A table with a
 *  piece wider than that column puts every meaning under its entry instead, so no row is cut at
 *  the smallest width the frame draws at. */
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
    const lines = flow(pieces, cols - at).map((text) => ({ col: at, text: lit(text) }));
    const more = (under.get(pieces)?.(cols - at) ?? []).map((spans) => spans.map((span) => ({ ...span, col: span.col + at })));
    return [...(stacked ? [[entry(left)], ...lines.map((line) => [line])] : lines.map((line, i) => (i === 0 ? [entry(left), line] : [line]))), ...more];
  });
}

/** The TUI's own sentences under the line of `open` in the list of instances: what the terminal
 *  takes, what it does not do, and where the keys that can be the back key are listed (the help
 *  does not restate the grammar). */
export const OPEN_RULES = Object.freeze([
  "While the terminal has the focus every other key goes to the agent, Ctrl+C and Ctrl+Z too.",
  "One terminal is open at a time. It has no scrollback but the viewer's own, and no mouse.",
  "docs/tui.md has the keys that can be the leader.",
]);
/** The rows under the line of `open`, in `room` cells: the leader pressed twice, which takes the
 *  focus from the open terminal (tui.json's open.detachKey, text from outside), then OPEN_RULES,
 *  each sentence on as many rows as it needs. */
function openRows(detachKey, room) {
  const key = keyText(`${detachKey} ${detachKey}`), said = "takes the focus from the terminal back to the list; the agent keeps running.";
  const first = flow(words(said), Math.max(1, room - key.width - 1));
  return [
    [{ col: 0, text: key.text, width: key.width }, { col: key.width + 1, text: lit(first[0]) }],
    ...first.slice(1).map((text) => [{ col: key.width + 1, text: lit(text) }]),
    ...OPEN_RULES.flatMap((sentence) => flow(words(sentence), room).map((text) => [{ col: 0, text: lit(text) }])),
  ];
}
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

/** The leader's rows (docs/tui.md, "The leader"): its key, then the table of what each key after
 *  it does (actions.mjs LEADER), from every focus. */
function leaderRows(detachKey, cols) {
  const key = keyText(detachKey);
  // The sentence after the key on as many rows as it needs, its later rows under its first.
  const at = INDENT + key.width + 1;
  const lead = flow(words("then one of these keys, from every focus; a terminal too:"), Math.max(1, cols - INDENT - at));
  return [
    [{ col: INDENT, text: lit("The leader"), style: TITLE }],
    [],
    [{ col: INDENT, text: key.text, width: key.width, style: KEYS }, { col: at, text: lit(lead[0]) }],
    ...lead.slice(1).map((text) => [{ col: at, text: lit(text) }]),
    ...table(LEADER.map((entry) => [entry.keys.map(keyLabel).join(", "),
      words(entry.does === "list" ? `${entry.label}; the leader again does the same` : entry.terminal ? `${entry.label}, while a terminal is open` : entry.label)]), cols, KEYS),
  ];
}

/** Every row of the help for an area `cols` wide, before it is scrolled. Unbound actions are
 *  listed as such: the table can be changed by the user's tui.json, and the help says what is so
 *  now. An action that does one thing in each view has a line per view, its key on each; under
 *  the line of opening an agent stand the back key (`detachKey`, tui.json's `open.detachKey`) and
 *  the rules of OPEN_RULES; under the line of the last act, ACT_RULES. */
export function helpRows(actions, ascii, cols = 100, detachKey = null) {
  const marks = marksOf(ascii);
  const closing = keyText(["close", "help"].map((id) => actions.find((action) => action.id === id)).filter((action) => action?.keys.length).map((action) => keyLabel(action.keys[0])).join(" or "));
  return [
    heading("Keys"),
    [],
    ...table(actions.flatMap((action) => {
      const left = action.keys.length ? keyText(keysLabel(action)) : "(no key)";
      if (!action.views) return [[left, words(action.label)]];
      return action.views.map(([view, said]) => [left, words(said), action.id === "open" && view === "instances" && detachKey !== null ? (room) => openRows(detachKey, room)
        : action.id === "restart" ? actRows : undefined]);
    }), cols, KEYS),
    ...(detachKey !== null ? [[], ...leaderRows(detachKey, cols)] : []),
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
export function help(actions, size, { top = 0, ascii = false, detachKey = null } = {}) {
  const all = helpRows(actions, ascii, size.cols, detachKey);
  const rows = Array.from({ length: size.rows }, () => []);
  const win = windowOf({ top, count: all.length, height: size.rows });
  all.slice(win.top, win.top + win.size).forEach((spans, i) => { rows[i] = spans; });
  const note = cutNote(win.above, win.below);
  if (note && size.rows > 0) rows[size.rows - 1] = [{ col: INDENT, text: lit(note), style: HINT }];
  return { rows, extent: all.length };
}
