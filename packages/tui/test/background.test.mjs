process.env.TZ = "UTC";
// The Background section (awebai/oats#1579) in the TUI: the rows the shared placement puts there are
// drawn in a tree of their own, after the main one, under a heading that can be selected and opens and
// closes it. Only when this run's kernel lists `instance-background`. Every entry is made by the shared
// functions (helpers.mjs); no test needs a terminal.
import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_FEATURE, instanceId, rosterRows, panelInstances, observedEntry } from "../lib/client.mjs";
import { BACKGROUND_ID, paletteItems, roster } from "../lib/model.mjs";
import { reduce } from "../lib/store.mjs";
import { BACKGROUND, CHEVRONS, NEEDS_INPUT } from "../lib/views/instances.mjs";
import { CLI, DEPLOYMENT, NOW, draw, drawnName, instanceRow, observed, press, rosterOf, stateOf, took } from "./helpers.mjs";

/** The kernel record of a run whose kernel lists the feature, and of one whose kernel does not (CLI). */
const BG_CLI = Object.freeze({ ...CLI, features: Object.freeze([...CLI.features, BACKGROUND_FEATURE]) });
const claim = { since: new Date(NOW - 120000).toISOString(), producer: "agent", reason: "question", message: "Ok?" };
const S = { cols: 80, rows: 30 };

/** dev-a and lead in the main tree; bg-1, spawned from lead and in the background, and its foreground
 *  child bg-kid under it. `extra` adds to a row by name. */
const ROWS = (extra = {}) => [
  instanceRow("dev", "dev-a", extra["dev-a"]),
  instanceRow("dev", "lead", extra.lead),
  instanceRow("ops", "bg-1", { background: true, parentInstance: "lead", ...extra["bg-1"] }),
  instanceRow("ops", "bg-kid", { parentInstance: "bg-1", ...extra["bg-kid"] }),
];
/** A run that read `rows`, with the kernel record `cli`. */
const run = (rows = ROWS(), cli = BG_CLI) => stateOf(observed(rows, { cli }), { cli });
/** The sidebar's list of instances, as drawn: the rows between the `Instances` title and the next rule. */
function listed(state, size = S) {
  const d = draw(state, size), rows = d.lines.map((line) => line.slice(0, d.cols).trimEnd());
  const from = rows.findIndex((line) => /^ Instances/.test(line)) + 1;
  return rows.slice(from, rows.findIndex((line, i) => i >= from && /^[─-]+$/.test(line)));
}
const idOf = (state, name) => instanceId(roster(state).instances.find((row) => row.instance === name));
const heading = (state) => roster(state).items.find((item) => item?.kind === "background") ?? null;

test("without the kernel's feature nothing changes: a row's background field is ignored, and no heading is drawn", () => {
  const s = run(ROWS(), CLI), r = roster(s);
  assert.equal(r.background, null);
  assert.equal(heading(s), null);
  assert.deepEqual(r.rows.map((item) => item.row.instance), ["dev-a", "lead", "bg-1", "bg-kid"], "every row in the main tree, as before");
  assert.ok(!listed(s).some((line) => line.includes(BACKGROUND)));
});

test("with the feature and no row in the background, no heading is drawn", () => {
  const s = run([instanceRow("dev", "dev-a"), instanceRow("dev", "lead")]);
  assert.equal(roster(s).background, null);
  assert.equal(heading(s), null);
});

test("the heading stands at the end of the list, closed by default, with the section's count; its rows are not drawn", () => {
  const s = run(), r = roster(s);
  assert.deepEqual(listed(s), [`> ● ${drawnName("dev-a")}`, `  ● ${drawnName("lead")}`, `  ${CHEVRONS.utf8.closed} ${BACKGROUND}  2`]);
  assert.deepEqual(r.rows.map((item) => item.row.instance), ["dev-a", "lead"]);
  assert.equal(r.stops.at(-1).id, BACKGROUND_ID, "the heading is the last stop of the selection");
  assert.deepEqual([heading(s).open, heading(s).count], [false, 2]);
  assert.equal(s.background.size, 0, "closed in a new run");
  // ASCII: the chevrons are `>` closed and `v` open.
  assert.equal(listed({ ...s, ascii: true }).at(-1), `  > ${BACKGROUND}  2`);
});

