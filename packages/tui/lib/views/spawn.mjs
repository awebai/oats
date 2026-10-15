// The spawn prompt (docs/tui.md, "Spawning an agent"): (model, area) -> rows of spans, over the
// whole body as the palette is. Pure: no IO, no clock, no escape byte. Two steps, the model's
// `m.spawn` (lib/model.mjs):
//   the picker   a title, one input, then the window of the souls the model lists, the selected one
//                in reverse with `>`, a soul a spawn here would refuse dim with `!` and its refusal;
//   the preview  the shared preview's facts (packages/client/spawn-preview-facts.mjs previewFacts),
//                the folds, scrolled by the model's `top` when they are taller than their room
//                (to the fold with the focus, whatever `top` says); under them, pinned to the
//                body's bottom, the two fields, the Spawn button and a problem.
// A soul's name, the query, every fact, the label of the instance a child would be of, the typed
// name and a problem's lines are text the TUI did not write and go through shown(); the titles,
// the field labels, the folds' labels and summaries and the button are the TUI's own. Nothing is
// told by colour alone: what has the focus carries `>` as well as reverse video, the focused
// button stands between `>` and `<`, a refused soul carries `!` and its refusal in words, and a
// preview being read again says so in words above its dim facts.
import { lit, ownEllipsis, shown, shownEnd, shownLines, textOf } from "../term/text.mjs";
import { style } from "../term/style.mjs";
import { textWidth } from "../term/width.mjs";
import { partRows } from "./frame.mjs";
import { cutNote, measured } from "./instances.mjs";
import { windowOf } from "./scroll.mjs";

/** The TUI's own lines in the prompt. Those that end in an ellipsis are drawn `...` in ASCII. */
export const SPAWN_TEXT = Object.freeze({
  pick: "Spawn: pick a soul",
  title: "Spawn",
  readingSouls: "Reading souls…",
  readingPreview: "Reading the preview…",
  none: "No souls in this workspace.",
  nomatch: "No soul matches.",
  name: "name",
  child: "child of",
  noParent: "none",
  button: "Spawn",
});

/** The query's prompt, and the cells it takes with the gap after it (the palette's). */
const PROMPT = ">", PROMPT_CELLS = 2;
/** A picker row's columns, as the palette's: the selection mark, a gap, the refused mark, a gap. */
const MARK = 2, LEAD = 4;
/** The mark of a soul a spawn here would refuse (the Souls view's). */
const REFUSED = "!";
/** The cells between a refused soul's name and its refusal. */
const REFUSAL_GAP = 2;
/** The picker's title and query rows: the window of souls starts under them. */
const PICKER_HEAD = 2;
/** The preview's labels start here: the first cell holds the focus mark. */
const LEFT = 2;
/** The values start here: the longest label the shared facts give ("Relationship") and a gap. */
const VALUE = LEFT + 14;
/** An open fold's content is set in this far. */
const INNER = LEFT + 2;
/** The most rows one value, sentence or line of a fold takes. */
const WRAP_ROWS = 8;
/** One cell is kept at the right edge. */
const EDGE = 1;

const PLAIN = style();
const BOLD = style({ bold: true });
const DIM = style({ dim: true });
const SELECTED = style({ reverse: true });
const FOCUSED = style({ bold: true, reverse: true });
const FOCUSED_DIM = style({ dim: true, reverse: true });

/** The TUI's own one-line words as drawn: the ellipsis is `...` in ASCII. */
const own = (text, ascii) => lit(ownEllipsis(text, ascii));
/** One span of the TUI's own words at `col`, kept inside `width` cells from column 0. */
function ownSpan(text, col, width, ascii, look = PLAIN) {
  const said = ownEllipsis(text, ascii), cells = Math.min(said.length, Math.max(0, width - col));
  return cells > 0 ? [{ col, text: lit(said), width: cells, style: look }] : [];
}
/** Text from outside on as many rows as it needs (at most `max`), each a span at `col`. */
function outsideRows(value, col, width, max, ascii, look = PLAIN) {
  const room = width - col;
  if (room < 1) return [];
  return shownLines(value, room, max, { ascii }).map((text) => [{ col, text, width: room, style: look }]);
}
/** Spans restyled: every span takes `look`. */
const restyled = (spans, look) => spans.map((span) => ({ ...span, style: look }));

