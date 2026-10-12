// Release-notes entries (docs/release-lane.md, "Release-notes entries"): a
// pull request writes its entry as one file under docs/release-notes/next/,
// and scripts/assemble-release-notes.mjs moves the entries into the version's
// notes file. This file holds the entries on the tree to the checker, and pins
// the checker, the assembly of a text and the command.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENTRY_NAME, SECTIONS, assembleNotes, checkEntry, checkNotes, entriesDir, listEntryFiles } from "../scripts/assemble-release-notes.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../scripts/assemble-release-notes.mjs", import.meta.url));

/** A temporary root: `files` are paths under docs/release-notes/ and their text. */
function fixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "oats-notes-entries-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs", "release-notes"), { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    const path = join(root, "docs", "release-notes", file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}
const notesFile = (root, tag) => join(root, "docs", "release-notes", `${tag}.md`);
const tree = (root) => readdirSync(join(root, "docs", "release-notes"), { recursive: true }).map(String).sort();
function command(args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: tmpdir(), env, encoding: "utf8" });
}
const nonBlank = (text) => text.split("\n").filter((line) => line.trim() !== "");
/** Whether `needle` is in `hay` in order (other lines may stand between). */
function inOrder(needle, hay) {
  let at = 0;
  for (const line of hay) if (at < needle.length && line === needle[at]) at++;
  return at === needle.length;
}
/** The non-blank lines under each `## ` heading of a text with no fenced heading in it. */
function bySection(text) {
  const sections = new Map();
  let current = null;
  for (const line of nonBlank(text)) {
    if (line.startsWith("## ")) { current = line.slice(3).trimEnd(); assert.ok(!sections.has(current), `"## ${current}" stands once`); sections.set(current, []); }
    else if (current) sections.get(current).push(line);
  }
  return sections;
}

// --------------------------------------------------------------- this tree

test("every file under docs/release-notes/next/ of this tree is an entry file", () => {
  // With no directory there is nothing to hold: the directory exists only while it holds entries.
  for (const file of listEntryFiles(ROOT)) {
    assert.ok(file.regular, `docs/release-notes/next/${file.name} must be a regular file: anything in that directory counts as an unassembled entry`);
    assert.deepEqual(checkEntry(file.name, readFileSync(file.path, "utf8")), [], `docs/release-notes/next/${file.name} (docs/release-lane.md, "Release-notes entries", has the rules)`);
  }
});

test("the doc that owns the rule names the seven sections in the checker's order", () => {
  assert.deepEqual(SECTIONS, ["Upgrade", "Added", "Changed", "Fixed", "Removed", "Provider updates", "Documentation"]);
  const doc = readFileSync(join(ROOT, "docs", "release-lane.md"), "utf8");
  const section = doc.slice(doc.indexOf("\n## Release-notes entries\n"));
  assert.ok(section.length > 1, "docs/release-lane.md has the section");
  let at = 0;
  for (const name of SECTIONS) {
    const found = section.indexOf(`\`${name}\``, at);
    assert.ok(found > 0, `the doc names ${name}, after the sections before it`);
    at = found;
  }
});

// ------------------------------------------------------------- the checker

test("checkEntry accepts an entry: sections with entries under them, and nothing else", () => {
  assert.deepEqual(checkEntry("991-update-every-pi-folder.md", "## Fixed\n\n- **One fix** (#991).\n  Its second line.\n"), []);
  // Several sections, in any order; an Upgrade section holds paragraphs and numbered steps, no bullet.
  assert.deepEqual(checkEntry("7-a.md", "\n## Upgrade\nA paragraph.\n\n1. A step.\n\n## Provider updates\n\n- one\n\n## Added\n- two"), []);
  for (const name of SECTIONS) assert.deepEqual(checkEntry("a.md", `## ${name}\n\n- entry\n`), [], name);
  // Spaces at the end of a heading line are ignored: an invisible one makes no other section.
  assert.deepEqual(checkEntry("a.md", "## Added  \n\n- entry\n"), []);
});

