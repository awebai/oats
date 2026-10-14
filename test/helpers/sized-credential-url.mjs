// One call of the kernel's credential-URL check on one sized input, as a program:
// `node sized-credential-url.mjs <shape>` prints {"answer", "ms"}. A process of its own because an
// expression runs in one turn of its thread: no timer of that thread can fire while it runs, so only another
// process can end it (credential-url-time.test.mjs does, at its limit). It writes no file.
import { fileURLToPath } from "node:url";
import { carriesCredentialForTests } from "../../lib/remote.mjs";

/** Characters in each input. Where this was sized, the check before #1036 took 0.87 s for a run of 32,768
 *  characters of `a.` and four times that for each doubling, so about an hour for this many; the check
 *  since takes some milliseconds for them. */
export const SIZE = 2_000_000;

const fill = (unit, n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
/** The hostile shapes, by what each is. */
export const SHAPES = {
  "a run of a.": (n) => fill("a.", n),
  "a run of a-": (n) => fill("a-", n),
  "a run of a+": (n) => fill("a+", n),
  "a run of letters": (n) => "a".repeat(n),
  "a run of scheme characters": (n) => fill("a1+.-", n),
  "very many :// with no @": (n) => fill("a://", n),
  "very many http:// with no @": (n) => fill("http://x", n),
  "one :// and a run of b: with no @": (n) => `a://${fill("b:", n)}`,
  "one :// and a run of letters with no @": (n) => `a://${"b".repeat(n)}`,
  "a run of a. before one :// with no @": (n) => `${fill("a.", n)}://u:p/h`,
  "a run of a. before one :// with u:p@": (n) => `${fill("a.", n)}://u:p@h`,
  "a run of a. before one http:// with u@": (n) => `${fill("a.", n)}http://u@h`,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = SHAPES[process.argv[2]](SIZE);
  const started = process.hrtime.bigint();
  const answer = carriesCredentialForTests(input);
  process.stdout.write(JSON.stringify({ answer, ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6) }));
}
