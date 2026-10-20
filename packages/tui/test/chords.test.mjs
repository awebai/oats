// The chords (docs/tui.md, "Chords"), module by module: the kitty keyboard protocol read
// (term/kitty.mjs), the key parser under it (term/keys.mjs), what is typed into an agent's terminal
// (term/through.mjs), the protocol pushed and popped on every way out (term/tty.mjs), the chords the
// TUI binds (actions.mjs), what one does (store.mjs) and the help. main.test.mjs has the run's.
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, CHORD_OWN, chordKeys, chordsRead, leaderHandles } from "../lib/actions.mjs";
import { CHORDS, chordFamilyFrom, chordFamilyNote, instanceId } from "../lib/client.mjs";
import { roster } from "../lib/model.mjs";
import { initialState, reduce } from "../lib/store.mjs";
import { ESC_TIMEOUT_MS, createKeyParser, keyId, legacyEvents } from "../lib/term/keys.mjs";
import { KEYBOARD_FLAGS, LEGACY_CHORDS, US_SHIFTED, confirmed, kittyId, kittyKey, legacyBytes } from "../lib/term/kitty.mjs";
import { BACK_KEY_SPLIT_MS, backKeyId, backKeySequences, createThrough } from "../lib/term/through.mjs";
import { ENTER, LEAVE, POP, PUSH, QUERY, SIGNAL_STATUS, createGuard } from "../lib/term/tty.mjs";
import { CHORD_OPEN_RULE, CHORD_RULES, chordFamilyLines, helpRows } from "../lib/views/help.mjs";
import { draw, fakeProcess, fakeStdin, fakeStdout, fakeTimers, instanceRow, observed, readTerminalOutput, rowStrings, stateOf } from "./helpers.mjs";

const E = "\x1b";
const bytes = (text) => Uint8Array.from(Buffer.from(text, "latin1"));
const utf8 = (text) => new TextEncoder().encode(text);
const hex = (b) => Buffer.from(b).toString("hex");
const ids = (events) => events.map((event) => (event.keyboard !== undefined ? `answer ${event.keyboard}` : keyId(event)));
/** The chords of Linux and Windows, the table's (chordKeys); a scanner of a terminal's focus under flags 1
 *  and 4 (or `options`) with them, the leader M-o; and its events as strings. */
const CHORD_MAP = chordKeys(false);
const scanner = (options = {}) => createThrough({ sequences: backKeySequences("M-o"), now: () => options.t?.() ?? 0, keyboard: 5, leader: backKeyId("M-o"), chords: CHORD_MAP, ...options });
const shown = (events) => events.map((event) => (event.input ? `input ${hex(event.input)}` : event.back ? `back ${hex(event.rest)}` : event.chord ? `chord ${event.chord} ${hex(event.rest)}` : event.paste !== undefined ? `paste ${event.paste}` : `answer ${event.keyboard}`));

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
  // AltGr where it is Ctrl+Alt (Windows): a character that is not ASCII is typed as it is, whatever its bits.
  ["AltGr+E on a Spanish layout, as text", "€", "€"], ["€ as a CSI u key with Ctrl and Alt", `${E}[8364;7u`, "€"], ["€ as a CSI u key", `${E}[8364u`, "€"],
  ["AltGr+2 and AltGr+3 on a Spanish layout, as text", "@#", "@#"],
  ["AltGr+A, E, O, Z on a Polish layout, as text", "ąęóż", "ąęóż"],
  ["ą ę ó ż as CSI u keys with Ctrl and Alt", `${E}[261;7u${E}[281;7u${E}[243;7u${E}[380;7u`, "ąęóż"],
  ["Ą as a CSI u key with Ctrl, Alt and Shift, its shifted key reported", `${E}[261:260;8u`, "Ą"],
  ["Up", `${E}[A`, `${E}[A`], ["Shift+Up", `${E}[1;2A`, `${E}[1;2A`], ["Ctrl+Up", `${E}[1;5A`, `${E}[1;5A`], ["Alt+Left", `${E}[1;3D`, `${E}[1;3D`],
  ["Home", `${E}[H`, `${E}[H`], ["End", `${E}[F`, `${E}[F`], ["Insert", `${E}[2~`, `${E}[2~`], ["Delete", `${E}[3~`, `${E}[3~`], ["Ctrl+Delete", `${E}[3;5~`, `${E}[3;5~`],
  ["PageUp", `${E}[5~`, `${E}[5~`], ["PageDown", `${E}[6~`, `${E}[6~`],
  ["F1", `${E}[P`, `${E}OP`], ["F2", `${E}[Q`, `${E}OQ`], ["F3", `${E}[13~`, `${E}OR`], ["F4", `${E}[S`, `${E}OS`],
  ["Ctrl+F1", `${E}[1;5P`, `${E}[1;5P`], ["Ctrl+F3", `${E}[13;5~`, `${E}[1;5R`], ["F5", `${E}[15~`, `${E}[15~`], ["Shift+F12", `${E}[24;2~`, `${E}[24;2~`],
  ["Keypad Enter", `${E}[57414u`, "\r"], ["Keypad Up", `${E}[57419u`, `${E}[A`], ["Ctrl+Keypad Up", `${E}[57419;5u`, `${E}[1;5A`],
  ["Alt+Keypad Delete", `${E}[57426;3u`, `${E}[3;3~`], ["Keypad Begin", `${E}[57427u`, `${E}[E`], ["Ctrl+Keypad 5", `${E}[57404;5u`, "5"], ["Keypad +", `${E}[57413u`, "+"],
  ["F13", `${E}[57376u`, ""], ["Play (a media key)", `${E}[57428u`, ""],
  // The protocol reports the lock keys, and Super, in the legacy shapes' modifier too: dropped.
  ["Up with Caps Lock", `${E}[1;65A`, `${E}[A`], ["Up with Num Lock", `${E}[1;129A`, `${E}[A`], ["Ctrl+Up with Caps Lock", `${E}[1;69A`, `${E}[1;5A`],
  ["Super+Up", `${E}[1;9A`, `${E}[A`], ["Home with Num Lock", `${E}[1;129H`, `${E}[H`], ["Delete with Num Lock", `${E}[3;129~`, `${E}[3~`],
  ["F5 with Caps Lock", `${E}[15;65~`, `${E}[15~`], ["Shift+F5 with Num Lock", `${E}[15;130~`, `${E}[15;2~`],
  ["F1 with Caps Lock", `${E}[1;65P`, `${E}OP`], ["Ctrl+F3 with Caps Lock", `${E}[13;69~`, `${E}[1;5R`],
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

/** The chords the TUI binds on Linux and Windows (packages/client/keymap.mjs CHORDS `other`), key id
 *  -> does, in the table's order: every row pinned. */
const LINUX_CHORDS = Object.freeze([
  ["ctrl+alt+k", "palette"], ["ctrl+alt+p", "spawn"], ["ctrl+alt+o", "workspaces"],
  ["alt+shift+up", "previous"], ["alt+shift+down", "next"], ["alt+shift+left", "tab-previous"], ["alt+shift+right", "tab-next"],
  ["ctrl+alt+1", "tab-1"], ["ctrl+alt+2", "tab-2"], ["ctrl+alt+3", "tab-3"], ["ctrl+alt+4", "tab-4"], ["ctrl+alt+5", "tab-5"],
  ["ctrl+alt+6", "tab-6"], ["ctrl+alt+7", "tab-7"], ["ctrl+alt+8", "tab-8"], ["ctrl+alt+9", "tab-9"],
  ["ctrl+alt+z", "zoom"], ["ctrl+alt+w", "close-terminal"], ["ctrl+alt+e", "split-right"], ["ctrl+alt+shift+e", "split-down"],
  ["ctrl+alt+a", "group-next"], ["ctrl+alt+f", "filter"],
]);
/** The chords of phase 2, gone from the table: none is bound. */
const PHASE_2 = Object.freeze(["ctrl+shift+k", "ctrl+shift+p", "ctrl+shift+w", "ctrl+shift+f", "ctrl+shift+e", "ctrl+shift+o", "ctrl+tab", "ctrl+shift+tab"]);
/** What a terminal sends for the chord `id` under flags 1 and 4: a Ctrl+Alt one as its `CSI u` key,
 *  with and without the subfields flag 4 may put on it (a letter with Shift reports its capital, the
 *  base-layout key is the key itself), and an Alt+Shift arrow as its legacy sequence. */
function sent(id) {
  if (Object.hasOwn(LEGACY_CHORDS, id)) return [`${E}[1;4${LEGACY_CHORDS[id]}`];
  const [, shift, ch] = /^ctrl\+alt\+(shift\+)?(.)$/.exec(id);
  const code = ch.charCodeAt(0), upper = ch.toUpperCase().charCodeAt(0);
  return shift ? [`${E}[${code}:${upper};8u`, `${E}[${code};8u`, `${E}[${code}:${upper}:${code};8u`] : [`${E}[${code};7u`, `${E}[${code}::${code};7u`, `${E}[${code}:;7u`];
}

