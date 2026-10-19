process.env.TZ = "UTC";
// The split of the panel into two groups in the store and on the screen (docs/tui.md, "Splits";
// spec T3 and its settled list): splitting, opening in the focused group, an instance already open
// in the other, moving a tab, focus between the groups, closing a group's last tab, the empty
// group, the cap across groups, and the regions, strips and rule the frame draws. Every entry is
// made by the shared functions (helpers.mjs); no test needs a terminal or tmux.
import test from "node:test";
import assert from "node:assert/strict";
import { instanceId } from "../lib/client.mjs";
import { model, outcomeOf, paletteItems, roster } from "../lib/model.mjs";
import { reduce, splitRefused } from "../lib/store.mjs";
import { SPLIT_MIN, splitFits, splitRegions } from "../lib/views/split.mjs";
import { layout, panelPlace } from "../lib/views/frame.mjs";
import { draw, instanceRow, observed, stateOf } from "./helpers.mjs";

/** The model the loop draws `state` from at `size` (lib/main.mjs modelled, as helpers.mjs draw makes it). */
function modelOf(state, size, now = "2026-10-11T10:00:30.000Z") {
  const r = roster(state, now);
  const g = layout(r.notice, size, { note: r.note, ascii: state.ascii, outcome: outcomeOf(state), terminal: state.tabs.length > 0 });
  return model(state, { page: g.page, body: g.body, now: Date.parse(now), at: now, cols: g.listCols });
}
/** The panel's room at 120x40 with a terminal open (the sidebar keeps 30 columns beside it, and
 *  the panel has every row, its strip's counted). */
const ROOM = Object.freeze({ cols: 89, rows: 40 });
const AT = Object.freeze({ page: 19, extent: 0, room: 19, cols: 38, panel: ROOM });
const S80 = { cols: 80, rows: 24 }, S120 = { cols: 120, rows: 40 }, S200 = { cols: 200, rows: 50 };

const SIX = () => stateOf(observed(["dev-a", "dev-b", "dev-c", "dev-d", "dev-e", "dev-f"].map((name) => instanceRow("dev", name))));
let reads = 0;
const key = (state, id, at = AT) => reduce(state, { key: id, ...(id.length === 1 ? { text: id } : {}), read: ++reads, ...at });
/** The leader alone, then `id`, each in a read of its own. */
function leaderThen(state, id, at = AT) {
  const lead = state.terminal?.focus === "terminal" && state.view === "instances" && state.palette === null
    ? reduce(state, { back: true, read: ++reads, ...at })
    : reduce(state, { key: state.leaderKey, read: ++reads, ...at });
  return key(lead.state, id, at);
}
const idOf = (state, name) => instanceId(roster(state).instances.find((row) => row.instance === name));
const on = (state, name) => Object.freeze({ ...state, selected: idOf(state, name) });
/** `name` opened with Enter from the list, its window shown by the panel. */
function enter(state, name) {
  const step = key(on(state, name), "enter");
  return step.state.terminal?.status === "starting" ? { ...step, state: reduce(step.state, { shown: { id: idOf(state, name) }, ...AT }).state } : step;
}
const opened = (state, ...names) => names.reduce((s, name) => enter(s, name).state, state);
/** The focus back to the list: the leader then Esc. */
const toList = (state) => leaderThen(state, "escape").state;
/** Each group's strip as names, and its shown one: `[[names, shown], …]`. */
const groups = (state) => Array.from({ length: state.split ? 2 : 1 }, (_, g) => [state.tabs.filter((tab) => tab.group === g).map((tab) => tab.name), g === state.group ? state.terminal?.name ?? null : state.tabs.find((tab) => tab.id === state.aside)?.name ?? null]);
const said = (state) => state.outcome?.said.map((part) => part.own).join("") ?? null;
/** dev-a and dev-b open, split right: the second group empty and focused, the keys the list's. */
const splitOf = (dir = "|") => leaderThen(opened(SIX(), "dev-a", "dev-b"), dir).state;

// ── Splitting ────────────────────────────────────────────────────────────────────────────────────

