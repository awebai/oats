// What is typed through to an agent's terminal (docs/tui.md, "Open an agent's terminal"). While
// a terminal has the focus the TUI reads no keys: the bytes the outer terminal sends go to the
// agent exactly as they came, and the scanner here looks for two things only, the back key's own
// bytes (which take the focus back to the list) and a bracketed paste (which goes to the agent as
// a paste, so a back key inside it is pasted, not taken). Pure: no IO; the clock is injected.
//
// The back key is tui.json's `open.detachKey`. Its grammar is THE TUI'S OWN: the keys it can take
// back from a terminal and name in the footer. It began as the kernel's `--detach-key` grammar
// (lib/session-viewer.mjs) and keeps its set and its spelling, so a tui.json written for PR 4 means
// the same key; it is not tied to the kernel's, which never sees this key any more.
import { ESC_TIMEOUT_MS, PASTE_LIMIT, PASTE_PAUSE_MS } from "./keys.mjs";

/** The keys that can be the back key: Control with a letter other than h, i and m (Backspace on
 *  some terminals, Tab, Enter), or one of \ ] ^ _; Meta with a lowercase letter or a digit; or F1
 *  to F12 with at most one of C-, M-, S-. Outside it, among others: Escape, and the ESC + C1
 *  introducers a terminal's reply can begin with. */
export const BACK_KEY = /^(?:C-[a-gj-ln-z\\\]^_]|M-[a-z0-9]|(?:[CMS]-)?F(?:[1-9]|1[0-2]))$/;
/** The grammar as the refusal of a key outside it says it. */
export const BACK_KEY_RULE = "C-<a letter except h, i and m, or one of \\ ] ^ _>, M-<a lowercase letter or digit>, or F1 to F12 with at most one of C-, M-, S-";
export const isBackKey = (value) => typeof value === "string" && BACK_KEY.test(value);

const ESC = 0x1b;
/** An escape sequence as bytes: ESC, then the printable ASCII that follows it. Built from the
 *  number, as term/keys.mjs does: no module but the screen and the guard writes an ESC in a string. */
const escaped = (rest) => Uint8Array.of(ESC, ...Array.from(rest, (c) => c.charCodeAt(0)));
/** The xterm modifier parameter of S-, M- and C-. */
const MODIFIER = Object.freeze({ S: 2, M: 3, C: 5 });
/** The number of F5..F12 in `CSI <n> ~`, and of F1..F4 in the same form (the vt220 and rxvt one). */
const TILDE = Object.freeze({ 1: 11, 2: 12, 3: 13, 4: 14, 5: 15, 6: 17, 7: 18, 8: 19, 9: 20, 10: 21, 11: 23, 12: 24 });

/** The byte sequences a terminal sends for a back key, each as bytes: what the scanner takes as
 *  the key. A Control key is one byte; a Meta key is ESC and the character; a function key has
 *  each form the key parser (term/keys.mjs) reads for it: `SS3 P..S` and `CSI 1 ; m P..S` for F1 to
 *  F4, `CSI n ~` and `CSI n ; m ~` for all twelve, and the Linux console's `CSI [ A..E` for an
 *  unmodified F1 to F5. A value outside the grammar is refused. */
export function backKeySequences(key) {
  if (!isBackKey(key)) throw new TypeError("not a back key");
  if (key.startsWith("C-") && !key.startsWith("C-F")) return [Uint8Array.of(key.charCodeAt(2) & 0x1f)];
  if (key.startsWith("M-") && !key.startsWith("M-F")) return [Uint8Array.of(ESC, key.charCodeAt(2))];
  const [, mod, number] = /^(?:([CMS])-)?F(\d+)$/.exec(key);
  const n = Number(number), m = mod ? MODIFIER[mod] : null, forms = [];
  if (n <= 4) {
    const final = "PQRS"[n - 1];
    forms.push(m === null ? `O${final}` : `[1;${m}${final}`);
    if (m !== null) forms.push(`O${m}${final}`);
  }
  forms.push(m === null ? `[${TILDE[n]}~` : `[${TILDE[n]};${m}~`);
  if (m === null && n <= 5) forms.push(`[[${"ABCDE"[n - 1]}`);
  return forms.map(escaped);
}

