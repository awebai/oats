process.env.TZ = "UTC";
// Each workspace keeps its tabs, layout, place and the palette's recency across a switch, for the
// run (docs/tui.md, "Tabs"): what a switch away closes and remembers, what coming back opens again
// and in what order, what is dropped, and what yields to the person. Every entry is made by the
// shared functions (helpers.mjs); no test needs a terminal or tmux.
import test from "node:test";
import assert from "node:assert/strict";
import { instanceId, observeIdentities, observedEntry, panelInstances, remoteRosterState, rosterRows } from "../lib/client.mjs";
import { memoryKey, paletteItems, preflightLine, roster } from "../lib/model.mjs";
import { TAB_LIMIT, reduce } from "../lib/store.mjs";
import { CLI, instanceRow, observed, rosterOf, stateOf, took } from "./helpers.mjs";

/** The geometry of the frame before each key, and the panel's room (a split needs one). */
const AT = Object.freeze({ page: 19, extent: 0, room: 19, cols: 38, panel: Object.freeze({ cols: 89, rows: 40 }) });
let reads = 0;
const key = (state, id) => reduce(state, { key: id, ...(id.length === 1 ? { text: id } : {}), read: ++reads, ...AT });
/** The leader alone, then `id`, each in a read of its own. */
function leaderThen(state, id) {
  const lead = state.terminal?.focus === "terminal" && state.view === "instances" && state.palette === null
    ? reduce(state, { back: true, read: ++reads, ...AT })
    : reduce(state, { key: state.leaderKey, read: ++reads, ...AT });
  return key(lead.state, id);
}
const idOf = (state, name) => instanceId(roster(state).instances.find((row) => row.instance === name));
const nameOf = (id) => id?.split("/").pop() ?? null;
const on = (state, name) => Object.freeze({ ...state, selected: idOf(state, name) });
/** The tab starting now, its window shown by the panel. */
const shown = (state) => { const tab = state.tabs.find((each) => each.status === "starting"); return tab ? reduce(state, { shown: { id: tab.id }, ...AT }) : { state, effect: null }; };
/** `name` opened with Enter from the list, its window shown. */
const enter = (state, name) => shown(key(on(state, name), "enter").state).state;
const opened = (state, ...names) => names.reduce(enter, state);
/** Every tab a restore opens, shown in turn: the effect of each step, and the state at the end. */
function settle(state) {
  const effects = [];
  for (let i = 0; i < 2 * TAB_LIMIT && state.tabs.some((tab) => tab.status === "starting"); i++) { const step = shown(state); effects.push(step.effect); state = step.state; }
  return { state, effects };
}
/** What a state's tabs and layout are, by name. */
const laid = (state) => ({
  tabs: state.tabs.map((tab) => `${tab.name}:${tab.group}`), split: state.split, group: state.group,
  shown: state.terminal?.name ?? null, aside: nameOf(state.aside), focus: state.terminal?.focus ?? null, zoom: state.terminal?.zoom ?? null,
});

/** Workspace A, this deployment: dev-a … dev-e, every one running. */
const A_ROWS = () => ["dev-a", "dev-b", "dev-c", "dev-d", "dev-e"].map((name) => instanceRow("dev", name));
const A = () => stateOf(observed(A_ROWS()));
/** Workspace B, another deployment of this machine, and its rows. */
const OTHER = "/srv/other";
const B_ROWS = (names = ["ops-a", "ops-b", "ops-c", "ops-d"]) => names.map((name) => instanceRow("ops", name, { home: `${OTHER}/agents/ops/instances/${name}` }));
const B_ENTRY = (rows = B_ROWS()) => observed(rows, { workspace: "acme-billing" });
let cycle = 1;
/** Workspace `id` opened (as the switcher's pick of a served deployment does). */
const go = (state, id) => reduce(state, { admitted: id, at: "2026-10-11T10:01:00.000Z", ...AT });
/** B opened, its rows read. */
const toB = (state, rows) => took(go(state, OTHER).state, B_ENTRY(rows), ++cycle, OTHER);