test("the leader then | splits side by side, - one above the other: the tabs stay in the first group, the second is empty and focused, and the keys are the list's (Settled 2)", () => {
  for (const [k, dir] of [["|", "right"], ["-", "down"]]) {
    const s = leaderThen(opened(SIX(), "dev-a", "dev-b"), k).state;
    assert.deepEqual([s.split, s.group, s.terminal, s.focus], [dir, 1, null, "list"], k);
    assert.deepEqual(groups(s), [[["dev-a", "dev-b"], "dev-b"], [[], null]], k);
    // From the list too, by the plain keys.
    const plain = key(toList(opened(SIX(), "dev-a")), k).state;
    assert.equal(plain.split, dir, `${k} from the list`);
  }
});

test("a second split does nothing and the line says so; a split with no room is refused with a line, measured with the strip (40 columns side by side, 8 rows above each other)", () => {
  const s = splitOf();
  const again = leaderThen(s, "-");
  assert.deepEqual([again.state.split, said(again.state)], ["right", "The panel has two groups already."]);
  const narrow = { ...AT, panel: { cols: 80, rows: 36 } }, low = { ...AT, panel: { cols: 89, rows: 16 } };
  const right = leaderThen(opened(SIX(), "dev-a"), "|", narrow);
  assert.deepEqual([right.state.split, said(right.state), right.state.terminal.focus], [null, "No room to split side by side: each group needs 40 columns.", "terminal"], "nothing moves, the line says why");
  const down = leaderThen(opened(SIX(), "dev-a"), "-", low);
  assert.deepEqual([down.state.split, said(down.state)], [null, "No room to split one above the other: each group needs 8 rows."]);
  // The edges: 81 columns hold two of 40, 17 rows two of 8.
  assert.deepEqual([splitFits("right", { cols: 81, rows: 1 }), splitFits("right", { cols: 80, rows: 99 }), splitFits("down", { cols: 1, rows: 17 }), splitFits("down", { cols: 99, rows: 16 })], [true, false, true, false]);
  assert.deepEqual(SPLIT_MIN, { cols: 40, rows: 8 });
  // A room nobody measured admits no split (round 1 of the review): the line, and nothing moves.
  assert.deepEqual([splitFits("right", undefined), splitFits("down", { cols: 89 })], [false, false]);
  const unknown = leaderThen(opened(SIX(), "dev-a"), "|", { ...AT, panel: null });
  assert.deepEqual([unknown.state.split, said(unknown.state)], [null, "No room to split side by side: each group needs 40 columns."]);
  // No tab open, or one starting: nothing at all.
  assert.equal(splitRefused(SIX(), "split-right", ROOM), true);
  const starting = key(on(toList(opened(SIX(), "dev-a")), "dev-b"), "enter").state;
  assert.equal(leaderThen(starting, "|").state.split, null);
});

// ── Opening ──────────────────────────────────────────────────────────────────────────────────────

test("Enter opens in the focused group: into the empty one as its first tab, the hint gone; then after that group's shown tab", () => {
  let s = enter(splitOf(), "dev-c").state;
  assert.deepEqual(groups(s), [[["dev-a", "dev-b"], "dev-b"], [["dev-c"], "dev-c"]]);
  assert.deepEqual([s.group, s.terminal.focus], [1, "terminal"]);
  s = enter(toList(s), "dev-d").state;
  assert.deepEqual(groups(s), [[["dev-a", "dev-b"], "dev-b"], [["dev-c", "dev-d"], "dev-d"]]);
});

test("an instance open in the other group: Enter shows that tab there, and the focus goes to that group", () => {
  const s = toList(enter(splitOf(), "dev-c").state);
  const step = key(on(s, "dev-a"), "enter");
  assert.deepEqual(step.effect, { show: idOf(s, "dev-a") });
  assert.deepEqual([groups(step.state), step.state.group, step.state.terminal.focus], [[[["dev-a", "dev-b"], "dev-a"], [["dev-c"], "dev-c"]], 0, "terminal"]);
});

test("the cap counts both groups' tabs: at 4, T2's line, and nothing closes", () => {
  const s = toList(enter(enter(splitOf(), "dev-c").state, "dev-d").state);
  assert.equal(s.tabs.length, 4);
  const step = key(on(s, "dev-e"), "enter");
  assert.deepEqual([step.effect, step.state.tabs.length, said(step.state)], [null, 4, "4 terminals are open; close one with Ctrl+\\ w."]);
});

