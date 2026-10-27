// The viewer's scroll keys through a TUI tab (docs/tui.md, "Tabs"; awebai/oats#1502 part E): each
// tab runs the kernel's viewer, so the TUI adds no key of its own. Ctrl+B then `[`, Shift+PgUp and
// the copy-mode keys typed after them reach the viewer as the bytes a terminal sends without the
// kitty protocol: as they came in a terminal without it, re-encoded under it. The one exception is
// a tui.json whose back key is Ctrl+B (`open.detachKey: "C-b"`): then Ctrl+B is the TUI's.
import test from "node:test";
import assert from "node:assert/strict";
import { backKeyId, backKeySequences, createThrough } from "../lib/term/through.mjs";

const E = "\x1b";
const utf8 = (text) => new TextEncoder().encode(text);
const hex = (b) => Buffer.from(b).toString("hex");
/** What a scanner handed on, as the agent's bytes joined, or `back` where the back key was taken. */
const passed = (events) => events.map((event) => (event.input ? hex(event.input) : event.back ? `back ${hex(event.rest)}` : JSON.stringify(event))).join(" ");
/** A tab's scanner: the default back key C-x, without the protocol (`keyboard` null) or under
 *  flags 1 and 4 (5), as the TUI pushes them. */
const scanner = (keyboard, key = "C-x") => createThrough({ sequences: backKeySequences(key), now: () => 0, keyboard, leader: backKeyId(key) });

/** The keys, each as a terminal without the protocol sends it, and as one under it does. */
const KEYS = [
  ["Ctrl+B", "\x02", `${E}[98;5u`],
  ["[", "[", "["],
  ["Shift+PgUp", `${E}[5;2~`, `${E}[5;2~`],
  ["Up", `${E}[A`, `${E}[A`],
  ["Down", `${E}[B`, `${E}[B`],
  ["Ctrl+U", "\x15", `${E}[117;5u`],
  ["Ctrl+D", "\x04", `${E}[100;5u`],
  ["PgUp", `${E}[5~`, `${E}[5~`],
  ["q", "q", "q"],
];

test("Ctrl+B then [, Shift+PgUp and the copy-mode keys after them reach the viewer as their legacy bytes, one key per read and all in one read, without the kitty protocol and under it", () => {
  for (const [what, legacy, kitty] of KEYS) {
    assert.equal(passed(scanner(null).feed(utf8(legacy))), hex(utf8(legacy)), `${what}, no protocol`);
    assert.equal(passed(scanner(5).feed(utf8(kitty))), hex(utf8(legacy)), `${what}, under the protocol: re-encoded`);
  }
  // A whole scroll back, typed as one run: what the viewer reads is the legacy run.
  const legacyRun = KEYS.map(([, legacy]) => legacy).join(""), kittyRun = KEYS.map(([, , kitty]) => kitty).join("");
  assert.equal(passed(scanner(null).feed(utf8(legacyRun))).replaceAll(" ", ""), hex(utf8(legacyRun)));
  assert.equal(passed(scanner(5).feed(utf8(kittyRun))).replaceAll(" ", ""), hex(utf8(legacyRun)));
});

test("Esc, which leaves copy mode, reaches the viewer too: at once under the protocol, after the Esc wait without it", () => {
  assert.equal(passed(scanner(5).feed(utf8(`${E}[27u`))), hex(utf8(E)));
  const s = scanner(null);
  const now = passed(s.feed(utf8(E)));
  assert.equal(`${now} ${passed(s.expire())}`.trim(), hex(utf8(E)), "a lone ESC waits only to be told from a paste's start, then goes");
});

test("with tui.json's back key Ctrl+B (open.detachKey C-b), Ctrl+B is the TUI's, in both modes: the viewer never reads it, so its C-b [ cannot be typed", () => {
  assert.equal(passed(scanner(null, "C-b").feed(utf8("\x02"))), "back ");
  assert.equal(passed(scanner(5, "C-b").feed(utf8(`${E}[98;5u`))), "back ");
  assert.equal(passed(scanner(null, "C-b").feed(utf8(`${E}[5;2~`))), hex(utf8(`${E}[5;2~`)), "Shift+PgUp still reaches it");
});

