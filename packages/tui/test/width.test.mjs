import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_GRAPHEME_UNITS, REPLACEMENT, WIDE_RANGES, cells, graphemeWidth, textWidth } from "../lib/term/width.mjs";

const cell = (text, width) => ({ text, width });
const replaced = cell(REPLACEMENT, 1);
const UNWRITABLE = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u;

/** Seeded linear congruential generator: the same sequence on every run. */
function generator(seed) {
  let state = seed >>> 0;
  return (bound) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * bound);
  };
}

test("the replacement is U+FFFD and the grapheme limit is 32 UTF-16 units", () => {
  assert.equal(REPLACEMENT, "\uFFFD");
  assert.equal(MAX_GRAPHEME_UNITS, 32);
});

test("printable ASCII is one cell per character", () => {
  assert.deepEqual(cells(""), []);
  assert.deepEqual(cells("a ~"), [cell("a", 1), cell(" ", 1), cell("~", 1)]);
  const all = Array.from({ length: 0x7f - 0x20 }, (_, index) => String.fromCharCode(0x20 + index)).join("");
  assert.deepEqual(cells(all), [...all].map((character) => cell(character, 1)));
  assert.equal(textWidth(all), 95);
});

test("ASCII measures the same beside a non-ASCII character as on the fast path", () => {
  assert.deepEqual(cells("abé"), [cell("a", 1), cell("b", 1), cell("é", 1)]);
});

test("a precomposed accented letter is one cell", () => {
  assert.deepEqual(cells("éñü"), [cell("é", 1), cell("ñ", 1), cell("ü", 1)]);
});

test("a letter with a combining accent is one cell and keeps its mark", () => {
  assert.deepEqual(cells("e\u0301"), [cell("e\u0301", 1)]);
  assert.deepEqual(cells("ne\u0301e"), [cell("n", 1), cell("e\u0301", 1), cell("e", 1)]);
  assert.deepEqual(cells("a\u0308\u0301"), [cell("a\u0308\u0301", 1)]);
});

test("CJK ideographs, kana, Hangul syllables and fullwidth Latin are two cells each", () => {
  for (const character of [
    "漢", // ideograph
    "㐀", // Extension A
    "\u{20000}", // Extension B
    "あ", // hiragana
    "ア", // katakana
    "한", // Hangul syllable
    "Ａ", // fullwidth A
    "！", // fullwidth exclamation mark
    "、", // ideographic comma
  ]) {
    assert.deepEqual(cells(character), [cell(character, 2)], `U+${character.codePointAt(0).toString(16)}`);
  }
  assert.equal(textWidth("日本語"), 6);
});

test("conjoining Hangul jamo are one grapheme of two cells", () => {
  assert.deepEqual(cells("한"), [cell("한", 2)]);
});

test("halfwidth katakana is one cell", () => {
  assert.deepEqual(cells("ｱｲ"), [cell("ｱ", 1), cell("ｲ", 1)]);
});

test("East Asian Ambiguous characters are one cell, the rule character U+2500 among them", () => {
  for (const character of ["±", "─", "…", "α", "│", "§", "㉈"]) {
    assert.deepEqual(cells(character), [cell(character, 1)], `U+${character.codePointAt(0).toString(16)}`);
  }
  assert.equal(textWidth("─".repeat(40)), 40);
});

test("U+303F, the narrow code point at the end of the CJK symbols, is one cell", () => {
  assert.deepEqual(cells("〾〿"), [cell("〾", 2), cell("〿", 1)]);
});

test("a combining mark with no base is dropped", () => {
  assert.deepEqual(cells("\u0301"), []);
  assert.deepEqual(cells("\u0301\u0308"), []);
  assert.deepEqual(cells("\u20DD"), []); // enclosing circle (Me)
  assert.deepEqual(cells("\uFE0F"), []);
  assert.equal(textWidth("\u0301"), 0);
});

test("a wide combining mark is dropped alone and stays with its base", () => {
  assert.deepEqual(cells("\u3099"), []);
  assert.deepEqual(cells("か\u3099"), [cell("か\u3099", 2)]);
});

test("a spacing combining mark takes a cell", () => {
  assert.deepEqual(cells("\u093E"), [cell("\u093E", 1)]); // Devanagari vowel sign aa (Mc)
});

test("a zero-width joiner, a direction mark or a soft hyphen alone is dropped", () => {
  for (const character of ["\u200D", "\u200E", "\u200F", "\u00AD", "\u061C", "\u200B", "\u2060", "\uFEFF"]) {
    assert.deepEqual(cells(character), [], `U+${character.codePointAt(0).toString(16)}`);
    assert.equal(graphemeWidth(character), 0);
  }
  assert.deepEqual(cells("a\u200Eb\u00ADc"), [cell("a", 1), cell("b", 1), cell("c", 1)]);
});

