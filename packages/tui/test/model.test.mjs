process.env.TZ = "UTC"; // a clock time on the screen is local: every time here is computed in one zone
// The model: from the store's state to what is drawn. What it shows is asked of the shared home,
// so each expected order, word and sentence here is what the shared function answers when it is
// called directly (through lib/client.mjs), never a copy of it. Every entry is made by the shared
// functions (helpers.mjs); no test needs a terminal, a timer or a process.
import test from "node:test";
import assert from "node:assert/strict";
import {
  TERMS, panelData, rosterRows, livenessInput, livenessAnswers, panelInstances, observedEntry, instanceId, instanceVisibleInTree, waitingRollup, collapseKey,
  filterInstanceTree, heldHome, rosterSections, deploymentState, rowStale, primaryDeployment, runtimeState as sharedState, runtimeCounts,
  waitingClaim, waitingLabel, waitedText, waitingClock, waitingBelowText, instanceActs,
} from "../lib/client.mjs";
import { WORD_MAX, clockTime, disclosure, model, panelOf, roster } from "../lib/model.mjs";
import { windowOf } from "../lib/views/scroll.mjs";
import { CLI, DEPLOYMENT, NOW, failed, instanceRow, observed, press, rosterOf, stateOf } from "./helpers.mjs";

const AT = new Date(NOW).toISOString();
const OBSERVED_AT = "2026-10-11T10:00:00.000Z";
const STOPPED = { running: false, runtimeState: "stopped" };
const TIMEOUT = { code: "E_CLI_TIMEOUT", message: "the read did not answer in time" };
const UNREADABLE = { code: "E_REMOTE_UNREADABLE", message: "the remote cache could not be read" };
const SINCE = "2026-10-11T09:56:00.000Z";
/** A waiting claim as it arrives in a panel row: the shared reader has already read it. */
const claimOf = (reason, message = null) => ({ since: SINCE, producer: "claude", reason, message });

/** What the views are given for a state, in a list pane `page` rows tall. */
const view = (state, page = 19, now = NOW) => model(state, { page, now, at: AT });
/** The same state with another instance selected, by name (and soul, for a name two souls have). */
function on(state, name, soul) {
  const item = roster(state).rows.find(({ row }) => row.instance === name && (soul === undefined || row.agent === soul));
  return Object.freeze({ ...state, selected: item.id });
}
/** The same state with these instances collapsed. */
const folded = (state, ...names) => Object.freeze({ ...state, collapsed: new Set(names.map((name) => collapseKey(DEPLOYMENT, panelRow(state, name).id))) });
/** A drawn item by name: `{ row, id, depth }`, the row being the panel's. */
const panelRow = (state, name) => roster(state).rows.find(({ row }) => row.instance === name);
const listRow = (state, name, soul) => view(on(state, name, soul)).list.find((row) => row?.selected);
const detailOf = (state, name, now = NOW) => view(on(state, name), 19, now).detail;
const fact = (detail, label) => detail.facts.find((f) => f.label === label) ?? null;
const labels = (detail) => detail.facts.map((f) => f.label);
/** The fact on the line after a labelled one. */
const after = (detail, label) => detail.facts[detail.facts.findIndex((f) => f.label === label) + 1] ?? null;
const names = (state) => roster(state).items.map((item) => item && item.row.instance);
const solos = (...list) => list.map((name) => instanceRow("dev", name));

/** `held`, field by field as the spec's "The store" gives it: what the shared composition reads of a client. */
const heldOf = (state, at) => ({
  ctxs: [state.deployment], snapshot: { byWs: new Map([[state.deployment, state.entry]]) }, remoteGroups: [],
  remembered: { get: () => null, note: () => null, all: () => [] }, rosterAnswered: true, rosterFailure: null, cli: state.cli,
  observing: new Set(), remoteCollecting: false, home: state.home, at,
});
const sharedPanel = (state) => panelData(heldOf(state, AT), DEPLOYMENT, TERMS);

/** The groups the shared functions give for a state, asked as the spec's steps 1 to 3 say. */
function sharedGroups(state) {
  const panel = sharedPanel(state), query = state.filter.query, filtering = query.trim() !== "";
  const visible = filterInstanceTree(panel.instances, query).filter((row) => instanceVisibleInTree(row, panel.instances, state.collapsed, DEPLOYMENT, filtering));
  const sections = rosterSections(panel.instances, visible, panel.deployments, TERMS);
  assert.equal(sections.length, 1, "one deployment is one section");
  return sections[0].groups;
}
/** The instances in the order the shared functions give: every group in the order given, every
 *  cluster's members in order with their depth. It holds whatever a collapse or a filter hides. */
const sharedRows = (state) => sharedGroups(state).flatMap((group) => group.clusters.flatMap((cluster) => cluster.instances.map((row) => [instanceId(row), row.depth])));
/** The same with one empty item before the group of single instances when clusters came before
 *  it. Only for a state that hides nothing: there a group of single instances is a group whose
 *  clusters hold one instance each. While a collapse or a filter hides part of a cluster, which
 *  group it is drawn in, and so where the empty item stands, is the shared grouping's to decide
 *  (awebai/oats#971), and no test here pins it. */
function sharedOrder(state) {
  assert.equal(state.collapsed.size === 0 && state.filter.query.trim() === "", true, "sharedOrder is for a state that hides nothing");
  const out = [];
  for (const group of sharedGroups(state)) {
    if (group.clusters.every((cluster) => cluster.instances.length === 1) && out.length) out.push(null);
    for (const cluster of group.clusters) for (const row of cluster.instances) out.push([instanceId(row), row.depth]);
  }
  return out;
}
const drawnOrder = (state) => roster(state).items.map((item) => item && [item.id, item.depth]);
const drawnRows = (state) => roster(state).rows.map((item) => [item.id, item.depth]);
/** The names drawn, without the empty item. */
const listed = (state) => names(state).filter(Boolean);

/** The collector as a probe that agrees with the kernel, and as its documented answer for a row
 *  the kernel answered `running: null` (liveness.mjs `observeLiveness`, which a test here cannot
 *  load): such a row is not probed, keeps the kernel's `running`, `runtimeState` and
 *  `runtimeError`, and its answer carries no `tmux`. A probed row comes back with a window id. */
const collector = (row) => (row.running === null
  ? { running: null, runtimeState: row.runtimeState ?? "unreachable", ...(row.runtimeError ? { runtimeError: row.runtimeError } : {}) }
  : { tmux: { ...row.tmux, windowId: "@7" }, running: row.running, runtimeState: row.runtimeState });
/** One read cycle as lib/read.mjs runs it, every step a shared function: the kernel's rows, the
 *  collector's input as the JSON it is given, what it printed (`null`: it failed as a whole), the
 *  answers, the panel's rows and the entry. */
function cycle(kernelRows, { collect = collector, team } = {}) {
  const document = rosterOf(kernelRows, { team }), rows = rosterRows(document, CLI);
  const input = JSON.parse(JSON.stringify(livenessInput(rows)));
  const answers = livenessAnswers(rows, collect ? JSON.stringify(input.map(collect)) : null);
  const entry = observedEntry({ roster: document, workspaceStatus: { workspace: { name: "lfx-workspace" } }, observedAt: OBSERVED_AT }, panelInstances(rows, answers), AT);
  return { rows, input, answers, entry };
}

// --- The roster is the Desktop's --------------------------------------------------------

// The rows of packages/desktop/test/palette-tree.test.mjs, "an empty query lists every instance in
// the sidebar's groups, order and depth, then the commands": two relation clusters and two
// unrelated instances, deliberately out of order. Copied as [name, what the row says]; the
// Desktop's fixture gives each a home of its own, as instanceRow does.
const PALETTE = [
  ["solo-y", { running: false }], ["grandchild", { parentInstance: "child-a" }], ["lead", {}], ["child-b", { parentInstance: "lead", running: false }],
  ["alpha", { running: false }], ["solo-x", {}], ["child-a", { parentInstance: "lead" }], ["alpha-kid", { parentInstance: "alpha" }],
];
const TREE = PALETTE.map(([name, extra]) => instanceRow("dev", name, extra.running === false ? { ...extra, runtimeState: "stopped" } : extra));

