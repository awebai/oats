// The list of instances: (model, pane) -> rows of spans. Pure: no IO, no clock, no escape byte.
// Every name, word and reason in it is text the TUI did not write and goes through shown(); the
// marks and the few words around them are the TUI's own. Nothing is told by colour alone: each
// state has a mark of its own shape, the selected row carries `>` as well as reverse video (the `>`
// only while the list has the focus, not the list of workspaces: the model's `cursor`), and a
// waiting row's state mark is the needs-input mark, `!` in reverse video. A row is quiet: its mark
// and its name, and a word only where the mark can't say it. Children stand under their parent by
// indentation alone; a folded row says how many it folds away, `+n`, and how many of those wait,
// `N below`. In a view of two or more deployments the list also holds a heading per deployment
// and the sentences the model sets under one: a heading says in words what it is of.
import { keyLabel } from "../actions.mjs";
import { lit, shown, shownEnd, textOf } from "../term/text.mjs";
import { COLORS, style } from "../term/style.mjs";
import { textWidth } from "../term/width.mjs";

/** The marks, in UTF-8 and in ASCII (docs/tui.md lists them; the help view draws them from here).
 *  The state marks are keyed by the word the shared home gives a row's state, with `shell` and
 *  `held` beside them (lib/model.mjs says when). `waiting` takes the state mark's cell on a row
 *  that needs input, whatever its state. A fold has no mark: a folded row shows `+n`. */
export const MARKS = Object.freeze({
  utf8: Object.freeze({ running: "●", stopped: "○", shell: "◌", unknown: "?", held: "◆", selected: ">", waiting: "!" }),
  ascii: Object.freeze({ running: "*", stopped: "-", shell: "~", unknown: "?", held: "#", selected: ">", waiting: "!" }),
});
export const marksOf = (ascii) => (ascii ? MARKS.ascii : MARKS.utf8);

/** Two cells of indent per level, and no deeper than this many levels: a deeper row sits at the last. */
const INDENT = 2, LEVELS = 6;
/** The cells every row keeps at its right edge, so the word column stands in one place whether a
 *  row folds waiting rows away or not: they hold the roll-up's tag in its short form, ` 1 ` to
 *  ` 99+ `, whose padding is its gap. A tag in words takes more, and one cell of gap before it. */
const EDGE = 5;
/** A row's cells before its name: the selection mark, a gap, the state mark, a gap. */
const LEAD = 4;
/** The column of the state mark, before a row's indent. */
const MARK = 2;
/** The cells a row's name keeps before its word, and the fewest a cut word is drawn in: under
 *  them the word is left out, since a few cells of it say nothing. */
const NAME_LEAST = 16, WORD_LEAST = 6;

/** A heading starts here: at the margin the sidebar keeps, not at a row's indent. */
const HEAD = 1;
/** The cells between two parts of a heading. */
const GAP = 2;
/** The fewest cells a heading's short reason or its path is drawn in when it is cut: under them
 *  it is left out, since a few cells of either say nothing. */
const PART_MIN = 8;
/** Where a sentence inside the list starts, and the line that says why no instance is listed or
 *  what is cut off. The model wraps a sentence for a pane less this indent and one cell
 *  (lib/model.mjs SENTENCE_INDENT, which a view cannot import): the same value. */
const SENTENCE_INDENT = 3;

const PLAIN = style();
const BOLD = style({ bold: true });
const DIM = style({ dim: true });
const SELECTED = style({ reverse: true });
/** The look of each state mark: the Souls view draws an instance's mark in its detail as the list does.
 *  No state is yellow: yellow says needs input, and only that. */
export const LOOK = Object.freeze({ running: style({ fg: "green" }), stopped: DIM, shell: DIM, unknown: DIM, held: style({ fg: "magenta" }) });
/** The marks an instance's colour (feature instance-color) draws: running in it, stopped and at its shell in
 *  it and dim. The shape still says the state; `unknown` and `held` keep their own look whatever the colour. */
const COLOURED = Object.freeze({ running: false, stopped: true, shell: true });
/** The colour that is the terminal's own foreground, no `fg` at all: `sand`'s (views/souls.mjs
 *  SOUL_COLOURS), which can't be yellow and stays seen on a light theme as on a dark one. */
