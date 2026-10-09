// The frame: (state, size) -> rows of safe text. Pure: no IO, no clock, no escape byte.
// Every word here is the TUI's own, so every span is lit(). Meaning never rests on colour alone:
// what is dim or bold also says what it is in words.
import { keyLabel } from "../actions.mjs";
import { lit } from "../term/text.mjs";
import { style } from "../term/style.mjs";
import { help } from "./help.mjs";

/** The frame is drawn from this size up (docs/tui.md); the design size is 80x24. */
export const MIN_SIZE = Object.freeze({ cols: 60, rows: 15 });
/** The views to come, named so the frame already has its shape. Drawn dim: none can be opened yet. */
const VIEWS = Object.freeze(["1 Instances", "2 Souls", "3 Capabilities"]);
const BODY = Object.freeze(["This preview draws the frame only.", "Views arrive in later releases."]);
const GAP = 3;
/** The longest run one lit() holds with room to spare: the display filter bounds a line, and a
 *  terminal can be wider than that bound. */
const RUN = 500;

const BOLD = style({ bold: true });
const DIM = style({ dim: true });

/** Spans left to right from `col`, GAP cells apart. */
function inline(col, texts, look) {
  const spans = [];
  for (const text of texts) { spans.push({ col, text: lit(text), ...(look ? { style: look } : {}) }); col += text.length + GAP; }
  return spans;
}
const centred = (text, cols, look) => ({ col: Math.max(0, Math.floor((cols - text.length) / 2)), text: lit(text), ...(look ? { style: look } : {}) });
const tooSmall = (size) => size.cols < MIN_SIZE.cols || size.rows < MIN_SIZE.rows;

/** One row saying so, with the size found and the size needed. Short, and the sizes early: on a
 *  terminal this small the screen clips the end of the row. */
function tooSmallRows(size) {
  const rows = Array.from({ length: size.rows }, () => []);
  if (size.rows > 0) rows[0] = [{ col: 0, text: lit(`Terminal too small: ${size.cols}x${size.rows}, oats tui needs ${MIN_SIZE.cols}x${MIN_SIZE.rows}.`) }];
  return rows;
}

/** The whole screen for a state: `{ view: "frame" | "help", actions, ascii }`. */
export function frame(state, size) {
  if (tooSmall(size)) return tooSmallRows(size);
  const rows = Array.from({ length: size.rows }, () => []);
  const rule = [];
  for (let col = 0; col < size.cols; col += RUN) rule.push({ col, text: lit((state.ascii ? "-" : "\u2500").repeat(Math.min(RUN, size.cols - col))), style: DIM });
  const key = (id) => { const action = state.actions.find((a) => a.id === id); return action ? `${keyLabel(action.keys[0])} ${action.label}` : null; };

  rows[0] = [{ col: 0, text: lit("oats"), style: BOLD }, { col: size.cols - "preview".length, text: lit("preview") }];
  rows[1] = inline(0, VIEWS, DIM);
  rows[2] = rule;
  rows[size.rows - 2] = rule;
  rows[size.rows - 1] = inline(0, [key(state.view === "help" ? "close" : "help"), key("quit")].filter(Boolean));

  const top = 3, height = size.rows - 5;
  if (state.view === "help") help(state.actions, { cols: size.cols, rows: height }).forEach((spans, i) => { rows[top + i] = spans; });
  else {
    // One line where it fits, else a line per sentence.
    const lines = BODY.join(" ").length <= size.cols ? [BODY.join(" ")] : BODY;
    const first = top + Math.max(0, Math.floor((height - lines.length) / 2));
    lines.forEach((line, i) => { rows[first + i] = [centred(line, size.cols)]; });
  }
  return rows;
}