// ── The picker ──────────────────────────────────────────────────────────────────────────────────

/** One soul's row in `cols` cells: `>` and reverse video when selected, `!` and dim when a spawn of
 *  it here would be refused, its name, and after a refused one's name its refusal, dim. */
function soulRow(row, cols) {
  const look = (base) => (row.selected ? SELECTED : base);
  const quiet = row.refused ? DIM : PLAIN;
  const end = cols - EDGE;
  const spans = [];
  if (row.selected) spans.push({ col: 0, width: cols, style: SELECTED }, { col: 0, text: lit(PROMPT), style: SELECTED, width: 1 });
  if (row.refused) spans.push({ col: MARK, text: lit(REFUSED), style: look(DIM), width: 1 });
  const name = measured(row.name), nameWidth = Math.max(0, Math.min(name.width, end - LEAD));
  if (nameWidth > 0) spans.push({ col: LEAD, text: name.text, style: look(quiet), width: nameWidth });
  const at = LEAD + nameWidth + REFUSAL_GAP;
  if (row.refused && row.refusal && at < end) {
    const refusal = measured(row.refusal);
    spans.push({ col: at, text: refusal.text, style: look(DIM), width: Math.min(refusal.width, end - at) });
  }
  return spans;
}

/** The picker's rows: the title, the query with its prompt, then the window of souls or the one
 *  sentence of a state with none; the last row says what the window cuts off. The cursor stands
 *  after the query. */
function picker(s, size, ascii) {
  const rows = Array.from({ length: size.rows }, () => []);
  const width = size.cols - EDGE;
  if (size.rows > 0) rows[0] = ownSpan(SPAWN_TEXT.pick, 0, width, ascii, BOLD);
  const query = measured(s.query ?? ""), room = Math.max(0, width - PROMPT_CELLS);
  if (size.rows > 1) rows[1] = [{ col: 0, text: lit(PROMPT), style: BOLD, width: PROMPT.length }, ...(query.width && room ? [{ col: PROMPT_CELLS, text: query.text, width: Math.min(query.width, room) }] : [])];
  const list = s.rows ?? [];
  list.forEach((row, i) => { if (PICKER_HEAD + i < size.rows) rows[PICKER_HEAD + i] = soulRow(row, size.cols); });
  if (!list.length && size.rows > PICKER_HEAD) {
    const said = s.state === "failed" ? outsideRows(s.failure, LEAD, width, Math.max(1, size.rows - PICKER_HEAD), ascii)
      : { reading: [ownSpan(SPAWN_TEXT.readingSouls, LEAD, width, ascii, DIM)], none: [ownSpan(SPAWN_TEXT.none, LEAD, width, ascii, DIM)], nomatch: [ownSpan(SPAWN_TEXT.nomatch, LEAD, width, ascii, DIM)] }[s.state] ?? [];
    said.forEach((spans, i) => { if (PICKER_HEAD + i < size.rows) rows[PICKER_HEAD + i] = spans; });
  }
  const note = cutNote(s.above ?? 0, s.below ?? 0);
  if (note && size.rows > PICKER_HEAD + 1) rows[size.rows - 1] = ownSpan(note, LEAD, width, ascii, DIM);
  return { rows, cursor: size.rows > 1 ? { row: 1, col: PROMPT_CELLS + Math.min(query.width, room) } : null, extent: 0, room: 1 };
}

// ── The preview ─────────────────────────────────────────────────────────────────────────────────

/** A value's parts from `col` in `width` cells (from column 0): each part is text from outside,
 *  written `gap` cells after the one before it, and never broken but where it is wider than a row;
 *  a `muted` part is dim. A `sub` part (where a value came from, what else) is dim on a row of its
 *  own under the value. */
