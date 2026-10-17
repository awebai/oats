// Where a recovery copy differs from its source (lib/tree-copy.mjs treeDisagreement), awebai/oats#1360:
// the bounded, failure-only diagnosis E_WORK_PRESERVATION_FAILED carries as
// `details.recoveryDisagreement` once the exact digest comparison has refused. Fixed kinds,
// escaped relative paths, no content, no link target, nothing outside the roots, and every bound.
import test from "node:test";
import assert from "node:assert/strict";
import fs, { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { escapedPath, treeDisagreement, TREE_DISAGREEMENT_LIMITS } from "../lib/tree-copy.mjs";

// lchmod exists only where the platform can set a link's mode (macOS); a named import would not link elsewhere.
const lchmodSync = fs.lchmodSync;

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-tree-disagreement-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
let n = 0;
/** Two equal trees (a, b) built from `files` ({ path: text | { link } | { dir } }), under a fresh directory. */
function pair(files) {
  const root = join(base, String(n++));
  const make = (side) => {
    const dir = join(root, side);
    mkdirSync(dir, { recursive: true });
    for (const [path, what] of Object.entries(files)) {
      const at = join(dir, path);
      mkdirSync(join(at, ".."), { recursive: true });
      if (typeof what === "string") { writeFileSync(at, what); chmodSync(at, 0o644); }
      else if (what.link !== undefined) symlinkSync(what.link, at);
      else mkdirSync(at, { recursive: true });
    }
    // Modes that do not depend on the umask, the links' own aside (a link has no chmod).
    const settle = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) { chmodSync(join(d, e.name), 0o755); settle(join(d, e.name)); } };
    settle(dir);
    return dir;
  };
  return { root, a: make("a"), b: make("b") };
}
const TREE = { "README.md": "hello\n", "src/main.js": "main\n", "src/lib/util.js": "util\n", "node_modules/pkg/tool.js": "tool\n", "node_modules/.bin/tool": { link: "../pkg/tool.js" }, "empty": { dir: true } };

test("equal trees answer no difference, complete", () => {
  const { a, b } = pair(TREE);
  assert.deepEqual(treeDisagreement(a, b), { entries: [], complete: true });
});

test("each kind is named at its relative path, in the order of the names' bytes, and nothing below a missing, extra or retyped entry", () => {
  const { root, a, b } = pair(TREE);
  rmSync(join(b, "src", "lib"), { recursive: true });                 // missing (a directory: its children are not listed)
  mkdirSync(join(b, "added", "deep"), { recursive: true });           // extra
  rmSync(join(b, "README.md")); mkdirSync(join(b, "README.md"));       // type: file in the source, directory in the copy
  chmodSync(join(b, "src", "main.js"), 0o600);                         // mode
  writeFileSync(join(b, "node_modules", "pkg", "tool.js"), "TOOL\n");  // file-content, same size
  rmSync(join(b, "node_modules", ".bin", "tool")); symlinkSync("../pkg/other.js", join(b, "node_modules", ".bin", "tool")); // link-target
  chmodSync(join(b, "empty"), 0o700);                                  // mode, of a directory
  const diff = treeDisagreement(a, b);
  assert.deepEqual(diff, { complete: true, entries: [
    { path: "README.md", kind: "type" },
    { path: "added", kind: "extra" },
    { path: "empty", kind: "mode" },
    { path: "node_modules/.bin/tool", kind: "link-target" },
    { path: "node_modules/pkg/tool.js", kind: "file-content" },
    { path: "src/lib", kind: "missing" },
    { path: "src/main.js", kind: "mode" },
  ] });
  assert.ok(!JSON.stringify(diff).includes(root), "no absolute path");
  assert.ok(!JSON.stringify(diff).includes("other.js") && !JSON.stringify(diff).includes("TOOL"), "no link target, no content");
});

test("a file of another size differs without being read; one entry can have several kinds", () => {
  const { a, b } = pair({ "f": "short\n" });
  writeFileSync(join(b, "f"), "a longer body\n");
  chmodSync(join(b, "f"), 0o600);
  assert.deepEqual(treeDisagreement(a, b, { limits: { ...TREE_DISAGREEMENT_LIMITS, bytes: 0 } }), { complete: true, entries: [{ path: "f", kind: "mode" }, { path: "f", kind: "file-content" }] });
});

test("a link's mode is compared without following it", { skip: typeof lchmodSync !== "function" && "this platform cannot set a link's mode (no lchmod)" }, () => {
  const { a, b } = pair({ "node_modules/pkg/tool.js": "tool\n", "node_modules/.bin/tool": { link: "../pkg/tool.js" } });
  lchmodSync(join(a, "node_modules", ".bin", "tool"), 0o700);
  assert.equal(lstatSync(join(a, "node_modules", ".bin", "tool")).mode & 0o7777, 0o700, "the fixture's link has a non-default mode");
  assert.notEqual(lstatSync(join(b, "node_modules", ".bin", "tool")).mode & 0o7777, 0o700, "the copy's link has the default");
  assert.deepEqual(treeDisagreement(a, b), { complete: true, entries: [{ path: "node_modules/.bin/tool", kind: "mode" }] });
  assert.equal(lstatSync(join(a, "node_modules", "pkg", "tool.js")).mode & 0o7777, 0o644, "the target's mode is untouched");
});