/** A with dev-a, dev-b, dev-c in the first group and dev-d in the second, split side by side; dev-d
 *  shown with the focus, zoomed; dev-b shown in the first group. */
function laidOut() {
  let s = opened(A(), "dev-a", "dev-b", "dev-c");
  s = leaderThen(s, "left").state;
  s = leaderThen(s, "|").state;
  s = enter(s, "dev-d");
  return leaderThen(s, "z").state;
}
const LAID = Object.freeze({ tabs: ["dev-a:0", "dev-b:0", "dev-c:0", "dev-d:1"], split: "right", group: 1, shown: "dev-d", aside: "dev-b", focus: "terminal", zoom: true });

test("switching away closes every viewer of the workspace left and remembers its tabs; coming back opens them again one at a time, in their order, and the layout, the shown tabs, the focus and the zoom are as they were", () => {
  const a = laidOut();
  assert.deepEqual(laid(a), LAID);
  // Away, from the switcher (the leader then o), which takes the focus from the terminal.
  const picking = leaderThen(a, "o").state;
  assert.equal(picking.view, "switcher");
  const away = go(picking, OTHER);
  assert.deepEqual(away.effect.close, ["dev-a", "dev-b", "dev-c", "dev-d"].map((name) => idOf(a, name)), "the viewers of the workspace left end");
  assert.deepEqual([away.state.tabs, away.state.terminal, away.state.split], [[], null, null]);
  const b = enter(took(away.state, B_ENTRY(), ++cycle, OTHER), "ops-a");
  // Back: B's viewer ends, and A's first tab opens again, the list keeping the focus.
  const back = go(b, a.open);
  assert.deepEqual(back.effect.close, [idOf(b, "ops-a")]);
  assert.equal(back.effect.open.id, idOf(a, "dev-a"));
  assert.deepEqual([back.state.tabs.map((tab) => `${tab.name}:${tab.status}`), back.state.terminal.focus], [["dev-a:starting"], "list"]);
  // One at a time: the next opens once the one before is shown.
  const { state: restored, effects } = settle(back.state);
  assert.deepEqual(effects.map((effect) => effect?.open?.name ?? (effect?.show ? `show ${nameOf(effect.show)}` : null)), ["dev-b", "dev-c", "dev-d", "show dev-d"]);
  assert.deepEqual(laid(restored), LAID);
  assert.equal(restored.restoring, null);
  assert.equal(restored.view, "instances");
});

test("a workspace opened for the first time has no memory: nothing opens, as before", () => {
  const away = toB(opened(A(), "dev-a"));
  assert.deepEqual([away.tabs, away.restoring, away.terminal], [[], null, null]);
});

test("each workspace restores its own tabs: two workspaces with four tabs each", () => {
  const a = opened(A(), "dev-a", "dev-b", "dev-c", "dev-d");
  const b = opened(toB(a), "ops-a", "ops-b", "ops-c", "ops-d");
  const backA = settle(go(b, a.open).state).state;
  assert.deepEqual(laid(backA).tabs, ["dev-a:0", "dev-b:0", "dev-c:0", "dev-d:0"]);
  assert.equal(backA.terminal.name, "dev-d");
  const backB = settle(go(backA, OTHER).state).state;
  assert.deepEqual(laid(backB).tabs, ["ops-a:0", "ops-b:0", "ops-c:0", "ops-d:0"]);
  assert.equal(backB.tabs.length <= TAB_LIMIT, true);
});

test("a remembered tab whose instance is gone or cannot be opened now is dropped on return, the line saying nothing; a split whose group empties leaves one group, and a dropped shown tab gives its place to the next", () => {
  const a = laidOut();
  const b = toB(leaderThen(a, "o").state);
  // While away: dev-d (alone in the second group) is retired, dev-b (shown in the first) stopped.
  const rows = A_ROWS().filter((row) => row.instance !== "dev-d").map((row) => (row.instance === "dev-b" ? { ...row, running: false, runtimeState: "stopped" } : row));
  const read = took(b, observed(rows), ++cycle, a.open);
  const back = settle(go(read, a.open).state).state;
  assert.deepEqual(laid(back), { tabs: ["dev-a:0", "dev-c:0"], split: null, group: 0, shown: "dev-c", aside: null, focus: "terminal", zoom: true });
  assert.equal(back.outcome, null, "nothing is said of what was dropped");
});