test("the heading is bold, like a machine's heading; selected, it is in reverse video with the cursor", () => {
  const s = Object.freeze({ ...run(), selected: BACKGROUND_ID }), d = draw(s, S);
  const y = d.lines.findIndex((line) => line.includes(BACKGROUND)), x = d.lines[y].indexOf(BACKGROUND);
  assert.equal(d.lines[y].slice(0, 3), `> ${CHEVRONS.utf8.closed}`);
  assert.deepEqual([d.cells[y][x].style.bold, d.cells[y][x].style.reverse], [true, true]);
  const plain = draw(run(), S), p = plain.lines.findIndex((line) => line.includes(BACKGROUND));
  assert.deepEqual([plain.cells[p][x].style.bold, plain.cells[p][x].style.reverse], [true, false]);
});

test("Enter and Space on the selected heading open and close the section; Right opens and Left closes it, the selection staying", () => {
  let s = press(run(), ["G"]).state;
  assert.equal(s.selected, BACKGROUND_ID, "the last stop is the heading");
  for (const [open, close] of [["enter", "enter"], ["space", "space"], ["right", "left"], ["l", "h"]]) {
    s = press(s, [open]).state;
    assert.deepEqual([s.background.has(s.open), heading(s).open, s.selected], [true, true, BACKGROUND_ID], `${open} opens`);
    assert.deepEqual(roster(s).rows.map((item) => item.row.instance), ["dev-a", "lead", "bg-1", "bg-kid"]);
    s = press(s, [close]).state;
    assert.deepEqual([s.background.has(s.open), heading(s).open, s.selected], [false, false, BACKGROUND_ID], `${close} closes`);
  }
  // Left on it closed and Right... open again goes to its first row, as a parent's fold does.
  assert.equal(press(s, ["left"]).state.background.size, 0);
  const into = press(s, ["right", "right"]).state;
  assert.equal(into.selected, idOf(into, "bg-1"));
  // Left on a root of the section goes back to the heading (its children folded first, as any parent).
  assert.equal(press(into, ["left", "left"]).state.selected, BACKGROUND_ID);
  // The cheat sheet names what Enter does on it.
  const sheet = (state) => draw(state, S).lines.map((line) => line.slice(0, 38).trim()).filter((line) => line.startsWith("Enter"));
  assert.deepEqual(sheet(s), ["Enter    open"]);
  assert.deepEqual(sheet(press(s, ["enter"]).state), ["Enter    close"]);
});

test("the heading is no instance: the acts, the detail and opening do nothing on it", () => {
  const s = press(run(), ["G"]).state;
  for (const key of ["X", "D", "S", "R", "tab"]) {
    const step = press(s, [key]);
    assert.deepEqual([step.state.view, step.state.focus, step.state.act, step.effects.length], ["instances", "list", null, 0], key);
  }
  assert.equal(draw(s, S).lines.some((line) => line.includes("soul     ")), false, "no detail");
});

test("open, the section's rows are a tree of their own: a background root whose parent is in the main tree is at depth 0, its foreground child under it", () => {
  const s = press(run(), ["G", "enter"]).state, r = roster(s);
  const depth = Object.fromEntries(r.rows.map((item) => [item.row.instance, [item.depth, item.background === true]]));
  assert.deepEqual(depth, { "dev-a": [0, false], lead: [0, false], "bg-1": [0, true], "bg-kid": [1, true] });
  assert.deepEqual(listed(s), [`  ● ${drawnName("dev-a")}`, `  ● ${drawnName("lead")}`, `> ${CHEVRONS.utf8.open} ${BACKGROUND}  2`, `  ● ${drawnName("bg-1")}`, `    ● ${drawnName("bg-kid")}`]);
});

test("the heading says Needs input while a row in the section waits, open or closed, and not for a waiting row of the main tree", () => {
  const waits = run(ROWS({ "bg-kid": { waitingOnYou: claim } }));
  assert.equal(heading(waits).waiting, true);
  const closed = draw(waits, S), y = closed.lines.findIndex((line) => line.includes(BACKGROUND));
  assert.match(closed.lines[y].slice(0, closed.cols), new RegExp(`${BACKGROUND}  2 +${NEEDS_INPUT} $`));
  const x = closed.lines[y].indexOf(NEEDS_INPUT);
  assert.deepEqual([closed.cells[y][x].style.reverse, closed.cells[y][x].style.fg], [true, "yellow"], "the needs-input look");
  assert.ok(!closed.lines[y].includes("min"), "no time");
  // Open: the heading still says it, and the row shows its own mark.
  const open = press(waits, ["G", "enter"]).state;
  assert.equal(heading(open).waiting, true);
  assert.ok(listed(open).some((line) => line.includes(NEEDS_INPUT)));
  assert.ok(listed(open).includes(`    ! ${drawnName("bg-kid")}`));
  // A waiting row of the main tree is no claim of the section's.
  const main = run(ROWS({ "dev-a": { waitingOnYou: claim } }));
  assert.equal(heading(main).waiting, false);
  assert.ok(!listed(main).at(-1).includes(NEEDS_INPUT));
});

