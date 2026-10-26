// The Capabilities view: (model, pane) -> rows of spans, the list of the open workspace's
// capabilities in their sections and groups, and the selected capability's detail. Pure: no IO, no
// clock, no escape byte. A capability's name, its description, a group's name and note, the facts
// of where it comes from and what it provides, the names of the souls that use it, the shared words
// of the detail (lib/model.mjs passes CAPABILITY_COPY's) and a failed read's sentence are text the
// TUI did not write and go through shown(); the section titles, the separators and the few lines
// of CAPABILITIES_TEXT are the TUI's own. Nothing is told by colour alone: the selected row and the
// marked soul carry `>` as well as reverse video, a soul's colour is drawn on a mark that is there
// without it, and the souls on an older version are said so in words before their warning style.
import { lit, shown, shownLines } from "../term/text.mjs";
import { style } from "../term/style.mjs";
import { keyLabel } from "../actions.mjs";
import { colourLook, cutNote, headingRow, marksOf, measured } from "./instances.mjs";
import { windowOf } from "./scroll.mjs";
import { COUNT_SIGN, SOUL_MARK, flowed, ownLines } from "./souls.mjs";

/** The TUI's own lines in the Capabilities view. The section titles are the Desktop's own
 *  (renderer/workspace-catalog.mjs), word for word: the shared home holds none (Spec 7, Settled 6).
 *  `retry` stands after the key that reads again (tui.json may rebind it). `reading` and
 *  `readingSouls` end in an ellipsis, drawn `...` in ASCII. */
export const CAPABILITIES_TEXT = Object.freeze({
  reading: "Reading capabilities…",
  none: "This workspace offers no capabilities. `oats capabilities` says why.",
  nomatch: "No capability matches the filter.",
  retry: "reads them again.",
  noWorkspace: "Open a workspace of this machine to see its capabilities.",
  readingSouls: "Reading souls…",
  sections: Object.freeze({ workspace: "Workspace owned", repo: "Repo owned", packages: "Packages" }),
});

/** The columns of the list: the selection mark, a section's title, a group's heading, a capability's name. */
const SECTION = 1, GROUP = 2, NAME = 4;
/** Where a line of the TUI's own and a failed read's sentence start in the list (views/souls.mjs). */
const SENTENCE_INDENT = 3;
/** The detail's title and headings start here: the first cell holds the mark of the pane with the
 *  focus (views/detail.mjs). Each section's lines are set in to INNER. */
const LEFT = 2, INNER = LEFT + 2;
/** The fewest cells a fact's value keeps beside its label: under them it goes on the row under it. */
const VALUE_MIN = 16;
/** The most rows a wrapped value or sentence takes, and the description. */
const WRAP_ROWS = 6, DESCRIPTION_ROWS = 8;

const PLAIN = style();
const BOLD = style({ bold: true });
const DIM = style({ dim: true });
const SELECTED = style({ reverse: true });
/** The warning style: what it marks says so in words too. Red, not yellow: yellow says needs input,
 *  and only that. */
const WARN = style({ bold: true, fg: "red" });

/** The mark between a group's name and its note, and before the instances on an older version. */
const dotOf = (ascii) => (ascii ? "-" : "·");
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
export function capabilitiesListed(c) {
  return Boolean(c) && c.local !== false && (c.heading != null || c.state === "rows" || c.state === "nomatch" || (c.list?.length ?? 0) > 0);
}

/** Text from outside, then `after` (parts `{ text, style }` of the TUI's own or shown already, each
 *  `width` cells) one cell after it, from column `col` in a row ending at `end`: the text is cut
 *  before what follows it is, which stands whole beside what is left of it, or not at all when no
 *  cell of the text would be left. */
