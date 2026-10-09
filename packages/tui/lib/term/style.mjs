// Style values, by name. A style is the terminal's own sixteen colours and four attributes
// (docs/tui.md): no background, no 256-colour or RGB value, so the user's theme stays the theme.
// This module holds SGR parameters as numbers; the screen is what writes the sequence.

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
    parameters.set(value, Object.freeze({ attributes: attributes.map((name) => ATTRIBUTE[name]), colour: spec.fg === undefined ? [] : [FOREGROUND[spec.fg]] }));
    made.set(id, value);
  }
  return made.get(id);
}
export const PLAIN = style();
export const isStyle = (value) => parameters.has(value);

/** The SGR parameters of a style, attributes first. Without `color` the colour is dropped and the
 *  attributes stay. */
export function sgr(value, { color = true } = {}) {
  const own = parameters.get(value);
  if (!own) throw new TypeError("not a style value: make one with style()");
  return color ? [...own.attributes, ...own.colour] : [...own.attributes];
}

/** NO_COLOR (no-color.org): set and not empty switches colour off. */
export const colorEnabled = (env) => !(typeof env.NO_COLOR === "string" && env.NO_COLOR !== "");
