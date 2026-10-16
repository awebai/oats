// The Souls view: (model, pane) -> rows of spans, the list of the open workspace's souls and the
// selected soul's detail. Pure: no IO, no clock, no escape byte. A soul's name, its description,
// where it comes from, its harness facts, its teams and capabilities, the names of its instances
// and a failed read's sentence are text the TUI did not write and go through shown(); the marks,
// the labels and the few lines of SOULS_TEXT are the TUI's own. Nothing is told by colour alone:
// a soul's colour is drawn on a mark that is there without it, the selected row carries `>` as
// well as reverse video, a soul a spawn here would refuse carries `!` as well as being dim, and
// the refusal in the detail says "Can't spawn here" in words before its warning style.
import { keyLabel } from "../actions.mjs";
import { lit, shown, shownLines } from "../term/text.mjs";
import { COLORS, style } from "../term/style.mjs";
import { LOOK, cutNote, headingRow, marksOf, measured } from "./instances.mjs";
import { windowOf } from "./scroll.mjs";

/** The TUI's own lines in the Souls view. `retry` and `toInstances` stand after the key that does
 *  what they say (tui.json may rebind it), so the line names the key the user has: `r reads them
 *  again.`. `reading` ends in an ellipsis, drawn `...` in ASCII. */
export const SOULS_TEXT = Object.freeze({
  reading: "Reading souls…",
  none: "This workspace offers no souls. `oats souls` says why.",
  nomatch: "No soul matches the filter.",
  retry: "reads them again.",
  noWorkspace: "Open a workspace of this machine to see its souls.",
  toInstances: "shows them in the Instances view.",
});

/** A soul's colour (soul-colors.mjs's palette name) as one of the terminal's sixteen: the model
 *  maps a row's colour with it, and a name not here leaves the soul uncoloured. */
export const SOUL_COLOURS = Object.freeze({ sand: "yellow", sage: "green", slate: "blue", mauve: "magenta", clay: "red", olive: "cyan" });

/** A soul's mark, in UTF-8 and in ASCII, and the sign before a count of its instances. */
export const SOUL_MARK = Object.freeze({ utf8: "■", ascii: "#" });
export const COUNT_SIGN = Object.freeze({ utf8: "·", ascii: "x" });

/** The columns of a soul's row, as an instance's: the selection mark, a gap, the soul's mark, a gap. */
const MARK = 2, NAME = 4;
/** Where a line of the TUI's own and a failed read's sentence start in the list, as in the list
 *  of instances (views/instances.mjs SENTENCE_INDENT). */
const SENTENCE_INDENT = 3;
/** The detail's title and labels start here: the first cell holds the mark of the pane with the
 *  focus (views/detail.mjs). */
const LEFT = 2;
/** The values start here, as in the instance detail (views/detail.mjs): a label is a short word.
 *  A part with a longer name (the harness, the capabilities, the instances here) has its name on
 *  a row of its own and its values under it. */
const VALUE = LEFT + 9;
/** The parts of a section (the harness, the instances) are set in this far under its label. */
const INNER = LEFT + 2;
/** The fewest cells a harness value keeps beside its label: under them each value goes on the
 *  row under its label, so a long label ("Launch configuration") never squeezes its value. */
const VALUE_MIN = 16;
/** The most rows a wrapped value or sentence takes, and the description. */
const WRAP_ROWS = 6, DESCRIPTION_ROWS = 8;

const PLAIN = style();
const BOLD = style({ bold: true });
const DIM = style({ dim: true });
const SELECTED = style({ reverse: true });
/** The refusal's warning style: it says "Can't spawn here" too, so the colour is not alone. */
const WARN = style({ bold: true, fg: "yellow" });

const markOf = (ascii) => (ascii ? SOUL_MARK.ascii : SOUL_MARK.utf8);
const countText = (count, ascii) => `${ascii ? COUNT_SIGN.ascii : COUNT_SIGN.utf8}${count}`;
/** A line of the TUI's own as the screen draws it: the ellipsis is `...` in ASCII. */
const ownText = (text, ascii) => (ascii ? text.replace(/…/g, "...") : text);

/** The first key of the action `id` as the user has it, `{ text, width }`, or null when it has none. */
function keyOf(m, id) {
  const action = (m.actions ?? []).find((a) => a.id === id && a.keys.length);
  return action ? measured(keyLabel(action.keys[0])) : null;
}

