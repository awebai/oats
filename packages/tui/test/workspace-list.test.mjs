process.env.TZ = "UTC";
// The list of workspaces at the top of the sidebar (docs/tui.md, "The list of workspaces"): its
// rows (one line each, a workspace's name) and dot as the frame draws them, its window, the leader's Up and Down between
// workspaces, the focus `w` gives it, and the palette's order after a move away and back. Every
// state is made by the real store from the shared functions (helpers.mjs); no test needs a
// terminal or tmux.
import test from "node:test";
import assert from "node:assert/strict";
import { instanceId } from "../lib/client.mjs";
import { LIST_LINES, WORKSPACE_WORDS, memoryKey, paletteItems, roster, switcher, workspaceList } from "../lib/model.mjs";
import { TAB_LIMIT, reduce } from "../lib/store.mjs";
import { createScreen } from "../lib/term/screen.mjs";
import { WAITING_DOT } from "../lib/views/workspaces.mjs";
import { draw, failed, instanceRow, observed, stateOf, took } from "./helpers.mjs";

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
const UNDERLINE = (cell) => cell.style.underline === true;
const QUESTION = Object.freeze({ since: "2026-10-11T09:56:00.000Z", producer: "claude", reason: "question", message: "Which base should it use?" });

/** A and `names.length` more workspaces served, each a deployment of its own at /srv/<name>, A open again. */
function many(names) {
  let state = A();
  for (const name of names) {
    const path = `/srv/${name}`;
    state = took(go(state, path).state, observed([instanceRow("w", `${name}-a`, { home: `${path}/agents/w/instances/${name}-a` })], { workspace: name }), ++cycle, path);
  }
  return go(state, A().open).state;
}

test("the list's rows: one per workspace the switcher offers, a line with its name alone, in its order; the open one in reverse video; this computer's deployments not opened and the rows that cannot be opened stay in the switcher", () => {
  const state = withListed(served());
  assert.deepEqual(listRows(state, 3), ["  acme-platform", "  acme-billing", ""]);
  const d = draw(state);
  assert.ok(d.cells[0].slice(0, 38).every(REVERSE), "the open workspace's row is in reverse video across the sidebar");
  assert.ok(!d.cells[1].slice(0, 38).some(REVERSE), "no other row is");
  const list = workspaceList(state);
  assert.deepEqual(list.rows.map((row) => [row.key.split("\u0000")[1], row.openable]), [["/srv/deploy", true], [OTHER, true]]);
  assert.equal(list.current, list.rows[0].key);
  assert.deepEqual(switcher(state).keys.map((k) => k.split("\u0000")[1]), ["/srv/deploy", OTHER, LEDGER, "/home/u/gone"], "the switcher keeps them");
});

test("a deployment that reports no workspace is a row too, by its folder's name, in the same flat list; alone, the list is its row", () => {
  assert.deepEqual(listRows(served({ bWorkspace: null }), 3), ["  acme-platform", "  other", ""]);
  const alone = stateOf(observed([instanceRow("dev", "dev-a")], { workspace: null }));
  assert.deepEqual(workspaceList(alone).lines.map((line) => line.label), ["deploy"]);
});

test(`more than ${LIST_LINES} workspaces: ${LIST_LINES - 1} of them, windowed around the open row (the cursor's, with the focus), and +N for the ones not shown`, () => {
  const state = many(["w1", "w2", "w3", "w4", "w5", "w6"]);
  const labels = workspaceList(state).lines.map((line) => line.label);
  assert.equal(labels.length, 7);
  assert.deepEqual(listRows(state, 6), [...labels.slice(0, 4).map((label) => `  ${label}`), "  +3", ""]);
  const focused = keys(state, ["w", "down", "down", "down", "down"]);
  assert.equal(focused.focus, "workspaces");
  assert.deepEqual(listRows(focused, 6), [`  ${labels[2]}`, `  ${labels[3]}`, `> ${labels[4]}`, `  ${labels[5]}`, "  +3", ""]);
});