test("under the protocol each Ctrl+Alt chord keeps its own key id, with or without flag 4's subfields; every other key held with Ctrl or Alt, the chords of phase 2 among them, reads as its legacy bytes", () => {
  const parser = createKeyParser({ now: () => 0, keyboard: 5, chords: CHORD_MAP });
  for (const [id] of LINUX_CHORDS) for (const typed of sent(id)) assert.deepEqual(ids(parser.feed(utf8(typed))), [id], `${id} as ${JSON.stringify(typed)}`);
  // Ctrl+Shift+K, Ctrl+Tab, Ctrl+Shift+Tab (phase 2's), Ctrl+Alt+0, Ctrl+Alt+Shift+1, Ctrl+Alt+L (no chord), Ctrl+Shift+C.
  assert.deepEqual(ids(parser.feed(utf8(`${E}[107;6u${E}[9;5u${E}[9;6u${E}[48;7u${E}[49:33;8u${E}[108;7u${E}[99;6u`))), ["ctrl+k", "tab", "shift+tab", "alt+0", "alt+!", "ctrl+alt+l", "ctrl+c"]);
  // kittyId is the chords' spelling, and null for every other key. A Ctrl+Shift letter has the
  // spelling of the Ctrl+Shift family's chords (`ctrl+shift+k`), and is still read as Ctrl+K above:
  // it is a chord only where `chords` binds it (keys.json's ctrl+shift, below).
  assert.deepEqual(["107;7", "101:69;8", "49;7", "57;7", "107;6", "9;5", "48;7", "49;8", "107;3", "8364;7", "261::97;7"].map((params) => kittyId(kittyKey(params))),
    ["ctrl+alt+k", "ctrl+alt+shift+e", "ctrl+alt+1", "ctrl+alt+9", "ctrl+shift+k", null, null, null, null, null, null]);
});

test("the Alt+Shift arrows read as their key ids with the protocol and without it: under it the lock keys are dropped from the modifier (a keypad arrow too), without it only Alt and Shift; with Ctrl too it is another key", () => {
  for (const keyboard of [null, "asking", 5]) {
    const p = createKeyParser({ now: () => 0, keyboard, chords: CHORD_MAP });
    assert.deepEqual(ids(p.feed(utf8(`${E}[1;4A${E}[1;4B${E}[1;4D${E}[1;4C${E}[1;8A`))), ["alt+shift+up", "alt+shift+down", "alt+shift+left", "alt+shift+right", "ctrl+alt+shift+up"], String(keyboard));
  }
  const on = createKeyParser({ now: () => 0, keyboard: 5, chords: CHORD_MAP });
  assert.deepEqual(ids(on.feed(utf8(`${E}[1;68A${E}[1;132B${E}[1;196D${E}[57419;4u`))), ["alt+shift+up", "alt+shift+down", "alt+shift+left", "alt+shift+up"], "Caps Lock, Num Lock, both; the keypad's Up");
  const off = createKeyParser({ now: () => 0, chords: CHORD_MAP });
  assert.deepEqual(ids(off.feed(utf8(`${E}[1;68A`))), [], "without the protocol a modifier above 16 is no key");
});

/** AltGr's characters on a Spanish (`€ @ #`) and a Polish layout (`ą ę ó ż`), as a terminal may send
 *  them under the protocol, each with the character it types: as text, or as a `CSI u` key of a
 *  character that is not ASCII, with or without the Ctrl and Alt bits, its base-layout key or not. */
const ALTGR = Object.freeze([
  ["€", "€"], ["@", "@"], ["#", "#"], ["ą", "ą"], ["ę", "ę"], ["ó", "ó"], ["ż", "ż"],
  [`${E}[8364;7u`, "€"], [`${E}[8364u`, "€"], [`${E}[8364::101;7u`, "€"],
  [`${E}[261;7u`, "ą"], [`${E}[281;7u`, "ę"], [`${E}[243;7u`, "ó"], [`${E}[380;7u`, "ż"], [`${E}[261::97;7u`, "ą"], [`${E}[380:379;8u`, "Ż"],
]);

test("AltGr never loses a character: a key that arrives as text is never a chord, in the list or in a terminal, with the protocol or without it", () => {
  for (const [typed, ch] of ALTGR) {
    for (const keyboard of [5, 1]) {
      assert.deepEqual(ids(createKeyParser({ now: () => 0, keyboard, chords: CHORD_MAP }).feed(utf8(typed))), [ch], `read: ${JSON.stringify(typed)} under flags ${keyboard}`);
      assert.deepEqual(shown(scanner({ keyboard }).feed(utf8(typed))), [`input ${hex(utf8(ch))}`], `typed: ${JSON.stringify(typed)} under flags ${keyboard}`);
    }
    if (typed.startsWith(E)) continue;
    assert.deepEqual(ids(createKeyParser({ now: () => 0, chords: CHORD_MAP }).feed(utf8(typed))), [ch], `read without the protocol: ${typed}`);
    assert.deepEqual(shown(scanner({ keyboard: null }).feed(utf8(typed))), [`input ${hex(utf8(ch))}`], `typed without the protocol: ${typed}`);
  }
});

// ── What is typed into an agent's terminal.

