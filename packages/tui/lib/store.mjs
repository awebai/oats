// The state of `oats tui` and the one function that changes it: reduce(state, event). Pure: no
// IO, no clock, no terminal size. What only the loop can do comes back as an effect, as data.
//
// The state holds what the user chose (which workspace is open, which instance, what is
// collapsed, the filters, where the panes are scrolled) and what the reader gave, exactly as the
// shared rules gave it: each served deployment's entry (deployment-panel.mjs), the roster of other
// machines (remote-roster.mjs `remoteRosterState`) and the memory of what they reported
// (remote-identity-memory.mjs), all through lib/read.mjs. Nothing is added to any of them, nothing
// removed, and nothing here decides what a failed read means or which view a deployment is in.
// Selection is an identity (the shared `instanceId`), never an index, so it survives every read;
// the rows it moves among are the model's, in drawn order.
import { ACTIONS, bindings } from "./actions.mjs";
import { collapseKey, displayLine, instanceId, pendingEntry } from "./client.mjs";
import { disclosure, roster, switcher } from "./model.mjs";
import { windowOf } from "./views/scroll.mjs";

/** The longest filter, in UTF-16 units. */
export const QUERY_LIMIT = 200;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const LINE_END = /\r\n|[\n\r\u2028\u2029]/;
const NO_FILTER = Object.freeze({ editing: false, query: "" });

/** The state before the first answer. `deployment` is the one `oats tui` was started in or was
 *  told of, with its shared pending entry (lib/main.mjs makes it); null for a run started outside
 *  every deployment, which serves none and shows the switcher.
 *  `ctxs`: the served deployments, in the order they were opened. `open`: the id of the deployment
 *  the Instances view was opened on (a path, or `remote:<group id>`), or null. `entries`,
 *  `numbers`: each served deployment's entry and the number of the cycle that gave it. `remote`,
 *  `rosterAt`, `memory`, `notes`, `collecting`: the roster of other machines as the shared rule
 *  left it, the time of the last outcome taken, what the machines reported, and whether a roster
 *  read is in flight. `selected`, `top`, `detailTop` are the open view's; `places` keeps them for
 *  the views left behind, and `collapsed` holds every view's keys (each carries its `open`).
 *  `back`: the view under the help. `offered`: the deployments of `~/Agents` not served. */
export function initialState({ deployment = null, cli, home, entry = null, actions = ACTIONS, ascii = false }) {
  return Object.freeze({
    view: deployment === null ? "switcher" : "instances", back: deployment === null ? "switcher" : "instances",
    ctxs: Object.freeze(deployment === null ? [] : [deployment]), open: deployment,
    entries: new Map(deployment === null ? [] : [[deployment, entry]]), numbers: new Map(),
    remote: Object.freeze({ remoteGroups: Object.freeze([]), rosterAnswered: false, rosterFailure: null }), rosterAt: null,
    memory: new Map(), notes: new Map(), collecting: false, cli, home,
    selected: null, collapsed: new Set(), filter: NO_FILTER, focus: "list", top: 0, detailTop: 0, places: new Map(),
    switcher: Object.freeze({ editing: false, query: "", selected: null, top: 0, line: null, refused: null }),
    offered: Object.freeze({ offered: Object.freeze([]), limited: false }),
    helpTop: 0, actions, ascii,
  });
}

const next = (state, changes) => Object.freeze({ ...state, ...changes });
const indexOf = (r, id) => (id === null ? -1 : r.index.get(id) ?? -1);
/** Whether an item of the list is an instance: the only kind the selection stands on. */
const isRow = (item) => item?.id !== undefined;

/** The list's `top` as the screen shows it for this state in a pane `page` rows tall. */
const settledTop = (state, r, page) => windowOf({ top: state.top, count: r.items.length, height: page, keep: indexOf(r, state.selected) }).top;

/** Select the instance at `index` of the drawn order (an item that is not an instance is passed
 *  over in the direction of travel), and scroll the least that shows it. A new selection starts
 *  its detail at the top. */
function selectAt(state, r, index, page, step = 1) {
  const count = r.items.length;
  if (!r.rows.length) return state;
  let at = Math.min(Math.max(0, index), count - 1);
  while (at >= 0 && at < count && !isRow(r.items[at])) at += step;
  if (at < 0 || at >= count) { at = Math.min(Math.max(0, index), count - 1); while (!isRow(r.items[at])) at -= step; }
  const id = r.items[at].id;
  const top = windowOf({ top: settledTop(state, r, page), count, height: page, keep: at }).top;
  return next(state, { selected: id, top, detailTop: id === state.selected ? state.detailTop : 0 });
}

