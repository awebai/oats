// The three withholding expressions of the shared home, each held to the expression it was before #976,
// which made them find `://` first and look behind it for the scheme so that their time grows with the
// length of the text. They withhold exactly what they withheld: the expressions before stay here as
// literals, and they are the reference. A disagreement is a fault in the new expression, never in this test.
//
// Two sets of strings for each: every short string over one character of each class the URL alternative
// tells apart, and generated strings of one seed (helpers/filter-strings.mjs). The long run made once for
// the change is this file with OATS_FILTER_DIFFERENTIAL='<generated strings> <seed> <short length>'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { displayLine, UNSAFE, DETAIL_WITHHELD, NOT_NOTE_TEXT, MAX_DISPLAY_LINE } from '../../client/display-text.mjs';
import { eventsUnsafe, eventsDetail, EVENTS_WITHHELD } from '../../client/instance-events-contract.mjs';
import { readinessData } from '../../client/readiness-contract.mjs';
import { data, target } from './helpers/readiness-fixture.mjs';
import { stringsOf, everyString } from './helpers/filter-strings.mjs';

// display-text.mjs `UNSAFE` before this change.
const UNSAFE_BEFORE = /[\x00-\x08\x0b-\x1f\x7f]|[a-z][a-z0-9+.-]*:\/\/[^\s/]*@|(?:token|authorization|password|secret|api[_ -]?key)\s*[:=]\s*\S+|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/i;
// readiness-contract.mjs `unsafe` before this change.
const READINESS_UNSAFE_BEFORE = /[\x00-\x08\x0b-\x1f\x7f]|[a-z][a-z0-9+.-]*:\/\/[^\s/]*@|(?:token|authorization|password|secret|api[_ -]?key)\s*[:=]\s*\S+/i;
// instance-events-contract.mjs `eventsUnsafe` before this change.
const EVENTS_UNSAFE_BEFORE = /[\x00-\x08\x0b-\x1f\x7f]|[a-z][a-z0-9+.-]*:\/\/\S+|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}|(?:token|authorization|password|secret|api[_ -]?key)\s*[:=]\s*\S+/i;

// display-text.mjs `displayLine` before this change: the same folding, replacement and bound, on UNSAFE_BEFORE.
const EVERY_NOT_NOTE_TEXT = new RegExp(NOT_NOTE_TEXT.source, 'gu');
function oneLineBefore(text) {
  const line = text.replace(/[\t\n\u2028\u2029]/g, ' ').replace(/ {2,}/g, ' ').replace(/^ | $/g, '').replace(EVERY_NOT_NOTE_TEXT, '\uFFFD');
  if (line.length <= MAX_DISPLAY_LINE) return line;
  const last = line.charCodeAt(MAX_DISPLAY_LINE - 1);
  return line.slice(0, last >= 0xD800 && last <= 0xDBFF ? MAX_DISPLAY_LINE - 1 : MAX_DISPLAY_LINE).replace(/ $/, '');
}
function displayLineBefore(text) {
  if (typeof text !== 'string' || !text) return null;
  if (UNSAFE_BEFORE.test(text)) return DETAIL_WITHHELD;
  const line = oneLineBefore(text);
  return !line ? null : UNSAFE_BEFORE.test(line) ? DETAIL_WITHHELD : line;
}

const [GENERATED = 200_000, SEED = 976, SHORT = 7] = (process.env.OATS_FILTER_DIFFERENTIAL ?? '').split(' ').filter(Boolean).map(Number);
// One character of each class the URL alternative tells apart: a letter, a scheme character that is not a
// letter, the colon, the slash, the at sign, a space, and a character that is none of them. To that
// alternative, any string of up to SHORT characters reads as one of the strings over these.
const CLASSES = ['a', '1', ':', '/', '@', ' ', '_'];

/** Both sets of strings, each given to `check(string, where)`. Says how many, and how many the reference withholds. */
function withEveryString(t, before, check) {
  let count = 0, withheld = 0;
  for (const s of everyString(CLASSES, SHORT)) { check(s, `one of every string of up to ${SHORT} characters`); count++; if (before.test(s)) withheld++; }
  const short = count, shortWithheld = withheld, next = stringsOf(SEED);
  for (let i = 0; i < GENERATED; i++) { const s = next(); check(s, `string ${i} of seed ${SEED}`); count++; if (before.test(s)) withheld++; }
  // The generated strings are worth something only if the reference answers both ways on plenty of them.
  const generatedWithheld = withheld - shortWithheld;
  assert.ok(shortWithheld > 0 && generatedWithheld > GENERATED / 5 && generatedWithheld < GENERATED * 4 / 5,
    `the reference withholds ${shortWithheld} of ${short} short strings and ${generatedWithheld} of ${GENERATED} generated ones`);
  t.diagnostic(`${short} short strings (${shortWithheld} withheld) and ${GENERATED} of seed ${SEED} (${generatedWithheld} withheld)`);
}
const differ = (what, s, where, was, is) => assert.fail(`${what} differs from the expression before on ${JSON.stringify(s)} (${where}): it was ${JSON.stringify(was)} and is ${JSON.stringify(is)}`);