test("the roster is the Desktop's: the rows of its palette test come out in the order and at the depths that test asserts", () => {
  const state = stateOf(observed(TREE));
  // That test's expected rows, [group, name, depth], without the group's label: one empty item
  // stands where its "independent" group begins.
  assert.deepEqual(roster(state).items.map((item) => item && [item.row.instance, item.depth]), [
    ["alpha", 0], ["alpha-kid", 1],
    ["lead", 0], ["child-a", 1], ["grandchild", 2], ["child-b", 1],
    null, ["solo-x", 0], ["solo-y", 0],
  ]);
  assert.deepEqual(roster(state).rows.map((item) => item.row.instance), ["alpha", "alpha-kid", "lead", "child-a", "grandchild", "child-b", "solo-x", "solo-y"]);
  // Its second assertion, a query: matches at their depth under their ancestors, in tree order.
  // (One cluster is drawn and no other group: the order inside a cluster is all this reads.)
  assert.deepEqual(roster(press(state, ["/", "g", "r", "a", "n", "d", "enter"]).state).rows.map((item) => [item.row.instance, item.depth]), [["lead", 0], ["child-a", 1], ["grandchild", 2]]);
  assert.deepEqual(roster(press(state, ["/", "c", "h", "i", "l", "d", "enter"]).state).rows.map((item) => item.row.instance), ["lead", "child-a", "grandchild", "child-b"]);
});

test("the roster is the Desktop's: the rows of its instance-tree test keep parent-first order, running first among siblings, and sibling-linked peers at depth 0", () => {
  // packages/desktop/test/instance-tree.test.mjs, "clusterInstances: connected components over
  // parent + sibling links; unrelated are single-node clusters".
  const rows = [
    ["coord-1", { running: true }], ["dev-a", { parentInstance: "coord-1", running: true }], ["dev-b", { parentInstance: "coord-1", running: false }],
    ["reviewer-1", { parentInstance: "dev-a", running: true }],
    ["peer-1", { siblingInstance: "peer-2", relation: "sibling", relativeTo: "peer-2", running: false }], ["peer-2", { running: false }],
    ["loner", { running: true }],
  ].map(([name, extra]) => instanceRow("dev", name, extra.running ? extra : { ...extra, runtimeState: "stopped" }));
  const state = stateOf(observed(rows));
  const items = roster(state).items.map((item) => item && [item.row.instance, item.depth]);
  assert.deepEqual(items.slice(0, 4), [["coord-1", 0], ["dev-a", 1], ["reviewer-1", 2], ["dev-b", 1]], "parent first, and the running sibling before the stopped one");
  assert.deepEqual(new Set(items.slice(4, 6).map((item) => item[0])), new Set(["peer-1", "peer-2"]), "a sibling link alone joins a cluster");
  assert.deepEqual(items.slice(4, 6).map((item) => item[1]), [0, 0]);
  assert.deepEqual(items.slice(6), [null, ["loner", 0]], "the unrelated instance stands alone, after the clusters");
  assert.deepEqual(drawnOrder(state), sharedOrder(state));
});

test("the drawn order is what the shared grouping gives when it is called directly: plain, collapsed, filtered, and after a row stops", () => {
  const state = stateOf(observed(TREE));
  const cases = {
    plain: state,
    "a child collapsed": folded(state, "child-a"),
    "a root collapsed": folded(state, "alpha"),
    "both roots collapsed": folded(state, "alpha", "lead"),
    "a filter on a cluster": press(state, ["/", "c", "h", "i", "l", "d", "enter"]).state,
    "a filter on single instances": press(state, ["/", "s", "o", "l", "o", "enter"]).state,
    "a filter on the soul": press(state, ["/", "d", "e", "v", "enter"]).state,
    "a filter under a collapsed row": press(folded(state, "lead"), ["/", "g", "r", "a", "n", "d", "enter"]).state,
    "the running lead stopped": stateOf(observed(TREE.map((row) => (row.instance === "lead" ? { ...row, ...STOPPED } : row)))),
    "every row stopped": stateOf(observed(TREE.map((row) => ({ ...row, ...STOPPED })))),
  };
  for (const [what, s] of Object.entries(cases)) {
    assert.deepEqual(drawnRows(s), sharedRows(s), what);
    if (s.collapsed.size === 0 && s.filter.query === "") assert.deepEqual(drawnOrder(s), sharedOrder(s), `${what}: with the empty item`);
    assert.equal(roster(s).items.filter((item) => item === null).length <= 1, true, `${what}: never two empty items`);
    assert.deepEqual(roster(s).rows, roster(s).items.filter(Boolean), what);
    assert.deepEqual([...roster(s).index], roster(s).items.flatMap((item, i) => (item ? [[item.id, i]] : [])), `${what}: the index is each row's place`);
  }
  assert.equal(roster(cases.plain).rows.length, TREE.length);
});

test("one empty item stands before the group of single instances exactly when clusters came before it", () => {
  const empties = (state) => names(state).flatMap((name, i) => (name === null ? [i] : []));
  const both = stateOf(observed(TREE));
  assert.deepEqual(empties(both), [6], "after the six rows of the two clusters, and nowhere between the clusters");
  assert.deepEqual(empties(stateOf(observed(solos("a", "b", "c")))), [], "only single instances: none");
  const clusters = stateOf(observed(TREE.filter((row) => !row.instance.startsWith("solo"))));
  assert.deepEqual(empties(clusters), [], "only clusters: none");
  assert.deepEqual(names(clusters), ["alpha", "alpha-kid", "lead", "child-a", "grandchild", "child-b"]);
  assert.deepEqual(names(press(both, ["/", "s", "o", "l", "o", "enter"]).state), ["solo-x", "solo-y"], "a filter that leaves only single instances: none");
  assert.deepEqual(names(press(both, ["/", "k", "i", "d", "enter"]).state), ["alpha", "alpha-kid"], "a filter that leaves only a cluster: none");
  assert.deepEqual(empties(stateOf(observed([]))), []);
  // The window carries the empty item at its place: the view draws an empty row there.
  assert.deepEqual(view(both).list.map((row) => row && row.name), ["alpha", "alpha-kid", "lead", "child-a", "grandchild", "child-b", null, "solo-x", "solo-y"]);
});

// --- The panel --------------------------------------------------------------------------

test("panelOf is the shared panelData over what the store holds, for a pending, an unavailable, an observed and a stale entry", () => {
  const entry = observed(TREE, { withheld: [{ agent: "dev", instance: "twice", reason: "duplicate-home" }] });
  const cases = {
    pending: stateOf(null, { home: "/srv" }),
    unavailable: stateOf(failed(entry, TIMEOUT), { home: "/srv" }),
    observed: stateOf(entry, { home: "/srv" }),
    stale: stateOf(failed(entry, UNREADABLE), { home: "/srv" }),
  };
  for (const [what, state] of Object.entries(cases)) {
    for (const at of [AT, "2026-10-11T11:11:11.000Z"]) assert.deepEqual(panelOf(state, at), panelData(heldOf(state, at), DEPLOYMENT, TERMS), what);
  }
  const status = (state) => panelOf(state, AT).deployment.status;
  assert.deepEqual(Object.values(cases).map(status), ["pending", "unavailable", "observed", "observed"]);
  // Each thing the store holds reaches the panel: the entry's rows, tagged with their deployment,
  // its stamps, its failure, and the home the short label is cut by.
  const live = panelOf(cases.observed, AT), stale = panelOf(cases.stale, AT);
  assert.equal(live.instances.length, TREE.length);
  assert.equal(live.instances.every((row) => row.deployment.id === DEPLOYMENT), true);
  assert.deepEqual([live.generatedAt, live.observedAt], [entry.generatedAt, entry.observedAt]);
  assert.equal(live.deployment.withheld.length, 1);
  assert.equal(live.error, undefined);
  assert.equal(stale.error, UNREADABLE.message);
  assert.equal(live.deployments.length, 1, "this version shows one deployment");
  assert.notEqual(live.deployments[0].label, panelOf(stateOf(entry, { home: "/elsewhere" }), AT).deployments[0].label, "the label is cut by the home the store holds");
});

// --- A row the kernel answered as unknown ----------------------------------------------

