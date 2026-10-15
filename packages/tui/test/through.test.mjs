import test from "node:test";
import assert from "node:assert/strict";
import { BACK_KEY, backKeySequences, createThrough, isBackKey } from "../lib/term/through.mjs";
import { ESC_TIMEOUT_MS, PASTE_LIMIT, PASTE_PAUSE_MS } from "../lib/term/keys.mjs";

const bytes = (text) => Uint8Array.from(Buffer.from(text, "latin1"));
const text = (value) => Buffer.from(value).toString("latin1");
/** The events of a feed with their bytes as latin1 strings, so a test reads them as typed. */
const read = (events) => events.map((e) => (e.input ? { input: text(e.input) } : e.back ? { back: true, rest: text(e.rest) } : e));
function scanner(key = "C-\\") {
  let t = 1000;
  const through = createThrough({ sequences: backKeySequences(key), now: () => t });
  return { feed: (s) => read(through.feed(bytes(s))), expire: () => read(through.expire()), timeoutAt: () => through.timeoutAt(), wait: (ms) => { t += ms; } };
}

test("the back key's grammar is the TUI's own set, pinned here: Control with a letter but h, i and m or one of \\ ] ^ _, Meta with a lowercase letter or a digit, F1 to F12 with at most one modifier", () => {
  const letters = [..."abcdefghijklmnopqrstuvwxyz"];
  const control = [...letters.filter((c) => !"him".includes(c)), "\\", "]", "^", "_"].map((c) => `C-${c}`);
  const meta = [...letters, ..."0123456789"].map((c) => `M-${c}`);
  const fkeys = Array.from({ length: 12 }, (_, i) => `F${i + 1}`).flatMap((f) => [f, `C-${f}`, `M-${f}`, `S-${f}`]);
  for (const key of [...control, ...meta, ...fkeys]) assert.equal(isBackKey(key), true, key);
  for (const key of ["C-h", "C-i", "C-m", "C-[", "Escape", "M-[", "M-]", "M-\\", "M-O", "M-A", "F0", "F13", "C-M-F1", "S-a", "C-\\x", "", "c-\\", " C-\\", "Any", "MouseDown1Pane"]) assert.equal(isBackKey(key), false, JSON.stringify(key));
  assert.equal(BACK_KEY.source, "^(?:C-[a-gj-ln-z\\\\\\]^_]|M-[a-z0-9]|(?:[CMS]-)?F(?:[1-9]|1[0-2]))$");
});

test("each back key is scanned as the bytes a terminal sends for it", () => {
  const seqs = (key) => backKeySequences(key).map(text);
  assert.deepEqual(seqs("C-\\"), ["\x1c"]);
  assert.deepEqual(seqs("C-]"), ["\x1d"]);
  assert.deepEqual(seqs("C-^"), ["\x1e"]);
  assert.deepEqual(seqs("C-_"), ["\x1f"]);
  assert.deepEqual(seqs("C-a"), ["\x01"]);
  assert.deepEqual(seqs("C-z"), ["\x1a"]);
  assert.deepEqual(seqs("M-x"), ["\x1bx"]);
  assert.deepEqual(seqs("M-0"), ["\x1b0"]);
  assert.deepEqual(seqs("F1"), ["\x1bOP", "\x1b[11~", "\x1b[[A"]);
  assert.deepEqual(seqs("F4"), ["\x1bOS", "\x1b[14~", "\x1b[[D"]);
  assert.deepEqual(seqs("F5"), ["\x1b[15~", "\x1b[[E"]);
  assert.deepEqual(seqs("F6"), ["\x1b[17~"]);
  assert.deepEqual(seqs("F11"), ["\x1b[23~"]);
  assert.deepEqual(seqs("F12"), ["\x1b[24~"]);
  assert.deepEqual(seqs("S-F1"), ["\x1b[1;2P", "\x1bO2P", "\x1b[11;2~"]);
  assert.deepEqual(seqs("M-F2"), ["\x1b[1;3Q", "\x1bO3Q", "\x1b[12;3~"]);
  assert.deepEqual(seqs("C-F12"), ["\x1b[24;5~"]);
  assert.throws(() => backKeySequences("C-m"), /not a back key/);
});

