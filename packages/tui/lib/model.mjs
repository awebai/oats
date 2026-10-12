// From the store's state to what is drawn: the roster in its order, the rows of the pane and the
// facts of the selected instance. Pure, and without a cell position: the views place it.
//
// Everything that groups, orders, hides or names an instance is asked of the shared home
// (client.mjs), the same functions the Desktop draws from: this module calls them and flattens
// their answers, and holds no rule of its own about which group a row is in or what state it is
// in. What it adds is the TUI's: the window, the clock times, and which fact stands on which line.
import {
  TERMS, panelData, displayLine, instanceId, instanceVisibleInTree, waitingRollup, collapseKey, filterInstanceTree,
  hasInstanceChildren, heldHome, rosterSections, deploymentState, rowStale, primaryDeployment, isMultiDeployment, runtimeState, runtimeCounts,
  waitingClaim, waitingLabel, waitedText, waitingClock, waitingBelowText, instanceActs,
  identityMemory, viewModel, workspaceChoices, workspaceChoiceRows, choiceMatches, UNMATCHED_SECTION, shortPath,
} from "./client.mjs";
import { shownLines } from "./term/text.mjs";
import { textWidth } from "./term/width.mjs";
import { windowOf } from "./views/scroll.mjs";

/** The widest the state column of the list may be, in cells. */
export const WORD_MAX = 20;
/** The most rows one sentence takes inside the list (a deployment's note, a reason). */
const SENTENCE_ROWS = 4;
/** The cells a sentence inside the list is set in from the pane's left edge. */
export const SENTENCE_INDENT = 3;
/** The width the list is flattened for when nobody says: only the rows that can be selected are
 *  read from such an answer, and they are the same at every width. */
const ANY_WIDTH = 80;

/** What the shared home reads of a client (panel-views.mjs `held`), built here and nowhere else.
 *  `snapshot.byWs` holds this machine's entries only: a machine's panel is made by the shared
 *  home itself from `remoteGroups`, stamped with `at`. So `at` is the time of the last roster
 *  outcome the store took (`rosterAt`): a machine's rows are what it reported then. Before any
 *  outcome there is no machine to stamp, and the time of the call stands in. */
export function heldOf(state, at) {
  return {
    ctxs: state.ctxs, snapshot: { byWs: state.entries }, remoteGroups: state.remote.remoteGroups,
    remembered: identityMemory({ memory: state.memory, notes: state.notes }),
    rosterAnswered: state.remote.rosterAnswered, rosterFailure: state.remote.rosterFailure, cli: state.cli,
    observing: new Set(), remoteCollecting: state.collecting, home: state.home, at: state.rosterAt ?? at,
  };
}

/** The panel of the view that holds `state.open`: the composition the Desktop's own panel is
 *  served from (panel-views.mjs `panelData`), so nothing of it is put together by hand here.
 *  Null while nothing is open (a run started outside a deployment, before a pick). */
export function panelOf(state, at) {
  return state.open === null ? null : panelData(heldOf(state, at), state.open, TERMS);
}

const text = (value) => typeof value === "string" && value !== "";
const pad = (n) => String(n).padStart(2, "0");
/** An ISO time as a local clock time, `14:03:27`, or null. */
export function clockTime(iso) {
  const at = new Date(iso);
  return text(iso) && Number.isFinite(at.getTime()) ? `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}` : null;
}

/** A row's state in a word: the one the kernel or the collector reported on the row, else the
 *  shared word for what is known of it (running, stopped, unknown). A row kept from a machine
 *  that was not reached (the shared home marks it) still carries the word of its last report,
 *  which is not its state now: it gets the shared word, so nothing reads as stopped, or as
 *  running, that is only not reached. */
const stateWord = (row) => (text(row.runtimeState) && row.serverUnreached !== true ? row.runtimeState : runtimeState(row));
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

/** Everything of a state that does not depend on a width: the panel, the rows as the shared
 *  grouping orders them, the headings, and what stands after the sections. */
