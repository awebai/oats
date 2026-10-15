// The frame: (model, size) -> the rows of the whole screen. Pure: no IO, no clock, no escape
// byte. It places the views: the header, the list of instances and the detail beside it (or as a
// page of its own on a narrow terminal), an agent's open terminal in the detail's place (or over
// the whole body, zoomed), the switcher of workspaces over the whole body, the help, and the
// footer. The TUI's own words are lit(); everything else is shown(). Meaning never
// rests on colour alone: what is dim or bold also says what it is in words or by a mark.
import { keyLabel } from "../actions.mjs";
import { lit, shown, shownLines } from "../term/text.mjs";
import { style } from "../term/style.mjs";
import { act } from "./act.mjs";
import { detail } from "./detail.mjs";
import { help, keyText } from "./help.mjs";
import { instances, measured } from "./instances.mjs";
import { switcher } from "./switcher.mjs";

/** The frame is drawn from this size up (docs/tui.md); the design size is 80x24. */
export const MIN_SIZE = Object.freeze({ cols: 60, rows: 15 });
/** From this width up the detail stands beside the list; under it, it is a page of its own. */
export const WIDE = 80;
/** The views, the header's second row: navigation, so no count and no digit stands against a name
 *  (the help and the footer name the digits). The open one is drawn in reverse; the two that
 *  cannot be opened yet are dim, and their key says what to run instead. */
const VIEWS = Object.freeze([Object.freeze({ name: "Instances", open: true }), Object.freeze({ name: "Souls", open: false }), Object.freeze({ name: "Capabilities", open: false })]);
/** The cells between two views' names: each name has one cell on each side of it (the reverse bar
 *  of the open one), and one between. */
const VIEW_GAP = 1;
const GAP = 3;
/** The least width of a terminal beside the list: under it the terminal has the whole body. */
export const PANEL_MIN = 40;
/** The most cells the list keeps beside an open terminal: the agent's screen has the rest. */
export const LIST_BESIDE = 30;
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
const REVERSE = style({ reverse: true });
const FOCUSED = style({ bold: true, reverse: true });

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
 *  reason is, on as many rows as a reason may take. While a terminal is open (`terminal`) the
 *  list keeps LIST_BESIDE cells at most, whether the terminal or the detail stands beside it, so
 *  the agent's screen keeps one size; a name longer than its row is cut there. */
