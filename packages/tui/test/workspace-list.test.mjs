process.env.TZ = "UTC";
// The list of workspaces at the top of the sidebar (docs/tui.md, "The list of workspaces"): its
// rows, marks, words and dot as the frame draws them, its window, the leader's Up and Down between
// workspaces, the focus `w` gives it, and the palette's order after a move away and back. Every
// state is made by the real store from the shared functions (helpers.mjs); no test needs a
// terminal or tmux.
import test from "node:test";
import assert from "node:assert/strict";
import { instanceId } from "../lib/client.mjs";
import { LIST_LINES, WORKSPACE_WORDS, memoryKey, paletteItems, roster, workspaceList } from "../lib/model.mjs";
import { TAB_LIMIT, reduce } from "../lib/store.mjs";
import { WAITING_DOT } from "../lib/views/workspaces.mjs";
import { draw, instanceRow, observed, stateOf, took } from "./helpers.mjs";

/** The geometry of the frame before each key, and the panel's room. */
const AT = Object.freeze({ page: 19, extent: 0, room: 19, cols: 38, panel: Object.freeze({ cols: 89, rows: 40 }) });
let reads = 0;
const key = (state, id) => reduce(state, { key: id, ...(id.length === 1 ? { text: id } : {}), read: ++reads, ...AT });
const keys = (state, ids) => ids.reduce((s, id) => key(s, id).state, state);
/** The leader alone, then `id`, each in a read of its own: from a terminal's focus the scanner's `back`. */
function leaderThen(state, id) {
  const lead = state.terminal?.focus === "terminal" && state.view === "instances" && state.palette === null
    ? reduce(state, { back: true, read: ++reads, ...AT })
    : reduce(state, { key: state.leaderKey, read: ++reads, ...AT });
  return key(lead.state, id);
}
const idOf = (state, name) => instanceId(roster(state).instances.find((row) => row.instance === name));
const nameOf = (id) => id?.split("/").pop() ?? null;
const on = (state, name) => Object.freeze({ ...state, selected: idOf(state, name) });
const shown = (state) => { const tab = state.tabs.find((each) => each.status === "starting"); return tab ? reduce(state, { shown: { id: tab.id }, ...AT }) : { state, effect: null }; };
const enter = (state, name) => shown(key(on(state, name), "enter").state).state;
const opened = (state, ...names) => names.reduce(enter, state);
const settle = (state) => { for (let i = 0; i < 2 * TAB_LIMIT && state.tabs.some((tab) => tab.status === "starting"); i++) state = shown(state).state; return state; };

/** Workspace A, this deployment (acme-platform): dev-a … dev-c, running. */
const A = (extra = {}) => stateOf(observed(["dev-a", "dev-b", "dev-c"].map((name) => instanceRow("dev", name, extra[name] ?? {}))));
/** Workspace B, another deployment of this machine (acme-billing). */
const OTHER = "/srv/other";
const B_ENTRY = (extra = {}, workspace = "acme-billing") => observed(["ops-a", "ops-b"].map((name) => instanceRow("ops", name, { home: `${OTHER}/agents/ops/instances/${name}`, ...(extra[name] ?? {}) })), { workspace });
let cycle = 1;
const go = (state, id) => reduce(state, { admitted: id, at: "2026-10-11T10:01:00.000Z", ...AT });
/** A and B served, A open again: the list's rows A (open), B. */
function served({ a = {}, b = {}, bWorkspace } = {}) {
  const atB = took(go(A(a), OTHER).state, B_ENTRY(b, bWorkspace), ++cycle, OTHER);
  return go(atB, A().open).state;
}
/** This computer's deployments list: `rows` of `[name, state]`, under /home/u. */
const LEDGER = "/home/u/acme-ledger";
const listing = (state, rows) => reduce(state, { listed: { rows: rows.map(([name, st]) => ({ path: `/home/u/${name}`, name, state: st })) } }).state;
const withListed = (state) => listing(state, [["acme-ledger", "ok"], ["gone", "missing"]]);
/** The list's rows as the sidebar draws them, from the top (the frame at 80x24: 38 cells). */
const listRows = (state, n) => draw(state).lines.slice(0, n).map((line) => [...line].slice(0, 38).join("").trimEnd());
const REVERSE = (cell) => cell.style.reverse === true;
const QUESTION = Object.freeze({ since: "2026-10-11T09:56:00.000Z", producer: "claude", reason: "question", message: "Which base should it use?" });