function partsRows(parts, col, width, ascii, gap = 1) {
  const room = width - col;
  if (room < 1) return [];
  const rows = [];
  let row = [], used = 0;
  const flush = () => { if (row.length) rows.push(row); row = []; used = 0; };
  for (const part of (parts ?? []).filter((each) => !each?.sub)) {
    const m = measured(part?.text), look = part?.muted ? DIM : PLAIN;
    if (m.width === 0) continue;
    const at = row.length ? used + gap : 0;
    if (at + m.width <= room) { row.push({ col: col + at, text: m.text, width: m.width, style: look }); used = at + m.width; continue; }
    flush();
    if (m.width <= room) { row.push({ col, text: m.text, width: m.width, style: look }); used = m.width; continue; }
    // Wider than a row: broken over rows of its own.
    for (const text of shownLines(part.text, room, WRAP_ROWS, { ascii })) rows.push([{ col, text, width: room, style: look }]);
  }
  flush();
  for (const part of (parts ?? []).filter((each) => each?.sub)) rows.push(...outsideRows(part.text, col, width, WRAP_ROWS, ascii, DIM));
  return rows;
}

/** A label (text from outside, dim, cut to the label column) with its value's rows beside it. */
function labelled(label, valueRows, width) {
  const name = measured(label), cells = Math.max(0, Math.min(name.width, VALUE - LEFT - 1, width - LEFT));
  const head = cells > 0 ? [{ col: LEFT, text: name.text, width: cells, style: DIM }] : [];
  if (!valueRows.length) return [head];
  return valueRows.map((spans, i) => (i === 0 ? [...head, ...spans] : spans));
}

/** An open fold's content, set in at INNER. */
function foldContent(key, facts, width, ascii) {
  const out = [];
  if (key === "prompts") {
    for (const prompt of facts?.prompts ?? []) {
      out.push(...outsideRows(prompt.label, INNER, width, 2, ascii, DIM));
      out.push(...outsideRows(prompt.text, INNER + 2, width, WRAP_ROWS, ascii));
    }
  } else if (key === "warnings") {
    (facts?.warnings ?? []).forEach((lines, i) => {
      if (i > 0) out.push([]);
      for (const line of Array.isArray(lines) ? lines : [lines]) out.push(...outsideRows(line, INNER, width, WRAP_ROWS, ascii));
    });
  } else if (key === "modules") {
    const described = (module) => [{ text: module.name }, ...(module.why ? [{ text: module.why, muted: true }] : []), ...(module.source ? [{ text: module.source, muted: true }] : [])];
    for (const slot of facts?.modules?.core ?? []) {
      const value = slot.module ? partsRows(described(slot.module), VALUE, width, ascii, 2) : [ownSpan(SPAWN_TEXT.noParent, VALUE, width, ascii, DIM)];
      const name = measured(slot.label), cells = Math.max(0, Math.min(name.width, VALUE - INNER - 1, width - INNER));
      const head = cells > 0 ? [{ col: INNER, text: name.text, width: cells, style: DIM }] : [];
      out.push(...value.map((spans, i) => (i === 0 ? [...head, ...spans] : spans)));
    }
    for (const module of facts?.modules?.caps ?? []) out.push(...partsRows(described(module), INNER, width, ascii, 2));
  }
  return out;
}

/** A row's text in focus: `>` in the first cell, and from it to the end of its spans in reverse video. */
function focusedRow(spans) {
  const end = spans.reduce((most, span) => Math.max(most, span.col + span.width), 1);
  return [{ col: 0, width: end, style: FOCUSED }, { col: 0, text: lit(PROMPT), style: FOCUSED, width: 1 }, ...restyled(spans, FOCUSED)];
}

