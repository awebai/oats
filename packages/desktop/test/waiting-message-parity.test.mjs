// The message contract's parity pin (#552/#553): the kernel's test and this one read the SAME fixture,
// test/fixtures/waiting-message-parity.json at the repository root, so the kernel's validWaitingMessage and
// Desktop's waitingMessage are held to the same answers. The list lives only there: never copy it here.
// Validity is "not null": a withheld note ("[Detail withheld]") is still a valid note, because what this
// pins is the kernel's refused set and length rule, not Desktop's own redaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { waitingMessage } from '../../client/waiting-on-you.mjs';

const raw = readFileSync(new URL('../../../test/fixtures/waiting-message-parity.json', import.meta.url), 'utf8');
const cases = JSON.parse(raw);
const textOf = c => Object.hasOwn(c, 'text') ? c.text : c.unit.repeat(c.repeat);

// The cases the contract requires (the coordinator's spec), by the fixture's own ids (#553 @ 957bdcfa).
const hex = cp => cp.toString(16).padStart(4, '0');
const REQUIRED = [
  'astral-zwj-sequence', 'astral-letter',
  'astral-200', 'astral-201', 'ascii-200', 'ascii-201', 'emoji-100', 'empty',
  ...[0x0000, 0x001F, 0x007F, 0x0080, 0x009F, 0x2028, 0x2029, 0x202A, 0x202E, 0x2066, 0x2069, 0x200B, 0x2060, 0xFEFF, 0xE0000, 0xE007F]
    .map(cp => `refused-u${hex(cp)}`),
  ...[0x0020, 0x00A0, 0x2027, 0x202F, 0x2065, 0x206A, 0x200A, 0x2061, 0xFEFE, 0xE0080, 0xE0100]
    .map(cp => `allowed-u${hex(cp)}`),
  ...['zwj', 'zwnj-persian', 'lrm', 'rlm', 'alm', 'hebrew', 'arabic', 'accents', 'cjk'].map(name => `allowed-${name}`),
];

test('the shared fixture: well-formed cases, unique ids, every required id, non-ASCII as JSON escapes', () => {
  assert.ok(Array.isArray(cases) && cases.length > 0, 'an array of cases');
  assert.match(raw, /^[\x00-\x7f]*$/, 'non-ASCII is written as JSON escapes');
  const ids = new Set();
  for (const c of cases) {
    const at = JSON.stringify(c.id);
    assert.ok(typeof c.id === 'string' && c.id, `an id: ${at}`);
    assert.ok(!ids.has(c.id), `unique id: ${at}`);
    ids.add(c.id);
    const text = Object.hasOwn(c, 'text'), unit = Object.hasOwn(c, 'unit'), repeat = Object.hasOwn(c, 'repeat');
    assert.ok(text ? !unit && !repeat : unit && repeat, `${at}: exactly one of text, or unit with repeat`);
    if (text) assert.equal(typeof c.text, 'string', `${at}: text is a string`);
    else assert.ok(typeof c.unit === 'string' && c.unit && Number.isInteger(c.repeat) && c.repeat >= 0, `${at}: a unit string and a repeat count`);
    assert.equal(typeof c.valid, 'boolean', `${at}: valid`);
    assert.ok(typeof c.why === 'string' && c.why, `${at}: why`);
  }
  assert.deepEqual(REQUIRED.filter(id => !ids.has(id)), [], 'every required case is present');
});

for (const c of cases) {
  test(`parity ${c.id}: ${c.valid ? 'a valid note' : 'refused'}`, () => {
    assert.equal(waitingMessage(textOf(c)) !== null, c.valid, `${c.id}: ${c.why}`);
  });
}