test("checkEntry reports each problem of a file that is not an entry", () => {
  const problems = (name, text) => checkEntry(name, text);
  const only = (found, pattern) => { assert.equal(found.length, 1, found.join("\n")); assert.match(found[0], pattern); };
  const good = "## Added\n\n- entry\n";

  // the name does not match the pattern
  for (const name of ["README.md", "Fix-991.md", "991_fix.md", "-991.md", "991.txt", "991", ".991.md", "9 91.md"]) {
    assert.ok(!ENTRY_NAME.test(name));
    only(problems(name, good), /the file name must match/);
  }
  // a non-blank line stands before the first heading
  only(problems("a.md", "An introduction.\n\n## Added\n\n- entry\n"), /^line 1: text stands before the first "## " heading$/);
  only(problems("a.md", "\n\n- stray\n## Added\n\n- entry\n"), /^line 3: text stands before/);
  // there is no heading (an empty file, or text alone)
  only(problems("a.md", ""), /^no "## <Section>" heading/);
  only(problems("a.md", "\n\n"), /^no "## <Section>" heading/);
  only(problems("a.md", "- an entry with no section\n"), /^no "## <Section>" heading/);
  // a heading is not one of the seven sections: the match is exact
  for (const heading of ["Bugfixes", "added", "ADDED", "Provider  updates", "Provider Updates", "Fixed:", "Added (#991)", ""]) {
    only(problems("a.md", `## ${heading}\n\n- entry\n`), /is not a section \(one of, exactly: Upgrade, Added, Changed, Fixed, Removed, Provider updates, Documentation\)$/);
  }
  // a section appears twice
  only(problems("a.md", "## Added\n\n- one\n\n## Fixed\n\n- two\n\n## Added\n\n- three\n"), /^line 9: "## Added" appears twice$/);
  // a section has no non-blank line under it
  only(problems("a.md", "## Added\n\n## Fixed\n\n- two\n"), /^line 1: "## Added" has no entry under it$/);
  only(problems("a.md", "## Fixed\n\n- two\n\n## Added\n  \n"), /^line 5: "## Added" has no entry under it$/);
  // a title belongs to the notes file only
  only(problems("a.md", "## Added\n\n# OATS 1.2.3\n\n- entry\n"), /^line 3: a "# " title belongs to the notes file/);
  // a fenced block is never closed: after assembly it would turn every later heading of the notes file into text
  only(problems("a.md", "## Added\n\n- entry\n\n```bash\noats update\n"), /^line 5: the fenced block is never closed$/);

  // Every problem of a file is reported, not the first one.
  const all = problems("Draft.md", "intro\n\n## Added\n\n## News\n\n- x\n\n## Added\n\n- y\n# Title\n");
  assert.equal(all.length, 6, all.join("\n"));
  for (const pattern of [/file name/, /text stands before/, /line 3: "## Added" has no entry/, /"## News" is not a section/, /"## Added" appears twice/, /"# " title/]) {
    assert.ok(all.some((problem) => pattern.test(problem)), `${pattern} in:\n${all.join("\n")}`);
  }
});

test("checkEntry reads headings outside fenced code only", () => {
  // A `## ` and a `# ` line inside a fence are text: they are the entry under the heading.
  assert.deepEqual(checkEntry("a.md", "## Added\n\n```markdown\n# A title\n## Not a section\n## Added\n```\n"), []);
  assert.deepEqual(checkEntry("a.md", "## Added\n\n- a step:\n\n  ~~~\n  ## Fixed\n  ~~~\n"), [], "an indented fence, in tildes");
  // The fence closes at the same character, at least as long: a block that shows a fence stays one block.
  assert.deepEqual(checkEntry("a.md", "## Added\n\n````\n```\n## Shown\n```\n````\n"), []);
  assert.deepEqual(checkEntry("a.md", "## Added\n\n~~~\n```\n## Shown\n~~~\n"), []);
  // After the fence closes, a heading is a heading again.
  assert.match(checkEntry("a.md", "## Added\n\n```\n## Shown\n```\n\n## News\n\n- x\n").join("\n"), /^line 7: "## News" is not a section/);
  // Three backticks with a backtick after them are inline code, not a fence.
  assert.match(checkEntry("a.md", "## Added\n\n```code``` and text\n## News\n\n- x\n").join("\n"), /^line 4: "## News" is not a section/);
  // A heading starts at the first column: an indented one is text.
  assert.deepEqual(checkEntry("a.md", "## Added\n\n  ## Fixed\n"), []);
});

test("checkNotes refuses a notes file whose sections cannot be told apart", () => {
  assert.deepEqual(checkNotes("# OATS 1.2.3\n\nUnreleased\n\n## A highlight\n\n## A highlight\n\n## Added\n\n- x\n"), [], "a hand-written heading may repeat");
  assert.deepEqual(checkNotes("## Added\n\n```\n## Added\n```\n"), [], "a fenced heading is text");
  assert.match(checkNotes("## Added\n\n- x\n\n## Fixed\n\n## Added \n\n- y\n").join("\n"), /^"## Added" appears 2 times: merge them into one section first$/);
  assert.match(checkNotes("## Added\n\n~~~\n- x\n\n## Fixed\n").join("\n"), /^line 3: the fenced block is never closed$/);
});

