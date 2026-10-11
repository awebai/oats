// The kernel's set is the floor of the clients' display filter (awebai/oats#855, section 2,
// term 7). The kernel never stores or prints a REFUSED_TEXT character in text it did not write
// (lib/refused-text.mjs); the Desktop and the TUI show such text through the shared
// displayLine (packages/client/display-text.mjs). This test imports both sides, which neither
// side does of the other, and proves the client filter refuses at least the kernel's set.
import test from "node:test";
import assert from "node:assert/strict";
import { REFUSED_TEXT } from "../lib/refused-text.mjs";
import { DETAIL_WITHHELD, displayLine } from "../packages/client/display-text.mjs";
import { shown, textOf } from "../packages/tui/lib/term/text.mjs";

/** Every code point the kernel's set holds, found by asking the set: no second list to keep in step. */
function refusedCodePoints() {
  assert.equal(REFUSED_TEXT instanceof RegExp && REFUSED_TEXT.unicode && !REFUSED_TEXT.global && !REFUSED_TEXT.sticky, true, "REFUSED_TEXT is a plain u-flag expression: test() keeps no state");
  const points = [];
  for (let cp = 0; cp <= 0x10FFFF; cp++) {
    if (cp >= 0xD800 && cp <= 0xDFFF) continue; // a surrogate is not a character
    if (REFUSED_TEXT.test(String.fromCodePoint(cp))) points.push(cp);
  }
  return points;
}
const name = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

test("the shared client filter refuses at least the kernel's REFUSED_TEXT: no character of the set comes back from displayLine, alone, inside a text, or at its ends", () => {
  const refused = refusedCodePoints();
  // The set as the kernel states it: C0, DEL and C1, the two separators, the bidi controls,
  // the three invisible hiders and the tag block. A smaller set here means the reading broke.
  assert.equal(refused.length >= 65 + 2 + 9 + 3 + 128, true, `${refused.length} characters read from the kernel's set`);
  for (const sample of [0x00, 0x09, 0x0A, 0x0D, 0x1B, 0x7F, 0x9B, 0x2028, 0x202E, 0x2066, 0x200B, 0x2060, 0xFEFF, 0xE0001, 0xE007F]) assert.equal(refused.includes(sample), true, name(sample));
  const leaks = [];
  for (const cp of refused) {
    const ch = String.fromCodePoint(cp);
    for (const text of [ch, `name${ch}more`, `${ch}name`, `name${ch}`, `a ${ch} b`, ch.repeat(3)]) {
      const line = displayLine(text);
      // Refused is: nothing to show, withheld whole, or shown without the character
      // (tab and line feed fold to a space, the rest become U+FFFD).
      if (line !== null && line !== DETAIL_WITHHELD && line.includes(ch)) leaks.push(`${name(cp)} in ${JSON.stringify(text)}`);
      if (line === text) leaks.push(`${name(cp)}: ${JSON.stringify(text)} came back unchanged`);
    }
  }
  assert.deepEqual(leaks, [], "if this fails, do not edit display-text.mjs here: report the characters to its owner");
});

test("so the TUI's safe text holds no character of the kernel's set, however it was made", () => {
  for (const cp of refusedCodePoints()) {
    const ch = String.fromCodePoint(cp);
    assert.equal(REFUSED_TEXT.test(textOf(shown(`dev${ch}-1`))), false, name(cp));
  }
});

test("the filter keeps what the kernel allows: ZWJ and ZWNJ, the direction marks and ordinary text are shown as they are", () => {
  for (const text of ["dev-1", "café", "中文", "\u{1F468}\u200D\u{1F4BB}", "می\u200Cخواهم", "a\u200Eb", "a\u200Fb", "a\u061Cb"]) {
    assert.equal(REFUSED_TEXT.test(text), false);
    assert.equal(displayLine(text), text);
  }
});
