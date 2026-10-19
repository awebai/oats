// The chords (docs/tui.md, "Chords"), module by module: the kitty keyboard protocol read
// (term/kitty.mjs), the key parser under it (term/keys.mjs), what is typed into an agent's terminal
// (term/through.mjs), the protocol pushed and popped on every way out (term/tty.mjs), the chords the
// TUI binds (actions.mjs), what one does (store.mjs) and the help. main.test.mjs has the run's.
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, chordKeys, leaderHandles } from "../lib/actions.mjs";
import { CHORDS } from "../lib/client.mjs";
import { initialState, reduce } from "../lib/store.mjs";
import { ESC_TIMEOUT_MS, createKeyParser, keyId, legacyEvents } from "../lib/term/keys.mjs";
import { KEYBOARD_FLAGS, US_SHIFTED, confirmed, kittyKey, legacyBytes } from "../lib/term/kitty.mjs";
import { backKeyId, backKeySequences, createThrough } from "../lib/term/through.mjs";
import { ENTER, LEAVE, POP, PUSH, QUERY, SIGNAL_STATUS, createGuard } from "../lib/term/tty.mjs";
import { CHORD_OPEN_RULE, CHORD_RULES, helpRows } from "../lib/views/help.mjs";
import { fakeProcess, fakeStdin, fakeStdout, fakeTimers, readTerminalOutput, rowStrings } from "./helpers.mjs";

const E = "\x1b";
const bytes = (text) => Uint8Array.from(Buffer.from(text, "latin1"));
const utf8 = (text) => new TextEncoder().encode(text);
const hex = (b) => Buffer.from(b).toString("hex");
const ids = (events) => events.map((event) => (event.keyboard !== undefined ? `answer ${event.keyboard}` : keyId(event)));

// ── What is pushed, asked and popped.

test("the protocol is pushed with flags 1 and 4, asked about and popped with the kitty sequences, which are the TUI's own", () => {
  assert.equal(KEYBOARD_FLAGS, 5);
  assert.deepEqual([PUSH, QUERY, POP], [`${E}[>5u`, `${E}[?u`, `${E}[<u`]);
  assert.deepEqual(readTerminalOutput(ENTER + PUSH + QUERY + POP + LEAVE).foreign, []);
  assert.deepEqual(readTerminalOutput(PUSH + QUERY + POP).sequences.map((s) => s.kind), ["keyboard", "keyboard", "keyboard"]);
  // The confirmed flags decide everything: flag 1 is needed, flag 4 makes Shift exact.
  assert.deepEqual([5, 1, 7, 0, 4, null, undefined].map(confirmed), [true, true, true, false, false, false, false]);
});

