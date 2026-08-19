// The capture ignore list: `<root>/ignore` patterns prevent capture
// entirely — the source file is never opened, so no blob is stored, no
// turn is appended, and the seen cache never learns about it. Ignoring is
// per record root and forward-looking only.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { RecordStore } from "../lib/store.mjs";
import { sha256Hex } from "../lib/canonical.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
import { captureAwLogs } from "../lib/capture-aw.mjs";
import {
  IgnoreError,
  IgnoreMatcher,
  ignoreFilePath,
  loadIgnore,
  parseIgnorePatterns,
} from "../lib/ignore.mjs";

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), "turn-record-ignore-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(join(base, "record"), { owner: "mac" });
  return { base, store };
}

function sessionEvent(type, text, ts) {
  return JSON.stringify({
    type,
    timestamp: ts,
    message: { content: [{ type: "text", text }] },
  });
}

function writeSession(dir, name, marker) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  const bytes = sessionEvent("user", marker, "2026-03-01T10:00:00Z") + "\n";
  writeFileSync(path, bytes);
  return { path, bytes };
}

// ------------------------------------------------------------- unit level

test("parseIgnorePatterns skips blanks and comments, trims whitespace", () => {
  const patterns = parseIgnorePatterns(
    "# a comment\n\n  secret-*  \n/abs/path/**\n\n# another\n",
  );
  assert.deepEqual(patterns, ["secret-*", "/abs/path/**"]);
});

test("glob semantics: * stays within a segment, ** crosses, ? is one char", () => {
  const m = new IgnoreMatcher(["/a/*/c.jsonl", "/x/**", "s?d"]);
  assert.ok(m.ignores("/a/b/c.jsonl"));
  assert.ok(!m.ignores("/a/b/b2/c.jsonl"), "* must not cross /");
  assert.ok(m.ignores("/x/deep/nested/file.jsonl"), "** crosses segments");
  assert.ok(m.ignores("/any", ["sad"]));
  assert.ok(!m.ignores("/any", ["said"]), "? matches exactly one char");
});

test("pattern without / matches names, never the path; with / only the path", () => {
  const m = new IgnoreMatcher(["abcd-1234", "/private/**"]);
  assert.ok(m.ignores("/home/u/projects/x.jsonl", ["x.jsonl", "abcd-1234"]), "session id hit");
  assert.ok(!m.ignores("/home/abcd-1234/y.jsonl", ["y.jsonl", "other"]), "bare pattern ignores paths");
  assert.ok(m.ignores("/private/p/z.jsonl", ["z.jsonl", "zid"]));
  assert.ok(!m.ignores("/open/p/z.jsonl", ["z.jsonl", "zid"]));
});

test("regex metacharacters in patterns are literal", () => {
  const m = new IgnoreMatcher(["a+b(c).jsonl"]);
  assert.ok(m.ignores("/p", ["a+b(c).jsonl"]));
  assert.ok(!m.ignores("/p", ["aab(c)x.jsonl"]));
});

test("hostile wildcard patterns match in bounded time (ReDoS regression)", () => {
  // The reviewer's exact shapes: alternating * and ? against a candidate
  // that cannot match. Under regex compilation ([^/]* adjacent to [^/])
  // repeat(15) took ~1s and repeat(20) never finished; the DP matcher is
  // O(|pattern| x |candidate|) by construction, so repeat(25) is ~thousands
  // of steps.
  const hostile = [
    "*?".repeat(25) + "ZZZ", // name rule
    "/" + "*?".repeat(25) + "ZZZ", // path rule
    "*".repeat(50) + "x",
    "?*".repeat(25) + "**" + "?".repeat(25) + "ZZZ",
  ];
  const m = new IgnoreMatcher(hostile);
  const candidates = ["a".repeat(25), "/" + "ab/".repeat(40) + "tail.jsonl", "b".repeat(200)];
  const t0 = performance.now();
  for (const c of candidates) {
    assert.ok(!m.ignores(c, [c]), "hostile patterns must not match these candidates");
  }
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 100, `hostile patterns took ${elapsed.toFixed(1)}ms (bound: 100ms)`);
});