function nameThen(name, after, col, end, look) {
  const afterWidth = after.reduce((sum, part) => sum + 1 + part.width, 0);
  const kept = end - col > afterWidth ? after : [];
  const room = end - col - (kept.length ? afterWidth : 0);
  if (room <= 0) return [];
  const nameWidth = Math.min(name.width, room);
  const spans = [{ col, text: name.text, style: look(PLAIN), width: kept.length ? nameWidth : room }];
  let at = col + nameWidth;
  for (const part of kept) { at += 1; spans.push({ col: at, text: part.text, style: look(part.style), width: part.width }); at += part.width; }
  return spans;
}

/** One item of the list in a pane `cols` wide: a section's title (bold), a group's heading (dim,
 *  `name · note`), or a capability: the selection mark, its name, and its layer's label dim when it
 *  has one. One cell is kept at the right edge. */
function itemRow(item, cols, ascii) {
  const end = cols - 1;
  if (item.section !== undefined) {
    const title = CAPABILITIES_TEXT.sections[item.section];
    return [{ col: SECTION, text: lit(title), style: BOLD, width: Math.max(0, Math.min(title.length, end - SECTION)) }];
  }
  if (item.group !== undefined) {
    const name = measured(item.group), note = item.note ? measured(item.note) : null;
    const spans = [{ col: GROUP, text: name.text, style: DIM, width: Math.max(0, Math.min(name.width, end - GROUP)) }];
    const at = GROUP + name.width;
    if (note && at + 3 < end) spans.push({ col: at + 1, text: lit(dotOf(ascii)), style: DIM, width: 1 }, { col: at + 3, text: note.text, style: DIM, width: Math.max(0, end - at - 3) });
    return spans.filter((span) => span.width > 0);
  }
  const look = (own) => (item.selected ? SELECTED : own);
  const spans = item.selected ? [{ col: 0, width: cols, style: SELECTED }, { col: 0, text: lit(marksOf(ascii).selected), style: SELECTED, width: 1 }] : [];
  const layer = item.layer ? measured(item.layer) : null;
  return [...spans, ...nameThen(measured(item.name), layer ? [{ text: layer.text, width: layer.width, style: DIM }] : [], NAME, end, look)];
}

/** `size.rows` rows for the list pane, `size.cols` wide: the model's window of the sections, the
 *  groups and the capabilities (after the heading of a failed re-read, when there is one) and on
 *  the last row what is cut off; or the one body the catalog's state gives: reading, a failed first
 *  read (its sentence, then the key that reads again), an empty catalog, nothing matching the
 *  filter, no workspace of this machine. */
export function capabilitiesList(m, size) {
  const c = m.capabilities, ascii = m.ascii;
  const rows = Array.from({ length: size.rows }, () => []);
  if (size.rows < 1 || !c) return rows;
  const width = Math.max(0, size.cols - SENTENCE_INDENT - 1);
  /** A line of the TUI's own, dim, from row `at` on: the rows it took. */
  const own = (text, at) => {
    const lines = ownLines(ownText(text, ascii), width).slice(0, Math.max(0, size.rows - at));
    lines.forEach((line, i) => { rows[at + i] = [{ col: SENTENCE_INDENT, text: lit(line), style: DIM, width }]; });
    return lines.length;
  };
  if (c.local === false) { own(CAPABILITIES_TEXT.noWorkspace, 0); return rows; }
  if (!capabilitiesListed(c)) {
    if (c.state === "failed") {
      // The sentence from outside, whole where the rows allow, and under it the key that reads again.
      const retry = keyOf(m, "refresh");
      const lines = shownLines(c.failure, width, Math.max(1, size.rows - (retry ? 1 : 0)), { ascii });
      lines.forEach((line, i) => { rows[i] = [{ col: SENTENCE_INDENT, text: line, width }]; });
      if (retry && lines.length < size.rows) {
        const at = lines.length, words = SENTENCE_INDENT + retry.width + 1;
        rows[at] = [{ col: SENTENCE_INDENT, text: retry.text, style: BOLD, width: Math.min(retry.width, width) },
          ...(words < size.cols - 1 ? [{ col: words, text: lit(CAPABILITIES_TEXT.retry), style: DIM, width: size.cols - 1 - words }] : [])];
      }
    } else own(c.state === "none" ? CAPABILITIES_TEXT.none : CAPABILITIES_TEXT.reading, 0);
    return rows;
  }
  let at = 0;
  if (c.heading) rows[at++] = headingRow(c.heading, size.cols, ascii);
  if (c.state === "none" || c.state === "nomatch") own(CAPABILITIES_TEXT[c.state], at);
  else c.list.forEach((item, i) => { if (at + i < size.rows) rows[at + i] = itemRow(item, size.cols, ascii); });
  const note = cutNote(c.above ?? 0, c.below ?? 0);
  if (note) rows[size.rows - 1] = [{ col: SENTENCE_INDENT, text: lit(note), style: DIM, width: Math.max(0, size.cols - SENTENCE_INDENT) }];
  return rows;
}