// ── Focus between groups ─────────────────────────────────────────────────────────────────────────

test("the leader then Tab: from a terminal to the other group's shown terminal; to the empty group, the keys the list's; from the list, to the focused group's terminal, or with it empty to the other's", () => {
  const two = enter(splitOf(), "dev-c").state; // dev-c in group 1, its terminal focused
  const across = leaderThen(two, "tab");
  assert.deepEqual([across.state.group, across.state.terminal.name, across.state.terminal.focus, across.state.aside], [0, "dev-b", "terminal", idOf(two, "dev-c")]);
  const back = leaderThen(across.state, "tab").state;
  assert.deepEqual([back.group, back.terminal.name], [1, "dev-c"]);
  // From the list: the focused group's terminal.
  const fromList = leaderThen(toList(two), "tab").state;
  assert.deepEqual([fromList.group, fromList.terminal.name, fromList.terminal.focus], [1, "dev-c", "terminal"]);
  // To the empty group: focused, no terminal, the keys the list's.
  const empty = leaderThen(leaderThen(splitOf(), "tab").state, "tab").state;
  assert.deepEqual([empty.group, empty.terminal, empty.focus], [1, null, "list"]);
  // From the list with the focused group empty: the other group's terminal.
  const fromEmpty = leaderThen(splitOf(), "tab").state;
  assert.deepEqual([fromEmpty.group, fromEmpty.terminal.name, fromEmpty.terminal.focus], [0, "dev-b", "terminal"]);
  // With one group, from a terminal: nothing.
  const one = opened(SIX(), "dev-a");
  assert.equal(leaderThen(one, "tab").effect, null);
  assert.equal(leaderThen(one, "tab").state.terminal.focus, "terminal");
});

test("[ and ] and the leader's Left/Right move within the focused group only", () => {
  const s = toList(enter(enter(splitOf(), "dev-c").state, "dev-d").state); // group 1: dev-c, dev-d (shown)
  const left = key(s, "[").state;
  assert.deepEqual([left.group, left.terminal.name], [1, "dev-c"]);
  assert.equal(key(left, "[").effect, null, "never into the other group");
});

// ── Moving a tab ─────────────────────────────────────────────────────────────────────────────────

test("the leader then m moves the focused group's shown tab to the other group, after its shown tab, shown there with the focus; the group it leaves shows its neighbour, or stays empty", () => {
  const s = leaderThen(enter(splitOf(), "dev-c").state, "tab").state; // focus on group 0's dev-b
  const moved = leaderThen(s, "m");
  assert.deepEqual(groups(moved.state), [[["dev-a"], "dev-a"], [["dev-c", "dev-b"], "dev-b"]]);
  assert.deepEqual([moved.state.group, moved.state.terminal.name, moved.state.terminal.focus, moved.effect], [1, "dev-b", "terminal", { show: idOf(s, "dev-b") }]);
  // The last tab of a group moved: that group stays, empty.
  const last = leaderThen(leaderThen(moved.state, "tab").state, "m").state;
  assert.deepEqual(groups(last), [[[], null], [["dev-c", "dev-b", "dev-a"], "dev-a"]], "after the shown dev-b");
  assert.equal(last.split, "right", "an empty group stays");
  // After the other group's shown tab, not at its end.
  const mid = leaderThen(leaderThen(key(toList(enter(enter(splitOf(), "dev-c").state, "dev-d").state), "[").state, "tab").state, "tab").state; // group 1: c (shown), d; the focus on group 0's dev-b
  assert.deepEqual(groups(leaderThen(mid, "m").state), [[["dev-a"], "dev-a"], [["dev-c", "dev-b", "dev-d"], "dev-b"]]);
  // Only with two groups.
  assert.equal(leaderThen(opened(SIX(), "dev-a", "dev-b"), "m").effect, null);
});

// ── Closing ──────────────────────────────────────────────────────────────────────────────────────

