// Strings for the differential tests of the withholding expressions (display-filter-differential.test.mjs).
// Seeded, so a failure names its seed and its string; nothing here reads the host's randomness.

// What a URL with credentials is made of, and what breaks one: scheme characters, the separators, the at
// sign, the characters \s matches (a no-break space, the line separator and the BOM among them), capitals,
// and letters that are not ASCII (two of them fold to an ASCII letter in some case mappings).
const URL = ['a', 'b', 'h', 'z', 'A', 'Z', '0', '9', '+', '.', '-', ':', '/', '@', ' ', '\t', '\n', '_', '://', '//', ':/', 'a://', '@b',
  '\u00A0', '\u2028', '\uFEFF', '\u00E9', '\u017F', '\u212A', '\u65E5'];
// The words and prefixes of the other alternatives, and what completes them.
const WORDS = ['token', 'authorization', 'password', 'secret', 'api', 'key', 'api_key', 'api key', 'api-key', 'apikey', 'Token', 'SECRET',
  '=', ':', '_', 'ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_', 'GHP_', 'A1b2C3d4E5f6G7h8', 'x'.repeat(15)];
// Control characters (withheld), characters of NOT_NOTE_TEXT (replaced), half a pair, and a run that takes
// a line to the length limit without a letter in it.
const OTHER = ['\x00', '\x08', '\x0B', '\r', '\x1B', '\x1F', '\x7F', '\x85', '\u200B', '\u202E', '\u2066', '\u{E0001}', '\uD83D', '_'.repeat(2040)];
const PROFILES = [URL, [...URL, ...WORDS], [...URL, ...WORDS, ...OTHER]];
// A URL with credentials, place by place: what is right there, and what is nearly right.
const BEFORE = ['', '', ' ', 'x ', '1', '_', '/', ':', '@', '\n', 'é', '.'];
const SCHEME = ['a', 'b', 'Z', 'h', '1', '9', '+', '.', '-'], NOT_SCHEME = [...SCHEME, '_', 'é', 'ſ', ' ', ''];
const NOT_SEPARATOR = [':/', '//', ':', '', ':///', '::/', ':\n//', ': //', '://://', ':/:/'];
const HOST = ['u', 'b', 'Z', '1', ':', '.', '-', '_', 'é', '@'], NOT_HOST = [...HOST, '/', ' ', '\t', ' ', '﻿', '://'];
const NOT_AT = ['', ' @', '/@', '\n@'];

// mulberry32: a 32-bit generator with a full period, enough to make strings.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** The strings of one seed, one for each call. A string is one to three parts, and a part is either
 * pieces in any order (six strings in ten draw from the URL pieces only) or a URL with credentials whose
 * every place is, one time in five, only nearly right. Mostly short. */
export function stringsOf(seed) {
  const next = random(seed);
  const one = from => from[Math.floor(next() * from.length)];
  const some = (from, most) => { let s = ''; for (let i = Math.floor(next() * (most + 1)); i > 0; i--) s += one(from); return s; };
  const right = () => next() < 0.8;
  return () => {
    const p = next(), pieces = PROFILES[p < 0.6 ? 0 : p < 0.85 ? 1 : 2];
    let s = '';
    for (let parts = 1 + Math.floor(next() * 3); parts > 0; parts--) {
      if (next() < 0.5) { s += some(pieces, 8); continue; }
      s += one(BEFORE) + (right() ? one(SCHEME) : one(NOT_SCHEME)) + some(right() ? SCHEME : NOT_SCHEME, 3) + (right() ? '://' : one(NOT_SEPARATOR))
        + some(right() ? HOST : NOT_HOST, 4) + (right() ? '@' : one(NOT_AT)) + some(pieces, 2);
    }
    return s;
  };
}

/** Every string of at most `max` characters over `alphabet`, shortest first. */
export function* everyString(alphabet, max) {
  yield '';
  for (let length = 1; length <= max; length++) {
    const digits = new Array(length).fill(0);
    for (;;) {
      let s = '';
      for (const d of digits) s += alphabet[d];
      yield s;
      let i = length - 1;
      while (i >= 0 && ++digits[i] === alphabet.length) digits[i--] = 0;
      if (i < 0) break;
    }
  }
}
