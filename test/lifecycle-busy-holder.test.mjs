// E_LIFECYCLE_BUSY says, as data, whether waiting ends it (awebai/oats#866, #874, #890). The code
// used to be raised for two different things with the same words: "another command is running, wait"
// and "something a dead command left has to be dealt with by hand". A client that read the code as
// "busy, try again" then waited for ever on the second. Every E_LIFECYCLE_BUSY now carries
// `error.details.holder`, a closed list (docs/desktop-cli-api.md, anchor `busy-holder`):
//   "running"  the kernel established that another oats command is alive: waiting ends it;
//   "unknown"  whether one still runs cannot be read: a person checks what the message names;
//   "none"     nobody is running: the message names the step that ends it.
// and for "unknown" and "none" the message always names that step, after " — ".
//
// A field that is on EVERY answer of a code is only true if the code has one way of being made.
// This file pins that:
//   1. no site of the kernel (lib/, bin/) raises E_LIFECYCLE_BUSY except through the one
//      constructor, lib/errors.mjs lifecycleBusy: a scan of the sources, comments left out;
//   2. the constructor: the message it builds, `details.holder` whatever the details given, and its
//      refusal (a TypeError, a defect) of a holder outside the list and of an "unknown" or a "none"
//      that names no step;
//   3. the builders of the claim refusals, called in this process for every arriving verb and every
//      refusal they have (lib/core.mjs lifecycleClaimRefusals, lib/worktree.mjs
//      worktreeClaimRefusals): the holder each one says, the step it names, what it says was not
//      done, and whose verb `details.action` is;
//   4. the docs table lists exactly the values of the list.
// What each refusal answers on a real home, through the CLI, is test/lifecycle-pair-table.test.mjs
// and the tests of each verb.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lifecycleClaimRefusals } from "../lib/core.mjs";
import { BUSY_HOLDERS, lifecycleBusy } from "../lib/errors.mjs";
import { purposeClaimBusy, worktreeClaimRefusals } from "../lib/worktree.mjs";
import { fixtureBase } from "./helpers/host-fixture.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOC = join(ROOT, "docs", "desktop-cli-api.md");
const CODE = "E_LIFECYCLE_BUSY";
/** The one file that may make the code, and the function in it that does. */
const CONSTRUCTOR_FILE = "lib/errors.mjs";

// ---- 1. the scan ----

/** `source` (JavaScript) with every comment blanked: each character of a `//` or a block comment
 *  becomes a space, so every other character keeps its line and its column. A string, a template
 *  literal and a regular expression are code and are kept whole, whatever they hold (`"//"`, a
 *  quote inside `/["']/`); the expressions inside `${ }` of a template are scanned as code, comments
 *  included. A hashbang line is blanked as a comment.
 *
 *  It is a scanner, not a parser, and it guesses one thing: a `/` after a value (a name, a number,
 *  `)` or `]`) divides, and after anything else starts a regular expression, when one closes on
 *  that line. A wrong guess matters only where the text taken for a regular expression holds a
 *  quote or a comment opener. It does not fail silently: a string that does not end on its line, a
 *  template or a block comment that never ends throws, naming `where` and the line; and the test
 *  below hands every stripped source to `node --check`, which refuses a source in which code was
 *  blanked or a comment was left. */