test("closing within a group shows its neighbour there; a group's last tab closed removes the group, and the other takes the panel and the focus", () => {
  let s = enter(enter(splitOf(), "dev-c").state, "dev-d").state; // group 1: dev-c, dev-d (shown, focused)
  s = leaderThen(s, "w").state;
  assert.deepEqual([groups(s), s.terminal.name, s.terminal.focus], [[[["dev-a", "dev-b"], "dev-b"], [["dev-c"], "dev-c"]], "dev-c", "terminal"]);
  const gone = leaderThen(s, "w");
  assert.deepEqual(gone.effect, { close: [idOf(s, "dev-c")], show: idOf(s, "dev-b") });
  assert.deepEqual([gone.state.split, gone.state.group, gone.state.aside, groups(gone.state), gone.state.terminal.focus], [null, 0, null, [[["dev-a", "dev-b"], "dev-b"]], "terminal"]);
  assert.equal(gone.state.tabs.every((tab) => tab.group === 0), true);
  // The first group's last tab: the second takes the panel, as group 0.
  const first = leaderThen(leaderThen(opened(SIX(), "dev-a"), "|").state, "tab").state; // group 0 focused (dev-a)
  const second = enter(leaderThen(first, "tab").state, "dev-c").state; // dev-c into group 1
  const shut = leaderThen(leaderThen(second, "tab").state, "w").state; // close dev-a, group 0's last
  assert.deepEqual([shut.split, groups(shut), shut.terminal.name], [null, [[["dev-c"], "dev-c"]], "dev-c"]);
});

test("a group's last tab closed while the other is empty closes the panel (Settled 5); the last tab of the only group closes it, as T2", () => {
  const s = leaderThen(splitOf(), "tab").state; // group 0 focused, group 1 empty
  const one = leaderThen(leaderThen(s, "w").state, "w").state;
  assert.deepEqual([one.tabs.length, one.terminal, one.split, one.focus], [0, null, null, "list"]);
});

test("the leader then x closes the empty focused group: the other takes the panel and is focused, the keys stay the list's; with tabs in it, x does nothing", () => {
  const s = splitOf();
  const closed = leaderThen(s, "x");
  assert.deepEqual([closed.state.split, closed.state.group, closed.state.terminal.name, closed.state.terminal.focus], [null, 0, "dev-b", "list"]);
  const full = enter(s, "dev-c").state;
  assert.equal(leaderThen(full, "x").effect, null);
  assert.equal(leaderThen(full, "x").state.split, "right");
});

test("a viewer's own end in a split: the other group's shown one shows its neighbour there; a group's last one removes the group, and the list takes the focus (Settled 5)", () => {
  const s = enter(enter(splitOf(), "dev-c").state, "dev-d").state; // group 0: a, b (b shown); group 1: c, d (d shown, focused)
  const aside = reduce(s, { returned: { id: idOf(s, "dev-b"), status: 1, stderr: "lost\n" }, ...AT });
  assert.deepEqual([groups(aside.state), aside.state.group, aside.state.terminal.name, aside.state.terminal.focus], [[[["dev-a"], "dev-a"], [["dev-c", "dev-d"], "dev-d"]], 1, "dev-d", "terminal"]);
  const last = reduce(aside.state, { returned: { id: idOf(s, "dev-a"), status: 1, stderr: "lost\n" }, ...AT });
  assert.deepEqual([last.state.split, groups(last.state), last.state.terminal.focus], [null, [[["dev-c", "dev-d"], "dev-d"]], "list"]);
});

test("zoom gives the focused group's terminal the whole body; with the empty group focused, z does nothing (Settled 6)", () => {
  assert.equal(leaderThen(splitOf(), "z").effect, null);
  assert.equal(leaderThen(splitOf(), "z").state.terminal, null);
});

test("another workspace closes every tab and the split", () => {
  const s = enter(splitOf(), "dev-c").state;
  const step = reduce(s, { admitted: "/srv/other", at: "2026-10-11T10:01:00.000Z", ...AT });
  assert.deepEqual([step.state.tabs.length, step.state.split, step.state.group, step.state.aside, step.state.terminal], [0, null, 0, null, null]);
  assert.deepEqual(step.effect.close, ["dev-a", "dev-b", "dev-c"].map((name) => idOf(s, name)));
});

