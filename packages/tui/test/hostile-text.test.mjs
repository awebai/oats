// What the TUI's permission to exist rests on (awebai/oats#855, section 2, term 7): nothing a
// kernel, a repository, an agent or a remote host says can write a control sequence to the
// terminal. Every test here goes through the real path and reads the bytes: shown(), a view's
// rows, the screen, and the guard's writer into a captured stream. The first holds the rule for
// one row of text; the ones after it put the same fixture in every field the Instances view
// shows.
import test from "node:test";
import assert from "node:assert/strict";
import { createScreen, glyphs } from "../lib/term/screen.mjs";
import { style } from "../lib/term/style.mjs";
import { lit, shown } from "../lib/term/text.mjs";
import { createGuard } from "../lib/term/tty.mjs";
import { fakeProcess, fakeStdin, fakeStdout, readTerminalOutput } from "./helpers.mjs";

const ESC = "\x1b", BEL = "\x07", ST = `${ESC}\\`;
/** Text as a hostile source might send it, by what it tries. Every row is drawn as a name would be. */
const FIXTURE = {
  "a lone ESC": `dev${ESC}`,
  "CSI colour": `${ESC}[31mred${ESC}[0m`,
  "CSI cursor moves": `${ESC}[H${ESC}[10;10H${ESC}[5A${ESC}[2Dmoved`,
  "CSI erase": `${ESC}[2J${ESC}[3J${ESC}[K${ESC}[1Kgone`,
  "CSI private modes": `${ESC}[?1049l${ESC}[?25h${ESC}[?1000h${ESC}[?2004l${ESC}[>1u`,
  "OSC 0, the title": `${ESC}]0;owned${BEL}`,
  "OSC 2, the title": `${ESC}]2;owned${ST}`,
  "OSC 8, a link": `${ESC}]8;;https://evil.example/${ST}click${ESC}]8;;${ST}`,
  "OSC 52, the clipboard": `${ESC}]52;c;cm0gLXJmIH4=${BEL}`,
  "DCS": `${ESC}P+q544e${ST}`,
  "a device query": `${ESC}[c${ESC}[6n${ESC}[>0q`,
  "the 8-bit CSI (U+009B)": "\u009B31mred\u009B2J",
  "the 8-bit OSC and ST (U+009D, U+009C)": "\u009D0;eightbit\u009C",
  "BEL": `ding${BEL}`,
  "BS": "ab\b\b\bxyz",
  "CR": "safe\rEVIL",
  "CRLF": "one\r\ntwo",
  "LF": "one\ntwo",
  "TAB": "one\ttwo",
  "DEL": "ab\x7f\x7f",
  "NUL": "ab\x00cd",
  "bidi embeddings (U+202A, U+202B, U+202C)": "a\u202Ab\u202Bc\u202Cd",
  "bidi overrides (U+202D, U+202E)": "safe\u202Etxt.exe\u202D",
  "bidi isolates (U+2066 to U+2069)": "a\u2066b\u2067c\u2068d\u2069e",
  "the zero-width space (U+200B)": "ad\u200Bmin",
  "the word joiner (U+2060)": "ad\u2060min",
  "the BOM (U+FEFF)": "\uFEFFadmin",
  "the line and paragraph separators (U+2028, U+2029)": "one\u2028two\u2029three",
  "tag characters": `ok${[..."run this"].map((c) => String.fromCodePoint(0xE0000 + c.codePointAt(0))).join("")}`,
  "a lone high surrogate": "ab\uD83Dcd",
  "a lone low surrogate": "ab\uDE00cd",
  "a grapheme with 500 combining marks": `Z${"\u0301".repeat(500)}algo`,
  "a 10 000-character name": "n".repeat(10000),
  "a 10 000-character name of wide characters": "名".repeat(10000),
  "a secret-shaped string": "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  "a credentialed URL": "https://user:hunter2@example.com/repo.git",
  "plain text, for comparison": "dev-1 café 中文",
};
/** What the kernel refuses, plus the rest of what a terminal acts on: none of it may be written. */
const REFUSED = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF\u{E0000}-\u{E007F}]/u;

/** A view as the later views will be: a label of the TUI's own and a value it did not write, on a
 *  row each, with a clipped column and a styled one. */
function view(entries, size) {
  const rows = Array.from({ length: size.rows }, () => []);
  entries.slice(0, size.rows).forEach(([, value], r) => {
    rows[r] = [{ col: 0, text: lit(`row ${r + 1}`), style: style({ dim: true }) }, { col: 8, text: shown(value), width: 30 }, { col: 40, text: shown(value), style: style({ bold: true, fg: "cyan" }) }];
  });
  return rows;
}

