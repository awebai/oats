// From the store's state to what is drawn: the roster in its order, the rows of the pane and the
// facts of the selected instance. Pure, and without a cell position: the views place it.
//
// Everything that groups, orders, hides or names an instance is asked of the shared home
// (client.mjs), the same functions the Desktop draws from: this module calls them and flattens
// their answers, and holds no rule of its own about which group a row is in or what state it is
// in. What it adds is the TUI's: the window, the clock times, and which fact stands on which line.
import {
  TERMS, panelData, displayLine, DETAIL_WITHHELD, originLead, instanceId, instanceVisibleInTree, waitingRollup, collapseKey, filterInstanceTree,
  hasInstanceChildren, heldHome, rosterSections, deploymentState, rowStale, primaryDeployment, isMultiDeployment, runtimeState, runtimeCounts,
  waitingClaim, waitingLabel, waitedText, waitingClock, waitingBelowText, instanceActs, rowReason,
  identityMemory, viewModel, workspaceChoices, workspaceChoiceRows, choiceMatches, UNMATCHED_SECTION, shortPath,
  openAct, deployments as heldDeployments, attachExit, preflightFailure, kernelLines,
  startGate, launchFlagIgnored, flagIgnoredNotice, retainedStartMessage, soulRows, soulFacts, spawnRefusal,
} from "./client.mjs";
import { shownLines } from "./term/text.mjs";
import { textWidth } from "./term/width.mjs";
import { windowOf } from "./views/scroll.mjs";
import { SOUL_COLOURS } from "./views/souls.mjs";

/** The widest the word column of the list may be, in cells. */
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
/** The word a list row shows beside its name, or null: only what its mark cannot say. That is a
 *  held home's state, else the shared label of the reason the row can't be reached or opened
 *  (remote-address.mjs rowReason: `gone from <machine>`, `<machine> not reached`, `state
 *  unknown`, …). A row that runs, is stopped, or keeps a shell has no word: its mark says it, and
 *  its harness is in the detail. */
function wordOf(row) {
  return heldHome(row)?.state ?? rowReason(row)?.label ?? null;
}
/** The detail's state: the list's word when it is a held home's state or the label of a reason
 *  the row can't be reached (a row gone from its machine reads `gone from <machine>`, not
 *  `unknown`); else the word the kernel or the collector reported, else the shared word. The
 *  reason that says only that the state is not known gives way to the kernel's own word for it
 *  (`unreachable`), which says more. */