// ------------------------------------------------------------ the assembly

const NOTES = [
  "# OATS 9.9.9", "", "Unreleased", "",
  "## Highlights for operators", "", "Hand-written text.", "",
  "## Added", "", "- old added", "",
  "## Fixed", "", "- old fixed", "  continued  ", "", "",
  "## Closing words", "", "Bye.", "",
].join("\n");
const ENTRIES = [
  // 996 sorts after 1002 as a string, before it as a number.
  { name: "996-b.md", text: "## Changed\n\n- changed by 996\n\n## Fixed\n\n- fixed by 996\n\n## Documentation\n- doc by 996\n" },
  { name: "1002-a.md", text: "\n## Fixed\n- fixed by 1002\n\n  its second paragraph\n\n\n## Upgrade\n\nA paragraph by 1002.\n\n1. A step.\n" },
];

test("assembleNotes puts each body in its section, in file-name order, and creates a section at its place", () => {
  const { text, sections } = assembleNotes(NOTES, ENTRIES, { version: "9.9.9" });
  assert.equal(text, [
    "# OATS 9.9.9", "", "Unreleased", "",
    "## Highlights for operators", "", "Hand-written text.", "",
    // created before the first later section the file has (Added); the hand-written heading stays first
    "## Upgrade", "", "A paragraph by 1002.", "", "1. A step.", "",
    "## Added", "", "- old added", "",
    // created before the first later section the file has (Fixed)
    "## Changed", "", "- changed by 996", "",
    // after what the section has; 1002 before 996; each body without its outer blank lines, its inner ones kept
    "## Fixed", "", "- old fixed", "  continued  ", "", "- fixed by 1002", "", "  its second paragraph", "", "- fixed by 996", "",
    // no later section in the file: right after the last earlier one, before the hand-written heading that follows it
    "## Documentation", "", "- doc by 996", "",
    "## Closing words", "", "Bye.", "",
  ].join("\n"));
  assert.deepEqual(sections, [
    { name: "Upgrade", created: true, files: ["1002-a.md"] },
    { name: "Changed", created: true, files: ["996-b.md"] },
    { name: "Fixed", created: false, files: ["1002-a.md", "996-b.md"] },
    { name: "Documentation", created: true, files: ["996-b.md"] },
  ]);
  // The order is the file names', whatever order the entries come in.
  assert.equal(assembleNotes(NOTES, [...ENTRIES].reverse(), { version: "9.9.9" }).text, text);
});

test("assembleNotes loses and changes no non-blank line of the notes file or of an entry", () => {
  const { text } = assembleNotes(NOTES, ENTRIES, { version: "9.9.9" });
  const result = nonBlank(text);
  assert.ok(inOrder(nonBlank(NOTES), result), "every non-blank line of the notes file, in order");
  const under = bySection(text);
  const created = ["## Upgrade", "## Changed", "## Documentation"];
  let moved = 0;
  for (const entry of ENTRIES) {
    for (const [name, lines] of bySection(entry.text)) {
      assert.ok(inOrder(lines, under.get(name)), `${entry.name}: every line under "## ${name}", in order, under that heading`);
      moved += lines.length;
    }
  }
  // Once: the result is the notes file's lines, the entries' lines and the created headings, and nothing more.
  assert.equal(result.length, nonBlank(NOTES).length + moved + created.length);
  for (const line of [...nonBlank(NOTES), ...ENTRIES.flatMap((entry) => [...bySection(entry.text).values()].flat()), ...created]) {
    assert.equal(result.filter((other) => other === line).length, 1, `once: ${line}`);
  }
  // What it did not touch is byte for byte: everything before the first insertion, and the tail.
  assert.ok(text.startsWith(NOTES.slice(0, NOTES.indexOf("## Added"))));
  assert.ok(text.endsWith("\n## Closing words\n\nBye.\n"));
});

