// The reading test of the client's own error codes (awebai/oats#1047).
//
// The shared home (packages/client) writes error codes of its own that have the kernel's shape, `E_` and
// capitals, and reads them in the same places as the kernel's. A kernel code that took one of those names
// would be read as the client's own. packages/client/own-codes.mjs lists them (CLIENT_OWN_CODES), and this
// test holds the list both ways, reading the sources and running none of them:
//
//   no collision    no listed name is written in the code of lib/ or bin/;
//   complete        every name of that shape written in the code of packages/client is listed, or is
//                   written in the code of lib/ or bin/ (then it is a kernel's code, which the client's
//                   tables hold a sentence for). And every listed name is written in packages/client.
//
// "Written in the code" is the same reading on both sides, by the reader the boundary test uses
// (test/helpers/source-tokens.mjs): a name (an object's key, a property, any other name), or a whole word
// of the shape inside a quoted string, a template with no `${…}` or a regular expression. So a sentence
// that mentions a code writes it. A comment is never read. The reader gives a string as it is spelled, so
// its escapes are resolved here before the words are looked for, every escape of a string and of a regular
// expression (`unescaped` says how): `"retry:\nE_BUSY"` holds the name, and so do `"E_\u0042USY"` and
// `/\105_BUSY/`; in a regular expression a class or an assertion (`\b`, `\d`) stands between words. A text
// that still holds a backslash is resolved again, a few times (`textsOf`), so a string that holds a regular
// expression's source is read as that too. Each half is proved to fail on a name planted in a source given
// to it (the last tests).
//
// What this test does not see:
//   * a code built from parts (`"E_" + kind`), and a name in the text of a template that has a `${…}`: the
//     reader keeps the code inside the `${…}` and not the template's own text;
//   * a name a regular expression matches without spelling it whole (alternatives, a class, a group, a
//     quantifier, a wildcard), or in another case under its `i` flag; and a name written with an escape
//     outside a string (a key `E_\u0042USY`);
//   * a name cut in two by a line continuation in a file whose lines end with a carriage return and a line
//     feed: the reader ends a string at the line feed;
//   * a name in a file that is not a module: a data file is not read;
//   * a name the client and the kernel both write on purpose, for one meaning: to this test it is the
//     kernel's, never a collision;
//   * names written anywhere else: the Desktop's server and renderer and the terminal client write codes
//     of their own, and so do provider packages and their mirrors. None of them is read here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readingsOf } from "./helpers/source-tokens.mjs";
import { CLIENT_OWN_CODES } from "../packages/client/own-codes.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HOME = "packages/client", LIST = `${HOME}/own-codes.mjs`, KERNEL = ["lib", "bin"];
const SHAPE = /^E_[A-Z0-9_]+$/;
/** A whole word of the shape inside a text: not the tail of a longer name, and not the head of one. */
const WORDS = /(?<![A-Za-z0-9_])E_[A-Z0-9_]+(?![A-Za-z0-9_])/g;
const isModule = (path) => /\.(mjs|cjs|js|jsx|ts|mts|cts|tsx)$/.test(path); // as the boundary test reads them

// ── The reading ───────────────────────────────────────────────────────────────
// A tree is a Map of repository-relative path (with `/`) to a module's text. Both halves read trees and
// nothing else, so the same reading runs on the repository and on the sources planted below.

/**
 * A spelling with its escapes resolved once, as the language resolves them: of a string or a template (`regexp` false), or
 * of a regular expression. `\u{…}`, `\uXXXX`, `\xHH` and a legacy octal escape (`\105`) are their character; in a string a
 * backslash before a line terminator is nothing, and any other escaped character is itself or the control character it
 * names. In a regular expression what matches no one character reads as a space: an assertion or a class (`\b`, `\d`,
 * `\p{…}`), a named reference, and `\cA` is its control character. A decimal escape there is a reference to a group or
 * a legacy octal character, which depends on the groups the expression has: `reference` says which way to read it.
 */
