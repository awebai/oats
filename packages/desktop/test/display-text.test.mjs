// The display filter (renderer/display-text.mjs): pure, no DOM. Characters of the set are code points or
// escapes here, never literal characters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { displayLine, cleanLine, NOT_NOTE_TEXT, UNSAFE, DETAIL_WITHHELD, MAX_DISPLAY_LINE } from '../../client/display-text.mjs';

const at = cp => String.fromCodePoint(cp);
const REPLACEMENT = at(0xFFFD);
// The set, each range at both ends, by what the filter does with it.
const FOLDED = [0x0009, 0x000A, 0x2028, 0x2029];                    // become a space
const WITHHELD = [0x0000, 0x0008, 0x000B, 0x000D, 0x001F, 0x007F];  // UNSAFE: the whole text is withheld
const REPLACED = [0x0080, 0x009F, 0x202A, 0x202E, 0x2066, 0x2069, 0x200B, 0x2060, 0xFEFF, 0xE0000, 0xE007F];
// Text outside the set: Japanese, Arabic, Persian with ZWNJ, an emoji ZWJ sequence, LRM, RLM, ALM, the
// soft hyphen, and the neighbours of the set's ranges.
const TEXT = ['\u65E5\u672C\u8A9E\u306E\u30D5\u30A1\u30A4\u30EB', '\u0645\u0644\u0641 \u0627\u0644\u0639\u0645\u0644',
  '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645', '\u{1F469}\u200D\u{1F4BB}', 'a\u200Eb', '\u05D0\u200Fb', '\u0627\u061Cb',
  'co\u00ADop', 'a\u00A0b', 'a\u2027b', 'a\u202Fb', 'a\u2065b', 'a\u206Ab', 'a\u200Ab', 'a\u2061b', 'a\uFEFEb', 'a\u{E0080}b',
  'r\u00E9sum\u00E9 /srv/agents/dev/instances/dev-1/work: fatal: not a git repository'];
const SECRETS = ['token=abc123', 'password: hunter2', 'api key: abc', 'https://user:pw@host.example/repo.git', `gh${'p'}_${'a'.repeat(20)}`];

test('not a non-empty string, or nothing but breaks and spaces: null', () => {
  for (const v of [undefined, null, 7, 10n, {}, ['a'], '', ' ', '\n', ' \t\n ', at(0x2028) + at(0x2029)]) assert.equal(displayLine(v), null, String(v));
});

test('one line: tab, line feed and the line and paragraph separators each become a space; runs collapse; the ends are trimmed', () => {
  assert.equal(displayLine('fatal: not a git repository\n\thint: run git init\n'), 'fatal: not a git repository hint: run git init');
  assert.equal(displayLine('  a   b  '), 'a b');
  for (const cp of FOLDED) {
    assert.equal(displayLine(`a${at(cp)}b`), 'a b', cp.toString(16));
    assert.equal(displayLine(`${at(cp)}a ${at(cp)}${at(cp)} b${at(cp)}`), 'a b', cp.toString(16));
  }
});

test('every character of the set still present becomes U+FFFD, one for one, also at the ends', () => {
  for (const cp of REPLACED) {
    assert.equal(displayLine(`a${at(cp)}b`), `a${REPLACEMENT}b`, cp.toString(16));
    assert.equal(displayLine(`${at(cp)}a${at(cp)}${at(cp)}b${at(cp)}`), `${REPLACEMENT}a${REPLACEMENT}${REPLACEMENT}b${REPLACEMENT}`, cp.toString(16));
  }
  const all = displayLine(REPLACED.map(at).join('x'));
  assert.equal(all, REPLACED.map(() => REPLACEMENT).join('x'));
  assert.doesNotMatch(all, NOT_NOTE_TEXT);
});

test('text outside the set is kept unchanged: international text, and ZWJ, ZWNJ, LRM, RLM, ALM and the soft hyphen', () => {
  for (const text of TEXT) { assert.equal(displayLine(text), text, JSON.stringify(text)); assert.equal(cleanLine(text), true, JSON.stringify(text)); }
});