test("no text from outside can write a control sequence: a hostile fixture drawn through shown(), a view, the screen and the real writer leaves only the TUI's own sequences in the output", () => {
  const entries = Object.entries(FIXTURE);
  assert.equal(entries.length >= 35, true);
  for (const look of [glyphs({ LANG: "en_US.UTF-8" }), glyphs({ LANG: "C" })]) {
    const size = { cols: 100, rows: 10 };
    const stdin = fakeStdin(), stdout = fakeStdout({ columns: size.cols, rows: size.rows }), proc = fakeProcess();
    const screen = createScreen({ ...look, color: true });
    let page = [];
    const guard = createGuard({ stdin, stdout, proc, frame: () => screen.render(view(page, size), size), onInput() {}, onResize() {}, onRedraw() {} });
    guard.start();
    // Every row of the fixture, a screen at a time, each frame a diff over the last one.
    for (let from = 0; from < entries.length; from += size.rows) { page = entries.slice(from, from + size.rows); guard.draw(); }
    // And each row alone on a screen that held another: a row is also safe as the only change.
    for (const entry of entries) { page = [entry]; guard.draw(); }
    guard.finish(0);

    // What the terminal received: the bytes of the captured stream.
    const bytes = Buffer.from(stdout.written.join(""), "utf8");
    const output = bytes.toString("utf8");
    assert.equal(Buffer.from(output, "utf8").equals(bytes) && output.isWellFormed(), true, "well-formed UTF-8, no lone surrogate");

    const { sequences, text, foreign } = readTerminalOutput(output);
    assert.deepEqual(foreign, [], "every ESC begins a sequence of the TUI's own list: a position, an erase, an SGR of its parameters, one of its four modes");
    assert.deepEqual([...new Set(sequences.map((s) => s.kind))].sort(), ["erase", "mode", "position", "sgr"]);
    assert.deepEqual(sequences.filter((s) => s.kind === "mode").map((s) => s.body), ["?1049h", "?25l", "?7l", "?2004h", "?2004l", "?7h", "?25h", "?1049l"], "the modes are the guard's own, once each way");
    assert.deepEqual([...new Set(sequences.filter((s) => s.kind === "sgr").map((s) => s.body))].sort(), ["0;1;36m", "0;2m", "0m"], "the styles are the view's own");
    const control = [...bytes].filter((b) => b < 0x20 && b !== 0x1b);
    assert.deepEqual(control, [], "no C0 byte but the ESC of those sequences: no BEL, BS, CR, LF or TAB");
    assert.equal(bytes.includes(0x7f), false, "no DEL");
    assert.doesNotMatch(text, /[\u0080-\u009F]/, "no C1 control, so no 8-bit CSI");
    assert.doesNotMatch(text, REFUSED, "none of the refused format characters: bidi controls, zero-width hiders, tags, separators");
    assert.equal(bytes.filter((b) => b === 0x1b).length, sequences.length, "one ESC per sequence, and no other");

    // It did draw them: the test is not passing on an empty screen.
    assert.match(text, /row 1.*row 10/s);
    assert.equal(text.includes("[withheld]"), true, "text with a control character or a secret shape is withheld whole");
    assert.equal(text.includes("one two"), true, "a line feed and a tab fold to a space");
    assert.equal(text.includes(look.utf8 ? "safe\uFFFDtxt.exe" : "safe?txt.exe"), true, "a bidi override is replaced, never dropped and never written");
    assert.equal(text.includes(look.utf8 ? "dev-1 café 中文" : "dev-1 caf? ??"), true);
    assert.equal(text.includes(look.utf8 ? "\uFFFDalgo" : "?algo"), true, "an over-long grapheme is one replacement cell");
    assert.equal(text.includes(look.utf8 ? "\uFFFD0;eightbit\uFFFD" : "?0;eightbit?"), true, "a C1 control is replaced: what is left is text, and it starts nothing");
    assert.doesNotMatch(text, /owned|EVIL|hunter2|ghp_|evil\.example/, "nothing of a withheld text is shown");
    assert.doesNotMatch(text, /n{61}/, "a long name is clipped to its row");
    assert.equal(text.includes(look.ascii ? "nnn..." : "nnn…"), true);
    if (!look.utf8) assert.doesNotMatch(output, /[^\x00-\x7f]/, "and with a locale that is not UTF-8, no byte outside ASCII at all");
  }
});

// ── The Instances view ───────────────────────────────────────────────────────────────────────────
// The same fixture in every field the view shows: each value is put where a kernel, a repository
// or an agent could put it, the state is drawn as the main loop draws it, and the frame is turned
// into bytes by the real screen. The rows are made by the shared functions, which validate nothing
// here: the model takes a row as given, so the view is what stands between the text and the terminal.
import { DETACH_KEY_FEATURE, observedEntry, panelInstances, rosterRows } from "../lib/client.mjs";
import { model } from "../lib/model.mjs";
import { reduce } from "../lib/store.mjs";
import { frame } from "../lib/views/frame.mjs";
import { CLI, DEPLOYMENT, NOW, draw, failed, instanceRow, observed, press, rosterOf, stateOf } from "./helpers.mjs";