function withoutComments(source, where) {
  const out = source.split("");
  const n = source.length;
  let i = 0;
  const lineOf = (at) => source.slice(0, at).split("\n").length;
  const lost = (at, what) => new Error(`${where}:${lineOf(at)}: the comment stripper of test/lifecycle-busy-holder.test.mjs lost its place (${what})`);
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "; };
  const WORD = /[A-Za-z0-9_$]/;
  /** Words after which an expression starts: a `/` there opens a regular expression. */
  const BEFORE_AN_EXPRESSION = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
  let afterValue = false;

  const quoted = (quote) => {
    const start = i++;
    while (i < n) {
      const c = source[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "\n") throw lost(start, "a string that does not end on its line");
      i++;
      if (c === quote) return;
    }
    throw lost(start, "a string that never ends");
  };
  /** At a `/` that may open a regular expression: move past it and its flags → true; false when
   *  none closes on this line (it divides). */
  const regularExpression = () => {
    let inClass = false;
    for (let k = i + 1; k < n; k++) {
      const c = source[k];
      if (c === "\n") return false;
      if (c === "\\") { k++; continue; }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        k++;
        while (k < n && /[a-z]/.test(source[k])) k++;
        i = k;
        return true;
      }
    }
    return false;
  };
  const template = () => {
    const start = i++;
    while (i < n) {
      const c = source[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { i++; return; }
      if (c === "$" && source[i + 1] === "{") {
        i += 2;
        code(true);
        if (source[i] !== "}") throw lost(start, "a ${ of a template literal that never closes");
        i++;
        continue;
      }
      i++;
    }
    throw lost(start, "a template literal that never ends");
  };
  /** Code, to the end of the source, or (`inTemplate`) to the `}` that closes a `${`. */
  function code(inTemplate) {
    let depth = 0;
    while (i < n) {
      const c = source[i], d = source[i + 1];
      if (c === "/" && d === "/") { const start = i; while (i < n && source[i] !== "\n") i++; blank(start, i); continue; }
      if (c === "/" && d === "*") {
        const start = i, end = source.indexOf("*/", i + 2);
        if (end === -1) throw lost(start, "a block comment that never ends");
        i = end + 2;
        blank(start, i);
        continue;
      }
      if (c === '"' || c === "'") { quoted(c); afterValue = true; continue; }
      if (c === "`") { template(); afterValue = true; continue; }
      if (c === "/") { if (!afterValue && regularExpression()) { afterValue = true; continue; } i++; afterValue = false; continue; }
      if (c === "{") { depth++; i++; afterValue = false; continue; }
      if (c === "}") { if (inTemplate && depth === 0) return; depth--; i++; afterValue = false; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (WORD.test(c)) { const start = i; while (i < n && WORD.test(source[i])) i++; afterValue = !BEFORE_AN_EXPRESSION.has(source.slice(start, i)); continue; }
      afterValue = c === ")" || c === "]";
      i++;
    }
  }
  if (source.startsWith("#!")) { while (i < n && source[i] !== "\n") i++; blank(0, i); }
  code(false);
  return out.join("");
}

/** A list literal that holds nothing but kernel codes, as strings: the one other place of
 *  lib/errors.mjs that names the code (the codes a verb answers only before any effect). */
const LIST_OF_CODES = /\[\s*(?:"E_[A-Z0-9_]+"\s*,\s*)*"E_[A-Z0-9_]+"\s*,?\s*\]/g;

/** Every place where `stripped` (a source without its comments, `file` its path from the
 *  repository root) names E_LIFECYCLE_BUSY in a way that is not allowed, as `<file>:<line>: <why>`.
 *
 *  The rule. Outside comments, the text E_LIFECYCLE_BUSY may stand:
 *    - in lib/errors.mjs: once as the first argument of the `oatsError(` call inside
 *      `lifecycleBusy` (the constructor), and as an element of a list of nothing but kernel codes;
 *    - in any file: as a whole string literal that is compared (`=== "E_LIFECYCLE_BUSY"`,
 *      `!== "…"`, either side) or is a `case "E_LIFECYCLE_BUSY":`. A comparison reads the code of
 *      an error someone else made; it cannot make one.
 *  Anything else is refused: `oatsError("E_LIFECYCLE_BUSY"`, `err("E_LIFECYCLE_BUSY"`, `code:
 *  "E_LIFECYCLE_BUSY"`, `.code = "E_LIFECYCLE_BUSY"`, a constant that holds the string, the code
 *  inside a longer string or a template literal, with any quote.
 *
 *  Its limits, which no scan of the text has not: a code put together at run time (`"E_LIFECYCLE_" +
 *  "BUSY"`), and an error re-made with the code of another (`oatsError(e.code, …)`), are not seen. */
function unsanctioned(stripped, file) {
  const problems = [];
  const lineOf = (at) => stripped.slice(0, at).split("\n").length;
  const lists = file === CONSTRUCTOR_FILE ? [...stripped.matchAll(LIST_OF_CODES)].map((m) => [m.index, m.index + m[0].length]) : [];
  let constructor = null;
  if (file === CONSTRUCTOR_FILE) {
    const start = stripped.indexOf("export function lifecycleBusy(");
    const end = start === -1 ? -1 : stripped.indexOf("\n}\n", start);
    if (start === -1 || end === -1) problems.push(`${file}: no \`export function lifecycleBusy(\` that ends with a closing brace on its own line: the one constructor of ${CODE} is not where this test looks for it`);
    else constructor = [start, end];
  }
  let made = 0;
  for (const m of stripped.matchAll(new RegExp(CODE, "g"))) {
    const at = m.index, end = at + CODE.length;
    const before = stripped.slice(Math.max(0, at - 200), at), after = stripped.slice(end, end + 200);
    const quote = before.at(-1);
    const literal = ['"', "'", "`"].includes(quote) && after[0] === quote;
    const left = before.slice(0, -1), right = after.slice(1);
    const read = literal && (/(?:===|!==)\s*$/.test(left) || /^\s*(?:===|!==)/.test(right) || (/\bcase\s+$/.test(left) && /^\s*:/.test(right)));
    if (read) continue;
    if (constructor && at > constructor[0] && at < constructor[1] && literal && /\boatsError\(\s*$/.test(left)) { made++; continue; }
    if (lists.some(([from, to]) => at > from && at < to)) continue;
    problems.push(`${file}:${lineOf(at)}: ${CODE} is named outside a comment, and it is neither compared nor made by lifecycleBusy: every ${CODE} is made by lib/errors.mjs lifecycleBusy(holder, said, remedy, details), which gives it details.holder`);
  }
  if (constructor && made !== 1) problems.push(`${file}: lifecycleBusy makes ${CODE} with \`oatsError("${CODE}", …)\` once; this test found that ${made} times in it`);
  return problems;
}

/** Every file under `dir` (a path from the repository root) whose name ends as `extension` says,
 *  as paths from the root. */
function files(dir, extension) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const at = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...files(at, extension));
    else if (extension.test(entry.name)) out.push(at);
  }
  return out.sort();
}

