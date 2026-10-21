/** The key parser of `oats tui`: raw terminal input bytes in, key events out.
 * Pure: no IO, no timers; the only clock is the injected `now`. Its one import is the reading of
 * the kitty keyboard protocol (term/kitty.mjs). It reads escape sequences and never writes one.
 *
 * Events are plain objects of exactly four shapes:
 *   a named key   { name, ctrl, alt, shift }
 *   a grapheme    { text }  or  { text, alt: true }
 *   a paste       { paste }  or  { paste: "", truncated: true }
 *   an answer     { keyboard: flags }: the terminal's answer to the protocol's query (`CSI ? flags u`),
 *                 while the parser waits for one */
import { confirmed, kittyId, kittyKey, legacyBytes, legacyParams } from "./kitty.mjs";

export const ESC_TIMEOUT_MS = 50;
export const PASTE_LIMIT = 1024 * 1024;
export const PASTE_PAUSE_MS = 1000;

/** Parameter and intermediate bytes held for one CSI or SS3. A longer sequence
 * is discarded as it streams: input can never grow the parser. */
const SEQUENCE_LIMIT = 64;
const ESC = 0x1b;
const PASTE_END = Uint8Array.of(ESC, 0x5b, 0x32, 0x30, 0x31, 0x7e); // CSI 201 ~

const GROUND = 0, ESCAPE = 1, CSI = 2, SS3 = 3, LINUX = 4, MOUSE = 5, STRING = 6, STRING_ESC = 7, PASTE = 8;

const LETTER_KEYS = Object.freeze({
  __proto__: null,
  A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", P: "f1", Q: "f2", R: "f3", S: "f4",
});
const TILDE_KEYS = Object.freeze({
  __proto__: null,
  1: "home", 7: "home", 4: "end", 8: "end", 2: "insert", 3: "delete", 5: "pageup", 6: "pagedown",
  11: "f1", 12: "f2", 13: "f3", 14: "f4", 15: "f5", 17: "f6", 18: "f7", 19: "f8", 20: "f9", 21: "f10", 23: "f11", 24: "f12",
});
/** The Linux console sends F1..F5 as `ESC [ [ A` .. `ESC [ [ E`. */
const LINUX_KEYS = Object.freeze({ __proto__: null, A: "f1", B: "f2", C: "f3", D: "f4", E: "f5" });
const KEY_PARAMS = /^\d*(?:;\d*)?$/;
const NO_CHORDS = new Map();
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

const named = (name, ctrl = false, alt = false, shift = false) => ({ name, ctrl, alt, shift });

/** Control with one of \ ] ^ _: the C0 bytes 0x1c..0x1f, in that order. */
const CTRL_PUNCTUATION = "\\]^_";

/** The key of a C0 byte or DEL, or null for a byte that is no key (NUL). 0x1c..0x1f are Control
 *  with \ ] ^ _ (`C-\`, a leader tui.json can name, is one of them: docs/tui.md, "The leader"). */
function c0Key(b) {
  if (b === 0x0d || b === 0x0a) return named("enter");
  if (b === 0x09) return named("tab");
  if (b === 0x7f || b === 0x08) return named("backspace");
  if (b >= 0x1c && b <= 0x1f) return named(CTRL_PUNCTUATION[b - 0x1c], true);
  return b >= 0x01 && b <= 0x1a ? named(String.fromCharCode(b + 0x60), true) : null;
}

/** xterm's modifier parameter: m - 1 is a bit mask (1 shift, 2 alt, 4 ctrl, 8 meta,
 * ignored). A value outside 1..16 is no key report, so the sequence is dropped:
 * that keeps most cursor position reports (`CSI row ; col R`) from reading as F3. */
function modified(name, param, shift = false) {
  const m = param === "" ? 1 : Number(param);
  if (!(m >= 1 && m <= 16)) return null;
  return named(name, ((m - 1) & 4) !== 0, ((m - 1) & 2) !== 0, shift || ((m - 1) & 1) !== 0);
}