const HOME = `${DEPLOYMENT}/agents/soul/instances/row-1`;
/** A kernel record that opens agents with a detach key. */
const KEYED = Object.freeze({ ...CLI, features: Object.freeze([...CLI.features, DETACH_KEY_FEATURE]) });
const CLAIM = Object.freeze({ since: "2026-10-11T09:56:00.000Z", producer: "claude", reason: "question", message: "Which base should it use?" });
/** One instance, selected as the only row: the list draws it and the detail shows its facts. */
const one = (extra = {}, soul = "soul", name = "row-1") => instanceRow(soul, name, { home: HOME, branch: "agents/row-1", ...extra });
const shownAs = (extra, options) => stateOf(observed([one(extra)]), options);
/** The same entry with its souls in `team`, through the shared calls helpers.mjs `observed` makes. */
function inTeam(rows, team) {
  const document = rosterOf(rows, { team }), listed = rosterRows(document, CLI);
  const answers = listed.map((row) => ({ running: row.running, runtimeState: row.runtimeState, tmux: row.tmux }));
  return observedEntry({ roster: document, workspaceStatus: { workspace: { name: "acme-platform" } }, observedAt: "2026-10-11T10:00:00.000Z" }, panelInstances(listed, answers), "2026-10-11T10:00:01.000Z");
}
/** Every field of the view that holds text the TUI did not write, and a state that shows `value` there. */
const FIELDS = {
  "the instance name": (value, options) => stateOf(observed([one({}, "soul", value)]), options),
  "the soul": (value, options) => stateOf(observed([one({}, value)]), options),
  "the harness": (value, options) => shownAs({ harness: value }, options),
  "the model": (value, options) => shownAs({ model: value }, options),
  "where the model came from": (value, options) => shownAs({ modelFrom: value }, options),
  "the work mode": (value, options) => shownAs({ work: value }, options),
  "the branch": (value, options) => shownAs({ branch: value }, options),
  "the team": (value, options) => stateOf(inTeam([one()], value), options),
  "the parent": (value, options) => shownAs({ parentInstance: value }, options),
  "the sibling": (value, options) => shownAs({ siblingInstance: value }, options),
  "the runtime state of a stopped instance": (value, options) => shownAs({ running: false, runtimeState: value }, options),
  "the runtime state of an instance the kernel could not answer for": (value, options) => shownAs({ running: null, runtimeState: value }, options),
  "the runtime error": (value, options) => shownAs({ running: null, runtimeState: "unreachable", runtimeError: value }, options),
  "the home path": (value, options) => stateOf(observed([instanceRow("soul", "row-1", { home: value })]), options),
  "the workspace's name": (value, options) => stateOf(observed([one()], { workspace: value }), options),
  "the failure message of an unavailable deployment": (value, options) => stateOf(failed(observed([one()]), { code: "E_SOMETHING_NEW", message: value }), options),
  // The same failure as the kernel's own refusal: the shared reader marks the error the CLI printed,
  // and the shared sentence then leads with who speaks and filters the message itself.
  "the failure message of an unavailable deployment, marked as the kernel's own refusal": (value, options) => stateOf(failed(observed([one()]), { code: "E_SOMETHING_NEW", message: value, origin: "kernel" }), options),
  "the failure message of a stale deployment": (value, options) => stateOf(failed(observed([one()]), { code: "E_REMOTE_UNREADABLE", message: value }), options),
  "a waiting claim's message, through the shared read": (value, options) => shownAs({ waitingOnYou: { ...CLAIM, message: value } }, options),
  // Opening an agent: the name in the line Enter says, what the viewer printed, and the key that returns.
  "the name in the line after Enter on an instance that does not run": (value, options) => press(stateOf(observed([one({ running: false, runtimeState: "stopped" }, "soul", value)]), options), ["enter"]).state,
  "what the viewer printed on stderr, in the line after the return": (value, options) => {
    const opened = press(stateOf(observed([one()], { cli: KEYED }), { cli: KEYED, ...options }), ["enter"]).state;
    return reduce(opened, { returned: { id: opened.opening.id, status: 1, stderr: value } }).state;
  },
  "the key that leaves an agent's terminal, in the footer": (value, options) => stateOf(observed([one()], { cli: KEYED }), { cli: KEYED, detachKey: value, ...options }),
};
const UTF8 = glyphs({ LANG: "en_US.UTF-8" }), NOT_UTF8 = glyphs({ LANG: "C" });
const S80 = { cols: 80, rows: 24 }, S120 = { cols: 120, rows: 40 };
/** Where each value is drawn: both sizes in UTF-8, and in the fields a kernel fills most freely (the
 *  name, a failure's message) also with a locale that is not: what differs there is the screen's
 *  work, the same for every field. One value is the exception. The shared display filter reads a run of 10 000 letters slowly (a
 *  third of a second of CPU a call: its credentialed-URL pattern backtracks) and every paint
 *  filters again, so that value is drawn once, and only where a text that long is cut (the name)
 *  or wrapped (the runtime error, a failure's message); 10 000 wide characters, which cost
 *  nothing, are drawn in every field like the rest. */
const SLOW = "a 10 000-character name";
const LONG_FIELDS = new Set(["the instance name", "the runtime error", "the failure message of an unavailable deployment", "the failure message of an unavailable deployment, marked as the kernel's own refusal", "the failure message of a stale deployment"]);
const BOTH_LOCALES = new Set(["the instance name", "the failure message of an unavailable deployment", "the failure message of an unavailable deployment, marked as the kernel's own refusal", "the quote line"]);
const drawnAt = (name, field) => (name !== SLOW ? [[S80, UTF8], [S120, UTF8], ...(BOTH_LOCALES.has(field) ? [[S80, NOT_UTF8]] : [])] : LONG_FIELDS.has(field) ? [[S80, UTF8]] : []);

