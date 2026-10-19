/** The kitty keyboard protocol, as `oats tui` reads it (docs/tui.md, "Chords"): the flags it asks
 * for, a `CSI … u` key read, and the bytes the same key sends without the protocol. Pure: no IO,
 * no state, no imports. The guard (term/tty.mjs) pushes, queries and pops the protocol; the key
 * parser (term/keys.mjs) and the scanner of what is typed into a terminal (term/through.mjs) read
 * what comes back with these.
 *
 * Under the protocol a terminal sends Esc, and every key held with Ctrl or Alt, as
 * `CSI code[:shifted[:base]] [; mods] u`: one sequence, never an ESC alone, so Alt+O and Esc then
 * `o` are told apart exactly. Everything else (text, Shift and a character, Enter, Tab and
 * Backspace alone, the arrows, the function keys) keeps the bytes it has without it.
 *
 * What the TUI reads is what the legacy bytes of a key read as, with two exceptions: the chords
 * (packages/client/keymap.mjs CHORDS), which keep their own key id (`ctrl+shift+k`), and the exact
 * Alt and Esc above. What it types into an agent is those legacy bytes (`legacyBytes`), so the
 * agent's program gets what it gets without the protocol. */

/** The flags pushed (`CSI > flags u`): 1, disambiguate the escape codes, and 4, report alternate
 *  keys, so the shifted key a key with Shift makes on the person's layout comes with it. The
 *  maintainer's decision of 2026-10-19; set it to 1 and flag 4 is never asked for: the US table
 *  below is then the only way to the shifted key. No other flag (2, 8, 16) is ever asked for. */
export const KEYBOARD_FLAGS = 1 | 4;
/** The flag the TUI needs confirmed to read the protocol at all, and the one that makes the shifted
 *  key exact. */
export const DISAMBIGUATE = 1, ALTERNATE_KEYS = 4;

/** Whether the flags a terminal confirmed (its `CSI ? flags u` answer) let the TUI read the
 *  protocol: the answer must hold flag 1. Any other answer is as no answer. */
export const confirmed = (flags) => Number.isInteger(flags) && (flags & DISAMBIGUATE) !== 0;

/** `code[:shifted[:base]][;mods]`: the parameters of a `CSI … u` key under flags 1 and 4. Flag 4
 *  puts the subfields on every key, so they are taken on every one; the base-layout key (the
 *  third) is read and ignored. No event type, no text: flags 2 and 16 are never asked for. */
const PARAMS = /^(\d{1,7})(?::(\d{0,7})(?::\d{0,7})?)?(?:;(\d{1,3}))?$/;
/** The modifier bits after the 1 is taken away: Shift, Alt, Ctrl. Super, Hyper, Meta and the lock
 *  bits are dropped: a terminal sends a key held with them as it sends the key without them. */
const SHIFT = 1, ALT = 2, CTRL = 4;

/** A `CSI … u` key's parameters (the bytes between `CSI` and `u`) as `{ code, shifted, shift, alt,
 *  ctrl }`, or null when they are no key: a reply (`?flags`), an event type or a text field, a
 *  modifier outside 1..256, a code that is no Unicode scalar. `shifted` is the alternate key flag 4
 *  reports, or null when it is absent or empty. */
export function kittyKey(params) {
  const match = typeof params === "string" ? PARAMS.exec(params) : null;
  if (!match) return null;
  const code = Number(match[1]), shifted = match[2] ? Number(match[2]) : null, m = match[3] === undefined ? 1 : Number(match[3]);
  if (!scalar(code) || (shifted !== null && !scalar(shifted)) || !(m >= 1 && m <= 256)) return null;
  const bits = m - 1;
  return { code, shifted, shift: (bits & SHIFT) !== 0, alt: (bits & ALT) !== 0, ctrl: (bits & CTRL) !== 0 };
}
const scalar = (cp) => Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);

/** The key id a key held with Ctrl keeps under the protocol, the chords' spelling
 *  (packages/client/keymap.mjs: `ctrl+shift+k`, `ctrl+tab`): Ctrl, Alt and Shift, in that order,
 *  then a letter or Tab. Null for every other key: those are read as their legacy bytes are. */
export function kittyId(key) {
  if (key === null || !key.ctrl) return null;
  const name = key.code === 9 ? "tab" : key.code >= 0x61 && key.code <= 0x7a ? String.fromCharCode(key.code) : null;
  return name === null ? null : `ctrl+${key.alt ? "alt+" : ""}${key.shift ? "shift+" : ""}${name}`;
}

