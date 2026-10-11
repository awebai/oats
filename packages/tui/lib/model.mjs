// From the store's state to what is drawn: the roster in its order, the rows of the pane and the
// facts of the selected instance. Pure, and without a cell position: the views place it.
//
// Everything that groups, orders, hides or names an instance is asked of the shared home
// (client.mjs), the same functions the Desktop draws from: this module calls them and flattens
// their answers, and holds no rule of its own about which group a row is in or what state it is
// in. What it adds is the TUI's: the window, the clock times, and which fact stands on which line.
import {
  TERMS, panelData, displayLine, instanceId, instanceVisibleInTree, waitingRollup, collapseKey, filterInstanceTree,
  hasInstanceChildren, heldHome, rosterSections, deploymentState, rowStale, primaryDeployment, runtimeState, runtimeCounts,
  waitingClaim, waitingLabel, waitedText, waitingClock, waitingBelowText, instanceActs,
} from "./client.mjs";
import { textWidth } from "./term/width.mjs";
import { windowOf } from "./views/scroll.mjs";

/** The widest the state column of the list may be, in cells. */
export const WORD_MAX = 20;

/** The remembered machines of other deployments: this version has none. */
const REMEMBERED = Object.freeze({ get: () => null, note: () => null, all: () => [] });

/** The panel of the one deployment: the composition the Desktop's own panel is served from
 *  (panel-views.mjs `panelData`), so nothing of it is put together by hand here. `held` is what
 *  that function reads of a client, built here and nowhere else; `at` is the ISO time of the
 *  call, read by the caller. */
export function panelOf(state, at) {
  const held = {
    ctxs: [state.deployment], snapshot: { byWs: new Map([[state.deployment, state.entry]]) }, remoteGroups: [],
    remembered: REMEMBERED, rosterAnswered: true, rosterFailure: null, cli: state.cli,
    observing: new Set(), remoteCollecting: false, home: state.home, at,
  };
  return panelData(held, state.deployment, TERMS);
}

const text = (value) => typeof value === "string" && value !== "";
const pad = (n) => String(n).padStart(2, "0");
/** An ISO time as a local clock time, `14:03:27`, or null. */
export function clockTime(iso) {
  const at = new Date(iso);
  return text(iso) && Number.isFinite(at.getTime()) ? `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}` : null;
}

/** A row's state in a word: the one the kernel or the collector reported on the row, else the
 *  shared word for what is known of it (running, stopped, unknown). */
const stateWord = (row) => (text(row.runtimeState) ? row.runtimeState : runtimeState(row));
/** What a list row shows at its right edge: a held home's state, the harness of a running
 *  instance, else its state. */
function wordOf(row) {
  const held = heldHome(row);
  if (held) return held.state;
  return row.running === true && text(row.harness) ? row.harness : stateWord(row);
}
/** Which mark a row carries: the shared word, `held` for a home the kernel holds, and `shell`
 *  for a stopped instance whose terminal still has a shell in it. */
function markOf(row) {
  if (heldHome(row)) return "held";
  const word = runtimeState(row);
  return word === "stopped" && row.runtimeState === "shell" ? "shell" : word;
}

/** The group of instances that are related to no other, as the shared grouping names it. */
const SINGLES = "independent";

function build(state, at) {
  const panel = panelOf(state, at);
  const instances = panel.instances, deployments = panel.deployments;
  const query = state.filter.query, filtering = query.trim() !== "";
  const matched = filterInstanceTree(instances, query);
  const visible = matched.filter((i) => instanceVisibleInTree(i, instances, state.collapsed, state.deployment, filtering));
  const sections = rosterSections(instances, visible, deployments, TERMS);
  // The groups in the order given, every cluster's members in order. No heading: one deployment
  // is one section. One empty item stands before the group of single instances when clusters
  // came before it.
  const items = [];
  for (const section of sections) for (const group of section.groups) {
    if (group.key === SINGLES && items.length) items.push(null);
    for (const cluster of group.clusters) for (const row of cluster.instances) items.push({ row, id: instanceId(row), depth: Number.isInteger(row.depth) ? row.depth : 0 });
  }
  const rows = items.filter(Boolean);
  const index = new Map(items.flatMap((item, i) => (item ? [[item.id, i]] : [])));
  const stale = (row) => rowStale(row, deployments);
  const state_ = deploymentState(primaryDeployment(deployments));
  const status = panel.deployment?.status;
  const live = state_.key === "live";
  const counted = runtimeCounts(instances);
  const waiting = instances.filter((row) => waitingClaim(row, { stale: stale(row) })).length;
  const withheld = Array.isArray(panel.deployment?.withheld) ? panel.deployment.withheld.length : 0;
  return {
    panel, instances, deployments, items, rows, index, filtering, stale,
    below: waitingRollup(instances, state.collapsed, state.deployment, { filtering, stale }),
    status,
    workspace: text(panel.workspace?.name) ? panel.workspace.name : "",
    // The counts in the order they are drawn. `shared`: the word is the shared home's.
    counts: [
      ...Object.entries(counted).slice(0, 1).map(([word, n]) => ({ n, word, shared: true })),
      { n: waiting, word: waiting === 1 ? "needs input" : "need input", shared: false },
      ...Object.entries(counted).slice(1).map(([word, n]) => ({ n, word, shared: true })),
      { n: withheld, word: "withheld", shared: false },
    ].filter((count) => count.n > 0),
    // The time of the read the screen shows: the cycle's own (`generatedAt`), never
    // `observedAt`, which is when the kernel last looked at the workspace's remotes and is up
    // to a minute older on a read in the background. Nothing drawn here comes from the remotes.
    readAt: live ? clockTime(panel.generatedAt) : null,
    // A deployment that is not live says so above the list, with why. Before the first answer
    // the list holds the TUI's own line instead: the shared sentence for that moment names an
    // installed CLI, and the TUI runs its own kernel.
    // `since`: an entry kept over a failed read carries the time of its last good read. An
    // unavailable entry carries only the time of the cycle that failed, which is no "since".
    notice: live || status === "pending" ? null : { text: state_.text, since: status === "observed" ? clockTime(panel.generatedAt) : null, reason: state_.detail },
    empty: status === "pending" ? "reading" : status !== "observed" ? null : !instances.length ? "none" : !items.length ? "nomatch" : null,
    // As wide as the widest word among all the rows of the list, so the column does not move
    // while the list scrolls.
    wordWidth: Math.min(WORD_MAX, rows.reduce((widest, { row }) => Math.max(widest, textWidth(displayLine(wordOf(row)) ?? "")), 0)),
  };
}

