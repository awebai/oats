/** keys.json, the one preference both clients share about their keys: which chord family they bind
 * on Linux and Windows (packages/client/keymap.mjs CHORD_FAMILIES). It is `config/keys.json` in OATS's
 * own directory of this user, beside the TUI's tui.json, and resolved the same way: `$OATS_HOME_DIR`
 * when that is set and not empty, else `<home>/.oats`. Its shape: `{ "chords": "alt" | "ctrl+alt" | "ctrl+shift" }`.
 * No file, or no `chords` in it, is no choice: the default, Alt. A `chords` written is a choice, and
 * stays one when the default changes (a user who chose Ctrl+Alt keeps it).
 *
 * The file is the clients'; the kernel never reads it. Each client does its own IO and hands the text
 * here: the TUI at its start, the Desktop in its main process, which hands the family to its renderer
 * and is the one that writes the file (keysWithFamily). Pure: no fs, no state.
 *
 *   keysPath(env, home)          -> the file's path
 *   chordFamilyFrom(bytes, error) -> { family, why }: the family to bind, and why it is the default
 *   chordFamilyNote(read)         -> the one line a client shows when the file was not taken, or null
 *   keysWithFamily(bytes, family) -> the file's new text: `chords` set, every other key kept, or a
 *                                    KeysUnwritable error when that cannot be done
 *
 * Both clients hand over the file's bytes, not their own reading of them, so the same bytes mean the
 * same family in both: UTF-8 (RFC 8259), a byte-order mark ignored, anything else not text.
 *
 * Every way the file can fail means the default, Alt: none is an error the user must clear. An older
 * client, which knows no `alt`, reads `"chords": "alt"` as an unknown value: its own default, with
 * its note. */
import { join } from "node:path";
import { CHORD_FAMILIES, CHORD_FAMILY_LABELS, DEFAULT_CHORD_FAMILY } from "./keymap.mjs";

/** The most a client reads of the file, in bytes: anything longer is not a keys.json. */
export const KEYS_LIMIT = 16384;

/** Why the family is the default, by the `why` chordFamilyFrom answers; null: the file chose it. */
export const KEYS_WHY = Object.freeze({
  missing: "there is no keys.json",
  unreadable: "keys.json cannot be read",
  "too-large": "keys.json is too large",
  "not-utf8": "keys.json is not UTF-8 text",
  "not-json": "keys.json is not JSON",
  "not-object": "keys.json is not an object",
  "no-chords": "keys.json names no chords",
  "unknown-chords": "keys.json: unknown chords value",
});

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const utf8Length = (text) => new TextEncoder().encode(text).length;

/** The file's text from what a client read: `{ text }`, or `{ why }` when it is none. `input` is the
 *  file's bytes (a Uint8Array, a Buffer), at most KEYS_LIMIT and one of them, decoded as UTF-8 with a
 *  leading byte-order mark dropped; or text already decoded (a test's), held to the same rules. */
function textOf(input) {
  if (input instanceof Uint8Array) {
    if (input.length > KEYS_LIMIT) return { why: "too-large" };
    try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(input) }; } catch { return { why: "not-utf8" }; }
  }
  if (typeof input !== "string") return { why: "unreadable" };
  if (utf8Length(input) > KEYS_LIMIT) return { why: "too-large" };
  return { text: input.startsWith("\uFEFF") ? input.slice(1) : input };
}

/** What keysWithFamily throws when the file is there and its other keys cannot all be kept: one it
 *  cannot read as a JSON object, or one whose new text would be over KEYS_LIMIT. `why` says which
 *  (a key of KEYS_WHY, or "unreadable" for a file the client could not read). Nothing is written. */
export class KeysUnwritable extends Error {
  constructor(why) {
    super(`keys.json cannot be rewritten without losing what it holds (${why})`);
    this.name = "KeysUnwritable";
    this.code = "E_KEYS_UNWRITABLE";
    this.why = why;
  }
}

/** The path of keys.json: `config/keys.json` in `$OATS_HOME_DIR` when that is set and not empty, else
 *  in `<home>/.oats` (the TUI's configPath for tui.json, packages/tui/lib/config.mjs). */
export function keysPath(env, home) {
  const own = env?.OATS_HOME_DIR;
  return join(typeof own === "string" && own !== "" ? own : join(home, ".oats"), "config", "keys.json");
}

/** The family keys.json names. `bytes` is what the client read of the file (textOf: its bytes, at most
 *  KEYS_LIMIT and one), or null or undefined when there is none; `error` the error its read threw, if
 *  one did (ENOENT and ENOTDIR are no file, any other is a file that cannot be read). Answers a frozen
 *  `{ family, why }`: `why` is null when the file chose the family, else a key of KEYS_WHY, and
 *  `family` is then the default. */
export function chordFamilyFrom(bytes, error = null) {
  const fallback = (why) => Object.freeze({ family: DEFAULT_CHORD_FAMILY, why });
  if (error) return fallback(error.code === "ENOENT" || error.code === "ENOTDIR" ? "missing" : "unreadable");
  if (bytes === null || bytes === undefined) return fallback("missing");
  const { text, why } = textOf(bytes);
  if (why) return fallback(why);
  let value;
  try { value = JSON.parse(text); } catch { return fallback("not-json"); }
  if (!isObject(value)) return fallback("not-object");
  if (!Object.hasOwn(value, "chords")) return fallback("no-chords");
  if (!CHORD_FAMILIES.includes(value.chords)) return fallback("unknown-chords");
  return Object.freeze({ family: value.chords, why: null });
}

/** The line a client shows when keys.json was there and not taken ("keys.json: unknown chords value,
 *  using Alt", the default's label), or null: the file chose the family, or there is none, which is the default
 *  with nothing to say. `read` is what chordFamilyFrom answered. */
export function chordFamilyNote(read) {
  if (!read || read.why === null || read.why === "missing" || !Object.hasOwn(KEYS_WHY, read.why)) return null;
  return `${KEYS_WHY[read.why]}, using ${CHORD_FAMILY_LABELS[DEFAULT_CHORD_FAMILY]}`;
}

/** The text of keys.json with `chords` set to `family`, from the file's current `bytes` (as
 *  chordFamilyFrom takes them; null when there is no file): every other key of the object is kept,
 *  in its place, so that a key a later client adds is not lost to an older one. The text is indented
 *  when that fits in KEYS_LIMIT, else on one line, so the clients always read back what was written.
 *  Throws KeysUnwritable, so that nothing is written, for a file that is there and is not a JSON
 *  object, or whose keys do not fit in KEYS_LIMIT with `chords` set; a TypeError for a `family` that
 *  is not one of CHORD_FAMILIES. A client that could not read the file must not call this: it does
 *  not know what it would lose. The client writes the answer atomically. */
export function keysWithFamily(bytes, family) {
  if (!CHORD_FAMILIES.includes(family)) throw new TypeError(`unknown chord family: ${String(family)}`);
  let kept = {};
  if (bytes !== null && bytes !== undefined) {
    const { text, why } = textOf(bytes);
    if (why) throw new KeysUnwritable(why);
    let value;
    try { value = JSON.parse(text); } catch { throw new KeysUnwritable("not-json"); }
    if (!isObject(value)) throw new KeysUnwritable("not-object");
    kept = value;
  }
  const next = { ...kept, chords: family };
  for (const text of [`${JSON.stringify(next, null, 2)}\n`, `${JSON.stringify(next)}\n`]) if (utf8Length(text) <= KEYS_LIMIT) return text;
  throw new KeysUnwritable("too-large");
}