/** A complete CSI as a key, or null when it is not one (then it is dropped whole).
 * Only `CSI [n] [; m] final` is a key: a private marker, an intermediate or a
 * third parameter makes it a terminal report. */
function csiKey(params, final) {
  if (params === null || !KEY_PARAMS.test(params)) return null;
  const [first, mod = ""] = params.split(";");
  if (final === "~") return TILDE_KEYS[Number(first)] ? modified(TILDE_KEYS[Number(first)], mod) : null;
  if (first !== "" && Number(first) !== 1) return null;
  if (final === "Z") return modified("tab", mod, true);
  return LETTER_KEYS[final] ? modified(LETTER_KEYS[final], mod) : null;
}

/** `ESC O X`, and the modifier forms `ESC O m X` and `ESC O 1 ; m X`. */
function ss3Key(params, final) {
  if (params === null || !KEY_PARAMS.test(params) || !LETTER_KEYS[final]) return null;
  return modified(LETTER_KEYS[final], params.slice(params.lastIndexOf(";") + 1));
}

const MORE = -1, BAD = -2, RETRY = -3;

/** A streaming UTF-8 decoder (the WHATWG algorithm: no overlong form, no surrogate,
 * nothing above U+10FFFF). `push` returns a code point, MORE when the character is
 * incomplete, BAD for a byte that is not UTF-8, or RETRY when the byte ended an
 * incomplete character: that character is invalid and the byte must be offered again. */
function utf8Decoder() {
  let need = 0, cp = 0, lo = 0x80, hi = 0xbf;
  return {
    get pending() { return need > 0; },
    push(b) {
      if (need === 0) {
        if (b < 0x80) return b;
        if (b >= 0xc2 && b <= 0xdf) { need = 1; cp = b & 0x1f; }
        else if (b >= 0xe0 && b <= 0xef) { need = 2; cp = b & 0x0f; if (b === 0xe0) lo = 0xa0; else if (b === 0xed) hi = 0x9f; }
        else if (b >= 0xf0 && b <= 0xf4) { need = 3; cp = b & 0x07; if (b === 0xf0) lo = 0x90; else if (b === 0xf4) hi = 0x8f; }
        else return BAD;
        return MORE;
      }
      const valid = b >= lo && b <= hi;
      lo = 0x80; hi = 0xbf;
      if (!valid) { need = 0; return RETRY; }
      cp = (cp << 6) | (b & 0x3f);
      return --need === 0 ? cp : MORE;
    },
  };
}

/** Paste content is decoded leniently: what is not UTF-8 becomes U+FFFD, never an error. */
function decodeLenient(bytes, length) {
  const decoder = utf8Decoder(), points = [];
  let text = "";
  const put = (cp) => {
    if (points.push(cp) < 4096) return;
    text += String.fromCodePoint.apply(null, points);
    points.length = 0;
  };
  for (let i = 0; i < length; i++) {
    const cp = decoder.push(bytes[i]);
    if (cp >= 0) put(cp);
    else if (cp !== MORE) { put(0xfffd); if (cp === RETRY) i--; }
  }
  if (decoder.pending) put(0xfffd);
  return text + String.fromCodePoint.apply(null, points);
}

/** The events a key's legacy bytes read as, whole: a fresh parser without the protocol, the Esc of a
 *  lone ESC taken at once (the bytes are one key, nothing follows them). */
export function legacyEvents(bytes) {
  let t = 0;
  const parser = createKeyParser({ now: () => t });
  const events = parser.feed(bytes);
  t = Infinity;
  return [...events, ...parser.expire()];
}