test("links are never followed: what they point at is not read or named", () => {
  const outside = join(base, `outside-${n++}`);
  mkdirSync(outside); writeFileSync(join(outside, "secret-name"), "secret");
  const { a, b } = pair({ "into": { link: outside }, "dangling": { link: "../nowhere" } });
  writeFileSync(join(outside, "changed"), "x");
  const diff = treeDisagreement(a, b);
  assert.deepEqual(diff, { entries: [], complete: true });
});

test("the excluded paths are passed over exactly, on both sides, and no other name like them", () => {
  const { a, b } = pair({ ".git/HEAD": "ref\n", ".gitx": "kept\n", "sub/.git/HEAD": "ref\n" });
  writeFileSync(join(b, ".git", "HEAD"), "other\n");
  writeFileSync(join(b, ".gitx"), "KEPT\n");
  writeFileSync(join(b, "sub", ".git", "HEAD"), "other\n");
  assert.deepEqual(treeDisagreement(a, b, { excludePaths: [Buffer.from(".git")] }).entries, [{ path: ".gitx", kind: "file-content" }, { path: "sub/.git/HEAD", kind: "file-content" }]);
  assert.deepEqual(treeDisagreement(a, b, { excludePaths: [Buffer.from(".git"), Buffer.from(join("sub", ".git"))] }).entries, [{ path: ".gitx", kind: "file-content" }]);
});

test("names are bytes, escaped so that each reads back one way", () => {
  const { a, b } = pair({});
  // A control character, a backslash, a space and UTF-8; a byte of no valid UTF-8 too, where the
  // filesystem holds such a name (APFS refuses it).
  const odd = Buffer.from([0x66, 0x0a, 0x5c, 0x20, 0xc3, 0xa9]);
  writeFileSync(Buffer.concat([Buffer.from(a + "/"), odd]), "x");
  const invalid = Buffer.concat([Buffer.from(a + "/g"), Buffer.from([0xff])]);
  let utf8Only = false;
  try { writeFileSync(invalid, "x"); } catch (err) { if (err.code !== "EILSEQ") throw err; utf8Only = true; }
  assert.deepEqual(treeDisagreement(a, b), { complete: true, entries: [
    { path: "f\\x0a\\\\ \\xc3\\xa9", kind: "missing" },
    ...(utf8Only ? [] : [{ path: "g\\xff", kind: "missing" }]),
  ] });
  assert.equal(escapedPath(Buffer.from("\\x41")), "\\\\x41", "a literal backslash cannot read as an escape");
  assert.notEqual(escapedPath(Buffer.from("\\x41")), escapedPath(Buffer.from([0x41])));
});

test("every bound stops the search and says which; none hides a refusal or invents a path", () => {
  const { a, b } = pair({ "one": "1\n", "two": "2\n", "three": "3\n", "big": "x".repeat(300_000) });
  for (const name of ["one", "two", "three"]) writeFileSync(join(b, name), "X\n");
  // Exactly as many differences as the cap: complete. One more: stopped.
  assert.deepEqual(treeDisagreement(a, b, { limits: { ...TREE_DISAGREEMENT_LIMITS, discrepancies: 3 } }), { complete: true, entries: [{ path: "one", kind: "file-content" }, { path: "three", kind: "file-content" }, { path: "two", kind: "file-content" }] });
  assert.deepEqual(treeDisagreement(a, b, { limits: { ...TREE_DISAGREEMENT_LIMITS, discrepancies: 2 } }), { complete: false, stoppedBy: "discrepancies", entries: [{ path: "one", kind: "file-content" }, { path: "three", kind: "file-content" }] });
  // The bytes it reads: an equal 300 KB file needs 600 KB of reads.
  assert.deepEqual(treeDisagreement(a, b, { limits: { ...TREE_DISAGREEMENT_LIMITS, bytes: 100_000 } }), { complete: false, stoppedBy: "bytes", entries: [] });
  // The entries it looks at, on both sides together.
  assert.deepEqual(treeDisagreement(a, b, { limits: { ...TREE_DISAGREEMENT_LIMITS, entries: 3 } }), { complete: false, stoppedBy: "entries", entries: [] });
  // Its time, by the clock it is given.
  let t = 0;
  assert.deepEqual(treeDisagreement(a, b, { clock: () => (t += 3000) }), { complete: false, stoppedBy: "time", entries: [] });
});

test("a tree that cannot be read answers unreadable, and never throws", () => {
  const { a } = pair(TREE);
  assert.deepEqual(treeDisagreement(a, join(base, "no-such-copy")), { complete: false, stoppedBy: "unreadable", entries: [] });
  assert.deepEqual(treeDisagreement(join(base, "no-such-source"), a), { complete: false, stoppedBy: "unreadable", entries: [] });
});