test("an emoji is two cells", () => {
  assert.deepEqual(cells("\u{1F600}"), [cell("\u{1F600}", 2)]);
  assert.deepEqual(cells("⌚"), [cell("⌚", 2)]); // watch: emoji presentation in the BMP
  assert.deepEqual(cells("a\u{1F680}b"), [cell("a", 1), cell("\u{1F680}", 2), cell("b", 1)]);
});

test("an emoji ZWJ sequence is one grapheme of two cells", () => {
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}";
  const technologist = "\u{1F469}\u200D\u{1F4BB}";
  const rainbowFlag = "\u{1F3F3}\uFE0F\u200D\u{1F308}";
  const unqualifiedRainbowFlag = "\u{1F3F3}\u200D\u{1F308}";
  for (const sequence of [family, technologist, rainbowFlag, unqualifiedRainbowFlag]) {
    assert.deepEqual(cells(sequence), [cell(sequence, 2)]);
  }
  assert.equal(textWidth(family + technologist), 4);
});

test("a flag is one grapheme of two cells", () => {
  const spain = "\u{1F1EA}\u{1F1F8}";
  const england = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
  assert.deepEqual(cells(spain), [cell(spain, 2)]);
  assert.deepEqual(cells(england), [cell(england, 2)]);
  assert.deepEqual(cells(spain + spain), [cell(spain, 2), cell(spain, 2)]);
});

test("a text-presentation symbol is one cell, and two with the emoji variation selector", () => {
  assert.deepEqual(cells("❤"), [cell("❤", 1)]);
  assert.deepEqual(cells("❤\uFE0F"), [cell("❤\uFE0F", 2)]);
  assert.deepEqual(cells("©"), [cell("©", 1)]);
  assert.deepEqual(cells("©\uFE0F"), [cell("©\uFE0F", 2)]);
});

test("a keycap sequence is two cells, and its digit without the keycap stays one", () => {
  for (const base of ["1", "#", "*"]) {
    assert.deepEqual(cells(`${base}\uFE0F\u20E3`), [cell(`${base}\uFE0F\u20E3`, 2)]);
    assert.deepEqual(cells(`${base}\uFE0F`), [cell(`${base}\uFE0F`, 1)]);
    assert.deepEqual(cells(`${base}\u20E3`), [cell(`${base}\u20E3`, 1)]);
  }
});

test("an emoji with a skin tone is one grapheme of two cells", () => {
  const thumbsUp = "\u{1F44D}\u{1F3FD}";
  const pointingUp = "☝\u{1F3FD}"; // the base alone has text presentation
  assert.deepEqual(cells(thumbsUp), [cell(thumbsUp, 2)]);
  assert.deepEqual(cells(pointingUp), [cell(pointingUp, 2)]);
  assert.deepEqual(cells("☝"), [cell("☝", 1)]);
});

test("a grapheme longer than the limit becomes one replacement cell", () => {
  assert.deepEqual(cells(`a${"\u0301".repeat(500)}`), [replaced]);
  assert.deepEqual(cells(`x${"\u0301".repeat(500)}y`), [replaced, cell("y", 1)]);
  assert.deepEqual(cells("\u200D".repeat(MAX_GRAPHEME_UNITS + 1)), [replaced]);
});

test("a grapheme of exactly the limit is kept, and one unit more is replaced", () => {
  const atLimit = `a${"\u0301".repeat(MAX_GRAPHEME_UNITS - 1)}`;
  assert.equal(atLimit.length, MAX_GRAPHEME_UNITS);
  assert.deepEqual(cells(atLimit), [cell(atLimit, 1)]);
  assert.deepEqual(cells(`${atLimit}\u0301`), [replaced]);
});

test("a lone surrogate becomes a replacement cell and a surrogate pair does not", () => {
  assert.deepEqual(cells("\uD83D"), [replaced]);
  assert.deepEqual(cells("\uDE00"), [replaced]);
  assert.deepEqual(cells("a\uD83Db"), [cell("a", 1), replaced, cell("b", 1)]);
  assert.deepEqual(cells("\uDE00\uD83D"), [replaced, replaced]);
  assert.deepEqual(cells("😀"), [cell("\u{1F600}", 2)]);
});

test("a control character becomes a replacement cell and is never written", () => {
  for (const control of ["\x1b", "\x07", "\x00", "\t", "\n", "\r", "\x7f", "\u0080", "\u009B", "\u009F"]) {
    assert.deepEqual(cells(control), [replaced], `U+${control.codePointAt(0).toString(16)}`);
  }
  assert.deepEqual(cells("\r\n"), [replaced]);
  assert.deepEqual(cells("ab\n"), [cell("a", 1), cell("b", 1), replaced]);
  assert.equal(textWidth("ab\n"), 3);
  assert.deepEqual(cells("\x1b[31m"), [replaced, cell("[", 1), cell("3", 1), cell("1", 1), cell("m", 1)]);
  assert.deepEqual(cells("a\u009Bb\x07"), [cell("a", 1), replaced, cell("b", 1), replaced]);
});