test("the palette lists the split's rows where each applies", () => {
  const rowsOf = (state) => paletteItems(leaderThen(state, "k").state).items.filter((item) => item.kind === "command").map((item) => item.label);
  assert.deepEqual(rowsOf(opened(SIX(), "dev-a")).slice(-2), ["Split right", "Split down"]);
  assert.equal(rowsOf(SIX()).some((label) => label.startsWith("Split")), false, "no tab, no split");
  assert.equal(rowsOf(splitOf()).at(-1), "Close the empty group");
  assert.equal(rowsOf(enter(splitOf(), "dev-c").state).at(-1), "Move tab to the other group");
  // Run from the palette: the split is made.
  let p = leaderThen(opened(SIX(), "dev-a"), "k").state;
  const at = paletteItems(p).items.findIndex((item) => item.label === "Split down");
  for (let i = 0; i < at; i++) p = key(p, "down").state;
  assert.equal(key(p, "enter").state.split, "down");
});

// ── The layout ───────────────────────────────────────────────────────────────────────────────────

test("splitRegions: side by side the first takes the extra column, a rule column between; one above the other the first the extra row, a rule row between", () => {
  // The panels of 120x40 and 80x24 beside the sidebar: from row 0, every row.
  assert.deepEqual(splitRegions({ title: 0, col: 31, cols: 89, rows: 39 }, "right"), [
    { title: 0, top: 1, col: 31, cols: 44, rows: 39 }, { title: 0, top: 1, col: 76, cols: 44, rows: 39 }, { col: 75 },
  ]);
  assert.deepEqual(splitRegions({ title: 0, col: 31, cols: 49, rows: 23 }, "down"), [
    { title: 0, top: 1, col: 31, cols: 49, rows: 11 }, { title: 13, top: 14, col: 31, cols: 49, rows: 10 }, { row: 12 },
  ]);
});

/** dev-a, dev-b in group 0; dev-c in group 1, shown with the focus in its terminal. */
const both = (k) => enter(leaderThen(opened(SIX(), "dev-a", "dev-b"), k).state, "dev-c").state;

test("the regions the frame draws, at 80x24, 120x40 and 200x50, both orientations; side by side does not fit at 80 columns, so the focused group is drawn alone (Settled 3)", () => {
  const expect = {
    "120x40 |": [{ group: 0, cols: 44, rows: 39 }, { group: 1, cols: 44, rows: 39 }],
    "200x50 |": [{ group: 0, cols: 84, rows: 49 }, { group: 1, cols: 84, rows: 49 }],
    "80x24 -": [{ group: 0, cols: 49, rows: 11 }, { group: 1, cols: 49, rows: 10 }],
    "120x40 -": [{ group: 0, cols: 89, rows: 19 }, { group: 1, cols: 89, rows: 18 }],
    "200x50 -": [{ group: 0, cols: 169, rows: 24 }, { group: 1, cols: 169, rows: 23 }],
    "80x24 |": [{ group: 1, cols: 49, rows: 23 }],
  };
  for (const [name, regions] of Object.entries(expect)) {
    const [w, k] = name.split(" "), [cols, rows] = w.split("x").map(Number);
    const d = draw(both(k), { cols, rows });
    assert.deepEqual(d.regions.map(({ group, cols: c, rows: r }) => ({ group, cols: c, rows: r })), regions, name);
    assert.deepEqual([d.terminal.cols, d.terminal.rows], [regions.find((r) => r.group === 1).cols, regions.find((r) => r.group === 1).rows], `${name}: the focused group's terminal`);
  }
});

test("both strips drawn, the rule between: the focused group's shown tab in reverse while its terminal has the focus, the other's bold and never in reverse", () => {
  const s = both("|"), d = draw(s, S120);
  // The strips stand on the screen's first row, beside the sidebar's title.
  const line = d.lines[0];
  assert.match(line, /│ dev-a {2}dev-b +│ dev-c/, "group 0's strip, the rule, group 1's title");
  const at = (word) => line.indexOf(word);
  assert.deepEqual([d.cells[0][at("dev-c")].style.reverse, d.cells[0][at("dev-b")].style.reverse, d.cells[0][at("dev-b")].style.bold], [true, false, true]);
  // The rule stands on every row of the panel, which is every row of the screen.
  const ruleCol = 31 + 44;
  for (let r = 0; r < 40; r++) assert.equal(d.cells[r][ruleCol].text, "│", `row ${r}`);
  // From the list, neither is in reverse.
  const l = draw(toList(s), S120);
  assert.equal(l.cells[0][at("dev-c")].style.reverse, false);
  // One above the other: a rule row between, under group 0's strip and its 19 rows.
  const down = draw(both("-"), S120);
  assert.equal(down.lines[20].slice(31), "─".repeat(89));
  // Where it meets the sidebar's rule, a joint: `├`, `+` in ASCII; zoomed, or with the whole screen, no rule and no joint.
  assert.equal(down.lines[20][30], "├");
  assert.equal(draw({ ...both("-"), ascii: true }, S120).lines[20].slice(30, 33), "+--");
  assert.equal(draw(both("-"), { cols: 70, rows: 30 }).lines.some((line) => line.includes("├")), false, "under 80 columns the panel has the whole screen");
});