test("the comment stripper of this file blanks comments and nothing else: strings, template literals and regular expressions that hold comment openers or quotes are kept, and a source it cannot follow throws", () => {
  /** `source` with each of `comments` (texts of it) turned into spaces, its line breaks kept. */
  const blanked = (source, ...comments) => comments.reduce((text, comment) => {
    assert.ok(text.includes(comment), `sample premise: ${JSON.stringify(comment)} is in ${JSON.stringify(source)}`);
    return text.replace(comment, comment.replace(/[^\n]/g, " "));
  }, source);
  /** The stripper blanks exactly `comments` in `source`: with none, the source is kept as it is. */
  const strips = (source, ...comments) => assert.equal(withoutComments(source, "sample.mjs"), blanked(source, ...comments), source);

  // Nothing of these is a comment.
  strips('const a = "// not a comment";');
  strips("const a = '/* not a comment */';");
  strips("const a = `// ${b ? \"//\" : '/*'} */`;");
  strips('const url = "http://example.invalid/a" + `http://${host}/b`;');
  // Comments, and what stands beside them.
  strips("a(); // E_X\nb();", "// E_X");
  strips("a(/* E_X */ 1);\n/** E_X\n * E_Y */\nb();", "/* E_X */", "/** E_X\n * E_Y */");
  strips("const t = `a ${ b /* E_X */ } c // kept`; // gone", "/* E_X */", "// gone");
  strips("const t = `${ `${ a /* in */ }` } // kept`; /* out */", "/* in */", "/* out */");
  strips("const s = 'it\\'s // kept', t = \"a \\\" // kept\"; // gone", "// gone");
  strips("const quotes = /[\"'`]/g, slashes = /\\/\\//, klass = /[/\"]/; // gone", "// gone");
  strips("return /\"/.test(s) ? a / b : c / d; // gone", "// gone");
  strips("const half = (a + b) / 2, third = list[0] / 3; // gone", "// gone");
  strips("#!/usr/bin/env node\nrun(); // gone", "#!/usr/bin/env node", "// gone");
  // What it cannot follow, it says, with the file and the line.
  assert.throws(() => withoutComments('const a = "never ends\nb();', "sample.mjs"), /sample\.mjs:1: .*a string that does not end on its line/);
  assert.throws(() => withoutComments("a(); /* never ends", "sample.mjs"), /sample\.mjs:1: .*a block comment that never ends/);
  assert.throws(() => withoutComments("a();\nconst t = `never ends", "sample.mjs"), /sample\.mjs:2: .*a template literal that never ends/);
});

