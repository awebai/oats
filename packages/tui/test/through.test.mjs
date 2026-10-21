import test from "node:test";
import assert from "node:assert/strict";
import { backKeyLabel } from "../lib/actions.mjs";
import { BACK_KEY, BACK_KEY_SPLIT_MS, backKeySequences, createThrough, isBackKey } from "../lib/term/through.mjs";
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

test("the default back key, C-x (Ctrl+X, the leader on every platform), is the byte 0x18 without the protocol; ESC right before it is Ctrl+Alt+X and Alt+O is ESC o, both the agent's as typed (#1433)", () => {
  let t = 1000;
  const through = createThrough({ sequences: backKeySequences("C-x"), now: () => t, leader: "ctrl+x" });
  const s = { feed: (value) => read(through.feed(bytes(value))), expire: () => read(through.expire()) };
  assert.deepEqual(backKeySequences("C-x").map(text), ["\x18"]);
  assert.deepEqual(s.feed("ls\x18jj"), [{ input: "ls" }, { back: true, rest: "jj" }]);
  assert.deepEqual(s.feed("\x18"), [{ back: true, rest: "" }]);
  assert.deepEqual(s.feed("\x1b\x18"), [{ input: "\x1b\x18" }], "Ctrl+Alt+X: never the back key");
  assert.deepEqual(s.feed("a\x1b\x18b\x18c"), [{ input: "a\x1b\x18b" }, { back: true, rest: "c" }], "a Ctrl+X after it in the read still is");
  assert.deepEqual(s.feed("\x1bo"), [{ input: "\x1bo" }], "Alt+O: no back key now, the agent's");
  assert.equal(through.timeoutAt(), null, "no back key begins with ESC: nothing waits");
  t += 60_000;
  assert.deepEqual(s.expire(), []);
});

test("a key sequence split across reads is never held back from the agent, but a beginning of the back key's own bytes waits for the next read or BACK_KEY_SPLIT_MS, and one that may begin a paste the Esc timeout", () => {
  const plain = scanner();
  // A lone ESC (the agent's Esc) and an arrow split after its ESC go on at once with C-\ as the back key.
  assert.deepEqual(plain.feed("\x1b"), [{ input: "\x1b" }]);
  assert.equal(plain.timeoutAt(), null);
  assert.deepEqual(plain.feed("[A"), [{ input: "[A" }]);
  const meta = scanner("M-x");
  assert.deepEqual(meta.feed("ab\x1b"), [{ input: "ab" }]);
  assert.equal(meta.timeoutAt(), 1000 + BACK_KEY_SPLIT_MS);
  assert.deepEqual(meta.feed("x!"), [{ back: true, rest: "!" }]);
  assert.deepEqual(meta.feed("\x1b"), []);
  meta.wait(BACK_KEY_SPLIT_MS - 1);
  assert.deepEqual(meta.expire(), []);
  meta.wait(1);
  assert.deepEqual(meta.expire(), [{ input: "\x1b" }]);
  assert.equal(meta.timeoutAt(), null);
  // ESC [ 2 may begin F12 and a paste's start marker: it waits as a paste's beginning does.
  const f12 = scanner("F12");
  assert.deepEqual(f12.feed("\x1b[2"), []);
  assert.equal(f12.timeoutAt(), 1000 + ESC_TIMEOUT_MS);
  assert.deepEqual(f12.feed("4~"), [{ back: true, rest: "" }]);
  assert.deepEqual(f12.feed("\x1b[2"), []);
  assert.deepEqual(f12.feed("~"), [{ input: "\x1b[2~" }]); // Insert, not F12: the agent's
});