test("open, a folded parent of the section rolls up its waiting child, as in the main tree", () => {
  let s = press(run(ROWS({ "bg-kid": { waitingOnYou: claim } })), ["G", "enter", "right", "left"]).state;
  assert.equal(s.selected, idOf(s, "bg-1"));
  assert.equal(roster(s).below.get(idOf(s, "bg-1"))?.length, 1);
  assert.match(listed(s).find((line) => line.includes(drawnName("bg-1"))), /\+1 +1 below/);
  s = press(s, ["left"]).state;
  assert.equal(s.selected, BACKGROUND_ID);
});

test("the workspace's needs-input count counts the section's rows, closed or open (regression)", () => {
  const s = run(ROWS({ "bg-kid": { waitingOnYou: claim }, "dev-a": { waitingOnYou: claim } }));
  const count = (state) => roster(state).counts.find((each) => each.word === "need input")?.n ?? 0;
  assert.equal(count(s), 2, "closed");
  assert.equal(count(press(s, ["G", "enter"]).state), 2, "open");
  const only = run(ROWS({ "bg-kid": { waitingOnYou: claim } }));
  assert.deepEqual(roster(only).counts.find((each) => each.word === "needs input")?.n, 1, "a background row alone");
});

test("a filter shows the section's matching rows with the heading open and counts them; what is stored stays closed", () => {
  const s = press(run(), ["/", "k", "i", "d", "enter"]).state, r = roster(s);
  assert.equal(s.background.size, 0, "nothing stored");
  // The match and the path to it, as the shared filter leaves them: both in the section.
  assert.deepEqual([heading(s).open, heading(s).count], [true, 2]);
  assert.deepEqual(r.rows.filter((item) => item.background).map((item) => item.row.instance), ["bg-1", "bg-kid"]);
  // Enter on the heading while a filter is on changes nothing; the cheat sheet does not offer it.
  const on = press(Object.freeze({ ...s, selected: BACKGROUND_ID }), ["enter"]).state;
  assert.deepEqual([on.selected, on.background.size, heading(on).open], [BACKGROUND_ID, 0, true]);
  // The filter cleared: the section is closed again, and the selection on one of its rows goes to the heading.
  const picked = Object.freeze({ ...s, selected: idOf(s, "bg-kid") });
  const cleared = press(picked, ["escape"]).state;
  assert.deepEqual([heading(cleared).open, cleared.selected], [false, BACKGROUND_ID]);
  // A filter that matches nothing of the section draws no heading.
  const none = press(run(), ["/", "d", "e", "v", "enter"]).state;
  assert.equal(heading(none), null);
});

test("the movement keys skip the section's rows while it is closed: Down from the last main row stops on the heading, and Up goes back", () => {
  let s = press(run(), ["g"]).state;
  assert.equal(s.selected, idOf(s, "dev-a"));
  s = press(s, ["j", "j"]).state;
  assert.equal(s.selected, BACKGROUND_ID);
  assert.equal(press(s, ["j"]).state.selected, BACKGROUND_ID, "nothing after it");
  assert.equal(press(s, ["k"]).state.selected, idOf(s, "lead"));
  // Open, Down goes into the section.
  const open = press(s, ["enter", "j"]).state;
  assert.equal(open.selected, idOf(open, "bg-1"));
});

test("every instance in the background: the heading alone, and nothing says the list is empty or unmatched", () => {
  const s = run([instanceRow("ops", "bg-1", { background: true }), instanceRow("ops", "bg-2", { background: true })]), r = roster(s);
  assert.equal(r.empty, null);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(listed(s), [`> ${CHEVRONS.utf8.closed} ${BACKGROUND}  2`], "selected, as a first row is");
  assert.equal(s.selected, BACKGROUND_ID);
  assert.equal(press(s, ["enter", "j"]).state.selected, idOf(s, "bg-1"));
});