function detailState(row) {
  const held = heldHome(row);
  if (held) return held.state;
  const reason = rowReason(row);
  return reason && reason.key !== "unknown" ? reason.label : stateWord(row);
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
  // The filter: the text typed after `/`, or the exact soul filter the Souls view's `i` sets
  // (`soul`: the names an instance's soul may carry), matched by the shared walk all the same.
  const query = state.filter.query, soul = state.filter.soul ?? null, filtering = query.trim() !== "" || soul !== null;
  // The section (deployment) each row is drawn in, read from the shared split itself: the
  // sections of all rows. A collapse hides, and rolls up, only rows of its own section, as in the
  // Desktop: a parent's name can resolve to a row of another deployment of the view.
  // `ordered`: every row in that order, whatever is filtered or folded (the palette's).
  const sectionOf = new Map(), ordered = [];
  for (const part of rosterSections(instances, instances, deployments, TERMS)) for (const group of part.groups) for (const cluster of group.clusters) for (const row of cluster.instances) { sectionOf.set(instanceId(row), part.deployment?.id ?? null); ordered.push(row); }
  const section = (row) => sectionOf.get(instanceId(row)) ?? null;
  const matched = soul !== null ? filterInstanceTree(instances, soul.name, (row) => soul.names.includes(row.agent)) : filterInstanceTree(instances, query);
  const visible = matched.filter((i) => instanceVisibleInTree(i, instances, state.collapsed, state.open, filtering, { section }));
  const sections = rosterSections(instances, visible, deployments, TERMS);
  // How many instances each collapse folds away under its row: every descendant of the row in its
  // own section, as the shared walk finds them when it is asked with that collapse alone (so a
  // fold further down hides none of them from the count). A filter folds nothing away.
  const folded = new Map();
  if (!filtering) for (const row of visible) {
    const key = collapseKey(state.open, instanceId(row));
    if (!state.collapsed.has(key)) continue;
    const alone = new Set([key]);
    folded.set(instanceId(row), instances.filter((other) => !instanceVisibleInTree(other, instances, alone, state.open, false, { section })).length);
  }
  const stale = (row) => rowStale(row, deployments);
  const primary = primaryDeployment(deployments), said = deploymentState(primary);
  const live = primary !== null && said.key === "live";
  // The time of the read the screen shows: the cycle's own (`generatedAt`), never
  // `observedAt`, which is when the kernel last looked at the workspace's remotes and is up
  // to a minute older on a read in the background. Nothing drawn here comes from the remotes.
  // In a view whose primary is a machine it is the time of the last roster read (heldOf).
  const readAt = live ? clockTime(panel.generatedAt) : null;

  // The list, top to bottom, before any width. A section that has a label (a view of two or more
  // deployments) starts with its heading and the deployment's note; then the groups in the order
  // given, every cluster's members in order, with one gap before the group of single instances
  // when rows of the section came before it.
  const parts = [], rows = [];
  const heading = (deployment, label, path = null) => {
    const its = deploymentState(deployment), up = its.key === "live";
    // A machine's rows are what it reported at the last roster read: that time stands on its
    // heading only when the header's time is another, so the heading of a machine read with
    // this one is its name alone. A deployment that is not live has its state and short reason
    // in the shared words instead, and no time.
    const read = up && deployment.local === false ? clockTime(state.rosterAt) : null;
    return {
      kind: "heading", label, path, state: up ? null : its.text, short: up || !text(deployment.short) ? null : deployment.short,
      readAt: read !== readAt ? read : null,
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
    const its = deploymentState(deployment);
    if (its.key === "live" || sections.some((part) => part.deployment?.id === deployment.id)) continue;
    parts.push(heading(deployment, deployment.machine, deployment.label));
    if (text(its.detail)) parts.push({ kind: "sentence", value: its.detail });
    if (text(deployment.note)) parts.push({ kind: "sentence", value: deployment.note });
  }
  // The roster read failed and no answer has arrived yet: there is no machine to say it.
  // It is about no row above it: an empty row sets it apart when something stands there.
  if (state.remote.rosterFailure !== null) parts.push(...(parts.length ? [{ kind: "gap" }] : []), { kind: "own", words: ROSTER_FAILED }, { kind: "sentence", value: state.remote.rosterFailure });

  // The entry of this machine's deployment, when the view's primary is one: only it is ever
  // pending, withholds homes, or holds nothing after a failed read. A machine's panel has none.
  const status = panel?.deployment?.status ?? null;
  const local = panel !== null && !!panel.deployment;
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
    panel, gone, instances, ordered, deployments, multi, parts, rows, filtering, stale, section, live, observed, folded,
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
    readAt,
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
    // none (it is not `observed`), and its notice is all there is to say.
    empty: status === "pending" ? "reading" : !observed ? null : !instances.length ? "none" : !rows.length ? "nomatch" : null,
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
  const same = kept && MADE_FROM.every((name) => kept.state[name] === state[name]) && kept.state.filter.query === state.filter.query && kept.state.filter.soul === state.filter.soul;
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

/** One row of the list: its mark, its name, the word its mark cannot say (or null), whether it
 *  waits, and on a folded row only, how many instances are folded away under it (`folded`) and how
 *  many of those wait (`below`). A row that is not folded says nothing of its children: they
 *  stand under it, indented. */
function listRow(state, r, item) {
  const closed = disclosure(state, r, item) === "closed";
  return {
    id: item.id, name: item.row.instance, depth: item.depth, selected: item.id === state.selected,
    mark: markOf(item.row), word: wordOf(item.row),
    waiting: waitingClaim(item.row, { stale: r.stale(item.row) }) !== null,
    folded: closed ? r.folded.get(item.id) ?? 0 : 0,
    below: closed ? r.below.get(item.id)?.length ?? 0 : 0,
  };
}

/** A text the TUI did not write, as the detail and the outcome line draw it, or null when it has
 *  nothing to show. Who made it is the shared home's to say: after the words originLead gives for
 *  `origin` when it names a speaker; as it is when the shared home vouches for it (`vouched`: it
 *  is a sentence of the shared home's own); else in quotation marks, naming nobody. A missing mark
 *  is never read as "the shared home wrote this".
 *  The filter is asked about the text alone, before anything is put around it, so the words in
 *  front are never why a text is shown. What it withholds goes to the view as it came, which
 *  draws the withheld word and nothing else. (The view asks again about the whole value: words in
 *  front never change the answer; a closing quotation mark can, for a text that ends in a
 *  secret's name and its sign, and that text is then withheld.) */
function spoken(value, origin, vouched) {
  const line = displayLine(value);
  if (line === null) return null;
  if (line === DETAIL_WITHHELD) return value;
  const lead = originLead(origin, TERMS);
  return lead !== null ? `${lead} ${line}` : vouched ? line : `"${line}"`;
}

/** A reason of the shared home's (a held row's, an act's), as `spoken` says it: its sentence is
 *  vouched for when it carries no mark. */
const reasonSpoken = (reason) => spoken(reason.sentence, reason.origin, reason.origin === undefined);

/** The TUI's own words around opening an agent's terminal (docs/tui.md, "Opening an agent").
 *  Each is a list of parts: `{ own }` is the TUI's, `{ shown }` text from outside (a name, a
 *  machine's name), drawn through the display filter on its own. `<id>` and `<home>` in the
 *  command are the TUI's placeholders: nothing of the row is in them. */
export const OPEN_WORDS = Object.freeze({
  failed: (name) => [{ shown: name }, { own: " could not be opened." }],
  link: (machine) => [{ own: "The connection to " }, { shown: machine }, { own: " ended." }],
  unknown: (name) => [{ own: "The viewer of " }, { shown: name }, { own: " ended without saying why." }],
  noTmux: (name) => [{ shown: name }, { own: " could not be opened: the terminal panel needs tmux 3.2 or later on this machine." }],
  notRunning: (name) => [{ shown: name }, { own: " is not running, so it has no terminal to open." }],
  stateUnknown: (name) => [{ own: "Whether " }, { shown: name }, { own: " runs is not known, so it is not opened." }],
});
/** The body of a view of this machine that is not in this version (Capabilities): what it will
 *  hold, and what to run until then, the help's commands (views/help.mjs VIEWS), in the TUI's own
 *  words; each command is whole, never broken over two rows. */
const command = (text) => Object.freeze({ own: `\`${text}\``, whole: true });
export const NOT_BUILT = Object.freeze({
  capabilities: Object.freeze({ said: Object.freeze([{ own: "This view will list the capabilities this machine has. It is not in this version: " }, command("oats capabilities"), { own: " lists them." }]), under: Object.freeze([]) }),
});
/** A sentence from outside (a reason of the shared home's, the preflight table's), as a text
 *  under the line: drawn as the detail draws a reason, wrapped on the reason's rows, never as one
 *  unbroken part (a part is a name). */
const outside = (value) => (value === null ? [] : [value]);

/** Whether a row is of another machine: the shared home names its server on it. */
const elsewhere = (row) => typeof row.server === "string" && row.server !== "";

/** Whether `row`'s terminal can be opened from here, and what Enter does: `acts` is the row's
 *  instanceActs answer (computed once per selected row, for the detail too).
 *    { open: true, id, name, machine, target, routed }  the kernel's viewer can be started:
 *        `target` is what the shared sessionAttachArgv and prepareRemoteTerm take, `routed` true
 *        for a row of another machine (its preflight runs first)
 *    { open: false, said: { said, under } }             opens nothing, and this says why
 *  Whether a row can be opened is the shared openAct's, switched on its reason's code, never on a
 *  sentence. The viewer is started with no key of its own (the TUI takes the back key before the
 *  pane sees it), so a kernel or a host of any version is opened alike. */
export function openDecision(state, row, acts) {
  const name = row.instance, id = instanceId(row);
  const machine = elsewhere(row) ? row.deployment?.machine ?? row.server : null;
  const no = (said, under = []) => ({ open: false, said: { said, under } });
  const act = openAct(row);
  if (act === null) {
    const held = acts.blocked ?? acts.limited;
    return no([], outside(reasonSpoken(held)));
  }
  if (!act.enabled) {
    if (act.reason.code === "not-running") return no(OPEN_WORDS.notRunning(name));
    if (act.reason.code === "state-unknown") return no(OPEN_WORDS.stateUnknown(name));
    return no([], outside(reasonSpoken(act.reason)));
  }
  if (!elsewhere(row)) return { open: true, id, name, machine, target: { home: row.home }, routed: false };
  return { open: true, id, name, machine, target: { serverId: row.server, instance: row.instance, home: row.home }, routed: true };
}

/** The line after a terminal closed by itself, or null when the TUI says nothing of its own: the
 *  viewer ended with status 0 (the list shows the agent as the kernel now reports it), or the
 *  person closed it (`asked`: c, or Enter on another row). `status` is what the pane's shell
 *  wrote of the viewer's exit (lib/panel.mjs), null when it wrote none; the shared attachExit reads
 *  it, as for a viewer started with no key, and the TUI compares no number. What the viewer printed
 *  on stderr stands under a failure, once, as one text in quotation marks naming nobody: OATS, tmux
 *  and ssh all print there, and nothing is compared with it. `refused` is the panel's own refusal
 *  when no viewer was started at all: "tmux" (no tmux here, or one too old), or "start" (the
 *  panel's server or window was not made; `stderr` is then what tmux said). */
export function returnedLine({ name, machine, routed }, status, stderr, { asked = false, refused = null } = {}) {
  if (asked) return null;
  if (refused === "tmux") return { said: OPEN_WORDS.noTmux(name), under: [] };
  if (refused !== null) status = 1;
  const word = attachExit(status, { keyed: false, routed });
  if (word === "ended") return null;
  if (word === "unknown") return { said: OPEN_WORDS.unknown(name), under: [] };
  const line = displayLine(stderr);
  const under = line === null ? [] : [line === DETAIL_WITHHELD ? DETAIL_WITHHELD : `"${line}"`];
  return { said: word === "link" ? OPEN_WORDS.link(machine) : OPEN_WORDS.failed(name), under };
}

/** The line after a preflight that failed, or null when there is nothing to say: the person's own
 *  Esc, or a row that went away (E_TERM_CONTEXT_CHANGED). Else the shared table's sentence, and
 *  under it what the kernel said, when it said something (kernelLines). */
export function preflightLine({ machine }, error) {
  const failure = preflightFailure(error, machine);
  if (failure.code === "E_TERM_CONTEXT_CHANGED") return null;
  return { said: [], under: [...outside(failure.sentence), ...(failure.said === null ? [] : kernelLines(failure.said.message, failure.said.fix, TERMS))] };
}

/** The row's own text (its `runtimeError`), in the form that says who made it (see detailOf), or
 *  null. `acts` is the row's instanceActs answer: a reason of it that carries no `origin` and is
 *  this very text vouches for it. */
function rowText(row, acts) {
  const vouched = [acts.blocked, acts.limited, ...acts.acts.map((act) => act.reason)].some((reason) => reason && reason.origin === undefined && reason.sentence === row.runtimeError);
  return spoken(row.runtimeError, row.runtimeErrorOrigin, vouched);
}

/** The facts of one instance, a label and a value per line; a fact that is absent is left out.
 *  `form`: `line` (one row), `wrap` (a sentence, on as many rows as it needs), `end` (read from
 *  its end: a path). A fact with no label continues the one above it. Every value is text the
 *  TUI did not write, or holds some: the view draws all of them through shown(). `now` is the
 *  time of the paint, so the waited time is right whenever the screen is drawn. */
function detailOf(state, r, item, now, acts) {
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
  add("state", detailState(row));
  const held = acts.blocked ?? acts.limited;
  // The row's own text stands under its state, in the form that says who made it. Who made it is
  // the shared home's to say, in two ways, and the TUI writes no word and no sentence of its own
  // for either: the row's mark, which originLead turns into the words that go before the text;
  // or a reason of the row that carries no `origin`, which is a sentence the shared home wrote
  // itself, when that sentence is this very text (compared as given). A text with neither is
  // vouched for by nobody: it stands in quotation marks and names no one. A missing mark is
  // never read as "the shared home wrote this".
  // The filter is asked about the text alone, before anything is put around it, so the words in
  // front are never why a text is shown. What it withholds goes to the view as it came, which
  // draws the withheld word and nothing else. (The view asks again about the whole value: words
  // in front never change the answer; a closing quotation mark can, for a text that ends in a
  // secret's name and its sign, and that text is then withheld.)
  add("", rowText(row, acts), "wrap");
  // What holds the row, when that is a sentence of the shared home's and not the row's text: a
  // reason with an `origin` is the row's text, and so is one whose sentence is that text. Either
  // stands once, under the state.
  if (held && held.origin === undefined && held.sentence !== row.runtimeError) add("held", held.sentence, "wrap");
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

/** The house fuzzy matcher of the Desktop's palette, the same function
 *  (packages/desktop/renderer/overlay-picker.mjs subsequenceScore): the TUI cannot import the
 *  Desktop's renderer, and test/tui-palette.test.mjs holds the two to the same answers. Lower is
 *  better, null is no match, and a prefix match gets a strong (negative) bonus. */
export function subsequenceScore(text, query) {
  const t = String(text).toLowerCase();
  const s = String(query).toLowerCase();
  let ti = 0, gaps = 0;
  for (const ch of s) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    gaps += found - ti; ti = found + 1;
  }
  return gaps + (t.startsWith(s) ? -100 : 0);
}

/** The palette's views and commands, each a row's label and the action it runs. */
const PALETTE_VIEWS = Object.freeze([["instances", "Instances"], ["souls", "Souls"], ["capabilities", "Capabilities"]]);
const PALETTE_COMMANDS = Object.freeze([["workspaces", "Workspaces"], ["refresh", "Refresh"], ["help", "Help"]]);
const PALETTE_ACTS = Object.freeze({ stop: "Stop", restart: "Restart", retire: "Retire", start: "Start" });

/** THE PALETTE'S ROWS (docs/tui.md, "The palette"), in this order: the instances that can be
 *  opened (the most recently opened in this run first, then the shared order), the souls of the
 *  open workspace once its catalog was read, the views, the acts
 *  the palette's instance offers (the open terminal's, when the palette came from its focus; else
 *  the selected one), then workspaces, refresh and help. With a query, each group keeps the rows the
 *  Desktop's subsequence score matches, the best first (a prefix first); a tie keeps that order.
 *  A row: `{ key, kind, label, does?, id?, name?, machine?, mark? }`; `selected` is the key the
 *  selection stands on (the first row when the palette's own is not listed). */
export function paletteItems(state, at = new Date(0).toISOString()) {
  const p = state.palette;
  if (p === null) return { items: [], selected: null };
  const groups = [];
  if (state.open !== null) {
    const r = roster(state, at);
    const recent = new Map(state.recent.map((id, i) => [id, i]));
    const rank = (row) => recent.get(instanceId(row)) ?? Infinity;
    const openable = r.ordered.filter((row) => openDecision(state, row, instanceActs(row)).open);
    groups.push(openable.map((row, i) => ({ row, i })).sort((a, b) => rank(a.row) - rank(b.row) || a.i - b.i).map(({ row }) => {
      const machine = elsewhere(row) ? row.deployment?.machine ?? row.server : null;
      return { key: `instance\u0000${instanceId(row)}`, kind: "instance", label: row.instance, id: instanceId(row), name: row.instance, machine, mark: markOf(row), text: `${row.instance} ${machine ?? ""}` };
    }));
  }
  // The souls of the open workspace, once its catalog was read (the Souls view opened): choosing
  // one shows the Souls view with it selected. A palette never reads the catalog.
  groups.push(soulsOf(state).all.map((row) => ({ key: `soul\u0000${row.name}`, kind: "soul", label: row.name, name: row.name, text: row.name })));
  groups.push(PALETTE_VIEWS.map(([does, label]) => ({ key: `view\u0000${does}`, kind: "view", label, does, text: label })));
  const id = p.from === "terminal" && state.terminal !== null ? state.terminal.id : state.selected;
  const row = id === null || state.open === null ? null : roster(state, at).instances.find((each) => instanceId(each) === id) ?? null;
  if (row !== null && state.opening === null) {
    const acts = instanceActs(row);
    groups.push(ACT_VERBS.filter((verb) => actDecision(state, row, acts, verb).open)
      .map((verb) => ({ key: `act\u0000${verb}`, kind: "act", label: PALETTE_ACTS[verb], does: verb, id: instanceId(row), name: row.instance, text: `${PALETTE_ACTS[verb]} ${row.instance}` })));
  }
  groups.push(PALETTE_COMMANDS.map(([does, label]) => ({ key: `command\u0000${does}`, kind: "command", label, does, text: label })));
  const query = p.query.trim();
  const items = groups.flatMap((group) => (query === ""
    ? group
    : group.map((item, i) => ({ item, i, score: subsequenceScore(item.text, query) })).filter((each) => each.score !== null).sort((a, b) => a.score - b.score || a.i - b.i).map(({ item }) => item)));
  return { items, selected: items.some((item) => item.key === p.selected) ? p.selected : items[0]?.key ?? null };
}
/** The palette as the view draws it, in a body `page` rows tall: its query on the first row, and
 *  under it the window of its rows that holds the selection (whose last row says what is cut off,
 *  when something is: scroll.mjs windowOf keeps it). */
function paletteView(state, page, at) {
  const list = paletteItems(state, at), height = Math.max(1, page - 1);
  const selected = list.items.findIndex((item) => item.key === list.selected);
  const win = windowOf({ top: 0, count: list.items.length, height, keep: selected });
  return {
    query: state.palette.query, from: state.palette.from,
    rows: list.items.slice(win.top, win.top + win.size).map((item) => ({ ...item, selected: item.key === list.selected })),
    above: win.above, below: win.below, empty: list.items.length === 0,
  };
}

/** What the views draw for a state. For the Instances view, in a list pane `page` rows tall and
 *  `cols` wide: the header's facts, the rows of the window with their marks, and the selected
 *  instance's detail. For the switcher, in a pane `page` rows tall: the window of its rows. Only
 *  the rows in the pane are worked out. */
export function model(state, { page, now, at, cols }) {
  const r = roster(state, at, cols);
  const common = {
    view: state.view, focus: state.focus, ascii: state.ascii, actions: state.actions,
    // The filter of the view shown: the Souls view has one of its own.
    filter: state.view === "souls" ? state.souls.filter : state.filter,
    workspace: r.workspace, machines: r.machines, here: r.here, machine: r.machine, counts: r.counts, readAt: r.readAt, notice: r.notice, note: r.note, empty: r.empty, observed: r.observed,
    detailTop: state.detailTop, helpTop: state.helpTop, open: state.open !== null,
    detachKey: state.detachKey, opening: state.opening, outcome: state.outcome, openable: false, actable: [],
    terminal: state.terminal, onTerminal: false,
    act: state.view === "act" && state.act ? actView(state) : null,
    // The leader waits for its key (the footer is its hint), and the palette, while it is open.
    leader: state.leader?.waiting === true, palette: state.palette === null ? null : paletteView(state, page, at),
    body: state.view === "capabilities" ? NOT_BUILT.capabilities : null,
    souls: state.view === "souls" ? soulsView(state, page, at) : null,
  };
  // The view under the help, or under a confirmation, decides what the header says.
  const under = state.view === "help" || state.view === "act" ? state.back : state.view;
  if (under === "switcher") {
    const s = switcher(state, at);
    const at_ = s.selected === null ? -1 : s.items.findIndex((item) => item.key === s.selected);
    // The line that says what happened to the open workspace stands above the rows and takes one
    // of the pane's: the window is that much shorter, so no choice is hidden for it.
    const win = windowOf({ top: state.switcher.top, count: s.items.length, height: Math.max(1, page - (state.switcher.line ? 1 : 0)), keep: state.switcher.loose ? -1 : at_ });
    return {
      ...common, under, list: [], above: 0, below: 0, wordWidth: 0, detail: null,
      // Nothing of a workspace stands in the header while the switcher is shown.
      workspace: "", machines: 0, here: false, machine: null, counts: [], readAt: null, notice: null, note: null, empty: null, observed: true, outcome: null,
      filter: Object.freeze({ editing: state.switcher.editing, query: state.switcher.query }),
      switcher: {
        rows: s.items.slice(win.top, win.top + win.size).map((item) => (item.key === undefined ? item : { ...item, selected: item.key === s.selected })),
        above: win.above, below: win.below, empty: s.empty, said: state.switcher.line,
      },
    };
  }
  const selected = state.selected === null ? -1 : r.index.get(state.selected) ?? -1;
  // What the detail, the footer and Enter read of the selected row is worked out once per paint.
  const row = selected >= 0 ? r.items[selected].row : null, acts = row ? instanceActs(row) : null;
  const decision = row ? openDecision(state, row, acts) : null;
  // The window holds the selection, unless the list was scrolled away from it on purpose.
  const win = windowOf({ top: state.top, count: r.items.length, height: page, keep: state.loose ? -1 : selected });
  return {
    ...common, under,
    list: r.items.slice(win.top, win.top + win.size).map((item) => (item?.id !== undefined ? { kind: "row", ...listRow(state, r, item) } : item)),
    above: win.above, below: win.below, wordWidth: r.wordWidth,
    detail: selected >= 0 ? detailOf(state, r, r.items[selected], now, acts) : null,
    // Enter opens the selected agent's terminal now, or (`onTerminal`) goes to the one open on it.
    openable: decision?.open === true && state.opening === null,
    onTerminal: row !== null && state.terminal !== null && state.terminal.id === instanceId(row),
    // The acts whose key opens a confirmation now, read from the same instanceActs answer: the
    // footer names them. A key not named still answers, with the line that says why.
    actable: row && state.opening === null ? ACT_VERBS.filter((verb) => actDecision(state, row, acts, verb).open) : [],
    switcher: null,
  };
}

/** The shared home's rows of deployment `id` as the state holds them, unfiltered: the rows the list
 *  draws for it, found by the deployment and never by the view that is open. */
const rowsOf = (held, id) => panelData(held, id, TERMS).instances.filter((row) => row.deployment?.id === id);
/** Where a routed command runs from (its `localCwd`): the open deployment when it is this
 *  machine's, else the first served, else the home. */
export const actCwd = (state) => (state.ctxs.includes(state.open) ? state.open : state.ctxs[0] ?? state.home);
/** What the lifecycle boundary admits a request of deployment `id` against (its `getContext()`),
 *  asked at every admission: the deployment as the shared `deployments` lists it (a machine's with
 *  its roster group), the kernel record, `actCwd`, and that deployment's rows now. */
export function actContext(state, id, at) {
  const held = heldOf(state, at);
  const workspace = heldDeployments(held).find((w) => w.id === id) ?? null;
  return { workspace, cli: state.cli, localCwd: actCwd(state), instances: workspace ? rowsOf(held, id) : [] };
}
/** This machine's deployments and their rows, for the shared start rule's home check
 *  (session-start.mjs verifiedLocalHome). */
export function localDeployments(state, at) {
  const held = heldOf(state, at);
  return heldDeployments(held).filter((w) => !w.remote).map((w) => ({ id: w.id, remote: false, instances: rowsOf(held, w.id) }));
}

/** The four acts on an instance, in the order the help, the footer and the keys know them. */
export const ACT_VERBS = Object.freeze(["stop", "retire", "start", "restart"]);
const DONE = Object.freeze({ stop: "stopped", retire: "retired", start: "started", restart: "restarted" });
/** The TUI's own words around the acts (docs/tui.md, "Stopping, starting, restarting and
 *  retiring"), as parts the way OPEN_WORDS are: `{ own }` the TUI's, `{ shown }` a name. A
 *  lifecycle sentence the shared home has is never written here: the confirmation's view says it. */
export const ACT_WORDS = Object.freeze({
  notHere: (name, verb) => [{ shown: name }, { own: ` can't be ${DONE[verb]} here.` }],
  stillStarting: (name, verb) => [{ own: `The ${verb} of ` }, { shown: name }, { own: " is still running." }],
  /** The line on stderr after the TUI has left, one per change still running. */
  leaving: (verb, name) => `oats: the ${verb} of ${name} is still running; \`oats status\` shows its result.`,
  question: (name, verb) => [{ own: verb === "restart" ? "Restart " : "Start " }, { shown: name }, { own: "?" }],
  what: (verb) => (verb === "restart"
    ? "Its session is ended and started again: what it is doing is interrupted. Save any work in progress first."
    : "It starts with the launch settings recorded for it."),
  starting: (name, verb) => [{ own: verb === "restart" ? "Restarting " : "Starting " }, { shown: name }, { own: "…" }],
  started: (name, verb) => [{ shown: name }, { own: ` ${DONE[verb]}.` }],
  unconfirmed: (name) => [{ own: "OATS didn't confirm the start of " }, { shown: name }, { own: ". It may still be running: the list shows it when it is." }],
  waiting: "Esc stops waiting.",
  details: "Details:",
  since: "Started at",
  next: Object.freeze({
    "retire-with-force": (name) => [{ own: "Check the process it names, then retire it with `oats retire " }, { shown: name }, { own: " --force`." }],
    "check-roster": () => [{ own: "The list shows its result when it is done." }],
  }),
});
/** The labels of the buttons, the TUI's own, by the confirmation's offer (and the phase it is in). */
export function buttonLabel(offer, verb, phase) {
  if (offer === "close") {
    if (phase === "reading" || phase === "review") return "Cancel";
    if (phase === "applying" || phase === "starting") return `Close (the ${verb} goes on)`;
    return "Close";
  }
  if (offer === "refresh") return "Review again";
  if (offer === "check-again") return "Check again";
  return { stop: "Stop", retire: "Retire", start: "Start", restart: "Restart" }[verb];
}
/** The order the buttons stand in, whatever order the offers come in: the first has the focus. */
export const BUTTON_ORDER = Object.freeze(["close", "refresh", "check-again", "apply"]);

/** Whether an act key on `row` opens a confirmation, and what the line says when it does not.
 *  `acts` is the row's instanceActs answer, read once per paint (the footer) or per key, as
 *  openDecision reads it; nothing here decides which acts a row has.
 *    { open: true, verb, id, name, kind, machine, label, home }  a confirmation opens: `kind`
 *        "lifecycle" for stop and retire (the shared confirmation), "start" for the TUI's own
 *    { open: false, said: { said, under } }                    nothing opens, and this says why
 *  In order: a start or restart of this row from this TUI still running (Done 7); the verb listed
 *  and enabled (start and restart also asked of the shared startGate); listed and not enabled
 *  (its own reason); not listed (the row's blocked or limited reason, else the TUI's words). */
export function actDecision(state, row, acts, verb) {
  const name = row.instance, id = instanceId(row);
  const no = (said, under = []) => ({ open: false, said: { said, under } });
  const running = state.starting?.get(id);
  if (running) return no(ACT_WORDS.stillStarting(name, running.verb));
  const act = acts.acts.find((each) => each.verb === verb);
  if (!act) {
    const held = acts.blocked ?? acts.limited;
    return held ? no([], outside(reasonSpoken(held))) : no(ACT_WORDS.notHere(name, verb));
  }
  if (!act.enabled) return no([], outside(reasonSpoken(act.reason)));
  const lifecycle = verb === "stop" || verb === "retire";
  if (!lifecycle) {
    const refused = startGate(state.cli, row, { restart: verb === "restart" }, TERMS);
    // The gate's `detail` is the row's own text: said as the detail says it, with its speaker.
    if (refused) return no([], [refused.sentence, ...outside(refused.detail ? rowText(row, acts) : null)]);
  }
  const machine = elsewhere(row) ? row.deployment?.machine ?? row.server : null;
  return { open: true, verb, id, name, kind: lifecycle ? "lifecycle" : "start", machine, label: machine, home: row.home ?? null };
}

/** What a start's or a restart's answer (the shared startInstance's) shows, as the act view's
 *  lines: `{ said }` the TUI's own sentence in parts, `{ text }` a shared sentence or the kernel's
 *  line (each already as the shared home words it). Chosen by the answer's fields and codes, never
 *  by its words. */
export function startOutcome(name, verb, answer) {
  const lines = [];
  const kernel = (detail) => (detail ? kernelLines(detail, undefined, TERMS).map((text) => ({ text })) : []);
  if (answer?.ok === true) {
    const fact = launchFlagIgnored(answer.result), notice = fact ? flagIgnoredNotice(name, fact) : null;
    if (notice) return [{ text: notice.headline, look: "bold" }, ...(notice.detail ? notice.detail.split("\n").map((text) => ({ text })) : [])];
    return [{ said: ACT_WORDS.started(name, verb), look: "bold" }];
  }
  if (answer?.outcome === "refused") {
    lines.push({ text: answer.sentence, look: "bold" });
    // A refusal before the CLI ran (the gate, the home check) carries the row's own text, if any.
    if (answer.ran) lines.push(...kernel(answer.detail));
    else if (answer.detail) lines.push({ text: answer.detail });
    return lines;
  }
  // The end of the wait for a start that goes on: the code the shared rule leaves to each client to
  // word. No answer at all (the call itself was refused by the loop) is no more than that either.
  if (!answer || answer.code === "E_START_UNCONFIRMED") return [{ said: ACT_WORDS.unconfirmed(name), look: "bold" }];
  if (answer.incomplete) return [{ text: retainedStartMessage(name, answer.incomplete), look: "bold" }, ...kernel(answer.detail)];
  return [{ text: answer.sentence ?? answer.code, look: "bold" }, ...kernel(answer.detail)];
}

/** An ISO-less clock time, `14:03`, of milliseconds since the epoch, or null. */
const hourMinute = (ms) => { const at = new Date(ms); return Number.isFinite(ms) && Number.isFinite(at.getTime()) ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : null; };

/** The act view's content for the open confirmation (`state.act`), top to bottom, each part only
 *  when it has something: { title, lines, buttons }. A line is `{ text, look?, path? }` (a shared
 *  sentence or the kernel's text, drawn through the display filter; `path` after it, shortened),
 *  `{ said, look? }` (the TUI's own sentence, in parts), `{ pair: [label, value] }` (a state row: both from outside, the plan's label a target's name among them),
 *  `{ choice: { id, sentence, value } }` or `{ gap: true }`. `look`: "bold", "dim". */
export function actView(state) {
  const a = state.act;
  const lines = [];
  const gap = () => { if (lines.length && !lines.at(-1).gap) lines.push({ gap: true }); };
  const short = (path) => shortPath(path, { home: a.machine === null ? state.home : null });
  let title;
  if (a.kind === "start") {
    title = { said: ACT_WORDS.question(a.name, a.verb) };
    if (a.phase === "review") {
      lines.push({ own: ACT_WORDS.what(a.verb) });
      gap();
      if (a.machine !== null) lines.push({ pair: ["machine", a.machine] });
      if (a.home) lines.push({ pair: ["home", short(a.home)] });
    } else if (a.phase === "starting") lines.push({ said: ACT_WORDS.starting(a.name, a.verb) });
    else lines.push(...startOutcome(a.name, a.verb, a.answer));
  } else {
    const view = a.view ?? {}, plan = a.plan;
    title = { text: plan && (a.phase === "review" || view.kind === "reading") ? plan.question : view.title ?? "" };
    if (a.notice?.sentence) lines.push({ text: a.notice.sentence, look: "bold" });
    if (view.kind === "reading" || view.kind === "applying") {
      lines.push({ text: view.message });
      if (view.kind === "reading") lines.push({ own: ACT_WORDS.waiting, look: "dim" });
    }
    if (plan && (a.phase === "review" || view.kind === "reading")) {
      gap();
      for (const h of plan.happening) lines.push({ text: h.text, ...(h.path ? { path: short(h.path) } : {}), ...(h.tone === "attention" ? { look: "bold" } : h.tone === "note" ? { look: "dim" } : {}) });
      if (plan.state.rows.length || plan.state.notes.length) gap();
      for (const row of plan.state.rows) lines.push({ pair: [row.label, row.value] });
      for (const note of plan.state.notes) lines.push({ text: note.text, ...(note.tone === "attention" ? { look: "bold" } : note.tone === "note" ? { look: "dim" } : {}) });
      if (plan.warning) lines.push({ text: plan.warning, look: "bold" });
      const offered = plan.choices.filter((choice) => choice.offered);
      if (offered.length) gap();
      for (const choice of offered) lines.push({ choice: { id: choice.id, sentence: choice.sentence, value: choice.value } });
      if (plan.notice?.sentence) lines.push({ text: plan.notice.sentence, look: "bold" });
    }
    if (a.phase === "settled" && view.status) {
      gap();
      lines.push({ text: view.status.headline, look: "bold" });
      for (const more of view.status.more ?? []) {
        if (more.quote !== undefined) lines.push(...kernelLines(more.quote, undefined, TERMS).map((text) => ({ text })));
        else lines.push({ text: more.text });
      }
      if (view.status.next && ACT_WORDS.next[view.status.next]) lines.push({ said: ACT_WORDS.next[view.status.next](a.name) });
      for (const block of view.blocks ?? []) {
        if (block.type === "details") {
          lines.push({ said: [{ own: `${ACT_WORDS.details} ` }, { shown: block.reason?.code ?? "" }], look: "dim" });
          lines.push(...kernelLines(block.reason?.detail, undefined, TERMS).map((text) => ({ text })));
        } else if (block.type === "quote") lines.push(...kernelLines(block.text, undefined, TERMS).map((text) => ({ text })));
        else if (block.type === "note") lines.push({ text: block.text });
        else if (block.type === "rows") for (const row of block.rows) { lines.push({ text: row.text }); if (row.quote) lines.push(...kernelLines(row.quote, undefined, TERMS).map((text) => ({ text }))); }
        else if (block.type === "lines") for (const line of block.lines) lines.push({ text: line.text, ...(line.path ? { path: short(line.path) } : {}) });
      }
    }
    const since = a.running ? hourMinute(a.running.since) : null;
    if (since) lines.push({ own: `${ACT_WORDS.since} ${since}.`, look: "dim" });
  }
  const buttons = a.offers.map((offer) => ({ id: offer, label: buttonLabel(offer, a.verb, a.phase), focused: offer === a.focus }));
  return { title, lines, buttons, top: a.top };
}

// ── THE SOULS VIEW (docs/tui.md, "The Souls view") ───────────────────────────────────────────────

/** The sentence of a catalog read that failed: the Desktop's own (packages/desktop/renderer/views/
 *  spawn.mjs catalogReasonText), copied until the shared home has it; the kernel's message in it is
 *  text from outside, which the view draws through the display filter. */
export function catalogFailure(reason) {
  const message = typeof reason?.message === "string" && reason.message ? reason.message : "";
  return message ? `Couldn't read this workspace's souls: ${message}` : "Couldn't read this workspace's souls.";
}

/** The names an instance's soul (its row's `agent`) may carry for a soul row: its name, and for a
 *  package soul the kernel's key and its qualified name. The exact soul filter matches these. */
export function soulNames(row) {
  return [...new Set([row.name, row.key, row.qualifiedName].filter(text))];
}

/** Whether a soul row matches the Souls view's filter: its name, its description or where it comes
 *  from contains the text, case aside, as the Desktop's soul grid filters (views/spawn.mjs). */
const soulMatches = (row, needle) => [row.name, row.description, row.repoName].some((value) => String(value || "").toLowerCase().includes(needle));

/** The souls of the open workspace as the store and the view read them: the shared rows
 *  (soul-rows.mjs soulRows) of the catalog the loop holds for it, filtered by the view's own
 *  filter. Only a workspace of this machine has souls here (`local`). `held` is what the loop
 *  holds of its catalog (`{ entry, reading }`), `rows` the rows the filter keeps, `selected` the
 *  row the selection stands on: the store's, while it is listed, else the first. */
export function soulsOf(state) {
  const id = state.open, local = id !== null && state.ctxs.includes(id);
  const entry = local ? state.entries.get(id) ?? null : null;
  const deployment = entry?.deployment?.status === "observed" ? entry.deployment : null;
  const held = local ? state.souls.held.get(id) ?? null : null;
  const all = deployment && Array.isArray(held?.entry?.souls) ? soulRows(deployment, held.entry.souls) : [];
  const needle = state.souls.filter.query.trim().toLowerCase();
  const rows = needle ? all.filter((row) => soulMatches(row, needle)) : all;
  const selected = rows.find((row) => row.name === state.souls.selected) ?? rows[0] ?? null;
  return { local, deployment, held, all, rows, selected };
}

/** The most instances the detail names; the rest are counted, `+n`. */
const INSTANCES_NAMED = 8;

/** This machine's instances of a soul in the open workspace, in the list's order: the rows of
 *  another machine are not counted, since the view is of this machine's souls. */
function instancesOf(state, at, row) {
  const names = soulNames(row);
  return roster(state, at).ordered.filter((each) => !elsewhere(each) && names.includes(each.agent));
}

/** Where a soul comes from, in one value: the member it is in, and for a package soul the package
 *  and its version (the shared row's `repoName` already names the package when no member does). */
function soulFrom(row) {
  if (row.soulKind !== "package" || !text(row.package)) return row.repoName;
  const pkg = `package ${row.package}${text(row.version) ? ` ${row.version}` : ""}`;
  return row.repoName === `package ${row.package}` || !text(row.repoName) ? pkg : `${row.repoName} · ${pkg}`;
}

/** The selected soul's detail, from its row and the shared facts (soul-facts.mjs soulFacts, with
 *  no inspection): nothing of a soul is worded here but the labels the view puts beside them. */
function soulDetail(state, at, row) {
  const facts = soulFacts(row, null, state.cli, TERMS);
  const teams = Array.isArray(row.teams) && row.teams.length
    ? [...row.teams].sort((a, b) => (b.default === true) - (a.default === true)).map((team) => ({ label: team.label, default: team.default === true || team.label === row.defaultTeam?.label }))
    : null;
  const capabilities = Array.isArray(row.capabilities) && row.capabilities.length ? row.capabilities.map((c) => c.name) : null;
  const here = instancesOf(state, at, row);
  return {
    name: row.name, description: row.description ?? "", from: soulFrom(row), works: facts.work, refusal: facts.refusalLine,
    harness: { rows: facts.rows, notes: facts.notes, problem: facts.problem },
    teams, capabilities,
    instances: { shown: here.slice(0, INSTANCES_NAMED).map((each) => ({ name: each.instance, mark: markOf(each) })), more: Math.max(0, here.length - INSTANCES_NAMED) },
  };
}

/** What the Souls view draws, in a list pane `page` rows tall (views/souls.mjs): the state of the
 *  catalog, the window of its rows, and the selected soul's detail. A failed re-read keeps the
 *  rows it held, and says so on a heading above them, as a machine's heading says it. */
function soulsView(state, page, at) {
  const s = soulsOf(state), v = state.souls;
  const base = { local: s.local, failure: null, heading: null, list: [], above: 0, below: 0, focus: v.focus, filter: v.filter, detail: null, detailTop: v.detailTop };
  if (!s.local) return { ...base, state: "none" };
  const entry = s.held?.entry ?? null, reason = entry?.reason ?? null;
  if (!Array.isArray(entry?.souls)) {
    // Nothing held: the first read is in flight (or the deployment not read yet), or it failed.
    return reason && !s.held.reading ? { ...base, state: "failed", failure: catalogFailure(reason) } : { ...base, state: "reading" };
  }
  const heading = reason ? { label: "Souls", path: null, state: null, short: catalogFailure(reason), readAt: clockTime(entry.observedAt) } : null;
  const state_ = !s.all.length ? "none" : !s.rows.length ? "nomatch" : "rows";
  const height = Math.max(1, page - (heading ? 1 : 0));
  const at_ = s.selected ? s.rows.indexOf(s.selected) : -1;
  const win = windowOf({ top: v.top, count: s.rows.length, height, keep: v.loose ? -1 : at_ });
  const count = (row) => instancesOf(state, at, row).length;
  return {
    ...base, state: state_, heading,
    list: s.rows.slice(win.top, win.top + win.size).map((row) => ({
      name: row.name, color: SOUL_COLOURS[row.color] ?? null, count: count(row), refused: spawnRefusal(row, state.cli) !== null, selected: row === s.selected,
    })),
    above: win.above, below: win.below,
    // The heading has room for little of a failed re-read's sentence: the detail holds it whole,
    // as a machine's full reason stands in the detail of each of its rows.
    detail: s.selected ? { ...soulDetail(state, at, s.selected), failure: heading ? heading.short : null } : null,
  };
}