test("the back key is one keypress (the maintainer's condition): its bytes in one read, or split across reads within BACK_KEY_SPLIT_MS, are the back key; Esc and then its key typed as two keys reach the agent as typed, whether expire() ran or a later read comes first", () => {
  assert.equal(BACK_KEY_SPLIT_MS, 10);
  assert.deepEqual(scanner("M-o").feed("\x1bo"), [{ back: true, rest: "" }], "one read");
  const split = scanner("M-o");
  assert.deepEqual(split.feed("\x1b"), []);
  split.wait(5);
  assert.deepEqual(split.feed("o"), [{ back: true, rest: "" }], "the rest 5 ms later: one keypress, split by the read");
  // Esc, then o 30 ms later: through the wait's own timer (expire() at 10 ms) ...
  const timed = scanner("M-o");
  assert.deepEqual(timed.feed("\x1b"), []);
  assert.equal(timed.timeoutAt(), 1000 + BACK_KEY_SPLIT_MS);
  timed.wait(BACK_KEY_SPLIT_MS);
  assert.deepEqual(timed.expire(), [{ input: "\x1b" }]);
  timed.wait(30 - BACK_KEY_SPLIT_MS);
  assert.deepEqual(timed.feed("o"), [{ input: "o" }]);
  // ... and with no expire() run before the late read: the held ESC is the agent's first.
  const late = scanner("M-o");
  assert.deepEqual(late.feed("\x1b"), []);
  late.wait(30);
  assert.deepEqual(late.feed("o"), [{ input: "\x1b" }, { input: "o" }]);
  assert.equal(late.timeoutAt(), null);
  assert.deepEqual(late.expire(), [], "nothing is handed on twice");
  // A late read that holds again: the held ESC first, then the new one waits its own time.
  const again = scanner("M-o");
  again.feed("\x1b");
  again.wait(BACK_KEY_SPLIT_MS);
  assert.deepEqual(again.feed("a\x1b"), [{ input: "\x1b" }, { input: "a" }]);
  assert.equal(again.timeoutAt(), 1000 + BACK_KEY_SPLIT_MS + BACK_KEY_SPLIT_MS);
  again.wait(2);
  assert.deepEqual(again.feed("o"), [{ back: true, rest: "" }]);
  // The same for a function key split after its ESC: F12's ESC alone waits BACK_KEY_SPLIT_MS.
  const f12 = scanner("F12");
  assert.deepEqual(f12.feed("\x1b"), []);
  assert.equal(f12.timeoutAt(), 1000 + BACK_KEY_SPLIT_MS);
  f12.wait(30);
  assert.deepEqual(f12.feed("[24~"), [{ input: "\x1b" }, { input: "[24~" }]);
});

test("a paste's start marker held from its third byte still waits the Esc timeout, not BACK_KEY_SPLIT_MS: also with a back key that begins with ESC, a late rest of it 30 ms later is the paste's", () => {
  for (const key of ["C-\\", "M-o"]) {
    const s = scanner(key);
    assert.deepEqual(s.feed("\x1b[2"), []);
    assert.equal(s.timeoutAt(), 1000 + ESC_TIMEOUT_MS, key);
    s.wait(30);
    assert.deepEqual(s.expire(), [], key);
    assert.deepEqual(s.feed("00~one\x1b[201~"), [{ paste: "one" }], key);
    const lapsed = scanner(key);
    lapsed.feed("\x1b[2");
    lapsed.wait(ESC_TIMEOUT_MS - 1);
    assert.deepEqual(lapsed.expire(), [], key);
    lapsed.wait(1);
    assert.deepEqual(lapsed.expire(), [{ input: "\x1b[2" }], key);
  }
});