/** Whether the list stands, beside the detail on a wide terminal: once the catalog was read (its
 *  rows, or none of them matching the filter), and over the rows a failed re-read kept. A body of
 *  one sentence (reading, a failed first read, an empty catalog, no workspace here) has the whole
 *  width instead. */
export function soulsListed(s) {
  return Boolean(s) && s.local !== false && (s.heading != null || s.state === "rows" || s.state === "nomatch" || (s.list?.length ?? 0) > 0);
}

/** A line of the TUI's own on as many rows of `width` cells as it needs, broken at its spaces but
 *  never inside a command between backticks: a command cut in two cannot be typed. The Capabilities
 *  view sets its own lines with it too. */
export function ownLines(text, width) {
  const words = text.match(/`[^`]*`[^\s`]*|\S+/g) ?? [];
  return words.reduce((lines, word) => {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
    return lines;
  }, []);
}

/** Units set on rows of `width` cells from column 0, `gap` cells between two: a unit is pieces
 *  (`{ text, width, style, glue }`) written together, one cell between two but before a glued one
 *  (a comma). A unit is never broken over two rows; one wider than a row is cut there. The
 *  Capabilities view flows what a capability provides with it. */
export function flowed(units, width, gap = 1) {
  const unitWidth = (unit) => unit.reduce((sum, piece, i) => sum + piece.width + (i > 0 && !piece.glue ? 1 : 0), 0);
  const rows = [];
  let row = [], used = 0;
  for (const unit of units) {
    const w = unitWidth(unit);
    if (row.length && used + gap + w > width) { rows.push(row); row = []; used = 0; }
    let col = row.length ? used + gap : 0;
    unit.forEach((piece, i) => {
      if (i > 0 && !piece.glue) col += 1;
      if (col < width && piece.width > 0) row.push({ col, text: piece.text, width: Math.min(piece.width, width - col), ...(piece.style ? { style: piece.style } : {}) });
      col += piece.width;
    });
    used = Math.min(width, col);
  }
  if (row.length) rows.push(row);
  return rows;
}

/** One soul's row in a pane `cols` wide: the selection mark, the soul's mark in its colour, its
 *  name, `!` when a spawn of it here would be refused, and a dim count of its instances here when
 *  it has any. The name is cut before the `!` and the count are: they stay whole beside what is
 *  left of it. A refused soul's row is dim. One cell is kept at the right edge. */
function soulRow(row, cols, ascii) {
  const look = (own) => (row.selected ? SELECTED : own);
  const quiet = row.refused ? DIM : PLAIN;
  const colour = typeof row.color === "string" && COLORS.includes(row.color) ? row.color : null;
  const spans = [];
  if (row.selected) spans.push({ col: 0, width: cols, style: SELECTED }, { col: 0, text: lit(marksOf(ascii).selected), style: SELECTED, width: 1 });
  spans.push({ col: MARK, text: lit(markOf(ascii)), style: look(colour ? style({ fg: colour, dim: row.refused === true }) : quiet), width: 1 });
  const end = cols - 1;
  if (end <= NAME) return spans;
  const after = [...(row.refused ? [{ text: "!", style: quiet }] : []), ...(row.count > 0 ? [{ text: countText(row.count, ascii), style: DIM }] : [])];
  const afterWidth = after.reduce((sum, part) => sum + 1 + part.text.length, 0);
  const name = measured(row.name);
  // What follows the name stands only when a cell of the name is left beside it.
  const kept = end - NAME > afterWidth ? after : [];
  const room = end - NAME - (kept.length ? afterWidth : 0);
  const nameWidth = Math.min(name.width, room);
  spans.push({ col: NAME, text: name.text, style: look(quiet), width: kept.length ? nameWidth : room });
  let col = NAME + nameWidth;
  for (const part of kept) { col += 1; spans.push({ col, text: lit(part.text), style: look(part.style), width: part.text.length }); col += part.text.length; }
  return spans;
}

/** `size.rows` rows for the list pane, `size.cols` wide: the model's window of the souls (after
 *  the heading of a failed re-read, when there is one) and on the last row what is cut off; or the
 *  one body the catalog's state gives: reading, a failed first read (its sentence, then the key
 *  that reads again), an empty catalog, no soul matching the filter, no workspace of this machine. */
