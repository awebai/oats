import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ESC_TIMEOUT_MS, PASTE_LIMIT, PASTE_PAUSE_MS, createKeyParser, keyId } from "../lib/term/keys.mjs";

const ESC = "\x1b", CSI = "\x1b[", SS3 = "\x1bO", ST = "\x1b\\", BEL = "\x07";
const PASTE_START = "\x1b[200~", PASTE_END = "\x1b[201~";

/** Bytes from parts: a string is its UTF-8, a number is one raw byte. */
function bytes(...parts) {
  return Buffer.concat(parts.map((part) => (typeof part === "number" ? Buffer.from([part]) : Buffer.from(part, "utf8"))));
}

/** The named-key event of a key id: key("ctrl+alt+up"). The inverse of keyId. */
function key(id) {
  const mods = id.split("+"), name = mods.pop();
  return { name, ctrl: mods.includes("ctrl"), alt: mods.includes("alt"), shift: mods.includes("shift") };
}
const text = (value) => ({ text: value });
const alt = (value) => ({ text: value, alt: true });
const paste = (value) => ({ paste: value });
const TRUNCATED = { paste: "", truncated: true };

/** A parser on a fake clock. `feed` takes parts; `raw` feeds one byte array as it is. */
function harness(start = 0) {
  let t = start;
  const parser = createKeyParser({ now: () => t });
  return {
    feed: (...parts) => parser.feed(bytes(...parts)),
    raw: (chunk) => parser.feed(chunk),
    expire: () => parser.expire(),
    timeoutAt: () => parser.timeoutAt(),
    advance(ms) { t += ms; },
  };
}

// --- The table: bytes -> events ------------------------------------------------

/** xterm modifier parameter -> key id prefix (m - 1: 1 shift, 2 alt, 4 ctrl). */
const MODS = { 2: "shift+", 3: "alt+", 4: "alt+shift+", 5: "ctrl+", 6: "ctrl+shift+", 7: "ctrl+alt+", 8: "ctrl+alt+shift+" };
const LETTERS = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", P: "f1", Q: "f2", R: "f3", S: "f4" };
const TILDES = {
  1: "home", 7: "home", 4: "end", 8: "end", 2: "insert", 3: "delete", 5: "pageup", 6: "pagedown",
  11: "f1", 12: "f2", 13: "f3", 14: "f4", 15: "f5", 17: "f6", 18: "f7", 19: "f8", 20: "f9", 21: "f10", 23: "f11", 24: "f12",
};
const FAMILY = "\u{1f469}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}"; // one emoji, seven code points joined by ZWJ