/** `{ rows, mark }`: every row of the selected capability's detail for a pane `cols` wide, before it
 *  is scrolled, and the row of the marked soul of "Used by" (-1 when none is marked). Top to bottom:
 *  the name and its layer's label, a failed re-read's sentence (in the warning style; it says so in
 *  words), the description; where it comes from (each fact `label  value`); what it provides (each
 *  kind its names, flowed, or the shared word for none or not listable); and the souls that use it,
 *  eight at most and then `+n`, each its colour mark, its name, a dim count of its instances that
 *  carry it and how many of those are on an older version. A section with nothing to say is left out. */
export function capabilityDetailRows(m, cols) {
  const d = m.capabilities?.detail;
  if (!d) return { rows: [], mark: -1 };
  const ascii = m.ascii, wide = Math.max(0, cols - LEFT), inner = Math.max(0, cols - INNER);
  const label = (text, col = LEFT) => { const t = measured(text); return { col, text: t.text, style: DIM, width: Math.max(0, Math.min(t.width, cols - col)) }; };
  const layer = d.layer ? measured(d.layer) : null;
  const rows = [nameThen(measured(d.name), layer ? [{ text: layer.text, width: layer.width, style: DIM }] : [], LEFT, cols, (own) => (own === PLAIN ? BOLD : own))];
  /** Safe lines placed at `col`, each `width` cells, the first beside `first` when given. */
  const lines = (list, col, width, look, first = null) => list.forEach((line, i) => rows.push([...(i === 0 && first ? [first] : []), { col, text: line, width, ...(look ? { style: look } : {}) }]));
  /** Facts `{ label, value }` under a section's heading: the labels in a column of their own, and
   *  each value beside its label, wrapped, or under it when the column leaves too few cells (and
   *  none at all in a pane with no cell for it). */
  const facts = (list, value) => {
    const names = list.map((fact) => measured(fact.label));
    const column = Math.max(0, ...names.map((name) => name.width));
    const beside = inner - column - 2 >= VALUE_MIN;
    list.forEach((fact, i) => {
      const name = { col: INNER, text: names[i].text, style: DIM, width: Math.min(names[i].width, inner) };
      if (beside) value(fact, INNER + column + 2, inner - column - 2, name);
      else { rows.push([name]); if (inner - 2 >= 1) value(fact, INNER + 2, inner - 2, null); }
    });
  };
  const blank = () => rows.push([]);

  if (d.failure) lines(shownLines(d.failure, wide, WRAP_ROWS, { ascii }), LEFT, wide, WARN);
  lines(shownLines(d.description, wide, DESCRIPTION_ROWS, { ascii }), LEFT, wide);

  if (d.comesFrom.length) {
    blank();
    rows.push([label(d.words.comesFrom)]);
    facts(d.comesFrom, (fact, col, width, name) => lines(shownLines(fact.value, width, WRAP_ROWS, { ascii }), col, width, null, name));
  }

  if (d.provides.length) {
    blank();
    rows.push([label(d.words.provides)]);
    const comma = { text: lit(","), width: 1, glue: true };
    facts(d.provides, (kind, col, width, name) => {
      if (kind.said) { lines(shownLines(kind.said, width, WRAP_ROWS, { ascii }), col, width, DIM, name); return; }
      const set = width < 1 ? [] : flowed(kind.names.map((each, i, all) => [measured(each), ...(i < all.length - 1 ? [comma] : [])]), width);
      if (!set.length) { if (name) rows.push([name]); return; }
      set.forEach((spans, i) => rows.push([...(i === 0 && name ? [name] : []), ...spans.map((span) => ({ ...span, col: span.col + col }))]));
    });
  }

  const u = d.used;
  blank();
  const count = u.count ? measured(u.count) : null, heading = label(d.words.usedBy);
  rows.push([heading, ...(count && LEFT + heading.width + 2 < cols ? [{ col: LEFT + heading.width + 2, text: count.text, style: DIM, width: Math.max(0, Math.min(count.width, cols - LEFT - heading.width - 2)) }] : [])]);
  let mark = -1;
  if (u.state === "reading") lines([lit(ownText(CAPABILITIES_TEXT.readingSouls, ascii))], INNER, inner, DIM);
  else if (u.state === "failed") lines(shownLines(u.failure, inner, WRAP_ROWS, { ascii }), INNER, inner, WARN);
  else if (u.empty) lines(shownLines(u.empty, inner, WRAP_ROWS, { ascii }), INNER, inner, DIM);
  const sign = ascii ? COUNT_SIGN.ascii : COUNT_SIGN.utf8, soulMark = ascii ? SOUL_MARK.ascii : SOUL_MARK.utf8, end = cols - 1;
  u.shown.forEach((user, i) => {
    const marked = i === m.capabilities.mark;
    if (marked) mark = rows.length;
    const look = (own) => (marked ? SELECTED : own);
    const spans = marked ? [{ col: LEFT, width: Math.max(0, cols - LEFT), style: SELECTED }, { col: LEFT, text: lit(">"), style: SELECTED, width: 1 }] : [];
    spans.push({ col: INNER, text: lit(soulMark), style: look(colourLook(user.color) ?? PLAIN), width: 1 });
    const counted = `${sign}${user.count}`;
    const after = [{ text: lit(counted), width: counted.length, style: DIM }];
    if (user.behind) { const behind = measured(user.behind); after.push({ text: lit(dotOf(ascii)), width: 1, style: DIM }, { text: behind.text, width: behind.width, style: WARN }); }
    rows.push([...spans, ...nameThen(measured(user.name), after, INNER + 2, end, look)]);
  });
  if (u.more > 0) rows.push([{ col: INNER, text: lit(`+${u.more}`), style: DIM, width: `+${u.more}`.length }]);
  return { rows, mark };
}

