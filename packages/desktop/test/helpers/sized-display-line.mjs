// One call of the display filter on one sized input, as a program: `node sized-display-line.mjs <shape>`
// prints {"answer", "ms"}. A process of its own because an expression runs in one turn of its thread: no
// timer of that thread can fire while it runs, so only another process can end it
// (display-filter-time.test.mjs does, at its limit). It writes no file.
import { fileURLToPath } from 'node:url';
import { displayLine } from '../../../client/display-text.mjs';

/** Characters in each input. Where this was sized, the withholding expression before #976 took 1.7 s for a
 * run of 32,768 letters and four times that for each doubling, so more than an hour and a half for this
 * many; the expression since takes some tens of milliseconds for them. */
export const SIZE = 2_000_000;

const fill = (unit, n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
/** The hostile shapes, by what each is. */
export const SHAPES = {
  'a run of letters': n => 'a'.repeat(n),
  'a run of scheme characters': n => fill('a1+.-', n),
  'a run of letters before one :// with no @': n => `${'a'.repeat(n)}://host/path`,
  'a run of letters before one :// with an @': n => `${'a'.repeat(n)}://user@host`,
  'a run of digits before one :// with an @': n => `${'1'.repeat(n)}://user@host`,
  'one :// and a run of letters with no @': n => `a://${'b'.repeat(n)}`,
  'one :// and a run of colons with no @': n => `a://${fill('b:', n)}`,
  'very many :// with no @': n => fill('a://', n),
  'a run of letters after token=': n => `token=${'a'.repeat(n)}`,
  'token and a run of spaces': n => `token${' '.repeat(n)}`,
  'token, a run of spaces, = and a run of spaces': n => `token${' '.repeat(n / 2)}=${' '.repeat(n / 2)}`,
  'very many token': n => fill('token ', n),
  'runs of api': n => fill('api', n),
  'very many token prefixes, each one character short': n => fill(`ghp_${'a'.repeat(15)} `, n),
  'a run of spaces at the end': n => `a${' '.repeat(n)}`,
  'a run of tabs': n => `a${'\t'.repeat(n)}b`,
  'very many line feeds': n => fill('a\n', n),
  'a run of zero-width spaces': n => `a${'\u200B'.repeat(n)}b`,
  'a run of tag characters': n => fill('\u{E0001}', n),
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = SHAPES[process.argv[2]](SIZE);
  const started = process.hrtime.bigint();
  const answer = displayLine(input);
  process.stdout.write(JSON.stringify({ answer, ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6) }));
}