test("a row the kernel answered running null and unreachable keeps the kernel's three fields and its tmux, draws the unknown mark with the kernel's word, and offers exactly the shared acts", () => {
  const kernel = { running: null, runtimeState: "unreachable", runtimeError: "tmux: the socket /run/user/1000/oats/agents.sock could not be read", tmux: { session: "oats-agents", window: "lost" } };
  const { input, entry } = cycle([instanceRow("dev", "fine"), instanceRow("dev", "lost", kernel)]);
  assert.equal(input.find((row) => row.instance === "lost").running, null, "the collector is told the kernel answered null");
  assert.equal(input.find((row) => row.instance === "fine").running, true);
  const state = stateOf(entry), { row } = panelRow(state, "lost");
  assert.deepEqual({ running: row.running, runtimeState: row.runtimeState, runtimeError: row.runtimeError, tmux: row.tmux }, kernel);
  assert.equal(panelRow(state, "fine").row.tmux.windowId, "@7", "a probed row has the collector's tmux; the unknown one the kernel's, with no window id");
  const drawn = listRow(state, "lost");
  assert.deepEqual({ mark: drawn.mark, word: drawn.word, waiting: drawn.waiting }, { mark: "unknown", word: "unreachable", waiting: false });
  assert.deepEqual(listRow(state, "fine").mark, "running");
  // Its acts are the shared answer, and that answer has neither start nor restart.
  const acts = instanceActs(row);
  assert.deepEqual(acts.acts.map((act) => act.verb), ["inspect", "stop", "retire"]);
  assert.deepEqual([acts.blocked, acts.limited], [null, null]);
  const detail = detailOf(state, "lost");
  assert.equal(fact(detail, "state").value, "unreachable");
  assert.deepEqual(after(detail, "state"), { label: "", value: `"${kernel.runtimeError}"`, form: "wrap" }, "the kernel's text on the next line, as a quote");
  assert.equal(fact(detail, "held"), null, "nothing of the TUI's own is said about it");
  assert.deepEqual(view(state).counts.map((count) => [count.n, count.word]), Object.entries(runtimeCounts(sharedPanel(state).instances)).filter(([, n]) => n > 0).map(([word, n]) => [n, word]));
  assert.equal(runtimeCounts(sharedPanel(state).instances).unknown, 1);
});

test("when the collector fails as a whole every row reads unknown, with the shared sentence in its detail", () => {
  const rows = [instanceRow("dev", "fine"), instanceRow("dev", "idle", STOPPED), instanceRow("dev", "lost", { running: null, runtimeState: "unreachable", runtimeError: "the kernel's own reason" })];
  const { answers, entry } = cycle(rows, { collect: null });
  const sentence = answers[0].runtimeError;
  assert.equal(typeof sentence === "string" && sentence.length > 0, true);
  assert.equal(answers.every((answer) => answer.running === null && answer.runtimeError === sentence), true);
  const state = stateOf(entry);
  for (const name of ["fine", "idle", "lost"]) {
    const drawn = listRow(state, name), detail = detailOf(state, name);
    assert.equal(drawn.mark, "unknown", name);
    assert.equal(drawn.word, panelRow(state, name).row.runtimeState, name);
    assert.equal(fact(detail, "state").value, panelRow(state, name).row.runtimeState, name);
    assert.deepEqual(after(detail, "state"), { label: "", value: `"${sentence}"`, form: "wrap" }, name);
    assert.deepEqual(instanceActs(panelRow(state, name).row).acts.map((act) => act.verb), ["inspect", "stop", "retire"], name);
  }
  assert.deepEqual(view(state).counts, [{ n: 3, word: "unknown", shared: true }]);
});

// --- What a failed read is shown as -----------------------------------------------------

/** A cluster with two waiting rows below its root, and a single instance that waits. */
const WAITERS = [
  instanceRow("dev", "lead"),
  instanceRow("dev", "child-a", { parentInstance: "lead", waitingOnYou: claimOf("question", "Which base should it use?") }),
  instanceRow("dev", "grandchild", { parentInstance: "child-a", waitingOnYou: claimOf("permission") }),
  instanceRow("dev", "child-b", { parentInstance: "lead" }),
  instanceRow("dev", "solo", { waitingOnYou: claimOf("attention", "Done, have a look.") }),
];

test("a stale entry reads stale through the shared panel: every row is held stale, a waiting claim on such a row is not shown, and the notice says so with the time and the reason", () => {
  const entry = observed(WAITERS), live = stateOf(entry), state = stateOf(failed(entry, UNREADABLE));
  const panel = sharedPanel(state), said = deploymentState(primaryDeployment(panel.deployments));
  assert.equal(said.key, "stale");
  assert.equal(panel.instances.length, WAITERS.length, "the rows are the last observation's");
  for (const row of panel.instances) {
    assert.equal(rowStale(row, panel.deployments), true, row.instance);
    assert.equal(waitingClaim(row, { stale: rowStale(row, panel.deployments) }), null, row.instance);
  }
  // The claims are still on the rows: only the stale reading hides them.
  assert.deepEqual(panel.instances.filter((row) => waitingClaim(row)).map((row) => row.instance).sort(), ["child-a", "grandchild", "solo"]);
  assert.deepEqual(view(live).list.filter(Boolean).filter((row) => row.waiting).map((row) => row.name).sort(), ["child-a", "grandchild", "solo"]);
  assert.deepEqual(view(state).list.filter(Boolean).map((row) => row.waiting), [false, false, false, false, false]);
  assert.deepEqual(view(live).counts.filter((count) => !count.shared), [{ n: 3, word: "need input", shared: false }]);
  assert.deepEqual(view(state).counts.filter((count) => !count.shared), [], "the header counts no one as needing input");
  assert.equal(view(state).counts.some((count) => count.word.includes("input")), false);
  assert.equal(fact(detailOf(live, "child-a"), "needs") !== null, true);
  for (const name of ["child-a", "grandchild", "solo"]) assert.equal(fact(detailOf(state, name), "needs"), null, name);
  assert.equal(detailOf(state, "child-a").facts.some((f) => f.value.includes("Which base")), false, "nor is its message quoted");
  // Collapsed over them, the stale root rolls nothing up either.
  assert.equal(view(on(folded(live, "lead"), "lead")).list.find((row) => row?.selected).below, 2);
  assert.equal(view(on(folded(state, "lead"), "lead")).list.find((row) => row?.selected).below, 0);
  assert.equal(fact(view(on(folded(state, "lead"), "lead")).detail, "below"), null);
  // Since the last good read: the cycle's own time, which a failed read leaves on the entry it
  // keeps, and not the kernel's older look at the remotes.
  assert.deepEqual([entry.generatedAt, entry.observedAt], ["2026-10-11T10:00:00.000Z", "2026-10-11T09:59:00.000Z"]);
  assert.deepEqual(view(state).notice, { text: said.text, since: clockTime(entry.generatedAt), reason: said.detail });
  assert.equal(view(state).notice.since, "10:00:00");
  assert.equal(sharedPanel(stateOf(failed(entry, UNREADABLE, "2026-10-11T10:07:00.000Z"))).generatedAt, entry.generatedAt, "a later failure does not move it");
  assert.equal(said.detail.includes(UNREADABLE.message), true, "the reason holds the kernel's message");
  assert.deepEqual([view(state).empty, view(state).observed], [null, true]);
  assert.equal(view(live).notice, null, "a live deployment has no notice");
});

test("an unavailable entry has no rows: the notice holds the shared state's words and its detail as the reason, and no empty line of the TUI's stands in", () => {
  const entry = observed(TREE), state = stateOf(failed(entry, TIMEOUT));
  const said = deploymentState(primaryDeployment(sharedPanel(state).deployments));
  assert.notEqual(said.key, "live");
  assert.equal(said.detail.includes(TIMEOUT.message), true);
  const m = view(state);
  assert.deepEqual(roster(state).rows, []);
  assert.deepEqual(m.list, []);
  assert.deepEqual([m.above, m.below], [0, 0]);
  assert.equal(m.notice.text, said.text);
  assert.equal(m.notice.reason, said.detail);
  assert.equal(m.empty, null);
  assert.equal(m.observed, false);
  assert.equal(m.detail, null);
  assert.deepEqual(m.counts, []);
  // The selection the user had is not drawn, and is not lost either (the store keeps it).
  assert.equal(view(press(stateOf(entry), ["j"]).state).detail.title, "alpha-kid");
});