function build(state, at) {
  const panel = panelOf(state, at);
  // No view holds what was open (a machine that is no longer listed): the store shows the
  // switcher for it; nothing is drawn from this answer.
  const gone = panel !== null && !panel.workspace;
  const instances = panel?.instances ?? [], deployments = panel?.deployments ?? [];
  const multi = isMultiDeployment(deployments);
  const query = state.filter.query, filtering = query.trim() !== "";
  // The section (deployment) each row is drawn in, read from the shared split itself: the
  // sections of all rows. A collapse hides, and rolls up, only rows of its own section, as in the
  // Desktop: a parent's name can resolve to a row of another deployment of the view.
  const sectionOf = new Map();
  for (const part of rosterSections(instances, instances, deployments, TERMS)) for (const group of part.groups) for (const cluster of group.clusters) for (const row of cluster.instances) sectionOf.set(instanceId(row), part.deployment?.id ?? null);
  const section = (row) => sectionOf.get(instanceId(row)) ?? null;
  const matched = filterInstanceTree(instances, query);
  const visible = matched.filter((i) => instanceVisibleInTree(i, instances, state.collapsed, state.open, filtering, { section }));
  const sections = rosterSections(instances, visible, deployments, TERMS);
  const stale = (row) => rowStale(row, deployments);

  // The list, top to bottom, before any width. A section that has a label (a view of two or more
  // deployments) starts with its heading and the deployment's note; then the groups in the order
  // given, every cluster's members in order, with one gap before the group of single instances
  // when rows of the section came before it.
  const parts = [], rows = [];
  const heading = (deployment, label, path = null) => {
    const said = deploymentState(deployment), live = said.key === "live";
    return {
      kind: "heading", label, path, state: live ? null : said.text, short: live || !text(deployment.short) ? null : deployment.short,
      // A machine's rows are what it reported at the last roster read.
      readAt: live && deployment.local === false ? clockTime(state.rosterAt) : null,
    };
  };
  for (const part of sections) {
    if (text(part.label)) {
      parts.push(heading(part.deployment, part.label));
      if (text(part.deployment.note)) parts.push({ kind: "sentence", value: part.deployment.note });
    }
    let drawn = 0;
    for (const group of part.groups) {
      if (group.key === SINGLES && drawn) parts.push({ kind: "gap" });
      for (const cluster of group.clusters) for (const row of cluster.instances) {
        const item = { kind: "row", row, id: instanceId(row), depth: Number.isInteger(row.depth) ? row.depth : 0 };
        parts.push(item); rows.push(item); drawn++;
      }
    }
  }
  // A deployment of the view that is not live and has no row is in no section: it is named
  // after them, with its state, and its reason on rows of its own.
  if (multi) for (const deployment of deployments) {
    const said = deploymentState(deployment);
    if (said.key === "live" || sections.some((part) => part.deployment?.id === deployment.id)) continue;
    parts.push(heading(deployment, deployment.machine, deployment.label));
    if (text(said.detail)) parts.push({ kind: "sentence", value: said.detail });
    if (text(deployment.note)) parts.push({ kind: "sentence", value: deployment.note });
  }
  // The roster read failed and no answer has arrived yet: there is no machine to say it.
  // It is about no row above it: an empty row sets it apart when something stands there.
  if (state.remote.rosterFailure !== null) parts.push(...(parts.length ? [{ kind: "gap" }] : []), { kind: "own", words: ROSTER_FAILED }, { kind: "sentence", value: state.remote.rosterFailure });

  const primary = primaryDeployment(deployments), said = deploymentState(primary);
  // The entry of this machine's deployment, when the view's primary is one: only it is ever
  // pending, withholds homes, or holds nothing after a failed read. A machine's panel has none.
  const status = panel?.deployment?.status ?? null;
  const local = panel !== null && !!panel.deployment;
  const live = primary !== null && said.key === "live";
  const counted = runtimeCounts(instances);
  const waiting = instances.filter((row) => waitingClaim(row, { stale: stale(row) })).length;
  const withheld = Array.isArray(panel?.deployment?.withheld) ? panel.deployment.withheld.length : 0;
  // The machines of the view other than this one, each once, and whether a deployment of this
  // machine is in it: both read from the shared entries (`local`), never decided here.
  const away = [...new Set(deployments.filter((d) => d.local === false && text(d.machine)).map((d) => d.machine))];
  const machines = away.length, here = deployments.some((d) => d.local === true);
  // Whether a list stands under the header: not for a deployment of this machine that was never
  // observed, nor for a machine that is not live and has no row kept. Each has only its reason.
  const observed = panel !== null && !gone && (local ? status === "observed" : live || instances.length > 0);
  return {
    panel, gone, instances, deployments, multi, parts, rows, filtering, stale, section, live, observed,
    below: waitingRollup(instances, state.collapsed, state.open, { filtering, stale, section }),
    status,
    workspace: text(panel?.workspace?.name) ? panel.workspace.name : "",
    machines, here,
    // The one machine of a view that holds no deployment of this machine: nothing else names it,
    // since a view of one deployment has no heading.
    machine: !here && away.length === 1 ? away[0] : null,
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
    // In a view whose primary is a machine it is the time of the last roster read (heldOf).
    readAt: live ? clockTime(panel.generatedAt) : null,
    // A deployment that is not live says so above the list, with why. Before the first answer
    // the list holds the TUI's own line instead: the shared sentence for that moment names an
    // installed CLI, and the TUI runs its own kernel.
    // `since`: an entry kept over a failed read carries the time of its last good read. An
    // unavailable entry carries only the time of the cycle that failed, which is no "since".
    notice: panel === null || gone || primary === null || live || status === "pending" ? null
      : { text: said.text, since: status === "observed" ? clockTime(panel.generatedAt) : null, reason: said.detail },
    // The note of the one deployment of a view that has no headings: above the list.
    note: !multi && text(primary?.note) ? primary.note : null,
    // Why no instance is listed. "none" is a statement about the deployment, so it is made only
    // of one that was read: a machine that is not live and has no row kept is not known to have
    // none, and its notice is all there is to say.
    empty: status === "pending" ? "reading" : !observed ? null : !instances.length ? (local || live ? "none" : null) : !rows.length ? "nomatch" : null,
    // As wide as the widest word among all the rows of the list, so the column does not move
    // while the list scrolls.
    wordWidth: Math.min(WORD_MAX, rows.reduce((widest, { row }) => Math.max(widest, textWidth(displayLine(wordOf(row)) ?? "")), 0)),
  };
}