test("the rows not read yet: the restore waits for them, and an instance not read is not taken for gone", () => {
  const a = opened(A(), "dev-a", "dev-b");
  const b = toB(a);
  // A's deployment, read again and pending (as after a refresh that has not answered).
  const pendingA = reduce(b, { id: a.open, entry: { ...observed(A_ROWS()), deployment: { ...observed(A_ROWS()).deployment, status: "pending" } }, number: ++cycle }).state;
  const back = go(pendingA, a.open);
  assert.deepEqual([back.effect?.open, back.state.restoring?.queue.length], [undefined, 2], "nothing opens before the rows are read");
  const read = reduce(back.state, { id: a.open, entry: observed(A_ROWS()), number: ++cycle });
  assert.equal(read.effect?.open?.id, idOf(a, "dev-a"));
});

test("a switch while a restore is opening tabs: what is starting closes, the rest is remembered again, nothing opens in the other workspace, and the way back opens them all", () => {
  const a = opened(A(), "dev-a", "dev-b", "dev-c");
  const b = toB(a);
  const back = go(b, a.open).state;
  const first = shown(back).state;
  assert.deepEqual(first.tabs.map((tab) => `${tab.name}:${tab.status}`), ["dev-a:open", "dev-b:starting"]);
  // Away again with dev-b still starting.
  const again = go(first, OTHER);
  assert.deepEqual(again.effect.close, [idOf(a, "dev-a"), idOf(a, "dev-b")]);
  assert.equal(again.effect.open, undefined, "nothing of A opens in B");
  assert.deepEqual([again.state.tabs, again.state.restoring], [[], null]);
  // dev-b's window, made late, changes nothing in B.
  assert.deepEqual(reduce(again.state, { shown: { id: idOf(a, "dev-b") }, ...AT }).state.tabs, []);
  assert.deepEqual(again.state.layouts.get(memoryKey(a, a.open)).tabs.map((tab) => tab.name), ["dev-a", "dev-b", "dev-c"]);
  const home = settle(go(again.state, a.open).state).state;
  assert.deepEqual([laid(home).tabs, home.terminal.name], [["dev-a:0", "dev-b:0", "dev-c:0"], "dev-c"]);
});

test("a key of the person's while a restore runs keeps the focus where they put it: the tabs still open, and the list keeps the focus", () => {
  const a = laidOut();
  const back = go(toB(leaderThen(a, "o").state), a.open).state;
  const moved = key(back, "j").state;
  const done = settle(moved).state;
  assert.deepEqual(laid(done), { ...LAID, focus: "list", zoom: false });
});

test("the person's own open while a restore runs: the restore yields, and what it had not opened is dropped", () => {
  const a = opened(A(), "dev-a", "dev-b", "dev-c");
  const back = go(toB(a), a.open).state;
  const yielded = key(on(back, "dev-e"), "enter").state;
  assert.equal(yielded.restoring, null);
  const done = shown(yielded).state;
  assert.deepEqual(done.tabs.map((tab) => tab.name), ["dev-a"], "only what had opened");
  assert.equal(key(on(done, "dev-e"), "enter").effect.open.id, idOf(a, "dev-e"), "the person's next open goes through");
});

test("the palette's recency is per workspace: after A, B and A again, A's palette leads with A's last instances, and its first pick is the one shown before, in A", () => {
  let a = opened(A(), "dev-a", "dev-b", "dev-c");
  a = leaderThen(a, "left").state; // dev-b shown: recency dev-b, dev-c, dev-a
  const b = opened(toB(a), "ops-a", "ops-b", "ops-c");
  assert.deepEqual(b.recent.get(memoryKey(a, a.open)).map(nameOf), ["dev-b", "dev-c", "dev-a"], "B's opens leave A's recency as it was");
  const back = settle(go(b, a.open).state).state;
  assert.deepEqual(back.recent.get(memoryKey(a, a.open)).map(nameOf), ["dev-b", "dev-c", "dev-a"], "the restored shown tab is the most recent");
  const palette = leaderThen(back, "k").state, items = paletteItems(palette);
  assert.deepEqual(items.items.filter((item) => item.kind === "instance").slice(0, 3).map((item) => item.name), ["dev-b", "dev-c", "dev-a"]);
  assert.equal(nameOf(items.selected.split("\u0000")[1]), "dev-c", "open on the one before: in A");
});