// ── THE TABLE: every key typed into an agent under the protocol, and the bytes it sends without it.
// Each row: what the key is, what a terminal sends for it under flags 1 and 4, and what it sends
// without the protocol (xterm's legacy encoding). The scanner of a terminal's focus types the second
// into the agent; the key parser reads the first as the legacy parser reads the second.
const TABLE = [
  ["a", "a", "a"], ["Shift+A", "A", "A"], ["é", "é", "é"],
  ["Esc", `${E}[27u`, E], ["Alt+Esc", `${E}[27;3u`, `${E}${E}`], ["Ctrl+Esc", `${E}[27;5u`, E],
  ["Enter", "\r", "\r"], ["Shift+Enter", `${E}[13;2u`, "\r"], ["Ctrl+Enter", `${E}[13;5u`, "\r"], ["Alt+Enter", `${E}[13;3u`, `${E}\r`],
  ["Tab", "\t", "\t"], ["Shift+Tab", `${E}[9;2u`, `${E}[Z`], ["Shift+Tab (legacy form)", `${E}[Z`, `${E}[Z`],
  ["Ctrl+Tab", `${E}[9;5u`, "\t"], ["Ctrl+Shift+Tab", `${E}[9;6u`, `${E}[Z`], ["Alt+Tab", `${E}[9;3u`, `${E}\t`], ["Alt+Shift+Tab", `${E}[9;4u`, `${E}${E}[Z`],
  ["Backspace", "\x7f", "\x7f"], ["Ctrl+Backspace", `${E}[127;5u`, "\x08"], ["Alt+Backspace", `${E}[127;3u`, `${E}\x7f`], ["Ctrl+Alt+Backspace", `${E}[127;7u`, `${E}\x08`],
  ["Space", " ", " "], ["Ctrl+Space", `${E}[32;5u`, "\x00"], ["Alt+Space", `${E}[32;3u`, `${E} `], ["Shift+Space", `${E}[32;2u`, " "],
  ["Ctrl+A", `${E}[97;5u`, "\x01"], ["Ctrl+C", `${E}[99;5u`, "\x03"], ["Ctrl+Z", `${E}[122;5u`, "\x1a"], ["Ctrl+Shift+A", `${E}[97:65;6u`, "\x01"],
  ["Ctrl+Alt+A", `${E}[97;7u`, `${E}\x01`], ["Alt+A", `${E}[97;3u`, `${E}a`], ["Shift+Alt+A", `${E}[97:65;4u`, `${E}A`],
  ["Alt+O", `${E}[111;3u`, `${E}o`], ["Ctrl+\\", `${E}[92;5u`, "\x1c"], ["Ctrl+]", `${E}[93;5u`, "\x1d"], ["Ctrl+[", `${E}[91;5u`, E],
  ["Ctrl+2", `${E}[50;5u`, "\x00"], ["Ctrl+3", `${E}[51;5u`, E], ["Ctrl+6", `${E}[54;5u`, "\x1e"], ["Ctrl+8", `${E}[56;5u`, "\x7f"], ["Ctrl+/", `${E}[47;5u`, "\x1f"],
  ["Ctrl+1", `${E}[49;5u`, "1"], ["Ctrl+,", `${E}[44;5u`, ","],
  ["Ctrl+Shift+/ (? reported)", `${E}[47:63;6u`, "\x7f"], ["Shift+Alt+2 (@ reported)", `${E}[50:64;4u`, `${E}@`], ["Shift+Alt+2 on a layout whose Shift+2 is \"", `${E}[50:34;4u`, `${E}"`],
  ["Alt+é", `${E}[233;3u`, `${E}é`], ["Shift+Alt+é", `${E}[233:201;4u`, `${E}É`],
  ["Ctrl+A with Caps Lock", `${E}[97;69u`, "\x01"], ["Ctrl+A with Num Lock", `${E}[97;133u`, "\x01"], ["Super+A", `${E}[97;9u`, "a"],
  ["Ctrl+с (the base-layout key is ignored)", `${E}[1089::99;5u`, "с"],
  ["Up", `${E}[A`, `${E}[A`], ["Shift+Up", `${E}[1;2A`, `${E}[1;2A`], ["Ctrl+Up", `${E}[1;5A`, `${E}[1;5A`], ["Alt+Left", `${E}[1;3D`, `${E}[1;3D`],
  ["Home", `${E}[H`, `${E}[H`], ["End", `${E}[F`, `${E}[F`], ["Insert", `${E}[2~`, `${E}[2~`], ["Delete", `${E}[3~`, `${E}[3~`], ["Ctrl+Delete", `${E}[3;5~`, `${E}[3;5~`],
  ["PageUp", `${E}[5~`, `${E}[5~`], ["PageDown", `${E}[6~`, `${E}[6~`],
  ["F1", `${E}[P`, `${E}OP`], ["F2", `${E}[Q`, `${E}OQ`], ["F3", `${E}[13~`, `${E}OR`], ["F4", `${E}[S`, `${E}OS`],
  ["Ctrl+F1", `${E}[1;5P`, `${E}[1;5P`], ["Ctrl+F3", `${E}[13;5~`, `${E}[1;5R`], ["F5", `${E}[15~`, `${E}[15~`], ["Shift+F12", `${E}[24;2~`, `${E}[24;2~`],
  ["Keypad Enter", `${E}[57414u`, "\r"], ["Keypad Up", `${E}[57419u`, `${E}[A`], ["Ctrl+Keypad Up", `${E}[57419;5u`, `${E}[1;5A`],
  ["Alt+Keypad Delete", `${E}[57426;3u`, `${E}[3;3~`], ["Keypad Begin", `${E}[57427u`, `${E}[E`], ["Ctrl+Keypad 5", `${E}[57404;5u`, "5"], ["Keypad +", `${E}[57413u`, "+"],
  ["F13", `${E}[57376u`, ""], ["Play (a media key)", `${E}[57428u`, ""],
];

