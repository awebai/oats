// The frame: (model, size) -> the rows of the whole screen. Pure: no IO, no clock, no escape
// byte. It places the views: the header, the list of instances and the detail beside it (or as a
// page of its own on a narrow terminal), the switcher of workspaces over the whole body, the
// help, and the footer. The TUI's own words are lit(); everything else is shown(). Meaning never
// rests on colour alone: what is dim or bold also says what it is in words or by a mark.
import { keyLabel } from "../actions.mjs";
import { lit, shown, shownLines } from "../term/text.mjs";
import { style } from "../term/style.mjs";
import { detail } from "./detail.mjs";
import { help, keyText } from "./help.mjs";
import { instances, measured } from "./instances.mjs";
import { switcher } from "./switcher.mjs";

/** The frame is drawn from this size up (docs/tui.md); the design size is 80x24. */
export const MIN_SIZE = Object.freeze({ cols: 60, rows: 15 });
/** From this width up the detail stands beside the list; under it, it is a page of its own. */
export const WIDE = 80;
/** The views, named so the frame has its shape. Two are dim: they cannot be opened yet, and the
 *  help says what to run instead. */
const VIEWS = Object.freeze([Object.freeze({ name: "1 Instances", open: true }), Object.freeze({ name: "2 Souls", open: false }), Object.freeze({ name: "3 Capabilities", open: false })]);
const GAP = 3;
/** One cell of margin on each side of the header and the footer. */
const MARGIN = 1;
/** The longest run one lit() holds with room to spare: the display filter bounds a line, and a
 *  terminal can be wider than that bound. */
const RUN = 500;
/** The rows a reason may take above the list: a quarter of the body, at least one, at most this. */
const REASON_ROWS = 4;
/** The rows a deployment's note may take above the list. */
const NOTE_ROWS = 2;
/** The cells a kept filter takes in the footer. */
const FILTER_COLS = 24;
/** What the header holds in the workspace's place while the switcher is shown. */
const WORKSPACES = "workspaces";
/** The TUI's word before the one machine of a view that holds no deployment of this machine. */
const ON = "on";
/** The cells the workspace's name keeps (all of them, when it is shorter) before the header says
 *  how many other machines it is on: under that the name comes first. */
const NAME_MIN = 8;

const BOLD = style({ bold: true });
const DIM = style({ dim: true });

const clamp = (n, low, high) => Math.min(Math.max(n, low), high);
const tooSmall = (size) => size.cols < MIN_SIZE.cols || size.rows < MIN_SIZE.rows;

/** One row saying so, with the size found and the size needed. Short, and the sizes early: on a
 *  terminal this small the screen clips the end of the row. */
function tooSmallRows(size) {
  const rows = Array.from({ length: size.rows }, () => []);
  if (size.rows > 0) rows[0] = [{ col: 0, text: lit(`Terminal too small: ${size.cols}x${size.rows}, oats tui needs ${MIN_SIZE.cols}x${MIN_SIZE.rows}.`) }];
  return rows;
}

/** A horizontal rule over the whole width, with a joint where the panes' rule meets it. */
function rule(cols, ascii, joint = null) {
  const spans = [], dash = ascii ? "-" : "─";
  for (let col = 0; col < cols; col += RUN) spans.push({ col, text: lit(dash.repeat(Math.min(RUN, cols - col))), style: DIM });
  if (joint) spans.push({ col: joint.col, text: lit(ascii ? "+" : joint.up ? "┴" : "┬"), style: DIM, width: 1 });
  return spans;
}

/** Where everything stands for a size: the body under the header, the reason of a deployment
 *  that is not live and the note of the one deployment of a view without headings (both wrapped
 *  here, since their rows take room from the panes), and the panes. `notice` and `note` are the
 *  model's (lib/model.mjs): the main loop asks for the layout first, because the model's window
 *  is as tall, and the sentences in its list as wide, as the list pane this gives. The answer's
 *  `note` is the note's rows. */
