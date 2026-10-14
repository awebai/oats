// The kernel's credential-URL check (lib/remote.mjs, before a value is written to the parsed cache) answers
// what it answered before #1036, and its time grows with the length of its input, not with its square.
//
// Same answers. The check before #1036 is kept below, verbatim, as REFERENCE. It and the check since have
// the same flags (`i`, no `u`), so `\b`, `[a-z]` and every class mean the same in both: `\b` sits between
// one of [A-Za-z0-9_] and anything else (or an end), and `[a-z]` matches the ASCII letters only. Each
// alternative of REFERENCE matches when there are positions p < q with a word boundary at p, the scheme
// (`https?`, or `[a-z][a-z0-9+.-]*`) spanning exactly p..q, `://` at q, and the userinfo part after q + 3.
// Each alternative since matches `://` at q, then asks behind it, in a look-behind, for a p with a word
// boundary at p and the same scheme spanning p..q, then the same userinfo part after q + 3. A look-behind
// answers whether any such p exists, and nothing after it depends on which p it found (no capture, no
// back-reference), so each alternative accepts exactly the (p, q) pairs it accepted before, and the
// expression matches exactly the texts it matched before. The differential tests below hold this over a
// hand-written list and a seeded generated corpus.
//
// Linear time. A match attempt fails at once at a position that does not start `://`. At a `://` at q:
// - the first look-behind reads at most the five characters of `https`;
// - the second reads back through the run of scheme characters ([a-z0-9+.-]) that ends at q and stops at the
//   first character outside it, trying the word boundary and `[a-z]` once at each position of the run. The
//   runs that end at two different `://` are disjoint: each `://` ends in `/`, which is not a scheme
//   character. So all the look-behinds together read the text at most once;
// - the userinfo part reads forward and stops at whitespace, a quote, `@` or `/` (the first segment also at
//   `:`), backing off once over what it read; it never reads past the `/` of the next `://`. So the forward
//   reads of two `://` overlap by at most the three characters of the later `://`.
// Before #1036 the scheme came first: at each word boundary of a run of scheme characters, the scheme read to
// the end of the run and backed off looking for `://`, once per boundary, so a run with a boundary at every
// other character (`a.a.a.…`) took time that grew with the square of its length.
//
// Sized, not timed: each input is so long that an expression whose time grows with the square of a run
// cannot answer within the limit (about an hour) and one whose time grows with the length answers at once
// (milliseconds), and the limit sits two orders of magnitude from both. So the test depends on the growth
// and not on the machine. Each call runs in a process of its own (helpers/sized-credential-url.mjs), which
// this test kills at the limit: an expression cannot be interrupted from its own thread, by a timer or by
// the runner's timeout.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { carriesCredentialForTests as carriesCredential } from "../lib/remote.mjs";
import { SIZE, SHAPES } from "./helpers/sized-credential-url.mjs";

/** The check before #1036, verbatim: the reference the check since is held to. */
const REFERENCE = /\bhttps?:\/\/[^\s"'\/@]+@|\b[a-z][a-z0-9+.-]*:\/\/[^\s"'\/@:]+:[^\s"'\/@]*@/i;