/** What the scanner of a terminal's focus types into the agent for `typed`, under flags `flags`. */
function typedUnder(typed, flags = 5) {
  const through = createThrough({ sequences: backKeySequences("F12"), now: () => 0, keyboard: flags, leader: backKeyId("F12") });
  const events = through.feed(utf8(typed));
  assert.equal(events.every((event) => event.input), true, JSON.stringify(events));
  return Buffer.concat(events.map((event) => Buffer.from(event.input)));
}

test("every key typed into an agent under the protocol is the bytes the same key sends without it, row by row", () => {
  for (const [name, under, legacy] of TABLE) assert.equal(hex(typedUnder(under)), hex(utf8(legacy)), name);
});

test("the key parser reads every key of the table under the protocol as the legacy parser reads its bytes without it", () => {
  for (const [name, under, legacy] of TABLE) {
    let t = 0;
    const parser = createKeyParser({ now: () => t, keyboard: 5 });
    const events = parser.feed(utf8(under));
    t += ESC_TIMEOUT_MS;
    assert.deepEqual(ids([...events, ...parser.expire()]), ids(legacyEvents(utf8(legacy))), name);
  }
});

test("flag 4 puts subfields on every CSI u key: with them present every key reads and is typed as without them", () => {
  for (const [name, under] of TABLE) {
    const m = /^\x1b\[(\d+)(:[\d:]*)?(;\d+)?u$/.exec(under);
    if (!m || m[2]) continue;
    const [, code, , mods = ""] = m, shift = mods !== "" && ((Number(mods.slice(1)) - 1) & 1) !== 0;
    // A shifted key only where Shift is held (where it is not, flag 4 sends none); the base-layout key on every one.
    const variants = shift ? [`${code}::${code}`] : [`${code}:`, `${code}::${code}`, `${code}:${code}:${code}`, `${code}:${code}`];
    for (const fields of variants) {
      const sent = `${E}[${fields}${mods}u`;
      assert.equal(hex(typedUnder(sent)), hex(typedUnder(under)), `${name} as ${JSON.stringify(sent)}`);
      const p = createKeyParser({ now: () => 0, keyboard: 5 }), q = createKeyParser({ now: () => 0, keyboard: 5 });
      assert.deepEqual(ids([...p.feed(utf8(sent)), ...p.expire()]), ids([...q.feed(utf8(under)), ...q.expire()]), `${name} as ${JSON.stringify(sent)}`);
    }
  }
});

test("the shifted key is read only with Shift held, an empty one is as none, and the confirmed flags decide the rest: 5 exact, 1 the US table for the 21 keys that are not letters", () => {
  const key = (params) => kittyKey(params);
  assert.equal(hex(legacyBytes(key("50:64;3"), 5)), hex(utf8(`${E}2`)), "Alt+2 with a shifted key and no Shift: the 2");
  assert.equal(hex(legacyBytes(key("50:;4"), 5)), hex(utf8(`${E}2`)), "flag 4 confirmed, the shifted field empty: no other character");
  assert.equal(hex(legacyBytes(key("50:;4"), 1)), hex(utf8(`${E}@`)), "flag 1 alone: the US layout's");
  assert.equal(hex(legacyBytes(key("50:34;4"), 5)), hex(utf8(`${E}"`)), "flag 4: the reported character, on any layout");
  assert.equal(hex(legacyBytes(key("50:34;4"), 1)), hex(utf8(`${E}@`)), "flag 1 alone: the reported field is not read");
  assert.equal(hex(legacyBytes(key("97;4"), 1)), hex(utf8(`${E}A`)), "a letter is exact on every path: its capital");
  // THE ONE LIMIT (docs/tui.md, "Chords"): with flag 1 alone, the 21 keys that are not letters take the US layout's.
  assert.equal(Object.keys(US_SHIFTED).length, 21);
  for (const [ch, shifted] of Object.entries(US_SHIFTED)) {
    assert.equal(Buffer.from(legacyBytes(key(`${ch.codePointAt(0)};4`), 1)).toString(), `${E}${shifted}`, `Shift+Alt+${ch} under flag 1`);
  }
  // No answer, or one without flag 1: legacy. kittyKey refuses what is no key.
  for (const params of ["?5", "97;5:1", "97;5;97", "97;0", "97;257", "55296", "", "a"]) assert.equal(key(params), null, params);
});

// ── The key parser.

test("the parser reads the protocol only after the terminal's answer holds flag 1: before it, and with no answer, a CSI u key is no key and timing tells Esc from Alt", () => {
  let t = 0;
  const asking = createKeyParser({ now: () => t, keyboard: "asking" });
  assert.deepEqual(ids(asking.feed(utf8(`${E}[111;3u${E}[?5u${E}[111;3u`))), ["answer 5", "alt+o"], "the key before the answer is dropped");
  assert.equal(asking.keyboard, 5);
  assert.deepEqual(ids(asking.feed(utf8(`${E}[?5u`))), [], "an answer again is dropped");
  const refused = createKeyParser({ now: () => t, keyboard: "asking" });
  assert.deepEqual(ids(refused.feed(utf8(`${E}[?0u${E}[111;3u`))), ["answer 0"]);
  assert.equal(refused.keyboard, null, "an answer without flag 1: as without the protocol");
  const given = createKeyParser({ now: () => t, keyboard: "asking" });
  given.giveUp();
  assert.deepEqual(ids(given.feed(utf8(`${E}[?5u${E}[107;6u`))), [], "an answer after the wait, and the keys after it, are not read");
  assert.equal(given.keyboard, null);
  // Without the protocol the timing rule holds: Esc then o within the Esc timeout is Alt+O.
  const legacy = createKeyParser({ now: () => t });
  assert.deepEqual(ids(legacy.feed(utf8(E))), []);
  t += ESC_TIMEOUT_MS - 1;
  assert.deepEqual(ids(legacy.feed(utf8("o"))), ["alt+o"]);
});

test("under the protocol Alt+O and Esc then o are told apart exactly, with no timing, in one read or apart", () => {
  const parser = createKeyParser({ now: () => 0, keyboard: 5 });
  assert.deepEqual(ids(parser.feed(utf8(`${E}[27uo${E}[111;3u`))), ["escape", "o", "alt+o"]);
  assert.deepEqual(ids(parser.feed(utf8(`${E}[27u`))), ["escape"], "Esc alone is read at once");
  assert.equal(parser.timeoutAt(), null, "no Esc waits for a timeout");
  assert.deepEqual(ids(parser.feed(utf8("o"))), ["o"]);
});

test("a chord keeps its own key id under the protocol; the same key not bound as a chord reads as its legacy bytes", () => {
  const chords = new Map([["ctrl+shift+k", "palette"], ["ctrl+tab", "tab-next"], ["ctrl+shift+tab", "tab-previous"]]);
  const parser = createKeyParser({ now: () => 0, keyboard: 5, chords });
  assert.deepEqual(ids(parser.feed(utf8(`${E}[107:75;6u${E}[9;5u${E}[9;6u${E}[99;6u${E}[108;6u`))), ["ctrl+shift+k", "ctrl+tab", "ctrl+shift+tab", "ctrl+c", "ctrl+l"]);
  const none = createKeyParser({ now: () => 0, keyboard: 5 });
  assert.deepEqual(ids(none.feed(utf8(`${E}[107;6u${E}[9;5u${E}[9;6u`))), ["ctrl+k", "tab", "shift+tab"]);
});

// ── What is typed into an agent's terminal.

const CHORD_MAP = new Map([["ctrl+shift+k", "palette"], ["ctrl+shift+w", "close-terminal"]]);
const scanner = (options = {}) => createThrough({ sequences: backKeySequences("M-o"), now: () => options.t?.() ?? 0, keyboard: 5, leader: backKeyId("M-o"), chords: CHORD_MAP, ...options });
const shown = (events) => events.map((event) => (event.input ? `input ${hex(event.input)}` : event.back ? `back ${hex(event.rest)}` : event.chord ? `chord ${event.chord} ${hex(event.rest)}` : event.paste !== undefined ? `paste ${event.paste}` : `answer ${event.keyboard}`));

test("in a terminal under the protocol the back key is its one sequence, a chord is the TUI's, and what follows either in its read is handed on as the rest", () => {
  assert.deepEqual(shown(scanner().feed(utf8(`ab${E}[111;3uxy`))), ["input 6162", "back 7879"]);
  assert.deepEqual(shown(scanner().feed(utf8(`${E}[27uo`))), ["input 1b", "input 6f"], "Esc then o: the agent's, never the back key");
  assert.deepEqual(shown(scanner().feed(utf8(`q${E}[107;6uzz`))), ["input 71", "chord palette 7a7a"]);
  assert.deepEqual(shown(scanner().feed(utf8(`${E}[112;6u`))), ["input 10"], "a Ctrl+Shift key that is no chord: its Ctrl byte");
  const f12 = createThrough({ sequences: backKeySequences("F12"), now: () => 0, keyboard: 5, leader: backKeyId("F12") });
  assert.deepEqual(shown(f12.feed(utf8(`${E}[24~`))), ["back "], "a function key back key keeps its legacy form");
  const ctrl = createThrough({ sequences: backKeySequences("C-\\"), now: () => 0, keyboard: 5, leader: backKeyId("C-\\") });
  assert.deepEqual(shown(ctrl.feed(utf8(`${E}[92;5u`))), ["back "], "C-\\ under the protocol");
  assert.deepEqual(shown(ctrl.feed(utf8("\x1c"))), ["input 1c"], "its legacy byte is no key a terminal sends under the protocol: the agent's");
});

test("in a terminal under the protocol a sequence split across reads waits for its end, a lone ESC goes on after the Esc timeout, and a paste is a paste", () => {
  let t = 0;
  const s = scanner({ t: () => t });
  assert.deepEqual(shown(s.feed(utf8(`a${E}[111`))), ["input 61"]);
  assert.deepEqual(shown(s.feed(utf8(";3u"))), ["back "], "the back key, completed by the next read");
  const lone = scanner({ t: () => t });
  assert.deepEqual(shown(lone.feed(utf8(E))), []);
  assert.equal(lone.timeoutAt(), t + ESC_TIMEOUT_MS);
  t += ESC_TIMEOUT_MS;
  assert.deepEqual(shown(lone.expire()), ["input 1b"]);
  const pasting = scanner({ t: () => t });
  assert.deepEqual(shown(pasting.feed(utf8(`${E}[200~one${E}[107;6u${E}[201~x`))), [`paste one${E}[107;6u`, "input 78"], "a chord inside a paste is pasted text");
});

test("while the answer is awaited the scanner takes it from what is typed, never the agent's, and reads what follows as it says", () => {
  const asking = createThrough({ sequences: backKeySequences("M-o"), now: () => 0, keyboard: "asking", leader: backKeyId("M-o"), chords: CHORD_MAP });
  assert.deepEqual(shown(asking.feed(utf8(`a${E}[?5u${E}[107;6u`))), ["input 61", "answer 5", "chord palette "]);
  const refused = createThrough({ sequences: backKeySequences("M-o"), now: () => 0, keyboard: "asking", leader: backKeyId("M-o"), chords: CHORD_MAP });
  assert.deepEqual(shown(refused.feed(utf8(`${E}[?0u${E}o`))), ["answer 0", "back "], "an answer without flag 1: the legacy back key");
  const legacy = createThrough({ sequences: backKeySequences("M-o"), now: () => 0 });
  assert.deepEqual(shown(legacy.feed(utf8(`${E}[?5u${E}[107;6u`))), [`input ${hex(utf8(`${E}[?5u${E}[107;6u`))}`], "never asked: every byte is the agent's, as before");
});

// ── The guard: popped on every way out.

function guarded({ keyboard = true } = {}) {
  const log = [];
  const stdin = fakeStdin({ log }), stdout = fakeStdout({ log }), proc = fakeProcess(), timers = fakeTimers();
  const guard = createGuard({ stdin, stdout, proc, keyboard, setTimer: timers.setTimer, clearTimer: timers.clearTimer, frame: () => "", onInput() {}, onResize() {}, onRedraw() {} });
  guard.start();
  const writes = () => log.filter(([what]) => what === "write").map(([, b]) => b);
  return { guard, proc, timers, log, writes };
}

test("the guard pushes and asks after the modes, keeps the protocol on an answer with flag 1, and pops it at once when the answer refuses it or none came", () => {
  const g = guarded();
  assert.deepEqual(g.writes(), [ENTER + PUSH + QUERY]);
  g.guard.keyboardAnswered(true);
  g.guard.keyboardAnswered(false);
  assert.deepEqual(g.writes(), [ENTER + PUSH + QUERY], "an answer once taken is not changed");
  const refused = guarded();
  refused.guard.keyboardAnswered(false);
  assert.deepEqual(refused.writes(), [ENTER + PUSH + QUERY, POP]);
  refused.guard.reassert();
  refused.guard.finish(0);
  assert.deepEqual(refused.writes().slice(2), [LEAVE + ENTER, LEAVE], "never pushed again, never popped twice");
  const never = guarded({ keyboard: false });
  never.guard.finish(0);
  assert.deepEqual(never.writes(), [ENTER, LEAVE], "a guard that does not ask writes as before");
});

const WAYS_OUT = [
  ["quit", (g) => g.guard.finish(0)],
  ["a crash", (g) => g.proc.emit("uncaughtException", new Error("boom"))],
  ["a rejection nobody caught", (g) => g.proc.emit("unhandledRejection", new Error("boom"))],
  ...Object.keys(SIGNAL_STATUS).map((signal) => [signal, (g) => g.proc.emit(signal, signal)]),
  ["the process's exit", (g) => g.proc.emit("exit", 0)],
];
for (const [way, take] of WAYS_OUT) {
  for (const answered of ["asking", "on"]) {
    test(`the protocol is popped before the modes on ${way}, ${answered === "on" ? "once the terminal answered" : "while the answer is awaited"}`, () => {
      const g = guarded();
      if (answered === "on") g.guard.keyboardAnswered(true);
      g.log.length = 0;
      take(g);
      assert.deepEqual(g.writes(), [POP + LEAVE]);
    });
  }
}

test("a suspend pops the protocol with the modes before the stop; the return pushes it again, and does not ask again once answered", () => {
  const g = guarded();
  g.guard.keyboardAnswered(true);
  g.log.length = 0;
  g.proc.emit("SIGTSTP", "SIGTSTP");
  assert.deepEqual(g.writes(), [POP + LEAVE]);
  assert.deepEqual(g.log.filter(([what]) => what === "kill" || what === "write").at(-1), ["write", POP + LEAVE]);
  g.log.length = 0;
  g.proc.emit("SIGCONT", "SIGCONT");
  assert.deepEqual(g.writes(), [ENTER + PUSH]);
  // Stopped and continued from outside, and Ctrl+L: the modes and the protocol set again, popped first.
  g.log.length = 0;
  g.proc.emit("SIGCONT", "SIGCONT");
  g.guard.reassert();
  assert.deepEqual(g.writes(), [POP + LEAVE + ENTER + PUSH, POP + LEAVE + ENTER + PUSH]);
  g.log.length = 0;
  g.guard.finish(0);
  assert.deepEqual(g.writes(), [POP + LEAVE]);
});

// ── The chords the TUI binds, and what each does.

test("the chords are the shared ones (CHORDS), each one the TUI handles; on macOS only those without ⌘; a key a user's tui.json binds stays the user's", () => {
  assert.deepEqual([...chordKeys(false)], CHORDS.map((entry) => [entry.other, entry.does]));
  assert.deepEqual([...chordKeys(true)], CHORDS.filter((entry) => !entry.mac.startsWith("cmd+")).map((entry) => [entry.mac, entry.does]));
  assert.deepEqual([...chordKeys(true)], [["ctrl+tab", "tab-next"], ["ctrl+shift+tab", "tab-previous"]]);
  for (const entry of CHORDS) assert.equal(leaderHandles(entry.does), true, `${entry.does} is one the TUI handles`);
  const rebound = ACTIONS.map((action) => (action.id === "help" ? { ...action, keys: ["ctrl+tab"] } : action));
  assert.equal(chordKeys(false, rebound).has("ctrl+tab"), false, "the user's key wins");
  assert.equal(initialState({ cli: {}, home: "/h", platform: "linux" }).chords.get("ctrl+shift+k"), "palette");
});

const leaderKeyOf = (does) => ({ palette: "k", spawn: "n", "tab-next": "right", "tab-previous": "left", "close-terminal": "w", filter: "/", "split-right": "|", "split-down": "-" })[does];

test("from the list a chord does what the leader then its key does, once the terminal answered, and nothing before", () => {
  const base = initialState({ deployment: "/d", cli: {}, home: "/h", platform: "linux", detachKey: "M-o" });
  const on = reduce(base, { keyboard: 5 }).state;
  for (const [key, does] of base.chords) {
    assert.deepEqual(reduce(base, { key, read: 1 }), { state: base, effect: null }, `${key} before the answer: nothing`);
    const chorded = reduce(on, { key, read: 2 }); // the read the leader's key comes in
    const led = reduce(reduce(on, { key: "alt+o", read: 1 }).state, { key: leaderKeyOf(does), read: 2 });
    assert.deepEqual({ ...chorded.state, leader: null }, { ...led.state, leader: null }, `${key} is the leader then ${leaderKeyOf(does)}`);
    assert.deepEqual(chorded.effect, led.effect, key);
  }
  const waiting = reduce(on, { key: "alt+o", read: 1 }).state;
  const cancelled = reduce(waiting, { key: "ctrl+shift+k", read: 2 }).state;
  assert.equal(cancelled.palette, null, "while the leader waits a chord is a key not in its table: it cancels the leader");
  assert.equal(cancelled.leader.waiting, false);
});

test("a chord typed in a terminal opens what the leader then its key opens from there, and nothing without the protocol", () => {
  const base = initialState({ deployment: "/d", cli: {}, home: "/h", platform: "linux", detachKey: "M-o" });
  const inTerminal = (state) => Object.freeze({ ...state, terminal: Object.freeze({ id: "a", name: "a", machine: null, routed: false, group: 0, focus: "terminal", zoom: false, status: "open" }), tabs: Object.freeze([Object.freeze({ id: "a", name: "a", machine: null, routed: false, status: "open", activity: false, group: 0 })]) });
  const on = inTerminal(reduce(base, { keyboard: 5 }).state);
  const opened = reduce(on, { chord: "palette", read: 3 }).state;
  assert.notEqual(opened.palette, null);
  assert.equal(reduce(inTerminal(base), { chord: "palette", read: 3 }).state.palette, null, "no answer, no chord");
});

// ── The help.

test("the help lists the chords only while the terminal confirms the protocol, with what a terminal may take first; the terminal's line says they are taken there too", () => {
  const without = rowStrings(helpRows(ACTIONS, false, 140, "M-o"), 140).join("\n");
  assert.doesNotMatch(without, /Chords|Ctrl\+Shift\+K|chords \(below\)/);
  const lines = rowStrings(helpRows(ACTIONS, false, 140, "M-o", [...chordKeys(false)]), 140).map((line) => line.trimEnd());
  const at = lines.findIndex((line) => line.trim() === "Chords");
  assert.ok(at > lines.findIndex((line) => line.trim() === "The leader"), "after the leader's table: the leader leads");
  const section = lines.slice(at, at + 16).join("\n");
  for (const [key, said] of [["Ctrl+Shift+K", "palette"], ["Ctrl+Shift+P", "spawn"], ["Ctrl+Tab", "next tab"], ["Ctrl+Shift+Tab", "previous tab"], ["Ctrl+Shift+W", "close terminal"], ["Ctrl+Shift+F", "filter"], ["Ctrl+Shift+E", "split right"], ["Ctrl+Shift+O", "split down"]]) {
    assert.match(section, new RegExp(`${key.replaceAll("+", "\\+")} +${said}\\n`), key);
  }
  assert.match(section, /Your terminal may take some of these first: foot takes Ctrl\+Shift\+C, V, R, N, O, U, Z, X and Q\./);
  assert.deepEqual(CHORD_RULES, ["Your terminal may take some of these first: foot takes Ctrl+Shift+C, V, R, N, O, U, Z, X and Q. The leader works in every terminal."]);
  assert.match(lines.join("\n"), new RegExp(CHORD_OPEN_RULE.slice(0, 40).replace(/[()]/g, "\\$&")));
});
