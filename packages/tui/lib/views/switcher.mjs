// The switcher of workspaces: (model, area) -> rows of spans. Pure: no IO, no clock, no escape
// byte. It is drawn in the area views/frame.mjs gives it: the main area. A workspace's name, its machines and how many of
// its deployments are not live are the shared home's words and go through shown(), as do a listed
// deployment's name and path and what the kernel said; the marks, the headings of its own and its
// few sentences are the TUI's.
// Nothing is told by colour alone: the selected row carries `>` as well as reverse video, and
// the workspace that is open carries `*`.
import { lit, shown, shownLines } from "../term/text.mjs";
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
  /** A stale row of this computer's deployments list, in place of its path, by the kernel's state
   *  (packages/client/deployment-list.mjs DEPLOYMENT_STATES). Such a row does not open. */
  states: Object.freeze({ missing: "Not found.", "not-a-deployment": "Not an OATS deployment any more.", unreadable: "Can't be read." }),
  /** The two lines of a Remove asked, over the rows: the selected row stays marked under them. */
  removing: Object.freeze(["Remove the selected row from this computer's list?", "Enter removes it; other keys keep it. Its folder stays."]),
  /** What a Remove answered, and that the list could not be read: each with a name or the kernel's
   *  message, shown as it came. */
  removed: (name) => `${name} was removed from this computer's list.`,
  notRemoved: (name, message) => `${name} was not removed from this computer's list: ${message}`,
  unread: (message) => `This computer's list of deployments could not be read: ${message}`,
});

/** The columns of a choice: the selection mark in the first cell, the open mark, then the label.
 *  A heading and every line that is not a choice start two cells before the labels. */
const OPEN = 2, LABEL = 4, ASIDE = LABEL - 2;
/** One cell of margin at the right edge, as the sidebar keeps. */
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

/** One choice in an area `cols` wide: a workspace, or a listed deployment that is not opened yet. What a
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
  // A row that turned out not to be a deployment, and a stale one, say so where its path stood.
  const own = item.refused ? SWITCHER_TEXT.refused : SWITCHER_TEXT.states[item.state] ?? null;
  const place = own !== null ? { text: lit(own), width: own.length } : measured(item.place);
  // With no place to show, the label has the row.
  const labelWidth = Math.max(0, Math.min(place.width ? labelCols : limit - LABEL, limit - LABEL));
  if (labelWidth) spans.push({ col: LABEL, text: shown(item.label), style: look(PLAIN), width: labelWidth });
  if (place.width && limit > placeCol) spans.push({ col: placeCol, text: place.text, style: look(own !== null ? PLAIN : DIM), width: limit - placeCol });
  if (live.width) spans.push({ col: liveCol, text: live.text, style: look(PLAIN), width: Math.max(0, Math.min(live.width, edge - liveCol)) });
  return spans.filter((span) => span.width > 0);
}

/** The most rows one sentence with a name or the kernel's words in it takes above the choices: the
 *  kernel's message says what to do, so it is wrapped, not cut, up to this. */
const LEAD_ROWS = 4;

/** The rows that stand above the choices, top to bottom, for an area `cols` wide, each
 *  `{ text, style }` with `text` made (term/text.mjs): what happened (that the workspace which was
 *  open is no longer listed, what a Remove answered), that this computer's deployments list could
 *  not be read, and a Remove asked: each something to read, so not dim, and each wrapped to the
 *  width: a sentence with a name or the kernel's words in it is shown as it came. lib/model.mjs counts these rows to make
 *  the window of the choices that much shorter (switcherLead), so it never hides a choice. */
export function leadRows(s, cols, { ascii = false } = {}) {
  const width = Math.max(1, cols - ASIDE - MARGIN), rows = [];
  // A sentence of the TUI's own is broken at its spaces (the main area beside the sidebar can be narrow).
  const own = (text) => { for (const line of wrapped(text, width)) rows.push({ text: lit(line), style: PLAIN }); };
  const shared = (text) => { for (const line of shownLines(text, width, LEAD_ROWS, { ascii })) rows.push({ text: line, style: PLAIN }); };
  if (s.said === "gone") own(SWITCHER_TEXT.gone);
  else if (s.said?.removed !== undefined) shared(SWITCHER_TEXT.removed(s.said.removed));
  else if (s.said?.notRemoved !== undefined) shared(SWITCHER_TEXT.notRemoved(s.said.notRemoved, s.said.message));
  if (s.failure) shared(SWITCHER_TEXT.unread(s.failure));
  if (s.removing) for (const text of SWITCHER_TEXT.removing) own(text);
  return rows;
}

/** The rows above the choices: leadRows, then why no workspace is listed (dim, as the list's own
 *  empty line is), which stands only when there is no choice to hide. */
function leadLines(s, cols, ascii) {
  const lines = leadRows(s, cols, { ascii });
  const dim = (text) => lines.push({ text: lit(text), style: DIM });
  if (s.empty === "nomatch") dim(SWITCHER_TEXT.nomatch);
  if (s.empty === "none") {
    const [first, second, command] = SWITCHER_TEXT.none, whole = `${second} ${command}`, room = cols - MARGIN - ASIDE;
    // A sentence wider than the area (the main area beside the sidebar can be narrow) goes on on the
    // next row, broken at its spaces; the command is a piece of its own, never broken.
    for (const text of [...wrapped(first, room), ...(whole.length <= room ? [whole] : [...wrapped(second, room), command])]) dim(text);
  }
  return lines;
}
/** A sentence of the TUI's own on rows of at most `room` cells, broken at its spaces. */
function wrapped(text, room) {
  return text.split(" ").reduce((rows, word) => {
    const last = rows.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= room) rows[rows.length - 1] = `${last} ${word}`;
    else rows.push(word);
    return rows;
  }, []);
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
  const lead = leadLines(s, cols, m.ascii === true).slice(0, Math.max(0, size.rows - s.rows.length - (note ? 1 : 0)));
  lead.forEach((line, i) => { rows[i] = [{ col: ASIDE, text: line.text, style: line.style, width: aside }]; });
  s.rows.forEach((item, i) => {
    const at = lead.length + i;
    if (at >= size.rows) return;
    if (item.heading !== undefined) rows[at] = [{ col: ASIDE, text: item.shared ? shown(item.heading) : lit(item.heading), style: DIM, width: aside }];
    else rows[at] = choiceRow(item, cols);
  });
  if (note) rows[size.rows - 1] = [{ col: ASIDE, text: lit(note), style: DIM, width: aside }];
  return rows;
}