/** After the rows changed (a read, the filter, a collapse): the selection stays on its instance
 *  while that is still drawn; else it moves to the row now at the same place in the drawn order,
 *  else to the last row, else there is none. With none selected, the first row is.
 *  A filter that matches nothing leaves no row to move to: the selection then stays on its
 *  instance while the view still has it, and is found again when the filter is cleared. */
function rehomed(before, state) {
  const now = roster(state);
  if (state.selected !== null && now.index.has(state.selected)) return state;
  if (state.selected !== null && now.rows.length === 0 && now.instances.some((row) => instanceId(row) === state.selected)) return state;
  const place = state.selected === null ? 0 : Math.max(0, before.rows.findIndex((item) => item.id === state.selected));
  const item = now.rows[Math.min(place, now.rows.length - 1)] ?? null;
  return next(state, { selected: item ? item.id : null, detailTop: 0 });
}

/** The switcher, shown: over whatever view was there. `said`: a line of its own to show. */
const toSwitcher = (state, said = null) => next(state, { view: "switcher", switcher: Object.freeze({ ...state.switcher, editing: false, line: said, refused: null }) });

/** After what the reader gave changed: when no view holds what was open any more (a machine that
 *  is no longer listed), the switcher is shown and says so, and nothing is open. Else the
 *  collapse keys of this view whose instance is gone are forgotten, and the selection finds its
 *  place. */
function settled(state, taken) {
  const now = roster(taken);
  if (taken.open !== null && now.gone) {
    const places = new Map(taken.places); places.delete(taken.open);
    return { state: toSwitcher(next(taken, { open: null, places, selected: null, top: 0, detailTop: 0, focus: "list", filter: NO_FILTER, back: "switcher" }), "gone"), effect: { offer: true } };
  }
  const before = roster(state);
  const mine = `${collapseKey(taken.open, "")}`;
  const present = new Set(now.instances.map((row) => collapseKey(taken.open, instanceId(row))));
  const stillThere = [...taken.collapsed].filter((key) => !key.startsWith(mine) || present.has(key));
  const pruned = stillThere.length === taken.collapsed.size ? taken : next(taken, { collapsed: new Set(stillThere) });
  return { state: rehomed(before, pruned), effect: null };
}

/** A served deployment's entry from the reader, with the number of the cycle that gave it. An
 *  answer for a deployment that is not served, or one that is not newer than the last taken for
 *  it, is dropped. Only an observed entry moves the selection or forgets a collapse: a failed
 *  read has no rows to move to, and the next good one finds the user where they were. */
function took(state, { id, entry, number }) {
  if (!state.ctxs.includes(id) || !(number > (state.numbers.get(id) ?? 0))) return { state, effect: null };
  const taken = next(state, { entries: new Map(state.entries).set(id, entry), numbers: new Map(state.numbers).set(id, number) });
  return entry?.deployment?.status === "observed" ? settled(state, taken) : { state: taken, effect: null };
}

/** The roster of other machines after one outcome, as the shared rule made it (lib/read.mjs),
 *  with the memory of what the machines reported and the time of the outcome. */
function heard(state, { remote, memory, notes, at }) {
  return settled(state, next(state, { remote, memory, notes, rosterAt: at, collecting: false }));
}

/** Open the view of deployment `id`: the place the view left behind is kept, and found again
 *  on the way back (the row, where the list and the detail were scrolled). A filter is not kept. */
function opened(state, id) {
  const shown = next(state, { view: "instances", back: "instances", switcher: Object.freeze({ ...state.switcher, editing: false, query: "", line: null, refused: null }) });
  if (id === state.open) return shown;
  const places = new Map(state.places);
  if (state.open !== null) places.set(state.open, Object.freeze({ selected: state.selected, top: state.top, detailTop: state.detailTop }));
  const place = places.get(id) ?? { selected: null, top: 0, detailTop: 0 };
  return rehomed({ rows: [] }, next(shown, { open: id, places, focus: "list", filter: NO_FILTER, ...place }));
}

/** A picked folder of `~/Agents` that is a deployment (lib/read.mjs made it canonical and asked
 *  the shared rule): it is served from now on, pending until its first read, and opened. */
function admitted(state, { admitted: id, at }) {
  if (state.ctxs.includes(id)) return opened(state, id);
  const joined = next(state, { ctxs: Object.freeze([...state.ctxs, id]), entries: new Map(state.entries).set(id, pendingEntry(null, at)) });
  return opened(joined, id);
}

/** The filter's text changed. */
function queried(state, query) {
  if (query === state.filter.query) return state;
  const before = roster(state);
  return rehomed(before, next(state, { filter: Object.freeze({ ...state.filter, query }), top: 0 }));
}