export const DEFAULT_FG = "default";
/** The look an instance's or a soul's colour draws, with `attributes` (`{ dim }`): `colour` a terminal
 *  colour name or DEFAULT_FG; null for any other value, which draws no colour. */
export function colourLook(colour, attributes = {}) {
  if (colour === DEFAULT_FG) return style(attributes);
  return typeof colour === "string" && COLORS.includes(colour) ? style({ fg: colour, ...attributes }) : null;
}
/** A state mark's look for a row of colour `colour` (a terminal colour name, DEFAULT_FG, or null for none). */
export function markLook(mark, colour) {
  const coloured = Object.hasOwn(COLOURED, mark) ? colourLook(colour, { dim: COLOURED[mark] }) : null;
  return coloured ?? LOOK[mark] ?? LOOK.unknown;
}
/** The needs-input look, of a waiting row's mark and of the roll-up's tag: bold, in reverse video in
 *  the waiting colour (the mark is then a yellow cell with the `!` cut out, the Desktop's disc in
 *  one cell), so the reverse video and the `!` carry it under NO_COLOR. On the selected row, which
 *  is in reverse already, it is the other way round: not reversed, a gap in the selection's bar.
 *  An instance's colour never draws it. */
const WAITS = style({ fg: "yellow", bold: true, reverse: true });
const WAITS_SELECTED = style({ fg: "yellow", bold: true });

/** The words for an instance that needs input: the shared home's for a claim that names no reason
 *  of its own (packages/client/waiting-on-you.mjs, waitingLabel, which the detail says; a test pins
 *  them equal), and the help's for the mark. A row says them by its mark, not in words. */
export const NEEDS_INPUT = "Needs input";
/** The roll-up tag's words, the Desktop's (packages/desktop/renderer/shell.mjs, needsInputMark; a
 *  test pins them equal): `N below` on a row that folds away N waiting rows, `99+ below` past 99,
 *  whether the row waits itself or not: its mark says its own claim, the tag the rest. */
/** A count of waiting rows as the tag says it, or the help's letter for one (`N`) as it is. */
const count = (n) => (typeof n === "number" && n > 99 ? "99+" : String(n));
export const belowText = (n) => `${count(n)} below`;

export const EMPTY_TEXT = Object.freeze({
  reading: "Reading the deployment.",
  none: "No agents yet",
  nomatch: "No instance matches the filter.",
});

/** The words after EMPTY_TEXT.none and the key that spawns (docs/tui.md, "What it shows"). */
export const SPAWNS_ONE = "spawns one";

/** Text the TUI did not write, with the cells its display takes: `{ text, width }`. What stands
 *  after it on a row is placed by that width. */
export function measured(value) {
  const text = shown(value);
  return { text, width: textWidth(textOf(text)) };
}

/** A row's roll-up tag, in words and in its short form (the count alone), or null when the row
 *  folds no waiting row away. Drawn with a cell of padding either side. */
function tagOf(row) {
  return row.below > 0 ? { full: belowText(row.below), short: count(row.below) } : null;
}

/** One instance's row in a pane `cols` wide: the state mark (the needs-input mark on a waiting
 *  row), the name cut to what is left, on a folded row `+n` after the name, the row's word (when it
 *  has one) in the word column, and the roll-up tag at the edge. A row with no word gives its name the word column's cells too. The
 *  name wins over the word: it keeps NAME_LEAST cells (all of it when it is shorter), and when the
 *  word column would leave it fewer, the word is cut to what the name leaves, after it, or given
 *  up under WORD_LEAST cells; the mark and the detail still say it. The name is cut before `+n`
 *  is: the count stays whole beside what is left of the name. The tag is the first to give way:
 *  it is in words only where the whole name, its count and the word column all fit beside it
 *  (the word column then stands left of the tag), and else in its short form, inside the EDGE
 *  cells every row keeps, so it never takes a cell from the name, the word or the mark. Every
 *  span has its width, so no text can pass its column whatever the terminal thinks a character
 *  takes. */