test("the empty states: reading before the first answer, none for a deployment without instances, nomatch for a filter that matches nothing", () => {
  const pending = view(stateOf());
  assert.deepEqual([pending.empty, pending.notice, pending.observed, pending.readAt], ["reading", null, false, null]);
  assert.deepEqual(pending.list, []);
  const none = view(stateOf(observed([])));
  assert.deepEqual([none.empty, none.notice, none.observed, none.detail], ["none", null, true, null]);
  const nomatch = view(press(stateOf(observed(TREE)), ["/", "z", "z", "z", "enter"]).state);
  assert.deepEqual([nomatch.empty, nomatch.notice, nomatch.observed], ["nomatch", null, true]);
  assert.deepEqual(nomatch.list, []);
  assert.equal(nomatch.detail, null);
  assert.equal(view(stateOf(observed(TREE))).empty, null, "with rows to draw there is no empty line");
  // No instances and a filter: there is still nothing to match in.
  assert.equal(view(press(stateOf(observed([])), ["/", "z", "enter"]).state).empty, "none");
});

test("the header's facts of a live deployment: its workspace's name, the time of the read as a local clock time, and what the store holds of the view", () => {
  // The read's own time, not the kernel's observation of the remotes, which a read in the
  // background reuses: here it is a minute older, and the header does not show it.
  const state = press(stateOf(observed(TREE, { workspace: "lfx-workspace", observedAt: "2026-10-11T14:02:27.000Z", at: "2026-10-11T14:03:27.000Z" })), ["j", "tab"]).state;
  const m = view(state);
  assert.equal(m.workspace, "lfx-workspace");
  assert.equal(m.readAt, clockTime("2026-10-11T14:03:27.000Z"));
  assert.equal(m.readAt, "14:03:27");
  assert.deepEqual({ view: m.view, focus: m.focus, filter: m.filter, ascii: m.ascii, detailTop: m.detailTop, helpTop: m.helpTop }, { view: "instances", focus: "detail", filter: { editing: false, query: "" }, ascii: false, detailTop: 0, helpTop: 0 });
  assert.equal(m.actions, state.actions);
  assert.deepEqual(m.list.filter((row) => row?.selected).map((row) => row.name), ["alpha-kid"], "one row is the selected one");
  assert.equal(m.detail.title, "alpha-kid");
  assert.equal(view(stateOf(observed(TREE), { ascii: true })).ascii, true);
});

// --- Marks and words --------------------------------------------------------------------

test("a row's mark is the shared word for its state, and its word is its harness when it runs, else the state the kernel named, else the shared word", () => {
  const rows = [
    instanceRow("dev", "runs", { harness: "codex" }),
    instanceRow("dev", "idle", STOPPED),
    instanceRow("dev", "shelly", { running: false, runtimeState: "shell" }),
    instanceRow("dev", "herdr", { running: null, runtimeState: "unsupported", runtimeError: "E_HERDR_REMOVED: this backend is gone", tmux: null }),
    instanceRow("dev", "lost", { running: null, runtimeState: "unreachable" }),
    instanceRow("dev", "old-idle", { running: false, runtimeState: undefined }),
    instanceRow("dev", "old-lost", { running: null, runtimeState: undefined }),
  ];
  const state = stateOf(observed(rows));
  const drawn = (name) => { const row = listRow(state, name); return [row.mark, row.word]; };
  assert.deepEqual(drawn("runs"), ["running", "codex"], "a running row shows its harness, as the row names it");
  assert.deepEqual(drawn("idle"), ["stopped", "stopped"]);
  assert.deepEqual(drawn("shelly"), ["shell", "shell"], "stopped, with a shell left in its terminal");
  assert.deepEqual(drawn("herdr"), ["unknown", "unsupported"]);
  assert.deepEqual(drawn("lost"), ["unknown", "unreachable"]);
  // A row that names no state: the shared word for what is known of it.
  assert.deepEqual(drawn("old-idle"), ["stopped", sharedState(panelRow(state, "old-idle").row)]);
  assert.deepEqual(drawn("old-lost"), ["unknown", sharedState(panelRow(state, "old-lost").row)]);
  // Every mark but the two refinements is the shared word itself.
  for (const name of ["runs", "idle", "herdr", "lost", "old-idle", "old-lost"]) assert.equal(drawn(name)[0], sharedState(panelRow(state, name).row), name);
  // The detail's state line says the same state, and for a running row "running", not its harness.
  for (const [name, word] of [["runs", "running"], ["idle", "stopped"], ["shelly", "shell"], ["herdr", "unsupported"], ["lost", "unreachable"], ["old-idle", "stopped"], ["old-lost", "unknown"]]) {
    assert.equal(fact(detailOf(state, name), "state").value, word, name);
  }
  assert.deepEqual(after(detailOf(state, "herdr"), "state"), { label: "", value: `"${panelRow(state, "herdr").row.runtimeError}"`, form: "wrap" });
  assert.equal(after(detailOf(state, "idle"), "state").label, "harness", "no reason, no quote line");
});

const HELD = [
  instanceRow("dev", "spawning", { ...STOPPED, spawnInProgress: true }),
  instanceRow("dev", "half-spawned", { ...STOPPED, rollbackIncomplete: true }),
  instanceRow("dev", "half-retired", { ...STOPPED, retirePending: true }),
  instanceRow("dev", "held-running", { retirePending: true }),
];

test("a held home of each of the three kinds carries the held mark, the shared home's word for its state, and in the detail the sentence the shared acts give", () => {
  const state = stateOf(observed(HELD));
  const kinds = [];
  for (const name of HELD.map((row) => row.instance)) {
    const { row } = panelRow(state, name), held = heldHome(row), acts = instanceActs(row), drawn = listRow(state, name);
    kinds.push(held.kind);
    assert.deepEqual([drawn.mark, drawn.word], ["held", held.state], name);
    const sentence = acts.blocked?.sentence ?? acts.limited.sentence;
    assert.deepEqual(fact(detailOf(state, name), "held"), { label: "held", value: sentence, form: "wrap" }, name);
    assert.equal(sentence.includes(name), true, "the shared sentence names the instance");
  }
  assert.deepEqual(new Set(kinds).size, 3, "three kinds of held home");
  assert.equal(listRow(state, "held-running").word, heldHome(panelRow(state, "held-running").row).state, "held wins over the harness of a running row");
  // A home that is not held has no such line.
  assert.equal(fact(detailOf(stateOf(observed(TREE)), "lead"), "held"), null);
});

test("a held home's detail says the held state on its state line, the same word as its list row", () => {
  const state = stateOf(observed(HELD));
  for (const name of HELD.map((row) => row.instance)) {
    assert.equal(fact(detailOf(state, name), "state").value, heldHome(panelRow(state, name).row).state, name);
    assert.equal(fact(detailOf(state, name), "state").value, listRow(state, name).word, name);
  }
});

// --- Waiting ----------------------------------------------------------------------------

test("a running row with a claim waits: its detail says why in the shared words and for how long at the time of the paint, then quotes its message as the agent's", () => {
  const state = stateOf(observed(WAITERS));
  const { row } = panelRow(state, "child-a"), claim = waitingClaim(row);
  assert.equal(claim.message, "Which base should it use?");
  assert.equal(listRow(state, "child-a").waiting, true);
  assert.equal(listRow(state, "lead").waiting, false);
  const detail = detailOf(state, "child-a");
  assert.deepEqual(fact(detail, "needs"), { label: "needs", value: `${waitingLabel(claim)}, ${waitedText(claim.since, NOW)}`, form: "line" });
  assert.deepEqual(after(detail, "needs"), { label: "", value: `the agent: "${claim.message}"`, form: "wrap" });
  // The waited time is the paint's: an hour later the same state says so.
  const later = NOW + 60 * 60 * 1000;
  assert.notEqual(waitedText(claim.since, later), waitedText(claim.since, NOW));
  assert.equal(fact(detailOf(state, "child-a", later), "needs").value, `${waitingLabel(claim)}, ${waitedText(claim.since, later)}`);
  // Each reason in the shared words, and a reason no table holds in the shared fallback.
  const reasons = stateOf(observed(["permission", "question", "attention", "something-new"].map((reason) => instanceRow("dev", reason, { waitingOnYou: claimOf(reason, "m") }))));
  for (const reason of ["permission", "question", "attention", "something-new"]) {
    assert.equal(fact(detailOf(reasons, reason), "needs").value, `${waitingLabel(claimOf(reason))}, ${waitedText(SINCE, NOW)}`, reason);
  }
  assert.deepEqual(view(state).counts.find((count) => !count.shared), { n: 3, word: "need input", shared: false });
  assert.equal(view(stateOf(observed(WAITERS.slice(0, 2)))).counts.find((count) => !count.shared).n, 1);
});