test("wildcard-heavy patterns still match correctly (DP semantics)", () => {
  const m = new IgnoreMatcher(["*?*?*.jsonl", "/a/**/b/*.jsonl", "**z"]);
  assert.ok(m.ignores("/p", ["ab.jsonl"]), "two ? need two chars before .jsonl");
  assert.ok(!m.ignores("/p", ["a.jsonl"]), "only one char before .jsonl");
  assert.ok(m.ignores("/a/x/y/b/c.jsonl"));
  assert.ok(!m.ignores("/a/x/y/c.jsonl"));
  assert.ok(m.ignores("/p", ["xyz"]), "** may consume everything before the literal");
  assert.ok(m.ignores("/p", ["z"]), "** matches empty");
});

test("loadIgnore: missing file means empty matcher; empty matcher ignores nothing", (t) => {
  const { store } = setup(t);
  const m = loadIgnore(store.root);
  assert.equal(m.size, 0);
  assert.ok(!m.ignores("/anything", ["anything"]));
});

// ---------------------------------------------------------------- sessions

test("ignored session is never captured: no turn, no blob, and it is counted", (t) => {
  const { base, store } = setup(t);
  const projects = join(base, "projects", "-my-project");
  const secret = writeSession(projects, "secret-session.jsonl", "the private words");
  const open = writeSession(projects, "open-session.jsonl", "the public words");
  mkdirSync(store.root, { recursive: true });
  writeFileSync(ignoreFilePath(store.root), "# privacy\nsecret-session\n");

  const r = captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  assert.equal(r.ignored, 1, "ignored files are visible in the pass result");
  assert.equal(r.appended, 1);

  const turns = store.readStream("mac~cc");
  assert.equal(turns.length, 1);
  assert.equal(turns[0].thread, "cc:session:open-session");

  // Prevention is total: the ignored bytes are nowhere in the object store.
  assert.ok(store.hasObject("sha256:" + sha256Hex(Buffer.from(open.bytes))));
  assert.ok(!store.hasObject("sha256:" + sha256Hex(Buffer.from(secret.bytes))), "no blob stored");
});

test("path glob ignores a whole project directory, for every session format", (t) => {
  const { base, store } = setup(t);
  writeSession(join(base, "projects", "-secret-proj"), "a.jsonl", "hidden");
  writeSession(join(base, "projects", "-open-proj"), "b.jsonl", "visible");
  mkdirSync(store.root, { recursive: true });
  writeFileSync(ignoreFilePath(store.root), "**/-secret-proj/**\n");

  for (const format of ["cc", "pi", "codex"]) {
    const r = captureSessions(store, { owner: "mac", roots: [join(base, "projects")], format });
    assert.equal(r.ignored, 1, `${format}: secret project ignored`);
  }
  // The ignore check runs before the shared seen cache, so every format
  // reports the ignored file; the open one was captured once (by cc, the
  // first pass — later formats see it unchanged in the seen cache).
  const turns = store.readStream("mac~cc");
  assert.equal(turns.length, 1);
});

test("ignore is per record root", (t) => {
  const { base } = setup(t);
  writeSession(join(base, "projects", "-p"), "s.jsonl", "words");
  const restricted = new RecordStore(join(base, "restricted"), { owner: "mac" });
  const open = new RecordStore(join(base, "open"), { owner: "mac" });
  mkdirSync(restricted.root, { recursive: true });
  writeFileSync(ignoreFilePath(restricted.root), "s\n");

  const roots = [join(base, "projects")];
  assert.equal(captureSessions(restricted, { owner: "mac", roots }).appended, 0);
  assert.equal(captureSessions(open, { owner: "mac", roots }).appended, 1);
});

