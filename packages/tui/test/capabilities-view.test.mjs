process.env.TZ = "UTC";
// The Capabilities view as the frame draws it (Spec 7, Done 2 and 3): the list of capabilities in
// their sections and groups in the sidebar, the selected capability's detail beside it, the bodies of
// the catalog's states, and the cheat sheet. The model is the frame's contract (lib/model.mjs, `m.capabilities`), made here by
// hand over a real model of the Instances view, so each case says exactly what the view is handed;
// capabilities.test.mjs holds the model to the shared rules. What a test claims about the screen it
// reads from the screen's cells, never from a string's length.
import test from "node:test";
import assert from "node:assert/strict";
import { model } from "../lib/model.mjs";
import { createScreen } from "../lib/term/screen.mjs";
import { style } from "../lib/term/style.mjs";
import { textWidth } from "../lib/term/width.mjs";
import { WIDE, frame } from "../lib/views/frame.mjs";
import { CAPABILITIES_TEXT, capabilityDetailRows } from "../lib/views/capabilities.mjs";
import { CAPABILITY_COPY } from "../lib/client.mjs";
import { NOW, instanceRow, observed, stateOf } from "./helpers.mjs";

const size = (cols, rows) => ({ cols, rows });
const S60 = size(60, 24), S80 = size(80, 24), S120 = size(120, 40);
const SIZES = [S60, S80, S120];
const AT = new Date(NOW).toISOString();
/** The sidebar's width on a wide terminal (views/frame.mjs layout), and where the main area is read
 *  from: the cell after the sidebar's rule (the detail itself stands from the next, listCols + 2). */