test("a claim on a row that does not run is not shown: stopped, a shell, unknown", () => {
  const waiting = { waitingOnYou: claimOf("question", "Still there?") };
  const rows = [
    instanceRow("dev", "idle", { ...STOPPED, ...waiting }), instanceRow("dev", "shelly", { running: false, runtimeState: "shell", ...waiting }),
    instanceRow("dev", "lost", { running: null, runtimeState: "unreachable", ...waiting }), instanceRow("dev", "runs", waiting),
  ];
  const state = stateOf(observed(rows));
  for (const name of ["idle", "shelly", "lost"]) {
    assert.equal(panelRow(state, name).row.waitingOnYou.message, "Still there?", "the claim is on the row");
    assert.equal(listRow(state, name).waiting, false, name);
    assert.equal(fact(detailOf(state, name), "needs"), null, name);
    assert.equal(detailOf(state, name).facts.some((f) => f.value.includes("Still there?")), false, name);
  }
  assert.equal(listRow(state, "runs").waiting, true);
  assert.deepEqual(view(state).counts.filter((count) => !count.shared), [{ n: 1, word: "needs input", shared: false }]);
  // A kernel that does not advertise the feature: its claims are dropped at the read.
  const old = stateOf(observed(rows, { cli: { ...CLI, features: CLI.features.filter((feature) => feature !== "waiting-on-you") } }));
  assert.equal(listRow(old, "runs").waiting, false);
});

test("a hostile waiting message never reaches the detail: the row still waits, by its label alone, with no quote line", () => {
  // The shared reader nulls such a message when it reads the kernel's row (waiting-on-you.mjs
  // `waitingOnYouData`, called by the deployment reader): what arrives in a panel row is
  // `message: null`. The first row is that. The other two leave the hostile text in the row, as
  // if a reader had not: the shared `waitingClaim` reads the claim again and nulls it too.
  const rows = [
    instanceRow("dev", "as-it-arrives", { waitingOnYou: claimOf("permission", null) }),
    instanceRow("dev", "control", { waitingOnYou: claimOf("permission", "run \x1b[31mthis\x07") }),
    instanceRow("dev", "override", { waitingOnYou: claimOf("permission", "safe ‮evil") }),
  ];
  const state = stateOf(observed(rows));
  for (const name of rows.map((row) => row.instance)) {
    const claim = waitingClaim(panelRow(state, name).row);
    assert.equal(claim.message, null, name);
    assert.equal(listRow(state, name).waiting, true, name);
    const detail = detailOf(state, name);
    assert.equal(fact(detail, "needs").value, `${waitingLabel(claim)}, ${waitedText(SINCE, NOW)}`, name);
    assert.equal(after(detail, "needs").label, "harness", `${name}: the next fact is the next label, not a quote`);
    assert.equal(detail.facts.some((f) => f.label === "" || f.value.includes("the agent") || f.value.includes("evil") || f.value.includes("\x1b")), false, name);
  }
});

// --- The roll-up ------------------------------------------------------------------------

test("a collapsed row counts the rows that wait below it and names them in the shared words; expanded, it counts none and each child carries its own mark", () => {
  const open = stateOf(observed(WAITERS));
  assert.deepEqual(view(open).list.filter(Boolean).map((row) => [row.name, row.waiting, row.below]), [["lead", false, 0], ["child-a", true, 0], ["grandchild", true, 0], ["child-b", false, 0], ["solo", true, 0]]);
  assert.equal(fact(detailOf(open, "lead"), "below"), null);
  const closed = press(open, ["h"]).state; // the first row, the selected one, is the cluster's root
  assert.equal(closed.collapsed.has(collapseKey(DEPLOYMENT, panelRow(open, "lead").id)), true);
  const under = waitingRollup(sharedPanel(closed).instances, closed.collapsed, DEPLOYMENT, { filtering: false, stale: () => false }).get(panelRow(closed, "lead").id);
  assert.deepEqual(under.map((row) => row.instance).sort(), ["child-a", "grandchild"]);
  const lead = listRow(closed, "lead");
  assert.deepEqual({ below: lead.below, waiting: lead.waiting, disclosure: lead.disclosure }, { below: 2, waiting: false, disclosure: "closed" });
  assert.deepEqual(fact(detailOf(closed, "lead"), "below"), { label: "below", value: waitingBelowText(under), form: "wrap" });
  assert.equal(after(detailOf(closed, "lead"), "state").label, "below", "after the state, before the harness");
  // A row that waits itself and has one waiting below it: both are said.
  const mid = folded(open, "child-a"), child = listRow(mid, "child-a");
  assert.deepEqual({ below: child.below, waiting: child.waiting }, { below: 1, waiting: true });
  assert.equal(listRow(mid, "lead").below, 0, "the root is open: nothing is hidden right below it that it must answer for");
  assert.deepEqual(labels(detailOf(mid, "child-a")).slice(0, 5), ["soul", "state", "needs", "", "below"]);
  // Collapsed over rows that do not wait: no count and no line.
  const quiet = folded(stateOf(observed(TREE)), "lead");
  assert.equal(listRow(quiet, "lead").below, 0);
  assert.equal(fact(detailOf(quiet, "lead"), "below"), null);
  // The header counts every waiting row, drawn or not.
  assert.equal(view(closed).counts.find((count) => !count.shared).n, 3);
});

// --- The filter -------------------------------------------------------------------------

test("a filter that matches a row under a collapsed parent shows it with its ancestors, leaves the collapse set as it is, and reads every disclosure as open", () => {
  const closed = folded(stateOf(observed(WAITERS)), "lead");
  assert.deepEqual(listed(closed).sort(), ["lead", "solo"], "the rows below the collapsed root are gone from the list");
  const lead = panelRow(closed, "lead");
  assert.equal(disclosure(closed, roster(closed), lead), "closed");
  const filtering = press(closed, ["/", "g", "r", "a", "n", "d", "enter"]).state;
  assert.deepEqual(listed(filtering), ["lead", "child-a", "grandchild"]);
  assert.equal(filtering.collapsed, closed.collapsed, "the same set");
  assert.deepEqual([...filtering.collapsed], [collapseKey(DEPLOYMENT, lead.id)]);
  const r = roster(filtering);
  assert.deepEqual(r.rows.map((item) => disclosure(filtering, r, item)), ["open", "open", null]);
  assert.deepEqual(view(filtering).list.filter(Boolean).map((row) => [row.name, row.disclosure, row.below]), [["lead", "open", 0], ["child-a", "open", 0], ["grandchild", null, 0]], "nothing is rolled up while every match is shown");
  // While the field is still open it is the same.
  const typing = press(closed, ["/", "g", "r"]).state;
  assert.deepEqual(listed(typing), ["lead", "child-a", "grandchild"]);
  assert.equal(disclosure(typing, roster(typing), panelRow(typing, "lead")), "open");
  // The filter cleared: the row is collapsed as before.
  const cleared = press(filtering, ["escape"]).state;
  assert.deepEqual(listed(cleared).sort(), ["lead", "solo"]);
  assert.equal(disclosure(cleared, roster(cleared), panelRow(cleared, "lead")), "closed");
  // A query of spaces alone filters nothing and hides nothing.
  const spaces = Object.freeze({ ...closed, filter: Object.freeze({ editing: true, query: "  " }) });
  assert.deepEqual(listed(spaces).sort(), ["lead", "solo"]);
  assert.equal(disclosure(spaces, roster(spaces), panelRow(spaces, "lead")), "closed");
});