test("a selected row that becomes background while the section is closed hands the selection to the heading", () => {
  const rows = [instanceRow("dev", "dev-a"), instanceRow("dev", "lead"), instanceRow("ops", "ops-1")];
  let s = run(rows);
  s = press(s, ["G"]).state;
  assert.equal(s.selected, idOf(s, "ops-1"));
  s = took(s, observed([rows[0], rows[1], instanceRow("ops", "ops-1", { background: true })], { cli: BG_CLI }), 2);
  assert.equal(s.selected, BACKGROUND_ID);
  // Moved out again (a CLI change), its rows return to the main tree with it, and the heading goes.
  s = took(s, observed(rows, { cli: BG_CLI }), 3);
  assert.equal(heading(s), null);
  assert.deepEqual(roster(s).rows.map((item) => item.row.instance), ["dev-a", "lead", "ops-1"]);
});

test("a background parent moved out: its foreground children come back to the main tree under it", () => {
  const s = run([instanceRow("dev", "lead"), instanceRow("ops", "bg-1", { parentInstance: "lead" }), instanceRow("ops", "bg-kid", { parentInstance: "bg-1" })]);
  assert.equal(heading(s), null);
  assert.deepEqual(roster(s).rows.map((item) => [item.row.instance, item.depth]), [["lead", 0], ["bg-1", 1], ["bg-kid", 2]]);
});

test("the palette still lists every instance in the order it had, the section's included, open or closed", () => {
  const instancesOf = (state) => paletteItems(press(state, ["ctrl+k"]).state).items.filter((item) => item.kind === "instance").map((item) => item.name);
  const without = instancesOf(run(ROWS(), CLI));
  assert.deepEqual(new Set(without), new Set(["dev-a", "lead", "bg-1", "bg-kid"]));
  assert.deepEqual(instancesOf(run()), without);
  assert.deepEqual(instancesOf(press(run(), ["G", "enter"]).state), without);
});

test("an instance of the closed section opened from the palette does not open the section, nor move the selection", () => {
  let s = press(run(), ["g"]).state;
  const before = s.selected, id = idOf(s, "bg-1");
  s = press(s, ["ctrl+k", "b", "g", "-", "1", "enter"]).state;
  if (s.terminal?.status === "starting") s = reduce(s, { shown: { id } }).state;
  assert.equal(s.terminal?.id, id, "its terminal is opened");
  assert.deepEqual([s.background.size, heading(s).open, s.selected], [0, false, before]);
});

test("the open state is the workspace's, kept for the run as a collapse is", () => {
  const s = press(run(), ["G", "enter"]).state;
  assert.deepEqual([...s.background], [s.open]);
  // Another workspace's open section is not this one's.
  assert.equal(heading(Object.freeze({ ...s, background: new Set(["/elsewhere"]) })).open, false);
});

test("a view of two deployments: Right on the open heading goes to the section's first row, past the machine's heading (review round 1)", () => {
  const identity = { key: "github.com/acme/platform", ref: "main", keyFrom: "workspace", standalone: false, defaultTeam: { label: "eng", team: "team-1" }, teams: { eng: "team-1" }, teamsFrom: "observed" };
  const entry = (dir, name) => {
    const row = instanceRow("dev", name, { home: `${dir}/agents/dev/instances/${name}`, background: true });
    const document = { ...rosterOf([row]), root: `${dir}/agents`, workspace: { reachable: true, ...identity } };
    const listed = rosterRows(document, BG_CLI);
    const instances = panelInstances(listed, listed.map((each) => ({ running: each.running, runtimeState: each.runtimeState, tmux: each.tmux })));
    return observedEntry({ roster: document, workspaceStatus: { workspace: { name: "acme-platform" } }, observedAt: new Date(NOW).toISOString() }, instances, new Date(NOW).toISOString());
  };
  let s = stateOf(entry(DEPLOYMENT, "bg-a"), { cli: BG_CLI });
  s = reduce(s, { admitted: "/srv/deploy-b", at: new Date(NOW).toISOString() }).state;
  s = took(s, entry("/srv/deploy-b", "bg-b"), 2, "/srv/deploy-b");
  s = press(s, ["G", "right"]).state;
  const r = roster(s);
  assert.equal(r.multi, true);
  assert.equal(r.background.open, true);
  const at = r.items.findIndex((item) => item?.kind === "background");
  assert.ok(r.items[at + 1]?.heading, "a machine's heading stands right under the open heading");
  const after = press(s, ["right"]).state;
  assert.equal(after.selected, instanceId(r.instances.find((row) => row.instance === r.items.find((item, i) => i > at && item?.row)?.row.instance)));
  assert.notEqual(after.selected, BACKGROUND_ID);
});