/** Rows of [what it proves, input parts, expected events]. */
const TABLE = [
  // Printable text.
  ["an ASCII letter is text", ["q"], [text("q")]],
  ["a question mark is text", ["?"], [text("?")]],
  ["a space is text", [" "], [text(" ")]],
  ["a tilde is text", ["~"], [text("~")]],
  ["the letters that introduce sequences are text when no ESC precedes them", ["[O]PX^_M"], [..."[O]PX^_M"].map(text)],
  ["a run of ASCII is one event per character", ["hello"], [..."hello"].map(text)],
  ["a 2-byte character is text", ["\u00e9"], [text("\u00e9")]],
  ["a 3-byte character is text", ["\u20ac"], [text("\u20ac")]],
  ["a 4-byte character is text", ["\u{1d11e}"], [text("\u{1d11e}")]],
  ["the last code point U+10FFFF is text", [0xf4, 0x8f, 0xbf, 0xbf], [text("\u{10ffff}")]],
  ["a no-break space U+00A0, just above the C1 controls, is text", [0xc2, 0xa0], [text("\u00a0")]],
  ["CJK is one event per character", ["\u65e5\u672c\u8a9e"], [text("\u65e5"), text("\u672c"), text("\u8a9e")]],
  ["an emoji ZWJ sequence is one grapheme", [FAMILY], [text(FAMILY)]],
  ["a base letter and its combining mark are one grapheme", ["e\u0301"], [text("e\u0301")]],
  ["a flag of two regional indicators is one grapheme", ["\u{1f1ea}\u{1f1f8}"], [text("\u{1f1ea}\u{1f1f8}")]],
  ["an emoji with a skin tone between letters is its own grapheme", ["a\u{1f44d}\u{1f3fd}b"], [text("a"), text("\u{1f44d}\u{1f3fd}"), text("b")]],
  ["a key between two code points cuts the grapheme run", ["e", 0x09, "\u0301"], [text("e"), key("tab"), text("\u0301")]],
  ["a dropped sequence between two code points cuts the grapheme run", ["e", CSI, "12;40R", "\u0301"], [text("e"), text("\u0301")]],
  ["a dropped control byte between two code points cuts the grapheme run", ["e", 0x00, "\u0301"], [text("e"), text("\u0301")]],
  ["an invalid byte between two code points cuts the grapheme run", ["e", 0xff, "\u0301"], [text("e"), text("\u0301")]],
  ["an incomplete character between two code points cuts the grapheme run", ["e", 0xc3, "\u0301"], [text("e"), text("\u0301")]],
  ["a dropped C1 control between two code points cuts the grapheme run", ["e", 0xc2, 0x85, "\u0301"], [text("e"), text("\u0301")]],

  // Invalid UTF-8 and C1 controls are dropped.
  ["a byte that is never UTF-8 is dropped", [0xff], []],
  ["a stray continuation byte is dropped", [0x80], []],
  ["an overlong 2-byte form is dropped", [0xc0, 0x80], []],
  ["an overlong 2-byte form of an ASCII letter is dropped", [0xc1, 0xa1], []],
  ["an overlong 3-byte form is dropped", [0xe0, 0x80, 0x80], []],
  ["an overlong 3-byte form of a 2-byte character is dropped", [0xe0, 0x9f, 0xbf], []],
  ["an overlong 4-byte form of a 3-byte character is dropped", [0xf0, 0x8f, 0xbf, 0xbf], []],
  ["the first 3-byte character U+0800 is text", [0xe0, 0xa0, 0x80], [text("\u0800")]],
  ["the last character before the surrogates, U+D7FF, is text", [0xed, 0x9f, 0xbf], [text("\ud7ff")]],
  ["the first character after the surrogates, U+E000, is text", [0xee, 0x80, 0x80], [text("\ue000")]],
  ["the first 4-byte character U+10000 is text", [0xf0, 0x90, 0x80, 0x80], [text("\u{10000}")]],
  ["an encoded surrogate is dropped", [0xed, 0xa0, 0x80], []],
  ["a code point above U+10FFFF is dropped", [0xf4, 0x90, 0x80, 0x80], []],
  ["a lead byte above 0xf4 is dropped with its continuation bytes", [0xf5, 0x80, 0x80, 0x80], []],
  ["an incomplete character is dropped and the byte that ended it is still read", [0xc3, "a"], [text("a")]],
  ["an incomplete character ended by a key is dropped and the key is read", [0xe2, 0x82, 0x0d], [key("enter")]],
  ["an incomplete character ended by a sequence is dropped and the sequence is read", [0xf0, 0x9f, CSI, "A"], [key("up")]],
  ["invalid bytes between text leave the text", ["a", 0xff, 0xfe, "b"], [text("a"), text("b")]],
  ["the C1 control U+0080 is dropped", [0xc2, 0x80], []],
  ["the C1 control U+009B (an 8-bit CSI) is dropped and what follows is text", [0xc2, 0x9b, "A"], [text("A")]],
  ["the C1 control U+009F is dropped", [0xc2, 0x9f], []],

  // C0 keys.
  ["CR is Enter", [0x0d], [key("enter")]],
  ["LF is Enter", [0x0a], [key("enter")]],
  ["CR LF is two Enters", [0x0d, 0x0a], [key("enter"), key("enter")]],
  ["HT is Tab", [0x09], [key("tab")]],
  ["DEL is Backspace", [0x7f], [key("backspace")]],
  ["BS is Backspace", [0x08], [key("backspace")]],
  ["NUL is dropped", [0x00], []],
  ["0x1c is dropped", [0x1c], []],
  ["0x1d is dropped", [0x1d], []],
  ["0x1e is dropped", [0x1e], []],
  ["0x1f is dropped", [0x1f], []],
  ["a dropped control byte between text leaves the text", ["a", 0x00, "b"], [text("a"), text("b")]],

  // CSI and SS3 details beyond the generated rows below.
  ["an explicit modifier 1 is no modifier", [CSI, "1;1A"], [key("up")]],
  ["an empty modifier is no modifier", [CSI, "1;A"], [key("up")]],
  ["the meta bit of the modifier is ignored", [CSI, "1;9A"], [key("up")]],
  ["the meta bit is ignored beside the others", [CSI, "1;16A"], [key("ctrl+alt+shift+up")]],
  ["a modifier of 0 is no key report: dropped", [CSI, "1;0A"], []],
  ["a modifier above 16 is no key report: dropped", [CSI, "1;17A"], []],
  ["CSI Z is Shift+Tab", [CSI, "Z"], [key("shift+tab")]],
  ["CSI 1;5Z is Ctrl+Shift+Tab", [CSI, "1;5Z"], [key("ctrl+shift+tab")]],
  ["SS3 with the full parameter form reads the modifier", [SS3, "1;5P"], [key("ctrl+f1")]],
  ["an SS3 with an unknown final is consumed and dropped", [SS3, "x", "q"], [text("q")]],
  ["an SS3 shifts one character: a space is consumed with it and what follows is text", [SS3, " ", "A"], [text("A")]],
  ["a control byte inside an SS3 is dropped and the SS3 goes on", [SS3, 0x00, "A"], [key("up")]],
  ["an ESC inside an SS3 starts a new sequence", [SS3, "5", CSI, "B"], [key("down")]],
  ["the Linux console F1", [CSI, "[A"], [key("f1")]],
  ["the Linux console F2", [CSI, "[B"], [key("f2")]],
  ["the Linux console F3", [CSI, "[C"], [key("f3")]],
  ["the Linux console F4", [CSI, "[D"], [key("f4")]],
  ["the Linux console F5", [CSI, "[E"], [key("f5")]],
  ["the Linux console form with an unknown letter is consumed and dropped", [CSI, "[F", "q"], [text("q")]],
  ["a `[` final after parameters is an unknown CSI, not the Linux console form", [CSI, "1[", "A"], [text("A")]],

  // Alt: ESC then a key.
  ["ESC then a letter is Alt+letter", [ESC, "q"], [alt("q")]],
  ["ESC then a space is Alt+space", [ESC, " "], [alt(" ")]],
  ["ESC then a multi-byte character is Alt+that character", [ESC, "\u00e9"], [alt("\u00e9")]],
  ["ESC then a CJK character is Alt+that character", [ESC, "\u65e5"], [alt("\u65e5")]],
  ["Alt applies to one character only", [ESC, "ab"], [alt("a"), text("b")]],
  ["Alt applies to one multi-byte character only", [ESC, "\u00e9\u00e9"], [alt("\u00e9"), text("\u00e9")]],
  ["Alt before an invalid byte is lost with it", [ESC, 0xff, "\u00e9"], [text("\u00e9")]],
  ["Alt before an incomplete character is lost with it", [ESC, 0xc3, "a\u00e9"], [text("a"), text("\u00e9")]],
  ["Alt before a C1 control is lost with it", [ESC, 0xc2, 0x9b, "\u00e9"], [text("\u00e9")]],
  ["ESC CR is Alt+Enter", [ESC, 0x0d], [key("alt+enter")]],
  ["ESC LF is Alt+Enter", [ESC, 0x0a], [key("alt+enter")]],
  ["ESC HT is Alt+Tab", [ESC, 0x09], [key("alt+tab")]],
  ["ESC DEL is Alt+Backspace", [ESC, 0x7f], [key("alt+backspace")]],
  ["ESC BS is Alt+Backspace", [ESC, 0x08], [key("alt+backspace")]],
  ["ESC then a Ctrl letter is Ctrl+Alt+letter", [ESC, 0x03], [key("ctrl+alt+c")]],
  ["ESC then a dropped control byte is dropped whole", [ESC, 0x00, "q"], [text("q")]],
  ["ESC then an invalid byte is dropped whole", [ESC, 0xff, "q"], [text("q")]],
  ["ESC then an incomplete character loses the Alt with the character", [ESC, 0xc3, "a"], [text("a")]],
  ["ESC ESC is the Esc key, then the second ESC starts over as a sequence", [ESC, CSI, "A"], [key("escape"), key("up")]],
  ["ESC ESC then a letter is the Esc key and Alt+letter", [ESC, ESC, "q"], [key("escape"), alt("q")]],

  // Anything else that starts with ESC is consumed whole.
  ["a cursor position report arriving unasked is dropped", [CSI, "12;40R"], []],
  ["a focus-in event is dropped", [CSI, "I"], []],
  ["a focus-out event is dropped", [CSI, "O"], []],
  ["an SGR mouse press is dropped", [CSI, "<0;1;1M"], []],
  ["an SGR mouse release is dropped", [CSI, "<0;1;1m"], []],
  ["an SGR mouse report ends at its final: it takes no bytes after it", [CSI, "<0;1;1M", "abc"], [text("a"), text("b"), text("c")]],
  ["a urxvt mouse report ends at its final: it takes no bytes after it", [CSI, "32;10;10M", "abc"], [text("a"), text("b"), text("c")]],
  ["a primary device attributes reply is dropped", [CSI, "?1;2c"], []],
  ["a secondary device attributes reply is dropped", [CSI, ">0;276;0c"], []],
  ["a mode report with an intermediate byte is dropped", [CSI, "?2026;2$y"], []],
  ["a kitty keyboard report is dropped", [CSI, "97;5u"], []],
  ["a modifyOtherKeys report with three parameters is dropped", [CSI, "27;5;13~"], []],
  ["an unknown function key number is dropped", [CSI, "25~"], []],
  ["a letter final with a third parameter is no key: dropped", [CSI, "1;5;2A"], []],
  ["a tilde final with a third parameter is no key: dropped", [CSI, "3;5;2~"], []],
  ["a paste end marker outside a paste is dropped", [PASTE_END], []],
  ["a letter final whose first parameter is not 1 is dropped", [CSI, "5A"], []],
  ["a key final behind a private marker is dropped", [CSI, "?1;5A"], []],
  ["a key final behind an intermediate byte is dropped", [CSI, "1 A"], []],
  ["a CSI longer than 64 bytes is dropped even with a key final", [CSI, "0".repeat(70), "1;5A", "q"], [text("q")]],
  ["a CSI of 100000 parameter bytes is dropped", [CSI, "1;".repeat(50000), "R", "q"], [text("q")]],
  ["a control byte inside a CSI is dropped and the CSI goes on", [CSI, "1", 0x00, ";5", 0x0d, "A"], [key("ctrl+up")]],
  ["a DEL inside a CSI is dropped and the CSI goes on", [CSI, "1;", 0x7f, "2B"], [key("shift+down")]],
  ["an ESC inside a CSI starts a new sequence", [CSI, "1;", CSI, "B"], [key("down")]],
  ["a byte >= 0x80 aborts the CSI and is dropped; what follows is read fresh", [CSI, "1", 0xc3, 0xa9, "A"], [text("A")]],
  ["an unknown CSI between two keys leaves the two keys", ["a", CSI, "12;40R", "b"], [text("a"), text("b")]],
  ["an unknown CSI between two named keys leaves the two keys", [CSI, "A", CSI, "?1;2c", CSI, "B"], [key("up"), key("down")]],
  ["an X10 mouse report is consumed with its 3 bytes", [CSI, "M", " !!"], []],
  ["the 3 bytes of an X10 mouse report never become text", [CSI, "M", "abc", "q"], [text("q")]],
  ["the 3 bytes of an X10 mouse report may be any byte", [CSI, "M", 0x20, 0xff, 0x80, "q"], [text("q")]],
  ["an ESC inside an X10 mouse report, which never holds one, starts a new sequence", [CSI, "M", "a", CSI, "B"], [key("down")]],
  ["an OSC ended by BEL is dropped", [ESC, "]0;title", BEL], []],
  ["an OSC ended by ST is dropped", [ESC, "]11;rgb:0000/0000/0000", ST], []],
  ["an OSC holding key bytes and UTF-8 is dropped whole", [ESC, "]52;c;q", 0x03, 0x0d, 0x7f, "t\u00edtulo \u65e5", BEL, "q"], [text("q")]],
  ["a DCS is dropped", [ESC, "P1$r0m", ST], []],
  ["a BEL does not end a DCS", [ESC, "Pa", BEL, "q", ST, "x"], [text("x")]],
  ["an SOS is dropped", [ESC, "Xanything", ST, "q"], [text("q")]],
  ["a PM is dropped", [ESC, "^anything", ST, "q"], [text("q")]],
  ["an APC is dropped", [ESC, "_Gi=1;OK", ST, "q"], [text("q")]],
  ["a doubled ESC before the backslash still ends a string", [ESC, "Pabc", ESC, ST, "q"], [text("q")]],
  ["an ESC that is not ST abandons a string and starts a new sequence", [ESC, "]0;x", CSI, "A"], [key("up")]],

  // Bracketed paste.
  ["a bracketed paste is one paste event", [PASTE_START, "hello", PASTE_END], [paste("hello")]],
  ["keys around a paste stay keys", ["a", PASTE_START, "b", PASTE_END, "c"], [text("a"), paste("b"), text("c")]],
  ["an empty paste is an empty paste event", [PASTE_START, PASTE_END], [paste("")]],
  ["q, Ctrl+C, Ctrl+Z, Enter, DEL and escape sequences inside a paste are content, never keys",
    [PASTE_START, "q", 0x03, 0x1a, "\r\n\t", CSI, "A", ESC, "]0;t", BEL, 0x7f, SS3, "P", PASTE_END],
    [paste("q\x03\x1a\r\n\t\x1b[A\x1b]0;t\x07\x7f\x1bOP")]],
  ["a paste keeps its UTF-8", [PASTE_START, `d\u00eda \u65e5\u672c ${FAMILY}`, PASTE_END], [paste(`d\u00eda \u65e5\u672c ${FAMILY}`)]],
  ["a paste is decoded leniently: invalid bytes become U+FFFD", [PASTE_START, "a", 0xff, "b", 0xc3, PASTE_END], [paste("a\ufffdb\ufffd")]],
  ["an overlong form inside a paste is not decoded: U+FFFD for each byte", [PASTE_START, 0xc1, 0xa1, PASTE_END], [paste("\ufffd\ufffd")]],
  ["the beginning of an end marker inside a paste is content", [PASTE_START, "a", CSI, "20b", ESC, CSI, "201", PASTE_END], [paste("a\x1b[20b\x1b\x1b[201")]],
  ["a start marker inside a paste is content", [PASTE_START, "a", PASTE_START, "b", PASTE_END], [paste("a\x1b[200~b")]],
  ["a fake end marker inside the pasted text ends the paste: the rest is keys",
    [PASTE_START, "one", PASTE_END, "two", PASTE_END], [paste("one"), text("t"), text("w"), text("o")]],
  ["two pastes in a row are two paste events", [PASTE_START, "a", PASTE_END, PASTE_START, "b", PASTE_END], [paste("a"), paste("b")]],
];