test("the empty group's hint: Enter on an agent opens it here, in reverse while it is focused, and the leader's keys for the groups, as many as the group's width holds", () => {
  const d = draw(splitOf(), S120);
  const hint = d.lines[1].slice(76), keys = d.lines[2].slice(76);
  assert.equal(hint.trim(), "Enter on an agent opens it here");
  assert.equal(d.cells[1][77].style.reverse, true);
  assert.equal(keys, " Ctrl+\\ Tab next group", "44 cells hold the first key alone");
  assert.equal(draw(splitOf(), S200).lines[2].slice(116), " Ctrl+\\ Tab next group   Ctrl+\\ x close group", "84 hold both");
  // Not focused: plain.
  assert.equal(draw(leaderThen(splitOf(), "tab").state, S120).cells[1][77].style.reverse, false);
});

test("zoomed, the focused group's terminal has the whole screen and the other is not drawn; under 80 columns with a terminal focused the whole screen holds both", () => {
  const z = draw(leaderThen(both("-"), "z").state, S120);
  assert.deepEqual(z.regions.map(({ group, cols, rows }) => ({ group, cols, rows })), [{ group: 1, cols: 120, rows: 39 }]);
  const narrow = draw(both("-"), { cols: 70, rows: 30 });
  assert.deepEqual(narrow.regions.map(({ group, cols }) => ({ group, cols })), [{ group: 0, cols: 70 }, { group: 1, cols: 70 }]);
  assert.equal(draw(toList(both("-")), { cols: 70, rows: 30 }).regions.length, 0, "the list alone with its focus (T1)");
});

test("the leader's hint names the split's keys where they apply", () => {
  // The hint is the sidebar's cheat sheet, a row per key: the sidebar's rows (30 columns while a
  // tab is open, the empty group's too), trimmed, one per line.
  const hint = (s) => {
    const w = reduce(s, s.terminal?.focus === "terminal" ? { back: true, read: ++reads, ...AT } : { key: s.leaderKey, read: ++reads, ...AT }).state, size = { cols: 200, rows: 40 };
    const cols = layout(null, size, { terminal: w.tabs.length > 0 }).listCols;
    return draw(w, size).cells.map((line) => line.slice(0, cols).map((cell) => cell.text).join("").trim()).join("\n");
  };
  assert.match(hint(opened(SIX(), "dev-a")), /\nw {9}close terminal\n\|\/- {7}split\n/);
  assert.match(hint(splitOf()), /\nTab {7}next group\nx {9}close group\n/);
  assert.match(hint(both("|")), /\nTab {7}next group\nm {9}move tab\n/);
  assert.doesNotMatch(hint(SIX()), /split/);
});

test("the panel's place is the Instances view's with the terminal's focus, whatever is drawn over it: behind the help and the palette the frame draws no region, and panelPlace still measures the panel (round 1 of the review)", () => {
  const s = opened(SIX(), "dev-a");
  const help = key(toList(s), "?").state, pal = leaderThen(s, "k").state;
  for (const [name, over] of [["help", help], ["palette", pal]]) {
    assert.deepEqual(draw(over, S80).regions, [], name);
    assert.deepEqual(panelPlace(modelOf(over, S80), S80), { panel: { cols: 49, rows: 24 }, focused: { cols: 49, rows: 23 } }, name);
  }
  assert.deepEqual(panelPlace(modelOf(toList(s), { cols: 70, rows: 30 }), { cols: 70, rows: 30 }).panel.cols, 70, "under 80 columns, the whole width");
  assert.equal(panelPlace(modelOf(s, { cols: 50, rows: 10 }), { cols: 50, rows: 10 }), null, "too small");
});