/** The bytes a frame's rows become on a real screen, held to the census: `text`, what is left of
 *  them without the TUI's own sequences. */
function census(rows, size, look, at, cells = null) {
  const screen = createScreen({ ...look, color: true });
  const bytes = Buffer.from(screen.render(rows, size, { full: true }), "utf8"), output = bytes.toString("utf8");
  assert.equal(output.isWellFormed(), true, `${at}: well-formed, no lone surrogate`);
  const { sequences, text, foreign } = readTerminalOutput(output);
  assert.deepEqual(foreign, [], `${at}: every ESC begins a sequence of the TUI's own list`);
  assert.deepEqual([...new Set(sequences.map((s) => s.kind))].filter((kind) => !["erase", "position", "sgr"].includes(kind)), [], `${at}: a frame writes positions, erases and styles, and nothing else`);
  assert.equal(bytes.filter((b) => b === 0x1b).length, sequences.length, `${at}: one ESC per sequence, and no other`);
  assert.equal(bytes.some((b) => (b < 0x20 && b !== 0x1b) || b === 0x7f), false, `${at}: no C0 byte but the ESC of those sequences, and no DEL`);
  assert.doesNotMatch(text, /[\u0080-\u009F]/, `${at}: no C1 control`);
  assert.doesNotMatch(text, REFUSED, `${at}: none of the refused format characters`);
  if (!look.utf8) assert.equal(bytes.some((b) => b > 0x7f), false, `${at}: with a locale that is not UTF-8, no byte outside ASCII`);
  // And the cell buffer itself: no cell holds a control character, a C1 control or a bidi control.
  const held = (cells ?? screen.cells(rows, size)).flatMap((line, r) => line.flatMap((cell, x) => (REFUSED.test(cell.text) || /[\u0080-\u009F]/.test(cell.text) ? [`row ${r}, column ${x}`] : [])));
  assert.deepEqual(held, [], `${at}: no cell holds a character the terminal acts on`);
  assert.doesNotMatch(text, /owned|EVIL|hunter2|ghp_|evil\.example/, `${at}: nothing of a withheld text is shown`);
  assert.equal(text.includes("oats") && text.includes("1 Instances"), true, `${at}: the frame is drawn`);
  return text;
}

for (const [field, make] of Object.entries(FIELDS)) {
  test(`the hostile fixture as ${field}, drawn by the Instances view at 80x24 and at 120x40, leaves only the TUI's own sequences in the output, and no cell holds a control character`, () => {
    for (const [name, value] of Object.entries(FIXTURE)) for (const [size, look] of drawnAt(name, field)) {
      const state = make(value, { ascii: look.ascii }), at = `${name}, ${size.cols}x${size.rows}${look.utf8 ? "" : ", not UTF-8"}`;
      const drawn = draw(state, size, { utf8: look.utf8 }), text = census(drawn.rows, size, look, at, drawn.cells);
      // The field is on the screen: plain text put there is read there.
      if (name === "plain text, for comparison" && size === S120) assert.equal(text.includes("dev-1 café 中文"), true, `${at}: ${field} is drawn`);
      if (name === "bidi overrides (U+202D, U+202E)" && size === S120 && !field.startsWith("a waiting claim")) assert.equal(text.includes("safe\uFFFDtxt.exe"), true, `${at}: a bidi override is replaced, never dropped and never written`);
    }
  });
}

test("a waiting claim's message handed to the view directly, whatever the shared read lets through, is drawn through shown(): the hostile fixture on the quote line leaves only the TUI's own sequences", () => {
  const state = (look) => shownAs({ waitingOnYou: { ...CLAIM } }, { ascii: look.ascii });
  for (const [name, value] of Object.entries(FIXTURE)) for (const [size, look] of drawnAt(name, name === SLOW ? null : "the quote line")) {
    const at = `${name}, ${size.cols}x${size.rows}${look.utf8 ? "" : ", not UTF-8"}`;
    const m = model(state(look), { page: draw(state(look), size).page, now: NOW, at: new Date(NOW).toISOString() });
    // The quote line: the fact under `needs`, which holds the claim's message.
    const needs = m.detail.facts.findIndex((fact) => fact.label === "needs"), quote = m.detail.facts[needs + 1];
    assert.equal(needs >= 0 && quote.label === "" && quote.value.includes(CLAIM.message), true, "the model holds the message on the line under `needs`");
    const facts = m.detail.facts.map((fact) => (fact === quote ? { ...fact, value: fact.value.replace(CLAIM.message, () => value) } : fact));
    const text = census(frame({ ...m, detail: { ...m.detail, facts } }, size).rows, size, look, at);
    if (name === "plain text, for comparison" && size === S120) assert.equal(text.includes("the agent: \"dev-1 café 中文\""), true, `${at}: the message is drawn as an attributed quote`);
    if (name === "CSI erase") assert.equal(text.includes("[withheld]") && !text.includes("gone"), true, `${at}: a message with a control character is withheld whole`);
    if (name === "bidi overrides (U+202D, U+202E)" && size === S120) assert.equal(text.includes("safe\uFFFDtxt.exe"), true, `${at}: a bidi override is replaced`);
  }
});