test("a line or paragraph separator becomes a replacement cell", () => {
  assert.deepEqual(cells("\u2028"), [replaced]);
  assert.deepEqual(cells("a\u2029b"), [cell("a", 1), replaced, cell("b", 1)]);
});

test("graphemeWidth answers 0, 1 or 2, and 1 for a grapheme that is replaced", () => {
  assert.equal(graphemeWidth(""), 0);
  assert.equal(graphemeWidth("\u0301"), 0);
  assert.equal(graphemeWidth("a"), 1);
  assert.equal(graphemeWidth("e\u0301"), 1);
  assert.equal(graphemeWidth("漢"), 2);
  assert.equal(graphemeWidth("\u{1F600}"), 2);
  assert.equal(graphemeWidth("\x1b"), 1);
  assert.equal(graphemeWidth("\uD83D"), 1);
  assert.equal(graphemeWidth(`a${"\u0301".repeat(500)}`), 1);
});

test("textWidth is the sum of the cells of a text", () => {
  const samples = [
    ["", 0],
    ["oats tui", 8],
    ["漢字 ok", 7],
    ["e\u0301\u0301 \u{1F600}\u200D", 4],
    ["\u{1F1EA}\u{1F1F8} ❤\uFE0F ❤", 7],
    ["\x1b[0m\u200Eｱ", 5],
  ];
  for (const [text, width] of samples) {
    assert.equal(textWidth(text), width, JSON.stringify(text));
    assert.equal(textWidth(text), cells(text).reduce((total, each) => total + each.width, 0));
  }
});

test("the wide range table is sorted, its ranges do not touch, and it stays small", () => {
  assert.ok(WIDE_RANGES.length > 0 && WIDE_RANGES.length < 40);
  let previousLast = -1;
  for (const [first, last] of WIDE_RANGES) {
    assert.ok(Number.isInteger(first) && Number.isInteger(last) && first <= last && last <= 0x10ffff);
    assert.ok(first > previousLast + 1, `U+${first.toString(16)} touches or precedes the range before it`);
    previousLast = last;
  }
});

test("the first and last code point of every wide range is two cells", () => {
  for (const range of WIDE_RANGES) {
    for (const codePoint of range) {
      const character = String.fromCodePoint(codePoint);
      assert.deepEqual(cells(character), [cell(character, 2)], `U+${codePoint.toString(16)}`);
    }
  }
});

test("the code points on either side of a wide range are not wide unless they are emoji", () => {
  for (const [first, last] of WIDE_RANGES) {
    for (const codePoint of [first - 1, last + 1]) {
      const character = String.fromCodePoint(codePoint);
      if (/^\p{Emoji_Presentation}/u.test(character)) continue;
      assert.notEqual(graphemeWidth(character), 2, `U+${codePoint.toString(16)}`);
    }
  }
});

test("any single code point yields at most one cell of width 1 or 2 and never a control", () => {
  const next = generator(0x0a75);
  for (let round = 0; round < 5000; round++) {
    // A third each from the controls and marks, the BMP, and every plane.
    const codePoint = next([0x0300, 0x10000, 0x110000][round % 3]);
    let result;
    assert.doesNotThrow(() => { result = cells(String.fromCodePoint(codePoint)); }, `U+${codePoint.toString(16)}`);
    assert.ok(result.length <= 1, `U+${codePoint.toString(16)}`);
    for (const each of result) {
      assert.ok(each.width === 1 || each.width === 2, `U+${codePoint.toString(16)}`);
      assert.doesNotMatch(each.text, UNWRITABLE);
    }
  }
});

test("any sequence of code points yields bounded cells of width 1 or 2 that sum to its width", () => {
  const next = generator(0x7e57);
  // Weighted toward what joins into graphemes: marks, joiners, selectors, emoji, controls.
  const pools = [
    () => next(0x0300),
    () => 0x0300 + next(0x70),
    () => [0x200d, 0xfe0f, 0xfe0e, 0x20e3, 0x200e, 0x00ad, 0x000d, 0x000a][next(8)],
    () => 0x1f1e6 + next(26),
    () => 0x1f300 + next(0x700),
    () => 0xd800 + next(0x800),
    () => next(0x110000),
  ];
  for (let round = 0; round < 2000; round++) {
    const length = 1 + next(40);
    let text = "";
    for (let index = 0; index < length; index++) text += String.fromCodePoint(pools[next(pools.length)]());
    let result;
    assert.doesNotThrow(() => { result = cells(text); }, JSON.stringify(text));
    let total = 0;
    for (const each of result) {
      assert.ok(each.width === 1 || each.width === 2, JSON.stringify(text));
      assert.ok(each.text.length >= 1 && each.text.length <= MAX_GRAPHEME_UNITS, JSON.stringify(text));
      assert.doesNotMatch(each.text, UNWRITABLE);
      total += each.width;
    }
    assert.equal(textWidth(text), total, JSON.stringify(text));
  }
});
