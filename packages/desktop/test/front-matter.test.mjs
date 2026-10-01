// splitFrontMatter: a strict, dependency-free YAML subset for Markdown front
// matter. Simple metadata becomes a table; anything outside the subset keeps
// its raw text (entries: null) so the reader shows it as code. Never throws.
import test from "node:test";
import assert from "node:assert/strict";
import { splitFrontMatter, FRONT_MATTER_MAX } from "../renderer/front-matter.mjs";

const entries = (text) => splitFrontMatter(text).frontMatter?.entries;

test("SKILL.md front matter: name plus a folded description", () => {
  const text = "---\nname: pdf-tools\ndescription: >\n  Extract text and tables\n  from PDF files.\n\n  Use for forms.\n---\n# PDF tools\n\nBody.\n";
  const { frontMatter, body } = splitFrontMatter(text);
  assert.deepEqual(frontMatter.entries, [
    ["name", "pdf-tools"],
    ["description", "Extract text and tables from PDF files.\nUse for forms.\n"],
  ]);
  assert.equal(frontMatter.raw, "name: pdf-tools\ndescription: >\n  Extract text and tables\n  from PDF files.\n\n  Use for forms.");
  assert.equal(body, "# PDF tools\n\nBody.\n");
});

test("block scalars: literal keeps newlines, chomping indicators", () => {
  assert.deepEqual(entries("---\na: |\n  one\n    two\n  three\n\nb: |-\n  x\n  y\nc: >-\n  p\n  q\nd: >\n  r\n    more\n  s\n---\n"), [
    ["a", "one\n  two\nthree\n"],
    ["b", "x\ny"],
    ["c", "p q"],
    ["d", "r\n  more\ns\n"],
  ]);
  assert.deepEqual(entries("---\na: |\nb: x\n---\n"), [["a", ""], ["b", "x"]], "empty block scalar");
  assert.equal(entries("---\na: |+\n  x\n---\n"), null, "keep chomping is outside the subset");
  assert.equal(entries("---\na: |2\n  x\n---\n"), null, "indentation indicators are outside the subset");
});

test("quoted strings and escapes", () => {
  assert.deepEqual(entries(`---\na: 'it''s: fine # not a comment'\nb: "say \\"hi\\"\\n\\ttab \\\\ end"\nc: "x" # trailing comment\n---\n`), [
    ["a", "it's: fine # not a comment"],
    ["b", 'say "hi"\n\ttab \\ end'],
    ["c", "x"],
  ]);
  assert.equal(entries('---\na: "bad \\u0041 escape"\n---\n'), null, "unsupported escape");
  assert.equal(entries('---\na: "unterminated\n---\n'), null);
  assert.equal(entries("---\na: 'x' trailing\n---\n"), null);
});

test("plain scalars: comments stripped, text kept (no type coercion)", () => {
  assert.deepEqual(entries("---\nversion: 1.10\nenabled: true\nempty:\nurl: https://x.dev/a#frag # note\nnull_text: null\n---\n"), [
    ["version", "1.10"], ["enabled", "true"], ["empty", ""], ["url", "https://x.dev/a#frag"], ["null_text", "null"],
  ]);
  assert.deepEqual(entries("---\nd: a wrapped\n  plain scalar\n---\n"), [["d", "a wrapped plain scalar"]], "continuation folds");
  assert.equal(entries("---\na: b: c\n---\n"), null, "nested mapping on one line");
});

test("lists: block (indented or not) and flow", () => {
  assert.deepEqual(entries("---\ntags:\n  - one\n  - 'two'\n  # comment\n  - \"three\"\nflat:\n- a\n- b\nflow: [x, 'y z', \"w\"]\nnone: []\n---\n"), [
    ["tags", ["one", "two", "three"]],
    ["flat", ["a", "b"]],
    ["flow", ["x", "y z", "w"]],
    ["none", []],
  ]);
  assert.equal(entries("---\na: [x, [y]]\n---\n"), null, "nested flow list");
  assert.equal(entries("---\na: [x, y\n---\n"), null, "unterminated flow list");
  assert.equal(entries("---\na: {x: 1}\n---\n"), null, "flow mapping");
  assert.equal(entries("---\na:\n  - x\n   - y\n---\n"), null, "inconsistent indentation");
  assert.equal(entries("---\na:\n  - b: 1\n---\n"), null, "mapping inside a list");
});