test('what is unsafe is withheld whole, tested on the text as given: before folding, replacement and truncation', () => {
  for (const secret of SECRETS) {
    assert.equal(displayLine(secret), DETAIL_WITHHELD, secret);
    assert.equal(displayLine(`first line\n${at(0x202E)}${secret}${at(0x200B)}\n\tlast line`), DETAIL_WITHHELD, secret);
    assert.equal(displayLine(`${'x'.repeat(3000)} ${secret}`), DETAIL_WITHHELD, 'past the length limit');
  }
  assert.equal(displayLine('token =\n abc123'), DETAIL_WITHHELD, 'across a line break');
  for (const cp of WITHHELD) assert.equal(displayLine(`a${at(cp)}b`), DETAIL_WITHHELD, cp.toString(16));
  // The line that would be shown is held to the same rule.
  assert.equal(displayLine(`token=${at(0xFEFF)}`), DETAIL_WITHHELD);
  assert.equal(displayLine(DETAIL_WITHHELD), DETAIL_WITHHELD);
});

test('bounded to 2048 UTF-16 units after filtering, without splitting a pair or ending on a space', () => {
  assert.equal(MAX_DISPLAY_LINE, 2048);
  assert.equal(displayLine('m'.repeat(5000)).length, 2048);
  assert.equal(displayLine('m'.repeat(2048)), 'm'.repeat(2048));
  assert.equal(displayLine(`${'m\n'.repeat(1500)}`).length, 2047, 'folded first, then bounded: 1024 pairs minus the final space');
  assert.equal(displayLine(`${'m'.repeat(2047)}${at(0x1F600)}tail`), 'm'.repeat(2047), 'a pair is never split');
  assert.equal(displayLine(`${'m'.repeat(2047)} tail`), 'm'.repeat(2047), 'never ends on a space');
});

test('filtering twice equals filtering once', () => {
  const inputs = [...TEXT, ...SECRETS, ...[...FOLDED, ...WITHHELD, ...REPLACED].flatMap(cp => [`a${at(cp)}b`, `${at(cp)}a b${at(cp)}`, `token=${at(cp)}`, `x://a${at(cp)}b@c`]),
    'fatal: not a git repository\n\thint: run git init\n', '  a   b  ', 'm'.repeat(5000), `${'m'.repeat(2047)}${at(0x1F600)}tail`, `${'m'.repeat(2047)} tail`,
    `${'m '.repeat(1500)}`, '', ' ', '\n'];
  for (const input of inputs) {
    const once = displayLine(input);
    assert.equal(displayLine(once), once, JSON.stringify(input.slice(0, 40)));
    if (once !== null) assert.equal(cleanLine(once), true, JSON.stringify(input.slice(0, 40)));
  }
});

test('cleanLine: a string the filter would return unchanged, and nothing else', () => {
  for (const v of ['fatal: not a git repository', DETAIL_WITHHELD, 'm'.repeat(2048)]) assert.equal(cleanLine(v), true, v.slice(0, 40));
  for (const v of [undefined, null, 7, '', ' ', 'two\nlines', 'a\tb', ' leading', 'trailing ', 'two  spaces', 'm'.repeat(2049), 'token=abc123',
    ...[...FOLDED, ...WITHHELD, ...REPLACED].map(cp => `a${at(cp)}b`)]) assert.equal(cleanLine(v), false, JSON.stringify(v));
});

test('the set has one definition; the withholding pattern is the one remote reasons use today; both are stateless', () => {
  assert.equal(NOT_NOTE_TEXT.global, false); assert.equal(UNSAFE.global, false);
  const read = name => readFileSync(new URL(`../../client/${name}`, import.meta.url), 'utf8');
  assert.match(read('waiting-on-you.mjs'), /import \{ NOT_NOTE_TEXT \} from '\.\/display-text\.mjs'/);
  assert.doesNotMatch(read('waiting-on-you.mjs'), /\\p\{Cc\}/, 'waiting-on-you.mjs defines no set of its own');
  assert.equal(UNSAFE.flags, 'i');
  assert.equal(UNSAFE.source, String.raw`[\x00-\x08\x0b-\x1f\x7f]|[a-z][a-z0-9+.-]*:\/\/[^\s/]*@|(?:token|authorization|password|secret|api[_ -]?key)\s*[:=]\s*\S+|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}`,
    'unchanged, character for character');
  assert.match(read('remote-address.mjs'), /import \{ displayLine, cleanLine, DETAIL_WITHHELD \} from '\.\/display-text\.mjs'/);
  assert.doesNotMatch(read('remote-address.mjs'), /\\x00|\bUNSAFE\b/, 'remote-address.mjs has no pattern of its own');
});