function instanceRow(row, cols, wordWidth, marks) {
  const look = (own) => (row.selected ? SELECTED : own);
  const at = Math.min(row.depth, LEVELS - 1) * INDENT;
  const fold = row.folded > 0 ? `+${row.folded}` : null;
  const nameCol = LEAD + at;
  const name = measured(row.name), claim = Math.min(name.width + (fold ? fold.length + 1 : 0), NAME_LEAST);
  // The tag, and where the name and the word end: before the tag in words and a gap, or the EDGE.
  const hasWord = wordWidth > 0 && row.word !== null && row.word !== undefined;
  const whole = name.width + (fold ? fold.length + 1 : 0) + (hasWord ? 2 + wordWidth : 0);
  const tag = tagOf(row), wide = tag !== null && cols - tag.full.length - 3 - nameCol >= whole;
  const waits = tag && (wide ? tag.full : tag.short), end = wide ? cols - tag.full.length - 3 : cols - EDGE, room = end - nameCol;
  // The word's cells: its column's, or what the name's claim leaves of the row, or none.
  const left = room - claim - 2;
  const wordCells = hasWord ? (left >= wordWidth ? wordWidth : left >= WORD_LEAST ? left : 0) : 0;
  const wordCol = left >= wordWidth ? end - wordWidth : nameCol + claim + 2;
  const nameEnd = wordCells ? wordCol - 2 : end;
  const spans = [];
  if (row.selected) spans.push({ col: 0, width: cols, style: SELECTED });
  if (row.selected && row.cursor !== false) spans.push({ col: 0, text: lit(marks.selected), style: SELECTED, width: 1 });
  const waitLook = row.selected ? WAITS_SELECTED : WAITS;
  if (row.waiting) spans.push({ col: MARK + at, text: lit(marks.waiting), style: waitLook, width: 1 });
  else spans.push({ col: MARK + at, text: lit(marks[row.mark] ?? marks.unknown), style: look(markLook(row.mark, row.color)), width: 1 });
  if (nameEnd > nameCol) {
    // The count and the gap before it, when there is room for them and for a cell of the name.
    const after = fold && nameEnd - nameCol > fold.length + 1 ? fold.length + 1 : 0;
    const nameWidth = Math.min(name.width, nameEnd - nameCol - after);
    spans.push({ col: nameCol, text: name.text, style: look(PLAIN), width: after ? nameWidth : nameEnd - nameCol });
    if (after) spans.push({ col: nameCol + nameWidth + 1, text: lit(fold), style: look(DIM), width: fold.length });
  }
  if (wordCells) spans.push({ col: wordCol, text: shown(row.word), style: look(DIM), width: wordCells });
  // The tag: its padding a blank span in its style, the words over it.
  const tagCol = waits ? cols - waits.length - 2 : 0;
  if (waits && tagCol > MARK + at) {
    spans.push({ col: tagCol, width: waits.length + 2, style: waitLook }, { col: tagCol + 1, text: lit(waits), style: waitLook, width: waits.length });
  }
  return spans;
}

/** A deployment's heading in a pane `cols` wide: its label in bold, its path, and, when it is not
 *  live, the shared word for its state and the short reason; at the right edge the time a machine
 *  reported its rows at. The state and the time always stand. When the row is too narrow for the
 *  rest, the path is given up first, then the short reason, and then the label is cut: the full
 *  reason is in the detail of each of its rows, and under the heading when it has none. A short
 *  reason with no state word is drawn too: the Souls view's heading of a failed re-read has a
 *  sentence and no shared word for a state (views/souls.mjs). */
