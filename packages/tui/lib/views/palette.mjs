// The palette (docs/tui.md, "The palette"): (model, area) -> rows of spans, over the whole body.
// Pure: no IO, no clock, no escape byte. One input over a list: the query on the first row, then
// the window of the rows lib/model.mjs paletteItems lists, the selected one in reverse with `>`.
// An instance's name and machine and the query are text the TUI did not write and go through
// shown(); the labels of the views, the acts and the commands are the TUI's own. Nothing is told
// by colour alone: each row says in a word what kind it is.
import { lit, shown } from "../term/text.mjs";
import { style } from "../term/style.mjs";
import { cutNote, marksOf, measured } from "./instances.mjs";

/** The query's prompt, and the cells it takes with the gap after it. */
const PROMPT = ">", PROMPT_CELLS = 2;
/** The cells a row's text starts at: the selection mark, a gap, an instance's state mark, a gap. */
const LEAD = 4;
/** The word at a row's right edge that says what it is. */
const KINDS = Object.freeze({ instance: "instance", view: "view", act: "act", command: "command" });
/** The TUI's word before another machine's name. */
const ON = "on";

const BOLD = style({ bold: true });
const DIM = style({ dim: true });
const SELECTED = style({ reverse: true });
const PLAIN = style();

/** One row of the palette in `cols` cells. */
function itemRow(item, cols, marks) {
  const look = (own) => (item.selected ? SELECTED : own);
  const kind = KINDS[item.kind], kindCol = Math.max(LEAD, cols - kind.length);
  const spans = [];
  if (item.selected) spans.push({ col: 0, width: cols, style: SELECTED }, { col: 0, text: lit(">"), style: SELECTED, width: 1 });
  if (item.kind === "instance") spans.push({ col: 2, text: lit(marks[item.mark] ?? marks.unknown), style: look(PLAIN), width: 1 });
  let col = LEAD;
  const room = () => Math.max(0, kindCol - 2 - col);
  const put = (text, width, own) => { const w = Math.min(width, room()); if (w > 0) spans.push({ col, text, style: look(own), width: w }); col += width + 1; };
  if (item.kind === "instance") {
    const name = measured(item.name);
    put(name.text, name.width, PLAIN);
    if (item.machine !== null && item.machine !== undefined) { put(lit(ON), ON.length, DIM); const where = measured(item.machine); put(where.text, where.width, DIM); }
  } else {
    put(lit(item.label), item.label.length, PLAIN);
    if (item.kind === "act") { const name = measured(item.name); put(name.text, name.width, DIM); }
  }
  spans.push({ col: kindCol, text: lit(kind), style: look(DIM), width: Math.min(kind.length, cols - kindCol) });
  return spans;
}

/** `{ rows, cursor }`: `size.rows` rows for an area `size.cols` wide, and the column the cursor
 *  stands at on the first row, after the query. The last row says what is cut off. */
export function palette(m, size) {
  const rows = Array.from({ length: size.rows }, () => []);
  const p = m.palette, query = measured(p.query);
  const room = Math.max(0, size.cols - PROMPT_CELLS - 1);
  if (size.rows > 0) rows[0] = [{ col: 0, text: lit(PROMPT), style: BOLD, width: PROMPT.length }, ...(query.width ? [{ col: PROMPT_CELLS, text: query.text, width: Math.min(query.width, room) }] : [])];
  const marks = marksOf(m.ascii);
  if (p.empty && size.rows > 1) rows[1] = [{ col: LEAD, text: lit("Nothing matches."), style: DIM, width: Math.max(0, size.cols - LEAD) }];
  p.rows.forEach((item, i) => { if (1 + i < size.rows) rows[1 + i] = itemRow(item, size.cols, marks); });
  const note = cutNote(p.above, p.below);
  if (note && size.rows > 2) rows[size.rows - 1] = [{ col: LEAD, text: lit(note), style: DIM, width: Math.max(0, size.cols - LEAD) }];
  return { rows, cursor: PROMPT_CELLS + Math.min(query.width, room) };
}
