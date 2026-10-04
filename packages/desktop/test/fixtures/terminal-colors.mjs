// The terminal colour screen: every kind of colour a program can ask a
// terminal for, as labelled SGR sequences. Run it inside a Desktop terminal
// tab and look at it in each theme (White, Solarized, Dark):
//
//   node packages/desktop/test/fixtures/terminal-colors.mjs
//
// Desktop gives xterm a minimum contrast ratio (TERMINAL_MINIMUM_CONTRAST,
// renderer/terminal-tab.mjs), so text must stay readable in every cell, on
// its own background; only the box drawing in the last row may be faint.
// Needs nothing but Node and writes only to stdout.
// test/terminal-contrast.test.mjs holds the screen to the groups below.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const paint = (params, text) => `${ESC}${params.join(";")}m${text}${RESET}`;
// The 16 ANSI colours: 30–37 and 90–97 as text, 40–47 and 100–107 as background.
const ansiFg = index => (index < 8 ? 30 + index : 82 + index);
const ansiBg = index => (index < 8 ? 40 + index : 92 + index);
const ANSI = Array.from({ length: 16 }, (_, index) => index);
const pad = (value, width) => String(value).padStart(width, " ");
const rows = (cells, perRow) => Array.from({ length: Math.ceil(cells.length / perRow) },
  (_, row) => cells.slice(row * perRow, (row + 1) * perRow).join(""));

// A fully saturated colour for a hue in degrees (HSL, lightness 50%).
function hue(degrees) {
  const part = (degrees % 60) / 60;
  const up = Math.round(255 * part), down = Math.round(255 * (1 - part));
  return [[255, up, 0], [down, 255, 0], [0, 255, up], [0, down, 255], [up, 0, 255], [255, 0, down]][Math.floor(degrees / 60) % 6];
}

// Truecolour text on a truecolour background: what a program written for one
// palette leaves behind in another.
const PAIRS = [
  ["light grey on white", [187, 187, 187], [255, 255, 255]],
  ["yellow on white", [255, 255, 0], [255, 255, 255]],
  ["dark grey on near black", [68, 68, 68], [16, 16, 16]],
  ["blue on black", [0, 0, 255], [0, 0, 0]],
  ["grey on the same grey", [128, 128, 128], [128, 128, 128]],
  ["white on navy", [255, 255, 255], [0, 0, 128]],
];

// Greys a program would pick for a border: the first is faint on a light
// background, the second on a dark one.
const BOX = "┌─┬─┐│├┼┤└┴┘░▒▓█";
const BOX_GREYS = [250, 238];

/** The whole screen, as one string of labelled lines. */
export function terminalColorScreen() {
  const lines = [];
  const section = (title, ...body) => lines.push("", title, ...body);

  lines.push("OATS Desktop terminal colours. Look at this screen in White, Solarized and Dark:",
    "text must stay readable in every cell. Only the box drawing in the last row may be faint.");

  section("1. The 16 ANSI colours on the default background",
    ANSI.map(fg => paint([ansiFg(fg)], ` ${pad(fg, 2)} `)).join(""));

  section("2. The 16 ANSI colours (rows) on the 16 ANSI backgrounds (columns)",
    `    ${ANSI.map(bg => ` ${pad(bg, 2)} `).join("")}`,
    ...ANSI.map(fg => ` ${pad(fg, 2)} ${ANSI.map(bg => paint([ansiFg(fg), ansiBg(bg)], ` ${pad(fg, 2)} `)).join("")}`));

  section("3. The default foreground on the 16 ANSI backgrounds",
    ANSI.map(bg => paint([ansiBg(bg)], ` ${pad(bg, 2)} `)).join(""));

  const indexed = (from, count) => Array.from({ length: count }, (_, i) => paint([38, 5, from + i], `${pad(from + i, 3)} `));
  section("4. 256 colours on the default background: the 6x6x6 cube (16-231)", ...rows(indexed(16, 216), 18));
  section("   and the 24 greys (232-255)", ...rows(indexed(232, 24), 12));

  const hex = value => value.toString(16).padStart(2, "0");
  section("5. Truecolour on the default background: a grey ramp",
    Array.from({ length: 16 }, (_, i) => paint([38, 2, i * 17, i * 17, i * 17], `${hex(i * 17)} `)).join(""));
  section("   a hue ramp (degrees)",
    ...rows(Array.from({ length: 24 }, (_, i) => paint([38, 2, ...hue(i * 15)], `${pad(i * 15, 3)} `)), 12));
  section("   and text on a background of its own",
    ...PAIRS.map(([label, fg, bg]) => `   ${paint([38, 2, ...fg, 48, 2, ...bg], ` ${label} `)}`));

  const styled = (name, code) => `${name} ${paint([code], "default ")}${ANSI.map(fg => paint([code, ansiFg(fg)], `${pad(fg, 2)} `)).join("")}`;
  section("6. Dim and bold: the default foreground and the 16 ANSI colours",
    styled("dim ", 2), styled("bold", 1));

  section("7. Box drawing and block elements (U+2500-259F) are excluded from the floor:",
    "   they keep the colour the program chose; the text beside them does not",
    `   ${BOX_GREYS.map(grey => `${paint([38, 5, grey], BOX)} ${paint([38, 5, grey], `text ${grey}`)}`).join("  ")}`);

  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(terminalColorScreen());
}