// Ctrl+letter: every byte 0x01..0x1a that is not Backspace, Tab or Enter.
for (let b = 0x01; b <= 0x1a; b++) {
  if ([0x08, 0x09, 0x0a, 0x0d].includes(b)) continue;
  const letter = String.fromCharCode(b + 0x60);
  TABLE.push([`byte 0x${b.toString(16).padStart(2, "0")} is Ctrl+${letter}`, [b], [key(`ctrl+${letter}`)]]);
}
// Arrows, Home, End and F1..F4 by letter final: CSI and SS3, bare and with each modifier.
for (const [final, name] of Object.entries(LETTERS)) {
  TABLE.push([`CSI ${final} is ${name}`, [CSI, final], [key(name)]]);
  TABLE.push([`SS3 ${final} is ${name}`, [SS3, final], [key(name)]]);
  for (const [m, mods] of Object.entries(MODS)) {
    TABLE.push([`CSI 1;${m}${final} is ${mods}${name}`, [CSI, `1;${m}${final}`], [key(mods + name)]]);
    TABLE.push([`SS3 ${m}${final} is ${mods}${name}`, [SS3, `${m}${final}`], [key(mods + name)]]);
  }
}
// Home, End, Insert, Delete, PageUp, PageDown and F1..F12 by number: bare and with each modifier.
for (const [n, name] of Object.entries(TILDES)) {
  TABLE.push([`CSI ${n}~ is ${name}`, [CSI, `${n}~`], [key(name)]]);
  for (const [m, mods] of Object.entries(MODS)) TABLE.push([`CSI ${n};${m}~ is ${mods}${name}`, [CSI, `${n};${m}~`], [key(mods + name)]]);
}

