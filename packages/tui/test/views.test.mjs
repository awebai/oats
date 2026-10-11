import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS } from "../lib/actions.mjs";
import { isSafeText } from "../lib/term/text.mjs";
import { isStyle } from "../lib/term/style.mjs";
import { MIN_SIZE, frame } from "../lib/views/frame.mjs";
import { help } from "../lib/views/help.mjs";
import { rowStrings } from "./helpers.mjs";

const state = (over = {}) => ({ view: "frame", ascii: false, actions: ACTIONS, ...over });
const draw = (st, cols, rows) => rowStrings(frame(st, { cols, rows }), cols);
/** A screen of `rows` rows, empty but for the ones given by index. */
const screenOf = (rows, given) => Array.from({ length: rows }, (_, r) => given[r] ?? "");
const RULE = "─";

test("the frame at 80x24: the name and the preview mark, the three view names, a rule, the one centred line, a rule, the keys", () => {
  assert.deepEqual(draw(state(), 80, 24), screenOf(24, {
    0: `oats${" ".repeat(69)}preview`,
    1: "1 Instances   2 Souls   3 Capabilities",
    2: RULE.repeat(80),
    12: `${" ".repeat(7)}This preview draws the frame only. Views arrive in later releases.`,
    22: RULE.repeat(80),
    23: "? help   q quit",
  }));
});

test("the frame at 120x40 keeps its shape: the mark at the right edge, the line centred in the larger body", () => {
  assert.deepEqual(draw(state(), 120, 40), screenOf(40, {
    0: `oats${" ".repeat(109)}preview`,
    1: "1 Instances   2 Souls   3 Capabilities",
    2: RULE.repeat(120),
    20: `${" ".repeat(27)}This preview draws the frame only. Views arrive in later releases.`,
    38: RULE.repeat(120),
    39: "? help   q quit",
  }));
});

test("the frame at 60x15, the smallest it is drawn at: the body line does not fit, so each sentence has its row", () => {
  assert.deepEqual(draw(state(), 60, 15), screenOf(15, {
    0: `oats${" ".repeat(49)}preview`,
    1: "1 Instances   2 Souls   3 Capabilities",
    2: RULE.repeat(60),
    7: `${" ".repeat(13)}This preview draws the frame only.`,
    8: `${" ".repeat(14)}Views arrive in later releases.`,
    13: RULE.repeat(60),
    14: "? help   q quit",
  }));
});

test("in ASCII the rules are hyphens and nothing in the frame is outside ASCII, at every size", () => {
  assert.deepEqual(draw(state({ ascii: true }), 80, 24), screenOf(24, {
    0: `oats${" ".repeat(69)}preview`,
    1: "1 Instances   2 Souls   3 Capabilities",
    2: "-".repeat(80),
    12: `${" ".repeat(7)}This preview draws the frame only. Views arrive in later releases.`,
    22: "-".repeat(80),
    23: "? help   q quit",
  }));
  for (const [cols, rows] of [[80, 24], [120, 40], [60, 15], [59, 14]]) {
    for (const view of ["frame", "help"]) assert.doesNotMatch(draw(state({ ascii: true, view }), cols, rows).join("\n"), /[^\x20-\x7e\n]/, `${view} at ${cols}x${rows}`);
  }
  assert.deepEqual(draw(state({ ascii: true }), 60, 15)[13], "-".repeat(60));
  assert.deepEqual(draw(state({ ascii: true }), 120, 40)[38], "-".repeat(120));
});

