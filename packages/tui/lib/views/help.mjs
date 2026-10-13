// The help view: the action table, the marks and what this version does not do, as rows of safe
// text. Pure: no IO, no clock, no escape byte. The keys are generated from the table the reducer
// acts on, so the help names every key that does something and no key that does not; the marks
// are the ones the list and the switcher draw (views/instances.mjs, views/switcher.mjs).
import { keyLabel } from "../actions.mjs";
import { lit } from "../term/text.mjs";
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
  Object.freeze({ what: "open an agent's terminal", command: "oats session attach --home <home>" }),
  Object.freeze({ what: "stop an agent", command: "oats instance stop <instance>" }),
  Object.freeze({ what: "start or restart an agent", command: "oats session start --home <home>" }),
  Object.freeze({ what: "retire an agent", command: "oats retire <instance>" }),
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
  // An entry is the TUI's own word, or text made elsewhere with its width (a key's label).
  pairs = pairs.map(([left, pieces]) => [typeof left === "string" ? { text: lit(left), width: left.length } : left, pieces]);
  const entry = (left) => ({ col: INDENT, text: left.text, width: left.width, ...(look ? { style: look } : {}) });
  const column = INDENT + Math.max(...pairs.map(([left]) => left.width)) + GAP;
  const stacked = pairs.some(([, pieces]) => pieces.some((piece) => column + piece.length > cols));
  const at = stacked ? INDENT + 2 : column;
  return pairs.flatMap(([left, pieces]) => {
    const lines = flow(pieces, cols - at).map((text) => ({ col: at, text: lit(text) }));
    return stacked ? [[entry(left)], ...lines.map((line) => [line])] : lines.map((line, i) => (i === 0 ? [entry(left), line] : [line]));
  });
}
const heading = (text) => [{ col: INDENT, text: lit(text), style: TITLE }];
/** Sentences, each from the left margin on as many rows as it needs, with that margin kept at
 *  the right too: its later rows are set in, so the next sentence is seen to start. */
const sentences = (list, cols) => list.flatMap((sentence) => {
  const [first, ...rest] = flow(words(sentence), cols - 2 * INDENT);
  return [first, ...flow(rest.flatMap(words), cols - 2 * INDENT - 2)].map((text, i) => [{ col: INDENT + (i ? 2 : 0), text: lit(text) }]);
});

/** Every row of the help for an area `cols` wide, before it is scrolled. Unbound actions are
 *  listed as such: the table can be changed by the user's tui.json, and the help says what is so
 *  now. */
export function helpRows(actions, ascii, cols = 100) {
  const marks = marksOf(ascii);
  const closing = keyText(["close", "help"].map((id) => actions.find((action) => action.id === id)).filter((action) => action?.keys.length).map((action) => keyLabel(action.keys[0])).join(" or "));
  return [
    heading("Keys"),
    [],
    ...table(actions.map((action) => [action.keys.length ? keyText(keysLabel(action)) : "(no key)", words(action.label)]), cols, KEYS),
    [],
    heading("Marks"),
    [],
    ...table([
      [marks.running, "running"],
      [marks.stopped, "stopped"],
      [marks.shell, "stopped, with a shell left in its terminal"],
      [marks.unknown, "state unknown"],
      [marks.held, "held by a spawn or a retire that is not finished"],
      [`${marks.open} ${marks.closed}`, "has instances below it: shown, folded away"],
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
export function help(actions, size, { top = 0, ascii = false } = {}) {
  const all = helpRows(actions, ascii, size.cols);
  const rows = Array.from({ length: size.rows }, () => []);
  const win = windowOf({ top, count: all.length, height: size.rows });
  all.slice(win.top, win.top + win.size).forEach((spans, i) => { rows[i] = spans; });
  const note = cutNote(win.above, win.below);
  if (note && size.rows > 0) rows[size.rows - 1] = [{ col: INDENT, text: lit(note), style: HINT }];
  return { rows, extent: all.length };
}