function unescaped(text, regexp, reference = false) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "\\" || i + 1 === text.length) { out += text[i]; continue; }
    const rest = text.slice(i + 1);
    let m;
    if ((m = /^u\{([0-9A-Fa-f]+)\}/.exec(rest)) || (m = /^u([0-9A-Fa-f]{4})/.exec(rest)) || (m = /^x([0-9A-Fa-f]{2})/.exec(rest))) {
      const point = parseInt(m[1], 16);
      out += point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    }
    else if (!regexp && (m = /^(?:\r\n|[\n\r\u2028\u2029])/.exec(rest))) out += "";
    else if (regexp && (m = /^c[A-Za-z]/.exec(rest))) out += String.fromCharCode(m[0].charCodeAt(1) % 32);
    else if (regexp && (m = /^[bBdDwWsSpPk]/.exec(rest))) out += " ";
    else if (regexp && reference && (m = /^[1-9][0-9]*/.exec(rest))) out += " ";
    else if ((m = /^(?:[0-3][0-7]{0,2}|[4-7][0-7]?)/.exec(rest))) out += String.fromCharCode(parseInt(m[0], 8));
    else if ((m = /^[nrtbfv]/.exec(rest))) out += { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v" }[m[0]];
    else { m = [String.fromCodePoint(rest.codePointAt(0))]; out += m[0]; }
    i += m[0].length;
  }
  return out;
}
/** How many times a text that still holds a backslash is resolved again. */
const AGAIN = 4;
/**
 * Every text a string, a plain template or a regular expression may stand for: its escapes resolved, a regular
 * expression's decimal escapes each way. A text that still holds a backslash is then resolved again, as a string and as
 * a regular expression, up to AGAIN times: a string may hold a regular expression's source (`new RegExp("\\bE_BUSY\\b")`)
 * or another quoted string. A name found in any of the texts is written; reading more than the code means errs toward failing.
 */
function textsOf(t, v) {
  const each = (text, regexp) => (regexp ? [unescaped(text, true), unescaped(text, true, true)] : [unescaped(text, false)]);
  const texts = new Set();
  let wave = each(v, t === "re");
  for (let again = 0; wave.length; again++) {
    const fresh = wave.filter((text) => !texts.has(text));
    for (const text of fresh) texts.add(text);
    wave = again < AGAIN ? fresh.filter((text) => text.includes("\\")).flatMap((text) => [...each(text, false), ...each(text, true)]) : [];
  }
  return texts;
}
/** The names of the kernel's shape a source writes, in any reading of it; null when the reader cannot read it. */
function namesIn(source) {
  const readings = readingsOf(source);
  if (!readings) return null;
  const names = new Set();
  for (const tokens of readings) for (const { t, v } of tokens) {
    if (t === "id") { if (SHAPE.test(v)) names.add(v); }
    else if ((t === "str" || t === "tpl" || t === "re") && typeof v === "string") for (const text of textsOf(t, v)) for (const [name] of text.matchAll(WORDS)) names.add(name);
    // The reader takes a number with every word character and dot after it, a property of it too (`1..E_BUSY`).
    else if (t === "num") for (const [name] of v.matchAll(WORDS)) names.add(name);
  }
  return names;
}
/** Every name the modules of a tree write → the paths that write it. A module the reader cannot read is a problem of its own. */
function written(tree) {
  const names = new Map(), unread = [];
  for (const [path, source] of tree) {
    const found = namesIn(source);
    if (!found) unread.push(`${path}: has more possible readings than this reader checks, so its names cannot be told`);
    else for (const name of found) names.set(name, [...(names.get(name) ?? []), path]);
  }
  return { names, unread };
}
/** No collision: a listed name written in the kernel's code. */
function collisions(kernel, listed = CLIENT_OWN_CODES) {
  const { names, unread } = written(kernel);
  return [...unread, ...listed.filter((name) => names.has(name)).map((name) =>
    `${name} is a code of the client's own (${LIST}) and ${names.get(name).join(", ")} writes it: a client would read the kernel's code as its own. Give the kernel's code another name.`)];
}
/** Complete: a name the client writes that is neither listed nor the kernel's, and a listed name the client does not write. */
function incomplete(client, kernel, listed = CLIENT_OWN_CODES) {
  const theirs = written(kernel).names, { names, unread } = written(new Map([...client].filter(([path]) => path !== LIST)));
  return [...unread,
    ...[...names].filter(([name]) => !listed.includes(name) && !theirs.has(name)).sort().map(([name, paths]) =>
      `${name}, written in ${paths.join(", ")}, is neither in ${LIST} nor written in the kernel's code. A code of the client's own goes on that list; a kernel's code is spelled as the kernel spells it.`),
    ...listed.filter((name) => !names.has(name)).map((name) => `${name} is in ${LIST} and nothing else in ${HOME} writes it: take it off the list.`)];
}