test("the filter is kept per workspace, a field still being typed in kept as Enter keeps it; the place too", () => {
  const typed = ["/", "d", "e", "v", "-", "c"].reduce((s, k) => key(s, k).state, leaderThen(opened(A(), "dev-a"), "escape").state);
  assert.deepEqual(typed.filter, { editing: true, query: "dev-c" });
  const b = toB(typed);
  assert.deepEqual(b.filter, { editing: false, query: "" }, "B has its own");
  const back = go(b, typed.open).state;
  assert.deepEqual(back.filter, { editing: false, query: "dev-c" });
});

test("another machine's tab is asked first again on return, as an open is; one whose preflight fails is dropped with the line that says why", () => {
  const a = remoteA();
  const id = idOf(a, FAR_A);
  const asked = key(on(a, FAR_A), "enter").state;
  const far = shown(reduce(asked, { prepared: { id } }).state).state;
  const withLocal = enter(far, ALPHA);
  const back = go(toB(withLocal), a.open);
  // The tabs in their order: garnet's first, asked first.
  assert.deepEqual([back.effect.open.routed, back.state.opening], [true, { id, phase: "preflight", name: FAR_A, machine: "garnet", routed: true, restore: true }]);
  const ready = reduce(back.state, { prepared: { id } });
  assert.deepEqual([ready.effect, ready.state.tabs.map((tab) => tab.name), ready.state.terminal.focus], [{ panel: id }, [FAR_A], "list"]);
  const done = settle(ready.state).state;
  assert.deepEqual([done.tabs.map((tab) => tab.name), done.terminal.name], [[FAR_A, ALPHA], ALPHA]);
  // The preflight fails: dropped, the line says why, and the next opens.
  const error = Object.assign(new Error("no route"), { code: "E_SSH" });
  const failed = reduce(go(toB(withLocal), a.open).state, { prepared: { id, error } });
  assert.deepEqual([failed.state.outcome, failed.effect?.open?.name], [preflightLine({ machine: "garnet" }, error), ALPHA]);
  assert.deepEqual(settle(failed.state).state.tabs.map((tab) => tab.name), [ALPHA]);
});

test("a switch while another machine is asked first: the preflight is given up, it is no tab to remember, and its answer opens nothing", () => {
  const a = enter(remoteA(), ALPHA);
  const id = idOf(a, FAR_A);
  const asking = key(on(leaderThen(a, "escape").state, FAR_A), "enter").state;
  assert.equal(asking.opening?.id, id);
  const away = go(asking, OTHER);
  assert.deepEqual([away.effect.abandon, away.state.opening], [true, null]);
  assert.deepEqual(away.state.layouts.get(memoryKey(a, a.open)).tabs.map((tab) => tab.name), [ALPHA]);
  assert.deepEqual(reduce(away.state, { prepared: { id } }).effect, null);
});

