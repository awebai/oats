// An instance's colour (feature instance-color, awebai/oats#1421 §2) in the TUI: the state mark of an
// instance's row takes the row's colour through the souls' map (views/souls.mjs SOUL_COLOURS), by the
// shared rule of which colour a row shows (packages/client instance-presentation.mjs instanceColor).
// The mark's shape keeps the state: running ●, stopped ○, at its shell ◌ in the colour; unknown and held
// keep their own look whatever the colour; no colour, or one outside the palette, looks as before.
import test from "node:test";
import assert from "node:assert/strict";
import { instanceColor } from "../lib/client.mjs";
import { style } from "../lib/term/style.mjs";
import { LOOK, MARKS, markLook } from "../lib/views/instances.mjs";
import { SOUL_COLOURS } from "../lib/views/souls.mjs";
import { draw, drawnName, instanceRow, observed, stateOf } from "./helpers.mjs";

/** The style of the state mark on the list row that names `name` (its mark, a space, the name as words). */
function markStyle(d, name) {
  const words = drawnName(name);
  const row = d.lines.findIndex((line) => new RegExp(`[●○◌?◆] ${words}(\\s|$)`, "u").test(line));
  assert.ok(row >= 0, `${name} is drawn in the list`);
  const col = d.lines[row].indexOf(` ${words}`) - 1;
  return { mark: d.lines[row][col], style: d.cells[row][col].style };
}

test("instanceColor: a palette name exactly, else null", () => {
  for (const color of ["sand", "sage", "slate", "mauve", "clay", "olive"]) assert.equal(instanceColor({ color }), color);
  for (const color of [undefined, null, "", "Sage", " sage", "teal", 3, {}, ["sage"]]) assert.equal(instanceColor({ color }), null, JSON.stringify(color));
  assert.equal(instanceColor(null), null);
  assert.equal(instanceColor(undefined), null);
  assert.deepEqual(Object.keys(SOUL_COLOURS), ["sand", "sage", "slate", "mauve", "clay", "olive"], "every palette name has a terminal colour");
});

test("markLook: running, stopped and shell take the colour (the last two dim); unknown and held keep their own; no colour is LOOK", () => {
  assert.deepEqual(markLook("running", "blue"), style({ fg: "blue" }));
  assert.deepEqual(markLook("stopped", "red"), style({ fg: "red", dim: true }));
  assert.deepEqual(markLook("shell", "red"), style({ fg: "red", dim: true }));
  assert.deepEqual(markLook("unknown", "blue"), LOOK.unknown);
  assert.deepEqual(markLook("held", "blue"), LOOK.held);
  for (const mark of Object.keys(LOOK)) assert.deepEqual(markLook(mark, null), LOOK[mark], mark);
});

test("no state mark is yellow, which says needs input and only that: unknown is dim in the default foreground, its shape saying it", () => {
  assert.deepEqual(LOOK.unknown, style({ dim: true }));
  for (const [mark, look] of Object.entries(LOOK)) assert.equal(look.fg === "yellow" || look.fg === "brightYellow", false, mark);
});

test("the Instances list draws each row's mark in its colour, its shape still saying its state", () => {
  // The first row is the selected one, drawn in reverse video whatever its colour: none of the four.
  const rows = [
    instanceRow("dev", "aaa-selected"),
    instanceRow("dev", "dev-slate", { color: "slate" }),
    instanceRow("dev", "dev-clay", { color: "clay", running: false, runtimeState: null }),
    instanceRow("dev", "dev-teal", { color: "teal" }),
    instanceRow("dev", "dev-plain"),
  ];
  const d = draw(stateOf(observed(rows)), { cols: 100, rows: 24 });
  assert.deepEqual(markStyle(d, "dev-slate"), { mark: MARKS.utf8.running, style: style({ fg: SOUL_COLOURS.slate }) });
  assert.deepEqual(markStyle(d, "dev-clay"), { mark: MARKS.utf8.stopped, style: style({ fg: SOUL_COLOURS.clay, dim: true }) });
  assert.deepEqual(markStyle(d, "dev-teal"), { mark: MARKS.utf8.running, style: LOOK.running }, "a colour outside the palette is none");
  assert.deepEqual(markStyle(d, "dev-plain"), { mark: MARKS.utf8.running, style: LOOK.running }, "no colour looks as before");
});