test("through the shared read a hostile waiting message does not arrive: the detail holds the reason in words and no quote line", () => {
  for (const name of ["CSI erase", "OSC 52, the clipboard", "bidi overrides (U+202D, U+202E)", "the 8-bit CSI (U+009B)", "a secret-shaped string"]) {
    const d = draw(shownAs({ waitingOnYou: { ...CLAIM, message: FIXTURE[name] } }), S120);
    assert.equal(d.lines.some((line) => line.includes(" needs ")), true, `${name}: the claim is still drawn`);
    assert.equal(d.lines.some((line) => line.includes("the agent:")), false, `${name}: without its message`);
  }
});

// ── Other machines and the switcher ──────────────────────────────────────────────────────────────
// The same fixture in what another machine, a registration, a failed roster read or a folder's name
// can put on the screen. Every outcome of the roster read reaches the store as the loop hands it on
// (lib/read.mjs): through the shared remoteRosterState and observeIdentities. A group has the
// kernel's form except in the one field a case makes hostile.
import { DETAIL_WITHHELD, cliRemoteRoster, displayLine, observeIdentities, remoteRosterState } from "../lib/client.mjs";
import { textWidth } from "../lib/term/width.mjs";
import { cutNote } from "../lib/views/instances.mjs";

const S60 = { cols: 60, rows: 15 };
const IDENTITY = Object.freeze({ key: "github.com/acme/platform", ref: "main", keyFrom: "workspace", standalone: false, defaultTeam: Object.freeze({ label: "eng", team: "team-1" }), teams: Object.freeze({ eng: "team-1" }), teamsFrom: "observed" });
const ELSEWHERE = Object.freeze({ ...IDENTITY, key: "github.com/acme/billing" });
/** A kernel that reads other machines: without `roster` the shared home makes no roster read. */
const REMOTE_CLI = Object.freeze({ ...CLI, remote: Object.freeze(["roster"]) });
/** This machine's deployment, one instance, its roster reporting the workspace's identity. */
function reporting(options) {
  const document = { ...rosterOf([one()]), workspace: { reachable: true, ...IDENTITY } }, listed = rosterRows(document, REMOTE_CLI);
  const answers = listed.map((row) => ({ running: row.running, runtimeState: row.runtimeState, tmux: row.tmux }));
  const entry = observedEntry({ roster: document, workspaceStatus: { workspace: { name: "acme-platform" } }, observedAt: "2026-10-11T09:59:00.000Z" }, panelInstances(listed, answers), "2026-10-11T10:00:00.000Z");
  return stateOf(entry, { cli: REMOTE_CLI, ...options });
}
const FAR = "/home/dev/Agents/acme";
const farRow = (name, extra = {}, root = FAR) => ({
  instance: name, agent: "acme-ledger-developer", home: `${root}/agents/acme-ledger-developer/instances/${name}`, agentsRoot: `${root}/agents`,
  work: "worktree", harness: "claude", running: true, runtimeState: "running", addressable: true, ...extra,
});
/** The machine `garnet`, reached, reporting this workspace, with one row; and a second one, `quartz`. */
const group = (extra = {}) => ({
  id: "garnet:acme-1", server: "garnet", label: "garnet", registrationPresent: true, target: { workspace: FAR, sshHost: "garnet.example" }, probe: { ok: true },
  workspace: IDENTITY, agentsRoot: `${FAR}/agents`, souls: [], instances: [farRow("acme-ledger-far-a")], ...extra,
});
const quartz = (extra = {}) => group({ id: "quartz:acme-7", server: "quartz", label: "quartz", target: { workspace: "/srv/acme", sshHost: "quartz.example" }, agentsRoot: "/srv/acme/agents", instances: [farRow("acme-ledger-far-q", {}, "/srv/acme")], ...extra });
const T1 = "2026-10-11T10:00:10.000Z", T2 = "2026-10-11T10:00:25.000Z";
/** The store after one outcome of the roster read, made as the loop makes it. */
function heard(state, outcome, at) {
  const next = remoteRosterState(state.remote, outcome, at);
  const kept = next.reported === null ? { memory: state.memory, notes: state.notes } : observeIdentities({ memory: state.memory, notes: state.notes }, next.reported, at);
  return reduce(state, { roster: { remote: { remoteGroups: next.remoteGroups, rosterAnswered: next.rosterAnswered, rosterFailure: next.rosterFailure }, memory: kept.memory, notes: kept.notes, at } }).state;
}
const answered = (...groups) => ({ envelope: { ok: true, result: { groups } } });
/** The same answer as the reader takes it: read by the shared cliRemoteRoster from an installed CLI
 *  that printed it. Where it parses the answer the shared read marks a probe's error as the
 *  kernel's, and who gave the text of that machine's rows is read from the mark; an envelope made
 *  here (`answered`) has none, and its probe's error would read as the client's own. */