/** The TUI's own line for a roster read that failed before any answer arrived. */
export const ROSTER_FAILED = "Other machines were not read.";

/** The list as rows of the screen for a pane `cols` wide: every part on one row, a sentence on
 *  as many as it needs. An item is null (an empty row), an instance (`{ row, id, depth }`, the
 *  only kind that can be selected), `{ heading }`, `{ line }` (one row of a sentence, safe text),
 *  `{ own }` (the TUI's words) or `{ empty }` (why no instance is listed). `index`: an
 *  instance's id to its place. */
function flatten(base, cols, ascii) {
  const items = [];
  const room = Math.max(1, cols - SENTENCE_INDENT - 1);
  // The line that says why no instance is listed, set apart from what follows it by an empty row.
  if (base.empty) items.push({ empty: base.empty }, ...(base.parts.length ? [null] : []));
  for (const part of base.parts) {
    if (part.kind === "gap") items.push(null);
    else if (part.kind === "row") items.push(part);
    else if (part.kind === "heading") items.push({ heading: part });
    else if (part.kind === "own") items.push({ own: part.words });
    else for (const line of shownLines(part.value, room, SENTENCE_ROWS, { ascii })) items.push({ line });
  }
  return { items, index: new Map(items.flatMap((item, i) => (item?.id !== undefined ? [[item.id, i]] : []))) };
}