/** Graphemes are cut within one feed and text is never held back, so a grapheme of
 * several code points whose code points arrive in separate feeds comes out as
 * several text events. For a row that expects such a grapheme, a split feed is
 * compared on the concatenated text: adjacent plain text events are joined on both
 * sides. Every other row must give exactly the same events however it is split. */
const hasLongGrapheme = (events) => events.some((event) => typeof event.text === "string" && [...event.text].length > 1);
const isPlainText = (event) => typeof event.text === "string" && event.alt === undefined;
function joinText(events) {
  const joined = [];
  for (const event of events) {
    const last = joined.at(-1);
    if (last && isPlainText(last) && isPlainText(event)) joined[joined.length - 1] = text(last.text + event.text);
    else joined.push(event);
  }
  return joined;
}
function assertSameWhenSplit(actual, expected, message) {
  if (hasLongGrapheme(expected)) assert.deepEqual(joinText(actual), joinText(expected), `${message} (concatenated text)`);
  else assert.deepEqual(actual, expected, message);
}

test("the table has a row for every key in every form", () => {
  assert.ok(TABLE.length > 400, `${TABLE.length} rows`);
  assert.equal(new Set(TABLE.map(([label]) => label)).size, TABLE.length, "every row says something different");
  const names = new Set(TABLE.flatMap(([, , events]) => events).filter((event) => event.name).map((event) => event.name));
  const all = ["enter", "tab", "backspace", "escape", "up", "down", "left", "right", "home", "end", "pageup", "pagedown", "insert", "delete",
    ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`), ..."abcdefgklnopqrstuvwxyz"]; // Ctrl+letter: all but h, i, j, m, which are Backspace, Tab and Enter
  assert.deepEqual([...names].sort(), all.sort());
});

test("every table row, fed whole, gives exactly its events", () => {
  for (const [label, parts, expected] of TABLE) assert.deepEqual(harness().feed(...parts), expected, label);
});

test("every table row, fed one byte at a time with the clock standing still, gives the same events", () => {
  for (const [label, parts, expected] of TABLE) {
    const parser = harness(), actual = [];
    for (const b of bytes(...parts)) actual.push(...parser.feed(b));
    assertSameWhenSplit(actual, expected, label);
  }
});

test("every table row, split in two feeds at every byte position, gives the same events", () => {
  for (const [label, parts, expected] of TABLE) {
    const input = bytes(...parts);
    for (let cut = 1; cut < Math.min(input.length, 200); cut++) {
      const parser = harness();
      const actual = [...parser.raw(input.subarray(0, cut)), ...parser.raw(input.subarray(cut))];
      assertSameWhenSplit(actual, expected, `${label}, cut at ${cut}`);
    }
  }
});

test("no table row leaves a deadline behind, and a named key's id reads back as the same key", () => {
  for (const [label, parts, expected] of TABLE) {
    const parser = harness();
    parser.feed(...parts);
    assert.equal(parser.timeoutAt(), null, label);
    for (const event of expected) if (event.name) assert.deepEqual(key(keyId(event)), event, label);
  }
});

// --- The lone ESC and its 50 ms -------------------------------------------------

test("a lone ESC is the Esc key once it has waited 50 ms on the injected clock, and not before", () => {
  const parser = harness();
  assert.equal(ESC_TIMEOUT_MS, 50);
  assert.equal(parser.timeoutAt(), null, "nothing is pending before any input");
  assert.deepEqual(parser.expire(), []);
  assert.deepEqual(parser.feed(ESC), [], "a lone ESC is not yet a key");
  assert.equal(parser.timeoutAt(), 50);
  parser.advance(49);
  assert.deepEqual(parser.expire(), [], "1 ms before the deadline");
  assert.equal(parser.timeoutAt(), 50, "the deadline does not move");
  parser.advance(1);
  assert.deepEqual(parser.expire(), [key("escape")], "at the deadline");
  assert.equal(parser.timeoutAt(), null);
  assert.deepEqual(parser.expire(), [], "the Esc key is emitted once");
  assert.deepEqual(parser.feed("q"), [text("q")], "the next key is plain, not Alt");
});

test("expire() after the deadline emits the Esc key, and the deadline is the feed's own clock time plus 50", () => {
  const parser = harness(1000);
  assert.deepEqual(parser.feed("a"), [text("a")]);
  assert.equal(parser.timeoutAt(), null);
  parser.advance(20);
  assert.deepEqual(parser.feed("b", ESC), [text("b")]);
  assert.equal(parser.timeoutAt(), 1070);
  parser.advance(500);
  assert.deepEqual(parser.expire(), [key("escape")]);
  assert.equal(parser.timeoutAt(), null);
});

test("an ESC followed before the deadline by the rest of the sequence in the next feed is the sequence", () => {
  const parser = harness();
  assert.deepEqual(parser.feed(ESC), []);
  parser.advance(49);
  assert.deepEqual(parser.feed("[A"), [key("up")]);
  assert.equal(parser.timeoutAt(), null);
  assert.deepEqual(parser.expire(), []);
});

test("an ESC followed before the deadline by a key in the next feed is Alt+that key", () => {
  const parser = harness();
  parser.feed(ESC);
  parser.advance(49);
  assert.deepEqual(parser.feed("q"), [alt("q")]);
  parser.feed(ESC);
  parser.advance(10);
  assert.deepEqual(parser.feed(0x0d), [key("alt+enter")]);
});

test("a feed arriving at or after the deadline of a lone ESC gives the Esc key first, then its bytes parsed fresh", () => {
  for (const wait of [50, 51, 5000]) {
    const parser = harness();
    parser.feed(ESC);
    parser.advance(wait);
    assert.deepEqual(parser.feed("[A"), [key("escape"), text("["), text("A")], `after ${wait} ms`);
    assert.equal(parser.timeoutAt(), null);
    assert.deepEqual(parser.expire(), [], "the Esc key is not emitted twice");
  }
  const parser = harness();
  parser.feed(ESC);
  parser.advance(50);
  assert.deepEqual(parser.feed(CSI, "A"), [key("escape"), key("up")], "a whole sequence after the deadline is still a sequence");
});

test("the deadline belongs to the last lone ESC: a second ESC emits the first and waits its own 50 ms", () => {
  const parser = harness();
  parser.feed(ESC);
  assert.equal(parser.timeoutAt(), 50);
  parser.advance(30);
  assert.deepEqual(parser.feed(ESC), [key("escape")]);
  assert.equal(parser.timeoutAt(), 80);
  parser.advance(49);
  assert.deepEqual(parser.expire(), []);
  parser.advance(1);
  assert.deepEqual(parser.expire(), [key("escape")]);
});

test("an empty feed neither completes nor cancels a lone ESC before its deadline", () => {
  const parser = harness();
  parser.feed(ESC);
  parser.advance(10);
  assert.deepEqual(parser.feed(), []);
  assert.equal(parser.timeoutAt(), 50);
  parser.advance(10);
  assert.deepEqual(parser.feed("[B"), [key("down")]);
});

test("an ESC as the last byte of a chunk continues in the next chunk, whatever it starts", () => {
  const cases = [
    [["a", ESC], [text("a")], ["[A", "b"], [key("up"), text("b")]],
    [[CSI, "A", ESC], [key("up")], ["OP"], [key("f1")]],
    [["x", ESC], [text("x")], ["[200~pasted", PASTE_END], [paste("pasted")]],
    [[ESC], [], ["]0;title", BEL, "q"], [text("q")]],
    [[CSI, "1;5", ESC], [], ["[1;2C"], [key("shift+right")]],
    [[ESC, "]0;title", ESC], [], ["\\q"], [text("q")]],
    [[PASTE_START, "abc", ESC], [], ["[201~q"], [paste("abc"), text("q")]],
  ];
  for (const [first, firstEvents, second, secondEvents] of cases) {
    const parser = harness();
    assert.deepEqual(parser.feed(...first), firstEvents);
    parser.advance(ESC_TIMEOUT_MS - 1);
    assert.deepEqual(parser.feed(...second), secondEvents);
  }
});

test("only a lone ESC times out: every other incomplete sequence waits for its end, however long", () => {
  const cases = [
    [[CSI], ["A"], [key("up")]],
    [[CSI, "1;"], ["5D"], [key("ctrl+left")]],
    [[SS3], ["P"], [key("f1")]],
    [[CSI, "["], ["E"], [key("f5")]],
    [[CSI, "M", "a"], ["bc", "q"], [text("q")]],
    [[ESC, "]0;an unterminated ti"], ["tle", BEL, "q"], [text("q")]],
    [[ESC, "]0;title", ESC], ["\\", "q"], [text("q")]],
    [[ESC, "P1$r"], ["0m", ST, "q"], [text("q")]],
    [[0xe2, 0x82], [0xac], [text("\u20ac")]],
    [[ESC, 0xc3], [0xa9], [alt("\u00e9")]],
  ];
  for (const [first, second, expected] of cases) {
    const parser = harness();
    assert.deepEqual(parser.feed(...first), []);
    assert.equal(parser.timeoutAt(), null, "no deadline");
    parser.advance(3_600_000);
    assert.deepEqual(parser.expire(), [], "expire() does not touch it");
    assert.deepEqual(parser.feed(...second), expected);
  }
});

test("a character whose bytes are split across feeds at any byte is emitted by the feed that completes it", () => {
  for (const character of ["\u00e9", "\u20ac", "\u65e5", "\u{1f600}"]) {
    const input = bytes(character);
    for (let cut = 1; cut < input.length; cut++) {
      const parser = harness();
      assert.deepEqual(parser.raw(input.subarray(0, cut)), [], `${character}: nothing before the last byte`);
      assert.deepEqual(parser.raw(input.subarray(cut)), [text(character)], `${character} cut at ${cut}`);
    }
    const parser = harness(), events = [];
    for (const b of input) events.push(parser.feed(b));
    assert.deepEqual(events, [...Array(input.length - 1).fill([]), [text(character)]], `${character} one byte per feed`);
  }
});

test("text is never held back for a combining mark: the mark arriving in a later feed is its own event", () => {
  const parser = harness();
  assert.deepEqual(parser.feed("e"), [text("e")], "the typed key acts at once");
  assert.deepEqual(parser.feed("\u0301"), [text("\u0301")]);
  assert.deepEqual(parser.feed("e\u0301"), [text("e\u0301")], "in one feed they are one grapheme");
});

// --- Bracketed paste ------------------------------------------------------------

test("a paste whose markers are split at every byte position is the same one paste", () => {
  const input = bytes("a", PASTE_START, "pasted q", 0x03, PASTE_END, "b");
  const expected = [text("a"), paste("pasted q\x03"), text("b")];
  for (let cut = 1; cut < input.length; cut++) {
    const parser = harness();
    assert.deepEqual([...parser.raw(input.subarray(0, cut)), ...parser.raw(input.subarray(cut))], expected, `cut at ${cut}`);
  }
  const end = bytes(PASTE_END);
  for (let cut = 1; cut < end.length; cut++) {
    const parser = harness();
    assert.deepEqual(parser.feed(PASTE_START, "abc", end.subarray(0, cut)), [], `no event before the end marker is whole (cut at ${cut})`);
    assert.deepEqual(parser.feed(end.subarray(cut), "q"), [paste("abc"), text("q")], `end marker cut at ${cut}`);
  }
});

test("the end marker of a paste may arrive one byte per feed, with clock time passing between the bytes", () => {
  const parser = harness();
  assert.deepEqual(parser.feed(PASTE_START, "abc"), []);
  for (const b of bytes(PASTE_END).subarray(0, 5)) {
    parser.advance(PASTE_PAUSE_MS - 1);
    assert.deepEqual(parser.feed(b), []);
    assert.equal(parser.timeoutAt(), null, "an ESC inside a paste has no deadline");
    assert.deepEqual(parser.expire(), []);
  }
  assert.deepEqual(parser.feed("~"), [paste("abc")]);
});

test("a paste holding q, 0x03, 0x1a and a fake end marker gives the content up to the fake marker, then keys", () => {
  const parser = harness();
  assert.deepEqual(
    parser.feed(PASTE_START, "q", 0x03, 0x1a, " rm -rf ", PASTE_END, "q", 0x03, 0x1a, PASTE_END),
    [paste("q\x03\x1a rm -rf "), text("q"), key("ctrl+c"), key("ctrl+z")],
    "a fake end marker ends the paste: what follows is the terminal's doing and is read as keys",
  );
});

test("a paste is delivered whole below the limit, however it is chunked", () => {
  const content = Buffer.alloc(300_000);
  for (let i = 0; i < content.length; i++) content[i] = 0x20 + (i * 7) % 95;
  const parser = harness(), events = [];
  events.push(...parser.feed(PASTE_START));
  for (let i = 0; i < content.length; i += 7919) events.push(...parser.raw(content.subarray(i, i + 7919)));
  assert.deepEqual(events, [], "nothing before the end marker");
  assert.deepEqual(parser.feed(PASTE_END), [paste(content.toString("latin1"))]);
});

test("a paste one byte under the limit is delivered; a paste that reaches the limit is truncated", () => {
  assert.equal(PASTE_LIMIT, 1024 * 1024);
  const under = harness();
  under.feed(PASTE_START);
  assert.deepEqual(under.raw(Buffer.alloc(PASTE_LIMIT - 1, "a")), []);
  const [event, ...rest] = under.feed(PASTE_END);
  assert.deepEqual(rest, []);
  assert.deepEqual(Object.keys(event), ["paste"]);
  assert.equal(event.paste.length, PASTE_LIMIT - 1);
  assert.equal(event.paste, "a".repeat(PASTE_LIMIT - 1));

  const at = harness();
  at.feed(PASTE_START);
  assert.deepEqual(at.raw(Buffer.alloc(PASTE_LIMIT - 1, "a")), []);
  assert.deepEqual(at.feed("a"), [], "the byte that reaches the limit emits nothing yet");
  assert.deepEqual(at.feed(PASTE_END), [TRUNCATED]);

  const marker = harness();
  marker.feed(PASTE_START);
  marker.raw(Buffer.alloc(PASTE_LIMIT - 3, "a"));
  assert.deepEqual(marker.feed(CSI, "x", PASTE_END), [TRUNCATED], "the bytes of a marker that was not one count as content");

  const atOnce = harness();
  assert.deepEqual(atOnce.raw(Buffer.concat([bytes(PASTE_START), Buffer.alloc(2 * PASTE_LIMIT, "a"), bytes(PASTE_END, "q")])), [TRUNCATED, text("q")]);
});

test("a paste that never ends is held in bounded memory: no event until the end marker, then exactly one truncated paste", () => {
  const parser = harness();
  const chunk = new Uint8Array(64 * 1024).fill(0x61);
  chunk[100] = 0x03; chunk[200] = 0x1b; chunk[300] = 0x71; // Ctrl+C, a stray ESC and a q stay content over the limit too
  assert.deepEqual(parser.feed(PASTE_START), []);
  const before = process.memoryUsage().arrayBuffers;
  let fed = 0;
  for (; fed < 64 * PASTE_LIMIT; fed += chunk.length) {
    const events = parser.raw(chunk);
    if (events.length > 0) assert.fail(`an event after ${fed} bytes of an unterminated paste: ${JSON.stringify(events)}`);
  }
  assert.ok(fed > PASTE_LIMIT);
  const grown = process.memoryUsage().arrayBuffers - before;
  assert.ok(grown < 4 * PASTE_LIMIT, `${fed} bytes fed, ${grown} bytes of byte arrays grown`);
  assert.equal(parser.timeoutAt(), null);
  assert.deepEqual(parser.expire(), []);
  assert.deepEqual(parser.feed(PASTE_END.slice(0, 4)), [], "the end marker may still be split");
  assert.deepEqual(parser.feed(PASTE_END.slice(4), "q", CSI, "A"), [TRUNCATED, text("q"), key("up")], "then keys are keys again");
  assert.deepEqual(parser.feed(PASTE_START, "next", PASTE_END), [paste("next")], "and the next paste is whole");
});

test("a pause of PASTE_PAUSE_MS between feeds abandons an open paste: truncated, then that feed is keys", () => {
  assert.equal(PASTE_PAUSE_MS, 1000);
  const parser = harness();
  assert.deepEqual(parser.feed(PASTE_START, "abc"), []);
  parser.advance(999);
  assert.deepEqual(parser.feed("def"), [], "1 ms short of the pause the paste goes on");
  parser.advance(999);
  assert.deepEqual(parser.feed("ghi", PASTE_END), [paste("abcdefghi")], "the pause is measured from the previous feed, not from the start");

  assert.deepEqual(parser.feed(PASTE_START, "abc"), []);
  parser.advance(1000);
  assert.deepEqual(parser.feed("q", 0x03), [TRUNCATED, text("q"), key("ctrl+c")], "at the pause the paste is abandoned and the keys act");
  assert.deepEqual(parser.feed("x"), [text("x")], "the parser is out of the paste");

  assert.deepEqual(parser.feed(PASTE_START, "abc", CSI, "20"), [], "even with half an end marker pending");
  parser.advance(60_000);
  assert.deepEqual(parser.feed(PASTE_END, "q"), [TRUNCATED, text("q")], "a late end marker is an unknown CSI outside a paste");
});

test("the pause rule also frees a paste that is over the limit, and counts only time inside a paste", () => {
  const parser = harness();
  parser.feed(PASTE_START);
  assert.deepEqual(parser.raw(Buffer.alloc(PASTE_LIMIT + 10, "a")), []);
  parser.advance(PASTE_PAUSE_MS);
  assert.deepEqual(parser.feed(CSI, "A"), [TRUNCATED, key("up")]);

  parser.advance(60_000);
  assert.deepEqual(parser.feed(PASTE_START, "after a long idle", PASTE_END), [paste("after a long idle")], "an idle time before the paste is no pause");
  parser.advance(60_000);
  assert.deepEqual(parser.feed("q"), [text("q")], "outside a paste a pause means nothing");
});

// --- Robustness -----------------------------------------------------------------

test("random bytes never throw and never put a control character in a text event", () => {
  let seed = 0x9e3779b9;
  const random = (below) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor((seed / 0x1_0000_0000) * below); };
  // Half the bytes are uniform, half come from the bytes sequences are made of. No "0":
  // a paste start marker must not form, the property is about input outside paste mode.
  const hot = bytes(ESC, ESC, ESC, "[[[O]P^_X\\;;1125~~AMRZI<?$ q", BEL, 0x0d, 0x7f, 0x00, 0x03, 0x18, 0x1a,
    0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80, 0xc2, 0x9b, 0xed, 0xa0, 0xff);
  const names = new Set(["enter", "tab", "backspace", "escape", "up", "down", "left", "right", "home", "end", "pageup", "pagedown",
    "insert", "delete", ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`)]);
  const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
  const seen = { named: 0, text: 0, alt: 0, escape: 0 };
  let t = 0;
  const parser = createKeyParser({ now: () => t });

  const check = (event, where) => {
    if (Object.hasOwn(event, "name")) {
      assert.deepEqual(Object.keys(event), ["name", "ctrl", "alt", "shift"], where);
      for (const mod of ["ctrl", "alt", "shift"]) assert.equal(typeof event[mod], "boolean", where);
      assert.ok(names.has(event.name) || (/^[a-z]$/.test(event.name) && event.ctrl && !event.shift), `${where}: ${JSON.stringify(event)}`);
      assert.deepEqual(key(keyId(event)), event, where);
      seen.named++;
      if (event.name === "escape") seen.escape++;
      return;
    }
    assert.ok(Object.hasOwn(event, "text"), `${where}: random bytes must stay outside paste mode, got ${JSON.stringify(event)}`);
    assert.ok(event.alt === undefined ? Object.keys(event).length === 1 : event.alt === true && Object.keys(event).length === 2, where);
    assert.ok(event.text.length > 0 && event.text.isWellFormed(), where);
    for (const character of event.text) {
      const cp = character.codePointAt(0);
      assert.ok(cp >= 0x20 && cp !== 0x7f && !(cp >= 0x80 && cp <= 0x9f), `${where}: U+${cp.toString(16)} in a text event`);
    }
    assert.equal([...graphemes.segment(event.text)].length, 1, `${where}: one grapheme per text event`);
    assert.equal(typeof keyId(event), "string", where);
    seen[event.alt ? "alt" : "text"]++;
  };

  for (let round = 0; round < 2000; round++) {
    const chunk = new Uint8Array(random(48));
    for (let i = 0; i < chunk.length; i++) chunk[i] = random(2) ? random(256) : hot[random(hot.length)];
    if (random(3) === 0) {
      t += random(120);
      for (const event of parser.expire()) check(event, `round ${round}, expire`);
    }
    for (const event of parser.feed(chunk)) check(event, `round ${round}`);
    // From any state outside a paste, `ESC \` leads back to plain input: nothing is stuck.
    if (round % 20 === 19) {
      for (const event of parser.feed(bytes(ST))) check(event, `round ${round}, recovery`);
      assert.deepEqual(parser.feed(bytes("q")), [text("q")], `round ${round}: a key after ESC \\ is that key`);
      assert.equal(parser.timeoutAt(), null);
    }
  }
  for (const [kind, count] of Object.entries(seen)) assert.ok(count > 20, `the run exercised ${kind} events (${count})`);
});

