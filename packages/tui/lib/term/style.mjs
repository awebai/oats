// Style values, of two kinds. This module holds SGR parameters as numbers; the screen is what writes
// the sequence, and a value only this module made is one it writes.
//
// The TUI's own: the terminal's sixteen colours and four attributes (docs/tui.md), `style()`. No
// background, no 256-colour or RGB value, so the user's theme stays the theme.
// The agent's own: what an agent's terminal set, read from its capture by term/capture.mjs and
// drawn only in the terminal panel, `agentStyle()`. Those colours are the agent's, not the TUI's,
// so this kind has a background and 256-colour and RGB values. It is still a closed set built
// from a state of named fields: nothing of the agent's sequence text is kept, only the numbers
// this module writes back for it.

const FOREGROUND = Object.freeze({
  black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37,
  brightBlack: 90, brightRed: 91, brightGreen: 92, brightYellow: 93, brightBlue: 94, brightMagenta: 95, brightCyan: 96, brightWhite: 97,
});
const ATTRIBUTE = Object.freeze({ bold: 1, dim: 2, underline: 4, reverse: 7 });
export const COLORS = Object.freeze(Object.keys(FOREGROUND));
export const ATTRIBUTES = Object.freeze(Object.keys(ATTRIBUTE));

/** One value per distinct style, so two equal styles are the same object and the screen compares
 *  cells by identity. */
const made = new Map();
const parameters = new WeakMap();

/** The style with that colour and those attributes: `style({ fg: "red", bold: true })`. */
export function style(spec = {}) {
  for (const key of Object.keys(spec)) if (key !== "fg" && !ATTRIBUTES.includes(key)) throw new TypeError(`unknown style key ${key}`);
  if (spec.fg !== undefined && !Object.hasOwn(FOREGROUND, spec.fg)) throw new TypeError("a style's colour is one of the sixteen ANSI names");
  const attributes = ATTRIBUTES.filter((name) => spec[name] === true);
  const id = [...attributes, spec.fg ?? ""].join(",");
  if (!made.has(id)) {
    const value = Object.freeze({ fg: spec.fg ?? null, ...Object.fromEntries(ATTRIBUTES.map((name) => [name, attributes.includes(name)])) });
    parameters.set(value, Object.freeze({ attributes: attributes.map((name) => ATTRIBUTE[name]), colour: spec.fg === undefined ? [] : [FOREGROUND[spec.fg]], background: false }));
    made.set(id, value);
  }
  return made.get(id);
}
export const PLAIN = style();
export const isStyle = (value) => parameters.has(value);

// ── The agent's own ──────────────────────────────────────────────────────────────────────────────

/** The attributes an agent's style keeps, in the order their parameters are written. Each is on
 *  or off: an underline's kind (curly, dotted) is not kept, so 4:3 is written back as 4. */
const AGENT_ATTRIBUTE = Object.freeze({ bold: 1, dim: 2, italic: 3, underline: 4, blink: 5, reverse: 7, invisible: 8, strikethrough: 9 });
export const AGENT_ATTRIBUTES = Object.freeze(Object.keys(AGENT_ATTRIBUTE));
const AGENT_KEYS = Object.freeze([...AGENT_ATTRIBUTES, "fg", "bg"]);
/** The agent's styles are interned apart and only so many are kept, the least recently made or
 *  asked for going first: an agent that writes a gradient in RGB names a new style per cell, and
 *  what the TUI keeps must not grow with what an agent writes. One that was let go and is asked
 *  for again is a new value, which costs the screen one rewrite of the rows it is in. */
export const AGENT_STYLES_KEPT = 4096;
const agentMade = new Map();

const isByte = (n) => Number.isInteger(n) && n >= 0 && n < 256;
/** A colour of an agent's style, checked and frozen: `null` (the terminal's default), `{ ansi: n }`
 *  one of the sixteen (0 to 15), `{ index: n }` one of 256, or `{ rgb: [r, g, b] }`. Anything else
 *  is refused: the parameters written for it are built from these numbers alone. */