const PASTE_START = escaped("[200~");
const PASTE_END = escaped("[201~");
/** The first bytes of a paste's start marker that are held when a read ends on them: from `ESC [ 2`
 *  on. A lone ESC or `ESC [` is never held for the paste's sake (an agent's Esc must not wait):
 *  they go to the agent at once, and when the next read completes the marker (within
 *  PASTE_PAUSE_MS) the paste goes on to the agent RAW, as typed, its marks included, with no back
 *  key taken from it until its end marker (round 1 of the review: a split there must not let a
 *  back key inside a paste, or the keys after it, act). */
const PASTE_HELD_FROM = 3;

/** Whether `data` holds `seq` at `at`, whole. */
function at(data, from, seq) {
  if (from + seq.length > data.length) return false;
  for (let i = 0; i < seq.length; i++) if (data[from + i] !== seq[i]) return false;
  return true;
}
/** Whether `data` from `from` to its end is the beginning of `seq`, and shorter than it. */
function begins(data, from, seq) {
  const left = data.length - from;
  if (left <= 0 || left >= seq.length) return false;
  for (let i = 0; i < left; i++) if (data[from + i] !== seq[i]) return false;
  return true;
}
const join = (a, b) => { if (a.length === 0) return b; const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };
const decoder = () => new TextDecoder("utf-8", { fatal: false });

/** A scanner of the bytes typed while a terminal has the focus. `feed(bytes)` answers events in
 *  order: `{ input: <bytes> }` (for the agent, as typed), `{ paste: <text> }` (a bracketed paste,
 *  unwrapped) and, at most once per feed and last, `{ back: true, rest: <bytes> }` (the back key:
 *  what came after it in the same read is no longer the agent's, and `rest` hands it on).
 *  A read is never held back from the agent but for a beginning of the back key's own bytes, or of
 *  a paste's start marker from its third byte: those wait for the next read, or until `expire()`
 *  past `timeoutAt()` (the key parser's Esc timeout) hands them on as input. A paste is held until
 *  its end marker; one that reaches PASTE_LIMIT is dropped whole, and one whose end has not come
 *  when a read arrives PASTE_PAUSE_MS after the one before is given to the agent as what it held,
 *  and that read is scanned anew, as the key parser abandons a stalled paste. */
