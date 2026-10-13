// The switcher of workspaces: (model, area) -> rows of spans. Pure: no IO, no clock, no escape
// byte. It takes the whole body of the frame. A workspace's name, its machines and how many of
// its deployments are not live are the shared home's words and go through shown(), as does a
// folder's name and path; the marks, the headings of its own and its few sentences are the TUI's.
// Nothing is told by colour alone: the selected row carries `>` as well as reverse video, and
// the workspace that is open carries `*`.
import { lit, shown } from "../term/text.mjs";
import { style } from "../term/style.mjs";
import { cutNote, measured } from "./instances.mjs";

/** The mark of the workspace that is open (the help view lists it from here). */
export const OPEN_MARK = "*";
/** The switcher's own sentences. `none`: its second sentence ends in a command, which is a piece
 *  of its own so that a narrow row moves it whole to the next one and never cuts it. */
export const SWITCHER_TEXT = Object.freeze({
  none: Object.freeze(["No workspace to show.", "Start it in a deployment, or name one:", "oats tui --dir <path>"]),
  nomatch: "No workspace matches the filter.",
  gone: "That workspace is no longer listed.",
  refused: "Not an OATS deployment any more.",
});

/** The columns of a choice: the selection mark in the first cell, the open mark, then the label.
 *  A heading and every line that is not a choice start two cells before the labels. */
const OPEN = 2, LABEL = 4, ASIDE = LABEL - 2;
/** One cell of margin at the right edge, as the header and the footer keep. */
const MARGIN = 1;
/** The cells between two columns. */
const GAP = 2;
/** The labels' column is a third of the width, within these bounds: a column of a fixed width
 *  does not move while the list scrolls, and at the smallest width the frame is drawn at it
 *  leaves the second column the cells of the longest line of the TUI's own that stands there. */
const LABEL_MIN = 20, LABEL_MAX = 40;

const PLAIN = style();
const DIM = style({ dim: true });
const SELECTED = style({ reverse: true });

/** One choice in an area `cols` wide: a workspace, or a folder that is not opened yet. What a
 *  workspace says of its deployments that are not live stands whole at the right edge; when the
 *  row is too narrow the place is cut first, then the label. */
function choiceRow(item, cols) {
  const look = (own) => (item.selected ? SELECTED : own);
  const edge = cols - MARGIN;
  const labelCols = Math.min(Math.max(Math.floor(cols / 3), LABEL_MIN), LABEL_MAX), placeCol = LABEL + labelCols + GAP;
  const spans = [];
  if (item.selected) spans.push({ col: 0, width: cols, style: SELECTED }, { col: 0, text: lit(">"), style: SELECTED, width: 1 });
  if (item.open) spans.push({ col: OPEN, text: lit(OPEN_MARK), style: look(PLAIN), width: 1 });
  const live = measured(item.notLiveText);
  const liveCol = Math.max(LABEL, edge - live.width);
  // Where the label and the place end: at the edge, or two cells before what stands there.
  const limit = live.width ? liveCol - GAP : edge;
  // A folder that turned out not to be a deployment says so where its path stood.
  const place = item.refused ? { text: lit(SWITCHER_TEXT.refused), width: SWITCHER_TEXT.refused.length } : measured(item.place);
  // With no place to show, the label has the row.
  const labelWidth = Math.max(0, Math.min(place.width ? labelCols : limit - LABEL, limit - LABEL));
  if (labelWidth) spans.push({ col: LABEL, text: shown(item.label), style: look(PLAIN), width: labelWidth });
  if (place.width && limit > placeCol) spans.push({ col: placeCol, text: place.text, style: look(item.refused ? PLAIN : DIM), width: limit - placeCol });
  if (live.width) spans.push({ col: liveCol, text: live.text, style: look(PLAIN), width: Math.max(0, Math.min(live.width, edge - liveCol)) });
  return spans.filter((span) => span.width > 0);
}

/** The lines above the choices, top to bottom, for an area `cols` wide: that the workspace which
 *  was open is no longer listed (something that happened, so not dim), and why no workspace is
 *  listed (dim, as the list's own empty line is). */
function leadLines(s, cols) {
  const lines = [];
  if (s.said === "gone") lines.push({ text: SWITCHER_TEXT.gone, style: PLAIN });
  if (s.empty === "nomatch") lines.push({ text: SWITCHER_TEXT.nomatch, style: DIM });
  if (s.empty === "none") {
    const [first, second, command] = SWITCHER_TEXT.none, whole = `${second} ${command}`;
    for (const text of [first, ...(ASIDE + whole.length <= cols - MARGIN ? [whole] : [second, command])]) lines.push({ text, style: DIM });
  }
  return lines;
}

/** `size.rows` rows for an area `size.cols` wide: the lines above, the model's window of the
 *  switcher's rows, one item per row, and on the last row what is cut off above and below.
 *  The model's window is as tall as the area, so a line above takes its row only while the rows
 *  given leave one: a choice is never hidden for it. */
export function switcher(m, size) {
  const rows = Array.from({ length: size.rows }, () => []);
  const s = m.switcher;
  if (!s || size.rows < 1) return rows;
  const { cols } = size, aside = Math.max(0, cols - ASIDE - MARGIN);
  const note = cutNote(s.above, s.below);
  const lead = leadLines(s, cols).slice(0, Math.max(0, size.rows - s.rows.length - (note ? 1 : 0)));
  lead.forEach((line, i) => { rows[i] = [{ col: ASIDE, text: lit(line.text), style: line.style, width: aside }]; });
  s.rows.forEach((item, i) => {
    const at = lead.length + i;
    if (at >= size.rows) return;
    if (item.heading !== undefined) rows[at] = [{ col: ASIDE, text: item.shared ? shown(item.heading) : lit(item.heading), style: DIM, width: aside }];
    else if (item.own !== undefined) rows[at] = [{ col: LABEL, text: lit(item.own), style: DIM, width: Math.max(0, cols - LABEL - MARGIN) }];
    else rows[at] = choiceRow(item, cols);
  });
  if (note) rows[size.rows - 1] = [{ col: ASIDE, text: lit(note), style: DIM, width: aside }];
  return rows;
}
