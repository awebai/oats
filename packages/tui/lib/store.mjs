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
import { collapseKey, displayLine, instanceActs, instanceId, outcomeWords, pendingEntry, spawnProblem } from "./client.mjs";
import { DETACH_KEY } from "./config.mjs";
import { BUTTON_ORDER, SPAWN_WORDS, SPLIT_WORDS, TAB_WORDS, actDecision, disclosure, openDecision, paletteItems, preflightLine, returnedLine, roster, soulNames, soulOfAgent, soulsOf, spawnChoices, spawnChoicesKey, spawnLine, spawnPickerItems, spawnReady, spawnRing, spawnSelector, spawnedRow, switcher } from "./model.mjs";
import { backKeyId } from "./term/through.mjs";
import { windowOf } from "./views/scroll.mjs";
import { SPLIT_MIN, splitFits } from "./views/split.mjs";

/** The longest filter, in UTF-16 units. */
export const QUERY_LIMIT = 200;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const LINE_END = /\r\n|[\n\r\u2028\u2029]/;
/** The instance list's filter: the text typed after `/`, or (`soul`, only while it is set) the
 *  exact filter of one soul's instances that the Souls view's `i` sets, `{ name, names }` (the
 *  names an instance's soul may carry: lib/model.mjs soulNames). Never both: `/` replaces the soul
 *  filter, and Esc clears it. */
const NO_FILTER = Object.freeze({ editing: false, query: "" });
/** The Souls view's own (docs/tui.md, "The Souls view"): whether its catalog was ever wanted (the
 *  view opened once: a run that never opens it never reads one), what the loop holds of each
 *  workspace's catalog (`held`: id -> `{ entry, reading }`, the shared catalog's projected entry
 *  and whether a read of it is in flight), and the selection (a soul's name), the scroll, the focus
 *  and the filter of the view, kept when it is left and found again, for the run. */
const NO_SOULS = Object.freeze({ wanted: false, held: new Map(), selected: null, top: 0, loose: false, focus: "list", detailTop: 0, filter: Object.freeze({ editing: false, query: "" }) });

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
 *  pressed, for the line after. `tabs`: the terminals open in the panel (docs/tui.md, "Tabs"),
 *  in the strips' order (each group's tabs in this order), at most TAB_LIMIT across both groups:
 *  each `{ id, name, machine, routed, status, activity, group }`, `id` the row's instanceId and the
 *  next three the row's as it was when it was opened, `status` "starting" until the panel has its
 *  window, then "open", `activity` true while it is hidden and its agent wrote since it was last
 *  shown, `group` 0 or 1 (docs/tui.md, "Splits"). `split`: null, or "right" or "down" while the
 *  panel is split in two groups; `group` the focused group (where an open goes); `aside` the other
 *  group's shown tab's id, or null (no split, or that group empty). `terminal`: the focused group's
 *  SHOWN tab, or null when no tab is open or the focused group is empty:
 *  `{ id, name, machine, routed, group, focus, zoom, status }`, its tab's fields with `focus`
 *  "terminal" while what is typed goes to the agent and "list" while the TUI reads keys, and `zoom`
 *  true while it has the whole body (only with the terminal's focus).
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
 *  `act`, `acted`, `starting`, `leader`, `palette` and `recent`.
 *  A SPAWN (docs/tui.md, "Spawning an agent"; see `spawnAsked`): `spawn` the prompt while it is
 *  open, or null; `spawning` the one spawn under way, `{ name, soul, workspace, phase, prompt }`
 *  (`phase` "submitting", "spawning" or "checking"; `prompt` the prompt as it was pressed, to come
 *  back to), or null; `spawnCheck` `{ name }` while a check of an outcome not known is offered
 *  (`C`), or null; `arriving` the instance a spawn created, `{ workspace, instance, home,
 *  agentsRoot, agent, reads, words }`, until its row is opened or two reads did not show it;
 *  `previews` the number of the last preview read asked in the run, so that an answer to a prompt
 *  already closed is never taken by the next one. */
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
    leaderKey: backKeyId(detachKey), leader: null, palette: null, recent: Object.freeze([]), souls: NO_SOULS,
    spawn: null, spawning: null, spawnCheck: null, arriving: null, previews: 0, tabs: Object.freeze([]), split: null, group: 0, aside: null,
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
  if (!observed) return { state: taken, effect: null };
  const step = settled(state, taken);
  if (step.state.arriving?.workspace !== id) return step;
  const then = arrived(step.state);
  return { state: then.state, effect: both(step.effect, then.effect) };
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
  souls: Object.freeze({
    query: (state) => state.souls.filter.query,
    put: (state, query) => (query === state.souls.filter.query ? state : soulsWith(state, { filter: Object.freeze({ ...state.souls.filter, query }), top: 0, loose: false, detailTop: 0 })),
    close: (state, query) => soulsWith(state, { filter: Object.freeze({ editing: false, query }), top: 0, loose: false }),
  }),
  switcher: Object.freeze({
    query: (state) => state.switcher.query,
    put: (state, query) => (query === state.switcher.query ? state : next(state, { switcher: Object.freeze({ ...state.switcher, query, top: 0, loose: false }) })),
    close: (state, query) => next(state, { switcher: Object.freeze({ ...state.switcher, query, editing: false, top: 0, loose: false }) }),
  }),
});
/** The filter field that is open now, or null. */
const fieldOf = (state) => (state.view === "instances" && state.filter.editing ? FIELDS.instances
  : state.view === "switcher" && state.switcher.editing ? FIELDS.switcher
  : state.view === "souls" && state.souls.filter.editing ? FIELDS.souls : null);

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

/** The Souls view's own state with what changes of it. */
const soulsWith = (state, changes) => next(state, { souls: Object.freeze({ ...state.souls, ...changes }) });

/** The Souls view shown (docs/tui.md, "The Souls view"): from now on its catalog is wanted, and
 *  the loop settles it for the open workspace (`souls: "settle"`), which reads it only when nothing
 *  is held for the workspace as it is now (the shared catalog's key). */
function soulsShown(state) {
  // Come back to from another view, it shows its list: what was selected and filtered stays.
  const shown = state.view === "souls" ? state : next(state, { view: "souls", back: "souls", souls: Object.freeze({ ...state.souls, focus: "list" }) });
  return { state: soulsWith(shown, { wanted: true }), effect: { souls: "settle" } };
}

/** What the loop holds of a workspace's catalog, told: `{ id, entry, reading }` (the shared
 *  catalog's projected entry, or null, and whether a read is in flight). Only a served workspace's
 *  is kept. */
function soulsHeard(state, { id, entry, reading }) {
  if (!state.ctxs.includes(id)) return { state, effect: null };
  const held = soulsWith(state, { held: new Map(state.souls.held).set(id, Object.freeze({ entry: entry ?? null, reading: reading === true })) });
  // A prompt that waits for this catalog to know its soul (N, before the Souls view was ever read).
  return held.spawn?.workspace === id && held.spawn.step === "preview" && held.spawn.soul === null ? soulFound(held) : { state: held, effect: null };
}

