// The list of instances: (model, pane) -> rows of spans. Pure: no IO, no clock, no escape byte.
// Every name, word and reason in it is text the TUI did not write and goes through shown(); the
// marks and the few words around them are the TUI's own. Nothing is told by colour alone: each
// state has a mark of its own shape, the selected row carries `>` as well as reverse video, and a
// waiting row carries `!`.
import { lit, shown } from "../term/text.mjs";
import { style } from "../term/style.mjs";

/** The marks, in UTF-8 and in ASCII (docs/tui.md lists them; the help view draws them from here).
 *  The state marks are keyed by the word the shared home gives a row's state, with `shell` and
 *  `held` beside them (lib/model.mjs says when). */
export const MARKS = Object.freeze({
  utf8: Object.freeze({ running: "●", stopped: "○", shell: "◌", unknown: "?", held: "◆", open: "▾", closed: "▸", selected: ">", waiting: "!" }),
  ascii: Object.freeze({ running: "*", stopped: "-", shell: "~", unknown: "?", held: "#", open: "v", closed: ">", selected: ">", waiting: "!" }),
});
export const marksOf = (ascii) => (ascii ? MARKS.ascii : MARKS.utf8);

/** Two cells of indent per level, and no deeper than this many levels: a deeper row sits at the last. */
const INDENT = 2, LEVELS = 6;
/** The cells kept at the right edge for the waiting mark: `!`, `!N`, `!NN`, `!99+`. */
const WAITING = 4;
/** A row's cells before its name: the selection mark, a gap, the disclosure mark, a gap, the
 *  state mark, a gap. */
const LEAD = 5;

const PLAIN = style();
const DIM = style({ dim: true });
const SELECTED = style({ reverse: true });
const LOOK = Object.freeze({ running: style({ fg: "green" }), stopped: DIM, shell: DIM, unknown: style({ fg: "yellow" }), held: style({ fg: "magenta" }) });
const WAITS = style({ fg: "yellow", bold: true });
const WAITS_SELECTED = style({ reverse: true, bold: true });

export const EMPTY_TEXT = Object.freeze({
  reading: "Reading the deployment.",
  none: "No instances in this deployment.",
  nomatch: "No instance matches the filter.",
});

const waitingText = (row) => (row.below > 99 ? "!99+" : row.below > 0 ? `!${row.below}` : row.waiting ? "!" : null);

/** One instance's row in a pane `cols` wide: the marks, the name cut to what is left, the state
 *  word in its column and the waiting mark at the edge. Every span has its width, so no text can
 *  pass its column whatever the terminal thinks a character takes. */
function instanceRow(row, cols, wordWidth, marks) {
  const look = (own) => (row.selected ? SELECTED : own);
  const at = Math.min(row.depth, LEVELS - 1) * INDENT;
  const wordCol = Math.max(0, cols - WAITING - 1 - wordWidth);
  const nameCol = LEAD + at;
  const spans = [];
  if (row.selected) spans.push({ col: 0, width: cols, style: SELECTED }, { col: 0, text: lit(marks.selected), style: SELECTED, width: 1 });
  if (row.disclosure) spans.push({ col: 1 + at, text: lit(marks[row.disclosure]), style: look(PLAIN), width: 1 });
  spans.push({ col: 3 + at, text: lit(marks[row.mark] ?? marks.unknown), style: look(LOOK[row.mark] ?? LOOK.unknown), width: 1 });
  if (wordCol - 2 > nameCol) spans.push({ col: nameCol, text: shown(row.name), style: look(PLAIN), width: wordCol - 2 - nameCol });
  if (wordWidth > 0) spans.push({ col: wordCol, text: shown(row.word), style: look(DIM), width: wordWidth });
  const waits = waitingText(row);
  if (waits) spans.push({ col: cols - waits.length, text: lit(waits), style: row.selected ? WAITS_SELECTED : WAITS, width: waits.length });
  return spans;
}

/** How many rows are cut off, in the TUI's words: `12 more below`. */
export function cutNote(above, below) {
  return [above > 0 ? `${above} more above` : null, below > 0 ? `${below} more below` : null].filter(Boolean).join(", ");
}

/** `size.rows` rows for a pane `size.cols` wide: the model's window of instances, an empty row
 *  where it has one, and on the last row what is cut off above and below. With no instance to
 *  draw, the one line that says why. */
export function instances(m, size) {
  const rows = Array.from({ length: size.rows }, () => []);
  if (size.rows < 1) return rows;
  if (m.empty) { rows[0] = [{ col: LEAD - 2, text: lit(EMPTY_TEXT[m.empty]), style: DIM, width: Math.max(0, size.cols - LEAD + 2) }]; return rows; }
  const marks = marksOf(m.ascii);
  m.list.forEach((row, i) => { if (row && i < size.rows) rows[i] = instanceRow(row, size.cols, m.wordWidth, marks); });
  const note = cutNote(m.above, m.below);
  if (note) rows[size.rows - 1] = [{ col: LEAD - 2, text: lit(note), style: DIM, width: Math.max(0, size.cols - LEAD + 2) }];
  return rows;
}