/** `{ rows, extent, top }`: `size.rows` rows of the detail for a pane `size.cols` wide, scrolled to
 *  the model's `detailTop`, or the least from there that shows the marked soul while the detail was
 *  not scrolled away from it (`keep`); how many rows the whole detail has; and the row it was drawn
 *  from, which the loop gives the store. The pane with the focus says so with `>` beside the title,
 *  never by an attribute alone (views/detail.mjs). */
export function capabilityDetail(m, size) {
  const { rows: all, mark } = capabilityDetailRows(m, size.cols);
  const rows = Array.from({ length: size.rows }, () => []);
  const c = m.capabilities;
  const win = windowOf({ top: c?.detailTop ?? 0, count: all.length, height: size.rows, keep: c?.keep && mark >= 0 ? mark : -1 });
  all.slice(win.top, win.top + win.size).forEach((spans, i) => { rows[i] = spans; });
  const note = cutNote(win.above, win.below);
  if (note && size.rows > 0) rows[size.rows - 1] = [{ col: LEFT, text: lit(note), style: DIM, width: Math.max(0, size.cols - LEFT) }];
  if (c?.focus === "detail" && size.rows > 0 && all.length) rows[0] = [{ col: 0, text: lit(">"), style: BOLD, width: 1 }, ...rows[0]];
  return { rows, extent: all.length, top: win.top };
}
