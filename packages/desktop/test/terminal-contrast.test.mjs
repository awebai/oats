// The terminal colour screen (test/fixtures/terminal-colors.mjs, #602): what a
// person runs in a Desktop terminal tab to look at the contrast floor in each
// theme. Held here to the groups of cases it must show. The module is imported
// and its string read: no process, no terminal, no xterm.
import test from "node:test";
import assert from "node:assert/strict";
import { terminalColorScreen } from "./fixtures/terminal-colors.mjs";

const screen = terminalColorScreen();
const sgr = (...params) => `\x1b[${params.join(";")}m`;
const ANSI = Array.from({ length: 16 }, (_, index) => index);
// 30–37 and 90–97 as text, 40–47 and 100–107 as background.
const fg = index => (index < 8 ? 30 + index : 82 + index);
const bg = index => (index < 8 ? 40 + index : 92 + index);
const has = (sequence, what) => assert.ok(screen.includes(sequence), `the screen has ${what} (${JSON.stringify(sequence)})`);

test("terminal colour screen: only SGR sequences, each one reset, and plain labels", () => {
  const sequences = screen.match(/\x1b\[[0-9;]*m/g) ?? [];
  const text = screen.replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(text, /^[\n\x20-\x7e─-▟]+$/, "nothing but SGR, printable ASCII, newlines and the box-drawing row");
  const resets = sequences.filter(sequence => sequence === sgr(0)).length;
  assert.ok(resets > 0);
  assert.equal(sequences.length - resets, resets, "every colour is reset before the next cell");
  assert.ok(screen.endsWith(`${sgr(0)}\n`), "the terminal is left in its default colours");
  assert.equal(terminalColorScreen(), screen, "the screen is the same on every run");
});

test("terminal colour screen: the 16 ANSI colours on the default background", () => {
  for (const index of ANSI) has(sgr(fg(index)), `ANSI ${index} as text`);
});

test("terminal colour screen: the 16 ANSI colours on each of the 16 ANSI backgrounds", () => {
  for (const text of ANSI) for (const back of ANSI) has(sgr(fg(text), bg(back)), `ANSI ${text} on ANSI ${back}`);
});

test("terminal colour screen: the default foreground on each ANSI background", () => {
  for (const index of ANSI) has(sgr(bg(index)), `the default foreground on ANSI ${index}`);
});

test("terminal colour screen: the 256-colour cube and greys on the default background", () => {
  for (let index = 16; index <= 255; index++) has(sgr(38, 5, index), `256-colour ${index} as text`);
});

test("terminal colour screen: a truecolour grey ramp, a hue ramp and explicit foreground-and-background pairs", () => {
  const texts = [...screen.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].map(match => match.slice(1, 4).map(Number));
  const greys = new Set(texts.filter(([r, g, b]) => r === g && g === b).map(([r]) => r));
  assert.ok(greys.size >= 8, `a grey ramp (${greys.size} steps)`);
  assert.ok(greys.has(0) && greys.has(255), "from black to white");
  const hues = new Set(texts.filter(([r, g, b]) => r !== g || g !== b).map(String));
  assert.ok(hues.size >= 12, `a hue ramp (${hues.size} hues)`);
  const pairs = new Set([...screen.matchAll(/\x1b\[38;2;\d+;\d+;\d+;48;2;\d+;\d+;\d+m/g)].map(String));
  assert.ok(pairs.size >= 3, `truecolour text on a truecolour background (${pairs.size} pairs)`);
});

test("terminal colour screen: the default foreground and the 16 ANSI colours, each dim and each bold", () => {
  for (const [name, code] of [["dim", 2], ["bold", 1]]) {
    has(sgr(code), `the default foreground, ${name}`);
    for (const index of ANSI) has(sgr(code, fg(index)), `ANSI ${index}, ${name}`);
  }
});

test("terminal colour screen: one row of coloured box drawing, labelled as excluded from the floor", () => {
  const lines = screen.split("\n");
  const rows = lines.filter(line => /[─-▟]/.test(line));
  assert.equal(rows.length, 1, "one row of box-drawing and block characters");
  const runs = [...rows[0].matchAll(/\x1b\[38;5;(\d+)m[─-▟]+\x1b\[0m/g)];
  assert.ok(runs.length >= 1, "drawn in a 256-colour grey");
  for (const [, index] of runs) assert.ok(Number(index) >= 232, `colour ${index} is one of the 24 greys`);
  const label = lines.slice(0, lines.indexOf(rows[0])).reverse().find(line => /^\d+\. /.test(line));
  assert.match(label, /U\+2500-259F.*excluded from the floor/, "the row's heading says xterm leaves these characters alone");
});
