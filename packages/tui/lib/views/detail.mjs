// The detail of the selected instance: (model, pane) -> rows of spans. Pure: no IO, no clock, no
// escape byte. A label of the TUI's own and a value per line; every value is text the TUI did not
// write (a kernel's field, a shared sentence) and goes through shown(), cut or wrapped by cells.
import { lit, shown, shownEnd, shownLines } from "../term/text.mjs";
import { style } from "../term/style.mjs";
import { cutNote } from "./instances.mjs";
import { windowOf } from "./scroll.mjs";

const BOLD = style({ bold: true });
const DIM = style({ dim: true });
/** The title and the labels start here: the first cell holds the mark of the pane with the focus. */
const LEFT = 2;
/** The values start here: the longest label, `harness`, and a gap. */
const VALUE = LEFT + 9;
/** The most rows one wrapped value takes. */
const WRAP_ROWS = 6;

/** Every row of the detail for a pane `cols` wide, before it is scrolled: the title, then the
 *  facts. A sentence is wrapped onto rows of its own under its label; a path is read from its
 *  end. */
export function detailRows(m, cols) {
  if (!m.detail) return [];
  const room = Math.max(0, cols - VALUE);
  const rows = [[{ col: LEFT, text: shown(m.detail.title), style: BOLD, width: Math.max(0, cols - LEFT) }]];
  for (const fact of m.detail.facts) {
    const label = fact.label ? [{ col: LEFT, text: lit(fact.label), style: DIM, width: VALUE - LEFT - 1 }] : [];
    if (room < 1) { rows.push(label); continue; }
    if (fact.form === "wrap") shownLines(fact.value, room, WRAP_ROWS, { ascii: m.ascii }).forEach((line, i) => rows.push([...(i === 0 ? label : []), { col: VALUE, text: line, width: room }]));
    else rows.push([...label, { col: VALUE, text: fact.form === "end" ? shownEnd(fact.value, room, { ascii: m.ascii }) : shown(fact.value), width: room }]);
  }
  return rows;
}

/** `{ rows, extent }`: `size.rows` rows for a pane `size.cols` wide, scrolled to the model's
 *  `detailTop`, and how many rows the whole detail has. The pane that has the focus says so with
 *  `>` beside the title, never by an attribute alone. */
export function detail(m, size) {
  const all = detailRows(m, size.cols);
  const rows = Array.from({ length: size.rows }, () => []);
  const win = windowOf({ top: m.detailTop, count: all.length, height: size.rows });
  all.slice(win.top, win.top + win.size).forEach((spans, i) => { rows[i] = spans; });
  const note = cutNote(win.above, win.below);
  if (note && size.rows > 0) rows[size.rows - 1] = [{ col: LEFT, text: lit(note), style: DIM, width: Math.max(0, size.cols - LEFT) }];
  if (m.focus === "detail" && size.rows > 0 && all.length) rows[0] = [{ col: 0, text: lit(">"), style: BOLD, width: 1 }, ...rows[0]];
  return { rows, extent: all.length };
}