test("comments and blank lines are ignored at top level", () => {
  assert.deepEqual(entries("---\n# heading comment\n\nname: a\n   # indented comment\n\n---\n"), [["name", "a"]]);
  assert.deepEqual(entries("---\n---\nbody"), [], "empty front matter");
});

test("no front matter: the whole text is body", () => {
  for (const text of ["# Title\n---\na: b\n---\n", "", " ---\na: b\n---\n", "----\na: b\n---\n", "---"]) {
    assert.deepEqual(splitFrontMatter(text), { frontMatter: null, body: text }, JSON.stringify(text));
  }
  assert.deepEqual(splitFrontMatter(undefined), { frontMatter: null, body: "" });
});

test("unclosed fence is not front matter", () => {
  const text = "---\nname: a\n\n# Body\n";
  assert.deepEqual(splitFrontMatter(text), { frontMatter: null, body: text });
});

test("BOM, CRLF and the ... closing fence", () => {
  const { frontMatter, body } = splitFrontMatter("\uFEFF---\r\nname: a\r\ntags:\r\n  - x\r\n...\r\nBody\r\n");
  assert.equal(frontMatter.raw, "name: a\ntags:\n  - x");
  assert.deepEqual(frontMatter.entries, [["name", "a"], ["tags", ["x"]]]);
  assert.equal(body, "Body\r\n");
  assert.equal(splitFrontMatter("---\na: b\n---").body, "", "closing fence at end of file");
});

test("outside the subset: entries null, raw kept", () => {
  const cases = {
    nested: "meta:\n  author: x\n  tags: [a]",
    anchor: "a: &ref 1\nb: *ref",
    alias: "b: *ref",
    tag: "a: !!str 1",
    duplicate: "a: 1\nb: 2\na: 3",
    tabIndent: "a:\n\t- x",
    garbageLine: "just some words",
    quotedKey: "\"a\": 1",
    topLevelList: "- a\n- b",
    noSpaceAfterColon: "a:1",
    indentedFirst: "  a: 1",
  };
  for (const [name, raw] of Object.entries(cases)) {
    const { frontMatter, body } = splitFrontMatter(`---\n${raw}\n---\nbody`);
    assert.equal(frontMatter.entries, null, name);
    assert.equal(frontMatter.raw, raw, name);
    assert.equal(body, "body", name);
  }
});

test("garbage never throws", () => {
  const alphabet = ["-", "-", "-", "\n", "\n", "\r", " ", " ", "\t", ":", "'", '"', "\\", "#", "[", "]", "{", "}", ",",
    "|", ">", "&", "*", "!", "a", "b", "k", ".", "\uFEFF", "é", "\u0000"];
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 600; i++) {
    let s = i % 2 ? "---\n" : "";
    const len = rand(200);
    for (let k = 0; k < len; k++) s += alphabet[rand(alphabet.length)];
    if (i % 3) s += "\n---\n";
    const out = splitFrontMatter(s);
    assert.equal(typeof out.body, "string");
    if (out.frontMatter) assert.ok(out.frontMatter.entries === null || Array.isArray(out.frontMatter.entries));
  }
});

test("64 KiB bound, and pathological lines stay linear", () => {
  const big = "a: " + "x".repeat(FRONT_MATTER_MAX);
  const { frontMatter } = splitFrontMatter(`---\n${big}\n---\n`);
  assert.equal(frontMatter.entries, null);
  assert.equal(frontMatter.raw, big);
  assert.deepEqual(entries(`---\na: ${"x".repeat(FRONT_MATTER_MAX - 10)}\n---\n`), [["a", "x".repeat(FRONT_MATTER_MAX - 10)]]);
  const started = Date.now();
  const n = FRONT_MATTER_MAX - 100;
  for (const raw of [`a: x${" ".repeat(n)}y`, `a: [${"a,".repeat(n / 2)}]`, `a: [${"'a',".repeat(n / 4)}]`, `a: '${" ".repeat(n)}`]) {
    splitFrontMatter(`---\n${raw}\n---\n`);
  }
  assert.ok(Date.now() - started < 1000, "bounded input parses quickly");
});