test("the filter matches by name, by soul and by repository, whatever the case, through the shared matcher", () => {
  const rows = [instanceRow("oats-expert", "tui-reader"), instanceRow("dev", "plain", { repo: `${DEPLOYMENT}/Desktop-App` }), instanceRow("dev", "other")];
  const state = stateOf(observed(rows));
  const query = (text) => names(Object.freeze({ ...state, filter: Object.freeze({ editing: false, query: text }) })).sort();
  assert.deepEqual(query("READER"), ["tui-reader"]);
  assert.deepEqual(query("expert"), ["tui-reader"]);
  assert.deepEqual(query("desktop-app"), ["plain"]);
  assert.deepEqual(query(" other "), ["other"], "the ends are trimmed");
  for (const text of ["reader", "dev", "desktop", "nothing"]) {
    const s = Object.freeze({ ...state, filter: Object.freeze({ editing: false, query: text }) });
    assert.deepEqual(drawnRows(s), sharedRows(s), text);
  }
});

// --- Withheld rows and the counts -------------------------------------------------------

test("withheld rows are counted in the header and never drawn as rows", () => {
  const withheld = [{ agent: "dev", instance: "twice", reason: "duplicate-home" }, { agent: "dev", instance: "astray", reason: "home-outside-soul" }];
  const state = stateOf(observed(solos("a", "b"), { withheld }));
  assert.equal(sharedPanel(state).deployment.withheld.length, 2);
  assert.deepEqual(view(state).counts.find((count) => count.word === "withheld"), { n: 2, word: "withheld", shared: false });
  assert.deepEqual(names(state), ["a", "b"]);
  assert.deepEqual(view(state).list.map((row) => row.name), ["a", "b"]);
  assert.equal(view(stateOf(observed(solos("a", "b"), { withheld: [] }))).counts.some((count) => count.word === "withheld"), false, "none withheld: no count");
  // A stale entry still holds the observation's withheld rows; an unavailable one has none to count.
  assert.equal(view(stateOf(failed(observed(solos("a"), { withheld }), UNREADABLE))).counts.find((count) => count.word === "withheld").n, 2);
  assert.equal(view(stateOf(failed(observed(solos("a"), { withheld }), TIMEOUT))).counts.length, 0);
});

test("the three state counts are the shared counts of the panel's rows, and a count of zero is left out", () => {
  const mixes = {
    "running and stopped": [...solos("a", "b"), instanceRow("dev", "c", STOPPED)],
    "all three": [...solos("a"), instanceRow("dev", "c", STOPPED), instanceRow("dev", "d", STOPPED), instanceRow("dev", "e", { running: null, runtimeState: "unreachable" })],
    "only stopped": [instanceRow("dev", "c", STOPPED)],
    "only unknown": [instanceRow("dev", "e", { running: null, runtimeState: "unsupported" })],
    "the tree": TREE,
    none: [],
  };
  for (const [what, rows] of Object.entries(mixes)) {
    const state = stateOf(observed(rows)), shared = runtimeCounts(sharedPanel(state).instances), counts = view(state).counts;
    assert.deepEqual(Object.keys(shared).sort(), ["running", "stopped", "unknown"]);
    for (const [word, n] of Object.entries(shared)) {
      assert.deepEqual(counts.filter((count) => count.word === word), n > 0 ? [{ n, word, shared: true }] : [], `${what}: ${word}`);
    }
    assert.equal(counts.every((count) => count.n > 0), true, what);
    assert.equal(counts.reduce((sum, count) => sum + (count.shared ? count.n : 0), 0), rows.length, what);
  }
  assert.deepEqual(view(stateOf(observed(mixes["all three"]))).counts.map((count) => count.word), ["running", "stopped", "unknown"], "in the order the shared count gives");
  // With the TUI's two counts: the waiting ones right after the running ones, the withheld last.
  const full = stateOf(observed([...WAITERS, instanceRow("dev", "idle", STOPPED), instanceRow("dev", "lost", { running: null, runtimeState: "unreachable" })], { withheld: [{ agent: "dev", instance: "twice", reason: "duplicate-home" }] }));
  assert.deepEqual(view(full).counts.map((count) => [count.n, count.word]), [[5, "running"], [3, "need input"], [1, "stopped"], [1, "unknown"], [1, "withheld"]]);
});

// --- The detail -------------------------------------------------------------------------

test("the detail's facts stand in the order of the spec's table: soul, state, its reason, held, needs, the message, below, harness, work, team, parent, started, home", () => {
  // One row made to hold every fact at once, so that each conditional line shows its place: it
  // runs, waits with a message, carries a reason, is a held home, and is collapsed over a row
  // that waits.
  const rows = [
    instanceRow("dev", "lead"),
    instanceRow("dev", "mid", { parentInstance: "lead", runtimeError: "the last probe was slow", rollbackIncomplete: true, waitingOnYou: claimOf("question", "Go on?") }),
    instanceRow("dev", "kid", { parentInstance: "mid", waitingOnYou: claimOf("permission") }),
  ];
  const state = on(folded(stateOf(observed(rows)), "mid"), "mid");
  const { row } = panelRow(state, "mid"), detail = view(state).detail;
  assert.equal(detail.title, "mid");
  assert.deepEqual(labels(detail), ["soul", "state", "", "held", "needs", "", "below", "harness", "work", "team", "parent", "started", "home"]);
  assert.deepEqual(fact(detail, "soul"), { label: "soul", value: "dev", form: "line" });
  assert.deepEqual(after(detail, "state"), { label: "", value: `"${row.runtimeError}"`, form: "wrap" });
  assert.equal(fact(detail, "held").value, instanceActs(row).limited.sentence);
  assert.equal(after(detail, "needs").value, `the agent: "${waitingClaim(row).message}"`);
  assert.equal(fact(detail, "below").value, waitingBelowText([panelRow(stateOf(observed(rows)), "kid").row]));
  assert.deepEqual(fact(detail, "harness"), { label: "harness", value: `${row.harness}, ${row.model} (${row.modelFrom})`, form: "line" });
  assert.deepEqual(fact(detail, "work"), { label: "work", value: `${row.work}, ${row.branch}`, form: "line" });
  assert.deepEqual(fact(detail, "team"), { label: "team", value: "lfx", form: "line" });
  assert.deepEqual(fact(detail, "parent"), { label: "parent", value: "lead", form: "line" });
  assert.deepEqual(fact(detail, "started"), { label: "started", value: waitingClock(row.startedAt, NOW), form: "line" });
  assert.deepEqual(fact(detail, "home"), { label: "home", value: row.home, form: "end" });
  assert.equal(row.home, instanceRow("dev", "mid").home);
});

test("a plain instance's detail has the eight lines the table always gives, less the ones whose value is absent", () => {
  const plain = detailOf(stateOf(observed(TREE)), "child-a");
  assert.deepEqual(labels(plain), ["soul", "state", "harness", "work", "team", "parent", "started", "home"]);
  assert.deepEqual(labels(detailOf(stateOf(observed(TREE)), "lead")), ["soul", "state", "harness", "work", "team", "started", "home"], "a root has no parent line");
  const without = (extra, options) => labels(detailOf(stateOf(cycle([instanceRow("dev", "bare", extra)], options).entry), "bare"));
  assert.deepEqual(without({}), ["soul", "state", "harness", "work", "team", "started", "home"]);
  assert.deepEqual(without({ startedAt: undefined }), ["soul", "state", "harness", "work", "team", "home"], "never started");
  assert.deepEqual(without({ harness: null, model: null }), ["soul", "state", "work", "team", "started", "home"], "no harness reported");
  assert.deepEqual(without({}, { team: null }), ["soul", "state", "harness", "work", "started", "home"], "a soul in no team");
  assert.deepEqual(without({ work: null, branch: null }), ["soul", "state", "harness", "team", "started", "home"], "no work mode and no branch");
  assert.deepEqual(without({ startedAt: undefined, harness: null, model: null, work: null, branch: null }, { team: null }), ["soul", "state", "home"]);
});

