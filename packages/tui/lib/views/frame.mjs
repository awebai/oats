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

/** A sentence made of parts (lib/model.mjs OPEN_WORDS): the TUI's own words (`{ own }`) and text
 *  from outside (`{ shown }`, a name), each made safe on its own, so no word of the TUI's is ever
 *  filtered with a name and no name is ever taken for the TUI's. Set on at most `max` rows of at
 *  most `width` cells, broken at the spaces of the TUI's words; a name and what is written against
 *  it (a full stop) are never broken apart, and a name wider than a row is cut there. Answers rows
 *  of spans from column 0; when more was left, the last row ends in the cut mark. */
export function partRows(parts, width, max, { ascii = false } = {}) {
  if (width < 1 || max < 1) return [];
  // Units: what is written together, a space between two.
  const units = [];
  let glue = false;
  const put = (piece) => { if (glue && units.length) units.at(-1).push(piece); else units.push([piece]); glue = true; };
  for (const part of parts) {
    if (part.own !== undefined) part.own.split(" ").forEach((word, i) => { if (i > 0) glue = false; if (word) put({ text: lit(word), width: word.length }); });
    else { const m = measured(part.shown); if (m.width > 0) put(m); }
  }
  const unitWidth = (unit) => unit.reduce((sum, piece) => sum + piece.width, 0);
  const rows = [];
  let row = [], used = 0, i = 0;
  for (; i < units.length; i++) {
    const w = unitWidth(units[i]);
    if (row.length && used + 1 + w > width) {
      rows.push(row);
      if (rows.length === max) break;
      row = []; used = 0;
    }
    let col = row.length ? used + 1 : 0;
    for (const piece of units[i]) { if (col < width) row.push({ col, text: piece.text, width: Math.min(piece.width, width - col) }); col += piece.width; }
    used = Math.min(width, col);
  }
  if (i === units.length && row.length) rows.push(row);
  const mark = ascii ? "..." : "\u2026";
  if (i < units.length && rows.length && mark.length <= width) {
    const last = rows[rows.length - 1];
    while (last.length && last.at(-1).col + last.at(-1).width + 1 + mark.length > width) last.pop();
    const end = last.length ? last.at(-1).col + last.at(-1).width + 1 : 0;
    last.push({ col: end, text: lit(mark), width: mark.length });
  }
  return rows;
}

/** Where everything stands for a size: the body under the header, the reason of a deployment
 *  that is not live, the note of the one deployment of a view without headings and the line after
 *  an agent was opened (each wrapped here, since their rows take room from the panes), and the
 *  panes. `notice`, `note` and `outcome` are the model's (lib/model.mjs): the main loop asks for
 *  the layout first, because the model's window is as tall, and the sentences in its list as wide,
 *  as the list pane this gives. The answer's `note` is the note's rows and `outcome` the line's:
 *  its sentence and each text under it (what the viewer printed, what the kernel said) set as a
 *  reason is, on as many rows as a reason may take. */