// ── The hint (docs/tui.md, "Tabs"): where the scroll keys are named while a terminal has the focus.
import { PREFIX_SCROLL_FEATURE, chordFamilyFrom, instanceId } from "../lib/client.mjs";
import { roster, scrollKeys } from "../lib/model.mjs";
import { reduce } from "../lib/store.mjs";
import { CLI, draw, instanceRow, observed, stateOf } from "./helpers.mjs";

const AT = Object.freeze({ page: 19, extent: 0, room: 19, cols: 38, panel: Object.freeze({ cols: 89, rows: 40 }) });
let reads = 0;
const key = (state, id) => reduce(state, { key: id, ...(id.length === 1 ? { text: id } : {}), read: ++reads, ...AT });
const idOf = (state, name) => instanceId(roster(state).instances.find((row) => row.instance === name));
function enter(state, name) {
  const step = key(Object.freeze({ ...state, selected: idOf(state, name) }), "enter");
  return step.state.terminal?.status === "starting" ? reduce(step.state, { shown: { id: idOf(state, name) }, ...AT }).state : step.state;
}
const ONE = (options) => stateOf(observed([instanceRow("dev", "dev-a")]), options);
/** This machine's kernel as `oats version --json` describes it (lib/client.mjs cliRecord): with the
 *  feature and its viewer taking C-b [ (`prefix` true), with the feature alone (false), or a kernel
 *  before the feature (null), whose viewer may not bind Shift+PageUp either. */
const kernel = (prefix) => {
  const features = CLI.features.filter((name) => name !== PREFIX_SCROLL_FEATURE);
  return prefix === null ? Object.freeze({ ...CLI, features, sessionViewer: undefined }) : Object.freeze({ ...CLI, features: [...features, PREFIX_SCROLL_FEATURE], sessionViewer: { prefixScroll: prefix } });
};
/** dev-a's terminal open with the focus in it, on a kernel `kernel(prefix)`. */
const focused = (prefix, options) => enter(ONE({ cli: kernel(prefix), ...options }), "dev-a");
const S120 = { cols: 120, rows: 40 };
/** keys.json with Ctrl+Alt chosen: a zoomed title row keeps to the leader's keys there. */
const CTRL_ALT = Object.freeze({ keysRead: chordFamilyFrom('{ "chords": "ctrl+alt" }') });
const zoom = (s) => key(reduce(s, { back: true, read: ++reads, ...AT }).state, "z").state;
/** The sidebar's rows of the cheat sheet, trimmed. */
const sheet = (d) => d.lines.map((line) => line.slice(0, 30).trim()).filter(Boolean);