export function layout(notice, size, { observed = true, note = null, ascii = false, outcome = null, terminal = false } = {}) {
  const body = { top: 3, rows: Math.max(0, size.rows - 5) };
  const wide = size.cols >= WIDE;
  const listCols = !wide ? size.cols : terminal ? LIST_BESIDE : clamp(Math.floor(size.cols * 0.48), 36, 60);
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
 *  list of instances the acts go first (`restart`, `start`, `retire`, then `stop`), then the views
 *  (one hint for the three, `1-3 views`), then `workspaces`, `refresh`, the key that clears a
 *  kept filter, `detail`, the open terminal's `close-terminal` and `zoom`, `open` and last `filter`
 *  (`filter` before `open` while a filter is kept: its own `/` stands in the footer then). A row
 *  too narrow for the whole of a hint drops it.
 *  `open` stands first while Enter would open the selected agent's terminal, or (`focus terminal`)
 *  go to the one open on the selected row; while another machine is asked first, the key that
 *  gives the open up stands in its place. With a terminal open, `zoom` and `close-terminal` follow
 *  it; then the acts whose key opens a confirmation for the selected row now (the model's
 *  `actable`). While the terminal has the focus the TUI reads no key but the back key, and the
 *  footer names that alone (tui.json's `open.detachKey`, text from outside). In a confirmation the
 *  buttons are on the screen, and the footer says how to work them: the close key with the close
 *  button's label, the keys that move, Enter, and `quit`. The switcher has a filter of its own,
 *  drawn as the list's. A key's label is the user's (views/help.mjs keyText); everything is placed
 *  by cells. */
function footer(m, cols) {
  const action = (id) => m.actions.find((a) => a.id === id && a.keys.length);
  /** A hint: a key and what it does, the TUI's word or safe text with its width. */
  const made = (key, word) => {
    const said = typeof word === "string" ? { text: lit(word), width: word.length } : word;
    return { key, word: said, width: key.width + 1 + said.width };
  };
  const hint = (id, label) => { const a = action(id); return a ? made(keyText(keyLabel(a.keys[0])), label ?? a.label) : null; };
  /** The hints that are no one action's: made below. */
  const hintOf = {};
  const edge = cols - MARGIN; // nothing stands at or past it
  /** A hint's spans at `col`, never past the edge. */
  const put = (h, col, look) => [
    { col, text: h.key.text, width: Math.max(0, Math.min(h.key.width, edge - col)), ...look },
    ...h.word.spans.map((span) => ({ ...span, col: col + h.key.width + 1 + span.col })).map((span) => ({ ...span, width: Math.max(0, Math.min(span.width, edge - span.col)), ...look })),
  ].filter((span) => span.width > 0);
  const span = (hints) => hints.reduce((sum, h) => sum + h.width, 0) + Math.max(0, hints.length - 1) * GAP;
  // A word is drawn as one span, unless it was made of spans already.
  const spansOf = (h) => ({ ...h, word: { ...h.word, spans: h.word.spans ?? [{ col: 0, text: h.word.text, width: h.word.width }] } });

  // While what is typed goes to the agent the TUI takes one key, the back key, and the footer
  // names it alone (tui.json's open.detachKey, text from outside), in every such frame: before
  // anything else the footer could show.
  const listing = m.view !== "help" && m.view !== "switcher";
  if (listing && m.terminal?.focus === "terminal") {
    const key = keyText(m.detachKey), word = "back to the list";
    return [{ col: MARGIN, text: key.text, width: Math.max(0, Math.min(key.width, edge - MARGIN)) },
      { col: MARGIN + key.width + 1, text: lit(word), width: Math.max(0, Math.min(word.length, edge - MARGIN - key.width - 1)) }].filter((s) => s.width > 0);
  }
  if (m.view !== "help" && m.filter.editing) {
    const hints = [made({ text: lit("Enter"), width: "Enter".length }, "keep"), hint("close", "clear")].filter(Boolean).map(spansOf);
    const spans = [{ col: MARGIN, text: lit("/"), style: BOLD, width: 1 }, { col: MARGIN + 1, text: shown(m.filter.query), width: Math.max(0, edge - span(hints) - GAP - MARGIN - 1) }];
    let col = Math.max(MARGIN + 2, edge - span(hints));
    for (const h of hints) { spans.push(...put(h, col, { style: DIM })); col += h.width + GAP; }
    return spans;
  }
  if (m.view === "act" && m.act) {
    // The confirmation: its buttons are the offers, on the screen; the footer says how to work them.
    const close = action("close"), shut = m.act.buttons.find((button) => button.id === "close");
    const hints = [
      ...(close && shut ? [made(keyText(keyLabel(close.keys[0])), shut.label)] : []),
      ...(m.act.buttons.length > 1 ? [made({ text: lit("Left/Right"), width: "Left/Right".length }, "move")] : []),
      made({ text: lit("Enter"), width: "Enter".length }, "press"),
    ].map(spansOf);
    const quit = hint("quit");
    const all = [...hints, ...(quit ? [spansOf(quit)] : [])];
    const spans = [];
    let col = MARGIN;
    for (const h of all) { if (col + h.width > edge) break; spans.push(...put(h, col)); col += h.width + GAP; }
    return spans;
  }
  // While another machine is asked first, Esc gives the open up, and that is all it does: the
  // hint stands where `open` stood, is kept as long, and `close` is not listed beside it.
  const asking = listing && m.opening?.phase === "preflight";
  // An action with no key (tui.json may unbind one) has no hint: nothing stands first then. On the
  // row whose terminal is open, Enter goes to it.
  const first = (asking ? [["open", hint("close", "stop opening")]] : listing && m.onTerminal ? [["open", hint("open", "focus terminal")]] : listing && m.openable ? [["open", hint("open")]] : []).filter(([, h]) => h);
  // With a terminal open, the keys that zoom it and close it stand after `open`, kept as long.
  const terminal = listing && m.terminal ? [["zoom", hint("zoom")], ["close-terminal", hint("close-terminal")]].filter(([, h]) => h) : [];
  // The acts the selected row offers now stand after those, and are the first given up.
  const acts = listing && !asking ? (m.actable ?? []).map((verb) => [verb, hint(verb)]).filter(([, h]) => h) : [];
  const ACTS = ["stop", "retire", "start", "restart"];
  // The three views are one hint, `views`, named by their keys: `1-3` while they are the digits
  // in order, else each key (tui.json may rebind one), and a view with no key left out. The
  // header shows which views there are; the help names each key.
  const viewKeys = ["instances", "souls", "capabilities"].map((id) => action(id)).filter(Boolean).map((a) => keyLabel(a.keys[0]));
  const views = viewKeys.length === 0 ? null : made(keyText(viewKeys.join("") === "123" ? "1-3" : viewKeys.join("/")), "views");
  hintOf.views = views;
  const VIEW_KEYS = ["views"];
  const [ids, keep] = m.view === "help" ? [["close"], ["close"]]
    // Esc closes the switcher only onto a view, and there is none before a workspace is opened.
    // A kept filter puts `close` before `refresh`, as in the list: the key that clears it is the hint to keep.
    : m.view === "switcher" ? [["open", "filter", ...(m.filter.query ? ["close", "refresh"] : ["refresh", ...(m.open ? ["close"] : [])])], null]
    : m.focus === "detail" ? [["detail", "close", "refresh"], ["open", "zoom", "close-terminal", "detail", "close", "refresh", ...ACTS]]
    // A kept filter shows its own `/` beside the hints: then `open` outlives the `/ filter` hint.
    : [["filter", "detail", ...(m.filter.query ? ["close"] : []), "refresh", "workspaces", ...VIEW_KEYS], [...(m.filter.query ? ["open", "zoom", "close-terminal", "filter"] : ["filter", "open", "zoom", "close-terminal"]), "detail", "close", "refresh", "workspaces", ...VIEW_KEYS, ...ACTS]];
  const hints = [...first, ...terminal, ...acts, ...ids.filter((id) => !(asking && id === "close")).map((id) => [id, id in hintOf ? hintOf[id] : hint(id)])].filter(([, h]) => h).map(([id, h]) => [id, spansOf(h)]);
  const last = ["help", "quit"].map((id) => hint(id)).filter(Boolean).map(spansOf);
  const spans = [];
  let col = MARGIN;
  if (m.view !== "help" && m.filter.query) {
    // The kept filter has a place of its own width, so the hints stand where they always do;
    // it gives way, down to nothing, before `help` and `quit` do, and before the hint that
    // stands first while Enter would open an agent (or Esc gives an open up).
    // The room of that first hint is kept only when it fits beside `help` and `quit`: a hint that
    // cannot stand takes no room from the filter.
    const firstFits = first.length > 0 && col + first[0][1].width + GAP + span(last) <= edge;
    const held = firstFits ? first[0][1].width + GAP : 0;
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
  const g = layout(m.notice, size, { observed: m.observed, note: m.note, ascii: m.ascii, outcome: m.outcome, terminal: Boolean(m.terminal) });
  const { cols } = size;
  // The switcher is no view of the three: while it is shown, or is under the help, none is current.
  const listing = m.under === "switcher";

  const counts = countSpans(m.counts, cols);
  const nameCol = MARGIN + "oats".length + 2;
  rows[0] = [{ col: MARGIN, text: lit("oats"), style: BOLD }, ...nameSpans(m, nameCol, counts.start - 2 - nameCol), ...counts.spans];
  let col = MARGIN;
  for (const view of VIEWS) {
    // The Instances view is the open one but while the switcher is shown: then none is.
    const look = !view.open ? DIM : listing ? null : REVERSE;
    if (look === REVERSE) rows[1].push({ col, width: view.name.length + 2, style: REVERSE });
    rows[1].push({ col: col + 1, text: lit(view.name), ...(look ? { style: look } : {}), width: view.name.length });
    col += view.name.length + 2 + VIEW_GAP;
  }
  if (m.readAt) { const read = `read ${m.readAt}`; rows[1].push({ col: cols - MARGIN - read.length, text: lit(read), style: DIM, width: read.length }); }
  rows[size.rows - 1] = footer(m, cols);

  if (m.view === "act" && m.act) {
    rows[2] = rule(cols, m.ascii);
    rows[size.rows - 2] = rule(cols, m.ascii);
    const drawn = act(m, { cols, rows: g.body.rows });
    drawn.rows.forEach((spans, i) => { rows[g.body.top + i] = spans; });
    return { rows, page: Math.max(1, g.page), extent: drawn.extent, room: drawn.room };
  }
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
  const area = terminalAt(m, size, g);
  const zoomed = area !== null && area.whole;
  const paged = !zoomed && !g.wide && m.focus === "detail" && m.detail;
  // Two panes only over an observed deployment, or beside an open terminal: with no instance and
  // no terminal there is nothing to put beside the list.
  const split = !zoomed && g.wide && g.panes.rows > 0 && (m.observed || area !== null);
  const joint = split ? { col: g.listCols } : null;
  // The rule that opens the panes: the one under the header, or the one under the reason and the note.
  const opening = m.observed && g.above > 0 ? g.panes.top - 1 : 2;
  rows[2] = rule(cols, m.ascii, opening === 2 ? joint : null);
  if (opening !== 2 && opening < size.rows - 2) rows[opening] = rule(cols, m.ascii, joint);
  rows[size.rows - 2] = rule(cols, m.ascii, joint && { ...joint, up: true });

  const pane = { cols: g.wide ? g.listCols : cols, rows: g.panes.rows };
  let extent = 0;
  if (!paged && !zoomed) instances(m, pane).forEach((spans, i) => { rows[g.panes.top + i] = spans; });
  const bar = split ? [{ col: g.listCols, text: lit(m.ascii ? "|" : "│"), style: DIM, width: 1 }] : [];
  if (area !== null) {
    for (let i = 0; i < g.panes.rows; i++) rows[g.panes.top + i] = [...rows[g.panes.top + i], ...bar];
    terminalRows(m, area).forEach((spans, i) => { rows[area.title + i] = [...rows[area.title + i], ...spans]; });
  } else if (split || paged) {
    const at = paged ? MARGIN : g.listCols + 2;
    const drawn = detail(m, { cols: Math.max(0, cols - at - MARGIN), rows: g.panes.rows });
    extent = drawn.extent;
    drawn.rows.forEach((spans, i) => { rows[g.panes.top + i] = [...rows[g.panes.top + i], ...bar, ...placed(spans, at)]; });
  }
  // The agent's cursor, where the agent has it, while what is typed goes to the agent.
  const agent = area !== null && m.terminal.focus === "terminal" ? m.screen?.cursor : null;
  const cursor = agent?.visible && agent.y < area.rows && agent.x < area.cols ? { row: area.top + agent.y, col: area.col + agent.x } : null;
  return { rows, page: Math.max(1, g.page), extent, room: Math.max(1, g.panes.rows), terminal: area, cursor };
}

/** Where the open terminal stands for a model and a size, or null while it is not shown (no
 *  terminal; another view over the body; the detail in its place; the list's focus on a terminal
 *  too narrow for it beside the list). `{ title, top, col, cols, rows, whole }`: `title` is the row
 *  that names the agent, and the agent's screen is `rows` rows of `cols` cells from (`top`, `col`)
 *  (the size the panel gives the viewer). With the terminal's focus it has the whole body when it is
 *  zoomed, under WIDE columns, and when the side beside the list would be under PANEL_MIN cells
 *  (`whole`); else it stands beside the list, edge to edge, in the detail's place. */
export function terminalArea(m, size) {
  if (tooSmall(size)) return null;
  return terminalAt(m, size, layout(m.notice, size, { observed: m.observed, note: m.note, ascii: m.ascii, outcome: m.outcome, terminal: Boolean(m.terminal) }));
}
function terminalAt(m, size, g) {
  const t = m.terminal;
  if (!t || m.view !== "instances" || m.under === "switcher" || g.panes.rows < 2) return null;
  const side = size.cols - g.listCols - 1;
  const narrow = !g.wide || side < PANEL_MIN;
  const whole = t.focus === "terminal" && (t.zoom || narrow);
  // From the list's focus it stands beside the list, unless the detail stands there or there is no room.
  if (t.focus !== "terminal" && (m.focus === "detail" || narrow)) return null;
  const col = whole ? 0 : g.listCols + 1;
  return { title: g.panes.top, top: g.panes.top + 1, col, cols: whole ? size.cols : side, rows: g.panes.rows - 1, whole };
}

/** The open terminal's rows from its title row: the agent's name (and its machine, when it is
 *  another's), in reverse while what is typed goes to it, then the agent's screen as the last
 *  capture made it (lib/panel.mjs, term/capture.mjs: spans of the agent's own text and styles), each
 *  row placed at the terminal's first column and kept inside its cells. */
function terminalRows(m, area) {
  const t = m.terminal, focused = t.focus === "terminal";
  const name = measured(t.name), title = [];
  if (focused) title.push({ col: area.col, width: Math.min(area.cols, name.width + 2), style: FOCUSED });
  title.push({ col: area.col + 1, text: name.text, style: focused ? FOCUSED : BOLD, width: Math.max(0, Math.min(name.width, area.cols - 2)) });
  if (t.routed && t.machine !== null) {
    const where = measured(t.machine), at = area.col + name.width + 3;
    if (at + ON.length + 1 < area.col + area.cols) title.push({ col: at, text: lit(ON), style: DIM, width: ON.length }, { col: at + ON.length + 1, text: where.text, style: DIM, width: Math.max(0, area.col + area.cols - (at + ON.length + 1)) });
  }
  const lines = m.screen?.lines ?? [];
  const body = Array.from({ length: area.rows }, (_, r) => (lines[r] ?? [])
    .filter((span) => span.col < area.cols)
    .map((span) => ({ ...span, col: area.col + span.col, width: Math.min(span.width ?? area.cols, area.cols - span.col) })));
  return [title, ...body];
}