/** One answer is kept: a repaint, a resize and a key that changes nothing the roster is made
 *  from read it again without asking the shared home again (its grouping walks the whole roster
 *  for each row). The state's values are never changed in place, so their identity says whether
 *  they changed. The flattening for the last width asked is kept beside it. */
const MADE_FROM = ["entries", "remote", "memory", "notes", "rosterAt", "collecting", "ctxs", "open", "collapsed", "cli", "home"];
let kept = null;
/** The roster of a state: the rows in drawn order and what the header says, for a list pane
 *  `cols` wide. Only `items` and `index` depend on the width; `rows`, the instances in drawn
 *  order, do not. `at` stamps a machine's panel before any roster outcome was taken, which
 *  never shows; it is passed on. */
export function roster(state, at = new Date(0).toISOString(), cols = ANY_WIDTH) {
  const same = kept && MADE_FROM.every((name) => kept.state[name] === state[name]) && kept.state.filter.query === state.filter.query;
  if (!same) kept = { state, base: build(state, at), flat: null };
  if (!kept.flat || kept.flat.cols !== cols || kept.flat.ascii !== state.ascii) kept.flat = { cols, ascii: state.ascii, ...flatten(kept.base, cols, state.ascii) };
  return { ...kept.base, items: kept.flat.items, index: kept.flat.index };
}

/** Whether a row has instances below it, and whether they are folded away. A filter shows every
 *  match whatever is collapsed, and leaves the collapse set as it is. */