test("in a terminal under the protocol the back key is its one sequence, a chord is the TUI's, and what follows either in its read is handed on as the rest", () => {
  assert.deepEqual(shown(scanner().feed(utf8(`ab${E}[111;3uxy`))), ["input 6162", "back 7879"]);
  assert.deepEqual(shown(scanner().feed(utf8(`${E}[27uo`))), ["input 1b", "input 6f"], "Esc then o: the agent's, never the back key");
  assert.deepEqual(shown(scanner().feed(utf8(`q${E}[107;7uzz`))), ["input 71", "chord palette 7a7a"]);
  assert.deepEqual(shown(scanner().feed(utf8(`${E}[112;6u`))), ["input 10"], "a Ctrl+Shift key: no chord, its Ctrl byte");
  assert.deepEqual(shown(scanner().feed(utf8(`${E}[107;6u${E}[9;5u${E}[9;6u`))), ["input 0b", "input 09", `input ${hex(utf8(`${E}[Z`))}`], "the chords of phase 2 are no chords: their legacy bytes");
  const f12 = createThrough({ sequences: backKeySequences("F12"), now: () => 0, keyboard: 5, leader: backKeyId("F12") });
  assert.deepEqual(shown(f12.feed(utf8(`${E}[24~`))), ["back "], "a function key back key keeps its legacy form");
  const ctrl = createThrough({ sequences: backKeySequences("C-\\"), now: () => 0, keyboard: 5, leader: backKeyId("C-\\") });
  assert.deepEqual(shown(ctrl.feed(utf8(`${E}[92;5u`))), ["back "], "C-\\ under the protocol");
  assert.deepEqual(shown(ctrl.feed(utf8("\x1c"))), ["input 1c"], "its legacy byte is no key a terminal sends under the protocol: the agent's");
});

test("in a terminal under the protocol a sequence split across reads waits for its end however late it comes, a lone ESC too, and a paste is a paste", () => {
  let t = 0;
  const s = scanner({ t: () => t });
  assert.deepEqual(shown(s.feed(utf8(`a${E}[111`))), ["input 61"]);
  assert.equal(s.timeoutAt(), null, "no deadline under the protocol");
  t += 60_000;
  assert.deepEqual(shown(s.feed(utf8(";3u"))), ["back "], "the back key, completed by the next read");
  const lone = scanner({ t: () => t });
  assert.deepEqual(shown(lone.feed(utf8(E))), []);
  assert.equal(lone.timeoutAt(), null);
  t += 60_000;
  assert.deepEqual(shown(lone.expire()), []);
  assert.deepEqual(shown(lone.feed(utf8("x"))), ["input 1b78"], "an ESC and no sequence: as it came");
  const long = scanner({ t: () => t });
  assert.deepEqual(shown(long.feed(utf8(`${E}[${"1".repeat(70)}`))).length, 1, "a sequence longer than any key goes on as it came");
  const pasting = scanner({ t: () => t });
  assert.deepEqual(shown(pasting.feed(utf8(`${E}[200~one${E}[107;7u${E}[1;4A${E}[201~x`))), [`paste one${E}[107;7u${E}[1;4A`, "input 78"], "a chord inside a paste is pasted text");
});

test("while the answer is awaited the scanner takes it from what is typed, never the agent's, and reads what follows as it says", () => {
  const asking = createThrough({ sequences: backKeySequences("M-o"), now: () => 0, keyboard: "asking", leader: backKeyId("M-o"), chords: CHORD_MAP });
  assert.deepEqual(shown(asking.feed(utf8(`a${E}[?5u${E}[107;7u`))), ["input 61", "answer 5", "chord palette "]);
  const refused = createThrough({ sequences: backKeySequences("M-o"), now: () => 0, keyboard: "asking", leader: backKeyId("M-o"), chords: CHORD_MAP });
  assert.deepEqual(shown(refused.feed(utf8(`${E}[?0u${E}o`))), ["answer 0", "back "], "an answer without flag 1: the legacy back key");
  const legacy = createThrough({ sequences: backKeySequences("M-o"), now: () => 0 });
  assert.deepEqual(shown(legacy.feed(utf8(`${E}[?5u${E}[107;7u`))), [`input ${hex(utf8(`${E}[?5u${E}[107;7u`))}`], "never asked: every byte is the agent's, as before");
});

test("in a terminal under the protocol every chord of the table is the TUI's, with or without flag 4's subfields and with the lock keys: no byte of it reaches the agent, and what follows it in its read is the rest", () => {
  for (const [id, does] of LINUX_CHORDS) for (const typed of sent(id)) {
    assert.deepEqual(shown(scanner().feed(utf8(`a${typed}b`))), ["input 61", `chord ${does} 62`], `${id} as ${JSON.stringify(typed)}`);
  }
  for (const [typed, does] of [[`${E}[1;68A`, "previous"], [`${E}[1;132B`, "next"], [`${E}[1;196D`, "tab-previous"], [`${E}[1;68C`, "tab-next"], [`${E}[57419;4u`, "previous"]]) {
    assert.deepEqual(shown(scanner().feed(utf8(typed))), [`chord ${does} `], `${JSON.stringify(typed)}: the lock keys, or the keypad`);
  }
  for (const typed of [`${E}[1;8A`, `${E}[1;3A`, `${E}[1;2B`]) assert.deepEqual(shown(scanner().feed(utf8(typed))), [`input ${hex(utf8(typed))}`], `${JSON.stringify(typed)}: no chord, the agent's`);
  const taken = createThrough({ sequences: backKeySequences("M-o"), now: () => 0, keyboard: 5, leader: backKeyId("M-o"), chords: new Map() });
  assert.deepEqual(shown(taken.feed(utf8(`${E}[107;7u${E}[1;4A`))), [`input ${hex(utf8(`${E}\x0b`))}`, `input ${hex(utf8(`${E}[1;4A`))}`], "a chord the TUI does not bind: the agent's, as its legacy bytes");
});

/** Every event of a scanner fed `bytes` and then given the time to hand on what it held. */
function settled(make, bytes) {
  let t = 0;
  const s = make(() => t), events = s.feed(bytes);
  t = 60_000;
  return joined([...events, ...s.expire()]);
}

test("in a terminal without the protocol the Alt+Shift arrows are the TUI's, exactly CSI 1;4 and their letter, and what follows one in its read is the rest; a Ctrl+Alt chord is ESC and a Ctrl byte, the agent's, as is every other modifier", () => {
  for (const keyboard of [null, "asking"]) {
    const make = (now) => createThrough({ sequences: backKeySequences("M-o"), now, keyboard, leader: backKeyId("M-o"), chords: CHORD_MAP });
    for (const [id, does] of LINUX_CHORDS) {
      if (Object.hasOwn(LEGACY_CHORDS, id)) {
        assert.deepEqual(shown(make(() => 0).feed(utf8(`x${E}[1;4${LEGACY_CHORDS[id]}yz`))), ["input 78", `chord ${does} 797a`], `${id}, ${keyboard}`);
        continue;
      }
      const legacy = legacyBytes(kittyKey(sent(id)[0].slice(2, -1)), 5);
      assert.deepEqual(settled(make, legacy), [`input ${hex(legacy)}`], `${id} without the protocol: ${hex(legacy)}, the agent's (${keyboard})`);
    }
    for (const typed of [`${E}[1;68A`, `${E}[1;8A`, `${E}[1;3A`, `${E}[;4A`, `${E}[1;4E`]) assert.deepEqual(settled(make, utf8(typed)), [`input ${hex(utf8(typed))}`], `${JSON.stringify(typed)}: the agent's (${keyboard})`);
  }
  assert.deepEqual(hex(legacyBytes(kittyKey("107;7"), 5)), "1b0b", "Ctrl+Alt+K without the protocol is ESC, then Ctrl+K");
});

test("without the protocol an Alt+Shift arrow is one keypress, as the back key is: split across reads within BACK_KEY_SPLIT_MS it is the chord, further apart its bytes reach the agent as typed, and what may begin one waits no longer than that", () => {
  const seq = `${E}[1;4A`;
  for (const back of ["C-\\", "M-o"]) {
    for (let k = 1; k < seq.length; k++) {
      let t = 0;
      const make = () => createThrough({ sequences: backKeySequences(back), now: () => t, chords: CHORD_MAP });
      const soon = make();
      assert.deepEqual(shown(soon.feed(utf8(seq.slice(0, k)))), [], `${back}, split at ${k}: held`);
      assert.equal(soon.timeoutAt(), BACK_KEY_SPLIT_MS, `${back}, split at ${k}: for one keypress only`);
      t += BACK_KEY_SPLIT_MS - 1;
      assert.deepEqual(shown(soon.feed(utf8(seq.slice(k)))), ["chord previous "], `${back}, split at ${k}, within the window: the chord`);
      for (const expire of [true, false]) {
        t = 0;
        const late = make(), first = late.feed(utf8(seq.slice(0, k)));
        t = BACK_KEY_SPLIT_MS;
        const events = [...first, ...(expire ? late.expire() : []), ...late.feed(utf8(seq.slice(k)))];
        assert.deepEqual(joined(events), [`input ${hex(utf8(seq))}`], `${back}, split at ${k}, ${BACK_KEY_SPLIT_MS} ms apart${expire ? ", expired" : ""}: the agent's, as typed`);
      }
    }
  }
});

/** The events of `typed` read in one feed, and split at byte `k` with `delay` ms between the two
 *  reads, made comparable: consecutive inputs joined. */
function joined(events) {
  const out = [];
  for (const event of shown(events)) {
    const last = out.at(-1);
    if (event.startsWith("input ") && last?.startsWith("input ")) out[out.length - 1] = last + event.slice(6);
    else out.push(event);
  }
  return out;
}

test("under the protocol a key split across two reads at any byte, however far apart, reads and is typed as the key whole: no timing (Alt+O exact, a chord never reaches the agent)", () => {
  const keys = [`${E}[111;3u`, `${E}[107;7u`, `${E}[101:69;8u`, `${E}[49;7u`, `${E}[1;68A`, `${E}[27u`, `${E}[99;5u`, `${E}[1;65A`, `${E}[15;5~`];
  for (const key of keys) {
    const whole = joined(scanner().feed(utf8(key)));
    const parsed = ids(createKeyParser({ now: () => 0, keyboard: 5, chords: CHORD_MAP }).feed(utf8(key)));
    for (let k = 1; k < key.length; k++) {
      for (const delay of [0, 75, 60_000]) {
        let t = 0;
        const s = scanner({ t: () => t });
        const split = s.feed(utf8(key.slice(0, k)));
        t += delay;
        assert.deepEqual(joined([...split, ...s.expire(), ...s.feed(utf8(key.slice(k)))]), whole, `${JSON.stringify(key)} split at ${k}, ${delay} ms apart, typed`);
        const p = createKeyParser({ now: () => t, keyboard: 5, chords: CHORD_MAP });
        t = 0;
        const first = p.feed(utf8(key.slice(0, k)));
        t += delay;
        assert.deepEqual(ids([...first, ...p.expire(), ...p.feed(utf8(key.slice(k)))]), parsed, `${JSON.stringify(key)} split at ${k}, ${delay} ms apart, read`);
      }
    }
  }
});

test("while the answer is awaited in a terminal it is taken split at any byte, however late within the wait, never the agent's, and what follows reads as it says", () => {
  const typed = `a${E}[?5u${E}[107;7u`;
  const expected = ["input 61", "answer 5", "chord palette "];
  for (let k = 1; k < typed.length; k++) {
    for (const delay of [0, 5, 75, 1500]) {
      let t = 0;
      const s = createThrough({ sequences: backKeySequences("M-o"), now: () => t, keyboard: "asking", leader: backKeyId("M-o"), chords: CHORD_MAP, answerBy: 2000 });
      const first = s.feed(utf8(typed.slice(0, k)));
      t += delay;
      assert.deepEqual(joined([...first, ...s.feed(utf8(typed.slice(k)))]), expected, `split at ${k}, ${delay} ms apart`);
    }
  }
});

test("while the answer is awaited in the list it is read split at any byte, however late within the wait", () => {
  const typed = `${E}[?5u${E}[107;7u`;
  for (let k = 1; k < typed.length; k++) {
    for (const delay of [0, 75, 1500]) {
      let t = 0;
      const p = createKeyParser({ now: () => t, keyboard: "asking", chords: CHORD_MAP, answerBy: 2000 });
      const first = p.feed(utf8(typed.slice(0, k)));
      t += delay;
      assert.deepEqual(ids([...first, ...p.expire(), ...p.feed(utf8(typed.slice(k)))]), ["answer 5", "ctrl+alt+k"], `split at ${k}, ${delay} ms apart`);
    }
  }
});

test("what is kept for the answer and is not it reads and is typed as it was, and nothing stays kept once the wait is over", () => {
  const read = (parts, { gap = 500, giveUp = false } = {}) => {
    let t = 0;
    const p = createKeyParser({ now: () => t, keyboard: "asking", answerBy: 2000 });
    const events = [];
    for (const part of parts) { events.push(...p.feed(utf8(part)), ...p.expire()); t += gap; }
    if (giveUp) events.push(...p.giveUp());
    return { events: ids(events), p };
  };
  assert.deepEqual(read([E, "x"]).events, ["escape", "x"], "Esc, then x later: never Alt+X");
  assert.deepEqual(read([E, "x"], { gap: 10 }).events, ["alt+x"], "within the Esc timeout, as without the protocol");
  assert.deepEqual(read([E, "[a"]).events, ["escape", "[", "a"], "Esc, then [ and a later: as typed");
  assert.deepEqual(read([E, "[", "?"], { giveUp: true }).events, ["escape", "[", "?"], "given up: as typed");
  const lone = read([E], { gap: 0 });
  assert.equal(lone.p.timeoutAt(), 2000, "a lone ESC waits for the answer's deadline at most");
  let clock = 0;
  const at = createKeyParser({ now: () => clock, keyboard: "asking", answerBy: 2000 });
  assert.deepEqual(ids(at.feed(utf8(E))), []);
  clock = 1999;
  assert.deepEqual(ids(at.expire()), [], "kept while the wait lasts");
  clock = 2000;
  assert.deepEqual(ids(at.expire()), ["escape"], "the Esc key at the wait's end");
  assert.deepEqual(read([E], { gap: 0, giveUp: true }).events, [], "given up at once: the Esc waits only its own timeout now");
  const cut = createKeyParser({ now: () => 0, keyboard: "asking", answerBy: 2000 });
  assert.deepEqual(ids(cut.feed(utf8(`${E}[?5`))), []);
  assert.deepEqual(ids(cut.giveUp()), [], "an answer whose end never came is dropped at the wait's end");
  assert.deepEqual(ids(cut.feed(utf8("\x03q"))), ["ctrl+c", "q"], "and the keys after it read afresh");
  // In a terminal: a later read that does not go on with the answer comes after what was held, never the back key with it.
  let t = 0;
  const through = () => createThrough({ sequences: backKeySequences("M-o"), now: () => t, keyboard: "asking", leader: backKeyId("M-o"), chords: CHORD_MAP, answerBy: 2000 });
  let s = through();
  assert.deepEqual(shown(s.feed(utf8(E))), []);
  assert.equal(s.timeoutAt(), 2000);
  t = 500;
  assert.deepEqual(shown(s.feed(utf8("o"))), ["input 1b", "input 6f"], "Esc, then o later: the agent's, not the back key");
  t = 0; s = through(); s.feed(utf8(E)); t = 5;
  assert.deepEqual(shown(s.feed(utf8("o"))), ["back "], "within the one-keypress window: the back key, as without the protocol");
  t = 0; s = through(); s.feed(utf8(`${E}[`)); t = 500;
  assert.deepEqual(shown(s.feed(utf8("x"))), ["input 1b5b", "input 78"]);
  t = 0; s = through(); s.feed(utf8(`${E}[?5`));
  assert.deepEqual(shown(s.giveUp()), [`input ${hex(utf8(`${E}[?5`))}`], "given up: what was held is the agent's");
  assert.equal(s.timeoutAt(), null, "and nothing stays held");
  t = 0; s = through(); s.feed(utf8(E));
  t = 1999;
  assert.deepEqual(shown(s.expire()), [], "held while the wait lasts");
  t = 2000;
  assert.deepEqual(shown(s.expire()), ["input 1b"], "at the deadline a held ESC is handed on");
});

test("under the protocol the cursor report's shape keeps the legacy reader's rule, its modifier never made xterm's: above 16 it is no key", () => {
  const parser = createKeyParser({ now: () => 0, keyboard: 5 });
  assert.deepEqual(ids(parser.feed(utf8(`${E}[1;65R${E}[1;5R${E}[13;65~`))), ["ctrl+f3", "f3"]);
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

test("the chords are the shared ones (CHORDS), every row pinned, each one the TUI handles, and a row of an action the TUI does not have is skipped; none of phase 2's; on macOS none (every key there holds ⌘); a key a user's tui.json binds stays the user's", () => {
  assert.deepEqual([...chordKeys(false)], LINUX_CHORDS);
  assert.deepEqual([...chordKeys(false)], CHORDS.filter((entry) => leaderHandles(entry.does)).map((entry) => [entry.other, entry.does]), "the table's own, in its order");
  for (const key of PHASE_2) assert.equal(chordKeys(false).has(key), false, `${key} is no chord`);
  assert.deepEqual([...chordKeys(true)], [], "on macOS the TUI has no chords");
  assert.equal(CHORDS.every((entry) => entry.mac.startsWith("cmd+")), true);
  for (const [, does] of LINUX_CHORDS) assert.equal(leaderHandles(does), true, `${does} is one the TUI handles`);
  // A row the Desktop has and the TUI not yet (an edit of the instance, say) is no key of the TUI's.
  const more = [...CHORDS, { does: "edit-instance", mac: "cmd+alt+r", other: "ctrl+alt+r" }];
  assert.deepEqual([...chordKeys(false, ACTIONS, more)], LINUX_CHORDS, "an action the TUI does not have is skipped");
  assert.deepEqual(CHORD_OWN, ["tab-1", "tab-2", "tab-3", "tab-4", "tab-5", "tab-6", "tab-7", "tab-8", "tab-9"]);
  // Each is read as the protocol or the legacy sequence says: a Ctrl+Alt one by kittyId, an Alt+Shift arrow by its sequence.
  for (const [key] of LINUX_CHORDS) assert.equal(Object.hasOwn(LEGACY_CHORDS, key) || kittyId(kittyKey(sent(key)[0].slice(2, -1))) === key, true, key);
  const rebound = ACTIONS.map((action) => (action.id === "help" ? { ...action, keys: ["alt+shift+up"] } : action));
  assert.equal(chordKeys(false, rebound).has("alt+shift+up"), false, "the user's key wins");
  assert.equal(initialState({ cli: {}, home: "/h", platform: "linux" }).chords.get("ctrl+alt+k"), "palette");
  assert.equal(initialState({ cli: {}, home: "/h", platform: "darwin" }).chords.size, 0);
  // Without the protocol only the Alt+Shift arrows are read.
  assert.deepEqual([...chordsRead(chordKeys(false), false)], [["alt+shift+up", "previous"], ["alt+shift+down", "next"], ["alt+shift+left", "tab-previous"], ["alt+shift+right", "tab-next"]]);
  assert.equal(chordsRead(chordKeys(false), true).size, LINUX_CHORDS.length);
});

/** The geometry of the frame before each key: the store reads it for a move, never keeps it. */
const AT = Object.freeze({ page: 19, extent: 0, room: 19, cols: 38 });
let reads = 0;
/** A key in a read of its own; a one-character id types itself. */
const key = (state, id) => reduce(state, { key: id, ...(id.length === 1 ? { text: id } : {}), read: ++reads, ...AT });
/** The leader alone, then `id`, each in a read of its own: `{ back }` from the terminal's focus, else the leader's key. */
function leaderThen(state, id) {
  const lead = state.terminal?.focus === "terminal" && state.view === "instances" && state.palette === null
    ? reduce(state, { back: true, read: ++reads, ...AT })
    : reduce(state, { key: state.leaderKey, read: ++reads, ...AT });
  return key(lead.state, id);
}
/** A chord typed in a terminal (term/through.mjs's event), in a read of its own. */
const chorded = (state, does) => reduce(state, { chord: does, read: ++reads, ...AT, panel: null });
/** A chord (`chord`, a key id, or `{ does }` from a terminal) and the leader then `then`, each read as the
 *  second read of input, so that what keeps a read's number (the palette, a spawn) keeps the same. */
function both(state, chord, then) {
  const terminal = state.terminal?.focus === "terminal" && state.view === "instances";
  const viaChord = reduce(state, { ...(typeof chord === "string" ? { key: chord } : { chord: chord.does }), read: 2, ...AT, panel: null });
  const lead = reduce(state, { ...(terminal ? { back: true } : { key: state.leaderKey }), read: 1, ...AT });
  const viaLeader = reduce(lead.state, { key: then, ...(then.length === 1 ? { text: then } : {}), read: 2, ...AT, panel: null });
  return [outcome(viaChord), outcome(viaLeader)];
}
/** dev-a … dev-d, every one running here, on Linux (whose chords these are). */
const FOUR = () => stateOf(observed(["dev-a", "dev-b", "dev-c", "dev-d"].map((name) => instanceRow("dev", name))), { platform: "linux" });
const idOf = (state, name) => instanceId(roster(state).instances.find((row) => row.instance === name));
const on = (state, name) => Object.freeze({ ...state, selected: idOf(state, name) });
/** Each name opened with Enter in turn, its window shown: the last is the shown tab, with the focus in it. */
const opened = (state, ...names) => names.reduce((s, name) => { const step = key(on(s, name), "enter").state; return reduce(step, { shown: { id: idOf(s, name) }, ...AT }).state; }, state);
const kitty = (state) => reduce(state, { keyboard: 5 }).state;
/** The leader's key for a `does` of the chords that has one. */
const leaderKeyOf = (does) => ({ palette: "k", spawn: "n", workspaces: "o", previous: "up", next: "down", "tab-previous": "left", "tab-next": "right", zoom: "z", "close-terminal": "w", "split-right": "|", "split-down": "-", "group-next": "tab", filter: "/" })[does];
/** The state and the effect, the leader's wait left out (the chord has none). */
const outcome = (step) => ({ state: { ...step.state, leader: null }, effect: step.effect });

test("from the list a chord does what the leader then its key does: every one once the terminal confirms the protocol, the Alt+Shift arrows before it too, and the Ctrl+Alt ones nothing then", () => {
  const list = [on(FOUR(), "dev-b"), on(opened(FOUR(), "dev-a", "dev-b", "dev-c"), "dev-b")].map((s) => (s.terminal ? leaderThen(s, "escape").state : s));
  for (const base of list) {
    for (const [id, does] of LINUX_CHORDS) {
      if (!leaderKeyOf(does)) continue;
      const [chord, led] = both(kitty(base), id, leaderKeyOf(does));
      assert.deepEqual(chord, led, `${id} is the leader then ${leaderKeyOf(does)}`);
      if (Object.hasOwn(LEGACY_CHORDS, id)) {
        const [before, leader] = both(base, id, leaderKeyOf(does));
        assert.deepEqual(before, leader, `${id} before the answer: the leader then ${leaderKeyOf(does)}`);
      } else assert.deepEqual(outcome(key(base, id)), outcome({ state: base, effect: null }), `${id} before the answer: nothing`);
    }
  }
  assert.notEqual(key(list[0], "alt+shift+down").state.terminal, null, "Alt+Shift+Down opened the next instance's terminal, without the protocol");
  assert.deepEqual(key(list[0], "ctrl+alt+k"), { state: list[0], effect: null }, "ESC and Ctrl+K without the protocol: no key");
  assert.equal(key(kitty(list[0]), "ctrl+alt+o").state.view, "switcher", "Ctrl+Alt+O: the switcher");
  const waiting = reduce(kitty(list[0]), { key: list[0].leaderKey, read: ++reads, ...AT }).state;
  const cancelled = key(waiting, "ctrl+alt+k").state;
  assert.equal(cancelled.palette, null, "while the leader waits a chord is a key not in its table: it cancels the leader");
  assert.equal(cancelled.leader.waiting, false);
});

test("a chord typed in a terminal is the leader then its key from there, and types nothing into the agent: every one under the protocol, the Alt+Shift arrows without it, the Ctrl+Alt ones nothing then", () => {
  const base = opened(FOUR(), "dev-a", "dev-b", "dev-c");
  assert.equal(base.terminal.focus, "terminal");
  for (const [, does] of LINUX_CHORDS) {
    for (const state of [base, kitty(base)]) {
      const step = chorded(state, does);
      assert.equal(step.effect?.input, undefined, `${does}: no byte for the agent`);
      if (!leaderKeyOf(does)) continue;
      const read = state.keyboard !== null || ["previous", "next", "tab-previous", "tab-next"].includes(does);
      const [chord, led] = both(state, { does }, leaderKeyOf(does));
      assert.deepEqual(chord, read ? led : { state: { ...state, leader: null }, effect: null }, `${does}, ${state.keyboard === null ? "without" : "under"} the protocol`);
    }
  }
  assert.notEqual(chorded(kitty(base), "palette").state.palette, null, "Ctrl+Alt+K: the palette, from the terminal's focus");
  assert.equal(chorded(base, "palette").state.palette, null, "without the protocol no Ctrl+Alt chord comes");
  assert.equal(chorded(base, "tab-previous").state.terminal.name, "dev-b", "Alt+Shift+Left without the protocol: the tab before");
  // An action's own (the switcher, the filter) is run once, as the leader then its key runs it.
  assert.equal(chorded(kitty(base), "workspaces").state.view, "switcher", "Ctrl+Alt+O from a terminal: the switcher");
  assert.equal(chorded(kitty(base), "filter").state.filter.editing, true, "Ctrl+Alt+F from a terminal: the filter field");
});

test("tab-1 to tab-8 show the focused group's Nth tab and tab-9 its last, the focus staying where it was; no such tab, the shown one, no terminal or no workspace: nothing", () => {
  const three = kitty(opened(FOUR(), "dev-a", "dev-b", "dev-c"));
  assert.deepEqual(three.tabs.map((tab) => tab.name), ["dev-a", "dev-b", "dev-c"]);
  assert.equal(three.terminal.name, "dev-c", "the last opened is shown");
  const first = chorded(three, "tab-1").state;
  for (const [from, does, name] of [[three, "tab-1", "dev-a"], [three, "tab-2", "dev-b"], [first, "tab-9", "dev-c"], [first, "tab-3", "dev-c"]]) {
    const step = chorded(from, does);
    assert.equal(step.state.terminal.name, name, `${does} from ${from.terminal.name}`);
    assert.deepEqual(step.effect, { show: idOf(three, name) }, `${does}: the panel shows it`);
    assert.equal(step.state.terminal.focus, "terminal", `${does}: the focus stays in the terminal`);
  }
  for (const does of ["tab-3", "tab-9"]) assert.deepEqual(chorded(three, does), { state: three, effect: null }, `${does}: the shown one, nothing`);
  for (const does of ["tab-4", "tab-5", "tab-6", "tab-7", "tab-8"]) assert.deepEqual(chorded(three, does), { state: three, effect: null }, `${does}: no such tab, nothing`);
  // From the list's focus: the tab is shown, the list keeps the focus.
  const listed = leaderThen(three, "escape").state;
  const fromList = key(listed, "ctrl+alt+1");
  assert.equal(fromList.state.terminal.name, "dev-a");
  assert.equal(fromList.state.terminal.focus, "list");
  assert.equal(fromList.state.focus, "list");
  // Zoomed: it stays zoomed.
  const zoomed = chorded(three, "zoom").state;
  assert.equal(zoomed.terminal.zoom, true);
  assert.equal(chorded(zoomed, "tab-1").state.terminal.zoom, true, "the zoom kept");
  // No terminal open, no workspace open: nothing.
  const none = kitty(FOUR());
  for (const does of CHORD_OWN) assert.deepEqual(key(none, `ctrl+alt+${does.slice(4)}`), { state: none, effect: null }, `${does} with no terminal`);
  const nowhere = initialState({ cli: {}, home: "/h", platform: "linux" });
  assert.deepEqual(key(kitty(nowhere), "ctrl+alt+1"), { state: kitty(nowhere), effect: null }, "with no workspace");
  // A split: never into the other group. The new group, empty and focused, has no Nth tab.
  const lead = reduce(three, { back: true, read: ++reads, ...AT }).state;
  const split = reduce(lead, { key: "|", text: "|", read: ++reads, ...AT, panel: { cols: 89, rows: 40 } }).state;
  assert.notEqual(split.split, null);
  for (const does of CHORD_OWN) assert.equal(key(split, `ctrl+alt+${does.slice(4)}`).effect, null, `${does} in an empty group`);
});

// ── The help and the cheat sheet.

/** The help's lines, trimmed at the end, for an area 140 wide, the leader M-o. */
const helpLines = (chords, lead, ascii = false) => rowStrings(helpRows(ACTIONS, ascii, 140, "M-o", chords, lead), 140).map((line) => line.trimEnd());
/** A section's table rows as the help draws them: from the indent, the left column as wide as its widest entry, three cells, the meaning. */
const tableRows = (pairs) => { const widest = Math.max(...pairs.map(([left]) => left.length)); return pairs.map(([left, said]) => `  ${left.padEnd(widest)}   ${said}`); };
/** The chords' rows under the protocol, as the help says them: each with the leader and its key. */
const LED_ROWS = Object.freeze([
  ["Ctrl+Alt+K", "palette, or Alt+O then k"],
  ["Ctrl+Alt+P", "spawn, or Alt+O then n"],
  ["Ctrl+Alt+O", "workspaces, or Alt+O then o"],
  ["Alt+Shift+Up/Down", "previous and next instance, or Alt+O then Up and Down"],
  ["Alt+Shift+Left/Right", "previous and next tab, or Alt+O then Left and Right"],
  ["Ctrl+Alt+1 … Ctrl+Alt+9", "the focused group's first to eighth tab, 9 its last"],
  ["Ctrl+Alt+Z", "zoom, or Alt+O then z"],
  ["Ctrl+Alt+W", "close terminal, or Alt+O then w"],
  ["Ctrl+Alt+E", "split right, or Alt+O then |"],
  ["Ctrl+Alt+Shift+E", "split down, or Alt+O then -"],
  ["Ctrl+Alt+A", "next group, or Alt+O then Tab"],
  ["Ctrl+Alt+F", "filter, or Alt+O then /"],
]);
const inOrder = (lines, wanted) => { let at = 0; for (const line of wanted) { const found = lines.indexOf(line, at); assert.notEqual(found, -1, line); at = found + 1; } };

test("under the protocol the help leads with the chords, first of all, the leader's section after: a row per action, its chord and then the leader and its key, a pair of arrows and the nine tab-N on one row each", () => {
  const lines = helpLines([...chordKeys(false)], true);
  const chords = lines.indexOf("  Chords"), leader = lines.indexOf("  The leader");
  assert.ok(chords >= 0 && chords < leader, "the chords before the leader");
  assert.ok(chords < lines.indexOf("  Keys"), "before the table of keys: they lead");
  const table = tableRows(LED_ROWS);
  assert.equal(lines.indexOf(table[0]) > chords && lines.indexOf(table.at(-1)) < leader, true);
  assert.deepEqual(lines.slice(lines.indexOf(table[0]), lines.indexOf(table[0]) + table.length), table, "every row, in the table's order");
  assert.match(lines.join("\n"), new RegExp(CHORD_OPEN_RULE.slice(0, 40).replace(/[()]/g, "\\$&")), "the terminal's line says they are taken there too");
  // ASCII: no Unicode ellipsis.
  const ascii = helpLines([...chordKeys(false)], true, true);
  assert.equal(ascii.some((line) => line.startsWith("  Ctrl+Alt+1 ... Ctrl+Alt+9 ")), true);
  assert.equal(ascii.some((line) => line.includes("…")), false);
});

test("without the protocol the leader leads, and a short chords' section after it names only the Alt+Shift arrows; with no chord (macOS) there is none", () => {
  const lines = helpLines([...chordsRead(chordKeys(false), false)], false);
  const chords = lines.indexOf("  Chords"), leader = lines.indexOf("  The leader");
  assert.ok(leader > 0 && chords > leader, "the leader first");
  inOrder(lines.slice(chords), tableRows(LED_ROWS.slice(3, 5)));
  assert.equal(lines.slice(chords).some((line) => line.startsWith("  Ctrl+Alt")), false, "no Ctrl+Alt chord listed");
  for (const none of [[], null]) assert.equal(helpLines(none, false).some((line) => /Chords|chords \(below\)/.test(line)), false, `${JSON.stringify(none)}: no chords' section`);
  // A key tui.json took: the other of its pair stands alone, still from the table.
  const rebound = ACTIONS.map((action) => (action.id === "help" ? { ...action, keys: ["alt+shift+up"] } : action));
  const alone = rowStrings(helpRows(rebound, false, 140, "M-o", [...chordsRead(chordKeys(false, rebound), true)], true), 140).map((line) => line.trimEnd());
  assert.equal(alone.some((line) => /^ {2}Alt\+Shift\+Down +next instance, or Alt\+O then Down$/.test(line)), true);
  assert.equal(alone.some((line) => line.includes("Alt+Shift+Up/")), false);
});

test("what a terminal may take first is said in sentences: Windows Terminal's tabs and panes, the terminals without the protocol, AltGr, the leader, and where the table of terminals is", () => {
  assert.deepEqual(CHORD_RULES, [
    "Your terminal may take some first: Windows Terminal takes Ctrl+Alt+1 to Ctrl+Alt+9 for its own tabs, and the Alt+Shift arrows while its panes are split.",
    "Terminals without the kitty keyboard protocol (GNOME Terminal and the other VTE terminals, Konsole before 26.08, WezTerm unless enable_kitty_keyboard is set) send only the Alt+Shift arrows.",
    "On a keyboard layout where AltGr is Ctrl+Alt (Windows), a Ctrl+Alt key that types a character types it.",
    "The leader works in every terminal.",
    "docs/tui.md, \"Chords\", has the table of terminals.",
  ]);
  const text = helpLines([...chordKeys(false)], true).join(" ").replace(/ +/g, " ");
  for (const sentence of CHORD_RULES) assert.equal(text.includes(sentence), true, sentence);
});

/** The cheat sheet's rows of a drawing: the sidebar's under its last rule, down to the last that holds something. */
function sheetOf(d) {
  const rows = d.cells.map((line) => line.slice(0, d.cols).map((cell) => cell.text).join(""));
  const last = rows.findLastIndex((row) => /^[─-]+$/.test(row));
  const lines = rows.slice(last + 1).map((row) => row.trimEnd());
  while (lines.length && lines.at(-1) === "") lines.pop();
  return lines;
}
/** Cheat-sheet rows as the spec draws them 30 cells wide (beside a terminal): one hint a row, its key
 *  from the margin; the chords' words (`c`) in a column after their widest key, as far left as leaves
 *  the longest whole; the leader's (`l`) three cells after theirs. */
function sheetRows(hints) {
  const col = (block) => {
    const mine = hints.filter(([, , b]) => b === block), widest = Math.max(...mine.map(([key]) => key.length));
    return Math.min(1 + widest + 3, 29 - (block === "c" ? Math.max(6, ...mine.map(([, word]) => word.length)) : 6));
  };
  return hints.map(([key, word, block]) => ` ${key.padEnd(col(block) - 2)} ${word}`);
}

test("under the protocol a terminal's cheat sheet leads with the chords, the leader's hints after them; the leader is given up last; without the protocol the leader's lead and the Alt+Shift arrows follow; in the list the sheet is as before", () => {
  const sz = { cols: 120, rows: 40 };
  const terminal = opened(FOUR(), "dev-a", "dev-b", "dev-c");
  const chords = [["Ctrl+Alt+K", "palette", "c"], ["Alt+Shift+Up/Down", "agent", "c"], ["Alt+Shift+Left/Right", "tab", "c"], ["Ctrl+Alt+W", "close", "c"], ["Ctrl+Alt+Z", "zoom", "c"]];
  const leader = [["Ctrl+\\", "commands", "l"], ["Ctrl+\\ Esc", "the list", "l"], ["Ctrl+\\ Ctrl+\\", "types Ctrl+\\", "l"]];
  const full = [...chords, ...leader];
  assert.deepEqual(sheetOf(draw(kitty(terminal), sz)), sheetRows(full));
  assert.equal(sheetRows(full)[2], " Alt+Shift+Left/Right tab", "the widest chord whole, its word whole");
  const arrows = chords.filter(([key]) => key.startsWith("Alt+Shift+"));
  assert.deepEqual(sheetOf(draw(terminal, sz)), sheetRows([...leader, ...arrows]), "without the protocol: the leader's three, then the Alt+Shift arrows");
  for (let rows = 15; rows < 40; rows++) {
    const got = sheetOf(draw(terminal, { cols: 120, rows })), kept = [...leader, ...arrows];
    while (kept.length > got.length) kept.splice(kept.findLastIndex(([, word]) => word !== "commands"), 1);
    assert.deepEqual(got, sheetRows(kept), `without the protocol, ${rows} rows: the arrows are given up first`);
  }
  // One tab: no tab hint.
  assert.deepEqual(sheetOf(draw(kitty(opened(FOUR(), "dev-a")), sz)), sheetRows(full.filter(([, word]) => word !== "tab")));
  // In the list the sheet is the list's, the protocol or not.
  const listed = leaderThen(terminal, "escape").state;
  assert.deepEqual(sheetOf(draw(kitty(listed), sz)), sheetOf(draw(listed, sz)));
  // Short of rows: given up from the end, the leader last.
  for (let rows = 15; rows < 40; rows++) {
    const got = sheetOf(draw(kitty(terminal), { cols: 120, rows }));
    const kept = [...full];
    while (kept.length > got.length) kept.splice(kept.findLastIndex(([, word]) => word !== "commands"), 1);
    assert.deepEqual(got, sheetRows(kept), `${rows} rows`);
    assert.equal(got.some((line) => /^ Ctrl\+\\ +commands$/.test(line)), true, `${rows} rows: the leader stands`);
  }
});

// ── The Ctrl+Shift family (docs/tui.md, "Switch to Ctrl+Shift"): keys.json's `chords`, read at the start.

/** keys.json's answers (lib/config.mjs loadKeys, through the shared reader): the option chosen, and a file not taken. */
const SHIFT_READ = chordFamilyFrom('{ "chords": "ctrl+shift" }');
const UNKNOWN_READ = chordFamilyFrom('{ "chords": "ctrl+meta" }');
/** The chords the TUI binds on Linux and Windows under the option (CHORDS `shift`), every row pinned:
 *  seven move to Ctrl+Shift, the Alt+Shift arrows, Ctrl+Alt+1–9, group-next and filter keep their key. */
const SHIFT_CHORDS = Object.freeze([
  ["ctrl+shift+k", "palette"], ["ctrl+shift+p", "spawn"], ["ctrl+shift+s", "workspaces"],
  ["alt+shift+up", "previous"], ["alt+shift+down", "next"], ["alt+shift+left", "tab-previous"], ["alt+shift+right", "tab-next"],
  ["ctrl+alt+1", "tab-1"], ["ctrl+alt+2", "tab-2"], ["ctrl+alt+3", "tab-3"], ["ctrl+alt+4", "tab-4"], ["ctrl+alt+5", "tab-5"],
  ["ctrl+alt+6", "tab-6"], ["ctrl+alt+7", "tab-7"], ["ctrl+alt+8", "tab-8"], ["ctrl+alt+9", "tab-9"],
  ["ctrl+shift+m", "zoom"], ["ctrl+shift+w", "close-terminal"], ["ctrl+shift+e", "split-right"], ["ctrl+shift+d", "split-down"],
  ["ctrl+alt+a", "group-next"], ["ctrl+alt+f", "filter"],
]);
const SHIFT_MAP = chordKeys(false, ACTIONS, CHORDS, "ctrl+shift");
/** What a terminal sends for the Ctrl+Shift chord `id` under flags 1 and 4: its `CSI u` key with the
 *  Shift and Ctrl bits (modifier 6), with flag 4's capital and base-layout key, and without them. */
function sentShift(id) {
  const code = /^ctrl\+shift\+([a-z])$/.exec(id)[1].charCodeAt(0), upper = code - 0x20;
  return [`${E}[${code};6u`, `${E}[${code}:${upper};6u`, `${E}[${code}:${upper}:${code};6u`, `${E}[${code};70u`];
}

test("each family's chords, every row pinned: Ctrl+Alt by default (no file, or one not taken), the seven Ctrl+Shift rows under the option, the others' key kept; macOS has none in either", () => {
  assert.deepEqual([...chordKeys(false, ACTIONS, CHORDS, "ctrl+alt")], LINUX_CHORDS);
  assert.deepEqual([...chordKeys(false, ACTIONS, CHORDS)], LINUX_CHORDS, "the default family is Ctrl+Alt");
  assert.deepEqual([...SHIFT_MAP], SHIFT_CHORDS);
  assert.deepEqual([...SHIFT_MAP], CHORDS.filter((entry) => leaderHandles(entry.does)).map((entry) => [entry.shift, entry.does]), "the table's `shift` column, in its order");
  const moved = SHIFT_CHORDS.filter(([key]) => key.startsWith("ctrl+shift+")).map(([, does]) => does);
  assert.deepEqual(moved, ["palette", "spawn", "workspaces", "zoom", "close-terminal", "split-right", "split-down"]);
  for (const family of ["ctrl+alt", "ctrl+shift"]) assert.deepEqual([...chordKeys(true, ACTIONS, CHORDS, family)], [], `macOS, ${family}: no chords, as before`);
  // The store binds the family keys.json chose; with no file, or a file not taken, Ctrl+Alt.
  const state = (keysRead, platform = "linux") => initialState({ cli: {}, home: "/h", platform, ...(keysRead ? { keysRead } : {}) });
  assert.deepEqual([...state(null).chords], LINUX_CHORDS, "no keysRead: the default");
  assert.deepEqual([...state(chordFamilyFrom(null)).chords], LINUX_CHORDS, "no file");
  assert.deepEqual([...state(UNKNOWN_READ).chords], LINUX_CHORDS, "an unknown value");
  assert.deepEqual([...state(SHIFT_READ).chords], SHIFT_CHORDS, "the option");
  assert.equal(state(SHIFT_READ).keysRead, SHIFT_READ, "the store keeps what keys.json said, for the help");
  assert.equal(state(SHIFT_READ, "darwin").chords.size, 0, "macOS: none, whatever the file says");
});

test("a key a user's tui.json binds keeps its key under the option too, row by row: the chord that has it drops, the other rows stay", () => {
  // tui.json takes ctrl+alt+a and ctrl+alt+f (keys of the kept rows) for the help and the palette.
  const rebound = ACTIONS.map((action) => (action.id === "help" ? { ...action, keys: ["ctrl+alt+a"] } : action.id === "palette" ? { ...action, keys: ["ctrl+k", "ctrl+alt+f"] } : action));
  const map = chordKeys(false, rebound, CHORDS, "ctrl+shift");
  assert.deepEqual([...map], SHIFT_CHORDS.filter(([key]) => key !== "ctrl+alt+a" && key !== "ctrl+alt+f"));
  assert.deepEqual(rebound.find((action) => action.id === "palette").keys, ["ctrl+k", "ctrl+alt+f"], "the action keeps its keys");
  // A table whose action holds ctrl+shift+k (no tui.json can write that id: term/keys.mjs isKeyId refuses it, as no
  // key parser without the binding reads it): the palette's chord drops, the action keeps it, the other six stay.
  const holding = ACTIONS.map((action) => (action.id === "help" ? { ...action, keys: ["ctrl+shift+k"] } : action));
  const held = chordKeys(false, holding, CHORDS, "ctrl+shift");
  assert.equal(held.has("ctrl+shift+k"), false, "the palette's chord drops");
  assert.deepEqual(holding.find((action) => action.id === "help").keys, ["ctrl+shift+k"], "the action keeps its key");
  assert.deepEqual([...held], SHIFT_CHORDS.filter(([key]) => key !== "ctrl+shift+k"), "every other row stays");
  assert.equal(chordKeys(false, holding, CHORDS, "ctrl+alt").get("ctrl+alt+k"), "palette", "under the default family that key is no chord's: nothing drops");
});

test("without the protocol the option reads no chord but the Alt+Shift arrows: a Ctrl+Shift letter is Ctrl and its letter's byte, the agent's", () => {
  assert.deepEqual([...chordsRead(SHIFT_MAP, false)], [["alt+shift+up", "previous"], ["alt+shift+down", "next"], ["alt+shift+left", "tab-previous"], ["alt+shift+right", "tab-next"]]);
  assert.equal(chordsRead(SHIFT_MAP, true).size, SHIFT_CHORDS.length);
  const base = stateOf(observed([instanceRow("dev", "dev-a")]), { platform: "linux", keysRead: SHIFT_READ });
  assert.deepEqual(outcome(key(base, "ctrl+shift+k")), outcome({ state: base, effect: null }), "before the protocol is confirmed: nothing");
  assert.notEqual(key(kitty(base), "ctrl+shift+k").state.palette, null, "under it: the palette");
  assert.equal(key(kitty(base), "ctrl+shift+s").state.view, "switcher", "Ctrl+Shift+S: the switcher");
  assert.equal(key(kitty(base), "ctrl+alt+k").state.palette, null, "Ctrl+Alt+K is no chord under the option");
});

test("condition 4, D and M: under the option and the protocol CSI 100;6u is split down and CSI 109;6u zoom, in the list and in a terminal; their legacy bytes 0x04 (EOF) and 0x0d (Enter) are never a chord, the protocol confirmed or not", () => {
  for (const [letter, does, legacy, legacyId] of [["d", "split-down", "\x04", "ctrl+d"], ["m", "zoom", "\r", "enter"]]) {
    const id = `ctrl+shift+${letter}`;
    for (const typed of sentShift(id)) {
      assert.deepEqual(ids(createKeyParser({ now: () => 0, keyboard: 5, chords: SHIFT_MAP }).feed(utf8(typed))), [id], `${id} as ${JSON.stringify(typed)}, in the list`);
      assert.deepEqual(shown(scanner({ chords: SHIFT_MAP }).feed(utf8(`a${typed}b`))), ["input 61", `chord ${does} 62`], `${id} as ${JSON.stringify(typed)}, in a terminal`);
    }
    for (const keyboard of [5, 1, null, "asking"]) {
      assert.deepEqual(ids(createKeyParser({ now: () => 0, keyboard, chords: SHIFT_MAP }).feed(utf8(legacy))), [legacyId], `${JSON.stringify(legacy)} under ${keyboard}: the list's ${legacyId}`);
      assert.deepEqual(shown(scanner({ keyboard, chords: SHIFT_MAP }).feed(utf8(legacy))), [`input ${hex(utf8(legacy))}`], `${JSON.stringify(legacy)} under ${keyboard}: the agent's`);
    }
    // Under the default family the event is Ctrl and the letter, as before: Ctrl+D (EOF) and Enter for the agent.
    assert.deepEqual(shown(scanner().feed(utf8(`${E}[${letter.charCodeAt(0)};6u`))), [`input ${hex(utf8(legacy))}`], `${id} under Ctrl+Alt: the agent's ${legacyId}`);
    assert.deepEqual(ids(createKeyParser({ now: () => 0, keyboard: 5, chords: CHORD_MAP }).feed(utf8(`${E}[${letter.charCodeAt(0)};6u`))), [legacyId], `${id} under Ctrl+Alt, in the list: ${legacyId}`);
  }
  // The store: the chord's `does` from a terminal is the leader then its key, as every chord.
  assert.equal(SHIFT_MAP.get("ctrl+shift+d"), "split-down");
  assert.equal(SHIFT_MAP.get("ctrl+shift+m"), "zoom");
});

test("under the option every Ctrl+Shift chord is read from its protocol event, with or without flag 4's subfields and the lock keys; Ctrl+Alt+Shift with a letter (Alt held) is none of them, and an unbound Ctrl+Shift letter is Ctrl and the letter", () => {
  const parser = createKeyParser({ now: () => 0, keyboard: 5, chords: SHIFT_MAP });
  for (const [id, does] of SHIFT_CHORDS.filter(([key]) => key.startsWith("ctrl+shift+"))) for (const typed of sentShift(id)) {
    assert.deepEqual(ids(parser.feed(utf8(typed))), [id], `${id} as ${JSON.stringify(typed)}`);
    assert.deepEqual(shown(scanner({ chords: SHIFT_MAP }).feed(utf8(typed))), [`chord ${does} `], `${id} as ${JSON.stringify(typed)}, in a terminal`);
  }
  // Alt held: Ctrl+Alt+Shift+K, D, M. No Ctrl+Shift chord, their legacy bytes: ESC and the Ctrl byte.
  for (const letter of ["k", "d", "m"]) {
    const code = letter.charCodeAt(0), typed = `${E}[${code}:${code - 0x20};8u`;
    assert.equal(kittyId(kittyKey(typed.slice(2, -1))), `ctrl+alt+shift+${letter}`);
    const read = ids(createKeyParser({ now: () => 0, keyboard: 5, chords: SHIFT_MAP }).feed(utf8(typed)));
    assert.equal(read.includes(`ctrl+shift+${letter}`), false, `Ctrl+Alt+Shift+${letter.toUpperCase()} is no Ctrl+Shift chord`);
    assert.deepEqual(shown(scanner({ chords: SHIFT_MAP }).feed(utf8(typed))), [`input ${hex(legacyBytes(kittyKey(typed.slice(2, -1)), 5))}`], `Ctrl+Alt+Shift+${letter.toUpperCase()}: the agent's`);
  }
  // A Ctrl+Shift letter the option does not bind (C, the copy key; L): Ctrl and the letter, as before.
  assert.deepEqual(ids(parser.feed(utf8(`${E}[99;6u${E}[108;6u`))), ["ctrl+c", "ctrl+l"]);
  assert.deepEqual(shown(scanner({ chords: SHIFT_MAP }).feed(utf8(`${E}[108;6u`))), ["input 0c"]);
  // kittyId: Ctrl and Shift without Alt and a letter only; a digit with Shift, Shift alone, Ctrl alone are not.
  assert.deepEqual(["100;6", "109:77;6", "49:33;6", "107;2", "107;5", "100:68;8"].map((params) => kittyId(kittyKey(params))),
    ["ctrl+shift+d", "ctrl+shift+m", null, null, null, "ctrl+alt+shift+d"]);
});

test("the help says which family is bound, at the top of the chords' section: Ctrl+Alt with how to switch; Ctrl+Shift from keys.json; the option without the protocol, use the leader; and why a file was not taken", () => {
  const ALT_LINE = 'Shortcuts: Ctrl+Alt. For Ctrl+Shift (foot, Alacritty), set "chords": "ctrl+shift" in keys.json and restart.';
  const SHIFT_LINE = "Shortcuts: Ctrl+Shift, from keys.json.";
  const NO_PROTOCOL = "Shortcuts: Ctrl+Shift, from keys.json, but this terminal does not confirm the kitty keyboard protocol: use the leader.";
  const keysOf = (read) => ({ family: read.family, label: read.family === "ctrl+shift" ? "Ctrl+Shift" : "Ctrl+Alt", note: chordFamilyNote(read) });
  assert.deepEqual(chordFamilyLines(keysOf(chordFamilyFrom(null)), true), [ALT_LINE], "no file: nothing more to say");
  assert.deepEqual(chordFamilyLines(keysOf(chordFamilyFrom(null)), false), [ALT_LINE]);
  assert.deepEqual(chordFamilyLines(keysOf(SHIFT_READ), true), [SHIFT_LINE]);
  assert.deepEqual(chordFamilyLines(keysOf(SHIFT_READ), false), [NO_PROTOCOL]);
  assert.deepEqual(chordFamilyLines(keysOf(UNKNOWN_READ), true), [ALT_LINE, "keys.json: unknown chords value, using Ctrl+Alt"]);
  assert.deepEqual(chordFamilyLines(keysOf(chordFamilyFrom(null, { code: "EACCES" })), false), [ALT_LINE, "keys.json cannot be read, using Ctrl+Alt"]);
  assert.deepEqual(chordFamilyLines(keysOf(chordFamilyFrom("{")), true), [ALT_LINE, "keys.json is not JSON, using Ctrl+Alt"]);
  assert.deepEqual(chordFamilyLines(null, true), [], "no family given: none");
  // In the help, the sentences lead the chords' section, under its heading, before its own first sentence.
  const said = (lines) => lines.join(" ").replace(/ +/g, " ");
  const section = (lines) => lines.slice(lines.indexOf("  Chords"), lines.indexOf("  Chords") + 6);
  const under = rowStrings(helpRows(ACTIONS, false, 140, "M-o", [...SHIFT_MAP], true, null, keysOf(SHIFT_READ)), 140).map((line) => line.trimEnd());
  assert.deepEqual(section(under).slice(0, 4), ["  Chords", "", `  ${SHIFT_LINE}`, "  One keypress each, from every focus, a terminal's too: none reaches the agent."]);
  assert.equal(under.some((line) => line.startsWith("  Ctrl+Shift+K ") && line.endsWith("palette, or Alt+O then k")), true, "the chords named in their family");
  assert.equal(under.some((line) => line.startsWith("  Ctrl+Shift+D ") && line.endsWith("split down, or Alt+O then -")), true);
  assert.equal(under.some((line) => line.startsWith("  Ctrl+Alt+A ") && line.endsWith("next group, or Alt+O then Tab")), true, "a kept row keeps its key");
  const without = rowStrings(helpRows(ACTIONS, false, 140, "M-o", [...chordsRead(SHIFT_MAP, false)], false, null, keysOf(SHIFT_READ)), 140).map((line) => line.trimEnd());
  assert.equal(said(section(without)).includes(NO_PROTOCOL), true, "without the protocol: the option cannot work here");
  assert.equal(without.slice(without.indexOf("  Chords")).some((line) => line.startsWith("  Ctrl+Shift+")), false, "and no Ctrl+Shift chord is listed");
  const fell = rowStrings(helpRows(ACTIONS, false, 140, "M-o", [...CHORD_MAP], true, null, keysOf(UNKNOWN_READ)), 140).map((line) => line.trimEnd());
  assert.deepEqual(section(fell).slice(2, 5), [`  ${ALT_LINE}`, "  keys.json: unknown chords value, using Ctrl+Alt", "  One keypress each, from every focus, a terminal's too: none reaches the agent."]);
  // The run's state reaches the help: the help view drawn from a state under the option, the protocol confirmed.
  const state = kitty(stateOf(observed([instanceRow("dev", "dev-a")]), { platform: "linux", keysRead: SHIFT_READ }));
  const shownHelp = draw(key(state, "?").state, { cols: 140, rows: 60 }).lines.join("\n");
  assert.equal(shownHelp.includes(SHIFT_LINE), true, "the help drawn from the run's state");
  assert.equal(draw(key(kitty(stateOf(observed([instanceRow("dev", "dev-a")]), { platform: "linux", keysRead: UNKNOWN_READ })), "?").state, { cols: 140, rows: 60 }).lines.join("\n").includes("keys.json: unknown chords value, using Ctrl+Alt"), true);
  // macOS: no chords, no section, no line.
  const mac = stateOf(observed([instanceRow("dev", "dev-a")]), { platform: "darwin", keysRead: SHIFT_READ });
  assert.equal(draw(key(kitty(mac), "?").state, { cols: 140, rows: 60 }).lines.join("\n").includes("Shortcuts:"), false);
});

test("under the option a terminal's cheat sheet names the Ctrl+Shift chords it shows: the palette, close and zoom", () => {
  const sz = { cols: 120, rows: 40 };
  const terminal = opened(stateOf(observed(["dev-a", "dev-b", "dev-c", "dev-d"].map((name) => instanceRow("dev", name))), { platform: "linux", keysRead: SHIFT_READ }), "dev-a", "dev-b", "dev-c");
  const chords = [["Ctrl+Shift+K", "palette", "c"], ["Alt+Shift+Up/Down", "agent", "c"], ["Alt+Shift+Left/Right", "tab", "c"], ["Ctrl+Shift+W", "close", "c"], ["Ctrl+Shift+M", "zoom", "c"]];
  const leader = [["Ctrl+\\", "commands", "l"], ["Ctrl+\\ Esc", "the list", "l"], ["Ctrl+\\ Ctrl+\\", "types Ctrl+\\", "l"]];
  assert.deepEqual(sheetOf(draw(kitty(terminal), sz)), sheetRows([...chords, ...leader]));
  const arrows = chords.filter(([keys]) => keys.startsWith("Alt+Shift+"));
  assert.deepEqual(sheetOf(draw(terminal, sz)), sheetRows([...leader, ...arrows]), "without the protocol: the leader's three, then the Alt+Shift arrows, as under Ctrl+Alt");
});