export function layout(notice, size, { observed = true, note = null, ascii = false } = {}) {
  const body = { top: 3, rows: Math.max(0, size.rows - 5) };
  const wide = size.cols >= WIDE;
  const listCols = wide ? clamp(Math.floor(size.cols * 0.48), 36, 60) : size.cols;
  const across = Math.max(1, size.cols - 2 * MARGIN);
  const reason = notice ? shownLines(notice.reason, across, clamp(Math.floor(body.rows / 4), 1, REASON_ROWS), { ascii }) : [];
  const noted = note ? shownLines(note, across, NOTE_ROWS, { ascii }) : [];
  // The state and its reason, then the note, stand above the panes, over the whole width; a rule
  // closes them when instances follow.
  const said = (notice ? 1 + reason.length : 0) + noted.length;
  const above = said ? Math.min(body.rows, said + (observed ? 1 : 0)) : 0;
  return { body, wide, listCols, reason, note: noted, above, panes: { top: body.top + above, rows: Math.max(0, body.rows - above) }, page: Math.max(0, body.rows - above) };
}

/** The header's middle, from `col` on in `room` cells: the workspace's name and, when the view
 *  holds other machines, what says so, in the TUI's words and dim:
 *    `+N machine(s)`  beside a deployment of this machine;
 *    `on <machine>`   the one machine of a view that holds no deployment of this machine (no
 *                     heading names it there);
 *    `N machines`     two or more of them and no deployment of this machine.
 *  Whether a deployment is this machine's is the shared entries' word (the model's `here`), and
 *  the machine's name is theirs. What stands after the name gives way before the name is cut
 *  short of NAME_MIN cells, and a machine's name is cut before the workspace's. While the
 *  switcher is shown no workspace is named: the header says what is listed instead. */
function nameSpans(m, col, room) {
  if (room <= 0) return [];
  if (m.under === "switcher") return [{ col, text: lit(WORKSPACES), width: room }];
  const name = measured(m.workspace), alone = [{ col, text: name.text, width: room }];
  if (!(m.machines > 0)) return alone;
  const least = Math.min(name.width, NAME_MIN);
  // Two cells between the name and what follows it, as everywhere in the header.
  const after = (width) => col + width + (width ? 2 : 0);
  if (!m.here && m.machine !== null) {
    const where = measured(m.machine), left = room - 2 - ON.length - 1;
    // The machine's name is cut first, down to the cells that still say something: the
    // workspace's name has what that leaves.
    const kept = Math.min(where.width, NAME_MIN);
    if (left - least < kept) return alone;
    const width = Math.min(name.width, left - kept), at = after(width);
    return [...(width ? [{ col, text: name.text, width }] : []), { col: at, text: lit(ON), style: DIM, width: ON.length }, { col: at + ON.length + 1, text: where.text, style: DIM, width: Math.min(where.width, left - width) }];
  }
  const more = `${m.here ? "+" : ""}${m.machines} ${m.machines === 1 ? "machine" : "machines"}`;
  const left = room - 2 - more.length;
  if (left < least) return alone;
  const width = Math.min(name.width, left);
  return [...(width ? [{ col, text: name.text, width }] : []), { col: after(width), text: lit(more), style: DIM, width: more.length }];
}

/** The header's counts, right aligned, each a number and a word. When they do not all fit, the
 *  ones from the shared count are given up from the end, never the two the TUI adds. */
function countSpans(counts, cols) {
  const texts = counts.map((count) => ({ ...count, text: `${count.n} ${count.word}` }));
  const width = (list) => list.reduce((sum, c) => sum + c.text.length, 0) + Math.max(0, list.length - 1) * 2;
  const room = cols - 2 * MARGIN - "oats".length - 2;
  let kept = texts;
  while (width(kept) > room && kept.some((c) => c.shared)) kept = kept.filter((c, i) => i !== kept.findLastIndex((k) => k.shared));
  const spans = [];
  let col = cols - MARGIN - width(kept);
  for (const count of kept) { if (col >= 0) spans.push({ col, text: count.shared ? shown(count.text) : lit(count.text), width: count.text.length }); col += count.text.length + 2; }
  return { spans, start: cols - MARGIN - width(kept) };
}

/** The footer: the filter field while it is open; else the actions that apply now, read from the
 *  effective table, as many as fit, `help` and `quit` last and always: their room is set aside
 *  first, and a kept filter and the other hints take what is left. A hint that does not fit ends
 *  the row's hints, so the order they are tried in is the order they are given up from the end:
 *  `workspaces` stands after `refresh`, and a row too narrow for both keeps `refresh`. The
 *  switcher has a filter of its own, drawn as the list's. A key's label is the user's
 *  (views/help.mjs keyText); everything is placed by cells. */