// The edge cases, each with the answer the reference gives, so a reader sees it without running it.
const EDGES = [
  ["https://user@host", true],
  ["http://u:p@h", true],
  ["HTTPS://U@H", true],
  ["Http://u@h", true],
  ["git+ssh://u:p@h", true],
  ["svn+ssh://u@h", false],                        // a user without a password, on a scheme other than http(s)
  ["ssh://git@github.com/o/r", false],
  ["x-y.z://a:b@c", true],
  ["X-Y.Z://A:B@C", true],
  ["1http://u@h", false],                          // no word boundary before http, and no scheme starts at 1
  ["1http://u:p@h", false],
  ["ahttps://u@h", false],                         // ahttps is a scheme, but carries no password
  ["ahttps://u:p@h", true],
  ["_https://u@h", false],                         // `_` is a word character: no boundary before https
  ["_https://u:p@h", false],
  ["_a://u:p@h", false],
  ["é https://u@h", true],
  ["éhttps://u@h", true],                          // é is not a word character (no `u` flag): a boundary
  ["ſhttps://u@h", true],
  ["\u212Ahttps://u@h", true],                     // the Kelvin sign is no word character either
  ["\u212A://u:p@h", false],                       // nor `[a-z]` under `i` without `u`
  ["-https://u@h", true],
  [".a://u:p@h", true],
  ["+a://u:p@h", true],
  ["a.b://u:p@h", true],
  ["a-://u:p@h", true],
  ["1a://u:p@h", false],
  ["1.a://u:p@h", true],                           // a scheme starts after the dot
  ["://u:p@h", false],                             // no scheme
  [" ://u:p@h", false],
  ["a://@h", false],
  ["a://u:@h", true],
  ["a://:p@h", false],                             // the user is at least one character
  ["a://u:p/@h", false],
  ["a://u::p@h", true],
  ["a://u:p:q@h", true],
  ["http://@h", false],
  ["http://:@h", true],
  ["http://u:p/@h", false],
  ["a://u :p@h", false],                           // whitespace inside the userinfo
  ["a://u:p @h", false],
  ["a://u:\tp@h", false],
  ["a://u:p\n@h", false],
  ["http://u p@h", false],
  ["a://u\":p@h", false],                          // quotes inside the userinfo
  ["a://u:p'@h", false],
  ["http://\"u@h", false],
  ["http://u'@h", false],
  ["https://host/path@x", false],                  // the `/` stops it
  ["https://host/path:x@y", false],
  ["see https://a/b and git://c/d then https://t@e", true], // several URLs, only the last with a credential
  ["see https://a/b and git://c/d then git://u:p@e", true],
  ["see https://a/b and git://c/d then ssh://git@e", false],
  ["https://a, ftp://b; s3://u:p@c", true],
  ["https:\\/\\/u@h", false],                      // JSON-escaped: no `://` in the text
  ["https:\\/\\/u:p@h", false],
  ["https://u\\@h", true],                         // a backslash is no stop character
  [JSON.stringify({ members: ["https://tok3n@github.com/o/r"] }), true],
  [JSON.stringify({ members: ["https://x:tok3n@github.com/o/r"] }), true],
  [JSON.stringify({ members: ["ssh://u:tok3n@example.com/o/r"] }), true],
  [JSON.stringify({ members: ["ssh://git@github.com/o/r"] }), false],
  [JSON.stringify({ a: "https://", b: "u@h" }), false], // the quote ends it
  ["a://u:p@", true],
  ["a://u:p", false],
  ["", false],
  ["@", false],
  [":", false],
  ["://", false],
  ["a:/", false],
  ["a:/u:p@h", false],
  ["a:///u:p@h", false],
  ["http:///u@h", false],
  ["httpss://u@h", false],
  ["httpss://u:p@h", true],
];

test("the reference gives each edge case the answer written beside it", () => {
  for (const [text, answer] of EDGES) assert.equal(REFERENCE.test(text), answer, JSON.stringify(text));
});

test("the check answers each edge case as the reference does", () => {
  for (const [text] of EDGES) assert.equal(carriesCredential(text), REFERENCE.test(text), JSON.stringify(text));
});