/** The modules under the given directories of the repository, as a tree. */
function treeOf(dirs) {
  const tree = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && isModule(path)) tree.set(path, readFileSync(join(ROOT, path), "utf8"));
    }
  };
  for (const dir of dirs) if (existsSync(join(ROOT, dir))) walk(dir);
  return tree;
}

// ── The repository ────────────────────────────────────────────────────────────

const client = treeOf([HOME]), kernel = treeOf(KERNEL);

test("the list is one frozen value: distinct names of the kernel's shape, in order", () => {
  assert.ok(Object.isFrozen(CLIENT_OWN_CODES) && Array.isArray(CLIENT_OWN_CODES));
  assert.ok(CLIENT_OWN_CODES.length > 0);
  for (const name of CLIENT_OWN_CODES) assert.match(name, SHAPE);
  assert.equal(new Set(CLIENT_OWN_CODES).size, CLIENT_OWN_CODES.length, "no name twice");
  assert.deepEqual([...CLIENT_OWN_CODES], [...CLIENT_OWN_CODES].sort(), "sorted");
});

test("no code name of the client's own is written in the kernel's code (lib/, bin/)", (t) => {
  assert.deepEqual(collisions(kernel), []);
  // Not vacuous: the kernel was read, and the reading finds the codes it writes.
  assert.ok(kernel.has("bin/oats.mjs") && kernel.has("lib/core.mjs"), "the kernel was read");
  const theirs = written(kernel).names;
  assert.ok(theirs.size > 150, `the reading finds the kernel's codes (${theirs.size})`);
  t.diagnostic(`${kernel.size} kernel modules read; ${theirs.size} names of the shape; ${CLIENT_OWN_CODES.length} listed`);
});

test("every name of the kernel's shape in packages/client is listed or is the kernel's, and every listed name is written there", (t) => {
  assert.deepEqual(incomplete(client, kernel), []);
  // Not vacuous: the home was read, with the list's own module, and holds names of both kinds.
  assert.ok(client.has(LIST) && client.size >= 48, `the shared home was read (${client.size} modules)`);
  const ours = written(client).names, theirs = written(kernel).names;
  const shared = [...ours.keys()].filter((name) => theirs.has(name));
  assert.ok(shared.length > 30, `the client names kernel codes too (${shared.length})`);
  t.diagnostic(`${client.size} client modules read; ${ours.size} names of the shape: ${shared.length} the kernel's, ${ours.size - shared.length} the client's own`);
});

// ── The reading fails on what it is for ───────────────────────────────────────
// On sources built here, so that a break in the repository fails the tests above and not these.

/** A small repository that breaks neither half: a home with two codes of its own and a sentence for a kernel code, and the kernel. */
const OWN = Object.freeze(["E_OWN_ONE", "E_OWN_TWO"]);
function fixture(changes = {}) {
  const tree = new Map(Object.entries({
    [LIST]: `export const CLIENT_OWN_CODES = Object.freeze(['E_OWN_ONE', 'E_OWN_TWO']);\n`,
    [`${HOME}/table.mjs`]: `// E_ONLY_IN_A_COMMENT is not a code.\nconst errors = { E_OWN_ONE: "A sentence of the client.", E_THEIRS: "A sentence for a kernel code." };\nexport const failed = (code) => ({ code: Object.hasOwn(errors, code) ? code : "E_OWN_TWO" });\n`,
    "lib/core.mjs": `/* The client answers E_OWN_ONE; the kernel never does. */\nexport const refuse = () => fail("E_THEIRS", "refused");\n`,
    "bin/oats.mjs": `import { refuse } from "../lib/core.mjs";\nrefuse();\n`,
    ...changes,
  }));
  const part = (dirs) => new Map([...tree].filter(([path]) => dirs.some((dir) => path.startsWith(`${dir}/`))));
  return { client: part([HOME]), kernel: part(KERNEL) };
}
const collisionsWith = (changes) => collisions(fixture(changes).kernel, OWN);
const incompleteWith = (changes, listed = OWN) => { const { client, kernel } = fixture(changes); return incomplete(client, kernel, listed); };

