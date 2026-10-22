// The list of workspaces at the top of the sidebar (docs/tui.md, "The list of workspaces"): (the
// model's `workspaces`, a width) -> rows of spans. Pure: no IO, no clock, no escape byte.
// A workspace's name is the shared home's and goes through shown(); the marks, the state words and
// `+N` are the TUI's. Nothing is told by colour alone: the open workspace carries `*` as well as
// reverse video, the row under the cursor (the list has the focus) `>`, and a workspace where an
// instance needs input a dot, `●` in yellow, `!` without colour or in ASCII.
import { lit, shown } from "../term/text.mjs";
import { style } from "../term/style.mjs";
import { measured } from "./instances.mjs";
import { OPEN_MARK } from "./switcher.mjs";

/** The dot of a workspace where an instance needs input: in yellow, or, with no colour to say it
 *  (NO_COLOR) or in ASCII, the needs-input mark of the rows. */
export const WAITING_DOT = Object.freeze({ utf8: "●", ascii: "!" });
const CURSOR = 0, OPEN = 1, NAME = 3, MARGIN = 1, GAP = 2, NAME_LEAST = 8;
const PLAIN = style(), DIM = style({ dim: true }), BOLD = style({ bold: true }), BAR = style({ bold: true, reverse: true });
const YELLOW = style({ fg: "yellow", bold: true }), YELLOW_BAR = style({ fg: "yellow", bold: true, reverse: true });

/** One row of the list, `cols` wide: `>` under the cursor, `*` for the open workspace, its name
 *  (the open one's with what the title said beside it: `nameSpans(col, room)`), then at the edge
 *  its state word, dim, when there is room for it, and its dot. A row that does not open is dim.
 *  The open workspace's row is in reverse video while the list does not have the focus, the
 *  cursor's while it has. */
function row(line, cols, { focused, cursor, ascii, colour, nameSpans }) {
  const under = focused && line.key === cursor, barred = under || (!focused && line.current);
  const look = (own) => (barred ? BAR : own);
  const spans = barred ? [{ col: 0, width: cols, style: BAR }] : [];
  if (under) spans.push({ col: CURSOR, text: lit(">"), style: BAR, width: 1 });
  if (line.current) spans.push({ col: OPEN, text: lit(OPEN_MARK), style: look(BOLD), width: 1 });
  let edge = cols - MARGIN;
  if (line.waiting) {
    const yellow = colour && !ascii;
    edge -= 1;
    spans.push({ col: edge, text: lit(yellow ? WAITING_DOT.utf8 : WAITING_DOT.ascii), style: yellow ? (barred ? YELLOW_BAR : YELLOW) : look(BOLD), width: 1 });
    edge -= 1;
  }
  // The word gives way to the name: it stands while the name keeps NAME_LEAST cells.
  if (line.word && edge - line.word.length - GAP - NAME >= NAME_LEAST) {
    edge -= line.word.length;
    spans.push({ col: edge, text: lit(line.word), style: look(DIM), width: line.word.length });
    edge -= GAP;
  }
  const room = Math.max(0, edge - NAME);
  if (line.current && nameSpans) for (const span of nameSpans(NAME, room)) spans.push({ ...span, style: look(span.style ?? BOLD) });
  else if (room) spans.push({ col: NAME, text: shown(line.label), style: look(line.openable ? PLAIN : DIM), width: Math.min(room, measured(line.label).width) });
  return spans.filter((span) => span.width > 0);
}

/** The list's rows: `w` the model's `workspaces` (`lines` windowed, `more`, `focused`, `cursor`), in
 *  `cols`; a heading dim, from the margin; `+N` last when N lines are not shown. */
export function workspaceRows(w, cols, { ascii = false, colour = true, nameSpans = null } = {}) {
  const rows = w.lines.map((line) => (line.heading !== undefined
    ? [{ col: MARGIN, text: shown(line.heading), style: DIM, width: Math.max(0, cols - 2 * MARGIN) }]
    : row(line, cols, { focused: w.focused, cursor: w.cursor, ascii, colour, nameSpans })));
  if (w.more > 0) rows.push([{ col: NAME, text: lit(`+${w.more}`), style: DIM, width: String(w.more).length + 1 }]);
  return rows;
}