test("the dot: one cell after the name of each workspace where an instance needs input, the open one included: ● in yellow, ! in ASCII and with no colour; unknown or stale is no dot", () => {
  const waiting = served({ b: { "ops-b": { waitingOnYou: { ...QUESTION } } } });
  assert.deepEqual(workspaceList(waiting).lines.map((line) => line.waiting), [false, true]);
  assert.equal(listRows(waiting, 2)[1], `  acme-billing ${WAITING_DOT.utf8}`);
  assert.equal(draw(waiting).cells[1][15].style.fg, "yellow");
  assert.equal(listRows({ ...waiting, ascii: true }, 2)[1], `  acme-billing ${WAITING_DOT.ascii}`);
  assert.equal(listRows({ ...waiting, colour: false }, 2)[1], `  acme-billing ${WAITING_DOT.ascii}`, "no colour: !");
  // B's next read failed: what it last said is unknown now.
  const stale = took(waiting, failed(B_ENTRY({ "ops-b": { waitingOnYou: { ...QUESTION } } }), { code: "E_CLI_TIMEOUT", message: "late" }), ++cycle, OTHER);
  assert.equal(workspaceList(stale).lines[1].waiting, false);
  // A long name is cut with an ellipsis, and the dot stays after what is shown of it.
  const long = served({ b: { "ops-b": { waitingOnYou: { ...QUESTION } } }, bWorkspace: "a-workspace-with-a-very-long-name-indeed" });
  assert.equal(listRows(long, 2)[1], `  a-workspace-with-a-very-long-nam… ${WAITING_DOT.utf8}`);
  // The dot follows the name as the screen draws it: a name of wide characters cut where one would
  // not fit, at either parity of the sidebar's width, and a name drawn in ? without UTF-8.
  const wide = served({ b: { "ops-b": { waitingOnYou: { ...QUESTION } } }, bWorkspace: "名前".repeat(30) });
  for (const size of [{ cols: 80, rows: 24 }, { cols: 120, rows: 40 }]) {
    const d = draw(wide, size);
    assert.match(d.cells[1].slice(0, d.cols).map((c) => c.text).join("").trimEnd(), new RegExp(`^ {2}(名前)+名?… ${WAITING_DOT.utf8}$`), `at ${size.cols} columns`);
  }
  const named = served({ b: { "ops-b": { waitingOnYou: { ...QUESTION } } }, bWorkspace: "名前" });
  assert.equal(draw({ ...named, ascii: true }, { cols: 80, rows: 24 }, { utf8: false }).lines[1].slice(0, 38).trimEnd(), `  ?? ${WAITING_DOT.ascii}`);
  // The open workspace's own.
  const here = served({ a: { "dev-b": { waitingOnYou: { ...QUESTION } } } });
  assert.equal(workspaceList(here).lines[0].waiting, true);
  assert.equal(draw(here).lines[0].slice(0, 38).trimEnd(), `  acme-platform ${WAITING_DOT.utf8}`);
});