/** Text for a filter field: the query with it added when the filter stays within its limit and
 *  the display filter shows the text as it is; else the query as it was. A paste is held to that
 *  as it stands. The space KEY is the one text the display filter would change that is still
 *  taken: between words, so never first and never after another space. */
function typed(query, text, { key = false } = {}) {
  const fits = text !== "" && query.length + text.length <= QUERY_LIMIT;
  const shows = key && text === " " ? query !== "" && !query.endsWith(" ") : displayLine(text) === text;
  return fits && shows ? query + text : query;
}

/** The two filter fields, each as what the keys of an open field need: its text, and the state
 *  with another text or with the field closed on one. */
const FIELDS = Object.freeze({
  instances: Object.freeze({
    query: (state) => state.filter.query,
    put: (state, query) => queried(state, query),
    close: (state, query) => next(queried(state, query), { filter: Object.freeze({ editing: false, query }) }),
  }),
  switcher: Object.freeze({
    query: (state) => state.switcher.query,
    put: (state, query) => (query === state.switcher.query ? state : next(state, { switcher: Object.freeze({ ...state.switcher, query, top: 0 }) })),
    close: (state, query) => next(state, { switcher: Object.freeze({ ...state.switcher, query, editing: false, top: 0 }) }),
  }),
});
/** The filter field that is open now, or null. */
const fieldOf = (state) => (state.view === "instances" && state.filter.editing ? FIELDS.instances : state.view === "switcher" && state.switcher.editing ? FIELDS.switcher : null);

/** A key while a filter field is open. A key that is text is text, whatever the action table
 *  says, so `q` and `j` can be typed; Backspace removes one grapheme, Enter keeps the filter and
 *  the close key clears it. The three keys that are not about the view keep their actions. */