/** `now` is the injected clock in milliseconds; the parser reads it once per
 * `feed` and once per `expire`, and nowhere else.
 *
 * `keyboard` is the kitty keyboard protocol (docs/tui.md, "Chords"): null, the default, without it;
 * "asking" while the terminal's answer to the query is awaited; or the flags it answered once they
 * hold flag 1. `chords` are the key ids the TUI binds as chords (packages/client/keymap.mjs CHORDS):
 * a Map of key id to what it does, of which only the ids are read here. While asking, the answer `CSI ? flags u` is the event `{ keyboard: flags }`, and the bytes
 * after it are read as it says: with flag 1 under the protocol, else as before. Under the protocol
 * a `CSI … u` key is read as its legacy bytes are (term/kitty.mjs legacyBytes, legacyEvents above),
 * so Ctrl+Shift+C is Ctrl+C as without it, and a chord of `chords` as its own key id (term/kitty.mjs
 * kittyId): a Ctrl+Alt one (`ctrl+alt+k`), which without the protocol is ESC and a C0 byte
 * (`ctrl+alt+k` too, here, which the store binds only under the protocol), and a Ctrl+Shift one
 * (`ctrl+shift+k`, bound only when keys.json chose that family), which is read from the protocol's
 * event alone: without it, and as a legacy byte under it, Ctrl+Shift+K is Ctrl+K, and Ctrl+Shift+D
 * and Ctrl+Shift+M are Ctrl+D and Enter. A Ctrl+Shift letter that is not among `chords` reads as its
 * legacy bytes, as before, but the one whose legacy bytes read as `leader` (the leader's key id,
 * null for none): Ctrl+Shift+X under the protocol is `ctrl+shift+x`, which nothing binds, and never
 * the leader Ctrl+X. A character that is not ASCII is never a chord:
 * AltGr's `€`, as text or as a `CSI … u` of its own, reads as that text. An Alt+Shift arrow chord is
 * read by its legacy sequence (`CSI 1 ; 4 A`) in every state. An answer
 * at any other time is dropped, as is a `u` key while not under the protocol. Under it a key in a
 * legacy shape has its modifier made xterm's (term/kitty.mjs legacyParams: the lock keys dropped),
 * and nothing is timed: a terminal under the protocol sends no lone ESC for a key, so an ESC, like
 * any sequence begun, waits for what follows it however late that comes, and Esc is its own
 * sequence.
 * While asking, the answer may come split across reads, and over a slow link late: with `answerBy`
 * (the clock time the run stops waiting for it) an ESC that a later read follows with `[` is kept as
 * its possible beginning (a `candidate`) up to then. What turns out not to be the answer is read as
 * it was typed: the Esc key, then `[` and the rest as text. A late ESC that `[` does not follow is
 * the Esc key, as before, and so a lone ESC is, at `answerBy` at the latest.
 *
 *   feed(bytes)  the events of these bytes, in order. Text is never held back:
 *                a complete character is emitted by the feed that completes it.
 *   expire()     call when the clock reaches timeoutAt(): the Esc key, if a lone
 *                ESC has waited ESC_TIMEOUT_MS; else nothing.
 *   timeoutAt()  the clock time at which expire() is due, or null.
 *   giveUp()     the answer is no longer awaited (none came in time): a late one is dropped, and
 *                the events of what was kept for it are answered.
 *   keyboard     the protocol as it is now: null, "asking" or the confirmed flags. */