const ESC = 0x1b;
/** The functional keys of the protocol's private-use range the TUI forwards: the keypad, as the key
 *  each one is without the protocol. Every other code of that range (F13 and above, the media keys,
 *  the lock and modifier keys, Menu) is a key a legacy terminal sends no bytes of its own for, or the
 *  TUI reads as no key: nothing. */
const KEYPAD = Object.freeze({
  __proto__: null,
  57399: "0", 57400: "1", 57401: "2", 57402: "3", 57403: "4", 57404: "5", 57405: "6", 57406: "7", 57407: "8", 57408: "9",
  57409: ".", 57410: "/", 57411: "*", 57412: "-", 57413: "+", 57414: "enter", 57415: "=", 57416: ",",
  57417: "left", 57418: "right", 57419: "up", 57420: "down", 57421: "pageup", 57422: "pagedown",
  57423: "home", 57424: "end", 57425: "insert", 57426: "delete", 57427: "begin",
});
const PRIVATE_FIRST = 57344, PRIVATE_LAST = 63743;
/** The legacy form of a named key: `CSI <final>` / `CSI 1 ; m <final>`, or `CSI n ~` / `CSI n ; m ~`. */
const LETTER = Object.freeze({ __proto__: null, up: "A", down: "B", right: "C", left: "D", home: "H", end: "F", begin: "E" });
const TILDE = Object.freeze({ __proto__: null, insert: 2, delete: 3, pageup: 5, pagedown: 6 });

/** Shift on the 21 keys of the US layout that are not letters: the character it makes there. Only
 *  where flag 4 is not confirmed (the terminal answered flag 1 alone), and then it is the one limit
 *  of the rule that what is typed into an agent is the bytes of the same key without the protocol:
 *  on another layout Shift makes another character (docs/tui.md, "Chords"). */
export const US_SHIFTED = Object.freeze({
  __proto__: null,
  "`": "~", 1: "!", 2: "@", 3: "#", 4: "$", 5: "%", 6: "^", 7: "&", 8: "*", 9: "(", 0: ")",
  "-": "_", "=": "+", "[": "{", "]": "}", "\\": "|", ";": ":", "'": "\"", ",": "<", ".": ">", "/": "?",
});

/** Ctrl with a character, as a legacy terminal sends it: the letters and `@ [ \ ] ^ _` (and `?`,
 *  `~`, Space, and the digits 2 to 8, which a terminal maps as xterm does) as their C0 byte or DEL;
 *  every other character as itself. */
function ctrlByte(ch) {
  const c = ch.codePointAt(0);
  if ((c >= 0x61 && c <= 0x7a) || (c >= 0x40 && c <= 0x5f)) return c & 0x1f;
  const mapped = { " ": 0, 2: 0, 3: 0x1b, 4: 0x1c, 5: 0x1d, 6: 0x1e, 7: 0x1f, 8: 0x7f, "/": 0x1f, "?": 0x7f, "~": 0x1e }[ch];
  return mapped ?? null;
}

const utf8 = (text) => [...new TextEncoder().encode(text)];
const csi = (rest) => [ESC, 0x5b, ...Array.from(rest, (c) => c.charCodeAt(0))];

/** The character Shift makes on `code`: the alternate key flag 4 reported (only while Shift is held:
 *  `shifted` is read only then), else a letter's capital, else, with flag 4 not confirmed, the US
 *  layout's (US_SHIFTED), else the character itself. */
function shiftedText(key, flags) {
  const ch = String.fromCodePoint(key.code);
  if (!key.shift) return ch;
  if (key.shifted !== null && (flags & ALTERNATE_KEYS) !== 0) return String.fromCodePoint(key.shifted);
  const upper = ch.toUpperCase();
  if (upper !== ch && [...upper].length === 1) return upper;
  return (flags & ALTERNATE_KEYS) === 0 ? US_SHIFTED[ch] ?? ch : ch;
}

/** The bytes the key `key` (kittyKey's) sends WITHOUT the protocol, the legacy encoding of xterm and
 *  of the terminals that follow it, as a Uint8Array; null for a key that sends none. `flags` are the
 *  confirmed ones: with flag 4, Shift's character is the one the terminal reported.
 *    Esc ESC; Enter CR; Tab TAB, with Shift `CSI Z`; Backspace DEL, with Ctrl BS; Space SP, with Ctrl
 *    NUL; a character with Shift its shifted character, with Ctrl its C0 byte (ctrlByte); a keypad key
 *    as the key it is; Alt puts ESC before any of these. The arrows, Home, End, Insert, Delete,
 *    PageUp, PageDown and Begin are `CSI` forms with the modifier as their parameter (1 + Shift 1 +
 *    Alt 2 + Ctrl 4), as xterm sends them. */