function footer(m, cols) {
  const action = (id) => m.actions.find((a) => a.id === id && a.keys.length);
  /** A hint: a key and what it does. */
  const made = (key, word) => ({ key, word, width: key.width + 1 + word.length });
  const hint = (id, label) => { const a = action(id); return a ? made(keyText(keyLabel(a.keys[0])), label ?? a.label) : null; };
  const edge = cols - MARGIN; // nothing stands at or past it
  /** A hint's spans at `col`, never past the edge. */
  const put = (h, col, look) => [
    { col, text: h.key.text, width: Math.max(0, Math.min(h.key.width, edge - col)), ...look },
    { col: col + h.key.width + 1, text: lit(h.word), width: Math.max(0, Math.min(h.word.length, edge - col - h.key.width - 1)), ...look },
  ].filter((span) => span.width > 0);
  const span = (hints) => hints.reduce((sum, h) => sum + h.width, 0) + Math.max(0, hints.length - 1) * GAP;

  if (m.view !== "help" && m.filter.editing) {
    const hints = [made({ text: lit("Enter"), width: "Enter".length }, "keep"), hint("close", "clear")].filter(Boolean);
    const spans = [{ col: MARGIN, text: lit("/"), style: BOLD, width: 1 }, { col: MARGIN + 1, text: shown(m.filter.query), width: Math.max(0, edge - span(hints) - GAP - MARGIN - 1) }];
    let col = Math.max(MARGIN + 2, edge - span(hints));
    for (const h of hints) { spans.push(...put(h, col, { style: DIM })); col += h.width + GAP; }
    return spans;
  }
  const ids = m.view === "help" ? ["close"]
    // Esc closes the switcher only onto a view, and there is none before a workspace is opened.
    // A kept filter puts `close` before `refresh`, as in the list: the key that clears it is the hint to keep.
    : m.view === "switcher" ? ["open-workspace", "filter", ...(m.filter.query ? ["close", "refresh"] : ["refresh", ...(m.open ? ["close"] : [])])]
    : m.focus === "detail" ? ["detail", "close", "refresh"]
    : ["filter", "detail", ...(m.filter.query ? ["close"] : []), "refresh", "workspaces"];
  const last = ["help", "quit"].map((id) => hint(id)).filter(Boolean);
  const spans = [];
  let col = MARGIN;
  if (m.view !== "help" && m.filter.query) {
    // The kept filter has a place of its own width, so the hints stand where they always do;
    // it gives way, down to nothing, before `help` and `quit` do.
    const slot = Math.min(FILTER_COLS - GAP, edge - MARGIN - span(last) - (last.length ? GAP : 0));
    if (slot >= 2) {
      spans.push({ col, text: lit("/"), style: BOLD, width: 1 }, { col: col + 1, text: shown(m.filter.query), style: BOLD, width: slot - 1 });
      col += slot + GAP;
    }
  }
  for (const h of ids.map((id) => hint(id)).filter(Boolean)) {
    if (col + h.width + GAP + span(last) > edge) break;
    spans.push(...put(h, col));
    col += h.width + GAP;
  }
  for (const h of last) { spans.push(...put(h, col)); col += h.width + GAP; }
  return spans;
}

/** Shift a pane's rows to its place on the screen. */
const placed = (spans, col) => spans.map((span) => ({ ...span, col: span.col + col }));

/** The whole screen for a model: `{ rows, page, extent, room }`. `page` is the rows of the list
 *  pane (of the whole body, for the switcher); `extent` and `room` are how many rows the other
 *  scrolling pane (the help, else the detail) holds and shows. The main loop hands the three back
 *  with the next key, so the store scrolls by what is on the screen without holding a size. */