export function createKeyParser({ now, keyboard = null, chords = NO_CHORDS, leader = null, answerBy = null } = {}) {
  if (typeof now !== "function") throw new TypeError("createKeyParser needs an injected clock: { now: () => milliseconds }");
  if (!(keyboard === null || keyboard === "asking" || confirmed(keyboard))) throw new TypeError("keyboard is null, \"asking\" or flags that hold flag 1");
  if (!(chords instanceof Map)) throw new TypeError("chords is a Map of key ids");
  let kb = keyboard;
  /** An ESC kept past its timeout as the possible beginning of the answer, and the CSI it began. */
  let candidate = false;
  const asking = () => kb === "asking" && answerBy !== null;
  /** When a lone ESC is the Esc key: after ESC_TIMEOUT_MS, and while the answer is awaited not
   *  before `answerBy` (a later read decides it sooner, see feed). */
  const escDue = () => (asking() ? Math.max(escAt + ESC_TIMEOUT_MS, answerBy) : escAt + ESC_TIMEOUT_MS);
  const utf8 = utf8Decoder();
  let state = GROUND, out = [], feedAt = 0, lastFeedAt = 0;
  let run = "";       // consecutive printable code points of this feed, not yet cut into graphemes
  let alt = false;    // ESC came before the multi-byte character being decoded
  let escAt = 0;      // feed time of the pending lone ESC
  let seq = "";       // CSI/SS3 parameter and intermediate bytes; null once over SEQUENCE_LIMIT
  let bel = false;    // the string sequence is an OSC, which BEL also ends
  let mouse = 0;      // bytes of an X10 mouse report still to swallow
  let held = null, size = 0, over = false, matched = 0; // paste: content, its length, limit hit, end-marker bytes matched

  /** Whatever comes between two code points, a key or a dropped byte or sequence,
   * ends the run: only code points that arrive consecutively join into a grapheme. */
  const flush = () => {
    if (run.length === 1) out.push({ text: run });
    else if (run !== "") for (const { segment } of GRAPHEMES.segment(run)) out.push({ text: segment });
    run = "";
  };
  const emit = (event) => { flush(); out.push(event); };
  const startEscape = () => { flush(); state = ESCAPE; escAt = feedAt; };

  const ground = (b) => {
    if (b >= 0x80 || utf8.pending) {
      const cp = utf8.push(b);
      if (cp === MORE) return;
      const withAlt = alt;
      alt = false;
      if (cp === RETRY) { flush(); ground(b); return; }
      if (cp === BAD || cp <= 0x9f) { flush(); return; } // not UTF-8, or a C1 control: dropped
      if (withAlt) emit({ text: String.fromCodePoint(cp), alt: true });
      else run += String.fromCodePoint(cp);
      return;
    }
    if (b === ESC) { startEscape(); return; }
    if (b >= 0x20 && b !== 0x7f) { run += String.fromCharCode(b); return; }
    const key = c0Key(b);
    if (key) emit(key);
    else flush();
  };

  /** The byte after an ESC: a sequence introducer, or Alt plus a key. */
  const afterEscape = (b) => {
    state = GROUND;
    if (b === ESC) { emit(named("escape")); startEscape(); }
    else if (b === 0x5b) { state = CSI; seq = ""; }
    else if (b === 0x4f) { state = SS3; seq = ""; }
    else if (b === 0x5d) { state = STRING; bel = true; }                                    // OSC
    else if (b === 0x50 || b === 0x58 || b === 0x5e || b === 0x5f) { state = STRING; bel = false; } // DCS SOS PM APC
    else if (b >= 0x80) { alt = true; ground(b); }
    else if (b >= 0x20 && b !== 0x7f) emit({ text: String.fromCharCode(b), alt: true });
    else {
      const key = c0Key(b);
      if (key) { key.alt = true; emit(key); }
    }
  };

  /** Inside a CSI, an SS3 or the Linux console form. A control byte is dropped and
   * the sequence goes on, an ESC starts over, a byte >= 0x80 aborts and is dropped. */
  const inSequence = (b) => {
    // A candidate goes on only as the answer does: `?`, at most three digits, `u`.
    if (candidate) {
      const goesOn = seq === "" ? b === 0x3f : b === 0x75 ? /^\?\d{1,3}$/.test(seq) : b >= 0x30 && b <= 0x39 && /^\?\d{0,2}$/.test(seq);
      if (!goesOn) { replay(); step(b); return; }
      if (b === 0x75) candidate = false;
    }
    if (b === ESC) { startEscape(); return; }
    if (b < 0x20 || b === 0x7f) return;
    if (b >= 0x80) { state = GROUND; return; }
    const from = state;
    // CSI: parameters 0x30..0x3f and intermediates 0x20..0x2f. SS3: parameters only.
    if (from !== LINUX && b <= 0x3f && (from === CSI || b >= 0x30)) {
      seq = seq !== null && seq.length < SEQUENCE_LIMIT ? seq + String.fromCharCode(b) : null;
      return;
    }
    const final = String.fromCharCode(b);
    state = GROUND;
    let key = null;
    if (from === LINUX) key = LINUX_KEYS[final] ? named(LINUX_KEYS[final]) : null;
    else if (from === SS3) key = ss3Key(seq, final);
    else if (seq === "" && final === "[") state = LINUX;
    else if (seq === "" && final === "M") { state = MOUSE; mouse = 3; } // X10 mouse report: 3 raw bytes follow
    else if (seq === "200" && final === "~") state = PASTE;
    else if (final === "u") { kittyEvents(seq); return; }
    else key = csiKey(confirmed(kb) ? legacyParams(seq, final) : seq, final);
    if (key) emit(key);
  };

  /** A candidate that is not the answer, as it was typed: the Esc key, then `[` and what followed. */
  const replay = () => {
    const typed = `[${seq ?? ""}`;
    candidate = false; state = GROUND;
    emit(named("escape"));
    for (const c of typed) ground(c.charCodeAt(0));
  };

  /** A `CSI … u`: the protocol's answer while it is awaited, or a key under the protocol. */
  const kittyEvents = (seq) => {
    const answer = seq === null ? null : /^\?(\d{1,3})$/.exec(seq);
    if (answer) {
      if (kb !== "asking") { flush(); return; }
      const flags = Number(answer[1]);
      kb = confirmed(flags) ? flags : null;
      emit({ keyboard: flags });
      return;
    }
    const key = kb === null || kb === "asking" ? null : kittyKey(seq);
    if (key === null) { flush(); return; }
    const id = kittyId(key);
    if (id !== null && chords.has(id)) { emit(named(String.fromCharCode(key.code), key.ctrl, key.alt, key.shift)); return; }
    const bytes = legacyBytes(key, kb);
    if (bytes === null) { flush(); return; }
    const events = legacyEvents(bytes);
    // A key with an id of its own whose legacy bytes read as the leader (Ctrl+Shift+X is 0x18, as
    // Ctrl+X) is its own key, which nothing binds: never the leader.
    if (id !== null && leader !== null && events.length === 1 && keyId(events[0]) === leader) { emit(named(String.fromCharCode(key.code), key.ctrl, key.alt, key.shift)); return; }
    for (const event of events) emit(event);
  };

  const endPaste = (truncated) => {
    emit(truncated ? { paste: "", truncated: true } : { paste: decodeLenient(held, size) });
    held = null; size = 0; over = false; matched = 0;
    state = GROUND;
  };

  /** Holds paste content, up to the limit. Content that reaches PASTE_LIMIT is
   * dropped and nothing more is held: the paste will end as truncated. */
  const hold = (source, from, to) => {
    if (over) return;
    const length = size + to - from;
    if (length >= PASTE_LIMIT) { over = true; held = null; size = 0; return; }
    if (held === null || length > held.length) {
      const grown = new Uint8Array(Math.min(PASTE_LIMIT, Math.max(length, 2 * (held === null ? 128 : held.length))));
      if (held !== null) grown.set(held.subarray(0, size));
      held = grown;
    }
    held.set(source.subarray(from, to), size);
    size = length;
  };

  /** Inside a bracketed paste every byte is content, up to the end marker `CSI 201 ~`,
   * which may arrive split at any byte. Returns the index after the bytes it consumed. */
  const inPaste = (bytes, i) => {
    while (i < bytes.length) {
      const b = bytes[i];
      if (b === PASTE_END[matched]) {
        i++;
        if (++matched === PASTE_END.length) { endPaste(over); break; }
      } else if (matched > 0) {
        // Not the marker after all: its bytes were content. This byte is looked at again.
        hold(PASTE_END, 0, matched);
        matched = 0;
      } else {
        const stop = bytes.indexOf(ESC, i);
        hold(bytes, i, stop === -1 ? bytes.length : stop);
        i = stop === -1 ? bytes.length : stop;
      }
    }
    return i;
  };

  /** The paste pause rule, and it lives only here. A paste whose end marker never
   * arrives must not deafen the program for ever (Ctrl+C is a byte here): when a
   * feed arrives PASTE_PAUSE_MS or more after the previous feed while a paste is
   * open (under or over the limit), the paste is abandoned as truncated and this
   * feed is read as keys. No timer: the clock is only read at feed.
   *
   * This is acceptable only because bracketed paste is a second guard, never the
   * only one. A terminal may lack it, a paste can carry its own end marker, and a
   * stalled paste ends here: nothing in the TUI may rely on this parser to stop a
   * pasted key from acting. An act that matters asks for its own confirmation. */
  const abandonStalledPaste = () => {
    if (state === PASTE && feedAt - lastFeedAt >= PASTE_PAUSE_MS) endPaste(true);
  };

  /** One byte, in whatever state the parser is (a paste's content is read by inPaste). */
  function step(b) {
    switch (state) {
      case GROUND: ground(b); break;
      case ESCAPE: afterEscape(b); break;
      case MOUSE:
        if (b === ESC) startEscape();
        else if (--mouse === 0) state = GROUND;
        break;
      case STRING: // swallowed as it streams, never held
        if (b === ESC) state = STRING_ESC;
        else if (bel && b === 0x07) state = GROUND;
        break;
      case STRING_ESC:
        // `ESC \` is ST and ends the string. An ESC before anything else abandons
        // the string and starts a new sequence, as in a CSI: the next key that
        // sends an ESC recovers from a string whose end never arrives.
        if (b === 0x5c) state = GROUND;
        else if (b !== ESC) afterEscape(b);
        break;
      default: inSequence(b);
    }
  }

  return {
    feed(bytes) {
      if (!(bytes instanceof Uint8Array)) throw new TypeError("feed expects bytes (a Uint8Array)");
      feedAt = now();
      // A lone ESC that already waited its time is the Esc key; these bytes start fresh. Under the
      // protocol nothing is timed. While the answer is awaited, one these bytes follow with `[` may
      // begin it: kept, as a candidate.
      if (state === ESCAPE && !confirmed(kb) && feedAt >= escAt + ESC_TIMEOUT_MS) {
        if (asking() && feedAt < answerBy && bytes[0] === 0x5b) candidate = true;
        else { state = GROUND; emit(named("escape")); }
      }
      abandonStalledPaste();
      lastFeedAt = feedAt;
      for (let i = 0; i < bytes.length; i++) {
        if (state === PASTE) { i = inPaste(bytes, i) - 1; continue; }
        step(bytes[i]);
      }
      flush();
      const events = out;
      out = [];
      return events;
    },
    expire() {
      if (state !== ESCAPE || confirmed(kb) || now() < escDue()) return [];
      state = GROUND;
      return [named("escape")];
    },
    /** Only a lone ESC has a deadline, and none under the protocol. Every other incomplete sequence
     *  waits for its end. */
    timeoutAt() {
      return state === ESCAPE && !confirmed(kb) ? escDue() : null;
    },
    giveUp() {
      if (kb !== "asking") return [];
      kb = null;
      if (candidate) replay();
      else if (state === ESCAPE && now() >= escAt + ESC_TIMEOUT_MS) { state = GROUND; emit(named("escape")); }
      // An answer begun in one read whose end never came: no key sends `CSI ?`, so it is dropped,
      // and the next key is read afresh.
      else if (state === CSI && seq !== null && /^\?\d{0,3}$/.test(seq)) state = GROUND;
      flush();
      const events = out;
      out = [];
      return events;
    },
    get keyboard() { return kb; },
  };
}