export function legacyBytes(key, flags) {
  if (key === null) return null;
  let { code } = key;
  if (code >= PRIVATE_FIRST && code <= PRIVATE_LAST) {
    const pad = KEYPAD[code];
    if (pad === undefined) return null;
    if (pad === "enter") code = 13;
    else if (pad.length === 1) code = pad.codePointAt(0);
    else {
      const m = 1 + (key.shift ? SHIFT : 0) + (key.alt ? ALT : 0) + (key.ctrl ? CTRL : 0);
      const bytes = pad in LETTER ? csi(m === 1 ? LETTER[pad] : `1;${m}${LETTER[pad]}`) : csi(m === 1 ? `${TILDE[pad]}~` : `${TILDE[pad]};${m}~`);
      return Uint8Array.from(bytes);
    }
    key = { ...key, code, shifted: null, shift: false, ctrl: false }; // the keypad's own character, which Shift and Ctrl leave as it is
  }
  let bytes;
  if (code === 27) bytes = [ESC];
  else if (code === 13) bytes = [0x0d];
  else if (code === 9) bytes = key.shift ? csi("Z") : [0x09];
  else if (code === 127 || code === 8) bytes = [key.ctrl ? 0x08 : 0x7f];
  else if (code === 32) bytes = [key.ctrl ? 0x00 : 0x20];
  else if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return null;
  else {
    const text = shiftedText(key, flags);
    const byte = key.ctrl ? ctrlByte(text) : null;
    bytes = byte === null ? utf8(text) : [byte];
  }
  return Uint8Array.from(key.alt ? [ESC, ...bytes] : bytes);
}

/** The finals of the keys a terminal sends in the legacy shapes under the protocol: `CSI 1 ; m X`
 *  (the arrows, Home, End, Begin, F1 to F4) and `CSI n ; m ~`. Not `R`: under the protocol F3 is
 *  `CSI 13 ~`, and `CSI row ; col R` is a cursor report, which stays no key. */
const KEY_FINALS = "ABCDEFHPQS~";
/** The parameters of such a key with the protocol's modifier made xterm's: the protocol reports the
 *  lock keys and Super, Hyper and Meta in the modifier (Up with Caps Lock is `CSI 1 ; 65 A`), where
 *  a terminal without it sends the key as it is without them (`CSI A`). Shift, Alt and Ctrl stay;
 *  a modifier of none is left out, with the `1` before a letter (`CSI 1 ; 69 A` is `CSI 1 ; 5 A`,
 *  `CSI 15 ; 65 ~` is `CSI 15 ~`). Every other sequence's parameters are answered as they are. */
export function legacyParams(params, final) {
  const match = typeof params === "string" && final.length === 1 && KEY_FINALS.includes(final) ? /^(\d*);(\d{1,3})$/.exec(params) : null;
  if (!match) return params;
  const m = Number(match[2]);
  if (!(m >= 1 && m <= 256)) return params;
  const bits = (m - 1) & (SHIFT | ALT | CTRL);
  if (bits !== 0) return `${match[1]};${bits + 1}`;
  if (final === "~") return match[1];
  return match[1] === "" || match[1] === "1" ? "" : params;
}

/** A complete `CSI` sequence other than a `u` key, as a terminal sends it under the protocol, made
 *  the bytes it is without it: its modifier made xterm's (legacyParams); F1, F2 and F4 unmodified
 *  come as `CSI P`, `CSI Q`, `CSI S` (legacy `SS3 P`, `SS3 Q`, `SS3 S`), and F3 as `CSI 13 ~` (legacy
 *  `SS3 R`, and `CSI 1 ; m R` with a modifier). Every other sequence is the same bytes. `params` are
 *  the bytes between `CSI` and `final`. */
export function legacySequence(given, final) {
  const params = legacyParams(given, final);
  const ss3 = (letter) => Uint8Array.of(ESC, 0x4f, letter.charCodeAt(0));
  if ((params === "" || params === "1" || params === "1;1") && "PQS".includes(final) && final !== "") return ss3(final);
  if (final === "~") {
    if (params === "13" || params === "13;1") return ss3("R");
    const modified = /^13;(\d{1,3})$/.exec(params);
    if (modified) return Uint8Array.from(csi(`1;${modified[1]}R`));
  }
  return Uint8Array.from(csi(`${params}${final}`));
}