export function frame(m, size) {
  if (tooSmall(size)) return { rows: tooSmallRows(size), page: 1, extent: 0, room: 1 };
  const rows = Array.from({ length: size.rows }, () => []);
  const g = layout(m.notice, size, { observed: m.observed, note: m.note, ascii: m.ascii });
  const { cols } = size;
  // The switcher is no view of the three: while it is shown, or is under the help, none is current.
  const listing = m.under === "switcher";

  const counts = countSpans(m.counts, cols);
  const nameCol = MARGIN + "oats".length + 2;
  rows[0] = [{ col: MARGIN, text: lit("oats"), style: BOLD }, ...nameSpans(m, nameCol, counts.start - 2 - nameCol), ...counts.spans];
  let col = MARGIN;
  for (const view of VIEWS) { rows[1].push({ col, text: lit(view.name), ...(view.open && !listing ? {} : { style: DIM }), width: view.name.length }); col += view.name.length + GAP; }
  if (m.readAt) { const read = `read ${m.readAt}`; rows[1].push({ col: cols - MARGIN - read.length, text: lit(read), style: DIM, width: read.length }); }
  rows[size.rows - 1] = footer(m, cols);

  if (m.view === "help") {
    rows[2] = rule(cols, m.ascii);
    rows[size.rows - 2] = rule(cols, m.ascii);
    const drawn = help(m.actions, { cols, rows: g.body.rows }, { top: m.helpTop, ascii: m.ascii });
    drawn.rows.forEach((spans, i) => { rows[g.body.top + i] = spans; });
    return { rows, page: Math.max(1, g.page), extent: drawn.extent, room: g.body.rows };
  }

  // The switcher takes the whole body, over the whole width: one pane, so no joint in the rules.
  // Nothing beside it scrolls on its own.
  if (listing) {
    rows[2] = rule(cols, m.ascii);
    rows[size.rows - 2] = rule(cols, m.ascii);
    switcher(m, { cols, rows: g.body.rows }).forEach((spans, i) => { rows[g.body.top + i] = spans; });
    return { rows, page: Math.max(1, g.body.rows), extent: 0, room: 1 };
  }

  // The state of a deployment that is not live, and on rows of its own the reason, which is the
  // shared home's sentence or the kernel's: nothing of the TUI's stands on a reason's row. Then
  // the note of the one deployment of a view without headings, the shared home's sentence too.
  const said = [];
  if (m.notice) {
    const since = m.notice.since ? `since ${m.notice.since}` : null;
    said.push([{ col: MARGIN, text: shown(m.notice.text), style: BOLD, width: Math.max(0, cols - 2 * MARGIN - (since ? since.length + 2 : 0)) }, ...(since ? [{ col: cols - MARGIN - since.length, text: lit(since), style: DIM, width: since.length }] : [])]);
    for (const line of g.reason) said.push([{ col: MARGIN, text: line, width: cols - 2 * MARGIN }]);
  }
  for (const line of g.note) said.push([{ col: MARGIN, text: line, width: cols - 2 * MARGIN }]);
  said.slice(0, g.above).forEach((spans, i) => { rows[g.body.top + i] = spans; });
  const paged = !g.wide && m.focus === "detail" && m.detail;
  // Two panes only over an observed deployment: with no instance there is nothing to put beside the list.
  const split = g.wide && g.panes.rows > 0 && m.observed;
  const joint = split ? { col: g.listCols } : null;
  // The rule that opens the panes: the one under the header, or the one under the reason and the note.
  const opening = m.observed && g.above > 0 ? g.panes.top - 1 : 2;
  rows[2] = rule(cols, m.ascii, opening === 2 ? joint : null);
  if (opening !== 2 && opening < size.rows - 2) rows[opening] = rule(cols, m.ascii, joint);
  rows[size.rows - 2] = rule(cols, m.ascii, joint && { ...joint, up: true });

  const pane = { cols: g.wide ? g.listCols : cols, rows: g.panes.rows };
  let extent = 0;
  if (!paged) instances(m, pane).forEach((spans, i) => { rows[g.panes.top + i] = spans; });
  if (split || paged) {
    const at = paged ? MARGIN : g.listCols + 2;
    const drawn = detail(m, { cols: Math.max(0, cols - at - MARGIN), rows: g.panes.rows });
    extent = drawn.extent;
    drawn.rows.forEach((spans, i) => { rows[g.panes.top + i] = [...rows[g.panes.top + i], ...(split ? [{ col: g.listCols, text: lit(m.ascii ? "|" : "│"), style: DIM, width: 1 }] : []), ...placed(spans, at)]; });
  }
  return { rows, page: Math.max(1, g.page), extent, room: Math.max(1, g.panes.rows) };
}
