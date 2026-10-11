// The state of `oats tui` and the one function that changes it: reduce(state, event). Pure: no
// IO, no clock, no terminal size. What only the loop can do comes back as an effect, as data.
//
// The state holds what the user chose (which instance, what is collapsed, the filter, where the
// panes are scrolled) and the deployment's entry exactly as the shared rule gave it
// (deployment-panel.mjs, through lib/read.mjs): nothing is added to an entry, nothing removed, and
// nothing here decides what a failed read means. Selection is an identity (the shared
// `instanceId`), never an index, so it survives every read; the rows it moves among are the
// model's, in drawn order.
import { ACTIONS, bindings } from "./actions.mjs";
import { collapseKey, displayLine, instanceId } from "./client.mjs";
import { disclosure, roster } from "./model.mjs";
import { windowOf } from "./views/scroll.mjs";

/** The longest filter, in UTF-16 units. */
export const QUERY_LIMIT = 200;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const LINE_END = /\r\n|[\n\r\u2028\u2029]/;

/** The state before the first answer. `entry` is the shared pending entry (lib/read.mjs makes it). */
export function initialState({ deployment, cli, home, entry, actions = ACTIONS, ascii = false }) {
  return Object.freeze({
    view: "instances", deployment, cli, home, entry, number: 0,
    selected: null, collapsed: new Set(), filter: Object.freeze({ editing: false, query: "" }),
    focus: "list", top: 0, detailTop: 0, helpTop: 0, actions, ascii,
  });
}

const next = (state, changes) => Object.freeze({ ...state, ...changes });
const indexOf = (r, id) => (id === null ? -1 : r.index.get(id) ?? -1);

/** The list's `top` as the screen shows it for this state in a pane `page` rows tall. */
const settledTop = (state, r, page) => windowOf({ top: state.top, count: r.items.length, height: page, keep: indexOf(r, state.selected) }).top;

/** Select the row at `index` of the drawn order (an empty item is skipped in the direction of
 *  travel), and scroll the least that shows it. A new selection starts its detail at the top. */
function selectAt(state, r, index, page, step = 1) {
  const count = r.items.length;
  if (!count) return state;
  let at = Math.min(Math.max(0, index), count - 1);
  while (at >= 0 && at < count && r.items[at] === null) at += step;
  if (at < 0 || at >= count) { at = Math.min(Math.max(0, index), count - 1); while (r.items[at] === null) at -= step; }
  const id = r.items[at].id;
  const top = windowOf({ top: settledTop(state, r, page), count, height: page, keep: at }).top;
  return next(state, { selected: id, top, detailTop: id === state.selected ? state.detailTop : 0 });
}

/** After the rows changed (a read, the filter, a collapse): the selection stays on its instance
 *  while that is still drawn; else it moves to the row now at the same place in the drawn order,
 *  else to the last row, else there is none. With none selected, the first row is.
 *  A filter that matches nothing leaves no row to move to: the selection then stays on its
 *  instance while the deployment still has it, and is found again when the filter is cleared. */
function rehomed(before, state) {
  const now = roster(state);
  if (state.selected !== null && now.index.has(state.selected)) return state;
  if (state.selected !== null && now.rows.length === 0 && now.instances.some((row) => instanceId(row) === state.selected)) return state;
  const place = state.selected === null ? 0 : Math.max(0, before.rows.findIndex((item) => item.id === state.selected));
  const item = now.rows[Math.min(place, now.rows.length - 1)] ?? null;
  return next(state, { selected: item ? item.id : null, detailTop: 0 });
}

/** A deployment's entry from the reader, with the number of the cycle that gave it. An answer
 *  that is not newer than the last one taken is dropped. Only an observed entry moves the
 *  selection or forgets a collapse: a failed read has no rows to move to, and the next good one
 *  finds the user where they were. */
function took(state, { entry, number }) {
  if (!(number > state.number)) return state;
  const taken = next(state, { entry, number });
  if (entry?.deployment?.status !== "observed") return taken;
  const before = roster(state);
  const present = new Set(roster(taken).instances.map((row) => collapseKey(state.deployment, instanceId(row))));
  const stillThere = [...state.collapsed].filter((key) => present.has(key));
  const pruned = stillThere.length === state.collapsed.size ? taken : next(taken, { collapsed: new Set(stillThere) });
  return rehomed(before, pruned);
}

/** The filter's text changed. */
function queried(state, query) {
  if (query === state.filter.query) return state;
  const before = roster(state);
  return rehomed(before, next(state, { filter: Object.freeze({ ...state.filter, query }), top: 0 }));
}

/** Text for the filter field: added when the filter stays within its limit and the display
 *  filter shows the text as it is; else nothing is added. A paste is held to that as it stands.
 *  The space KEY is the one text the display filter would change that is still taken: between
 *  words, so never first and never after another space. */
function typed(state, text, { key = false } = {}) {
  const query = state.filter.query;
  const fits = text !== "" && query.length + text.length <= QUERY_LIMIT;
  const shows = key && text === " " ? query !== "" && !query.endsWith(" ") : displayLine(text) === text;
  return fits && shows ? queried(state, query + text) : state;
}

/** A key while the filter field is open. A key that is text is text, whatever the action table
 *  says, so `q` and `j` can be typed; Backspace removes one grapheme, Enter keeps the filter and
 *  the close key clears it. The three keys that are not about the view keep their actions. */