test("fixture: a repository that breaks neither half has no problem, and a comment is not read on either side", () => {
  assert.deepEqual(collisionsWith(), []);
  assert.deepEqual(incompleteWith(), []);
});

test("positive control, no collision: a listed name planted in a kernel source is found, however it is written, and never in a comment", () => {
  // The line that makes it fail: a kernel module that refuses with one of the client's names.
  assert.deepEqual(collisionsWith({ "lib/planted.mjs": `export const refuse = () => fail("E_OWN_ONE", "busy");\n` }),
    [`E_OWN_ONE is a code of the client's own (${LIST}) and lib/planted.mjs writes it: a client would read the kernel's code as its own. Give the kernel's code another name.`]);
  for (const source of [`const codes = { E_OWN_ONE: 1 };`, `const codes = { 'E_OWN_ONE': 1 };`, `if (e.code === codes.E_OWN_ONE) retry();`,
    `throw new Error("refused (E_OWN_ONE): try again");`, "const said = `E_OWN_ONE`;", `const known = /^(E_OWN_ONE|E_THEIRS)$/;`, `const known = /^E_OWN_ONE$/;`, `const priced = "$E_OWN_ONE$";`, `const odd = 1..E_OWN_ONE;`,
    `const a = 1; const b = a / 2; const c = "E_OWN_ONE"; const d = b / a;`, "const said = `${ok ? \"E_OWN_ONE\" : \"\"}`;"])
    assert.equal(collisionsWith({ "lib/planted.mjs": source }).length, 1, source);
  // After an escape, and spelled with one: the reader gives a string as written, and the name is read from what it stands for.
  for (const source of [String.raw`const retry = /\bE_OWN_ONE\b/.test(message);`, String.raw`const message = "retry:\nE_OWN_ONE";`, String.raw`const message = 'said:\tE_OWN_ONE\tthen';`,
    String.raw`const code = "E_\u004FWN_ONE";`, String.raw`const code = "E_\x4fWN_ONE";`, String.raw`const code = "\u{45}_OWN_ONE";`, String.raw`const code = 'E_OWN\_ONE';`,
    "const said = `first line\\nE_OWN_ONE`;", String.raw`const known = /^E\_OWN_ONE$/;`, String.raw`const known = /\dE_OWN_ONE\s/;`, "const code = \"E_OWN_\\\nONE\";",
    // Every escape whole: a control escape, a legacy octal one (a regular expression's, and a string's in a script), a reference to a group,
    // and a line continuation before each line terminator the language has.
    String.raw`const code = /\cAE_OWN_ONE/;`, String.raw`const code = /\105_OWN_ONE/;`, String.raw`const code = "\105_OWN_ONE";`, String.raw`const code = "E_\117WN_ONE";`,
    String.raw`const twice = /(x)\1E_OWN_ONE/;`, String.raw`const nul = /\0E_OWN_ONE/;`, String.raw`const prop = /\p{Lu}E_OWN_ONE/u;`, String.raw`const named = /(?<n>x)\k<n>E_OWN_ONE/;`,
    ...["\r", "\u2028", "\u2029"].map((end) => `const code = "E_OWN_\\${end}ONE";`),
    // A string that holds a regular expression's source, or another quoted string: resolved again.
    String.raw`const retry = new RegExp("\\bE_OWN_ONE\\b");`, String.raw`const body = "{\"code\":\"E_OWN_ONE\"}";`, String.raw`const deep = "\\\\bE_OWN_ONE";`, String.raw`const source = "\\x45_OWN_ONE";`])
    assert.equal(collisionsWith({ "lib/planted.mjs": source }).length, 1, JSON.stringify(source));
  for (const source of [`// E_OWN_ONE is the client's\nexport const a = 1;`, `/* a client answers E_OWN_ONE */ export const a = 1;`,
    `/** @returns "E_OWN_ONE" */\nexport const a = 1;`, `export const a = "OATS_E_OWN_ONE";`, `export const a = "E_OWN_ONE_MORE";`, `export const a = "e_own_one";`,
    // An escape that makes a letter joins the word it stands in: these are other, longer names.
    String.raw`export const a = "E_OWN_ONE\u0041";`, String.raw`export const a = "\x58E_OWN_ONE";`, String.raw`export const a = "E_OWN\nONE";`])
    assert.deepEqual(collisionsWith({ "lib/planted.mjs": source }), [], source);
  // In bin/ as in lib/, in a subdirectory, and each listed name; two writers are both named.
  assert.equal(collisionsWith({ "bin/planted.mjs": `fail("E_OWN_TWO")` }).length, 1);
  assert.equal(collisionsWith({ "lib/deep/planted.mjs": `fail("E_OWN_TWO")` }).length, 1);
  assert.match(collisionsWith({ "lib/a.mjs": `fail("E_OWN_TWO")`, "bin/b.mjs": `fail("E_OWN_TWO")` })[0], /and lib\/a\.mjs, bin\/b\.mjs writes it/);
  // Outside lib/ and bin/ nothing is read: that is the limit the header states.
  assert.deepEqual(collisionsWith({ "packages/other/planted.mjs": `fail("E_OWN_ONE")` }), []);
});

