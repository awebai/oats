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
import { ACTIONS, LEADER_KEYS, bindings } from "./actions.mjs";
import { collapseKey, displayLine, instanceActs, instanceId, pendingEntry } from "./client.mjs";
import { DETACH_KEY } from "./config.mjs";
import { BUTTON_ORDER, actDecision, disclosure, openDecision, paletteItems, preflightLine, returnedLine, roster, switcher } from "./model.mjs";
import { backKeyId } from "./term/through.mjs";
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
 *  read is in flight. `unread`: per served deployment whose read failed with nothing kept, the
 *  instances it last held (see `took`). `loose`: the list was scrolled away from the selection
 *  on purpose (see `scrolledList`); the switcher has its own.
 *  `selected`, `top`, `detailTop` are the open view's; `places` keeps them for
 *  the views left behind, and `collapsed` holds every view's keys (each carries its `open`).
 *  `back`: the view under the help. `offered`: the deployments of `~/Agents` not served.
 *  `opening`: the agent of another machine whose terminal is being opened, or null:
 *  `{ id, phase: "preflight", name, machine, routed }` while that machine is asked whether its
 *  session is there; `name`, `machine` and `routed` are the row's as it was when Enter was
 *  pressed, for the line after. `terminal`: the open terminal, or null (one at a time):
 *  `{ id, name, machine, routed, focus, zoom, status }`, `id` the row's instanceId and the next
 *  three the row's as it was when it was opened; `focus` "terminal" while what is typed goes to
 *  the agent and "list" while the TUI reads keys; `zoom` true while it has the whole body (only
 *  with the terminal's focus); `status` "starting" until the panel has its window, then "open".
 *  `outcome`: the line after an open (the model's `{ said, under }`), shown above the panes until
 *  the next key bound to an action, or null.
 *  `detachKey`: tui.json's `open.detachKey`, the leader (docs/tui.md, "The leader"), and
 *  `leaderKey` the key id it is read as where the TUI reads keys (term/through.mjs backKeyId).
 *  `leader`: `{ read, waiting }` from the leader's read on, or null (see `leading`).
 *  `palette`: the palette while it is open (see `paletteOpened`), or null. `recent`: the ids of
 *  the instances opened in this run, the latest first.
 *  `act`: the confirmation open in the act view (see `actOpened`), or null; `acted` counts the
 *  confirmations opened in this run, so an answer for one that was closed is told apart.
 *  `starting`: id -> `{ verb, since }` of this run's starts and restarts whose child is still
 *  alive, whether or not the TUI still waits for its answer (the loop says when one is spawned and
 *  when it closes): no act opens on such a row.
 *  `retiring`: the instanceIds of the rows whose retire this run sent and has not read since
 *  (#1247), as lib/main.mjs's tracker says them (`{ retiring }`): they read as retiring. The roster
 *  is made from it (lib/model.mjs MADE_FROM), and from none of `opening`, `terminal`, `outcome`,
 *  `act`, `acted`, `starting`, `leader`, `palette` and `recent`. */
export function initialState({ deployment = null, cli, home, entry = null, actions = ACTIONS, ascii = false, detachKey = DETACH_KEY }) {
  return Object.freeze({
    view: deployment === null ? "switcher" : "instances", back: deployment === null ? "switcher" : "instances",
    ctxs: Object.freeze(deployment === null ? [] : [deployment]), open: deployment,
    entries: new Map(deployment === null ? [] : [[deployment, entry]]), numbers: new Map(),
    remote: Object.freeze({ remoteGroups: Object.freeze([]), rosterAnswered: false, rosterFailure: null }), rosterAt: null,
    memory: new Map(), notes: new Map(), collecting: false, cli, home,
    selected: null, collapsed: new Set(), filter: NO_FILTER, focus: "list", top: 0, loose: false, detailTop: 0, places: new Map(), unread: new Map(),
    switcher: Object.freeze({ editing: false, query: "", selected: null, top: 0, loose: false, line: null, refused: null }),
    offered: Object.freeze({ offered: Object.freeze([]), limited: false }),
    helpTop: 0, actions, ascii, detachKey, opening: null, terminal: null, outcome: null, act: null, acted: 0, starting: new Map(), retiring: new Set(),
    leaderKey: backKeyId(detachKey), leader: null, palette: null, recent: Object.freeze([]),
  });
}

const next = (state, changes) => Object.freeze({ ...state, ...changes });
const indexOf = (r, id) => (id === null ? -1 : r.index.get(id) ?? -1);
/** Whether an item of the list is an instance: the only kind the selection stands on. */
const isRow = (item) => item?.id !== undefined;

/** The list's `top` as the screen shows it for this state in a pane `page` rows tall. The
 *  window holds the selected instance, unless it was scrolled away from it on purpose (`loose`). */
const settledTop = (state, r, page) => windowOf({ top: state.top, count: r.items.length, height: page, keep: state.loose ? -1 : indexOf(r, state.selected) }).top;

/** Select the instance at `index` of the drawn order (an item that is not an instance is passed
 *  over in the direction of travel), and scroll the least that shows it. The first instance
 *  brings what stands above it into the pane (its heading), and the last what stands under it
 *  (a deployment without rows, the roster's failure), as far as the pane holds them beside it.
 *  A new selection starts its detail at the top. */
function selectAt(state, r, index, page, step = 1) {
  const count = r.items.length;
  if (!r.rows.length) return state;
  let at = Math.min(Math.max(0, index), count - 1);
  while (at >= 0 && at < count && !isRow(r.items[at])) at += step;
  if (at < 0 || at >= count) { at = Math.min(Math.max(0, index), count - 1); while (!isRow(r.items[at])) at -= step; }
  const id = r.items[at].id;
  const from = id === r.rows[0].id ? 0 : id === r.rows.at(-1).id ? count : settledTop(state, r, page);
  const top = windowOf({ top: from, count, height: page, keep: at }).top;
  return next(state, { selected: id, top, loose: false, detailTop: id === state.selected ? state.detailTop : 0 });
}

/** A movement key with no instance to go to in its direction (the selection is on the first or
 *  the last one, or the list holds none): the list scrolls instead, by what the key moves, so
 *  whatever stands beyond the instances can always be read, however much of it there is. The
 *  selection stays where it is and may leave the pane (`loose`) until it moves again. */
function scrolledList(state, r, action, page) {
  const count = r.items.length, from = settledTop(state, r, page);
  const top = windowOf({ top: moved(action, from, count, page), count, height: page }).top;
  return top === from ? state : next(state, { top, loose: true });
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
  return next(state, { selected: item ? item.id : null, loose: false, detailTop: 0 });
}

/** The switcher, shown: over whatever view was there. `said`: a line of its own to show. */
const toSwitcher = (state, said = null) => next(state, { view: "switcher", switcher: Object.freeze({ ...state.switcher, editing: false, loose: false, line: said, refused: null }) });

/** After what the reader gave changed: when no view holds what was open any more (a machine that
 *  is no longer listed), the switcher is shown and says so, and nothing is open. Else the
 *  collapse keys of this view whose instance is gone are forgotten, and the selection finds its
 *  place.
 *  THAT AN INSTANCE IS GONE IS KNOWN ONLY OF A DEPLOYMENT THAT WAS READ. One whose read failed
 *  with nothing kept draws no row (and, reporting no workspace, is in no view but its own): its
 *  instances are not gone, they are not known. `unread` holds them (see `took`): the collapse of
 *  such an instance is not forgotten and a selection on one is not moved, whoever answered
 *  meanwhile (another deployment, the roster of other machines), so the next good read finds
 *  the user where they were. A machine's rows are kept by the shared rule while it does not
 *  answer, so they need no such care. */
function settled(state, taken) {
  const now = roster(taken);
  if (taken.open !== null && now.gone) {
    const places = new Map(taken.places); places.delete(taken.open);
    // A confirmation open over that view is closed with it: what it sent goes on.
    const dismiss = taken.act !== null ? { dismiss: taken.act.n } : {};
    return { state: toSwitcher(next(taken, { open: null, places, selected: null, top: 0, loose: false, detailTop: 0, focus: "list", filter: NO_FILTER, back: "switcher", act: null }), "gone"), effect: { offer: true, ...dismiss } };
  }
  const before = roster(state);
  const unknown = new Set([...taken.unread.values()].flatMap((ids) => [...ids]));
  const mine = `${collapseKey(taken.open, "")}`;
  const present = new Set(now.instances.map((row) => collapseKey(taken.open, instanceId(row))));
  const stillThere = [...taken.collapsed].filter((key) => !key.startsWith(mine) || present.has(key) || unknown.has(key.slice(mine.length)));
  const pruned = stillThere.length === taken.collapsed.size ? taken : next(taken, { collapsed: new Set(stillThere) });
  return { state: unknown.has(pruned.selected) ? pruned : rehomed(before, pruned), effect: null };
}

/** A served deployment's entry from the reader, with the number of the cycle that gave it. An
 *  answer for a deployment that is not served, or one that is not newer than the last taken for
 *  it, is dropped. Only an observed entry moves the selection or forgets a collapse: a failed
 *  read has no rows to move to, and the next good one finds the user where they were.
 *  `unread`: for a deployment whose read failed with nothing kept, the instances it held when it
 *  was last read, until it is read again. They are what `settled` must not take for gone. */
function took(state, { id, entry, number }) {
  if (!state.ctxs.includes(id) || !(number > (state.numbers.get(id) ?? 0))) return { state, effect: null };
  const observed = entry?.deployment?.status === "observed", held = state.entries.get(id);
  let unread = state.unread;
  if (observed && unread.has(id)) { unread = new Map(unread); unread.delete(id); }
  else if (!observed && held?.deployment?.status === "observed") unread = new Map(unread).set(id, new Set((Array.isArray(held.instances) ? held.instances : []).map(instanceId)));
  const taken = next(state, { entries: new Map(state.entries).set(id, entry), numbers: new Map(state.numbers).set(id, number), unread });
  return observed ? settled(state, taken) : { state: taken, effect: null };
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
  return rehomed({ rows: [] }, next(shown, { open: id, places, focus: "list", filter: NO_FILTER, loose: false, ...place }));
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
  return rehomed(before, next(state, { filter: Object.freeze({ ...state.filter, query }), top: 0, loose: false }));
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
    put: (state, query) => (query === state.switcher.query ? state : next(state, { switcher: Object.freeze({ ...state.switcher, query, top: 0, loose: false }) })),
    close: (state, query) => next(state, { switcher: Object.freeze({ ...state.switcher, query, editing: false, top: 0, loose: false }) }),
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
      if (sw.query !== "") return { state: put({ query: "", top: 0, loose: false }), effect: null };
      // Back to the view it was opened over; with nothing open there is none.
      return state.open === null ? stay : { state: next(put({ line: null, refused: null }), { view: "instances", back: "instances" }), effect: null };
    case "instances": return state.open === null ? stay : { state: next(put({ line: null, refused: null }), { view: "instances", back: "instances" }), effect: null };
    case "up": case "down": case "top": case "bottom": case "page-up": case "page-down": {
      // The rows of the pane the choices have: the line that says what happened takes one (lib/model.mjs).
      const count = s.items.length, height = Math.max(1, page - (sw.line ? 1 : 0));
      const drawn = windowOf({ top: sw.top, count, height, keep: sw.loose ? -1 : s.items.findIndex((item) => item.key !== undefined && item.key === s.selected) }).top;
      const from = Math.max(0, s.keys.indexOf(s.selected));
      const key = s.keys.length ? s.keys[Math.min(Math.max(0, moved(action, from, s.keys.length, page)), s.keys.length - 1)] : null;
      // No choice to go to in that direction (the first, the last, or none at all): the rows
      // scroll instead, so a line under the last choice (that the folder holds more) is read.
      if (key === null || key === s.selected) {
        const top = windowOf({ top: moved(action, drawn, count, height), count, height }).top;
        return top === drawn ? stay : { state: put({ top, loose: true }), effect: null };
      }
      const at = s.items.findIndex((item) => item.key === key);
      // The headings above the first choice come into the pane with it, and what stands under the last one.
      const top = windowOf({ top: key === s.keys[0] ? 0 : key === s.keys.at(-1) ? count : drawn, count, height, keep: at }).top;
      return { state: put({ selected: key, top, loose: false }), effect: null };
    }
    case "open": {
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
 *  (one outcome of the roster read), `{ collecting }`, `{ retiring: <Set of instanceIds> }` (this
 *  run's retires in flight now), `{ offered: { offered, limited } }` (the
 *  deployments of `~/Agents` not served), `{ admitted: <deployment>, at }` and `{ refused: <path> }`
 *  (what a picked folder turned out to be).
 *  Opening an agent gives five more: `{ prepared: { id, error? } }` (the preflight of another
 *  machine's agent ended: `error` is what the shared prepareRemoteTerm threw), `{ given: true }`
 *  (the loop gave the preflight up itself: a suspend), `{ shown: { id } }` (the panel has the
 *  viewer's window), `{ returned: { id, status, stderr, asked, refused } }` (the viewer ended: what
 *  its pane wrote of its exit status and stderr, whether it was closed because the TUI asked, and
 *  the panel's refusal when it started none: model.mjs returnedLine) and
 *  `{ back: true, read, rest }` (the leader was typed in the terminal, in that read of input;
 *  `rest`: more bytes came after it in the same read).
 *  An effect is something only the loop can do: "quit", "suspend", "redraw", or an object with
 *  any of `refresh: { live }` (read now), `offer: true` (list `~/Agents` again),
 *  `admit: <path>` (ask whether a picked folder is a deployment), `close: <id>` (close the open
 *  terminal; when an `open` comes with it, before that open), `open: <decision>` (open the agent's
 *  terminal: the model's openDecision, with its target), `panel: <id>` (the preflight is over:
 *  start the viewer it prepared in the panel) and `abandon: true` (give the preflight up); or null.
 *  The line after an open stands until the next key that is bound to an action: a key bound to
 *  nothing (a stray back key is no key at all) leaves it. */
export function reduce(state, event, keymap = bindings(state.actions)) {
  if (state.outcome !== null && typeof event.key === "string" && keymap.has(event.key)) state = next(state, { outcome: null });
  const step = reduced(state, event, keymap);
  // The terminal has the focus only while the list of instances is shown: anything that shows
  // another view (a workspace gone, which shows the switcher) gives the focus back to the list.
  const t = step.state.terminal;
  if (t?.focus !== "terminal") return step;
  if (step.state.view !== "instances") return { ...step, state: next(step.state, { terminal: Object.freeze({ ...t, focus: "list", zoom: false }) }) };
  // While it has the focus, what lies under it is the list: the back key returns there, never to
  // the detail. A filter field open when the focus came (a preflight that ended while it was
  // typed in) is settled, its text kept as Enter keeps it: no key goes to it any more.
  const under = step.state.focus !== "list" || step.state.filter.editing;
  return under ? { ...step, state: next(step.state, { focus: "list", filter: Object.freeze({ ...step.state.filter, editing: false }) }) } : step;
}

/** The terminal of an open decision (the model's openDecision), starting, with the focus. */
const startingTerminal = ({ id, name, machine, routed }) => Object.freeze({ id, name, machine, routed, focus: "terminal", zoom: false, status: "starting" });
/** The open terminal with what changes of it. */
const terminalWith = (state, changes) => next(state, { terminal: Object.freeze({ ...state.terminal, ...changes }) });

/** The preflight of another machine's agent ended. Given up meanwhile (Esc, a suspend, a second
 *  open): dropped. Failed: the line that says so, unless it is the person's own giving up. Else
 *  the viewer is started in the panel, unless the row it is for has gone from the roster since. */
function prepared(state, { id, error }) {
  const opening = state.opening;
  if (opening === null || opening.id !== id || opening.phase !== "preflight") return { state, effect: null };
  if (error !== undefined) return { state: next(state, { opening: null, outcome: preflightLine(opening, error) }), effect: null };
  if (!roster(state).instances.some((row) => instanceId(row) === id)) return { state: next(state, { opening: null }), effect: null };
  return { state: next(state, { opening: null, terminal: startingTerminal(opening) }), effect: { panel: id } };
}

/** The viewer of the open terminal ended: the right side is the detail's again, the focus the
 *  list's, the line says what happened (nothing, when the person closed it), and the instances are
 *  read again at once. It is never opened again on its own: Enter opens it. An end of a terminal
 *  that is no longer the open one (closed by the person, then reported) changes nothing. */
function returned(state, { id, status, stderr, asked = false, refused = null }) {
  const t = state.terminal;
  if (t === null || t.id !== id) return { state, effect: null };
  return { state: next(state, { terminal: null, outcome: returnedLine(t, status, stderr, { asked, refused }) }), effect: { refresh: { live: true } } };
}

/** Enter in the list of instances (or a row of the palette, or the leader's Up and Down): on the
 *  row whose terminal is open, the focus goes to it; on another, that agent's terminal is opened
 *  (the open one is closed first: one at a time), or the line says why not. Nothing while another
 *  machine is asked first. Every open counts for the palette's recency (`recent`). */
function openAgent(state, row) {
  if (state.opening !== null) return { state, effect: null };
  const t = state.terminal;
  if (t !== null && t.id === instanceId(row)) return { state: terminalWith(state, { focus: "terminal", zoom: false }), effect: null };
  const decision = openDecision(state, row, instanceActs(row));
  if (!decision.open) return { state: next(state, { outcome: decision.said }), effect: null };
  state = next(state, { recent: Object.freeze([decision.id, ...state.recent.filter((id) => id !== decision.id)].slice(0, RECENT_KEPT)) });
  const close = t === null ? {} : { close: t.id };
  if (decision.routed) {
    const opening = Object.freeze({ id: decision.id, phase: "preflight", name: decision.name, machine: decision.machine, routed: true });
    return { state: next(state, { opening, terminal: null, outcome: null }), effect: { ...close, open: decision } };
  }
  return { state: next(state, { terminal: startingTerminal(decision), outcome: null }), effect: { ...close, open: decision } };
}

/** The keys of the open terminal from the list: zoom gives it the focus and the whole body, and
 *  close ends its viewer (the agent keeps running) and gives the right side back to the detail. */
function terminalKey(state, action) {
  const t = state.terminal;
  if (t === null) return { state, effect: null };
  if (action === "zoom") return { state: terminalWith(state, { focus: "terminal", zoom: true }), effect: null };
  return { state: next(state, { terminal: null }), effect: { close: t.id } };
}

/** The keys of the act view that are not the action table's: the focus moves with these and with
 *  no printable key, so nothing typed or pasted as text reaches a button. */
const FOCUS_KEYS = Object.freeze({ left: -1, "shift+tab": -1, right: 1, tab: 1 });

/** An act key on `row` (the selected one; the open terminal's from the terminal's focus): the
 *  confirmation it opens, or the line that says why not (lib/model.mjs actDecision, over the row's
 *  instanceActs answer read now). A stop or a retire asks the loop for the shared confirmation
 *  (`act`), which reads the plan; a start or a restart opens the TUI's own confirmation, and
 *  nothing is asked of the loop until it is pressed. The focus starts on the first button,
 *  Cancel. Nothing while an open is under way. `after`: "terminal" when the confirmation was
 *  asked for from the terminal's focus, which it gives back when it closes. */
function actOn(state, row, verb, after = null) {
  if (state.opening !== null) return { state, effect: null };
  const decision = actDecision(state, row, instanceActs(row), verb);
  if (!decision.open) return { state: next(state, { outcome: decision.said }), effect: null };
  const n = state.acted + 1;
  const base = { n, kind: decision.kind, verb, id: decision.id, name: decision.name, machine: decision.machine, home: decision.home, focus: "close", movedIn: null, top: 0, after };
  const act = decision.kind === "start"
    ? Object.freeze({ ...base, phase: "review", offers: Object.freeze(["close", "apply"]), answer: null })
    : Object.freeze({ ...base, phase: "reading", offers: Object.freeze(["close"]), outcome: null, notice: null, running: null, view: null, plan: null });
  return { state: next(state, { view: "act", back: "instances", act, acted: n, outcome: null }), effect: decision.kind === "start" ? null : { act: { n, verb, id: decision.id, row, label: decision.label } } };
}

/** The confirmation closed by the person (Esc, or its Cancel or Close pressed): the view goes, and
 *  the loop is told; a plan read, an apply or a start it sent goes on. One asked for from the
 *  terminal's focus gives it back, while that terminal is still the open one. */
function actClosed(state) {
  const shut = next(state, { view: "instances", back: "instances", act: null }), t = shut.terminal;
  const back = state.act.after === "terminal" && t !== null && t.id === state.act.id ? terminalWith(shut, { focus: "terminal", zoom: false }) : shut;
  return { state: back, effect: { dismiss: state.act.n } };
}

/** A key in the act view. Left/Right and Tab/Shift+Tab move the focus among the buttons, Enter
 *  presses the one that has it, Esc closes, Space sets the plan's choice, the movement keys scroll
 *  the content; quit, suspend and redraw keep their actions; every other key does nothing.
 *  A press of the act's own button in the same read of input as the move that put the focus on
 *  it is ignored (`read`): a paste, with bracketed paste unsupported, cannot both move and press. */
function inAct(state, event, action) {
  const a = state.act, stay = { state, effect: null };
  if (action === "quit" || action === "suspend" || action === "redraw") return { state, effect: action };
  if (event.key === "escape" || action === "close") return actClosed(state);
  const put = (changes) => next(state, { act: Object.freeze({ ...a, ...changes }) });
  if (Object.hasOwn(FOCUS_KEYS, event.key)) {
    const at = Math.max(0, a.offers.indexOf(a.focus)), to = Math.min(Math.max(0, at + FOCUS_KEYS[event.key]), a.offers.length - 1);
    const focus = a.offers[to];
    return focus === a.focus ? stay : { state: put({ focus, movedIn: focus === "apply" ? event.read ?? null : null }), effect: null };
  }
  if (event.key === "enter") {
    if (a.focus === "apply" && event.read !== undefined && a.movedIn === event.read) return stay;
    if (a.focus === "close") return actClosed(state);
    if (a.kind === "start") {
      if (a.focus !== "apply" || a.phase !== "review") return stay;
      const row = roster(state).instances.find((each) => instanceId(each) === a.id) ?? null;
      return { state: put({ phase: "starting", offers: Object.freeze(["close"]), focus: "close", movedIn: null }), effect: { start: { n: a.n, verb: a.verb, id: a.id, row } } };
    }
    const call = { apply: "apply", refresh: "refresh", "check-again": "checkAgain" }[a.focus];
    return call ? { state, effect: { call: { n: a.n, method: call } } } : stay;
  }
  if (event.key === "space" || event.text === " ") {
    const choice = a.kind === "lifecycle" && (a.phase === "review" || a.phase === "reading") ? a.plan?.choices.find((each) => each.offered) : null;
    return choice ? { state, effect: { call: { n: a.n, method: "setChoice", args: [choice.id, !choice.value] } } } : stay;
  }
  if (MOVES.includes(action)) {
    const count = event.extent ?? 0, height = event.room ?? 1;
    const from = windowOf({ top: a.top, count, height }).top;
    return { state: put({ top: windowOf({ top: moved(action, from, count, height), count, height }).top }), effect: null };
  }
  return stay;
}

/** What the loop says of the confirmation and of a start (`{ acted }`):
 *    { n, confirmation: { phase, outcome, offers, notice, running, view } }  the shared
 *        confirmation's state() and view() after each step it told (stop, retire);
 *    { n, answer }        a start's or restart's answer (the shared startInstance's): shown when its
 *        confirmation is still open, and the rows are read again (live) whatever it was;
 *    { spawned: { id, verb }, at }  a start's child began (`at`: ms since the epoch);
 *    { closed: id }       that child closed: the row takes acts again, and is read again (live).
 *  An answer for a confirmation that was closed (another `n`) changes nothing on screen. When the
 *  buttons change, the focus goes back to the first. */
function acted(state, event) {
  const a = state.act, mine = a !== null && event.n === a.n;
  if (event.spawned !== undefined) return { state: next(state, { starting: new Map(state.starting).set(event.spawned.id, Object.freeze({ verb: event.spawned.verb, since: event.at ?? null })) }), effect: null };
  if (event.closed !== undefined) {
    if (!state.starting.has(event.closed)) return { state, effect: { refresh: { live: true } } };
    const starting = new Map(state.starting); starting.delete(event.closed);
    return { state: next(state, { starting }), effect: { refresh: { live: true } } };
  }
  if (event.answer !== undefined) {
    const shown = mine && a.kind === "start" ? next(state, { act: Object.freeze({ ...a, phase: "settled", offers: Object.freeze(["close"]), focus: "close", movedIn: null, answer: event.answer }) }) : state;
    return { state: shown, effect: { refresh: { live: true } } };
  }
  if (event.confirmation !== undefined && mine && a.kind === "lifecycle") {
    const c = event.confirmation, view = c.view ?? null;
    const plan = view && typeof view.question === "string" ? view : view?.kind === "reading" && view.kept ? a.plan : null;
    const offers = Object.freeze(BUTTON_ORDER.filter((offer) => (c.offers ?? []).includes(offer)));
    const same = offers.length === a.offers.length && offers.every((offer, i) => offer === a.offers[i]);
    return { state: next(state, { act: Object.freeze({ ...a, phase: c.phase, outcome: c.outcome ?? null, notice: c.notice ?? null, running: c.running ?? null, view, plan, offers,
      ...(same ? {} : { focus: offers[0] ?? "close", movedIn: null }) }) }), effect: null };
  }
  return { state, effect: null };
}

/** The instances the palette's recency keeps. */
const RECENT_KEPT = 50;
const leaderAt = (read, waiting) => Object.freeze({ read: Number.isInteger(read) ? read : null, waiting });
/** Whether an event came in the same read of input as the leader. */
const sameRead = (leader, event) => leader.read !== null && event.read === leader.read;
/** Two effects as one: the dismissal of a confirmation the leader closed, and what it then ran. */
const both = (a, b) => (a === null ? b : b === null ? a : typeof b === "string" ? b : { ...a, ...b });

/** THE LEADER (docs/tui.md, "The leader"): tui.json's open.detachKey, read as `leaderKey` where the
 *  TUI reads keys and as `{ back }` from the bytes typed into a terminal (term/through.mjs). It
 *  waits, with no timeout, for the key of LEADER's table that follows it IN A LATER READ, so a
 *  paste can never run a command: what comes in the leader's own read cancels it and is dropped.
 *  The key that follows is one key: the rest of its read is dropped too. A key not in the table
 *  cancels the leader and is dropped. Answers the step, or `{ pass }`: the state the event goes on
 *  in, when it is not the leader's. */
function leading(state, event, keymap) {
  const l = state.leader;
  // The leader typed in a terminal: the rest of that read is never the agent's (lib/main.mjs), and
  // when there was a rest (`rest`), it cancelled the leader.
  if (event.back !== undefined) return { state: state.terminal?.focus === "terminal" ? next(state, { leader: leaderAt(event.read, event.rest !== true) }) : state, effect: null };
  if (typeof event.key !== "string" && !("paste" in event)) return { pass: state };
  if (l !== null && sameRead(l, event)) return { state: l.waiting ? next(state, { leader: leaderAt(l.read, false) }) : state, effect: null };
  if (l !== null && l.waiting) {
    const after = next(state, { leader: leaderAt(event.read, false) });
    const does = typeof event.key !== "string" ? undefined : event.key === state.leaderKey ? "list" : LEADER_KEYS.get(event.key);
    return does === undefined ? { state: after, effect: null } : led(after, does, event, keymap);
  }
  const plain = l === null ? state : next(state, { leader: null });
  if (event.key === state.leaderKey) return { state: next(plain, { leader: leaderAt(event.read, true) }), effect: null };
  return { pass: plain };
}

/** Whatever has the focus, settled, so the list has it: the palette closed, a confirmation closed
 *  (the loop told), the help and the views of this machine left, a filter field kept as Enter keeps
 *  it, the terminal and the detail left. -> { state, effect } */
function toList(state) {
  let s = state, effect = null;
  if (s.palette !== null) s = next(s, { palette: null });
  if (s.view === "act" && s.act !== null) { effect = { dismiss: s.act.n }; s = next(s, { view: "instances", back: "instances", act: null }); }
  if (s.view === "help") s = next(s, { view: s.back });
  if (s.view === "souls" || s.view === "capabilities") s = s.open === null ? toSwitcher(next(s, { back: "switcher" })) : next(s, { view: "instances", back: "instances" });
  const field = fieldOf(s);
  if (field) s = field.close(s, field.query(s).trim());
  if (s.terminal?.focus === "terminal") s = terminalWith(s, { focus: "list", zoom: false });
  if (s.view === "instances" && s.focus === "detail") s = next(s, { focus: "list" });
  return { state: s, effect };
}

/** As toList, then the Instances view itself: the switcher, while a workspace is open, closed onto
 *  it. Where the terminal commands (open, previous, next, zoom, close) and the acts go, from
 *  whatever was shown; with no workspace open the switcher stays. -> { state, effect } */
function toInstances(state) {
  const settled = toList(state), s = settled.state;
  if (s.view !== "switcher" || s.open === null) return settled;
  return { state: next(s, { view: "instances", back: "instances", switcher: Object.freeze({ ...s.switcher, line: null, refused: null }) }), effect: settled.effect };
}

/** What the leader's key does (LEADER's `does`), from wherever the focus was. From the terminal's
 *  focus the acts are the open terminal's instance's and give the focus back when their
 *  confirmation closes, zoom zooms it in or out, and the palette gives it back when it is closed;
 *  Up and Down go from the open terminal's instance. Every other key first gives the focus to
 *  the list, then does what its action does there; the terminal's keys and the acts first go to
 *  the Instances view, from any view (toInstances). */
function led(state, does, event, keymap) {
  const stay = { state, effect: null }, t = state.terminal;
  const inTerminal = t?.focus === "terminal" && state.view === "instances";
  if (does === "list") return toList(state);
  if (does === "palette") return { state: paletteOpened(state, event, inTerminal ? "terminal" : "list"), effect: null };
  if (does === "zoom" || does === "close-terminal") {
    if (t === null) return stay;
    if (does === "zoom" && inTerminal) return { state: terminalWith(state, { zoom: !t.zoom }), effect: null };
    const settledState = toInstances(state);
    if (settledState.state.view !== "instances") return stay;
    const step = terminalKey(settledState.state, does);
    return { state: step.state, effect: both(settledState.effect, step.effect) };
  }
  if (does === "previous" || does === "next") return stepped(state, does === "previous" ? -1 : 1, event);
  if (does === "stop" || does === "retire" || does === "start" || does === "restart") {
    const id = inTerminal ? t.id : state.selected;
    const row = id === null ? null : roster(state).instances.find((each) => instanceId(each) === id) ?? null;
    if (row === null || state.open === null) return stay;
    const settledState = toInstances(state);
    const step = actOn(settledState.state, row, does, inTerminal ? "terminal" : null);
    return { state: step.state, effect: both(settledState.effect, step.effect) };
  }
  const settledState = toList(state);
  const { key, text, ...rest } = event;
  const step = reduced(settledState.state, { ...rest, action: does }, keymap);
  return { state: step.state, effect: both(settledState.effect, step.effect) };
}

/** The leader's Up and Down: the instance before or after the open terminal's (or the selection's,
 *  with none open) in the list as it is drawn, passing over the rows that cannot be opened, is
 *  selected and opened with the focus in it, in the Instances view from whatever was shown (a
 *  confirmation is closed, the loop told). At either end of the list nothing moves, and nothing
 *  is left. */
function stepped(state, step, event) {
  const stay = { state, effect: null };
  if (state.opening !== null || state.open === null) return stay;
  const settled = toInstances(state), s = settled.state;
  if (s.view !== "instances") return stay;
  const page = Math.max(1, Number.isInteger(event.page) ? event.page : 1);
  const r = roster(s, undefined, Number.isInteger(event.cols) ? event.cols : undefined);
  const from = indexOf(r, s.terminal !== null && r.index.has(s.terminal.id) ? s.terminal.id : s.selected);
  if (from < 0) return stay;
  for (let i = from + step; i >= 0 && i < r.items.length; i += step) {
    const item = r.items[i];
    if (!isRow(item) || !openDecision(s, item.row, instanceActs(item.row)).open) continue;
    const opened = openAgent(selectAt(s, r, i, page, step), item.row);
    return { state: opened.state, effect: both(settled.effect, opened.effect) };
  }
  return stay;
}

/** THE PALETTE (docs/tui.md, "The palette"), opened: one input over the rows lib/model.mjs
 *  paletteItems lists. `read` is the read of input that opened it: a press of Enter in that same
 *  read runs nothing (a paste cannot open it and run a row). `from`: "terminal" when it was opened
 *  from the terminal's focus, which closing it gives back. While it is open the TUI reads keys,
 *  so the terminal does not have the focus. */
function paletteOpened(state, event, from) {
  const palette = Object.freeze({ query: "", selected: null, top: 0, read: Number.isInteger(event.read) ? event.read : null, from });
  const t = state.terminal;
  return next(state, { palette, ...(t?.focus === "terminal" ? { terminal: Object.freeze({ ...t, focus: "list", zoom: false }) } : {}) });
}
/** The palette closed: the focus goes back to the terminal it came from, while that is open. */
function paletteClosed(state) {
  const shut = next(state, { palette: null }), t = shut.terminal;
  return state.palette.from === "terminal" && t !== null && shut.view === "instances" ? terminalWith(shut, { focus: "terminal" }) : shut;
}
/** The keys that move the palette's selection: named keys only, so every letter is the query's. */
const PALETTE_MOVES = Object.freeze({ up: "up", down: "down", pageup: "page-up", pagedown: "page-down" });
/** A key or a paste while the palette is open. Text and a paste's first line go to the query,
 *  Backspace takes a grapheme off it, Up and Down (and PageUp, PageDown) move among its rows,
 *  Enter runs the selected row, Esc (or its own key again) closes it; quit, suspend and redraw keep
 *  their actions. Every other key does nothing. */
function inPalette(state, event, keymap) {
  const p = state.palette, stay = { state, effect: null };
  const put = (changes) => next(state, { palette: Object.freeze({ ...p, ...changes }) });
  const query = (text) => (text === p.query ? stay : { state: put({ query: text, selected: null, top: 0 }), effect: null });
  if ("paste" in event) return typeof event.paste === "string" ? query(typed(p.query, event.paste.split(LINE_END)[0])) : stay;
  if (typeof event.text === "string") return query(typed(p.query, event.text, { key: true }));
  const action = keymap.get(event.key);
  if (event.key === "backspace") return query([...GRAPHEMES.segment(p.query)].map((g) => g.segment).slice(0, -1).join(""));
  if (event.key === "escape" || action === "close" || action === "palette") return { state: paletteClosed(state), effect: null };
  if (action === "quit" || action === "suspend" || action === "redraw") return { state, effect: action };
  const list = paletteItems(state);
  const keys = list.items.map((item) => item.key);
  if (Object.hasOwn(PALETTE_MOVES, event.key)) {
    if (!keys.length) return stay;
    const page = Math.max(1, (Number.isInteger(event.page) ? event.page : 1) - 1);
    const from = Math.max(0, keys.indexOf(list.selected));
    const to = Math.min(Math.max(0, moved(PALETTE_MOVES[event.key], from, keys.length, page)), keys.length - 1);
    return { state: put({ selected: keys[to] }), effect: null };
  }
  if (event.key !== "enter") return stay;
  if (p.read !== null && event.read === p.read) return stay;
  const item = list.items.find((each) => each.key === list.selected);
  return item ? ranFromPalette(state, item, event, keymap) : stay;
}
/** A palette row run, what was open under the palette settled first as the leader settles it (a
 *  filter field kept, a confirmation closed, the loop told): an instance is opened (its terminal
 *  swapped into the panel) and an act opens its confirmation on the palette's instance, both in
 *  the Instances view whatever was shown (toInstances); a view or a command does what its action
 *  does from the list (toList). */
function ranFromPalette(state, item, event, keymap) {
  const from = state.palette.from;
  const settled = item.kind === "instance" || item.kind === "act" ? toInstances(state) : toList(state), shut = settled.state;
  const then = (step) => ({ state: step.state, effect: both(settled.effect, step.effect) });
  if (item.kind === "instance" || item.kind === "act") {
    const row = shut.view === "instances" ? roster(shut).instances.find((each) => instanceId(each) === item.id) : undefined;
    if (!row) return settled;
    if (item.kind === "act") return then(actOn(shut, row, item.does, from === "terminal" ? "terminal" : null));
    const r = roster(shut, undefined, Number.isInteger(event.cols) ? event.cols : undefined);
    const page = Math.max(1, Number.isInteger(event.page) ? event.page : 1);
    const at = indexOf(r, item.id);
    return then(openAgent(at < 0 ? shut : selectAt(shut, r, at, page), row));
  }
  const { key, text, ...rest } = event;
  return then(reduced(shut, { ...rest, action: item.does }, keymap));
}

function reduced(state, event, keymap) {
  const lead = leading(state, event, keymap);
  if (lead.pass === undefined) return lead;
  state = lead.pass;
  const stay = { state, effect: null };
  if (event.acted !== undefined) return acted(state, event.acted);
  if (event.prepared !== undefined) return prepared(state, event.prepared);
  if (event.given !== undefined) return state.opening?.phase === "preflight" ? { state: next(state, { opening: null }), effect: null } : stay;
  if (event.returned !== undefined) return returned(state, event.returned);
  if (event.shown !== undefined) return state.terminal?.id === event.shown.id ? { state: terminalWith(state, { status: "open" }), effect: null } : stay;
  if (event.entry !== undefined) return took(state, event);
  if (event.roster !== undefined) return heard(state, event.roster);
  if (event.collecting !== undefined) return { state: event.collecting === state.collecting ? state : next(state, { collecting: event.collecting === true }), effect: null };
  // The rows stay where they are: only what they read changes.
  if (event.retiring !== undefined) return { state: next(state, { retiring: new Set(event.retiring) }), effect: null };
  if (event.offered !== undefined) return { state: next(state, { offered: Object.freeze({ offered: Object.freeze([...event.offered.offered]), limited: event.offered.limited === true }) }), effect: null };
  if (event.admitted !== undefined) return { state: admitted(state, event), effect: { refresh: { live: true } } };
  if (event.refused !== undefined) return { state: next(state, { switcher: Object.freeze({ ...state.switcher, refused: event.refused }) }), effect: null };
  // An action the leader or the palette runs comes as `{ action }`, with no key: whatever field or
  // confirmation was open has been settled first.
  const given = event.action !== undefined;
  if (!given && state.palette !== null) return inPalette(state, event, keymap);
  const field = given ? null : fieldOf(state);
  // A paste goes only into an open filter field: its first line. Anywhere else it is dropped whole.
  if ("paste" in event) return field && typeof event.paste === "string" ? { state: field.put(state, typed(field.query(state), event.paste.split(LINE_END)[0])), effect: null } : stay;
  if (typeof event.key !== "string" && !given) return stay;
  const action = given ? event.action : keymap.get(event.key);
  if (field) return edited(state, field, event, action);
  if (state.view === "act" && state.act !== null) return inAct(state, event, action);
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
    case "palette": return { state: paletteOpened(state, event, "list"), effect: null };
    // Souls and Capabilities are views of this machine, whatever workspace is open, or none.
    case "souls": case "capabilities": return { state: state.view === action ? state : next(state, { view: action, back: action }), effect: null };
    default:
  }
  if (state.view === "souls" || state.view === "capabilities") {
    // Esc and 1 go back to the instances, or to the switcher when no workspace is open.
    if (action !== "close" && action !== "instances") return stay;
    return { state: state.open === null ? toSwitcher(next(state, { back: "switcher" })) : next(state, { view: "instances", back: "instances" }), effect: null };
  }
  if (state.view === "help") {
    if (action === "close") return { state: next(state, { view: state.back }), effect: null };
    if (action === "instances") return state.open === null ? stay : { state: next(state, { view: "instances", back: "instances" }), effect: null };
    return MOVES.includes(action) ? { state: next(state, { helpTop: scrolled(state.helpTop) }), effect: null } : stay;
  }
  if (state.view === "switcher") return switched(state, action, page);

  if (action === "close") {
    // In this order: an open under way (another machine is asked first), a kept filter, the detail.
    if (state.opening?.phase === "preflight") return { state: next(state, { opening: null }), effect: { abandon: true } };
    if (state.filter.query !== "") return { state: queried(state, ""), effect: null };
    return state.focus === "detail" ? { state: next(state, { focus: "list" }), effect: null } : stay;
  }
  const r = roster(state, undefined, Number.isInteger(event.cols) ? event.cols : undefined);
  const at = indexOf(r, state.selected);
  switch (action) {
    case "filter": return { state: next(state, { focus: "list", filter: Object.freeze({ ...state.filter, editing: true }) }), effect: null };
    case "open": return at < 0 ? stay : openAgent(state, r.items[at].row);
    case "zoom": case "close-terminal": return terminalKey(state, action);
    case "stop": case "retire": case "start": case "restart": return at < 0 ? stay : actOn(state, r.items[at].row, action);
    case "detail": return at < 0 ? stay : { state: next(state, { focus: state.focus === "detail" ? "list" : "detail" }), effect: null };
    case "up": case "down": case "top": case "bottom": case "page-up": case "page-down": {
      if (state.focus === "detail") return { state: next(state, { detailTop: scrolled(state.detailTop) }), effect: null };
      // With nothing selected, any movement selects the first row.
      const target = at < 0 ? 0 : moved(action, at, r.items.length, page);
      const picked = selectAt(state, r, target, page, target < at ? -1 : 1);
      return { state: picked.selected === state.selected ? scrolledList(state, r, action, page) : picked, effect: null };
    }
    case "collapse": case "expand": {
      if (state.focus !== "list" || at < 0) return stay;
      const item = r.items[at], fold = disclosure(state, r, item), key = collapseKey(state.open, item.id);
      const settledState = next(state, { top: settledTop(state, r, page) });
      if (!r.filtering && fold === (action === "collapse" ? "open" : "closed")) {
        const collapsed = new Set(state.collapsed);
        if (action === "collapse") collapsed.add(key); else collapsed.delete(key);
        return { state: rehomed(r, next(settledState, { collapsed, loose: false })), effect: null };
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
