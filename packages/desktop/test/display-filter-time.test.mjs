// The display filter's time grows with the length of its input, not with its square (#976). Sized, not
// timed: each input is so long that an expression whose time grows with the square of a run cannot answer
// (hours) and one whose time grows with the length answers at once (well under a second), and the limit
// sits two orders of magnitude from both. So the test depends on the growth and not on the machine.
//
// Each call runs in a process of its own (helpers/sized-display-line.mjs), which this test kills at the
// limit: an expression cannot be interrupted from its own thread, by a timer or by the runner's timeout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DETAIL_WITHHELD, MAX_DISPLAY_LINE } from '../../client/display-text.mjs';
import { SIZE, SHAPES } from './helpers/sized-display-line.mjs';

const LIMIT_MS = 30_000;
const PROGRAM = fileURLToPath(new URL('./helpers/sized-display-line.mjs', import.meta.url));
const REPLACEMENT = '\uFFFD';
const line = unit => unit.repeat(MAX_DISPLAY_LINE).slice(0, MAX_DISPLAY_LINE);

// What displayLine answers for each shape: the same as for a short input of that shape.
const ANSWERS = {
  'a run of letters': line('a'),
  'a run of scheme characters': line('a1+.-'),
  'a run of letters before one :// with no @': line('a'),
  'a run of letters before one :// with an @': DETAIL_WITHHELD,
  'a run of digits before one :// with an @': line('1'),            // no scheme: a scheme starts with a letter
  'one :// and a run of letters with no @': `a://${line('b')}`.slice(0, MAX_DISPLAY_LINE),
  'one :// and a run of colons with no @': `a://${line('b:')}`.slice(0, MAX_DISPLAY_LINE),
  'very many :// with no @': line('a://'),
  'a run of letters after token=': DETAIL_WITHHELD,
  'token and a run of spaces': 'token',
  'token, a run of spaces, = and a run of spaces': 'token =',
  'very many token': line('token ').replace(/ $/, ''),
  'runs of api': line('api'),
  'very many token prefixes, each one character short': line(`ghp_${'a'.repeat(15)} `).replace(/ $/, ''),
  'a run of spaces at the end': 'a',
  'a run of tabs': 'a b',
  'very many line feeds': line('a ').replace(/ $/, ''),
  'a run of zero-width spaces': `a${line(REPLACEMENT)}`.slice(0, MAX_DISPLAY_LINE),
  'a run of tag characters': line(REPLACEMENT),
};

test('every hostile shape has its answer', () => {
  assert.deepEqual(Object.keys(ANSWERS), Object.keys(SHAPES));
  for (const shape of Object.keys(SHAPES)) assert.ok(SHAPES[shape](SIZE).length >= SIZE, shape);
});

for (const [shape, answer] of Object.entries(ANSWERS)) {
  test(`${SIZE} characters, ${shape}: answered within the limit, and with the same answer`, t => {
    const child = spawnSync(process.execPath, [PROGRAM, shape], { encoding: 'utf8', timeout: LIMIT_MS, killSignal: 'SIGKILL' });
    if (child.error?.code === 'ETIMEDOUT') {
      assert.fail(`the display filter's time no longer grows with the length of its input: no answer in ${LIMIT_MS / 1000} s for ${SIZE} characters, ${shape} (the process was ended)`);
    }
    assert.equal(child.status, 0, `${child.error ?? ''}${child.signal ?? ''}${child.stderr}`);
    const said = JSON.parse(child.stdout);
    assert.equal(said.answer, answer);
    t.diagnostic(`${said.ms} ms`);
  });
}
