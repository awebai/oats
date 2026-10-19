// The act view: one confirmation of a stop, a retire, a start or a restart, over the list of
// instances (as the help is). Pure: no IO, no clock, no escape byte. (model, area) -> rows.
// The content (lib/model.mjs actView) scrolls when it is taller than the area; the buttons keep
// the area's last rows. The TUI's own words are lit(); every shared sentence, the kernel's lines,
// a name and a path go through shown(). Meaning never rests on colour alone: the button with the
// focus is drawn between `>` and `<` as well as in reverse.
import { EMPTY, lit, shown, shownLines, textOf } from "../term/text.mjs";
import { textWidth } from "../term/width.mjs";
import { style } from "../term/style.mjs";
import { partRows } from "./frame.mjs";
import { cutNote } from "./instances.mjs";
import { windowOf } from "./scroll.mjs";

const LEFT = 2;
const GAP = 3;
/** The most rows one line of the content takes. */
const LINE_ROWS = 12;
const BOLD = style({ bold: true });
const DIM = style({ dim: true });
const FOCUSED = style({ bold: true, reverse: true });
const LOOKS = Object.freeze({ bold: BOLD, dim: DIM });

/** A line's own rows of spans from column 0, in `width` cells. */
function lineRows(line, width, ascii) {
  const look = LOOKS[line.look];
  const styled = (spans) => (look ? spans.map((span) => ({ ...span, style: look })) : spans);
  if (line.gap) return [[]];
  if (line.said) return partRows(line.said, width, LINE_ROWS, { ascii }).map(styled);
  if (line.own !== undefined) return partRows([{ own: line.own }], width, LINE_ROWS, { ascii }).map(styled);
  if (line.pair) {
    // A state row's label is the shared plan's (a target's name among them), so it is text from
    // outside like its value: filtered, cut to half the width, and measured as it is drawn.
    const [label, value] = line.pair;
    const name = shownLines(label, Math.max(1, Math.floor(width / 2)), 1, { ascii })[0] ?? EMPTY;
    const used = textWidth(textOf(name)), at = used + 2;
    return [[{ col: 0, text: name, style: DIM, width: used }, { col: at, text: shown(value), width: Math.max(0, width - at) }]];
  }
  if (line.choice) {
    const box = line.choice.value ? "[x]" : "[ ]";
    return shownLines(line.choice.sentence, Math.max(1, width - 4), LINE_ROWS, { ascii })
      .map((text, i) => [...(i === 0 ? [{ col: 0, text: lit(box), width: 3 }] : []), { col: 4, text, width: Math.max(0, width - 4) }]);
  }
  // A shared sentence or the kernel's line, with a path after it: one text from outside.
  const text = line.path ? `${line.text ?? ""} ${line.path}` : line.text;
  return shownLines(text, width, LINE_ROWS, { ascii }).map((value) => styled([{ col: 0, text: value, width }]));
}

/** Every row of the content for an area `cols` wide, before it is scrolled: the title, then the lines. */
export function actRows(m, cols) {
  const width = Math.max(1, cols - 2 * LEFT);
  const t = m.act.title;
  const title = t.said ? partRows(t.said, width, 2, { ascii: m.ascii }) : shownLines(t.text, width, 2, { ascii: m.ascii }).map((text) => [{ col: 0, text, width }]);
  const rows = [...title.map((spans) => spans.map((span) => ({ ...span, style: BOLD }))), []];
  for (const line of m.act.lines) rows.push(...lineRows(line, width, m.ascii));
  return rows.map((spans) => spans.map((span) => ({ ...span, col: span.col + LEFT })));
}

/** The buttons, one per offer of the confirmation and in its order, the one with the focus between
 *  `>` and `<`: on one row when they fit, else on as many as they need, a button never split and
 *  never left out (the area beside the sidebar can be narrow, and every offer, the one with the
 *  focus among them, must be seen). A label wider than a row is cut there. */
function buttonRows(buttons, cols) {
  const rows = [];
  let row = [], col = LEFT;
  for (const button of buttons) {
    const label = button.focused ? `> ${button.label} <` : `[ ${button.label} ]`;
    if (row.length && col + label.length > cols) { rows.push(row); row = []; col = LEFT; }
    row.push({ col, text: lit(label), width: Math.max(0, Math.min(label.length, cols - col)), ...(button.focused ? { style: FOCUSED } : {}) });
    col += label.length + GAP;
  }
  if (row.length) rows.push(row);
  return rows;
}

/** `{ rows, extent, room }`: `size.rows` rows for an area `size.cols` wide: the content scrolled
 *  to the confirmation's `top`, then an empty row and the buttons on the last rows (buttonRows).
 *  `extent` and `room` are the content's, for the store's scroll. */
export function act(m, size) {
  const rows = Array.from({ length: size.rows }, () => []);
  const buttons = buttonRows(m.act.buttons, size.cols).slice(-Math.max(0, size.rows - 1));
  const room = Math.max(0, size.rows - 1 - buttons.length);
  const all = actRows(m, size.cols);
  const win = windowOf({ top: m.act.top ?? 0, count: all.length, height: room });
  all.slice(win.top, win.top + win.size).forEach((spans, i) => { rows[i] = spans; });
  const note = cutNote(win.above, win.below);
  if (note && room > 0) rows[room - 1] = [{ col: LEFT, text: lit(note), style: DIM, width: Math.max(0, size.cols - LEFT) }];
  buttons.forEach((spans, i) => { rows[size.rows - buttons.length + i] = spans; });
  return { rows, extent: all.length, room: Math.max(1, room) };
}