test("the list's rows: the workspaces served, then under its heading this computer's deployments that are not, each by its name; the open one with * and in reverse video, a row that cannot be opened dim with its state word", () => {
  const state = withListed(served());
  assert.deepEqual(listRows(state, 6), [" * acme-platform", "   acme-billing", " On this machine, not opened", "   acme-ledger", "   gone                       missing", ""]);
  const d = draw(state);
  assert.ok(d.cells[0].slice(0, 38).every(REVERSE), "the open workspace's row is in reverse video across the sidebar");
  assert.ok(!d.cells[1].slice(0, 38).some(REVERSE), "no other row is");
  assert.equal(d.cells[2][1].style.dim, true, "the heading is dim");
  assert.equal(d.cells[4][3].style.dim, true, "the row that cannot be opened is dim");
  assert.notEqual(d.cells[3][3].style.dim, true, "the listed row that opens is not");
  const list = workspaceList(state);
  assert.deepEqual(list.rows.map((row) => [row.key.split("\u0000")[1], row.openable]), [["/srv/deploy", true], [OTHER, true], [LEDGER, true], ["/home/u/gone", false]]);
  assert.equal(list.current, list.rows[0].key);
});

test("a deployment that reports no workspace is a row of its own, by its folder's name; alone, the list is its row", () => {
  const unmatched = served({ bWorkspace: null });
  assert.deepEqual(listRows(unmatched, 3), [" * acme-platform", "   other", ""]);
  const alone = stateOf(observed([instanceRow("dev", "dev-a")], { workspace: null }));
  assert.deepEqual(workspaceList(alone).lines.map((line) => line.heading ?? line.label), ["deploy"], "one row, no heading");
});

test(`more than ${LIST_LINES} lines: ${LIST_LINES - 1} of them, windowed around the open row (the cursor's, with the focus), and +N for the workspaces not shown`, () => {
  const many = listing(served(), ["l1", "l2", "l3", "l4", "l5"].map((name) => [name, "ok"]));
  assert.equal(workspaceList(many).lines.length, 8, "seven workspaces and a heading");
  assert.deepEqual(listRows(many, 6), [" * acme-platform", "   acme-billing", " On this machine, not opened", "   l1", "   +4", ""]);
  // With the focus, the cursor moves the window; the heading out of it is not counted.
  const focused = keys(many, ["w", "down", "down", "down", "down"]);
  assert.equal(focused.focus, "workspaces");
  assert.deepEqual(listRows(focused, 6), ["   l1", "   l2", ">  l3", "   l4", "   +3", ""]);
});

test("the dot: on each workspace where an instance needs input, the open one included, at the row's edge: ● in yellow, ! in ASCII and with no colour; unknown is no dot", () => {
  const waiting = withListed(served({ b: { "ops-b": { waitingOnYou: { ...QUESTION } } } }));
  const lines = workspaceList(waiting).lines.filter((line) => line.key !== undefined);
  assert.deepEqual(lines.map((line) => line.waiting), [false, true, false, false], "B's instance waits; the listed rows are unknown");
  assert.equal(listRows(waiting, 2)[1], `${"   acme-billing".padEnd(36)}${WAITING_DOT.utf8}`);
  const d = draw(waiting);
  assert.equal(d.cells[1][36].style.fg, "yellow");
  assert.equal(listRows({ ...waiting, ascii: true }, 2)[1].at(-1), WAITING_DOT.ascii);
  assert.equal(listRows({ ...waiting, colour: false }, 2)[1].at(-1), WAITING_DOT.ascii, "no colour: !");
  // A listed deployment's, from the slow schedule (main.mjs): true is a dot, null none.
  const heard = reduce(waiting, { listedWaiting: new Map([[LEDGER, true], ["/home/u/gone", null]]) }).state;
  assert.equal(listRows(heard, 4)[3], `${"   acme-ledger".padEnd(36)}${WAITING_DOT.utf8}`);
  assert.equal(workspaceList(heard).lines[4].waiting, false);
  // The open workspace's own.
  const here = served({ a: { "dev-b": { waitingOnYou: { ...QUESTION } } } });
  assert.equal(workspaceList(here).lines[0].waiting, true);
  assert.equal(draw(here).lines[0].slice(0, 38).trimEnd().at(-1), WAITING_DOT.utf8);
});

test("the leader then Down opens the next workspace and Up the one before, as the list draws them: past a row that cannot be opened, a listed one admitted, and at an end nothing moves and the line says so", () => {
  const state = withListed(served());
  const up = leaderThen(state, "up");
  assert.equal(up.effect, null);
  assert.deepEqual(up.state.outcome?.said, WORKSPACE_WORDS.above(), "nothing above the first row");
  const down = leaderThen(state, "down");
  assert.equal(down.state.open, OTHER, "the next workspace, B, is open");
  const third = leaderThen(settle(took(down.state, B_ENTRY(), ++cycle, OTHER)), "down");
  assert.deepEqual(third.effect, { admit: LEDGER }, "a row of this computer's list is admitted, as the switcher's Enter does");
  // From the last openable row, past `gone`, which does not open: the end.
  const last = withListed(served());
  const atEnd = listing(last, [["gone", "missing"]]);
  const b = took(leaderThen(atEnd, "down").state, B_ENTRY(), ++cycle, OTHER);
  const end = leaderThen(b, "down");
  assert.equal(end.state.open, OTHER);
  assert.deepEqual(end.state.outcome?.said, WORKSPACE_WORDS.below(), "the row that cannot be opened is passed over, and nothing is below it");
});