test("assembleNotes creates a section at the end when the notes file has no later and no earlier one", () => {
  const entries = [{ name: "1-a.md", text: "## Changed\n\n- new\n" }];
  // no section at all; the file ends without a newline
  assert.equal(assembleNotes("# OATS 1.0.0\n\nUnreleased", entries, { version: "1.0.0" }).text, "# OATS 1.0.0\n\nUnreleased\n\n## Changed\n\n- new\n");
  // hand-written headings only; the file ends in several blank lines
  assert.equal(assembleNotes("# OATS 1.0.0\n\n## A highlight\n\ntext\n\n\n\n", entries, { version: "1.0.0" }).text, "# OATS 1.0.0\n\n## A highlight\n\ntext\n\n## Changed\n\n- new\n");
  // earlier sections only: after the last of them, which is the end
  assert.equal(assembleNotes("## Upgrade\n\n- u\n\n## Added\n\n- a\n", entries, { version: "1.0.0" }).text, "## Upgrade\n\n- u\n\n## Added\n\n- a\n\n## Changed\n\n- new\n");
  // a file that starts at a section: nothing is put before the created heading
  assert.equal(assembleNotes("## Fixed\n\n- f\n", entries, { version: "1.0.0" }).text, "## Changed\n\n- new\n\n## Fixed\n\n- f\n");
});

test("assembleNotes keeps what it does not add, blank lines aside where text goes in", () => {
  const entries = [{ name: "1-a.md", text: "## Added\n\n- new\n" }];
  const at = (notes) => assembleNotes(notes, entries, { version: "1.0.0" }).text;
  // a known section with nothing under it yet
  assert.equal(at("## Added\n\n## Fixed\n\n- f\n"), "## Added\n\n- new\n\n## Fixed\n\n- f\n");
  assert.equal(at("## Added\n## Fixed\n- f\n"), "## Added\n\n- new\n\n## Fixed\n- f\n");
  assert.equal(at("## Added"), "## Added\n\n- new\n");
  // the file ends without a newline, or in several blank lines: it ends in one newline
  assert.equal(at("## Added\n\n- a"), "## Added\n\n- a\n\n- new\n");
  assert.equal(at("## Added\n\n- a\n\n\n\n"), "## Added\n\n- a\n\n- new\n");
  // blank lines and spacing the insertion does not meet are kept: after the title, between other sections, inside lines
  assert.equal(at("# T\n\n\n\n## Added\n\n\n- a\t\n\n\n## Fixed\n- f  \n\n\n\n## Removed\n\n- r\n"), "# T\n\n\n\n## Added\n\n\n- a\t\n\n- new\n\n## Fixed\n- f  \n\n\n\n## Removed\n\n- r\n");
  // a heading of the notes file is kept byte for byte, its trailing spaces too, and it is the section
  assert.equal(at("## Added  \n\n- a\n"), "## Added  \n\n- a\n\n- new\n");
  // a fenced heading of the notes file is text: the body goes to the section, not into the fence
  assert.equal(at("## Fixed\n\n```\n## Added\n```\n\n## Added\n\n- a\n"), "## Fixed\n\n```\n## Added\n```\n\n## Added\n\n- a\n\n- new\n");
  // a hand-written heading between two sections stays between them
  assert.equal(at("## Upgrade\n\n- u\n\n## A highlight\n\ntext\n\n## Fixed\n\n- f\n"), "## Upgrade\n\n- u\n\n## A highlight\n\ntext\n\n## Added\n\n- new\n\n## Fixed\n\n- f\n");
  // an entry's fenced block moves whole, a `## ` line in it included
  assert.equal(assembleNotes("## Added\n\n- a\n", [{ name: "1-a.md", text: "## Added\n\n- new:\n\n  ```\n  ## Fixed\n  ```\n" }], { version: "1.0.0" }).text, "## Added\n\n- a\n\n- new:\n\n  ```\n  ## Fixed\n  ```\n");
});

test("assembleNotes creates a notes file that does not exist", () => {
  assert.equal(assembleNotes(null, [], { version: "1.2.3" }).text, "# OATS 1.2.3\n\nUnreleased\n");
  const { text, sections } = assembleNotes(null, ENTRIES, { version: "1.2.3" });
  assert.equal(text, [
    "# OATS 1.2.3", "", "Unreleased", "",
    "## Upgrade", "", "A paragraph by 1002.", "", "1. A step.", "",
    "## Changed", "", "- changed by 996", "",
    "## Fixed", "", "- fixed by 1002", "", "  its second paragraph", "", "- fixed by 996", "",
    "## Documentation", "", "- doc by 996", "",
  ].join("\n"));
  assert.ok(sections.every((section) => section.created));
});

// ------------------------------------------------------------- the command