test("a workspace that goes from the views while it is open forgets its memory: its tabs close, and nothing of it is kept", () => {
  // quartz's workspace, opened from the switcher, with a tab of quartz open.
  let s = ["w", "j", "enter"].reduce((state, k) => key(state, k).state, remoteA([garnet(), quartz()]));
  assert.equal(roster(s).instances.some((row) => row.instance === QUARTZ_A), true, "quartz's view is open");
  const id = idOf(s, QUARTZ_A);
  s = shown(reduce(key(on(s, QUARTZ_A), "enter").state, { prepared: { id } }).state).state;
  const k = memoryKey(s, s.open);
  assert.deepEqual([s.tabs.map((tab) => tab.name), s.recent.has(k), s.places.has(k)], [[QUARTZ_A], true, false]);
  // Away and back: its place is kept.
  s = settle(reduce(go(s, s.ctxs[0]).state, { prepared: { id } }).state).state;
  assert.equal(s.places.has(k), true);
  s = ["w", "j", "enter"].reduce((state, each) => key(state, each).state, s);
  s = settle(reduce(s, { prepared: { id } }).state).state;
  assert.equal(memoryKey(s, s.open), k);
  // The roster of other machines lists quartz no more: its view goes, and the switcher is shown.
  const lost = heardGroups(s, [garnet()]);
  assert.deepEqual([lost.state.view, lost.state.open, lost.state.tabs], ["switcher", null, []]);
  assert.deepEqual(lost.effect.close, [id], "its viewer ends");
  assert.deepEqual([lost.state.layouts.has(k), lost.state.recent.has(k), lost.state.places.has(k)], [false, false, false]);
});

// ── Another machine ──────────────────────────────────────────────────────────────────────────────

const KEYED = Object.freeze({ ...CLI, remote: Object.freeze(["roster", "session"]) });
const IDENTITY = Object.freeze({ key: "github.com/acme/platform", ref: "main", keyFrom: "workspace", standalone: false, defaultTeam: Object.freeze({ label: "eng", team: "team-1" }), teams: Object.freeze({ eng: "team-1" }), teamsFrom: "observed" });
const ALPHA = "dev-alpha", FAR = "/home/dev/Agents/acme", FAR_A = "dev-far-a";
/** This machine's entry, reporting the workspace garnet's group joins. */
function reporting(rows) {
  const document = { ...rosterOf(rows), workspace: { reachable: true, ...IDENTITY } }, listed = rosterRows(document, KEYED);
  return observedEntry({ roster: document, workspaceStatus: { workspace: { name: "acme-platform" } }, observedAt: "2026-10-11T09:59:00.000Z" }, panelInstances(listed, listed.map((row) => ({ running: row.running, runtimeState: row.runtimeState, tmux: row.tmux }))), "2026-10-11T10:00:00.000Z");
}
const QUARTZ = "/home/dev/Agents/ledger", QUARTZ_A = "ledger-a";
const LEDGER = Object.freeze({ ...IDENTITY, key: "github.com/acme/ledger" });
/** A machine's group of the roster of other machines: its agents, running, in workspace `workspace`. */
const machine = (server, root, workspace, names) => ({
  id: `${server}:1`, server, label: server, registrationPresent: true, target: { workspace: root, sshHost: `${server}.example` }, probe: { ok: true, features: [] },
  workspace, agentsRoot: `${root}/agents`, souls: [],
  instances: names.map((name) => ({ instance: name, agent: "dev", home: `${root}/agents/dev/instances/${name}`, agentsRoot: `${root}/agents`, work: "worktree", harness: "claude", running: true, runtimeState: "running", addressable: true })),
});
/** garnet, in workspace A; quartz, in a workspace of its own. */
const garnet = () => machine("garnet", FAR, IDENTITY, [FAR_A]);
const quartz = () => machine("quartz", QUARTZ, LEDGER, [QUARTZ_A]);
let heardAt = 10;
/** The store after one outcome of the roster read, made as the loop makes it. -> the step */
function heardGroups(state, groups) {
  const at = `2026-10-11T10:00:${String(++heardAt).padStart(2, "0")}.000Z`, next = remoteRosterState(state.remote, { envelope: { ok: true, result: { groups } } }, at);
  const kept = next.reported === null ? { memory: state.memory, notes: state.notes } : observeIdentities({ memory: state.memory, notes: state.notes }, next.reported, at);
  return reduce(state, { roster: { remote: { remoteGroups: next.remoteGroups, rosterAnswered: next.rosterAnswered, rosterFailure: next.rosterFailure }, memory: kept.memory, notes: kept.notes, at } });
}
/** Workspace A on this machine (dev-alpha) and on garnet (dev-far-a), the roster of other machines read. */
const remoteA = (groups = [garnet()]) => heardGroups(stateOf(reporting([instanceRow("dev", ALPHA)]), { cli: KEYED }), groups).state;
