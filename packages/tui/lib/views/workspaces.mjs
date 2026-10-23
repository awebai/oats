// The list of workspaces at the top of the sidebar (docs/tui.md, "The list of workspaces"): (the
// model's `workspaces`, a width) -> rows of spans. Pure: no IO, no clock, no escape byte.
// A row is one line, a workspace's name, which is the shared home's and goes through shown(); `>`,
// the dot and `+N` are the TUI's. The open workspace's row is in reverse video, the row under the
// cursor (the list has the focus) carries `>` as well, and a workspace where an instance needs input
// a dot after its name, `●` in yellow, `!` without colour or in ASCII.
import { lit, shown } from "../term/text.mjs";
import { style } from "../term/style.mjs";
import { measured } from "./instances.mjs";

/** The dot of a workspace where an instance needs input: in yellow, or, with no colour to say it
 *  (NO_COLOR) or in ASCII, the needs-input mark of the rows. */
export const WAITING_DOT = Object.freeze({ utf8: "●", ascii: "!" });
const CURSOR = 0, NAME = 2, MARGIN = 1;
const PLAIN = style(), BOLD = style({ bold: true }), BAR = style({ bold: true, reverse: true });
const YELLOW = style({ fg: "yellow", bold: true });

/** One row of the list, `cols` wide: `>` under the cursor, the name, cut with an ellipsis where it
 *  does not fit, and one cell after it the dot. The open workspace's row is in reverse video across
 *  the row while the list does not have the focus, the cursor's while it has; the dot's cell is a
 *  gap in it, on the normal background (a yellow cell with a dark dot in it would read as
 *  something else). */
function row(line, cols, { focused, cursor, ascii, colour }) {
  const under = focused && line.key === cursor, barred = under || (!focused && line.current);
  const spans = barred ? [{ col: 0, width: cols, style: BAR }] : [];
  if (under) spans.push({ col: CURSOR, text: lit(">"), style: BAR, width: 1 });
  // The name keeps the row less the margin, and less the dot and the cell before it when there is one.
  const room = Math.max(0, cols - MARGIN - NAME - (line.waiting ? 2 : 0));
  const width = Math.min(room, measured(line.label).width);
  if (width > 0) spans.push({ col: NAME, text: shown(line.label), style: barred ? BAR : PLAIN, width });
  if (line.waiting) {
    const yellow = colour && !ascii;
    spans.push({ col: NAME + width + 1, text: lit(yellow ? WAITING_DOT.utf8 : WAITING_DOT.ascii), style: yellow ? YELLOW : BOLD, width: 1 });
  }
  return spans;
}

/** The list's rows: `w` the model's `workspaces` (`lines` windowed, `more`, `focused`, `cursor`), in
 *  `cols`; `+N` last when N workspaces are not shown. */
export function workspaceRows(w, cols, { ascii = false, colour = true } = {}) {
  const rows = w.lines.map((line) => row(line, cols, { focused: w.focused, cursor: w.cursor, ascii, colour }));
  if (w.more > 0) rows.push([{ col: NAME, text: lit(`+${w.more}`), style: style({ dim: true }), width: String(w.more).length + 1 }]);
  return rows;
}