/** The canonical string the action table binds: "ctrl+c", "shift+tab", "escape",
 * "?", "space", "alt+q". Modifiers come in the order ctrl, alt, shift. A paste
 * is not a key: null. */
export function keyId(event) {
  if (typeof event?.name === "string") {
    return `${event.ctrl ? "ctrl+" : ""}${event.alt ? "alt+" : ""}${event.shift ? "shift+" : ""}${event.name}`;
  }
  if (typeof event?.text !== "string") return null;
  const id = event.text === " " ? "space" : event.text;
  return event.alt ? `alt+${id}` : id;
}

/** The names that take every modifier: the keys read by `modified` from a CSI or an SS3. */
const MODIFIED_NAMES = new Set([...Object.values(LETTER_KEYS), ...Object.values(TILDE_KEYS)]);
const NAMED_ID = /^(ctrl\+)?(alt\+)?(shift\+)?([a-z][a-z0-9]*)$/;
const CTRL_PUNCTUATION_ID = /^ctrl\+(?:alt\+)?[\\\]^_]$/;
/** What no text event holds: a control character (C0, DEL, C1) or half a surrogate pair. */
const NOT_TEXT = /[\p{Cc}\p{Cs}]/u;
/** The characters that, after an ESC, begin a sequence (CSI, SS3, OSC, DCS, SOS, PM, APC): Alt
 * with one of them never arrives as a key. */