// What the URL alternative matches and what it does not, said once by hand: the reference is held to it too.
const CREDENTIALS = [['a://@', true], ['https://user:pw@host.example/repo.git', true], ['A://B@', true], ['x a://b@c', true], ['1a://@', true],
  ['a1+.-://@', true], ['+a://@', true], ['a://b:c@d', true], ['a://b@ c', true], ['\u00E9a://@', true], ['a://\u00E9@', true], ['a://a://@', true],
  ['1://@', false], ['-://@', false], ['://@', false], ['a:/@', false], ['a//@', false], ['a:///@', false], ['a://b/@', false], ['a://b @', false],
  ['a:// @', false], ['a://\u00A0@', false], ['a://\uFEFF@', false], ['a://b\n@', false], ['a\n://@', false], ['a:\n//@', false], ['a_://@', false],
  ['\u00E9://@', false], ['\u017F://@', false], ['\u212A://@', false], ['a://://@', false], ['a://b', false], ['@a://', false]];
const ADDRESSES = [['a://b', true], ['A://B', true], ['1a://b', true], ['a1+.-://b', true], ['x a://@', true], ['a:///', true], ['a://://', true],
  ['a://', false], ['a:// b', false], ['a://\n', false], ['1://b', false], ['://b', false], ['a:/b', false], ['a//b', false], ['a_://b', false],
  ['\u00E9://b', false], ['\u017F://b', false], ['\u212A://b', false]];

test('display-text.mjs UNSAFE matches exactly what the expression before matched, and displayLine answers what it answered', t => {
  for (const [s, unsafe] of CREDENTIALS) { assert.equal(UNSAFE_BEFORE.test(s), unsafe, JSON.stringify(s)); assert.equal(UNSAFE.test(s), unsafe, JSON.stringify(s)); }
  withEveryString(t, UNSAFE_BEFORE, (s, where) => {
    const was = UNSAFE_BEFORE.test(s), is = UNSAFE.test(s);
    if (was !== is) differ('UNSAFE', s, where, was, is);
    const lineWas = displayLineBefore(s), lineIs = displayLine(s);
    if (lineWas !== lineIs) differ('displayLine', s, where, lineWas, lineIs);
  });
});

test('readiness-contract.mjs withholds exactly the texts the expression before withheld', t => {
  // The expression is private: a note of a readiness answer is the shortest way to it (64 notes an answer).
  const answer = data(), notes = [], wheres = [];
  const flush = () => {
    if (!notes.length) return;
    const read = readinessData({ ...answer, notes }, target);
    assert.ok(read, 'the readiness answer is read');
    notes.forEach((s, i) => {
      const was = READINESS_UNSAFE_BEFORE.test(s) ? '[Detail withheld]' : s;
      if (read.notes[i] !== was) differ('a readiness text', s, wheres[i], was, read.notes[i]);
    });
    notes.length = wheres.length = 0;
  };
  // Its texts are bounded to 1024 characters: a longer one refuses the whole answer, before and since.
  const check = (s, where) => { if (s.length > 1024) return; notes.push(s); wheres.push(where); if (notes.length === 64) flush(); };
  for (const [s, unsafe] of CREDENTIALS) { assert.equal(READINESS_UNSAFE_BEFORE.test(s), unsafe, JSON.stringify(s)); check(s, 'said by hand'); }
  withEveryString(t, READINESS_UNSAFE_BEFORE, check);
  flush();
});

test('instance-events-contract.mjs eventsUnsafe matches exactly what the expression before matched, and eventsDetail withholds what it withheld', t => {
  for (const [s, unsafe] of ADDRESSES) { assert.equal(EVENTS_UNSAFE_BEFORE.test(s), unsafe, JSON.stringify(s)); assert.equal(eventsUnsafe.test(s), unsafe, JSON.stringify(s)); }
  withEveryString(t, EVENTS_UNSAFE_BEFORE, (s, where) => {
    const was = EVENTS_UNSAFE_BEFORE.test(s), is = eventsUnsafe.test(s);
    if (was !== is) differ('eventsUnsafe', s, where, was, is);
    if (s.length <= 2048 && eventsDetail(s) !== (was ? EVENTS_WITHHELD : s)) differ('eventsDetail', s, where, was ? EVENTS_WITHHELD : s, eventsDetail(s));
  });
});