export function disclosure(state, r, item) {
  if (!hasInstanceChildren(r.instances, item.row)) return null;
  return !r.filtering && state.collapsed.has(collapseKey(state.open, item.id)) ? "closed" : "open";
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
  if (r.multi) {
    // Which machine the instance is on, and, when that deployment is not live, the whole
    // sentence that says why: a heading has room for the short reason only.
    add("machine", row.deployment?.machine);
    const of = r.deployments.find((d) => d.id === row.deployment?.id);
    const said = of ? deploymentState(of) : null;
    if (said && said.key !== "live") add("", said.detail, "wrap");
  }
  add("state", heldHome(row)?.state ?? stateWord(row)); // the word of its list row, harness apart
  // A command's message ends in a newline; one that is only spaces says nothing to quote.
  if (text(row.runtimeError) && row.runtimeError.trim()) add("", `"${row.runtimeError.trim()}"`, "wrap");
  const acts = instanceActs(row), held = acts.blocked ?? acts.limited;
  // A row of a machine that was not reached is held by the very text it carries as its
  // `runtimeError` (compared as given): that text stands once, as the quote above.
  if (held && !(text(row.runtimeError) && held.sentence === row.runtimeError)) add("held", held.sentence, "wrap");
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

/** The heading of the deployments in `~/Agents` that are not served yet: the TUI's own. */
export const OFFERED_SECTION = "On this machine, not opened";
export const MORE_FOLDERS = "More folders than are listed here.";

/** The switcher's rows for a state, top to bottom: the workspaces this run can show, as the
 *  shared home lists and words them; then the ones matched to no workspace under the shared
 *  heading; then the deployments of `~/Agents` that are not served, under the TUI's own.
 *  An item is `{ heading, shared }`, `{ own }`, or a choice: `{ key, label, place, notLiveText,
 *  open, primary }` for a view (`primary` is the deployment Enter opens) and `{ key, label, place,
 *  path, refused }` for an offered folder. `keys` are the choices in order; `selected` is the
 *  key the selection stands on (the first choice when the state's own is not listed). */
export function switcher(state, at = new Date(0).toISOString()) {
  const held = heldOf(state, at), views = viewModel(held, TERMS);
  const rows = workspaceChoiceRows(workspaceChoices(held, TERMS, views));
  const query = state.switcher.query;
  const openView = state.open === null ? null : views.views.find((v) => v.id === state.open || v.deployments.includes(state.open))?.id ?? null;
  const choice = (row) => ({
    key: `view\u0000${row.id}`, label: row.label, place: row.place, notLiveText: row.notLiveText, open: row.id === openView,
    primary: views.views.find((v) => v.id === row.id)?.primary ?? null,
  });
  const shown = rows.filter((row) => choiceMatches(row, query));
  const matched = shown.filter((row) => !row.unattached).map(choice), unmatched = shown.filter((row) => row.unattached).map(choice);
  const offered = state.offered.offered
    .map(({ path, name }) => ({ key: `path\u0000${path}`, label: name, place: shortPath(path, { home: state.home }), path, refused: state.switcher.refused === path }))
    .filter((item) => choiceMatches(item, query));
  const items = [
    ...matched,
    ...(unmatched.length ? [{ heading: UNMATCHED_SECTION, shared: true }, ...unmatched] : []),
    ...(offered.length ? [{ heading: OFFERED_SECTION, shared: false }, ...offered] : []),
    ...(state.offered.limited ? [{ own: MORE_FOLDERS }] : []),
  ];
  const keys = items.filter((item) => item.key !== undefined).map((item) => item.key);
  const total = rows.length + state.offered.offered.length;
  return {
    items, keys, selected: keys.includes(state.switcher.selected) ? state.switcher.selected : keys[0] ?? null,
    empty: keys.length ? null : total ? "nomatch" : "none",
  };
}

/** What the views draw for a state. For the Instances view, in a list pane `page` rows tall and
 *  `cols` wide: the header's facts, the rows of the window with their marks, and the selected
 *  instance's detail. For the switcher, in a pane `page` rows tall: the window of its rows. Only
 *  the rows in the pane are worked out. */
export function model(state, { page, now, at, cols }) {
  const r = roster(state, at, cols);
  const common = {
    view: state.view, focus: state.focus, ascii: state.ascii, actions: state.actions, filter: state.filter,
    workspace: r.workspace, machines: r.machines, here: r.here, machine: r.machine, counts: r.counts, readAt: r.readAt, notice: r.notice, note: r.note, empty: r.empty, observed: r.observed,
    detailTop: state.detailTop, helpTop: state.helpTop, open: state.open !== null,
  };
  // The view under the help decides what the header says.
  const under = state.view === "help" ? state.back : state.view;
  if (under === "switcher") {
    const s = switcher(state, at);
    const at_ = s.selected === null ? -1 : s.items.findIndex((item) => item.key === s.selected);
    // The line that says what happened to the open workspace stands above the rows and takes one
    // of the pane's: the window is that much shorter, so no choice is hidden for it.
    const win = windowOf({ top: state.switcher.top, count: s.items.length, height: Math.max(1, page - (state.switcher.line ? 1 : 0)), keep: at_ });
    return {
      ...common, under, list: [], above: 0, below: 0, wordWidth: 0, detail: null,
      // Nothing of a workspace stands in the header while the switcher is shown.
      workspace: "", machines: 0, here: false, machine: null, counts: [], readAt: null, notice: null, note: null, empty: null, observed: true,
      filter: Object.freeze({ editing: state.switcher.editing, query: state.switcher.query }),
      switcher: {
        rows: s.items.slice(win.top, win.top + win.size).map((item) => (item.key === undefined ? item : { ...item, selected: item.key === s.selected })),
        above: win.above, below: win.below, empty: s.empty, said: state.switcher.line,
      },
    };
  }
  const selected = state.selected === null ? -1 : r.index.get(state.selected) ?? -1;
  const win = windowOf({ top: state.top, count: r.items.length, height: page, keep: selected });
  return {
    ...common, under,
    list: r.items.slice(win.top, win.top + win.size).map((item) => (item?.id !== undefined ? { kind: "row", ...listRow(state, r, item) } : item)),
    above: win.above, below: win.below, wordWidth: r.wordWidth,
    detail: selected >= 0 ? detailOf(state, r, r.items[selected], now) : null,
    switcher: null,
  };
}