test("from a terminal's focus the leader then Down moves to the next workspace; coming back with the leader then Up gives the terminal, and its focus, back", () => {
  const a = opened(served(), "dev-a");
  assert.equal(a.terminal?.focus, "terminal");
  const away = leaderThen(a, "down");
  assert.equal(away.state.open, OTHER);
  assert.deepEqual(away.effect.close, [idOf(a, "dev-a")], "the workspace left's viewers end");
  const b = took(away.state, B_ENTRY(), ++cycle, OTHER);
  const back = settle(leaderThen(b, "up").state);
  assert.equal(back.open, a.open);
  assert.deepEqual([back.terminal?.name, back.terminal?.focus], ["dev-a", "terminal"]);
});

test("w gives the list the focus on the open row; Up and Down move the cursor past rows that cannot be opened, Enter opens the cursor's row and gives the instances the focus, Esc gives it back with nothing opened, and w again shows the switcher", () => {
  const state = withListed(served());
  const focused = key(state, "w");
  assert.deepEqual([focused.state.view, focused.state.focus, focused.effect], ["instances", "workspaces", null]);
  assert.equal(focused.state.workspaceCursor, workspaceList(state).current);
  assert.equal(draw(focused.state).lines[0].slice(0, 3), ">* ", "the cursor's mark on the open row");
  const third = keys(focused.state, ["down", "down"]);
  assert.equal(third.workspaceCursor, `path\u0000${LEDGER}`);
  assert.equal(key(third, "down").state.workspaceCursor, third.workspaceCursor, "`gone` does not open: the cursor stays");
  assert.ok(draw(third).cells[3].slice(0, 38).every(REVERSE), "the cursor's row is in reverse video");
  assert.ok(!draw(third).cells[0].slice(4, 38).some(REVERSE), "the open row is not, while the list has the focus");
  const picked = key(third, "enter");
  assert.deepEqual(picked.effect, { admit: LEDGER });
  assert.equal(picked.state.focus, "list");
  const escaped = key(key(focused.state, "down").state, "escape");
  assert.deepEqual([escaped.state.focus, escaped.state.open, escaped.effect], ["list", state.open, null]);
  const all = key(focused.state, "w");
  assert.equal(all.state.view, "switcher");
  assert.deepEqual(all.effect, { list: true, identify: true });
  // Esc closes the switcher onto the list's focus.
  assert.equal(key(all.state, "escape").state.focus, "list");
});

test("a key the focused list does not own gives the focus back first, then does what it does there", () => {
  const focused = key(withListed(served()), "w").state;
  const help = key(focused, "?");
  assert.equal(help.state.view, "help");
  const filter = key(focused, "/");
  assert.deepEqual([filter.state.focus, filter.state.filter.editing, filter.state.workspaceCursor], ["list", true, null], "/ types the instances' filter");
  // j and k are the list's own Down and Up.
  assert.equal(key(focused, "j").state.workspaceCursor, `view\u0000${OTHER}`);
});

test("a listed deployment that is refused when opened from the list says so in the outcome line, by its name", () => {
  const state = withListed(served());
  const refused = reduce(state, { refused: LEDGER }).state;
  assert.deepEqual(refused.outcome?.said, WORKSPACE_WORDS.refused("acme-ledger"));
  assert.ok(draw(refused).lines.some((line) => line.startsWith(" acme-ledger: not an OATS deployment ")), "under the list");
});

test("the palette after A, B and A again by the leader's Down and Up: A's instances, the most recently shown first", () => {
  let a = opened(served(), "dev-a", "dev-b", "dev-c");
  a = leaderThen(a, "left").state; // dev-b shown: recency dev-b, dev-c, dev-a
  const b = took(leaderThen(a, "down").state, B_ENTRY(), ++cycle, OTHER);
  assert.equal(b.open, OTHER);
  const back = settle(leaderThen(opened(b, "ops-a"), "up").state);
  assert.equal(back.open, a.open);
  assert.deepEqual(back.recent.get(memoryKey(a, a.open)).map(nameOf), ["dev-b", "dev-c", "dev-a"]);
  const items = paletteItems(leaderThen(back, "k").state);
  assert.deepEqual(items.items.filter((item) => item.kind === "instance").slice(0, 3).map((item) => item.name), ["dev-b", "dev-c", "dev-a"]);
});