const INTRODUCERS = "[O]PX^_";
const oneGrapheme = (text) => GRAPHEMES.segment(text).containing(0).segment === text;
const oneCodePoint = (text) => text.length === (text.codePointAt(0) > 0xffff ? 2 : 1);

/** Whether a string is a key id: true exactly for the strings keyId answers for an event the
 * parser above can emit, so a table that binds only key ids binds nothing that can never arrive
 * from it. Whether a given terminal sends the key is not asked: `f12` and `alt+` an accented
 * letter are key ids on a terminal that sends neither. The grammar is the parser's, branch for
 * branch (the Linux console's F1..F5 are bare names the others already hold):
 *
 *   text       one grapheme without a control character, as itself (`+` is the plus key), and
 *              `space` for the space, which is never written " "
 *   alt+text   `alt+` and ONE CODE POINT (`alt++`, `alt+space`): Alt reaches a single
 *              character, so `alt+` and a grapheme of several code points is no key; and not
 *              `alt+` with one of `[ O ] P X ^ _`, which after an ESC begin a sequence
 *   named      up down left right home end insert delete pageup pagedown f1..f12, with any of
 *              `ctrl+`, `alt+`, `shift+`, in that order
 *              enter, backspace: bare or `alt+`.  escape: bare
 *              tab: bare, `alt+tab`, and `shift+tab` with any of `ctrl+`, `alt+` before it
 *   ctrl       `ctrl+` or `ctrl+alt+` and a letter a..z whose C0 byte is a key of its own:
 *              not h, i, j or m, which arrive as Backspace, Tab and Enter; or one of \ ] ^ _ */
export function isKeyId(id) {
  if (typeof id !== "string" || id === "" || NOT_TEXT.test(id)) return false;
  if (id === "space" || id === "alt+space") return true;
  if (id === " " || id === "alt+ ") return false;
  if (oneGrapheme(id)) return true;
  if (id.startsWith("alt+") && id.length > 4 && oneCodePoint(id.slice(4))) return !INTRODUCERS.includes(id.slice(4));
  if (CTRL_PUNCTUATION_ID.test(id)) return true;
  const match = NAMED_ID.exec(id);
  if (!match) return false;
  const [, ctrl, alt, shift, name] = match;
  if (MODIFIED_NAMES.has(name)) return true;
  if (name === "tab") return shift !== undefined || ctrl === undefined;
  if (name === "enter" || name === "backspace") return ctrl === undefined && shift === undefined;
  if (name === "escape") return ctrl === undefined && alt === undefined && shift === undefined;
  return name.length === 1 && ctrl !== undefined && shift === undefined && c0Key(name.charCodeAt(0) - 0x60).name === name;
}