test("below 60x15 the screen is one line: the terminal is too small, the size found and the size needed", () => {
  assert.deepEqual(MIN_SIZE, { cols: 60, rows: 15 });
  for (const ascii of [false, true]) {
    assert.deepEqual(draw(state({ ascii }), 59, 14), screenOf(14, { 0: "Terminal too small: 59x14, oats tui needs 60x15." }));
    assert.deepEqual(draw(state({ ascii, view: "help" }), 59, 14), screenOf(14, { 0: "Terminal too small: 59x14, oats tui needs 60x15." }), "whatever view is open");
  }
  assert.equal(draw(state(), 59, 24)[0], "Terminal too small: 59x24, oats tui needs 60x15.", "too narrow alone");
  assert.equal(draw(state(), 200, 14)[0], "Terminal too small: 200x14, oats tui needs 60x15.", "too short alone");
  assert.equal(draw(state(), 60, 15)[0].startsWith("oats"), true, "60x15 itself is drawn");
  assert.deepEqual(frame(state(), { cols: 20, rows: 0 }), [], "no row, no line");
});

test("the help at 80x24: the frame around it, one row per action of the table, and how to close it", () => {
  assert.deepEqual(draw(state({ view: "help" }), 80, 24), screenOf(24, {
    0: `oats${" ".repeat(69)}preview`,
    1: "1 Instances   2 Souls   3 Capabilities",
    2: RULE.repeat(80),
    4: "  Keys",
    6: "  ?           help",
    7: "  Esc         close",
    8: "  q, Ctrl+C   quit",
    9: "  Ctrl+Z      suspend",
    10: "  Ctrl+L      redraw",
    12: "  Esc or ? closes this help",
    22: RULE.repeat(80),
    23: "Esc close   q quit",
  }));
});

test("the help fits the smallest frame, 60x15, and keeps every action", () => {
  assert.deepEqual(draw(state({ view: "help" }), 60, 15), screenOf(15, {
    0: `oats${" ".repeat(49)}preview`,
    1: "1 Instances   2 Souls   3 Capabilities",
    2: RULE.repeat(60),
    4: "  Keys",
    6: "  ?           help",
    7: "  Esc         close",
    8: "  q, Ctrl+C   quit",
    9: "  Ctrl+Z      suspend",
    10: "  Ctrl+L      redraw",
    12: "  Esc or ? closes this help",
    13: RULE.repeat(60),
    14: "Esc close   q quit",
  }));
});

test("the help is generated from the table it is given: other keys and another action appear as given, and no key it was not given", () => {
  const actions = [{ id: "help", keys: ["f1"], label: "help" }, { id: "close", keys: ["ctrl+g", "escape"], label: "close" }, { id: "quit", keys: ["ctrl+q"], label: "leave" }, { id: "open", keys: ["enter", "o"], label: "open the agent" }];
  const rows = rowStrings(help(actions, { cols: 60, rows: 12 }), 60);
  assert.deepEqual(rows, ["", "  Keys", "", "  F1            help", "  Ctrl+G, Esc   close", "  Ctrl+Q        leave", "  Enter, o      open the agent", "", "  Ctrl+G or F1 closes this help", "", "", ""]);
  const framed = draw(state({ actions, view: "frame" }), 80, 24);
  assert.equal(framed[23], "F1 help   Ctrl+Q leave", "the last row names the keys of the table, too");
  assert.doesNotMatch([...rows, ...framed].join("\n"), /\?|\bq\b|Ctrl\+C/);
});

test("a terminal wider than the display filter's longest line still gets its rules, edge to edge", () => {
  const rows = draw(state(), 3000, 20);
  assert.equal(rows[2], RULE.repeat(3000));
  assert.equal(rows[18], RULE.repeat(3000));
  assert.equal(rows[0].endsWith("preview") && rows[0].length === 3000, true);
});

test("a view answers one row per screen row, and every span is safe text with a style value", () => {
  for (const [cols, rows] of [[80, 24], [120, 40], [60, 15], [59, 14], [1, 1]]) {
    for (const view of ["frame", "help"]) {
      const drawn = frame(state({ view }), { cols, rows });
      assert.equal(drawn.length, rows);
      for (const span of drawn.flat()) {
        assert.equal(isSafeText(span.text), true);
        assert.equal(span.style === undefined || isStyle(span.style), true);
        assert.equal(Number.isInteger(span.col) && span.col >= 0, true);
      }
    }
  }
});