/** A seeded generator (mulberry32): the same corpus on every run. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, items) => items[Math.floor(rand() * items.length)];

test("the check answers a seeded corpus of characters as the reference does", () => {
  // Weighted to the characters the expression reads: scheme characters, the delimiters (and `://` whole, so
  // that it is frequent), the stop characters, the backslash, and characters on either side of the boundary.
  // Random characters seldom spell a URL with userinfo: the next corpus is the one that matches often.
  const alphabet = [..."abhpstxyzAHTPS", ..."aabhhttppss", ..."0119", ..."++..--", ..."::::", ..."////", ..."@@@@",
    ..."\"'", ..." \t\n", ..."\\\\", "_", "é", "\u212A", "://", "://", "://", "://"];
  const rand = random(1036);
  let matched = 0, unmatched = 0;
  for (let i = 0; i < 200_000; i++) {
    const length = 1 + Math.floor(rand() * 16);
    let text = "";
    for (let j = 0; j < length; j++) text += pick(rand, alphabet);
    const answer = REFERENCE.test(text);
    if (answer) matched++; else unmatched++;
    assert.equal(carriesCredential(text), answer, JSON.stringify(text));
  }
  assert.ok(matched > 100 && unmatched > 100_000, `the corpus reaches both answers (${matched}, ${unmatched})`);
});

test("the check answers a seeded corpus of URL-shaped texts as the reference does", () => {
  // Each text is a URL with userinfo, slot by slot, where each slot may also take a piece that breaks it, so
  // that both answers are frequent and each part of the expression decides some of them.
  const slots = [
    ["", "", "see ", "x", "1", "_", "é", "a.", "-", " ", "\"", "https://h/ "],     // what comes before
    ["http", "https", "HTTPS", "git+ssh", "a.b-c", "x", "1x", "", "ht tp"],         // the scheme
    ["://", "://", "://", ":\\/\\/", ":/", ":///", "//"],                            // the delimiter
    ["u", "u", "user", "", "u/", "u ", "u\"", "u'", "u\\", "@"],                     // the user
    [":", ":", "", "::", "/"],                                                       // the separator
    ["p", "tok3n", "", "p/", "p\t", "p'", ":p"],                                     // the password
    ["@", "@", "@", "", "/@", " @"],                                                 // the at
    ["h", "host/o/r", "", "\"", " https://u@h"],                                     // what comes after
  ];
  const rand = random(976);
  let matched = 0, unmatched = 0;
  for (let i = 0; i < 100_000; i++) {
    const text = slots.map((slot) => pick(rand, slot)).join("");
    const answer = REFERENCE.test(text);
    if (answer) matched++; else unmatched++;
    assert.equal(carriesCredential(text), answer, JSON.stringify(text));
  }
  assert.ok(matched > 10_000 && unmatched > 10_000, `the corpus reaches both answers (${matched}, ${unmatched})`);
});

const LIMIT_MS = 30_000;
const PROGRAM = fileURLToPath(new URL("./helpers/sized-credential-url.mjs", import.meta.url));

// What the check answers for each shape: the same as for a short input of that shape.
const ANSWERS = {
  "a run of a.": false,
  "a run of a-": false,
  "a run of a+": false,
  "a run of letters": false,
  "a run of scheme characters": false,
  "very many :// with no @": false,
  "very many http:// with no @": false,
  "one :// and a run of b: with no @": false,
  "one :// and a run of letters with no @": false,
  "a run of a. before one :// with no @": false,
  "a run of a. before one :// with u:p@": true,
  "a run of a. before one http:// with u@": true,
};

test("every hostile shape has its answer, and the reference gives it at a short size", () => {
  assert.deepEqual(Object.keys(ANSWERS), Object.keys(SHAPES));
  for (const shape of Object.keys(SHAPES)) {
    assert.ok(SHAPES[shape](SIZE).length >= SIZE, shape);
    assert.equal(REFERENCE.test(SHAPES[shape](64)), ANSWERS[shape], shape);
  }
});

for (const [shape, answer] of Object.entries(ANSWERS)) {
  test(`${SIZE} characters, ${shape}: answered within the limit, and with the same answer`, (t) => {
    const child = spawnSync(process.execPath, [PROGRAM, shape], { encoding: "utf8", timeout: LIMIT_MS, killSignal: "SIGKILL" });
    if (child.error?.code === "ETIMEDOUT") {
      assert.fail(`the credential-URL check's time no longer grows with the length of its input: no answer in ${LIMIT_MS / 1000} s for ${SIZE} characters, ${shape} (the process was ended)`);
    }
    assert.equal(child.status, 0, `${child.error ?? ""}${child.signal ?? ""}${child.stderr}`);
    const said = JSON.parse(child.stdout);
    assert.equal(said.answer, answer);
    t.diagnostic(`${said.ms} ms`);
  });
}