test("the command moves the entries into the notes file and removes them; a second run changes nothing", (t) => {
  const root = fixture(t, { "v9.9.9.md": NOTES, "v9.9.8.md": "# OATS 9.9.8\n", ...Object.fromEntries(ENTRIES.map((entry) => [`next/${entry.name}`, entry.text])) });
  assert.deepEqual(listEntryFiles(root).map((file) => file.name), ["1002-a.md", "996-b.md"], "file-name order as plain strings");
  const first = command(["--tag", "v9.9.9", "--root", root]);
  assert.equal(first.status, 0, first.stderr);
  const written = readFileSync(notesFile(root, "v9.9.9"), "utf8");
  assert.equal(written, assembleNotes(NOTES, ENTRIES, { version: "9.9.9" }).text);
  // per section, the files that went into it
  assert.match(first.stdout, /^docs\/release-notes\/v9\.9\.9\.md: updated, 2 entry files moved in$/m);
  assert.match(first.stdout, /^ {2}## Upgrade \(new section\): 1002-a\.md$/m);
  assert.match(first.stdout, /^ {2}## Fixed: 1002-a\.md, 996-b\.md$/m);
  assert.match(first.stdout, /^removed the entry files and docs\/release-notes\/next\/$/m);
  // the entry files and the emptied directory are gone, nothing else is left or touched
  assert.deepEqual(tree(root), ["v9.9.8.md", "v9.9.9.md"]);
  assert.equal(readFileSync(notesFile(root, "v9.9.8"), "utf8"), "# OATS 9.9.8\n", "no other notes file is touched");

  const second = command(["--tag=v9.9.9", `--root=${root}`]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /^nothing to do: no entry file under docs\/release-notes\/next\//);
  assert.equal(readFileSync(notesFile(root, "v9.9.9"), "utf8"), written);
  assert.deepEqual(tree(root), ["v9.9.8.md", "v9.9.9.md"]);

  // A later run in the same release: the new entry goes after the earlier ones.
  mkdirSync(entriesDir(root));
  writeFileSync(join(entriesDir(root), "5-later.md"), "## Fixed\n\n- fixed by 5\n");
  assert.equal(command(["--tag", "v9.9.9", "--root", root]).status, 0);
  assert.match(readFileSync(notesFile(root, "v9.9.9"), "utf8"), /- fixed by 996\n\n- fixed by 5\n\n## Documentation\n/);
});

test("the command creates the notes file of a version that has none, with or without entries", (t) => {
  const empty = fixture(t);
  const bare = command(["--tag", "v1.2.3", "--root", empty]);
  assert.equal(bare.status, 0, bare.stderr);
  assert.match(bare.stdout, /^docs\/release-notes\/v1\.2\.3\.md: created, 0 entry files moved in$/m);
  assert.equal(readFileSync(notesFile(empty, "v1.2.3"), "utf8"), "# OATS 1.2.3\n\nUnreleased\n");
  assert.deepEqual(tree(empty), ["v1.2.3.md"]);
  // an empty directory holds nothing: the notes file is created and the directory goes
  const emptied = fixture(t);
  mkdirSync(entriesDir(emptied));
  assert.equal(command(["--tag", "v1.2.3", "--root", emptied]).status, 0);
  assert.deepEqual(tree(emptied), ["v1.2.3.md"]);

  const root = fixture(t, { "next/12-a.md": "## Added\n\n- new\n" });
  const r = command(["--tag", "v1.2.3", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(notesFile(root, "v1.2.3"), "utf8"), "# OATS 1.2.3\n\nUnreleased\n\n## Added\n\n- new\n");
  assert.deepEqual(tree(root), ["v1.2.3.md"]);
});

test("the command refuses as a whole: one bad entry among good ones writes nothing and removes nothing", (t) => {
  const files = {
    "v9.9.9.md": NOTES,
    "next/1002-a.md": ENTRIES[1].text,
    "next/996-b.md": ENTRIES[0].text,
    "next/997-bad.md": "## Bugfixes\n\n- x\n\n## Added\n",
  };
  const root = fixture(t, files);
  const before = tree(root);
  const r = command(["--tag", "v9.9.9", "--root", root]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  // every problem, each with its file
  assert.match(r.stderr, /^refused: 2 problems; nothing was written or removed$/m);
  assert.match(r.stderr, /^- docs\/release-notes\/next\/997-bad\.md: line 1: "## Bugfixes" is not a section/m);
  assert.match(r.stderr, /^- docs\/release-notes\/next\/997-bad\.md: line 5: "## Added" has no entry under it$/m);
  assert.deepEqual(tree(root), before, "every entry file is still there, and no temporary file");
  for (const [file, text] of Object.entries(files)) assert.equal(readFileSync(join(root, "docs", "release-notes", file), "utf8"), text, `${file} is byte-identical`);
});

test("the command refuses anything under next/ that is not an entry file, and a notes file it cannot read cleanly", (t) => {
  const refused = (root, pattern) => {
    const before = tree(root);
    const r = command(["--tag", "v9.9.9", "--root", root]);
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, pattern);
    assert.deepEqual(tree(root), before);
    assert.equal(readFileSync(notesFile(root, "v9.9.9"), "utf8"), NOTES);
  };
  refused(fixture(t, { "v9.9.9.md": NOTES, "next/README.md": "Entries wait here.\n" }), /next\/README\.md: the file name must match[\s\S]*next\/README\.md: no "## <Section>" heading/);
  refused(fixture(t, { "v9.9.9.md": NOTES, "next/Fix-991.md": "## Fixed\n\n- x\n" }), /next\/Fix-991\.md: the file name must match/);
  refused(fixture(t, { "v9.9.9.md": NOTES, "next/991-fix.md": "" }), /next\/991-fix\.md: no "## <Section>" heading/);
  refused(fixture(t, { "v9.9.9.md": NOTES, "next/991-fix/entry.md": "## Fixed\n\n- x\n" }), /next\/991-fix: not a regular file/);
  const linked = fixture(t, { "v9.9.9.md": NOTES, "elsewhere.md": "## Fixed\n\n- x\n" });
  mkdirSync(entriesDir(linked));
  symlinkSync(join("..", "elsewhere.md"), join(entriesDir(linked), "991-fix.md"));
  refused(linked, /next\/991-fix\.md: not a regular file/);

  // A notes file that holds a section twice, also when there is no entry to move.
  const twice = "# OATS 9.9.9\n\n## Added\n\n- a\n\n## Fixed\n\n- f\n\n## Added\n\n- b\n";
  for (const files of [{ "v9.9.9.md": twice }, { "v9.9.9.md": twice, "next/1-a.md": "## Added\n\n- new\n" }]) {
    const root = fixture(t, files);
    const before = tree(root);
    const r = command(["--tag", "v9.9.9", "--root", root]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^- docs\/release-notes\/v9\.9\.9\.md: "## Added" appears 2 times/m);
    assert.deepEqual(tree(root), before);
    assert.equal(readFileSync(notesFile(root, "v9.9.9"), "utf8"), twice);
  }
});

test("the command line: --tag is required and looks like vX.Y.Z; --help prints the usage", (t) => {
  const root = fixture(t, { "next/1-a.md": "## Added\n\n- new\n" });
  for (const args of [[], ["--root", root], ["--tag", "9.9.9", "--root", root], ["--tag", "v9.9", "--root", root], ["--tag", "v9.9.9-rc.1", "--root", root], ["--tag", "latest", "--root", root]]) {
    const r = command(args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /--tag is required and must look like vX\.Y\.Z/);
    assert.match(r.stderr, /^usage: node scripts\/assemble-release-notes\.mjs --tag vX\.Y\.Z \[--root <dir>\]/m);
  }
  for (const [args, pattern] of [[["--tag"], /--tag needs a value/], [["--tag", "v9.9.9", "--root"], /--root needs a value/], [["--tag", "v9.9.9", "--dry-run", "--root", root], /unexpected argument "--dry-run"/], [["v9.9.9"], /unexpected argument "v9\.9\.9"/]]) {
    const r = command(args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, pattern);
  }
  // a root that is not a checkout is refused, not created
  const nowhere = join(root, "nowhere");
  const missing = command(["--tag", "v9.9.9", "--root", nowhere]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /is not a directory: --root must be a checkout of the repository/);
  assert.ok(!existsSync(nowhere));
  // none of the refusals above wrote or removed anything
  assert.deepEqual(tree(root), ["next", "next/1-a.md"]);

  const help = command(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^usage: node scripts\/assemble-release-notes\.mjs --tag vX\.Y\.Z \[--root <dir>\]$/m);
  assert.ok(help.stdout.includes(`sections, in order: ${SECTIONS.join(", ")}`));
  assert.match(help.stdout, /exit status: 0 done or nothing to do, 2 refused\./);
});