export function headingRow({ label, path, state, short, readAt }, cols, ascii) {
  const spans = [], edge = cols - 1;
  let limit = edge;
  if (readAt) {
    const read = `read ${readAt}`, col = Math.max(HEAD, edge - read.length);
    spans.push({ col, text: lit(read), style: DIM, width: Math.max(0, Math.min(read.length, edge - col)) });
    limit = col - GAP;
  }
  const name = measured(label), word = state ? measured(state) : null, why = short ? measured(short) : null, where = path ? measured(path) : null;
  let room = limit - HEAD - (word ? GAP + word.width : 0);
  const nameWidth = Math.max(0, Math.min(name.width, room));
  room -= nameWidth;
  /** The cells a part after the label gets: its own, or what is left when that is enough to read. */
  const taken = (part) => (part && part.width > 0 && room - GAP >= Math.min(part.width, PART_MIN) ? Math.min(part.width, room - GAP) : 0);
  const whyWidth = taken(why);
  if (whyWidth) room -= GAP + whyWidth;
  const whereWidth = taken(where);
  let col = HEAD;
  if (nameWidth) { spans.push({ col, text: name.text, style: BOLD, width: nameWidth }); col += nameWidth + GAP; }
  // A path is read from its end: cut, it keeps its last cells.
  if (whereWidth) { spans.push({ col, text: whereWidth < where.width ? shownEnd(path, whereWidth, { ascii }) : where.text, style: DIM, width: whereWidth }); col += whereWidth + GAP; }
  if (word) { spans.push({ col, text: word.text, style: PLAIN, width: Math.max(0, Math.min(word.width, edge - col)) }); col += word.width + GAP; }
  if (whyWidth) spans.push({ col, text: why.text, style: DIM, width: whyWidth });
  return spans.filter((span) => span.width > 0);
}

/** How many rows are cut off, in the TUI's words: `12 more below`. */
export function cutNote(above, below) {
  return [above > 0 ? `${above} more above` : null, below > 0 ? `${below} more below` : null].filter(Boolean).join(", ");
}

/** The one row of a view with no instances, in `aside` cells: `No agents yet: n spawns one`, with
 *  the key the user's table gives `spawn` (text from outside: tui.json may rebind it), or `No
 *  agents yet.` while it has none. Cut at the edge, the key before the words after it. */
function noneRow(m, aside) {
  const action = (m.actions ?? []).find((a) => a.id === "spawn" && a.keys.length);
  if (!action) return [{ col: SENTENCE_INDENT, text: lit(`${EMPTY_TEXT.none}.`), style: DIM, width: aside }];
  const end = SENTENCE_INDENT + aside, lead = `${EMPTY_TEXT.none}:`, key = measured(keyLabel(action.keys[0]));
  const at = SENTENCE_INDENT + lead.length + 1, after = at + key.width + 1;
  return [
    { col: SENTENCE_INDENT, text: lit(lead), style: DIM, width: Math.min(lead.length, aside) },
    { col: at, text: key.text, style: DIM, width: Math.max(0, Math.min(key.width, end - at)) },
    { col: after, text: lit(SPAWNS_ONE), style: DIM, width: Math.max(0, Math.min(SPAWNS_ONE.length, end - after)) },
  ].filter((span) => span.width > 0);
}

/** `size.rows` rows for a pane `size.cols` wide: the model's window of the list, one item per row,
 *  and on the last row what is cut off above and below. An item is an instance, a deployment's
 *  heading, one row of a sentence the model wrapped (safe text already, placed as it is), a line
 *  of the TUI's own, the one line that says why no instance is listed, or nothing (an empty row). */
export function instances(m, size) {
  const rows = Array.from({ length: size.rows }, () => []);
  if (size.rows < 1) return rows;
  const marks = marksOf(m.ascii);
  const aside = Math.max(0, size.cols - SENTENCE_INDENT), sentence = Math.max(0, size.cols - SENTENCE_INDENT - 1);
  m.list.forEach((item, i) => {
    if (!item || i >= size.rows) return;
    if (item.heading) rows[i] = headingRow(item.heading, size.cols, m.ascii);
    else if (item.line) rows[i] = [{ col: SENTENCE_INDENT, text: item.line, width: sentence }];
    else if (item.own) rows[i] = [{ col: SENTENCE_INDENT, text: lit(item.own), style: DIM, width: sentence }];
    else if (item.empty === "none") rows[i] = noneRow(m, aside);
    else if (item.empty) rows[i] = [{ col: SENTENCE_INDENT, text: lit(EMPTY_TEXT[item.empty]), style: DIM, width: aside }];
    else rows[i] = instanceRow(item, size.cols, m.wordWidth, marks);
  });
  const note = cutNote(m.above, m.below);
  if (note) rows[size.rows - 1] = [{ col: SENTENCE_INDENT, text: lit(note), style: DIM, width: aside }];
  return rows;
}