export function soulsList(m, size) {
  const s = m.souls, ascii = m.ascii;
  const rows = Array.from({ length: size.rows }, () => []);
  if (size.rows < 1 || !s) return rows;
  const width = Math.max(0, size.cols - SENTENCE_INDENT - 1);
  /** A line of the TUI's own, dim, from row `at` on: the rows it took. */
  const own = (text, at) => {
    const lines = ownLines(ownText(text, ascii), width).slice(0, Math.max(0, size.rows - at));
    lines.forEach((line, i) => { rows[at + i] = [{ col: SENTENCE_INDENT, text: lit(line), style: DIM, width }]; });
    return lines.length;
  };
  if (s.local === false) { own(SOULS_TEXT.noWorkspace, 0); return rows; }
  if (!soulsListed(s)) {
    if (s.state === "failed") {
      // The sentence from outside, whole where the rows allow, and under it the key that reads again.
      const retry = keyOf(m, "refresh");
      const lines = shownLines(s.failure, width, Math.max(1, size.rows - (retry ? 1 : 0)), { ascii });
      lines.forEach((line, i) => { rows[i] = [{ col: SENTENCE_INDENT, text: line, width }]; });
      if (retry && lines.length < size.rows) {
        const at = lines.length, words = SENTENCE_INDENT + retry.width + 1;
        rows[at] = [{ col: SENTENCE_INDENT, text: retry.text, style: BOLD, width: Math.min(retry.width, width) },
          ...(words < size.cols - 1 ? [{ col: words, text: lit(SOULS_TEXT.retry), style: DIM, width: size.cols - 1 - words }] : [])];
      }
    } else own(s.state === "none" ? SOULS_TEXT.none : SOULS_TEXT.reading, 0);
    return rows;
  }
  let at = 0;
  if (s.heading) rows[at++] = headingRow(s.heading, size.cols, ascii);
  if (s.state === "none" || s.state === "nomatch") own(SOULS_TEXT[s.state], at);
  else s.list.forEach((row, i) => { if (at + i < size.rows) rows[at + i] = soulRow(row, size.cols, ascii); });
  const note = cutNote(s.above ?? 0, s.below ?? 0);
  if (note) rows[size.rows - 1] = [{ col: SENTENCE_INDENT, text: lit(note), style: DIM, width: Math.max(0, size.cols - SENTENCE_INDENT) }];
  return rows;
}

/** Every row of the selected soul's detail for a pane `cols` wide, before it is scrolled: the name,
 *  a failed re-read's sentence (in the warning style; it says so in words) and the description; `from` and `works`; the refusal; the harness (each fact `label  value`,
 *  its notes, a launch problem); the teams; the capabilities (one line, wrapped); and the instances
 *  here, with the key that shows them. A section with nothing to say is left out. */