const listWidth = (cols) => Math.min(Math.max(Math.floor(cols * 0.48), 36), 60);
const paneOf = (sz) => (sz.cols >= WIDE ? listWidth(sz.cols) : sz.cols);
const detailAt = (sz) => (sz.cols >= WIDE ? listWidth(sz.cols) + 1 : 0);
/** What no cell may hold: a control character (C0, DEL, C1) or a bidi control. */
const CONTROL = /[\p{Cc}\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

/** The real model of a small Instances view: the title, the actions and the cheat sheet's keys. */
const baseModel = (ascii) => model(stateOf(observed([instanceRow("dev", "dev-a")]), { ascii }), { page: 19, now: NOW, at: AT, cols: 38 });
const LONG = "a-capability-whose-name-is-far-longer-than-any-list-pane-can-hold-at-any-width";
/** Two sections of three: Workspace owned (two groups) and Packages; no Repo owned. */
const LIST = () => [
  { section: "workspace" },
  { group: "oats", note: "member repo · host" },
  { name: "aweb", layer: "Messaging", selected: true },
  { name: LONG, layer: "Knowledge", selected: false },
  { group: "tools", note: "member repo" },
  { name: "notes", layer: null, selected: false },
  { section: "packages" },
  { group: "acme-pack", note: "package · v1.2.0" },
  { name: "pack-tools", layer: null, selected: false },
];
/** Every section of the detail. */
const DETAIL = () => ({
  name: "aweb", layer: "Messaging", description: "Messaging over aweb: mail and chat between the instances of the workspace, and its channel.", failure: null,
  words: { comesFrom: CAPABILITY_COPY.comesFrom, provides: CAPABILITY_COPY.provides, usedBy: CAPABILITY_COPY.usedBy },
  comesFrom: [{ label: "Repository", value: "oats" }, { label: "Latest", value: "bbbbbbb" }, { label: "Path", value: "capabilities/aweb" }, { label: "Fingerprint", value: "ccccccc" }],
  provides: [{ label: "Skills", names: ["oats-aweb", "aweb-messaging", "aweb-identity", "aweb-team-membership"], said: null }, { label: "Commands", names: [], said: CAPABILITY_COPY.none }, { label: "Hooks", names: ["SessionStart"], said: null }],
  used: { state: "known", failure: null, count: CAPABILITY_COPY.souls(2), empty: null, more: 0, shown: [
    { name: "dev", color: "green", count: 2, behind: CAPABILITY_COPY.behind(1), soul: "dev" },
    { name: "reviewer", color: null, count: 0, behind: null, soul: "reviewer" },
  ] },
});
/** A detail with its name alone: no layer, no description, a kind the kernel could not list, and no soul using it. */
const BARE = () => ({
  name: "bare", layer: null, description: "", failure: null, words: DETAIL().words, comesFrom: [],
  provides: [{ label: "Skills", names: [], said: CAPABILITY_COPY.unlistable }],
  used: { state: "known", failure: null, count: CAPABILITY_COPY.souls(0), empty: CAPABILITY_COPY.noSoul, more: 0, shown: [] },
});
const CAPS = () => ({ local: true, state: "rows", failure: null, heading: null, list: LIST(), above: 0, below: 0, focus: "list", filter: { editing: false, query: "" }, detail: DETAIL(), detailTop: 0, keep: true, mark: -1 });
/** The model of the Capabilities view: the base's, its `capabilities` replaced in part. */
function capsModel(over = {}, { ascii = false } = {}) {
  return { ...baseModel(ascii), view: "capabilities", under: "capabilities", capabilities: { ...CAPS(), ...over } };
}
const FAILURE = "Couldn't read this workspace's capabilities: oats capabilities exited 1 after reading the workspace's members for longer than it was given.";

/** Draw a model as the main loop draws it after the model step. */
function drawModel(m, sz) {
  const made = frame(m, sz);
  const cells = createScreen({ utf8: true, ascii: m.ascii }).cells(made.rows, sz);
  return { ...made, cells, lines: cells.map((line) => line.map((cell) => cell.text).join("").trimEnd()) };
}
const cellText = (d, r, from = 0, to = Infinity) => d.cells[r].slice(from, to).map((cell) => cell.text).join("").trimEnd();
/** Every row of the screen: there is no header and no footer, the sidebar and the main area each
 *  have the whole height. */
const allRows = (sz) => Array.from({ length: sz.rows }, (_, i) => i);
const sidebarLines = (d, sz) => allRows(sz).map((r) => cellText(d, r, 0, paneOf(sz)));
/** The sidebar's rules: the one between the closed views and the Capabilities view's heading (the
 *  last of the accordion), and the one between its list and the cheat sheet. */
function rulesOf(d, sz) {
  const pane = paneOf(sz), found = sidebarLines(d, sz).map((line, r) => (line === "─".repeat(pane) || line === "-".repeat(pane) ? r : -1)).filter((r) => r >= 0);
  assert.equal(found.length, 2, "the sidebar has its two rules");
  return found;
}
/** The rows of the open view's list: under its heading, down to the rule before the cheat sheet. */
const listRows = (d, sz) => { const [before, after] = rulesOf(d, sz); return allRows(sz).slice(before + 2, after); };
const listLines = (d, sz) => listRows(d, sz).map((r) => cellText(d, r, 0, paneOf(sz)));
/** The open view's heading: the accordion's row of the Capabilities view, after the rule. */
const headingLine = (d, sz) => cellText(d, rulesOf(d, sz)[0] + 1, 0, paneOf(sz));
const detailLines = (d, sz) => allRows(sz).map((r) => cellText(d, r, detailAt(sz)));
/** The cheat sheet: the sidebar's rows after its last rule, the empty rows under it left out. */
function sheet(d, sz) {
  const lines = sidebarLines(d, sz).slice(rulesOf(d, sz)[1] + 1);
  while (lines.length && lines.at(-1) === "") lines.pop();
  return lines;
}
/** The cheat sheet's rows for `[key, word]` hints: the key from the margin, the word in a column
 *  after the widest key and three cells. */
const hints = (...pairs) => { const widest = Math.max(...pairs.map(([key]) => key.length)); return pairs.map(([key, word]) => ` ${key.padEnd(widest + 3)}${word}`); };
const LEAD = ["Ctrl+\\", "commands"], PALETTE = ["Ctrl+K", "palette"], HELP = ["?", "help"], QUIT = ["q", "quit"];
/** The row of the list whose sidebar cells hold `word`. */
function listRowWith(d, sz, word) {
  const found = listRows(d, sz).filter((r) => cellText(d, r, 0, paneOf(sz)).includes(word));
  assert.equal(found.length >= 1, true, `a row of the list holds ${word}`);
  return found[0];
}
/** The row whose text holds `word` (from cell `from`). */
function rowWith(d, sz, word, from = 0) {
  const found = allRows(sz).filter((r) => cellText(d, r, from).includes(word));
  assert.equal(found.length >= 1, true, `a row holds ${word}`);
  return found[0];
}
/** The cell index at which `word` is first drawn in row `r`, or -1. */
function cellIndexOf(d, r, word, from = 0) {
  const cells = d.cells[r];
  for (let x = from; x + word.length <= cells.length; x++) if (cells.slice(x, x + word.length).map((cell) => cell.text).join("") === word) return x;
  return -1;
}
/** Every row of a frame takes exactly the terminal's columns, and no wide grapheme is split. */
function fits(d, sz, at) {
  assert.equal(d.cells.length, sz.rows, at);
  d.cells.forEach((line, r) => {
    assert.equal(line.length, sz.cols, `${at}: row ${r} has the terminal's cells`);
    assert.equal(line.reduce((sum, cell) => sum + cell.width, 0), sz.cols, `${at}: row ${r}: its graphemes take exactly the terminal's columns`);
    assert.equal(textWidth(d.lines[r]) <= sz.cols, true, `${at}: row ${r} is no wider than the terminal`);
  });
}

// ── The whole screen ────────────────────────────────────────────────────────────────────────────

test("the Capabilities view at 80x24 in UTF-8, cell for cell: the sections and groups in the sidebar under the open view's heading, the sidebar's rule over the whole height, the selected capability's detail beside it from the top, and the small cheat sheet under the list", () => {
  const d = drawModel(capsModel(), S80);
  assert.deepEqual(d.lines, [
    "  acme-platform                       │   aweb Messaging",
    "                                      │   Messaging over aweb: mail and chat",
    " Instances                          1 │   between the instances of the",
    " Souls                              2 │   workspace, and its channel.",
    "──────────────────────────────────────│",
    " Capabilities                       3 │   Comes from",
    " Workspace owned                      │     Repository   oats",
    "  oats · member repo · host           │     Latest       bbbbbbb",
    ">   aweb Messaging                    │     Path         capabilities/aweb",
    "    a-capability-whose-nam… Knowledge │     Fingerprint  ccccccc",
    "  tools · member repo                 │",
    "    notes                             │   Provides",
    " Packages                             │     Skills    oats-aweb,",
    "  acme-pack · package · v1.2.0        │               aweb-messaging,",
    "    pack-tools                        │               aweb-identity,",
    "──────────────────────────────────────│               aweb-team-membership",
    " Ctrl+\\   commands                    │     Commands  None",
    " Ctrl+K   palette                     │     Hooks     SessionStart",
    " Enter    detail                      │",
    " ?        help                        │   Used by  2 souls",
    " q        quit                        │     ■ dev ·2 · 1 on an older version",
    "                                      │     ■ reviewer ·0",
    "                                      │",
    "                                      │",
  ]);
  assert.deepEqual([d.page, d.room, d.extent], [17, 24, 22], "the list's rows, and the detail's rows shown and held: every row of the screen");
  assert.equal(d.cells[5][1].style.bold, true, "Capabilities is the open view");
  assert.equal(d.cells[5][36].style.dim, true, "its key is dim at the right");
});

test("at 60, 80 and 120 columns, in UTF-8 and ASCII, every row fits the terminal, the list stands in the sidebar, and the detail stands beside it only on a wide terminal", () => {
  for (const ascii of [false, true]) for (const sz of SIZES) {
    const at = `${sz.cols}x${sz.rows}${ascii ? " ascii" : ""}`;
    const d = drawModel(capsModel({}, { ascii }), sz);
    fits(d, sz, at);
    const list = listLines(d, sz);
    assert.equal(list.some((line) => line.trim() === "Workspace owned"), true, `${at}: the section's title`);
    assert.equal(list.some((line) => line.includes(ascii ? "oats - member repo" : "oats · member repo")), true, `${at}: a group's heading`);
    assert.equal(list.some((line) => line.startsWith(">   aweb")), true, `${at}: the selected row`);
    assert.equal(d.lines.some((line) => line.includes("Comes from")), sz.cols >= WIDE, `${at}: the detail beside the list on a wide terminal only`);
    for (const line of d.lines) assert.doesNotMatch(line, CONTROL, at);
  }
});

test("a section's title is bold, a group's heading dim, a capability's layer label dim, and the selected row in reverse with `>`: never colour alone", () => {
  const d = drawModel(capsModel(), S80);
  const BOLD = style({ bold: true }), DIM = style({ dim: true }), SELECTED = style({ reverse: true });
  const title = listRowWith(d, S80, "Workspace owned");
  assert.deepEqual(d.cells[title][1].style, BOLD);
  const group = listRowWith(d, S80, "tools · member repo");
  assert.deepEqual(d.cells[group][2].style, DIM);
  const selected = listRowWith(d, S80, "aweb Messaging");
  assert.equal(d.cells[selected][0].text, ">");
  assert.deepEqual(d.cells[selected][4].style, SELECTED);
  const layer = cellIndexOf(d, selected, "Messaging");
  assert.deepEqual(d.cells[selected][layer].style, SELECTED, "on the selected row its label is in reverse too");
  const other = listRowWith(d, S80, "pack-tools");
  assert.deepEqual(d.cells[other][4].style.reverse ?? false, false);
  const long = listRowWith(d, S80, "Knowledge");
  assert.deepEqual(d.cells[long][cellIndexOf(d, long, "Knowledge")].style, DIM, "a layer label is dim");
});

test("a long name is cut before its layer label is: the label stands whole beside what is left of the name; with no room for both, the name alone", () => {
  for (const sz of SIZES) {
    const d = drawModel(capsModel(), sz);
    const r = listRowWith(d, sz, "a-capability-whose");
    const line = cellText(d, r, 0, paneOf(sz));
    assert.match(line, /… Knowledge$/, `${sz.cols}: cut, then the label`);
  }
});

test("Repo owned stands where the model lists it, between Workspace owned and Packages; a model without it draws no such title", () => {
  const withRepo = [...LIST().slice(0, 6), { section: "repo" }, { group: "oats", note: "member repo · host" }, { name: "secret", layer: null, selected: false }, ...LIST().slice(6)];
  const d = drawModel(capsModel({ list: withRepo }), S80);
  const titles = listLines(d, S80).filter((line) => /^ [A-Z]/.test(line)).map((line) => line.trim());
  assert.deepEqual(titles, [CAPABILITIES_TEXT.sections.workspace, CAPABILITIES_TEXT.sections.repo, CAPABILITIES_TEXT.sections.packages]);
  assert.equal(drawModel(capsModel(), S80).lines.some((line) => line.includes("Repo owned")), false);
});

test("the bodies of the catalog's states read as the Souls view's, with the noun capabilities: reading, none, no match, a failed first read with the key that reads again, no workspace here; a failed re-read keeps the rows under a heading", () => {
  // A body stands in the list's place in the sidebar, wrapped to its width, and nothing stands beside it.
  const body = (over, sz = S80, ascii = false) => {
    const d = drawModel(capsModel(over, { ascii }), sz);
    if (sz.cols >= WIDE) assert.deepEqual(detailLines(d, sz).filter(Boolean), [], `${sz.cols}: nothing in the main area`);
    return listLines(d, sz).filter(Boolean).join("\n");
  };
  assert.equal(body({ state: "reading", list: [], detail: null }), "   Reading capabilities…");
  assert.equal(body({ state: "reading", list: [], detail: null }, S80, true), "   Reading capabilities...");
  assert.equal(body({ state: "none", list: [], detail: null }), "   This workspace offers no\n   capabilities. `oats capabilities`\n   says why.", "a command is never broken over two rows");
  assert.equal(body({ state: "none", list: [], detail: null }, S60), "   This workspace offers no capabilities.\n   `oats capabilities` says why.", "a command is never broken over two rows");
  // No match is said in the list's place, as a filter of the Souls view's is.
  assert.deepEqual(listLines(drawModel(capsModel({ state: "nomatch", list: [], detail: null }), S80), S80).filter(Boolean), ["   No capability matches the filter."]);
  assert.equal(body({ local: false, state: "none", list: [], detail: null }), "   Open a workspace of this machine\n   to see its capabilities.");
  const failed = body({ state: "failed", failure: FAILURE, list: [], detail: null }).split("\n");
  assert.equal(failed.slice(0, -1).map((line) => line.trim()).join(" "), FAILURE, "the whole sentence, wrapped");
  assert.equal(failed.at(-1), "   r reads them again.");
  // Over a failed re-read: its heading as the list's first row, then the rows; the detail holds the sentence whole, in the warning style.
  // The heading has no word of its own: the accordion's row above it names the view.
  const heading = { label: "", path: null, state: null, short: FAILURE, readAt: "09:59:30" };
  const d = drawModel(capsModel({ heading, detail: { ...DETAIL(), failure: FAILURE } }), S120);
  const list = listLines(d, S120);
  assert.match(list[0], /^ Couldn't read/, "the sentence from the margin");
  assert.match(list[0], /read 09:59:30$/);
  assert.equal(list[1].trim(), "Workspace owned");
  const detail = detailLines(d, S120);
  assert.match(detail[1], /^ {3}Couldn't read this workspace's capabilities/);
  const r = rowWith(d, S120, "Couldn't read this workspace's capabilities", detailAt(S120));
  assert.deepEqual(d.cells[r][cellIndexOf(d, r, "Couldn't", detailAt(S120))].style, style({ bold: true, fg: "yellow" }));
});

test("the list's window: the rows the model hands, and on the last row what is cut off above and below", () => {
  const d = drawModel(capsModel({ above: 3, below: 12 }), S80);
  assert.equal(listLines(d, S80).at(-1), "   3 more above, 12 more below");
});

// ── The detail ──────────────────────────────────────────────────────────────────────────────────

test("the detail top to bottom: the name and its layer, the description wrapped, Comes from as `label  value`, Provides each kind wrapped, and Used by with its count; at 60 columns Enter gives it the list's place", () => {
  for (const sz of [size(80, 40), S120]) {
    const detail = detailLines(drawModel(capsModel(), sz), sz).join("\n");
    const order = ["aweb Messaging", "Messaging over aweb", CAPABILITY_COPY.comesFrom, "Repository", "Fingerprint", CAPABILITY_COPY.provides, "Skills", "Commands  None", "Hooks", `${CAPABILITY_COPY.usedBy}  ${CAPABILITY_COPY.souls(2)}`, "dev"];
    const at = order.map((word) => detail.indexOf(word));
    assert.deepEqual(at.every((n) => n >= 0), true, `${sz.cols}: each part is drawn`);
    assert.deepEqual([...at].sort((a, b) => a - b), at, `${sz.cols}: in this order`);
  }
  // Under WIDE columns the list alone; with the detail's focus, the detail in its place.
  const narrow = drawModel(capsModel({ focus: "detail" }), S60);
  fits(narrow, S60, "60, detail");
  const lines = allRows(S60).map((r) => cellText(narrow, r));
  assert.equal(lines[0], `${" > aweb Messaging".padEnd(51)}Tab back`, "the focus mark beside the title, and the page's key at the right");
  assert.equal(lines.some((line) => line.includes("Workspace owned")), false, "the list is not drawn");
  assert.equal(lines.some((line) => line.includes("acme-platform")), false, "nor the rest of the sidebar: the detail has the whole screen");
  assert.equal(lines.some((line) => line.includes(CAPABILITY_COPY.usedBy)), true);
});

test("a detail with nothing to say leaves its parts out: no layer, no description, no Comes from; a kind the kernel could not list says so, and a capability no soul uses says the shared sentence", () => {
  assert.equal(capabilityDetailRows(capsModel({ detail: BARE() }), 60).mark, -1, "nothing marked");
  const detail = detailLines(drawModel(capsModel({ detail: BARE() }), S80), S80).filter(Boolean);
  assert.deepEqual(detail, ["   bare", `   ${CAPABILITY_COPY.provides}`, "     Skills  Not listable: a spawn of it", "             would refuse.", `   ${CAPABILITY_COPY.usedBy}  ${CAPABILITY_COPY.souls(0)}`, `     ${CAPABILITY_COPY.noSoul}`], "the shared sentence wrapped beside its label, never cut");
  assert.equal(CAPABILITY_COPY.unlistable, "Not listable: a spawn of it would refuse.");
  const noKinds = detailLines(drawModel(capsModel({ detail: { ...BARE(), provides: [] } }), S80), S80).filter(Boolean);
  assert.equal(noKinds.some((line) => line.includes(CAPABILITY_COPY.provides)), false, "no kind reported: no Provides");
  const noInstance = detailLines(drawModel(capsModel({ detail: { ...BARE(), used: { ...BARE().used, empty: CAPABILITY_COPY.noInstance } } }), S80), S80);
  assert.equal(noInstance.some((line) => line.trim() === CAPABILITY_COPY.noInstance), true);
});

test("Used by: each soul its colour mark, its name, a dim count of the instances carrying it and those on an older version in words and the warning style; eight at most then `+n`; Reading souls… and a failed read before the souls are known", () => {
  const d = drawModel(capsModel(), S120);
  const dev = rowWith(d, S120, "■ dev", detailAt(S120));
  const mark = cellIndexOf(d, dev, "■", detailAt(S120));
  assert.deepEqual(d.cells[dev][mark].style, style({ fg: "green" }), "dev's colour on its mark");
  assert.deepEqual(d.cells[dev][cellIndexOf(d, dev, "·2", detailAt(S120))].style, style({ dim: true }));
  const behind = cellIndexOf(d, dev, CAPABILITY_COPY.behind(1), detailAt(S120));
  assert.deepEqual(d.cells[dev][behind].style, style({ bold: true, fg: "yellow" }));
  const reviewer = rowWith(d, S120, "■ reviewer", detailAt(S120));
  assert.equal(cellText(d, reviewer, detailAt(S120)).trim(), "■ reviewer ·0", "uncoloured, and its count even at 0");
  assert.equal(d.cells[reviewer][cellIndexOf(d, reviewer, "■", detailAt(S120))].style.fg ?? null, null);
  const ascii = drawModel(capsModel({}, { ascii: true }), S120);
  assert.equal(cellText(ascii, rowWith(ascii, S120, "# dev", detailAt(S120)), detailAt(S120)).trim(), `# dev x2 - ${CAPABILITY_COPY.behind(1)}`);
  const more = drawModel(capsModel({ detail: { ...DETAIL(), used: { ...DETAIL().used, more: 3 } } }), S120);
  assert.equal(detailLines(more, S120).some((line) => line.trim() === "+3"), true);
  const reading = detailLines(drawModel(capsModel({ detail: { ...DETAIL(), used: { state: "reading", failure: null, count: null, empty: null, more: 0, shown: [] } } }), S120), S120);
  assert.equal(reading.some((line) => line.trim() === CAPABILITY_COPY.usedBy), true, "no count before the souls are known");
  assert.equal(reading.some((line) => line.trim() === CAPABILITIES_TEXT.readingSouls), true);
  const failed = drawModel(capsModel({ detail: { ...DETAIL(), used: { state: "failed", failure: "Couldn't read this workspace's souls: no.", count: null, empty: null, more: 0, shown: [] } } }), S120);
  const r = rowWith(failed, S120, "Couldn't read this workspace's souls", detailAt(S120));
  assert.deepEqual(failed.cells[r][cellIndexOf(failed, r, "Couldn't", detailAt(S120))].style, style({ bold: true, fg: "yellow" }));
});

test("the marked soul of Used by carries `>` and reverse video; the detail is drawn from the least top that shows it, and the frame hands that top to the loop", () => {
  const d = drawModel(capsModel({ focus: "detail", mark: 1 }), S120);
  // The detail's own column 0 is a cell past the bar: the mark stands at its LEFT (2), the soul's mark at INNER (4).
  const r = rowWith(d, S120, "■ reviewer", detailAt(S120));
  assert.equal(d.cells[r][detailAt(S120) + 3].text, ">");
  assert.deepEqual(d.cells[r][detailAt(S120) + 5].style.reverse, true);
  assert.equal(d.capabilitiesTop, 0, "everything fits: drawn from the top");
  // In 16 rows (the detail has them all) the marked soul is under the fold: the window moves the least that shows it.
  const short = size(120, 16);
  const low = drawModel(capsModel({ focus: "detail", mark: 1 }), short);
  assert.equal(low.capabilitiesTop, 4);
  assert.deepEqual(detailLines(low, short).slice(-3), ["     ■ dev ·2 · 1 on an older version", "   > ■ reviewer ·0", "   4 more above"]);
  // Scrolled away on purpose (not kept), the store's top stands.
  const loose = drawModel(capsModel({ focus: "detail", mark: 1, keep: false, detailTop: 0 }), short);
  assert.equal(loose.capabilitiesTop, 0);
  // With no detail drawn there is no top to hand.
  assert.equal(drawModel(capsModel({ state: "reading", list: [], detail: null }), S80).capabilitiesTop, undefined);
});

test("text from outside goes through the display filter: a control character in a name, a note, a fact or a soul never reaches a cell", () => {
  const evil = "bad\x1b[31mname\u202e\x07";
  const list = [{ section: "workspace" }, { group: evil, note: evil }, { name: evil, layer: evil, selected: true }];
  const detail = { ...DETAIL(), name: evil, layer: evil, description: evil, comesFrom: [{ label: evil, value: evil }], provides: [{ label: evil, names: [evil], said: null }], used: { ...DETAIL().used, count: evil, shown: [{ name: evil, color: "green", count: 1, behind: evil, soul: "x" }] } };
  for (const sz of SIZES) {
    const d = drawModel(capsModel({ list, detail, failure: evil }), sz);
    for (const line of d.lines) assert.doesNotMatch(line, CONTROL, `${sz.cols}`);
  }
});

// ── The cheat sheet ─────────────────────────────────────────────────────────────────────────────

test("the cheat sheet is small: after the leader and the palette, Enter detail from the list; from the detail Tab back, then Enter soul while a soul is marked and none while none is; then help and quit; the filter, a read again, Esc and the workspaces are not on it, nor with no workspace here", () => {
  const rest = [HELP, QUIT];
  assert.deepEqual(sheet(drawModel(capsModel(), S120), S120), hints(LEAD, PALETTE, ["Enter", "detail"], ...rest));
  assert.deepEqual(sheet(drawModel(capsModel({ focus: "detail", mark: 0 }), S120), S120), hints(LEAD, PALETTE, ["Tab", "back"], ["Enter", "soul"], ...rest));
  assert.deepEqual(sheet(drawModel(capsModel({ focus: "detail", mark: -1 }), S120), S120), hints(LEAD, PALETTE, ["Tab", "back"], ...rest));
  assert.deepEqual(sheet(drawModel(capsModel({ local: false, state: "none", list: [], detail: null }), S120), S120), hints(LEAD, PALETTE, ...rest));
  // In 24 rows the list keeps its rows, and the small sheet has all of its own under it.
  assert.deepEqual(sheet(drawModel(capsModel(), S60), S60), hints(LEAD, PALETTE, ["Enter", "detail"], ...rest));
  // A kept filter stands on the view's heading with its `/`, bold; the sheet is the list's.
  const kept = drawModel(capsModel({ filter: { editing: false, query: "aw" } }), S120);
  assert.equal(headingLine(kept, S120), ` Capabilities  /aw${" ".repeat(listWidth(120) - 20)}3`);
  for (const x of [15, 16, 17]) assert.equal(kept.cells[rulesOf(kept, S120)[0] + 1][x].style.bold, true, `bold at ${x}`);
  assert.deepEqual(sheet(kept, S120), hints(LEAD, PALETTE, ["Enter", "detail"], ...rest));
  // While it is typed the heading is the field, and the sheet says how to work it.
  const editing = drawModel(capsModel({ filter: { editing: true, query: "aw" } }), S120);
  assert.equal(headingLine(editing, S120), ` /aw${" ".repeat(listWidth(120) - 6)}3`);
  assert.deepEqual(sheet(editing, S120), hints(LEAD, ["Enter", "keep"], ["Esc", "clear"]));
});

test("under 80 columns the detail page's first row carries its keys at the right, dim, Tab back first: at 70x20, `> aweb Messaging`, then, ending a cell before the edge, Tab back and Enter soul while a soul is marked, Tab back alone while none is", () => {
  const sz = size(70, 20);
  const marked = drawModel(capsModel({ focus: "detail", mark: 0 }), sz);
  fits(marked, sz, "70x20 marked");
  assert.equal(cellText(marked, 0), ` > aweb Messaging${" ".repeat(31)}Tab back   Enter soul`);
  const from = cellIndexOf(marked, 0, "Tab back");
  assert.equal(from, 48, "the keys end a cell before the edge");
  for (let x = from; x < from + 21; x++) if (marked.cells[0][x].text !== " ") assert.equal(marked.cells[0][x].style.dim, true, `the keys are dim at ${x}`);
  assert.deepEqual([marked.cells[0][1].style.bold, marked.cells[0][3].style.bold], [true, true], "the focus mark and the name stay bold");
  const none = drawModel(capsModel({ focus: "detail", mark: -1 }), sz);
  assert.equal(cellText(none, 0), ` > aweb Messaging${" ".repeat(44)}Tab back`);
});