const printed = async (...groups) => ({ envelope: await cliRemoteRoster(CLI.bin, { exec: (bin, argv, options, callback) => { callback(null, JSON.stringify({ schemaVersion: 1, ok: true, result: { groups } }), ""); } }) });
/** A key on a state, with the geometry of an 80x24 frame: these keys read none of it. */
const key = (state, ...ids) => ids.reduce((s, id) => reduce(s, { key: id, page: 19, extent: 0, room: 19, cols: 38 }).state, state);
/** The second choice of the switcher, opened: the view of a machine that is in no view with this one. */
const second = (state) => key(state, "w", "j", "enter");
/** A workspace key whose last segment, the name a view of machines alone is shown under, is `value`. */
const named = (value) => ({ ...IDENTITY, key: `acme/${value}` });

/** Each place a machine, a registration, a roster read or a folder can put text, and a state in the
 *  Instances view that shows `value` there. `seen`: the view that draws plain text put there.
 *  `lead`: where the text is a row's own, the words the detail puts before it to say who gave it
 *  (the shared home's, written out here: a test is the place that pins them). */
const MACHINE_FIELDS = {
  "a machine's label": { seen: "the list and the detail", make: (value, options) => heard(reporting(options), answered(group({ label: value })), T1) },
  "a machine's server name, which names it when it has no label": { seen: "the list and the detail", make: (value, options) => heard(reporting(options), answered(group({ label: "", server: value })), T1) },
  "a machine's label where the header alone names it, `on <machine>`": { seen: "the list and the detail", make: (value, options) => second(heard(reporting(options), answered(group({ label: value, workspace: ELSEWHERE })), T1)) },
  "the workspace's name a machine reports": { seen: "the list and the detail", make: (value, options) => second(heard(reporting(options), answered(group({ workspace: named(value) })), T1)) },
  "a probe's error message, of a machine reached earlier": { seen: "the list and the detail", lead: "OATS says:", make: async (value, options) => heard(heard(reporting(options), answered(group()), T1), await printed(group({ probe: { ok: false, error: { code: "E_SSH", message: value } } })), T2) },
  "a probe's error message, of a machine never reached": { seen: null, make: (value, options) => heard(reporting(options), answered(group({ probe: { ok: false, error: { code: "E_REMOTE", message: value } }, workspace: null, instances: [] })), T1) },
  "the thrown message of the roster read, before any answer": { seen: "the list and the detail", make: (value, options) => heard(reporting(options), { thrown: value }, T1) },
  "the thrown message of the roster read, after an answer": { seen: "the list and the detail", make: (value, options) => heard(heard(reporting(options), answered(group()), T1), { thrown: value }, T2) },
  "the message of a roster answer that is an error": { seen: "the list and the detail", make: (value, options) => heard(reporting(options), { envelope: { ok: false, error: { code: "E_REGISTRY", message: value } } }, T1) },
  "a deployment's note under its heading, of a machine whose label and new workspace are the text": {
    seen: "the list and the detail",
    make: (value, options) => second(heard(heard(reporting(options), answered(group({ label: value }), quartz({ workspace: named(value) })), T1), answered(group({ label: value, workspace: named(value) }), quartz({ workspace: named(value) })), T2)),
  },
  "a deployment's note above the list, of a machine that moved to a workspace of that name": {
    seen: "the list and the detail",
    make: (value, options) => second(heard(heard(reporting(options), answered(group()), T1), answered(group({ workspace: named(value) })), T2)),
  },
  "the instance name of a machine's row": { seen: "the list and the detail", make: (value, options) => heard(reporting(options), answered(group({ instances: [farRow(value)] })), T1) },
  "the runtime error of a machine's row": { seen: "the list and the detail", lead: "OATS says:", make: (value, options) => heard(reporting(options), answered(group({ instances: [farRow("acme-ledger-far-a", { running: null, runtimeState: "unreachable", runtimeError: value })] })), T1) },
  "an offered folder's name and path": { seen: "the switcher", folder: true, make: (value, options) => reduce(reporting(options), { offered: { offered: [{ path: `/home/u/Agents/${value}`, name: value }], limited: true } }).state },
};
/** The views a state's text can reach, each with the sizes it is drawn at: the list with its
 *  headings beside the detail of its last row (a machine's, where there is one), that detail as
 *  the page it is on a narrow terminal, the switcher, and the help over the list and over the
 *  switcher. */