/** One answer is kept: a repaint, a resize and a key that changes none of the entry, the collapse
 *  set and the filter read the roster again without asking the shared home again (its grouping
 *  walks the whole roster for each row). The state's values are never changed in place, so their
 *  identity says whether they changed. */
let kept = null;
/** The roster of a state: the rows in drawn order and what the header says. No terminal size is
 *  in it. `at` stamps a panel that has no entry, which never happens here; it is passed on. */
export function roster(state, at = state.entry?.generatedAt) {
  const same = kept && kept.entry === state.entry && kept.collapsed === state.collapsed && kept.query === state.filter.query
    && kept.deployment === state.deployment && kept.cli === state.cli && kept.home === state.home;
  if (!same) kept = { entry: state.entry, collapsed: state.collapsed, query: state.filter.query, deployment: state.deployment, cli: state.cli, home: state.home, value: build(state, at) };
  return kept.value;
}

/** Whether a row has instances below it, and whether they are folded away. A filter shows every
 *  match whatever is collapsed, and leaves the collapse set as it is. */
export function disclosure(state, r, item) {
  if (!hasInstanceChildren(r.instances, item.row)) return null;
  return !r.filtering && state.collapsed.has(collapseKey(state.deployment, item.id)) ? "closed" : "open";
}

function listRow(state, r, item) {
  const fold = disclosure(state, r, item);
  return {
    id: item.id, name: item.row.instance, depth: item.depth, selected: item.id === state.selected,
    disclosure: fold, mark: markOf(item.row), word: wordOf(item.row),
    waiting: waitingClaim(item.row, { stale: r.stale(item.row) }) !== null,
    below: fold === "closed" ? r.below.get(item.id)?.length ?? 0 : 0,
  };
}

/** The facts of one instance, a label and a value per line; a fact that is absent is left out.
 *  `form`: `line` (one row), `wrap` (a sentence, on as many rows as it needs), `end` (read from
 *  its end: a path). A fact with no label continues the one above it. Every value is text the
 *  TUI did not write, or holds some: the view draws all of them through shown(). `now` is the
 *  time of the paint, so the waited time is right whenever the screen is drawn. */
function detailOf(state, r, item, now) {
  const row = item.row, facts = [];
  const add = (label, value, form = "line") => { if (text(value)) facts.push({ label, value, form }); };
  add("soul", row.agent);
  add("state", heldHome(row)?.state ?? stateWord(row)); // the word of its list row, harness apart
  if (text(row.runtimeError)) add("", `"${row.runtimeError.trim()}"`, "wrap"); // a command's message ends in a newline
  const acts = instanceActs(row), held = acts.blocked ?? acts.limited;
  if (held) add("held", held.sentence, "wrap");
  const claim = waitingClaim(row, { stale: r.stale(row) });
  if (claim) {
    add("needs", `${waitingLabel(claim)}, ${waitedText(claim.since, now)}`);
    if (text(claim.message)) add("", `the agent: "${claim.message.trim()}"`, "wrap");
  }
  const under = disclosure(state, r, item) === "closed" ? r.below.get(item.id) : null;
  if (under?.length) add("below", waitingBelowText(under), "wrap");
  add("harness", `${[row.harness, row.model].filter(text).join(", ")}${text(row.model) && text(row.modelFrom) ? ` (${row.modelFrom})` : ""}`);
  add("work", [row.work, row.branch].filter(text).join(", "));
  add("team", row.team);
  add("parent", [row.parentInstance, text(row.siblingInstance) ? `sibling of ${row.siblingInstance}` : null].filter(text).join(", "));
  if (text(row.startedAt)) add("started", waitingClock(row.startedAt, now));
  add("home", row.home, "end");
  return { title: row.instance, facts };
}

/** What the views draw for a state, in a list pane `page` rows tall: the header's facts, the rows
 *  of the window with their marks, and the selected instance's detail. Only the rows in the pane
 *  are worked out. */
export function model(state, { page, now, at }) {
  const r = roster(state, at);
  const selected = state.selected === null ? -1 : r.index.get(state.selected) ?? -1;
  const win = windowOf({ top: state.top, count: r.items.length, height: page, keep: selected });
  return {
    view: state.view, focus: state.focus, ascii: state.ascii, actions: state.actions, filter: state.filter,
    workspace: r.workspace, counts: r.counts, readAt: r.readAt, notice: r.notice, empty: r.empty, observed: r.status === "observed",
    list: r.items.slice(win.top, win.top + win.size).map((item) => item && listRow(state, r, item)),
    above: win.above, below: win.below, wordWidth: r.wordWidth,
    detail: selected >= 0 ? detailOf(state, r, r.items[selected], now) : null,
    detailTop: state.detailTop, helpTop: state.helpTop,
  };
}