test("un-ignoring works: the seen cache never swallowed the ignored file", (t) => {
  const { base, store } = setup(t);
  const projects = join(base, "projects", "-p");
  writeSession(projects, "later.jsonl", "captured only after un-ignore");
  mkdirSync(store.root, { recursive: true });
  writeFileSync(ignoreFilePath(store.root), "later\n");

  const roots = [join(base, "projects")];
  const r1 = captureSessions(store, { owner: "mac", roots });
  assert.equal(r1.appended, 0);
  assert.equal(r1.ignored, 1);

  // Remove the pattern; the very next pass captures the unchanged file.
  writeFileSync(ignoreFilePath(store.root), "");
  const r2 = captureSessions(store, { owner: "mac", roots });
  assert.equal(r2.ignored, 0);
  assert.equal(r2.appended, 1, "file untouched since being ignored is still captured");
  assert.equal(store.readStream("mac~cc")[0].thread, "cc:session:later");
});

test("ignoring is forward-looking: already-captured turns stay in the record", (t) => {
  const { base, store } = setup(t);
  const projects = join(base, "projects", "-p");
  writeSession(projects, "s1.jsonl", "captured before the rule existed");
  const roots = [join(base, "projects")];
  assert.equal(captureSessions(store, { owner: "mac", roots }).appended, 1);

  mkdirSync(store.root, { recursive: true });
  writeFileSync(ignoreFilePath(store.root), "s1\n");
  writeSession(projects, "s1.jsonl", "grown after the rule"); // file changed
  const r = captureSessions(store, { owner: "mac", roots });
  assert.equal(r.ignored, 1);
  assert.equal(r.appended, 0, "no new snapshot once ignored");
  assert.equal(store.readStream("mac~cc").length, 1, "existing turn not removed");
});

// ----------------------------------------------------------------- aw logs

test("ignored comm log is never captured and is reported, by account or path", (t) => {
  const { base, store } = setup(t);
  const logs = join(base, "aw-logs");
  mkdirSync(logs, { recursive: true });
  const entry = (body) =>
    JSON.stringify({ ts: "2026-03-01T10:00:00Z", dir: "send", ch: "mail", to: "acme/b", body }) +
    "\n";
  writeFileSync(join(logs, "acme-secret.jsonl"), entry("private"));
  writeFileSync(join(logs, "acme-open.jsonl"), entry("public"));
  mkdirSync(store.root, { recursive: true });
  writeFileSync(ignoreFilePath(store.root), "acme-secret\n");

  const results = captureAwLogs(store, { owner: "mac", commLogDir: logs });
  const ignored = results.filter((r) => r.ignored);
  assert.equal(ignored.length, 1);
  assert.equal(ignored[0].account, "acme-secret");
  const captured = results.filter((r) => !r.ignored);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].appended, 1);

  const turns = store.readStream("mac~aw");
  assert.equal(turns.length, 1);
  assert.equal(turns[0].body.text, "public");

  // Un-ignore: next pass picks the file up (seen cache untouched).
  writeFileSync(ignoreFilePath(store.root), "");
  const r2 = captureAwLogs(store, { owner: "mac", commLogDir: logs });
  assert.equal(r2.filter((r) => !r.ignored && r.appended === 1).length, 1);
  assert.equal(store.readStream("mac~aw").length, 2);
});

// ------------------------------------------------------------ fail closed

test("an unreadable ignore file fails the pass actionably, not open", (t) => {
  const { base, store } = setup(t);
  writeSession(join(base, "projects", "-p"), "s.jsonl", "words");
  mkdirSync(join(store.root, "ignore"), { recursive: true }); // a directory: EISDIR
  assert.throws(
    () => captureSessions(store, { owner: "mac", roots: [join(base, "projects")] }),
    (err) =>
      err instanceof IgnoreError &&
      err.message.includes(ignoreFilePath(store.root)) &&
      /remove it/.test(err.message),
    "error must name the ignore file and say what to do",
  );
});

test("ignore file bytes are read as written (sanity read-back)", (t) => {
  const { store } = setup(t);
  mkdirSync(store.root, { recursive: true });
  writeFileSync(ignoreFilePath(store.root), "# c\npat-*\n");
  assert.equal(readFileSync(ignoreFilePath(store.root), "utf8"), "# c\npat-*\n");
  assert.deepEqual(loadIgnore(store.root).patterns, ["pat-*"]);
});