/** The Instances view with the instances of soul `row` alone: the exact soul filter, shown where a
 *  kept filter stands; Esc clears it and `/` replaces it. */
function soulInstances(state, row) {
  const filter = Object.freeze({ editing: false, query: "", soul: Object.freeze({ name: row.name, names: Object.freeze(soulNames(row)) }) });
  return { state: rehomed(roster(state), next(state, { view: "instances", back: "instances", focus: "list", filter, top: 0, loose: false })), effect: null };
}

/** A key in the Souls view (docs/tui.md, "The Souls view"). The list's keys move among the souls
 *  the filter keeps, or scroll the detail while it has the focus; Enter gives the detail the focus,
 *  and from the detail does what `i` does, the selected soul's instances in the Instances view; `/`
 *  opens the view's own filter field; `r` reads the catalog again (`souls: "reread"`, which starts
 *  nothing while a read is in flight); Esc closes the detail, then clears a kept filter, then goes
 *  back to the instances (to the switcher when no workspace is open), as `1` does. */
function inSouls(state, action, event, page, scrolled) {
  const stay = { state, effect: null }, v = state.souls;
  const s = soulsOf(state), at = s.selected ? s.rows.indexOf(s.selected) : -1;
  const back = () => ({ state: state.open === null ? toSwitcher(next(state, { back: "switcher" })) : next(state, { view: "instances", back: "instances" }), effect: null });
  switch (action) {
    case "instances": return back();
    case "close":
      if (v.focus === "detail") return { state: soulsWith(state, { focus: "list" }), effect: null };
      if (v.filter.query !== "") return { state: soulsWith(state, { filter: Object.freeze({ editing: false, query: "" }), top: 0, loose: false }), effect: null };
      return back();
    case "filter": return s.local ? { state: soulsWith(state, { focus: "list", filter: Object.freeze({ ...v.filter, editing: true }) }), effect: null } : stay;
    case "refresh": return s.local ? { state, effect: { souls: "reread" } } : stay;
    case "open": return at < 0 ? stay : v.focus === "detail" ? soulInstances(state, s.selected) : { state: soulsWith(state, { focus: "detail" }), effect: null };
    case "detail": return at < 0 ? stay : { state: soulsWith(state, { focus: v.focus === "detail" ? "list" : "detail" }), effect: null };
    case "soul-instances": return at < 0 ? stay : soulInstances(state, s.selected);
    case "up": case "down": case "top": case "bottom": case "page-up": case "page-down": {
      if (v.focus === "detail") return { state: soulsWith(state, { detailTop: scrolled(v.detailTop) }), effect: null };
      if (!s.rows.length) return stay;
      const to = Math.min(Math.max(0, at < 0 ? 0 : moved(action, at, s.rows.length, page)), s.rows.length - 1);
      const name = s.rows[to].name;
      return { state: soulsWith(state, { selected: name, loose: false, detailTop: name === s.selected?.name ? v.detailTop : 0 }), effect: null };
    }
    default: return stay;
  }
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
  let step = reduced(state, event, keymap);
  // The tabs are the open workspace's: whatever opened another (or left it, gone), they all close,
  // and the split with them.
  if (step.state.open !== state.open && (step.state.tabs.length || step.state.split !== null)) {
    const ids = step.state.tabs.map((tab) => tab.id);
    step = { state: next(step.state, { tabs: Object.freeze([]), terminal: null, ...NO_SPLIT }), effect: ids.length ? both(step.effect, { close: ids }) : step.effect };
  }
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

/** The shown terminal with what changes of it: its focus and zoom (a change of its status goes
 *  through tabWith, which keeps its tab in step). */
const terminalWith = (state, changes) => next(state, { terminal: Object.freeze({ ...state.terminal, ...changes }) });
/** Tab `id` with what changes of it, and the shown terminal with it when it is that tab. */
function tabWith(state, id, changes) {
  const tabs = Object.freeze(state.tabs.map((tab) => (tab.id === id ? Object.freeze({ ...tab, ...changes }) : tab)));
  const { activity, ...shared } = changes;
  return next(state, { tabs, ...(state.terminal?.id === id ? { terminal: Object.freeze({ ...state.terminal, ...shared }) } : {}) });
}
/** No split: one group, focused. */
const NO_SPLIT = Object.freeze({ split: null, group: 0, aside: null });
/** Group `g`'s tabs, in the strip's order. */
const inGroup = (state, g) => state.tabs.filter((tab) => tab.group === g);
/** Group `g`'s shown tab's id: the focused group's is the terminal's, the other's `aside`. */
const shownOf = (state, g) => (g === state.group ? state.terminal?.id ?? null : state.aside);
/** The cap's line: every tab is taken, and how to free one (the leader's close). */
const fullLine = (state) => Object.freeze({ said: TAB_WORDS.full(TAB_LIMIT, state.detachKey), under: Object.freeze([]) });

/** A new tab for an open decision (the model's openDecision), starting, in the focused group:
 *  placed after its shown one (last, with none shown: an empty group's first) and shown, with the
 *  focus. */
function tabOpened(state, { id, name, machine, routed }) {
  const group = state.group, tab = Object.freeze({ id, name, machine, routed, status: "starting", activity: false, group });
  const at = state.terminal === null ? state.tabs.length : state.tabs.findIndex((each) => each.id === state.terminal.id) + 1;
  const tabs = Object.freeze([...state.tabs.slice(0, at), tab, ...state.tabs.slice(at)]);
  return next(state, { tabs, terminal: Object.freeze({ id, name, machine, routed, group, focus: "terminal", zoom: false, status: "starting" }) });
}

/** Tab `id` shown (docs/tui.md, "Tabs"), with `focus` and `zoom` (the shown one's, by default),
 *  in its group, which is the focused one from then on (docs/tui.md, "Splits"):
 *  its activity mark goes, it is the most recent for the palette, its instance's row is selected
 *  and revealed (a filter that hides it is cleared, a collapsed parent opened), and the focus stays
 *  where it was. The loop is told to show it unless it is the one shown already. */
function showTab(state, id, { focus = state.terminal?.focus ?? "list", zoom = state.terminal?.zoom ?? false } = {}) {
  const tab = state.tabs.find((each) => each.id === id);
  if (!tab) return { state, effect: null };
  const { activity, ...fields } = tab;
  const before = state.terminal?.id ?? null;
  // A tab of the other group: that group is focused now, and the one left keeps its shown tab.
  const across = tab.group !== state.group ? { group: tab.group, aside: before } : {};
  const shown = next(state, {
    tabs: Object.freeze(state.tabs.map((each) => (each.id === id && each.activity ? Object.freeze({ ...each, activity: false }) : each))),
    terminal: Object.freeze({ ...fields, focus, zoom: focus === "terminal" && zoom }),
    recent: recentWith(state, id),
    ...across,
  });
  return { state: revealed(shown, id), effect: before === id ? null : { show: id } };
}

/** The row of instance `id` selected and on view in the list (Settled 5 of T2): a text filter
 *  that hides it is cleared, and a collapsed instance above it is opened. The focus is not moved,
 *  and nothing is selected when the row is not in the roster at all (it went away). */
function revealed(state, id) {
  if (state.view !== "instances" || state.open === null) return state;
  let s = state;
  if (!roster(s).index.has(id) && (s.filter.query !== "" || s.filter.soul)) s = rehomed(roster(s), next(s, { filter: NO_FILTER, top: 0, loose: false }));
  if (!roster(s).index.has(id) && s.collapsed.size) {
    // The collapsed instances that hide it: each one alone would.
    const hiding = [...s.collapsed].filter((key) => !roster(next(s, { collapsed: new Set([key]) })).index.has(id));
    if (hiding.length) { const collapsed = new Set(s.collapsed); for (const key of hiding) collapsed.delete(key); s = next(s, { collapsed }); }
  }
  return roster(s).index.has(id) ? next(s, { selected: id, loose: false, detailTop: id === s.selected ? s.detailTop : 0 }) : s;
}

/** The shown tab closed by the person (`c` in the list, the leader then `w`): its viewer ends
 *  (the agent keeps running), the tab to its right is shown, else the one to its left, with the
 *  focus `focus` and the zoom `zoom` (the closed one's), within its group; a group's last one
 *  closed removes the group (ungrouped), and the last one of all gives the right side back to the
 *  detail and the focus to the list. */
function shownClosed(state, focus, zoom = state.terminal?.zoom ?? false) {
  const t = state.terminal;
  if (t === null) return { state, effect: null };
  const mine = inGroup(state, state.group), at = mine.findIndex((tab) => tab.id === t.id);
  const rest = mine.filter((tab) => tab.id !== t.id), neighbour = rest[at] ?? rest[at - 1] ?? null;
  const closed = next(state, { tabs: Object.freeze(state.tabs.filter((tab) => tab.id !== t.id)), terminal: null });
  // The group's last tab: the group goes, and the other takes the panel (or none is left).
  const step = neighbour !== null ? showTab(closed, neighbour.id, { focus, zoom })
    : state.split !== null ? ungrouped(closed, state.group, focus)
    : { state: next(closed, { focus: "list" }), effect: null };
  return { state: step.state, effect: both({ close: [t.id] }, step.effect) };
}

/** Group `g` of a split, empty now, removed (docs/tui.md, "Splits"): the other group takes the
 *  whole panel, as group 0, and is focused, its shown tab with the focus `focus`. When it is empty
 *  too nothing is left, and the panel closes. */
function ungrouped(state, g, focus) {
  const left = shownOf(state, 1 - g);
  const tabs = Object.freeze(state.tabs.map((tab) => (tab.group === 0 ? tab : Object.freeze({ ...tab, group: 0 }))));
  const one = next(state, { tabs, terminal: null, ...NO_SPLIT });
  if (left === null) return { state: next(one, { focus: "list" }), effect: null };
  return showTab(one, left, { focus, zoom: false });
}

/** The tab before or after the shown one (`step` -1 or 1) in the focused group shown, without
 *  wrapping and never into the other group: at either end
 *  nothing moves, nor while a tab is still starting (it is the shown one until the panel has its
 *  window). The focus stays where it was, and so does the zoom. */
function tabStepped(state, step, { focus = state.terminal?.focus ?? "list", zoom = state.terminal?.zoom ?? false } = {}) {
  const t = state.terminal;
  if (t === null || state.tabs.some((tab) => tab.status === "starting")) return { state, effect: null };
  const mine = inGroup(state, state.group), at = mine.findIndex((tab) => tab.id === t.id) + step;
  if (at < 0 || at >= mine.length) return { state, effect: null };
  return showTab(state, mine[at].id, { focus, zoom });
}

/** The preflight of another machine's agent ended. Given up meanwhile (Esc, a suspend, a second
 *  open): dropped. Failed: the line that says so, unless it is the person's own giving up. Else
 *  the viewer is started in the panel, unless the row it is for has gone from the roster since. */
function prepared(state, { id, error }) {
  const opening = state.opening;
  if (opening === null || opening.id !== id || opening.phase !== "preflight") return { state, effect: null };
  if (error !== undefined) return { state: next(state, { opening: null, outcome: preflightLine(opening, error) }), effect: null };
  if (!roster(state).instances.some((row) => instanceId(row) === id)) return { state: next(state, { opening: null }), effect: null };
  return { state: tabOpened(next(state, { opening: null }), opening), effect: { panel: id } };
}

/** The viewer of a tab ended by itself: its tab closes, the line says what happened, naming its
 *  instance (nothing when it ended cleanly), and the instances are read again at once. The shown
 *  one's end shows the tab to its right, else the one to its left, with the focus in the list
 *  (Settled 6 of T2); the last one's gives the right side back to the detail. The other group's
 *  shown one's end shows its neighbour there; a group's last one's removes the group (Settled 5 of
 *  T3). A hidden one's end changes neither the shown tab nor the focus. A tab is never opened again on its own: Enter opens
 *  it. The end of a tab the person closed (no longer a tab, then reported) changes nothing. */
function returned(state, { id, status, stderr, asked = false, refused = null }) {
  const tab = state.tabs.find((each) => each.id === id);
  if (!tab) return { state, effect: null };
  const line = returnedLine(tab, status, stderr, { asked, refused });
  const mine = inGroup(state, tab.group), at = mine.findIndex((each) => each.id === id);
  const rest = mine.filter((each) => each.id !== id), neighbour = rest[at] ?? rest[at - 1] ?? null;
  const tabs = Object.freeze(state.tabs.filter((each) => each.id !== id));
  const read = { refresh: { live: true } };
  const focused = state.terminal?.id === id, aside = state.aside === id;
  if (!focused && !aside) return { state: next(state, { tabs, ...(line ? { outcome: line } : {}) }), effect: read };
  // The other group's shown tab: its neighbour is shown there, and nothing else moves.
  if (aside && neighbour !== null) {
    const shown = Object.freeze(tabs.map((each) => (each.id === neighbour.id && each.activity ? Object.freeze({ ...each, activity: false }) : each)));
    return { state: next(state, { tabs: shown, aside: neighbour.id, ...(line ? { outcome: line } : {}) }), effect: read };
  }
  const closed = next(state, { tabs, ...(focused ? { terminal: null } : { aside: null }), outcome: line });
  // A group's last tab ended: the group goes, the other takes the panel, the list the focus (Settled 5 of T3).
  if (neighbour === null && state.split !== null) {
    const step = ungrouped(next(closed, { focus: "list" }), tab.group, "list");
    return { state: step.state, effect: both(read, step.effect) };
  }
  if (neighbour === null) return { state: closed, effect: read };
  // The list takes the focus, from the detail too (Settled 6 of T2), so the neighbour is drawn.
  const step = showTab(next(closed, { focus: "list" }), neighbour.id, { focus: "list" });
  return { state: step.state, effect: both(read, step.effect) };
}

/** Enter in the list of instances (or a row of the palette, the leader's Up and Down, a spawn's
 *  arrival): an instance open as a tab shows that tab, with the focus in it; another is opened as
 *  a new tab after the shown one, shown, with the focus (docs/tui.md, "Tabs"), or the line says why
 *  not. At the cap nothing closes on its own: the line says so. One open at a time (Settled 3 of
 *  T2): nothing while another machine is asked first or a tab is still starting, and a preflight
 *  holds its tab's place in the cap. Every open counts for the palette's recency (`recent`), as
 *  every tab shown does (showTab). */
function openAgent(state, row) {
  if (state.opening !== null) return { state, effect: null };
  const id = instanceId(row);
  // A tab still starting is the one shown until the panel has its window (one open at a time).
  const starting = state.tabs.some((tab) => tab.status === "starting");
  if (state.tabs.some((tab) => tab.id === id)) {
    if (starting && state.terminal?.id !== id) return { state, effect: null };
    const step = showTab(state, id, { focus: "terminal", zoom: false });
    return { state: step.state, effect: step.effect };
  }
  if (starting) return { state, effect: null };
  const decision = openDecision(state, row, instanceActs(row));
  if (!decision.open) return { state: next(state, { outcome: decision.said }), effect: null };
  if (state.tabs.length >= TAB_LIMIT) return { state: next(state, { outcome: fullLine(state) }), effect: null };
  state = next(state, { recent: recentWith(state, decision.id) });
  if (decision.routed) {
    const opening = Object.freeze({ id: decision.id, phase: "preflight", name: decision.name, machine: decision.machine, routed: true });
    return { state: next(state, { opening, outcome: null }), effect: { open: decision } };
  }
  return { state: next(tabOpened(state, decision), { outcome: null }), effect: { open: decision } };
}

/** The keys of the shown terminal from the list: zoom gives it the focus and the whole body, and
 *  close ends its viewer (the agent keeps running) and shows its neighbour, the focus `focus`. */
function terminalKey(state, action, focus = "list", zoom = false) {
  const t = state.terminal;
  if (t === null) return { state, effect: null };
  if (action === "zoom") return { state: terminalWith(state, { focus: "terminal", zoom: true }), effect: null };
  return shownClosed(state, focus, zoom);
}

/** THE SPLIT'S KEYS (docs/tui.md, "Splits"). Why `does` would do nothing now: `true` for nothing
 *  at all (no tab, a tab starting, a key that does not apply), the line that says why (a split
 *  there is no room for, a second split), or null when it acts. `room` is the panel's size as the
 *  Instances view gives it with the terminal's focus (`{ cols, rows }`, its strip row counted:
 *  views/frame.mjs panelPlace), measured when the key is read; a room not known admits no split. Asked
 *  before anything is settled, so that a key that does nothing moves no focus. */
export function splitRefused(state, does, room, inTerminal = false) {
  if (state.tabs.length === 0 || state.tabs.some((tab) => tab.status === "starting") || state.opening !== null) return true;
  switch (does) {
    case "split-right": case "split-down": {
      const dir = does === "split-right" ? "right" : "down";
      if (state.split !== null) return Object.freeze({ said: SPLIT_WORDS.twice(), under: Object.freeze([]) });
      return splitFits(dir, room) ? null : Object.freeze({ said: SPLIT_WORDS.small(dir, SPLIT_MIN), under: Object.freeze([]) });
    }
    // One group: only from the list, to its terminal.
    case "group-next": return state.split === null && (inTerminal || state.terminal === null) ? true : null;
    case "tab-move": return state.split === null || state.terminal === null ? true : null;
    case "group-close": return state.split === null || state.terminal !== null ? true : null;
    default: return true;
  }
}
/** A key of the split that acts (splitRefused said null), from the Instances view, `inTerminal`
 *  when it came from the terminal's focus:
 *    split-right, split-down: the tabs stay in the first group (left or top), and the second, empty,
 *      is the focused one; the keys are the list's (Settled 2 of T3), so Enter on a row opens there;
 *    group-next: to the other group's shown terminal, with the focus (to the empty group: focused,
 *      the keys the list's); from the list, to the focused group's terminal, or with that group
 *      empty to the other's;
 *    tab-move: the focused group's shown tab to the other group, after its shown tab, shown there
 *      with the focus; the group it leaves shows its neighbour, or stays, empty;
 *    group-close: the empty focused group goes; the other takes the panel and is focused, and the
 *      keys stay the list's (Settled 8 of T3). */
function splitKey(state, does, inTerminal) {
  const t = state.terminal, other = 1 - state.group;
  switch (does) {
    case "split-right": case "split-down":
      return { state: next(state, { split: does === "split-right" ? "right" : "down", group: 1, aside: t?.id ?? null, terminal: null, focus: "list" }), effect: null };
    case "group-next": {
      if (state.split === null || (!inTerminal && t !== null)) return { state: terminalWith(state, { focus: "terminal" }), effect: null };
      const there = shownOf(state, other);
      if (there !== null) return showTab(state, there, { focus: "terminal", zoom: false });
      return { state: next(state, { group: other, aside: t?.id ?? null, terminal: null, focus: "list" }), effect: null };
    }
    case "tab-move": {
      const mine = inGroup(state, state.group), at = mine.findIndex((tab) => tab.id === t.id);
      const rest = mine.filter((tab) => tab.id !== t.id), neighbour = rest[at] ?? rest[at - 1] ?? null;
      const without = state.tabs.filter((tab) => tab.id !== t.id);
      const place = state.aside === null ? without.length : without.findIndex((tab) => tab.id === state.aside) + 1;
      const moved = Object.freeze({ ...state.tabs.find((tab) => tab.id === t.id), group: other, activity: false });
      const tabs = Object.freeze([...without.slice(0, place), moved, ...without.slice(place)].map((tab) => (tab.id === neighbour?.id && tab.activity ? Object.freeze({ ...tab, activity: false }) : tab)));
      const { activity, ...fields } = moved;
      const s = next(state, { tabs, group: other, aside: neighbour?.id ?? null, terminal: Object.freeze({ ...fields, focus: "terminal", zoom: false }) });
      return { state: revealed(s, t.id), effect: { show: t.id } };
    }
    case "group-close": return ungrouped(state, state.group, "list");
    default: return { state, effect: null };
  }
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
/** The actions of the split (docs/tui.md, "Splits"). */
const SPLIT_KEYS = Object.freeze(["split-right", "split-down", "group-next", "tab-move", "group-close"]);
/** The palette's recency with `id` the most recent: an open, and a tab shown. */
const recentWith = (state, id) => Object.freeze([id, ...state.recent.filter((each) => each !== id)].slice(0, RECENT_KEPT));
/** How many terminals the panel holds open at once (lib/panel.mjs MAX_TERMINALS, which a test
 *  holds this to). */
export const TAB_LIMIT = 4;
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
  if (s.spawn !== null) s = next(s, { spawn: null });
  if (s.view === "act" && s.act !== null) { effect = { dismiss: s.act.n }; s = next(s, { view: "instances", back: "instances", act: null }); }
  if (s.view === "help") s = next(s, { view: s.back });
  // The open field is the shown view's: kept before that view is left (the Souls view's too).
  const field = fieldOf(s);
  if (field) s = field.close(s, field.query(s).trim());
  if (s.view === "souls" || s.view === "capabilities") s = s.open === null ? toSwitcher(next(s, { back: "switcher" })) : next(s, { view: "instances", back: "instances" });
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
    // A close from the terminal's focus gives that focus, and the zoom, to the tab shown next
    // (Settled 6 of T2): both are taken before settling, which gives the list the focus.
    const step = terminalKey(settledState.state, does, inTerminal ? "terminal" : "list", inTerminal && t.zoom);
    return { state: step.state, effect: both(settledState.effect, step.effect) };
  }
  // The tabs, from any focus: the one shown next keeps the focus and the zoom it had.
  if (does === "tab-previous" || does === "tab-next") {
    // At either end, or while a tab starts, nothing at all: not even the settling, which would
    // take the focus from the terminal.
    if (tabStepped(state, does === "tab-previous" ? -1 : 1).effect === null) return stay;
    const settledState = toInstances(state);
    if (settledState.state.view !== "instances") return stay;
    const step = tabStepped(settledState.state, does === "tab-previous" ? -1 : 1, { focus: inTerminal ? "terminal" : "list", zoom: inTerminal && t.zoom });
    return { state: step.state, effect: both(settledState.effect, step.effect) };
  }
  // The split's keys, from any focus: nothing at all when they do not apply (splitRefused).
  if (SPLIT_KEYS.includes(does)) {
    const refused = splitRefused(state, does, event.panel, inTerminal);
    if (refused === true) return stay;
    if (refused !== null) return { state: next(state, { outcome: refused }), effect: null };
    const settledState = toInstances(state);
    if (settledState.state.view !== "instances") return stay;
    const step = splitKey(settledState.state, does, inTerminal);
    return { state: step.state, effect: both(settledState.effect, step.effect) };
  }
  if (does === "previous" || does === "next") return stepped(state, does === "previous" ? -1 : 1, event);
  // Another of the open terminal's soul, from its focus; from anywhere else, of the selection's.
  // The Souls view's selected soul is named before the list is shown, which leaves that view.
  if (does === "spawn" || does === "spawn-another") {
    const target = spawnTarget(state, inTerminal ? t.id : state.selected);
    const settledState = toList(state);
    const step = spawnAsked(settledState.state, event, does, target);
    return { state: step.state, effect: both(settledState.effect, step.effect) };
  }
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
  // A soul: the Souls view, with it selected. A kept filter of the view that hides it is cleared:
  // the soul chosen is the one shown, and the one `i` acts on.
  if (item.kind === "soul") {
    const step = soulsShown(shut), chosen = soulsWith(step.state, { selected: item.name, loose: false, detailTop: 0 });
    const shown = soulsOf(chosen).selected?.name === item.name ? chosen : soulsWith(chosen, { filter: Object.freeze({ editing: false, query: "" }), top: 0 });
    return then({ state: shown, effect: step.effect });
  }
  if (item.kind === "instance" || item.kind === "act") {
    const row = shut.view === "instances" ? roster(shut).instances.find((each) => instanceId(each) === item.id) : undefined;
    if (!row) return settled;
    if (item.does === "spawn-another") return then(spawnAsked(shut, event, item.does, { id: item.id }));
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
  if (event.shown !== undefined) return state.tabs.some((tab) => tab.id === event.shown.id) ? { state: tabWith(state, event.shown.id, { status: "open" }), effect: null } : stay;
  // A hidden tab's agent wrote (the panel says so once per hidden spell): its mark.
  if (event.activity !== undefined) return state.terminal?.id !== event.activity.id && state.tabs.some((tab) => tab.id === event.activity.id && !tab.activity) ? { state: tabWith(state, event.activity.id, { activity: true }), effect: null } : stay;
  if (event.entry !== undefined) return took(state, event);
  if (event.roster !== undefined) return heard(state, event.roster);
  if (event.collecting !== undefined) return { state: event.collecting === state.collecting ? state : next(state, { collecting: event.collecting === true }), effect: null };
  // The rows stay where they are: only what they read changes.
  if (event.retiring !== undefined) return { state: next(state, { retiring: new Set(event.retiring) }), effect: null };
  if (event.offered !== undefined) return { state: next(state, { offered: Object.freeze({ offered: Object.freeze([...event.offered.offered]), limited: event.offered.limited === true }) }), effect: null };
  if (event.admitted !== undefined) return { state: admitted(state, event), effect: { refresh: { live: true } } };
  if (event.refused !== undefined) return { state: next(state, { switcher: Object.freeze({ ...state.switcher, refused: event.refused }) }), effect: null };
  if (event.souls !== undefined) return soulsHeard(state, event.souls);
  if (event.spawnRead !== undefined) return spawnRead(state, event.spawnRead);
  if (event.spawnDrawn !== undefined) return spawnDrawn(state, event.spawnDrawn);
  if (event.spawnTop !== undefined) return spawnTop(state, event.spawnTop);
  if (event.spawnProgress !== undefined) return { state: state.spawning?.phase === "submitting" ? next(state, { spawning: Object.freeze({ ...state.spawning, phase: "spawning" }) }) : state, effect: null };
  if (event.spawnDone !== undefined) return spawnDone(state, event.spawnDone);
  // An action the leader or the palette runs comes as `{ action }`, with no key: whatever field or
  // confirmation was open has been settled first.
  const given = event.action !== undefined;
  if (!given && state.palette !== null) return inPalette(state, event, keymap);
  if (!given && state.spawn !== null) return inSpawn(state, event, keymap);
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
    // In the Souls view it reads the souls again, and nothing else.
    case "refresh": return state.view === "souls" ? inSouls(state, action, event, page, scrolled) : { state, effect: { refresh: { live: true }, ...((state.view === "help" ? state.back : state.view) === "switcher" ? { offer: true } : {}) } };
    case "help": return { state: next(state, state.view === "help" ? { view: state.back } : { view: "help", back: state.view, helpTop: 0 }), effect: null };
    case "workspaces": return state.view === "switcher" ? stay : { state: toSwitcher(next(state, { back: "switcher" })), effect: { offer: true } };
    case "palette": return { state: paletteOpened(state, event, "list"), effect: null };
    // Souls and Capabilities are views of this machine, whatever workspace is open, or none.
    case "souls": return soulsShown(state);
    case "capabilities": return { state: state.view === action ? state : next(state, { view: action, back: action }), effect: null };
    // A spawn starts from the list of instances or the Souls view (the leader reaches them from anywhere).
    case "spawn": case "spawn-another": return state.view === "instances" || state.view === "souls" ? spawnAsked(state, event, action, spawnTarget(state)) : stay;
    case "spawn-check": return spawnChecked(state);
    default:
  }
  if (state.view === "souls") return inSouls(state, action, event, page, scrolled);
  if (state.view === "capabilities") {
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
    if (state.filter.query !== "" || state.filter.soul) return { state: rehomed(roster(state), next(state, { filter: NO_FILTER, top: 0, loose: false })), effect: null };
    return state.focus === "detail" ? { state: next(state, { focus: "list" }), effect: null } : stay;
  }
  const r = roster(state, undefined, Number.isInteger(event.cols) ? event.cols : undefined);
  const at = indexOf(r, state.selected);
  switch (action) {
    // A soul filter gives way to the text one.
    case "filter": return { state: rehomed(roster(state), next(state, { focus: "list", filter: Object.freeze({ editing: true, query: state.filter.query }) })), effect: null };
    case "open": return at < 0 ? stay : openAgent(state, r.items[at].row);
    case "zoom": case "close-terminal": return terminalKey(state, action);
    case "tab-previous": case "tab-next": return tabStepped(state, action === "tab-previous" ? -1 : 1);
    case "split-right": case "split-down": case "group-next": case "tab-move": case "group-close": {
      const refused = splitRefused(state, action, event.panel);
      return refused === true ? { state, effect: null } : refused !== null ? { state: next(state, { outcome: refused }), effect: null } : splitKey(state, action, false);
    }
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

// ── SPAWNING (docs/tui.md, "Spawning an agent"; Spec 6-spawn) ───────────────────────────────────

/** The longest name the name field takes: the kernel's instance-name limit (spawn-preview-contract
 *  INSTANCE_NAME_MAX). The preview says when the soul's name and the dash leave less room. */
const NAME_LIMIT = 64;
/** What the name field takes as typed: the characters an instance name is made of. */
const NAME_TEXT = /^[A-Za-z0-9-]+$/;
/** The prompt with what changes of it. */
const spawnWith = (state, changes) => next(state, { spawn: Object.freeze({ ...state.spawn, ...changes }) });
/** A line of its own, and nothing else. */
const said = (state, parts) => ({ state: next(state, { outcome: { said: parts, under: [] } }), effect: null });
const remoteRow = (row) => typeof row?.server === "string" && row.server !== "";
/** The parent a prompt can offer ("child of"): the selected instance of this workspace when it
 *  opened, as the shared relation anchors it. */
const anchorOf = (row) => (row && !remoteRow(row) ? Object.freeze({ id: instanceId(row), instance: row.instance, agent: row.agent, agentsRoot: row.agentsRoot }) : null);

/** What n and N are of, named in the view they were pressed in: the Souls view's selected soul
 *  (`{ souls: row|null }`), else instance `id` (the selection's, or the open terminal's). */
function spawnTarget(state, id = state.selected) {
  if ((state.view === "help" ? state.back : state.view) === "souls") return { souls: soulsOf(state).selected };
  return { id };
}

/** n, N, the leader's n and N, and the palette's two rows (docs/tui.md, "Spawning an agent").
 *  One spawn at a time: while one is under way the line says so and nothing opens. Only this
 *  machine's workspace is offered: on another machine's workspace or row the line says so.
 *  n opens the soul picker, and N the preview of the soul of instance `target.id` (the selection's,
 *  or the open terminal's from its focus); from the Souls view (`target.souls`) both start from
 *  its selected soul, at the preview. The catalog is wanted from now on (settled for the open
 *  workspace, as the Souls view settles it). `read`: the read of input the prompt opened in, whose
 *  Enter does nothing. */
function spawnAsked(state, event, verb, target) {
  const stay = { state, effect: null };
  if (state.open === null) return stay;
  if (state.spawning !== null) return said(state, SPAWN_WORDS.busy(state.spawning.name));
  if (!state.ctxs.includes(state.open)) return said(state, SPAWN_WORDS.remote());
  const fromSouls = Object.hasOwn(target, "souls"), id = fromSouls ? null : target.id;
  const row = state.view === "instances" && id !== null ? roster(state).instances.find((each) => instanceId(each) === id) ?? null : null;
  // Settled 9: on another machine's row, neither n nor N opens anything of this one.
  if (row !== null && remoteRow(row)) return said(state, SPAWN_WORDS.remote());
  let soul = null, wanted = null;
  if (fromSouls) {
    if (target.souls) soul = Object.freeze({ name: target.souls.name, agentsRoot: target.souls.agentsRoot });
  } else if (verb === "spawn-another") {
    if (row === null) return stay;
    wanted = row.agent;
  }
  const preview = soul !== null || wanted !== null;
  const prompt = Object.freeze({
    workspace: state.open, step: preview ? "preview" : "picker", read: Number.isInteger(event.read) ? event.read : null,
    back: preview && (verb === "spawn-another" || fromSouls) ? "list" : "picker",
    query: "", selected: null, soul, wanted, anchor: anchorOf(row),
    name: "", nameRead: "", child: false, focus: "spawn", folds: Object.freeze([]), top: 0,
    n: 0, asked: null, status: preview ? "souls" : null, data: null, reason: null, shownIn: null, readKey: null, problem: null,
  });
  const opened = soulsWith(next(state, { spawn: prompt, outcome: null }), { wanted: true });
  const step = preview ? (soul ? previewAsked(opened) : soulFound(opened)) : { state: opened, effect: null };
  return { state: step.state, effect: both({ souls: "settle" }, step.effect) };
}

/** A preview read asked of the loop (`spawnPreview`), numbered in the run (`previews`), not in the
 *  prompt: only the answer to the last one is taken, and never one asked by a prompt closed since.
 *  What was on screen stays while it is read, as stale, and Spawn is not armed until the answer
 *  is drawn (`spawnDrawn`). */
function previewAsked(state) {
  const p = state.spawn, n = state.previews + 1;
  const request = { action: "preview", selector: spawnSelector(p), choices: spawnChoices(p) };
  return { state: spawnWith(next(state, { previews: n }), { n, asked: spawnChoicesKey(p), nameRead: p.name, status: "reading", shownIn: null }), effect: { spawnPreview: { n, workspace: p.workspace, request } } };
}

/** N's soul, found in the workspace's catalog once it is held: the preview is read for it. A
 *  catalog that does not list it says so, and there is nothing to read or to spawn. */
function soulFound(state) {
  const p = state.spawn, found = soulOfAgent(state, p.workspace, p.wanted);
  if (found) return previewAsked(spawnWith(state, { soul: Object.freeze({ name: found.name, agentsRoot: found.agentsRoot }) }));
  const held = state.souls.held.get(p.workspace)?.entry ?? null;
  if (!Array.isArray(held?.souls)) return { state, effect: null }; // still read
  return { state: spawnWith(state, { status: "failed", reason: null, problem: { said: SPAWN_WORDS.noSoul(p.wanted), under: [] } }), effect: null };
}

/** The preview's answer (`{ n, answer }`): taken only for the last read asked. One the workspace
 *  moved under is read again at once, as its shared words say. An answer taken is not yet seen:
 *  Spawn is armed only once a frame that shows it ready is written (`spawnDrawn`). */
function spawnRead(state, { n, answer }) {
  const p = state.spawn;
  if (p === null || p.step !== "preview" || p.n !== n) return { state, effect: null };
  if (answer?.status === "available") return { state: spawnWith(state, { status: "shown", data: answer.data, reason: null, readKey: p.asked, shownIn: null }), effect: null };
  if (answer?.reason?.code === "E_TARGET_CHANGED") return previewAsked(state);
  return { state: spawnWith(state, { status: "failed", reason: answer?.reason ?? null, readKey: null }), effect: null };
}

/** A frame was written that shows preview `n` ready, its Spawn button on the screen
 *  (`{ n, read }`, `read` the number of the last read of input before that frame): the paste guard
 *  (inSpawn) takes Enter on Spawn only from a later read. Kept from the first such frame. */
function spawnDrawn(state, { n, read }) {
  const p = state.spawn;
  if (p === null || p.step !== "preview" || p.n !== n || p.shownIn !== null || !spawnReady(p) || !Number.isInteger(read)) return { state, effect: null };
  return { state: spawnWith(state, { shownIn: read }), effect: null };
}

/** The preview's window as a frame painted it (`{ n, top }`): it keeps the fold with the focus in
 *  sight, so it may stand where `top` does not. Taken once for each frame painted, `top` is then
 *  that window, and the movement keys go on from it, each from where the one before left it,
 *  painted or not (round 1 of the polish's review). */
function spawnTop(state, { n, top }) {
  const p = state.spawn;
  if (p === null || p.step !== "preview" || p.n !== n || !Number.isInteger(top) || top < 0 || p.top === top) return { state, effect: null };
  return { state: spawnWith(state, { top }), effect: null };
}

/** The name field's text left as it is now: when it is not what the preview was read with, the
 *  preview is read again. A changed choice puts away what an earlier spawn's outcome said. */
function nameKept(state) {
  const p = state.spawn;
  if (p.name === p.nameRead) return { state, effect: null };
  return previewAsked(spawnWith(state, { nameRead: p.name, problem: null }));
}

/** A key or a paste while the prompt is open.
 *  THE PICKER, as the palette: text and a paste's first line go to the query, Backspace takes a
 *  grapheme off it, Up and Down (PageUp, PageDown) move, Enter picks the selected soul (one whose
 *  spawn would be refused is not picked), Esc closes the prompt.
 *  THE PREVIEW (Settled 1): one focus ring, Spawn, the name, child of, each fold; Tab and Shift+Tab
 *  move along it. Enter does what the focus says: spawns, keeps the name and reads the preview
 *  again, toggles the parent, opens or closes a fold. On the name, text and a paste's first line
 *  are the name's (the characters of an instance name only), and Esc puts back the name the
 *  preview was read with; Esc elsewhere gives the focus to Spawn, and on Spawn backs out (to the
 *  picker, or to the list for N and from the Souls view). The movement keys scroll it.
 *  quit, suspend and redraw keep their actions where no text is typed.
 *  THE PASTE GUARD (Settled 2): Enter in the read of input the prompt opened in does nothing, and
 *  Enter on Spawn spawns only the preview read for the choices on screen, from a read of input
 *  later than the one in which that answer landed: a pasted `n…⏎⏎` stops at the preview. */
function inSpawn(state, event, keymap) {
  const p = state.spawn, stay = { state, effect: null };
  const action = typeof event.key === "string" ? keymap.get(event.key) : undefined;
  const sameRead = p.read !== null && event.read === p.read;
  if (p.step === "picker") {
    const query = (text) => (text === p.query ? stay : { state: spawnWith(state, { query: text, selected: null }), effect: null });
    if ("paste" in event) return typeof event.paste === "string" ? query(typed(p.query, event.paste.split(LINE_END)[0])) : stay;
    if (typeof event.text === "string") return query(typed(p.query, event.text, { key: true }));
    if (event.key === "backspace") return query([...GRAPHEMES.segment(p.query)].map((g) => g.segment).slice(0, -1).join(""));
    if (event.key === "escape" || action === "close") return { state: next(state, { spawn: null }), effect: null };
    if (action === "quit" || action === "suspend" || action === "redraw") return { state, effect: action };
    const list = spawnPickerItems(state), names = list.items.map((item) => item.name);
    if (Object.hasOwn(PALETTE_MOVES, event.key)) {
      if (!names.length) return stay;
      const page = Math.max(1, (Number.isInteger(event.page) ? event.page : 1) - 2);
      const from = Math.max(0, names.indexOf(list.selected));
      return { state: spawnWith(state, { selected: names[Math.min(Math.max(0, moved(PALETTE_MOVES[event.key], from, names.length, page)), names.length - 1)] }), effect: null };
    }
    if (event.key !== "enter" || sameRead) return stay;
    const item = list.items.find((each) => each.name === list.selected);
    if (!item || item.refused) return stay;
    return previewAsked(spawnWith(state, { step: "preview", selected: item.name, soul: Object.freeze({ name: item.row.name, agentsRoot: item.row.agentsRoot }), focus: "spawn", folds: Object.freeze([]), top: 0, data: null, reason: null, shownIn: null, readKey: null, problem: null }));
  }
  const ring = spawnRing(p);
  const focus = ring.includes(p.focus) ? p.focus : "spawn";
  const moveFocus = (by) => { const to = ring[(ring.indexOf(focus) + by + ring.length) % ring.length]; return to === focus ? state : spawnWith(state, { focus: to }); };
  if (focus === "name") {
    const name = (text) => (text === p.name ? stay : { state: spawnWith(state, { name: text }), effect: null });
    const fits = (text) => text !== "" && NAME_TEXT.test(text) && p.name.length + text.length <= NAME_LIMIT;
    if ("paste" in event) { const line = typeof event.paste === "string" ? event.paste.split(LINE_END)[0] : ""; return fits(line) ? name(p.name + line) : stay; }
    if (typeof event.text === "string") return fits(event.text) ? name(p.name + event.text) : stay;
    if (event.key === "backspace") return name(p.name.slice(0, -1));
    if (action === "quit" || action === "suspend" || action === "redraw") return { state, effect: action };
    if (event.key === "escape") return { state: spawnWith(state, { name: p.nameRead, focus: "spawn" }), effect: null };
    if (event.key === "enter") return nameKept(spawnWith(state, { focus: "spawn" }));
    if (event.key === "tab" || event.key === "shift+tab") return nameKept(moveFocus(event.key === "tab" ? 1 : -1));
    return stay;
  }
  if ("paste" in event) return stay;
  if (event.key === "tab" || event.key === "shift+tab") return { state: moveFocus(event.key === "tab" ? 1 : -1), effect: null };
  if (event.key === "escape" || action === "close") {
    if (focus !== "spawn") return { state: spawnWith(state, { focus: "spawn" }), effect: null };
    return { state: p.back === "picker" ? spawnWith(state, { step: "picker", problem: null, status: null, data: null, readKey: null }) : next(state, { spawn: null }), effect: null };
  }
  if (action === "quit" || action === "suspend" || action === "redraw") return { state, effect: action };
  if (MOVES.includes(action)) {
    const count = event.extent ?? 0, height = event.room ?? 1;
    const from = windowOf({ top: p.top, count, height }).top;
    return { state: spawnWith(state, { top: windowOf({ top: moved(action, from, count, height), count, height }).top }), effect: null };
  }
  if (event.key !== "enter" || sameRead) return stay;
  if (focus === "child") return previewAsked(spawnWith(state, { child: !p.child, problem: null }));
  if (focus.startsWith("fold:")) {
    const key = focus.slice("fold:".length);
    return { state: spawnWith(state, { folds: Object.freeze(p.folds.includes(key) ? p.folds.filter((each) => each !== key) : [...p.folds, key]) }), effect: null };
  }
  if (p.status === "failed") return p.soul === null ? stay : previewAsked(state);
  if (!spawnReady(p) || p.shownIn === null || !Number.isInteger(event.read) || event.read <= p.shownIn) return stay;
  return spawnPressed(state);
}

/** Enter on Spawn, the preview ready: the prompt closes, and the loop is asked to spawn it
 *  (`spawn`): the prepare body the TUI builds (Settled 4), and the decision on screen, which is
 *  the only one applied. The line says what is under way until its outcome. */
function spawnPressed(state) {
  const p = state.spawn, selector = spawnSelector(p), choices = spawnChoices(p);
  // The kernel's name for it (a purpose typed is put after the soul's name), for the lines that follow.
  const name = p.data.instance || p.name || p.soul.name;
  const spawning = Object.freeze({ name, soul: p.soul.name, workspace: p.workspace, phase: "submitting", prompt: p });
  const spawn = { workspace: p.workspace, selector, input: { action: "prepare", selector, choices, task: "" }, decision: structuredClone(p.data.decision), name };
  return { state: next(state, { spawn: null, spawning, spawnCheck: null, outcome: null }), effect: { spawn } };
}

/** C, while a check of an outcome not known is offered: the loop reads its result once
 *  (`spawnCheck`); an unknown result applies the same reference again, never a new one. */
function spawnChecked(state) {
  const c = state.spawnCheck;
  if (c === null || state.spawning !== null) return { state, effect: null };
  return { state: next(state, { spawnCheck: null, spawning: Object.freeze({ name: c.name, soul: c.soul, workspace: c.workspace, phase: "checking", prompt: c.prompt }), outcome: null }), effect: { spawnCheck: true } };
}

/** Whether the person is busy elsewhere: an outcome then says what to do, and nothing opens over
 *  what they are doing. */
const free = (state) => state.palette === null && state.spawn === null && state.act === null && state.opening === null && (state.view === "instances" || state.view === "souls");

/** A spawn's outcome (`{ kind, view, reason, instance, home }`, the shared transaction's, with the
 *  instance it is of), as Done 5 says each:
 *    created, complete and launched: the instances are read at once, and the new row is waited
 *      for (`arriving`, see `arrived`); its terminal opens with the focus;
 *    created otherwise: the shared words, and nothing opens;
 *    unknown, pending-expired, cleanup-owed: the shared words; a check is offered where they name one;
 *    drifted, refused, rolled-back, never-submitted: the shared words, and the preview again (read
 *      again, with the choices as they were), unless the person is busy elsewhere. */
function spawnDone(state, { kind, view = null, reason = null, instance = null, home = null }) {
  const s = state.spawning;
  if (s === null) return { state, effect: null };
  const name = instance ?? s.name, settled = next(state, { spawning: null });
  const words = kind === "unknown" || kind === "refused" ? spawnProblem(reason, "spawn") : outcomeWords(kind, view, name);
  const line = spawnLine(words, name, state.actions);
  const refresh = { refresh: { live: true } };
  if (kind === "created") {
    const launched = view?.status === "complete" && view.receipt?.launched !== false;
    const arriving = launched ? Object.freeze({ workspace: s.workspace, instance: name, home, agentsRoot: s.prompt.soul.agentsRoot, agent: view.receipt?.agent ?? s.soul, reads: 0, words }) : null;
    return { state: next(settled, { arriving, outcome: launched ? null : line }), effect: refresh };
  }
  if (["unknown", "pending-expired", "cleanup-owed"].includes(kind)) {
    const spawnCheck = words?.next === "check-result" ? Object.freeze({ name, soul: s.soul, workspace: s.workspace, prompt: s.prompt }) : null;
    return { state: next(settled, { spawnCheck, outcome: line }), effect: refresh };
  }
  if (!free(settled) || !settled.ctxs.includes(s.workspace) || settled.open !== s.workspace) return { state: next(settled, { outcome: line }), effect: refresh };
  const back = next(settled, { spawn: Object.freeze({ ...s.prompt, read: null, focus: "spawn", problem: line, data: null, readKey: null, shownIn: null }) });
  const step = previewAsked(back);
  return { state: step.state, effect: both(refresh, step.effect) };
}

/** A read of the workspace a spawn created an instance in (Settled 5): when its row is there and
 *  can be opened, it is selected and its terminal opened with the focus, in the Instances view, as
 *  the palette's open does (a filter that hides it is cleared). Not yet, after two reads: the line
 *  says so. The person busy elsewhere, or another workspace open: the line says it was created. */
function arrived(state) {
  const a = state.arriving, row = spawnedRow(state, a);
  if (row && openDecision(state, row, instanceActs(row)).open) {
    const done = next(state, { arriving: null });
    if (!free(done) || done.open !== a.workspace) return { state: next(done, { outcome: spawnLine({ ...a.words, next: a.words?.next ?? "open-from-list" }, a.instance, state.actions) }), effect: null };
    const settledState = toInstances(done), id = instanceId(row);
    // Every tab taken (Settled 7 of T2): the created line, then the cap's; nothing opens.
    if (!done.tabs.some((tab) => tab.id === id) && done.tabs.length >= TAB_LIMIT) {
      const created = spawnLine({ ...a.words, next: null }, a.instance, state.actions), full = fullLine(done);
      const said = created?.said.length ? [...created.said, { own: " " }, ...full.said] : full.said;
      return { state: next(done, { outcome: Object.freeze({ said: Object.freeze(said), under: created?.under ?? [] }) }), effect: null };
    }
    let s = settledState.state;
    if (!roster(s).index.has(id)) s = rehomed(roster(s), next(s, { filter: NO_FILTER, top: 0, loose: false }));
    const shown = roster(s).instances.find((each) => instanceId(each) === id) ?? row;
    const step = openAgent(next(s, { selected: id, loose: false, detailTop: 0 }), shown);
    return { state: step.state, effect: both(settledState.effect, step.effect) };
  }
  const reads = a.reads + 1;
  if (reads < 2) return { state: next(state, { arriving: Object.freeze({ ...a, reads }) }), effect: null };
  return { state: next(state, { arriving: null, outcome: spawnLine(outcomeWords("not-yet-visible", null, a.instance), a.instance, state.actions) }), effect: null };
}