test("while a terminal has the focus the cheat sheet names the scroll keys: Ctrl+B [ where the 30 cells beside the terminal hold one key, Shift+PageUp or Ctrl+B [ where there is room, as a zoomed terminal's title row has", () => {
  const s = focused(true);
  const d = draw(s, S120);
  assert.ok(sheet(d).some((row) => /^Ctrl\+B \[\s+scroll back$/.test(row)), `the sidebar: ${JSON.stringify(sheet(d))}`);
  const zoomed = draw(zoom(focused(true, CTRL_ALT)), S120);
  assert.match(zoomed.lines[0], /Shift\+PageUp or Ctrl\+B \[ scroll back$/, `the zoomed title row has room for both, in the Ctrl+Alt family: ${zoomed.lines[0]}`);
});

test("the hint follows this machine's kernel (oats version --json): Shift+PageUp where it lists session-attach-prefix-scroll, Ctrl+B [ too where its sessionViewer.prefixScroll is true and the leader is not Ctrl+B, and no hint at all where it does not list the feature", () => {
  const d = draw(focused(false), S120);
  assert.ok(sheet(d).some((row) => /^Shift\+PageUp\s+scroll back$/.test(row)), `prefixScroll false: ${JSON.stringify(sheet(d))}`);
  assert.equal(sheet(d).some((row) => row.includes("Ctrl+B")), false);
  const leader = draw(focused(true, { detachKey: "C-b" }), S120);
  assert.equal(sheet(leader).some((row) => row.includes("Ctrl+B [")), false, `the leader Ctrl+B: ${JSON.stringify(sheet(leader))}`);
  assert.ok(sheet(leader).some((row) => /^Shift\+PageUp\s+scroll back$/.test(row)));
  // A kernel before the feature: its viewer may pass Shift+PageUp to the agent, so nothing is named,
  // whatever else it says.
  const older = focused(null);
  assert.equal(draw(older, S120).lines.some((line) => line.includes("scroll back")), false, "no hint for a kernel without the feature");
  const zoomedOld = draw(key(reduce(older, { back: true, read: ++reads, ...AT }).state, "z").state, { cols: 200, rows: 40 });
  assert.equal(zoomedOld.lines[0].includes("scroll back"), false, `nor in a zoomed title row with room: ${zoomedOld.lines[0]}`);
  const listedOnly = enter(ONE({ cli: Object.freeze({ ...kernel(null), sessionViewer: { prefixScroll: true } }) }), "dev-a");
  assert.equal(draw(listedOnly, S120).lines.some((line) => line.includes("scroll back")), false, "a sessionViewer without the feature is not read");
  // The decision itself.
  assert.deepEqual(scrollKeys(focused(true), roster(focused(true)).instances), { shift: true, prefix: true });
  assert.deepEqual(scrollKeys(focused(false), roster(focused(false)).instances), { shift: true, prefix: false });
  assert.deepEqual(scrollKeys(focused(true, { detachKey: "C-b" }), roster(focused(true)).instances), { shift: true, prefix: false });
  assert.deepEqual(scrollKeys(older, roster(older).instances), { shift: false, prefix: false });
  assert.deepEqual(scrollKeys(ONE({ cli: kernel(true) }), roster(ONE()).instances), { shift: false, prefix: false }, "no terminal shown");
});

test("no hint while the list has the focus: the scroll keys are the terminal's", () => {
  const s = focused(true);
  const listed = draw(key(reduce(s, { back: true, read: ++reads, ...AT }).state, "escape").state, S120);
  assert.equal(listed.lines.some((line) => line.includes("scroll back")), false);
});

test("a zoomed terminal's title row keeps the scroll hint where it fits, short where the long one does not fit beside the tab; it is the first key given up, so in the Alt family, whose chords lead the row, it shows only where the row is wider than 120 columns (round 1 of the review; the expert's decision on #1514)", () => {
  // The Ctrl+Alt family: the leader's keys alone, then the hint.
  const d80 = draw(zoom(focused(true, CTRL_ALT)), { cols: 80, rows: 40 });
  assert.match(d80.lines[0], /Ctrl\+B \[ scroll back$/, `80 columns: ${d80.lines[0]}`);
  assert.doesNotMatch(d80.lines[0], /Shift\+PageUp or/);
  const LONG = "backend-maintainer-deployment-review";
  const long = enter(stateOf(observed([instanceRow("dev", LONG)]), { cli: kernel(true), ...CTRL_ALT }), LONG);
  const d120 = draw(zoom(long), S120);
  assert.match(d120.lines[0], /scroll back$/, `a long name at 120: ${d120.lines[0]}`);
  // The Alt family, the default: the chords and the leader's keys keep the row at 120 columns, and
  // the hint is given up first (KNOWN: a zoomed terminal there does not name its scroll keys).
  const alt120 = draw(zoom(focused(true)), S120);
  assert.match(alt120.lines[0], /Alt\+Z zoom .* Esc the list$/, `the Alt family at 120: ${alt120.lines[0]}`);
  assert.doesNotMatch(alt120.lines[0], /scroll back/);
  const alt160 = draw(zoom(focused(true)), { cols: 160, rows: 40 });
  assert.match(alt160.lines[0], /Esc the list {3}Shift\+PageUp or Ctrl\+B \[ scroll back$/, `the Alt family at 160: ${alt160.lines[0]}`);
});

test("the help names Ctrl+B [ as a way to scroll back only where it can reach the viewer: not with the leader Ctrl+B (round 1 of the review)", () => {
  const helpOf = (options) => draw(reduce(ONE(options), { key: "?", text: "?", read: ++reads, ...AT }).state, { cols: 200, rows: 100 }).lines.join(" ");
  assert.match(helpOf(), /Shift\+PageUp or Ctrl\+B \[ \(tmux 3\.3\+\) scrolls back/);
  const leader = helpOf({ detachKey: "C-b" });
  assert.match(leader, /Shift\+PageUp scrolls back/);
  assert.doesNotMatch(leader, /Ctrl\+B \[/);
});