test("the detail's harness, work, parent and started lines: the model's origin in brackets only with a model, the branch only when there is one, a sibling named as one, and the start as the shared clock reads it at the paint", () => {
  const value = (extra, label, now = NOW) => fact(detailOf(stateOf(observed([instanceRow("dev", "one", extra), instanceRow("dev", "peer-2")])), "one", now), label)?.value ?? null;
  assert.equal(value({}, "harness"), "claude, claude-opus-5-5 (soul)");
  assert.equal(value({ modelFrom: "launch" }, "harness"), "claude, claude-opus-5-5 (launch)", "the field's own value");
  assert.equal(value({ modelFrom: undefined }, "harness"), "claude, claude-opus-5-5", "no origin said: no brackets");
  assert.equal(value({ model: null, modelFrom: "soul" }, "harness"), "claude", "an origin without a model is not shown");
  assert.equal(value({ harness: "codex", model: "gpt-5" }, "harness"), "codex, gpt-5 (soul)");
  assert.equal(value({ branch: null }, "work"), "worktree");
  assert.equal(value({ work: "attached", branch: "main" }, "work"), "attached, main");
  assert.equal(value({ siblingInstance: "peer-2", relation: "sibling", relativeTo: "peer-2" }, "parent"), "sibling of peer-2");
  assert.equal(value({ parentInstance: "peer-2" }, "parent"), "peer-2");
  assert.equal(value({}, "parent"), null);
  // The start: on the day of the paint a time, on another day with its date, in another year with the year.
  const started = "2026-10-11T09:00:00.000Z";
  for (const now of [NOW, NOW + 3 * 24 * 60 * 60 * 1000, NOW + 400 * 24 * 60 * 60 * 1000]) assert.equal(value({ startedAt: started }, "started", now), waitingClock(started, now));
  assert.equal(new Set([NOW, NOW + 3 * 24 * 60 * 60 * 1000, NOW + 400 * 24 * 60 * 60 * 1000].map((now) => value({ startedAt: started }, "started", now))).size, 3, "three forms, by the paint's day");
  assert.equal(value({ startedAt: started }, "started"), "09:00");
});

test("the detail is the selected instance's, and there is none when nothing is selected or the selection is not drawn", () => {
  const state = stateOf(observed(TREE));
  assert.equal(view(state).detail.title, "alpha", "the first row is selected by the first answer");
  assert.equal(view(on(state, "solo-y")).detail.title, "solo-y");
  assert.equal(view(Object.freeze({ ...state, selected: null })).detail, null);
  assert.equal(view(Object.freeze({ ...state, selected: "/not/a/home" })).detail, null);
  assert.equal(view(Object.freeze({ ...state, selected: "/not/a/home" })).list.some((row) => row?.selected), false);
  // Two instances with one name in two souls: each has its own detail.
  const twins = stateOf(observed([instanceRow("soul-a", "twin"), instanceRow("soul-b", "twin", STOPPED)]));
  assert.deepEqual(["soul-a", "soul-b"].map((soul) => fact(view(on(twins, "twin", soul)).detail, "soul").value), ["soul-a", "soul-b"]);
  assert.deepEqual(["soul-a", "soul-b"].map((soul) => listRow(twins, "twin", soul).mark), ["running", "stopped"]);
});

// --- Only the pane is laid out ----------------------------------------------------------

/** 300 instances; the shared grouping walks the roster for each row, so not the 10 000 of the bound. */
const CROWD = [
  ...Array.from({ length: 299 }, (_, i) => instanceRow("dev", `inst-${String(i).padStart(3, "0")}`)),
  instanceRow("dev", "zzz-last", { running: null, runtimeState: "unreachable" }),
];

test("only the rows in the pane are laid out, however many instances there are", () => {
  const state = stateOf(observed(CROWD));
  assert.equal(roster(state).rows.length, 300);
  for (const page of [10, 19, 1, 0]) {
    const m = view(state, page);
    assert.equal(m.list.length <= page, true, `a pane of ${page} rows lays out ${m.list.length}`);
    assert.equal(m.above + m.list.length + m.below, 300, `page ${page}`);
  }
  const m = view(on(state, "inst-150"), 10);
  assert.equal(m.list.length, 9, "a pane of 10 rows, its last row saying what is cut off");
  assert.equal(m.list.some((row) => row.selected && row.name === "inst-150"), true, "the selected row is among them");
  assert.deepEqual(m.list.map((row) => row.id), roster(state).items.slice(m.above, m.above + 9).map((item) => item.id), "the rows of the window, in order");
});

test("the word column is as wide as the widest word among all the rows of the list, drawn or not, and never wider than its cap", () => {
  const state = stateOf(observed(CROWD));
  const top = view(state, 10);
  assert.equal(top.list.some((row) => row.name === "zzz-last"), false, "the row with the widest word is far below the pane");
  assert.equal(top.list.every((row) => row.word === "claude"), true);
  assert.equal(top.wordWidth, "unreachable".length);
  assert.equal(view(on(state, "zzz-last"), 10).wordWidth, top.wordWidth, "the column does not move while the list scrolls");
  // After the filter: a row the filter hides lends no width.
  assert.equal(view(press(state, ["/", "i", "n", "s", "t", "enter"]).state, 10).wordWidth, "claude".length);
  assert.equal(WORD_MAX, 20);
  const wide = stateOf(observed([...solos("a", "b"), instanceRow("dev", "wordy", { running: false, runtimeState: "a-state-with-a-name-far-too-long-for-a-column" })]));
  assert.equal(view(wide).wordWidth, WORD_MAX);
  assert.equal(view(wide).list.find((row) => row.name === "wordy").word, "a-state-with-a-name-far-too-long-for-a-column", "the word is given whole: the view cuts it");
  assert.equal(view(stateOf(observed([]))).wordWidth, 0);
});

// --- The window -------------------------------------------------------------------------

test("the window of a pane: all the rows when they fit, else one row less than the pane, with what is cut off above and below", () => {
  const cases = [
    ["fits", { top: 0, count: 5, height: 10 }, { top: 0, size: 5, above: 0, below: 0 }],
    ["fits exactly", { top: 0, count: 10, height: 10 }, { top: 0, size: 10, above: 0, below: 0 }],
    ["fits, whatever top was", { top: 7, count: 5, height: 10 }, { top: 0, size: 5, above: 0, below: 0 }],
    ["one row too many", { top: 0, count: 11, height: 10 }, { top: 0, size: 9, above: 0, below: 2 }],
    ["cut below", { top: 0, count: 40, height: 19 }, { top: 0, size: 18, above: 0, below: 22 }],
    ["cut above and below", { top: 10, count: 40, height: 19 }, { top: 10, size: 18, above: 10, below: 12 }],
    ["cut above", { top: 22, count: 40, height: 19 }, { top: 22, size: 18, above: 22, below: 0 }],
    ["a top past the end is the last window", { top: 500, count: 40, height: 19 }, { top: 22, size: 18, above: 22, below: 0 }],
    ["a top before the start is the first", { top: -3, count: 40, height: 19 }, { top: 0, size: 18, above: 0, below: 22 }],
    ["no top is the first window", { count: 40, height: 19 }, { top: 0, size: 18, above: 0, below: 22 }],
    ["the kept row is the window's last: nothing moves", { top: 0, count: 40, height: 19, keep: 17 }, { top: 0, size: 18, above: 0, below: 22 }],
    ["the kept row is one below the window: one row down", { top: 0, count: 40, height: 19, keep: 18 }, { top: 1, size: 18, above: 1, below: 21 }],
    ["the kept row is the window's first: nothing moves", { top: 10, count: 40, height: 19, keep: 10 }, { top: 10, size: 18, above: 10, below: 12 }],
    ["the kept row is one above the window: one row up", { top: 10, count: 40, height: 19, keep: 9 }, { top: 9, size: 18, above: 9, below: 13 }],
    ["the kept row is the last of all", { top: 0, count: 40, height: 19, keep: 39 }, { top: 22, size: 18, above: 22, below: 0 }],
    ["the kept row is the first of all", { top: 22, count: 40, height: 19, keep: 0 }, { top: 0, size: 18, above: 0, below: 22 }],
    ["no kept row", { top: 10, count: 40, height: 19, keep: -1 }, { top: 10, size: 18, above: 10, below: 12 }],
    ["a kept row that does not exist is no kept row", { top: 10, count: 40, height: 19, keep: 40 }, { top: 10, size: 18, above: 10, below: 12 }],
    ["a pane of no rows shows none", { top: 3, count: 40, height: 0 }, { top: 0, size: 0, above: 0, below: 40 }],
    ["a pane of no rows, with a kept row", { top: 3, count: 40, height: 0, keep: 5 }, { top: 0, size: 0, above: 0, below: 40 }],
    ["no rows", { top: 3, count: 0, height: 19 }, { top: 0, size: 0, above: 0, below: 0 }],
    ["a pane of one row and one row", { top: 0, count: 1, height: 1 }, { top: 0, size: 1, above: 0, below: 0 }],
    ["a pane of one row shows the kept row", { top: 0, count: 40, height: 1, keep: 5 }, { top: 5, size: 1, above: 5, below: 34 }],
    ["a pane of two rows shows one and says the rest", { top: 0, count: 40, height: 2, keep: 5 }, { top: 5, size: 1, above: 5, below: 34 }],
  ];
  for (const [what, input, expected] of cases) assert.deepEqual(windowOf(input), expected, what);
});