test("the parser needs its clock and bytes, and says so", () => {
  assert.throws(() => createKeyParser(), TypeError);
  assert.throws(() => createKeyParser({}), TypeError);
  assert.throws(() => createKeyParser({ now: 0 }), TypeError);
  assert.throws(() => harness().raw("\x1b[A"), TypeError, "a string is not bytes");
  assert.deepEqual(harness().raw(new Uint8Array([0x1b, 0x5b, 0x41])), [key("up")], "a plain Uint8Array is bytes");
  assert.deepEqual(harness().raw(new Uint8Array(0)), []);
});

test("the parser reads the clock once per feed and once per expire, and nowhere else", () => {
  let reads = 0;
  const parser = createKeyParser({ now: () => { reads++; return 0; } });
  assert.equal(reads, 0);
  parser.feed(bytes("abc", ESC, CSI, "A", PASTE_START, "x", PASTE_END, ESC));
  assert.equal(reads, 1);
  parser.timeoutAt();
  assert.equal(reads, 1);
  parser.expire();
  assert.equal(reads, 2);
});

test("events are fresh objects: changing one does not change a later one", () => {
  const parser = harness();
  const [first] = parser.feed(0x0d);
  first.name = "changed"; first.alt = true;
  assert.deepEqual(parser.feed(0x0d, CSI, "A", ESC), [key("enter"), key("up")]);
  parser.advance(ESC_TIMEOUT_MS);
  const [escape] = parser.expire();
  escape.name = "changed";
  parser.feed(ESC);
  parser.advance(ESC_TIMEOUT_MS);
  assert.deepEqual(parser.expire(), [key("escape")]);
});