test("everything but the back key reaches the agent exactly as typed, Ctrl+C, Ctrl+Z, Esc and the TUI's own keys included", () => {
  const s = scanner();
  assert.deepEqual(s.feed("q\x03\x1a\x1b?\r\x7f\x00"), [{ input: "q\x03\x1a\x1b?\r\x7f\x00" }]);
  assert.deepEqual(s.feed("\xe6\xbc\xa2"), [{ input: "\xe6\xbc\xa2" }]);
});

test("the back key ends the agent's bytes: what came before it goes to the agent, what came after it is handed on", () => {
  const s = scanner();
  assert.deepEqual(s.feed("ls\x1cjj"), [{ input: "ls" }, { back: true, rest: "jj" }]);
  assert.deepEqual(s.feed("\x1c"), [{ back: true, rest: "" }]);
});

test("a key sequence split across reads is never held back from the agent, but a beginning of the back key's own bytes waits for the next read or the Esc timeout", () => {
  const plain = scanner();
  // A lone ESC (the agent's Esc) and an arrow split after its ESC go on at once with C-\ as the back key.
  assert.deepEqual(plain.feed("\x1b"), [{ input: "\x1b" }]);
  assert.equal(plain.timeoutAt(), null);
  assert.deepEqual(plain.feed("[A"), [{ input: "[A" }]);
  const meta = scanner("M-x");
  assert.deepEqual(meta.feed("ab\x1b"), [{ input: "ab" }]);
  assert.equal(meta.timeoutAt(), 1000 + ESC_TIMEOUT_MS);
  assert.deepEqual(meta.feed("x!"), [{ back: true, rest: "!" }]);
  assert.deepEqual(meta.feed("\x1b"), []);
  assert.deepEqual(meta.expire(), []);
  meta.wait(ESC_TIMEOUT_MS);
  assert.deepEqual(meta.expire(), [{ input: "\x1b" }]);
  assert.equal(meta.timeoutAt(), null);
  const f12 = scanner("F12");
  assert.deepEqual(f12.feed("\x1b[2"), []);
  assert.deepEqual(f12.feed("4~"), [{ back: true, rest: "" }]);
  assert.deepEqual(f12.feed("\x1b[2"), []);
  assert.deepEqual(f12.feed("~"), [{ input: "\x1b[2~" }]); // Insert, not F12: the agent's
});

test("a bracketed paste is unwrapped and goes as a paste; a back key inside it is pasted, not taken", () => {
  const s = scanner();
  assert.deepEqual(s.feed("a\x1b[200~one\x1ctwo\x1b[201~b"), [{ input: "a" }, { paste: "one\x1ctwo" }, { input: "b" }]);
  // Split anywhere, the start marker from its third byte and the end marker at any byte.
  assert.deepEqual(s.feed("\x1b[2"), []);
  assert.deepEqual(s.feed("00~x\x1b[20"), []);
  assert.deepEqual(s.feed("1~\x1c"), [{ paste: "x" }, { back: true, rest: "" }]);
  // A paste's content is UTF-8 text.
  assert.deepEqual(scanner().feed("\x1b[200~\xe6\xbc\xa2\x1b[201~"), [{ paste: "漢" }]);
});

test("a paste that reaches the limit is dropped whole, and one whose end never comes is given to the agent after the pause", () => {
  const s = scanner();
  assert.deepEqual(s.feed(`\x1b[200~${"x".repeat(PASTE_LIMIT)}`), []);
  assert.deepEqual(s.feed("y\x1b[201~z"), [{ input: "z" }]);
  const stalled = scanner();
  assert.deepEqual(stalled.feed("\x1b[200~half"), []);
  stalled.wait(PASTE_PAUSE_MS);
  assert.deepEqual(stalled.feed("\x1c"), [{ paste: "half" }, { back: true, rest: "" }]);
});

test("the events are copies: a later read does not change bytes already handed out", () => {
  const through = createThrough({ sequences: backKeySequences("M-x"), now: () => 0 });
  const [first] = through.feed(bytes("abc"));
  through.feed(bytes("zzz"));
  assert.equal(text(first.input), "abc");
});
