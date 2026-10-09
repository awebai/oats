/** The characters the kernel never stores or prints in text it did not write itself (the
 *  maintainer's set): control characters (Cc: C0, DEL, C1), the Unicode line and paragraph
 *  separators, the bidi embeddings, overrides and isolates (U+202A-202E, U+2066-2069), the
 *  invisible hiders U+200B, U+2060 and U+FEFF, and the tag characters (U+E0000-E007F).
 *  Everything else is allowed, ZWJ and ZWNJ (U+200C/D, emoji sequences, Persian and Indic text)
 *  and the marks LRM, RLM and ALM (U+200E/F, U+061C) included. One set for the kernel: a waiting
 *  claim's message (lib/instance-events.mjs) refuses it, a trigger source's text
 *  (lib/triggers.mjs) has it replaced. The Desktop keeps its own identical copy. */
export const REFUSED_TEXT = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF\u{E0000}-\u{E007F}]/u;
const REFUSED_TEXT_ALL = new RegExp(REFUSED_TEXT.source, "gu");

/** Text from outside the kernel, made safe to store and print: every REFUSED_TEXT character
 *  replaced with U+FFFD, then cut to `max` code points, ending in `…` when cut. */
export function safeText(text, max) {
  const points = [...String(text).replace(REFUSED_TEXT_ALL, "\uFFFD")];
  return points.length > max ? `${points.slice(0, max - 1).join("")}…` : points.join("");
}