test("the window, for every small pane, count, top and kept row: it never passes the pane, loses no row, holds the kept row, and moves the least", () => {
  for (let count = 0; count <= 14; count++) for (let height = 0; height <= 9; height++) for (let top = -1; top <= count + 1; top++) {
    const free = windowOf({ top, count, height });
    for (let keep = -1; keep <= count; keep++) {
      const win = windowOf({ top, count, height, keep }), where = `count ${count}, height ${height}, top ${top}, keep ${keep}`;
      assert.equal(win.size <= height && win.size >= 0, true, where);
      assert.equal(win.above + win.size + win.below, count, where);
      assert.equal(win.above, win.top, where);
      if (count > height && height >= 2) assert.equal(win.size, height - 1, `${where}: the last row is given up to say what is cut off`);
      if (count <= height) assert.deepEqual(win, { top: 0, size: count, above: 0, below: 0 }, where);
      const kept = keep >= 0 && keep < count && win.size > 0;
      if (kept) assert.equal(keep >= win.top && keep < win.top + win.size, true, `${where}: the kept row is inside`);
      // The least: a window that already held the row is not moved, and one that did not ends with the row at its edge.
      const held = keep >= free.top && keep < free.top + free.size;
      if (!kept || held) assert.equal(win.top, free.top, `${where}: nothing to move for`);
      else assert.equal(win.top === keep || win.top + win.size - 1 === keep, true, `${where}: the row at the nearer edge`);
    }
  }
});

test("the model's window is the store's top corrected for the pane, and its cut counts are the window's", () => {
  const rows = Array.from({ length: 40 }, (_, i) => instanceRow("dev", `inst-${String(i).padStart(2, "0")}`));
  const state = stateOf(observed(rows));
  const at = (name, top, page) => view(Object.freeze({ ...on(state, name), top }), page);
  const cut = (m) => [m.above, m.list.length, m.below, m.list[0]?.name ?? null];
  assert.deepEqual(cut(at("inst-00", 0, 19)), [0, 18, 22, "inst-00"]);
  assert.deepEqual(cut(at("inst-17", 0, 19)), [0, 18, 22, "inst-00"], "the last row of the window");
  assert.deepEqual(cut(at("inst-18", 0, 19)), [1, 18, 21, "inst-01"], "one past it");
  assert.deepEqual(cut(at("inst-20", 10, 19)), [10, 18, 12, "inst-10"]);
  assert.deepEqual(cut(at("inst-39", 0, 19)), [22, 18, 0, "inst-22"]);
  assert.deepEqual(cut(at("inst-39", 22, 40)), [0, 40, 0, "inst-00"], "a pane that holds them all");
  assert.deepEqual(cut(at("inst-30", 13, 10)), [22, 9, 9, "inst-22"], "a shorter pane than the top was kept for");
  assert.deepEqual(cut(at("inst-05", 0, 0)), [0, 0, 40, null], "a pane of no rows");
  for (const [name, top, page] of [["inst-00", 0, 19], ["inst-18", 0, 19], ["inst-39", 5, 7], ["inst-12", 30, 4], ["inst-25", 25, 2]]) {
    const m = at(name, top, page), win = windowOf({ top, count: 40, height: page, keep: Number(name.slice(5)) });
    assert.deepEqual([m.above, m.below, m.list.length], [win.above, win.below, win.size], `${name}, top ${top}, page ${page}`);
    assert.equal(m.list.some((row) => row.selected), true, "the selected row is drawn");
  }
});

// --- Relations the shared home has to make sense of -------------------------------------

test("a parent that is gone, a parent cycle and an ambiguous parent name: nothing throws and every instance is drawn exactly once", () => {
  const cases = {
    "a parent that is gone": [instanceRow("dev", "orphan", { parentInstance: "ghost" }), instanceRow("dev", "other")],
    "a cycle of two": [instanceRow("dev", "a", { parentInstance: "b" }), instanceRow("dev", "b", { parentInstance: "a" }), instanceRow("dev", "other")],
    "a cycle of three under a root": [instanceRow("dev", "a", { parentInstance: "c" }), instanceRow("dev", "b", { parentInstance: "a" }), instanceRow("dev", "c", { parentInstance: "b" }), instanceRow("dev", "kid", { parentInstance: "a" })],
    "its own parent": [instanceRow("dev", "self", { parentInstance: "self" }), instanceRow("dev", "other")],
    "an ambiguous parent name": [instanceRow("soul-a", "coord"), instanceRow("soul-b", "coord"), instanceRow("dev", "kid", { parentInstance: "coord" }), instanceRow("dev", "grandkid", { parentInstance: "kid" })],
    "a sibling that is gone": [instanceRow("dev", "peer", { siblingInstance: "ghost" }), instanceRow("dev", "other")],
  };
  for (const [what, rows] of Object.entries(cases)) {
    const state = stateOf(observed(rows)), ids = roster(state).rows.map((item) => item.id);
    assert.equal(ids.length, rows.length, `${what}: every instance is drawn`);
    assert.equal(new Set(ids).size, rows.length, `${what}: once`);
    assert.deepEqual(drawnOrder(state), sharedOrder(state), `${what}: as the shared grouping answers`);
    // Each row drawn, selected, collapsed and filtered for: no throw, and still every instance once.
    for (const item of roster(state).rows) {
      const selected = Object.freeze({ ...state, selected: item.id });
      assert.equal(view(selected).detail.title, item.row.instance, what);
      const closed = Object.freeze({ ...selected, collapsed: new Set([collapseKey(DEPLOYMENT, item.id)]) });
      const drawn = roster(closed).rows.map((row) => row.id);
      assert.equal(new Set(drawn).size, drawn.length, `${what}: no row twice with ${item.row.instance} collapsed`);
      assert.equal(drawn.includes(item.id), true, `${what}: a collapsed row is itself drawn`);
      assert.doesNotThrow(() => view(closed), what);
      const filtered = Object.freeze({ ...closed, filter: Object.freeze({ editing: false, query: item.row.instance }) });
      assert.equal(roster(filtered).rows.some((row) => row.id === item.id), true, `${what}: a filter for a row's name shows it`);
      assert.doesNotThrow(() => view(filtered), what);
      assert.doesNotThrow(() => press(selected, ["h", "h", "l", "l", "j", "k"]), what);
    }
  }
  // The ambiguous name joins nothing: the child is under neither of the two it could mean.
  const ambiguous = stateOf(observed(cases["an ambiguous parent name"]));
  assert.equal(panelRow(ambiguous, "kid").depth, 0);
  assert.deepEqual(roster(ambiguous).rows.filter((item) => item.row.instance === "coord").map((item) => disclosure(ambiguous, roster(ambiguous), item)), [null, null]);
  assert.equal(disclosure(ambiguous, roster(ambiguous), panelRow(ambiguous, "kid")), "open", "its own child is still its child");
});

// --- Clock times ------------------------------------------------------------------------

test("clockTime reads an ISO time as a local clock time, and anything else as none", () => {
  assert.equal(clockTime("2026-10-11T14:03:27.000Z"), "14:03:27");
  assert.equal(clockTime("2026-01-02T03:04:05.000Z"), "03:04:05", "two digits each");
  assert.equal(clockTime("2026-10-11T00:00:00.000Z"), "00:00:00");
  assert.equal(clockTime("2026-10-11T16:03:27.000+02:00"), "14:03:27", "local, whatever zone the string names");
  const at = new Date("2026-10-11T23:59:59.000Z");
  assert.equal(clockTime(at.toISOString()), [at.getHours(), at.getMinutes(), at.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":"));
  for (const invalid of ["", "yesterday", "14:03:27", "2026-13-45T99:99:99.000Z", "not a time"]) assert.equal(clockTime(invalid), null, JSON.stringify(invalid));
  for (const other of [null, undefined, 0, 1760176800000, NaN, true, {}, [], new Date(NOW)]) assert.equal(clockTime(other), null, String(other));
});