test("the parser is pure: no import, no IO, timer or clock global, no Intl but Intl.Segmenter, and no ESC literal", () => {
  const source = readFileSync(new URL("../lib/term/keys.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^\s*import\b|\bimport\s*\(|\brequire\s*\(/m, "no import");
  assert.doesNotMatch(source, /\b(process|globalThis|setTimeout|setInterval|setImmediate|queueMicrotask|Date|performance|TextDecoder|TextEncoder|Buffer)\b|\bconsole\s*[.[]/, "no IO, timer or clock global");
  assert.deepEqual([...new Set(source.match(/\bIntl\.\w+/g))], ["Intl.Segmenter"]);
  assert.doesNotMatch(source, /\x1b|\\x1b|\\u001b|\\u\{1b\}|\\033/i, "ESC is only ever the number 0x1b, compared against input");
});

// --- keyId ------------------------------------------------------------------------

test("keyId is the modifiers in the order ctrl, alt, shift, then the name, for a named key", () => {
  assert.equal(keyId({ name: "escape", ctrl: false, alt: false, shift: false }), "escape");
  assert.equal(keyId({ name: "c", ctrl: true, alt: false, shift: false }), "ctrl+c");
  assert.equal(keyId({ name: "tab", ctrl: false, alt: false, shift: true }), "shift+tab");
  assert.equal(keyId({ name: "enter", ctrl: false, alt: true, shift: false }), "alt+enter");
  assert.equal(keyId({ name: "up", ctrl: true, alt: true, shift: false }), "ctrl+alt+up");
  assert.equal(keyId({ name: "f12", ctrl: true, alt: true, shift: true }), "ctrl+alt+shift+f12");
  assert.equal(keyId({ name: "delete", ctrl: false, alt: true, shift: true }), "alt+shift+delete");
  assert.equal(keyId({ shift: true, alt: true, ctrl: true, name: "home" }), "ctrl+alt+shift+home", "the order is fixed, not the object's");
});

test("keyId is the text itself for a grapheme, \"space\" for a space, prefixed alt+ when Alt was held", () => {
  assert.equal(keyId({ text: "?" }), "?");
  assert.equal(keyId({ text: "q" }), "q");
  assert.equal(keyId({ text: "Q" }), "Q");
  assert.equal(keyId({ text: "+" }), "+");
  assert.equal(keyId({ text: "\u00e9" }), "\u00e9");
  assert.equal(keyId({ text: FAMILY }), FAMILY);
  assert.equal(keyId({ text: " " }), "space");
  assert.equal(keyId({ text: "q", alt: true }), "alt+q");
  assert.equal(keyId({ text: " ", alt: true }), "alt+space");
});

test("keyId is null for a paste, truncated or not, and for what is no event", () => {
  assert.equal(keyId({ paste: "q" }), null);
  assert.equal(keyId({ paste: "" }), null);
  assert.equal(keyId({ paste: "", truncated: true }), null);
  assert.equal(keyId(null), null);
  assert.equal(keyId(undefined), null);
  assert.equal(keyId({}), null);
});

test("keyId of the events the parser emits is what the action table binds", () => {
  const parser = harness();
  const events = parser.feed(0x03, ESC, "q", "?", " ", CSI, "Z", CSI, "1;7A", PASTE_START, "q", PASTE_END, SS3, "P", 0x0d, 0x7f, ESC);
  parser.advance(ESC_TIMEOUT_MS);
  events.push(...parser.expire());
  assert.deepEqual(events.map(keyId), ["ctrl+c", "alt+q", "?", "space", "shift+tab", "ctrl+alt+up", null, "f1", "enter", "backspace", "escape"]);
});