export function soulDetailRows(m, cols) {
  const d = m.souls?.detail;
  if (!d) return [];
  const ascii = m.ascii, wide = Math.max(0, cols - LEFT), room = Math.max(0, cols - VALUE), inner = Math.max(0, cols - INNER);
  const rows = [[{ col: LEFT, text: shown(d.name), style: BOLD, width: wide }]];
  const label = (text, col = LEFT) => ({ col, text: lit(text), style: DIM, width: Math.max(0, Math.min(text.length, cols - col)) });
  /** Safe lines placed at `col`, each `width` cells, the first beside `first` (a label) when given. */
  const lines = (list, col, width, look, first = null) => list.forEach((line, i) => rows.push([...(i === 0 && first ? [first] : []), { col, text: line, width, ...(look ? { style: look } : {}) }]));
  /** A value from outside beside its label, wrapped under the value's column. */
  const fact = (name, value) => {
    if (room < 1) { rows.push([label(name)]); return; }
    lines(shownLines(value, room, WRAP_ROWS, { ascii }), VALUE, room, null, label(name));
  };
  /** Units beside a label, flowed under the value's column. */
  const flowFact = (name, units) => {
    const set = room < 1 ? [] : flowed(units, room);
    if (!set.length) { rows.push([label(name)]); return; }
    set.forEach((spans, i) => rows.push([...(i === 0 ? [label(name)] : []), ...spans.map((span) => ({ ...span, col: span.col + VALUE }))]));
  };

  // A failed re-read's sentence, whole, under the name: the rows are the last read's.
  if (d.failure) lines(shownLines(d.failure, wide, WRAP_ROWS, { ascii }), LEFT, wide, WARN);
  lines(shownLines(d.description, wide, DESCRIPTION_ROWS, { ascii }), LEFT, wide);
  if (d.from) fact("from", d.from);
  if (d.works) fact("works", d.works);
  if (d.refusal) lines(shownLines(d.refusal, wide, WRAP_ROWS, { ascii }), LEFT, wide, WARN);

  const h = d.harness ?? { rows: [], notes: [], problem: null };
  if (h.rows.length || h.notes.length || h.problem) {
    rows.push([label("harness")]);
    const names = h.rows.map(([name]) => measured(name));
    const column = Math.max(0, ...names.map((name) => name.width));
    const beside = inner - column - 2 >= VALUE_MIN;
    h.rows.forEach(([, value], i) => {
      const name = { col: INNER, text: names[i].text, style: DIM, width: Math.min(names[i].width, inner) };
      if (beside) lines(shownLines(value, inner - column - 2, WRAP_ROWS, { ascii }), INNER + column + 2, inner - column - 2, null, name);
      else { rows.push([name]); lines(shownLines(value, Math.max(0, inner - 2), WRAP_ROWS, { ascii }), INNER + 2, Math.max(0, inner - 2)); }
    });
    for (const note of h.notes) lines(shownLines(note, inner, WRAP_ROWS, { ascii }), INNER, inner, DIM);
    if (h.problem) {
      lines(shownLines(h.problem.lead, inner, WRAP_ROWS, { ascii }), INNER, inner, BOLD);
      for (const line of h.problem.lines ?? []) lines(shownLines(line, inner, WRAP_ROWS, { ascii }), INNER, inner);
      if (h.problem.code) {
        const code = measured(h.problem.code);
        rows.push([label("code", INNER), { col: INNER + 5, text: code.text, style: DIM, width: Math.max(0, Math.min(code.width, cols - INNER - 5)) }]);
      }
    }
  }

  // Each team its label, the default one marked so in the TUI's word; a comma after all but the last.
  const comma = { text: lit(","), width: 1, glue: true };
  if (d.teams?.length) flowFact("teams", d.teams.map((team, i, all) => [measured(team.label), ...(team.default ? [{ text: lit("(default)"), width: "(default)".length, style: DIM }] : []), ...(i < all.length - 1 ? [comma] : [])]));
  if (d.capabilities?.length) {
    rows.push([label("capabilities")]);
    flowed(d.capabilities.map((id, i, all) => [measured(id), ...(i < all.length - 1 ? [comma] : [])]), inner).forEach((spans) => rows.push(spans.map((span) => ({ ...span, col: span.col + INNER }))));
  }

  const here = d.instances ?? { shown: [], more: 0 };
  if (here.shown.length || here.more > 0) {
    rows.push([label("instances here")]);
    const marks = marksOf(ascii);
    const units = [
      ...here.shown.map((each) => [{ text: lit(marks[each.mark] ?? marks.unknown), width: 1, style: LOOK[each.mark] ?? LOOK.unknown }, measured(each.name)]),
      ...(here.more > 0 ? [[{ text: lit(`+${here.more}`), width: `+${here.more}`.length, style: DIM }]] : []),
    ];
    flowed(units, inner, 2).forEach((spans) => rows.push(spans.map((span) => ({ ...span, col: span.col + INNER }))));
    const key = keyOf(m, "soul-instances");
    if (key && INNER + key.width + 1 < cols) rows.push([{ col: INNER, text: key.text, style: DIM, width: key.width }, { col: INNER + key.width + 1, text: lit(SOULS_TEXT.toInstances), style: DIM, width: cols - INNER - key.width - 1 }]);
  }
  return rows;
}

/** `{ rows, extent }`: `size.rows` rows of the detail for a pane `size.cols` wide, scrolled to the
 *  model's `detailTop`, and how many rows the whole detail has. The pane with the focus says so
 *  with `>` beside the title, never by an attribute alone (views/detail.mjs). */
export function soulDetail(m, size) {
  const all = soulDetailRows(m, size.cols);
  const rows = Array.from({ length: size.rows }, () => []);
  const win = windowOf({ top: m.souls?.detailTop ?? 0, count: all.length, height: size.rows });
  all.slice(win.top, win.top + win.size).forEach((spans, i) => { rows[i] = spans; });
  const note = cutNote(win.above, win.below);
  if (note && size.rows > 0) rows[size.rows - 1] = [{ col: LEFT, text: lit(note), style: DIM, width: Math.max(0, size.cols - LEFT) }];
  if (m.souls?.focus === "detail" && size.rows > 0 && all.length) rows[0] = [{ col: 0, text: lit(">"), style: BOLD, width: 1 }, ...rows[0]];
  return { rows, extent: all.length };
}