test("the scan refuses every way of making E_LIFECYCLE_BUSY but the constructor, and admits a comment, a comparison and the constructor's own file", () => {
  const found = (source, file = "lib/sample.mjs") => unsanctioned(withoutComments(source, file), file);
  for (const raised of [
    'throw oatsError("E_LIFECYCLE_BUSY", "busy");',
    "throw oatsError('E_LIFECYCLE_BUSY', 'busy');",
    "throw oatsError(`E_LIFECYCLE_BUSY`, `busy`);",
    'throw err("E_LIFECYCLE_BUSY", "busy");',
    'return { code: "E_LIFECYCLE_BUSY", message };',
    'e.code = "E_LIFECYCLE_BUSY";',
    'throw Object.assign(new Error("busy"), { code: "E_LIFECYCLE_BUSY" });',
    'const BUSY = "E_LIFECYCLE_BUSY";\nthrow oatsError(BUSY, "busy");',
    'const CODES = ["E_LIFECYCLE_BUSY"];',
    'const code = busy ? "E_LIFECYCLE_BUSY" : "E_LIFECYCLE_FAILED";',
    'const code = e.code === "E_LIFECYCLE_BUSY" ? "E_LIFECYCLE_BUSY" : e.code;',
    "const text = `code E_LIFECYCLE_BUSY`;",
    'const text = "// E_LIFECYCLE_BUSY";',
    "const code = E_LIFECYCLE_BUSY;",
  ]) {
    const problems = found(raised);
    assert.equal(problems.length, 1, `refused, once: ${raised}\n${problems.join("\n")}`);
    assert.match(problems[0], /^lib\/sample\.mjs:1: /, "the refusal names the file and the line");
  }
  assert.match(found('a();\n\nthrow oatsError("E_LIFECYCLE_BUSY", "busy");')[0], /^lib\/sample\.mjs:3: /, "the line is the line of the source, comments blanked in place");
  for (const admitted of [
    "// E_LIFECYCLE_BUSY says that nothing happened",
    "/** refused as E_LIFECYCLE_BUSY\n *  (E_LIFECYCLE_BUSY) */\nrun();",
    'if (e.code === "E_LIFECYCLE_BUSY") wait();',
    "if ('E_LIFECYCLE_BUSY' !== e?.code) throw e;",
    'switch (e.code) { case "E_LIFECYCLE_BUSY": return wait(); default: throw e; }',
  ]) assert.deepEqual(found(admitted), [], `admitted: ${admitted}`);

  // The constructor's own file: the one `oatsError(` inside lifecycleBusy and a list of codes, and nothing else.
  const constructorFile = (rest = "") => `export function oatsError(code, message) { return Object.assign(new Error(message), { code }); }
export function lifecycleBusy(holder, said, remedy, details) {
  return Object.assign(oatsError("E_LIFECYCLE_BUSY", said), { details: { ...details, holder } });
}
const LISTED = Object.freeze(["E_BAD_ARGS", "E_LIFECYCLE_BUSY",
  "E_PLAN_STALE"]);
${rest}`;
  assert.deepEqual(found(constructorFile(), CONSTRUCTOR_FILE), [], "the constructor and the list");
  assert.match(found(constructorFile('export const other = () => oatsError("E_LIFECYCLE_BUSY", "busy");\n'), CONSTRUCTOR_FILE)[0], /^lib\/errors\.mjs:7: /, "a second maker in the constructor's file is refused like any other");
  assert.match(found(constructorFile('const MIXED = ["E_LIFECYCLE_BUSY", other];\n'), CONSTRUCTOR_FILE)[0], /^lib\/errors\.mjs:7: /, "a list that holds anything but codes is not the list");
  assert.match(found(constructorFile().replace('oatsError("E_LIFECYCLE_BUSY", said)', "oatsError(code, said)"), CONSTRUCTOR_FILE).join("\n"), /found that 0 times/, "a constructor that no longer names the code is not the constructor this test knows");
  assert.match(found(constructorFile().replace("export function lifecycleBusy(", "export function busy("), CONSTRUCTOR_FILE).join("\n"), /no `export function lifecycleBusy\(`/);
});