test("positive control, complete: an unlisted name planted in a client source is found, a kernel's name is not, and a listed name nobody writes is found", () => {
  // The line that makes it fail: a client table that gains a code of its own and not the list.
  assert.deepEqual(incompleteWith({ [`${HOME}/planted.mjs`]: `const errors = { E_OWN_THREE: "A sentence of the client." };\n` }),
    [`E_OWN_THREE, written in ${HOME}/planted.mjs, is neither in ${LIST} nor written in the kernel's code. A code of the client's own goes on that list; a kernel's code is spelled as the kernel spells it.`]);
  for (const source of [`return { code: 'E_OWN_THREE' };`, `if (reason.code === "E_OWN_THREE") return;`, `const text = SPAWN.E_OWN_THREE;`, "const text = `see E_OWN_THREE`;",
    String.raw`const known = /\bE_OWN_THREE\b/.test(message);`, String.raw`const message = "retry:\nE_OWN_THREE";`, String.raw`const code = "E_\u004FWN_THREE";`, String.raw`const known = /^E\_OWN_THREE$/;`,
    String.raw`const code = /\cAE_OWN_THREE/;`, String.raw`const code = /\105_OWN_THREE/;`, String.raw`const code = "\105_OWN_THREE";`, "const code = \"E_OWN_\\\u2028THREE\";",
    String.raw`const retry = new RegExp("\\bE_OWN_THREE\\b");`])
    assert.equal(incompleteWith({ [`${HOME}/planted.mjs`]: source }).length, 1, JSON.stringify(source));
  // A name the kernel writes is a kernel's code with a sentence here: not the client's own, and not to be listed.
  assert.deepEqual(incompleteWith({ [`${HOME}/planted.mjs`]: `const errors = { E_THEIRS: 'Another sentence for the kernel code.' };` }), []);
  assert.deepEqual(incompleteWith({ [`${HOME}/planted.mjs`]: `// E_OWN_THREE is not a code yet\nexport const a = 1;` }), []);
  // Once the list holds it, it passes; the list's own module does not count as a writer of a name.
  assert.deepEqual(incompleteWith({ [`${HOME}/planted.mjs`]: `const errors = { E_OWN_THREE: 'x' };` }, [...OWN, "E_OWN_THREE"]), []);
  assert.deepEqual(incompleteWith({ [LIST]: `export const CLIENT_OWN_CODES = ['E_OWN_ONE', 'E_OWN_TWO', 'E_OWN_GONE'];` }, [...OWN, "E_OWN_GONE"]),
    [`E_OWN_GONE is in ${LIST} and nothing else in ${HOME} writes it: take it off the list.`]);
  // And a file the reader cannot read is said, not skipped, on either side.
  const guesses = Array.from({ length: 8 }, (_, n) => `{} /a${n}/ 1`).join("\n");
  assert.match(incompleteWith({ [`${HOME}/planted.mjs`]: guesses })[0], /^packages\/client\/planted\.mjs: has more possible readings than this reader checks/);
  assert.match(collisionsWith({ "lib/planted.mjs": guesses })[0], /^lib\/planted\.mjs: has more possible readings than this reader checks/);
});