/** The preview's two parts for an area `cols` wide (one cell kept at the edge):
 *    scroll  the rows that scroll by the model's `top`: the title, the status, the identity, the
 *            facts and the folds, each open one with its content;
 *    keep    the row of the fold with the focus in `scroll`, or -1: the window always holds it;
 *    pinned  the rows that keep the area's bottom, as a confirmation's buttons do: the two fields,
 *            the Spawn button and a problem (cut to `problemRows` rows, the last one the cut mark);
 *    cursor  where the name field's cursor stands in `pinned` (`{ row, col }`), or null while the
 *            field has no focus;
 *    button  the Spawn button's row in `pinned`. */
export function previewRows(s, cols, ascii, { problemRows = Infinity } = {}) {
  const width = Math.max(1, cols - EDGE);
  const rows = [];
  let keep = -1;
  // The title: the TUI's word and the soul's name, bold.
  // A space ends the TUI's word: the soul's name is not written against it (frame.mjs partRows).
  const title = partRows([{ own: `${SPAWN_TEXT.title} ` }, ...(s.soul ? [{ shown: s.soul }] : [])], width - LEFT, 2, { ascii });
  rows.push(...title.map((spans) => restyled(spans, BOLD).map((span) => ({ ...span, col: span.col + LEFT }))), []);
  if (s.status === "souls") rows.push(ownSpan(SPAWN_TEXT.readingSouls, LEFT, width, ascii, DIM), []);
  if (s.status === "reading") rows.push(ownSpan(SPAWN_TEXT.readingPreview, LEFT, width, ascii, DIM), []);
  // The facts: shown while read and while a new read runs (dim then: they are the last read's).
  const facts = s.status === "shown" || s.status === "reading" ? s.facts : null;
  if (facts) {
    const stale = s.status === "reading";
    const block = [];
    for (const item of facts.identity ?? []) block.push(...labelled(item.label, partsRows([{ text: item.text, muted: item.muted }], VALUE, width, ascii), width));
    for (const fact of facts.facts ?? []) block.push(...labelled(fact.label, partsRows(fact.parts, VALUE, width, ascii), width));
    rows.push(...(stale ? block.map((spans) => restyled(spans, DIM)) : block));
    const folds = s.folds ?? [];
    if (folds.length) rows.push([]);
    for (const fold of folds) {
      const line = partRows([{ own: `${fold.label}: ${fold.summary}` }], width - LEFT, 1, { ascii }).flat().map((span) => ({ ...span, col: span.col + LEFT, style: stale ? DIM : PLAIN }));
      if (fold.focused) keep = rows.length;
      rows.push(fold.focused ? focusedRow(line) : line);
      if (fold.open) {
        const content = foldContent(fold.key, facts, width, ascii);
        rows.push(...(stale ? content.map((spans) => restyled(spans, DIM)) : content));
      }
    }
  }
  // The two fields, after an empty row: the name the person typed (empty: the identity's Name row
  // says the kernel numbers it), and, when offered, the instance the new one would be a child of.
  const pinned = [[]];
  const fields = s.fields ?? {};
  let cursor = null;
  if (fields.name) {
    const label = ownSpan(SPAWN_TEXT.name, LEFT, width, ascii);
    const room = Math.max(0, width - VALUE);
    const text = room > 0 ? shownEnd(fields.name.text ?? "", room, { ascii }) : null;
    const used = text ? Math.min(textWidth(textOf(text)), room) : 0;
    const value = used > 0 ? [{ col: VALUE, text, width: used }] : [];
    pinned.push(fields.name.focused ? [...focusedRow(label), ...value] : [...label, ...value]);
    if (fields.name.focused) cursor = { row: pinned.length - 1, col: Math.min(VALUE + used, width) };
  }
  if (fields.child?.offered) {
    const label = ownSpan(SPAWN_TEXT.child, LEFT, width, ascii);
    const value = fields.child.on && fields.child.label != null
      ? (() => { const m = measured(fields.child.label); return [{ col: VALUE, text: m.text, width: Math.max(0, Math.min(m.width, width - VALUE)) }].filter((span) => span.width > 0); })()
      : ownSpan(SPAWN_TEXT.noParent, VALUE, width, ascii, DIM);
    pinned.push(fields.child.focused ? [...focusedRow(label), ...value] : [...label, ...value]);
  }
  // The button: between `>` and `<` while it has the focus; dim while Enter on it would not spawn
  // the preview on screen (still read, failed, or not drawn for these choices yet).
  const focused = s.focus === "spawn";
  const label = focused ? `> ${SPAWN_TEXT.button} <` : `[ ${SPAWN_TEXT.button} ]`;
  pinned.push([], ownSpan(label, LEFT, width, ascii, s.ready ? (focused ? FOCUSED : PLAIN) : (focused ? FOCUSED_DIM : DIM)));
  const button = pinned.length - 1;
  // A failed read, or a spawn's outcome that brought the prompt back, after an empty row: its
  // sentence bold, then the lines under it as they came. Cut to the rows it is given, the last of
  // them the cut mark then.
  if (s.problem && problemRows > 0) {
    const problem = [[]];
    problem.push(...partRows(s.problem.said ?? [], width - LEFT, WRAP_ROWS, { ascii }).map((spans) => restyled(spans, BOLD).map((span) => ({ ...span, col: span.col + LEFT }))));
    for (const line of s.problem.under ?? []) problem.push(...outsideRows(line, LEFT, width, WRAP_ROWS, ascii));
    pinned.push(...(problem.length <= problemRows ? problem : [...problem.slice(0, problemRows - 1), ownSpan("\u2026", LEFT, width, ascii, DIM)]));
  }
  return { scroll: rows, keep, pinned, cursor, button };
}