function viewsOf(state) {
  const list = key(state, "G"), switching = key(list, "w");
  return [
    ["the list and the detail", list, [S80, S120]],
    ["the detail as a page", key(list, "tab"), [S60]],
    ["the switcher", switching, [S80, S60]],
    ["the help over the list", key(list, "?"), [S80]],
    ["the help over the switcher", key(switching, "?"), [S80]],
  ];
}
/** No row of a frame is wider than the terminal: each takes exactly its columns, in whole graphemes. */
function within(drawn, size, at) {
  assert.equal(drawn.cells.length, size.rows, `${at}: as many rows as the terminal has`);
  drawn.cells.forEach((line, r) => {
    assert.equal(line.length, size.cols, `${at}: row ${r} has the terminal's cells`);
    assert.equal(line.reduce((sum, cell) => sum + cell.width, 0), size.cols, `${at}: row ${r}: its graphemes take exactly the terminal's columns`);
    assert.equal(textWidth(drawn.lines[r]) <= size.cols, true, `${at}: row ${r} is no wider than the terminal`);
    const split = line.flatMap((cell, x) => ((cell.width === 2 && line[x + 1]?.width !== 0) || (cell.width === 0 && line[x - 1]?.width !== 2) ? [x] : []));
    assert.deepEqual(split, [], `${at}: row ${r}: no wide grapheme is split`);
  });
}
/** A text of 10 000 letters is drawn where a text that long is cut or wrapped, once (see SLOW). */
const LONG_MACHINE_FIELDS = new Set(["a machine's label", "the thrown message of the roster read, before any answer", "the runtime error of a machine's row"]);
/** What a folder directly inside `~/Agents` cannot be named: the shared listing reads no such entry. */
const noFolder = (value) => value.includes("/") || value.includes("\0");

for (const [field, { make, seen, folder = false, lead = null }] of Object.entries(MACHINE_FIELDS)) {
  test(`the hostile fixture as ${field}, drawn in the list with its headings, the detail, the switcher and the help over each, leaves only the TUI's own sequences in the output, and no row is wider than the terminal`, async () => {
    for (const [name, value] of Object.entries(FIXTURE)) {
      if (folder && noFolder(value)) continue;
      if (name === SLOW) {
        if (!LONG_MACHINE_FIELDS.has(field)) continue;
        const drawn = draw(key(await make(value, { ascii: false }), "G"), S80), at = `${name}, the list, 80x24`;
        census(drawn.rows, S80, UTF8, at, drawn.cells);
        within(drawn, S80, at);
        continue;
      }
      for (const [view, state, sizes] of viewsOf(await make(value, { ascii: false }))) for (const size of sizes) {
        const at = `${name}, ${view}, ${size.cols}x${size.rows}`, drawn = draw(state, size), text = census(drawn.rows, size, UTF8, at, drawn.cells);
        within(drawn, size, at);
        // The field is on the screen: plain text put there is read there.
        if (name === "plain text, for comparison" && view === seen && size !== S60 && (size === S120 || view === "the switcher")) assert.equal(text.includes("dev-1 café 中文"), true, `${at}: ${field} is drawn`);
        // A row's own text: the detail says who gave it, in the shared home's words, before a text
        // the display filter shows, and never before one it withholds. The value is the row's text.
        if (lead !== null && view === "the list and the detail") {
          const line = displayLine(value);
          assert.equal(text.includes(lead), line !== null && line !== DETAIL_WITHHELD, `${at}: the speaker's words stand before a text that is shown, and before no other`);
          if (name === "plain text, for comparison" && size === S120) assert.equal(text.includes(`${lead} dev-1 café 中文`), true, `${at}: the words, then the text`);
        }
      }
      // With a locale that is not UTF-8: the list and the switcher, where the screen has the most to replace.
      const plain = await make(value, { ascii: true });
      for (const [view, state] of [["the list and the detail", key(plain, "G")], ["the switcher", key(plain, "G", "w")]]) {
        const at = `${name}, ${view}, 80x24, not UTF-8`, drawn = draw(state, S80, { utf8: false });
        census(drawn.rows, S80, NOT_UTF8, at, drawn.cells);
        within(drawn, S80, at);
      }
    }
  });
}

test("a hostile machine name in the header's `on <machine>` leaves no control byte of its own on the screen: an escape sequence, a bidi override and wide characters, each cut inside the header's row", () => {
  const names = { "an escape sequence": `gar${ESC}[2J${ESC}]0;owned${BEL}net`, "a bidi override": "gar\u202Enet", "wide characters": "名前".repeat(80) };
  for (const [name, value] of Object.entries(names)) for (const look of [UTF8, NOT_UTF8]) for (const size of [S80, S120, S60]) {
    const state = second(heard(reporting({ ascii: look.ascii }), answered(group({ label: value, workspace: ELSEWHERE })), T1)), at = `${name}, ${size.cols}x${size.rows}${look.utf8 ? "" : ", not UTF-8"}`;
    const drawn = draw(state, size, { utf8: look.utf8 }), m = model(state, { page: drawn.page, now: NOW, at: new Date(NOW).toISOString(), cols: drawn.cols });
    assert.deepEqual([m.here, m.machines, m.machine], [false, 1, value], `${at}: the model hands the frame the machine's name as the shared entry has it`);
    const text = census(drawn.rows, size, look, at, drawn.cells), header = drawn.lines[0];
    within(drawn, size, at);
    assert.equal(header.startsWith(" oats  billing  on "), true, `${at}: the workspace's name and the TUI's own word stand whole: ${header}`);
    assert.equal(header.endsWith("  1 running") && drawn.cells[0][size.cols - 1].text === " ", true, `${at}: the count keeps its place at the right edge: ${header}`);
    const shownName = header.slice(" oats  billing  on ".length, header.length - "  1 running".length).trim();
    if (name === "an escape sequence") assert.equal(shownName, "[withheld]", `${at}: a name with a control character is withheld whole`);
    if (name === "a bidi override") assert.equal(shownName, look.utf8 ? "gar\uFFFDnet" : "gar?net", `${at}: a bidi override is replaced, never written`);
    if (name === "wide characters") {
      assert.equal(shownName.endsWith(look.ascii ? "..." : "…"), true, `${at}: a name longer than its cells is cut with the mark: ${shownName}`);
      if (look.utf8) assert.equal(drawn.cells[0].filter((cell) => cell.width === 2).length >= 4, true, `${at}: in two-cell graphemes, none split`);
      else assert.match(shownName, /^\?+\.\.\.$/, `${at}: each replaced by the screen`);
    }
    assert.equal(text.includes("owned"), false, at);
  }
});