test("no source of the kernel (lib/, bin/) names E_LIFECYCLE_BUSY outside a comment except lib/errors.mjs, in its one constructor lifecycleBusy and in the list of codes answered before any effect: every other site raises it through the constructor", (t) => {
  const scanned = [...files("lib", /\.mjs$/), ...files("bin", /\.mjs$/)];
  for (const expected of [CONSTRUCTOR_FILE, "lib/core.mjs", "lib/worktree.mjs", "lib/claim.mjs", "lib/instance-lifecycle.mjs", "bin/oats.mjs"]) assert.ok(scanned.includes(expected), `fixture premise: the scan reads ${expected}`);
  // The kernel is `.mjs` and nothing else: a source of another kind would not be scanned.
  assert.deepEqual([...files("lib", /\.(?:js|cjs|jsx|ts|mts|cts)$/), ...files("bin", /\.(?:js|cjs|jsx|ts|mts|cts)$/)], [], "fixture premise: every source of lib/ and bin/ is a .mjs file, which is what this scan reads");
  const scratch = fixtureBase("oats-busy-scan-");
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const problems = [];
  let named = 0;
  for (const file of scanned) {
    const source = readFileSync(join(ROOT, file), "utf8");
    const stripped = withoutComments(source, file);
    assert.equal(stripped.length, source.length, `${file}: blanking keeps every character's place`);
    assert.equal(stripped.split("\n").length, source.split("\n").length, `${file}: blanking keeps every line`);
    // The stripper is held to the language: what is left is still a module Node parses. A comment
    // left in as code, or code blanked as a comment, is refused here, naming the file.
    const copy = join(scratch, file);
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, stripped);
    try { execFileSync(process.execPath, ["--check", copy], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" }); }
    catch (e) { assert.fail(`${file} without its comments is no longer JavaScript that Node parses: the comment stripper of this test misread it, so its scan of this file cannot be trusted\n${String(e.stderr).replaceAll(scratch, "<stripped>")}`); }
    named += source.split(CODE).length - 1;
    problems.push(...unsanctioned(stripped, file));
  }
  assert.deepEqual(problems, [], `sites that name ${CODE} and are not the constructor:\n${problems.join("\n")}`);
  // The scan looked at something: the kernel does name the code, in comments and in the constructor.
  assert.ok(named >= 2, `fixture premise: lib/ and bin/ name ${CODE} (${named} times, comments included)`);
  t.diagnostic(`${scanned.length} sources under lib/ and bin/ scanned; ${CODE} is named ${named} times in them, comments included`);
});

// ---- 2. the constructor ----

test("lifecycleBusy(holder, said, remedy, details) makes E_LIFECYCLE_BUSY: the message is `<said> — <remedy>`, and details.holder is the holder whatever the details given hold", () => {
  const e = lifecycleBusy("running", "x; nothing was done", "wait", { a: 1 });
  assert.ok(e instanceof Error);
  assert.equal(e.code, "E_LIFECYCLE_BUSY");
  assert.equal(e.message, "x; nothing was done — wait");
  assert.deepEqual(e.details, { a: 1, holder: "running" });
  for (const holder of BUSY_HOLDERS) {
    assert.deepEqual(lifecycleBusy(holder, "s", "r").details, { holder }, `${holder}: without details, details is the holder alone`);
    for (const given of BUSY_HOLDERS) assert.deepEqual(lifecycleBusy(holder, "s", "r", { holder: given, a: 1 }).details, { a: 1, holder }, `${holder}: a holder key in the details given (${given}) does not win`);
    assert.equal(lifecycleBusy(holder, "s; nothing was done", "do r").message, "s; nothing was done — do r", holder);
  }
  const given = Object.freeze({ a: 1 });
  assert.notEqual(lifecycleBusy("running", "s", "r", given).details, given, "the details given are copied, never written to");
});

test("the list of holders is closed and frozen (running, unknown, none), and a holder outside it is a defect: lifecycleBusy throws a TypeError", () => {
  assert.deepEqual([...BUSY_HOLDERS], ["running", "unknown", "none"]);
  assert.equal(Object.isFrozen(BUSY_HOLDERS), true);
  for (const holder of ["busy", "RUNNING", "running ", "", undefined, null, 0, true, ["running"], {}]) {
    assert.throws(() => lifecycleBusy(holder, "s", "r", {}), TypeError, `a holder that is ${JSON.stringify(holder)}`);
  }
});

test("an \"unknown\" or a \"none\" without a remedy is a defect (a TypeError): waiting ends neither, so the answer names the step that does; \"running\" may have none, and its message is then `said` alone", () => {
  const NO_REMEDY = [undefined, null, "", "   ", "\t\n", 0, false, {}];
  for (const holder of ["unknown", "none"]) {
    for (const remedy of NO_REMEDY) assert.throws(() => lifecycleBusy(holder, "s; nothing was done", remedy, {}), TypeError, `${holder} with the remedy ${JSON.stringify(remedy)}`);
    assert.equal(lifecycleBusy(holder, "s; nothing was done", "remove the file, then retry").message, "s; nothing was done — remove the file, then retry");
  }
  for (const remedy of NO_REMEDY) {
    const e = lifecycleBusy("running", "s; nothing was done", remedy, { a: 1 });
    assert.equal(e.message, "s; nothing was done", `running with the remedy ${JSON.stringify(remedy)}: the message is what was said, with no dash after it`);
    assert.deepEqual(e.details, { a: 1, holder: "running" });
  }
});

// ---- 3. the builders of the claim refusals ----

const NAME = "alpha";
const HOME = "/deployment/agents/dev/instances/alpha";
const LOCK = "/deployment/agents/dev/instances/.oats-retirement/claims/alpha.lock";
const TREE_LOCK = "/deployment/agents/dev/instances/alpha/.oats/trees/p.lock";
const HOLDER_PID = 777001;
const SINCE = "2026-10-10T00:00:00.000Z";
/** A claim's record as lib/claim.mjs writes it, of a holder whose verb is `action` (none: a claim a
 *  kernel before feature `lifecycle-claim-stop` wrote, which only a retire took). */
const holderOf = (action) => ({ ...(action ? { action } : {}), pid: HOLDER_PID, processStart: "proc:start", nonce: "a".repeat(32), at: SINCE });
/** What each arriving verb's refusals say it did not do (docs/desktop-cli-api.md, "The messages"). */
const NOTHING = { retire: "nothing was done", stop: "nothing was stopped", "worktree add": "no tree was made" };
const count = (text, part) => text.split(part).length - 1;

/** Every refusal the builders have, as { what, arriving, kind, action, holder, e }: `kind` is the
 *  refusal (lib/claim.mjs names them), `action` the verb the holder's record names (undefined: it
 *  names none, or the refusal names no holder), `holder` what details.holder is to be (null: the
 *  refusal is not E_LIFECYCLE_BUSY), `e` the error. */
function everyRefusal() {
  const rows = [];
  const UNREADABLE = "the claim names no start time";
  for (const arriving of Object.keys(NOTHING)) {
    const refusals = lifecycleClaimRefusals(arriving, NAME, HOME, LOCK);
    for (const recorded of ["retire", "stop", undefined]) {
      const action = recorded ?? "retire";
      const record = holderOf(recorded), says = `its record ${recorded ? `says action: ${recorded}` : "names no verb"}`;
      // Beside a live retire, a stop and a worktree add are not busy: the instance is on its way out.
      rows.push({ what: `${arriving} beside a live holder (${says})`, arriving, kind: "busy", named: true, action, holder: action === "retire" && arriving !== "retire" ? null : "running", e: refusals.busy(record, null, LOCK) });
      rows.push({ what: `${arriving} beside a holder whose liveness cannot be read (${says})`, arriving, kind: "busy-unknown", named: true, action, holder: "unknown", unknown: UNREADABLE, e: refusals.busy(record, UNREADABLE, LOCK) });
      rows.push({ what: `${arriving} beside a claim that cannot be taken over (${says})`, arriving, kind: "cannotTakeOver", named: true, action, holder: "none", e: refusals.cannotTakeOver(record, LOCK, "its nonce is not the 32 hexadecimal digits a claim carries") });
    }
    rows.push({ what: `${arriving}, its own start unreadable`, arriving, kind: "ownStartUnreadable", named: false, holder: "none", e: refusals.ownStartUnreadable("the system did not say when this process started", LOCK) });
    rows.push({ what: `${arriving} beside a file that is no claim`, arriving, kind: "unreadableClaim", named: false, holder: "unknown", e: refusals.unreadableClaim(LOCK) });
  }
  // The claim of a purpose (`oats worktree add|remove`): the same protocol, another file, no verb.
  const tree = worktreeClaimRefusals(purposeClaimBusy("p", TREE_LOCK));
  const record = holderOf();
  rows.push({ what: "a worktree command beside a live holder of the purpose's claim", arriving: "worktree", kind: "busy", holder: "running", e: tree.busy(record, null, TREE_LOCK) });
  rows.push({ what: "a worktree command beside a holder whose liveness cannot be read", arriving: "worktree", kind: "busy-unknown", holder: "unknown", unknown: UNREADABLE, e: tree.busy(record, UNREADABLE, TREE_LOCK) });
  rows.push({ what: "a worktree command, its own start unreadable", arriving: "worktree", kind: "ownStartUnreadable", holder: "none", e: tree.ownStartUnreadable("the system did not say when this process started", TREE_LOCK) });
  rows.push({ what: "a worktree command beside a file that is no claim", arriving: "worktree", kind: "unreadableClaim", holder: "unknown", e: tree.unreadableClaim(TREE_LOCK) });
  rows.push({ what: "a worktree command beside a claim that cannot be taken over", arriving: "worktree", kind: "cannotTakeOver", holder: "none", e: tree.cannotTakeOver(record, TREE_LOCK, "its nonce is not the 32 hexadecimal digits a claim carries") });
  return rows;
}

test("every refusal of a claim, for every arriving verb (a retire, a stop, a worktree add, and a worktree command on its purpose's claim): an E_LIFECYCLE_BUSY names its holder from the closed list, an \"unknown\" or a \"none\" names the step that ends it after \" — \", and each is one line that says once what was not done", () => {
  const rows = everyRefusal();
  // 3 arriving verbs x (3 records x 3 refusals that name a holder + 2 that name none) + the purpose's 5.
  assert.equal(rows.length, 3 * (3 * 3 + 2) + 5, "fixture premise: every pair this test means to build");
  for (const { what, arriving, holder, e } of rows) {
    const said = `${what}: ${e.code} ${JSON.stringify(e.message)} ${JSON.stringify(e.details)}`;
    assert.ok(e instanceof Error, said);
    assert.equal(e.code, holder === null ? "E_INSTANCE_RETIRING" : "E_LIFECYCLE_BUSY", said);
    assert.equal(e.message.includes("\n"), false, `one line: ${said}`);
    if (holder === null) {
      assert.equal("holder" in e.details, false, `E_INSTANCE_RETIRING carries no details.holder: it is the field of E_LIFECYCLE_BUSY alone: ${said}`);
    } else {
      assert.ok(BUSY_HOLDERS.includes(e.details.holder), `details.holder is one of ${BUSY_HOLDERS.join(", ")}: ${said}`);
      assert.equal(e.details.holder, holder, `details.holder: ${said}`);
      if (holder !== "running") {
        const dash = e.message.indexOf(" — ");
        assert.ok(dash !== -1 && e.message.slice(dash + 3).trim().length > 0, `waiting does not end it, so the message names the step that does, after " — ": ${said}`);
        assert.doesNotMatch(e.message, /already running|wait for it to finish/, `nobody is said to be running, and nobody is told to wait: ${said}`);
      }
    }
    // What was not done, in the arriving verb's own words, once; the purpose's claim says "nothing was done".
    const own = NOTHING[arriving] ?? "nothing was done";
    for (const words of new Set(Object.values(NOTHING))) assert.equal(count(e.message, words), words === own ? 1 : 0, `it says ${JSON.stringify(own)} once, and no other verb's words: ${said}`);
  }
});

test("details.action of a home's claim refusal is the HOLDER's verb, \"retire\" for a record that names none, wherever the refusal names a holder; a refusal that names none (this process's own start, a file that is no claim) has no action, no pid and no since", () => {
  for (const { what, kind, named, action, unknown, e } of everyRefusal().filter((row) => row.arriving !== "worktree")) {
    const said = `${what}: ${e.code} ${JSON.stringify(e.details)}`;
    const { holder: _holder, ...details } = e.details;
    if (named) {
      assert.deepEqual(details, { instance: NAME, home: HOME, lock: LOCK, pid: HOLDER_PID, since: SINCE, action, ...(unknown ? { unknown } : {}) }, `the home, the file that names the holder, the holder and its verb: ${said}`);
      if (kind === "busy-unknown") assert.ok(e.message.includes(unknown) && e.message.includes(`pid ${HOLDER_PID}`) && e.message.includes(`remove ${LOCK}, then retry`), `the message says why the liveness cannot be read, the pid to check and the way out: ${said}`);
    } else {
      assert.deepEqual(details, { instance: NAME, home: HOME, lock: LOCK }, `the home and the file, and no holder: ${said}`);
    }
  }
});

test("beside a live retire a stop and a worktree add are refused E_INSTANCE_RETIRING, with the claim's details and no holder key; every other live pair is E_LIFECYCLE_BUSY, holder \"running\"", () => {
  const live = everyRefusal().filter((row) => row.kind === "busy" && row.arriving !== "worktree");
  const codes = Object.fromEntries(live.map(({ arriving, action, e }) => [`${arriving} beside ${action}`, e.code]));
  // Each pair is built twice for a holder that is a retire: its record says so, or names no verb.
  assert.deepEqual(codes, {
    "retire beside retire": "E_LIFECYCLE_BUSY", "retire beside stop": "E_LIFECYCLE_BUSY",
    "stop beside retire": "E_INSTANCE_RETIRING", "stop beside stop": "E_LIFECYCLE_BUSY",
    "worktree add beside retire": "E_INSTANCE_RETIRING", "worktree add beside stop": "E_LIFECYCLE_BUSY",
  });
  for (const { what, arriving, action, e } of live) {
    const said = `${what}: ${e.code} ${JSON.stringify(e.message)} ${JSON.stringify(e.details)}`;
    if (e.code === "E_INSTANCE_RETIRING") {
      assert.deepEqual(e.details, { instance: NAME, home: HOME, lock: LOCK, pid: HOLDER_PID, since: SINCE, action: "retire" }, said);
      assert.equal(e.message, `${NAME} is being retired (pid ${HOLDER_PID}, since ${SINCE}); ${NOTHING[arriving]}`, said);
    } else {
      assert.deepEqual(e.details, { instance: NAME, home: HOME, lock: LOCK, pid: HOLDER_PID, since: SINCE, action, holder: "running" }, said);
      assert.equal(e.message, `a ${action} of ${NAME} is already running (pid ${HOLDER_PID}, since ${SINCE}); ${NOTHING[arriving]} — wait for it to finish`, said);
    }
  }
});

// The builder's own words are held here: its sentence and its remedy. The reason is the caller's
// (lib/claim.mjs gives it what lib/worktree-hooks.mjs processStart said), and this test gives one
// that names no pid.
test("the refusal for a process whose own start cannot be read adds no pid of this process, which is gone when the answer is read, and names a check a person can run", () => {
  const own = everyRefusal().filter((row) => row.kind === "ownStartUnreadable");
  assert.equal(own.length, 4, "fixture premise: one for each arriving verb, and the purpose's");
  const pid = new RegExp(`(?<![0-9])${process.pid}(?![0-9])`);
  for (const { what, e } of own) {
    const said = `${what}: ${JSON.stringify(e.message)}`;
    assert.equal(e.details.holder, "none", said);
    assert.doesNotMatch(e.message, pid, `the pid of this process (${process.pid}) is not in the message: ${said}`);
    assert.doesNotMatch(JSON.stringify(e.details), pid, `nor in its details: ${said}`);
    assert.equal("pid" in e.details, false, `details names no pid: ${said}`);
    const remedy = e.message.slice(e.message.indexOf(" — ") + 3);
    assert.match(remedy, /`[^`\n]+`/, `the step that ends it holds a command to run, in backticks: ${said}`);
  }
});

// ---- 4. the docs ----

/** The one Markdown table between `<a id="<anchor>"></a>` and the next anchor of
 *  docs/desktop-cli-api.md → { header: [cell], body: [[cell]] }, every cell trimmed. Fails when
 *  the anchor is missing or there twice, when its section has no table or more than one, and when a
 *  row has not the header's number of cells. (As test/lifecycle-pair-table.test.mjs reads its own.) */
function tableAfter(anchor) {
  const doc = readFileSync(DOC, "utf8");
  const marker = `<a id="${anchor}"></a>`;
  const at = doc.indexOf(marker);
  assert.notEqual(at, -1, `docs/desktop-cli-api.md has the anchor ${marker}`);
  assert.equal(doc.indexOf(marker, at + 1), -1, `docs/desktop-cli-api.md has the anchor ${marker} once`);
  const rest = doc.slice(at + marker.length);
  const next = rest.indexOf('<a id="');
  const lines = (next === -1 ? rest : rest.slice(0, next)).split("\n");
  const start = lines.findIndex((line) => line.startsWith("|"));
  assert.notEqual(start, -1, `the section of ${marker} has a table`);
  let end = start;
  while (end < lines.length && lines[end].startsWith("|")) end++;
  assert.equal(lines.slice(end).some((line) => line.startsWith("|")), false, `the section of ${marker} has one table, not several: this test reads the first`);
  const cells = (line) => {
    assert.ok(line.trimEnd().endsWith("|"), `a table row of ${marker} ends with |: ${line}`);
    return line.trimEnd().slice(1, -1).split("|").map((cell) => cell.trim());
  };
  const [header, rule, ...body] = lines.slice(start, end).map(cells);
  assert.ok(rule && rule.every((cell) => /^:?-+:?$/.test(cell)), `the second line of the table of ${marker} is its rule`);
  assert.ok(body.length > 0, `the table of ${marker} has rows`);
  for (const row of body) assert.equal(row.length, header.length, `a row of the table of ${marker} has ${header.length} cells: ${row.join(" | ")}`);
  return { header, body };
}

test("the table of docs/desktop-cli-api.md for error.details.holder lists exactly the values of the kernel's closed list, each once, and says of each what it means and what ends it", () => {
  const { header, body } = tableAfter("busy-holder");
  assert.equal(header[0], "`details.holder`", "the first column is the value of details.holder");
  assert.equal(header.length, 3, "the value, what it means, what ends it");
  const values = body.map(([cell]) => {
    const m = /^`("[^"`]*")`$/.exec(cell);
    assert.ok(m, `a value is a JSON string in backticks, as the answer carries it: ${JSON.stringify(cell)}`);
    return JSON.parse(m[1]);
  });
  assert.deepEqual(values.filter((value, n) => values.indexOf(value) !== n), [], "no value has two rows");
  assert.deepEqual([...values].sort(), [...BUSY_HOLDERS].sort(), "the docs table and lib/errors.mjs BUSY_HOLDERS name the same values");
  for (const row of body) for (const cell of row.slice(1)) assert.ok(cell.length > 0, `every value says what it means and what ends it: ${row.join(" | ")}`);
});