/** The rows the scrolling part keeps at least, above what is pinned under it. */
const SCROLL_MIN = 3;

/** The preview in `size.rows` rows: the fields, the button and a problem pinned at the bottom, and
 *  above them the rest scrolled to the model's `top`, or to the window that holds the fold with
 *  the focus (the store scrolls only with the movement keys; Tab can land on a fold out of sight).
 *  The scrolling part's last row says what is cut off. `extent` and `room` are the scrolling
 *  part's, for the store's scroll, and `top` the row the window drawn starts at (which keeps the
 *  focused fold in sight, and so may stand where the model's `top` does not): the store scrolls
 *  from it; `armed` is whether the ready Spawn button is on the screen. */
function preview(s, size, ascii) {
  const rows = Array.from({ length: size.rows }, () => []);
  const fixed = previewRows(s, size.cols, ascii, { problemRows: 0 }).pinned.length;
  const all = previewRows(s, size.cols, ascii, { problemRows: Math.max(0, size.rows - SCROLL_MIN - fixed) });
  const pinned = all.pinned.slice(-size.rows);
  const room = Math.max(0, size.rows - pinned.length);
  const win = windowOf({ top: s.top ?? 0, count: all.scroll.length, height: room, keep: all.keep });
  all.scroll.slice(win.top, win.top + win.size).forEach((spans, i) => { rows[i] = spans; });
  const note = cutNote(win.above, win.below);
  if (note && room > 0) rows[room - 1] = ownSpan(note, LEFT, size.cols - EDGE, ascii, DIM);
  pinned.forEach((spans, i) => { rows[room + i] = spans; });
  const cut = all.pinned.length - pinned.length;
  const cursor = all.cursor && all.cursor.row >= cut ? { row: room + all.cursor.row - cut, col: all.cursor.col } : null;
  return { rows, cursor, extent: all.scroll.length, room: Math.max(1, room), top: win.top, armed: s.ready === true && all.button >= cut };
}

/** `{ rows, cursor, extent, room, top?, armed? }`: `size.rows` rows for an area `size.cols` wide, the step of the
 *  prompt the model is at. `cursor` is `{ row, col }` in the area (the query's end, or the name
 *  field's while it has the focus), or null; `extent` and `room` are the preview's scrolling
 *  part's, for the store's scroll (0 and 1 for the picker, which the model windows itself). */
export function spawn(m, size) {
  const s = m.spawn;
  return s.step === "picker" ? picker(s, size, m.ascii) : preview(s, size, m.ascii);
}