test("200 machines are drawn in bounded work: the shared home reads each machine a fixed number of times when the store takes the answer, a repaint, a resize and a movement key read none again, and a paint works out no more rows than its pane holds", () => {
  // No clock is read here: a time under load says nothing. What is counted is every read of a
  // machine's rows and of its probe by the shared home, through a proxy over each group, and the
  // rows the model works out for one paint.
  function counted(count) {
    const reads = { instances: 0, probe: 0 };
    const groups = Array.from({ length: count }, (_, i) => {
      const server = `garnet-${String(i).padStart(3, "0")}`;
      const made = group({ id: `${server}:acme-1`, server, label: server, instances: [farRow(`acme-ledger-far-${String(i).padStart(3, "0")}`)] });
      return new Proxy(made, { get(target, name, receiver) { if (Object.hasOwn(reads, name)) reads[name] += 1; return Reflect.get(target, name, receiver); } });
    });
    return { reads, groups };
  }
  const each = {};
  for (const count of [50, 200]) {
    const { reads, groups } = counted(count), state = heard(reporting(), answered(...groups), T1), at = `${count} machines`;
    each[count] = { taking: { instances: reads.instances / count, probe: reads.probe / count } };
    assert.equal(reads.instances > 0 && reads.probe > 0, true, `${at}: the proxies are the groups the shared home read`);
    // The first paint, a repaint, two resizes, and the selection walked to the end and back.
    const taken = { ...reads }, drawn = draw(state, S80);
    for (const size of [S80, S120, S60]) draw(state, size);
    let walked = state;
    for (const id of ["j", "pagedown", "pagedown", "G", "k", "pageup", "g"]) { walked = key(walked, id); draw(walked, S80); }
    assert.deepEqual(reads, taken, `${at}: the roster is asked of the shared home once for what the store took, not once a paint or a key`);
    // One paint: a pane of rows, whatever the roster holds. This machine's heading and row, then a heading and a row a machine.
    const m = model(state, { page: drawn.page, now: NOW, at: new Date(NOW).toISOString(), cols: drawn.cols }), items = 2 + 2 * count;
    assert.equal(drawn.rows.length, S80.rows, at);
    assert.equal(m.list.length, drawn.page - 1, `${at}: the model works out the rows of the pane and no other`);
    assert.deepEqual([m.above, m.below], [0, items - (drawn.page - 1)], `${at}: and counts the rest`);
    assert.equal(drawn.lines[21].slice(0, 38).trim(), cutNote(0, items - (drawn.page - 1)), `${at}: the pane's last row says so`);
    assert.equal(draw(walked, S80).lines[0].includes(`+${count} machines`), true, `${at}: the header counts them`);
    census(drawn.rows, S80, UTF8, at, drawn.cells);
    within(drawn, S80, at);
    // The switcher asks the shared home at each paint, and that too is a fixed number of reads a machine.
    const switching = key(state, "w"), before = { ...reads }, listed = draw(switching, S80);
    each[count].switcher = { instances: (reads.instances - before.instances) / count, probe: (reads.probe - before.probe) / count };
    census(listed.rows, S80, UTF8, `${at}, the switcher`, listed.cells);
    within(listed, S80, `${at}, the switcher`);
  }
  assert.deepEqual(each[200], each[50], "a machine is read as many times among 200 as among 50: the work grows with the machines, not with their square");
  for (const n of [each[200].taking.instances, each[200].taking.probe, each[200].switcher.probe]) assert.equal(Number.isInteger(n) && n > 0, true, "a whole number of reads a machine");
  assert.equal(each[200].switcher.instances, 0, "the switcher reads no machine's rows");
  // 200 machines matched to no workspace, in the switcher: one screen of them, and the rest counted.
  const never = Array.from({ length: 200 }, (_, i) => group({ id: `quartz-${i}:acme-1`, server: `quartz-${i}`, label: `quartz-${i}`, probe: { ok: false, error: { code: "E_SSH", message: "Permission denied (publickey)." } }, workspace: null, instances: [] }));
  const unmatched = draw(key(heard(reporting(), answered(...never), T1), "w"), S80);
  assert.equal(unmatched.lines.slice(3, 21).filter((line) => line.includes("quartz-")).length, 16, "the pane holds the open workspace, the heading and sixteen machines");
  assert.equal(unmatched.lines[21].trim(), cutNote(0, 202 - 18));
  within(unmatched, S80, "200 unmatched machines");
});