test("a back key is named for people: Control is Ctrl, Meta is Alt, Shift is Shift, a letter a capital, a function key as it is; a value outside the grammar is answered as given", () => {
  for (const [key, label] of [["C-\\", "Ctrl+\\"], ["C-x", "Ctrl+X"], ["C-]", "Ctrl+]"], ["C-_", "Ctrl+_"], ["M-o", "Alt+O"], ["M-5", "Alt+5"], ["F12", "F12"], ["F1", "F1"],
    ["S-F5", "Shift+F5"], ["C-F1", "Ctrl+F1"], ["M-F3", "Alt+F3"]]) assert.equal(backKeyLabel(key), label, key);
  for (const value of ["C-m", "M-O", "Any", "", "C-\\x"]) assert.equal(backKeyLabel(value), value, JSON.stringify(value));
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

test("a paste split anywhere, its two marks included, never lets a back key inside it act: every split in three reads hands on exactly what was typed, as input or as a paste, and the back key after it is taken (round 1 of the review)", () => {
  const typedText = "a\x1b[200~one\x1ctwo\x1b[201~b";
  /** What reached the agent, marks put back around a paste: it must be what was typed. */
  const reached = (events) => events.map((e) => (e.input !== undefined ? e.input : `\x1b[200~${Buffer.from(e.paste, "utf8").toString("latin1")}\x1b[201~`)).join("");
  for (let i = 1; i < typedText.length; i++) {
    for (let j = i + 1; j < typedText.length; j++) {
      const s = scanner(), events = [];
      for (const part of [typedText.slice(0, i), typedText.slice(i, j), typedText.slice(j)]) events.push(...s.feed(part));
      events.push(...s.expire());
      const at = `split at ${i}, ${j}`;
      assert.equal(events.some((e) => e.back), false, `${at}: no back key: ${JSON.stringify(events)}`);
      assert.equal(reached(events), typedText, at);
      assert.deepEqual(s.feed("\x1c"), [{ back: true, rest: "" }], `${at}: the back key after the paste is taken`);
    }
  }
});

test("a paste split anywhere with the Esc timeout passing between its reads (a held start handed on by expire()) still never lets a back key inside it act, for the default back key and one that begins with ESC (round 2 of the review)", () => {
  for (const [key, back] of [["C-\\", "\x1c"], ["M-x", "\x1bx"]]) {
    const typedText = `a\x1b[200~one${back}two\x1b[201~b`;
    const reached = (events) => events.map((e) => (e.input !== undefined ? e.input : `\x1b[200~${Buffer.from(e.paste, "utf8").toString("latin1")}\x1b[201~`)).join("");
    for (let i = 1; i < typedText.length; i++) {
      for (let j = i + 1; j < typedText.length; j++) {
        const s = scanner(key), events = [];
        for (const part of [typedText.slice(0, i), typedText.slice(i, j), typedText.slice(j)]) {
          events.push(...s.feed(part));
          s.wait(ESC_TIMEOUT_MS);
          events.push(...s.expire());
          s.wait(1);
        }
        const at = `${key}, split at ${i}, ${j}`;
        assert.equal(events.some((e) => e.back), false, `${at}: no back key: ${JSON.stringify(events)}`);
        assert.equal(reached(events), typedText, at);
        assert.deepEqual(s.feed(back), [{ back: true, rest: "" }], `${at}: the back key after the paste is taken`);
      }
    }
  }
  // The reviewer's three: ESC then "[" held and expired; ESC [ 2 held and expired; and with M-x, a
  // lone ESC expired. In each the pasted q after the back key stays the agent's.
  for (const [key, parts] of [["C-\\", ["\x1b", "[", "200~hello\x1cq\x1b[201~"]], ["C-\\", ["\x1b[2", "00~hello\x1cq\x1b[201~"]], ["M-x", ["\x1b", "[200~hello\x1bxq\x1b[201~"]]]) {
    const s = scanner(key), events = [];
    for (const [n, part] of parts.entries()) {
      events.push(...s.feed(part));
      if (n === parts.length - 2) { s.wait(ESC_TIMEOUT_MS); events.push(...s.expire()); s.wait(1); }
    }
    assert.equal(events.some((e) => e.back), false, `${key} ${JSON.stringify(parts)}: ${JSON.stringify(events)}`);
    assert.equal(events.map((e) => e.input).join(""), parts.join(""), "all of it the agent's, as typed");
  }
});

test("a paste split anywhere with the wait passing between its reads and no expire() run (the late read hands the held bytes on itself) never lets a back key inside it act either", () => {
  for (const [key, back] of [["C-\\", "\x1c"], ["M-x", "\x1bx"]]) {
    const typedText = `a\x1b[200~one${back}two\x1b[201~b`;
    const reached = (events) => events.map((e) => (e.input !== undefined ? e.input : `\x1b[200~${Buffer.from(e.paste, "utf8").toString("latin1")}\x1b[201~`)).join("");
    for (let i = 1; i < typedText.length; i++) {
      for (let j = i + 1; j < typedText.length; j++) {
        const s = scanner(key), events = [];
        for (const part of [typedText.slice(0, i), typedText.slice(i, j), typedText.slice(j)]) { events.push(...s.feed(part)); s.wait(ESC_TIMEOUT_MS); }
        events.push(...s.expire());
        const at = `${key}, split at ${i}, ${j}`;
        assert.equal(events.some((e) => e.back), false, `${at}: no back key: ${JSON.stringify(events)}`);
        assert.equal(reached(events), typedText, at);
      }
    }
  }
});

test("a raw paste (its start marker split after ESC or ESC [) whose end never comes is over after the pause: the back key is taken again", () => {
  for (const first of ["\x1b", "x\x1b["]) {
    const s = scanner();
    assert.deepEqual(s.feed(first), [{ input: first }]);
    assert.deepEqual(s.feed(first === "\x1b" ? "[200~half\x1c" : "200~half\x1c"), [{ input: first === "\x1b" ? "[200~half\x1c" : "200~half\x1c" }], "inside the paste: passed on, not taken");
    s.wait(PASTE_PAUSE_MS);
    assert.deepEqual(s.feed("\x1c"), [{ back: true, rest: "" }]);
  }
  // An Esc the agent was sent, then keys a while later: nothing is raw.
  const s = scanner();
  s.feed("\x1b");
  s.wait(PASTE_PAUSE_MS);
  assert.deepEqual(s.feed("[200~\x1c"), [{ input: "[200~" }, { back: true, rest: "" }]);
});