function edited(state, event, action) {
  const stay = { state, effect: null };
  if (typeof event.text === "string") return { state: typed(state, event.text, { key: true }), effect: null };
  if (event.key === "backspace") {
    const graphemes = [...GRAPHEMES.segment(state.filter.query)].map((g) => g.segment);
    return { state: queried(state, graphemes.slice(0, -1).join("")), effect: null };
  }
  const closed = (query) => next(queried(state, query), { filter: Object.freeze({ editing: false, query }) });
  if (event.key === "enter") return { state: closed(state.filter.query.trim()), effect: null };
  if (action === "close") return { state: closed(""), effect: null };
  if (action === "quit" || action === "suspend" || action === "redraw") return { state, effect: action };
  return stay;
}

const MOVES = Object.freeze(["up", "down", "top", "bottom", "page-up", "page-down"]);
/** Where a movement key takes a position `from` among `count` rows, a page being `page` rows. */
function moved(action, from, count, page) {
  const step = Math.max(1, page - 1);
  switch (action) {
    case "up": return from - 1;
    case "down": return from + 1;
    case "top": return 0;
    case "bottom": return count - 1;
    case "page-up": return from - step;
    default: return from + step;
  }
}

/** (state, event) -> { state, effect }.
 *  An event is a key, `{ key, text?, page, extent, room }` (`key` a key id, `text` the grapheme a
 *  text key typed; `page` the rows of the list pane, and `extent` and `room` the rows the other
 *  scrolling pane holds and shows, as the last frame drew them: the store keeps no size); a paste,
 *  `{ paste: <text> }`; or an answer of the reader, `{ entry, number }`.
 *  An effect is something only the loop can do: "quit", "suspend", "redraw",
 *  `{ refresh: { live } }`, or null. */
export function reduce(state, event, keymap = bindings(state.actions)) {
  const stay = { state, effect: null };
  if (event.entry !== undefined) return { state: took(state, event), effect: null };
  const editing = state.view === "instances" && state.filter.editing;
  // A paste goes only into the filter field: its first line. Anywhere else it is dropped whole.
  if ("paste" in event) return editing && typeof event.paste === "string" ? { state: typed(state, event.paste.split(LINE_END)[0]), effect: null } : stay;
  if (typeof event.key !== "string") return stay;
  const action = keymap.get(event.key);
  if (editing) return edited(state, event, action);
  const page = Math.max(1, Number.isInteger(event.page) ? event.page : 1);
  // A pane that scrolls on its own (the help, the detail) moves from where it is DRAWN: the top
  // the state holds may lie past the end since the terminal grew, and the view shows it corrected.
  const scrolled = (top) => {
    const count = event.extent ?? 0, height = event.room ?? 1;
    const from = windowOf({ top, count, height }).top;
    return windowOf({ top: moved(action, from, count, height), count, height }).top;
  };

  switch (action) {
    case "quit": case "suspend": case "redraw": return { state, effect: action };
    case "refresh": return { state, effect: { refresh: { live: true } } };
    case "help": return { state: next(state, state.view === "help" ? { view: "instances" } : { view: "help", helpTop: 0 }), effect: null };
    case "instances": return { state: next(state, { view: "instances" }), effect: null };
    case "close":
      // In this order: the help, a kept filter, the detail.
      if (state.view === "help") return { state: next(state, { view: "instances" }), effect: null };
      if (state.filter.query !== "") return { state: queried(state, ""), effect: null };
      return state.focus === "detail" ? { state: next(state, { focus: "list" }), effect: null } : stay;
    default:
  }
  if (state.view === "help") return MOVES.includes(action) ? { state: next(state, { helpTop: scrolled(state.helpTop) }), effect: null } : stay;

  const r = roster(state);
  const at = indexOf(r, state.selected);
  switch (action) {
    case "filter": return { state: next(state, { focus: "list", filter: Object.freeze({ ...state.filter, editing: true }) }), effect: null };
    case "detail": return at < 0 ? stay : { state: next(state, { focus: state.focus === "detail" ? "list" : "detail" }), effect: null };
    case "up": case "down": case "top": case "bottom": case "page-up": case "page-down": {
      if (state.focus === "detail") return { state: next(state, { detailTop: scrolled(state.detailTop) }), effect: null };
      // With nothing selected, any movement selects the first row.
      const target = at < 0 ? 0 : moved(action, at, r.items.length, page);
      return { state: selectAt(state, r, target, page, target < at ? -1 : 1), effect: null };
    }
    case "collapse": case "expand": {
      if (state.focus !== "list" || at < 0) return stay;
      const item = r.items[at], fold = disclosure(state, r, item), key = collapseKey(state.deployment, item.id);
      const settled = next(state, { top: settledTop(state, r, page) });
      if (!r.filtering && fold === (action === "collapse" ? "open" : "closed")) {
        const collapsed = new Set(state.collapsed);
        if (action === "collapse") collapsed.add(key); else collapsed.delete(key);
        return { state: rehomed(r, next(settled, { collapsed })), effect: null };
      }
      // Nothing to fold or unfold: collapse goes to the parent, the nearest row above that is one
      // level less deep; expand to the first child, the next row when it is one level deeper.
      // Both are read from the drawn order, which is the shared grouping's.
      if (action === "collapse") {
        for (let i = at - 1; i >= 0 && r.items[i] !== null; i--) if (r.items[i].depth === item.depth - 1) return { state: selectAt(state, r, i, page), effect: null };
        return stay;
      }
      const below = r.items[at + 1];
      return below && below.depth === item.depth + 1 ? { state: selectAt(state, r, at + 1, page), effect: null } : stay;
    }
    default: return stay;
  }
}