function agentColour(colour) {
  if (colour === undefined || colour === null) return null;
  const keys = typeof colour === "object" ? Object.keys(colour) : [];
  if (keys.length === 1 && keys[0] === "ansi" && Number.isInteger(colour.ansi) && colour.ansi >= 0 && colour.ansi <= 15) return Object.freeze({ ansi: colour.ansi });
  if (keys.length === 1 && keys[0] === "index" && isByte(colour.index)) return Object.freeze({ index: colour.index });
  if (keys.length === 1 && keys[0] === "rgb" && Array.isArray(colour.rgb) && colour.rgb.length === 3 && colour.rgb.every(isByte)) return Object.freeze({ rgb: Object.freeze([...colour.rgb]) });
  throw new TypeError("an agent style's colour is null, { ansi: 0-15 }, { index: 0-255 } or { rgb: [r, g, b] } of 0-255");
}
const colourId = (colour) => (colour === null ? "" : "ansi" in colour ? `a${colour.ansi}` : "index" in colour ? `i${colour.index}` : `r${colour.rgb.join(".")}`);
/** The parameters of a colour: `base` is 30 for the foreground and 40 for the background, so the
 *  sixteen are base..base+7 and base+60..base+67, and the extended forms base+8 then 5;n or 2;r;g;b. */
function colourParameters(colour, base) {
  if (colour === null) return [];
  if ("ansi" in colour) return [colour.ansi < 8 ? base + colour.ansi : base + 60 + colour.ansi - 8];
  if ("index" in colour) return [base + 8, 5, colour.index];
  return [base + 8, 2, ...colour.rgb];
}

/** The style an agent's terminal set: `agentStyle({ bold: true, fg: { index: 208 }, bg: { rgb: [1, 2, 3] } })`,
 *  each attribute of AGENT_ATTRIBUTES true or absent, `fg` and `bg` a colour or null. Interned as
 *  style() is, so an equal state is the same value (of the AGENT_STYLES_KEPT last asked for). The state with nothing set is PLAIN, which the
 *  two kinds share: an agent's blank cell and the TUI's are one cell to the screen. */
export function agentStyle(state = {}) {
  if (state === null || typeof state !== "object") throw new TypeError("an agent style is made from a state object");
  for (const key of Object.keys(state)) if (!AGENT_KEYS.includes(key)) throw new TypeError(`unknown agent style key ${key}`);
  const attributes = AGENT_ATTRIBUTES.filter((name) => state[name] === true);
  const fg = agentColour(state.fg), bg = agentColour(state.bg);
  if (attributes.length === 0 && fg === null && bg === null) return PLAIN;
  const id = `${attributes.join(",")}|${colourId(fg)}|${colourId(bg)}`;
  let value = agentMade.get(id);
  if (value) { agentMade.delete(id); agentMade.set(id, value); return value; }
  value = Object.freeze({ agent: true, ...Object.fromEntries(AGENT_ATTRIBUTES.map((name) => [name, attributes.includes(name)])), fg, bg });
  parameters.set(value, Object.freeze({ attributes: attributes.map((name) => AGENT_ATTRIBUTE[name]), colour: [...colourParameters(fg, 30), ...colourParameters(bg, 40)], background: bg !== null }));
  agentMade.set(id, value);
  if (agentMade.size > AGENT_STYLES_KEPT) agentMade.delete(agentMade.keys().next().value);
  return value;
}

/** The SGR parameters of a style, attributes first and then the colours, foreground before
 *  background. Without `color` every colour is dropped and the attributes stay. */
export function sgr(value, { color = true } = {}) {
  const own = parameters.get(value);
  if (!own) throw new TypeError("not a style value: make one with style()");
  return color ? [...own.attributes, ...own.colour] : [...own.attributes];
}

/** Whether a blank cell in this style shows: a space draws nothing of its own, so it shows only by
 *  what the style paints across the whole cell, an underline, reverse video, a strikethrough or a
 *  background. Without `color` a background is not written, so a space with only one shows nothing. */
export function blankShows(value, { color = true } = {}) {
  const own = parameters.get(value);
  if (!own) throw new TypeError("not a style value: make one with style()");
  return value.underline || value.reverse || value.strikethrough === true || (color && own.background);
}

/** NO_COLOR (no-color.org): set and not empty switches colour off. */
export const colorEnabled = (env) => !(typeof env.NO_COLOR === "string" && env.NO_COLOR !== "");
