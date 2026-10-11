import test from "node:test";
import assert from "node:assert/strict";
import { ATTRIBUTES, COLORS, PLAIN, colorEnabled, isStyle, sgr, style } from "../lib/term/style.mjs";

test("the sixteen ANSI colours are SGR 30 to 37 and 90 to 97, and nothing else is a colour", () => {
  assert.deepEqual(COLORS.map((fg) => sgr(style({ fg }))), [...[30, 31, 32, 33, 34, 35, 36, 37], ...[90, 91, 92, 93, 94, 95, 96, 97]].map((n) => [n]));
  for (const fg of ["orange", "#ff0000", 196, "bgRed", "default", ""]) assert.throws(() => style({ fg }), TypeError, String(fg));
});

test("the four attributes are bold 1, dim 2, underline 4 and reverse 7, written before the colour", () => {
  assert.deepEqual(ATTRIBUTES, ["bold", "dim", "underline", "reverse"]);
  assert.deepEqual(ATTRIBUTES.map((name) => sgr(style({ [name]: true }))), [[1], [2], [4], [7]]);
  assert.deepEqual(sgr(style({ fg: "red", reverse: true, bold: true })), [1, 7, 31]);
  assert.deepEqual(sgr(PLAIN), []);
});

test("a style has no background, no 256-colour and no RGB value: an unknown key is refused", () => {
  for (const spec of [{ bg: "red" }, { background: "blue" }, { color: 196 }, { rgb: [1, 2, 3] }, { italic: true }, { blink: true }]) assert.throws(() => style(spec), TypeError, JSON.stringify(spec));
});

test("equal styles are one value, and only style() makes a style", () => {
  assert.equal(style({ bold: true, fg: "cyan" }), style({ fg: "cyan", bold: true }));
  assert.equal(style({ bold: false }), PLAIN);
  assert.notEqual(style({ bold: true }), style({ dim: true }));
  assert.equal(Object.isFrozen(style({ fg: "green" })), true);
  assert.equal(isStyle(style({ dim: true })), true);
  for (const forged of [{ fg: "red", bold: true, dim: false, underline: false, reverse: false }, { ...style({ bold: true }) }, "bold", null, [1]]) {
    assert.equal(isStyle(forged), false);
    assert.throws(() => sgr(forged), TypeError);
  }
});

test("NO_COLOR set and not empty drops the colour and keeps the attributes; empty or unset does not", () => {
  assert.equal(colorEnabled({}), true);
  assert.equal(colorEnabled({ NO_COLOR: "" }), true);
  assert.equal(colorEnabled({ NO_COLOR: "1" }), false);
  assert.equal(colorEnabled({ NO_COLOR: "0" }), false, "any value that is not empty switches colour off");
  const loud = style({ fg: "brightRed", bold: true, underline: true });
  assert.deepEqual(sgr(loud, { color: colorEnabled({ NO_COLOR: "1" }) }), [1, 4]);
  assert.deepEqual(sgr(loud, { color: colorEnabled({ NO_COLOR: "" }) }), [1, 4, 91]);
});