test("on a row in reverse video the dot's cell is a gap in it: a yellow ● on the normal background, the open row's and the cursor's", () => {
  const here = served({ a: { "dev-b": { waitingOnYou: { ...QUESTION } } } });
  const size = { cols: 80, rows: 24 };
  for (const state of [here, key(here, "w").state]) {
    const d = draw(state, size);
    assert.equal([...d.lines[0]].indexOf(WAITING_DOT.utf8), 16);
    assert.equal(d.cells[0][15].style.reverse, true, "the row's reverse runs up to the dot");
    assert.notEqual(d.cells[0][16].style.reverse, true, "and not under it");
    assert.equal(d.cells[0][17].style.reverse, true, "and on after it");
    // The escape codes the terminal is sent: the last SGR before the ● sets yellow and no reverse (7).
    const out = createScreen().render(d.rows, size, { full: true });
    const before = out.slice(0, out.indexOf(WAITING_DOT.utf8)), sgr = before.slice(before.lastIndexOf("\x1b[") + 2);
    assert.match(sgr, /^[0-9;]*m$/);
    const params = sgr.slice(0, -1).split(";");
    assert.equal(params.includes("33"), true, `yellow: ${JSON.stringify(sgr)}`);
    assert.equal(params.includes("7"), false, `no reverse: ${JSON.stringify(sgr)}`);
    assert.match(before.slice(before.lastIndexOf("\x1b[1;1H")), /\x1b\[(?:[0-9]+;)*7(?:;[0-9]+)*m/, "the row before it is in reverse");
  }
  // ASCII: the ! stands outside the reverse too.
  const ascii = draw({ ...here, ascii: true });
  assert.equal(ascii.cells[0][16].text, WAITING_DOT.ascii);
  assert.notEqual(ascii.cells[0][16].style.reverse, true);
});

test("the leader then Down opens the next workspace and Up the one before, as the list draws them, and at an end nothing moves and the line says so", () => {
  const state = withListed(served());
  const up = leaderThen(state, "up");
  assert.equal(up.effect, null);
  assert.deepEqual(up.state.outcome?.said, WORKSPACE_WORDS.above(), "nothing above the first row");
  const down = leaderThen(state, "down");
  assert.equal(down.state.open, OTHER, "the next workspace, B, is open");
  const end = leaderThen(settle(took(down.state, B_ENTRY(), ++cycle, OTHER)), "down");
  assert.equal(end.state.open, OTHER);
  assert.deepEqual(end.state.outcome?.said, WORKSPACE_WORDS.below(), "this computer's deployments not opened are not rows: nothing is below B");
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

test("w gives the list the focus on the open row; Up and Down move the cursor, Enter opens the cursor's row and gives the instances the focus, Esc gives it back with nothing opened, and w again shows the switcher", () => {
  const state = withListed(served());
  const focused = key(state, "w");
  assert.deepEqual([focused.state.view, focused.state.focus, focused.effect], ["instances", "workspaces", null]);
  assert.equal(focused.state.workspaceCursor, workspaceList(state).current);
  assert.equal(draw(focused.state).lines[0].slice(0, 15), "> acme-platform", "the cursor's mark on the open row");
  const second = key(focused.state, "down").state;
  assert.equal(second.workspaceCursor, `view\u0000${OTHER}`);
  assert.equal(key(second, "down").state.workspaceCursor, second.workspaceCursor, "the last row: the cursor stays");
  assert.ok(draw(second).cells[1].slice(0, 38).every(REVERSE), "the cursor's row is in reverse video");
  assert.ok(!draw(second).cells[0].slice(0, 38).some(REVERSE), "the open row is not, while the list has the focus");
  assert.ok(draw(second).cells[0].slice(2, 15).every(UNDERLINE), "but its name is underlined: the open workspace is still told apart");
  assert.ok(!draw(second).cells[1].some(UNDERLINE) && !draw(state).cells[0].some(UNDERLINE), "the cursor's name is not, nor the open row's without the focus");
  const picked = key(second, "enter");
  assert.deepEqual([picked.state.open, picked.state.focus], [OTHER, "list"]);
  const escaped = key(second, "escape");
  assert.deepEqual([escaped.state.focus, escaped.state.open, escaped.effect], ["list", state.open, null]);
  const all = key(focused.state, "w");
  assert.equal(all.state.view, "switcher");
  assert.deepEqual(all.effect, { list: true, identify: true });
  // Esc closes the switcher onto the list's focus.
  assert.equal(key(all.state, "escape").state.focus, "list");
});

test("only the region with the focus draws >: with the list of workspaces focused the list of instances keeps its selection in reverse video, without its >", () => {
  const state = served();
  const cursors = (d) => d.lines.map((line, row) => (line.startsWith(">") ? row : -1)).filter((row) => row >= 0);
  const before = draw(state), row = before.lines.findIndex((line) => line.slice(0, 38).includes("dev-a"));
  assert.deepEqual(cursors(before), [row], "the list of instances has the focus: its selected row carries >");
  const focused = draw(key(state, "w").state);
  assert.deepEqual(cursors(focused), [0], "the list of workspaces has it: its cursor's row alone");
  assert.equal(focused.lines[row].startsWith(" "), true);
  assert.equal(focused.cells[row][0].style.reverse, true, "the selection is kept, in reverse video");
  assert.deepEqual(cursors(draw(key(key(state, "w").state, "escape").state)), [row], "Esc: the > is the instances' again");
});

test("No workspace above this one. goes at the next key of any kind, one bound to nothing included, and at what only the loop sees (a key typed to an agent, a resize); the line after an open stays at those", () => {
  const up = leaderThen(withListed(served()), "up").state;
  assert.deepEqual(up.outcome?.said, WORKSPACE_WORDS.above());
  assert.equal(key(up, "x").state.outcome, null, "x is bound to nothing");
  assert.equal(reduce(up, { passed: true }).state.outcome, null);
  // Another line keeps the rule it had: the next key bound to an action.
  const line = Object.freeze({ ...up, outcome: Object.freeze({ said: Object.freeze([{ own: "Opened." }]), under: Object.freeze([]) }) });
  const passed = reduce(line, { passed: true });
  assert.deepEqual([passed.state, passed.effect], [line, null], "nothing changes, so nothing is drawn again");
  assert.equal(key(line, "x").state.outcome, line.outcome);
  assert.equal(key(line, "j").state.outcome, null);
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

test("a listed deployment picked in the switcher and refused once the switcher was left says so in the outcome line, by its name", () => {
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