export function createThrough({ sequences, now }) {
  if (typeof now !== "function") throw new TypeError("createThrough needs an injected clock: { now: () => milliseconds }");
  const keys = sequences.map((seq) => Uint8Array.from(seq));
  let held = new Uint8Array(0), heldAt = 0;
  /** The paste being read: its content so far (null when none; only the tail that may begin the
   *  end marker once it went past the limit), and whether it did. */
  let paste = null, over = false, lastFeed = 0;
  /** How many first bytes of a paste's start marker the last read ended with and handed on (1 or
   *  2, or 0); and the paste passed on raw (see PASTE_HELD_FROM), with the last bytes it passed
   *  (`tail`, which may begin its end marker), or null. */
  let forwarded = 0, raw = null;

  function endPaste(out, content) {
    if (!over) out.push({ paste: decoder().decode(content) });
    paste = null; over = false;
  }
  /** Inside a paste: content up to the end marker, which may arrive split at any byte (the
   *  content's tail is kept until it is known not to begin the marker). Answers what is left. */
  function inPaste(out, data) {
    const content = join(paste, data);
    const scanFrom = Math.max(0, paste.length - (PASTE_END.length - 1));
    for (let i = scanFrom; i < content.length; i++) {
      if (content[i] === ESC && at(content, i, PASTE_END)) {
        endPaste(out, content.subarray(0, i));
        return content.subarray(i + PASTE_END.length);
      }
    }
    if (content.length >= PASTE_LIMIT) { over = true; paste = Uint8Array.from(content.subarray(content.length - (PASTE_END.length - 1))); return new Uint8Array(0); }
    paste = paste.length === 0 ? Uint8Array.from(content) : content; // never a view of the caller's read
    return new Uint8Array(0);
  }

  /** A raw paste: every byte to the agent as it came, up to and with the end marker, which may be
   *  split across reads. Answers what is left after it, or nothing while it goes on. */
  function inRaw(out, data) {
    const seen = join(raw.tail, data);
    for (let i = 0; i + PASTE_END.length <= seen.length; i++) {
      if (seen[i] === ESC && at(seen, i, PASTE_END)) {
        const end = i + PASTE_END.length - raw.tail.length;
        if (end > 0) out.push({ input: data.subarray(0, end) });
        raw = null;
        return data.subarray(Math.max(0, end));
      }
    }
    if (data.length) out.push({ input: data });
    raw.tail = Uint8Array.from(seen.subarray(Math.max(0, seen.length - (PASTE_END.length - 1))));
    return new Uint8Array(0);
  }
  /** How many first bytes of a paste's start marker the events end with, handed on as input. */
  function endsOnStart(out) {
    const last = out.at(-1);
    if (!last?.input || held.length || paste !== null || raw !== null) return 0;
    const b = last.input, n = b.length;
    if (n >= 2 && b[n - 2] === ESC && b[n - 1] === PASTE_START[1]) return 2;
    return n >= 1 && b[n - 1] === ESC ? 1 : 0;
  }

  function scan(out, data) {
    for (let i = 0; i < data.length; i++) {
      const b = data[i];
      if (b === ESC && at(data, i, PASTE_START)) {
        if (i > 0) out.push({ input: data.subarray(0, i) });
        paste = new Uint8Array(0); over = false;
        const rest = inPaste(out, data.subarray(i + PASTE_START.length));
        if (paste !== null) return; // the paste goes on in the next read
        return scan(out, rest);
      }
      const key = keys.find((seq) => seq[0] === b && at(data, i, seq));
      if (key) {
        if (i > 0) out.push({ input: data.subarray(0, i) });
        out.push({ back: true, rest: data.subarray(i + key.length) });
        return;
      }
      // The read ends on what may be the beginning of the back key or of a paste: held.
      if (keys.some((seq) => begins(data, i, seq)) || (data.length - i >= PASTE_HELD_FROM && begins(data, i, PASTE_START))) {
        if (i > 0) out.push({ input: data.subarray(0, i) });
        held = Uint8Array.from(data.subarray(i));
        heldAt = now();
        return;
      }
    }
    if (data.length) out.push({ input: data });
  }

  return {
    feed(bytes) {
      if (!(bytes instanceof Uint8Array)) throw new TypeError("feed expects bytes (a Uint8Array)");
      const out = [], t = now();
      let data = bytes;
      const soon = t - lastFeed < PASTE_PAUSE_MS;
      if (paste !== null && !soon) endPaste(out, paste);
      // A raw paste whose end has not come by the pause is over: what follows is scanned anew.
      if (raw !== null && !soon) raw = null;
      lastFeed = t;
      if (paste !== null) {
        data = inPaste(out, data);
        if (paste !== null) return out;
      }
      if (held.length) { data = join(held, data); held = new Uint8Array(0); }
      // The rest of a start marker whose first bytes the last read handed on: the paste is raw.
      // A beginning of that rest waits for the next read, as a held key does.
      if (raw === null && forwarded > 0 && soon) {
        const rest = PASTE_START.subarray(forwarded);
        if (at(data, 0, rest)) raw = { tail: new Uint8Array(0) };
        else if (begins(data, 0, rest)) { held = Uint8Array.from(data); heldAt = t; return out; }
      }
      forwarded = 0;
      if (raw !== null) data = inRaw(out, data);
      if (raw === null && data.length) scan(out, data);
      forwarded = endsOnStart(out);
      // Events are handed out as copies: the caller may keep them past the next read.
      return out.map((event) => (event.input ? { input: Uint8Array.from(event.input) } : event.rest ? { back: true, rest: Uint8Array.from(event.rest) } : event));
    },
    expire() {
      if (!held.length || now() < heldAt + ESC_TIMEOUT_MS) return [];
      const input = held;
      held = new Uint8Array(0);
      return [{ input }];
    },
    timeoutAt() { return held.length ? heldAt + ESC_TIMEOUT_MS : null; },
  };
}