function edited(state, field, event, action) {
  const query = field.query(state);
  if (typeof event.text === "string") return { state: field.put(state, typed(query, event.text, { key: true })), effect: null };
  if (event.key === "backspace") {
    const graphemes = [...GRAPHEMES.segment(query)].map((g) => g.segment);
    return { state: field.put(state, graphemes.slice(0, -1).join("")), effect: null };
  }
  if (event.key === "enter") return { state: field.close(state, query.trim()), effect: null };
  if (action === "close") return { state: field.close(state, ""), effect: null };
  if (action === "quit" || action === "suspend" || action === "redraw") return { state, effect: action };
  return { state, effect: null };
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

/** A key in the switcher. The selection moves among the choices (a heading is passed over);
 *  the open key opens the view of a workspace here, and asks the loop to admit a folder. */
function switched(state, action, page) {
  const stay = { state, effect: null };
  const s = switcher(state), sw = state.switcher;
  const put = (changes) => next(state, { switcher: Object.freeze({ ...sw, ...changes }) });
  switch (action) {
    case "filter": return { state: put({ editing: true }), effect: null };
    case "close":
      if (sw.query !== "") return { state: put({ query: "", top: 0 }), effect: null };
      // Back to the view it was opened over; with nothing open there is none.
      return state.open === null ? stay : { state: next(put({ line: null, refused: null }), { view: "instances", back: "instances" }), effect: null };
    case "instances": return state.open === null ? stay : { state: next(put({ line: null, refused: null }), { view: "instances", back: "instances" }), effect: null };
    case "up": case "down": case "top": case "bottom": case "page-up": case "page-down": {
      if (!s.keys.length) return stay;
      const from = Math.max(0, s.keys.indexOf(s.selected));
      const key = s.keys[Math.min(Math.max(0, moved(action, from, s.keys.length, page)), s.keys.length - 1)];
      const at = s.items.findIndex((item) => item.key === key);
      // The headings above the first choice come into the pane with it.
      const top = windowOf({ top: key === s.keys[0] ? 0 : windowOf({ top: sw.top, count: s.items.length, height: page }).top, count: s.items.length, height: page, keep: at }).top;
      return { state: put({ selected: key, top }), effect: null };
    }
    case "open-workspace": {
      const item = s.items.find((each) => each.key !== undefined && each.key === s.selected);
      if (!item) return stay;
      if (item.path !== undefined) return { state: put({ refused: null }), effect: { admit: item.path } };
      return item.primary === null ? stay : { state: opened(state, item.primary), effect: { refresh: { live: true } } };
    }
    default: return stay;
  }
}

/** (state, event) -> { state, effect }.
 *  An event is a key, `{ key, text?, page, extent, room, cols }` (`key` a key id, `text` the
 *  grapheme a text key typed; `page` the rows of the list pane and `cols` its width, and `extent`
 *  and `room` the rows the other scrolling pane holds and shows, as the last frame drew them: the
 *  store keeps no size); a paste, `{ paste: <text> }`; or what the loop read:
 *  `{ id, entry, number }` (a served deployment's entry), `{ roster: { remote, memory, notes, at } }`
 *  (one outcome of the roster read), `{ collecting }`, `{ offered: { offered, limited } }` (the
 *  deployments of `~/Agents` not served), `{ admitted: <deployment>, at }` and `{ refused: <path> }`
 *  (what a picked folder turned out to be).
 *  An effect is something only the loop can do: "quit", "suspend", "redraw", or an object with
 *  any of `refresh: { live }` (read now), `offer: true` (list `~/Agents` again) and
 *  `admit: <path>` (ask whether a picked folder is a deployment); or null. */
export function reduce(state, event, keymap = bindings(state.actions)) {
  const stay = { state, effect: null };
  if (event.entry !== undefined) return took(state, event);
  if (event.roster !== undefined) return heard(state, event.roster);
  if (event.collecting !== undefined) return { state: event.collecting === state.collecting ? state : next(state, { collecting: event.collecting === true }), effect: null };
  if (event.offered !== undefined) return { state: next(state, { offered: Object.freeze({ offered: Object.freeze([...event.offered.offered]), limited: event.offered.limited === true }) }), effect: null };
  if (event.admitted !== undefined) return { state: admitted(state, event), effect: { refresh: { live: true } } };
  if (event.refused !== undefined) return { state: next(state, { switcher: Object.freeze({ ...state.switcher, refused: event.refused }) }), effect: null };
  const field = fieldOf(state);
  // A paste goes only into an open filter field: its first line. Anywhere else it is dropped whole.
  if ("paste" in event) return field && typeof event.paste === "string" ? { state: field.put(state, typed(field.query(state), event.paste.split(LINE_END)[0])), effect: null } : stay;
  if (typeof event.key !== "string") return stay;
  const action = keymap.get(event.key);
  if (field) return edited(state, field, event, action);
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
    // In the switcher the folders of ~/Agents are listed again too.
    case "refresh": return { state, effect: { refresh: { live: true }, ...((state.view === "help" ? state.back : state.view) === "switcher" ? { offer: true } : {}) } };
    case "help": return { state: next(state, state.view === "help" ? { view: state.back } : { view: "help", back: state.view, helpTop: 0 }), effect: null };
    case "workspaces": return state.view === "switcher" ? stay : { state: toSwitcher(next(state, { back: "switcher" })), effect: { offer: true } };
    default:
  }
  if (state.view === "help") {
    if (action === "close") return { state: next(state, { view: state.back }), effect: null };
    if (action === "instances") return state.open === null ? stay : { state: next(state, { view: "instances", back: "instances" }), effect: null };
    return MOVES.includes(action) ? { state: next(state, { helpTop: scrolled(state.helpTop) }), effect: null } : stay;
  }
  if (state.view === "switcher") return switched(state, action, page);

  if (action === "close") {
    // In this order: a kept filter, the detail.
    if (state.filter.query !== "") return { state: queried(state, ""), effect: null };
    return state.focus === "detail" ? { state: next(state, { focus: "list" }), effect: null } : stay;
  }
  const r = roster(state, undefined, Number.isInteger(event.cols) ? event.cols : undefined);
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
      const item = r.items[at], fold = disclosure(state, r, item), key = collapseKey(state.open, item.id);
      const settledState = next(state, { top: settledTop(state, r, page) });
      if (!r.filtering && fold === (action === "collapse" ? "open" : "closed")) {
        const collapsed = new Set(state.collapsed);
        if (action === "collapse") collapsed.add(key); else collapsed.delete(key);
        return { state: rehomed(r, next(settledState, { collapsed })), effect: null };
      }
      // Nothing to fold or unfold: collapse goes to the parent, the nearest row above that is one
      // level less deep; expand to the first child, the next row when it is one level deeper.
      // Both are read from the drawn order, which is the shared grouping's, and neither leaves
      // the run of rows the instance stands in (a gap or a heading ends it).
      if (action === "collapse") {
        for (let i = at - 1; i >= 0 && isRow(r.items[i]); i--) if (r.items[i].depth === item.depth - 1) return { state: selectAt(state, r, i, page), effect: null };
        return stay;
      }
      const below = r.items[at + 1];
      return isRow(below) && below.depth === item.depth + 1 ? { state: selectAt(state, r, at + 1, page), effect: null } : stay;
    }
    default: return stay;
  }
}
