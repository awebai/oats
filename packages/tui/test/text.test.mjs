import test from "node:test";
import assert from "node:assert/strict";
import { DETAIL_WITHHELD } from "../lib/client.mjs";
import { EMPTY, WITHHELD, isSafeText, lit, shown, textOf } from "../lib/term/text.mjs";

const ESC = "\x1b";
/** What must never reach a terminal as it is, by name. */
const HOSTILE = {
  "ESC": `red ${ESC}[31m alert`,
  "a C1 control (U+009B, the 8-bit CSI)": "a\u009B31mb",
  "a bidi override (U+202E)": "safe\u202Etxt.exe",
  "a secret shape": "token: ghp_abcdefghijklmnopqrstuvwxyz0123",
};

test("lit() makes safe text of the TUI's own one-line words, and textOf() reads it back", () => {
  for (const words of ["oats", "? help", "This preview draws the frame only.", "───", "q, Ctrl+C"]) assert.equal(textOf(lit(words)), words);
});

test("lit() throws on ESC, a C1 control, a bidi override and a secret shape, and its message never repeats the text", () => {
  for (const [name, text] of Object.entries(HOSTILE)) {
    assert.throws(() => lit(text), (error) => error instanceof TypeError && !error.message.includes(text) && !/[\x00-\x1f\x7f-\x9f]/.test(error.message), name);
  }
});

test("lit() throws on anything the display filter would change: a run of spaces, a space at an end, a tab, a line break, nothing at all, not a string", () => {
  for (const text of ["two  spaces", " leading", "trailing ", "a\tb", "a\nb", "", " "]) assert.throws(() => lit(text), TypeError, JSON.stringify(text));
  for (const value of [null, undefined, 7, ["oats"], { toString: () => "oats" }]) assert.throws(() => lit(value), TypeError);
});

test("shown() answers the withheld mark for text the filter withholds whole, and the replaced line for the rest", () => {
  assert.equal(shown(HOSTILE["ESC"]), WITHHELD);
  assert.equal(shown(HOSTILE["a secret shape"]), WITHHELD);
  assert.equal(shown(DETAIL_WITHHELD), WITHHELD, "the filter's own mark is never shown as content");
  assert.equal(textOf(shown(HOSTILE["a C1 control (U+009B, the 8-bit CSI)"])), "a\uFFFD31mb");
  assert.equal(textOf(shown(HOSTILE["a bidi override (U+202E)"])), "safe\uFFFDtxt.exe");
  assert.equal(textOf(WITHHELD), "[withheld]");
  for (const [name, text] of Object.entries(HOSTILE)) assert.doesNotMatch(textOf(shown(text)), /[\x00-\x1f\x7f-\x9f\u202A-\u202E]/, name);
});

test("shown() folds a line to one line, and nothing to show is the empty value", () => {
  assert.equal(textOf(shown("dev-1")), "dev-1");
  assert.equal(textOf(shown("two\nlines\tand   spaces ")), "two lines and spaces");
  for (const nothing of [null, undefined, "", "   ", "\n", 42, {}]) assert.equal(shown(nothing), EMPTY);
  assert.equal(textOf(EMPTY), "");
});

test("safe text cannot be forged: a string, a look-alike object, a copy and a subclass are all refused", () => {
  const real = lit("oats");
  assert.equal(isSafeText(real), true);
  assert.equal(Object.isFrozen(real), true);
  assert.deepEqual(Reflect.ownKeys(real), [], "it carries no property a caller could read or set");
  const forgeries = ["oats", new String("oats"), { text: "oats" }, { ...real }, Object.create(real), Object.freeze(Object.create(null)), structuredClone({}), null, undefined, 0, Symbol("oats")];
  for (const forged of forgeries) {
    assert.equal(isSafeText(forged), false);
    assert.throws(() => textOf(forged), TypeError);
  }
});
