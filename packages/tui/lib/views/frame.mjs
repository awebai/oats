// The frame: (model, size) -> the rows of the whole screen. Pure: no IO, no clock, no escape
// byte. The screen is two things (docs/tui.md, "What it shows"): the sidebar on the left and the
// main area on the right, a rule between them over the whole height. The sidebar holds, from the
// top, the workspace's name, what stood above the panes (a deployment's state and reason, the
// note of a one-deployment view, the line after an open), the three views as an accordion (the
// open one's heading and its list: the instances, the souls or the capabilities) and the cheat
// sheet of the keys that apply now, the leader first. The main area holds the detail, or the open
// terminal (zoomed, over the whole screen), or an overlay: the switcher of workspaces, the
// palette, the spawn prompt, the help or a confirmation. Under WIDE columns the sidebar has the
// whole width, and the detail and every overlay are a page over the whole screen. There is no
// header and no footer. The TUI's own words are lit(); everything else is shown(). Meaning never
// rests on colour alone: what is dim or bold also says what it is in words or by a mark.
import { LEADER, backKeyLabel, keyLabel } from "../actions.mjs";
import { lit, ownEllipsis, shown, shownLines, textOf } from "../term/text.mjs";
import { style } from "../term/style.mjs";
import { act } from "./act.mjs";
import { detail } from "./detail.mjs";
import { help, keyText } from "./help.mjs";
import { instances, measured } from "./instances.mjs";
import { textWidth } from "../term/width.mjs";
import { palette } from "./palette.mjs";
import { soulDetail, soulsList, soulsListed } from "./souls.mjs";
import { capabilitiesList, capabilitiesListed, capabilityDetail } from "./capabilities.mjs";
import { spawn } from "./spawn.mjs";
import { splitFits, splitRegions } from "./split.mjs";
import { switcher } from "./switcher.mjs";

/** The frame is drawn from this size up (docs/tui.md); the design size is 80x24. */
export const MIN_SIZE = Object.freeze({ cols: 60, rows: 15 });
/** From this width up the main area stands beside the sidebar; under it, the sidebar has the whole
 *  width and the detail and the overlays are a page of their own. */
export const WIDE = 80;
/** The views, the sidebar's accordion, in this order: each a row with its key dim at the right,
 *  the open one's in bold with its list under it. */
const VIEWS = Object.freeze([Object.freeze({ id: "instances", name: "Instances" }), Object.freeze({ id: "souls", name: "Souls" }), Object.freeze({ id: "capabilities", name: "Capabilities" })]);
const GAP = 3;
/** The least width of a terminal beside the sidebar: under it the terminal has the whole screen. */
export const PANEL_MIN = 40;
/** The most cells the sidebar keeps beside an open terminal: the agent's screen has the rest. */
export const LIST_BESIDE = 30;
/** One cell of margin on each side of the sidebar's rows. */
const MARGIN = 1;
/** The longest run one lit() holds with room to spare: the display filter bounds a line, and a
 *  terminal can be wider than that bound. */
const RUN = 500;
/** The rows a reason may take in the sidebar: a quarter of the screen, at least one, at most this. */
const REASON_ROWS = 4;
/** The rows a deployment's note may take in the sidebar. */
const NOTE_ROWS = 2;
/** The fewest rows the open view's list keeps: what stands above it gives way first. */
const LIST_LEAST = 3;
/** The TUI's word before the soul a kept filter of the instances is by. */
const SOUL_WORD = "soul";
/** What the title says in the workspace's place while the switcher is shown. */
const WORKSPACES = "workspaces";
/** The TUI's word before the one machine of a view that holds no deployment of this machine. */
const ON = "on";
/** The cells the workspace's name keeps (all of them, when it is shorter) before the title says
 *  how many other machines it is on: under that the name comes first. */
const NAME_MIN = 8;

const BOLD = style({ bold: true });
const DIM = style({ dim: true });
const FOCUSED = style({ bold: true, reverse: true });

const clamp = (n, low, high) => Math.min(Math.max(n, low), high);
const tooSmall = (size) => size.cols < MIN_SIZE.cols || size.rows < MIN_SIZE.rows;
/** The leader's label, spelt for people (`Alt+O`, `Ctrl+\`): tui.json's open.detachKey is the
 *  user's, so it is text from outside. */
const leaderText = (m) => keyText(backKeyLabel(m.detachKey));

/** One row saying so, with the size found and the size needed. Short, and the sizes early: on a
 *  terminal this small the screen clips the end of the row. */
function tooSmallRows(size) {
  const rows = Array.from({ length: size.rows }, () => []);
  if (size.rows > 0) rows[0] = [{ col: 0, text: lit(`Terminal too small: ${size.cols}x${size.rows}, oats tui needs ${MIN_SIZE.cols}x${MIN_SIZE.rows}.`) }];
  return rows;
}

/** A horizontal rule `cols` cells wide from column 0: the sidebar's, between its parts. */
function rule(cols, ascii) {
  const spans = [], dash = ascii ? "-" : "─";
  for (let col = 0; col < cols; col += RUN) spans.push({ col, text: lit(dash.repeat(Math.min(RUN, cols - col))), style: DIM });
  return spans;
}

/** A sentence made of parts (lib/model.mjs OPEN_WORDS): the TUI's own words (`{ own }`) and text
 *  from outside (`{ shown }`, a name), each made safe on its own, so no word of the TUI's is ever
 *  filtered with a name and no name is ever taken for the TUI's. Set on at most `max` rows of at
 *  most `width` cells, broken at the spaces of the TUI's words but for those of a `{ own, whole }`
 *  part (a command: cut in two, it cannot be typed); a name or a whole part and what is written
 *  against it (a full stop) are never broken apart, and one wider than a row is cut there. Answers rows
 *  of spans from column 0; when more was left, the last row ends in the cut mark. */
