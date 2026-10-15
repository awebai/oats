import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_ATTRIBUTES, AGENT_STYLES_KEPT, ATTRIBUTES, COLORS, PLAIN, agentStyle, blankShows, colorEnabled, isStyle, sgr, style } from "../lib/term/style.mjs";

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

// ── The agent's own styles: drawn only in the terminal panel ─────────────────────────────────────

test("an agent's style keeps eight attributes, written in a fixed order: bold 1, dim 2, italic 3, underline 4, blink 5, reverse 7, invisible 8, strikethrough 9", () => {
  assert.deepEqual(AGENT_ATTRIBUTES, ["bold", "dim", "italic", "underline", "blink", "reverse", "invisible", "strikethrough"]);
  assert.deepEqual(AGENT_ATTRIBUTES.map((name) => sgr(agentStyle({ [name]: true }))), [[1], [2], [3], [4], [5], [7], [8], [9]]);
  assert.deepEqual(sgr(agentStyle({ strikethrough: true, bold: true, invisible: true, italic: true })), [1, 3, 8, 9]);
});

test("an agent's colours are the sixteen, 256 and RGB, foreground then background, each after the attributes", () => {
  assert.deepEqual(Array.from({ length: 16 }, (_, ansi) => sgr(agentStyle({ fg: { ansi } }))[0]), [30, 31, 32, 33, 34, 35, 36, 37, 90, 91, 92, 93, 94, 95, 96, 97]);
  assert.deepEqual(Array.from({ length: 16 }, (_, ansi) => sgr(agentStyle({ bg: { ansi } }))[0]), [40, 41, 42, 43, 44, 45, 46, 47, 100, 101, 102, 103, 104, 105, 106, 107]);
  assert.deepEqual(sgr(agentStyle({ fg: { index: 208 } })), [38, 5, 208]);
  assert.deepEqual(sgr(agentStyle({ bg: { index: 0 } })), [48, 5, 0]);
  assert.deepEqual(sgr(agentStyle({ fg: { rgb: [255, 0, 7] } })), [38, 2, 255, 0, 7]);
  assert.deepEqual(sgr(agentStyle({ bold: true, italic: true, fg: { index: 208 }, bg: { rgb: [1, 2, 3] } })), [1, 3, 38, 5, 208, 48, 2, 1, 2, 3]);
});

test("without colour an agent's colours are dropped, foreground and background, and its attributes stay", () => {
  assert.deepEqual(sgr(agentStyle({ bold: true, italic: true, fg: { index: 208 }, bg: { rgb: [1, 2, 3] } }), { color: false }), [1, 3]);
  assert.deepEqual(sgr(agentStyle({ bg: { ansi: 4 } }), { color: false }), []);
});

test("an agent's style is made from a state of named fields and checked colours: an unknown key, a colour out of range or of no known form, is refused", () => {
  for (const state of [{ overline: true }, { font: 1 }, { underlineColor: { index: 1 } }, { color: { ansi: 1 } }]) assert.throws(() => agentStyle(state), TypeError, JSON.stringify(state));
  for (const colour of [{ ansi: 16 }, { ansi: -1 }, { ansi: 1.5 }, { index: 256 }, { index: "1" }, { rgb: [1, 2] }, { rgb: [1, 2, 256] }, { rgb: [1, 2, -1] }, { rgb: "1;2;3" }, { ansi: 1, index: 1 }, "red", 31, [38, 5, 1]]) {
    assert.throws(() => agentStyle({ fg: colour }), TypeError, JSON.stringify(colour));
    assert.throws(() => agentStyle({ bg: colour }), TypeError, JSON.stringify(colour));
  }
  for (const state of [null, "bold", 1]) assert.throws(() => agentStyle(state), TypeError);
});

test("equal agent states are one value, frozen through, a style to the screen; the state with nothing set is PLAIN; and a theme style stays a theme style", () => {
  const a = agentStyle({ bold: true, fg: { rgb: [1, 2, 3] }, bg: { index: 9 } });
  assert.equal(a, agentStyle({ bg: { index: 9 }, fg: { rgb: [1, 2, 3] }, bold: true, dim: false }));
  assert.notEqual(a, agentStyle({ bold: true, fg: { rgb: [1, 2, 4] }, bg: { index: 9 } }));
  assert.notEqual(agentStyle({ fg: { ansi: 1 } }), agentStyle({ fg: { index: 1 } }), "the sixteen and the 256 are different colours to a terminal with its own theme");
  assert.equal(isStyle(a), true);
  assert.equal(Object.isFrozen(a) && Object.isFrozen(a.fg) && Object.isFrozen(a.fg.rgb) && Object.isFrozen(a.bg), true);
  assert.equal(agentStyle({}), PLAIN);
  assert.equal(agentStyle({ bold: false, fg: null, bg: null }), PLAIN);
  assert.notEqual(agentStyle({ bold: true, fg: { ansi: 1 } }), style({ bold: true, fg: "red" }), "the two kinds are made apart");
  for (const forged of [{ ...a }, Object.create(a), { agent: true, bold: true, fg: null, bg: null }]) {
    assert.equal(isStyle(forged), false);
    assert.throws(() => sgr(forged), TypeError);
    assert.throws(() => blankShows(forged), TypeError);
  }
});

test("only so many agent styles are kept: an agent that names a new colour per cell does not grow what the TUI holds, and the styles in use stay one value", () => {
  const kept = agentStyle({ fg: { rgb: [7, 7, 7] } });
  for (let n = 0; n < AGENT_STYLES_KEPT + 10; n++) {
    agentStyle({ bg: { rgb: [n & 255, (n >> 8) & 255, 1] } });
    if (n % 1000 === 0) assert.equal(agentStyle({ fg: { rgb: [7, 7, 7] } }), kept, "one asked for again is kept");
  }
  const recent = agentStyle({ bg: { rgb: [(AGENT_STYLES_KEPT + 9) & 255, ((AGENT_STYLES_KEPT + 9) >> 8) & 255, 1] } });
  assert.equal(agentStyle({ bg: { rgb: [(AGENT_STYLES_KEPT + 9) & 255, ((AGENT_STYLES_KEPT + 9) >> 8) & 255, 1] } }), recent);
  const gone = agentStyle({ bg: { rgb: [0, 0, 1] } });
  assert.equal(isStyle(gone), true, "a value let go and made again is a style all the same");
  assert.deepEqual(sgr(gone), [48, 2, 0, 0, 1]);
});

test("a blank shows in a style that paints it: underline, reverse, strikethrough, or a background with colour on", () => {
  assert.equal(blankShows(PLAIN), false);
  assert.equal(blankShows(style({ bold: true, fg: "red" })), false);
  assert.equal(blankShows(style({ underline: true })), true);
  assert.equal(blankShows(style({ reverse: true }), { color: false }), true);
  for (const name of ["underline", "reverse", "strikethrough"]) assert.equal(blankShows(agentStyle({ [name]: true }), { color: false }), true, name);
  for (const name of ["bold", "dim", "italic", "blink", "invisible"]) assert.equal(blankShows(agentStyle({ [name]: true })), false, name);
  assert.equal(blankShows(agentStyle({ fg: { rgb: [1, 2, 3] } })), false, "a foreground paints nothing on a blank");
  const bg = agentStyle({ bg: { index: 17 } });
  assert.equal(blankShows(bg), true);
  assert.equal(blankShows(bg, { color: false }), false, "without colour the background is not written");
});
