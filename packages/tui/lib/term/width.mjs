/** Terminal cell widths: how many cells a grapheme takes when `oats tui` writes it.
 * Pure: no IO and no imports, only `Intl.Segmenter`, Unicode property escapes and
 * one range table. A grapheme is the unit of layout: the terminal is given whole
 * graphemes, each in the one or two cells this module says it takes. */

/** Longest grapheme written as itself, in UTF-16 units. The longest emoji sequences
 * stay well under it; anything longer is a stack of marks on one base, and is replaced. */
export const MAX_GRAPHEME_UNITS = 32;
/** What stands in for a grapheme that must not reach the terminal. One cell. */
export const REPLACEMENT = "\uFFFD";

/** East Asian Wide (W) and Fullwidth (F) code points, as sorted, non-touching
 * `[first, last]` pairs. Taken from Unicode 16.0 EastAsianWidth.txt and deliberately
 * coarse: each pair is a whole block or run of blocks, so an unassigned code point
 * inside one counts wide, as the standard says of the CJK blocks. No assigned
 * narrow code point of 16.0 is inside a pair.
 * Emoji are not decided by this table but by the Emoji_Presentation property of
 * the running Node's ICU, which follows new emoji without a table change. */
export const WIDE_RANGES = Object.freeze([
  [0x1100, 0x115f], // Hangul Jamo leading consonants
  [0x2329, 0x232a], // angle brackets
  [0x2630, 0x2637], // Yijing trigrams
  [0x268a, 0x268f], // Yijing monograms and digrams
  [0x2e80, 0x303e], // CJK radicals, Kangxi, description characters, CJK symbols (not U+303F)
  [0x3041, 0x3247], // kana, Bopomofo, Hangul compatibility Jamo, Kanbun, strokes, enclosed CJK
  [0x3250, 0xa4cf], // enclosed CJK, CJK compatibility, Extension A, hexagrams, ideographs, Yi
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms, small form variants
  [0xff01, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6], // fullwidth signs
  [0x16fe0, 0x18d7f], // ideographic symbols and punctuation, Tangut, Khitan small script
  [0x1aff0, 0x1b2ff], // kana extended and supplement, small kana, Nushu
  [0x1d300, 0x1d376], // Tai Xuan Jing symbols, counting rod numerals
  [0x1f200, 0x1f2ff], // enclosed ideographic supplement
  [0x20000, 0x2fffd], // supplementary ideographic plane
  [0x30000, 0x3fffd], // tertiary ideographic plane
].map(Object.freeze));

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
/** Never written: C0, DEL and C1 controls (Cc) drive the terminal, a lone surrogate
 * (Cs) is ill-formed, and terminals disagree on what the line and paragraph
 * separators (Zl, Zp) do. With the `u` flag a paired surrogate is not Cs. */
const UNWRITABLE = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u;
/** Only non-spacing and enclosing marks and format characters: nothing to draw on
 * its own. Cf covers ZWJ, the direction marks, the soft hyphen and U+200B, U+2060,
 * U+FEFF; the variation selectors are Mn. Spacing marks (Mc) take a cell. */
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]+$/u;
/** Drawn as emoji by default. A regional indicator is one, so a flag needs no rule. */
const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}/u;
/** A text-presentation emoji turned into an emoji: by U+FE0F, by a skin tone on a
 * base that takes one, or by a ZWJ join. A digit, `#` or `*` is an Emoji code point
 * too, and U+FE0F alone does not widen it. */
const EMOJI_SEQUENCE = /(?![#*0-9])\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Extended_Pictographic}\u200D\p{Extended_Pictographic}/u;
/** A digit, `#` or `*` is an emoji only as a whole keycap: base, U+FE0F, U+20E3. */
const KEYCAP = /^[#*0-9]\uFE0F\u20E3/;

function isWide(codePoint) {
  if (codePoint < WIDE_RANGES[0][0]) return false;
  let low = 0;
  let high = WIDE_RANGES.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [first, last] = WIDE_RANGES[middle];
    if (codePoint < first) high = middle - 1;
    else if (codePoint > last) low = middle + 1;
    else return true;
  }
  return false;
}

/** 0, 1 or 2 cells, or -1 for a grapheme that is replaced. The order is the rule:
 * replaced before zero-width, so an endless run of marks is not measured, and
 * zero-width before wide, so a lone wide combining mark (U+3099) takes no cell. */
function measure(grapheme) {
  if (grapheme.length === 1) {
    const unit = grapheme.charCodeAt(0);
    if (unit >= 0x20 && unit <= 0x7e) return 1;
  }
  if (grapheme.length > MAX_GRAPHEME_UNITS || UNWRITABLE.test(grapheme)) return -1;
  if (grapheme === "") return 0;
  if (ZERO_WIDTH.test(grapheme)) return 0;
  if (isWide(grapheme.codePointAt(0))) return 2;
  if (EMOJI_PRESENTATION.test(grapheme) || EMOJI_SEQUENCE.test(grapheme) || KEYCAP.test(grapheme)) return 2;
  return 1;
}

/** Cells one grapheme takes: 0, 1 or 2. Decided by its first code point, or by its
 * emoji presentation; East Asian Ambiguous counts 1. A grapheme `cells()` replaces
 * (a control, a lone surrogate, an over-long one) measures 1, the cell of its
 * REPLACEMENT. */
export function graphemeWidth(grapheme) {
  const width = measure(grapheme);
  return width < 0 ? 1 : width;
}

/** The cells of a text: its graphemes in order, each `{ text, width }` with width 1
 * or 2. A zero-width grapheme standing alone is dropped: it takes no cell and is not
 * written. A grapheme that must not be written becomes one REPLACEMENT cell. */
export function cells(text) {
  const out = [];
  if (PRINTABLE_ASCII.test(text)) {
    for (let index = 0; index < text.length; index++) out.push({ text: text[index], width: 1 });
    return out;
  }
  for (const { segment } of SEGMENTER.segment(text)) {
    const width = measure(segment);
    if (width < 0) out.push({ text: REPLACEMENT, width: 1 });
    else if (width > 0) out.push({ text: segment, width });
  }
  return out;
}

/** Total cells of a text: the sum over `cells(text)`. */
export function textWidth(text) {
  if (PRINTABLE_ASCII.test(text)) return text.length;
  let total = 0;
  for (const cell of cells(text)) total += cell.width;
  return total;
}
