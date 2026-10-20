/** keys.json, the one preference both clients share about their keys: which chord family they bind
 * on Linux and Windows (packages/client/keymap.mjs CHORD_FAMILIES). It is `config/keys.json` in OATS's
 * own directory of this user, beside the TUI's tui.json, and resolved the same way: `$OATS_HOME_DIR`
 * when that is set and not empty, else `<home>/.oats`. Its shape: `{ "chords": "ctrl+alt" | "ctrl+shift" }`.
 *
 * The file is the clients'; the kernel never reads it. Each client does its own IO and hands the text
 * here: the TUI at its start, the Desktop in its main process, which hands the family to its renderer
 * and is the one that writes the file (keysWithFamily). Pure: no fs, no state.
 *
 *   keysPath(env, home)          -> the file's path
 *   chordFamilyFrom(text, error) -> { family, why }: the family to bind, and why it is the default
 *   chordFamilyNote(read)        -> the one line a client shows when the file was not taken, or null
 *   keysWithFamily(text, family) -> the file's new text: `chords` set, every other key kept
 *
 * Every way the file can fail means the default, Ctrl+Alt: none is an error the user must clear. */
import { join } from "node:path";
import { CHORD_FAMILIES, DEFAULT_CHORD_FAMILY } from "./keymap.mjs";

/** The most a client reads of the file: anything longer is not a keys.json. */
export const KEYS_LIMIT = 16384;

/** Why the family is the default, by the `why` chordFamilyFrom answers; null: the file chose it. */
export const KEYS_WHY = Object.freeze({
  missing: "there is no keys.json",
  unreadable: "keys.json cannot be read",
  "too-large": "keys.json is too large",
  "not-json": "keys.json is not JSON",
  "not-object": "keys.json is not an object",
  "no-chords": "keys.json names no chords",
  "unknown-chords": "keys.json: unknown chords value",
});

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** The path of keys.json: `config/keys.json` in `$OATS_HOME_DIR` when that is set and not empty, else
 *  in `<home>/.oats` (the TUI's configPath for tui.json, packages/tui/lib/config.mjs). */
export function keysPath(env, home) {
  const own = env?.OATS_HOME_DIR;
  return join(typeof own === "string" && own !== "" ? own : join(home, ".oats"), "config", "keys.json");
}

/** The family keys.json names. `text` is the file's text, or null or undefined when there is none;
 *  `error` the error its read threw, if one did (ENOENT and ENOTDIR are no file, any other is a file
 *  that cannot be read). Answers a frozen `{ family, why }`: `why` is null when the file chose the
 *  family, else a key of KEYS_WHY, and `family` is then the default. */
export function chordFamilyFrom(text, error = null) {
  const fallback = (why) => Object.freeze({ family: DEFAULT_CHORD_FAMILY, why });
  if (error) return fallback(error.code === "ENOENT" || error.code === "ENOTDIR" ? "missing" : "unreadable");
  if (text === null || text === undefined) return fallback("missing");
  if (typeof text !== "string") return fallback("unreadable");
  if (text.length > KEYS_LIMIT) return fallback("too-large");
  let value;
  try { value = JSON.parse(text); } catch { return fallback("not-json"); }
  if (!isObject(value)) return fallback("not-object");
  if (!Object.hasOwn(value, "chords")) return fallback("no-chords");
  if (!CHORD_FAMILIES.includes(value.chords)) return fallback("unknown-chords");
  return Object.freeze({ family: value.chords, why: null });
}

/** The line a client shows when keys.json was there and not taken ("keys.json: unknown chords value,
 *  using Ctrl+Alt"), or null: the file chose the family, or there is none, which is the default
 *  with nothing to say. `read` is what chordFamilyFrom answered. */
export function chordFamilyNote(read) {
  if (!read || read.why === null || read.why === "missing" || !Object.hasOwn(KEYS_WHY, read.why)) return null;
  return `${KEYS_WHY[read.why]}, using Ctrl+Alt`;
}

/** The text of keys.json with `chords` set to `family`, from the file's current `text` (null when
 *  there is none): every other key of an object is kept, in its place, so that a key a later client
 *  adds is not lost to an older one. A file that is not a JSON object gives way to `{ "chords" }`.
 *  Throws on a `family` that is not one of CHORD_FAMILIES. The client writes the answer atomically. */
export function keysWithFamily(text, family) {
  if (!CHORD_FAMILIES.includes(family)) throw new TypeError(`unknown chord family: ${String(family)}`);
  let value = null;
  if (typeof text === "string" && text.length <= KEYS_LIMIT) {
    try { value = JSON.parse(text); } catch { value = null; }
  }
  const kept = isObject(value) ? value : {};
  return `${JSON.stringify({ ...kept, chords: family }, null, 2)}\n`;
}