export function layout(notice, size, { observed = true, note = null, ascii = false, outcome = null } = {}) {
  const body = { top: 3, rows: Math.max(0, size.rows - 5) };
  const wide = size.cols >= WIDE;
  const listCols = wide ? clamp(Math.floor(size.cols * 0.48), 36, 60) : size.cols;
  const across = Math.max(1, size.cols - 2 * MARGIN);
  const reasonRows = clamp(Math.floor(body.rows / 4), 1, REASON_ROWS);
  const reason = notice ? shownLines(notice.reason, across, reasonRows, { ascii }) : [];
  const noted = note ? shownLines(note, across, NOTE_ROWS, { ascii }) : [];
  const after = outcome ? [
    ...partRows(outcome.said, across, reasonRows, { ascii }),
    ...outcome.under.flatMap((text) => shownLines(text, across, reasonRows, { ascii }).map((line) => [{ col: 0, text: line, width: across }])),
  ] : [];
  // The state and its reason, then the note, then the line after an open, stand above the panes,
  // over the whole width; a rule closes them when instances follow.
  const said = (notice ? 1 + reason.length : 0) + noted.length + after.length;
  const above = said ? Math.min(body.rows, said + (observed ? 1 : 0)) : 0;
  return { body, wide, listCols, reason, note: noted, outcome: after, above, panes: { top: body.top + above, rows: Math.max(0, body.rows - above) }, page: Math.max(0, body.rows - above) };
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
 *  first, and a kept filter and the other hints take what is left. The hints stand in the order
 *  given, and when they do not all fit they are given up in an order of their own (`keep`, the
 *  first kept longest), so a hint can stand first and still be given up before another: in the
 *  list of instances `workspaces` goes first, then `refresh`, the key that clears a kept filter,
 *  `detail`, `open` and last `filter` (`filter` before `open` while a filter is kept: its own `/`
 *  stands in the footer then). A row too narrow for the whole of a hint drops it.
 *  `open` stands first while Enter would open the selected agent's terminal, and names the key
 *  that brings the TUI back (tui.json's `open.detachKey`, text from outside); while another
 *  machine is asked first, the key that gives the open up stands in its place. The switcher has
 *  a filter of its own, drawn as the list's. A key's label is the user's (views/help.mjs keyText);
 *  everything is placed by cells. */
function footer(m, cols) {
  const action = (id) => m.actions.find((a) => a.id === id && a.keys.length);
  /** A hint: a key and what it does, the TUI's word or safe text with its width. */
  const made = (key, word) => {
    const said = typeof word === "string" ? { text: lit(word), width: word.length } : word;
    return { key, word: said, width: key.width + 1 + said.width };
  };
  const hint = (id, label) => { const a = action(id); return a ? made(keyText(keyLabel(a.keys[0])), label ?? a.label) : null; };
  const edge = cols - MARGIN; // nothing stands at or past it
  /** A hint's spans at `col`, never past the edge. */
  const put = (h, col, look) => [
    { col, text: h.key.text, width: Math.max(0, Math.min(h.key.width, edge - col)), ...look },
    ...h.word.spans.map((span) => ({ ...span, col: col + h.key.width + 1 + span.col })).map((span) => ({ ...span, width: Math.max(0, Math.min(span.width, edge - span.col)), ...look })),
  ].filter((span) => span.width > 0);
  const span = (hints) => hints.reduce((sum, h) => sum + h.width, 0) + Math.max(0, hints.length - 1) * GAP;
  // A word is drawn as one span, or as the open hint's three: `open (`, the key, `returns)`.
  const spansOf = (h) => ({ ...h, word: { ...h.word, spans: h.word.spans ?? [{ col: 0, text: h.word.text, width: h.word.width }] } });

  if (m.view !== "help" && m.filter.editing) {
    const hints = [made({ text: lit("Enter"), width: "Enter".length }, "keep"), hint("close", "clear")].filter(Boolean).map(spansOf);
    const spans = [{ col: MARGIN, text: lit("/"), style: BOLD, width: 1 }, { col: MARGIN + 1, text: shown(m.filter.query), width: Math.max(0, edge - span(hints) - GAP - MARGIN - 1) }];
    let col = Math.max(MARGIN + 2, edge - span(hints));
    for (const h of hints) { spans.push(...put(h, col, { style: DIM })); col += h.width + GAP; }
    return spans;
  }
  /** The open hint: `Enter open (C-\ returns)`, the detach key drawn as text from outside. */
  const opener = () => {
    const a = action("open");
    if (!a) return null;
    const key = keyText(m.detachKey), lead = "open (", tail = "returns)";
    const spans = [{ col: 0, text: lit(lead), width: lead.length }, { col: lead.length, text: key.text, width: key.width }, { col: lead.length + key.width + 1, text: lit(tail), width: tail.length }];
    return made(keyText(keyLabel(a.keys[0])), { spans, width: lead.length + key.width + 1 + tail.length });
  };
  const listing = m.view !== "help" && m.view !== "switcher";
  // While another machine is asked first, Esc gives the open up, and that is all it does: the
  // hint stands where `open` stood, is kept as long, and `close` is not listed beside it.
  const asking = listing && m.opening?.phase === "preflight";
  const first = asking ? [["open", hint("close", "stop opening")]] : listing && m.openable ? [["open", opener()]] : [];
  const [ids, keep] = m.view === "help" ? [["close"], ["close"]]
    // Esc closes the switcher only onto a view, and there is none before a workspace is opened.
    // A kept filter puts `close` before `refresh`, as in the list: the key that clears it is the hint to keep.
    : m.view === "switcher" ? [["open", "filter", ...(m.filter.query ? ["close", "refresh"] : ["refresh", ...(m.open ? ["close"] : [])])], null]
    : m.focus === "detail" ? [["detail", "close", "refresh"], ["open", "detail", "close", "refresh"]]
    // A kept filter shows its own `/` beside the hints: then `open` outlives the `/ filter` hint.
    : [["filter", "detail", ...(m.filter.query ? ["close"] : []), "refresh", "workspaces"], [...(m.filter.query ? ["open", "filter"] : ["filter", "open"]), "detail", "close", "refresh", "workspaces"]];
  const hints = [...first, ...ids.filter((id) => !(asking && id === "close")).map((id) => [id, hint(id)])].filter(([, h]) => h).map(([id, h]) => [id, spansOf(h)]);
  const last = ["help", "quit"].map((id) => hint(id)).filter(Boolean).map(spansOf);
  const spans = [];
  let col = MARGIN;
  if (m.view !== "help" && m.filter.query) {
    // The kept filter has a place of its own width, so the hints stand where they always do;
    // it gives way, down to nothing, before `help` and `quit` do, and before the hint that
    // stands first while Enter would open an agent (or Esc gives an open up).
    const held = first.length ? first[0][1].width + GAP : 0;
    const slot = Math.min(FILTER_COLS - GAP, edge - MARGIN - span(last) - (last.length ? GAP : 0) - held);
    if (slot >= 2) {
      spans.push({ col, text: lit("/"), style: BOLD, width: 1 }, { col: col + 1, text: shown(m.filter.query), style: BOLD, width: slot - 1 });
      col += slot + GAP;
    }
  }
  // Give up hints until the rest fit: the one kept least first, else (no order of its own) the last.
  let kept = hints;
  const room = () => col + span(kept.map(([, h]) => h)) + (kept.length ? GAP : 0) + span(last) <= edge;
  while (kept.length && !room()) {
    const order = keep ?? kept.map(([id]) => id);
    const least = [...order].reverse().find((id) => kept.some(([k]) => k === id)) ?? kept.at(-1)[0];
    kept = kept.filter(([id]) => id !== least);
  }
  for (const [, h] of kept) { spans.push(...put(h, col)); col += h.width + GAP; }
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
  const g = layout(m.notice, size, { observed: m.observed, note: m.note, ascii: m.ascii, outcome: m.outcome });
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
    const drawn = help(m.actions, { cols, rows: g.body.rows }, { top: m.helpTop, ascii: m.ascii, detachKey: m.detachKey });
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
  for (const spans of g.outcome) said.push(placed(spans, MARGIN));
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