export function partRows(parts, width, max, { ascii = false } = {}) {
  if (width < 1 || max < 1) return [];
  // Units: what is written together, a space between two.
  const units = [];
  let glue = false;
  const put = (piece) => { if (glue && units.length) units.at(-1).push(piece); else units.push([piece]); glue = true; };
  for (const part of parts) {
    if (part.own !== undefined && part.whole) { const own = ownEllipsis(part.own, ascii); put({ text: lit(own), width: own.length }); }
    else if (part.own !== undefined) ownEllipsis(part.own, ascii).split(" ").forEach((word, i) => { if (i > 0) glue = false; if (word) put({ text: lit(word), width: word.length }); });
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

/** The open view of the accordion for a model: the view under the help or a confirmation, none
 *  while the switcher is shown. A model made by hand that names none is the Instances view's. */
function openOf(m) {
  const under = m.under ?? m.view;
  if (under === "switcher") return null;
  return VIEWS.some((view) => view.id === under) ? under : "instances";
}

/** Where everything stands for a size (docs/tui.md, "What it shows"): the sidebar's width
 *  (`listCols`), and in it what stands under the title: the reason of a deployment that is not
 *  live, the note of the one deployment of a view without headings and the line after an agent was
 *  opened, each wrapped to the sidebar's width here, since their rows are taken from the list's.
 *  `notice`, `note` and `outcome` are the model's (lib/model.mjs): the main loop asks for the
 *  layout first, because the model's window is as tall (`page`), and the sentences in its list as
 *  wide, as this gives. The answer's `note` is the note's rows and `outcome` the line's: its
 *  sentence and each text under it (what the viewer printed, what the kernel said) set as a reason
 *  is, on as many rows as a reason may take; `above` is how many of those rows stand. `open` is the
 *  accordion's open view (null while the switcher is shown): the title, the three views' rows and
 *  the rules between the sidebar's parts take what they need, what stands above gives way to keep
 *  the list LIST_LEAST rows and the leader's, and `room` is what is left for the empty row under
 *  the title, the open view's list and the cheat sheet. `page` is the list's rows when it has to
 *  scroll (room less the leader's row): the model windows the list in it, and the frame gives the
 *  rows the list does not need to the cheat sheet. `body` is an overlay's rows: the whole height.
 *  While a terminal is open (`terminal`) the sidebar keeps LIST_BESIDE cells at most, whether the
 *  terminal or the detail stands beside it, so the agent's screen keeps one size; a name longer
 *  than its row is cut there. */
export function layout(notice, size, { note = null, ascii = false, outcome = null, terminal = false, open = "instances" } = {}) {
  const wide = size.cols >= WIDE;
  const listCols = !wide ? size.cols : terminal ? LIST_BESIDE : clamp(Math.floor(size.cols * 0.48), 36, 60);
  const across = Math.max(1, listCols - 2 * MARGIN);
  const reasonRows = clamp(Math.floor(size.rows / 4), 1, REASON_ROWS);
  const reason = notice ? shownLines(notice.reason, across, reasonRows, { ascii }) : [];
  const noted = note ? shownLines(note, across, NOTE_ROWS, { ascii }) : [];
  const after = outcome ? [
    ...partRows(outcome.said, across, reasonRows, { ascii }),
    ...outcome.under.flatMap((text) => shownLines(text, across, reasonRows, { ascii }).map((line) => [{ col: 0, text: line, width: across }])),
  ] : [];
  // The title, a row per view, and the rules: one before the cheat sheet, one between the open
  // view's list and the views after it, and one between the views before it and its heading.
  const at = VIEWS.findIndex((view) => view.id === open);
  const rules = 1 + (at < 0 ? 0 : (at > 0 ? 1 : 0) + (at < VIEWS.length - 1 ? 1 : 0));
  const fixed = 1 + VIEWS.length + rules;
  const said = (notice ? 1 + reason.length : 0) + noted.length + after.length;
  const above = Math.min(said, Math.max(0, size.rows - fixed - 1 - LIST_LEAST));
  const room = Math.max(0, size.rows - fixed - above);
  return { wide, listCols, reason, note: noted, outcome: after, above, open: at < 0 ? null : open, room, page: Math.max(1, room - 1), body: size.rows };
}
/** The layout the frame draws a model by. */
const layoutOf = (m, size, given = {}) => layout(m.notice, size, { note: m.note, ascii: m.ascii, outcome: m.outcome, terminal: panelOpen(m), open: openOf(m), ...given });

/** The title, from `col` on in `room` cells: the workspace's name and, when the view
 *  holds other machines, what says so, in the TUI's words and dim:
 *    `+N machine(s)`  beside a deployment of this machine;
 *    `on <machine>`   the one machine of a view that holds no deployment of this machine (no
 *                     heading names it there);
 *    `N machines`     two or more of them and no deployment of this machine.
 *  Whether a deployment is this machine's is the shared entries' word (the model's `here`), and
 *  the machine's name is theirs. What stands after the name gives way before the name is cut
 *  short of NAME_MIN cells, and a machine's name is cut before the workspace's. While the
 *  switcher is shown no workspace is named: the title says what is listed instead. */
function nameSpans(m, col, room) {
  if (room <= 0) return [];
  if (m.under === "switcher") return [{ col, text: lit(WORKSPACES), width: room }];
  const name = measured(m.workspace), alone = [{ col, text: name.text, width: room }];
  if (!(m.machines > 0)) return alone;
  const least = Math.min(name.width, NAME_MIN);
  // Two cells between the name and what follows it.
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

/** The title, the sidebar's first row: the workspace's name in bold and what the view holds of
 *  other machines (nameSpans), or `workspaces` while the switcher is shown. */
function titleRow(m, cols) {
  return nameSpans(m, MARGIN, cols - 2 * MARGIN).map((span) => (span.style ? span : { ...span, style: BOLD }));
}

/** What stands under the title, wrapped by layout(): the state of a deployment that is not live
 *  and, on rows of its own, the reason, which is the shared home's sentence or the kernel's
 *  (nothing of the TUI's stands on a reason's row); then the note of the one deployment of a view
 *  without headings, the shared home's sentence too; then the line after an open. */
function sayings(m, g) {
  const cols = g.listCols, said = [];
  if (m.notice) {
    const since = m.notice.since ? `since ${m.notice.since}` : null;
    said.push([{ col: MARGIN, text: shown(m.notice.text), style: BOLD, width: Math.max(0, cols - 2 * MARGIN - (since ? since.length + 2 : 0)) }, ...(since ? [{ col: cols - MARGIN - since.length, text: lit(since), style: DIM, width: since.length }] : [])]);
    for (const line of g.reason) said.push([{ col: MARGIN, text: line, width: cols - 2 * MARGIN }]);
  }
  for (const line of g.note) said.push([{ col: MARGIN, text: line, width: cols - 2 * MARGIN }]);
  for (const spans of g.outcome) said.push(placed(spans, MARGIN));
  return said.slice(0, g.above);
}

/** The filter of view `id` as its heading draws it, while that view is shown: the field while it
 *  is typed, else a filter kept by its text, or in the list of instances by a soul (the Souls
 *  view's `i`). Null for a view not shown, or with nothing to say. */
function filterOf(m, id) {
  if (m.view !== id) return null;
  const filter = id === "souls" ? m.souls?.filter : id === "capabilities" ? m.capabilities?.filter : m.filter;
  if (!filter) return null;
  const soul = id === "instances" && filter.soul && !filter.query ? filter.soul : null;
  if (filter.editing) return { editing: true, query: filter.query ?? "", soul: null };
  return filter.query || soul !== null ? { editing: false, query: filter.query ?? "", soul } : null;
}

/** A view's row of the accordion, `cols` wide: its name (bold while it is the open one) and its
 *  key dim at the right, the first the user's table gives its action (none while it has none).
 *  On the open view's row the filter: while it is typed the row is the field, `/` and what is
 *  typed; a kept one is named after the view's name, `/text` or `soul <name>`, cut first. */
function viewRow(m, view, cols, open) {
  const action = (m.actions ?? []).find((a) => a.id === view.id && a.keys.length);
  const key = action ? keyText(keyLabel(action.keys[0])) : null;
  const edge = cols - MARGIN, keyCol = key ? Math.max(MARGIN, edge - key.width) : edge;
  const end = key ? keyCol - 1 : edge;
  const field = open ? filterOf(m, view.id) : null;
  const spans = [];
  if (field?.editing) spans.push({ col: MARGIN, text: lit("/"), style: BOLD, width: Math.min(1, end - MARGIN) }, { col: MARGIN + 1, text: shown(field.query), width: Math.max(0, end - MARGIN - 1) });
  else {
    spans.push({ col: MARGIN, text: lit(view.name), ...(open ? { style: BOLD } : {}), width: Math.max(0, Math.min(view.name.length, end - MARGIN)) });
    const at = MARGIN + view.name.length + 2, room = end - at;
    if (field?.soul && room >= SOUL_WORD.length + 2) spans.push({ col: at, text: lit(SOUL_WORD), style: BOLD, width: SOUL_WORD.length }, { col: at + SOUL_WORD.length + 1, text: shown(field.soul.name), style: BOLD, width: room - SOUL_WORD.length - 1 });
    else if (field && !field.soul && room >= 2) spans.push({ col: at, text: lit("/"), style: BOLD, width: 1 }, { col: at + 1, text: shown(field.query), style: BOLD, width: room - 1 });
  }
  if (key) spans.push({ col: keyCol, text: key.text, style: DIM, width: Math.max(0, Math.min(key.width, edge - keyCol)) });
  return spans.filter((span) => span.width > 0);
}

/** A hint of the cheat sheet: `id` (an action's, or the hint's own), the key (`{ text, width }`:
 *  a key's label is the user's once tui.json names it, views/help.mjs keyText) and what it does
 *  (the TUI's word, or `{ spans, width }` made of parts). */
const made = (id, key, word) => ({ id, key, word: typeof word === "string" ? { spans: [{ col: 0, text: lit(word), width: word.length }], width: word.length } : word });
/** A hint of keys that are no action's (a key name the TUI writes, like `Enter`). */
const own = (id, keys, word) => made(id, { text: lit(keys), width: keys.length }, word);
/** `types <the leader>`: what the leader pressed twice does while a terminal has the focus. */
function types(m) {
  const key = leaderText(m);
  return { spans: [{ col: 0, text: lit("types"), width: 5 }, { col: 6, text: key.text, width: key.width }], width: 6 + key.width };
}

/** THE CHEAT SHEET (docs/tui.md, "The cheat sheet"): the keys that apply now, one per row, the
 *  leader first in every focus (`Alt+O commands`), then the palette, `help` and `quit` last. While
 *  the leader waits for its key it is the leader's hint (leaderHints). While what is typed goes to
 *  the agent the TUI reads the leader only: the leader then Esc gives the list the focus, and the
 *  leader twice types the leader into the terminal. In the palette, the spawn prompt (spawnHints),
 *  a confirmation, the filter field, the help and the switcher, how to work them: the keys they
 *  read are their own, so they are the TUI's words, but for the confirmation's close key and the
 *  field's clear, which are the user's. Else it is small: a view's list or its detail names what
 *  Enter does now, and the rest stays the leader's hint's, the palette's and the help's. In the list
 *  of instances Enter is `open` while it would open the selected agent's terminal and `focus
 *  terminal` on the row whose terminal is open; while another machine is asked first, the key that
 *  gives the open up (`stop opening`) stands in its place. In the Souls view Enter is the detail
 *  from the list and the soul's instances from the detail; in the Capabilities view the detail,
 *  and from it the marked soul. With the detail's focus the key that goes back to the list
 *  (`Tab back`) comes before it, and `spawn` after it where it spawns (the list of instances, the
 *  Souls view of a workspace of this machine). An action with no key (tui.json may unbind one) has
 *  no hint. The views have no hint: the accordion names their keys. When rows are short the sheet
 *  gives up rows from its end (keptHints), down to the leader alone. */
function cheatSheet(m) {
  const action = (id) => (m.actions ?? []).find((a) => a.id === id && a.keys.length);
  const hint = (id, label) => { const a = action(id); return a ? made(id, keyText(keyLabel(a.keys[0])), label ?? a.label) : null; };
  if (m.leader) return leaderHints(m);
  const led = (list) => [made("leader", leaderText(m), "commands"), ...list.filter(Boolean)];
  const soul = m.view === "souls" && m.souls ? m.souls : null;
  const capability = m.view === "capabilities" && m.capabilities ? m.capabilities : null;
  const filter = soul ? soul.filter : capability ? capability.filter : m.filter;
  // The list of instances, or a confirmation over it.
  const listing = !["help", "switcher", "souls", "capabilities"].includes(m.view);
  if (listing && m.terminal?.focus === "terminal" && !m.palette && !m.spawn) {
    const label = backKeyLabel(m.detachKey), list = keyLabel(LEADER.find((entry) => entry.does === "list").keys[0]);
    return led([made("list", keyText(`${label} ${list}`), "the list"), made("again", keyText(`${label} ${label}`), types(m))]);
  }
  if (m.palette) return led([own("run", "Enter", "run"), own("move", "Up/Down", "move"), own("close", "Esc", "close")]);
  if (m.spawn) return led(spawnHints(m.spawn, m.ascii));
  if (m.view !== "help" && filter?.editing) return led([own("keep", "Enter", "keep"), hint("close", "clear")]);
  if (m.view === "act" && m.act) {
    // The confirmation: its buttons are the offers, in the main area; the sheet says how to work them.
    const close = action("close"), shut = m.act.buttons.find((button) => button.id === "close");
    return led([close && shut ? made("close", keyText(keyLabel(close.keys[0])), shut.label) : null, m.act.buttons.length > 1 ? own("move", "Left/Right", "move") : null, own("press", "Enter", "press"), hint("quit")]);
  }
  // The help and the switcher cover the main area: their keys are how to work them.
  if (m.view === "help") return led([hint("palette"), hint("close"), hint("help"), hint("quit")]);
  // Esc closes the switcher only onto a view, and there is none before a workspace is opened.
  if (m.view === "switcher") return led([hint("palette"), ...["open", "filter", ...(m.filter?.query ? ["close", "refresh"] : ["refresh", ...(m.open ? ["close"] : [])])].map((id) => hint(id)), hint("help"), hint("quit")]);
  // A view's list or its detail: a small sheet; the rest is the leader's, the palette's and the help's.
  const asking = listing && m.opening?.phase === "preflight";
  const enter = asking ? [hint("close", "stop opening")] : listing && m.onTerminal ? [hint("open", "focus terminal")] : listing && m.openable ? [hint("open")]
    : soul?.detail ? [hint("open", soul.focus === "detail" ? "instances" : "detail")]
    : capability?.detail ? (capability.focus !== "detail" ? [hint("open", "detail")] : capability.mark >= 0 ? [hint("open", "soul")] : []) : [];
  const detailed = soul ? soul.focus === "detail" && Boolean(soul.detail) : capability ? capability.focus === "detail" && Boolean(capability.detail) : listing && m.focus === "detail";
  const spawns = listing || (soul && soul.local !== false);
  return led([hint("palette"), ...(detailed ? [hint("detail", "back")] : []), ...enter, ...(spawns ? [hint("spawn")] : []), hint("help"), hint("quit")]);
}

/** The spawn prompt's hints (docs/tui.md, "Spawning an agent"): the keys the prompt reads are its
 *  own, as the palette's are, so they are the TUI's words. The picker: Enter picks, Up/Down move,
 *  Esc closes. The preview: Enter and what it does at the focus (the model's `enter`; none while
 *  Enter does nothing), Tab and Shift+Tab move the focus, Esc goes back. */
function spawnHints(s, ascii) {
  return s.step === "picker" ? [own("pick", "Enter", "pick"), own("move", "Up/Down", "move"), own("close", "Esc", "close")]
    : [...(s.enter ? [own("enter", "Enter", ownEllipsis(s.enter, ascii))] : []), own("next", "Tab", "next"), own("back", "Shift+Tab", "back"), own("esc", "Esc", "back")];
}

/** The leader's hint (docs/tui.md, "The leader"): the leader's key, then what each key after it
 *  does, from actions.mjs LEADER, the views, the instances and the acts each one hint. The keys
 *  that need a terminal are named only while one is open, the tabs' only with two or more, and the
 *  split's only where they apply; while what is typed goes to the agent, the leader again, which
 *  types it there. The last, the list's, is never given up. */
function leaderHints(m) {
  const by = (does) => LEADER.find((entry) => entry.does === does);
  const one = (does) => { const entry = by(does); return own(does, keyLabel(entry.keys[0]), entry.label); };
  const keysOf = (list) => list.map((does) => keyLabel(by(does).keys[0])).join("/");
  const views = keysOf(["instances", "souls", "capabilities"]);
  const typing = m.terminal?.focus === "terminal" && m.view === "instances" && !m.palette && !m.spawn;
  return [
    made("leader", leaderText(m), "then"),
    own("palette", keyLabel(by("palette").keys[0]), "palette"),
    own("views", views === "1/2/3" ? "1-3" : views, "views"),
    own("instance", keysOf(["previous", "next"]), "instance"),
    ...(m.terminal ? [one("zoom"), one("close-terminal")] : []),
    // With two tabs or more, the keys that move between them.
    ...((m.tabs?.length ?? 0) > 1 ? [own("tabs", keysOf(["tab-previous", "tab-next"]), "tab")] : []),
    // The split's (docs/tui.md, "Splits"): to split while there is one group; with two, the next
    // group, and the move of the shown tab, or the close of the focused group while it is empty.
    ...(m.panelOpen && !m.split ? [own("split", keysOf(["split-right", "split-down"]), "split")] : []),
    ...(m.split ? [one("group-next"), ...(m.terminal ? [one("tab-move")] : [one("group-close")])] : []),
    own("acts", keysOf(["stop", "restart", "start", "retire"]), "acts"),
    one("filter"), one("workspaces"), one("help"),
    ...(typing ? [made("again", leaderText(m), types(m))] : []),
    one("list"),
  ];
}

/** The hints that stand in `count` rows: given up from the end, down to the leader alone; the
 *  leader's hint keeps its last, the list's, while it has two rows. */
function keptHints(m, hints, count) {
  if (count >= hints.length) return hints;
  if (m.leader && count >= 2) return [...hints.slice(0, count - 1), hints.at(-1)];
  return hints.slice(0, Math.max(1, count));
}

/** The cheat sheet's rows, `cols` wide: each hint's key in bold from the margin, and what it does
 *  in a column of its own after the widest key; a word is cut at the edge. */
function cheatRows(hints, cols) {
  const edge = cols - MARGIN;
  const widest = hints.reduce((most, h) => Math.max(most, h.key.width), 0);
  const wordCol = Math.min(MARGIN + widest + GAP, Math.max(MARGIN + 1, edge - 6));
  return hints.map((h) => [
    { col: MARGIN, text: h.key.text, style: BOLD, width: Math.max(0, Math.min(h.key.width, wordCol - 1 - MARGIN)) },
    ...h.word.spans.map((span) => ({ ...span, col: wordCol + span.col, width: Math.max(0, Math.min(span.width, edge - wordCol - span.col)) })),
  ].filter((span) => span.width > 0));
}

/** An overlay's or a detail page's first row on a narrow terminal, where it has the whole screen:
 *  its essential keys (the cheat sheet's, but for the leader, the palette, help and quit) at the
 *  right, dim, as many as fit after what the row holds, given up from the end. With `first`, the
 *  first key always stands (a detail page's way back): what the row holds is cut to leave it room. */
function withKeys(given, hints, cols, { skip = ["leader", "palette", "help", "quit"], last = false, first = false } = {}) {
  const keys = hints.filter((h) => !skip.includes(h.id));
  const widthOf = (list) => list.reduce((sum, h) => sum + h.key.width + 1 + h.word.width, 0) + Math.max(0, list.length - 1) * GAP;
  const limit = first && keys.length ? cols - MARGIN - widthOf(keys.slice(0, 1)) - GAP : Infinity;
  const row = limit === Infinity ? given : given.filter((span) => span.text === undefined || span.col < limit)
    .map((span) => (span.text === undefined ? span : { ...span, width: Math.min(span.width ?? textWidth(textOf(span.text)), limit - span.col) }));
  // What the row holds ends where its text does: a span may be given more cells than its text takes.
  const end = row.reduce((most, span) => (span.text !== undefined ? Math.max(most, span.col + Math.min(span.width ?? Infinity, textWidth(textOf(span.text)))) : most), 0);
  let kept = keys;
  // Given up from the end; with `last`, the last is kept as long as one other is (the leader's `Esc`).
  while (kept.length && end + GAP + widthOf(kept) > cols - MARGIN) kept = last && kept.length > 1 ? [...kept.slice(0, -2), kept.at(-1)] : kept.slice(0, -1);
  const spans = [];
  let col = cols - MARGIN - widthOf(kept);
  for (const h of kept) {
    spans.push({ col, text: h.key.text, style: DIM, width: h.key.width }, ...h.word.spans.map((span) => ({ ...span, col: col + h.key.width + 1 + span.col, style: DIM })));
    col += h.key.width + 1 + h.word.width + GAP;
  }
  return [...row, ...spans];
}

/** The rows of the open view's list in the sidebar, `page` rows of the sidebar's width (none while
 *  the switcher is shown). */
function listOf(m, g) {
  const size = { cols: g.listCols, rows: g.page };
  if (g.open === "instances") return instances(m, size);
  if (g.open === "souls") return m.souls ? soulsList(m, size) : [];
  if (g.open === "capabilities") return m.capabilities ? capabilitiesList(m, size) : [];
  return [];
}

/** The sidebar (docs/tui.md, "What it shows") in `rows`, from column 0 in the sidebar's width:
 *  the title; what stands under it (sayings); an empty row; the views, the open one's heading
 *  with its list (`list`, trailing empty rows left out) under it and a rule between the views
 *  before it and its heading, and between its list and the views after it; a rule, then the
 *  cheat sheet. It flows from the top. The list keeps its rows ahead of the cheat sheet: when both
 *  do not fit, the sheet gives up rows from its end down to the leader alone, then the empty row
 *  goes, and the list scrolls in what is left (layout's `page`). */
function sidebar(m, g, rows, list) {
  const cols = g.listCols;
  let r = 0;
  const put = (spans) => { if (r < rows.length) rows[r] = spans; r += 1; };
  put(titleRow(m, cols));
  sayings(m, g).forEach(put);
  let n = list.length;
  while (n > 0 && list[n - 1].length === 0) n -= 1;
  const hints = cheatSheet(m), room = g.room;
  const [empty, count, shownRows] = n + 1 + hints.length <= room ? [1, hints.length, n] : n + 2 <= room ? [1, room - 1 - n, n] : [0, 1, Math.min(n, room - 1)];
  r += empty;
  const at = VIEWS.findIndex((view) => view.id === g.open);
  VIEWS.forEach((view, i) => {
    if (i === at && i > 0) put(rule(cols, m.ascii));
    put(viewRow(m, view, cols, i === at));
    if (i !== at) return;
    list.slice(0, shownRows).forEach(put);
    if (i < VIEWS.length - 1) put(rule(cols, m.ascii));
  });
  put(rule(cols, m.ascii));
  cheatRows(keptHints(m, hints, count), cols).forEach(put);
}

/** The rule between the sidebar and the main area, over the whole height. */
function barred(m, rows, col) {
  for (let i = 0; i < rows.length; i++) rows[i] = [...rows[i], { col, text: lit(m.ascii ? "|" : "│"), style: DIM, width: 1 }];
}

/** The help's top row: the time of the read of this machine that the screen shows, which moves with
 *  every read, and how many rows the kernel reported that were withheld (a home outside its soul's
 *  directory, or one reported twice), when any were. */
function readRow(m) {
  const withheld = (m.counts ?? []).find((count) => count.word === "withheld")?.n ?? 0;
  // Each its own span, two cells apart: one text of the TUI's never holds two spaces in a row.
  const parts = [m.readAt ? `read ${m.readAt}` : null, withheld > 0 ? `${withheld} withheld` : null].filter(Boolean);
  let col = 2;
  return parts.map((part) => { const span = { col, text: lit(part), style: DIM, width: part.length }; col += part.length + 2; return span; });
}

/** The switcher's filter field, on a row of its own above its list while it is typed or kept: `/`
 *  and the text, bold once kept. */
function switcherField(m, cols) {
  const f = m.filter;
  return [{ col: 2, text: lit("/"), style: BOLD, width: 1 }, { col: 3, text: shown(f.query ?? ""), ...(f.editing ? {} : { style: BOLD }), width: Math.max(0, cols - 3 - MARGIN) }];
}
/** Whether the switcher shows its filter field. */
export const switcherFieldShown = (filter) => Boolean(filter?.editing) || Boolean(filter?.query);

/** Shift a pane's rows to its place on the screen. */
const placed = (spans, col) => spans.map((span) => ({ ...span, col: span.col + col }));

/** The frame for model `m` at `size`: `{ rows, page, extent, room, cursor, regions }`. `page` is
 *  the rows the list pane scrolls by (an overlay's, for the palette, the spawn prompt and the
 *  switcher); `extent` and `room` are how many rows the other scrolling pane (the help, else the
 *  detail) holds and shows. The main loop hands the three back with the next key, so the store
 *  scrolls by what is on the screen without holding a size. `regions`, for the loop
 *  (lib/main.mjs fitPanel), is each group of the panel this frame draws, empty when it draws none
 *  (another view, an overlay, a screen too small). */
export function frame(m, size) {
  const made = framed(m, size);
  return made.regions ? made : { ...made, regions: [] };
}
function framed(m, size) {
  if (tooSmall(size)) return { rows: tooSmallRows(size), page: 1, extent: 0, room: 1 };
  const rows = Array.from({ length: size.rows }, () => []);
  const g = layoutOf(m, size);
  const { cols } = size;
  // The main area: beside the sidebar from WIDE columns, a cell of margin on each side; under it
  // an overlay has the whole screen.
  const main = g.wide ? { col: g.listCols + 2, cols: Math.max(0, cols - g.listCols - 2 - MARGIN) } : { col: 0, cols };
  /** An overlay in the main area, the sidebar beside it; on a narrow terminal over the whole
   *  screen, its first row carrying its keys (withKeys). */
  const overlay = (drawn) => {
    if (g.wide) { sidebar(m, g, rows, listOf(m, g)); barred(m, rows, g.listCols); }
    drawn.forEach((spans, i) => { if (i < size.rows) rows[i] = [...rows[i], ...placed(spans, main.col)]; });
    if (!g.wide) rows[0] = withKeys(rows[0], cheatSheet(m), cols);
  };

  // The palette, whatever is under it.
  if (m.palette) {
    const drawn = palette(m, { cols: main.cols, rows: size.rows });
    overlay(drawn.rows);
    return { rows, page: Math.max(1, size.rows), extent: 0, room: 1, cursor: { row: 0, col: main.col + drawn.cursor } };
  }
  // The spawn prompt in the same place (the palette wins if both are ever set). `extent` and `room`
  // are its preview's, which the store scrolls as it scrolls a confirmation; `drawnTop` the
  // row its window was drawn from, which the loop gives the store once the frame is written; `armed` says the ready
  // Spawn button is drawn, which the loop tells the store once the frame is written.
  if (m.spawn) {
    const drawn = spawn(m, { cols: main.cols, rows: size.rows });
    overlay(drawn.rows);
    return { rows, page: Math.max(1, size.rows), extent: drawn.extent, room: drawn.room, ...(drawn.top !== undefined ? { drawnTop: drawn.top } : {}), cursor: drawn.cursor ? { row: drawn.cursor.row, col: main.col + drawn.cursor.col } : null, ...(drawn.armed ? { armed: true } : {}) };
  }
  if (m.view === "act" && m.act) {
    const drawn = act(m, { cols: main.cols, rows: size.rows });
    overlay(drawn.rows);
    return { rows, page: Math.max(1, g.page), extent: drawn.extent, room: drawn.room };
  }
  // The help, under its top row (readRow).
  if (m.view === "help") {
    const drawn = help(m.actions, { cols: main.cols, rows: size.rows - 1 }, { top: m.helpTop, ascii: m.ascii, detachKey: m.detachKey });
    overlay([readRow(m), ...drawn.rows]);
    return { rows, page: Math.max(1, g.page), extent: drawn.extent, room: Math.max(1, size.rows - 1) };
  }
  // The switcher, its filter field above it while it has one. Nothing beside it scrolls on its own.
  if (m.under === "switcher") {
    const field = switcherFieldShown(m.filter);
    const drawn = switcher(m, { cols: main.cols, rows: size.rows - (field ? 1 : 0) });
    overlay([...(field ? [switcherField(m, main.cols)] : []), ...drawn]);
    return { rows, page: Math.max(1, size.rows), extent: 0, room: 1 };
  }
  if (m.view === "souls" && m.souls) {
    const s = m.souls;
    const { extent } = viewFrame(m, size, g, rows, { listed: soulsListed(s), paged: s.focus === "detail" && Boolean(s.detail), draw: soulDetail });
    return { rows, page: Math.max(1, g.page), extent, room: size.rows };
  }
  if (m.view === "capabilities" && m.capabilities) {
    const c = m.capabilities;
    const { extent, top } = viewFrame(m, size, g, rows, { listed: capabilitiesListed(c), paged: c.focus === "detail" && Boolean(c.detail), draw: capabilityDetail });
    return { rows, page: Math.max(1, g.page), extent, room: size.rows, ...(top !== undefined ? { capabilitiesTop: top } : {}) };
  }

  const area = terminalAt(m, size, g);
  const zoomed = area !== null && area.whole;
  const paged = !zoomed && !g.wide && m.focus === "detail" && m.detail;
  if (!zoomed && !paged) { sidebar(m, g, rows, listOf(m, g)); if (g.wide) barred(m, rows, g.listCols); }
  let extent = 0;
  if (area !== null) {
    for (const region of area.regions) regionRows(m, region).forEach((spans, i) => { rows[region.title + i] = [...rows[region.title + i], ...spans]; });
    // The rule between two groups: a column side by side, a row one above the other.
    const p = area.panel, r = area.rule;
    if (r?.col !== undefined) for (let i = 0; i <= p.rows; i++) rows[p.title + i] = [...rows[p.title + i], { col: r.col, text: lit(m.ascii ? "|" : "│"), style: DIM, width: 1 }];
    // Beside the sidebar, the row meets its rule there: a joint (`├`, `+` in ASCII).
    if (r?.row !== undefined) rows[r.row] = [...rows[r.row], ...(!zoomed && p.col === g.listCols + 1 ? [{ col: g.listCols, text: lit(m.ascii ? "+" : "├"), style: DIM, width: 1 }] : []), { col: p.col, text: lit((m.ascii ? "-" : "─").repeat(p.cols)), style: DIM, width: p.cols }];
  } else if (g.wide || paged) {
    const at = paged ? MARGIN : g.listCols + 2;
    const drawn = detail(m, { cols: Math.max(0, cols - at - MARGIN), rows: size.rows });
    extent = drawn.extent;
    drawn.rows.forEach((spans, i) => { rows[i] = [...rows[i], ...placed(spans, at)]; });
    // Over the whole screen, the detail's first row carries its keys, as an overlay's does.
    if (paged) rows[0] = withKeys(rows[0], cheatSheet(m), cols, { first: true });
  }
  // Over the whole screen no cheat sheet is drawn: the terminal's title row, the TUI's own, carries
  // its keys at the right instead (the leader, then Esc for the list), and while the leader waits,
  // the leader's hint, as many as fit, its last (`Esc the list`) kept.
  if (zoomed) rows[area.title] = m.leader ? withKeys(rows[area.title], leaderHints(m), cols, { skip: [], last: true }) : withKeys(rows[area.title], cheatSheet(m), cols, { skip: ["again"] });
  // The focused group's terminal, when it shows one: the agent's cursor, where the agent has it,
  // while what is typed goes to the agent.
  const shownArea = area !== null && area.id !== null && m.terminal ? { title: area.title, top: area.top, col: area.col, cols: area.cols, rows: area.rows, whole: area.whole } : null;
  const agent = shownArea !== null && m.terminal.focus === "terminal" ? m.screen?.cursor : null;
  const cursor = agent?.visible && agent.y < shownArea.rows && agent.x < shownArea.cols ? { row: shownArea.top + agent.y, col: shownArea.col + agent.x } : null;
  // The regions the loop gives the panel (lib/main.mjs): each group drawn, its shown tab's id and
  // its size; and the panel's room as the terminal's focus would give it, for a split's size.
  const regions = area === null ? [] : area.regions.map(({ group, id, focused, cols: c, rows: r }) => ({ group, id, focused, cols: c, rows: r }));
  return { rows, page: Math.max(1, g.page), extent, room: size.rows, terminal: shownArea, cursor, regions };
}

/** The Souls or the Capabilities view: its list in the sidebar, and beside it in the main area the
 *  selected entry's detail (`draw`: views/souls.mjs soulDetail, views/capabilities.mjs
 *  capabilityDetail) once the list stands (`listed`); under WIDE columns the sidebar alone, and
 *  the detail as a page over the whole screen while it has the focus (`paged`), its first row
 *  carrying its keys (withKeys). Answers the detail's `extent` and, for the Capabilities view,
 *  `top`: the row the detail was drawn from, which the loop gives the store once the frame is
 *  written (it keeps the marked soul in sight). */
function viewFrame(m, size, g, rows, { listed, paged, draw }) {
  const { cols } = size;
  if (!g.wide && paged) {
    const drawn = draw(m, { cols: Math.max(0, cols - 2 * MARGIN), rows: size.rows });
    drawn.rows.forEach((spans, i) => { rows[i] = placed(spans, MARGIN); });
    rows[0] = withKeys(rows[0], cheatSheet(m), cols, { first: true });
    return { extent: drawn.extent, top: drawn.top };
  }
  sidebar(m, g, rows, listOf(m, g));
  if (!g.wide) return { extent: 0 };
  barred(m, rows, g.listCols);
  if (!listed) return { extent: 0 };
  const at = g.listCols + 2;
  const drawn = draw(m, { cols: Math.max(0, cols - at - MARGIN), rows: size.rows });
  drawn.rows.forEach((spans, i) => { rows[i] = [...rows[i], ...placed(spans, at)]; });
  return { extent: drawn.extent, top: drawn.top };
}

/** Where the open terminal stands for a model and a size, or null while it is not shown (no
 *  terminal; another view or an overlay; the detail in its place; the list's focus on a terminal
 *  too narrow for it beside the sidebar). `{ title, top, col, cols, rows, whole }`, the focused
 *  group's: `title` is the row that names the agent, and the agent's screen is `rows` rows of
 *  `cols` cells from (`top`, `col`) (the size the panel gives the viewer); with `panel` the whole
 *  panel's place, `regions` each group drawn (`group`, `id` its shown tab's or null, `focused`),
 *  and `rule` between two (views/split.mjs). It spans every row. With the terminal's focus it has
 *  the whole screen when it is zoomed, under WIDE columns, and when the side beside the sidebar
 *  would be under PANEL_MIN cells (`whole`); else it stands beside the sidebar, edge to edge, in
 *  the detail's place. */
export function terminalArea(m, size) {
  if (tooSmall(size)) return null;
  return terminalAt(m, size, layoutOf(m, size));
}
/** Where the panel stands as the Instances view gives it with the terminal's focus, whatever this
 *  frame draws (an overlay, another view, the list's focus): `{ panel, focused }`, the panel's
 *  room with its strip row counted (what a split is measured against: lib/store.mjs
 *  splitRefused) and the focused group's screen (`{ cols, rows }`, what a viewer opened now starts
 *  at), or null on a screen too small. */
export function panelPlace(m, size) {
  if (tooSmall(size)) return null;
  const g = layoutOf(m, size, { terminal: true, open: "instances" });
  const area = terminalAt({ ...m, view: "instances", under: "instances", palette: null, spawn: null, panelOpen: true, terminal: { ...(m.terminal ?? {}), focus: "terminal" } }, size, g);
  return { panel: panelRoom(size, g), focused: area === null ? null : { cols: area.cols, rows: area.rows } };
}
/** Whether the panel stands: a tab is open (a model made by hand may name only its terminal). */
const panelOpen = (m) => Boolean(m.panelOpen) || Boolean(m.terminal);
/** The panel's groups, or one made of the terminal for a model that names no groups. */
const groupsIn = (m) => m.groups ?? [{ tabs: m.tabs ?? [], shown: m.terminal?.id ?? null }];
/** The panel's size as the terminal's focus would give it, its strip row counted: what a split
 *  is measured against (lib/store.mjs splitRefused). */
function panelRoom(size, g) {
  const side = size.cols - g.listCols - 1;
  return { cols: !g.wide || side < PANEL_MIN ? size.cols : side, rows: size.rows };
}
function terminalAt(m, size, g) {
  const t = m.terminal;
  if (!panelOpen(m) || m.view !== "instances" || m.under === "switcher" || m.palette || m.spawn || size.rows < 2) return null;
  const focus = t?.focus ?? "list", zoom = Boolean(t?.zoom);
  const side = size.cols - g.listCols - 1;
  const narrow = !g.wide || side < PANEL_MIN;
  const whole = focus === "terminal" && (zoom || narrow);
  // From the list's focus it stands beside the sidebar, unless the detail stands there or there is no room.
  if (focus !== "terminal" && (m.focus === "detail" || narrow)) return null;
  const col = whole ? 0 : g.listCols + 1;
  const panel = { title: 0, top: 1, col, cols: whole ? size.cols : side, rows: size.rows - 1 };
  // Both groups while the panel holds them and nothing is zoomed; else the focused one alone, the
  // other kept (Settled 3 of T3).
  const groups = groupsIn(m), focused = m.group ?? 0;
  const both = Boolean(m.split) && !zoom && groups.length === 2 && splitFits(m.split, { cols: panel.cols, rows: panel.rows + 1 });
  const [first, second, rule] = both ? splitRegions(panel, m.split) : [panel, null, null];
  const regions = (both ? [{ ...first, group: 0 }, { ...second, group: 1 }] : [{ ...panel, group: focused }])
    .map((r) => ({ ...r, id: groups[r.group]?.shown ?? null, focused: r.group === focused, whole }));
  return { ...regions.find((r) => r.focused), panel, regions, rule };
}

/** A hidden tab's mark for output since it was last shown (docs/tui.md, "Tabs"). */
const ACTIVITY = "\u2022";

/** The tab strip (docs/tui.md, "Tabs"), the panel's top row with two tabs or more: each tab in
 *  order as ` name ` (and ` on machine`, dim, for another machine's agent), the shown one bold, in
 *  reverse while what is typed goes to it, a hidden one plain with `•` after its name when its
 *  agent wrote since it was shown. What does not fit is cut in this order: the hidden tabs'
 *  machines, then their names, each to an equal share of what the shown tab leaves with `…`, then
 *  the shown tab's machine, then the hidden tabs farthest from the shown one are left out. The
 *  shown tab's name stays whole while the row can hold it. */
function stripRow(given, area, { focused, ascii }) {
  const mark = ascii ? "*" : ACTIVITY;
  const tabs = given.map((tab) => ({ ...tab, name: measured(tab.name), machine: tab.machine === null ? null : measured(tab.machine), mark: !tab.shown && tab.activity }));
  const machineCells = (tab) => (tab.machine ? 1 + ON.length + 1 + tab.machine.width : 0);
  const cellsOf = (tab, { machine, name = tab.name.width, dropped = false }) => (dropped ? 0 : 1 + name + (tab.mark ? 1 : 0) + (machine ? machineCells(tab) : 0) + 1);
  const total = (plan) => tabs.reduce((sum, tab, i) => sum + cellsOf(tab, plan[i]), 0);
  const plan = tabs.map((tab) => ({ machine: true, name: tab.name.width, dropped: false }));
  const fits = () => total(plan) <= area.cols;
  const shown = tabs.findIndex((tab) => tab.shown);
  // The least a hidden tab is drawn in: a cell of its name (the cut mark), its mark, a cell each side.
  const least = (tab) => 3 + (tab.mark ? 1 : 0);
  // The shown tab's cells are taken first; the hidden ones share the rest equally. Those that do
  // not get even their least are left out, the farthest from the shown tab first.
  const share = () => {
    let left = area.cols - cellsOf(tabs[shown], plan[shown]);
    const near = tabs.map((tab, i) => i).filter((i) => i !== shown).sort((a, b) => Math.abs(a - shown) - Math.abs(b - shown) || a - b);
    const kept = [];
    for (const i of near) { plan[i].dropped = left - least(tabs[i]) < 0; if (!plan[i].dropped) { kept.push(i); left -= least(tabs[i]); } }
    const room = area.cols - cellsOf(tabs[shown], plan[shown]), each = Math.floor(room / Math.max(1, kept.length));
    for (const i of kept) plan[i].name = Math.max(1, Math.min(tabs[i].name.width, each - 2 - (tabs[i].mark ? 1 : 0)));
    while (!fits() && kept.length) plan[kept.pop()].dropped = true;
  };
  if (!fits()) tabs.forEach((tab, i) => { if (i !== shown) plan[i].machine = false; });
  if (!fits()) share();
  if (plan.some((p) => p.dropped) && plan[shown].machine && tabs[shown].machine) { plan[shown].machine = false; plan.forEach((p) => { p.dropped = false; }); share(); }
  const row = [];
  let col = area.col;
  const end = area.col + area.cols;
  tabs.forEach((tab, i) => {
    if (col >= end || plan[i].dropped) return;
    const p = plan[i], width = Math.min(cellsOf(tab, p), end - col);
    const style = tab.shown ? (focused ? FOCUSED : BOLD) : null;
    const name = p.name < tab.name.width ? shownLines(textOf(tab.name.text), p.name, 1, { ascii })[0] ?? lit("") : tab.name.text;
    const nameWidth = Math.min(p.name, textWidth(textOf(name)), end - col - 1);
    // In reverse, as T1's title: the name with a cell on each side; its machine stays dim.
    if (tab.shown && focused) row.push({ col, width: Math.min(nameWidth + 2, end - col), style: FOCUSED });
    if (nameWidth > 0) row.push({ col: col + 1, text: name, width: nameWidth, ...(style ? { style } : {}) });
    let at = col + 1 + nameWidth;
    if (tab.mark && at < end) { row.push({ col: at, text: lit(mark), width: 1 }); at += 1; }
    if (p.machine && tab.machine && at + 1 + ON.length + 1 < end) {
      row.push({ col: at + 1, text: lit(ON), style: DIM, width: ON.length });
      row.push({ col: at + 2 + ON.length, text: tab.machine.text, style: DIM, width: Math.max(0, Math.min(tab.machine.width, end - (at + 2 + ON.length))) });
    }
    col += width;
  });
  return row;
}

/** The open terminal's rows from its title row: the agent's name (and its machine, when it is
 *  another's), in reverse while what is typed goes to it (with two tabs or more, the tab strip:
 *  stripRow), then the shown agent's screen as the last capture made it (lib/panel.mjs,
 *  term/capture.mjs: spans of the agent's own text and styles), each row placed at the terminal's
 *  first column and kept inside its cells. */
/** What an empty group shows (docs/tui.md, "Splits"), under an empty strip row: that Enter on an
 *  agent in the list opens it here, in reverse while it is the focused group, then the leader's
 *  keys for the groups. */
const EMPTY_HINT = "Enter on an agent opens it here";
function emptyRows(m, area) {
  const end = area.col + area.cols, at = area.col + 1;
  const hint = [{ col: at, text: lit(EMPTY_HINT), width: Math.max(0, Math.min(EMPTY_HINT.length, end - at - 1)), ...(area.focused ? { style: FOCUSED } : {}) }];
  const leader = leaderText(m), keys = [];
  let col = at;
  for (const does of ["group-next", "group-close"]) {
    const entry = LEADER.find((each) => each.does === does), key = keyLabel(entry.keys[0]), word = entry.label;
    const after = col + leader.width + 1, at2 = after + key.length + 1;
    if (at2 + word.length > end - 1) break;
    keys.push({ col, text: leader.text, style: BOLD, width: leader.width }, { col: after, text: lit(key), style: BOLD, width: key.length }, { col: at2, text: lit(word), style: DIM, width: word.length });
    col = at2 + word.length + GAP;
  }
  return [[], hint, keys];
}
function regionRows(m, area) {
  const group = groupsIn(m)[area.group] ?? { tabs: [], shown: null };
  if (group.shown === null) return emptyRows(m, area);
  // The focused group's shown tab is in reverse while what is typed goes to it; the other group's
  // is bold, never in reverse, so one terminal at a time reads as focused (T3).
  const focused = area.focused && m.terminal?.focus === "terminal";
  const tab = group.tabs.find((each) => each.shown) ?? { name: m.terminal?.name, machine: m.terminal?.routed ? m.terminal.machine : null };
  const name = measured(tab.name);
  let title = [];
  if (group.tabs.length > 1) title = stripRow(group.tabs, area, { focused, ascii: m.ascii });
  else {
    if (focused) title.push({ col: area.col, width: Math.min(area.cols, name.width + 2), style: FOCUSED });
    title.push({ col: area.col + 1, text: name.text, style: focused ? FOCUSED : BOLD, width: Math.max(0, Math.min(name.width, area.cols - 2)) });
    if (tab.machine) {
      const where = measured(tab.machine), at = area.col + name.width + 3;
      if (at + ON.length + 1 < area.col + area.cols) title.push({ col: at, text: lit(ON), style: DIM, width: ON.length }, { col: at + ON.length + 1, text: where.text, style: DIM, width: Math.max(0, area.col + area.cols - (at + ON.length + 1)) });
    }
  }
  const screenOf = area.focused ? m.screen : m.screens?.get(group.shown) ?? null;
  const lines = screenOf?.lines ?? [];
  const body = Array.from({ length: area.rows }, (_, r) => (lines[r] ?? [])
    .filter((span) => span.col < area.cols)
    .map((span) => ({ ...span, col: area.col + span.col, width: Math.min(span.width ?? area.cols, area.cols - span.col) })));
  return [title, ...body];
}
